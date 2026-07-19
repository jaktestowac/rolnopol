/**
 * Hidden prompts and secret responses. Highest priority so they always win.
 * Output is intentionally fixed (no random variation) — these are discoverable
 * "codes" whose replies people rely on.
 */

function buildSecretHelpReply() {
  return [
    "🕵️ Secret mode unlocked. Try one of these hidden prompts:",
    '- "follow-the-red-rain"',
    '- "rolnikorzepole"',
    '- "tractor7"',
    '- "kraken"',
    '- "night owl"',
  ].join("\n");
}

function resolveEasterEgg(normalizedPrompt, context) {
  if (normalizedPrompt.includes("secret") || normalizedPrompt.includes("easter")) {
    return buildSecretHelpReply();
  }
  if (normalizedPrompt.includes("follow-the-red-rain")) {
    return `🌧️ Red rain protocol acknowledged. Current asset checksum: fields=${context?.summary?.fieldsCount || 0}, staff=${context?.summary?.staffCount || 0}, animals=${context?.summary?.totalAnimals || 0}.`;
  }
  if (normalizedPrompt.includes("rolnikorzepole")) {
    return "🚪 You found the rolnikorzepole breadcrumb. Rumor says repeated wrong turns open a custom 404 dimension.";
  }
  if (normalizedPrompt.includes("tractor7") || normalizedPrompt.includes("tractor 7")) {
    return "🚜 Seven tractor taps detected. Backend hatch remains protected, but your curiosity score just increased.";
  }
  if (normalizedPrompt.includes("kraken")) {
    return "🐙 Kraken whisper received. Admin vault exists beyond this mock realm — access remains strictly token-gated.";
  }
  if (normalizedPrompt.includes("night owl") || normalizedPrompt.includes("night shift")) {
    return "🌙 Night owl bonus: dreams grow best before sunrise. Your farm data is still safely user-scoped.";
  }
  return null;
}

module.exports = {
  id: "easter-eggs",
  match(normalizedPrompt, context) {
    return resolveEasterEgg(normalizedPrompt, context) !== null;
  },
  respond({ normalizedPrompt, context }) {
    return resolveEasterEgg(normalizedPrompt, context);
  },
};
