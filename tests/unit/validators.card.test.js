import { describe, it, expect } from "vitest";
import { isValidCardNumber } from "../../helpers/validators";

describe("validators.card", () => {
  it("accepts a valid Luhn card number", () => {
    expect(isValidCardNumber("4111111111111111")).toBe(true);
  });

  it("accepts spaces in card number", () => {
    expect(isValidCardNumber("4111 1111 1111 1111")).toBe(true);
  });

  it("rejects invalid checksum", () => {
    expect(isValidCardNumber("4111111111111112")).toBe(false);
  });

  it("rejects non-digit garbage", () => {
    expect(isValidCardNumber("4111-1111-1111-1111")).toBe(false);
    expect(isValidCardNumber("abcd")).toBe(false);
  });

  it("rejects too-short numbers", () => {
    expect(isValidCardNumber("123456789012")).toBe(false);
  });
});
