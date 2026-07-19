const { buildCoreIntentReply } = require("../farm-replies");

/**
 * Catch-all — always matches, so it must be registered last. Returns the
 * grounded farm summary plus a hint about the playful modes, matching the mock's
 * long-standing default reply.
 */
module.exports = {
  id: "fallback",
  match() {
    return true;
  },
  respond({ normalizedPrompt, context }) {
    return buildCoreIntentReply(normalizedPrompt, context);
  },
};
