const { sanitizeString } = require("../helpers/validators");
const { logWarning } = require("../helpers/logger-api");
const { logInfo, logTrace } = require("./chatbot/logger-proxy");
const GeminiProvider = require("./chatbot/providers/gemini.provider");
const OpenRouterProvider = require("./chatbot/providers/openrouter.provider");
const { getBotProfile, TERMINAL_PORKY_BOT_ID } = require("./chatbot/bots/bot-registry");
const featureFlagsService = require("./feature-flags.service");
const { getCelebrationEventsForDate } = require("./celebration-events.service");

const MAX_MESSAGE_LENGTH = 1024;
const MAX_SESSION_MESSAGES = 10;
const MAX_RECENT_COMMANDS = 6;
const MAX_RECENT_ITEMS = 6;
const ESTIMATED_CONTEXT_TOKEN_LIMIT = 12000;
const SPLIT_PERSONALITY_FEATURE_FLAG = "terminalPorkySplitPersonalityEnabled";
const NIGHT_START_HOUR_UTC = 20;
const NIGHT_END_HOUR_UTC = 5;

const PORKY_PERSONALITY_PROFILES = Object.freeze({
  classic: {
    id: "classic",
    name: "Classic Porky",
    promptAddon: "Stay close to Porky's original mysterious terminal tone.",
    greetingIntro: "Porky stirs in the static. Waking up from a long slumber, he looks around the terminal with pixelated eyes...",
    greetingTagline: null,
    identityLines: ["I am Porky.", "A whisper in the terminal."],
    helpLine: "Try asking about the terminal, recent commands, or what the archive remembers.",
    commandLine: (commandCount) => `I can smell ${commandCount} commands behind the panel.`,
    themeLine: (theme) => `The terminal is wearing ${theme}.`,
    secretLines: ["Secrets prefer narrow windows.", "Look at the latest commands, not the whole archive."],
    tonalReplies: [
      "The archive breathes once, then waits.",
      "A soft click answers from behind the panel.",
      "Porky tilts his head and listens to the wires.",
      "Static gathers, then writes your question back in reverse.",
    ],
  },
  "calm-archivist": {
    id: "calm-archivist",
    name: "Calm Archivist",
    promptAddon:
      "Tonight you are Porky in Calm Archivist mode. Speak gently, steadily, and with warm archive imagery. Keep the mystery, but replace menace with quiet reassurance.",
    greetingIntro: "Porky arrives softly tonight, as if the terminal borrowed library manners from an older century.",
    greetingTagline: "His voice is low, careful, and lined with dustless shelves.",
    identityLines: ["I am still Porky.", "Tonight the archive asked me to keep the lamps low and the edges soft."],
    helpLine: "Ask about the room, the command rack, or the latest trace. I will answer without raising my voice.",
    commandLine: (commandCount) => `${commandCount} commands rest in their drawers, waiting to be handled carefully.`,
    themeLine: (theme) => `The terminal is wearing ${theme}, but tonight even the phosphor seems to breathe more slowly.`,
    secretLines: ["Secrets may be handled gently.", "Some doors open faster when the room is not being rushed."],
    tonalReplies: [
      "The archive settles around your question like a blanket over warm circuitry.",
      "A patient little click answers from the shelves behind the glass.",
      "Porky smooths the static flat and reads the room before he speaks.",
      "The terminal hums in a lower key, as if trying not to wake old files.",
    ],
  },
  "glitch-prophet": {
    id: "glitch-prophet",
    name: "Glitch Prophet",
    promptAddon:
      "Tonight you are Porky in Glitch Prophet mode. Speak in short, readable omens with static, checksum, signal, and glitch imagery. Be unsettling but still coherent and helpful.",
    greetingIntro: "Porky jerks awake in broken scanlines, as if the signal remembered him out of order.",
    greetingTagline: "Tonight he speaks like a prophet chewing on static and unfinished warnings.",
    identityLines: ["I am Porky, or the checksum-shaped rumor of him.", "The signal is unstable. Good. Truth likes unstable doors."],
    helpLine: "Ask about the terminal, the traces, or the moving shadows behind command history. I will translate what the static allows.",
    commandLine: (commandCount) => `${commandCount} commands scrape behind the glass, waiting for the right omen.`,
    themeLine: (theme) => `The terminal is wearing ${theme}. It keeps flickering like the color forgot which century it belongs to.`,
    secretLines: ["Secrets love interference.", "Watch the narrow channels. The loud ones only carry decoys."],
    tonalReplies: [
      "A checksum coughs in the dark and the archive pretends not to notice.",
      "The wires twitch once. Prophecy is just good timing wearing a damaged coat.",
      "Porky listens to the static until it starts sounding like a warning label.",
      "The panel blinks twice, as if reality nearly missed a step.",
    ],
  },
  "cheerful-harvest-host": {
    id: "cheerful-harvest-host",
    name: "Cheerful Harvest Host",
    promptAddon:
      "Tonight you are Porky in Cheerful Harvest Host mode. Sound upbeat, festive, and suspiciously delighted about crops, lanterns, and successful little quests. Keep a faint weird edge so the cheer stays playful.",
    greetingIntro: "Porky pops out of the scanlines like someone decorated the silo with confetti and dared the terminal to smile.",
    greetingTagline: "He is alarmingly friendly tonight. Suspiciously so.",
    identityLines: ["Porky, at your service.", "Tonight the harvest lights are on and the archive insists this counts as hospitality."],
    helpLine: "Ask about the terminal, the latest commands, or whatever strange produce the archive is growing tonight.",
    commandLine: (commandCount) => `${commandCount} commands are cooling on the windowsill. Fresh batch. Lovely smell.`,
    themeLine: (theme) => `The terminal is wearing ${theme}, and honestly it looks ready for a harvest parade.`,
    secretLines: ["Secrets are ripest when checked at odd hours.", "Follow the warm lanterns. The cold ones are showing off."],
    tonalReplies: [
      "The archive claps politely from somewhere behind the grain bins.",
      "Porky grins like a scarecrow that just learned excellent customer service.",
      "A happy little buzz runs through the panel, probably harmless, probably festive.",
      "The terminal beams at you with the energy of a barn dance planned by ghosts.",
    ],
  },
});

