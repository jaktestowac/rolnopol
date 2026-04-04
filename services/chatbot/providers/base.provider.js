const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { logWarning } = require("../../../helpers/logger-api");

/**
 * BaseProvider - Abstract parent class for LLM providers
 * Handles common configuration, retry logic, and request patterns
 */
class BaseProvider {
  constructor(options = {}, providerConfig = {}) {
    this.providerName = providerConfig.name;
    this.envKeyPrefix = providerConfig.envKeyPrefix; // e.g., "GEMINI", "OPENROUTER"
    this.defaultModel = providerConfig.defaultModel;
    this.defaultApiBaseUrl = providerConfig.defaultApiBaseUrl;
    this.defaultTimeoutMs = providerConfig.defaultTimeoutMs ?? 30_000;
    this.defaultRetries = providerConfig.defaultRetries ?? 2;

    // Circuit breaker config
    this.failureCount = 0;
    this.failureThreshold = Number(options.failureThreshold ?? 5);
    this.cooldownMs = Number(options.cooldownMs ?? 30_000);
    this.circuitOpen = false;
    this.nextAttemptAt = 0;

    // Load configuration from options or env
    this.apiKey = options.apiKey ?? this._getEnvVar("API_KEY");
    this.model = options.model ?? this._getEnvVar("MODEL") ?? this.defaultModel;
    this.apiBaseUrl = options.apiBaseUrl ?? this._getEnvVar("API_BASE_URL") ?? this.defaultApiBaseUrl;
    this.timeoutMs = Number(options.timeoutMs ?? this._getEnvVar("TIMEOUT_MS") ?? this.defaultTimeoutMs);
    this.retries = Number(options.retries ?? this._getEnvVar("RETRIES") ?? this.defaultRetries);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  _getEnvVar(suffix) {
    const envKey = `${this.envKeyPrefix}_${suffix}`;
    return process.env[envKey];
  }

  _getRetryDelay(attempt) {
    const base = 300 * (attempt + 1);
    const jitter = Math.random() * base * 0.4; // +/-20%
    return Math.floor(base + jitter - base * 0.2);
  }

  _checkCircuit() {
    if (!this.circuitOpen) return;
    if (Date.now() >= this.nextAttemptAt) {
      this.circuitOpen = false;
      this.failureCount = 0;
      return;
    }
    throw new Error(`${this.providerName} circuit is open; unavailable temporarily`);
  }

  isConfigured() {
    return Boolean(this.apiKey && String(this.apiKey).trim() && this.model && String(this.model).trim());
  }

  ensureConfigured() {
    if (!this.apiKey || !String(this.apiKey).trim()) {
      throw new Error(`Missing ${this.envKeyPrefix}_API_KEY. Add it to .env (you can copy from .env.example).`);
    }

    if (!this.model || !String(this.model).trim()) {
      throw new Error(`Missing ${this.envKeyPrefix}_MODEL. Add it to .env (you can copy from .env.example).`);
    }
  }

  _isRetryableStatus(status) {
    return status === 429 || status >= 500;
  }

  /**
   * Template method for building request URL - override in subclass
   */
  _buildUrl() {
    throw new Error("_buildUrl() must be implemented by subclass");
  }

  /**
   * Template method for building request headers - override in subclass
   */
  _buildHeaders() {
    throw new Error("_buildHeaders() must be implemented by subclass");
  }

  /**
   * Template method for extracting response text - override in subclass
   */
  _extractText(data) {
    throw new Error("_extractText() must be implemented by subclass");
  }

  /**
   * Template method for extracting tool/function calls - override in subclass if provider supports it
   * Should return array of { name, arguments } or null if no tool calls
   */
  _extractToolCalls(data) {
    return null; // Override in subclass if provider supports tool calling
  }

  /**
   * Check if response indicates a tool/function call is needed
   */
  _hasToolCall(data) {
    const toolCalls = this._extractToolCalls(data);
    return toolCalls && toolCalls.length > 0;
  }

  /**
   * Make HTTP request with timeout handling
   */
  async _requestWithTimeout(url, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(url, {
        method: "POST",
        headers: this._buildHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Make API call with retry logic
   */
  async _callApiWithRetry(buildPayloadFn, extractFn) {
    this.ensureConfigured();
    const url = this._buildUrl();
    let lastError;

    this._checkCircuit();

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const payload = buildPayloadFn();
        const response = await this._requestWithTimeout(url, payload);
        const data = await response.json();

        if (!response.ok) {
          const message = data?.error?.message || `${this.providerName} request failed (${response.status})`;
          const error = new Error(message);
          error.status = response.status;

          if (attempt < this.retries && this._isRetryableStatus(response.status)) {
            const delay = this._getRetryDelay(attempt);
            await sleep(delay);
            continue;
          }

          throw error;
        }

        return data;
      } catch (error) {
        lastError = error;
        const isAbort = error?.name === "AbortError";

        if (attempt < this.retries && (isAbort || !error?.status)) {
          const delay = this._getRetryDelay(attempt);
          await sleep(delay);
          continue;
        }

        this.failureCount += 1;
        if (this.failureCount >= this.failureThreshold) {
          this.circuitOpen = true;
          this.nextAttemptAt = Date.now() + this.cooldownMs;
          logWarning(`${this.providerName} circuit opened due to repeated failures. Cooling down for ${this.cooldownMs}ms.`);
        }

        throw lastError;
      }
    }

    this.failureCount = 0;
    if (lastError) {
      throw lastError;
    }

    throw new Error(`${this.providerName} request failed after ${this.retries + 1} attempts`);
  }

  /**
   * Convert provider-specific error response format to standardized text
   */
  _parseToolArguments(rawArgs) {
    if (rawArgs === undefined || rawArgs === null) {
      return {};
    }

    if (typeof rawArgs === "object") {
      return rawArgs;
    }

    if (typeof rawArgs === "string") {
      try {
        return JSON.parse(rawArgs);
      } catch (error) {
        logWarning("Failed to parse tool arguments, using empty object", {
          rawArgs,
          error: error.message,
        });
        return {};
      }
    }

    logWarning("Unexpected tool argument type, using empty object", {
      rawArgs,
      type: typeof rawArgs,
    });
    return {};
  }

  async askText(userMessage, options = {}) {
    throw new Error("askText() must be implemented by subclass");
  }
}

module.exports = BaseProvider;
