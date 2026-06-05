import { describe, expect, it } from "vitest";

describe("Operator Holiday Harvest Archive hidden page", () => {
  it("serves the harvest-archive page", async () => {
    const request = (await import("supertest")).default;
    const app = require("../api/index.js");
    const response = await request(app).get("/operator/harvest-archive.html").expect(200);

    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("Holiday Harvest Archive");
    expect(response.text).toContain("harvestArchiveShell");
    expect(response.text).toContain("/css/pages/harvest-archive.css");
    expect(response.text).toContain("/js/pages/harvest-archive.js");
  });

  it("redirects the shortcut path to the harvest-archive page", async () => {
    const request = (await import("supertest")).default;
    const app = require("../api/index.js");
    const response = await request(app).get("/operator/harvest-archive").expect(302);

    expect(response.headers.location).toBe("/operator/harvest-archive.html");
  });

  it("page contains the archive header and status elements", async () => {
    const request = (await import("supertest")).default;
    const app = require("../api/index.js");
    const response = await request(app).get("/operator/harvest-archive.html").expect(200);

    expect(response.text).toContain("harvest-archive-header");
    expect(response.text).toContain("harvestArchiveStatus");
    expect(response.text).toContain("harvestArchiveBadge");
    expect(response.text).toContain("harvestArchiveLayout");
  });

  it("page references shared styles and font-awesome", async () => {
    const request = (await import("supertest")).default;
    const app = require("../api/index.js");
    const response = await request(app).get("/operator/harvest-archive.html").expect(200);

    expect(response.text).toContain("/css/styles.css");
    expect(response.text).toContain("font-awesome");
  });

  it("page has correct title", async () => {
    const request = (await import("supertest")).default;
    const app = require("../api/index.js");
    const response = await request(app).get("/operator/harvest-archive.html").expect(200);

    expect(response.text).toContain("<title>Holiday Harvest Archive - Rolnopol</title>");
  });
});
