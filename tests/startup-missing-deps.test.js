import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
const hc = require("../helpers/healthcheck.js");
const fs = require("fs");

describe.skip("Startup dependency check", () => {
  let origFsExistsSync;
  let origProcessExit;

  beforeAll(() => {
    origFsExistsSync = fs.existsSync;
    origProcessExit = process.exit;
    // Simulate missing node_modules directory
    fs.existsSync = (p) => {
      if (String(p).endsWith("node_modules")) return false;
      return origFsExistsSync(p);
    };
    process.exit = vi.fn();
  });

  afterAll(() => {
    fs.existsSync = origFsExistsSync;
    process.exit = origProcessExit;
  });

  it("aborts startup and calls process.exit(1) when dependencies are missing", async () => {
    await hc.performStartupHealthCheck();
    expect(process.exit).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