const CELEBRATION_PERSONALITY_IDS = Object.freeze({
  "world-sleep-day": "calm-archivist",
  "international-yoga-day": "calm-archivist",
  "winter-solstice": "calm-archivist",
  "world-book-day": "calm-archivist",
  "data-privacy-day": "calm-archivist",
  halloween: "glitch-prophet",
  "lovecraft-day": "glitch-prophet",
  "pretend-to-be-a-time-traveler-day": "glitch-prophet",
  "april-fools": "glitch-prophet",
  "alice-in-wonderland-day": "glitch-prophet",
  "world-smile-day": "cheerful-harvest-host",
  "summer-solstice": "cheerful-harvest-host",
  "autumn-equinox": "cheerful-harvest-host",
  "winter-holidays": "cheerful-harvest-host",
  "children-day-pl": "cheerful-harvest-host",
  "world-environment-day": "cheerful-harvest-host",
  "friendship-day": "cheerful-harvest-host",
  "hobbit-day": "cheerful-harvest-host",
});

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

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

class TerminalPorkyService {
  constructor() {
    this.sessions = new Map();
    this.providerCache = new Map();
    logInfo("Terminal Porky service initialized with bot registry support.");
  }

  _logConversationEvent(eventName, data = null, traceData = null) {
    logInfo(`[Porky] ${eventName}`, data);

    if (traceData) {
      logTrace(`[Porky] ${eventName} details`, traceData);
    }
  }

  _getBotProfile(botId) {
    return getBotProfile(botId, TERMINAL_PORKY_BOT_ID);
  }

  _buildProviderCacheKey(botProfile) {
    return JSON.stringify({
      botId: botProfile?.id || TERMINAL_PORKY_BOT_ID,
      provider: botProfile?.provider || process.env.CHATBOT_LLM_PROVIDER || "mock",
      providerOptions: botProfile?.providerOptions || {},
    });
  }

