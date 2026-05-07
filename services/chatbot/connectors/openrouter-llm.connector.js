const OpenRouterProvider = require("../providers/openrouter.provider");
const BaseLlmConnector = require("./base-llm.connector");

class OpenRouterLlmConnector extends BaseLlmConnector {
  constructor(provider = new OpenRouterProvider(), options = {}) {
    super(provider, "openrouter", options);
  }
}

module.exports = OpenRouterLlmConnector;
