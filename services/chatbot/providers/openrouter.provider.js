const BaseProvider = require("./base.provider");
const { getToolsForOpenRouter } = require("../tools/tools-registry");
const { logWarning, logInfo } = require("../../../helpers/logger-api");

const DEFAULT_OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "google/gemma-4-26b-a4b-it:free";

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

    if (typeof this.model === "string" && !this.model.endsWith(":free")) {
      logWarning(`🟥 OpenRouter model '${this.model}' is not a free model. Handle with care.`);
    } 
  }

  _buildUrl() {
    return `${this.apiBaseUrl}/chat/completions`;
  }

  _buildKeyInfoUrl() {
    return `${this.apiBaseUrl}/key`;
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

  _extractToolCalls(data) {
    const message = data?.choices?.[0]?.message;
    if (!message || !message.tool_calls) {
      return null;
    }

    const toolCalls = message.tool_calls.map((tc) => ({
      name: tc.function.name,
      arguments: this._parseToolArguments(tc.function.arguments),
    }));

    return toolCalls.length > 0 ? toolCalls : null;
  }

  async askText(userMessage, options = {}) {
    const systemInstruction = options?.systemInstruction?.parts?.[0]?.text || "";
    const generationConfig = options?.generationConfig || {};
    const useTools = options.useTools !== false; // Enable tools by default
    const messages = options.messages; // Support full conversation history

    const data = await this._callApiWithRetry(
      () => {
        // If messages provided, use full conversation; otherwise build from single message
        const msgArray = messages
          ? messages.map((msg) => ({
              role: msg.role,
              content: msg.content,
            }))
          : userMessage
            ? [
                {
                  role: "user",
                  content: userMessage,
                },
              ]
            : [];

        const payload = {
          model: this.model,
          messages: [
            {
              role: "system",
              content: systemInstruction,
            },
            ...msgArray,
          ],
          temperature: generationConfig?.temperature ?? 0.7,
          max_tokens: generationConfig?.maxOutputTokens ?? 2048,
        };

        // Add tools if supported and enabled
        if (useTools) {
          payload.tools = getToolsForOpenRouter();
        }

        return payload;
      },
      (data) => this._extractText(data),
    );

    const text = this._extractText(data);
    const toolCalls = this._extractToolCalls(data);

    return {
      text: text || "No response from model.",
      toolCalls: toolCalls || null,
      raw: data,
      usage: data?.usage ?? null,
    };
  }

  /**
   * Native token streaming via the OpenAI-compatible `stream: true` flag. Each
   * SSE frame is a chat-completion chunk whose `choices[0].delta.content` holds
   * the incremental text; the stream terminates with a `[DONE]` sentinel. Tools
   * are not used on the streaming path.
   */
  async *streamText(userMessage, options = {}) {
    this.ensureConfigured();
    const systemInstruction = options?.systemInstruction?.parts?.[0]?.text || "";
    const generationConfig = options?.generationConfig || {};
    const messages = options.messages;

    const msgArray = messages
      ? messages.map((msg) => ({ role: msg.role, content: msg.content }))
      : userMessage
        ? [{ role: "user", content: userMessage }]
        : [];

    const payload = {
      model: this.model,
      messages: [{ role: "system", content: systemInstruction }, ...msgArray],
      temperature: generationConfig?.temperature ?? 0.7,
      max_tokens: generationConfig?.maxOutputTokens ?? 2048,
      stream: true,
    };

    const { response, clearTimer } = await this._openStream(this._buildUrl(), payload, { signal: options.signal });

    if (!response.ok) {
      clearTimer();
      let message = `${this.providerName} stream request failed (${response.status})`;
      try {
        const data = await response.json();
        message = data?.error?.message || message;
      } catch (error) {
        // Non-JSON error body; keep the generic message.
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    clearTimer();

    let fullText = "";
    let usage = null;

    for await (const payloadLine of this._iterateSseData(response)) {
      if (payloadLine === "[DONE]") {
        break;
      }

      let parsed;
      try {
        parsed = JSON.parse(payloadLine);
      } catch (error) {
        continue;
      }

      if (parsed?.usage) {
        usage = parsed.usage;
      }

      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        fullText += delta;
        yield { type: "token", delta };
      }
    }

    yield { type: "done", text: fullText || "No response from model.", usage };
  }

  async getRateLimits() {
    const raw = await this._callJsonEndpointWithRetry({
      url: this._buildKeyInfoUrl(),
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "http://localhost",
        "X-Title": "Rolnopol Farm Assistant",
      },
      requireModel: false,
    });

    return {
      provider: this.providerName,
      supported: true,
      raw,
    };
  }
}

module.exports = OpenRouterProvider;
