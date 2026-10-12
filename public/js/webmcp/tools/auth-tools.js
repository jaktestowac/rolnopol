/**
 * WebMCP tools for the login and register pages.
 * No tool here accepts or returns a password, a 2FA code or a session token.
 */
(function (root) {
  "use strict";

  const { defineToolGroup } = root.RolnopolWebMcp || require("../webmcp-service.js");

  const RETURN_TO_KEY = "rolnopol.webmcp.returnTo";
  const NAVIGATION_DELAY_MS = 300;

  // The public demo accounts listed on the login page (see buildDemoInfo() in js/pages/login.js).
  const DEMO_ACCOUNTS = {
    "empty-user": { email: "emptyuser@rolnopol.demo.pl", password: "demoPass123", label: "Empty Demo User" },
    "demo-user": { email: "demo@example.com", password: "demo123", label: "Demo User" },
    "demo-user-2": { email: "test@example.com", password: "brownPass123", label: "Demo User 2" },
  };

  function getPasswordRules(service) {
    const strong = service.isEnabled("registrationStrongPasswordEnabled");
    return {
      ok: true,
      strongPasswordEnabled: strong,
      minLength: strong ? 8 : 3,
      requiresUppercase: strong,
      requiresLowercase: strong,
      requiresNumber: strong,
      requiresSpecialCharacter: strong,
      displayName: { optional: true, minLength: 3, maxLength: 20, allowed: "letters, numbers, spaces, hyphens, underscores" },
    };
  }

  function prefillRegistration({ email, displayName }) {
    const doc = root.document;
    const emailInput = doc.getElementById("email");
    const displayNameInput = doc.getElementById("displayedName");
    const passwordInput = doc.getElementById("password");

    if (!emailInput || !passwordInput) return { ok: false, error: "registration_form_not_found" };

    if (email) emailInput.value = email;
    if (displayName && displayNameInput) displayNameInput.value = displayName;
    passwordInput.focus?.();

    return {
      ok: true,
      awaitingUser: true,
      message: "The registration form is filled in. Ask the user to choose a password and submit the form.",
    };
  }

  function consumeReturnTo() {
    try {
      const value = root.sessionStorage?.getItem(RETURN_TO_KEY);
      root.sessionStorage?.removeItem(RETURN_TO_KEY);
      return value;
    } catch (error) {
      return null;
    }
  }

  async function loginAsDemo(service, { account }) {
    const authService = service.getModule("authService");
    if (!authService) return { ok: false, error: "auth_unavailable" };

    const demo = DEMO_ACCOUNTS[account];
    let result;
    try {
      result = await authService.login({ email: demo.email, password: demo.password });
    } catch (error) {
      return { ok: false, error: error?.message || "login_failed" };
    }

    if (result?.twoFactorRequired) {
      return { ok: false, error: "two_factor_required", message: "This demo account has 2FA enabled. Ask the user to log in manually." };
    }

    // Same destination as the login form; returnTo was validated by auth.openLogin's schema
    // and is checked again in app.js before use.
    const destination = root.RolnopolWebMcpReturnPath?.(consumeReturnTo()) || "/profile.html";
    setTimeout(() => root.location.assign(destination), NAVIGATION_DELAY_MS);

    return { ok: true, account, displayName: demo.label, redirectingTo: destination };
  }

  defineToolGroup("auth", {
    pages: ["login", "register"],
    tools: (service) => {
      if (service.page === "register") {
        return [
          {
            name: "auth.getPasswordRules",
            title: "Get password rules",
            description:
              "Return the password and display-name rules the Rolnopol registration form currently enforces, " +
              "so you can explain a failed registration without seeing the password.",
            auth: "anonymous",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true },
            execute: () => getPasswordRules(service),
          },
          {
            name: "auth.prefillRegistration",
            title: "Pre-fill registration form",
            description:
              "Fill the non-secret fields of the registration form (email, display name) and focus the password field. " +
              "The user chooses the password and submits the form themselves.",
            auth: "anonymous",
            inputSchema: {
              type: "object",
              properties: {
                email: { type: "string", maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
                displayName: { type: "string", minLength: 3, maxLength: 20, pattern: "^[a-zA-Z0-9\\s\\-_]+$" },
              },
              additionalProperties: false,
            },
            annotations: {},
            execute: (input) => prefillRegistration(input),
          },
        ];
      }

      return [
        {
          name: "auth.loginAsDemo",
          title: "Log in with a demo account",
          description:
            "Log in with one of Rolnopol's built-in demo accounts (for testing only). " +
            "empty-user has no farm data; demo-user and demo-user-2 have sample fields, staff, animals and money.",
          auth: "anonymous",
          flag: "webMcpDemoLoginEnabled",
          inputSchema: {
            type: "object",
            properties: {
              account: { type: "string", enum: Object.keys(DEMO_ACCOUNTS), description: "Which demo account to use." },
            },
            required: ["account"],
            additionalProperties: false,
          },
          annotations: {},
          execute: (input) => loginAsDemo(service, input),
        },
      ];
    },
  });
})(typeof window !== "undefined" ? window : globalThis);
