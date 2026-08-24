import { describe, it, expect } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";

// Import the app without starting the server
const app = require("../api/index.js");
const pipeline = require("../public/js/pages/metadata-peeler-pipeline.js");

// The tool is hidden the way the other operator prototypes are: nothing links to
// it and it asks robots to stay away, but a caller who knows the URL gets it.
// The file's bytes never reach this process, so there is no endpoint to gate.
describe("hidden operator Metadata Peeler page", () => {
  it("serves the page", async () => {
    const res = await request(app).get("/operator/tools/metadata-peeler.html");

    expect(res.status, `Body: ${res.text?.slice(0, 200)}`).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("Metadata <span>Peeler</span>");
    expect(res.text).toContain("/css/pages/metadata-peeler.css");
    expect(res.text).toContain("/js/pages/metadata-peeler-pipeline.js");
    expect(res.text).toContain("/js/pages/metadata-peeler.js");
  });

  it("redirects the extension-less path", async () => {
    const res = await request(app).get("/operator/tools/metadata-peeler");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/operator/tools/metadata-peeler.html");
  });

  it("stays out of search results", async () => {
    const res = await request(app).get("/operator/tools/metadata-peeler.html");

    expect(res.text).toContain('name="robots" content="noindex, nofollow"');
  });

  it("accepts only JPEG, PNG and GIF", async () => {
    const res = await request(app).get("/operator/tools/metadata-peeler.html");

    expect(res.text).toContain('accept="image/jpeg,image/png,image/gif"');
  });

  // The toggles are the pipeline's strip groups. If the two lists drift apart a
  // group becomes unreachable from the page, or a toggle governs nothing.
  it("offers a toggle for every strip group the pipeline defines", async () => {
    const res = await request(app).get("/operator/tools/metadata-peeler.html");
    const declared = [...res.text.matchAll(/<input([^>]*data-mdp-strip="([^"]+)"[^>]*)>/g)].map((match) => ({
      key: match[2],
      checked: /\bchecked\b/.test(match[1]),
    }));

    expect(declared.map((item) => item.key)).toEqual(pipeline.STRIP_GROUPS.map((group) => group.key));

    for (const group of pipeline.STRIP_GROUPS) {
      const toggle = declared.find((item) => item.key === group.key);

      expect(toggle.checked, `toggle ${group.key} default`).toBe(group.default === true);
    }
  });

  it("exposes the source, exposure, structure and inspector controls", async () => {
    const res = await request(app).get("/operator/tools/metadata-peeler.html");

    const controls = [
      "mdpDrop",
      "mdpFile",
      "mdpPeel",
      "mdpReport",
      "mdpClear",
      "mdpFindings",
      "mdpPreview",
      "mdpThumb",
      "mdpBlocks",
      "mdpHex",
      "mdpHexRows",
      "mdpHexScope",
      "mdpExif",
      "mdpSelectAll",
      "mdpSelectNone",
      "mdpReset",
      "mdpTheme",
      "mdpState",
    ];

    for (const id of controls) {
      expect(res.text, `control ${id} missing`).toContain(`id="${id}"`);
    }
  });

  it("offers every console theme the stylesheet defines", async () => {
    const page = await request(app).get("/operator/tools/metadata-peeler.html");
    const css = await request(app).get("/css/pages/metadata-peeler.css");

    // "cyan" is the default and lives in :root, so it has no theme block.
    for (const theme of ["amber", "lime", "magenta", "ice"]) {
      expect(page.text, `theme option ${theme} missing`).toContain(`value="${theme}"`);
      expect(css.text, `theme block ${theme} missing`).toContain(`[data-mdp-theme="${theme}"]`);
    }

    expect(page.text).toContain('value="cyan"');
  });

  it("serves the stylesheet and both scripts the page needs", async () => {
    const css = await request(app).get("/css/pages/metadata-peeler.css");
    const page = await request(app).get("/js/pages/metadata-peeler.js");
    const parser = await request(app).get("/js/pages/metadata-peeler-pipeline.js");

    expect(css.status).toBe(200);
    expect(page.status).toBe(200);
    expect(parser.status).toBe(200);

    // The parsing must be ours: a walk over the container's own headers...
    expect(parser.text).toContain("function parseJpeg");
    expect(parser.text).toContain("function parsePng");
    expect(parser.text).toContain("function parseGif");
    expect(parser.text).toContain("function parseExif");
    expect(parser.text).toContain("function crc32");

    // ...with no DOM in it, which is what makes it unit-testable at all.
    expect(parser.text).not.toContain("document.");
    expect(parser.text).not.toContain("getElementById");

    // The console owns only the work that needs a document.
    expect(page.text).toContain("MetadataPeelerPipeline");
    expect(page.text).toContain("createObjectURL");
  });

  // There is no DOM harness in this repo, so a mistyped id would only surface as
  // a thrown TypeError in a real browser. Check the two files agree instead.
  it("looks up only elements the markup actually has", async () => {
    const page = await request(app).get("/operator/tools/metadata-peeler.html");
    const js = await request(app).get("/js/pages/metadata-peeler.js");

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
        if (full.endsWith(path.join("operator", "tools", "metadata-peeler.html"))) continue;
        if (entry.name.startsWith("metadata-peeler")) continue;

        if (fs.readFileSync(full, "utf8").includes("tools/metadata-peeler")) {
          linked.push(path.relative(publicDir, full));
        }
      }
    };

    walk(publicDir);

    expect(linked, `The Metadata Peeler is meant to be hidden but is linked from: ${linked.join(", ")}`).toEqual([]);
  });
});
