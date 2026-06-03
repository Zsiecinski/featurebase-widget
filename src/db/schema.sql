-- Loop single-tenant analytics schema. Apply via `npm run db:migrate`.
--
-- Design notes
-- ────────────
-- The private (single-tenant) Loop is one Featurebase org → one Intercom
-- workspace. We could hardcode that, but keeping `workspace_id` as a column
-- means the analytics endpoint URL shape (`/admin/analytics/:workspace_id`)
-- matches the multi-tenant version exactly — easy to graduate later, and
-- easy to scope queries if a second workspace ever shows up here.
--
-- Defaulted to 'staytuned' so any insert that omits workspace_id still
-- attributes correctly. Override via SINGLE_TENANT_WORKSPACE env var.

CREATE TABLE IF NOT EXISTS events (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'staytuned',
  event        TEXT NOT NULL,           -- 'card_rendered' | 'item_clicked' | 'configure_saved' | etc.
  metadata     JSONB DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Hot query: aggregate one workspace's events in a recent time window.
CREATE INDEX IF NOT EXISTS idx_events_workspace_time
  ON events (workspace_id, created_at DESC);

-- Useful for cross-workspace event-type filters (rarely used here, cheap to have).
CREATE INDEX IF NOT EXISTS idx_events_event_time
  ON events (event, created_at DESC);
