import { describe, it, expect } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";

// Import the app without starting the server
const app = require("../api/index.js");

// The tool is hidden the way the other operator prototypes are: nothing links to
// it and it asks robots to stay away, but a caller who knows the URL gets it.
// All corruption happens in the browser, so there is no endpoint to gate.
describe("hidden operator Glitch Machine page", () => {
  it("serves the page", async () => {
    const res = await request(app).get("/operator/tools/glitch-machine.html");

    expect(res.status, `Body: ${res.text?.slice(0, 200)}`).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("GLITCH<span>//</span>MACHINE");
    expect(res.text).toContain("/css/pages/glitch-machine.css");
    expect(res.text).toContain("/js/pages/glitch-machine-pipeline.js");
    expect(res.text).toContain("/js/pages/glitch-machine.js");
  });

  it("redirects the extension-less path", async () => {
    const res = await request(app).get("/operator/tools/glitch-machine");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/operator/tools/glitch-machine.html");
  });

  it("stays out of search results", async () => {
    const res = await request(app).get("/operator/tools/glitch-machine.html");

    expect(res.text).toContain('name="robots" content="noindex, nofollow"');
  });

  it("accepts only JPEG, PNG and GIF", async () => {
    const res = await request(app).get("/operator/tools/glitch-machine.html");

    expect(res.text).toContain('accept="image/jpeg,image/png,image/gif"');
  });

  it("exposes the corruption, seed and carrier controls", async () => {
    const res = await request(app).get("/operator/tools/glitch-machine.html");

    const controls = [
      "glxAmount",
      "glxWindowFrom",
      "glxWindowTo",
      "glxOpMutate",
      "glxOpSmear",
      "glxOpStutter",
      "glxOpSwap",
      "glxSeed",
      "glxReroll",
      "glxAuto",
      "glxQuality",
      "glxRebake",
      "glxCompare",
      "glxSaveJpeg",
      "glxSavePng",
      "glxReset",
      "glxSignal",
    ];

    for (const id of controls) {
      expect(res.text, `control ${id} missing`).toContain(`id="${id}"`);
    }
  });

  it("offers every signal scheme the stylesheet defines", async () => {
    const page = await request(app).get("/operator/tools/glitch-machine.html");
    const css = await request(app).get("/css/pages/glitch-machine.css");

    // "vapor" is the default and lives in :root, so it has no signal block.
    for (const signal of ["toxin", "inferno", "void"]) {
      expect(page.text, `signal option ${signal} missing`).toContain(`value="${signal}"`);
      expect(css.text, `signal block ${signal} missing`).toContain(`[data-glx-signal="${signal}"]`);
    }

    expect(page.text).toContain('value="vapor"');
  });

  it("serves the stylesheet and both scripts the page needs", async () => {
    const css = await request(app).get("/css/pages/glitch-machine.css");
    const page = await request(app).get("/js/pages/glitch-machine.js");
    const pipeline = await request(app).get("/js/pages/glitch-machine-pipeline.js");

    expect(css.status).toBe(200);
    expect(page.status).toBe(200);
    expect(pipeline.status).toBe(200);

    // The page owns the one stage that needs a canvas: rebaking to JPEG...
    expect(page.text).toContain("toBlob");
    expect(page.text).toContain("GlitchMachinePipeline");

    // ...and the corruption must be ours and structure-aware: a marker walk
    // that finds the scans, then seeded writes that stay inside them.
    expect(pipeline.text).toContain("function mapJpeg");
    expect(pipeline.text).toContain("function glitch");
    expect(pipeline.text).toContain("function mulberry32");
    expect(pipeline.text).toContain("function canWrite");
  });

  // There is no DOM harness in this repo, so a mistyped id would only surface as
  // a thrown TypeError in a real browser. Check the two files agree instead.
  it("looks up only elements the markup actually has", async () => {
    const page = await request(app).get("/operator/tools/glitch-machine.html");
    const js = await request(app).get("/js/pages/glitch-machine.js");

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
        if (full.endsWith(path.join("operator", "tools", "glitch-machine.html"))) continue;
        if (entry.name.startsWith("glitch-machine")) continue;

        if (fs.readFileSync(full, "utf8").includes("tools/glitch-machine")) {
          linked.push(path.relative(publicDir, full));
        }
      }
    };

    walk(publicDir);

    expect(linked, `Glitch Machine is meant to be hidden but is linked from: ${linked.join(", ")}`).toEqual([]);
  });
});
