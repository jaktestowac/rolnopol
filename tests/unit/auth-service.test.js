import authService from "../../services/auth.service.js";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("auth.service", () => {
  let userDataInstance;

  beforeEach(() => {
    userDataInstance = authService.userDataInstance;
    vi.restoreAllMocks();
  });

  it("should throw error for invalid credentials", async () => {
    vi.spyOn(userDataInstance, "findUserByEmail").mockResolvedValue(null);
    await expect(
      authService.loginUser({ email: "bad@example.com", password: "bad" }),
    ).rejects.toThrow("Invalid credentials");
  });

  it("should throw error for deactivated account", async () => {
    vi.spyOn(userDataInstance, "findUserByEmail").mockResolvedValue({
      email: "user@example.com",
      password: "pass",
      isActive: false,
    });
    await expect(
      authService.loginUser({ email: "user@example.com", password: "pass" }),
    ).rejects.toThrow("Account is deactivated");
  });

  it("should register user successfully", async () => {
    vi.spyOn(authService.userDataInstance, "findUserByEmail").mockResolvedValue(
      null,
    );
    vi.spyOn(authService.userDataInstance, "createUser").mockResolvedValue({
      id: 1,
      email: "validuser@example.com",
      displayedName: "Valid User",
      password: "pass",
      isActive: true,
    });
    vi.spyOn(
      require("../../services/financial.service.js"),
      "initializeAccount",
    ).mockResolvedValue({ id: 1 });
    const result = await authService.registerUser({
      email: "validuser@example.com",
      displayedName: "Valid User",
      password: "pass",
    });
    expect(result.user).toMatchObject({
      id: 1,
      email: "validuser@example.com",
      displayedName: "Valid User",
    });
    expect(result.token).toBeDefined();
  });

  it("should throw error for duplicate email", async () => {
    vi.spyOn(authService.userDataInstance, "findUserByEmail").mockResolvedValue({ id: 1 });
    await expect(
      authService.registerUser({
        email: "duplicate@example.com",
        displayedName: "Valid User",
        password: "pass",
      }),
    ).rejects.toThrow("User with this email already exists");
  });

  it("should login user successfully", async () => {
    // Hash the password for the mock user
    const bcrypt = require("bcrypt");
    const hashedPassword = await bcrypt.hash("pass", 12);

    vi.spyOn(authService.userDataInstance, "findUserByEmail").mockResolvedValue({
      id: 1,
      email: "user@example.com",
      password: hashedPassword,
      isActive: true,
    });
    vi.spyOn(authService.userDataInstance, "updateUserLastLogin").mockResolvedValue();
    const result = await authService.loginUser({
      email: "user@example.com",
      password: "pass",
    });
    expect(result.user).toMatchObject({ id: 1, email: "user@example.com" });
    expect(result.token).toBeDefined();
  });

  it("should throw error for password mismatch", async () => {
    // Hash a different password for the mock user
    const bcrypt = require("bcrypt");
    const hashedPassword = await bcrypt.hash("other", 12);

    vi.spyOn(authService.userDataInstance, "findUserByEmail").mockResolvedValue({
      id: 1,
      email: "user@example.com",
      password: hashedPassword,
      isActive: true,
    });
    await expect(
      authService.loginUser({ email: "user@example.com", password: "pass" }),
    ).rejects.toThrow("Invalid credentials");
  });

  it("should validate user token successfully", async () => {
    vi.spyOn(authService.userDataInstance, "findUser").mockResolvedValue({
      id: 1,
      email: "user@example.com",
      isActive: true,
      password: "pass",
    });
    const result = await authService.validateUserToken(1);
    expect(result).toMatchObject({ id: 1, email: "user@example.com", isActive: true });
  });

  it("should throw error if user not found on token validation", async () => {
    vi.spyOn(authService.userDataInstance, "findUser").mockResolvedValue(null);
    await expect(authService.validateUserToken(1)).rejects.toThrow("User not found");
  });
});
