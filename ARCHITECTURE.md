# 🏗️ Rolnopol — Architecture & Communication Design

> A technical companion to the [README](./README.md). This document explains **how Rolnopol is built** and **how its components talk to each other**, with diagrams rendered directly on GitHub via [Mermaid](https://mermaid.js.org/).

Rolnopol is a single-process **Express.js** application that serves a static multi-page frontend, a versioned **REST API**, and two independent **WebSocket** channels — all backed by a set of **JSON files acting as a database**. It is intentionally feature-rich (and intentionally buggy in places) to act as a realistic playground for test automation.

## Table of Contents

- [1. High-Level Overview](#1-high-level-overview)
- [2. Layered Architecture](#2-layered-architecture)
- [3. Runtime Bootstrap](#3-runtime-bootstrap)
- [4. Request Lifecycle (Middleware Pipeline)](#4-request-lifecycle-middleware-pipeline)
- [5. REST API Surface](#5-rest-api-surface)
- [6. Authentication & Authorization](#6-authentication--authorization)
- [7. Data Layer](#7-data-layer)
- [8. Real-Time Communication (WebSockets)](#8-real-time-communication-websockets)
- [9. Notification Center](#9-notification-center)
- [10. Feature Flags](#10-feature-flags)
- [11. Plugin Runtime](#11-plugin-runtime)
- [12. Chaos Engine](#12-chaos-engine)
- [13. Farm Defence (FD) Game Subsystem](#13-farm-defence-fd-game-subsystem)
- [14. Directory Map](#14-directory-map)

---

## 1. High-Level Overview

```mermaid
graph TD
    subgraph Client["🖥️ Browser / API Client"]
        UI["Static Pages<br/>(public/*.html + JS)"]
        WSC["WebSocket clients"]
        EXT["External API consumers<br/>(JWT / API key)"]
    end

    subgraph Server["🌱 Rolnopol — single Node.js process"]
        HTTP["Express HTTP app<br/>(api/index.js)"]
        WSM["Messenger WS gateway<br/>/api/v1/messages/ws"]
        WSN["Notification WS gateway<br/>/api/v1/notifications/ws"]
        NC["Notification Center<br/>(pub/sub hub)"]
        PR["Plugin Runtime"]
    end

    subgraph Data["🗄️ JSON 'database' (data/*.json)"]
        DB["DatabaseManager<br/>(singleton JSONDatabase instances)"]
    end

    UI -->|"HTTP REST /api/v1"| HTTP
    EXT -->|"HTTP REST /api/v1"| HTTP
    WSC -.->|"WebSocket upgrade"| WSM
    WSC -.->|"WebSocket upgrade"| WSN

    HTTP --> DB
    HTTP --> NC
    HTTP --> PR
    NC -.->|"real-time packets"| WSN
    HTTP -.->|"message events"| WSM
    WSM --> DB
```

Everything runs inside **one Node process**. The HTTP server (`http.createServer(app)`) is shared with both WebSocket gateways via the HTTP `upgrade` event, so there is a single listening port (default **3000**).

---

## 2. Layered Architecture

Rolnopol follows a conventional **routes → controllers → services → data** layering, with cross-cutting modules (auth, feature flags, notifications, plugins) injected through middleware.

```mermaid
graph TD
    A["Frontend<br/>public/ — HTML pages + vanilla JS client, event-bus"]
    B["Routing layer<br/>routes/v1, routes/v2 — URL → controller mapping"]
    C["Middleware<br/>auth · rate-limit · feature-flag · chaos · version · id-validation"]
    D["Controllers<br/>controllers/*.controller.js — thin HTTP handlers"]
    E["Services<br/>services/*.service.js — business logic & game engines"]
    F["Modules & Helpers<br/>notification-center · plugin-runtime · token · logger · response"]
    G["Data access<br/>data/database-manager.js — singleton JSONDatabase"]
    H["Persistence<br/>data/*.json files"]

    A --> B --> C --> D --> E
    E --> F
    E --> G --> H
    C --> F

    style A fill:#4f709c,stroke:#24395b,color:#ffffff,stroke-width:1.5px
    style B fill:#4f7f8c,stroke:#264952,color:#ffffff,stroke-width:1.5px
    style C fill:#5e7962,stroke:#34482d,color:#ffffff,stroke-width:1.5px
    style D fill:#6a5576,stroke:#3b2b46,color:#ffffff,stroke-width:1.5px
    style E fill:#7b5b5d,stroke:#442f31,color:#ffffff,stroke-width:1.5px
    style F fill:#5f6f87,stroke:#323f59,color:#ffffff,stroke-width:1.5px
    style G fill:#4a6b58,stroke:#27402f,color:#ffffff,stroke-width:1.5px
    style H fill:#6b5f46,stroke:#3d331f,color:#ffffff,stroke-width:1.5px
```

**Design principles in play:**

| Principle                 | Where it shows up                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| **Thin controllers**      | Controllers parse the request and delegate; logic lives in services.                      |
| **Singleton databases**   | `DatabaseManager` hands out one `JSONDatabase` per resource to serialize writes.          |
| **Runtime toggles**       | Feature flags gate routes & UI pages without redeploys.                                   |
| **Defensive loading**     | If `fd.route` (or other optional modules) fails to load, the app still boots with a stub. |
| **Authoritative server**  | Game state (e.g. Farm Defence) lives server-side; clients send actions only.              |
| **Event-driven realtime** | The Notification Center is a pub/sub hub feeding the WebSocket gateways.                  |

---

## 3. Runtime Bootstrap

What happens when you run `npm start` (`api/index.js`):

```mermaid
sequenceDiagram
    participant Node as node api/index.js
    participant Deps as Dependency check
    participant DB as DatabaseManager
    participant NC as Notification Center
    participant PR as Plugin Runtime
    participant HTTP as Express app
    participant WS as WebSocket gateways

    Node->>Deps: checkAllDependencies()
    Deps-->>Node: ✅ all node_modules present (else exit 1)
    Node->>DB: initializeDatabases() + load all DBs into memory
    Note over DB: in NODE_ENV=test → restore base state, writes immediate
    Node->>NC: notificationCenter.initialize({ featureFlagsService })
    Node->>PR: pluginRuntime.initialize({ pluginsDir, services })
    PR->>HTTP: attach(app) — request/response hooks
    Node->>HTTP: register middleware + routes (/api/v1, /api/v2)
    Node->>HTTP: performStartupHealthCheck()
    Node->>HTTP: http.createServer(app).listen(PORT)
    HTTP->>WS: messengerWS.attach(server)
    HTTP->>WS: notificationWS.attach(server)
    WS-->>Node: 🚀 Server running on port 3000
```

A guard middleware (`api/index.js:175`) holds incoming requests until `dbInitializationPromise` resolves, returning **503** if initialization is still in progress. **SIGINT / SIGTERM / SIGHUP** trigger a graceful shutdown that stops plugins, closes both WebSocket gateways, stops the Notification Center, and flushes databases.

---

## 4. Request Lifecycle (Middleware Pipeline)

Every HTTP request flows through an ordered middleware chain before reaching a controller.

```mermaid
flowchart TD
    Req(["Incoming HTTP request"]) --> Ready{"DB ready?"}
    Ready -->|no| R503["503 — initializing"]
    Ready -->|yes| Parse["body parsers + cookie-parser"]
    Parse --> Plugins["plugin request/response hooks"]
    Plugins --> Log["request logging"]
    Log --> Egg["easter-egg breadcrumb header<br/>(every 11th request)"]
    Egg --> Metrics["Prometheus observer<br/>(feature-flagged)"]
    Metrics --> IsApi{"path starts /api ?"}

    IsApi -->|yes| Chaos["Chaos Engine middleware<br/>(latency / errors / mutation)"]
    Chaos --> Version["version router + headers"]
    Version --> RouteApi["matched API route"]
    RouteApi --> AuthMW["auth.middleware<br/>(JWT / admin / API key)"]
    AuthMW --> RateMW["rate-limit.middleware"]
    RateMW --> FlagMW["feature-flag.middleware<br/>(requireFeatureFlag)"]
    FlagMW --> Ctrl["Controller → Service → Data"]
    Ctrl --> Resp["formatResponseBody → JSON response"]

    IsApi -->|no| Gate["UI feature-gates<br/>(messenger/weather/buddy/farmlog…)"]
    Gate --> Static["express.static(public/)"]
    Static --> NotFound["404 / custom 404 handlers"]
```

> Not every API route uses every middleware — `auth`, `rate-limit`, and `feature-flag` are applied **per-route** inside the route files. The Chaos Engine, version, logging, and Prometheus middleware are **global** for `/api`.

---

## 5. REST API Surface

All API routes are version-prefixed. `routes/v1/index.js` aggregates ~40 route modules under `/api/v1`; `routes/v2` exposes a minimal versioned surface. The version middleware (`middleware/version.middleware.js`) handles `/api` routing and version headers.

```mermaid
graph LR
    API["/api"] --> V1["/api/v1"]
    API --> V2["/api/v2 — version info + healthcheck"]
    API --> LOGS["/api/logs"]
    API --> DBG["/api/debug"]

    V1 --> Core["Core<br/>register · login · logout<br/>users/profile · about · healthcheck · ping"]
    V1 --> Admin["Admin<br/>admin/auth/login · admin/users"]
    V1 --> Farm["Farm domain<br/>fields · staff · animals · map · marketplace"]
    V1 --> Fin["Financial<br/>financial/* · commodities/*"]
    V1 --> Social["Social & content<br/>messenger · blogs · farmlog posts · tasks · alerts"]
    V1 --> Realtime["Realtime & integrations<br/>notifications · webhooks · personal-api-keys"]
    V1 --> Platform["Platform controls<br/>feature-flags · chaos-engine · metrics · statistics"]
    V1 --> Games["Games & prototypes<br/>fd · labyrinth · terminal · tape-recorder · observatory · buddy"]
    V1 --> AI["AI<br/>chatbot (Gemini / OpenRouter / mock)"]
```

Response bodies are normalized through `helpers/response-helper.js` (`sendSuccess` / `sendError` / `formatResponseBody`). OpenAPI/Swagger is served from `/swagger.html` and `/schema/openapi.json`.

A typical authenticated REST call:

```mermaid
sequenceDiagram
    actor C as Client
    participant MW as Middleware chain
    participant Ctrl as Controller
    participant Svc as Service
    participant DBM as DatabaseManager
    participant JSON as data/*.json

    C->>MW: GET /api/v1/financial/account (Bearer token)
    MW->>MW: chaos → version → auth → rate-limit → feature-flag
    MW->>Ctrl: req.user populated, passes gates
    Ctrl->>Svc: financialService.getAccount(userId)
    Svc->>DBM: getFinancialDatabase()
    DBM->>JSON: read (in-memory, semaphore-guarded)
    JSON-->>Svc: account data
    Svc-->>Ctrl: account
    Ctrl-->>C: 200 { success, data } (formatResponseBody)
```

---

## 6. Authentication & Authorization

Rolnopol supports **three** auth mechanisms, all resolved in `middleware/auth.middleware.js` and backed by `helpers/token.helpers.js` (JWT) + `data/session-tokens.json` (revocation list).

| Mechanism            | Credential location                                                | Token store              | Expiry  | Use                             |
| -------------------- | ------------------------------------------------------------------ | ------------------------ | ------- | ------------------------------- |
| **User JWT**         | `Authorization: Bearer`, `token` header, or `rolnopolToken` cookie | `session-tokens.json`    | 24h     | Normal user endpoints           |
| **Admin JWT**        | Bearer / `token` body / `krakenToken` cookie                       | `session-tokens.json`    | 1h      | Admin panel & platform controls |
| **Personal API key** | `x-api-key` header                                                 | `personal-api-keys.json` | per-key | Scoped programmatic access      |

```mermaid
sequenceDiagram
    actor U as User
    participant Auth as auth.controller / service
    participant Tok as token.helpers
    participant ST as session-tokens.json
    participant API as Protected endpoint

    U->>Auth: POST /api/v1/login { email, password }
    Auth->>Auth: lookup user in users.json, verify password
    Auth->>Tok: generate JWT (signed with JWT_SECRET)
    Tok->>ST: persist token (for later revocation)
    Auth-->>U: { token, userId, expiresAt }

    Note over U,API: Subsequent requests
    U->>API: request + token (header/cookie)
    API->>Tok: isUserLogged(token) — verify signature + expiry + store
    Tok-->>API: ✅ userId  /  ❌ 401 or 403
    API-->>U: protected resource

    U->>Auth: POST /api/v1/logout
    Auth->>ST: remove token (revoke)
```

API-key requests follow the same gate but resolve to `req.auth = { type: "api-key", scopes }`, and endpoints check the key carries the required **scope** (e.g. `read:financial`). Admin login is additionally protected by attempt-limiting (3 tries, 1-minute block).

> 🔐 Demo passwords are stored in **plain text** by design — this app is a testing target, not a security reference. The `JWT_SECRET` defaults to an insecure value and should be overridden via env var.

---

## 7. Data Layer

There is no SQL/NoSQL engine — each entity is a JSON file under `data/`, wrapped by a `JSONDatabase` class and handed out as a **singleton** by `data/database-manager.js`.

```mermaid
graph TD
    subgraph DM["DatabaseManager (singleton)"]
        UD["UsersDatabase"]
        FD["FinancialDatabase"]
        MD["MessagesDatabase"]
        CD["CommoditiesDatabase"]
        MK["MarketplaceDatabase"]
        FF["FeatureFlagsDatabase"]
        Etc["… fields, staff, animals,<br/>tasks, webhooks, api-keys,<br/>avatars, pets, chaos-engine"]
    end

    UD --> J1[("users.json")]
    FD --> J2[("financial.json")]
    MD --> J3[("messages.json")]
    CD --> J4[("commodities.json")]
    MK --> J5[("marketplace.json")]
    FF --> J6[("feature-flags.json")]

    note["JSONDatabase = read/write +<br/>semaphore lock + debounced writes<br/>(immediate in NODE_ENV=test)"]
```

Key behaviors:

- **One instance per resource** prevents concurrent-write corruption of a JSON file.
- Writes are **debounced** (`JSON_DB_WRITE_DEBOUNCE_MS`) in normal mode, **immediate** in tests.
- On startup all databases are loaded into memory; in `NODE_ENV=test` they are restored from a **base state** (`debug-database-restore.service.js`) for deterministic tests.

---

## 8. Real-Time Communication (WebSockets)

Two **independent** WebSocket gateways share the HTTP server via the `upgrade` event. Each authenticates the upgrade request (JWT), enforces per-IP and per-user rate limits, caps payloads at 16 KB, and runs a 30-second heartbeat sweep to drop stale sockets.

| Gateway           | Path                       | Source file                           | Purpose                                                        |
| ----------------- | -------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| **Messenger**     | `/api/v1/messages/ws`      | `services/messenger-ws.service.js`    | Live chat: new messages, `messagesRead`, `relationshipChanged` |
| **Notifications** | `/api/v1/notifications/ws` | `services/notification-ws.service.js` | Platform notifications, fed by the Notification Center         |

```mermaid
sequenceDiagram
    actor C as Browser
    participant HTTP as http.Server
    participant WS as Notification WS gateway
    participant NC as Notification Center

    C->>HTTP: GET /api/v1/notifications/ws (Upgrade: websocket, token)
    HTTP->>WS: 'upgrade' event (URL matches WS_PATH)
    WS->>WS: _authenticateUpgrade(request) — verify JWT
    alt authorized
        WS->>WS: handleUpgrade → emit 'connection'
        WS->>WS: track socket by userId (+ admin set)
        WS-->>C: 101 Switching Protocols
    else rejected
        WS-->>C: 401 / 403, socket destroyed
    end

    Note over WS,NC: gateway subscribed at attach() time
    NC-->>WS: subscribeRealtime(packet) callback
    WS->>WS: route packet by userId / admin
    WS-->>C: socket.send(JSON payload)
```

The Messenger gateway additionally **listens to message-domain events** (`relationshipChanged`, `messagesRead`) and fans them out to the affected users' sockets (a user may have multiple connections, tracked as `userId → Set<WebSocket>`).

---

## 9. Notification Center

`modules/notification-center/index.js` is an in-process **publish/subscribe hub** with an event log. It decouples producers (controllers, plugins, game engines) from the real-time transport (the Notification WS gateway).

```mermaid
graph LR
    subgraph Producers
        P1["Controllers"]
        P2["Plugins (e.g. firefly-notification)"]
        P3["Game / celebration events"]
    end

    P1 -->|"publish(event)"| NC["Notification Center"]
    P2 -->|"publish(event)"| NC
    P3 -->|"publish(event)"| NC

    NC -->|"subscribeRealtime"| WS["Notification WS gateway"]
    NC -->|"subscribeEvents / listEvents"| API["GET /api/v1/notifications/events"]
    NC --> Store[("events-store.json /<br/>notifications-store.json")]

    WS -.->|"push"| Client["Browser"]
```

Events have the shape `{ type, source, payload, timestamp }`. The whole subsystem is gated behind the `notificationCenterEnabled` feature flag, and exposes REST endpoints for health, listing events, and triggering test events.

---

## 10. Feature Flags

`data/feature-flags.json` + `services/feature-flags.service.js` provide runtime toggles for dozens of features (messenger, weather, commodities trading, farmlog, pet buddy, Prometheus metrics, promo adverts, etc.). They gate behavior at **three** levels:

```mermaid
graph TD
    FJ[("feature-flags.json")] --> FS["feature-flags.service"]
    FS --> M1["UI page gates (api/index.js)<br/>e.g. /messenger → 404 if disabled"]
    FS --> M2["requireFeatureFlag() route middleware<br/>blocks API endpoints"]
    FS --> M3["In-code checks<br/>flags?.flags?.someFeatureEnabled === true"]
    FS --> Admin["Admin UI: feature-flags.html<br/>PUT /api/v1/feature-flags"]
```

Toggling a flag takes effect on the **next request** — no restart needed (e.g. the Prometheus observer hot-toggles).

---

## 11. Plugin Runtime

`modules/plugin-runtime/index.js` discovers plugins in `plugins/`, resolves their enabled-state from a precedence chain, and attaches their hooks/routes to Express. Plugins receive injected services (`featureFlagsService`, `notificationCenter`).

```mermaid
graph TD
    Init["pluginRuntime.initialize({ pluginsDir, services })"] --> Disc["discover plugins/*"]
    Disc --> Res["resolve enabled state"]
    Res --> Attach["pluginRuntime.attach(app)"]
    Attach --> Hooks["request/response hooks + custom routes + event subs"]

    subgraph Precedence["enabled-state precedence (high → low)"]
        G["global plugins.manifest.json"] --> L["plugin.manifest.json (per-plugin)"] --> Code["index.js code default"] --> Off["disabled if unspecified"]
    end
```

Bundled plugins include easter eggs and observability helpers: `teapot-blocker` (HTTP 418), `secret-garden-route`, `harvest-moon-header`, `firefly-notification`, `response-size-logger`, `starlit-statistics`, `feature-flag-watcher`, and a `plugin-template` for new ones.

---

## 12. Chaos Engine

`middleware/chaos-engine.middleware.js` + `services/chaos-engine.service.js` inject controlled failures (latency, errors, data mutation) into `/api` traffic based on configurable, runtime-reconfigurable rules (`data/chaos-engine.json`). It exists to make the API a **realistic, occasionally-flaky** target for resilience and retry testing, and has an admin UI (`chaos-engine.html`).

---

## 13. Farm Defence (FD) Game Subsystem

The most complex recent feature is **Farm Defence**, a server-authoritative tower-defense game under `services/fd/`. The client (`public/operator/fd.html`) only sends actions and renders snapshots; all simulation runs on the server, which makes the leaderboard tamper-resistant.

```mermaid
graph TD
    subgraph Client
        FDUI["operator/fd.html"]
    end

    subgraph API["fd.route → fd.controller"]
        E1["GET /api/v1/fd — snapshot"]
        E2["GET /api/v1/fd/updates?since=rev — delta"]
        E3["POST /api/v1/fd/actions — build/sell/upgrade/startWave/tick"]
        E4["GET /api/v1/fd/achievements"]
        E5["GET /api/v1/fd/leaderboard"]
    end

    subgraph Engine["services/fd/"]
        Svc["fd.service — session orchestrator"]
        Tick["tick-engine — per-tick simulation"]
        TR["tower-registry"]
        ER["enemy-registry"]
        EF["effect-registry"]
        WG["wave-generator"]
        MG["map-generator"]
        Ach["achievements.service<br/>(listens to game events)"]
    end

    FDUI -->|actions| E3
    FDUI -->|poll snapshot| E1
    FDUI -->|poll delta| E2
    E3 --> Svc
    E1 --> Svc
    E2 --> Svc
    Svc --> Tick
    Tick --> TR & ER & EF & WG
    Svc --> MG
    Svc -->|onEvent| Ach
    Ach --> AJ[("fd-achievements.json")]
    E4 --> Ach
    E5 --> Svc
```

**Anti-cheat design:** achievements and leaderboard scores are computed from the **server-owned game state** (`state.stats`), never from client claims. The achievements service tracks a per-session baseline and only unlocks on positive deltas from actual gameplay. Sessions are isolated by a `sessionId` (default `"default"`), and snapshots carry a `revision` so clients can request only deltas via `/fd/updates?since=`.

The subsystem is **defensively loaded**: if `fd.service` fails to import, `fd.route` mounts stub routes returning **503**, and if the achievements service fails the core game still runs.

---

## 14. Directory Map

```
rolnopol-jt/
├── api/index.js              # entry point: bootstrap, middleware, server, WS attach
├── routes/
│   ├── v1/                   # ~40 route modules → controllers (the main API)
│   ├── v2/                   # minimal versioned surface
│   ├── logs.route.js · debug.route.js · contact.route.js
├── controllers/              # thin HTTP handlers (*.controller.js)
├── services/                 # business logic & engines (*.service.js)
│   ├── messenger-ws.service.js · notification-ws.service.js   # WS gateways
│   ├── chatbot/              # LLM providers/connectors/bots
│   └── fd/                   # Farm Defence engine (tick, registries, generators)
├── middleware/               # auth · rate-limit · feature-flag · chaos · version · id-validation
├── modules/
│   ├── notification-center/  # pub/sub hub + event log
│   ├── plugin-runtime/       # plugin discovery & lifecycle
│   ├── farm-stay/            # app-side HTTP client of the FarmStay gateway (gateway URL only)
│   ├── agri-academy/         # app-side HTTP clients of the AgriAcademy gateways (exam-center + authoring)
│   └── greenhouse/ · tasklab/ # app-side clients of the gRPC external services
├── external-services/        # standalone microservice ecosystems, independent of the app
│   ├── farm-stay/            # 5 services (REST gateway + inventory/pricing/reservation/review leaves)
│   ├── agri-academy/         # 5 services (exam-center + authoring REST gateways; question-bank/grading gRPC + certificate-issuer REST leaves)
│   ├── greenhouse/           # gRPC crop-simulation service
│   └── tasklab/              # gRPC task-board service
├── plugins/                  # optional plugins + plugins.manifest.json
├── helpers/                  # token · response · logger · validators · healthcheck · metrics
├── data/
│   ├── *.json                # the "database" (users, financial, tasks, …)
│   ├── database-manager.js   # singleton JSONDatabase registry
│   ├── json-database.js      # base read/write + locking class
│   └── settings.js           # centralized config (PORT, JWT_SECRET, rate limits, …)
├── public/                   # frontend: *.html pages, js/, css/, operator/ games, swagger
└── tests/                    # vitest unit + property-based tests
```

### External-service ecosystems

`external-services/` holds self-contained microservice ecosystems that **do not import from the Rolnopol app** — the app talks to each only over the wire (gRPC or REST) via a thin app-side client under `modules/`, all gated by feature flags. The largest is **FarmStay** (`farmStayEnabled`): a booking.com-style stays marketplace of five services — a thin REST **stay-gateway** (owns no data) orchestrating four leaves (**inventory** + **reservation** over gRPC, **pricing** + **review-desk** over REST). The gateway is the only service Rolnopol dials; see [`external-services/farm-stay/README.md`](./external-services/farm-stay/README.md) and its `PRD.md` for the full design (atomic date-range holds, TTL expiry, the price-change handshake, cancellation refund windows, and cross-service release repair). Run it with `npm run farmstay`; test it with `npm run farmstay:test`.

**AgriAcademy** (`agriAcademyEnabled`) is a timed-certification-exam ecosystem of **five** services that deliberately **mixes protocols**: two REST gateways Rolnopol dials — the **exam-center** (taking exams: sessions, two server-side clocks, attempt limits, grading + certificate orchestration) and the **authoring-service** (certification units, exam definitions, typed-question authoring, public unit pages) — orchestrating three leaves: **question-bank** and **grading** over gRPC and a **certificate-issuer** over REST. Money is never in the ecosystem: a paid exam is settled in ROL by the Rolnopol taker bridge (`routes/v1/agri-academy.route.js`) against `services/financial.service` — charge-the-taker/pay-the-unit/refund keyed by `referenceId`, with a `POST /reconcile` backstop (the farm-stay model). See [`external-services/agri-academy/README.md`](./external-services/agri-academy/README.md) and its `PRD.md` for the full design (pay-before-exam, the access-window + completion-window clocks, attempt cooldown locks, typed-question registry, idempotent certificate issuance, and aggregate health). Run it with `npm run academy`; test it with `npm run academy:test`.

---

> 📌 **Keeping this current:** when you add a route module, a WebSocket channel, a feature flag, or a new `services/fd/*` component, update the relevant diagram above. The diagrams are plain Mermaid in this Markdown file and render automatically on GitHub.

_Built with ❤️💚 for the Playwright and test automation community — see the [README](./README.md) for setup, deployment, and learning resources._
