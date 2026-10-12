/**
 * WebMCP integration
 * Exposes Rolnopol actions as WebMCP tools (https://webmachinelearning.github.io/webmcp/)
 * so an AI agent in the browser can call them instead of driving the UI.
 *
 * app.js loads this file (and the tool groups in /js/webmcp/tools/) only when the
 * browser exposes a model context. Nothing is registered unless the
 * `webMcpEnabled` feature flag is on.
 */
(function (root) {
  "use strict";

  const TOOL_PREFIX = "rolnopol.";
  const toolGroups = new Map();

  /**
   * Resolve the browser's ModelContext. The current draft puts it on
   * `document.modelContext`; early Chrome previews exposed `navigator.modelContext`.
   */
  function getModelContext(scope) {
    const target = scope || root;
    if (target?.document?.modelContext) return target.document.modelContext;
    if (target?.navigator?.modelContext) return target.navigator.modelContext;
    return null;
  }

  /**
   * Register a group of tools.
   * @param {string} name - Group name
   * @param {Object} group
   * @param {string[]|"*"} group.pages - Page names (as in app.js) the group applies to, or "*" for every page
   * @param {Function} group.tools - (service) => tool definitions. Besides the WebMCP fields
   *   (name without the "rolnopol." prefix, title, description, inputSchema, annotations, execute),
   *   a definition may set `flag` (flag name or array of names that must all be on) and
   *   `auth` ("required" = logged-in users only, "anonymous" = logged-out users only).
   */
  function defineToolGroup(name, group) {
    toolGroups.set(name, group);
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validateValue(schema, value, path, errors) {
    if (!schema) return;

    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      errors.push(`${path} must be one of: ${schema.enum.join(", ")}`);
      return;
    }

    switch (schema.type) {
      case "object": {
        if (!isPlainObject(value)) {
          errors.push(`${path} must be an object`);
          return;
        }
        for (const key of schema.required || []) {
          if (value[key] === undefined || value[key] === null) {
            errors.push(`${path}.${key} is required`);
          }
        }
        for (const [key, propValue] of Object.entries(value)) {
          const propSchema = schema.properties?.[key];
          if (!propSchema) {
            if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
            continue;
          }
          if (propValue === undefined || propValue === null) continue;
          validateValue(propSchema, propValue, `${path}.${key}`, errors);
        }
        return;
      }
      case "string":
        if (typeof value !== "string") {
          errors.push(`${path} must be a string`);
          return;
        }
        if (schema.minLength !== undefined && value.length < schema.minLength) {
          errors.push(`${path} must be at least ${schema.minLength} characters`);
        }
        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
          errors.push(`${path} must be at most ${schema.maxLength} characters`);
        }
        if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) {
          errors.push(`${path} has an invalid format`);
        }
        return;
      case "integer":
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) {
          errors.push(`${path} must be ${schema.type === "integer" ? "an integer" : "a number"}`);
          return;
        }
        if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
        if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
          errors.push(`${path} must be > ${schema.exclusiveMinimum}`);
        }
        if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
        return;
      case "boolean":
        if (typeof value !== "boolean") errors.push(`${path} must be a boolean`);
        return;
      case "array":
        if (!Array.isArray(value)) {
          errors.push(`${path} must be an array`);
          return;
        }
        if (schema.maxItems !== undefined && value.length > schema.maxItems) {
          errors.push(`${path} must have at most ${schema.maxItems} items`);
        }
        value.forEach((item, index) => validateValue(schema.items, item, `${path}[${index}]`, errors));
        return;
      default:
        return;
    }
  }

  /**
   * Validate tool input against the subset of JSON Schema the Rolnopol tools use.
   * Browsers are not required to validate input before calling execute().
   * @returns {string[]} Validation errors (empty when valid)
   */
  function validateInput(schema, input) {
    const errors = [];
    validateValue(schema || { type: "object" }, input === undefined ? {} : input, "input", errors);
    return errors;
  }

  /** Unwrap the `{ success, data }` envelope every Rolnopol endpoint returns. */
  function unwrapResponseData(responseData) {
    if (isPlainObject(responseData) && Object.prototype.hasOwnProperty.call(responseData, "data")) {
      return responseData.data;
    }
    return responseData;
  }

  class WebMcpService {
    /**
     * @param {Object} options
     * @param {Object} options.app - window.App
     * @param {string} options.page - Current page name (as in app.js)
     * @param {Object} [options.modelContext] - Defaults to the browser's ModelContext
     * @param {Object} [options.document] - Defaults to window.document (used for the confirmation dialog)
     */
    constructor({ app, page, modelContext, document: doc } = {}) {
      this.app = app;
      this.page = page;
      this.modelContext = modelContext || getModelContext();
      this.document = doc || root.document;
      this.apiService = app?.getModule?.("apiService") || null;
      this.authService = app?.getModule?.("authService") || null;
      this.eventBus = app?.getEventBus?.() || null;
      this.flags = {};
      this.controller = null;
      this.registeredTools = [];
      this._flagsListenerAttached = false;
    }

    get supported() {
      return !!(this.modelContext && typeof this.modelContext.registerTool === "function");
    }

    /**
     * Load flags and register the tools for the current page.
     * @returns {Promise<boolean>} True when tools were registered
     */
    async start() {
      if (!this.supported || !this.apiService) return false;

      await this.loadFlags();
      this._attachFlagsListener();

      if (!this.isEnabled("webMcpEnabled")) return false;

      await this.registerAll();
      return true;
    }

    /** Unregister every tool this service registered. */
    stop() {
      if (this.controller) {
        this.controller.abort();
        this.controller = null;
      }
      this.registeredTools = [];
    }

    async restart() {
      this.stop();
      await this.loadFlags();
      if (this.isEnabled("webMcpEnabled")) {
        await this.registerAll();
      }
    }

    async loadFlags() {
      const result = await this.call("GET", "feature-flags", { requiresAuth: false });
      this.flags = result.ok && isPlainObject(result.data?.flags) ? result.data.flags : {};
      return this.flags;
    }

    isEnabled(flag) {
      return this.flags[flag] === true;
    }

    isAuthenticated() {
      return !!this.authService?.isAuthenticated?.();
    }

    getModule(name) {
      return this.app?.getModule?.(name) || null;
    }

    /**
     * Collect the tool definitions that apply to the current page, user and flags.
     */
    getApplicableTools() {
      const authenticated = this.isAuthenticated();
      const tools = [];

      for (const group of toolGroups.values()) {
        const pages = group.pages;
        if (pages !== "*" && !(Array.isArray(pages) && pages.includes(this.page))) continue;

        for (const tool of group.tools(this) || []) {
          const requiredFlags = [].concat(tool.flag || []);
          if (!requiredFlags.every((flag) => this.isEnabled(flag))) continue;
          if (tool.auth === "required" && !authenticated) continue;
          if (tool.auth === "anonymous" && authenticated) continue;
          tools.push(tool);
        }
      }

      return tools;
    }

    async registerAll() {
      this.controller = new AbortController();
      const signal = this.controller.signal;

      for (const tool of this.getApplicableTools()) {
        await this.registerTool(tool, signal);
      }
    }

    async registerTool(definition, signal) {
      const name = `${TOOL_PREFIX}${definition.name}`;
      const tool = {
        name,
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema || { type: "object", properties: {}, additionalProperties: false },
        annotations: definition.annotations || {},
        execute: (input, options) => this._execute(definition, input, options),
      };

      try {
        await this.modelContext.registerTool(tool, { signal });
        this.registeredTools.push(name);
      } catch (error) {
        console.warn(`[WebMCP] Failed to register ${name}:`, error);
      }
    }

    async _execute(definition, input, options = {}) {
      const args = input === undefined || input === null ? {} : input;
      const errors = validateInput(definition.inputSchema, args);
      if (errors.length > 0) {
        return { ok: false, error: "invalid_input", details: errors };
      }

      try {
        const result = await definition.execute(args, { signal: options.signal });
        if (result?.ok && !definition.annotations?.readOnlyHint) {
          this.notify(`AI agent: ${definition.title}`, "info");
        }
        return result;
      } catch (error) {
        return { ok: false, error: error?.message || "Tool execution failed" };
      }
    }

    /**
     * Call the Rolnopol API for a tool. Unlike page code, a failed call never
     * redirects to the login page or raises global error toasts, so an agent
     * cannot navigate the user away mid-task.
     * @returns {Promise<{ok: boolean, data?: any, error?: string, status?: number}>}
     */
    async call(method, endpoint, { body, query, requiresAuth = true } = {}) {
      if (!this.apiService) {
        return { ok: false, error: "api_unavailable" };
      }

      try {
        const response = await this.apiService.request(method, endpoint, {
          body,
          query,
          requiresAuth,
          suppressErrorEvents: true,
          noAuthRedirect: true,
        });

        if (!response?.success) {
          const status = response?.status;
          const error = status === 401 || status === 403 ? "not_authenticated" : response?.error || "request_failed";
          return { ok: false, status, error };
        }

        return { ok: true, data: unwrapResponseData(response.data) };
      } catch (error) {
        return { ok: false, status: error?.status, error: error?.message || "request_failed" };
      }
    }

    /**
     * Ask the user to approve an action an agent requested. Every tool with
     * consequentialHint goes through this before it changes anything.
     * @returns {Promise<boolean>} True only when the user clicked the confirm button
     */
    confirm({ title, message, details = [], confirmLabel = "Confirm", danger = false, signal } = {}) {
      const doc = this.document;

      if (!doc || typeof doc.createElement !== "function") {
        return Promise.resolve(false);
      }

      const dialog = doc.createElement("dialog");
      if (typeof dialog.showModal !== "function") {
        const text = [title, message, ...details].filter(Boolean).join("\n");
        return Promise.resolve(typeof root.confirm === "function" ? root.confirm(text) : false);
      }

      return new Promise((resolve) => {
        dialog.className = "webmcp-confirm";
        dialog.setAttribute("aria-labelledby", "webmcp-confirm-title");
        dialog.style.cssText =
          "position:fixed;inset:0;margin:auto;height:fit-content;" +
          "max-width:28rem;width:calc(100% - 2rem);border:1px solid #d0d7de;border-radius:0.75rem;padding:1.25rem;" +
          "font:inherit;color:#1f2328;background:#ffffff;box-shadow:0 12px 32px rgba(0,0,0,0.25);";

        const badge = doc.createElement("p");
        badge.textContent = "Request from an AI agent";
        badge.style.cssText = "margin:0 0 0.5rem;font-size:0.8rem;font-weight:600;color:#57606a;text-transform:uppercase;";

        const heading = doc.createElement("h2");
        heading.id = "webmcp-confirm-title";
        heading.textContent = title || "Confirm action";
        heading.style.cssText = "margin:0 0 0.5rem;font-size:1.15rem;";

        const body = doc.createElement("p");
        body.textContent = message || "";
        body.style.cssText = "margin:0 0 0.75rem;";

        const list = doc.createElement("ul");
        list.style.cssText = "margin:0 0 1rem;padding-left:1.25rem;";
        details.forEach((detail) => {
          const item = doc.createElement("li");
          item.textContent = detail;
          list.appendChild(item);
        });

        const actions = doc.createElement("div");
        actions.style.cssText = "display:flex;gap:0.5rem;justify-content:flex-end;";

        const cancelButton = doc.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "btn btn-secondary";
        cancelButton.textContent = "Cancel";

        const confirmButton = doc.createElement("button");
        confirmButton.type = "button";
        confirmButton.className = danger ? "btn btn-danger" : "btn btn-primary";
        confirmButton.textContent = confirmLabel;

        actions.append(cancelButton, confirmButton);
        dialog.append(badge, heading, body);
        if (details.length > 0) dialog.appendChild(list);
        dialog.appendChild(actions);

        let settled = false;
        const finish = (confirmed) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener?.("abort", onAbort);
          if (dialog.open) dialog.close();
          dialog.remove();
          resolve(confirmed);
        };
        const onAbort = () => finish(false);

        cancelButton.addEventListener("click", () => finish(false));
        confirmButton.addEventListener("click", () => finish(true));
        dialog.addEventListener("cancel", () => finish(false));
        signal?.addEventListener?.("abort", onAbort);

        if (signal?.aborted) {
          finish(false);
          return;
        }

        doc.body.appendChild(dialog);
        dialog.showModal();
        cancelButton.focus();
      });
    }

    notify(message, type = "info") {
      if (typeof root.showNotification === "function") {
        root.showNotification(message, type);
      }
    }

    _attachFlagsListener() {
      if (this._flagsListenerAttached || !this.eventBus) return;
      this._flagsListenerAttached = true;
      this.eventBus.on("feature-flags:changed", () => {
        this.restart().catch((error) => console.warn("[WebMCP] Failed to refresh tools:", error));
      });
    }
  }

  const api = {
    TOOL_PREFIX,
    WebMcpService,
    defineToolGroup,
    getModelContext,
    validateInput,
    toolGroups,
  };

  root.RolnopolWebMcp = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
