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

  // Unique visitor count for the KPI card. Inline so the analytics
  // endpoint stays one round-trip from the route handler.
  const [uniques] = await s`
    SELECT COUNT(DISTINCT metadata->>'contact_id')::int AS n
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND metadata->>'contact_id' IS NOT NULL
      AND created_at >= ${sinceDate}
  `;

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
      uniqueVisitors: uniques?.n || 0,
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

// Common keys Intercom installs use to tag a contact (or its company) with
// the Shopify store identifier. Ordered by preference — first match wins.
// Extend this list if you onboard another customer whose Intercom uses a
// different convention.
const SHOP_KEY_CANDIDATES = [
  'shopify_domain',
  'shop_domain',
  'myshopify_domain',
  'shopify_url',
  'shop_url',
  'store_domain',
  'store_url',
  'shop',
  'store',
];

/**
 * Given an event metadata blob, returns the best guess at the user's shop
 * identifier — usually a `*.myshopify.com` domain. Tries:
 *   1. Common keys on contact.custom_attributes
 *   2. Common keys on company.custom_attributes
 *   3. company_name (fallback — sometimes the company itself IS the shop)
 *
 * Returns null if nothing matches. Used by getEngagedUsers, the per-shop
 * aggregator, and the user timeline page.
 */
export function resolveShop(metadata) {
  if (!metadata) return null;
  const contactAttrs = metadata.contact_custom_attributes || {};
  for (const key of SHOP_KEY_CANDIDATES) {
    if (contactAttrs[key]) return String(contactAttrs[key]);
  }
  const companyAttrs = metadata.company_custom_attributes || {};
  for (const key of SHOP_KEY_CANDIDATES) {
    if (companyAttrs[key]) return String(companyAttrs[key]);
  }
  // Fallback: if the company name itself looks like a shop URL/domain,
  // use it. ("acme-store.myshopify.com" as the literal company name.)
  if (metadata.company_name) return String(metadata.company_name);
  return null;
}

/**
 * Top N shops by total click count. Aggregates events by resolveShop(),
 * which means it works regardless of which Intercom custom-attribute key
 * holds the myshopify domain. Used by the "Engagement by shop" section
 * of the dashboard.
 *
 * Returns [] when DB is unavailable or no events have shop attribution
 * yet — the renderer shows a friendly "no shop data" empty state.
 */
export async function getEngagementByShop(workspaceId, { days = 30, limit = 5 } = {}) {
  const s = init();
  if (!s) return [];
  const lim = Math.min(Math.max(Number(limit) || 5, 1), 50);
  const since = await s`SELECT NOW() - ${Number(days)}::int * INTERVAL '1 day' AS d`;

  // We can't push resolveShop() into SQL (it's app-level logic with a
  // priority list), so we pull recent events with the attribution fields
  // and aggregate in JS. The COUNT-only filter keeps payload small even
  // on busy workspaces — we project just the 5 columns we need.
  const rows = await s`
    SELECT
      event,
      metadata->>'contact_id' AS contact_id,
      metadata->'contact_custom_attributes'  AS contact_attrs,
      metadata->'company_custom_attributes'  AS company_attrs,
      metadata->>'company_name' AS company_name
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${since[0].d}
      AND (
        metadata->'contact_custom_attributes' IS NOT NULL
        OR metadata->'company_custom_attributes' IS NOT NULL
        OR metadata->>'company_name' IS NOT NULL
      )
  `;

  const byShop = new Map();
  for (const r of rows) {
    const shop = resolveShop({
      contact_custom_attributes: r.contact_attrs,
      company_custom_attributes: r.company_attrs,
      company_name: r.company_name,
    });
    if (!shop) continue;
    if (!byShop.has(shop)) byShop.set(shop, { shop, clicks: 0, renders: 0, contactIds: new Set() });
    const bucket = byShop.get(shop);
    if (r.event === 'item_clicked') bucket.clicks++;
    else if (r.event === 'card_rendered') bucket.renders++;
    if (r.contact_id) bucket.contactIds.add(r.contact_id);
  }

  return Array.from(byShop.values())
    .map((b) => ({
      shop: b.shop,
      clicks: b.clicks,
      renders: b.renders,
      uniqueVisitors: b.contactIds.size,
    }))
    .sort((a, b) =>
      b.clicks - a.clicks ||
      b.renders - a.renders ||
      b.uniqueVisitors - a.uniqueVisitors,
    )
    .slice(0, lim);
}

