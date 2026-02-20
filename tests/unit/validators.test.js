import { describe, it, expect } from "vitest";
import { isValidEmail, isValidPassword, isStrongPassword, isValidUsername, validateRegistrationData } from "../../helpers/validators";

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

  it("should validate strong password policy", () => {
    expect(isStrongPassword("Abcdef1!")).toBe(true);
    expect(isStrongPassword("abcdef1!")).toBe(false); // missing uppercase
    expect(isStrongPassword("ABCDEF1!")).toBe(false); // missing lowercase
    expect(isStrongPassword("Abcdefgh!")).toBe(false); // missing number
    expect(isStrongPassword("Abcdef12")).toBe(false); // missing special char
    expect(isStrongPassword("Ab1!")).toBe(false); // too short
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

  it("should validate registration with strong password option", () => {
    const weakPassword = validateRegistrationData(
      {
        email: "user2@example.com",
        password: "abc123",
      },
      { requireStrongPassword: true },
    );
    expect(weakPassword.isValid).toBe(false);
    expect(weakPassword.errors.join(" ")).toContain("uppercase");

    const strongPassword = validateRegistrationData(
      {
        email: "user3@example.com",
        password: "StrongPass1!",
      },
      { requireStrongPassword: true },
    );
    expect(strongPassword.isValid).toBe(true);
  });
});
