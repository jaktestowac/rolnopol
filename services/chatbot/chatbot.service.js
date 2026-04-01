const { sanitizeString } = require("../../helpers/validators");
const { logInfo, logWarning } = require("../../helpers/logger-api");
const MockLlmConnector = require("./connectors/mock-llm.connector");
const GeminiLlmConnector = require("./connectors/gemini-llm.connector");
const chatbotContextService = require("./chatbot-context.service");

const MAX_PROMPT_LENGTH = 1024;
const MIN_PROMPT_LENGTH = 6; // Skip context loading for very short messages

class ChatbotService {
  constructor() {
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
        return new GeminiLlmConnector();
      } catch (error) {
        logWarning("Gemini connector could not be initialized. Falling back to mock connector.", error);
        return new MockLlmConnector();
      }
    }

    if (provider !== "mock") {
      logWarning(`Unsupported LLM provider '${provider}'. Falling back to mock connector.`);
    }

    return new MockLlmConnector();
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
    return "I dont understand, but I'm here to help with your farm data. Try asking 'How are my fields doing?' or 'Tell me about animals.'";
  }

  async ask({ userId, message }) {
    const prompt = this._sanitizePrompt(message);

    // For very short messages, skip context loading and return a brief response
    if (this._isShortMessage(prompt)) {
      return {
        provider: this.connector.providerName,
        reply: this._buildMinimalReply(),
        contextSummary: null, // No context loaded for short messages
      };
    }

    // Load and compact context for substantive queries
    const context = await chatbotContextService.getContextForUser(userId);
    const compactedContext = this._compactContext(context);

    // Check context size and log if it's unusually large
    const contextSize = JSON.stringify(compactedContext).length;
    if (contextSize > 1024) {
      logWarning(`LLM context size for user ${userId} is unusually large: ${contextSize} characters`);
    }

    const reply = await this.connector.generateResponse({
      prompt,
      context: compactedContext,
    });

    return {
      provider: this.connector.providerName,
      reply,
      contextSummary: compactedContext.summary,
    };
  }
}

module.exports = new ChatbotService();
