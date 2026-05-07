function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createBotProfile(config = {}) {
  const id = normalizeString(config.id);
  const name = normalizeString(config.name);
  const systemPrompt = normalizeString(config.systemPrompt);

  if (!id) {
    throw new Error("Bot profile requires a non-empty id");
  }

  if (!name) {
    throw new Error(`Bot profile '${id}' requires a non-empty name`);
  }

  if (!systemPrompt) {
    throw new Error(`Bot profile '${id}' requires a non-empty systemPrompt`);
  }

  return Object.freeze({
    id,
    name,
    description: normalizeString(config.description),
    surface: normalizeString(config.surface) || "api",
    featureFlag: normalizeString(config.featureFlag) || null,
    requiresAuth: config.requiresAuth !== false,
    supportsTools: config.supportsTools !== false,
    systemPrompt,
    shortReply: normalizeString(config.shortReply) || null,
    provider: normalizeString(config.provider) || null,
    providerOptions:
      config.providerOptions && typeof config.providerOptions === "object" ? Object.freeze({ ...config.providerOptions }) : null,
    metadata: config.metadata && typeof config.metadata === "object" ? Object.freeze({ ...config.metadata }) : Object.freeze({}),
  });
}

module.exports = {
  createBotProfile,
};
