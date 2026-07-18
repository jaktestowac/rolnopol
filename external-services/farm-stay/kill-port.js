/**
 * Free a single TCP port by killing ONLY the process that is LISTENING on it —
 * and, optionally, only after confirming that process is the FarmStay service we
 * expect (so we never kill a stranger squatting on the port).
 *
 * WHY LISTENING-ONLY: a naive `netstat | findstr ":<port>"` (or `lsof -i:<port>`)
 * also matches every OTHER process that merely holds a CLIENT connection whose
 * *remote* port is <port>. The FarmStay gateway keeps warm keep-alive/gRPC
 * sockets open to each leaf, so those matches include the gateway itself — and
 * killing them takes the whole gateway down together with the one leaf you meant
 * to stop. We therefore match ONLY the socket in the LISTENING state whose LOCAL
 * address is on <port>.
 *
 * WHY IDENTITY VERIFICATION (opts.expect): before killing we read the listener's
 * command line and require it to contain an expected marker (the service's entry
 * directory, e.g. "inventory-service"). This works uniformly for REST *and* gRPC
 * services — and even for a hung process — unlike an HTTP /health probe, which
 * the gRPC leaves cannot answer and a hung service would fail anyway.
 */
const { execSync } = require("child_process");
const os = require("os");

const isWindows = os.platform() === "win32";

/** PIDs LISTENING on `port` — never a client socket whose remote port is `port`. */
function listeningPids(port) {
  const suffix = `:${port}`;
  if (isWindows) {
    let out = "";
    try {
      out = execSync("netstat -ano -p TCP", { encoding: "utf-8" });
    } catch {
      return [];
    }
    const pids = new Set();
    for (const line of out.split("\n")) {
      // Columns: Proto  Local Address  Foreign Address  State  PID
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 5 && cols[3] === "LISTENING" && cols[1].endsWith(suffix)) pids.add(cols[4]);
    }
    return [...pids].filter((pid) => pid && pid !== "0");
  }
  // Unix/macOS: -sTCP:LISTEN restricts to listeners, so a client socket whose
  // remote port is `port` is never returned.
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`, { encoding: "utf-8" });
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** Best-effort command line of a PID (for identity verification). "" if unknown. */
function commandLineOf(pid) {
  try {
    if (isWindows) {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return out.trim();
    }
    const out = execSync(`ps -p ${pid} -o args= 2>/dev/null || true`, { encoding: "utf-8" });
    return out.trim();
  } catch {
    return "";
  }
}

function killPid(pid) {
  try {
    execSync(isWindows ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`, { stdio: "pipe" });
    return true;
  } catch {
    return false; // already gone, or not ours to kill
  }
}

/**
 * Free `port` by killing its listener(s).
 *
 * @param {number} port
 * @param {object} [opts]
 * @param {string|string[]} [opts.expect] marker(s) that must appear in the
 *   listener's command line for it to be killed. A mismatch is skipped (the port
 *   is left alone). If the command line cannot be read, we fall back to killing
 *   and note that identity could not be verified.
 * @param {boolean} [opts.force] skip identity verification entirely.
 * @param {(msg: string) => void} [opts.log]
 */
function killPort(port, opts = {}) {
  const { expect, force = false, log = console.log } = opts;
  const expects = expect == null ? [] : Array.isArray(expect) ? expect : [expect];

  log(`\nChecking port ${port}...`);
  const pids = listeningPids(port);
  if (!pids.length) {
    log(`  ✓ Port ${port} is free`);
    return;
  }

  let killed = 0;
  let skipped = 0;
  for (const pid of pids) {
    if (!force && expects.length) {
      const cmd = commandLineOf(pid);
      if (cmd && !expects.some((e) => cmd.includes(e))) {
        log(`  ⚠ PID ${pid} on port ${port} is NOT a FarmStay service — skipping (pass --force to kill anyway).`);
        log(`     ${cmd}`);
        skipped += 1;
        continue;
      }
      if (!cmd) log(`  … could not verify PID ${pid} identity — killing anyway.`);
    }
    if (killPid(pid)) {
      log(`  Killed PID ${pid} on port ${port}`);
      killed += 1;
    }
  }

  if (killed) log(`  ✓ Port ${port} freed`);
  else if (skipped) log(`  ⚠ Port ${port} left alone (${skipped} non-FarmStay process(es) on it).`);
  else log(`  ✓ Port ${port} is free`);
}

module.exports = { listeningPids, commandLineOf, killPort };
