(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.TerminalThemeManager = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const DEFAULT_THEMES = {
    green: { label: "Green", description: "Classic green phosphor terminal" },
    amber: { label: "Amber", description: "Warm amber monochrome terminal" },
    blue: { label: "Blue", description: "Cool blue system console" },
    white: { label: "White", description: "Minimal monochrome terminal" },
    glitch: { label: "Glitch", description: "High-contrast sci-fi terminal" },
  };

  function toStringValue(value) {
    return value == null ? "" : String(value);
  }

  function normalizeThemeName(name) {
    return toStringValue(name).trim().toLowerCase();
  }

  function supportsStorage(storage) {
    return !!storage && typeof storage.getItem === "function" && typeof storage.setItem === "function";
  }

  function prefersReducedMotion(matchMediaImpl) {
    try {
      return typeof matchMediaImpl === "function" && matchMediaImpl("(prefers-reduced-motion: reduce)").matches === true;
    } catch (_) {
      return false;
    }
  }

  class TerminalThemeError extends Error {
    constructor(message, options = {}) {
      super(message || "Terminal theme error");
      this.name = "TerminalThemeError";
      this.code = options.code || "TERMINAL_THEME_ERROR";
      this.hint = toStringValue(options.hint);
      this.theme = toStringValue(options.theme);
    }

    toCommandResult(fallbackHint) {
      return {
        type: "error",
        content: this.message || "Terminal theme error",
        metadata: {
          code: this.code,
          hint: this.hint || fallbackHint || 'Type "theme list" to see available themes.',
          theme: this.theme || undefined,
        },
      };
    }
  }

  function createTerminalThemeManager(options = {}) {
    const documentRef = options.documentRef || (typeof document !== "undefined" ? document : null);
    const rootElement = options.rootElement || documentRef?.documentElement || null;
    const storage = options.storage || (typeof window !== "undefined" ? window.localStorage : null);
    const storageKey = toStringValue(options.storageKey || "rolnopol-terminal-theme-settings") || "rolnopol-terminal-theme-settings";
    const persist = options.persist !== false;
    const matchMediaImpl =
      options.matchMedia ||
      (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null);
    const reducedMotion = prefersReducedMotion(matchMediaImpl);
    const themes = {
      ...DEFAULT_THEMES,
      ...(options.themes || {}),
    };

    let state = {
      themeName: normalizeThemeName(options.defaultTheme || "green") || "green",
      effectsEnabled: options.defaultEffectsEnabled === undefined ? !reducedMotion : options.defaultEffectsEnabled !== false,
    };

    function getThemeDefinition(themeName = state.themeName) {
      const key = normalizeThemeName(themeName) || state.themeName;
      return themes[key] || null;
    }

    function listThemes() {
      return Object.entries(themes).map(([name, theme]) => ({
        name,
        label: theme.label || name,
        description: theme.description || "",
      }));
    }

    function getState() {
      return {
        themeName: state.themeName,
        effectsEnabled: state.effectsEnabled,
        reducedMotion,
      };
    }

    function persistState() {
      if (!persist || !supportsStorage(storage)) {
        return;
      }

      try {
        storage.setItem(
          storageKey,
          JSON.stringify({
            themeName: state.themeName,
            effectsEnabled: state.effectsEnabled,
          }),
        );
      } catch (_) {
        // Ignore storage failures; the terminal should still work.
      }
    }

    function loadState() {
      if (!persist || !supportsStorage(storage)) {
        return;
      }

      try {
        const raw = storage.getItem(storageKey);
        if (!raw) return;

        const parsed = JSON.parse(raw);
        const nextTheme = normalizeThemeName(parsed.themeName);
        if (nextTheme && themes[nextTheme]) {
          state.themeName = nextTheme;
        }

        if (typeof parsed.effectsEnabled === "boolean") {
          state.effectsEnabled = parsed.effectsEnabled;
        }
      } catch (_) {
        // Ignore malformed storage data.
      }
    }

    function applyState() {
      if (!rootElement) {
        return;
      }

      const effectiveEffectsEnabled = state.effectsEnabled && !reducedMotion;
      const theme = getThemeDefinition();

      rootElement.dataset.terminalTheme = state.themeName;
      rootElement.dataset.terminalEffects = effectiveEffectsEnabled ? "on" : "off";
      rootElement.dataset.terminalReducedMotion = reducedMotion ? "true" : "false";
      rootElement.dataset.terminalThemeLabel = theme?.label || state.themeName;
      rootElement.dataset.terminalThemeDescription = theme?.description || "";

      if (rootElement.classList) {
        rootElement.classList.toggle("terminal-effects-on", effectiveEffectsEnabled);
        rootElement.classList.toggle("terminal-effects-off", !effectiveEffectsEnabled);
      }
    }

    function ensureThemeExists(themeName) {
      const normalized = normalizeThemeName(themeName);
      if (!normalized || !themes[normalized]) {
        const available = listThemes()
          .map((theme) => theme.name)
          .join(", ");
        throw new TerminalThemeError(`Unknown theme: ${themeName}`, {
          code: "THEME_NOT_FOUND",
          theme: themeName,
          hint: `Available themes: ${available}`,
        });
      }
      return normalized;
    }

    function setTheme(themeName, options = {}) {
      const normalized = ensureThemeExists(themeName);
      state.themeName = normalized;
      applyState();
      if (options.persist !== false) {
        persistState();
      }
      return getThemeDefinition(normalized);
    }

    function setEffectsEnabled(enabled, options = {}) {
      state.effectsEnabled = enabled === true;
      applyState();
      if (options.persist !== false) {
        persistState();
      }
      return state.effectsEnabled;
    }

    function toggleEffects(options = {}) {
      return setEffectsEnabled(!state.effectsEnabled, options);
    }

    function reset(options = {}) {
      state.themeName = normalizeThemeName(options.defaultTheme || "green") || "green";
      state.effectsEnabled = options.defaultEffectsEnabled === undefined ? !reducedMotion : options.defaultEffectsEnabled !== false;
      applyState();
      if (options.persist !== false) {
        persistState();
      }
      return getState();
    }

    function describeTheme(themeName = state.themeName) {
      const theme = getThemeDefinition(themeName);
      if (!theme) {
        return null;
      }

      return {
        name: normalizeThemeName(themeName),
        label: theme.label || normalizeThemeName(themeName),
        description: theme.description || "",
      };
    }

    loadState();
    applyState();

    return {
      getState,
      getThemeDefinition,
      listThemes,
      describeTheme,
      setTheme,
      setEffectsEnabled,
      toggleEffects,
      reset,
      apply: applyState,
      getCurrentThemeName: () => state.themeName,
      isEffectsEnabled: () => state.effectsEnabled && !reducedMotion,
      isReducedMotion: () => reducedMotion,
      TerminalThemeError,
    };
  }

  return {
    DEFAULT_THEMES,
    TerminalThemeError,
    createTerminalThemeManager,
  };
});
