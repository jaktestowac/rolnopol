const MAX_LLM_CONSOLE_LOG_LEVEL = 2;

function formatTimestamp() {
  return new Date().toISOString();
}

function getLlmConsoleLogLevel() {
  const parsedLevel = Number.parseInt(process.env.LLM_CONSOLE_LOG_LEVEL ?? "0", 10);

  if (Number.isNaN(parsedLevel)) {
    return 0;
  }

  return Math.max(0, Math.min(MAX_LLM_CONSOLE_LOG_LEVEL, parsedLevel));
}

function safeStringify(value) {
  const seen = new WeakSet();

  return JSON.stringify(
    value,
    (key, currentValue) => {
      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }

        seen.add(currentValue);
      }

      return currentValue;
    },
    2,
  );
}

function logInfo(message, data = null) {
  if (getLlmConsoleLogLevel() < 1) {
    return;
  }

  const timestamp = formatTimestamp();
  console.log(`[INFO] ${timestamp} - ${message}`);

  if (data) {
    console.log("[INFO]    Data:", safeStringify(data));
  }
}

function logTrace(message, data = null) {
  if (getLlmConsoleLogLevel() < 2) {
    return;
  }

  const timestamp = formatTimestamp();
  console.log(`[TRACE] ${timestamp} - ${message}`);

  if (data) {
    console.log("[TRACE]    Data:", safeStringify(data));
  }
}

function getPromptPreview(request = {}) {
  if (typeof request.prompt === "string" && request.prompt.trim()) {
    return request.prompt.trim();
  }

  if (typeof request.text === "string" && request.text.trim()) {
    return request.text.trim();
  }

  if (Array.isArray(request.messages)) {
    const lastUserMessage = [...request.messages]
      .reverse()
      .find((message) => message && message.role === "user" && typeof message.content === "string");

    if (lastUserMessage?.content?.trim()) {
      return lastUserMessage.content.trim();
    }
  }

  return "[no prompt available]";
}

function getResponsePreview(response = {}) {
  if (typeof response.text === "string" && response.text.trim()) {
    return response.text.trim();
  }

  if (typeof response.reply === "string" && response.reply.trim()) {
    return response.reply.trim();
  }

  return "[no response text available]";
}

function logLlmRequest(request = {}) {
  const level = getLlmConsoleLogLevel();

  if (level === 0) {
    return;
  }

  if (level === 1) {
    console.log(`[LLM] request: ${getPromptPreview(request)}`);
    return;
  }

  console.log(`[LLM] request:\n${safeStringify(request)}`);
}

function logLlmResponse(response = {}) {
  const level = getLlmConsoleLogLevel();

  if (level === 0) {
    return;
  }

  if (level === 1) {
    console.log(`[LLM] response: ${getResponsePreview(response)}`);
    return;
  }

  console.log(`[LLM] response:\n${safeStringify(response)}`);
}

module.exports = {
  getLlmConsoleLogLevel,
  logInfo,
  logTrace,
  logLlmRequest,
  logLlmResponse,
  safeStringify,
};
