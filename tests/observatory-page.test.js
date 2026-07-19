import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setObservatoryEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { observatoryEnabled: enabled } })
    .expect(200);
}

describe("Operator observatory page", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
    await setObservatoryEnabled(true);
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("serves the observatory page", async () => {
    const response = await request(app).get("/operator/observatory.html").expect(200);

    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("Operator Observatory");
    expect(response.text).toContain("observatoryCanvas");
    expect(response.text).toContain("observatoryObjectTypeFilter");
    expect(response.text).toContain("observatorySearchInput");
    expect(response.text).toContain("/css/pages/observatory.css");
    expect(response.text).toContain("/js/pages/observatory.js");
    expect(response.text).toContain("simplified real-time sky dome");
  });

  it("redirects the shortcut path to the observatory page", async () => {
    const response = await request(app).get("/operator/observatory").expect(302);

    expect(response.headers.location).toBe("/operator/observatory.html");
  });

  it("supports the astronomy alias and redirects it to the canonical observatory page", async () => {
    const response = await request(app).get("/operator/astronomy").expect(302);

    expect(response.headers.location).toBe("/operator/observatory.html");
  });

  it("exposes observatory sky data from the backend including the moon", async () => {
    const response = await request(app)
      .get("/api/v1/observatory")
      .query({
        latitude: 52.2297,
        longitude: 21.0122,
        magnitudeLimit: 4.2,
        timestamp: "2026-05-31T21:00:00.000Z",
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.page).toMatchObject({
      title: "Operator Observatory",
      pageUrl: "/operator/observatory.html",
    });
    expect(response.body.data.observer).toMatchObject({
      latitudeDeg: 52.2297,
      longitudeDeg: 21.0122,
    });
    expect(response.body.data.sky).toEqual(
      expect.objectContaining({
        moon: expect.objectContaining({
          id: "moon",
          name: "Moon",
          type: "moon",
          altitudeDeg: expect.any(Number),
          azimuthDeg: expect.any(Number),
          phaseLabel: expect.any(String),
          illuminationPct: expect.any(Number),
        }),
        planets: expect.arrayContaining([
          expect.objectContaining({
            id: "venus",
            name: "Venus",
            type: "planet",
          }),
          expect.objectContaining({
            id: "pluto",
            name: "Pluto",
            type: "planet",
          }),
        ]),
        visibleObjects: expect.any(Array),
        constellations: expect.any(Array),
      }),
    );
  });
});
