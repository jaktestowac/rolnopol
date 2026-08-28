import { describe, it, expect, afterEach } from "vitest";

// Greenhouse identity resolution (modules/greenhouse/identity.js).
//
// The greenhouse is open to everyone, which makes this middleware unusual for this
// codebase: it is deliberately NOT an auth gate. A logged-in visitor is scoped by
// their real userId; an anonymous one is scoped by a demo id their browser
// generated. Getting that wrong in either direction is a real bug — 401 the
// anonymous visitor and the page is dead, or accept any demo id at all and one
// visitor can read another's greenhouse by guessing a header.
//
// So the pattern is the security boundary here, and it gets tested like one.
const { resolveGreenhouseIdentity, tryGetUserId, DEMO_ID_PATTERN } = require("../../modules/greenhouse/identity");
const { generateToken, revokeToken } = require("../../helpers/token.helpers");

const mintedTokens = [];

/** A real, storage-backed user token. Revoked after the test that made it. */
function mintToken(userId) {
  const token = generateToken(userId, { hours: 1 });
  mintedTokens.push(token);
  return token;
}

/** A request double covering both header access styles the module uses. */
function fakeReq({ headers = {}, cookies } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    headers: lower,
    cookies,
    get: (name) => lower[String(name).toLowerCase()],
  };
}

/** A response double capturing status + json, plus a next() call counter. */
function fakeRes() {
  const captured = { statusCode: null, body: null };
  return {
    captured,
    status(code) {
      captured.statusCode = code;
      return this;
    },
    json(payload) {
      captured.body = payload;
      return this;
    },
  };
}

function run(req) {
  const res = fakeRes();
  let nextCalls = 0;
  resolveGreenhouseIdentity(req, res, () => {
    nextCalls += 1;
  });
  return { res, nextCalls, identity: req.ghIdentity };
}

afterEach(() => {
  while (mintedTokens.length) {
    try {
      revokeToken(mintedTokens.pop());
    } catch {
      /* a test may have revoked it already */
    }
  }
});

describe("DEMO_ID_PATTERN", () => {
  it("accepts the shape the browser generates", () => {
    for (const id of ["demo-abc123", "demo-A1b2C3d4", "demo-abcdef", "demo-a_b-c_d", "demo-" + "x".repeat(64)]) {
      expect(DEMO_ID_PATTERN.test(id)).toBe(true);
    }
  });

  it("requires the demo- prefix", () => {
    for (const id of ["abc123def", "Demo-abc123", "DEMO-abc123", "xdemo-abc123", "demo_abc123"]) {
      expect(DEMO_ID_PATTERN.test(id)).toBe(false);
    }
  });

  it("requires at least six characters after the prefix", () => {
    expect(DEMO_ID_PATTERN.test("demo-abcde")).toBe(false); // five
    expect(DEMO_ID_PATTERN.test("demo-abcdef")).toBe(true); // six
    expect(DEMO_ID_PATTERN.test("demo-")).toBe(false);
  });

  it("rejects characters that have meaning in a path or a header", () => {
    for (const id of [
      "demo-abc/../etc",
      "demo-abc123 ",
      " demo-abc123",
      "demo-abc.123",
      "demo-abc:123",
      "demo-abc$123",
      "demo-abc%2f123",
      "demo-abc+123",
    ]) {
      expect(DEMO_ID_PATTERN.test(id)).toBe(false);
    }
  });

  it("is anchored at both ends, so a valid id cannot carry a payload", () => {
    expect(DEMO_ID_PATTERN.test("demo-abc123\nX-Injected: yes")).toBe(false);
    expect(DEMO_ID_PATTERN.test("prefix demo-abc123 suffix")).toBe(false);
  });

  it("is stateless — no /g flag, so repeated tests of one value agree", () => {
    expect(DEMO_ID_PATTERN.flags).not.toContain("g");
    const id = "demo-abc123";
    expect([DEMO_ID_PATTERN.test(id), DEMO_ID_PATTERN.test(id), DEMO_ID_PATTERN.test(id)]).toEqual([true, true, true]);
  });
});

describe("tryGetUserId", () => {
  it("returns null when the request carries no token at all", () => {
    expect(tryGetUserId(fakeReq())).toBeNull();
    expect(tryGetUserId(fakeReq({ headers: {} }))).toBeNull();
  });

  it("returns null for a token that is not in storage", () => {
    expect(tryGetUserId(fakeReq({ headers: { token: "not-a-real-token" } }))).toBeNull();
    expect(tryGetUserId(fakeReq({ headers: { authorization: "Bearer not-a-real-token" } }))).toBeNull();
  });

  it("returns null for a blank or whitespace-only token rather than treating it as present", () => {
    expect(tryGetUserId(fakeReq({ headers: { token: "" } }))).toBeNull();
    expect(tryGetUserId(fakeReq({ headers: { token: "   " } }))).toBeNull();
  });

  it("ignores a non-string token header", () => {
    expect(tryGetUserId(fakeReq({ headers: { token: 12345 } }))).toBeNull();
  });

  it("reads a real token from the token header", () => {
    const token = mintToken(4242);

    expect(String(tryGetUserId(fakeReq({ headers: { token } })))).toBe("4242");
  });

  it("reads a real token from an Authorization: Bearer header", () => {
    const token = mintToken(77);

    expect(String(tryGetUserId(fakeReq({ headers: { authorization: `Bearer ${token}` } })))).toBe("77");
  });

  it("reads a real token from the rolnopolToken cookie", () => {
    const token = mintToken(88);

    expect(String(tryGetUserId(fakeReq({ cookies: { rolnopolToken: token } })))).toBe("88");
  });

  it("lets the Authorization header win over the token header", () => {
    const bearer = mintToken(101);

    const userId = tryGetUserId(fakeReq({ headers: { token: "stale-token", authorization: `Bearer ${bearer}` } }));
    expect(String(userId)).toBe("101");
  });

  it("prefers a header over the cookie", () => {
    const header = mintToken(202);
    const cookie = mintToken(303);

    const userId = tryGetUserId(fakeReq({ headers: { token: header }, cookies: { rolnopolToken: cookie } }));
    expect(String(userId)).toBe("202");
  });

  it("only honours the Bearer scheme, not a bare or differently-named one", () => {
    const token = mintToken(404);

    // Without "Bearer " the authorization header is not read at all, and there is
    // no token header to fall back to.
    expect(tryGetUserId(fakeReq({ headers: { authorization: token } }))).toBeNull();
    expect(tryGetUserId(fakeReq({ headers: { authorization: `Token ${token}` } }))).toBeNull();
  });

  it("returns null once the token is revoked", () => {
    const token = mintToken(505);
    expect(tryGetUserId(fakeReq({ headers: { token } }))).not.toBeNull();

    revokeToken(token);
    expect(tryGetUserId(fakeReq({ headers: { token } }))).toBeNull();
  });
});

