import { describe, it, expect, vi, afterEach } from "vitest";

async function loadAuthenticateUser(tokenHelperOverrides = {}) {
  vi.resetModules();

  const tokenHelperMocks = {
    isUserLogged: vi.fn().mockReturnValue(false),
    getUserId: vi.fn().mockReturnValue(undefined),
    ...tokenHelperOverrides,
  };

  vi.doMock("../../helpers/token.helpers", () => tokenHelperMocks);

  const middlewareModule = await import("../../middleware/auth.middleware");
  return {
    authenticateUser: middlewareModule.authenticateUser,
    tokenHelperMocks,
  };
}

async function loadAuthenticateAdmin(tokenHelperOverrides = {}) {
  vi.resetModules();

  const tokenHelperMocks = {
    isAdminToken: vi.fn().mockReturnValue(false),
    ...tokenHelperOverrides,
  };

  vi.doMock("../../helpers/token.helpers", () => tokenHelperMocks);

  const middlewareModule = await import("../../middleware/auth.middleware");
  return {
    authenticateAdmin: middlewareModule.authenticateAdmin,
    tokenHelperMocks,
  };
}

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

describe("authenticateUser middleware", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("should return 401 if no token is provided", async () => {
    const { authenticateUser } = await loadAuthenticateUser();
    const req = { headers: {}, cookies: {} };
    const res = mockRes();
    const next = vi.fn();
    authenticateUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 403 if token is invalid", async () => {
    const { authenticateUser } = await loadAuthenticateUser({
      isUserLogged: vi.fn().mockReturnValue(false),
    });
    const req = { headers: { token: "invalid" }, cookies: {} };
    const res = mockRes();
    const next = vi.fn();
    authenticateUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 for malformed Authorization header when no fallback token exists", async () => {
    const { authenticateUser } = await loadAuthenticateUser();
    const req = {
      headers: { authorization: "Token raw-token-without-bearer-prefix" },
      cookies: {},
    };
    const res = mockRes();
    const next = vi.fn();

    authenticateUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should reject admin token on user-protected middleware", async () => {
    const adminToken = "admin-token";
    const { authenticateUser } = await loadAuthenticateUser({
      isUserLogged: vi.fn().mockReturnValue(false),
    });
    const req = {
      headers: { token: adminToken },
      cookies: {},
    };
    const res = mockRes();
    const next = vi.fn();

    authenticateUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("should prefer Authorization Bearer value over headers.token when bearer is invalid", async () => {
    const { authenticateUser, tokenHelperMocks } = await loadAuthenticateUser({
      isUserLogged: vi.fn().mockReturnValue(false),
    });
    const req = {
      headers: {
        authorization: "Bearer invalid-bearer-token",
        token: "fallback-header-token",
      },
      cookies: {},
    };
    const res = mockRes();
    const next = vi.fn();

    authenticateUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 403 when token is logged but userId cannot be decoded", async () => {
    const { authenticateUser } = await loadAuthenticateUser({
      isUserLogged: vi.fn().mockReturnValue(true),
      getUserId: vi.fn().mockReturnValue(undefined),
    });

    const req = {
      headers: { token: "valid-looking-token" },
      cookies: {},
    };
    const res = mockRes();
    const next = vi.fn();

    authenticateUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe("authenticateAdmin middleware", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("should return 401 if no admin token is provided", async () => {
    const { authenticateAdmin } = await loadAuthenticateAdmin();
    const req = { headers: {}, body: {}, cookies: {}, ip: "127.0.0.1" };
    const res = mockRes();
    const next = vi.fn();

    authenticateAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 403 for invalid admin token", async () => {
    const { authenticateAdmin } = await loadAuthenticateAdmin({
      isAdminToken: vi.fn().mockReturnValue(false),
    });
    const req = {
      headers: { authorization: "Bearer not-admin" },
      body: {},
      cookies: {},
      ip: "127.0.0.1",
    };
    const res = mockRes();
    const next = vi.fn();

    authenticateAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 for malformed Authorization header when no fallback admin token exists", async () => {
    const { authenticateAdmin } = await loadAuthenticateAdmin();
    const req = {
      headers: { authorization: "Token raw-admin-token" },
      body: {},
      cookies: {},
      ip: "127.0.0.1",
    };
    const res = mockRes();
    const next = vi.fn();

    authenticateAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
