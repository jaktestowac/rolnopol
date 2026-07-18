#!/usr/bin/env node

/**
 * Kill all farmstay services and free their ports
 * Ports: 4310 (gateway), 50071 (inventory), 4311 (pricing), 50072 (reservation),
 *        4312 (review-desk), 4319 (control)
 *
 *   node kill-all.js            # verify each listener is a FarmStay service, then kill
 *   node kill-all.js --force    # kill whatever listens, no identity check
 *
 * Only the LISTENING process on each port is killed, and only after its command
 * line is confirmed to be the expected FarmStay service — see kill-port.js for
 * why both guards matter (matching any socket referencing the port would kill the
 * gateway along with a leaf; skipping the identity check risks killing a stranger
 * squatting on the port).
 */

const path = require("path");
const { killPort } = require("./kill-port");
const { SERVICES, CONTROL_PORT } = require("./services");

const entryMarker = (entry) => path.basename(path.dirname(path.dirname(entry)));

// [{ port, expect }] for every service plus the supervisor's control port.
const TARGETS = SERVICES.map((s) => ({ port: s.port(), expect: entryMarker(s.entry) }));
TARGETS.push({ port: CONTROL_PORT, expect: "start-all.js" });

const force = process.argv.includes("--force");

console.log("Killing farmstay services...");
for (const t of TARGETS) killPort(t.port, { expect: t.expect, force });
console.log("\nDone! All farmstay ports should be free.");