describe("resolveGreenhouseIdentity — the logged-in path", () => {
  it("scopes a real session to a user identity and continues", () => {
    const token = mintToken(909);

    const { nextCalls, identity, res } = run(fakeReq({ headers: { token } }));

    expect(identity).toEqual({ kind: "user", id: "909" });
    expect(nextCalls).toBe(1);
    expect(res.captured.statusCode).toBeNull();
  });

  it("stringifies the id, so a numeric userId and a string one look the same downstream", () => {
    const token = mintToken(7);

    expect(run(fakeReq({ headers: { token } })).identity.id).toBe("7");
  });

  it("ignores a demo header entirely when the caller is logged in", () => {
    const token = mintToken(1234);

    const { identity } = run(fakeReq({ headers: { token, "x-greenhouse-demo-id": "demo-somebodyelse" } }));

    // Otherwise a logged-in visitor could read a demo greenhouse — or worse, be
    // silently downgraded into one and lose their plants.
    expect(identity).toEqual({ kind: "user", id: "1234" });
  });
});

describe("resolveGreenhouseIdentity — the anonymous path", () => {
  it("accepts a well-formed demo id and continues", () => {
    const { nextCalls, identity, res } = run(fakeReq({ headers: { "x-greenhouse-demo-id": "demo-abc123" } }));

    expect(identity).toEqual({ kind: "demo", id: "demo-abc123" });
    expect(nextCalls).toBe(1);
    expect(res.captured.statusCode).toBeNull();
  });

  it("reads the header case-insensitively, as Express does", () => {
    expect(run(fakeReq({ headers: { "X-Greenhouse-Demo-Id": "demo-abc123" } })).identity).toEqual({
      kind: "demo",
      id: "demo-abc123",
    });
  });

  it("keeps the demo id verbatim — it is the storage key", () => {
    const id = "demo-A1b2C3_d-4";

    expect(run(fakeReq({ headers: { "x-greenhouse-demo-id": id } })).identity.id).toBe(id);
  });
});

describe("resolveGreenhouseIdentity — refusing an unusable request", () => {
  const expectRefused = (req) => {
    const { nextCalls, identity, res } = run(req);

    expect(nextCalls).toBe(0);
    expect(identity).toBeUndefined();
    expect(res.captured.statusCode).toBe(400);
    return res.captured.body;
  };

  it("answers 400 — not 401 — when there is neither a session nor a demo id", () => {
    // 401 would be wrong: the greenhouse is open, and the caller is not
    // unauthorised, they just failed to say who they are.
    const body = expectRefused(fakeReq());

    expect(body.error).toMatch(/Missing greenhouse identity/);
    expect(body.error).toMatch(/x-greenhouse-demo-id/);
    expect(body.success).toBe(false);
  });

  it("refuses a malformed demo id rather than trusting it", () => {
    for (const id of ["abc123", "demo-short", "demo-abc/../other", "demo-abc 123", ""]) {
      expectRefused(fakeReq({ headers: { "x-greenhouse-demo-id": id } }));
    }
  });

  it("refuses a demo id carrying a header-injection payload", () => {
    expectRefused(fakeReq({ headers: { "x-greenhouse-demo-id": "demo-abc123\r\nX-Admin: true" } }));
  });

  it("refuses when the session token is invalid and no demo id is offered", () => {
    expectRefused(fakeReq({ headers: { token: "expired-or-forged" } }));
  });

  it("falls back to a valid demo id when the session token is invalid", () => {
    // An expired tab should degrade to a demo greenhouse, not to an error.
    const { identity, nextCalls } = run(fakeReq({ headers: { token: "expired-or-forged", "x-greenhouse-demo-id": "demo-abc123" } }));

    expect(identity).toEqual({ kind: "demo", id: "demo-abc123" });
    expect(nextCalls).toBe(1);
  });

  it("responds exactly once and does not also call next", () => {
    const req = fakeReq();
    const res = fakeRes();
    let nextCalls = 0;
    let jsonCalls = 0;
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      jsonCalls += 1;
      return originalJson(payload);
    };

    resolveGreenhouseIdentity(req, res, () => {
      nextCalls += 1;
    });

    expect(jsonCalls).toBe(1);
    expect(nextCalls).toBe(0);
  });
});
