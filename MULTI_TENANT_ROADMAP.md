# Multi-tenant migration roadmap

Tracks the work needed to take Loop from a Staytuned-internal single-tenant
app to a public Intercom App Store listing. Each phase is independent — we
can stop at any phase and the app still runs in its previous mode.

## Phase 0 — Single-tenant (CURRENT in `main`)

- One Featurebase org (Staytuned), credentials in Railway env vars
- Single Intercom workspace, configured manually in Developer Hub
- All in-progress + changelog filtering hardcoded to Kiwi category
- **Status: in production, working.**

## Phase 1 — Multi-tenant foundation (THIS BRANCH `multi-tenant`)

Mechanical scaffolding that doesn't change runtime behavior in single-tenant
deploys (those skip the new code via env-var gating).

- [x] Add `postgres` dependency
- [x] `src/db/schema.sql` defining `tenants`, `card_settings`, `tenant_events`
- [x] `src/db/index.js` — connection, AES-GCM encrypt/decrypt for FB keys,
  basic tenant repository (find / upsert-on-install / save-config / uninstall)
- [x] `scripts/db-migrate.mjs` — idempotent schema apply
- [x] `npm start` runs the migration before booting the server
- [x] `src/intercom.js` — signature verification middleware + OAuth helpers
- [x] `src/auth-routes.js` — `/auth/install` and `/auth/callback` endpoints
- [x] `/health` reports `multi_tenant` and `db` capability flags
- [x] `.env.example` documents the new env vars

**Single-tenant production is unaffected.** Without `DATABASE_URL` +
`INTERCOM_CLIENT_*` set, all new code paths short-circuit.

## Phase 2 — Per-tenant Featurebase calls ✅

- [x] In `server.js` `renderCanvas`, look up the tenant by
  `req.body.workspace_id`. If found and configured → use their FB key.
  If not configured → render a "needs setup" canvas. If env-var mode →
  fall back to current behavior.
- [x] Refactor `getChangelogs`, `getInProgressPosts`, `getChangelogById`
  to accept credentials as a parameter. `credsOrDefault()` falls back
  to env vars when called with `null` so single-tenant call sites work.
- [x] Add Featurebase API key entry to the `/configure` flow.
  `validateCredentials()` makes a real `/v2/post_statuses` call before
  saving — bad keys are rejected with an inline error.
- [x] `needsSetupCanvas` for tenants without Featurebase config yet.
- [x] Status-ID cache keyed by `${baseUrl}|${type}` so tenants don't
  share each other's resolved status IDs.

## Phase 3 — Webhook signature enforcement ✅

- [x] Raw-body capture via `express.json({ verify })` callback so
  signature middleware can recompute HMAC over the unparsed bytes.
- [x] `verifyCanvasKitSignature` applied to `/initialize`, `/submit`,
  `/configure`. Other routes (`/health`, `/assets/*`, `/auth/*`,
  `/debug/*`) skip it intentionally.
- [x] Middleware short-circuits to `next()` when `INTERCOM_CLIENT_SECRET`
  is unset (single-tenant unaffected).
- [x] Verified: secret set + missing X-Body-Signature → 401.

## Phase 4 — App Store listing prep ⚠️ (drafted, awaiting your input)

Templates drafted in this repo. User decisions needed to finalize:

- [x] App Store listing copy → `APP_STORE_LISTING.md`
  (name, tagline, descriptions, screenshots brief, scopes,
  submission checklist)
- [x] Privacy policy template → `PRIVACY_POLICY.md`
- [x] Terms of service template → `TERMS.md`
- [ ] Fill in placeholders (company name, jurisdiction, contact email)
  in both templates
- [ ] Host the privacy + terms at public URLs
- [ ] Set up a support email forwarder (`support@yourdomain`)
- [ ] Take the 5 marketing screenshots in production Messenger
  (use Staytuned for fixtures — see APP_STORE_LISTING.md for the brief)
- [ ] Pricing decision (recommended: Free for v1)
- [ ] Domain decision (`loop.app`, `loop-app.io`, subdomain of yours…)

## Phase 5 — Submission + review

- [ ] Submit the listing in Intercom Developer Hub
- [ ] Review takes ~5 business days. May request changes.
- [ ] Address any review feedback (usually around data handling or UX
  clarity in onboarding)
- [ ] Approve → live in App Store

## Phase 6 — Post-launch ops

- [ ] Monitoring: Sentry free tier on the app (errors), basic Railway
  uptime alerts
- [ ] Rate limiting per workspace (so one tenant can't burn through
  Featurebase API quota for everyone)
- [ ] Tenant-level analytics dashboard (which workspaces are active,
  installs vs configured-and-using funnel)
- [ ] Customer support escalation flow

---

## Env vars summary (production multi-tenant)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Railway Postgres connection string |
| `FB_ENCRYPTION_KEY` | 32-byte hex, AES-GCM key for FB API key encryption |
| `INTERCOM_CLIENT_ID` | From Intercom Dev Hub → Authentication |
| `INTERCOM_CLIENT_SECRET` | From Intercom Dev Hub — also used for webhook signatures |
| `INTERCOM_OAUTH_REDIRECT_URI` | `https://loop.example.com/auth/callback` |

## Deployment notes for the multi-tenant build

1. Add the Postgres plugin to the Railway service. Auto-injects `DATABASE_URL`.
2. Generate the encryption key: `openssl rand -hex 32`, paste into
   `FB_ENCRYPTION_KEY` env var.
3. In Intercom Developer Hub → Authentication, enable OAuth, set the
   redirect URI to `https://<railway-domain>/auth/callback`, copy client
   id + secret into env vars.
4. Push the `multi-tenant` branch. `npm start` auto-applies the schema
   on first boot.
5. Test with a fresh Intercom workspace (use Intercom's test workspace
   feature) — install via OAuth, configure Featurebase, verify Loop renders.
