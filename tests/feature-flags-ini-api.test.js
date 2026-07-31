import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

// End-to-end contract of the persistent feature-flags.ini overrides:
//   * GET returns the file value, not the stored value
//   * a real feature gate (the public Observatory page) honours the file
//   * PATCH/PUT that contradict the file are refused with 409
//   * reset keeps the file values in effect
//
// The app boots with the file skipped (NODE_ENV=test), so each test activates the
// singleton explicitly — which is also the guarantee that a plain test run is
// never affected by a developer's local feature-flags.ini.
const app = require("../api/index.js");
const featureFlagIni = require("../services/feature-flag-ini.service.js");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rolnopol-ini-api-"));
const MISSING_INI = path.join(tmpDir, "no-such-file.ini");
const OBSERVATORY_PAGE = "/operator/observatory.html";
let fileCounter = 0;
let originalFlags;

/** Activate feature-flags.ini for the app under test. */
function useIni(content) {
  fileCounter += 1;
  const filePath = path.join(tmpDir, `flags-${fileCounter}.ini`);
  fs.writeFileSync(filePath, content, "utf8");
  return featureFlagIni.load({ filePath, allowInTests: true });
}

function deactivateIni() {
  featureFlagIni.load({ filePath: MISSING_INI, allowInTests: false });
}

async function getFlags(query = "") {
  const res = await request(app).get(`/api/v1/feature-flags${query}`).expect(200);
  return res.body?.data;
}

beforeAll(async () => {
  originalFlags = (await getFlags()).flags;
});

beforeEach(() => {
  deactivateIni();
});

afterAll(async () => {
  deactivateIni();
  if (originalFlags) {
    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("feature-flags.ini: skipped in the test environment", () => {
  it("reports an inactive override layer on GET", async () => {
    const data = await getFlags();

    expect(data.overrides).toMatchObject({ source: "feature-flags.ini", active: false });
    expect(data.overrides.keys).toEqual([]);
  });

  it("does not apply a file that exists but was not opted into", async () => {
    fileCounter += 1;
    const filePath = path.join(tmpDir, `flags-ignored-${fileCounter}.ini`);
    fs.writeFileSync(filePath, "[flags]\nobservatoryEnabled = true\n", "utf8");
    featureFlagIni.load({ filePath, allowInTests: false });

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { observatoryEnabled: false } })
      .expect(200);
    const data = await getFlags();

    expect(data.overrides.active).toBe(false);
    expect(data.overrides.skippedReason).toBe("test-environment");
    expect(data.flags.observatoryEnabled).toBe(false);
  });
});

describe("feature-flags.ini: GET reflects the file", () => {
  it("returns the file value and keeps the stored value alongside it", async () => {
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { observatoryEnabled: false } })
      .expect(200);
    useIni("[flags]\nobservatoryEnabled = true\n");

    const data = await getFlags();

    expect(data.flags.observatoryEnabled).toBe(true);
    expect(data.storedFlags.observatoryEnabled).toBe(false);
    expect(data.overrides).toMatchObject({ active: true, enforcing: true, mode: "enforce", count: 1, keys: ["observatoryEnabled"] });
  });

  it("marks the pinned flag in the descriptions payload the flags page uses", async () => {
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { observatoryEnabled: false } })
      .expect(200);
    useIni("[flags]\nobservatoryEnabled = true\n");

    const data = await getFlags("?descriptions=true");

    expect(data.flags.observatoryEnabled).toMatchObject({
      value: true,
      storedValue: false,
      overriddenBy: "feature-flags.ini",
    });
    expect(data.overrides.keys).toEqual(["observatoryEnabled"]);
    expect(data.flags.messengerEnabled.overriddenBy).toBeUndefined();
  });

  it("reports flags the file declares that are not real feature flags", async () => {
    useIni("[flags]\nnotARealFlagEnabled = true\n");

    const data = await getFlags();

    expect(data.overrides.unknownKeys).toEqual(["notARealFlagEnabled"]);
    expect(data.flags.notARealFlagEnabled).toBe(true);
  });
});

