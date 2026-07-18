import { describe, it, expect } from "vitest";
const path = require("path");

const { ERROR_CODES, bridgeError, sendBridgeError, DEFAULT_MESSAGES } = require(
  path.join(__dirname, "..", "..", "helpers", "farm-stay-errors.js"),
);

// Minimal Express-response double capturing status + json payload.
function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("farm-stay error contract — bridgeError()", () => {
  it("mirrors the machine token in both `error` and `code`", () => {
    const b = bridgeError(ERROR_CODES.INTERNAL);
    expect(b.error).toBe("INTERNAL");
    expect(b.code).toBe("INTERNAL");
  });

  it("fills a default human message per code, overridable", () => {
    expect(bridgeError(ERROR_CODES.INSUFFICIENT_FUNDS).message).toBe(DEFAULT_MESSAGES.INSUFFICIENT_FUNDS);
    expect(bridgeError(ERROR_CODES.INTERNAL, "boom").message).toBe("boom");
  });

  it("spreads domain fields at the top level (not nested)", () => {
    const b = bridgeError(ERROR_CODES.INSUFFICIENT_FUNDS, undefined, { needed: 120, balance: 5, currency: "ROL" });
    expect(b.needed).toBe(120);
    expect(b.balance).toBe(5);
    expect(b.currency).toBe("ROL");
    // machine code + human message always present alongside the domain fields
    expect(b.error).toBe("INSUFFICIENT_FUNDS");
    expect(typeof b.message).toBe("string");
  });

  it("falls back to the raw code when no default message exists", () => {
    const b = bridgeError("SOME_NEW_CODE");
    expect(b.message).toBe("SOME_NEW_CODE");
  });
});

describe("farm-stay error contract — sendBridgeError()", () => {
  it("writes the status and the canonical envelope, and returns the response", () => {
    const res = fakeRes();
    const ret = sendBridgeError(res, 402, ERROR_CODES.INSUFFICIENT_FUNDS, undefined, { needed: 50 });
    expect(ret).toBe(res);
    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({ error: "INSUFFICIENT_FUNDS", code: "INSUFFICIENT_FUNDS", needed: 50 });
  });
});
