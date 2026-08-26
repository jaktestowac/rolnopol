import { describe, it, expect } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";

// Import the app without starting the server
const app = require("../api/index.js");
const pipeline = require("../public/js/pages/spectrogram-bench-pipeline.js");

// The tool is hidden the way the other operator prototypes are: nothing links to
// it and it asks robots to stay away, but a caller who knows the URL gets it.
// The samples never reach this process, so there is no endpoint to gate.
describe("hidden operator Spectrogram Bench page", () => {
  it("serves the page", async () => {
    const res = await request(app).get("/operator/tools/spectrogram-bench.html");

    expect(res.status, `Body: ${res.text?.slice(0, 200)}`).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("Spectrogram <span>Bench</span>");
    expect(res.text).toContain("/css/pages/spectrogram-bench.css");
    expect(res.text).toContain("/js/pages/spectrogram-bench-pipeline.js");
    expect(res.text).toContain("/js/pages/spectrogram-bench.js");
  });

  it("redirects the extension-less path", async () => {
    const res = await request(app).get("/operator/tools/spectrogram-bench");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/operator/tools/spectrogram-bench.html");
  });

  it("stays out of search results", async () => {
    const res = await request(app).get("/operator/tools/spectrogram-bench.html");

    expect(res.text).toContain('name="robots" content="noindex, nofollow"');
  });

  it("accepts WAV and MP3", async () => {
    const res = await request(app).get("/operator/tools/spectrogram-bench.html");

    expect(res.text).toContain('accept="audio/wav,audio/x-wav,audio/wave,audio/mpeg,.wav,.mp3"');
  });

  it("exposes the analysis, display, signal and transport controls", async () => {
    const res = await request(app).get("/operator/tools/spectrogram-bench.html");

    const controls = [
      "spbDrop",
      "spbFile",
      "spbCanvas",
      "spbOverlay",
      "spbWave",
      "spbFftSize",
      "spbWindow",
      "spbOverlap",
      "spbChannel",
      "spbRamp",
      "spbFloor",
      "spbGain",
      "spbLogScale",
      "spbGridLines",
      "spbSignal",
      "spbSeconds",
      "spbLoadSignal",
      "spbPlay",
      "spbStop",
      "spbSavePng",
      "spbClear",
      "spbLegend",
      "spbDecoder",
      "spbTheme",
      "spbState",
      "spbExportSize",
      "spbWindowMs",
      "spbRange",
      "spbWaveOverlay",
      "spbNormalize",
      "spbNormalizeTarget",
      "spbPreEmphasis",
      "spbEmphasis",
      "spbProcessing",
    ];

    for (const id of controls) {
      expect(res.text, `control ${id} missing`).toContain(`id="${id}"`);
    }
  });

  // Same drift-guard as the other selects: every table the pipeline exposes has
  // to be reachable from the markup, or an option selects nothing.
  it("offers every export size, window length and frequency range the pipeline defines", async () => {
    const res = await request(app).get("/operator/tools/spectrogram-bench.html");

    for (const size of pipeline.EXPORT_SIZES) {
      expect(res.text, `export size ${size.key} missing`).toContain(`value="${size.key}"`);
    }

    for (const length of pipeline.WINDOW_LENGTHS) {
      expect(res.text, `window length ${length.key} missing`).toContain(`value="${length.key}"`);
    }

    for (const range of pipeline.FREQUENCY_RANGES) {
      expect(res.text, `range ${range.key} missing`).toContain(`value="${range.key}"`);
    }
  });

  it("names the three scientific colour maps and defaults to one of them", async () => {
    const res = await request(app).get("/operator/tools/spectrogram-bench.html");
    const selected = res.text.match(/<option value="([^"]+)" selected>[^<]*<\/option>\s*<option value="plasma"/);

    for (const name of ["viridis", "plasma", "inferno"]) {
      expect(res.text, `${name} missing`).toContain(`value="${name}"`);
      expect(pipeline.RAMPS, `${name} not in the pipeline`).toHaveProperty(name);
    }

    // Whatever the ramp select defaults to must be a ramp that exists — the
    // console seeds its lookup table from this value.
    expect(selected).not.toBe(null);
    expect(pipeline.RAMPS).toHaveProperty(selected[1]);
  });

  /* The conditioning passes change the samples, so they have to re-run the
   * transform; the frequency range and the ramp only change how the same
   * magnitudes are drawn. A control in the wrong list is a silently stale plot. */
  it("re-analyses for conditioning and only repaints for presentation", async () => {
    const js = await request(app).get("/js/pages/spectrogram-bench.js");
    const reanalyse = js.text.match(/const REANALYSE = \[([\s\S]*?)\]/)[1];
    const overlayOnly = js.text.match(/const OVERLAY_ONLY = \[([\s\S]*?)\]/)[1];

    for (const id of ["spbNormalize", "spbNormalizeTarget", "spbPreEmphasis", "spbEmphasis", "spbWindowMs"]) {
      expect(reanalyse, `${id} must re-analyse`).toContain(id);
    }

    for (const id of ["spbRamp", "spbFloor", "spbGain", "spbRange"]) {
      expect(reanalyse, `${id} must not re-analyse`).not.toContain(id);
    }

    expect(overlayOnly).toContain("spbWaveOverlay");
    expect(overlayOnly).toContain("spbGridLines");
  });

  // The selects are the pipeline's own option sets. If the two drift apart, an
  // option either selects nothing or a capability becomes unreachable.
  it("offers every FFT size, window, ramp and test signal the pipeline defines", async () => {
    const res = await request(app).get("/operator/tools/spectrogram-bench.html");

    for (const size of pipeline.FFT_SIZES) {
      expect(res.text, `FFT size ${size} missing`).toContain(`value="${size}"`);
    }

    for (const name of Object.keys(pipeline.WINDOWS)) {
      expect(res.text, `window ${name} missing`).toContain(`value="${name}"`);
    }

    for (const name of Object.keys(pipeline.RAMPS)) {
      expect(res.text, `ramp ${name} missing`).toContain(`value="${name}"`);
    }

    for (const name of Object.keys(pipeline.SIGNALS)) {
      expect(res.text, `signal ${name} missing`).toContain(`value="${name}"`);
    }
  });

  it("keeps the dB floor slider inside the range the pipeline declares", async () => {
    const res = await request(app).get("/operator/tools/spectrogram-bench.html");
    const floor = res.text.match(/<input[^>]*id="spbFloor"[^>]*>/)[0];

    expect(floor).toContain(`min="${pipeline.DB_FLOOR_RANGE.min}"`);
    expect(floor).toContain(`max="${pipeline.DB_FLOOR_RANGE.max}"`);
    expect(floor).toContain(`value="${pipeline.DEFAULT_DB_FLOOR}"`);
  });

  it("defaults the FFT size to the pipeline's default", async () => {
    const res = await request(app).get("/operator/tools/spectrogram-bench.html");

    expect(res.text).toContain(`value="${pipeline.DEFAULT_FFT_SIZE}" selected`);
  });

  it("offers every console theme the stylesheet defines", async () => {
    const page = await request(app).get("/operator/tools/spectrogram-bench.html");
    const css = await request(app).get("/css/pages/spectrogram-bench.css");

    // "cyan" is the default and lives in :root, so it has no theme block.
    for (const theme of ["amber", "lime", "magenta", "ice"]) {
      expect(page.text, `theme option ${theme} missing`).toContain(`value="${theme}"`);
      expect(css.text, `theme block ${theme} missing`).toContain(`[data-spb-theme="${theme}"]`);
    }

    expect(page.text).toContain('value="cyan"');
  });

  it("serves the stylesheet and both scripts the page needs", async () => {
    const css = await request(app).get("/css/pages/spectrogram-bench.css");
    const page = await request(app).get("/js/pages/spectrogram-bench.js");
    const analysis = await request(app).get("/js/pages/spectrogram-bench-pipeline.js");

    expect(css.status).toBe(200);
    expect(page.status).toBe(200);
    expect(analysis.status).toBe(200);

    // Both container walks, the unpack and the transform are ours.
    expect(analysis.text).toContain("function parseRiff");
    expect(analysis.text).toContain("function parseMpeg");
    expect(analysis.text).toContain("function parseFrameHeader");
    expect(analysis.text).toContain("function mpegSlice");
    expect(analysis.text).toContain("function decodeSamples");
    expect(analysis.text).toContain("function makePlan");
    expect(analysis.text).toContain("function transform");
    expect(analysis.text).toContain("function spectrogram");

    // The pipeline never reaches for a browser decoder and has no DOM in it —
    // together that is what makes it unit-testable outside a browser at all.
    expect(analysis.text).not.toContain("decodeAudioData(");
    expect(analysis.text).not.toContain("document.");
    expect(analysis.text).not.toContain("getElementById");

    // The console owns only the work that needs a document.
    expect(page.text).toContain("SpectrogramBenchPipeline");
    expect(page.text).toContain("createImageData");
    expect(page.text).toContain("createBufferSource");
  });

  /* The tool's premise is that the analysis is hand-written, and MP3 is the one
   * deliberate exception: Layer III decoding is 34 Huffman tables, a bit
   * reservoir, an IMDCT and a synthesis filterbank, so the codec is borrowed
   * exactly the way the Pixelizer borrows `drawImage` to decode a JPEG.
   *
   * These assertions are the fence around that exception. */
  it("borrows the browser codec for the compressed path only", async () => {
    const html = await request(app).get("/operator/tools/spectrogram-bench.html");
    const page = await request(app).get("/js/pages/spectrogram-bench.js");

    // One caller, inside the compressed branch.
    expect([...page.text.matchAll(/decodeAudioData\(/g)]).toHaveLength(1);

    // The WAV branch still unpacks with our own reader, and the container is
    // chosen by signature rather than by file extension.
    expect(page.text).toContain("pipeline.decodeSamples(");
    expect(page.text).toContain("pipeline.detectContainer(");
    expect(page.text).toContain("pipeline.parseMpeg(");
    expect(page.text).toContain("pipeline.mpegSlice(");

    // And the page admits which half is which, on screen rather than in a
    // comment. Whitespace-tolerant: the formatter is free to wrap the hint.
    expect(html.text).toContain('id="spbDecoder"');
    expect(html.text).toMatch(/decoded\s+by\s+the\s+browser\s+codec/i);
  });

  // There is no DOM harness in this repo, so a mistyped id would only surface as
  // a thrown TypeError in a real browser. Check the two files agree instead.
  it("looks up only elements the markup actually has", async () => {
    const page = await request(app).get("/operator/tools/spectrogram-bench.html");
    const js = await request(app).get("/js/pages/spectrogram-bench.js");

    const wanted = [...js.text.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
    const missing = wanted.filter((id) => !page.text.includes(`id="${id}"`));

    expect(wanted.length).toBeGreaterThan(20);
    expect(missing, `script reads ids the page does not define: ${missing.join(", ")}`).toEqual([]);
  });

  // The console re-analyses on some controls and only repaints on others. A typo
  // in that list would silently stop the transform from re-running.
  it("names only real control ids in its re-analysis list", async () => {
    const page = await request(app).get("/operator/tools/spectrogram-bench.html");
    const js = await request(app).get("/js/pages/spectrogram-bench.js");
    const list = js.text.match(/const REANALYSE = \[([^\]]+)\]/)[1];
    const ids = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

    expect(ids.length).toBeGreaterThan(2);

    for (const id of ids) {
      expect(page.text, `re-analysis list names ${id}, which the page does not define`).toContain(`id="${id}"`);
    }
  });

  // The console reaches into the pipeline by name about thirty times. A typo
  // there is an undefined call at runtime, in a browser, with no test to catch
  // it — so check every name against what the module actually exports.
  it("calls only pipeline functions that exist", async () => {
    const js = await request(app).get("/js/pages/spectrogram-bench.js");
    // The lookbehind skips the file name in the header comment, where
    // "spectrogram-bench-pipeline.js" would otherwise read as a member called "js".
    const matches = [...js.text.matchAll(/(?<![-\w])pipeline\.([A-Za-z_][A-Za-z0-9_]*)/g)];
    const used = [...new Set(matches.map((match) => match[1]))];
    const exported = Object.keys(pipeline);
    const missing = used.filter((name) => exported.indexOf(name) === -1);

    expect(used.length).toBeGreaterThan(15);
    expect(missing, `console calls pipeline members that do not exist: ${missing.join(", ")}`).toEqual([]);
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
        if (full.endsWith(path.join("operator", "tools", "spectrogram-bench.html"))) continue;
        if (entry.name.startsWith("spectrogram-bench")) continue;

        if (fs.readFileSync(full, "utf8").includes("tools/spectrogram-bench")) {
          linked.push(path.relative(publicDir, full));
        }
      }
    };

    walk(publicDir);

    expect(linked, `The Spectrogram Bench is meant to be hidden but is linked from: ${linked.join(", ")}`).toEqual([]);
  });
});
