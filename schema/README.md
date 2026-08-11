# OpenAPI schema

`public/schema/openapi.v1.json` and `public/schema/openapi.v2.json` are **generated**. Editing them by hand will be undone by the next `npm run schema:generate`, and `tests/unit/openapi-contract.test.js` will fail in the meantime.

```
npm run schema:generate    # rewrite openapi.v1.json and openapi.v2.json
npm run schema:check       # exit 1 if the committed files are stale (CI)
```

`public/schema/openapi.json` is the **superseded hand-written schema**, still offered in Swagger UI as a deprecated definition. The generator does not own it and never overwrites it. It predates the coverage rules and violates most of them — 8 of its 57 paths point at routes that do not exist, and it declares two `servers` for one document — so the contract test asserts only that `schema:generate` leaves it alone. Point consumers at v1.

## Why two documents

v1 exposes 328 operations; v2 exposes 2. A single document with two `servers` entries cannot express that — in OpenAPI, `servers` means "the same API at several base URLs", so Swagger UI would keep every v1 operation on screen after you picked the v2 server and ~99% of them would 404.

So each version gets its own document, offered through Swagger UI's definition dropdown. They share `schema/components/`, so promoting an endpoint from v1 to v2 later is a copy of one override entry, not a re-description.

The five endpoints mounted outside the version prefix (`/api/logs`, `/api/debug`, `/api/version`, …) live in the v1 document with an operation-level `servers: [{ url: "/api" }]` override, which OAS 3.0 permits. That avoids a third definition for five endpoints.

## Where each part comes from

| Part                                          | Source                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Which operations exist                        | Walking the live `routes/v1` and `routes/v2` routers                               |
| Tags                                          | The route file an operation is defined in (`observatory.route.js` → `Observatory`) |
| `security`, 401/403                           | `authKind` tag on the auth middleware                                              |
| `x-feature-flag`, 404                         | `featureFlag` tag on the feature-flag middleware                                   |
| `x-rate-limit`, 429                           | `rateLimitType` tag on the rate limiters                                           |
| Summaries, request bodies, response schemas   | `schema/overrides/<version>/*.json`                                                |
| Reusable schemas, responses, security schemes | `schema/components/*.json`                                                         |
| Titles, descriptions, unversioned mounts      | `schema/generator.config.js`                                                       |

Coverage is total because it is derived from what is _mounted_, not from what somebody remembered to annotate. Adding a route to any `*.route.js` puts it in the schema on the next generate — and until you run it, the contract test fails.

## Adding detail to an operation

Create or edit a file under `schema/overrides/v1/` keyed by `METHOD /path` (the path as it appears in the document, with `{param}` placeholders). The file name only groups things for humans; every file in the directory is merged.

```json
{
  "GET /observatory/viewport": {
    "summary": "Sky objects projected into canvas pixels for a zoom/pan viewport",
    "parameters": [{ "name": "zoom", "in": "query", "schema": { "type": "number" } }],
    "responses": {
      "200": {
        "description": "Viewport with visible objects",
        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Viewport" } } }
      }
    }
  }
}
```

Overrides deep-merge over the generated operation and win on conflict; arrays are replaced wholesale. An override that matches no live route is reported as a warning and fails the contract test — that is how a renamed route gets noticed.

## Feature flags

Flag-gated endpoints are documented **whether or not their flag is on**, carrying `x-feature-flag` and a `404` response. Roughly half the surface is gated, and a tester needs to see that an endpoint exists and which switch turns it on. Hiding disabled endpoints would make the document change shape depending on runtime state.

## Middleware tagging

The generator can only read guards because the middleware factories tag the functions they return:

```js
middleware.featureFlag = flagName; // middleware/feature-flag.middleware.js
middleware.authKind = "user"; // middleware/auth.middleware.js
limiter.rateLimitType = "high"; // api/limiters.js
```

The flag name and auth mode are otherwise sealed inside a closure. If you add a new guard middleware, tag it the same way or its endpoints will be documented as unguarded.
