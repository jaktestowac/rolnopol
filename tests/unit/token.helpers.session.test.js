import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as tokenHelpers from "../../helpers/token.helpers";

describe("token.helpers session semantics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-21T10:00:00.000Z"));
    tokenHelpers.clearAllTokens();
  });

  afterEach(() => {
    tokenHelpers.clearAllTokens();
    vi.useRealTimers();
  });

  it("invalidates the previous token when generating a second token for the same user", () => {
    const userId = "session-user-1";
    const firstToken = tokenHelpers.generateToken(userId, { hours: 2 });

    vi.advanceTimersByTime(1500);
    const secondToken = tokenHelpers.generateToken(userId, { hours: 2 });

    expect(secondToken).not.toBe(firstToken);

    expect(tokenHelpers.isTokenInStorage(firstToken)).toBe(false);
    expect(tokenHelpers.isUserLogged(firstToken)).toBe(false);

    expect(tokenHelpers.isTokenInStorage(secondToken)).toBe(true);
    expect(tokenHelpers.isUserLogged(secondToken)).toBe(true);
    expect(tokenHelpers.getUserCurrentToken(userId)).toBe(secondToken);

    expect(tokenHelpers.getTokenStats()).toEqual({
      totalTokens: 1,
      activeUserTokens: 1,
      activeAdminTokens: 0,
    });
  });

  it("invalidateUserTokens removes only the selected user token and returns the removed count", () => {
    const userToInvalidate = "session-user-2";
    const otherUser = "session-user-3";

    const removedUserToken = tokenHelpers.generateToken(userToInvalidate, { hours: 1 });
    const otherUserToken = tokenHelpers.generateToken(otherUser, { hours: 1 });
    const adminToken = tokenHelpers.generateAdminToken();

    const removedCount = tokenHelpers.invalidateUserTokens(userToInvalidate);

    expect(removedCount).toBe(1);
    expect(tokenHelpers.isTokenInStorage(removedUserToken)).toBe(false);

    expect(tokenHelpers.isTokenInStorage(otherUserToken)).toBe(true);
    expect(tokenHelpers.isUserLogged(otherUserToken)).toBe(true);
    expect(tokenHelpers.isAdminToken(adminToken)).toBe(true);

    expect(tokenHelpers.getTokenStats()).toEqual({
      totalTokens: 2,
      activeUserTokens: 1,
      activeAdminTokens: 1,
    });
  });

  it("cleanupExpiredTokens removes only expired tokens and updates token statistics", () => {
    const expiredUserToken = tokenHelpers.generateToken("session-user-expired", {
      minutes: 1,
    });
    const activeUserToken = tokenHelpers.generateToken("session-user-active", {
      hours: 2,
    });
    const adminToken = tokenHelpers.generateAdminToken();

    expect(tokenHelpers.getTokenStats()).toEqual({
      totalTokens: 3,
      activeUserTokens: 2,
      activeAdminTokens: 1,
    });

    vi.advanceTimersByTime(2 * 60 * 1000);
    tokenHelpers.cleanupExpiredTokens();

    expect(tokenHelpers.isTokenInStorage(expiredUserToken)).toBe(false);
    expect(tokenHelpers.isTokenInStorage(activeUserToken)).toBe(true);
    expect(tokenHelpers.isAdminToken(adminToken)).toBe(true);

    expect(tokenHelpers.getTokenStats()).toEqual({
      totalTokens: 2,
      activeUserTokens: 1,
      activeAdminTokens: 1,
    });
  });

  it("revokeToken immediately invalidates the active user token", () => {
    const userId = "session-user-revoke";
    const token = tokenHelpers.generateToken(userId, { hours: 1 });

    expect(tokenHelpers.isUserLogged(token)).toBe(true);
    expect(tokenHelpers.getUserCurrentToken(userId)).toBe(token);

    const revoked = tokenHelpers.revokeToken(token);

    expect(revoked).toBe(true);
    expect(tokenHelpers.isUserLogged(token)).toBe(false);
    expect(tokenHelpers.getUserCurrentToken(userId)).toBeNull();
    expect(tokenHelpers.hasActiveToken(userId)).toBe(false);
  });

  it("revokeAdminToken revokes only admin tokens and does not remove user tokens", () => {
    const userId = "session-user-admin-revoke-check";
    const userToken = tokenHelpers.generateToken(userId, { hours: 1 });
    const adminToken = tokenHelpers.generateAdminToken();

    const revokeUserAsAdmin = tokenHelpers.revokeAdminToken(userToken);
    expect(revokeUserAsAdmin).toBe(false);
    expect(tokenHelpers.isUserLogged(userToken)).toBe(true);

    const revokeAdmin = tokenHelpers.revokeAdminToken(adminToken);
    expect(revokeAdmin).toBe(true);
    expect(tokenHelpers.isAdminToken(adminToken)).toBe(false);
    expect(tokenHelpers.isUserLogged(userToken)).toBe(true);
  });

  it("clearAllTokens invalidates both user and admin sessions", () => {
    const userToken = tokenHelpers.generateToken("session-user-clear", {
      hours: 1,
    });
    const adminToken = tokenHelpers.generateAdminToken();

    expect(tokenHelpers.isUserLogged(userToken)).toBe(true);
    expect(tokenHelpers.isAdminToken(adminToken)).toBe(true);

    const clearedCount = tokenHelpers.clearAllTokens();

    expect(clearedCount).toBe(2);
    expect(tokenHelpers.isUserLogged(userToken)).toBe(false);
    expect(tokenHelpers.isAdminToken(adminToken)).toBe(false);
    expect(tokenHelpers.getTokenStats()).toEqual({
      totalTokens: 0,
      activeUserTokens: 0,
      activeAdminTokens: 0,
    });
  });
});
