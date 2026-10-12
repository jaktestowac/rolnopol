/**
 * WebMCP tools available on every page: farm overview, weather, alerts and
 * session status / login / logout.
 */
(function (root) {
  "use strict";

  const { defineToolGroup } = root.RolnopolWebMcp || require("../webmcp-service.js");

  const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
  const REGION_CODE_PATTERN = "^PL-\\d{2}$";
  // Same-origin path only: "/x", never "//host" or "/\\host" (open redirect).
  const RETURN_PATH_PATTERN = "^/(?![/\\\\])[A-Za-z0-9._~/-]*(\\?[A-Za-z0-9._~=&%-]*)?$";
  const MAX_ITEMS = 50;

  // Read by setupLoginPage() in app.js after the page loads.
  const LOGIN_EMAIL_KEY = "rolnopol.webmcp.loginEmail";
  const RETURN_TO_KEY = "rolnopol.webmcp.returnTo";
  const NAVIGATION_DELAY_MS = 300;

  function sessionSet(key, value) {
    try {
      root.sessionStorage?.setItem(key, value);
    } catch (error) {
      // Storage can be unavailable (privacy mode); the login page still opens.
    }
  }

  function navigateSoon(path) {
    // Give the agent time to receive the tool result before the page unloads.
    setTimeout(() => root.location.assign(path), NAVIGATION_DELAY_MS);
  }

  async function getFarmOverview(service, { includeItems = true }) {
    const [fields, staff, animals, assignments, account] = await Promise.all([
      service.call("GET", "fields"),
      service.call("GET", "staff"),
      service.call("GET", "animals"),
      service.call("GET", "fields/assign"),
      service.call("GET", "financial/account"),
    ]);

    const failed = [fields, staff, animals, assignments].find((result) => !result.ok);
    if (failed) return failed;

    const fieldList = Array.isArray(fields.data) ? fields.data : [];
    const staffList = Array.isArray(staff.data) ? staff.data : [];
    const animalList = Array.isArray(animals.data) ? animals.data : [];
    const assignmentList = Array.isArray(assignments.data) ? assignments.data : [];

    const staffCountByField = {};
    const assignedStaffIds = new Set();
    assignmentList.forEach((assignment) => {
      staffCountByField[assignment.fieldId] = (staffCountByField[assignment.fieldId] || 0) + 1;
      assignedStaffIds.add(String(assignment.staffId));
    });

    const animalsByType = {};
    const animalCountByField = {};
    animalList.forEach((animal) => {
      const amount = Number(animal.amount) || 0;
      animalsByType[animal.type] = (animalsByType[animal.type] || 0) + amount;
      if (animal.fieldId) {
        animalCountByField[animal.fieldId] = (animalCountByField[animal.fieldId] || 0) + amount;
      }
    });

    const overview = {
      ok: true,
      fields: {
        count: fieldList.length,
        totalAreaHa: fieldList.reduce((sum, field) => sum + (parseFloat(field.area) || 0), 0),
        withoutStaff: fieldList.filter((field) => !staffCountByField[field.id]).length,
      },
      staff: {
        count: staffList.length,
        unassigned: staffList.filter((member) => !assignedStaffIds.has(String(member.id))).length,
      },
      animals: {
        records: animalList.length,
        totalAmount: Object.values(animalsByType).reduce((sum, amount) => sum + amount, 0),
        byType: animalsByType,
      },
      account: account.ok
        ? { balance: account.data?.account?.balance ?? null, currency: account.data?.account?.currency || "ROL" }
        : null,
    };

    if (includeItems) {
      overview.fields.items = fieldList.slice(0, MAX_ITEMS).map((field) => ({
        id: field.id,
        name: field.name,
        areaHa: field.area,
        district: field.district || null,
        staffCount: staffCountByField[field.id] || 0,
        animalCount: animalCountByField[field.id] || 0,
      }));
      overview.staff.items = staffList.slice(0, MAX_ITEMS).map((member) => ({
        id: member.id,
        name: `${member.name} ${member.surname}`,
        age: member.age,
        assigned: assignedStaffIds.has(String(member.id)),
      }));
    }

    return overview;
  }

  async function getWeatherForecast(service, { region, date, days = 3 }) {
    const regionsResult = await service.call("GET", "weather/regions", { requiresAuth: false });
    if (!regionsResult.ok) return regionsResult;

    const regions = Array.isArray(regionsResult.data?.regions) ? regionsResult.data.regions : [];
    let selected = regions.find((entry) => entry.code === regionsResult.data?.defaultRegion) || regions[0];

    if (region) {
      const needle = region.trim().toLowerCase();
      selected = regions.find((entry) => entry.code.toLowerCase() === needle || String(entry.name).toLowerCase() === needle);
      if (!selected) {
        return {
          ok: false,
          error: "unknown_region",
          availableRegions: regions.map((entry) => ({ code: entry.code, name: entry.name })),
        };
      }
    }

    if (!selected) return { ok: false, error: "no_regions_available" };

    const [today, forecast] = await Promise.all([
      service.call("GET", "weather", { requiresAuth: false, query: { region: selected.code, date } }),
      service.call("GET", "weather/forecast", { requiresAuth: false, query: { region: selected.code, days } }),
    ]);

    if (!today.ok) return today;

    return {
      ok: true,
      region: { code: selected.code, name: selected.name },
      today: today.data?.weather || null,
      forecast: forecast.ok && Array.isArray(forecast.data?.forecast) ? forecast.data.forecast : [],
      forecastError: forecast.ok ? undefined : forecast.error,
    };
  }

  function toAlertSummary(alert) {
    return {
      id: alert.id,
      date: alert.date,
      category: alert.category,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      location: alert.location,
    };
  }

  async function listAlerts(service, { date, region, severity, includeUpcoming = true, includeHistory = false, limit = 20 }) {
    // On the alerts page, default to the region the user picked there.
    const pageRegion = root.document?.getElementById?.("regionSelect")?.value;
    const result = await service.call("GET", "alerts", {
      requiresAuth: false,
      query: { date, region: region || pageRegion || undefined },
    });
    if (!result.ok) return result;

    const filter = (alerts) =>
      (Array.isArray(alerts) ? alerts : [])
        .filter((alert) => !severity || alert.severity === severity)
        .slice(0, limit)
        .map(toAlertSummary);

    const data = result.data || {};
    const response = {
      ok: true,
      date: data.today?.date || date || null,
      today: filter(data.today?.alerts),
    };

    if (includeUpcoming) {
      response.upcoming = { date: data.upcoming?.date || null, alerts: filter(data.upcoming?.alerts) };
    }
    if (includeHistory) {
      response.history = (Array.isArray(data.history) ? data.history : []).map((day) => ({
        date: day.date,
        alerts: filter(day.alerts),
      }));
    }
    if (data.today?.message) response.message = data.today.message;

    return response;
  }

  async function getAuthStatus(service) {
    if (!service.isAuthenticated()) {
      return { ok: true, loggedIn: false };
    }

    const result = await service.call("GET", "authorization");
    if (!result.ok) {
      return { ok: true, loggedIn: false, reason: result.error };
    }

    return {
      ok: true,
      loggedIn: true,
      userId: result.data?.id ?? null,
      displayName: result.data?.displayedName || result.data?.username || null,
    };
  }

  function openLogin(service, { email, returnTo }) {
    if (returnTo) sessionSet(RETURN_TO_KEY, returnTo);

    const onLoginPage = service.page === "login";
    if (onLoginPage) {
      const emailInput = root.document.getElementById("email");
      const passwordInput = root.document.getElementById("password");
      if (email && emailInput) emailInput.value = email;
      passwordInput?.focus?.();
    } else {
      if (email) sessionSet(LOGIN_EMAIL_KEY, email);
      navigateSoon("/login.html");
    }

    return {
      ok: true,
      awaitingUser: true,
      message: onLoginPage
        ? "The login form is ready. Ask the user to type their password and submit the form."
        : "Opening the login page. Ask the user to type their password and submit the form.",
    };
  }

  async function logout(service, _input, { signal }) {
    const confirmed = await service.confirm({
      title: "Log out?",
      message: "An AI agent wants to log you out of Rolnopol.",
      confirmLabel: "Log out",
      danger: true,
      signal,
    });
    if (!confirmed) return { ok: false, error: "user_cancelled" };

    const authService = service.getModule("authService");
    if (!authService) return { ok: false, error: "auth_unavailable" };

    // AuthService.logout() redirects to the login page, so run it after the result is returned.
    setTimeout(() => {
      authService.logout().catch((error) => console.warn("[WebMCP] Logout failed:", error));
    }, NAVIGATION_DELAY_MS);

    return { ok: true, loggingOut: true };
  }

  defineToolGroup("global", {
    pages: "*",
    tools: (service) => [
      {
        name: "farm.getOverview",
        title: "Get farm overview",
        description:
          "Summarise the logged-in user's farm: fields (count, total area, fields without staff), staff (count, unassigned), " +
          "animals by type and the account balance in ROL. Call this first to plan before changing anything.",
        auth: "required",
        inputSchema: {
          type: "object",
          properties: {
            includeItems: {
              type: "boolean",
              description: "Include up to 50 fields and staff members with their ids (default true).",
            },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: (input) => getFarmOverview(service, input),
      },
      {
        name: "weather.getForecast",
        title: "Get weather forecast",
        description:
          "Get today's weather and the forecast for up to 7 days for a Polish region (voivodeship). " +
          "Includes temperature, precipitation, soil moisture, drought index and an irrigation advisory.",
        flag: "weatherPageEnabled",
        inputSchema: {
          type: "object",
          properties: {
            region: {
              type: "string",
              maxLength: 40,
              description: "Region code (e.g. PL-14) or name (e.g. mazowieckie). Defaults to the service's default region.",
            },
            date: { type: "string", pattern: DATE_PATTERN, description: "Day for today's reading, YYYY-MM-DD (default: today)." },
            days: { type: "integer", minimum: 1, maximum: 7, description: "Number of forecast days starting tomorrow (default 3)." },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: (input) => getWeatherForecast(service, input),
      },
      {
        name: "alerts.list",
        title: "List farm alerts",
        description:
          "List weather, disease and operations alerts for a region: today's alerts, optionally tomorrow's and the last 7 days. " +
          "Severity is one of low, medium, high, critical.",
        flag: "alertsEnabled",
        inputSchema: {
          type: "object",
          properties: {
            date: { type: "string", pattern: DATE_PATTERN, description: "Day to read, YYYY-MM-DD (default: today)." },
            region: { type: "string", pattern: REGION_CODE_PATTERN, description: "Region code, e.g. PL-14." },
            severity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Only return alerts with this severity." },
            includeUpcoming: { type: "boolean", description: "Include tomorrow's alerts (default true)." },
            includeHistory: { type: "boolean", description: "Include the previous 7 days (default false)." },
            limit: { type: "integer", minimum: 1, maximum: MAX_ITEMS, description: "Maximum alerts per day (default 20)." },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: (input) => listAlerts(service, input),
      },
      {
        name: "auth.getStatus",
        title: "Get login status",
        description:
          "Check whether the user is logged in to Rolnopol and return their user id and display name. " +
          "Call this before tools that need a session.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
        execute: () => getAuthStatus(service),
      },
      {
        name: "auth.openLogin",
        title: "Open the login form",
        description:
          "Bring the user to the Rolnopol login form, optionally pre-filling their email. " +
          "The user types the password and submits the form themselves; this tool never accepts a password.",
        auth: "anonymous",
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string", maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", description: "Email to pre-fill." },
            returnTo: {
              type: "string",
              maxLength: 200,
              pattern: RETURN_PATH_PATTERN,
              description: "Rolnopol page to open after a successful login, e.g. /marketplace.html (same-origin path only).",
            },
          },
          additionalProperties: false,
        },
        annotations: {},
        execute: (input) => openLogin(service, input),
      },
      {
        name: "auth.logout",
        title: "Log out",
        description: "Log the user out of Rolnopol. The user must confirm in the page first.",
        auth: "required",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { consequentialHint: true },
        execute: (input, options) => logout(service, input, options),
      },
    ],
  });
})(typeof window !== "undefined" ? window : globalThis);
