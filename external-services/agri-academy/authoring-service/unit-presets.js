/**
 * Certification-unit branding presets — the predefined icon set (Font Awesome
 * solid keys) and colour palette a unit may pick from, plus validation/normalisation
 * for the branding fields (`tags`, `color`, `icon`). Single source of truth: the
 * authoring service validates against it and exposes it (GET /v1/unit-presets) so
 * the console renders the same picker — no client/server drift.
 *
 * `icon` is stored as the bare Font Awesome suffix (e.g. "tractor"); the UI renders
 * it as `fa-solid fa-<icon>`. `color` is any 6-digit hex; the palette is a set of
 * quick-pick suggestions. Icons are RESTRICTED to this list (predefined only).
 */
const ICON_KEYS = [
  "graduation-cap",
  "tractor",
  "wheat-awn",
  "seedling",
  "leaf",
  "cow",
  "apple-whole",
  "carrot",
  "flask",
  "shield-halved",
  "book-open",
  "award",
  "spray-can",
  "tree",
  "fish",
  "egg",
  "hand-holding-droplet",
  "wind",
  "sun-plant-wilt",
  "mound",
];

const PALETTE = ["#3fae6b", "#2e8f55", "#7bd4a0", "#d9a441", "#c9743a", "#4a90d9", "#8b5cf6", "#e05a5a"];

const DEFAULT_ICON = "graduation-cap";
const DEFAULT_COLOR = "#3fae6b";

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_TAGS = 8;
const MAX_TAG_LEN = 24;

function normalizeTags(raw) {
  if (!Array.isArray(raw)) return { error: "tags must be an array of strings" };
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    const s = String(t == null ? "" : t)
      .trim()
      .slice(0, MAX_TAG_LEN);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_TAGS) break;
  }
  return { value: out };
}

/**
 * Validate + normalise whichever branding fields are present on `body`.
 * @returns {{ value: { tags?, color?, icon? } } | { error: string }}
 *   — only the provided fields are returned, so it composes with a partial PATCH.
 */
function sanitizeBranding(body) {
  const b = body || {};
  const out = {};
  if (b.tags !== undefined) {
    const t = normalizeTags(b.tags);
    if (t.error) return { error: t.error };
    out.tags = t.value;
  }
  if (b.color !== undefined) {
    const c = String(b.color || "").trim();
    if (!HEX.test(c)) return { error: "color must be a hex value like #3fae6b" };
    out.color = c.toLowerCase();
  }
  if (b.icon !== undefined) {
    const i = String(b.icon || "")
      .trim()
      .replace(/^fa-(solid|regular|light|brands)\s+/, "")
      .replace(/^fa-/, "");
    if (!ICON_KEYS.includes(i)) return { error: "icon must be one of the predefined icons" };
    out.icon = i;
  }
  return { value: out };
}

module.exports = { ICON_KEYS, PALETTE, DEFAULT_ICON, DEFAULT_COLOR, sanitizeBranding };
