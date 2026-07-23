#!/usr/bin/env node
/**
 * AgriAcademy supervisor — spawns all five services, prefixes their logs, and
 * forwards SIGINT/SIGTERM so Ctrl-C stops the whole ecosystem cleanly.
 *
 * Leaves (question-bank, grading, certificate-issuer) + authoring start BEFORE
 * the exam center so the aggregate health (`GET /health/all` on :4350) is green
 * as soon as the runtime gateway is up. Dependency-free: only Node built-ins.
 *
 *     npm run academy
 */
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const SERVICES = [
  { name: "question-bank", entry: path.join(ROOT, "question-bank-service", "server", "index.js") },
  { name: "grading", entry: path.join(ROOT, "grading-service", "server", "index.js") },
  { name: "certificate-issuer", entry: path.join(ROOT, "certificate-issuer-service", "server", "index.js") },
  { name: "authoring", entry: path.join(ROOT, "authoring-service", "server", "index.js") },
  { name: "exam-center", entry: path.join(ROOT, "exam-center-service", "server", "index.js") },
];

const COLORS = {
  "question-bank": "\x1b[36m",
  grading: "\x1b[33m",
  "certificate-issuer": "\x1b[35m",
  authoring: "\x1b[32m",
  "exam-center": "\x1b[34m",
  supervisor: "\x1b[90m",
};
const RESET = "\x1b[0m";
const NO_COLOR = process.env.NO_COLOR != null;

function tag(name) {
  const label = `[${name}]`.padEnd(20);
  return NO_COLOR ? label : `${COLORS[name] || ""}${label}${RESET}`;
}
function log(name, line) {
  if (line.trim() === "") return;
  process.stdout.write(`${tag(name)} ${line}\n`);
}

const children = [];

function spawnService(def) {
  const child = spawn(process.execPath, [def.entry], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  children.push({ name: def.name, child });

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
    log("supervisor", `${def.name} exited (code=${code} signal=${signal})`);
  });
  return child;
}

async function main() {
  log("supervisor", `starting ${SERVICES.length} services…`);
  for (const def of SERVICES) {
    spawnService(def);
    log("supervisor", `${def.name} started`);
    // small stagger so leaf ports bind before the exam center dials them
    await new Promise((r) => setTimeout(r, 200));
  }

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("supervisor", `received ${signal}, stopping all services…`);
    for (const { child } of children) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    setTimeout(() => {
      for (const { child } of children) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
      process.exit(0);
    }, 2500).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log("supervisor", `fatal: ${err.message}`);
  process.exit(1);
});
