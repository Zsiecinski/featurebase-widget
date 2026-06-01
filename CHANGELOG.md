# Loop changelog

Notable changes shipped on the Loop public version. Format inspired by
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The Staytuned-internal single-tenant version (the `main` branch deploy
at `featurebase-widget-production.up.railway.app`) shares all features
listed here except where noted "multi-tenant only".

## [1.0.0] — 2026-06-01 — Public launch

First version submitted to the Intercom App Store. Available as **Free**
during early access. Pro tier planned for Q3 2026.

### Added
- Custom domain `loop.kbpulse.com` with SSL via Railway
- Per-workspace event tracking covering install / configure / render /
  click / uninstall lifecycle, written to `tenant_events` table
- `GET /admin/analytics/:workspace_id` endpoint that aggregates events
  into headline metrics (cards rendered, item clicks, click-through
  rate, top 5 clicked items, install/uninstall counts) for a
  configurable time window (`?days=N`, max 365)
- HTML version of the analytics endpoint (`?format=html` or
  `Accept: text/html`) with KPI cards and top-items table for quick
  ops visibility
- Public roadmap page at `/website/roadmap.html` (Shipped / In progress
  / Planned / Exploring sections, color-coded to match the Canvas
  Kit card UI)
- Marketing comparison page at `/website/comparison.html`
  ("Loop vs linking to your changelog page")
- Live interactive demo at `/website/demo.html` (loads Intercom
  Messenger in anonymous visitor mode for video recording)
- Five App Store screenshot templates at `/website/mockups.html` with
  one-click PNG export via html-to-image
- Operator-facing docs: `LAUNCH_CHECKLIST.md`, `LAUNCH_ANNOUNCEMENTS.md`
  (6-channel launch copy), `OUTREACH_TARGETS.md` (cold-email tracker
  template), `SUPPORT_RESPONSES.md` (10 pre-written reply templates)
- Documentation expansion: "Loop needs setup" troubleshooting, install
  error catalog, and 6-question FAQ covering OAuth scopes,
  private changelogs, expired keys, API rate impact, multi-workspace
  usage, and i18n status
- `@sentry/node` as a real dependency (was optional/console-only before)

### Changed
- `package.json` name: `featurebase-intercom` → `loop-app`
- `package.json` version: 0.1.0 → 1.0.0
- App description: now references Loop's branding throughout

### Fixed
- **OAuth workspace_id resolution**: Intercom's token endpoint returns
  only `{token, access_token, token_type}` — no `app_id`. Previous code
  expected workspace ID on the token response, causing every install
  to fail with "Token response missing access_token or workspace_id".
  Now derives workspace ID from the follow-up `/me` call.
- Privacy policy now documents Intercom's platform-required Canvas Kit
  scopes (Read users, Read conversations, Read companies) and clarifies
  that Loop's code never calls those endpoints — only `/me` for
  installing admin email.

### Operational notes
- Event log writes are fire-and-forget — never delay Canvas Kit
  responses, gracefully no-op when DB unavailable
- `last_used_at` auto-updates on render and click events
- Old single-tenant Railway URL still resolves but all listing /
  Intercom Dev Hub URLs point at `loop.kbpulse.com`

## [Unreleased] — App Store v1 prep

### Added
- Marketing website (`/`) with hero, problem framing, 6-feature grid,
  3-step setup, pricing card, FAQ, branded CTA banner, footer
- Full installer documentation at `/website/docs.html` with sidebar nav
  covering setup, customization, troubleshooting, and reference
- CSS-rendered Messenger mockups at `/website/mockups.html` for App Store
  screenshot capture (3 hero shots)
- Privacy policy and Terms of service pages with templated content
- CHANGELOG.md (this file)
- GitHub Actions CI workflow running tests + PNG-up-to-date check on
  every push and PR
- Integration tests covering all marketing site routes (9 new tests)
- **Multi-tenant only:** Sentry integration auto-enabled by `SENTRY_DSN`
- **Multi-tenant only:** Per-workspace rate limiting (120 req/min default)
- **Multi-tenant only:** `/admin/tenants` + `/admin/tenants/:id` support
  endpoints gated by `ADMIN_TOKEN` for tenant lookup without exposing
  API keys
- **Multi-tenant only:** GDPR right-to-erasure at `DELETE /auth/data`
- **Multi-tenant only:** Uninstall webhook at `POST /auth/uninstall`
- **Multi-tenant only:** Per-tenant Featurebase credentials with
  AES-256-GCM at-rest encryption
- **Multi-tenant only:** HMAC-SHA256 signature verification on Canvas
  Kit endpoints

### Changed
- Date label in list items + detail meta: "Shipped X" → "Updated X"
- Type badges rendered as PNG pills (NEW/IMPROVED/FIXED) in the
  item.image slot instead of inline emoji text
- Logo: violet-and-check → coral-and-infinity (concept 1)
- Landing page replaced the old "Loop is running" placeholder with the
  marketing site

### Fixed
- Configure save no longer keeps the modal open — response now excludes
  the canvas field per Intercom Canvas Kit configure flow spec
- Featured image dimensions (`image_width`, `image_height`) now always
  set on list items — without them, Intercom rejects the canvas

## [0.x] — Early development (pre-App-Store)

Numerous iterations not individually tracked. Highlights:

- Switched data source from `/v2/posts` (status=completed) to
  `/v2/changelogs` for customer-facing entries
- Added category filter to scope Loop to one product line
- Added Coming Next section (in-progress roadmap items)
- Added drill-down detail view via submit-and-replace pattern
- Respect Featurebase's `hideFromBoardAndWidgets` visibility flag
- Configure flow with 10 toggleable settings (4 sections, 2 counts, 4 text)
- Cache-busting via `?v=N` URL versioning pattern
- Canvas Kit Builder mockup links for design iteration
