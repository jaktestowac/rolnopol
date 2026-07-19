const { buildCoreIntentReply, getSummary } = require("../farm-replies");

/**
 * Playful persona "modes" (pirate, coach, detective, bard, oracle, zen) plus the
 * mode-help listing. Each persona wraps the grounded core farm reply so the
 * numbers stay real while the tone changes.
 */

function detectConversationMode(normalizedPrompt) {
  const modePatterns = [
    { mode: "pirate", patterns: ["pirate mode", "talk like a pirate", "yarrr", "ahoy"] },
    { mode: "coach", patterns: ["coach mode", "pep talk", "motivate me", "encourage me"] },
    { mode: "detective", patterns: ["detective mode", "investigate", "clue", "mystery"] },
    { mode: "bard", patterns: ["bard mode", "poem", "poet", "haiku"] },
    { mode: "oracle", patterns: ["oracle mode", "predict", "forecast", "prophecy"] },
    { mode: "zen", patterns: ["zen mode", "calm", "ground me", "breathe"] },
  ];
  for (const entry of modePatterns) {
    if (entry.patterns.some((pattern) => normalizedPrompt.includes(pattern))) {
      return entry.mode;
    }
  }
  return null;
}

function buildModeResponse(mode, normalizedPrompt, context) {
  const coreReply = buildCoreIntentReply(normalizedPrompt, context);
  const summary = getSummary(context);

  switch (mode) {
    case "pirate":
      return ["🏴‍☠️ Ahoy! Pirate mode active.", coreReply, "Fair winds, steady crops, and no sea monsters in the silo."].join("\n");
    case "coach":
      return ["💪 Coach mode active.", coreReply, "Next step: pick one field, one team task, or one herd metric and improve it today."].join("\n");
    case "detective":
      return [
        "🕵️ Detective mode active.",
        coreReply,
        `Clue board: ${summary.fieldsCount || 0} fields, ${summary.staffCount || 0} staff, ${summary.totalAnimals || 0} animals.`,
      ].join("\n");
    case "bard":
      return [
        "🎭 Bard mode active.",
        `On ${summary.fieldsCount || 0} fields the morning light now rests,`,
        `${summary.staffCount || 0} hands keep watch, and ${summary.totalAnimals || 0} hearts keep the rhythm blessed.`,
        `The pasture hums in patient rhyme; ask again, and I’ll sing more in time.`,
      ].join("\n");
    case "oracle":
      return [
        "🔮 Oracle mode active.",
        `I foresee ${summary.fieldsCount || 0} fields, ${summary.staffCount || 0} staff, and ${summary.totalAnimals || 0} animals moving in steady cycles.`,
        "The next wise question should focus on one bottleneck, one crop, or one cost center.",
      ].join("\n");
    case "zen":
      return [
        "🧘 Zen mode active.",
        `There are ${summary.fieldsCount || 0} fields, ${summary.staffCount || 0} staff members, and ${summary.totalAnimals || 0} animals in view.`,
        "No rush. Ask one calm question at a time, and we’ll keep the answer grounded.",
      ].join("\n");
    default:
      return coreReply;
  }
}

function buildModeHelpReply() {
  return [
    "✨ Mock chat modes you can try:",
    '- "pirate mode" for a salty farm briefing',
    '- "coach mode" for an encouraging next step',
    '- "detective mode" for a clue-by-clue readout',
    '- "bard mode" for a tiny farm poem',
    '- "oracle mode" for a mystical forecast',
    '- "zen mode" for a calmer, slower reply',
  ].join("\n");
}

function shouldShowModeHelp(normalizedPrompt) {
  return /\b(mode|modes|style|styles|persona|tone|tones)\b/.test(normalizedPrompt);
}

module.exports = {
  id: "personas",
  match(normalizedPrompt) {
    return detectConversationMode(normalizedPrompt) !== null || shouldShowModeHelp(normalizedPrompt);
  },
  respond({ normalizedPrompt, context }) {
    const mode = detectConversationMode(normalizedPrompt);
    if (mode) {
      return buildModeResponse(mode, normalizedPrompt, context);
    }
    return buildModeHelpReply();
  },
};