/**
 * Top N most engaged users (by item-click count, with renders as tiebreaker).
 * Used by the "Most engaged users" leaderboard on the analytics dashboard.
 *
 * Resolves identity by taking the *most recent* contact_name/email for each
 * contact_id — so if someone updates their name in Intercom, our leaderboard
 * reflects that without us needing to backfill old rows.
 *
 * Anonymous leads (contact_id present but name/email null) still get a row
 * so they're countable, just labeled "(anonymous lead)" in the renderer.
 */
export async function getEngagedUsers(workspaceId, { days = 30, limit = 5 } = {}) {
  const s = init();
  if (!s) return [];
  const lim = Math.min(Math.max(Number(limit) || 5, 1), 50);
  const since = await s`SELECT NOW() - ${Number(days)}::int * INTERVAL '1 day' AS d`;
  const rows = await s`
    WITH latest AS (
      SELECT DISTINCT ON (metadata->>'contact_id')
             metadata->>'contact_id'    AS contact_id,
             metadata->>'contact_name'  AS name,
             metadata->>'contact_email' AS email,
             metadata->>'contact_type'  AS type,
             metadata->'contact_custom_attributes' AS contact_attrs,
             metadata->'company_custom_attributes' AS company_attrs,
             metadata->>'company_name'  AS company_name
      FROM events
      WHERE workspace_id = ${workspaceId}
        AND metadata->>'contact_id' IS NOT NULL
      ORDER BY metadata->>'contact_id', created_at DESC
    ),
    counts AS (
      SELECT metadata->>'contact_id' AS contact_id,
             COUNT(*) FILTER (WHERE event = 'item_clicked')  AS clicks,
             COUNT(*) FILTER (WHERE event = 'card_rendered') AS renders,
             MAX(created_at) AS last_seen
      FROM events
      WHERE workspace_id = ${workspaceId}
        AND metadata->>'contact_id' IS NOT NULL
        AND created_at >= ${since[0].d}
      GROUP BY metadata->>'contact_id'
    )
    SELECT c.contact_id,
           l.name,
           l.email,
           l.type,
           l.contact_attrs,
           l.company_attrs,
           l.company_name,
           c.clicks::int  AS clicks,
           c.renders::int AS renders,
           c.last_seen
    FROM counts c
    JOIN latest l ON l.contact_id = c.contact_id
    WHERE c.clicks > 0 OR c.renders > 0
    ORDER BY c.clicks DESC, c.renders DESC, c.last_seen DESC
    LIMIT ${lim}
  `;
  return rows.map((r) => ({
    contactId: r.contact_id,
    name: r.name,
    email: r.email,
    type: r.type,
    clicks: r.clicks,
    renders: r.renders,
    lastSeen: r.last_seen,
    shop: resolveShop({
      contact_custom_attributes: r.contact_attrs,
      company_custom_attributes: r.company_attrs,
      company_name: r.company_name,
    }),
  }));
}

/**
 * Distinct contact_ids that triggered any event in the window. Used by
 * the "Unique visitors" KPI card. Returns 0 cleanly when DB unavailable.
 */
export async function getUniqueVisitors(workspaceId, { days = 30 } = {}) {
  const s = init();
  if (!s) return 0;
  const since = await s`SELECT NOW() - ${Number(days)}::int * INTERVAL '1 day' AS d`;
  const [row] = await s`
    SELECT COUNT(DISTINCT metadata->>'contact_id')::int AS uniques
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND metadata->>'contact_id' IS NOT NULL
      AND created_at >= ${since[0].d}
  `;
  return row?.uniques || 0;
}

/**
 * Per-item click breakdown — who clicked which item, with their click count.
 * Used by the expandable "Top items" table on the analytics dashboard so
 * you can drill from "Inventory sync got 8 clicks" into "and Bob clicked
 * it 3 times, Jane twice, anonymous lead twice…"
 *
 * Returns an array of { itemId, title, clicks, clickers: [{ contactId,
 * name, email, type, clicks }] } objects, sorted by total clicks desc.
 */
