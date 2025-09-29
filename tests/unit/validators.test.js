import { describe, it, expect } from "vitest";
import {
  isValidEmail,
  isValidPassword,
  isValidUsername,
  validateRegistrationData,
} from "../../helpers/validators";

describe("validators", () => {
  it("should validate correct email", () => {
    expect(isValidEmail("test@example.com")).toBe(true);
    expect(isValidEmail("bad-email")).toBe(false);
  });

  it("should validate password strength", () => {
    expect(isValidPassword("StrongPass123")).toBe(true);
    expect(isValidPassword("123")).toBe(true); // Accepts 3+ chars as valid
    expect(isValidPassword("12")).toBe(false); // Less than 3 chars is invalid
  });

  it("should validate username", () => {
    expect(isValidUsername("user123")).toBe(true);
    expect(isValidUsername("")).toBe(false);
  });

  it("should validate registration data", () => {
    const valid = validateRegistrationData({
      email: "user1@example.com",
      // displayedName optional now
      password: "Pass1234",
    });
    expect(valid.isValid).toBe(true);
    const invalid = validateRegistrationData({
      email: "",
      displayedName: "",
      password: "",
    });
    expect(invalid.isValid).toBe(false);
    expect(Array.isArray(invalid.errors)).toBe(true);
  });
});
