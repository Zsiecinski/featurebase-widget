// Internal analytics endpoints for the single-tenant Loop build.
//
// Gated by ADMIN_TOKEN env var — without that set, the routes return 404
// (functionally disabled, no info leak). With it set, the token must be
// passed as `Authorization: Bearer <token>` OR `?token=<token>` (the query
// param is handy for direct browser navigation into the HTML dashboard).
//
// Endpoints
// ─────────
//   GET /admin/analytics/:workspace_id   Headline metrics (KPI cards + top items)
//                                        Content-negotiated: HTML for humans,
//                                        JSON when Accept: application/json
//                                        or ?format=json.
//   GET /admin/events                    Recent events as JSON for ops poking.
//
// Use case: hit /admin/analytics/staytuned?format=html&token=… in a browser
// to see Cards Rendered, Item Clicks, CTR, Top 5 clicked items for the
// last 30 days. ?days=N changes the window (clamped 1..365).

import {
  dbAvailable,
  getAnalytics,
  recentEvents,
} from './db/index.js';

function requireAdminToken(req, res, next) {
  const required = process.env.ADMIN_TOKEN;
  if (!required) return res.status(404).end();
  const auth = req.get('Authorization') || '';
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  if (auth === `Bearer ${required}` || queryToken === required) {
    return next();
  }
  return res.status(401).json({ error: 'invalid admin token' });
}

export function registerAdminRoutes(app) {
  app.get('/admin/events', requireAdminToken, async (req, res) => {
    if (!dbAvailable()) return res.json({ events: [], note: 'DB not configured' });
    const limit = Number(req.query.limit) || 100;
    const workspaceId = req.query.workspace_id || null;
    const events = await recentEvents({ limit, workspaceId });
    res.json({ events, count: events.length });
  });

  app.get('/admin/analytics/:workspaceId', requireAdminToken, async (req, res) => {
    if (!dbAvailable()) return res.status(503).json({ error: 'DB not configured' });
    const requested = Number(req.query.days) || 30;
    const days = Math.min(Math.max(requested, 1), 365);
    const data = await getAnalytics(req.params.workspaceId, { days });
    if (!data) return res.status(404).json({ error: 'no events for this workspace yet' });

    // Default to HTML for browsers, JSON when explicitly requested. We use
    // req.accepts() so an Accept: application/json header (curl with -H)
    // gets JSON, and a browser default Accept: text/html,*/* gets HTML.
    const wantsHtml =
      req.query.format === 'html' ||
      (req.query.format !== 'json' && req.accepts(['json', 'html']) === 'html');
    if (wantsHtml) {
      const token = req.get('Authorization')?.replace(/^Bearer\s+/, '') || req.query.token || '';
      res.type('html').send(analyticsHtml(data, { token }));
      return;
    }
    res.json(data);
  });
}

