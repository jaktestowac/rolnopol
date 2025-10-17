import { describe, it, expect } from "vitest";
import * as tokenHelpers from "../../helpers/token.helpers";

describe("token.helpers", () => {
  it("should return false for isUserLogged with no token", () => {
    expect(tokenHelpers.isUserLogged("")).toBe(false);
    expect(tokenHelpers.isUserLogged(null)).toBe(false);
  });

  it("should generate a valid user token", () => {
    const userId = "test-user-123";
    const token = tokenHelpers.generateToken(userId);

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("should generate a valid admin token", () => {
    const token = tokenHelpers.generateAdminToken();

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("should validate user token correctly", () => {
    const userId = "test-user-456";
    const token = tokenHelpers.generateToken(userId);

    const decodedUserId = tokenHelpers.getUserId(token);
    expect(decodedUserId).toBe(userId);

    const isLogged = tokenHelpers.isUserLogged(token);
    expect(isLogged).toBe(true);
  });

  it("should validate admin token correctly", () => {
    const token = tokenHelpers.generateAdminToken();

    const isAdmin = tokenHelpers.isAdminToken(token);
    expect(isAdmin).toBe(true);
  });

  it("should reject invalid tokens", () => {
    const isLogged = tokenHelpers.isUserLogged("invalid-token");
    expect(isLogged).toBe(false);

    const isAdmin = tokenHelpers.isAdminToken("invalid-token");
    expect(isAdmin).toBe(false);
  });

  it("should get token expiration date", () => {
    const userId = "test-user-789";
    const token = tokenHelpers.generateToken(userId);

    const expiration = tokenHelpers.getTokenExpiration(token);
    expect(expiration).toBeTruthy();
    expect(new Date(expiration).getTime()).toBeGreaterThan(Date.now());
  });

  // More tests can be added for token storage and expiration logic
});
