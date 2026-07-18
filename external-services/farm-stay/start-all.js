#!/usr/bin/env node
/**
 * FarmStay supervisor — spawns all five services, prefixes their logs, and
 * forwards SIGINT/SIGTERM so Ctrl-C stops the whole ecosystem.
 *
 * It also runs a tiny HTTP CONTROL SERVER (default :4319) so you can
 * stop / start / restart an individual service at runtime to simulate outages
 * and watch the gateway's fallbacks kick in. Drive it with the control CLI:
 *
 *     npm run farmstay:control status
 *     npm run farmstay:control stop pricing
 *     npm run farmstay:control start pricing
 *     npm run farmstay:control restart inventory
 *
 * Dependency-free: only Node built-ins (child_process, http). Leaves start
 * before the gateway so aggregate health is green as soon as the gateway is up.
 */
const { spawn } = require("child_process");
const http = require("http");
const { SERVICES, NAMES, byName, CONTROL_PORT } = require("./services");

const COLORS = {
  inventory: "\x1b[36m",
  pricing: "\x1b[33m",
  reservation: "\x1b[35m",
  "review-desk": "\x1b[32m",
  gateway: "\x1b[34m",
  supervisor: "\x1b[90m",
};
const RESET = "\x1b[0m";
const NO_COLOR = process.env.NO_COLOR != null;

function tag(name) {
  const label = `[${name}]`.padEnd(13);
  return NO_COLOR ? label : `${COLORS[name] || ""}${label}${RESET}`;
}
function log(name, line) {
  if (line.trim() === "") return;
  process.stdout.write(`${tag(name)} ${line}\n`);
}

// managed[name] = { def, child, running, restarts, stopping }
const managed = {};

function spawnService(def) {
  const child = spawn(process.execPath, [def.entry], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const rec = managed[def.name];
  rec.child = child;
  rec.running = true;
  rec.stopping = false;

  const pipe = (stream) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const l of lines) log(def.name, l);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);

  child.on("exit", (code, signal) => {
    rec.running = false;
    rec.child = null;
    if (rec.stopping) {
      log("supervisor", `${def.name} stopped`);
    } else {
      log("supervisor", `${def.name} exited unexpectedly (code=${code} signal=${signal})`);
    }
  });
  return child;
}

async function startService(name) {
  const def = byName(name);
  if (!def) throw new Error(`unknown service: ${name}`);
  const rec = managed[name];
  if (rec.running) return { name, running: true, alreadyRunning: true };
  spawnService(def);
  log("supervisor", `${name} started (pid ${rec.child.pid}, :${def.port()})`);
  return { name, running: true, pid: rec.child.pid };
}

function stopService(name) {
  return new Promise((resolve) => {
    const rec = managed[name];
    if (!rec || !rec.running || !rec.child) return resolve({ name, running: false, alreadyStopped: true });
    rec.stopping = true;
    const child = rec.child; // capture THIS child; a restart may replace rec.child
    let forceTimer = null;
    const done = () => {
      if (forceTimer) clearTimeout(forceTimer);
      resolve({ name, running: false });
    };
    child.once("exit", done);
    child.kill("SIGTERM");
    // Force-kill THIS child if it doesn't exit promptly (cleared on exit above,
    // so a service restarted within the window is never hit by a stale timer).
    forceTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 2000);
  });
}

async function restartService(name) {
  const rec = managed[name];
  rec.restarts = (rec.restarts || 0) + 1;
  await stopService(name);
  return startService(name);
}

function status() {
  return NAMES.map((name) => {
    const rec = managed[name];
    const def = byName(name);
    return {
      name,
      kind: def.kind,
      port: def.port(),
      running: !!rec.running,
      pid: rec.child ? rec.child.pid : null,
      restarts: rec.restarts || 0,
    };
  });
}

// ── control HTTP server ─────────────────────────────────────────────────────

function startControlServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${CONTROL_PORT}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    try {
      // GET /status
      if (req.method === "GET" && (parts[0] === "status" || parts.length === 0)) {
        return send(200, { services: status() });
      }
      // POST /:action/:name  (action = start|stop|restart)  and /:action/all
      if (req.method === "POST" && parts.length === 2) {
        const [action, name] = parts;
        const targets = name === "all" ? NAMES : [name];
        if (name !== "all" && !byName(name)) return send(404, { error: `unknown service: ${name}` });
        const results = [];
        for (const t of targets) {
          if (action === "start") results.push(await startService(t));
          else if (action === "stop") results.push(await stopService(t));
          else if (action === "restart") results.push(await restartService(t));
          else return send(400, { error: `unknown action: ${action}` });
        }
        return send(200, { action, results });
      }
      return send(404, { error: "not found", usage: "GET /status | POST /{start|stop|restart}/{name|all}" });
    } catch (err) {
      return send(500, { error: err.message });
    }
  });
  server.listen(CONTROL_PORT, () =>
    log("supervisor", `control server on http://localhost:${CONTROL_PORT} (status | start|stop|restart /{name})`),
  );
  return server;
}

// ── boot ──────────────────────────────────────────────────────────────────────

async function main() {
  for (const def of SERVICES) managed[def.name] = { def, child: null, running: false, restarts: 0, stopping: false };

  log("supervisor", `starting ${SERVICES.length} services…`);
  for (const def of SERVICES) {
    await startService(def.name);
    // small stagger so leaf ports bind before the gateway dials them
    await new Promise((r) => setTimeout(r, 150));
  }
  const control = startControlServer();

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("supervisor", `received ${signal}, stopping all services…`);
    control.close();
    await Promise.all(NAMES.map((n) => stopService(n)));
    log("supervisor", "all stopped. bye.");
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log("supervisor", `fatal: ${err.message}`);
  process.exit(1);
});
