class MockLlmConnector {
  constructor() {
    this.providerName = "mock";
  }

  _buildSummaryReply(context) {
    const summary = context?.summary || {};
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

    return `${this._buildSummaryReply(context)}\n\nThis is currently a mocked assistant response. The connector is modular and ready for Gemini/other LLM integration.`;
  }
}

module.exports = MockLlmConnector;
