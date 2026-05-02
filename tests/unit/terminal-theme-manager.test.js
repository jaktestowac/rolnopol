import { describe, expect, it } from "vitest";

const { TerminalThemeError, createTerminalThemeManager } = require("../../public/js/pages/terminal-theme-manager.js");

function createMemoryStorage(initialState = {}) {
  const store = new Map(Object.entries(initialState));

  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

function createFakeDocument() {
  const classes = new Set();

  return {
    documentElement: {
      dataset: {},
      classList: {
        add: (...tokens) => tokens.forEach((token) => classes.add(token)),
        remove: (...tokens) => tokens.forEach((token) => classes.delete(token)),
        contains: (token) => classes.has(token),
        toggle: (token, force) => {
          const shouldAdd = force === undefined ? !classes.has(token) : force === true;
          if (shouldAdd) {
            classes.add(token);
            return true;
          }
          classes.delete(token);
          return false;
        },
      },
    },
  };
}

describe("terminal theme manager", () => {
  it("applies, persists, and restores terminal theme settings", () => {
    const storage = createMemoryStorage();

    const firstDocument = createFakeDocument();
    const firstManager = createTerminalThemeManager({
      documentRef: firstDocument,
      storage,
      persist: true,
      matchMedia: () => ({ matches: false }),
    });

    expect(firstManager.listThemes().map((theme) => theme.name)).toEqual(["green", "amber", "blue", "white", "glitch"]);
    expect(firstDocument.documentElement.dataset.terminalTheme).toBe("green");
    expect(firstDocument.documentElement.dataset.terminalEffects).toBe("on");
    expect(firstDocument.documentElement.classList.contains("terminal-effects-on")).toBe(true);

    firstManager.setTheme("blue");
    firstManager.setEffectsEnabled(false);

    expect(firstDocument.documentElement.dataset.terminalTheme).toBe("blue");
    expect(firstDocument.documentElement.dataset.terminalEffects).toBe("off");
    expect(firstDocument.documentElement.classList.contains("terminal-effects-off")).toBe(true);

    const restoredDocument = createFakeDocument();
    const restoredManager = createTerminalThemeManager({
      documentRef: restoredDocument,
      storage,
      persist: true,
      matchMedia: () => ({ matches: false }),
    });

    expect(restoredManager.getState()).toMatchObject({
      themeName: "blue",
      effectsEnabled: false,
      reducedMotion: false,
    });
    expect(restoredDocument.documentElement.dataset.terminalTheme).toBe("blue");
    expect(restoredDocument.documentElement.dataset.terminalEffects).toBe("off");
    expect(restoredDocument.documentElement.classList.contains("terminal-effects-off")).toBe(true);
  });

  it("respects reduced-motion preference and surfaces unknown themes clearly", () => {
    const documentRef = createFakeDocument();
    const manager = createTerminalThemeManager({
      documentRef,
      persist: false,
      matchMedia: () => ({ matches: true }),
    });

    expect(manager.isReducedMotion()).toBe(true);
    expect(manager.isEffectsEnabled()).toBe(false);
    expect(documentRef.documentElement.dataset.terminalEffects).toBe("off");

    expect(() => manager.setTheme("does-not-exist")).toThrow(TerminalThemeError);
  });
});