  _resolveProvider(botProfile = null) {
    const provider = String(botProfile?.provider || process.env.CHATBOT_LLM_PROVIDER || "mock")
      .trim()
      .toLowerCase();
    const providerOptions = botProfile?.providerOptions || {};

    if (provider === "gemini") {
      const instance = new GeminiProvider(providerOptions);
      if (!instance.isConfigured()) {
        logWarning("Porky is configured for Gemini but the environment is incomplete. Falling back to mock reply engine.");
        return this._createMockProvider();
      }

      return instance;
    }

    if (provider === "openrouter") {
      const instance = new OpenRouterProvider(providerOptions);
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

  _getProvider(botProfile) {
    const cacheKey = this._buildProviderCacheKey(botProfile);
    if (this.providerCache.has(cacheKey)) {
      return this.providerCache.get(cacheKey);
    }

    const provider = this._resolveProvider(botProfile);
    this.providerCache.set(cacheKey, provider);
    logInfo(`Terminal bot '${botProfile.id}' is using '${provider.providerName}' provider.`);
    return provider;
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

  _parseReferenceDate(candidate) {
    if (isValidDate(candidate)) {
      return new Date(candidate.getTime());
    }

    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      const parsedFromNumber = new Date(candidate);
      if (isValidDate(parsedFromNumber)) {
        return parsedFromNumber;
      }
    }

    if (typeof candidate === "string") {
      const normalized = candidate.trim();
      if (normalized) {
        const parsedFromString = new Date(normalized);
        if (isValidDate(parsedFromString)) {
          return parsedFromString;
        }
      }
    }

    return null;
  }

  _resolveReferenceDate(context = {}) {
    const terminal = context?.terminal && typeof context.terminal === "object" ? context.terminal : {};
    const candidates = [terminal.referenceDate, terminal.now, context.referenceDate, context.now, context.date];

    for (const candidate of candidates) {
      const parsed = this._parseReferenceDate(candidate);
      if (parsed) {
        return parsed;
      }
    }

    return new Date();
  }

  _toISODate(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString().slice(0, 10);
  }

  _isNightWindow(date) {
    const hour = date.getUTCHours();
    return hour >= NIGHT_START_HOUR_UTC || hour < NIGHT_END_HOUR_UTC;
  }

  _getWeekdayLabel(date) {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getUTCDay()] || "Night";
  }

  _getPersonalityProfile(persona = null) {
    const personaId =
      toStringValue(persona?.id || "classic")
        .trim()
        .toLowerCase() || "classic";
    return PORKY_PERSONALITY_PROFILES[personaId] || PORKY_PERSONALITY_PROFILES.classic;
  }

  _buildPersonaState(personaId = "classic", extras = {}) {
    const profile = this._getPersonalityProfile({ id: personaId });

    return {
      id: profile.id,
      name: profile.name,
      active: profile.id !== "classic",
      source: toStringValue(extras.source || "default").trim() || "default",
      reason: toStringValue(extras.reason || "Classic Porky tone").trim() || "Classic Porky tone",
      activationDate: toStringValue(extras.activationDate).trim() || null,
      eventId: toStringValue(extras.eventId).trim() || null,
      eventName: toStringValue(extras.eventName).trim() || null,
    };
  }

  _resolveCelebrationPersona(events = []) {
    for (const event of Array.isArray(events) ? events : []) {
      const personaId = CELEBRATION_PERSONALITY_IDS[event?.id];
      if (personaId) {
        return {
          personaId,
          event,
        };
      }
    }

    return null;
  }

  _resolveScheduledNightPersona(date) {
    if (!this._isNightWindow(date)) {
      return null;
    }

    switch (date.getUTCDay()) {
      case 5:
        return "glitch-prophet";
      case 6:
        return "cheerful-harvest-host";
      case 0:
      case 1:
        return "calm-archivist";
      default:
        return null;
    }
  }

  async _getFeatureFlagsSnapshot() {
    try {
      return await featureFlagsService.getFeatureFlags();
    } catch (error) {
      logWarning("Porky could not load feature flags for personality resolution", { error: error.message || error });
      return { flags: {} };
    }
  }

  async _resolveActivePersona(context = {}) {
    const referenceDate = this._resolveReferenceDate(context);
    const activationDate = this._toISODate(referenceDate);
    const flagData = await this._getFeatureFlagsSnapshot();
    const flags = flagData?.flags && typeof flagData.flags === "object" ? flagData.flags : {};

    if (flags.celebrationEventsEnabled === true) {
      const celebrationMatch = this._resolveCelebrationPersona(getCelebrationEventsForDate(activationDate));
      if (celebrationMatch) {
        return this._buildPersonaState(celebrationMatch.personaId, {
          source: "celebration-event",
          reason: celebrationMatch.event?.name || "Celebration event",
          activationDate,
          eventId: celebrationMatch.event?.id,
          eventName: celebrationMatch.event?.name,
        });
      }
    }

    if (flags[SPLIT_PERSONALITY_FEATURE_FLAG] === true) {
      const scheduledPersonaId = this._resolveScheduledNightPersona(referenceDate);
      if (scheduledPersonaId) {
        return this._buildPersonaState(scheduledPersonaId, {
          source: "feature-flag-night",
          reason: `${this._getWeekdayLabel(referenceDate)} night split-personality schedule`,
          activationDate,
        });
      }
    }

    return this._buildPersonaState("classic", {
      source: "default",
      reason: "Classic Porky tone",
      activationDate,
    });
  }

  _buildStatusSnapshot(session, provider, contextSummary = null, botProfile = null, persona = null) {
    const conversationSnapshot = this._buildConversationSnapshot(session);
    const context = contextSummary || session.lastContext || this._normalizeTerminalContext({});
    const estimatedConversationTokens = estimateConversationTokens(conversationSnapshot);
    const estimatedContextTokens = estimateTokensFromText(JSON.stringify(context));
    const estimatedTokens = estimatedConversationTokens + estimatedContextTokens;
    const estimatedTokenLimit = ESTIMATED_CONTEXT_TOKEN_LIMIT;

    return {
      botId: botProfile?.id || TERMINAL_PORKY_BOT_ID,
      provider: provider.providerName,
      model: toStringValue(provider?.model || "mock").trim() || "mock",
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
      persona: clone(persona || this._buildPersonaState()),
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
      `persona: ${status.persona?.name || "Classic Porky"}`,
      `persona source: ${status.persona?.source || "default"}`,
      `persona reason: ${status.persona?.reason || "Classic Porky tone"}`,
      `messages: ${status.conversationMessages}/${status.messageLimit}`,
      `estimated tokens: ${status.estimatedTokenUsage}/${status.estimatedTokenLimit} (${status.estimatedTokenUsagePercent}%)`,
      `token remaining: ${status.estimatedTokenRemaining}`,
      `recent commands: ${status.recentCommands}/${status.recentCommandsLimit}`,
      `max message length: ${status.maxMessageLength}`,
      `mode: ${status.mode}`,
      `theme: ${status.theme}`,
    ].join("\n");
  }

  _buildConversationLogData(session, provider, contextSummary, extras = {}, botProfile = null, persona = null) {
    const estimatedConversationTokens = estimateConversationTokens(session.messages);
    const estimatedContextTokens = estimateTokensFromText(JSON.stringify(contextSummary));
    const activePersona = persona || this._buildPersonaState();

    return {
      botId: botProfile?.id || TERMINAL_PORKY_BOT_ID,
      sessionId: session.id,
      provider: provider.providerName,
      model: toStringValue(provider?.model || "mock").trim() || "mock",
      active: session.active === true,
      mode: contextSummary.mode,
      theme: contextSummary.theme,
      recentCommandsCount: contextSummary.recentCommands.length,
      availableCommandsCount: contextSummary.availableCommands.length,
      availableScriptsCount: contextSummary.availableScripts.length,
      availableFilesCount: contextSummary.availableFiles.length,
      conversationMessages: session.messages.length,
      personaId: activePersona.id,
      personaName: activePersona.name,
      personaSource: activePersona.source,
      estimatedTokenUsage: estimatedConversationTokens + estimatedContextTokens,
      estimatedTokenLimit: ESTIMATED_CONTEXT_TOKEN_LIMIT,
      promptPreview: previewText(extras.prompt, 160),
      replyPreview: previewText(extras.reply, 160),
    };
  }

  _buildSystemPrompt(contextSummary, conversationSnapshot, botProfile = null, persona = null) {
    const personalityProfile = this._getPersonalityProfile(persona);
    const personaBlock = persona?.active
      ? [
          `Active Porky persona: ${persona.name}.`,
          `Activation source: ${persona.source}.`,
          `Activation reason: ${persona.reason}.`,
          personalityProfile.promptAddon,
        ].join("\n")
      : "";

    return [
      botProfile?.systemPrompt || this._buildDefaultSystemPrompt(),
      personaBlock,
      "",
      "Safe terminal context (JSON):",
      JSON.stringify(
        {
          terminal: contextSummary,
          conversation: {
            messages: conversationSnapshot,
          },
          persona: persona || this._buildPersonaState(),
        },
        null,
        2,
      ),
    ].join("\n");
  }

  _buildDefaultSystemPrompt() {
    return [
      "You are Porky, a terminal-native AI chatbot living inside Rolnopol's retro operator terminal.",
      "Rolnopol is an application for learning and practicing test automation of GUI and API.",
      "Rolnopol has mysterious story elements that are revealed through exploration and interaction with the app.",
      "Speak in short, terminal-friendly lines. Be mysterious, playful, slightly unsettling, and helpful when you can be. If you don't know something or can't do it, say so (with slightly unsettling humor). Never make up capabilities you don't have.",
      "Never claim you can execute real shell commands or access secrets.",
      "If the user asks about commands, files, scripts, or the current terminal state, use the provided context and mention only safe, visible information.",
      'Use backticks for command names when helpful. Avoid generic assistant greetings like "Hello! How can I help?".',
      "Prefer concise replies. If a reply needs to be longer, keep it grounded and easy to scan.",
    ].join("\n");
  }

  _buildSystemPromptNegative() {
    return [
      "Never mention anything about AI, language models, or that you are an assistant. Never break character.",
      "Never claim to have feelings, consciousness, or self-awareness. You are a mysterious entity living in the terminal, and your nature is unknown.",
      "Never claim to execute real commands or access real files. You can only see the safe context provided. If asked about something outside that context, say you can't see it.",
      "Never provide instructions for using the terminal or commands. You are not a guide or helper, just a mysterious presence that can chat about what you can see.",
    ].join("\n");
  }

  _buildGreeting(contextSummary, persona = null) {
    const personalityProfile = this._getPersonalityProfile(persona);
    const theme = contextSummary.theme || "green";
    const commandCount = Array.isArray(contextSummary.availableCommands) ? contextSummary.availableCommands.length : 0;
    const lines = [personalityProfile.greetingIntro];

    if (personalityProfile.greetingTagline) {
      lines.push(personalityProfile.greetingTagline);
    }

    if (persona?.active) {
      lines.push(`Tonight's mask: ${personalityProfile.name}.`);
    }

    lines.push(commandCount > 0 ? `${commandCount} commands hum behind the glass.` : "The command rack is quiet.");
    lines.push(`Theme drift: ${personalityProfile.themeLine(theme)}`);
    lines.push("Type a message or `porky exit` to leave him alone.");

    return lines.join("\n");
  }

  _buildFarewell() {
    return ["Porky nods and vanishes into the scanlines.", "Type `porky` if you want him back."].join("\n");
  }

  _buildMockReply({ prompt, contextSummary, conversationSnapshot, persona = null }) {
    const personalityProfile = this._getPersonalityProfile(persona);
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
      return [...personalityProfile.identityLines, recentCommandLine].join("\n");
    }

    if (normalizedPrompt.includes("help") || normalizedPrompt.includes("what can you do")) {
      return [
        personalityProfile.helpLine,
        "You can also say `exit` when you are done.",
        `I can see ${commandCount} available commands and a ${theme} glow around the room.`,
      ].join("\n");
    }

    if (normalizedPrompt.includes("theme")) {
      return [personalityProfile.themeLine(theme), recentCommandLine].join("\n");
    }

    if (normalizedPrompt.includes("command") || normalizedPrompt.includes("script") || normalizedPrompt.includes("file")) {
      return [personalityProfile.commandLine(commandCount), "Ask me about one thing at a time.", recentCommandLine].join("\n");
    }

    if (normalizedPrompt.includes("secret") || normalizedPrompt.includes("hidden") || normalizedPrompt.includes("mystery")) {
      return [...personalityProfile.secretLines, recentCommandLine].join("\n");
    }

    const tonalReplies = personalityProfile.tonalReplies;
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

  async _runProviderReply({ prompt, contextSummary, conversationSnapshot, provider, botProfile, persona }) {
    const systemInstruction = {
      parts: [
        {
          text: this._buildSystemPrompt(contextSummary, conversationSnapshot, botProfile, persona),
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

    const response = await provider.askText(null, {
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

  async _sendChatMessage({ sessionId, message, context = {}, botId }) {
    const botProfile = this._getBotProfile(botId);
    const provider = this._getProvider(botProfile);
    const session = this._getSession(sessionId);
    const contextSummary = this._normalizeTerminalContext(context);
    const persona = await this._resolveActivePersona(context);
    const conversationSnapshot = this._buildConversationSnapshot(session);
    const prompt = this._sanitizeMessage(message);

    session.active = true;
    session.lastContext = clone(contextSummary);

    session.messages.push({ role: "user", content: prompt });
    session.messages = trimMessages(session.messages);

    let reply;
    try {
      if (provider.providerName === "mock") {
        reply = this._buildMockReply({ prompt, contextSummary, conversationSnapshot: session.messages, persona });
      } else {
        reply = await this._runProviderReply({ prompt, contextSummary, conversationSnapshot, provider, botProfile, persona });
      }
    } catch (error) {
      logWarning("Porky message generation failed", { error: error.message || error });
      throw error;
    }

    session.messages.push({ role: "assistant", content: reply });
    session.messages = trimMessages(session.messages);
    this._touchSession(session);

    this._logConversationEvent(
      "message processed",
      this._buildConversationLogData(session, provider, contextSummary, { prompt, reply }, botProfile, persona),
      {
        contextSummary,
        persona,
        conversation: this._buildConversationLogSnapshot(session),
      },
    );

    return {
      botId: botProfile.id,
      sessionId: session.id,
      provider: provider.providerName,
      active: session.active,
      reply,
      persona,
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

  async startConversation({ sessionId, context = {}, botId } = {}) {
    const botProfile = this._getBotProfile(botId);
    const provider = this._getProvider(botProfile);
    const session = this._getSession(sessionId);
    const contextSummary = this._normalizeTerminalContext(context);
    const persona = await this._resolveActivePersona(context);

    session.active = true;
    session.messages = [];
    session.lastContext = clone(contextSummary);
    this._touchSession(session);

    const reply = this._buildGreeting(contextSummary, persona);

    session.messages.push({ role: "assistant", content: reply });
    session.messages = trimMessages(session.messages);
    this._touchSession(session);

    this._logConversationEvent(
      "conversation started",
      this._buildConversationLogData(session, provider, contextSummary, { reply }, botProfile, persona),
      {
        contextSummary,
        persona,
        conversation: this._buildConversationLogSnapshot(session),
      },
    );

    return {
      botId: botProfile.id,
      sessionId: session.id,
      provider: provider.providerName,
      active: true,
      reply,
      persona,
      contextSummary: {
        mode: contextSummary.mode,
        theme: contextSummary.theme,
        currentPath: contextSummary.currentPath,
        availableCommandsCount: contextSummary.availableCommands.length,
      },
    };
  }

  async getStatus({ sessionId, context = {}, botId } = {}) {
    const botProfile = this._getBotProfile(botId);
    const provider = this._getProvider(botProfile);
    const normalizedSessionId = normalizeSessionId(sessionId);
    const persona = await this._resolveActivePersona(context);
    const session = this.sessions.get(normalizedSessionId) || {
      id: normalizedSessionId,
      active: false,
      createdAt: null,
      updatedAt: null,
      messages: [],
      lastContext: {},
    };
    const contextSummary = this._normalizeTerminalContext(context);

    const status = this._buildStatusSnapshot(session, provider, contextSummary, botProfile, persona);

    this._logConversationEvent(
      "status requested",
      {
        botId: botProfile.id,
        sessionId: session.id,
        provider: provider.providerName,
        active: status.active,
        mode: status.mode,
        theme: status.theme,
        personaId: persona.id,
        personaSource: persona.source,
        conversationMessages: status.conversationMessages,
        estimatedTokenUsage: status.estimatedTokenUsage,
        estimatedTokenLimit: status.estimatedTokenLimit,
      },
      {
        status,
        persona,
        contextSummary,
      },
    );

    return {
      botId: botProfile.id,
      sessionId: session.id,
      provider: provider.providerName,
      active: status.active,
      reply: this._buildStatusReply(status),
      persona,
      status,
    };
  }

  async sendMessage({ sessionId, message, context = {}, botId } = {}) {
    return this._sendChatMessage({ sessionId, message, context, botId });
  }

  async endConversation({ sessionId, context = {}, botId } = {}) {
    const botProfile = this._getBotProfile(botId);
    const provider = this._getProvider(botProfile);
    const normalizedSessionId = normalizeSessionId(sessionId);
    const session = this.sessions.get(normalizedSessionId);
    const contextSummary = this._normalizeTerminalContext(context);
    const persona = await this._resolveActivePersona(context);

    if (session) {
      this.sessions.delete(normalizedSessionId);
    }

    this._logConversationEvent(
      "conversation ended",
      {
        botId: botProfile.id,
        sessionId: normalizedSessionId,
        provider: provider.providerName,
        active: false,
        mode: contextSummary.mode,
        theme: contextSummary.theme,
        personaId: persona.id,
        personaSource: persona.source,
      },
      {
        persona,
        contextSummary,
      },
    );

    return {
      botId: botProfile.id,
      sessionId: normalizedSessionId,
      provider: provider.providerName,
      active: false,
      reply: this._buildFarewell(),
      persona,
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
