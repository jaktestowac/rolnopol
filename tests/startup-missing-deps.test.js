import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
const hc = require("../helpers/healthcheck.js");
const fs = require("fs");

describe("Startup dependency check", () => {
  let origFsExistsSync;
  let origProcessExit;

  beforeAll(() => {
    origProcessExit = process.exit;
    process.exit = vi.fn();

    origFsExistsSync = fs.existsSync;
    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      const normalized = String(p).replace(/\\/g, "/");
      if (normalized.endsWith("node_modules")) return false;
      return origFsExistsSync(p);
    });
  });

  afterAll(() => {
    if (fs.existsSync.mockRestore) fs.existsSync.mockRestore();
    process.exit = origProcessExit;
  });

  it("aborts startup and calls process.exit(1) when dependencies are missing", async () => {
    const path = require("path");
    const projectRoot = path.resolve(__dirname, "..");
    const nodeModulesPath = path.join(projectRoot, "node_modules");
    await hc.performStartupHealthCheck();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
