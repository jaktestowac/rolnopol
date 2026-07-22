/**
 * In-memory JSON store with file persistence for the AgriAcademy ecosystem.
 *
 * A trimmed, self-contained port of Rolnopol's data/json-database.js — same
 * load-into-memory + persist-on-write model and the same public API surface we
 * use (initialize, getAll, update, replaceAll), but with ZERO dependency on
 * Rolnopol. Owned by the ecosystem.
 *
 * Writes are serialized through a per-process semaphore and coalesced, so
 * concurrent mutations (e.g. two sessions racing) are applied one at a time.
 */
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

class Semaphore {
  constructor() {
    this.waiting = [];
    this.count = 0;
  }
  async acquire() {
    if (this.count > 0) {
      await new Promise((resolve) => this.waiting.push(resolve));
    }
    this.count++;
  }
  release() {
    this.count--;
    const next = this.waiting.shift();
    if (next) next();
  }
}

const globalWriteSemaphore = new Semaphore();

class JSONDatabase {
  constructor(filePath, defaultData = {}) {
    this.filePath = filePath;
    this.defaultData = defaultData;
    this.data = null;
    this.isInitialized = false;
    this.ensureDirectory();
  }

  ensureDirectory() {
    const dir = path.dirname(this.filePath);
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }
  }

  clone(value) {
    return Array.isArray(value) ? [...value] : { ...value };
  }

  async initialize() {
    if (this.isInitialized) return;
    try {
      if (fsSync.existsSync(this.filePath)) {
        const content = await fs.readFile(this.filePath, "utf8");
        if (content && content.trim() !== "") {
          this.data = JSON.parse(content);
        } else {
          this.data = this.clone(this.defaultData);
          await this.persist();
        }
      } else {
        this.data = this.clone(this.defaultData);
        await this.persist();
      }
    } catch {
      this.data = this.clone(this.defaultData);
    }
    this.isInitialized = true;
  }

  async persist() {
    await globalWriteSemaphore.acquire();
    try {
      const json = JSON.stringify(this.data, null, 2);
      await fs.writeFile(this.filePath, json, "utf8");
    } finally {
      globalWriteSemaphore.release();
    }
  }

  async getAll() {
    if (!this.isInitialized) await this.initialize();
    return this.data;
  }

  /**
   * Read-modify-write applied atomically with respect to other update() calls
   * on the same process (the write semaphore serializes the persist, and the
   * transform runs synchronously between acquire points). updateFn receives the
   * current data and returns the next data.
   */
  async update(updateFn) {
    if (!this.isInitialized) await this.initialize();
    const next = updateFn(this.data);
    this.data = next;
    await this.persist();
    return this.data;
  }

  async replaceAll(next) {
    if (!this.isInitialized) await this.initialize();
    this.data = next;
    await this.persist();
    return this.data;
  }
}

module.exports = JSONDatabase;
