# Loop — Project state

> **Purpose of this file:** single source of truth for the project's
> current architecture, what's done, what's pending, and where every
> piece lives. If a new Claude session picks this up, read this first.

Last updated: 2026-05-30 — after Phase 6 ops infrastructure + CI + docs + marketing mockups.

---

## For the operator: launching this thing

**→ [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md)** is the step-by-step
guide from "Loop works for Staytuned" to "Loop is live in the Intercom
App Store." Read that if you're trying to ship the public version. This
file (PROJECT_STATE.md) is for understanding what the codebase IS;
LAUNCH_CHECKLIST is for understanding what to DO.

## TL;DR

**What Loop is:** Intercom Canvas Kit app that surfaces the Featurebase
changelog + roadmap inside the Messenger.

**Two deploys, one codebase:**
- `main` branch = single-tenant Staytuned production at
  `featurebase-widget-production.up.railway.app`
- `multi-tenant` branch = public-version-in-progress (same code +
  per-tenant scaffolding gated by env vars)

The single-tenant production runs **all the same code** as the
multi-tenant branch when `DATABASE_URL` / `INTERCOM_CLIENT_ID` are
unset. All multi-tenant code paths short-circuit. **Merging multi-
tenant → main when ready will NOT break Staytuned production** as
long as those env vars stay unset on that Railway service.

**GitHub repo:** <https://github.com/Zsiecinski/featurebase-widget>

---

## The visual brand (decided)

| | |
|---|---|
| Name | **Loop** |
| Tagline | **Close the feedback loop in Messenger.** |
| Primary color | Coral 500 `#F43F5E` |
| Secondary color | Coral 400 `#FB7185` (lighter accent) |
| Logo concept | Infinity symbol (∞) on coral rounded square |
| Type | Inter / system sans |

Logo and brand kit live in `assets/`. SVG masters + PNG renders for
all sizes (192/256/512, favicon 64, OG 1200×630, apple-touch 180,
wordmark 720×200). Regenerate with `npm run logos`.

### Canvas Kit pill badges (separate from app icon)

- 🟢 NEW — `pill-new.png` (green `#10B981`)
- 🟣 IMPROVED — `pill-improved.png` (purple `#8B5CF6`)
- 🟠 FIXED — `pill-fixed.png` (orange `#F97316`)
- 🔵 IN PROGRESS — `pill-in-progress.png` (blue `#3B82F6`, Coming Next section only)

Rendered at 360×120 source, displayed at 60×20 in the Canvas Kit avatar slot.

---

## Architecture by branch

### `main` (single-tenant Staytuned production)

```
src/
├── server.js          Express + Canvas Kit endpoints + marketing site serving
├── config.js          Env-var config (FEATUREBASE_API_KEY etc.)
├── featurebase.js     API client (reads from config.js)
├── canvas.js          homeCanvas / detailCanvas / needsSetupCanvas / errorCanvas
└── mock.js            Mock changelogs + in-progress posts for dev

test/
├── canvas.test.js     ~17 tests
└── featurebase.test.js ~18 tests
                       (35 total passing on main)

website/
├── index.html         Landing page (hero, features, pricing, FAQ)
├── privacy.html       Privacy policy template
├── terms.html         Terms of service template
└── styles.css         Coral brand styles

assets/
├── logo.svg / logo-{192,256,512}.png        Loop app icon
├── favicon.svg                              Tab favicon
├── wordmark.svg                             Icon + "Loop" text
├── og.svg / og.png                          Social preview (1200×630)
├── apple-touch-icon.png                     iOS home screen icon
├── pill-{new,improved,fixed,in-progress}.png  Canvas Kit badges
└── badge-*.png (legacy circle badges, not used in production)

scripts/
├── generate-pngs.mjs    Sharp-based SVG→PNG renderer (`npm run logos`)
├── render-concepts.mjs  One-off for the logo concept comparison
└── (provision/deploy scripts from earlier exist but unused now)
```

**Production env vars (Railway):**
- `FEATUREBASE_API_KEY` = `fb_live_...`
- `FEATUREBASE_CATEGORY` = `Kiwi`
- `ROADMAP_URL` (optional, default Staytuned roadmap)
- `DEBUG_TOKEN` (optional, gates `/debug/changelogs`)

