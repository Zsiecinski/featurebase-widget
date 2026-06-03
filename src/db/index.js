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
  // Distinct items clicked — useful "breadth of engagement" signal.
  const [items] = await s`
    SELECT COUNT(DISTINCT metadata->>'item_id')::int AS n
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND event = 'item_clicked'
      AND metadata->>'item_id' IS NOT NULL
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
      itemsClicked: items?.n || 0,
      clicksPerVisitor: uniques?.n > 0 ? Number((clicks / uniques.n).toFixed(2)) : 0,
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
 * Heuristic: does this string look like a shop identifier (domain/URL)?
 * Used as a guard before treating Intercom's `user_id` field as a shop —
 * many setups put the myshopify domain there, but others put internal IDs
 * like "cust_12345" that we don't want to surface in the Shop column.
 */
function looksLikeShopId(s) {
  if (!s) return false;
  const str = String(s).trim();
  if (!str || /\s/.test(str)) return false;
  // Has at least one `.something`. Catches:
  //   acme-store.myshopify.com  ✓
  //   acme.shop                 ✓
  //   plain-text-id             ✗
  //   cust_12345                ✗
  return /\.[a-z]{2,}/i.test(str);
}

/**
 * Given an event metadata blob, returns the best guess at the user's shop
 * identifier — usually a `*.myshopify.com` domain. Tries, in order:
 *   1. Common keys on contact.custom_attributes
 *   2. contact.user_id — IF it looks domain-shaped. Many Intercom setups
 *      (including Staytuned's) use Intercom's "external user ID" field
 *      to hold the myshopify domain directly.
 *   3. Common keys on company.custom_attributes
 *   4. company_name (fallback — sometimes the company itself IS the shop)
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
  // user_id is a popular place for the myshopify domain. Gate behind a
  // domain-shape check so non-Shopify Intercom setups don't show internal
  // IDs as fake "shops".
  if (looksLikeShopId(metadata.contact_user_id)) {
    return String(metadata.contact_user_id);
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
 * Daily activity for the main bar chart at the top of the dashboard.
 * Returns one entry per day in the [since, now] window — including days
 * with zero activity, so the chart's X-axis is uniform. Two metrics per
 * day: renders + clicks (the two events that matter for engagement).
 */
export async function getDailyActivity(workspaceId, { days = 30 } = {}) {
  const s = init();
  if (!s) return [];
  const n = Math.min(Math.max(Number(days) || 30, 1), 365);

  // generate_series + LEFT JOIN gives us zero-rows for empty days without
  // having to fabricate them in JS. Truncate to day boundaries so the
  // bars don't get sliced weirdly across timezone offsets.
  const rows = await s`
    WITH days AS (
      SELECT generate_series(
        date_trunc('day', NOW() - ${n}::int * INTERVAL '1 day'),
        date_trunc('day', NOW()),
        INTERVAL '1 day'
      )::date AS day
    ),
    counts AS (
      SELECT date_trunc('day', created_at)::date AS day,
             COUNT(*) FILTER (WHERE event = 'card_rendered')::int AS renders,
             COUNT(*) FILTER (WHERE event = 'item_clicked')::int  AS clicks
      FROM events
      WHERE workspace_id = ${workspaceId}
        AND created_at >= NOW() - ${n}::int * INTERVAL '1 day'
      GROUP BY day
    )
    SELECT d.day,
           COALESCE(c.renders, 0) AS renders,
           COALESCE(c.clicks,  0) AS clicks
    FROM days d
    LEFT JOIN counts c ON c.day = d.day
    ORDER BY d.day
  `;
  return rows.map((r) => ({
    day: r.day,
    renders: r.renders,
    clicks: r.clicks,
  }));
}

/**
 * Per-contact daily click counts over a short window. Used to render
 * row sparklines next to engaged-visitor names. One batched query
 * covers all contact IDs to avoid N+1.
 *
 * Returns Map(contactId → [{ day, clicks }, ...]) with zero-filled days.
 */
export async function getUserSparklines(workspaceId, contactIds, { days = 7 } = {}) {
  const s = init();
  if (!s || !Array.isArray(contactIds) || contactIds.length === 0) return new Map();
  const n = Math.min(Math.max(Number(days) || 7, 1), 30);

  const rows = await s`
    SELECT metadata->>'contact_id' AS contact_id,
           date_trunc('day', created_at)::date AS day,
           COUNT(*)::int AS clicks
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND event = 'item_clicked'
      AND metadata->>'contact_id' = ANY(${contactIds})
      AND created_at >= NOW() - ${n}::int * INTERVAL '1 day'
    GROUP BY metadata->>'contact_id', day
  `;

  // Build a base zero-filled timeline once and clone per user.
  const baseDays = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    baseDays.push(d.toISOString().slice(0, 10));
  }
  const out = new Map();
  for (const id of contactIds) {
    out.set(id, baseDays.map((day) => ({ day, clicks: 0 })));
  }
  for (const r of rows) {
    const arr = out.get(r.contact_id);
    if (!arr) continue;
    const key = new Date(r.day).toISOString().slice(0, 10);
    const slot = arr.find((d) => d.day === key);
    if (slot) slot.clicks = r.clicks;
  }
  return out;
}

/**
 * Aggregate counts for the period IMMEDIATELY PRIOR to the current window
 * of equal length. Used to render % change badges on the KPI cards.
 *
 *   current  window:   [NOW() - days .... NOW()]
 *   previous window:   [NOW() - 2*days .. NOW() - days]
 *
 * Returns { cardsRendered, itemClicks, configureSaved } for the prior window,
 * or all-zeros if DB unavailable.
 */
export async function getPriorPeriodCounts(workspaceId, { days = 30 } = {}) {
  const s = init();
  if (!s) return { cardsRendered: 0, itemClicks: 0, configureSaved: 0, uniqueVisitors: 0, itemsClicked: 0 };
  const n = Math.min(Math.max(Number(days) || 30, 1), 365);

  const rows = await s`
    SELECT event, COUNT(*)::int AS count
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND created_at >= NOW() - (2 * ${n})::int * INTERVAL '1 day'
      AND created_at <  NOW() - ${n}::int * INTERVAL '1 day'
    GROUP BY event
  `;
  const byEvent = Object.fromEntries(rows.map((r) => [r.event, r.count]));

  const [uniq] = await s`
    SELECT COUNT(DISTINCT metadata->>'contact_id')::int AS n
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND metadata->>'contact_id' IS NOT NULL
      AND created_at >= NOW() - (2 * ${n})::int * INTERVAL '1 day'
      AND created_at <  NOW() - ${n}::int * INTERVAL '1 day'
  `;
  const [itemsPrior] = await s`
    SELECT COUNT(DISTINCT metadata->>'item_id')::int AS n
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND event = 'item_clicked'
      AND metadata->>'item_id' IS NOT NULL
      AND created_at >= NOW() - (2 * ${n})::int * INTERVAL '1 day'
      AND created_at <  NOW() - ${n}::int * INTERVAL '1 day'
  `;

  return {
    cardsRendered: byEvent.card_rendered || 0,
    itemClicks: byEvent.item_clicked || 0,
    configureSaved: byEvent.configure_saved || 0,
    uniqueVisitors: uniq?.n || 0,
    itemsClicked: itemsPrior?.n || 0,
  };
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
      created_at,
      metadata->>'contact_id'      AS contact_id,
      metadata->>'contact_user_id' AS contact_user_id,
      metadata->'contact_custom_attributes' AS contact_attrs,
      metadata->'company_custom_attributes' AS company_attrs,
      metadata->>'company_name'    AS company_name
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${since[0].d}
      AND (
        metadata->'contact_custom_attributes' IS NOT NULL
        OR metadata->'company_custom_attributes' IS NOT NULL
        OR metadata->>'company_name' IS NOT NULL
        OR metadata->>'contact_user_id' IS NOT NULL
      )
  `;

  // For sparklines: build a 7-day click timeline per shop while we're
  // already iterating events. Defaults to the LAST 7 DAYS of the window,
  // not the whole window — sparklines work best at consistent length so
  // rows can be compared visually regardless of the selected days filter.
  const sparkDays = 7;
  const sparkStart = new Date(Date.now() - sparkDays * 86400000);
  const baseSpark = [];
  for (let i = sparkDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    baseSpark.push({ day: d.toISOString().slice(0, 10), clicks: 0 });
  }

  const byShop = new Map();
  for (const r of rows) {
    const shop = resolveShop({
      contact_custom_attributes: r.contact_attrs,
      contact_user_id: r.contact_user_id,
      company_custom_attributes: r.company_attrs,
      company_name: r.company_name,
    });
    if (!shop) continue;
    if (!byShop.has(shop)) {
      byShop.set(shop, {
        shop,
        clicks: 0,
        renders: 0,
        contactIds: new Set(),
        sparkline: baseSpark.map((d) => ({ ...d })),
      });
    }
    const bucket = byShop.get(shop);
    if (r.event === 'item_clicked') bucket.clicks++;
    else if (r.event === 'card_rendered') bucket.renders++;
    if (r.contact_id) bucket.contactIds.add(r.contact_id);

    // If the event landed inside the 7-day sparkline window, bump its day.
    if (r.event === 'item_clicked' && r.created_at >= sparkStart) {
      const key = new Date(r.created_at).toISOString().slice(0, 10);
      const slot = bucket.sparkline.find((d) => d.day === key);
      if (slot) slot.clicks++;
    }
  }

  return Array.from(byShop.values())
    .map((b) => ({
      shop: b.shop,
      clicks: b.clicks,
      renders: b.renders,
      uniqueVisitors: b.contactIds.size,
      sparkline: b.sparkline,
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
             metadata->>'contact_id'      AS contact_id,
             metadata->>'contact_name'    AS name,
             metadata->>'contact_email'   AS email,
             metadata->>'contact_type'    AS type,
             metadata->>'contact_user_id' AS contact_user_id,
             metadata->'contact_custom_attributes' AS contact_attrs,
             metadata->'company_custom_attributes' AS company_attrs,
             metadata->>'company_name'    AS company_name
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
           l.contact_user_id,
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
      contact_user_id: r.contact_user_id,
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
 * Full breakdown for one item — every clicker, their identity + shop +
 * click count + last-clicked timestamp. Used by the per-item drilldown
 * page reached by clicking an item title in the dashboard.
 *
 * Anonymous leads are collapsed into a single "(anonymous)" bucket and
 * their combined click count surfaces at the bottom of the list.
 *
 * Returns null when the item has no events in the window — caller 404s.
 */
export async function getItemDetail(workspaceId, itemId, { days = 30 } = {}) {
  const s = init();
  if (!s) return null;
  const n = Math.min(Math.max(Number(days) || 30, 1), 365);
  const since = await s`SELECT NOW() - ${n}::int * INTERVAL '1 day' AS d`;

  // Most-recent identity snapshot per contact_id (or '(anonymous)' bucket).
  // Same DISTINCT-ON pattern as getEngagedUsers so updated names propagate.
  const clickers = await s`
    WITH latest AS (
      SELECT DISTINCT ON (COALESCE(metadata->>'contact_id', '(anonymous)'))
             COALESCE(metadata->>'contact_id', '(anonymous)') AS contact_id,
             metadata->>'contact_name'    AS name,
             metadata->>'contact_email'   AS email,
             metadata->>'contact_type'    AS type,
             metadata->>'contact_user_id' AS contact_user_id,
             metadata->'contact_custom_attributes' AS contact_attrs,
             metadata->'company_custom_attributes' AS company_attrs,
             metadata->>'company_name'    AS company_name
      FROM events
      WHERE workspace_id = ${workspaceId}
        AND event = 'item_clicked'
        AND metadata->>'item_id' = ${itemId}
      ORDER BY COALESCE(metadata->>'contact_id', '(anonymous)'), created_at DESC
    ),
    counts AS (
      SELECT COALESCE(metadata->>'contact_id', '(anonymous)') AS contact_id,
             COUNT(*)::int AS clicks,
             MAX(created_at) AS last_clicked
      FROM events
      WHERE workspace_id = ${workspaceId}
        AND event = 'item_clicked'
        AND metadata->>'item_id' = ${itemId}
        AND created_at >= ${since[0].d}
      GROUP BY COALESCE(metadata->>'contact_id', '(anonymous)')
    )
    SELECT c.contact_id, l.name, l.email, l.type,
           l.contact_user_id, l.contact_attrs, l.company_attrs, l.company_name,
           c.clicks, c.last_clicked
    FROM counts c
    JOIN latest l ON l.contact_id = c.contact_id
    ORDER BY (c.contact_id = '(anonymous)') ASC, c.clicks DESC, c.last_clicked DESC
  `;

  // Headline counts + title.
  const [head] = await s`
    SELECT MAX(metadata->>'item_title') AS title,
           COUNT(*)::int AS total_clicks_period,
           MIN(created_at) AS first_clicked,
           MAX(created_at) AS last_clicked
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND event = 'item_clicked'
      AND metadata->>'item_id' = ${itemId}
      AND created_at >= ${since[0].d}
  `;
  if (!head || head.total_clicks_period === 0) return null;

  const [allTime] = await s`
    SELECT COUNT(*)::int AS total
    FROM events
    WHERE workspace_id = ${workspaceId}
      AND event = 'item_clicked'
      AND metadata->>'item_id' = ${itemId}
  `;

  // Daily activity (clicks only) for this item, zero-filled.
  const daily = await s`
    WITH days AS (
      SELECT generate_series(
        date_trunc('day', NOW() - ${n}::int * INTERVAL '1 day'),
        date_trunc('day', NOW()),
        INTERVAL '1 day'
      )::date AS day
    ),
    counts AS (
      SELECT date_trunc('day', created_at)::date AS day,
             COUNT(*)::int AS clicks
      FROM events
      WHERE workspace_id = ${workspaceId}
        AND event = 'item_clicked'
        AND metadata->>'item_id' = ${itemId}
        AND created_at >= NOW() - ${n}::int * INTERVAL '1 day'
      GROUP BY day
    )
    SELECT d.day, COALESCE(c.clicks, 0) AS clicks
    FROM days d
    LEFT JOIN counts c ON c.day = d.day
    ORDER BY d.day
  `;

  return {
    item: {
      id: itemId,
      title: head.title || itemId,
      firstClicked: head.first_clicked,
      lastClicked: head.last_clicked,
    },
    periodDays: n,
    totals: {
      clicksPeriod: head.total_clicks_period,
      clicksAllTime: allTime?.total || 0,
      uniqueClickers: clickers.filter((c) => c.contact_id !== '(anonymous)').length,
      anonymousClicks: clickers.find((c) => c.contact_id === '(anonymous)')?.clicks || 0,
    },
    clickers: clickers.map((r) => ({
      contactId: r.contact_id === '(anonymous)' ? null : r.contact_id,
      name: r.name,
      email: r.email,
      type: r.type,
      shop: resolveShop({
        contact_custom_attributes: r.contact_attrs,
        contact_user_id: r.contact_user_id,
        company_custom_attributes: r.company_attrs,
        company_name: r.company_name,
      }),
      clicks: r.clicks,
      lastClicked: r.last_clicked,
    })),
    dailyActivity: daily.map((r) => ({
      day: r.day,
      clicks: r.clicks,
      renders: 0,  // shape-compatible with dailyChartSvg
    })),
  };
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
    SELECT metadata->>'contact_id'      AS contact_id,
           metadata->>'contact_name'    AS name,
           metadata->>'contact_email'   AS email,
           metadata->>'contact_type'    AS type,
           metadata->>'contact_user_id' AS contact_user_id,
           metadata->'contact_custom_attributes' AS contact_attrs,
           metadata->'company_custom_attributes' AS company_attrs,
           metadata->>'company_name'    AS company_name
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
           COUNT(*) FILTER (WHERE event = 'card_rendered')::int AS renders,
           COUNT(DISTINCT metadata->>'item_id') FILTER (WHERE event = 'item_clicked')::int AS items_clicked
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
        contact_user_id: latest.contact_user_id,
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
      itemsClicked: counts?.items_clicked || 0,
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
