import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { localhostOnly, isLocalRequest, isLocalAddress } = require("../../middleware/localhost-only.middleware");

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

function makeReq(overrides = {}) {
  const { headers = {}, remoteAddress = "127.0.0.1", ...rest } = overrides;

  return {
    method: "GET",
    path: "/shutdown",
    originalUrl: "/api/v1/shutdown",
    headers,
    socket: { remoteAddress },
    ...rest,
  };
}

describe("isLocalAddress", () => {
  it("accepts the loopback forms Node hands out", () => {
    const loopback = [
      "127.0.0.1",
      "127.1.2.3", // the whole 127.0.0.0/8 block is loopback
      "::1",
      "0:0:0:0:0:0:0:1",
      "::ffff:127.0.0.1", // IPv4 peer on a dual-stack socket
      "[::1]",
      "::1%lo0",
      " 127.0.0.1 ",
      "::FFFF:127.0.0.1",
    ];

    for (const address of loopback) {
      expect(isLocalAddress(address), address).toBe(true);
    }
  });

  it("rejects non-loopback and unusable addresses", () => {
    const remote = [
      "192.168.0.10",
      "10.0.0.1",
      "8.8.8.8",
      "0.0.0.0",
      "::",
      "fe80::1",
      "2001:db8::1",
      "::ffff:192.168.0.10",
      "1270.0.0.1",
      "127.0.0.1.evil.com",
      "localhost", // a name, not an address — never a socket peer address
      "",
      "   ",
      null,
      undefined,
      127,
      {},
    ];

    for (const address of remote) {
      expect(isLocalAddress(address), String(address)).toBe(false);
    }
  });

  it("widens on extra rules — exact strings and regexes", () => {
    expect(isLocalAddress("192.168.0.10", ["192.168.0.10"])).toBe(true);
    expect(isLocalAddress("192.168.0.11", ["192.168.0.10"])).toBe(false);
    expect(isLocalAddress("10.1.2.3", [/^10\./])).toBe(true);
    // An extra rule written as an IPv4-mapped literal still matches the plain form.
    expect(isLocalAddress("192.168.0.10", ["::ffff:192.168.0.10"])).toBe(true);
  });

  it("ignores rules that are neither a string nor a regex", () => {
    expect(isLocalAddress("192.168.0.10", [null, 42, {}])).toBe(false);
  });
});

describe("isLocalRequest", () => {
  it("is true for a loopback peer with no proxy headers", () => {
    expect(isLocalRequest(makeReq())).toBe(true);
  });

  it("is false when a proxy hop header is present, even on a loopback socket", () => {
    expect(isLocalRequest(makeReq({ headers: { "x-forwarded-for": "203.0.113.7" } }))).toBe(false);
  });

  it("accepts proxied requests when explicitly told to", () => {
    const req = makeReq({ headers: { "x-forwarded-for": "203.0.113.7" } });

    expect(isLocalRequest(req, { allowProxyHopHeaders: true })).toBe(true);
  });

  it("is false for a remote peer", () => {
    expect(isLocalRequest(makeReq({ remoteAddress: "203.0.113.7" }))).toBe(false);
  });

  it("survives a request object without a socket", () => {
    expect(isLocalRequest({ headers: {} })).toBe(false);
    expect(isLocalRequest(undefined)).toBe(false);
  });
});

describe("localhostOnly middleware", () => {
  let next;
  let res;

  beforeEach(() => {
    next = vi.fn();
    res = mockRes();
  });

  it("lets a localhost request through", () => {
    localhostOnly()(makeReq(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("answers 403 to a remote request", () => {
    localhostOnly({ resourceName: "Shutdown" })(makeReq({ remoteAddress: "203.0.113.7" }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: "Shutdown is available from localhost only" }));
  });

  it("answers 403 when the peer is loopback but the request carries a proxy hop header", () => {
    // A local reverse proxy makes the socket loopback while the real client is
    // remote, and the header is client-controlled — so it must not be trusted.
    for (const header of ["x-forwarded-for", "x-real-ip", "forwarded"]) {
      next = vi.fn();
      res = mockRes();

      localhostOnly()(makeReq({ headers: { [header]: "203.0.113.7" } }), res, next);

      expect(next, header).not.toHaveBeenCalled();
      expect(res.status, header).toHaveBeenCalledWith(403);
    }
  });

  it("ignores an empty proxy hop header", () => {
    localhostOnly()(makeReq({ headers: { "x-forwarded-for": "  " } }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not consult req.ip, which trust proxy would make spoofable", () => {
    // req.ip says localhost, the socket says otherwise — the socket wins.
    localhostOnly()(makeReq({ remoteAddress: "203.0.113.7", ip: "127.0.0.1" }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("extends per endpoint via allow", () => {
    localhostOnly({ allow: [/^192\.168\./] })(makeReq({ remoteAddress: "192.168.0.10" }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("lets onDenied replace the 403 response", () => {
    const onDenied = vi.fn();

    localhostOnly({ onDenied })(makeReq({ remoteAddress: "203.0.113.7" }), res, next);

    expect(onDenied).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe("localhostOnly env allowlist", () => {
  const ENV_VAR = "LOCALHOST_ONLY_EXTRA_ADDRESSES";
  let saved;

  beforeEach(() => {
    saved = process.env[ENV_VAR];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = saved;
  });

  it("permits addresses listed in the env var, read per request", () => {
    const middleware = localhostOnly();
    const req = makeReq({ remoteAddress: "192.168.0.10" });

    let next = vi.fn();
    middleware(req, mockRes(), next);
    expect(next, "not allowed before the env var is set").not.toHaveBeenCalled();

    // No restart, no new middleware instance — the same closure sees the change.
    process.env[ENV_VAR] = " 10.0.0.1 , 192.168.0.10 ";
    next = vi.fn();
    middleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("can be pointed at a different env var, or switched off with null", () => {
    process.env[ENV_VAR] = "192.168.0.10";
    const req = makeReq({ remoteAddress: "192.168.0.10" });

    const next = vi.fn();
    localhostOnly({ envVar: null })(req, mockRes(), next);

    expect(next).not.toHaveBeenCalled();
  });
});
