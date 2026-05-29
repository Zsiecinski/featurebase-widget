-- Loop multi-tenant schema. Apply via `npm run db:migrate`.
--
-- Design notes
-- ────────────
-- Single shared table per concept; row-level filtering by workspace_id.
-- Featurebase API keys are encrypted at rest using app-level AES-GCM
-- with a key from FB_ENCRYPTION_KEY env var (NOT stored in DB).
-- workspace_id is the Intercom workspace identifier — every Canvas Kit
-- request carries it, so it's our universal tenant key.

CREATE TABLE IF NOT EXISTS tenants (
  id                      SERIAL PRIMARY KEY,
  -- Identity (from Intercom OAuth)
  intercom_workspace_id   TEXT NOT NULL UNIQUE,
  intercom_access_token   TEXT NOT NULL,         -- For server-side Intercom API calls (e.g. attribute lookups). Treat as secret.
  intercom_admin_email    TEXT,                  -- The installer's email for support contact
  -- Featurebase config (provided by the installer via Configure flow)
  featurebase_org         TEXT,                  -- subdomain, e.g. 'staytuned'
  featurebase_api_key_enc TEXT,                  -- AES-GCM encrypted; never log plaintext
  featurebase_category    TEXT,                  -- Optional category filter substring
  featurebase_base_url    TEXT DEFAULT 'https://do.featurebase.app',
  -- Lifecycle
  installed_at            TIMESTAMPTZ DEFAULT NOW(),
  configured_at           TIMESTAMPTZ,           -- When the installer first saved valid Featurebase config
  last_used_at            TIMESTAMPTZ,
  uninstalled_at          TIMESTAMPTZ,           -- Soft-delete marker; row kept for support / reinstall recovery
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_workspace ON tenants (intercom_workspace_id);
CREATE INDEX IF NOT EXISTS idx_tenants_active    ON tenants (intercom_workspace_id) WHERE uninstalled_at IS NULL;

-- ---------------------------------------------------------------------------
-- Per-card-instance settings (the existing Configure form values).
-- One row per Canvas Kit card placement. Multiple cards per tenant possible.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS card_settings (
  id                      SERIAL PRIMARY KEY,
  tenant_id               INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  card_instance_id        TEXT,                  -- Intercom's card instance identifier when available; nullable for v0
  -- Persisted Configure-form values (JSON for flexibility as we add more)
  options                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_settings_tenant ON card_settings (tenant_id);

-- ---------------------------------------------------------------------------
-- Audit log of meaningful tenant events. Useful for support investigations
-- and basic install funnel analytics. Cheap to write, easy to drop later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_events (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,           -- 'install' | 'configure' | 'uninstall' | 'fb_auth_failed' | etc.
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_events_tenant ON tenant_events (tenant_id, created_at DESC);
