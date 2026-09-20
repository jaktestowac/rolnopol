/**
 * Rolnopol Survival — page gating (PRD WP-44, WP-38).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const path = require("path");
const os = require("os");

process.env.SURVIVAL_SESSIONS_DB_PATH = path.join(os.tmpdir(), `survival-page-test-${process.pid}.json`);

const app = require("../api/index.js");

const FLAG = "survivalGameEnabled";

async function getFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { [FLAG]: enabled } })
    .expect(200);
}

describe("Rolnopol Survival page gating", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getFlags();
  });

  afterAll(async () => {
    if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
  });

  it("returns 404 for the page while the flag is off", async () => {
    await setEnabled(false);
    const res = await request(app).get("/operator/survival.html").expect(404);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("serves the page when the flag is on", async () => {
    await setEnabled(true);
    const res = await request(app).get("/operator/survival.html").expect(200);

    expect(res.text).toContain("Rolnopol Survival");
    expect(res.text).toContain("/js/games/survival/game.js");
    expect(res.text).toContain("/css/pages/survival.css");
    // Release 2 controls: difficulty, the day's actions and the history panel.
    expect(res.text).toContain('id="wpDifficulty"');
    expect(res.text).toContain('id="wpRest"');
    expect(res.text).toContain('id="wpSearchWater"');
    expect(res.text).toContain('id="wpHistoryModal"');
    // Release 3: the menu, the map action and the scenario picker.
    expect(res.text).toContain('id="wpMenu"');
    expect(res.text).toContain('id="wpScenarios"');
    expect(res.text).toContain('id="wpCheckMap"');
    expect(res.text).toContain('id="wpCheats"');
    expect(res.text).toContain('id="wpMapSize"');
    expect(res.text).toContain('id="wpScoreboardBtn"');
    expect(res.text).toContain('id="wpGuide"');
  });

  it("redirects the extension-less path", async () => {
    await setEnabled(true);
    const res = await request(app).get("/operator/survival").expect(302);
    expect(res.headers.location).toBe("/operator/survival.html");
  });

  it("ships the game modules as static files", async () => {
    await setEnabled(true);
    const files = [
      "rng.js",
      "hex.js",
      "config.js",
      "game.js",
      "events.js",
      "markers.js",
      "chaser.js",
      "snapshot.js",
      "ambient.js",
      "guide.js",
      "cheats.js",
      "balance-bot.js",
      "assets.js",
      "ui.js",
    ];
    for (const file of files) {
      await request(app)
        .get("/js/games/survival/" + file)
        .expect(200);
    }
  });
});
