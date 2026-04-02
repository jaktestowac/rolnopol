/**
 * BaseConnector - Abstract parent class for LLM connectors
 * Handles common prompt building and generation logic
 */
class BaseLlmConnector {
  constructor(provider, providerName) {
    this.providerName = providerName;
    this.provider = provider;
    this.provider.ensureConfigured();
  }

  /**
   * Build system instruction for the LLM
   * Can be overridden for custom system prompts
   */
  _buildSystemInstruction() {
    return {
      parts: [
        {
          text: [
            "You are Porky, Rolnopol's farm assistant.",
            "Answer clearly, briefly, and using only facts from the provided context when possible.",
            "If data is missing, say so directly and suggest what the user can ask next.",
          ].join(" "),
        },
      ],
    };
  }

  /**
   * Build prompt with context - can be overridden for custom formatting
   */
  _buildPrompt(prompt, context) {
    return [
      "User question:",
      prompt,
      "",
      "User farm context (JSON):",
      JSON.stringify(context || {}, null, 2),
      "",
      "Rules:",
      "- Keep response concise and practical.",
      "- Do not invent resources that are not present in context.",
      "- Respond in the language used by the user if possible.",
    ].join("\n");
  }

  /**
   * Generate response from LLM
   * Uses provider's askText method and returns formatted response
   */
  async generateResponse({ prompt, context }) {
    const answer = await this.provider.askText(this._buildPrompt(prompt, context), {
      systemInstruction: this._buildSystemInstruction(),
      generationConfig: {
        temperature: 0.5,
      },
    });

    return answer?.text || "No text returned by model.";
  }
}

module.exports = BaseLlmConnector;
