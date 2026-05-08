const { sanitizeString } = require("../../helpers/validators");
const { logWarning } = require("../../helpers/logger-api");
const { logInfo, logTrace } = require("./logger-proxy");
const MockLlmConnector = require("./connectors/mock-llm.connector");
const GeminiLlmConnector = require("./connectors/gemini-llm.connector");
const OpenRouterLlmConnector = require("./connectors/openrouter-llm.connector");
const chatbotContextService = require("./chatbot-context.service");
const createAlertsService = require("../alerts.service");
const docsService = require("../docs.service");
const OpenRouterProvider = require("./providers/openrouter.provider");
const GeminiProvider = require("./providers/gemini.provider");
const { getBotProfile, DEFAULT_BOT_ID } = require("./bots/bot-registry");

const MAX_PROMPT_LENGTH = 1024;
const MIN_PROMPT_LENGTH = 6; // Skip context loading for very short messages
const CONTEXT_WARNING_THRESHOLD = 2048; // warn only when context is unusually large for normal farm data

class ChatbotService {
  constructor({ prometheusMetrics = null } = {}) {
    this.metrics = prometheusMetrics;
    this.connectorCache = new Map();
    logInfo("Chatbot service initialized with bot registry support.");
  }

  _resolveProviderName(botProfile = null) {
    return String(botProfile?.provider || process.env.CHATBOT_LLM_PROVIDER || "mock")
      .trim()
      .toLowerCase();
  }

  _buildConnectorCacheKey(botProfile) {
    const providerName = this._resolveProviderName(botProfile);
    const providerOptions = botProfile?.providerOptions || {};
    return JSON.stringify({
      botId: botProfile?.id || DEFAULT_BOT_ID,
      providerName,
      providerOptions,
    });
  }

  _resolveConnector(botProfile = null) {
    const provider = this._resolveProviderName(botProfile);
    const providerOptions = botProfile?.providerOptions || {};

    if (provider === "gemini") {
      const apiKey = providerOptions.apiKey ?? process.env.GEMINI_API_KEY;
      const model = providerOptions.model ?? process.env.GEMINI_MODEL;
      const hasGeminiApiKey = Boolean(apiKey && String(apiKey).trim());
      const hasGeminiModel = Boolean(model && String(model).trim());

      if (!hasGeminiApiKey || !hasGeminiModel) {
        const missing = [!hasGeminiApiKey ? "GEMINI_API_KEY" : null, !hasGeminiModel ? "GEMINI_MODEL" : null].filter(Boolean).join(", ");
        logWarning(`LLM provider 'gemini' is configured but missing: ${missing}. Falling back to mock connector.`);
        return new MockLlmConnector();
      }

      try {
        const geminiProvider = new GeminiProvider(providerOptions);
        return new GeminiLlmConnector(geminiProvider, { prometheusMetrics: this.metrics, botProfile });
      } catch (error) {
        logWarning("Gemini connector could not be initialized. Falling back to mock connector.", error);
        return new MockLlmConnector();
      }
    }

    if (provider === "openrouter") {
      const apiKey = providerOptions.apiKey ?? process.env.OPENROUTER_API_KEY;
      const model = providerOptions.model ?? process.env.OPENROUTER_MODEL;
      const hasOpenRouterApiKey = Boolean(apiKey && String(apiKey).trim());
      const hasOpenRouterModel = Boolean(model && String(model).trim());

      if (!hasOpenRouterApiKey || !hasOpenRouterModel) {
        const missing = [!hasOpenRouterApiKey ? "OPENROUTER_API_KEY" : null, !hasOpenRouterModel ? "OPENROUTER_MODEL" : null]
          .filter(Boolean)
          .join(", ");
        logWarning(`LLM provider 'openrouter' is configured but missing: ${missing}. Falling back to mock connector.`);
        return new MockLlmConnector();
      }

      try {
        const openRouterProvider = new OpenRouterProvider(providerOptions);
        return new OpenRouterLlmConnector(openRouterProvider, { prometheusMetrics: this.metrics, botProfile });
      } catch (error) {
        logWarning("OpenRouter connector could not be initialized. Falling back to mock connector.", error);
        return new MockLlmConnector();
      }
    }

    if (provider !== "mock") {
      logWarning(`Unsupported LLM provider '${provider}'. Falling back to mock connector.`);
    }

    return new MockLlmConnector();
  }

