const mockEngine = require("../mock");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * MockLlmConnector — the offline/default provider (used when
 * CHATBOT_LLM_PROVIDER is "mock" or unset). It delegates to the modular mock
 * engine (services/chatbot/mock), which resolves the prompt to an intent and
 * can call real tools (weather, alerts, farm context, …) so replies are
 * believable and data-backed. Replies also vary between calls.
 *
 * The connector keeps the same interface as the real connectors:
 *   - generateResponse(...)        → Promise<string>
 *   - generateResponseStream(...)  → async iterator of { type: "token"|"done", ... }
 *   - getRateLimits()
 */
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

  async generateResponse({ prompt, context, userId } = {}) {
    const { text } = await mockEngine.respond({ prompt, context, userId });
    return text;
  }

  /**
   * Stream the mocked reply as synthetic tokens. The full reply (which may run
   * tools) is resolved first — the client's "thinking" indicator covers that —
   * then it's chopped into whitespace-preserving chunks and paced for a
   * believable typewriter effect. A client disconnect (signal) stops the stream.
   */
  async *generateResponseStream({ prompt, context, userId, signal } = {}) {
    const { text } = await mockEngine.respond({ prompt, context, userId });
    const reply = String(text || "");

    // Split into words while keeping trailing whitespace so the reassembled
    // text is byte-identical to `reply`.
    const chunks = reply.match(/\S+\s*|\s+/g) || [];
    const perChunkDelayMs = chunks.length > 0 ? Math.min(28, Math.floor(1600 / chunks.length)) : 0;

    let streamed = "";
    for (const chunk of chunks) {
      if (signal && signal.aborted) {
        break;
      }
      streamed += chunk;
      yield { type: "token", delta: chunk };
      if (perChunkDelayMs > 0) {
        await sleep(perChunkDelayMs);
      }
    }

    yield { type: "done", text: streamed || reply, usage: null };
  }
}

module.exports = MockLlmConnector;
