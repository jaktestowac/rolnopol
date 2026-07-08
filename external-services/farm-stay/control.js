#!/usr/bin/env node
/**
 * FarmStay control CLI — talks to the supervisor's control server (start-all.js)
 * to stop / start / restart an individual service at runtime, so you can
 * simulate outages and watch the gateway degrade.
 *
 *   node control.js status
 *   node control.js stop pricing
 *   node control.js start pricing
 *   node control.js restart inventory
 *   node control.js stop all
 *
 * (Also available as `npm run farmstay:control -- <cmd> [service]`.)
 */
const { NAMES, CONTROL_PORT } = require("./services");

const BASE = process.env.FARM_STAY_CONTROL_URL || `http://localhost:${CONTROL_PORT}`;
const ACTIONS = ["start", "stop", "restart"];

function usage() {
  console.log(`Usage:
  node control.js status
  node control.js <start|stop|restart> <service|all>

Services: ${NAMES.join(", ")}, all`);
}

async function api(method, path) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method });
  } catch (err) {
    console.error(`Cannot reach the supervisor at ${BASE} — is \`npm run farmstay\` running? (${err.message})`);
    process.exit(2);
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function printStatus(services) {
  const rows = services.map((s) => ({
    service: s.name,
    kind: s.kind,
    port: s.port,
    status: s.running ? "● running" : "○ stopped",
    pid: s.pid || "-",
    restarts: s.restarts,
  }));
  console.table(rows);
}

async function main() {
  const [cmd, target] = process.argv.slice(2);

  if (!cmd || cmd === "status") {
    const { json } = await api("GET", "/status");
    printStatus(json.services || []);
    return;
  }

  if (!ACTIONS.includes(cmd)) {
    usage();
    process.exit(1);
  }
  if (!target) {
    console.error(`"${cmd}" needs a service name (or "all").`);
    usage();
    process.exit(1);
  }
  if (target !== "all" && !NAMES.includes(target)) {
    console.error(`Unknown service "${target}". Known: ${NAMES.join(", ")}, all`);
    process.exit(1);
  }

  const { status, json } = await api("POST", `/${cmd}/${target}`);
  if (status >= 400) {
    console.error(`Failed: ${json.error || status}`);
    process.exit(1);
  }
  console.log(`${cmd} → ${target}:`, JSON.stringify(json.results));
  const after = await api("GET", "/status");
  printStatus(after.json.services || []);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
