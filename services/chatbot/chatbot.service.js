const { sanitizeString } = require("../../helpers/validators");
const { logInfo, logWarning, logTrace } = require("../../helpers/logger-api");
const MockLlmConnector = require("./connectors/mock-llm.connector");
const GeminiLlmConnector = require("./connectors/gemini-llm.connector");
const OpenRouterLlmConnector = require("./connectors/openrouter-llm.connector");
const chatbotContextService = require("./chatbot-context.service");
const docsService = require("../docs.service");

const MAX_PROMPT_LENGTH = 1024;
const MIN_PROMPT_LENGTH = 6; // Skip context loading for very short messages
const CONTEXT_WARNING_THRESHOLD = 2048; // warn only when context is unusually large for normal farm data

class ChatbotService {
  constructor({ prometheusMetrics = null } = {}) {
    this.metrics = prometheusMetrics;
    this.connector = this._resolveConnector();
    logInfo(`Chatbot initialized with '${this.connector.providerName}' provider.`);
  }

  _resolveConnector() {
    const provider = String(process.env.CHATBOT_LLM_PROVIDER || "mock")
      .trim()
      .toLowerCase();

    if (provider === "gemini") {
      const hasGeminiApiKey = Boolean(process.env.GEMINI_API_KEY && String(process.env.GEMINI_API_KEY).trim());
      const hasGeminiModel = Boolean(process.env.GEMINI_MODEL && String(process.env.GEMINI_MODEL).trim());

      if (!hasGeminiApiKey || !hasGeminiModel) {
        const missing = [!hasGeminiApiKey ? "GEMINI_API_KEY" : null, !hasGeminiModel ? "GEMINI_MODEL" : null].filter(Boolean).join(", ");
        logWarning(`LLM provider 'gemini' is configured but missing: ${missing}. Falling back to mock connector.`);
        return new MockLlmConnector();
      }

      try {
        return new GeminiLlmConnector(undefined, undefined, this.metrics);
      } catch (error) {
        logWarning("Gemini connector could not be initialized. Falling back to mock connector.", error);
        return new MockLlmConnector(undefined, undefined, this.metrics);
      }
    }

    if (provider === "openrouter") {
      const hasOpenRouterApiKey = Boolean(process.env.OPENROUTER_API_KEY && String(process.env.OPENROUTER_API_KEY).trim());
      const hasOpenRouterModel = Boolean(process.env.OPENROUTER_MODEL && String(process.env.OPENROUTER_MODEL).trim());

      if (!hasOpenRouterApiKey || !hasOpenRouterModel) {
        const missing = [!hasOpenRouterApiKey ? "OPENROUTER_API_KEY" : null, !hasOpenRouterModel ? "OPENROUTER_MODEL" : null]
          .filter(Boolean)
          .join(", ");
        logWarning(`LLM provider 'openrouter' is configured but missing: ${missing}. Falling back to mock connector.`);
        return new MockLlmConnector();
      }

      try {
        return new OpenRouterLlmConnector(undefined, undefined, this.metrics);
      } catch (error) {
        logWarning("OpenRouter connector could not be initialized. Falling back to mock connector.", error);
        return new MockLlmConnector(undefined, undefined, this.metrics);
      }
    }

    if (provider !== "mock") {
      logWarning(`Unsupported LLM provider '${provider}'. Falling back to mock connector.`);
    }

    return new MockLlmConnector(undefined, undefined, this.metrics);
  }

