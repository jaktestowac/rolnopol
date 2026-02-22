# Rolnopol — Feature Flags Proposal: Cookie Banner + Adverts Popups

Date: 2026-02-22

## Goal

Introduce **5 new feature flags** with minimal disruption to existing architecture:

1. **Cookie consent banner** at the bottom of the page.
2. **Page-specific adverts popups** (promo/info popups about Rolnopol features) controlled independently per page area.

This plan is based on the current implementation in:

- `services/feature-flags.service.js`
- `data/feature-flags.json`
- `public/js/services/feature-flags-service.js`
- `public/js/utils/init-navigation.js`
- `public/js/components.js`
- `public/css/styles.css`

---

## Current architecture (what we can reuse)

- Backend already supports dynamic boolean flags with defaults and grouping:
  - `PREDEFINED_FEATURE_FLAGS`
  - `FEATURE_FLAG_DESCRIPTIONS`
  - `FEATURE_FLAG_GROUPS`
- Frontend has a feature flags client (`FeatureFlagsService`) with short cache TTL and `isEnabled(flag, default)` API.
- Global page bootstrap exists via `initNavigation(...)` and shared scripts (`components.js`, `app.js`).
- Existing modal pattern is available:
  - JS: `showAppModal(...)` in `public/js/components.js`
  - CSS: `.app-modal*` styles in `public/css/styles.css`
- Existing cookie helper function is available (`getCookie`) and can be extended with safe setter helper.

This means both requested features can be added in a way consistent with existing coding style.

---

## Proposed new feature flags

### 1) Cookie banner flag

- **Key**: `cookieConsentBannerEnabled`
- **Default**: `false` (safe rollout)
- **Group**: `privacy`
- **Description**: `Enable or disable cookie consent banner shown at the bottom of pages`

### 2) Page-specific adverts popup flags

Each page area has its own flag for granular control:

#### 2a) Home advert flag

- **Key**: `promoAdvertsHomeEnabled`
- **Default**: `false` (safe rollout)
- **Group**: `marketing`
- **Description**: `Enable or disable Rolnopol promotional popups on home/dashboard pages`

#### 2b) Marketplace advert flag

- **Key**: `promoAdvertsMarketplaceEnabled`
- **Default**: `false` (safe rollout)
- **Group**: `marketing`
- **Description**: `Enable or disable Rolnopol promotional popups on marketplace pages`

#### 2c) Financial advert flag

- **Key**: `promoAdvertsFinancialEnabled`
- **Default**: `false` (safe rollout)
- **Group**: `marketing`
- **Description**: `Enable or disable Rolnopol promotional popups on financial/tracking pages`

#### 2d) Docs advert flag

- **Key**: `promoAdvertsDocsEnabled`
- **Default**: `false` (safe rollout)
- **Group**: `marketing`
- **Description**: `Enable or disable Rolnopol promotional popups on documentation pages`

#### 2e) Alerts advert flag

- **Key**: `promoAdvertsAlertsEnabled`
- **Default**: `false` (safe rollout)
- **Group**: `marketing`
- **Description**: `Enable or disable Rolnopol promotional popups on alerts pages`

#### 2f) Advert flag for advert display on any page

- **Key**: `promoAdvertsGeneralAdEnabled`
- **Default**: `false` (safe rollout)
- **Group**: `marketing`
- **Description**: `Enable or disable Rolnopol promotional popups on general pages. This applies to any page, but there can not be 2 popups at the same time. Also pages like swagger, privacy, backend, feature-flags etc. will be excluded from this.`

---

## Feature 1: Cookie banner behavior design

## UX behavior

- Banner appears fixed at bottom when:
  - `cookieConsentBannerEnabled === true`
  - user does **not** have consent cookie.
- Banner includes:
  - short message,
  - **Accept** button (required by request),
  - optional “More info” link to privacy docs.
- On **Accept**:
  - create cookie for **7 days**,
  - hide banner immediately.

## Cookie design

- Cookie name: `rolnopolCookieConsent`
- Value: `accepted`
- Expiration: `7 days`
- Scope: `path=/`
- Security suggestion:
  - add `SameSite=Lax`
  - add `Secure` when `location.protocol === 'https:'`

## Implementation touchpoints

- New JS module (recommended):
  - `public/js/components/cookie-consent.js`
  - handles rendering, cookie read/write, and feature flag check.
- Shared init integration:
  - call initialization from `public/js/utils/init-navigation.js` after feature flag service is ready.
- Optional style block in:
  - `public/css/styles.css` (`.cookie-consent-banner`, buttons, responsive rules).

## Edge cases

- If feature flag API fails, default to hidden (`false`) to avoid unexpected banner.
- If user has already accepted cookie, banner should never flash (check cookie before rendering).
- Handle pages without `header-component` gracefully (script should still work).

---

## Feature 2–5: Page-specific adverts popup behavior design

## UX behavior

- Popup appears only when:
  - **corresponding page flag is enabled** (e.g., `promoAdvertsHomeEnabled` for home page),
  - popup not shown recently (cooldown per page).
- Reuse existing app modal (`showAppModal`) for consistency.
- Content examples:
  - Home: "Try Rolnopol Marketplace" or "Explore our features"
  - Marketplace: "Discover better pricing tools"
  - Financial: "Track finances with smart reports"
  - Docs: "Use our advanced search filters"

## Display policy

- Avoid aggressive behavior:
  - show once per session per page,
  - delay open (e.g. 5–10s after page load),
  - do not show immediately after another modal.

## Page mapping

