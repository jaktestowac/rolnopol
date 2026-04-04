const BaseProvider = require("./base.provider");
const { getToolsForGemini } = require("../tools/tools-registry");

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

  _extractToolCalls(data) {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      return null;
    }

    const toolCalls = [];
    for (const part of parts) {
      if (part.functionCall) {
        toolCalls.push({
          name: part.functionCall.name,
          arguments: this._parseToolArguments(part.functionCall.args),
        });
      }
    }

    return toolCalls.length > 0 ? toolCalls : null;
  }

  async askText(prompt, options = {}) {
    const useTools = options.useTools !== false; // Enable tools by default
    const messages = options.messages; // Support full conversation history

    const data = await this._callApiWithRetry(
      () => {
        // If messages provided, build contents from conversation; otherwise use single prompt
        const contents = messages
          ? messages.map((msg) => ({
              role: msg.role || "user",
              parts: [{ text: msg.content }],
            }))
          : prompt
            ? [{ parts: [{ text: prompt }] }]
            : [];

        const payload = {
          contents: contents,
          generationConfig: options.generationConfig,
          systemInstruction: options.systemInstruction,
        };

        // Add tools if supported and enabled
        if (useTools) {
          Object.assign(payload, getToolsForGemini());
        }

        return payload;
      },
      (data) => this._extractCandidateText(data),
    );

    const text = this._extractCandidateText(data);
    const toolCalls = this._extractToolCalls(data);

    return {
      text: text || "No text returned by model.",
      toolCalls: toolCalls || null,
      raw: data,
      usage: data?.usageMetadata,
    };
  }
}

module.exports = GeminiProvider;