describe("feature-flags.ini: an invalid file warns and the app keeps working", () => {
  it("serves flags normally and reports the problems when the file has a syntax error", async () => {
    useIni("[flags]\nthis line is broken\nobservatoryEnabled = true\n");

    const data = await getFlags();

    expect(data.overrides.hasProblems).toBe(true);
    expect(data.overrides.problems[0]).toMatchObject({ kind: "syntax", line: 2 });
    // The valid line is still applied.
    expect(data.flags.observatoryEnabled).toBe(true);
    await request(app).get(OBSERVATORY_PAGE).expect(200);
  });

  it("keeps the whole app responsive when nothing in the file is usable", async () => {
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { observatoryEnabled: false } })
      .expect(200);
    useIni("[[[\nbroken\nobservatoryEnabled = perhaps\n");

    const data = await getFlags();

    expect(data.overrides.active).toBe(false);
    expect(data.overrides.hasProblems).toBe(true);
    expect(data.flags.observatoryEnabled).toBe(false);
    // Nothing is pinned, so writes still work.
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { observatoryEnabled: true } })
      .expect(200);
    await request(app).get(OBSERVATORY_PAGE).expect(200);
  });

  it("reports the problems in the descriptions payload the page renders", async () => {
    useIni("[flags]\nbroken line\nnotARealFlagEnabled = true\n");

    const data = await getFlags("?descriptions=true");

    expect(data.overrides.problems.map((problem) => problem.kind).sort()).toEqual(["syntax", "unknown-flag"]);
  });

  it("reports no problems for a clean file", async () => {
    useIni("[flags]\nobservatoryEnabled = true\n");

    const data = await getFlags();

    expect(data.overrides.hasProblems).toBe(false);
    expect(data.overrides.problems).toEqual([]);
  });
});

describe("feature-flags.ini: a real feature gate honours the file", () => {
  it("404s the Observatory page when the file turns it off, even though the store says on", async () => {
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { observatoryEnabled: true } })
      .expect(200);
    await request(app).get(OBSERVATORY_PAGE).expect(200);

    useIni("[flags]\nobservatoryEnabled = false\n");

    await request(app).get(OBSERVATORY_PAGE).expect(404);
    expect((await getFlags()).storedFlags.observatoryEnabled).toBe(true);
  });

  it("serves the Observatory page when the file turns it on, even though the store says off", async () => {
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { observatoryEnabled: false } })
      .expect(200);
    await request(app).get(OBSERVATORY_PAGE).expect(404);

    useIni("[flags]\nobservatoryEnabled = true\n");

    await request(app).get(OBSERVATORY_PAGE).expect(200);
  });

  it("stops overriding as soon as the file is gone", async () => {
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { observatoryEnabled: false } })
      .expect(200);
    useIni("[flags]\nobservatoryEnabled = true\n");
    await request(app).get(OBSERVATORY_PAGE).expect(200);

    deactivateIni();

    await request(app).get(OBSERVATORY_PAGE).expect(404);
  });
});

describe("feature-flags.ini: writes against pinned flags", () => {
  it("refuses a PATCH with 409 and names the file", async () => {
    useIni("[flags]\nobservatoryEnabled = true\n");

    const res = await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { observatoryEnabled: false } })
      .expect(409);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("feature-flags.ini");
    expect(res.body.error).toContain("observatoryEnabled");
    expect(res.body.details).toEqual([{ key: "observatoryEnabled", pinnedValue: true, requestedValue: false }]);
    expect((await getFlags()).flags.observatoryEnabled).toBe(true);
  });

  it("refuses a PUT with 409", async () => {
    useIni("[flags]\nobservatoryEnabled = true\n");
    const current = (await getFlags()).flags;

    await request(app)
      .put("/api/v1/feature-flags")
      .send({ flags: { ...current, observatoryEnabled: false } })
      .expect(409);
  });

  it("accepts a PUT that keeps every pinned value", async () => {
    useIni("[flags]\nobservatoryEnabled = true\n");
    const current = (await getFlags()).flags;

    await request(app).put("/api/v1/feature-flags").send({ flags: current }).expect(200);
    expect((await getFlags()).flags.observatoryEnabled).toBe(true);
  });

  it("still allows changes to flags the file does not pin", async () => {
    useIni("[flags]\nobservatoryEnabled = true\n");

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { messengerEnabled: true } })
      .expect(200);
    const data = await getFlags();

    expect(data.flags.messengerEnabled).toBe(true);
    expect(data.flags.observatoryEnabled).toBe(true);

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { messengerEnabled: false } })
      .expect(200);
  });

  it("keeps rejecting bad payloads with 400", async () => {
    useIni("[flags]\nobservatoryEnabled = true\n");

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { observatoryEnabled: "true" } })
      .expect(400);
    await request(app).patch("/api/v1/feature-flags").send({ flags: {} }).expect(400);
  });

  it("allows every write in seed mode", async () => {
    useIni("[settings]\nmode = seed\n[flags]\nobservatoryEnabled = true\n");

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { observatoryEnabled: false } })
      .expect(200);
    expect((await getFlags()).flags.observatoryEnabled).toBe(false);
  });
});

describe("feature-flags.ini: reset", () => {
  it("resets the store but leaves pinned flags at their file value", async () => {
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { messengerEnabled: true } })
      .expect(200);
    useIni("[flags]\nobservatoryEnabled = true\n");

    const res = await request(app).post("/api/v1/feature-flags/reset").send({}).expect(200);

    expect(res.body.data.flags.messengerEnabled).toBe(false);
    expect(res.body.data.flags.observatoryEnabled).toBe(true);
    expect(res.body.data.storedFlags.observatoryEnabled).toBe(false);
    expect(res.body.data.overrides.active).toBe(true);
  });
});