- `promoAdvertsHomeEnabled` → applies to `/`, `/index.html`, home/main pages
- `promoAdvertsMarketplaceEnabled` → applies to `/marketplace.html`
- `promoAdvertsFinancialEnabled` → applies to `/financial.html` and related pages
- `promoAdvertsDocsEnabled` → applies to `/docs.html`

## Config approach (optional)

Optionally store campaign metadata per page in a frontend config:

- New file: `public/js/config/promo-adverts-config.js`
- Shape example:
  - pageKey (e.g., `home`, `marketplace`)
  - title/body text
  - delaySeconds
  - priority

Storage key pattern:

- `rolnopolPromoAdvertSeen:<pageKey>` in `localStorage` (per-page cooldown)

## Implementation touchpoints

- New module:
  - `public/js/components/promo-adverts.js`
- Called from global flow in `public/js/utils/init-navigation.js`.
- Checks page-specific flag: `featureFlagsService.isEnabled('promoAdverts<PageName>Enabled', false)`.
- Can optionally load config from `public/js/config/promo-adverts-config.js`.
- Uses existing `showAppModal(...)` from `public/js/components.js`.

## Edge cases

- Missing/invalid config → skip popup silently.
- Multiple matching campaigns → show highest priority only.
- Respect auth redirects; don’t show popup during login redirect flow.

---

## Backend changes required (small)

Update `services/feature-flags.service.js`:

1. Add 5 keys to `PREDEFINED_FEATURE_FLAGS`:
   - `cookieConsentBannerEnabled: false`
   - `promoAdvertsHomeEnabled: false`
   - `promoAdvertsMarketplaceEnabled: false`
   - `promoAdvertsFinancialEnabled: false`
   - `promoAdvertsDocsEnabled: false`
2. Add descriptions in `FEATURE_FLAG_DESCRIPTIONS` for each.
3. Add new groups in `FEATURE_FLAG_GROUPS`:
   - `privacy: ['cookieConsentBannerEnabled']`
   - `marketing: ['promoAdvertsHomeEnabled', 'promoAdvertsMarketplaceEnabled', 'promoAdvertsFinancialEnabled', 'promoAdvertsDocsEnabled']`

Update persisted defaults in `data/feature-flags.json` with all 5 keys (set `false`).

No API contract changes are required because current endpoints already support unknown/new boolean flags.

---

## Frontend changes required

1. Add cookie consent component and CSS.
2. Add promo adverts component and optional config file.
3. Wire both initializers into global bootstrap (`init-navigation.js`).
4. Ensure script inclusion in pages that use shared initialization.
   - Most pages already load shared scripts and `initNavigation(...)`.

---

## Testing plan

## Unit tests

- `tests/unit/feature-flags.service.test.js`
  - update expected defaults to include:
    - `cookieConsentBannerEnabled: false`
    - `promoAdvertsHomeEnabled: false`
    - `promoAdvertsMarketplaceEnabled: false`
    - `promoAdvertsFinancialEnabled: false`
    - `promoAdvertsDocsEnabled: false`
  - verify reset/default population includes all.

## API tests

- `tests/feature-flags-api.test.js`
  - assert `GET /feature-flags?descriptions=true` returns all 5 new keys and groups.
  - verify reset includes all 5 defaulted to `false`.

## UI/integration tests (recommended)

- Cookie banner:
  - appears when flag on + cookie missing,
  - hides when accepted,
  - not shown again with valid cookie.
- Promo popups:
  - Home page: appears when `promoAdvertsHomeEnabled` is on, no flag = no popup,
  - Marketplace page: appears when `promoAdvertsMarketplaceEnabled` is on,
  - Financial page: appears when `promoAdvertsFinancialEnabled` is on,
  - Docs page: appears when `promoAdvertsDocsEnabled` is on,
  - Cooldown per page is respected (not re-shown in same session).

---

## Rollout strategy

Phase 1 (safe):

- Deploy code with all 5 flags default `false`.
- Verify no visual changes in production.

Phase 2 (cookie banner):

- Enable `cookieConsentBannerEnabled` only.
- Monitor user behavior and client errors.

Phase 3 (promo popups — granular roll-in):

- Enable **one page flag at a time**, starting with lower-traffic pages (e.g., docs).
- Enable `promoAdvertsDocsEnabled` → monitor → `promoAdvertsMarketplaceEnabled` → monitor → etc.
- Tune delays/content based on feedback before enabling home (highest traffic).

---

## Suggested implementation order (small PRs)

1. Backend: add 5 flags + tests updates.
2. Cookie banner component + CSS + integration.
3. Promo popup component + config + page mapping + integration.
4. Final test pass and UX polish across all 4 page areas.

---

## Risks and mitigations

- **Risk**: popup fatigue / poor UX.
  - **Mitigation**: cooldown + delayed display + single popup at a time.
- **Risk**: cookie banner flashes on every page load.
  - **Mitigation**: cookie check before DOM insert.
- **Risk**: feature flag fetch latency affects first paint.
  - **Mitigation**: default hidden behavior and short-circuit if cached flag exists.

---

## Deliverables checklist

- [ ] Add 5 flags in backend defaults/descriptions/groups (`cookieConsentBannerEnabled` + 4 page-specific promo flags).
- [ ] Update `data/feature-flags.json` defaults.
- [ ] Implement `cookie-consent` frontend component (7-day cookie).
- [ ] Implement `promo-adverts` frontend component with page mapping + per-page cooldown.
- [ ] Create optional `promo-adverts-config.js` with page metadata (title, body, delay).
- [ ] Wire both into shared bootstrap (`init-navigation.js`).
- [ ] Add/update tests (service + API + UI as available).
- [ ] Validate manually on: `index` (home), `docs`, `marketplace`, `financial` pages.