### `multi-tenant` (public App Store version, in progress)

Inherits all of main, adds:

```
src/
├── server.js          + resolveCredentials(), per-tenant lookup,
                       multi-tenant Configure form, save-to-DB,
                       webhook signature middleware on Canvas endpoints
├── featurebase.js     Refactored: every function takes credentials param,
                       credsOrDefault() falls back to env vars when null
├── canvas.js          + needsSetupCanvas for unconfigured tenants
├── intercom.js        OAuth helpers + HMAC verifyCanvasKitSignature middleware
├── auth-routes.js     /auth/install, /auth/callback, /auth/uninstall,
                       DELETE /auth/data (GDPR right-to-erasure)
└── db/
    ├── index.js       postgres.js client, AES-256-GCM encrypt/decrypt,
                       tenant repository (findTenantByWorkspace,
                       upsertTenantOnInstall, saveFeaturebaseConfig,
                       markUninstalled)
    └── schema.sql     tenants, card_settings, tenant_events tables

scripts/
└── db-migrate.mjs     Idempotent schema apply, runs on every npm start

test/
+ intercom.test.js     ~7 signature + multi-tenant tests
+ db.test.js           ~6 AES-GCM encrypt/decrypt tests
                       (48 total passing on multi-tenant)

MULTI_TENANT_ROADMAP.md   Phase-by-phase status
APP_STORE_LISTING.md      Full listing copy + screenshot brief
PRIVACY_POLICY.md         Full template (richer than website's HTML version)
TERMS.md                  Full template (richer than website's HTML version)
```

**Multi-tenant env vars (when set, enable multi-tenant mode):**
- `DATABASE_URL` = Railway Postgres URL
- `FB_ENCRYPTION_KEY` = 32-byte hex (run `openssl rand -hex 32`)
- `INTERCOM_CLIENT_ID` = from Intercom Dev Hub
- `INTERCOM_CLIENT_SECRET` = from Intercom Dev Hub (also signs requests)
- `INTERCOM_OAUTH_REDIRECT_URI` = `https://<deploy>/auth/callback`

---

## Status by phase

### ✅ Phase 1 — Multi-tenant foundation (DONE on multi-tenant branch)

DB schema, tenant repo, AES-256-GCM key encryption, OAuth helpers,
HMAC verification helpers, `/auth/install`, `/auth/callback`.

### ✅ Phase 2 — Per-tenant Featurebase calls (DONE on multi-tenant branch)

`featurebase.js` takes `credentials` parameter on every function.
`credsOrDefault()` falls back to env-var config when null (single-tenant
preserved). `resolveCredentials(req)` looks up tenant by workspace_id.
`needsSetupCanvas` for unconfigured tenants. API key validation via
real Featurebase call before saving. Configure form gains FB credential
fields when multi-tenant mode is enabled.

### ✅ Phase 3 — HMAC signature enforcement (DONE on multi-tenant branch)

Raw-body capture via `express.json({ verify })`. `verifyCanvasKitSignature`
applied to `/initialize`, `/submit`, `/configure`. Middleware short-circuits
in single-tenant mode (no secret set). Tested: missing sig → 401, wrong
sig → 401, valid HMAC-SHA256 sig → next().

### ⚠️ Phase 4 — App Store listing prep (TEMPLATES DRAFTED, awaiting user input)

- ✅ `APP_STORE_LISTING.md` — listing copy, screenshot brief, OAuth scopes,
  submission checklist
- ✅ `PRIVACY_POLICY.md` + `TERMS.md` — templates with placeholders
- ✅ `website/index.html` + privacy.html + terms.html — live on main, served
  at `featurebase-widget-production.up.railway.app/`
- ❌ Privacy + terms placeholders filled in (jurisdiction, company name, etc.)
- ❌ Support email forwarder set up
- ❌ Marketing screenshots taken in production Messenger
- ❌ Pricing decision finalised (recommended: Free for v1)
- ❌ Domain decision (`loop.app`, custom domain, etc.)

### ⏳ Phase 5 — Submit to Intercom for review (BLOCKED on Phase 4 user input)