export async function getTopItemsWithClickers(workspaceId, { days = 30, limit = 5 } = {}) {
  const s = init();
  if (!s) return [];
  const lim = Math.min(Math.max(Number(limit) || 5, 1), 20);
  const since = await s`SELECT NOW() - ${Number(days)}::int * INTERVAL '1 day' AS d`;

  // Step 1: top N items by click count.
  const items = await s`
    SELECT metadata->>'item_id'    AS item_id,
           MAX(metadata->>'item_title') AS title,
           COUNT(*)::int           AS clicks
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND event = 'item_clicked'
      AND metadata->>'item_id' IS NOT NULL
      AND created_at >= ${since[0].d}
    GROUP BY metadata->>'item_id'
    ORDER BY clicks DESC
    LIMIT ${lim}
  `;
  if (items.length === 0) return [];

  // Step 2: for each item, top clickers. One round-trip via UNNEST.
  const itemIds = items.map((i) => i.item_id);
  const clickers = await s`
    SELECT metadata->>'item_id' AS item_id,
           COALESCE(metadata->>'contact_id', '(anonymous)') AS contact_id,
           MAX(metadata->>'contact_name')  AS name,
           MAX(metadata->>'contact_email') AS email,
           MAX(metadata->>'contact_type')  AS type,
           COUNT(*)::int AS clicks
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND event = 'item_clicked'
      AND created_at >= ${since[0].d}
      AND metadata->>'item_id' = ANY(${itemIds})
    GROUP BY metadata->>'item_id', COALESCE(metadata->>'contact_id', '(anonymous)')
    ORDER BY clicks DESC
  `;
  const byItem = new Map();
  for (const c of clickers) {
    if (!byItem.has(c.item_id)) byItem.set(c.item_id, []);
    byItem.get(c.item_id).push({
      contactId: c.contact_id === '(anonymous)' ? null : c.contact_id,
      name: c.name,
      email: c.email,
      type: c.type,
      clicks: c.clicks,
    });
  }
  return items.map((i) => ({
    itemId: i.item_id,
    title: i.title,
    clicks: i.clicks,
    clickers: byItem.get(i.item_id) || [],
  }));
}

/**
 * One user's full event timeline — every render and click in chronological
 * order. Used by the per-user drilldown page at /admin/analytics/:ws/user/:id.
 */
export async function getUserTimeline(workspaceId, contactId, { days = 90, limit = 200 } = {}) {
  const s = init();
  if (!s) return null;
  const since = await s`SELECT NOW() - ${Number(days)}::int * INTERVAL '1 day' AS d`;

  // Identity snapshot — most recent name/email/attrs for this user.
  // We grab the latest row (any event) and let resolveShop() decide
  // which custom attribute holds the shop. Avoids hardcoding key names.
  const [latest] = await s`
    SELECT metadata->>'contact_id'    AS contact_id,
           metadata->>'contact_name'  AS name,
           metadata->>'contact_email' AS email,
           metadata->>'contact_type'  AS type,
           metadata->'contact_custom_attributes' AS contact_attrs,
           metadata->'company_custom_attributes' AS company_attrs,
           metadata->>'company_name'  AS company_name
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND metadata->>'contact_id' = ${contactId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (!latest) return null;

  // Separate query for the first/last bracket — the identity snapshot
  // is for the MOST RECENT row only, but first_seen should look at all.
  const [bracket] = await s`
    SELECT MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND metadata->>'contact_id' = ${contactId}
  `;

  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const events = await s`
    SELECT id, event, metadata, created_at
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND metadata->>'contact_id' = ${contactId}
      AND created_at >= ${since[0].d}
    ORDER BY created_at DESC
    LIMIT ${lim}
  `;

  // Aggregate counts for the user header KPIs.
  const [counts] = await s`
    SELECT COUNT(*) FILTER (WHERE event = 'item_clicked')::int  AS clicks,
           COUNT(*) FILTER (WHERE event = 'card_rendered')::int AS renders
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND metadata->>'contact_id' = ${contactId}
      AND created_at >= ${since[0].d}
  `;

  return {
    user: {
      contactId: latest.contact_id,
      name: latest.name,
      email: latest.email,
      type: latest.type,
      shop: resolveShop({
        contact_custom_attributes: latest.contact_attrs,
        company_custom_attributes: latest.company_attrs,
        company_name: latest.company_name,
      }),
      companyName: latest.company_name,
      firstSeen: bracket?.first_seen || null,
      lastSeen: bracket?.last_seen || null,
    },
    periodDays: Number(days),
    totals: {
      clicks: counts?.clicks || 0,
      renders: counts?.renders || 0,
    },
    events: events.map((e) => ({
      id: e.id,
      event: e.event,
      at: e.created_at,
      metadata: e.metadata,
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
