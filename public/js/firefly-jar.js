const JAR = document.getElementById("jar");
const FETCH_INTERVAL = 8000; // ms
const WINDOW_SEC = 60; // look‑back window for the count endpoint
// Mocked base number of fireflies to ensure the jar is never empty
const MOCK_BASE_COUNT = 15;
// Cap fireflies per resource to avoid DOM overload
const MAX_FIREFLIES_PER_RESOURCE = 50;

/**
 * Toggle for icon mode vs simple dots.
 * When true (default) resources with an icon show glowing FA icons.
 * When false all fireflies render as simple colored circles.
 *
 * Usage in browser console:
 *   toggleIcons()                 — flip the current mode (global shortcut)
 *   fireflyJar.toggleIcons()       — flip the current mode
 *   fireflyJar.icons(true)         — enable icons
 *   fireflyJar.icons(false)        — force simple dots
 *   fireflyJar.icons()             — get current state
 */
window.fireflyJar = {
  _iconsEnabled: true,
  icons(enabled) {
    if (enabled === undefined) return this._iconsEnabled;
    this._iconsEnabled = !!enabled;
    console.log(`Firefly Jar: icons ${this._iconsEnabled ? "enabled" : "disabled"}`);
    rerender();
    return this._iconsEnabled;
  },
  toggleIcons() {
    return this.icons(!this._iconsEnabled);
  },
  toggle() {
    return this.toggleIcons();
  },
  ti() {
    return this.toggleIcons();
  },
};

/** Global shortcut so you can type toggleIcons() directly in the console */
window.toggleIcons = function () {
  return window.fireflyJar.toggleIcons();
};

/**
 * Fetch aggregated resource counts from the unified jar-counts endpoint.
 * Returns an array of { id, count, color, label } or empty array on error.
 */
async function fetchJarCounts() {
  try {
    const resp = await fetch(`/api/v1/operator/jar-counts?windowSec=${WINDOW_SEC}`);
    const data = await resp.json();
    if (data && data.data && Array.isArray(data.data.resources)) {
      return data.data.resources;
    }
  } catch (e) {
    // ignore errors – fallback to mock
  }
  return [];
}

/**
 * Glow color map per color key — used for icon glow and background circle.
 */
const GLOW_COLORS = {
  red: { bg: "rgba(245, 67, 67, 0.8)", glow: "rgba(255, 121, 117, 0.9)" },
  blue: { bg: "rgba(100, 149, 237, 0.8)", glow: "rgba(135, 206, 250, 0.9)" },
  green: { bg: "rgba(100, 237, 149, 0.8)", glow: "rgba(144, 238, 144, 0.9)" },
  orange: { bg: "rgba(238, 156, 56, 0.8)", glow: "rgba(255, 165, 0, 0.9)" },
  purple: { bg: "rgba(178, 100, 237, 0.8)", glow: "rgba(186, 85, 211, 0.9)" },
  white: { bg: "rgba(230, 230, 255, 0.9)", glow: "rgba(255, 255, 255, 0.95)" },
  cyan: { bg: "rgba(100, 237, 237, 0.8)", glow: "rgba(0, 255, 255, 0.9)" },
  pink: { bg: "rgba(237, 100, 178, 0.8)", glow: "rgba(255, 105, 180, 0.9)" },
  gold: { bg: "rgba(237, 200, 70, 0.9)", glow: "rgba(255, 215, 0, 0.95)" },
  crimson: { bg: "rgba(220, 20, 60, 0.85)", glow: "rgba(220, 20, 60, 0.95)" },
  yellow: { bg: "rgba(255, 255, 150, 0.8)", glow: "rgba(255, 255, 200, 0.9)" },
  amber: { bg: "rgba(255, 220, 120, 0.8)", glow: "rgba(255, 230, 160, 0.9)" },
};

/**
 * Create a single firefly DOM element.
 *
 * When an icon is provided (and icons are enabled via fireflyJar.icons())
 * the firefly is a glowing Font Awesome icon (no circle background).
 * Without an icon, or when icons are disabled, a colored-circle firefly is rendered.
 *
 * @param {Object} options
 * @param {string} options.color   - Firefly color key (yellow, red, blue, etc.)
 * @param {string} [options.icon]  - Font Awesome icon class (e.g. "fa-bell")
 * @param {string} [options.label] - Resource label for the tooltip
 */
