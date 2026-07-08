#!/usr/bin/env node

/**
 * Kill all farmstay services and free their ports
 * Ports: 50071 (inventory), 4311 (pricing), 50072 (reservation), 4319 (control)
 */

const { execSync } = require("child_process");
const os = require("os");

const PORTS = [50071, 4311, 50072, 4319];
const isWindows = os.platform() === "win32";

function killProcessOnPort(port) {
  try {
    console.log(`\nChecking port ${port}...`);

    let command;
    if (isWindows) {
      // Windows: use netstat and taskkill
      command = `for /f "tokens=5" %a in ('netstat -ano ^| findstr ":${port}"') do taskkill /PID %a /F`;
      try {
        execSync(command, { stdio: "pipe", shell: "cmd" });
        console.log(`  ✓ Port ${port} freed`);
      } catch (e) {
        // Process might not exist, that's ok
        console.log(`  ✓ Port ${port} is free`);
      }
    } else {
      // Unix/Mac: use lsof and kill
      try {
        const output = execSync(`lsof -ti:${port} 2>/dev/null || true`, { encoding: "utf-8" });
        if (output.trim()) {
          const pids = output.trim().split("\n");
          for (const pid of pids) {
            if (pid) {
              try {
                execSync(`kill -9 ${pid}`, { stdio: "pipe" });
                console.log(`  Killing PID ${pid} on port ${port}...`);
              } catch (e) {
                // Already dead
              }
            }
          }
          console.log(`  ✓ Port ${port} freed`);
        } else {
          console.log(`  ✓ Port ${port} is free`);
        }
      } catch (e) {
        console.log(`  ✓ Port ${port} is free`);
      }
    }
  } catch (error) {
    console.error(`  Error checking port ${port}:`, error.message);
  }
}

console.log("Killing farmstay services...");
PORTS.forEach(killProcessOnPort);
console.log("\nDone! All farmstay ports should be free.");