When all of Phase 4 user items above are done, submit listing in
Intercom Developer Hub. Review takes ~5 business days. May request
changes (usually data handling clarity or onboarding UX).

### ⏳ Phase 6 — Post-launch ops (NOT STARTED)

Sentry integration, per-workspace rate limiting, tenant analytics,
support escalation flow.

---

## What's pending and who's blocked

### Pending on user (cannot do alone)

- [ ] Create second Railway service deploying from `multi-tenant` branch
- [ ] Add Postgres plugin to that service (auto-injects `DATABASE_URL`)
- [ ] Generate `FB_ENCRYPTION_KEY` and set in that service
- [ ] Create second Intercom Developer Hub app for the public version
- [ ] Set OAuth credentials in Railway env vars
- [ ] Fill placeholders in `PRIVACY_POLICY.md`, `TERMS.md`, website's privacy/terms
  with company name, jurisdiction, support email
- [ ] Set up `support@<domain>` email forwarder
- [ ] Take 5 marketing screenshots per APP_STORE_LISTING.md brief
- [ ] Pricing decision (recommended: Free v1)
- [ ] Domain decision (optional but recommended before App Store submit)
- [ ] Submit listing in Intercom Developer Hub
- [ ] Update Intercom URLs to bump cache (every Railway deploy: bump
  `?v=N+1` in Initialize/Submit/Configure URLs)

### Done since the initial Phase 4 snapshot

- [x] Sentry integration (`src/observability.js`, env-var gated by `SENTRY_DSN`)
- [x] Per-workspace rate limiting (`src/rate-limit.js`, 120 req/min default)
- [x] `/admin/tenants/:workspace_id` support endpoint (`src/admin-routes.js`,
  behind `ADMIN_TOKEN`)
- [x] Error handler middleware mounted last
- [x] Website synced to both branches
- [x] PROJECT_STATE.md created on both branches
- [x] CI workflow (`.github/workflows/ci.yml`) running tests + PNG-up-to-date
  check on push and PR for both branches
- [x] `/website/docs.html` — full installer-facing docs page with sidebar nav
- [x] `/website/mockups.html` — branded mockups for App Store screenshots
- [x] Root README rewritten with full endpoint reference + branch architecture
- [x] Integration tests for marketing site routes (9 tests covering all
  static routes, 404s, content-type assertions)

### Can do without user (will continue in subsequent sessions)

- [ ] More integration tests (mocked DB for multi-tenant paths, OAuth flow)
- [ ] `listTenants()` for `/admin/tenants` (currently single-lookup only)
- [ ] Per-tenant background job (re-validate FB keys nightly, mark expired)
- [ ] Marketing site additions: testimonials section (with placeholder copy),
  comparison-with-changelog-only-tools section
- [ ] Status page / uptime monitor public URL
- [ ] CHANGELOG.md for the public version's own changelog (meta)

---

## Key decisions made (for context)

| Decision | Choice | Why |
|---|---|---|
| Product name | Loop | Closes feedback loop; short, brandable |
| Primary color | Coral `#F43F5E` | Contrarian vs B2B blue/purple sea; pops in App Store grid |
| Logo direction | Infinity ∞ | 1:1 name-shape match, easy to recall |
| Hosting (single-tenant) | Railway | Already running, $5/mo |
| Hosting (public version) | Railway + Postgres plugin | Same dashboard, single ops surface |
| Database | Postgres via postgres.js | Lightweight, tagged-template SQL, no ORM |
| Encryption | AES-256-GCM via Node crypto | Standard, no extra deps |
| OAuth library | Hand-rolled with fetch | Avoid Passport bloat for one flow |
| Web framework | Express 4 | Already in use, simple |
| Marketing site stack | Static HTML/CSS | No framework needed, deploys with Express |
| Two-branch strategy | main = single-tenant, multi-tenant = public | Branches converge once multi-tenant is fully tested |
| Cache busting | `?v=N` query param in Intercom URLs | Forces Intercom to refetch on every config change |
| Configure save flow | All in `/configure` endpoint | Intercom routes saves there, not `/submit` |
| Type badges UI | Image (item.image with image_width/height) | Avatar slot, real visual chips |
| "Shipped" vs "Updated" | Updated | More accurate for re-published entries |

