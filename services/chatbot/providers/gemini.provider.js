const BaseProvider = require("./base.provider");

const DEFAULT_GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

class GeminiProvider extends BaseProvider {
  constructor(options = {}) {
    super(options, {
      name: "gemini",
      envKeyPrefix: "GEMINI",
      defaultModel: DEFAULT_GEMINI_MODEL,
      defaultApiBaseUrl: DEFAULT_GEMINI_API_BASE_URL,
      defaultTimeoutMs: 30_000,
      defaultRetries: 2,
    });
  }

  _buildUrl(action = "generateContent") {
    return `${this.apiBaseUrl}/models/${encodeURIComponent(this.model)}:${action}`;
  }

  _buildHeaders() {
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": this.apiKey,
    };
  }

  _extractCandidateText(data) {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      return "";
    }

    return parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
  }

  _extractText(data) {
    return this._extractCandidateText(data);
  }

  async askText(prompt, options = {}) {
    const data = await this._callApiWithRetry(
      () => ({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: options.generationConfig,
        systemInstruction: options.systemInstruction,
      }),
      (data) => this._extractCandidateText(data),
    );

    const text = this._extractCandidateText(data);

    return {
      text: text || "No text returned by model.",
      raw: data,
      usage: data?.usageMetadata,
    };
  }
}

module.exports = GeminiProvider;
