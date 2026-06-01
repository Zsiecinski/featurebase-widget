// Admin endpoints for support and operational use. Gated by ADMIN_TOKEN env
// var — without that set, the routes return 404 (functionally disabled).
// With it set, the token must be passed as `Authorization: Bearer <token>`.
//
// Endpoints
// ─────────
//   GET /admin/tenants               List of installed tenants (summary view)
//   GET /admin/tenants/:workspace_id Tenant detail (no plaintext FB key)
//
// Use case: a customer emails support saying Loop isn't rendering. Look up
// their workspace, see when they installed, whether Featurebase was
// configured, when they last used it. Faster than asking them for screenshots.

import {
  findTenantByWorkspace,
  listTenants,
  recentEvents,
  getAnalytics,
  dbAvailable,
} from './db/index.js';

function requireAdminToken(req, res, next) {
  const required = process.env.ADMIN_TOKEN;
  if (!required) return res.status(404).end();
  const auth = req.get('Authorization') || '';
  if (auth !== `Bearer ${required}`) {
    return res.status(401).json({ error: 'invalid admin token' });
  }
  next();
}

export function registerAdminRoutes(app) {
  app.get('/admin/tenants', requireAdminToken, async (req, res) => {
    if (!dbAvailable()) return res.json({ tenants: [], note: 'DB not configured' });
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const includeUninstalled = req.query.uninstalled === 'true';
    const tenants = await listTenants({ limit, offset, includeUninstalled });
    res.json({
      tenants,
      count: tenants.length,
      limit,
      offset,
    });
  });

  app.get('/admin/events', requireAdminToken, async (req, res) => {
    if (!dbAvailable()) return res.json({ events: [] });
    const limit = Number(req.query.limit) || 100;
    const tenantId = req.query.tenant_id ? Number(req.query.tenant_id) : null;
    const events = await recentEvents({ limit, tenantId });
    res.json({ events, count: events.length });
  });

  app.get('/admin/tenants/:workspaceId', requireAdminToken, async (req, res) => {
    if (!dbAvailable()) return res.status(503).json({ error: 'DB not configured' });
    const tenant = await findTenantByWorkspace(req.params.workspaceId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    // Redact the API key — only show whether it's set, not its value.
    res.json({
      id: tenant.id,
      workspaceId: tenant.workspaceId,
      featurebase: {
        org: tenant.featurebase.org,
        category: tenant.featurebase.category,
        baseUrl: tenant.featurebase.baseUrl,
        apiKeySet: Boolean(tenant.featurebase.apiKey),
      },
      configured: tenant.configured,
    });
  });

  // Per-workspace analytics summary. Groundwork for the future Pro-tier
  // customer-facing dashboard — for now, internal-only behind ADMIN_TOKEN.
  // Aggregates tenant_events into headline metrics: cards rendered, item
  // clicks, click-through rate, top items, install/uninstall counts.
  //
  // Content negotiation: returns JSON by default; renders a styled HTML
  // dashboard when Accept: text/html is sent OR when ?format=html is set.
  // The HTML version is for ops humans, the JSON for tooling.
  //
  // Query params: ?days=N (default 30, max 365), ?format=html|json
  app.get('/admin/analytics/:workspaceId', requireAdminToken, async (req, res) => {
    if (!dbAvailable()) return res.status(503).json({ error: 'DB not configured' });
    const requested = Number(req.query.days) || 30;
    const days = Math.min(Math.max(requested, 1), 365);
    const data = await getAnalytics(req.params.workspaceId, { days });
    if (!data) return res.status(404).json({ error: 'tenant not found' });

    const wantsHtml =
      req.query.format === 'html' ||
      (req.query.format !== 'json' && req.accepts(['json', 'html']) === 'html');
    if (wantsHtml) {
      res.type('html').send(analyticsHtml(data));
      return;
    }
    res.json(data);
  });
}

// Render the analytics summary as a self-contained HTML page. No external
// CSS, no JS — works in any browser, prints cleanly, copy-pasteable into
// support tickets. Coral-on-slate to match Loop's marketing palette.
function analyticsHtml(d) {
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
  .footer { margin-top: 32px; font-size: 0.78rem; color: var(--ink-500); text-align: center; }
  .footer code { background: var(--ink-100); padding: 1px 6px; border-radius: 4px; }
  .uninstalled-banner {
    background: #FEF3C7;
    border: 1px solid #F59E0B;
    color: #92400E;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 0.88rem;
    font-weight: 600;
    margin-bottom: 24px;
  }
</style>
</head>
<body>
<div class="container">
  <h1>Loop analytics</h1>
  <div class="sub">Last ${d.periodDays} days · ${escape(d.tenant.email || 'no email on file')}</div>
  <div class="ws-pill">${escape(d.tenant.workspaceId)}</div>

  ${d.tenant.uninstalledAt
    ? `<div class="uninstalled-banner">⚠ This workspace uninstalled Loop on ${dt(d.tenant.uninstalledAt)}.</div>`
    : ''}

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

  <h2>Tenant details</h2>
  <dl class="meta">
    <dt>Workspace ID</dt><dd>${escape(d.tenant.workspaceId)}</dd>
    <dt>Admin email</dt><dd>${escape(d.tenant.email || '—')}</dd>
    <dt>Installed</dt><dd>${dt(d.tenant.installedAt)}</dd>
    <dt>First configured</dt><dd>${dt(d.tenant.configuredAt)}</dd>
    <dt>Last active</dt><dd>${dt(d.tenant.lastUsedAt)}</dd>
    <dt>Uninstalled</dt><dd>${dt(d.tenant.uninstalledAt)}</dd>
  </dl>

  <div class="footer">
    Loop internal analytics · query: <code>?days=${d.periodDays}</code> ·
    <a href="?format=json&days=${d.periodDays}">view as JSON</a>
  </div>
</div>
</body>
</html>`;
}
