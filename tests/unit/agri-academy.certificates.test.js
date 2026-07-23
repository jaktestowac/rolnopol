import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import request from "supertest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DB + silent logs before requiring the service.
const TMP_DB = path.join(os.tmpdir(), `aa-certs-unit-${process.pid}.json`);
process.env.CERTIFICATES_DB_PATH = TMP_DB;
process.env.AGRI_ACADEMY_LOG = "silent";

const CI = path.join(__dirname, "..", "..", "external-services", "agri-academy", "certificate-issuer-service");
const db = require(path.join(CI, "server", "db.js"));
const { buildApp, certNumber, verifyView } = require(path.join(CI, "server", "index.js"));

const mintBody = (over = {}) => ({
  examId: "e1",
  examTitle: "Pesticide Basics",
  ownerUnitId: "unit-1",
  holder: "taker-9",
  sessionId: "sess-1",
  scorePct: 82,
  certValidMonths: 24,
  ...over,
});

let app;
beforeAll(async () => {
  await db.init();
  app = buildApp();
});
afterEach(() => {
  delete process.env.AGRI_ACADEMY_TIME_OFFSET_MS;
});
afterAll(() => {
  delete process.env.AGRI_ACADEMY_TIME_OFFSET_MS;
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("certificate-issuer — health", () => {
  it("reports SERVING", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body.status).toBe("SERVING");
  });
});

describe("certificate-issuer — mint", () => {
  it("mints a valid, numbered certificate", async () => {
    const res = await request(app).post("/v1/certificates").send(mintBody()).expect(201);
    expect(res.body.certNo).toMatch(/^AA-\d{4}-\d{6}$/);
    expect(res.body.revoked).toBe(false);
    expect(res.body.expiresAt).toBeTruthy();
    const verify = await request(app).get(`/v1/verify/${res.body.certNo}`).expect(200);
    expect(verify.body.status).toBe("valid");
  });

  it("numbers certificates sequentially", async () => {
    const a = await request(app)
      .post("/v1/certificates")
      .send(mintBody({ holder: "u-a", sessionId: "s-a" }))
      .expect(201);
    const b = await request(app)
      .post("/v1/certificates")
      .send(mintBody({ holder: "u-b", sessionId: "s-b" }))
      .expect(201);
    const seqA = Number(a.body.certNo.split("-")[2]);
    const seqB = Number(b.body.certNo.split("-")[2]);
    expect(seqB).toBe(seqA + 1);
  });

  it("is idempotent per { examId, holder, sessionId } (never double-mints)", async () => {
    const body = mintBody({ holder: "u-idem", sessionId: "s-idem" });
    const first = await request(app).post("/v1/certificates").send(body).expect(201);
    const second = await request(app).post("/v1/certificates").send(body).expect(201);
    expect(second.body.certNo).toBe(first.body.certNo);
  });

  it("400s when ANY of examId / holder / sessionId is missing", async () => {
    await request(app).post("/v1/certificates").send(mintBody({ examId: undefined })).expect(400);
    await request(app).post("/v1/certificates").send(mintBody({ holder: undefined })).expect(400);
    await request(app).post("/v1/certificates").send(mintBody({ sessionId: undefined })).expect(400);
    await request(app).post("/v1/certificates").send(mintBody({ holder: "" })).expect(400);
  });

  it("coerces a non-string but present holder (0) to a string rather than rejecting", async () => {
    const res = await request(app)
      .post("/v1/certificates")
      .send(mintBody({ holder: 0, sessionId: "s-holder0" }))
      .expect(201);
    expect(res.body.holder).toBe("0");
  });
});

describe("certificate-issuer — verify states", () => {
  it("unknown for an unminted number", async () => {
    const res = await request(app).get("/v1/verify/AA-2026-999999").expect(200);
    expect(res.body.status).toBe("unknown");
  });

  it("expired once past expiresAt (lazy at verify)", async () => {
    const minted = await request(app)
      .post("/v1/certificates")
      .send(mintBody({ holder: "u-exp", sessionId: "s-exp", certValidMonths: 1 }))
      .expect(201);
    // Jump ~2 months forward.
    process.env.AGRI_ACADEMY_TIME_OFFSET_MS = String(62 * 24 * 60 * 60 * 1000);
    const res = await request(app).get(`/v1/verify/${minted.body.certNo}`).expect(200);
    expect(res.body.status).toBe("expired");
  });
});

