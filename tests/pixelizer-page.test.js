import { describe, it, expect } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";

// Import the app without starting the server
const app = require("../api/index.js");

// The tool is hidden the way the other operator prototypes are: nothing links to
// it and it asks robots to stay away, but a caller who knows the URL gets it.
// All image work happens in the browser, so there is no endpoint to gate.
describe("hidden operator Pixelizer page", () => {
  it("serves the page", async () => {
    const res = await request(app).get("/operator/tools/pixelizer.html");

    expect(res.status, `Body: ${res.text?.slice(0, 200)}`).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("Pixel<span>izer</span>");
    expect(res.text).toContain("/css/pages/pixelizer.css");
    expect(res.text).toContain("/js/pages/pixelizer-pipeline.js");
    expect(res.text).toContain("/js/pages/pixelizer.js");
  });

  it("redirects the extension-less path", async () => {
    const res = await request(app).get("/operator/tools/pixelizer");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/operator/tools/pixelizer.html");
  });

  it("stays out of search results", async () => {
    const res = await request(app).get("/operator/tools/pixelizer.html");

    expect(res.text).toContain('name="robots" content="noindex, nofollow"');
  });

  it("offers the three pixelation levels plus a custom block size", async () => {
    const res = await request(app).get("/operator/tools/pixelizer.html");

    for (const level of ["low", "medium", "high", "custom"]) {
      expect(res.text, `level ${level} missing`).toContain(`value="${level}"`);
    }

    expect(res.text).toContain('id="pxlBlock"');
  });

  it("accepts only JPEG, PNG and GIF", async () => {
    const res = await request(app).get("/operator/tools/pixelizer.html");

    expect(res.text).toContain('accept="image/jpeg,image/png,image/gif"');
  });

  it("exposes the colour, tone and mosaic controls", async () => {
    const res = await request(app).get("/operator/tools/pixelizer.html");

    const controls = [
      "pxlPalette",
      "pxlDepth",
      "pxlDither",
      "pxlInvert",
      "pxlBrightness",
      "pxlContrast",
      "pxlSaturation",
      "pxlShape",
      "pxlGutter",
      "pxlScanlines",
      "pxlBloom",
      "pxlCompare",
      "pxlDownload",
      "pxlReset",
      "pxlTheme",
    ];

    for (const id of controls) {
      expect(res.text, `control ${id} missing`).toContain(`id="${id}"`);
    }
  });

  it("offers every console theme the stylesheet defines", async () => {
    const page = await request(app).get("/operator/tools/pixelizer.html");
    const css = await request(app).get("/css/pages/pixelizer.css");

    // "cyan" is the default and lives in :root, so it has no theme block.
    for (const theme of ["amber", "lime", "magenta", "ice"]) {
      expect(page.text, `theme option ${theme} missing`).toContain(`value="${theme}"`);
      expect(css.text, `theme block ${theme} missing`).toContain(`[data-pxl-theme="${theme}"]`);
    }

    expect(page.text).toContain('value="cyan"');
  });

  it("serves the stylesheet and both scripts the page needs", async () => {
    const css = await request(app).get("/css/pages/pixelizer.css");
    const page = await request(app).get("/js/pages/pixelizer.js");
    const pipeline = await request(app).get("/js/pages/pixelizer-pipeline.js");

    expect(css.status).toBe(200);
    expect(page.status).toBe(200);
    expect(pipeline.status).toBe(200);

    // The page owns the one stage that needs a canvas...
    expect(page.text).toContain("getImageData");
    expect(page.text).toContain("putImageData");
    expect(page.text).toContain("PixelizerPipeline");

    // ...and the processing must be ours: block averaging over the raw buffer,
    // not a downscale/upscale trick handed to the browser's smoothing filter.
    expect(pipeline.text).toContain("function averageBlocks");
    expect(pipeline.text).toContain("function gradeBlocks");
    expect(pipeline.text).toContain("function paintBlocks");
  });

  // There is no DOM harness in this repo, so a mistyped id would only surface as
  // a thrown TypeError in a real browser. Check the two files agree instead.
  it("looks up only elements the markup actually has", async () => {
    const page = await request(app).get("/operator/tools/pixelizer.html");
    const js = await request(app).get("/js/pages/pixelizer.js");

    const wanted = [...js.text.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
    const missing = wanted.filter((id) => !page.text.includes(`id="${id}"`));

    expect(wanted.length).toBeGreaterThan(20);
    expect(missing, `script reads ids the page does not define: ${missing.join(", ")}`).toEqual([]);
  });

  it("is not linked from any shipped page", async () => {
    const publicDir = path.join(__dirname, "../public");
    const linked = [];

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(full);
          continue;
        }

        if (!/\.(html|js)$/i.test(entry.name)) continue;
        if (full.endsWith(path.join("operator", "tools", "pixelizer.html"))) continue;
        if (entry.name.startsWith("pixelizer")) continue;

        if (fs.readFileSync(full, "utf8").includes("tools/pixelizer")) {
          linked.push(path.relative(publicDir, full));
        }
      }
    };

    walk(publicDir);

    expect(linked, `Pixelizer is meant to be hidden but is linked from: ${linked.join(", ")}`).toEqual([]);
  });
});
