/**
 * Rolnopol Survival — script order on the page.
 *
 * Every module is written twice over: `require` in Node, and a global picked off
 * `root.Survival` in the browser. The browser half reads its dependencies at the
 * moment the file runs, so a module loaded before the thing it needs captures
 * `undefined` and fails later with a message that points at the wrong file.
 *
 * Node never sees it, because `require` resolves whatever the order. That is
 * exactly why this test exists: the whole unit suite passed while the chase
 * scenario was broken in the browser, because `scenarios.js` was two lines above
 * `chaser.js` in the page.
 *
 * The graph is read from the sources rather than written down here, so adding a
 * module cannot leave this check behind.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const GAME_DIR = path.join(__dirname, "../../public/js/games/survival");
const HTML = fs.readFileSync(path.join(__dirname, "../../public/operator/survival.html"), "utf8");

/** Which file defines which `Survival.<name>` global. */
function moduleNames() {
  const names = {};

  for (const file of fs.readdirSync(GAME_DIR).filter((name) => name.endsWith(".js"))) {
    const source = fs.readFileSync(path.join(GAME_DIR, file), "utf8");
    const match = source.match(/root\.Survival\.(\w+)\s*=\s*factory/);
    if (match) names[match[1]] = file;
  }

  return names;
}

/** What each file reaches for in its browser branch. */
function dependencies(file) {
  const source = fs.readFileSync(path.join(GAME_DIR, file), "utf8");
  const factoryCalls = source.match(/factory\([^)]*\)/gs) || [];
  const found = new Set();

  for (const call of factoryCalls) {
    for (const match of call.matchAll(/root\.Survival\.(\w+)/g)) found.add(match[1]);
  }

  return [...found];
}

/** The order the page actually loads them in. */
function loadOrder() {
  return [...HTML.matchAll(/\/js\/games\/survival\/([\w-]+\.js)/g)].map((match) => match[1]);
}

describe("survival load order", () => {
  it("loads every module the game directory holds", () => {
    const onDisk = fs.readdirSync(GAME_DIR).filter((name) => name.endsWith(".js"));
    const loaded = loadOrder();

    expect([...loaded].sort()).toEqual([...onDisk].sort());
  });

  it("loads each module after everything it reads at load time", () => {
    const names = moduleNames();
    const order = loadOrder();
    const problems = [];

    order.forEach((file, index) => {
      for (const dependency of dependencies(file)) {
        const provider = names[dependency];

        // `ui.js` and friends assign their own global; that is not a dependency.
        if (!provider || provider === file) continue;

        const providerIndex = order.indexOf(provider);
        if (providerIndex === -1 || providerIndex > index) {
          problems.push(file + " needs " + provider + " but is loaded before it");
        }
      }
    });

    expect(problems).toEqual([]);
  });

  it("puts the module that touches the DOM last", () => {
    const order = loadOrder();
    expect(order[order.length - 1]).toBe("ui.js");
  });

  it("has no module reaching for a global nobody defines", () => {
    const names = moduleNames();
    const unknown = [];

    for (const file of loadOrder()) {
      for (const dependency of dependencies(file)) {
        if (!names[dependency]) unknown.push(file + " reaches for Survival." + dependency);
      }
    }

    expect(unknown).toEqual([]);
  });
});
