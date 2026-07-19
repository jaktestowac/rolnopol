const ToolsExecutor = require("../tools/tools-executor");

/**
 * Thin wrapper around the real ToolsExecutor for use by mock intents. It runs
 * the same tools the LLM connectors use (weather, alerts, farm context, …), so
 * the mock's answers are backed by real (simulated) data rather than being
 * hard-coded. Usage is recorded so callers/tests can see which tools ran.
 */
class MockTools {
  constructor(userId, context) {
    this.executor = new ToolsExecutor(userId, context);
    this.used = [];
  }

  async call(toolName, args = {}) {
    this.used.push(toolName);
    try {
      return await this.executor.execute(toolName, args);
    } catch (error) {
      return { error: error && error.message ? error.message : String(error) };
    }
  }
}

module.exports = MockTools;
