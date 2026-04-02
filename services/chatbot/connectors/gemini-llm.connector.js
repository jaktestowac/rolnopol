const GeminiProvider = require("../providers/gemini.provider");
const BaseLlmConnector = require("./base-llm.connector");

class GeminiLlmConnector extends BaseLlmConnector {
  constructor(provider = new GeminiProvider()) {
    super(provider, "gemini");
  }
}

module.exports = GeminiLlmConnector;