describe("certificate-issuer — revoke", () => {
  it("revokes and verify reflects it", async () => {
    const minted = await request(app)
      .post("/v1/certificates")
      .send(mintBody({ holder: "u-rev", sessionId: "s-rev" }))
      .expect(201);
    const rev = await request(app).post(`/v1/certificates/${minted.body.certNo}/revoke`).send({ reason: "issued in error" }).expect(200);
    expect(rev.body.status).toBe("revoked");
    const verify = await request(app).get(`/v1/verify/${minted.body.certNo}`).expect(200);
    expect(verify.body.status).toBe("revoked");
    expect(verify.body.revokedReason).toBe("issued in error");
  });

  it("404s revoking an unknown certificate", async () => {
    await request(app).post("/v1/certificates/AA-2026-000000/revoke").send({ reason: "x" }).expect(404);
  });

  it("is idempotent: a second revoke keeps the first reason (empty reason doesn't clobber)", async () => {
    const minted = await request(app)
      .post("/v1/certificates")
      .send(mintBody({ holder: "u-rev-idem", sessionId: "s-rev-idem" }))
      .expect(201);
    await request(app).post(`/v1/certificates/${minted.body.certNo}/revoke`).send({ reason: "first reason" }).expect(200);
    const again = await request(app).post(`/v1/certificates/${minted.body.certNo}/revoke`).send({}).expect(200);
    expect(again.body.status).toBe("revoked");
    expect(again.body.revokedReason).toBe("first reason");
  });

  it("defaults revokedReason to 'revoked' when none is supplied", async () => {
    const minted = await request(app)
      .post("/v1/certificates")
      .send(mintBody({ holder: "u-rev-noreason", sessionId: "s-rev-noreason" }))
      .expect(201);
    const rev = await request(app).post(`/v1/certificates/${minted.body.certNo}/revoke`).send({}).expect(200);
    expect(rev.body.revokedReason).toBe("revoked");
  });

  it("revoked takes precedence over expired at verify", async () => {
    const minted = await request(app)
      .post("/v1/certificates")
      .send(mintBody({ holder: "u-rev-exp", sessionId: "s-rev-exp", certValidMonths: 1 }))
      .expect(201);
    await request(app).post(`/v1/certificates/${minted.body.certNo}/revoke`).send({ reason: "gone" }).expect(200);
    process.env.AGRI_ACADEMY_TIME_OFFSET_MS = String(62 * 24 * 60 * 60 * 1000); // now also past expiry
    const v = await request(app).get(`/v1/verify/${minted.body.certNo}`).expect(200);
    expect(v.body.status).toBe("revoked"); // not "expired"
  });
});

describe("certificate-issuer — verify view does not leak internals", () => {
  it("omits sessionId / examId / idem key from the public verify body", async () => {
    const minted = await request(app)
      .post("/v1/certificates")
      .send(mintBody({ holder: "u-leak", sessionId: "s-leak-secret" }))
      .expect(201);
    const v = await request(app).get(`/v1/verify/${minted.body.certNo}`).expect(200);
    expect(v.body.sessionId).toBeUndefined();
    expect(v.body.examId).toBeUndefined();
    expect(JSON.stringify(v.body)).not.toContain("s-leak-secret");
    // but the intended public fields ARE present
    expect(v.body.certNo).toBe(minted.body.certNo);
    expect(v.body.holder).toBe("u-leak");
    expect(v.body.unit).toBe("unit-1");
  });
});

describe("certificate-issuer — health count + pure helpers", () => {
  it("health reports a numeric certificate_count that reflects minted certs", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(typeof res.body.certificate_count).toBe("number");
    expect(res.body.certificate_count).toBeGreaterThanOrEqual(1);
  });

  it("certNumber formats AA-<year>-<zero-padded seq>", () => {
    expect(certNumber(123, Date.parse("2026-05-01T00:00:00Z"))).toBe("AA-2026-000123");
    expect(certNumber(7, Date.parse("2030-01-01T00:00:00Z"))).toBe("AA-2030-000007");
  });

  it("verifyView returns 'unknown' for a null certificate", () => {
    expect(verifyView(null, Date.now())).toEqual({ status: "unknown" });
  });

  it("the certNo year follows the (offset) clock", async () => {
    const base = await request(app)
      .post("/v1/certificates")
      .send(mintBody({ holder: "u-year-a", sessionId: "s-year-a" }))
      .expect(201);
    const baseYear = Number(base.body.certNo.split("-")[1]);
    process.env.AGRI_ACADEMY_TIME_OFFSET_MS = String(2 * 366 * 24 * 60 * 60 * 1000); // ~2 years ahead
    const future = await request(app)
      .post("/v1/certificates")
      .send(mintBody({ holder: "u-year-b", sessionId: "s-year-b" }))
      .expect(201);
    const futureYear = Number(future.body.certNo.split("-")[1]);
    expect(futureYear).toBeGreaterThanOrEqual(baseYear + 1);
  });
});

describe("certificate-issuer — templates", () => {
  it("mints with a chosen template and verify embeds the style descriptor + unit name", async () => {
    const minted = await request(app)
      .post("/v1/certificates")
      .send(mintBody({ holder: "u-tpl", sessionId: "s-tpl", template: "midnight", unitName: "Acme Board" }))
      .expect(201);
    expect(minted.body.template).toBe("midnight");
    const v = await request(app).get(`/v1/verify/${minted.body.certNo}`).expect(200);
    expect(v.body.template).toBe("midnight");
    expect(v.body.templateStyle.id).toBe("midnight");
    expect(v.body.templateStyle.accent).toBeTruthy();
    expect(v.body.unitName).toBe("Acme Board");
  });

  it("defaults an unknown or absent template", async () => {
    const minted = await request(app)
      .post("/v1/certificates")
      .send(mintBody({ holder: "u-tpl2", sessionId: "s-tpl2", template: "neon-glow" }))
      .expect(201);
    expect(minted.body.template).toBe("classic-green");
  });
});
