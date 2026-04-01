const GeminiProvider = require("../providers/gemini.provider");

class GeminiLlmConnector {
  constructor(provider = new GeminiProvider()) {
    this.providerName = "gemini";
    this.provider = provider;
    this.provider.ensureConfigured();
  }

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

module.exports = GeminiLlmConnector;
