const MockEngine = require("./mock-engine");
const intents = require("./intents");

/**
 * Singleton mock engine wired with the default intent registry. Import this and
 * call `.respond({ prompt, context, userId })` to get a believable, tool-backed
 * mock reply. Used by the mock LLM connector for both blocking and streamed
 * responses.
 */
module.exports = new MockEngine({ intents });
