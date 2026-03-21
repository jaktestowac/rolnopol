import { describe, test, expect, vi } from "vitest";
import fc from "fast-check";
const authService = require("../../services/auth.service");
const featureFlagsService = require("../../services/feature-flags.service");

describe("AuthService property-based tests", () => {
  test("_maskEmail behaves consistently with format rules", () => {
    fc.assert(
      fc.property(fc.string(), (email) => {
        const masked = authService._maskEmail(email);

        if (!email || typeof email !== "string") {
          expect(masked).toBeNull();
          return;
        }

        const atIndex = email.indexOf("@");
        if (atIndex <= 0) {
          expect(masked).toBe("***");
          return;
        }

        const local = email.slice(0, atIndex);
        const domain = email.slice(atIndex + 1);
        const visible = local.slice(0, Math.min(local.length, 2));
        expect(masked).toBe(`${visible}***@${domain}`);
      }),
    );
  });

  test("_isRegistrationStrongPasswordEnabled returns true only when flag set, and false on error", async () => {
    const flagValueArb = fc.oneof(fc.constant(true), fc.constant(false), fc.constant(undefined));
    await fc.assert(
      fc.asyncProperty(flagValueArb, async (flagValue) => {
        const getFeatureFlags = vi.spyOn(featureFlagsService, "getFeatureFlags");

        if (flagValue === undefined) {
          getFeatureFlags.mockRejectedValue(new Error("boom"));
          const out = await authService._isRegistrationStrongPasswordEnabled();
          expect(out).toBe(false);
        } else {
          getFeatureFlags.mockResolvedValue({ flags: { registrationStrongPasswordEnabled: flagValue } });
          const out = await authService._isRegistrationStrongPasswordEnabled();
          expect(out).toBe(flagValue === true);
        }

        getFeatureFlags.mockRestore();
      }),
    );
  });

  test("registerUser returns expected fields and trims display name", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc
          .array(
            fc.constantFrom(
              "a",
              "b",
              "c",
              "d",
              "e",
              "f",
              "g",
              "h",
              "i",
              "j",
              "k",
              "l",
              "m",
              "n",
              "o",
              "p",
              "q",
              "r",
              "s",
              "t",
              "u",
              "v",
              "w",
              "x",
              "y",
              "z",
              "A",
              "B",
              "C",
              "D",
              "E",
              "F",
              "G",
              "H",
              "I",
              "J",
              "K",
              "L",
              "M",
              "N",
              "O",
              "P",
              "Q",
              "R",
              "S",
              "T",
              "U",
              "V",
              "W",
              "X",
              "Y",
              "Z",
              "0",
              "1",
              "2",
              "3",
              "4",
              "5",
              "6",
              "7",
              "8",
              "9",
              " ",
              "_",
              "-",
            ),
            { minLength: 3, maxLength: 20 },
          )
          .map((arr) => arr.join("")),
        fc.string({ minLength: 10, maxLength: 30 }),
        async (email, displayedName, password) => {
          const trimmed = displayedName.trim();
          const findUser = vi.spyOn(authService.userDataInstance, "findUserByEmail").mockResolvedValue(null);
          const createUser = vi.spyOn(authService.userDataInstance, "createUser").mockResolvedValue({
            id: 123,
            email,
            displayedName: trimmed,
            password,
            isActive: true,
          });
          vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({ flags: { registrationStrongPasswordEnabled: false } });
          vi.spyOn(require("../../services/financial.service"), "initializeAccount").mockResolvedValue({ id: 123 });

          const result = await authService.registerUser({ email, displayedName: `  ${trimmed}  `, password });

          expect(result.user).toEqual({ id: 123, email, displayedName: trimmed, isActive: true });
          expect(result.token).toBeDefined();

          findUser.mockRestore();
          createUser.mockRestore();
        },
      ),
    );
  });

  test("loginUser success path returns a token and excludes password", async () => {
    await fc.assert(
      fc.asyncProperty(fc.emailAddress(), fc.string({ minLength: 6, maxLength: 30 }), async (email, password) => {
        const user = { id: 42, email, password, isActive: true };
        vi.spyOn(authService.userDataInstance, "findUserByEmail").mockResolvedValue(user);
        vi.spyOn(authService.userDataInstance, "updateUserLastLogin").mockResolvedValue();

        const result = await authService.loginUser({ email, password });
        expect(result.user).toEqual({ id: 42, email, isActive: true });
        expect(result.token).toBeDefined();

        const invalidPassword = password + "x";
        await expect(authService.loginUser({ email, password: invalidPassword })).rejects.toThrow("Invalid credentials");
      }),
    );
  });

  test("validateUserToken returns user object without password if active", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 1000 }), fc.boolean(), async (id, isActive) => {
        const user = { id, email: `user${id}@example.com`, password: "secret", isActive };
        vi.spyOn(authService.userDataInstance, "findUser").mockResolvedValue(user);

        if (isActive) {
          const result = await authService.validateUserToken(id);
          expect(result).toEqual({ id, email: user.email, isActive });
        } else {
          await expect(authService.validateUserToken(id)).rejects.toThrow("Account is deactivated");
        }
      }),
    );
  });
});