// ---------------------------------------------------------------------------
// HTML renderer. Self-contained: no external CSS, no JS, works in any
// browser, prints cleanly, copy-pasteable into support tickets / Slack.
// Coral-on-slate to match Loop's marketing palette.
// ---------------------------------------------------------------------------
function analyticsHtml(d, { token = '' } = {}) {
  const tokenSuffix = token ? `&token=${encodeURIComponent(token)}` : '';
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const pct = (n) => `${(Number(n || 0) * 100).toFixed(1)}%`;
  const dt = (s) => (s ? new Date(s).toISOString().slice(0, 19).replace('T', ' ') + ' UTC' : '—');
  const escape = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);

  const topItemsRows = d.topClickedItems.length
    ? d.topClickedItems
        .map(
          (it, i) => `
        <tr>
          <td class="rank">${i + 1}</td>
          <td>${escape(it.title || it.itemId)}</td>
          <td class="num">${fmt(it.clicks)}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td colspan="3" class="muted">No item clicks recorded yet in this window.</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loop analytics — ${escape(d.tenant.workspaceId)}</title>
<style>
  :root {
    --coral: #F43F5E;
    --coral-deep: #BE123C;
    --ink-100: #F1F5F9;
    --ink-300: #CBD5E1;
    --ink-500: #64748B;
    --ink-700: #334155;
    --ink-900: #0F172A;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    background: #F8FAFC;
    color: var(--ink-900);
    padding: 32px 24px 64px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 1.65rem; letter-spacing: -0.02em; margin-bottom: 4px; }
  .sub { color: var(--ink-500); font-size: 0.9rem; margin-bottom: 8px; }
  .ws-pill {
    display: inline-block;
    background: var(--coral);
    color: white;
    padding: 4px 10px;
    border-radius: 6px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 0.78rem;
    font-weight: 700;
    margin-bottom: 18px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 14px;
    margin-bottom: 32px;
  }
  .kpi {
    background: white;
    border: 1px solid var(--ink-100);
    border-radius: 10px;
    padding: 16px 18px;
  }
  .kpi__label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-500);
    font-weight: 700;
    margin-bottom: 6px;
  }
  .kpi__value {
    font-size: 1.65rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--ink-900);
  }
  .kpi__sub {
    font-size: 0.78rem;
    color: var(--ink-500);
    margin-top: 4px;
  }
  .kpi--accent .kpi__value { color: var(--coral-deep); }
  h2 {
    font-size: 1rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    margin: 8px 0 12px;
    color: var(--ink-700);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    background: white;
    border: 1px solid var(--ink-100);
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 32px;
    font-size: 0.92rem;
  }
  th, td { padding: 10px 14px; text-align: left; }
  th {
    background: #F8FAFC;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-500);
    border-bottom: 1px solid var(--ink-100);
  }
  tr:not(:last-child) td { border-bottom: 1px solid var(--ink-100); }
  .num { font-variant-numeric: tabular-nums; text-align: right; font-weight: 600; }
  .rank {
    width: 32px;
    color: var(--ink-500);
    font-weight: 700;
    text-align: center;
  }
  .muted { color: var(--ink-500); font-style: italic; text-align: center; padding: 18px; }
  .meta {
    background: white;
    border: 1px solid var(--ink-100);
    border-radius: 10px;
    padding: 18px 22px;
    margin-bottom: 24px;
    font-size: 0.88rem;
    color: var(--ink-700);
  }
  .meta dt { color: var(--ink-500); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
  .meta dd { margin-bottom: 12px; font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
  .range-nav {
    margin-bottom: 18px;
    font-size: 0.82rem;
    color: var(--ink-500);
  }
  .range-nav a {
    display: inline-block;
    padding: 5px 12px;
    border-radius: 6px;
    font-weight: 600;
    text-decoration: none;
    border: 1px solid var(--ink-100);
    color: var(--ink-700);
    background: white;
    margin-right: 6px;
  }
  .range-nav a.active {
    background: var(--coral);
    color: white;
    border-color: var(--coral);
  }
  .footer { margin-top: 32px; font-size: 0.78rem; color: var(--ink-500); text-align: center; }
  .footer code { background: var(--ink-100); padding: 1px 6px; border-radius: 4px; }
</style>
</head>
<body>
<div class="container">
  <h1>Loop analytics</h1>
  <div class="sub">Last ${d.periodDays} days</div>
  <div class="ws-pill">${escape(d.tenant.workspaceId)}</div>

  <div class="range-nav">
    <a class="${d.periodDays === 7 ? 'active' : ''}"   href="?format=html&days=7${tokenSuffix}">7 days</a>
    <a class="${d.periodDays === 30 ? 'active' : ''}"  href="?format=html&days=30${tokenSuffix}">30 days</a>
    <a class="${d.periodDays === 90 ? 'active' : ''}"  href="?format=html&days=90${tokenSuffix}">90 days</a>
    <a class="${d.periodDays === 365 ? 'active' : ''}" href="?format=html&days=365${tokenSuffix}">1 year</a>
  </div>

  <div class="grid">
    <div class="kpi kpi--accent">
      <div class="kpi__label">Cards rendered</div>
      <div class="kpi__value">${fmt(d.period.cardsRendered)}</div>
      <div class="kpi__sub">${fmt(d.allTime.cardsRendered)} all-time</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">Item clicks</div>
      <div class="kpi__value">${fmt(d.period.itemClicks)}</div>
      <div class="kpi__sub">${fmt(d.allTime.itemClicks)} all-time</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">Click-through rate</div>
      <div class="kpi__value">${pct(d.period.clickThroughRate)}</div>
      <div class="kpi__sub">clicks ÷ renders</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">Configure saves</div>
      <div class="kpi__value">${fmt(d.period.configureSaved)}</div>
      <div class="kpi__sub">${fmt(d.allTime.configureSaved)} all-time</div>
    </div>
  </div>

  <h2>Top 5 clicked items (last ${d.periodDays} days)</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Item title</th>
        <th class="num">Clicks</th>
      </tr>
    </thead>
    <tbody>${topItemsRows}</tbody>
  </table>

  <h2>Workspace details</h2>
  <dl class="meta">
    <dt>Workspace ID</dt><dd>${escape(d.tenant.workspaceId)}</dd>
    <dt>First event seen</dt><dd>${dt(d.tenant.installedAt)}</dd>
    <dt>Last active</dt><dd>${dt(d.tenant.lastUsedAt)}</dd>
  </dl>

  <div class="footer">
    Loop internal analytics · window: <code>?days=${d.periodDays}</code> ·
    <a href="?format=json&days=${d.periodDays}${tokenSuffix}">view as JSON</a> ·
    <a href="/admin/events?${token ? `token=${encodeURIComponent(token)}` : ''}">recent events</a>
  </div>
</div>
</body>
</html>`;
}