  _getBotProfile(botId) {
    return getBotProfile(botId, DEFAULT_BOT_ID);
  }

  _getConnector(botProfile) {
    const cacheKey = this._buildConnectorCacheKey(botProfile);
    if (this.connectorCache.has(cacheKey)) {
      return this.connectorCache.get(cacheKey);
    }

    const connector = this._resolveConnector(botProfile);
    this.connectorCache.set(cacheKey, connector);
    logInfo(`Chatbot bot '${botProfile.id}' is using '${connector.providerName}' provider.`);
    return connector;
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

  _buildPromptContext(context) {
    if (!context || typeof context !== "object") {
      return {};
    }

    return {
      summary: context.summary || {},
    };
  }

  _isShortMessage(prompt) {
    // Return true if message is very brief (likely just a greeting or acknowledgment)
    return prompt.trim().length < MIN_PROMPT_LENGTH;
  }

  _buildMinimalReply(botProfile = null) {
    // Hardcoded response for very short messages (no context loading needed)
    return (
      botProfile?.shortReply || "Ask me about your fields, staff, animals, or financial summary. I'm here to help with your farm data."
    );
  }

  _isDocsOnlyBot(botProfile = null) {
    return botProfile?.metadata?.mode === "docs-only";
  }

  _isAlertsOnlyBot(botProfile = null) {
    return botProfile?.metadata?.mode === "alerts-only";
  }

  _buildDocsPromptContext(docsResult) {
    const matches = Array.isArray(docsResult?.matches) ? docsResult.matches : [];

    return {
      query: docsResult?.query || "",
      totalMatches: Number(docsResult?.totalMatches) || 0,
      matches: matches.map((item) => ({
        section: item.section || "",
        title: item.title || "",
        score: Number(item.score) || 0,
        content: typeof item.content === "string" ? item.content : JSON.stringify(item.content, null, 2),
      })),
    };
  }

  _normalizeAlertsRequestContext(requestContext = {}) {
    const defaultDate = new Date().toISOString().slice(0, 10);
    const normalizedDate = sanitizeString(requestContext?.date);
    const normalizedRegion = sanitizeString(requestContext?.region).toUpperCase();

    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) ? normalizedDate : defaultDate,
      region: /^[A-Z]{2}-\d{2}$/.test(normalizedRegion) ? normalizedRegion : "PL-14",
    };
  }

  _summarizeAlertSeverities(alerts = []) {
    return alerts.reduce(
      (acc, alert) => {
        const severity = typeof alert?.severity === "string" ? alert.severity.toLowerCase() : "unknown";
        acc[severity] = (acc[severity] || 0) + 1;
        return acc;
      },
      { critical: 0, high: 0, medium: 0, low: 0 },
    );
  }

  _toAlertSnapshot(alert = {}) {
    return {
      title: alert.title || "Untitled alert",
      severity: alert.severity || "unknown",
      category: alert.category || "general",
      date: alert.date || "",
      message: alert.message || "",
      timestamp: alert.timestamp || "",
    };
  }

  _buildAlertsPromptContext({ date, region, todayAlerts, upcoming, history }) {
    return {
      seedDate: date,
      region,
      todayCount: todayAlerts.length,
      upcomingDate: upcoming.date,
      upcomingCount: Array.isArray(upcoming.alerts) ? upcoming.alerts.length : 0,
      todaySeveritySummary: this._summarizeAlertSeverities(todayAlerts),
      upcomingSeveritySummary: this._summarizeAlertSeverities(upcoming.alerts || []),
      todayAlerts: todayAlerts.slice(0, 6).map((alert) => this._toAlertSnapshot(alert)),
      upcomingAlerts: (upcoming.alerts || []).slice(0, 6).map((alert) => this._toAlertSnapshot(alert)),
      recentHistory: (history || []).slice(0, 3).map((entry) => ({
        date: entry.date,
        count: Array.isArray(entry.alerts) ? entry.alerts.length : 0,
        severitySummary: this._summarizeAlertSeverities(entry.alerts || []),
        topAlerts: (entry.alerts || []).slice(0, 3).map((alert) => this._toAlertSnapshot(alert)),
      })),
    };
  }

  _formatAlertHeadlineList(alerts = []) {
    if (!alerts.length) {
      return "nothing especially dramatic at the moment";
    }

    return alerts
      .slice(0, 3)
      .map((alert) => `${alert.title} (${alert.severity})`)
      .join(", ");
  }

  _buildAlertsMockReply(prompt, alertsContext) {
    const normalizedPrompt = String(prompt || "").toLowerCase();
    const todayAlerts = alertsContext.todayAlerts || [];
    const upcomingAlerts = alertsContext.upcomingAlerts || [];
    const history = alertsContext.recentHistory || [];
    const severityRank = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };

    const standoutAlerts = [...todayAlerts, ...upcomingAlerts]
      .sort((left, right) => (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0))
      .slice(0, 3);

    if (/(tomorrow|upcoming|next)/.test(normalizedPrompt)) {
      return upcomingAlerts.length
        ? `For ${alertsContext.region}, I see ${upcomingAlerts.length} alert(s) lined up for ${alertsContext.upcomingDate}. The standout signals are ${this._formatAlertHeadlineList(upcomingAlerts)}.`
        : `For ${alertsContext.region}, tomorrow (${alertsContext.upcomingDate}) looks calm — no upcoming alerts are queued right now.`;
    }

    if (/(history|recent|last\s+\d|last week|previous)/.test(normalizedPrompt)) {
      const historyLines = history.map((entry) => {
        const headline = this._formatAlertHeadlineList(entry.topAlerts || []);
        return `- ${entry.date}: ${entry.count} alert(s), top items: ${headline}`;
      });

      return historyLines.length
        ? [`For ${alertsContext.region}, here is the recent alert trail:`, ...historyLines].join("\n")
        : `I do not have recent history snapshots to compare for ${alertsContext.region}.`;
    }

    if (/(critical|urgent|severe|high|watch|risk|danger)/.test(normalizedPrompt)) {
      const urgentAlerts = standoutAlerts.filter((alert) => ["critical", "high"].includes(alert.severity));

      return urgentAlerts.length
        ? `The sharpest signals for ${alertsContext.region} are ${this._formatAlertHeadlineList(urgentAlerts)}. Today shows ${alertsContext.todaySeveritySummary.critical} critical and ${alertsContext.todaySeveritySummary.high} high-severity alert(s).`
        : `Nothing is flashing red for ${alertsContext.region} right now — I do not see any critical or high alerts in today's snapshot.`;
    }

    return `For ${alertsContext.region} on ${alertsContext.seedDate}, I see ${todayAlerts.length} alert(s) today and ${upcomingAlerts.length} more for ${alertsContext.upcomingDate}. The biggest signals are ${this._formatAlertHeadlineList(standoutAlerts)}.`;
  }

  async _answerAlertsOnlyBot({ prompt, connector, botProfile, requestContext }) {
    if (this._isShortMessage(prompt)) {
      const shortReply = this._buildMinimalReply(botProfile);
      this.metrics?.recordChatbotRequest(connector.providerName, "short");
      this.metrics?.recordChatbotTokenUsage(connector.providerName, this._estimateTokens(shortReply));

      return {
        provider: connector.providerName,
        botId: botProfile.id,
        botName: botProfile.name,
        reply: shortReply,
        contextSummary: "alerts-overview",
      };
    }

    const { date, region } = this._normalizeAlertsRequestContext(requestContext);
    const alertsService = createAlertsService(region);
    const todayAlerts = alertsService.generateAlertsForDate(date);
    const upcoming = alertsService.getUpcoming(date);
    const history = alertsService.getHistory(date, 3);
    const alertsPromptContext = this._buildAlertsPromptContext({
      date,
      region,
      todayAlerts,
      upcoming,
      history,
    });

    if (connector.providerName === "mock") {
      const reply = this._buildAlertsMockReply(prompt, alertsPromptContext);
      this.metrics?.recordChatbotRequest(connector.providerName, "alerts-bot");
      this.metrics?.recordChatbotTokenUsage(connector.providerName, this._estimateTokens(reply));

      return {
        provider: connector.providerName,
        botId: botProfile.id,
        botName: botProfile.name,
        reply,
        contextSummary: "alerts-overview",
      };
    }

    const reply = await connector.generateResponse({
      prompt,
      context: alertsPromptContext,
      promptContext: alertsPromptContext,
      userId: 0,
    });

    this.metrics?.recordChatbotRequest(connector.providerName, "alerts-bot");
    this.metrics?.recordChatbotTokenUsage(connector.providerName, this._estimateTokens(prompt + " " + reply));

    return {
      provider: connector.providerName,
      botId: botProfile.id,
      botName: botProfile.name,
      reply,
      contextSummary: "alerts-overview",
    };
  }

  async _answerDocsOnlyBot({ prompt, connector, botProfile }) {
    if (this._isShortMessage(prompt)) {
      const shortReply = this._buildMinimalReply(botProfile);
      this.metrics?.recordChatbotRequest(connector.providerName, "short");
      this.metrics?.recordChatbotTokenUsage(connector.providerName, this._estimateTokens(shortReply));

      return {
        provider: connector.providerName,
        botId: botProfile.id,
        botName: botProfile.name,
        reply: shortReply,
        contextSummary: "docs-search",
      };
    }

    const docsResult = await docsService.search(prompt, 3);
    const docsPromptContext = this._buildDocsPromptContext(docsResult);

    if (connector.providerName === "mock" || docsPromptContext.totalMatches === 0) {
      const reply = docsResult.answer;
      this.metrics?.recordChatbotRequest(connector.providerName, "docs-bot");
      this.metrics?.recordChatbotTokenUsage(connector.providerName, this._estimateTokens(reply));

      return {
        provider: connector.providerName,
        botId: botProfile.id,
        botName: botProfile.name,
        reply,
        contextSummary: "docs-search",
      };
    }

    const reply = await connector.generateResponse({
      prompt,
      context: docsPromptContext,
      promptContext: docsPromptContext,
      userId: 0,
    });

    this.metrics?.recordChatbotRequest(connector.providerName, "docs-bot");
    this.metrics?.recordChatbotTokenUsage(connector.providerName, this._estimateTokens(prompt + " " + reply));

    return {
      provider: connector.providerName,
      botId: botProfile.id,
      botName: botProfile.name,
      reply,
      contextSummary: "docs-search",
    };
  }

  _estimateTokens(text) {
    // Consistent with connector token estimator: ~4 chars per token
    return Math.ceil((String(text || "").length || 0) / 4);
  }

  async _answerDocsQuery(query, connector) {
    const text = query.replace(/^\/docs\s*/i, "").trim();
    if (!text) {
      return {
        provider: connector.providerName,
        reply: "Usage: /docs <question>. Example: /docs system overview, /docs how to use marketplace, /docs user roles",
        contextSummary: null,
      };
    }

    try {
      const result = await docsService.search(text, 3);
      return {
        provider: connector.providerName,
        reply: result.answer,
        contextSummary: "docs-search",
      };
    } catch (err) {
      return {
        provider: connector.providerName,
        reply: `Sorry, I couldn't search docs: ${err.message}`,
        contextSummary: "docs-search-error",
      };
    }
  }

  _formatRawReply(data) {
    if (typeof data === "string") {
      return data;
    }

    return JSON.stringify(data, null, 2);
  }

  async _answerRateLimitsQuery(connector) {
    const limitsInfo = await connector.getRateLimits();

    return {
      provider: connector.providerName,
      reply: this._formatRawReply(limitsInfo?.raw ?? limitsInfo),
      contextSummary: null,
    };
  }

  async ask({ userId, message, botId, requestContext }) {
    const startTime = process.hrtime.bigint();
    let resultStatus = "success";
    const botProfile = this._getBotProfile(botId);
    const connector = this._getConnector(botProfile);

    try {
      const prompt = this._sanitizePrompt(message);

      if (this._isDocsOnlyBot(botProfile)) {
        return await this._answerDocsOnlyBot({ prompt, connector, botProfile });
      }

      if (this._isAlertsOnlyBot(botProfile)) {
        return await this._answerAlertsOnlyBot({ prompt, connector, botProfile, requestContext });
      }

      if (/^\/docs(\s|$)/i.test(prompt)) {
        const docsResponse = await this._answerDocsQuery(prompt, connector);
        this.metrics?.recordChatbotRequest(connector.providerName, "docs");
        this.metrics?.recordChatbotTokenUsage(connector.providerName, this._estimateTokens(docsResponse.reply));
        return { ...docsResponse, botId: botProfile.id, botName: botProfile.name };
      }

      if (/^\/(ratelimits|limits)(\s|$)/i.test(prompt)) {
        const limitsResponse = await this._answerRateLimitsQuery(connector);
        this.metrics?.recordChatbotRequest(connector.providerName, "limits");
        this.metrics?.recordChatbotTokenUsage(connector.providerName, this._estimateTokens(limitsResponse.reply));
        return { ...limitsResponse, botId: botProfile.id, botName: botProfile.name };
      }

      // For very short messages, skip context loading and return a brief response
      if (this._isShortMessage(prompt)) {
        const shortReply = this._buildMinimalReply(botProfile);
        this.metrics?.recordChatbotRequest(connector.providerName, "short");
        this.metrics?.recordChatbotTokenUsage(connector.providerName, this._estimateTokens(shortReply));

        return {
          provider: connector.providerName,
          botId: botProfile.id,
          botName: botProfile.name,
          reply: shortReply,
          contextSummary: null, // No context loaded for short messages
        };
      }

      // Load and compact context for substantive queries
      const context = await chatbotContextService.getContextForUser(userId);
      const compactedContext = this._compactContext(context);
      const promptContext = connector.providerName === "mock" ? compactedContext : this._buildPromptContext(compactedContext);

      // Check context size and log if it's unusually large
      const contextSize = JSON.stringify(promptContext).length;

      // only for non mock providers:
      if (connector.providerName !== "mock" && contextSize > CONTEXT_WARNING_THRESHOLD) {
        logWarning(`LLM context size for user ${userId} is unusually large: ${contextSize} characters`);
      }

      const reply = await connector.generateResponse({
        prompt,
        context: compactedContext,
        promptContext,
        userId,
      });

      this.metrics?.recordChatbotRequest(connector.providerName, "success");

      const estimate = this._estimateTokens(prompt + " " + reply);
      this.metrics?.recordChatbotTokenUsage(connector.providerName, estimate);

      return {
        provider: connector.providerName,
        botId: botProfile.id,
        botName: botProfile.name,
        reply,
        contextSummary: compactedContext.summary,
      };
    } catch (error) {
      resultStatus = "failure";
      logWarning(`Chatbot ask() failed for user ${userId}`, { error: error.message || error, botId: botProfile.id });
      this.metrics?.recordChatbotRequest(connector.providerName, "failure");
      throw error;
    } finally {
      const endTime = process.hrtime.bigint();
      const durationSeconds = Number(endTime - startTime) / 1e9;
      this.metrics?.recordChatbotDuration(connector.providerName, durationSeconds);
      logTrace(`Chatbot ask() completed for user ${userId}`, {
        provider: connector.providerName,
        botId: botProfile.id,
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
