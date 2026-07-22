import { describe, it, expect, beforeEach, afterEach } from "vitest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Direct unit coverage for the AgriAcademy shared libraries. These are the
// ecosystem's own copies under external-services/agri-academy/shared — distinct
// from Rolnopol's data/ copies — and had no dedicated tests.
const SHARED = path.join(__dirname, "..", "..", "external-services", "agri-academy", "shared");
const JSONDatabase = require(path.join(SHARED, "json-database.js"));
const clock = require(path.join(SHARED, "clock.js"));
const templates = require(path.join(SHARED, "cert-templates.js"));

// ── json-database ─────────────────────────────────────────────────────────────
describe("shared/json-database", () => {
  let file;
  const tmp = () => path.join(os.tmpdir(), `aa-jsondb-${process.pid}-${seq++}.json`);
  let seq = 0;
  const DEFAULTS = { version: 1, n: 0, items: {} };

  beforeEach(() => {
    file = tmp();
  });
  afterEach(() => {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  });

  it("seeds defaults (and persists) when the file does not exist", async () => {
    const db = new JSONDatabase(file, DEFAULTS);
    await db.initialize();
    expect(await db.getAll()).toEqual(DEFAULTS);
    expect(fs.existsSync(file)).toBe(true); // persisted on first boot
  });

  it("seeds defaults for an empty file", async () => {
    fs.writeFileSync(file, "   ");
    const db = new JSONDatabase(file, DEFAULTS);
    await db.initialize();
    expect(await db.getAll()).toEqual(DEFAULTS);
  });

  it("recovers from a corrupt file by falling back to defaults", async () => {
    fs.writeFileSync(file, "{ this is not: valid json ]");
    const db = new JSONDatabase(file, DEFAULTS);
    await db.initialize(); // must NOT throw
    expect(await db.getAll()).toEqual(DEFAULTS);
  });

  it("loads existing valid data verbatim", async () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, n: 5, items: { a: 1 } }));
    const db = new JSONDatabase(file, DEFAULTS);
    await db.initialize();
    expect((await db.getAll()).n).toBe(5);
  });

  it("getAll auto-initializes when not yet initialized", async () => {
    const db = new JSONDatabase(file, DEFAULTS);
    expect(await db.getAll()).toEqual(DEFAULTS); // no explicit initialize()
  });

  it("update() applies a read-modify-write and persists it to disk", async () => {
    const db = new JSONDatabase(file, DEFAULTS);
    await db.initialize();
    await db.update((d) => ({ ...d, n: d.n + 1 }));
    expect((await db.getAll()).n).toBe(1);
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(onDisk.n).toBe(1);
  });

  it("serializes concurrent updates without losing a write", async () => {
    const db = new JSONDatabase(file, DEFAULTS);
    await db.initialize();
    await Promise.all([
      db.update((d) => ({ ...d, n: d.n + 1 })),
      db.update((d) => ({ ...d, n: d.n + 1 })),
      db.update((d) => ({ ...d, n: d.n + 1 })),
    ]);
    expect((await db.getAll()).n).toBe(3);
  });

  it("replaceAll swaps the whole store and persists", async () => {
    const db = new JSONDatabase(file, DEFAULTS);
    await db.initialize();
    await db.replaceAll({ version: 2, n: 99, items: {} });
    expect((await db.getAll()).n).toBe(99);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).version).toBe(2);
  });

  it("clone copies arrays and objects shallowly (no shared reference)", () => {
    const db = new JSONDatabase(file, DEFAULTS);
    const arr = [1, 2];
    const obj = { a: 1 };
    expect(db.clone(arr)).toEqual(arr);
    expect(db.clone(arr)).not.toBe(arr);
    expect(db.clone(obj)).toEqual(obj);
    expect(db.clone(obj)).not.toBe(obj);
  });
});

// ── clock ───────────────────────────────────────────────────────────────────
describe("shared/clock", () => {
  afterEach(() => {
    delete process.env.AGRI_ACADEMY_TIME_OFFSET_MS;
  });

  it("now() ≈ Date.now() with no offset set", () => {
    expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1000);
  });

  it("now() is shifted forward by a positive offset", () => {
    process.env.AGRI_ACADEMY_TIME_OFFSET_MS = String(100000);
    expect(clock.now() - Date.now()).toBeGreaterThanOrEqual(100000 - 1000);
    expect(clock.now() - Date.now()).toBeLessThan(100000 + 1000);
  });

  it("a negative offset moves the clock backward", () => {
    process.env.AGRI_ACADEMY_TIME_OFFSET_MS = String(-50000);
    expect(clock.now()).toBeLessThan(Date.now());
  });

  it("a non-numeric offset is treated as 0 (never NaN)", () => {
    process.env.AGRI_ACADEMY_TIME_OFFSET_MS = "not-a-number";
    expect(Number.isFinite(clock.now())).toBe(true);
    expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1000);
  });

  it("an empty offset is treated as 0", () => {
    process.env.AGRI_ACADEMY_TIME_OFFSET_MS = "";
    expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1000);
  });

  it("nowIso() returns an offset-aware ISO string", () => {
    process.env.AGRI_ACADEMY_TIME_OFFSET_MS = String(3600000); // +1h
    const iso = clock.nowIso();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(Math.abs(Date.parse(iso) - clock.now())).toBeLessThan(1000);
  });
});

// ── cert-templates ────────────────────────────────────────────────────────────
describe("shared/cert-templates", () => {
  it("exposes 10 unique templates with the default among them", () => {
    expect(templates.TEMPLATE_IDS.length).toBe(10);
    expect(new Set(templates.TEMPLATE_IDS).size).toBe(10);
    expect(templates.TEMPLATE_IDS).toContain(templates.DEFAULT_TEMPLATE);
  });

  it("isValidTemplate accepts known ids and rejects everything else", () => {
    expect(templates.isValidTemplate(templates.DEFAULT_TEMPLATE)).toBe(true);
    expect(templates.isValidTemplate("midnight")).toBe(true);
    for (const bad of [null, undefined, "", "neon-glow", 42, {}]) {
      expect(templates.isValidTemplate(bad)).toBe(false);
    }
  });

  it("getTemplate falls back to the default descriptor for an unknown id", () => {
    const known = templates.getTemplate("midnight");
    expect(known.id).toBe("midnight");
    const fallback = templates.getTemplate("does-not-exist");
    expect(fallback.id).toBe(templates.DEFAULT_TEMPLATE);
    expect(fallback.accent).toBeTruthy();
  });
});
