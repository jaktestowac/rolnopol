/**
 * Feature-flagged documentation sections.
 *
 * Each entry maps one or more feature flags to a documentation section that is
 * merged into the public docs (and the docs search / AI assistant) ONLY when
 * its flag condition is satisfied. This lets the documentation grow to describe
 * whichever features are currently turned on, instead of only ever documenting
 * the always-on core in data/docs.json.
 *
 * Flag condition per entry:
 *   - `flags`    : array of flags that must ALL be enabled (AND).
 *   - `anyFlags` : array where at least ONE must be enabled (OR).
 *   - `flag`     : shorthand for a single required flag.
 * When both `flags` and `anyFlags` are present, both conditions must hold.
 *
 * Section content shape (rendered by public/docs.html):
 *   A section's `content` is an array of `{ heading, content: [...] }` blocks.
 *   Each block's `content` is a list of items built with the helpers below:
 *     - p(text)                       -> paragraph
 *     - ul([...])                     -> bullet list
 *     - table(columns, rows)          -> table
 *     - callout(variant, title, text) -> info/tip/warning/success box
 *     - scenario([...], title?)       -> numbered walkthrough (steps)
 *     - flow([...], title?)           -> vertical flowchart / diagram
 *   A `flow` node is a string or `{ label, detail?, arrow? }`, where `arrow`
 *   labels the connector to the next node (e.g. a branch/condition).
 *
 * The renderer is fully backward compatible: base docs in data/docs.json and
 * any older content shapes (string, string[], subsection-card, ...) still work.
 *
 * When merged, each section is automatically tagged with `isFeatureFlagged: true`
 * and `featureFlags: [...]` (the flags that caused it to appear) so the UI can
 * label — and optionally hide — documentation that only exists because a flag
 * is enabled. All API paths below are relative to the `/api/v1` base unless
 * noted; disabled feature endpoints respond with HTTP 404 (unless noted).
 */

const heading = (title, content) => ({ heading: title, content });
const p = (text) => ({ type: "paragraph", text });
const ul = (items) => ({ type: "list", items });
const table = (columns, rows) => ({ type: "table", columns, rows });
const callout = (variant, title, text) => ({ type: "callout", variant, title, text });
const flow = (nodes, title) => ({ type: "flow", title, steps: nodes });
const scenario = (items, title) => ({ type: "steps", title, items });

