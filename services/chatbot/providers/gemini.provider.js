const DEFAULT_GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_TIMEOUT_MS = 30_000;
const DEFAULT_GEMINI_RETRIES = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class GeminiProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    this.model = options.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    this.apiBaseUrl = options.apiBaseUrl ?? process.env.GEMINI_API_BASE_URL ?? DEFAULT_GEMINI_API_BASE_URL;
    this.timeoutMs = Number(options.timeoutMs ?? process.env.GEMINI_TIMEOUT_MS ?? DEFAULT_GEMINI_TIMEOUT_MS);
    this.retries = Number(options.retries ?? process.env.GEMINI_RETRIES ?? DEFAULT_GEMINI_RETRIES);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isConfigured() {
    return Boolean(this.apiKey && String(this.apiKey).trim() && this.model && String(this.model).trim());
  }

  ensureConfigured() {
    if (!this.apiKey || !String(this.apiKey).trim()) {
      throw new Error("Missing GEMINI_API_KEY. Add it to .env (you can copy from .env.example).");
    }

    if (!this.model || !String(this.model).trim()) {
      throw new Error("Missing GEMINI_MODEL. Add it to .env (you can copy from .env.example).");
    }
  }

  _buildUrl(action = "generateContent") {
    return `${this.apiBaseUrl}/models/${encodeURIComponent(this.model)}:${action}`;
  }

  async _requestWithTimeout(url, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  _isRetryableStatus(status) {
    return status === 429 || status >= 500;
  }

  _extractCandidateText(data) {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      return "";
    }

    return parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
  }

  async callGemini(payload) {
    this.ensureConfigured();
    const url = this._buildUrl();

    let lastError;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await this._requestWithTimeout(url, payload);
        const data = await response.json();

        if (!response.ok) {
          const message = data?.error?.message || `Gemini request failed (${response.status})`;
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
      }
    }

    throw lastError || new Error("Gemini request failed without detailed error.");
  }

  async askText(prompt, options = {}) {
    const data = await this.callGemini({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: options.generationConfig,
      systemInstruction: options.systemInstruction,
    });

    const text = this._extractCandidateText(data);

    return {
      text: text || "No text returned by model.",
      raw: data,
      usage: data?.usageMetadata,
    };
  }
}

module.exports = GeminiProvider;
