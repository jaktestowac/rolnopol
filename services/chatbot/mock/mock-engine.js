const MockTools = require("./tools-facade");
const { logWarning } = require("../../../helpers/logger-api");

/**
 * MockEngine — resolves a user prompt to the first matching intent and runs it.
 *
 * Intents are plain modules ({ id, match(normalizedPrompt, context), respond(ctx) })
 * evaluated in order; the first whose match() returns truthy wins, so ordering
 * encodes priority (specific intents first, a catch-all fallback last). Each
 * intent gets a MockTools facade so it can pull real (simulated) data, plus the
 * raw + normalized prompt, the farm context, and the userId.
 *
 * To add behavior: drop a new module in ./intents and register it in
 * ./intents/index.js at the desired priority. Nothing else needs to change.
 */
class MockEngine {
  constructor({ intents } = {}) {
    this.intents = Array.isArray(intents) ? intents : [];
  }

  _resolveIntent(normalizedPrompt, context) {
    for (const intent of this.intents) {
      try {
        if (intent && typeof intent.match === "function" && intent.match(normalizedPrompt, context)) {
          return intent;
        }
      } catch (error) {
        logWarning(`Mock intent '${intent && intent.id}' match() threw; skipping.`, { error: error.message || error });
      }
    }
    return null;
  }

  async respond({ prompt, context, userId }) {
    const safeContext = context || {};
    const normalizedPrompt = String(prompt || "").toLowerCase();
    const tools = new MockTools(userId, { ...safeContext, userId });

    const intent = this._resolveIntent(normalizedPrompt, safeContext);

    if (!intent) {
      return { text: "I'm not sure how to help with that yet. Try asking about your fields, weather, prices, or alerts.", intentId: null, toolsUsed: [] };
    }

    try {
      const text = await intent.respond({ prompt, normalizedPrompt, context: safeContext, tools, userId });
      return { text: String(text == null ? "" : text), intentId: intent.id, toolsUsed: tools.used };
    } catch (error) {
      logWarning(`Mock intent '${intent.id}' respond() failed; using graceful fallback.`, { error: error.message || error });
      return {
        text: "I ran into a snag pulling that together. Please try rephrasing, or ask about your fields, staff, or animals.",
        intentId: intent.id,
        toolsUsed: tools.used,
      };
    }
  }
}

module.exports = MockEngine;