module.exports = [
  // ---------------------------------------------------------------------------
  // Security & account
  // ---------------------------------------------------------------------------
  {
    flag: "twoFactorAuthEnabled",
    section: {
      section: "two-factor-auth",
      title: "Two-Factor Authentication (2FA)",
      content: [
        heading("Overview", [
          p(
            "User-managed two-factor authentication using time-based one-time passwords (TOTP). When a user turns on 2FA, login requires the account password plus a current 6-digit code from an authenticator app.",
          ),
          ul([
            "Self-service enrollment and removal from the account security page (/two-factor.html).",
            "Backup/recovery codes for regaining access when the authenticator is unavailable.",
            "Login stays backward compatible: the API only asks for a code once 2FA is enabled.",
          ]),
        ]),
        heading("Login flow with 2FA", [
          flow([
            { label: "Enter email + password", detail: "POST /login" },
            { label: "Server verifies the password", arrow: "valid" },
            { label: "Second factor required", detail: "response: twoFactorRequired = true" },
            { label: "Enter authenticator code", detail: "6-digit TOTP (or a backup code)" },
            { label: "Server validates the code", arrow: "match" },
            { label: "Session issued", detail: "rolnopolToken cookie set" },
          ]),
        ]),
        heading("Scenario: enroll then sign in", [
          scenario([
            { title: "Open account security", text: "Go to /two-factor.html while logged in." },
            { title: "Start setup", text: "POST /users/profile/two-factor/setup returns a secret / QR data." },
            { title: "Confirm", text: "Enter the current code to POST /users/profile/two-factor/enable." },
            { title: "Store backup codes", text: "Save the one-time recovery codes shown after enabling." },
            { title: "Re-login", text: "Log out and back in — the second-step prompt now appears." },
          ]),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["GET", "/users/profile/two-factor", "Current 2FA status for the user"],
              ["POST", "/users/profile/two-factor/setup", "Begin enrollment (returns secret / QR data)"],
              ["POST", "/users/profile/two-factor/enable", "Confirm and enable 2FA with a code"],
              ["POST", "/users/profile/two-factor/disable", "Disable 2FA after re-verifying"],
            ],
          ),
          callout(
            "warning",
            "Edge cases to test",
            "Invalid/expired codes must be rejected; backup codes are single-use; all endpoints require a logged-in session and return 404 when the feature is disabled.",
          ),
        ]),
      ],
    },
  },
  {
    flag: "registrationStrongPasswordEnabled",
    section: {
      section: "registration-strong-password",
      title: "Strong Password Policy (Registration)",
      content: [
        heading("Overview", [
          p("Enforces a strong-password policy for new-user registration, both in the register form and on the server."),
          ul([
            "When enabled: minimum 8 characters and must include uppercase, lowercase, a number, and a special character.",
            "When disabled: the minimum length falls back to 3 characters.",
            "The register form shows the stricter guidance while the flag is on.",
          ]),
        ]),
        heading("Scenario: weak password is rejected", [
          scenario([
            "Enable the flag and open /register.html.",
            "Enter a weak password such as 'abc' and submit.",
            "Registration is rejected with a validation error, even if client checks are bypassed (the rule is enforced server-side).",
            "Enter a compliant password (e.g. 'Str0ng!pass') and registration succeeds.",
          ]),
          callout(
            "tip",
            "Server-side enforcement",
            "The policy is applied during registration validation, so it holds regardless of the client.",
          ),
        ]),
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Alerts
  // ---------------------------------------------------------------------------
  {
    flag: "alertsEnabled",
    section: {
      section: "alerts",
      title: "Alerts",
      content: [
        heading("Overview", [
          p(
            "The alerts system surfaces notable conditions for animals and farm operations on the alerts page (/alerts.html). This flag is the master switch — with it off, the page cannot load data and the alerts API returns 404.",
          ),
          ul([
            "Alerts are listed on the alerts page; the Alerts nav link appears only when this flag is on.",
            "'alertsSeverityFilterEnabled' adds a severity dropdown to filter alerts by level.",
            "'alertsAiAssistantEnabled' adds the 'Alerticus' AI assistant that interprets alerts.",
            "'celebrationEventsEnabled' shows celebration/holiday events on the page.",
          ]),
        ]),
        heading("How an alert reaches the user", [
          flow([
            { label: "Condition detected", detail: "animal / operations data" },
            { label: "Alert raised", detail: "with severity + timing" },
            { label: "Listed on the alerts page", detail: "GET /alerts, /alerts/upcoming" },
            { label: "User reviews (and optionally asks Alerticus)", detail: "when AI assistant is enabled" },
          ]),
        ]),
        heading("Endpoints", [
          callout("info", "Public feature", "Alerts endpoints are public (rate-limited, no login required)."),
          table(
            ["Method", "Path", "Requires"],
            [
              ["GET", "/alerts", "alertsEnabled"],
              ["GET", "/alerts/history", "alertsEnabled"],
              ["GET", "/alerts/upcoming", "alertsEnabled"],
              ["GET", "/alerts/celebration-events", "alertsEnabled + celebrationEventsEnabled"],
              ["POST", "/alerts-chat/messages", "alertsEnabled + alertsAiAssistantEnabled"],
            ],
          ),
        ]),
      ],
    },
  },
  {
    flag: "alertsSeverityFilterEnabled",
    section: {
      section: "alerts-severity-filter",
      title: "Alerts — Severity Filter",
      content: [
        heading("Overview", [
          p("Adds a severity dropdown on the alerts page so users can narrow the list to a chosen severity level."),
          ul([
            "UI-only control; there is no dedicated endpoint.",
            "When disabled the filter is hidden and any active selection is cleared.",
          ]),
          callout("info", "Depends on Alerts", "Only has an effect while 'alertsEnabled' is on and the alerts page can load."),
        ]),
      ],
    },
  },
  {
    flag: "alertsAiAssistantEnabled",
    section: {
      section: "alerts-ai-assistant",
      title: "Alerts — AI Assistant (Alerticus)",
      content: [
        heading("Overview", [
          p(
            "Enables the 'Alerticus' AI assistant widget on the alerts page, which interprets today's and upcoming alerts for the selected region.",
          ),
          ul([
            "Chat widget embedded on /alerts.html.",
            "Backed by POST /alerts-chat/messages (requires both 'alertsEnabled' and this flag).",
            "No login required; when disabled the widget is hidden and the endpoint returns 404.",
          ]),
          callout("tip", "Try asking", '"What alerts should I worry about today?" or "Any upcoming issues for my animals?"'),
        ]),
      ],
    },
  },
  {
    flag: "celebrationEventsEnabled",
    section: {
      section: "celebration-events",
      title: "Celebration Events",
      content: [
        heading("Overview", [
          p(
            "Shows celebration/holiday events on the alerts page and activates matching festive personas for Porky in the operator terminal.",
          ),
          ul([
            "Events are read from GET /alerts/celebration-events (requires 'alertsEnabled' + this flag).",
            "A matching celebration persona is selected for Porky in the operator terminal.",
          ]),
          callout(
            "info",
            "Persona priority",
            "A celebration persona takes priority over the 'terminalPorkySplitPersonalityEnabled' night schedule.",
          ),
        ]),
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Homepage presentation (any of the homepage flags)
  // ---------------------------------------------------------------------------
  {
    anyFlags: ["homeWelcomeVideoEnabled", "homeStatsSectionEnabled", "homeModernRestyleEnabled"],
    section: {
      section: "homepage-features",
      title: "Homepage Enhancements",
      content: [
        heading("Overview", [
          p("Optional presentation features layered onto the public homepage (/). Each toggles independently and requires no login."),
          ul([
            "homeWelcomeVideoEnabled: shows a promotional welcome video block.",
            "homeStatsSectionEnabled: shows an advanced statistics section.",
            "homeModernRestyleEnabled: swaps the homepage to a modern redesigned layout and styling.",
          ]),
          callout(
            "tip",
            "Live restyle",
            "The modern restyle applies at runtime and re-applies when feature flags change, so you can toggle it without reloading.",
          ),
        ]),
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Profile
  // ---------------------------------------------------------------------------
  {
    flag: "profileAvatarUploadEnabled",
    section: {
      section: "profile-avatar-upload",
      title: "Custom Profile Avatars",
      content: [
        heading("Overview", [
          p("Lets logged-in users upload a custom avatar image on the profile page (/profile.html)."),
          ul([
            "Uploaded avatars also appear anywhere user identity is shown, such as the messenger.",
            "Endpoint: PUT /users/profile/avatar (requires login; returns 404 when disabled).",
          ]),
          callout("info", "Login required", "Avatar upload is available to any authenticated user; no admin role is needed."),
        ]),
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Documentation tooling (any of the docs flags)
  // ---------------------------------------------------------------------------
  {
    anyFlags: ["docsSearchEnabled", "docsAdvancedSearchEnabled", "docsAiAssistantEnabled"],
    section: {
      section: "documentation-tools",
      title: "Documentation Tools",
      content: [
        heading("Overview", [
          p("Optional tools available on this documentation page itself."),
          ul([
            "docsSearchEnabled: a basic search box that filters documentation sections.",
            "docsAdvancedSearchEnabled: advanced filters (match mode contains/exact/regex, search scope, case sensitivity). Takes precedence over basic search.",
            "docsAiAssistantEnabled: the 'Docsy' AI assistant widget answering questions grounded in these docs (POST /docs-chat/messages).",
          ]),
          callout(
            "tip",
            "Feature-flag docs are searchable",
            "Sections added by enabled feature flags (like this one) are indexed by both search and the Docsy assistant.",
          ),
        ]),
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Contact
  // ---------------------------------------------------------------------------
  {
    flag: "contactFormEnabled",
    section: {
      section: "contact-form",
      title: "Contact Form",
      content: [
        heading("Overview", [
          p("Enables the public contact form on /contact.html for submitting name, email, subject, and message. No login is required."),
        ]),
        heading("Submission flow", [
          flow([
            { label: "Fill in the contact form", detail: "/contact.html" },
            { label: "Submit", detail: "POST /api/contact" },
            { label: "Server validates and stores the message", arrow: "valid" },
            { label: "Confirmation shown to the user" },
          ]),
          callout("warning", "When disabled", "The form is hidden with a 'contact unavailable' notice and POST /api/contact returns 404."),
        ]),
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Interactive map
  // ---------------------------------------------------------------------------
  {
    flag: "rolnopolMapEnabled",
    section: {
      section: "interactive-map",
      title: "Interactive Farm Map",
      content: [
        heading("Overview", [
          p(
            "An interactive map that visualizes fields and districts spatially. The Map nav link and the /rolnopolmap.html page appear only when this flag is enabled.",
          ),
          ul([
            "Browse fields geographically and jump to the underlying resource details.",
            "Reflects the same ownership and assignment rules as the rest of the system.",
          ]),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["GET", "/map", "Map overview data"],
              ["GET", "/map/fieldsmap", "Fields plotted on the map"],
              ["GET", "/map/districts", "District boundaries"],
            ],
          ),
          callout("info", "Login required", "Map API endpoints require a logged-in session; gating of the page/nav is client-side."),
        ]),
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Communication
  // ---------------------------------------------------------------------------
  {
    flag: "messengerEnabled",
    section: {
      section: "messenger",
      title: "Internal Messenger",
      content: [
        heading("Overview", [
          p(
            "A private, user-to-user messenger (/messenger.html). Conversations are visible only to their participants and update in near real time via a WebSocket channel with polling fallback.",
          ),
        ]),
        heading("Message delivery flow", [
          flow([
            { label: "User A opens a conversation", detail: "GET /messages/conversations/:userId" },
            { label: "User A sends a message", detail: "POST /messages" },
            { label: "Stored and delivered", detail: "WebSocket push + GET /messages/poll fallback" },
            { label: "User B sees the new message" },
          ]),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["GET", "/messages/conversations", "List the user's conversations"],
              ["GET", "/messages/conversations/:userId", "Messages with a specific user"],
              ["POST", "/messages", "Send a message"],
              ["GET", "/messages/poll", "Poll for new messages"],
            ],
          ),
          callout(
            "warning",
            "Test cross-user isolation",
            "All endpoints require login. A user must never be able to read another pair's conversation.",
          ),
        ]),
      ],
    },
  },
  {
    flag: "assistantChatEnabled",
    section: {
      section: "assistant-chat",
      title: "AI Farm Assistant Chat",
      content: [
        heading("Overview", [
          p(
            "A floating AI assistant chat modal ('Porky – AI Assistant') available site-wide for logged-in users (except the login/register and Swagger pages).",
          ),
          ul([
            "Answers questions about the signed-in user's own farm data — fields, staff, and animals.",
            "Backed by POST /assistant-chat/messages.",
          ]),
          callout(
            "info",
            "Login required",
            "Both the widget injection and the endpoint require an authenticated user; when disabled the widget is not injected and the endpoint returns 404.",
          ),
        ]),
      ],
    },
  },
  {
    flag: "terminalPorkySplitPersonalityEnabled",
    section: {
      section: "terminal-porky-split-personality",
      title: "Operator Terminal — Porky Split Personality",
      content: [
        heading("Overview", [
          p(
            "Gives 'Porky', the chatbot in the operator terminal (/operator/terminal.html), a night-time split-personality schedule with alternate personas.",
          ),
          ul([
            "Scheduled night personas apply only during the UTC night window on certain weekdays.",
            "They apply only when no celebration-event persona is active.",
            "This flag changes Porky's persona selection only; the terminal endpoints themselves are not gated by it.",
          ]),
          callout(
            "info",
            "Persona priority",
            "When 'celebrationEventsEnabled' is on and an event matches, the celebration persona wins over this night schedule.",
          ),
        ]),
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Notifications & integrations
  // ---------------------------------------------------------------------------
  {
    flag: "notificationCenterEnabled",
    section: {
      section: "notification-center",
      title: "Notification Center",
      content: [
        heading("Overview", [
          p(
            "An event-driven, multi-channel notification module. System events are stored and dispatched to users, and can be forwarded to registered webhooks. Its management UI is embedded in the admin dashboard.",
          ),
        ]),
        heading("Event pipeline", [
          flow([
            { label: "System event occurs", detail: "e.g. resource change" },
            { label: "Event stored", detail: "notification event store" },
            { label: "Dispatcher routes the event", detail: "to configured channels" },
            { label: "Delivered", detail: "in-app + webhook subscriptions" },
          ]),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["GET", "/notifications/health", "Module health"],
              ["GET", "/notifications/events", "Stored notification events"],
              ["GET", "/notifications/event-types", "Available event types"],
              ["POST", "/notifications/trigger", "Trigger a notification event"],
              ["GET/POST", "/notifications/test-event", "Emit a test event"],
            ],
          ),
          callout(
            "info",
            "Works with webhooks",
            "Webhook subscriptions from the integrations feature are consumed here for delivery. A WebSocket channel (/notifications/ws) provides live updates. When disabled, the module runs as a no-op stub and the API returns 404.",
          ),
        ]),
      ],
    },
  },
  {
    flag: "personalApiKeysEnabled",
    section: {
      section: "personal-api-keys",
      title: "Personal API Keys",
      content: [
        heading("Overview", [
          p(
            "Lets users create and manage personal API keys for their own integrations, from the Personal Integrations page (/integrations.html).",
          ),
        ]),
        heading("Key lifecycle", [
          flow([
            { label: "Create a key", detail: "POST /users/profile/api-keys" },
            { label: "Use it in your integration", detail: "authenticates as the user" },
            { label: "Rotate when needed", detail: "POST .../:keyId/regenerate", arrow: "optional" },
            { label: "Revoke", detail: "DELETE .../:keyId" },
          ]),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["GET", "/users/profile/api-keys", "List the user's API keys"],
              ["POST", "/users/profile/api-keys", "Create a new API key"],
              ["POST", "/users/profile/api-keys/:keyId/regenerate", "Regenerate a key"],
              ["DELETE", "/users/profile/api-keys/:keyId", "Revoke a key"],
            ],
          ),
          callout("info", "Login required", "All API-key endpoints require a logged-in session."),
        ]),
      ],
    },
  },
  {
    flag: "integrationsWebhooksEnabled",
    section: {
      section: "webhooks",
      title: "Webhook Integrations",
      content: [
        heading("Overview", [
          p(
            "Lets users register outbound webhooks and review delivery activity, from the Personal Integrations page (/integrations.html). Registered webhooks are called when relevant events occur, enabling external automation.",
          ),
        ]),
        heading("Delivery flow", [
          flow([
            { label: "Register a webhook URL", detail: "POST /users/profile/webhooks" },
            { label: "An event occurs", detail: "e.g. via the notification center" },
            { label: "Rolnopol POSTs to your URL", detail: "outbound delivery" },
            { label: "Delivery recorded", detail: "GET /users/profile/webhooks/deliveries" },
          ]),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["GET", "/users/profile/webhooks", "List webhooks"],
              ["POST", "/users/profile/webhooks", "Create a webhook"],
              ["PUT", "/users/profile/webhooks/:webhookId", "Update a webhook"],
              ["DELETE", "/users/profile/webhooks/:webhookId", "Delete a webhook"],
              ["GET", "/users/profile/webhooks/deliveries", "Delivery / activity logs"],
            ],
          ),
          callout(
            "info",
            "Login required",
            "All webhook endpoints require a logged-in session. Pairs with the notification center for event delivery.",
          ),
        ]),
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Weather
  // ---------------------------------------------------------------------------
  {
    flag: "weatherPageEnabled",
    section: {
      section: "weather",
      title: "Weather",
      content: [
        heading("Overview", [
          p(
            "The weather module exposes the /weather.html page and weather API. This flag is the master switch — its sub-features are unreachable when it is off.",
          ),
          ul([
            "weatherWeatherDataExport: anonymous weather data export (CSV and PDF).",
            "weatherUserInsightsEnabled: a personalized insights panel for logged-in users.",
            "weatherTrendChartEnabled: a compact temperature/humidity/wind trend chart.",
          ]),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Requires"],
            [
              ["GET", "/weather", "weatherPageEnabled (public)"],
              ["GET", "/weather/regions", "weatherPageEnabled (public)"],
              ["GET", "/weather/forecast", "weatherPageEnabled (public)"],
              ["GET", "/weather/export/csv", "weatherPageEnabled + weatherWeatherDataExport"],
              ["GET", "/weather/export/pdf", "weatherPageEnabled + weatherWeatherDataExport"],
              ["GET", "/weather/user-insights", "weatherPageEnabled + weatherUserInsightsEnabled + login"],
            ],
          ),
          callout(
            "info",
            "Master switch",
            "Turning this off blocks the page and every weather sub-feature, regardless of their own flags.",
          ),
        ]),
      ],
    },
  },
  {
    flag: "weatherWeatherDataExport",
    section: {
      section: "weather-data-export",
      title: "Weather — Data Export",
      content: [
        heading("Overview", [
          p("Enables anonymous weather data export (CSV and PDF) from the weather page, without personalized insights."),
          ul([
            "Endpoints: GET /weather/export/csv and GET /weather/export/pdf (require 'weatherPageEnabled' + this flag).",
            "No login required — the export is anonymous.",
          ]),
          callout("info", "Depends on Weather", "Requires the weather module ('weatherPageEnabled') to be reachable."),
        ]),
      ],
    },
  },
  {
    flag: "weatherUserInsightsEnabled",
    section: {
      section: "weather-user-insights",
      title: "Weather — Personalized Insights",
      content: [
        heading("Overview", [
          p("Shows a personalized weather insights panel with farm-profile-aware risks and recommendations for logged-in users."),
          ul([
            "Endpoint: GET /weather/user-insights (requires 'weatherPageEnabled' + this flag + login).",
            "The panel stays hidden for unauthenticated users even when enabled.",
          ]),
        ]),
      ],
    },
  },
  {
    flag: "weatherTrendChartEnabled",
    section: {
      section: "weather-trend-chart",
      title: "Weather — Trend Chart",
      content: [
        heading("Overview", [
          p("Shows a compact trend chart of temperature, humidity, and wind on the weather page."),
          callout(
            "info",
            "Presentation only",
            "It reuses data already returned by the weather API (no dedicated endpoint) and requires 'weatherPageEnabled' to be reachable.",
          ),
        ]),
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Financial
  // ---------------------------------------------------------------------------
  {
    anyFlags: ["financialReportsEnabled", "financialCsvExportEnabled"],
    section: {
      section: "financial-exports",
      title: "Financial Exports",
      content: [
        heading("Overview", [
          p("Adds export options to the financial page (/financial.html). Both require login."),
          ul([
            "financialReportsEnabled: a 'Download PDF Report' action backed by GET /financial/report.",
            "financialCsvExportEnabled: a 'CSV Export' action backed by GET /financial/export/csv, with optional filters (type, category, startDate, endDate).",
          ]),
          callout("info", "Login required", "Each export button appears only when its flag is on, and its endpoint returns 404 otherwise."),
        ]),
      ],
    },
  },
  {
    flag: "staffFieldsExportEnabled",
    section: {
      section: "staff-fields-export",
      title: "Staff / Fields / Animals Export",
      content: [
        heading("Overview", [
          p(
            "Enables the /staff-fields-export.html page, which builds a JSON export of the user's staff, fields, and animals in the browser.",
          ),
        ]),
        heading("How the export is built", [
          flow([
            { label: "Open the export page", detail: "/staff-fields-export.html" },
            { label: "Page loads your data", detail: "GET /staff, /animals, /fields" },
            { label: "Serialized to JSON in the browser" },
            { label: "Download the JSON file" },
          ]),
          callout(
            "warning",
            "When disabled",
            "The page shows an 'Export Unavailable' notice and redirects back to the staff/fields overview. Requires login.",
          ),
        ]),
      ],
    },
  },
  {
    flag: "financialCommoditiesEnabled",
    section: {
      section: "financial-commodities",
      title: "Commodities Monitoring",
      content: [
        heading("Overview", [
          p(
            "Adds agricultural commodity price monitoring to the financial area, including the /financial-commodities.html page, a shortcut card on the financial page, and a Commodities nav link. All endpoints require login.",
          ),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["GET", "/commodities/prices", "Current commodity prices"],
              ["GET", "/commodities/prices/:symbol/history", "Price history for a symbol"],
              ["GET", "/commodities/portfolio", "The user's commodities portfolio"],
            ],
          ),
          callout(
            "info",
            "Trading is separate",
            "Buying and selling additionally require the 'financialCommoditiesTradingEnabled' flag — see the Commodities Trading section.",
          ),
        ]),
      ],
    },
  },
  {
    // Trading has its own section so the flag is always documented when on; note
    // that at runtime the buy/sell routes require financialCommoditiesEnabled too.
    flag: "financialCommoditiesTradingEnabled",
    section: {
      section: "financial-commodities-trading",
      title: "Commodities Trading",
      content: [
        heading("Overview", [
          p(
            "Enables buying and selling commodities from the commodities page, on top of monitoring. Purchases are validated against the user's financial account (no overdraft).",
          ),
        ]),
        heading("Buy flow", [
          flow([
            { label: "Pick a commodity and amount", detail: "/financial-commodities.html" },
            { label: "Submit the order", detail: "POST /commodities/buy" },
            { label: "Funds checked", detail: "no overdraft allowed", arrow: "enough funds?" },
            { label: "Account charged, portfolio updated" },
            { label: "Confirmation" },
          ]),
        ]),
        heading("Scenario: insufficient funds", [
          scenario([
            "Enable both commodities flags and open the commodities page.",
            "Attempt to buy more than your ROL balance allows.",
            "The purchase is blocked with an insufficient-funds error and no balance/portfolio change occurs.",
          ]),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["POST", "/commodities/buy", "Buy a commodity"],
              ["POST", "/commodities/sell", "Sell a commodity"],
            ],
          ),
          callout(
            "warning",
            "Requires monitoring too",
            "At runtime, buy/sell also require 'financialCommoditiesEnabled'; this section appears whenever the trading flag is on so the flag is documented.",
          ),
        ]),
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Modules (built-in + external services)
  // ---------------------------------------------------------------------------
  {
    flag: "taskManagerEnabled",
    section: {
      section: "task-manager",
      title: "Task Manager",
      content: [
        heading("Overview", [
          p(
            "A built-in task manager for logged-in users (/tasks.html) with tasks, statuses (kanban/swimlane), and labels. Create, track, move, complete, archive, and restore tasks.",
          ),
        ]),
        heading("Task lifecycle", [
          flow([
            { label: "Create a task", detail: "POST /tasks" },
            { label: "Move it across statuses", detail: "PATCH /tasks/:taskId/move" },
            { label: "Complete", arrow: "or" },
            { label: "Archive", detail: "POST /tasks/:taskId/archive" },
            { label: "Restore if needed", detail: "POST /tasks/:taskId/restore" },
          ]),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["GET/POST", "/tasks", "List / create tasks"],
              ["GET/PUT/PATCH/DELETE", "/tasks/:taskId", "Read / update / delete a task"],
              ["PATCH", "/tasks/:taskId/move", "Move a task between statuses"],
              ["GET/POST", "/tasks/statuses", "List / create statuses"],
              ["GET/POST/PUT/DELETE", "/tasks/labels", "Manage labels"],
            ],
          ),
          callout(
            "info",
            "Local module",
            "This is the built-in task manager — distinct from TaskLab, which proxies an external service. Requires login.",
          ),
        ]),
      ],
    },
  },
  {
    flag: "taskLabEnabled",
    section: {
      section: "tasklab",
      title: "TaskLab (External Service)",
      content: [
        heading("Overview", [
          p(
            "TaskLab is a REST proxy and dashboard (/tasklab.html) backed by a standalone external TaskLab service over gRPC — the app holds no TaskLab data itself. Requires login.",
          ),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["GET", "/tasklab/statuses", "Available statuses"],
              ["GET", "/tasklab/tasks", "List tasks (filters: status, q, includeArchived)"],
              ["POST", "/tasklab/tasks", "Create a task"],
              ["PATCH", "/tasklab/tasks/:id/status", "Change a task's status"],
              ["POST", "/tasklab/tasks/:id/archive", "Archive a task"],
              ["POST", "/tasklab/tasks/:id/restore", "Restore a task"],
            ],
          ),
          callout(
            "warning",
            "Service must be running",
            "If the external TaskLab service is offline, endpoints return 503 — start it with `npm run tasklab`.",
          ),
        ]),
      ],
    },
  },
  {
    flag: "greenhouseControlRoomEnabled",
    section: {
      section: "greenhouse-control-room",
      title: "Greenhouse Control Room (External Service)",
      content: [
        heading("Overview", [
          p(
            "A 'Grow-a-Plant' control room (/greenhouse.html) backed by a standalone external greenhouse service over gRPC, with a live sensor feed over WebSocket.",
          ),
        ]),
        heading("Grow a crop", [
          flow([
            { label: "Plant a crop in a slot", detail: "POST /greenhouse/:slot/plant" },
            { label: "Water it", detail: "POST /greenhouse/:slot/water" },
            { label: "Sensors update live", detail: "GET /greenhouse/ws (WebSocket)" },
            { label: "Harvest", detail: "POST /greenhouse/:slot/harvest" },
          ]),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["GET", "/greenhouse/crops", "Available crops"],
              ["GET", "/greenhouse", "Current greenhouse / slot state"],
              ["POST", "/greenhouse/:slot/plant", "Plant a crop in a slot"],
              ["POST", "/greenhouse/:slot/water", "Water a slot"],
              ["POST", "/greenhouse/:slot/harvest", "Harvest a slot"],
              ["GET", "/greenhouse/ws", "Live sensor feed (WebSocket)"],
            ],
          ),
          callout(
            "info",
            "Demo mode & offline",
            "Identity resolves from a logged-in session or a demo id, so it can be explored without a full login. If the service is offline, endpoints return 503 — start it with `npm run greenhouse`.",
          ),
        ]),
      ],
    },
  },
  {
    flag: "farmStayEnabled",
    section: {
      section: "farm-stay",
      title: "FarmStay (External Service)",
      content: [
        heading("Overview", [
          p(
            "FarmStay lets users search, book, and manage farm-stay properties (/farm-stay.html, plus /farm-stay-analytics.html). It talks to a standalone external FarmStay gateway, but money lives in Rolnopol.",
          ),
        ]),
        heading("Booking & payment flow", [
          flow([
            { label: "Search properties", detail: "GET /farm-stay/search" },
            { label: "Create a booking", detail: "POST /farm-stay/bookings" },
            { label: "Confirm the booking", detail: "POST /farm-stay/bookings/:id/confirm", arrow: "charges ROL" },
            { label: "Booking confirmed", detail: "receipt PDF available" },
          ]),
        ]),
        heading("Scenario: not enough ROL", [
          scenario([
            "Search and create a booking for a property.",
            "Confirm the booking while your ROL balance is too low.",
            "The charge is rolled back and the API responds with HTTP 402 (payment required); the booking is not confirmed.",
          ]),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["GET", "/farm-stay/search", "Search available properties"],
              ["GET/POST", "/farm-stay/properties", "Browse / create properties (hosting)"],
              ["POST", "/farm-stay/bookings", "Create a booking"],
              ["POST", "/farm-stay/bookings/:id/confirm", "Confirm and pay for a booking"],
              ["POST", "/farm-stay/bookings/:id/cancel", "Cancel a booking (partial refund)"],
              ["GET", "/farm-stay/bookings/:id/receipt.pdf", "Booking receipt (PDF)"],
            ],
          ),
          callout(
            "info",
            "Money & admin",
            "Confirming charges ROL (rolls back on insufficient funds → 402); cancelling refunds a percentage. Platform-wide analytics additionally require an admin caller (enforced by the gateway). Requires login.",
          ),
        ]),
      ],
    },
  },
  {
    flag: "rolnopolFarmlogEnabled",
    section: {
      section: "farmlog",
      title: "Rolnopol Blog Space (Farmlog)",
      content: [
        heading("Overview", [
          p(
            "Farmlog is the Rolnopol blog space (/farmlog.html) where users create and browse blogs and posts. Reading is public; creating, editing, and deleting require login.",
          ),
          ul([
            "'rolnopolFarmlogEngagementEnabled' adds likes, blog/post favorites, and a most-liked ranking.",
            "Engagement requires both flags — turning off Farmlog disables engagement regardless of its own flag.",
          ]),
        ]),
        heading("Publishing flow", [
          flow([
            { label: "Create a blog", detail: "POST /blogs (login)" },
            { label: "Publish a post", detail: "POST /blogs/:blogSlug/posts" },
            { label: "Readers view it", detail: "GET /blogs/:slug (public)" },
            { label: "Readers engage", detail: "like / favorite (when engagement is on)" },
          ]),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["GET", "/blogs", "List blogs"],
              ["GET", "/blogs/:slug", "Read a blog"],
              ["GET", "/blogs/:blogSlug/posts/:postSlug", "Read a post"],
              ["POST/DELETE", "/blogs/:blogSlug/posts/:postSlug/like", "Like / unlike a post (engagement)"],
              ["POST/DELETE", "/blogs/:blogSlug/favorite", "Favorite / unfavorite a blog (engagement)"],
            ],
          ),
        ]),
      ],
    },
  },
  {
    flag: "rolnopolFarmlogEngagementEnabled",
    section: {
      section: "farmlog-engagement",
      title: "Farmlog — Engagement",
      content: [
        heading("Overview", [
          p("Adds engagement to Farmlog: post likes, blog/post favorites, and a most-liked post ranking."),
          ul([
            "Endpoints: POST/DELETE /blogs/:blogSlug/posts/:postSlug/like and POST/DELETE /blogs/:blogSlug/favorite.",
            "Like/favorite actions require login.",
          ]),
          callout(
            "info",
            "Requires Farmlog",
            "Engagement needs both 'rolnopolFarmlogEnabled' and this flag; disabling the parent disables engagement entirely.",
          ),
        ]),
      ],
    },
  },
  {
    flag: "petBuddyEnabled",
    section: {
      section: "pet-buddy",
      title: "Pet Buddy",
      content: [
        heading("Overview", [
          p(
            "A companion mini-feature (/buddy.html): hatch a virtual pet, customize it (eyes, hat), and interact with it (pet, talk, ask for help). Requires login; users can only act on their own pet.",
          ),
        ]),
        heading("Companion flow", [
          flow([
            { label: "Hatch a pet", detail: "POST /buddy" },
            { label: "Customize it", detail: "PATCH /buddy/:id (eyes, hat)" },
            { label: "Interact", detail: "pet / talk / ask-help" },
          ]),
        ]),
        heading("Endpoints", [
          table(
            ["Method", "Path", "Description"],
            [
              ["POST", "/buddy", "Hatch a pet"],
              ["GET", "/buddy", "Get the user's pet"],
              ["PATCH", "/buddy/:id", "Customize the pet"],
              ["POST", "/buddy/:id/pet", "Pet interaction"],
              ["POST", "/buddy/:id/talk", "Talk interaction"],
              ["POST", "/buddy/:id/ask-help", "Ask the pet for help"],
            ],
          ),
          callout("warning", "When disabled", "Buddy actions respond with HTTP 403 ('Pet Buddy feature is not enabled')."),
        ]),
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Marketing / privacy / monitoring
  // ---------------------------------------------------------------------------
  {
    anyFlags: ["promoAdvertsHomeEnabled", "promoAdvertsAlertsEnabled", "promoAdvertsGeneralAdEnabled", "promoAdvertsBottomBannerEnabled"],
    section: {
      section: "promo-adverts",
      title: "Promotional Adverts",
      content: [
        heading("Overview", [
          p("Optional Rolnopol promotional placements. No login required."),
          ul([
            "promoAdvertsHomeEnabled: promo popup on the home/dashboard page.",
            "promoAdvertsAlertsEnabled: promo popup on alerts pages.",
            "promoAdvertsGeneralAdEnabled: promo popup on any general page; also the fallback when the home/alerts popup is off. Excludes system pages (login, register, admin, swagger, etc.).",
            "promoAdvertsBottomBannerEnabled: a persistent banner fixed at the bottom of pages (independent of the popups).",
          ]),
          callout("info", "Throttling", "Popups are throttled by a per-placement cookie, and only one popup shows at a time."),
        ]),
      ],
    },
  },
  {
    flag: "cookieConsentBannerEnabled",
    section: {
      section: "cookie-consent",
      title: "Cookie Consent Banner",
      content: [
        heading("Overview", [
          p(
            "Shows a cookie-consent banner fixed at the bottom of pages until the user accepts. Appears site-wide on pages that load the shared navigation, and links to the privacy page.",
          ),
          callout(
            "info",
            "Remembered choice",
            "Accepting sets a consent cookie (about 7 days); the banner is skipped while that cookie is present. No login required.",
          ),
        ]),
      ],
    },
  },
  {
    flag: "prometheusMetricsEnabled",
    section: {
      section: "prometheus-metrics",
      title: "Prometheus Metrics",
      content: [
        heading("Overview", [
          p("Enables Prometheus-style metrics collection and the GET /metrics endpoint (text/plain exposition format)."),
          ul([
            "Toggling the flag turns metric recording on/off; disabling clears the counters.",
            "There is no dedicated UI page — this is an operations/monitoring endpoint.",
          ]),
          callout(
            "warning",
            "Publicly reachable",
            "Once enabled, /metrics has no authentication and is publicly reachable — treat it as an internal/ops feature.",
          ),
        ]),
      ],
    },
  },
];
