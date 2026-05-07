const GeminiProvider = require("../providers/gemini.provider");
const BaseLlmConnector = require("./base-llm.connector");

class GeminiLlmConnector extends BaseLlmConnector {
  constructor(provider = new GeminiProvider(), options = {}) {
    super(provider, "gemini", options);
  }
}

module.exports = GeminiLlmConnector;
