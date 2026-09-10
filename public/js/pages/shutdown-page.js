/* Hidden operator page: /operator/shutdown
 *
 * Drives the two-stage safety (release the safety, then hold the button for
 * HOLD_MS) and calls GET /api/v1/shutdown. The server is the real gate — it
 * refuses any caller that is not on this machine — so nothing here is a security
 * control; the safety exists so a stray click cannot stop the application, and
 * the console exists so the operator can see what the server answered.
 *
 * Vanilla IIFE, matching the other page scripts in this directory. */
(function () {
  "use strict";

  const HOLD_MS = 3000; // hold this long to fire
  const RING_CIRCUMFERENCE = 339.292; // 2πr for r=54, matches the SVG in the markup
  const PING_INTERVAL_MS = 900;
  const PING_TIMEOUT_MS = 2500;
  const PING_ATTEMPTS = 12; // ~11s of grace before we stop guessing

  const el = {
    page: document.body,
    shell: document.getElementById("shutdownShell"),
    host: document.getElementById("shutdownHost"),
    version: document.getElementById("shutdownVersion"),
    gate: document.getElementById("shutdownGate"),
    armSwitch: document.getElementById("shutdownArmSwitch"),
    armState: document.getElementById("shutdownArmState"),
    armHint: document.getElementById("shutdownArmHint"),
    button: document.getElementById("shutdownButton"),
    buttonLabel: document.getElementById("shutdownButtonLabel"),
    progress: document.getElementById("shutdownProgress"),
    countdown: document.getElementById("shutdownCountdown"),
    log: document.getElementById("shutdownLog"),
    state: document.getElementById("shutdownState"),
    curtain: document.getElementById("shutdownCurtain"),
    curtainNote: document.getElementById("shutdownCurtainNote"),
    retry: document.getElementById("shutdownRetry"),
  };

  let armed = false;
  let holdStartedAt = null;
  let holdFrame = null;
  let fired = false;

  // ------------------------------------------------------------------ console

  function log(message, kind) {
    if (!el.log) return;

    const line = document.createElement("div");
    line.className = "shutdown-log__line" + (kind ? ` shutdown-log__line--${kind}` : "");

    const time = document.createElement("span");
    time.className = "shutdown-log__time";
    time.textContent = new Date().toLocaleTimeString("en-GB", { hour12: false });

    const body = document.createElement("span");
    body.className = "shutdown-log__body";
    body.textContent = message; // textContent, never innerHTML — server strings land here

    line.appendChild(time);
    line.appendChild(body);
    el.log.appendChild(line);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function setState(text, kind) {
    if (!el.state) return;

    el.state.textContent = text;
    el.state.classList.toggle("is-warn", kind === "warn");
    el.state.classList.toggle("is-error", kind === "error");
  }

  // -------------------------------------------------------------- arm / disarm

  function setArmed(next) {
    if (fired) return;

    armed = next === true;

    el.page.classList.toggle("is-armed", armed);
    el.armSwitch.setAttribute("aria-checked", armed ? "true" : "false");
    el.armState.textContent = armed ? "released" : "engaged";
    el.button.disabled = !armed;
    el.buttonLabel.textContent = armed ? "Hold to stop" : "Locked";

    if (el.armHint) {
      el.armHint.textContent = armed
        ? "Engage the safety to lock the control again. Escape also disarms."
        : "Release the safety to enable the shutdown control.";
    }

    if (armed) {
      log("Safety released — shutdown control live.", "warn");
      setState("armed", "warn");
    } else {
      cancelHold(false);
      log("Safety engaged.", "ok");
      setState("standby");
    }
  }

  // ------------------------------------------------------------ hold-to-fire

  function paintProgress(ratio) {
    const clamped = Math.max(0, Math.min(1, ratio));
    el.progress.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamped));
  }

  function tickHold() {
    if (holdStartedAt === null) return;

    const elapsed = Date.now() - holdStartedAt;
    const remaining = Math.max(0, HOLD_MS - elapsed);

    paintProgress(elapsed / HOLD_MS);
    el.countdown.textContent = remaining > 0 ? `${(remaining / 1000).toFixed(1)}s` : "";

    if (elapsed >= HOLD_MS) {
      cancelHold(true);
      fire();
      return;
    }

    holdFrame = window.requestAnimationFrame(tickHold);
  }

  function startHold() {
    if (!armed || fired || holdStartedAt !== null) return;

    holdStartedAt = Date.now();
    el.page.classList.add("is-holding");
    log("Holding…", "warn");
    holdFrame = window.requestAnimationFrame(tickHold);
  }

  function cancelHold(completed) {
    const wasHolding = holdStartedAt !== null;

    holdStartedAt = null;
    if (holdFrame !== null) {
      window.cancelAnimationFrame(holdFrame);
      holdFrame = null;
    }

    el.page.classList.remove("is-holding");
    el.countdown.textContent = "";
    paintProgress(completed ? 1 : 0);

    if (wasHolding && !completed) {
      log("Released early — shutdown aborted.", "ok");
      setState("armed", "warn");
    }
  }

  // ----------------------------------------------------------------- shutdown

  async function fire() {
    if (fired) return;
    fired = true;

    el.page.classList.add("is-firing");
    el.button.disabled = true;
    el.buttonLabel.textContent = "Sending";
    setState("shutting down", "warn");
    log("GET /api/v1/shutdown", "warn");

    let response;
    let payload = null;

    try {
      response = await fetch("/api/v1/shutdown", { headers: { Accept: "application/json" } });
      payload = await response.json().catch(() => null);
    } catch (error) {
      // The server can go down before the response is flushed — that is a
      // success, not a failure, so fall through to the liveness probe.
      log(`Request failed: ${error && error.message ? error.message : error}`, "warn");
      log("The server may already be going down — probing…", "warn");
      probeUntilDown();
      return;
    }

    log(`HTTP ${response.status}`, response.ok ? "ok" : "error");

    if (response.status === 403) {
      // The localhost gate refused us. Nothing was stopped.
      fired = false;
      el.page.classList.remove("is-firing");
      el.page.classList.add("is-denied");
      window.setTimeout(() => el.page.classList.remove("is-denied"), 800);

      el.gate.classList.add("is-remote");
      el.gate.textContent = "refused — not localhost";
      el.buttonLabel.textContent = "Hold to stop";
      el.button.disabled = !armed;

      log(payload && payload.error ? payload.error : "Refused: not a localhost caller.", "error");
      setState("refused", "error");
      return;
    }

    if (!response.ok) {
      fired = false;
      el.page.classList.remove("is-firing");
      el.buttonLabel.textContent = "Hold to stop";
      el.button.disabled = !armed;

      log(payload && payload.error ? payload.error : "Unexpected response.", "error");
      setState("error", "error");
      return;
    }

    if (payload && payload.message) log(payload.message, "ok");

    // NODE_ENV=test: the endpoint reports what it would do and stays up, so
    // there is nothing to probe for.
    if (payload && payload.data && payload.data.simulated === true) {
      log("Simulated — the server is running with NODE_ENV=test and stays up.", "warn");
      setState("simulated", "warn");
      el.page.classList.remove("is-firing");
      fired = false;
      el.buttonLabel.textContent = "Hold to stop";
      el.button.disabled = !armed;
      return;
    }

    log("Graceful teardown started: services, plugins, sockets, databases.", "warn");
    probeUntilDown();
  }

  // -------------------------------------------------------- liveness probing

  function pingOnce() {
    // AbortController rather than a bare fetch: a socket that hangs while the
    // server tears down would otherwise never settle.
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    return fetch(`/api/v1/ping?probe=${Date.now()}`, { cache: "no-store", signal: controller.signal })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => window.clearTimeout(timer));
  }

  async function probeUntilDown() {
    setState("verifying", "warn");
    log("Waiting for the server to stop answering…");

    for (let attempt = 1; attempt <= PING_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, PING_INTERVAL_MS));

      const alive = await pingOnce();
      if (!alive) {
        log("No answer — Rolnopol is down.", "ok");
        setState("down", "error");
        showCurtain("Rolnopol has stopped answering on this host.");
        return;
      }

      log(`Still answering (probe ${attempt}/${PING_ATTEMPTS})…`);
    }

    log("Server is still answering. Check the server console for the shutdown log.", "error");
    setState("unclear", "error");
  }

  function showCurtain(note) {
    if (el.curtainNote && note) el.curtainNote.textContent = note;

    el.curtain.setAttribute("aria-hidden", "false");
    el.page.classList.add("is-down");
    if (el.retry) el.retry.focus();
  }

  // -------------------------------------------------------------------- boot

  function bindEvents() {
    el.armSwitch.addEventListener("click", () => setArmed(!armed));

    // Pointer events cover mouse, touch and pen with one path. `pointercancel`
    // and `pointerleave` matter: dragging off the button must abort the hold.
    el.button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      startHold();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
      el.button.addEventListener(type, () => cancelHold(false));
    });

    // Keyboard equivalent of press-and-hold. `repeat` is ignored so the held key
    // does not restart the timer on every auto-repeat.
    el.button.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      if (!event.repeat) startHold();
    });
    el.button.addEventListener("keyup", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      cancelHold(false);
    });
    el.button.addEventListener("blur", () => cancelHold(false));

    if (el.retry) {
      el.retry.addEventListener("click", async () => {
        el.retry.disabled = true;
        const alive = await pingOnce();
        el.retry.disabled = false;

        if (alive) {
          log("Server is answering again — reloading.", "ok");
          window.location.reload();
        } else {
          log("Still down.", "warn");
        }
      });
    }

    // Escape is the panic key: disarm and abort whatever is in flight locally.
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !fired) setArmed(false);
    });
  }

  async function showEnvironment() {
    const host = window.location.host || "unknown";
    el.host.textContent = `host ${host}`;

    // Purely informational: the browser's idea of "local" says nothing about
    // the socket the server will see. The server decides, and a refusal shows
    // up as the 403 branch above.
    const looksLocal = /^(localhost|127(\.\d+){3}|\[::1\])(:\d+)?$/i.test(host);
    if (!looksLocal) {
      el.gate.classList.add("is-remote");
      el.gate.textContent = "not localhost — will be refused";
      log(`This page was opened as "${host}", not localhost. The server will refuse the request.`, "error");
    }

    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      const data = await res.json();
      el.version.textContent = `v${data.version}`;
    } catch (error) {
      el.version.textContent = "v?";
    }
  }

  function init() {
    paintProgress(0);
    bindEvents();
    log("Operator shutdown console ready.", "ok");
    log("Release the safety, then hold the button for 3 seconds.");
    showEnvironment();
  }

  init();
})();
