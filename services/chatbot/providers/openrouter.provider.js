const BaseProvider = require("./base.provider");

const DEFAULT_OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4-turbo";

class OpenRouterProvider extends BaseProvider {
  constructor(options = {}) {
    super(options, {
      name: "openrouter",
      envKeyPrefix: "OPENROUTER",
      defaultModel: DEFAULT_OPENROUTER_MODEL,
      defaultApiBaseUrl: DEFAULT_OPENROUTER_API_BASE_URL,
      defaultTimeoutMs: 30_000,
      defaultRetries: 2,
    });
  }

  _buildUrl() {
    return `${this.apiBaseUrl}/chat/completions`;
  }

  _buildHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "HTTP-Referer": "http://localhost", // OpenRouter recommended
      "X-Title": "Rolnopol Farm Assistant",
    };
  }

  _extractText(data) {
    const message = data?.choices?.[0]?.message;
    if (!message || typeof message.content !== "string") {
      return "";
    }

    return message.content.trim();
  }

  async askText(userMessage, options = {}) {
    const systemInstruction = options?.systemInstruction?.parts?.[0]?.text || "";
    const generationConfig = options?.generationConfig || {};

    const data = await this._callApiWithRetry(
      () => ({
        model: this.model,
        messages: [
          {
            role: "system",
            content: systemInstruction,
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        temperature: generationConfig?.temperature ?? 0.7,
        max_tokens: generationConfig?.maxOutputTokens ?? 2048,
      }),
      (data) => this._extractText(data),
    );

    const text = this._extractText(data);

    return {
      text: text || "No response from model.",
    };
  }
}

module.exports = OpenRouterProvider;
