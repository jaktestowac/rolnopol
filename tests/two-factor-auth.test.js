import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const app = require("../api/index.js");
const { generateTotpToken } = require("../helpers/two-factor-auth");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setTwoFactorFlag(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { twoFactorAuthEnabled: enabled } })
    .expect(200);
}

async function registerUser(prefix = "twofactor") {
  const user = {
    email: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`,
    displayedName: "Two Factor Tester",
    password: "testpass123",
  };

  const response = await request(app).post("/api/v1/register").send(user).expect(201);

  return {
    user,
    authToken: response.body?.data?.token,
    createdUser: response.body?.data?.user,
  };
}

describe("Two-factor authentication", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("allows a user to enroll in 2FA and then requires a valid code during login", async () => {
    await setTwoFactorFlag(true);
    const session = await registerUser();

    const setupResponse = await request(app)
      .post("/api/v1/users/profile/two-factor/setup")
      .set("token", session.authToken)
      .send({})
      .expect(200);

    const setupData = setupResponse.body?.data;
    expect(setupData?.pendingSetup).toBe(true);
    expect(typeof setupData?.manualEntryKey).toBe("string");
    expect(setupData.manualEntryKey.length).toBeGreaterThan(10);
    expect(typeof setupData?.otpAuthUrl).toBe("string");
    expect(setupData.otpAuthUrl).toContain("otpauth://totp/");
    expect(typeof setupData?.qrCodeDataUrl).toBe("string");
    expect(setupData.qrCodeDataUrl).toContain("data:image/png;base64,");

    const enrollmentCode = generateTotpToken(setupData.manualEntryKey);

    const enableResponse = await request(app)
      .post("/api/v1/users/profile/two-factor/enable")
      .set("token", session.authToken)
      .send({ code: enrollmentCode })
      .expect(200);

    expect(enableResponse.body?.data?.enabled).toBe(true);
    expect(enableResponse.body?.data?.manualEntryKey).toBe(null);

    const loginChallenge = await request(app)
      .post("/api/v1/login")
      .send({ email: session.user.email, password: session.user.password })
      .expect(202);

    expect(loginChallenge.body.success).toBe(true);
    expect(loginChallenge.body?.data?.twoFactorRequired).toBe(true);
    expect(loginChallenge.body?.data?.user?.email).toBe(session.user.email);
    expect(loginChallenge.body?.data).not.toHaveProperty("token");

    await request(app)
      .post("/api/v1/login")
      .send({ email: session.user.email, password: session.user.password, twoFactorCode: "000000" })
      .expect(401);

    const validLogin = await request(app)
      .post("/api/v1/login")
      .send({
        email: session.user.email,
        password: session.user.password,
        twoFactorCode: generateTotpToken(setupData.manualEntryKey),
      })
      .expect(200);

    expect(validLogin.body?.data?.token).toBeTruthy();
    expect(validLogin.body?.data?.user?.email).toBe(session.user.email);
  });

  it("keeps classic login behavior when the global 2FA feature flag is disabled", async () => {
    await setTwoFactorFlag(true);
    const session = await registerUser("twofactoroff");

    const setupResponse = await request(app)
      .post("/api/v1/users/profile/two-factor/setup")
      .set("token", session.authToken)
      .send({})
      .expect(200);

    const secret = setupResponse.body?.data?.manualEntryKey;

    await request(app)
      .post("/api/v1/users/profile/two-factor/enable")
      .set("token", session.authToken)
      .send({ code: generateTotpToken(secret) })
      .expect(200);

    await setTwoFactorFlag(false);

    const loginResponse = await request(app)
      .post("/api/v1/login")
      .send({ email: session.user.email, password: session.user.password })
      .expect(200);

    expect(loginResponse.body.success).toBe(true);
    expect(loginResponse.body?.data?.token).toBeTruthy();
    expect(loginResponse.body?.data?.user?.email).toBe(session.user.email);
  });
});
