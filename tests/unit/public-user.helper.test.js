import { describe, it, expect } from "vitest";

const { toPublicUser } = require("../../helpers/public-user");

describe("public-user helper", () => {
  it("strips password and twoFactorAuth fields", () => {
    const result = toPublicUser({
      id: 1,
      username: "farmer",
      password: "secret",
      twoFactorAuth: { enabled: true, secret: "abc" },
      email: "a@b.io",
    });
    expect(result).toEqual({ id: 1, username: "farmer", email: "a@b.io" });
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("twoFactorAuth");
  });

  it("keeps a user without sensitive fields intact", () => {
    const user = { id: 2, username: "u", displayedName: "U" };
    expect(toPublicUser(user)).toEqual(user);
  });

  it("returns non-object input unchanged", () => {
    expect(toPublicUser(null)).toBeNull();
    expect(toPublicUser(undefined)).toBeUndefined();
    expect(toPublicUser("nope")).toBe("nope");
  });
});
