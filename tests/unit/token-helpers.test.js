import { describe, it, expect } from "vitest";
import * as tokenHelpers from "../../helpers/token.helpers";

describe("token.helpers", () => {
  it("should encode and decode base64 correctly", () => {
    const text = "hello world";
    const encoded = tokenHelpers.base64Encode(text);
    const decoded = tokenHelpers.base64Decode(encoded);
    expect(decoded).toBe(text);
  });

  it("should return false for isUserLogged with no token", () => {
    expect(tokenHelpers.isUserLogged("")).toBe(false);
    expect(tokenHelpers.isUserLogged(null)).toBe(false);
  });

  // More tests can be added for token storage and expiration logic
});