---

## Critical gotchas worth remembering

1. **Intercom Canvas Kit caches aggressively per workspace + URL.** To
   force a fresh render after any change, bump `?v=N` in the URL field
   in Intercom Dev Hub → Canvas Kit. Without this, even valid no-store
   headers don't help.

2. **Configure save is routed to `/configure`, not `/submit`.** Different
   from runtime interactions. Detect by `component_id === 'save_config'`.

3. **`/configure` save response must NOT include a canvas.** Returning
   only `card_creation_options` (or `results`) closes the modal. Returning
   a canvas keeps it open as a re-render.

4. **Featurebase `/v2/post_statuses` returns a bare array, not `{data: []}`.**
   Unlike `/v2/changelogs`. Both shapes handled defensively.

5. **`hideFromBoardAndWidgets` flag is respected.** Loop matches the
   visibility of Featurebase's own public board. Segment restrictions
   (`allowedSegmentIds`) are NOT enforced — we don't have an
   Intercom-user ↔ Featurebase-segment mapping.

6. **List item `image` field requires `image_width` + `image_height`.**
   Without them, Intercom rejects the entire canvas with "Something
   went wrong while trying to set up that card."

7. **`rounded_image` field on list items breaks the canvas** in some
   Canvas Kit versions even though docs list it. Don't set it.

8. **Multi-tenant code paths are env-var gated.** No `DATABASE_URL` =
   no DB calls. No `INTERCOM_CLIENT_SECRET` = signature middleware
   bypasses. The same code runs both deploys.

9. **`/configure` handler must be `async`.** Used to be sync; now does
   DB writes. Forgetting `async` causes a boot-time syntax error.

10. **Public webpage at `/` serves marketing site** (since the website push
    on main). The old "app is running" placeholder is gone.

---

## How to resume in a fresh session

1. Read this file.
2. Check `git log --oneline` on both `main` and `multi-tenant` to see
   recent commits.
3. Check `MULTI_TENANT_ROADMAP.md` (on multi-tenant branch) for
   phase-by-phase status.
4. Run `npm test` on both branches — 35 tests on main, 48 on multi-tenant.
5. Hit the deploy URL — `featurebase-widget-production.up.railway.app/` —
   should render the marketing site, not an error.
6. Check Railway HTTP logs for recent traffic patterns.

Common next moves at any given time:

- **Continue Phase 6 / nice-to-haves** → keep working on the multi-tenant
  branch (Sentry, rate limit, more tests)
- **Iterate on the marketing site** → work on main, deploys to Staytuned
  production URL
- **Operator-blocking items** → wait for user; meanwhile do other code work

---

## File index (where to find things)

```
/
├── PROJECT_STATE.md          ← this file (read first!)
├── MULTI_TENANT_ROADMAP.md   ← multi-tenant phase status (on multi-tenant branch)
├── APP_STORE_LISTING.md      ← listing copy + screenshot brief (on multi-tenant)
├── PRIVACY_POLICY.md         ← full privacy template (on multi-tenant)
├── TERMS.md                  ← full terms template (on multi-tenant)
├── README.md                 ← root readme (rough, needs update)
├── package.json              ← deps + scripts
├── railway.json              ← Railway deploy config
├── .env.example              ← env var documentation
│
├── src/
│   ├── server.js             ← Express app + all routing
│   ├── config.js             ← env loader (single-tenant config)
│   ├── canvas.js             ← homeCanvas + detailCanvas + needsSetupCanvas + errorCanvas
│   ├── featurebase.js        ← FB API client (creds param on multi-tenant)
│   ├── mock.js               ← mock data for dev/tests
│   ├── intercom.js           ← OAuth + HMAC verification (multi-tenant only)
│   ├── auth-routes.js        ← /auth/* endpoints (multi-tenant only)
│   └── db/                   ← Postgres client + tenant repo (multi-tenant only)
│
├── test/                     ← node:test tests (35 main / 48 multi-tenant)
├── website/                  ← marketing site (HTML/CSS, on main)
├── assets/                   ← SVG masters + PNG renders for branding
└── scripts/                  ← PNG generator + DB migrator
```