function createFirefly(options = { color: "yellow" }) {
  const colorKey = options.color || "yellow";
  const colors = GLOW_COLORS[colorKey] || GLOW_COLORS.yellow;
  const useIcon = options.icon && window.fireflyJar._iconsEnabled;

  // --- Icon firefly: glowing FA icon, no circle ---
  if (useIcon) {
    const el = document.createElement("div");
    el.className = "firefly firefly-icon";
    el.setAttribute("data-color", colorKey);

    // random start position
    el.style.left = Math.random() * 100 + "vw";
    el.style.top = Math.random() * 100 + "vh";

    // random drift
    const dx = (Math.random() - 0.5) * 200;
    const dy = (Math.random() - 0.5) * 200;
    el.style.setProperty("--dx", `${dx}px`);
    el.style.setProperty("--dy", `${dy}px`);

    // random animation duration
    const duration = Math.random() * 7 + 5;
    el.style.setProperty("--duration", `${duration}s`);

    // random icon size between 10px and 18px
    const iconSize = Math.random() * 8 + 10;
    el.style.setProperty("--icon-size", `${iconSize}px`);

    // glow color
    el.style.setProperty("--glow-color", colors.glow);

    // Create the FA icon
    const iconEl = document.createElement("i");
    iconEl.className = `fa-solid ${options.icon}`;
    el.appendChild(iconEl);

    // Tooltip
    if (options.label) {
      el.title = options.label;
    }

    JAR.appendChild(el);
    return;
  }

  // --- Classic circle firefly (no icon) ---
  const el = document.createElement("div");
  el.className = "firefly";
  el.setAttribute("data-color", colorKey);

  // random start position
  el.style.left = Math.random() * 100 + "vw";
  el.style.top = Math.random() * 100 + "vh";

  // random drift
  const dx = (Math.random() - 0.5) * 200;
  const dy = (Math.random() - 0.5) * 200;
  el.style.setProperty("--dx", `${dx}px`);
  el.style.setProperty("--dy", `${dy}px`);

  // random size between 6px and 12px
  const size = Math.random() * 6 + 6;
  el.style.setProperty("--size", `${size}px`);

  // random animation duration
  const duration = Math.random() * 7 + 5;
  el.style.setProperty("--duration", `${duration}s`);

  el.style.background = colors.bg;
  el.style.boxShadow = `0 0 12px ${colors.glow}`;
  el.style.setProperty("--hue", `${Math.random() * 40 - 20}deg`);

  if (options.label) {
    el.title = options.label;
  }

  JAR.appendChild(el);
}

/**
 * Synchronize firefly elements for each color group.
 * `data` is an array of objects: { count, options: { color } }.
 * Existing fireflies are left untouched; new ones are added, excess ones removed.
 */
function syncFireflies(data) {
  // Build a map of current counts per color
  const currentCounts = {};
  for (const d of data) {
    const color = d.options && d.options.color ? d.options.color : "yellow";
    currentCounts[color] = 0;
  }

  for (const child of JAR.children) {
    const color = child.getAttribute("data-color") || "yellow";
    if (color in currentCounts) currentCounts[color]++;
  }

  // Process each requested group
  for (const { count, options } of data) {
    const color = options && options.color ? options.color : "yellow";
    const current = currentCounts[color] || 0;
    if (current < count) {
      for (let i = 0; i < count - current; i++) {
        createFirefly(options);
      }
    } else if (current > count) {
      let removed = 0;
      for (let i = JAR.children.length - 1; i >= 0 && removed < current - count; i--) {
        const child = JAR.children[i];
        if ((child.getAttribute("data-color") || "yellow") === color) {
          child.remove();
          removed++;
        }
      }
    }
    currentCounts[color] = count;
  }
}

/**
 * Main render loop: fetch counts from backend, cap per-resource maximums,
 * add ambient base fireflies, and sync the DOM.
 */
async function render() {
  const resources = await fetchJarCounts();

  // Build sync data from API response, capping each resource at a reasonable max
  const syncData = resources
    .filter((r) => r.count > 0)
    .map((r) => ({
      count: Math.min(r.count, MAX_FIREFLIES_PER_RESOURCE),
      options: {
        color: r.color || "yellow",
        icon: r.icon || null,
        label: r.label || null,
      },
    }));

  // Always add a base of ambient amber fireflies so the jar is never empty
  // Uses "amber" (not "yellow") to avoid collision with API resources that may also be yellow
  syncData.unshift({
    count: MOCK_BASE_COUNT,
    options: { color: "amber", icon: "fa-kiwi-bird" },
  });

  syncFireflies(syncData);
}

/**
 * Clear all fireflies from the jar and re-render immediately.
 * Used by the icon toggle to switch between icon and dot modes.
 */
function rerender() {
  JAR.innerHTML = "";
  render();
}

render();
setInterval(render, FETCH_INTERVAL);
