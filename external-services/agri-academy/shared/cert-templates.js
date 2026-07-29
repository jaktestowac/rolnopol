/**
 * Certificate templates — the ten predefined "looks" a certificate can have.
 * An exam picks one (`certTemplate`) at authoring time; the chosen template id
 * rides through to the certificate issuer at mint time and is stored on the
 * certificate. The verify endpoint embeds the full descriptor (`templateStyle`)
 * so the certificate page can render the styled document without a second lookup.
 *
 * Shared within the ecosystem (independent of Rolnopol): authoring validates
 * against it, the issuer stores + embeds it, and the authoring console fetches the
 * list (GET /v1/cert-templates) for its picker + live preview — one source of truth.
 *
 * Each descriptor is a plain style object consumed directly as inline CSS by the
 * client renderer: `bg` (page), `panel` (the document), `ink`/`sub` (text),
 * `accent` (title + rule + seal), `border`, `font`, and a `motif` glyph.
 */
const TEMPLATES = [
  {
    id: "classic-green",
    name: "Classic Green",
    bg: "radial-gradient(1000px 500px at 70% -10%, #1c3326 0%, #0f1a14 55%)",
    panel: "#16241b",
    ink: "#eaf3ec",
    sub: "#9bb3a4",
    accent: "#3fae6b",
    border: "#2f5b41",
    font: "Georgia, 'Times New Roman', serif",
    motif: "🌱",
  },
  {
    id: "gold-formal",
    name: "Gold Formal",
    bg: "#efe7d6",
    panel: "#fffdf8",
    ink: "#2b2620",
    sub: "#7a6f5c",
    accent: "#b8912e",
    border: "#cbb27a",
    font: "'Times New Roman', Georgia, serif",
    motif: "🏅",
  },
  {
    id: "midnight",
    name: "Midnight Blue",
    bg: "linear-gradient(180deg, #0b1226 0%, #060a16 100%)",
    panel: "#0e1630",
    ink: "#e8eeff",
    sub: "#93a0c8",
    accent: "#5aa0ff",
    border: "#2a3a6a",
    font: "'Segoe UI', system-ui, sans-serif",
    motif: "🌙",
  },
  {
    id: "royal-purple",
    name: "Royal Purple",
    bg: "radial-gradient(900px 480px at 50% -10%, #2c1a52 0%, #1a1030 60%)",
    panel: "#241542",
    ink: "#f0e9ff",
    sub: "#b6a6d8",
    accent: "#c39bff",
    border: "#4a3576",
    font: "Georgia, serif",
    motif: "👑",
  },
  {
    id: "rustic-kraft",
    name: "Rustic Kraft",
    bg: "#ddd0b3",
    panel: "#f1e8d4",
    ink: "#3b2f1e",
    sub: "#7c6a4d",
    accent: "#9a6b3a",
    border: "#b79a68",
    font: "'Courier New', ui-monospace, monospace",
    motif: "🌾",
  },
  {
    id: "modern-teal",
    name: "Modern Teal",
    bg: "#e8f3f2",
    panel: "#ffffff",
    ink: "#12302e",
    sub: "#5f7d7c",
    accent: "#0f9c8f",
    border: "#b6ddd8",
    font: "'Segoe UI', system-ui, sans-serif",
    motif: "✅",
  },
  {
    id: "crimson-seal",
    name: "Crimson Seal",
    bg: "#f3e7e7",
    panel: "#fffafa",
    ink: "#2a1414",
    sub: "#7c5a5a",
    accent: "#b23a3a",
    border: "#dcb0b0",
    font: "Georgia, serif",
    motif: "🔖",
  },
  {
    id: "slate-minimal",
    name: "Slate Minimal",
    bg: "#f1f3f6",
    panel: "#ffffff",
    ink: "#1f2733",
    sub: "#6b7688",
    accent: "#3f5875",
    border: "#dde1e8",
    font: "'Segoe UI', system-ui, sans-serif",
    motif: "▪",
  },
  {
    id: "sunrise",
    name: "Sunrise",
    bg: "linear-gradient(135deg, #ffd7a8 0%, #ff9a8b 100%)",
    panel: "#fff7f0",
    ink: "#3a2418",
    sub: "#8a6a56",
    accent: "#e8703a",
    border: "#f2c39a",
    font: "'Segoe UI', system-ui, sans-serif",
    motif: "🌅",
  },
  {
    id: "botanical",
    name: "Botanical",
    bg: "#eaf1e0",
    panel: "#fbfdf6",
    ink: "#24331a",
    sub: "#6a7d55",
    accent: "#5a8f3a",
    border: "#cfe0b8",
    font: "Georgia, serif",
    motif: "🍃",
  },
];

const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);
const DEFAULT_TEMPLATE = "classic-green";
const byId = new Map(TEMPLATES.map((t) => [t.id, t]));

function isValidTemplate(id) {
  return byId.has(id);
}

/** Resolve a template descriptor by id, falling back to the default. */
function getTemplate(id) {
  return byId.get(id) || byId.get(DEFAULT_TEMPLATE);
}

module.exports = { TEMPLATES, TEMPLATE_IDS, DEFAULT_TEMPLATE, isValidTemplate, getTemplate };
