#!/usr/bin/env node

/**
 * Kill a SINGLE FarmStay service by freeing its port — standalone, cross-platform,
 * and (unlike `control.js stop <service>`) it does NOT need the supervisor
 * (`npm run farmstay`) to be running. Handy for simulating a one-service outage
 * to watch the gateway degrade.
 *
 *   node kill-service.js inventory          # frees :50071
 *   node kill-service.js pricing            # frees :4311
 *   node kill-service.js reservation        # frees :50072
 *   node kill-service.js review-desk         # frees :4312   (alias: reviews / review)
 *   node kill-service.js gateway            # frees :4310
 *   node kill-service.js control            # frees :4319   (the supervisor's control server)
 *   node kill-service.js all                # frees every port (same as kill-all.js)
 *   node kill-service.js <name> --force     # skip the identity check (see below)
 *
 * Also wired as `npm run farmstay:kill:<name>`.
 *
 * SAFETY: before killing, we confirm the process LISTENING on the port is really
 * the FarmStay service we expect — by matching its command line against the
 * service's entry directory (e.g. "inventory-service"). A stranger squatting on
 * the port is left alone unless you pass --force. See kill-port.js for why we
 * also target only the LISTENING socket (matching any socket referencing the
 * port would take the gateway down with the leaf).
 */

const path = require("path");
const { killPort } = require("./kill-port");
const { SERVICES, CONTROL_PORT } = require("./services");

// The directory that identifies a service in its command line, e.g.
// ".../inventory-service/server/index.js" → "inventory-service".
const entryMarker = (entry) => path.basename(path.dirname(path.dirname(entry)));

// name → { port, expect }. Registry services plus the supervisor's control port
// (the control server runs inside start-all.js).
const TARGETS = {};
for (const s of SERVICES) TARGETS[s.name] = { port: s.port(), expect: entryMarker(s.entry) };
TARGETS.control = { port: CONTROL_PORT, expect: "start-all.js" };

// Friendly aliases for the review-desk / gateway names used elsewhere.
const ALIAS = { reviews: "review-desk", review: "review-desk", "stay-gateway": "gateway" };

function resolve(name) {
  const key = ALIAS[name] || name;
  return { key, target: TARGETS[key] };
}

function usage() {
  const names = [...Object.keys(TARGETS), "all"];
  console.error(`Usage: node kill-service.js <service|all> [--force]\nServices: ${names.join(", ")}`);
}

function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const target = args.find((a) => !a.startsWith("-"));

  if (!target) {
    usage();
    process.exit(1);
  }

  if (target === "all") {
    console.log("Killing all FarmStay services...");
    for (const t of Object.values(TARGETS)) killPort(t.port, { expect: t.expect, force });
    console.log("\nDone! All FarmStay ports should be free.");
    return;
  }

  const { key, target: t } = resolve(target);
  if (!t) {
    console.error(`Unknown service "${target}".`);
    usage();
    process.exit(1);
  }

  console.log(`Killing FarmStay ${key} service (port ${t.port})...`);
  killPort(t.port, { expect: t.expect, force });
  console.log("\nDone!");
}

main();
