const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
            await sleep(300 * (attempt + 1));
            continue;
          }

          throw error;
        }

        return data;
      } catch (error) {
        lastError = error;
        const isAbort = error?.name === "AbortError";

        if (attempt < this.retries && (isAbort || !error?.status)) {
          await sleep(300 * (attempt + 1));
          continue;
        }

        throw lastError;
      }
    }

    throw lastError;
  }

  /**
   * Convert provider-specific error response format to standardized text
   */
  async askText(userMessage, options = {}) {
    throw new Error("askText() must be implemented by subclass");
  }
}

module.exports = BaseProvider;