  _sanitizePrompt(prompt) {
    const normalized = sanitizeString(typeof prompt === "string" ? prompt : "");

    if (!normalized) {
      throw new Error("Validation failed: message is required");
    }

    if (normalized.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Validation failed: message exceeds ${MAX_PROMPT_LENGTH} characters`);
    }

    return normalized;
  }

  _compactContext(context) {
    // Minify context by converting to JSON and back (removes extra whitespace)
    // This reduces the size sent to the LLM while preserving all data
    return JSON.parse(JSON.stringify(context));
  }

  _isShortMessage(prompt) {
    // Return true if message is very brief (likely just a greeting or acknowledgment)
    return prompt.trim().length < MIN_PROMPT_LENGTH;
  }

  _buildMinimalReply() {
    // Hardcoded response for very short messages (no context loading needed)
    return "Ask me about your fields, staff, animals, or financial summary. I'm here to help with your farm data.";
  }

  _estimateTokens(text) {
    // Consistent with connector token estimator: ~4 chars per token
    return Math.ceil((String(text || "").length || 0) / 4);
  }

  async _answerDocsQuery(query) {
    const text = query.replace(/^\/docs\s*/i, "").trim();
    if (!text) {
      return {
        provider: this.connector.providerName,
        reply: "Usage: /docs <question>. Example: /docs system overview, /docs how to use marketplace, /docs user roles",
        contextSummary: null,
      };
    }

    try {
      const result = await docsService.search(text, 3);
      return {
        provider: this.connector.providerName,
        reply: result.answer,
        contextSummary: "docs-search",
      };
    } catch (err) {
      return {
        provider: this.connector.providerName,
        reply: `Sorry, I couldn't search docs: ${err.message}`,
        contextSummary: "docs-search-error",
      };
    }
  }

  async ask({ userId, message }) {
    const startTime = process.hrtime.bigint();
    let resultStatus = "success";

    try {
      const prompt = this._sanitizePrompt(message);

      if (/^\/docs(\s|$)/i.test(prompt)) {
        const docsResponse = await this._answerDocsQuery(prompt);
        this.metrics?.recordChatbotRequest(this.connector.providerName, "docs");
        this.metrics?.recordChatbotTokenUsage(this.connector.providerName, this._estimateTokens(docsResponse.reply));
        return docsResponse;
      }

      // For very short messages, skip context loading and return a brief response
      if (this._isShortMessage(prompt)) {
        const shortReply = this._buildMinimalReply();
        this.metrics?.recordChatbotRequest(this.connector.providerName, "short");
        this.metrics?.recordChatbotTokenUsage(this.connector.providerName, this._estimateTokens(shortReply));

        return {
          provider: this.connector.providerName,
          reply: shortReply,
          contextSummary: null, // No context loaded for short messages
        };
      }

      // Load and compact context for substantive queries
      const context = await chatbotContextService.getContextForUser(userId);
      const compactedContext = this._compactContext(context);

      // Check context size and log if it's unusually large
      const contextSize = JSON.stringify(compactedContext).length;
      if (contextSize > CONTEXT_WARNING_THRESHOLD) {
        logWarning(`LLM context size for user ${userId} is unusually large: ${contextSize} characters`);
      }

      const reply = await this.connector.generateResponse({
        prompt,
        context: compactedContext,
        userId,
      });

      this.metrics?.recordChatbotRequest(this.connector.providerName, "success");

      const estimate = this._estimateTokens(prompt + " " + reply);
      this.metrics?.recordChatbotTokenUsage(this.connector.providerName, estimate);

      return {
        provider: this.connector.providerName,
        reply,
        contextSummary: compactedContext.summary,
      };
    } catch (error) {
      resultStatus = "failure";
      logWarning(`Chatbot ask() failed for user ${userId}`, { error: error.message || error });
      this.metrics?.recordChatbotRequest(this.connector.providerName, "failure");
      throw error;
    } finally {
      const endTime = process.hrtime.bigint();
      const durationSeconds = Number(endTime - startTime) / 1e9;
      this.metrics?.recordChatbotDuration(this.connector.providerName, durationSeconds);
      logTrace(`Chatbot ask() completed for user ${userId}`, {
        provider: this.connector.providerName,
        resultStatus,
        durationSeconds,
      });
    }
  }

  async runSmokeEval(userId = 1) {
    const scenarios = [
      { prompt: "summary", expected: "Fields:" },
      { prompt: "tell me about your fields", expected: "Your fields:" },
      { prompt: "show staff", expected: "Your staff:" },
      { prompt: "how many animals", expected: "Your animals:" },
    ];

    const results = [];

    for (const scenario of scenarios) {
      try {
        const response = await this.ask({ userId, message: scenario.prompt });
        const passed = typeof response.reply === "string" && response.reply.toLowerCase().includes(scenario.expected.toLowerCase());

        results.push({
          prompt: scenario.prompt,
          reply: response.reply,
          expected: scenario.expected,
          passed,
        });

        this.metrics?.recordChatbotEvaluation(passed);
      } catch (error) {
        results.push({
          prompt: scenario.prompt,
          reply: null,
          expected: scenario.expected,
          passed: false,
          error: error.message || String(error),
        });
        this.metrics?.recordChatbotEvaluation(false);
      }
    }

    const failures = results.filter((item) => !item.passed).length;
    return {
      total: results.length,
      failures,
      results,
      healthy: failures === 0,
    };
  }
}

const prometheusMetricsForChatbot = require("../../helpers/prometheus-metrics");
module.exports = new ChatbotService({ prometheusMetrics: prometheusMetricsForChatbot });
