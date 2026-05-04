(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.TerminalApiClient = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  function toStringValue(value) {
    return value == null ? "" : String(value);
  }

  function generateSessionId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function encodePath(path) {
    return toStringValue(path)
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  class TerminalApiError extends Error {
    constructor(message, options = {}) {
      super(message || "Terminal backend request failed");
      this.name = "TerminalApiError";
      this.status = Number.isFinite(options.status) ? options.status : 0;
      this.code = toStringValue(options.code || "TERMINAL_API_ERROR") || "TERMINAL_API_ERROR";
      this.url = toStringValue(options.url);
      this.endpoint = toStringValue(options.endpoint);
      this.responseData = options.responseData;
      this.retriable = options.retriable === true;
      this.hint = toStringValue(options.hint);
    }

    toCommandResult(fallbackHint) {
      const responseMetadata = this.responseData?.error?.metadata || this.responseData?.details?.metadata || null;

      return {
        type: "error",
        content: this.message || "Terminal backend request failed.",
        metadata: {
          code: this.code,
          status: this.status,
          hint: this.hint || fallbackHint || 'Type "help" to see available commands.',
          ...(responseMetadata && typeof responseMetadata === "object" ? responseMetadata : {}),
        },
      };
    }
  }

  class TerminalApiClient {
    constructor(options = {}) {
      this.baseUrl =
        options.baseUrl ||
        (typeof window !== "undefined" && window.location && window.location.protocol === "file:" ? "http://localhost:3000" : "");
      this.apiVersion = options.apiVersion || "v1";
      this.defaultTimeout = Number.isFinite(options.timeout) ? Math.max(1, options.timeout) : 12000;
      this.retries = Number.isFinite(options.retries) ? Math.max(0, options.retries) : 1;
      this.fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
      this.sessionId = toStringValue(options.sessionId) || generateSessionId();
      this.defaultHeaders = {
        "Content-Type": "application/json",
        ...(options.defaultHeaders || {}),
      };
      this.onRequestStatusChange = typeof options.onRequestStatusChange === "function" ? options.onRequestStatusChange : null;

      if (!this.fetchImpl) {
        throw new Error("fetch is required for TerminalApiClient");
      }
    }

    getSessionId() {
      return this.sessionId;
    }

    setSessionId(sessionId) {
      this.sessionId = toStringValue(sessionId) || this.sessionId;
      return this.sessionId;
    }

    getApiUrl(endpoint) {
      const cleanEndpoint = toStringValue(endpoint).replace(/^\/+/, "");
      return `${this.baseUrl}/api/${this.apiVersion}/${cleanEndpoint}`;
    }

    async _parseResponse(response) {
      const contentType = toStringValue(response.headers?.get?.("content-type")).toLowerCase();

      if (contentType.includes("application/json") && typeof response.json === "function") {
        return response.json();
      }

      if (typeof response.text === "function") {
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch (_) {
          return { success: response.ok, data: text };
        }
      }

      return { success: response.ok };
    }

    _buildTimeoutSignal(timeout) {
      const duration = Number.isFinite(timeout) ? Math.max(1, timeout) : this.defaultTimeout;

      if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
        return AbortSignal.timeout(duration);
      }

      const controller = new AbortController();
      setTimeout(() => controller.abort(), duration);
      return controller.signal;
    }

    _buildErrorFromResponse(response, data, endpoint, url) {
      const responseError = data?.error;
      const message =
        (responseError && typeof responseError === "object" && (responseError.message || responseError.error)) ||
        (typeof responseError === "string" ? responseError : null) ||
        data?.message ||
        response.statusText ||
        `HTTP ${response.status}`;

      return new TerminalApiError(message, {
        status: response.status,
        code: (responseError && typeof responseError === "object" && responseError.code) || data?.code || `HTTP_${response.status}`,
        endpoint,
        url,
        responseData: data,
        hint: (responseError && typeof responseError === "object" && responseError.hint) || data?.hint,
        retriable: response.status >= 500 || response.status === 429,
      });
    }

    async request(method, endpoint, options = {}) {
      const timeout = Number.isFinite(options.timeout) ? Math.max(1, options.timeout) : this.defaultTimeout;
      const retries = Number.isFinite(options.retries) ? Math.max(0, options.retries) : this.retries;
      const attempts = retries + 1;
      const headers = { ...this.defaultHeaders, ...(options.headers || {}) };
      let url = this.getApiUrl(endpoint);

      if (options.query && typeof options.query === "object") {
        const queryParams = new URLSearchParams();
        Object.entries(options.query).forEach(([key, value]) => {
          if (value === undefined || value === null || value === "") return;
          queryParams.set(key, String(value));
        });
        const qs = queryParams.toString();
        if (qs) {
          url = `${url}?${qs}`;
        }
      }

      let lastError = null;

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          if (this.onRequestStatusChange) {
            this.onRequestStatusChange({
              status: "pending",
              attempt,
              attempts,
              endpoint,
              method,
            });
          }

          const requestOptions = {
            method,
            headers,
            signal: this._buildTimeoutSignal(timeout),
            credentials: "include",
          };

          if (method !== "GET" && options.body !== undefined) {
            requestOptions.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
          }

          const response = await this.fetchImpl(url, requestOptions);
          const data = await this._parseResponse(response);

          if (!response.ok) {
            throw this._buildErrorFromResponse(response, data, endpoint, url);
          }

          if (this.onRequestStatusChange) {
            this.onRequestStatusChange({
              status: "fulfilled",
              attempt,
              attempts,
              endpoint,
              method,
            });
          }

          return data;
        } catch (error) {
          lastError =
            error instanceof TerminalApiError
              ? error
              : new TerminalApiError(error?.message || "Terminal backend request failed", {
                  endpoint,
                  url,
                  code: error?.code || (error?.name === "AbortError" ? "REQUEST_TIMEOUT" : "NETWORK_ERROR"),
                  status: error?.name === "AbortError" ? 408 : 0,
                  retriable: error?.name === "AbortError" || error?.name === "TypeError",
                });

          const shouldRetry = attempt < attempts && lastError.retriable;

          if (!shouldRetry) {
            if (this.onRequestStatusChange) {
              this.onRequestStatusChange({
                status: "rejected",
                attempt,
                attempts,
                endpoint,
                method,
                error: lastError,
              });
            }

            throw lastError;
          }
        }
      }

      throw lastError || new TerminalApiError("Terminal backend request failed", { endpoint, url, status: 0 });
    }

    async requestData(method, endpoint, options = {}) {
      const response = await this.request(method, endpoint, options);
      if (response && typeof response === "object" && Object.prototype.hasOwnProperty.call(response, "data")) {
        return response.data;
      }
      return response;
    }

    getCommands(options = {}) {
      return this.requestData("GET", "terminal/commands", options);
    }

    executeCommand(input, context = {}, options = {}) {
      return this.requestData("POST", "terminal/execute", {
        ...options,
        body: {
          input,
          sessionId: context.sessionId || this.sessionId,
          context: context.context || context,
        },
      });
    }

    getScript(scriptId, options = {}) {
      return this.requestData("GET", `terminal/scripts/${encodeURIComponent(toStringValue(scriptId))}`, options);
    }

    listScripts(options = {}) {
      return this.requestData("GET", "terminal/scripts", options);
    }

    listAssets(options = {}) {
      return this.requestData("GET", "terminal/assets", options);
    }

    getAsset(assetId, options = {}) {
      return this.requestData("GET", `terminal/assets/${encodeURIComponent(toStringValue(assetId))}`, options);
    }

    listFiles(options = {}) {
      return this.requestData("GET", "terminal/files", options);
    }

    getVirtualFile(path, options = {}) {
      return this.requestData("GET", `terminal/files/${encodePath(path)}`, options);
    }

    startPorkyConversation(context = {}, options = {}) {
      return this.requestData("POST", "terminal/porky/start", {
        ...options,
        body: {
          sessionId: context.sessionId || this.sessionId,
          context: context.context || context,
        },
      });
    }

    sendPorkyMessage(message, context = {}, options = {}) {
      return this.requestData("POST", "terminal/porky/message", {
        ...options,
        body: {
          sessionId: context.sessionId || this.sessionId,
          message,
          context: context.context || context,
        },
      });
    }

    getPorkyStatus(context = {}, options = {}) {
      return this.requestData("POST", "terminal/porky/status", {
        ...options,
        body: {
          sessionId: context.sessionId || this.sessionId,
          context: context.context || context,
        },
      });
    }

    endPorkyConversation(context = {}, options = {}) {
      return this.requestData("POST", "terminal/porky/end", {
        ...options,
        body: {
          sessionId: context.sessionId || this.sessionId,
          context: context.context || context,
        },
      });
    }
  }

  function createTerminalApiClient(options = {}) {
    return new TerminalApiClient(options);
  }

  return {
    TerminalApiClient,
    TerminalApiError,
    createTerminalApiClient,
  };
});
