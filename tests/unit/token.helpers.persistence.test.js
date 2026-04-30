import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const buildTokenStoragePath = (name) => path.join(os.tmpdir(), `rolnopol-${name}-${process.pid}.json`);

describe("token.helpers persistent registry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-21T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TOKEN_STORAGE_FILE;
    vi.resetModules();
  });

  it("rehydrates persisted user and admin sessions after module reload", async () => {
    const tokenStorageFile = buildTokenStoragePath("session-tokens");
    fs.rmSync(tokenStorageFile, { force: true });
    process.env.TOKEN_STORAGE_FILE = tokenStorageFile;

    const firstLoad = await import("../../helpers/token.helpers");
    firstLoad.clearAllTokens();

    const userToken = firstLoad.generateToken("persisted-user", { hours: 2 });
    const adminToken = firstLoad.generateAdminToken();

    expect(fs.existsSync(tokenStorageFile)).toBe(true);

    vi.resetModules();

    const secondLoad = await import("../../helpers/token.helpers");

    expect(secondLoad.isUserLogged(userToken)).toBe(true);
    expect(secondLoad.isAdminToken(adminToken)).toBe(true);
    expect(secondLoad.getUserCurrentToken("persisted-user")).toBe(userToken);
    expect(secondLoad.getTokenStats()).toEqual({
      totalTokens: 2,
      activeUserTokens: 1,
      activeAdminTokens: 1,
    });

    secondLoad.clearAllTokens();
    fs.rmSync(tokenStorageFile, { force: true });
  });

  it("persists last access and last modification timestamps for session records", async () => {
    const tokenStorageFile = buildTokenStoragePath("session-timestamp-fields");
    fs.rmSync(tokenStorageFile, { force: true });
    process.env.TOKEN_STORAGE_FILE = tokenStorageFile;

    const tokenHelpers = await import("../../helpers/token.helpers");
    tokenHelpers.clearAllTokens();

    const userToken = tokenHelpers.generateToken("timestamp-user", { hours: 2 });

    const createdSnapshot = JSON.parse(fs.readFileSync(tokenStorageFile, "utf8"));
    const storedTokenBeforeAccess = createdSnapshot.tokens["timestamp-user"];

    expect(storedTokenBeforeAccess.createdAt).toBe("2026-02-21T10:00:00.000Z");
    expect(storedTokenBeforeAccess.updatedAt).toBe("2026-02-21T10:00:00.000Z");
    expect(storedTokenBeforeAccess.lastAccessAt).toBe("2026-02-21T10:00:00.000Z");

    vi.advanceTimersByTime(60 * 1000);
    expect(tokenHelpers.isUserLogged(userToken)).toBe(true);

    const accessSnapshot = JSON.parse(fs.readFileSync(tokenStorageFile, "utf8"));
    const storedTokenAfterAccess = accessSnapshot.tokens["timestamp-user"];

    expect(storedTokenAfterAccess.createdAt).toBe("2026-02-21T10:00:00.000Z");
    expect(storedTokenAfterAccess.updatedAt).toBe("2026-02-21T10:00:00.000Z");
    expect(storedTokenAfterAccess.lastAccessAt).toBe("2026-02-21T10:01:00.000Z");

    tokenHelpers.clearAllTokens();
    fs.rmSync(tokenStorageFile, { force: true });
  });
});
