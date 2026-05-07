const farmAssistantBot = require("./farm-assistant.bot");
const terminalPorkyBot = require("./terminal-porky.bot");

const DEFAULT_BOT_ID = "farm-assistant";
const TERMINAL_PORKY_BOT_ID = "terminal-porky";

const BOT_PROFILES = Object.freeze({
  [farmAssistantBot.id]: farmAssistantBot,
  [terminalPorkyBot.id]: terminalPorkyBot,
});

function normalizeBotId(botId, fallbackId = DEFAULT_BOT_ID) {
  const normalized = typeof botId === "string" ? botId.trim() : "";
  return normalized || fallbackId;
}

function listBotProfiles() {
  return Object.values(BOT_PROFILES);
}

function hasBotProfile(botId) {
  return Object.prototype.hasOwnProperty.call(BOT_PROFILES, normalizeBotId(botId, ""));
}

function getBotProfile(botId, fallbackId = DEFAULT_BOT_ID) {
  const resolvedBotId = normalizeBotId(botId, fallbackId);
  const profile = BOT_PROFILES[resolvedBotId];

  if (!profile) {
    throw new Error(`Validation failed: unknown botId '${resolvedBotId}'`);
  }

  return profile;
}

module.exports = {
  BOT_PROFILES,
  DEFAULT_BOT_ID,
  TERMINAL_PORKY_BOT_ID,
  normalizeBotId,
  listBotProfiles,
  hasBotProfile,
  getBotProfile,
};
