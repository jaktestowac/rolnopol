class MockLlmConnector {
  constructor() {
    this.providerName = "mock";
  }

  async getRateLimits() {
    return {
      provider: this.providerName,
      supported: false,
      raw: {
        provider: this.providerName,
        supported: false,
        message: "Rate limits are mocked for the mock provider.",
      },
    };
  }

  _getSummary(context) {
    return context?.summary || {};
  }

  _buildSummaryReply(context) {
    const summary = this._getSummary(context);
    return [
      "Here is a quick summary of your farm data:",
      `- Fields: ${summary.fieldsCount || 0}`,
      `- Total field area: ${summary.totalFieldAreaHa || 0} ha`,
      `- Staff members: ${summary.staffCount || 0}`,
      `- Animal records: ${summary.animalRecordsCount || 0}`,
      `- Total animals: ${summary.totalAnimals || 0}`,
    ].join("\n");
  }

  _buildFieldsReply(context) {
    const fields = context?.samples?.fields || [];
    if (!fields.length) {
      return "I could not find any fields assigned to your account yet.";
    }

    const list = fields.map((field) => `${field.name || "Unnamed field"} (${field.area || 0} ha)`).join(", ");
    return `Your fields: ${list}. Ask me for a full summary anytime.`;
  }

  _buildStaffReply(context) {
    const staff = context?.samples?.staff || [];
    if (!staff.length) {
      return "I could not find any staff assigned to your account yet.";
    }

    const list = staff
      .map((member) => {
        const fullName = [member.name, member.surname].filter(Boolean).join(" ") || "Unnamed worker";
        return `${fullName}${member.position ? ` (${member.position})` : ""}`;
      })
      .join(", ");

    return `Your staff: ${list}.`;
  }

  _buildAnimalsReply(context) {
    const animals = context?.samples?.animals || [];
    if (!animals.length) {
      return "I could not find any animals assigned to your account yet.";
    }

    const list = animals.map((animal) => `${animal.type || "unknown"}: ${animal.amount || 0}`).join(", ");
    return `Your animals: ${list}.`;
  }

  _buildModeHelpReply() {
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

  _buildSecretHelpReply() {
    return [
      "🕵️ Secret mode unlocked. Try one of these hidden prompts:",
      '- "follow-the-red-rain"',
      '- "rolnikorzepole"',
      '- "tractor7"',
      '- "kraken"',
      '- "night owl"',
    ].join("\n");
  }

  _detectConversationMode(normalizedPrompt) {
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

  _buildCoreIntentReply(normalizedPrompt, context) {
    if (normalizedPrompt.includes("summary") || normalizedPrompt.includes("podsum")) {
      return this._buildSummaryReply(context);
    }

    if (normalizedPrompt.includes("field") || normalizedPrompt.includes("pole")) {
      return this._buildFieldsReply(context);
    }

    if (normalizedPrompt.includes("staff") || normalizedPrompt.includes("pracownik")) {
      return this._buildStaffReply(context);
    }

    if (normalizedPrompt.includes("animal") || normalizedPrompt.includes("zwierz")) {
      return this._buildAnimalsReply(context);
    }

    return `${this._buildSummaryReply(context)}\n\nThis is currently a mocked assistant response. Try pirate mode, coach mode, detective mode, bard mode, oracle mode, or zen mode for a more playful persona.`;
  }

  _buildModeResponse(mode, normalizedPrompt, context) {
    const coreReply = this._buildCoreIntentReply(normalizedPrompt, context);
    const summary = this._getSummary(context);

    switch (mode) {
      case "pirate":
        return ["🏴‍☠️ Ahoy! Pirate mode active.", coreReply, "Fair winds, steady crops, and no sea monsters in the silo."].join("\n");
      case "coach":
        return [
          "💪 Coach mode active.",
          coreReply,
          "Next step: pick one field, one team task, or one herd metric and improve it today.",
        ].join("\n");
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

  _shouldShowModeHelp(normalizedPrompt) {
    return /\b(mode|modes|style|styles|persona|tone|tones)\b/.test(normalizedPrompt);
  }

  _getEasterEggResponse(normalizedPrompt, context) {
    if (normalizedPrompt.includes("secret") || normalizedPrompt.includes("easter")) {
      return this._buildSecretHelpReply();
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

  async generateResponse({ prompt, context }) {
    const normalizedPrompt = String(prompt || "").toLowerCase();

    const easterEggReply = this._getEasterEggResponse(normalizedPrompt, context);
    if (easterEggReply) {
      return easterEggReply;
    }

    const conversationMode = this._detectConversationMode(normalizedPrompt);
    if (conversationMode) {
      return this._buildModeResponse(conversationMode, normalizedPrompt, context);
    }

    if (this._shouldShowModeHelp(normalizedPrompt)) {
      return this._buildModeHelpReply();
    }

    return this._buildCoreIntentReply(normalizedPrompt, context);
  }
}

module.exports = MockLlmConnector;
