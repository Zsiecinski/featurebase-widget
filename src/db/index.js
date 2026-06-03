// Thin Postgres client + event log for the single-tenant Loop build.
// Uses `postgres` (postgres.js) — lightweight, no ORM, tagged-template SQL.
//
// All functions are safe to call when DATABASE_URL is unset: writes no-op,
// reads return null/[]. This means the Canvas Kit hot path never blocks
// or throws on a missing database.
//
// Environment
// ───────────
//   DATABASE_URL              Railway Postgres connection string. Required
//                             in production. If absent, db calls degrade.
//   SINGLE_TENANT_WORKSPACE   Workspace ID to attribute events to. Defaults
//                             to 'staytuned'. Use this same value when you
//                             open /admin/analytics/<id>?format=html.
//   PGSSLMODE=disable         Skip SSL (local dev only).

import postgres from 'postgres';

let sql = null;

function init() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  sql = postgres(url, {
    // Railway Postgres requires SSL; postgres.js auto-negotiates.
    ssl: process.env.PGSSLMODE === 'disable' ? false : 'require',
    max: 5,
    idle_timeout: 30,
  });
  return sql;
}

export function dbAvailable() {
  return Boolean(init());
}

/**
 * The workspace ID all single-tenant events are attributed to. Aligns with
 * the `:workspace_id` path param on the analytics endpoint so the same
 * value is used end-to-end.
 */
export function defaultWorkspaceId() {
  return process.env.SINGLE_TENANT_WORKSPACE || 'staytuned';
}

/**
 * Append an event to the log. Fire-and-forget — call without awaiting in
 * hot paths. Never throws (errors are logged but swallowed). When the DB
 * is unavailable, silently no-ops.
 *
 *   workspaceId   string  — usually defaultWorkspaceId() for this build
 *   event         string  — 'card_rendered' | 'item_clicked' | 'configure_saved' | etc.
 *   metadata      object  — JSON-serializable details (item_id, trigger, etc.)
 */
export async function logEvent(workspaceId, event, metadata = {}) {
  const s = init();
  if (!s || !workspaceId || !event) return;
  try {
    await s`
      INSERT INTO events (workspace_id, event, metadata)
      VALUES (${workspaceId}, ${event}, ${s.json(metadata || {})})
    `;
  } catch (err) {
    // Never propagate event-log errors into the response path.
    console.error('[logEvent]', event, err.message);
  }
}

/**
 * Aggregate one workspace's events into headline metrics. Used by the
 * /admin/analytics/:workspace_id endpoint.
 *
 *   workspaceId   string
 *   options       { days = 30 } — clamp 1..365 enforced by the caller
 *
 * Returns null when DB is unavailable OR when the workspace has no events.
 */
export async function getAnalytics(workspaceId, { days = 30 } = {}) {
  const s = init();
  if (!s) return null;

  // Resolve "since" timestamp once and reuse so all queries cover an
  // identical window (they'd otherwise drift by tens of milliseconds).
  const sinceRow = await s`SELECT NOW() - ${Number(days)}::int * INTERVAL '1 day' AS d`;
  const sinceDate = sinceRow[0].d;

  const periodCounts = await s`
    SELECT event, COUNT(*)::int AS count
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${sinceDate}
    GROUP BY event
  `;
  const allTimeCounts = await s`
    SELECT event, COUNT(*)::int AS count
    FROM events
    WHERE workspace_id = ${workspaceId}
    GROUP BY event
  `;
  const firstSeen = await s`
    SELECT MIN(created_at) AS at FROM events
    WHERE workspace_id = ${workspaceId}
  `;
  const lastSeen = await s`
    SELECT MAX(created_at) AS at FROM events
    WHERE workspace_id = ${workspaceId}
  `;
  const topItems = await s`
    SELECT metadata->>'item_id'    AS item_id,
           metadata->>'item_title' AS item_title,
           COUNT(*)::int           AS clicks
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND event = 'item_clicked'
      AND metadata->>'item_id' IS NOT NULL
      AND created_at >= ${sinceDate}
    GROUP BY metadata->>'item_id', metadata->>'item_title'
    ORDER BY clicks DESC
    LIMIT 5
  `;

  const period = Object.fromEntries(periodCounts.map((r) => [r.event, r.count]));
  const allTime = Object.fromEntries(allTimeCounts.map((r) => [r.event, r.count]));
  const renders = period.card_rendered || 0;
  const clicks = period.item_clicked || 0;

  // If we have no events at all for this workspace, return null so the
  // caller can 404 — distinguishes "DB not configured" from "no data yet".
  const totalAllTime = Object.values(allTime).reduce((a, b) => a + b, 0);
  if (totalAllTime === 0) return null;

  return {
    tenant: {
      workspaceId,
      installedAt: firstSeen[0]?.at || null,
      lastUsedAt: lastSeen[0]?.at || null,
    },
    periodDays: Number(days),
    period: {
      cardsRendered: renders,
      itemClicks: clicks,
      clickThroughRate: renders > 0 ? Number((clicks / renders).toFixed(3)) : 0,
      configureOpened: period.configure_opened || 0,
      configureSaved: period.configure_saved || 0,
      installs: period.install || 0,
      uninstalls: period.uninstall || 0,
    },
    allTime: {
      cardsRendered: allTime.card_rendered || 0,
      itemClicks: allTime.item_clicked || 0,
      configureSaved: allTime.configure_saved || 0,
      installs: allTime.install || 0,
      uninstalls: allTime.uninstall || 0,
    },
    topClickedItems: topItems.map((r) => ({
      itemId: r.item_id,
      title: r.item_title,
      clicks: r.clicks,
    })),
  };
}

/**
 * Recent events for ops visibility. Used by /admin/events.
 */
export async function recentEvents({ limit = 100, workspaceId = null } = {}) {
  const s = init();
  if (!s) return [];
  const max = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const rows = workspaceId
    ? await s`
        SELECT id, workspace_id, event, metadata, created_at
        FROM events
        WHERE workspace_id = ${workspaceId}
        ORDER BY id DESC
        LIMIT ${max}
      `
    : await s`
        SELECT id, workspace_id, event, metadata, created_at
        FROM events
        ORDER BY id DESC
        LIMIT ${max}
      `;
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    event: r.event,
    metadata: r.metadata,
    at: r.created_at,
  }));
}

export async function close() {
  if (sql) await sql.end({ timeout: 5 });
  sql = null;
}
