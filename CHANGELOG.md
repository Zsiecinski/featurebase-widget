# Loop changelog

Notable changes shipped on the Loop public version. Format inspired by
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The Staytuned-internal single-tenant version (the `main` branch deploy
at `featurebase-widget-production.up.railway.app`) shares all features
listed here except where noted "multi-tenant only".

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
