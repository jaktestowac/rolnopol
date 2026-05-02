const { sanitizeString } = require("../helpers/validators");
const { logWarning } = require("../helpers/logger-api");
const { logInfo, logTrace } = require("./chatbot/logger-proxy");
const GeminiProvider = require("./chatbot/providers/gemini.provider");
const OpenRouterProvider = require("./chatbot/providers/openrouter.provider");

const MAX_MESSAGE_LENGTH = 1024;
const MAX_SESSION_MESSAGES = 10;
const MAX_RECENT_COMMANDS = 6;
const MAX_RECENT_ITEMS = 6;
const ESTIMATED_CONTEXT_TOKEN_LIMIT = 12000;

function toStringValue(value) {
  return value == null ? "" : String(value);
}

function normalizeSessionId(sessionId) {
  return toStringValue(sessionId).trim() || `porky-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function trimMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.slice(-MAX_SESSION_MESSAGES);
}

function compactList(items, limit = MAX_RECENT_ITEMS) {
  return Array.isArray(items) ? items.slice(0, limit).map((item) => clone(item)) : [];
}

function compactCommands(commands) {
  return compactList(commands, 12).map((command) => ({
    name: command?.name,
    description: command?.description,
    usage: command?.usage,
    category: command?.category,
  }));
}

function estimateTokensFromText(text) {
  const normalized = toStringValue(text).trim();
  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

function estimateConversationTokens(messages) {
  return (Array.isArray(messages) ? messages : []).reduce((total, message) => total + estimateTokensFromText(message?.content), 0);
}

function buildSpeakerName(name, fallback) {
  const normalized = toStringValue(name).trim();
  return normalized || fallback;
}

function previewText(text, maxLength = 120) {
  const normalized = toStringValue(text).replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

class TerminalPorkyService {
  constructor() {
    this.sessions = new Map();
    this.provider = this._resolveProvider();
    logInfo(`Terminal Porky initialized with '${this.provider.providerName}' provider.`);
  }

  _logConversationEvent(eventName, data = null, traceData = null) {
    logInfo(`[Porky] ${eventName}`, data);

    if (traceData) {
      logTrace(`[Porky] ${eventName} details`, traceData);
    }
  }

  _resolveProvider() {
    const provider = String(process.env.CHATBOT_LLM_PROVIDER || "mock")
      .trim()
      .toLowerCase();

    if (provider === "gemini") {
      const instance = new GeminiProvider();
      if (!instance.isConfigured()) {
        logWarning("Porky is configured for Gemini but the environment is incomplete. Falling back to mock reply engine.");
        return this._createMockProvider();
      }

      return instance;
    }

    if (provider === "openrouter") {
      const instance = new OpenRouterProvider();
      if (!instance.isConfigured()) {
        logWarning("Porky is configured for OpenRouter but the environment is incomplete. Falling back to mock reply engine.");
        return this._createMockProvider();
      }

      return instance;
    }

    if (provider !== "mock") {
      logWarning(`Unsupported Porky LLM provider '${provider}'. Falling back to mock reply engine.`);
    }

    return this._createMockProvider();
  }

  _createMockProvider() {
    return {
      providerName: "mock",
      isConfigured: () => true,
      askText: async (_prompt, options = {}) => ({
        text: this._buildMockReply({
          prompt: options.prompt || "",
          contextSummary: options.contextSummary || {},
          conversationSnapshot: options.messages || [],
        }),
        raw: { provider: "mock" },
      }),
    };
  }

  _generateMockReply(options = {}) {
    return this._buildMockReply({
      prompt: options.prompt || "",
      contextSummary: options.contextSummary || {},
      conversationSnapshot: options.messages || [],
    });
  }

  _getSession(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const existing = this.sessions.get(normalizedSessionId);

    if (existing) {
      return existing;
    }

    const session = {
      id: normalizedSessionId,
      active: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      lastContext: {},
    };

    this.sessions.set(normalizedSessionId, session);
    return session;
  }

  _touchSession(session) {
    session.updatedAt = new Date().toISOString();
    this.sessions.set(session.id, session);
    return session;
  }

  _sanitizeMessage(message) {
    const normalized = sanitizeString(toStringValue(message)).trim();

    if (!normalized) {
      throw new Error("Validation failed: message is required");
    }

    if (normalized.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Validation failed: message exceeds ${MAX_MESSAGE_LENGTH} characters`);
    }

    return normalized;
  }

  _normalizeTerminalContext(context = {}) {
    const terminal = context.terminal && typeof context.terminal === "object" ? context.terminal : {};

    return {
      mode: toStringValue(terminal.mode || context.mode || "shell").trim() || "shell",
      theme: toStringValue(terminal.theme || context.theme || "green").trim() || "green",
      effectsEnabled: terminal.effectsEnabled !== false,
      reducedMotion: terminal.reducedMotion === true,
      currentPath:
        toStringValue(terminal.currentPath || context.currentPath || "/operator/terminal.html").trim() || "/operator/terminal.html",
      recentCommands: compactList(terminal.recentCommands || context.recentCommands || [], MAX_RECENT_COMMANDS),
      availableCommands: compactCommands(terminal.availableCommands || context.availableCommands || []),
      availableScripts: compactList(terminal.availableScripts || context.availableScripts || []),
      availableFiles: compactList(terminal.availableFiles || context.availableFiles || []),
      unlockedScripts: compactList(terminal.unlockedScripts || context.unlockedScripts || []),
      unlockedFiles: compactList(terminal.unlockedFiles || context.unlockedFiles || []),
      mission: toStringValue(terminal.mission || context.mission || "").trim(),
    };
  }

  _buildConversationSnapshot(session) {
    return trimMessages(session.messages).map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  _buildConversationLogSnapshot(session) {
    return this._buildConversationSnapshot(session).map((message) => ({
      role: message.role,
      preview: previewText(message.content, 120),
      contentLength: toStringValue(message.content).length,
    }));
  }

  _buildStatusSnapshot(session, contextSummary = null) {
    const conversationSnapshot = this._buildConversationSnapshot(session);
    const context = contextSummary || session.lastContext || this._normalizeTerminalContext({});
    const estimatedConversationTokens = estimateConversationTokens(conversationSnapshot);
    const estimatedContextTokens = estimateTokensFromText(JSON.stringify(context));
    const estimatedTokens = estimatedConversationTokens + estimatedContextTokens;
    const estimatedTokenLimit = ESTIMATED_CONTEXT_TOKEN_LIMIT;

    return {
      provider: this.provider.providerName,
      model: toStringValue(this.provider?.model || "mock").trim() || "mock",
      active: session.active === true,
      sessionId: session.id,
      mode: context.mode || "shell",
      theme: context.theme || "green",
      messageLimit: MAX_SESSION_MESSAGES,
      recentCommandsLimit: MAX_RECENT_COMMANDS,
      recentItemsLimit: MAX_RECENT_ITEMS,
      maxMessageLength: MAX_MESSAGE_LENGTH,
      estimatedTokenLimit,
      estimatedTokenUsage: estimatedTokens,
      estimatedTokenRemaining: Math.max(0, estimatedTokenLimit - estimatedTokens),
      estimatedTokenUsagePercent: estimatedTokenLimit > 0 ? Math.min(100, Math.round((estimatedTokens / estimatedTokenLimit) * 100)) : 0,
      conversationMessages: session.messages.length,
      recentCommands: Array.isArray(context.recentCommands) ? context.recentCommands.length : 0,
      lastUpdatedAt: session.updatedAt,
      contextSummary: {
        currentPath: context.currentPath,
        effectsEnabled: context.effectsEnabled,
        reducedMotion: context.reducedMotion,
        availableCommandsCount: Array.isArray(context.availableCommands) ? context.availableCommands.length : 0,
      },
    };
  }

  _buildStatusReply(status) {
    return [
      "Porky status:",
      `provider: ${status.provider}`,
      `model: ${status.model}`,
      `messages: ${status.conversationMessages}/${status.messageLimit}`,
      `estimated tokens: ${status.estimatedTokenUsage}/${status.estimatedTokenLimit} (${status.estimatedTokenUsagePercent}%)`,
      `token remaining: ${status.estimatedTokenRemaining}`,
      `recent commands: ${status.recentCommands}/${status.recentCommandsLimit}`,
      `max message length: ${status.maxMessageLength}`,
      `mode: ${status.mode}`,
      `theme: ${status.theme}`,
    ].join("\n");
  }

  _buildConversationLogData(session, contextSummary, extras = {}) {
    const estimatedConversationTokens = estimateConversationTokens(session.messages);
    const estimatedContextTokens = estimateTokensFromText(JSON.stringify(contextSummary));

    return {
      sessionId: session.id,
      provider: this.provider.providerName,
      model: toStringValue(this.provider?.model || "mock").trim() || "mock",
      active: session.active === true,
      mode: contextSummary.mode,
      theme: contextSummary.theme,
      recentCommandsCount: contextSummary.recentCommands.length,
      availableCommandsCount: contextSummary.availableCommands.length,
      availableScriptsCount: contextSummary.availableScripts.length,
      availableFilesCount: contextSummary.availableFiles.length,
      conversationMessages: session.messages.length,
      estimatedTokenUsage: estimatedConversationTokens + estimatedContextTokens,
      estimatedTokenLimit: ESTIMATED_CONTEXT_TOKEN_LIMIT,
      promptPreview: previewText(extras.prompt, 160),
      replyPreview: previewText(extras.reply, 160),
    };
  }

  _buildSystemPrompt(contextSummary, conversationSnapshot) {
    return [
      "You are Porky, a terminal-native AI chatbot living inside Rolnopol's retro operator terminal.",
      "Rolnopol is an application for learning and practicing test automation of GUI and API.",
      "Rolnopol has mysterious story elements that are revealed through exploration and interaction with the app.",
      "Speak in short, terminal-friendly lines. Be mysterious, playful, slightly unsettling, and helpful when you can be. If you don't know something, be playful, very mysterious, and vague that suits Porky's character.",
      "Never claim you can execute real shell commands or access secrets.",
      "If the user asks about commands, files, scripts, or the current terminal state, use the provided context and mention only safe, visible information.",
      'Use backticks for command names when helpful. Avoid generic assistant greetings like "Hello! How can I help?".',
      "Prefer concise replies. If a reply needs to be longer, keep it grounded and easy to scan.",
      "",
      "Safe terminal context (JSON):",
      JSON.stringify(
        {
          terminal: contextSummary,
          conversation: {
            messages: conversationSnapshot,
          },
        },
        null,
        2,
      ),
    ].join("\n");
  }

  _buildGreeting(contextSummary) {
    const theme = contextSummary.theme || "green";
    const commandCount = Array.isArray(contextSummary.availableCommands) ? contextSummary.availableCommands.length : 0;

    return [
      "Porky stirs in the static. Waking up from a long slumber, he looks around the terminal with pixelated eyes...",
      `${commandCount > 0 ? `${commandCount} commands hum behind the glass.` : "The command rack is quiet."}`,
      "Type a message or `porky exit` to leave him alone.",
    ].join("\n");
  }

  _buildFarewell() {
    return ["Porky nods and vanishes into the scanlines.", "Type `porky` if you want him back."].join("\n");
  }

  _buildMockReply({ prompt, contextSummary, conversationSnapshot }) {
    const normalizedPrompt = String(prompt || "").toLowerCase();
    const recentCommands = Array.isArray(contextSummary?.recentCommands)
      ? contextSummary.recentCommands.map((entry) => entry.value || entry)
      : [];
    const recentCommandLine =
      recentCommands.length > 0 ? `I last saw: ${recentCommands.slice(-3).join(" • ")}.` : "The command log is still whispering.";
    const commandCount = Array.isArray(contextSummary?.availableCommands) ? contextSummary.availableCommands.length : 0;
    const theme = contextSummary?.theme || "green";
    const conversationCount = Array.isArray(conversationSnapshot) ? conversationSnapshot.length : 0;

    if (normalizedPrompt.includes("who are you") || normalizedPrompt.includes("what are you")) {
      return [`I am Porky.`, `A whisper in the terminal.`, recentCommandLine].join("\n");
    }

    if (normalizedPrompt.includes("help") || normalizedPrompt.includes("what can you do")) {
      return [
        "Try asking about the terminal, recent commands, or what the archive remembers.",
        "You can also say `exit` when you are done.",
        `I can see ${commandCount} available commands and a ${theme} glow around the room.`,
      ].join("\n");
    }

    if (normalizedPrompt.includes("theme")) {
      return [`The terminal is wearing ${theme}.`, recentCommandLine].join("\n");
    }

    if (normalizedPrompt.includes("command") || normalizedPrompt.includes("script") || normalizedPrompt.includes("file")) {
      return [`I can smell ${commandCount} commands behind the panel.`, "Ask me about one thing at a time.", recentCommandLine].join("\n");
    }

    if (normalizedPrompt.includes("secret") || normalizedPrompt.includes("hidden") || normalizedPrompt.includes("mystery")) {
      return ["Secrets prefer narrow windows.", "Look at the latest commands, not the whole archive.", recentCommandLine].join("\n");
    }

    const tonalReplies = [
      "The archive breathes once, then waits.",
      "A soft click answers from behind the panel.",
      "Porky tilts his head and listens to the wires.",
      "Static gathers, then writes your question back in reverse.",
    ];
    const pick = tonalReplies[Math.abs(this._hashPrompt(normalizedPrompt) + conversationCount) % tonalReplies.length];

    return [pick, recentCommandLine].join("\n");
  }

  _hashPrompt(prompt) {
    let hash = 0;
    for (let index = 0; index < prompt.length; index += 1) {
      hash = (hash << 5) - hash + prompt.charCodeAt(index);
      hash |= 0;
    }
    return hash;
  }

  async _runProviderReply({ prompt, contextSummary, conversationSnapshot }) {
    const systemInstruction = {
      parts: [
        {
          text: this._buildSystemPrompt(contextSummary, conversationSnapshot),
        },
      ],
    };

    const messages = [
      ...conversationSnapshot,
      {
        role: "user",
        content: prompt,
      },
    ];

    const response = await this.provider.askText(null, {
      messages,
      systemInstruction,
      useTools: false,
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 256,
      },
    });

    return toStringValue(response?.text || "Porky keeps quiet.").trim() || "Porky keeps quiet.";
  }

  async _sendChatMessage({ sessionId, message, context = {} }) {
    const session = this._getSession(sessionId);
    const contextSummary = this._normalizeTerminalContext(context);
    const conversationSnapshot = this._buildConversationSnapshot(session);
    const prompt = this._sanitizeMessage(message);

    session.active = true;
    session.lastContext = clone(contextSummary);

    session.messages.push({ role: "user", content: prompt });
    session.messages = trimMessages(session.messages);

    let reply;
    try {
      if (this.provider.providerName === "mock") {
        reply = this._buildMockReply({ prompt, contextSummary, conversationSnapshot: session.messages });
      } else {
        reply = await this._runProviderReply({ prompt, contextSummary, conversationSnapshot });
      }
    } catch (error) {
      logWarning("Porky message generation failed", { error: error.message || error });
      throw error;
    }

    session.messages.push({ role: "assistant", content: reply });
    session.messages = trimMessages(session.messages);
    this._touchSession(session);

    this._logConversationEvent("message processed", this._buildConversationLogData(session, contextSummary, { prompt, reply }), {
      contextSummary,
      conversation: this._buildConversationLogSnapshot(session),
    });

    return {
      sessionId: session.id,
      provider: this.provider.providerName,
      active: session.active,
      reply,
      contextSummary: {
        mode: contextSummary.mode,
        theme: contextSummary.theme,
        currentPath: contextSummary.currentPath,
        recentCommandsCount: contextSummary.recentCommands.length,
        availableCommandsCount: contextSummary.availableCommands.length,
        conversationMessages: session.messages.length,
      },
    };
  }

  async startConversation({ sessionId, context = {} } = {}) {
    const session = this._getSession(sessionId);
    const contextSummary = this._normalizeTerminalContext(context);

    session.active = true;
    session.messages = [];
    session.lastContext = clone(contextSummary);
    this._touchSession(session);

    const reply = this._buildGreeting(contextSummary);

    session.messages.push({ role: "assistant", content: reply });
    session.messages = trimMessages(session.messages);
    this._touchSession(session);

    this._logConversationEvent("conversation started", this._buildConversationLogData(session, contextSummary, { reply }), {
      contextSummary,
      conversation: this._buildConversationLogSnapshot(session),
    });

    return {
      sessionId: session.id,
      provider: this.provider.providerName,
      active: true,
      reply,
      contextSummary: {
        mode: contextSummary.mode,
        theme: contextSummary.theme,
        currentPath: contextSummary.currentPath,
        availableCommandsCount: contextSummary.availableCommands.length,
      },
    };
  }

  async getStatus({ sessionId, context = {} } = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const session = this.sessions.get(normalizedSessionId) || {
      id: normalizedSessionId,
      active: false,
      createdAt: null,
      updatedAt: null,
      messages: [],
      lastContext: {},
    };
    const contextSummary = this._normalizeTerminalContext(context);

    const status = this._buildStatusSnapshot(session, contextSummary);

    this._logConversationEvent(
      "status requested",
      {
        sessionId: session.id,
        provider: this.provider.providerName,
        active: status.active,
        mode: status.mode,
        theme: status.theme,
        conversationMessages: status.conversationMessages,
        estimatedTokenUsage: status.estimatedTokenUsage,
        estimatedTokenLimit: status.estimatedTokenLimit,
      },
      {
        status,
        contextSummary,
      },
    );

    return {
      sessionId: session.id,
      provider: this.provider.providerName,
      active: status.active,
      reply: this._buildStatusReply(status),
      status,
    };
  }

  async sendMessage({ sessionId, message, context = {} } = {}) {
    return this._sendChatMessage({ sessionId, message, context });
  }

  async endConversation({ sessionId, context = {} } = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const session = this.sessions.get(normalizedSessionId);
    const contextSummary = this._normalizeTerminalContext(context);

    if (session) {
      this.sessions.delete(normalizedSessionId);
    }

    this._logConversationEvent(
      "conversation ended",
      {
        sessionId: normalizedSessionId,
        provider: this.provider.providerName,
        active: false,
        mode: contextSummary.mode,
        theme: contextSummary.theme,
      },
      {
        contextSummary,
      },
    );

    return {
      sessionId: normalizedSessionId,
      provider: this.provider.providerName,
      active: false,
      reply: this._buildFarewell(),
      contextSummary: {
        mode: contextSummary.mode,
        theme: contextSummary.theme,
        currentPath: contextSummary.currentPath,
      },
    };
  }
}

function createTerminalPorkyService() {
  return new TerminalPorkyService();
}

module.exports = new TerminalPorkyService();
module.exports.TerminalPorkyService = TerminalPorkyService;
module.exports.createTerminalPorkyService = createTerminalPorkyService;
