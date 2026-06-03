// Internal analytics endpoints for the single-tenant Loop build.
//
// Gated by ADMIN_TOKEN env var — without that set, the routes return 404
// (functionally disabled, no info leak). With it set, the token must be
// passed as `Authorization: Bearer <token>` OR `?token=<token>` (the query
// param is handy for direct browser navigation into the HTML dashboard).
//
// Endpoints
// ─────────
//   GET /admin/analytics/:workspace_id              Main dashboard
//   GET /admin/analytics/:workspace_id/user/:id     Per-user drilldown
//   GET /admin/events                               Recent events as JSON
//
// PII masking
// ───────────
// The dashboard hides names and emails by default (B. S. / b•••@acme.com).
// Append `&show_pii=1` (or click the toggle in the dashboard header) to
// reveal full identities. This protects against accidental PII exposure
// during screen-shares or demo recordings.

import {
  dbAvailable,
  getAnalytics,
  getDailyActivity,
  getEngagedUsers,
  getEngagementByShop,
  getPriorPeriodCounts,
  getTopItemsWithClickers,
  getUserSparklines,
  getUserTimeline,
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

// Extract the bearer token from either header or query, for round-trip URLs
// in the rendered HTML (so navigation between pages keeps auth alive).
function tokenFrom(req) {
  return (
    req.get('Authorization')?.replace(/^Bearer\s+/, '') ||
    (typeof req.query.token === 'string' ? req.query.token : '') ||
    ''
  );
}

// "1" / "true" → true; anything else (incl. undefined) → false.
function truthyParam(v) {
  return v === '1' || v === 'true';
}

// Normalise the ?theme= param. Accepts 'dark' or 'light'; anything else
// (incl. missing) means "auto" — let prefers-color-scheme decide via CSS.
function themeFrom(req) {
  const t = req.query.theme;
  return t === 'dark' || t === 'light' ? t : null;
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
    const showPii = truthyParam(req.query.show_pii);

    // Six independent queries in parallel — none depend on each other.
    const [
      data,
      engaged,
      itemsWithClickers,
      byShop,
      daily,
      prior,
    ] = await Promise.all([
      getAnalytics(req.params.workspaceId, { days }),
      getEngagedUsers(req.params.workspaceId, { days, limit: 5 }),
      getTopItemsWithClickers(req.params.workspaceId, { days, limit: 5 }),
      getEngagementByShop(req.params.workspaceId, { days, limit: 5 }),
      getDailyActivity(req.params.workspaceId, { days }),
      getPriorPeriodCounts(req.params.workspaceId, { days }),
    ]);
    if (!data) return res.status(404).json({ error: 'no events for this workspace yet' });

    // Attach per-user sparklines as a second round-trip (depends on the
    // engaged list, so it can't go in the Promise.all above).
    const contactIds = engaged.map((u) => u.contactId).filter(Boolean);
    const userSparklines = await getUserSparklines(req.params.workspaceId, contactIds, { days: 7 });
    const engagedWithSpark = engaged.map((u) => ({
      ...u,
      sparkline: userSparklines.get(u.contactId) || [],
    }));

    const wantsHtml =
      req.query.format === 'html' ||
      (req.query.format !== 'json' && req.accepts(['json', 'html']) === 'html');
    if (wantsHtml) {
      res.type('html').send(
        analyticsHtml(
          {
            ...data,
            engagedUsers: engagedWithSpark,
            itemsWithClickers,
            engagementByShop: byShop,
            dailyActivity: daily,
            priorPeriod: prior,
          },
          { token: tokenFrom(req), showPii, theme: themeFrom(req) },
        ),
      );
      return;
    }
    // JSON view applies masking too — so the same toggle behavior is
    // consistent whether you're hitting the dashboard in a browser or
    // pulling data with curl. Pass &show_pii=1 to get raw identities.
    // Note: shop is NOT masked — myshopify domains are business
    // identifiers, not PII, and the whole point of capturing them
    // is to be able to see them in a list.
    res.json({
      ...data,
      engagedUsers: engagedWithSpark.map((u) => maskUser(u, showPii)),
      itemsWithClickers: itemsWithClickers.map((it) => ({
        ...it,
        clickers: it.clickers.map((c) => maskUser(c, showPii)),
      })),
      engagementByShop: byShop,
      dailyActivity: daily,
      priorPeriod: prior,
    });
  });

  // Per-user drilldown — every event from one contact in chronological order.
  app.get('/admin/analytics/:workspaceId/user/:contactId', requireAdminToken, async (req, res) => {
    if (!dbAvailable()) return res.status(503).json({ error: 'DB not configured' });
    const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 365);
    const showPii = truthyParam(req.query.show_pii);
    const data = await getUserTimeline(req.params.workspaceId, req.params.contactId, { days });
    if (!data) return res.status(404).json({ error: 'no events for this user' });

    const wantsHtml =
      req.query.format === 'html' ||
      (req.query.format !== 'json' && req.accepts(['json', 'html']) === 'html');
    if (wantsHtml) {
      res.type('html').send(
        userTimelineHtml(data, {
          workspaceId: req.params.workspaceId,
          token: tokenFrom(req),
          showPii,
          theme: themeFrom(req),
        }),
      );
      return;
    }
    res.json({
      ...data,
      user: maskUser(data.user, showPii),
    });
  });
}

// ---------------------------------------------------------------------------
// PII masking. Default-on — converts "Bob Smith" → "B. S." and
// "bob@acme.com" → "b•••@acme.com". Opt out per request with show_pii=1.
// ---------------------------------------------------------------------------
// Exported for tests + reuse by future tooling (e.g. a daily email digest
// that should also respect the masking default).
export function maskName(name, showPii) {
  if (!name) return null;
  if (showPii) return name;
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}.`)
    .join(' ');
}

export function maskEmail(email, showPii) {
  if (!email) return null;
  if (showPii) return email;
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  // Always exactly 3 dots regardless of local length. Consistent rendering
  // in tables, and no length info leak ("b•@x.com" vs "b•••••••••@x.com"
  // would whisper how long the username was).
  return `${local[0]}•••@${domain}`;
}

// Wraps a user record (engaged-users row, clicker row, timeline header) with
// masking applied. Stays a flat object so renderers can use it directly.
function maskUser(u, showPii) {
  if (!u) return u;
  return {
    ...u,
    name: maskName(u.name, showPii),
    email: maskEmail(u.email, showPii),
  };
}

// ---------------------------------------------------------------------------
// Shared HTML helpers. No external CSS, no JS — works in any browser.
// ---------------------------------------------------------------------------
const escape = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const pct = (n) => `${(Number(n || 0) * 100).toFixed(1)}%`;
const dt = (s) => (s ? new Date(s).toISOString().slice(0, 19).replace('T', ' ') + ' UTC' : '—');

// ---------------------------------------------------------------------------
// SVG chart renderers. All server-side, no JS, no external libraries.
// Coral = clicks (the primary metric), blue = renders (the secondary one).
// ---------------------------------------------------------------------------

// SVG renderers use CSS classes (.bar-clicks, .bar-renders, .axis-line,
// .axis-label, .spark-line, .spark-area) instead of hardcoded fills/strokes.
// CSS variables in the theme block decide the actual colors, so charts
// switch between light and dark mode without re-rendering server-side.

/**
 * Big daily activity chart. Side-by-side bars per day, coral for clicks
 * and blue for renders. Auto-scales Y to max value. Three X-axis labels
 * (start / middle / end) so it stays readable at any window length.
 */
function dailyChartSvg(daily) {
  const W = 940;
  const H = 240;
  const PAD = { top: 16, right: 16, bottom: 36, left: 32 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  if (!Array.isArray(daily) || daily.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="chart">
      <text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="axis-label" font-family="-apple-system,sans-serif" font-size="13">No activity data yet.</text>
    </svg>`;
  }

  const maxVal = Math.max(1, ...daily.map((d) => Math.max(d.renders, d.clicks)));
  // Nice round-up for the Y axis upper bound.
  const yMax = niceCeil(maxVal);

  const slotW = innerW / daily.length;
  const barW = Math.max(2, slotW * 0.36);
  const barGap = slotW * 0.08;

  // Y-axis ticks at 0, half, full.
  const yTicks = [0, Math.round(yMax / 2), yMax];
  const yTickLines = yTicks
    .map((v) => {
      const y = PAD.top + innerH - (v / yMax) * innerH;
      return `
        <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y}" y2="${y}" class="axis-line" stroke-width="1" stroke-dasharray="2,3" opacity="0.5" />
        <text x="${PAD.left - 6}" y="${y + 4}" text-anchor="end" class="axis-label" font-family="ui-monospace,monospace" font-size="10">${v}</text>
      `;
    })
    .join('');

  // Bars: render bar (blue, behind) + click bar (coral) per day.
  const bars = daily
    .map((d, i) => {
      const x0 = PAD.left + i * slotW + (slotW - barW * 2 - barGap) / 2;
      const renderH = (d.renders / yMax) * innerH;
      const clickH = (d.clicks / yMax) * innerH;
      const yR = PAD.top + innerH - renderH;
      const yC = PAD.top + innerH - clickH;
      return `
        <rect x="${x0}" y="${yR}" width="${barW}" height="${renderH}" class="bar-renders" rx="1.5" />
        <rect x="${x0 + barW + barGap}" y="${yC}" width="${barW}" height="${clickH}" class="bar-clicks" rx="1.5" />
      `;
    })
    .join('');

  // X-axis labels: first / middle / last. Skip middle if window is small.
  const labelIndices = daily.length >= 5 ? [0, Math.floor(daily.length / 2), daily.length - 1] : [0, daily.length - 1];
  const xLabels = labelIndices
    .map((i) => {
      const x = PAD.left + i * slotW + slotW / 2;
      const label = new Date(daily[i].day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `<text x="${x}" y="${H - 16}" text-anchor="middle" class="axis-label" font-family="-apple-system,sans-serif" font-size="11">${label}</text>`;
    })
    .join('');

  // Bottom-axis baseline.
  const baseline = `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${PAD.top + innerH}" y2="${PAD.top + innerH}" class="axis-line" stroke-width="1.5" />`;

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="chart">
    ${yTickLines}
    ${baseline}
    ${bars}
    ${xLabels}
  </svg>`;
}

/**
 * Tiny sparkline — small inline SVG showing a 7-day click trend.
 * Used per-row in the engaged-users and shops tables so you can spot
 * who's trending up vs cooling off at a glance.
 */
function sparklineSvg(points, { width = 80, height = 24 } = {}) {
  if (!Array.isArray(points) || points.length === 0) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="spark"></svg>`;
  }
  const max = Math.max(1, ...points.map((p) => p.clicks));
  const slotW = width / Math.max(1, points.length - 1);
  const coords = points
    .map((p, i) => {
      const x = i * slotW;
      const y = height - (p.clicks / max) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  // Area under the line, semi-transparent. Plus the line itself on top.
  const area = `${0},${height} ${coords} ${width},${height}`;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="spark">
    <polygon points="${area}" class="spark-area" />
    <polyline points="${coords}" fill="none" class="spark-line" stroke-width="1.5" stroke-linejoin="round" />
  </svg>`;
}

/**
 * Period-over-period change badge. Shown next to KPI values.
 * Coral up-arrow for growth, slate down-arrow for decline, no badge
 * when the prior period was zero (no meaningful baseline to compare).
 */
function deltaBadge(current, prior) {
  if (!prior || prior === 0) {
    if (current > 0) return `<span class="delta delta--new">NEW</span>`;
    return '';
  }
  const pctChange = ((current - prior) / prior) * 100;
  if (Math.abs(pctChange) < 1) return `<span class="delta delta--flat">±0%</span>`;
  const up = pctChange > 0;
  const arrow = up ? '↑' : '↓';
  const rounded = Math.abs(pctChange) >= 100
    ? Math.round(pctChange)
    : Math.round(pctChange * 10) / 10;
  return `<span class="delta delta--${up ? 'up' : 'down'}">${arrow} ${Math.abs(rounded)}%</span>`;
}

// Round up to a "nice" number for Y-axis: 1 → 1, 4 → 5, 7 → 10, 15 → 20,
// 73 → 80, 175 → 200. Avoids ugly axis labels like "y=7" on auto-scaling.
function niceCeil(n) {
  if (n <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(n)));
  const norm = n / pow;
  let nice;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
}

// Render a shop value. Auto-detects whether it looks like a myshopify
// domain and styles it as code; otherwise shows it plain. Null/empty
// renders as a muted dash so columns line up cleanly.
function shopCell(shop, { strong = false } = {}) {
  if (!shop) return '<span class="muted">—</span>';
  const looksLikeDomain = /\.[a-z]{2,}(?:\/|$)/i.test(String(shop));
  const inner = looksLikeDomain ? `<code>${escape(shop)}</code>` : escape(shop);
  return strong ? `<strong>${inner}</strong>` : inner;
}

// Format a user row as a single-line label. Anonymous leads (no
// contact_id) get a styled muted label; identified users show their
// (possibly masked) name + email.
function userLabel(u, { workspaceId = null, token = '' } = {}) {
  if (!u) return '<span class="muted">(unknown)</span>';
  if (!u.contactId) return '<span class="muted">(anonymous lead)</span>';
  const nm = u.name ? escape(u.name) : '<span class="muted">no name</span>';
  const em = u.email ? escape(u.email) : '<span class="muted">no email</span>';
  const inner = `${nm} · <span class="email">${em}</span>`;
  if (workspaceId && token) {
    return `<a href="/admin/analytics/${encodeURIComponent(workspaceId)}/user/${encodeURIComponent(u.contactId)}?format=html&token=${encodeURIComponent(token)}">${inner}</a>`;
  }
  return inner;
}

// Build a URL pointing at the same dashboard view but with show_pii toggled.
// Preserves other params (days, format) so clicking the toggle doesn't
// reset the user's filters.
function piiToggleUrl(req, showPii, basePath) {
  const params = new URLSearchParams();
  if (basePath.format) params.set('format', basePath.format);
  if (basePath.days) params.set('days', String(basePath.days));
  if (basePath.token) params.set('token', basePath.token);
  if (!showPii) params.set('show_pii', '1');
  return `?${params.toString()}`;
}

// Shared <style> block for both pages.
const sharedStyle = `
  /* ─── Light theme (default) ──────────────────────────────────────── */
  :root {
    --bg: #F8FAFC;
    --card-bg: #FFFFFF;
    --table-head-bg: #F8FAFC;
    --border: #F1F5F9;
    --border-strong: #E2E8F0;
    --text: #0F172A;
    --text-secondary: #334155;
    --text-muted: #64748B;
    --text-light: #94A3B8;
    --code-bg: #F1F5F9;
    --coral: #F43F5E;
    --coral-deep: #BE123C;
    --coral-bg: #FEE2E2;
    --blue: #60A5FA;
    --blue-deep: #1D4ED8;
    --blue-bg: #DBEAFE;
    --amber-bg: #FEF3C7;
    --amber-border: #F59E0B;
    --amber-text: #92400E;
    --green-bg: #DCFCE7;
    --green-text: #166534;
    --shadow: 0 0 0 1px rgba(15, 23, 42, 0.04);
    --chart-axis: #CBD5E1;
    --chart-label: #64748B;
  }

  /* ─── Dark theme (explicit override) ──────────────────────────────── */
  :root[data-theme="dark"] {
    --bg: #0B1220;
    --card-bg: #1E293B;
    --table-head-bg: #182234;
    --border: #334155;
    --border-strong: #475569;
    --text: #F1F5F9;
    --text-secondary: #CBD5E1;
    --text-muted: #94A3B8;
    --text-light: #64748B;
    --code-bg: #334155;
    --coral: #FB7185;
    --coral-deep: #FDA4AF;
    --coral-bg: #4C1D2A;
    --blue: #93C5FD;
    --blue-deep: #BFDBFE;
    --blue-bg: #1E3A8A;
    --amber-bg: #422006;
    --amber-border: #B45309;
    --amber-text: #FCD34D;
    --green-bg: #14532D;
    --green-text: #BBF7D0;
    --shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
    --chart-axis: #475569;
    --chart-label: #94A3B8;
  }

  /* Auto dark mode when OS prefers it AND no explicit theme is set.
     Mirrors the [data-theme="dark"] block above. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0B1220;
      --card-bg: #1E293B;
      --table-head-bg: #182234;
      --border: #334155;
      --border-strong: #475569;
      --text: #F1F5F9;
      --text-secondary: #CBD5E1;
      --text-muted: #94A3B8;
      --text-light: #64748B;
      --code-bg: #334155;
      --coral: #FB7185;
      --coral-deep: #FDA4AF;
      --coral-bg: #4C1D2A;
      --blue: #93C5FD;
      --blue-deep: #BFDBFE;
      --blue-bg: #1E3A8A;
      --amber-bg: #422006;
      --amber-border: #B45309;
      --amber-text: #FCD34D;
      --green-bg: #14532D;
      --green-text: #BBF7D0;
      --shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
      --chart-axis: #475569;
      --chart-label: #94A3B8;
    }
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { color-scheme: light dark; }
  html[data-theme="light"] { color-scheme: light; }
  html[data-theme="dark"]  { color-scheme: dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    background: var(--bg); color: var(--text);
    padding: 32px 24px 64px; line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 1.65rem; letter-spacing: -0.02em; margin-bottom: 4px; }
  h2 {
    font-size: 1rem; font-weight: 800; letter-spacing: -0.01em;
    margin: 8px 0 12px; color: var(--text-secondary);
  }
  .sub { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 8px; }
  .ws-pill {
    display: inline-block; background: var(--coral); color: white;
    padding: 4px 10px; border-radius: 6px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 0.78rem; font-weight: 700; margin-bottom: 18px;
  }
  .grid {
    display: grid; gap: 14px; margin-bottom: 32px;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
  .kpi { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
  .kpi__label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); font-weight: 700; margin-bottom: 6px; }
  .kpi__value { font-size: 1.65rem; font-weight: 800; letter-spacing: -0.02em; color: var(--text); }
  .kpi__sub { font-size: 0.78rem; color: var(--text-muted); margin-top: 4px; }
  .kpi--accent .kpi__value { color: var(--coral-deep); }
  table {
    width: 100%; border-collapse: collapse; background: var(--card-bg);
    border: 1px solid var(--border); border-radius: 10px;
    overflow: hidden; margin-bottom: 32px; font-size: 0.92rem;
  }
  th, td { padding: 10px 14px; text-align: left; vertical-align: top; }
  th {
    background: var(--table-head-bg); font-size: 0.7rem; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--text-muted); border-bottom: 1px solid var(--border);
  }
  tr:not(:last-child) td { border-bottom: 1px solid var(--border); }
  .num { font-variant-numeric: tabular-nums; text-align: right; font-weight: 600; }
  .rank { width: 32px; color: var(--text-muted); font-weight: 700; text-align: center; }
  .muted { color: var(--text-muted); font-style: italic; }
  .muted-cell { color: var(--text-muted); font-style: italic; text-align: center; padding: 18px; }
  a { color: var(--coral-deep); text-decoration: none; font-weight: 600; }
  a:hover { text-decoration: underline; }
  .email { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-weight: 500; color: var(--text-secondary); }
  .clicker-list { font-size: 0.84rem; color: var(--text-secondary); line-height: 1.7; }
  .clicker-list .clicker { display: block; padding: 2px 0; }
  .clicker-list .count { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  code { background: var(--code-bg); padding: 1px 6px; border-radius: 4px; color: var(--text); }
  .meta {
    background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px;
    padding: 18px 22px; margin-bottom: 24px; font-size: 0.88rem; color: var(--text-secondary);
  }
  .meta dt { color: var(--text-muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
  .meta dd { margin-bottom: 12px; font-family: ui-monospace, 'SF Mono', Menlo, monospace; color: var(--text); }
  .range-nav, .toolbar { margin-bottom: 18px; font-size: 0.82rem; color: var(--text-muted); }
  .range-nav a, .toolbar a, .toggle {
    display: inline-block; padding: 5px 12px; border-radius: 6px;
    font-weight: 600; text-decoration: none;
    border: 1px solid var(--border); color: var(--text-secondary);
    background: var(--card-bg); margin-right: 6px;
  }
  .range-nav a.active { background: var(--coral); color: white; border-color: var(--coral); }
  .toggle--on { background: var(--text); color: var(--card-bg); border-color: var(--text); }
  .toggle--off { background: var(--card-bg); }
  .toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  .toolbar-right { display: flex; gap: 6px; align-items: center; }
  .timeline-row td { font-size: 0.88rem; }
  .timeline-row .event-pill {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 0.7rem; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .event-pill--click  { background: var(--coral-bg); color: var(--coral-deep); }
  .event-pill--render { background: var(--blue-bg);  color: var(--blue-deep);  }
  .event-pill--config { background: var(--amber-bg); color: var(--amber-text); }
  .event-pill--other  { background: var(--border);   color: var(--text-secondary); }
  .pii-banner {
    background: var(--amber-bg); border: 1px solid var(--amber-border); color: var(--amber-text);
    padding: 10px 14px; border-radius: 8px; font-size: 0.84rem;
    margin-bottom: 18px; font-weight: 500;
  }
  .chart-card {
    background: var(--card-bg); border: 1px solid var(--border);
    border-radius: 10px; padding: 18px 18px 14px;
    margin-bottom: 32px;
  }
  .chart-card__head {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 8px;
  }
  .chart-card__title { font-size: 0.92rem; font-weight: 700; color: var(--text-secondary); }
  .chart-card__legend { font-size: 0.78rem; color: var(--text-muted); }
  .chart-card__legend .sw {
    display: inline-block; width: 10px; height: 10px; border-radius: 2px;
    margin-right: 5px; vertical-align: -1px;
  }
  .chart-card__legend .sw--clicks  { background: var(--coral); }
  .chart-card__legend .sw--renders { background: var(--blue); }
  .chart-card__legend span + span { margin-left: 12px; }
  .chart { width: 100%; height: auto; display: block; }
  .chart .bar-clicks  { fill: var(--coral); }
  .chart .bar-renders { fill: var(--blue); }
  .chart .axis-line   { stroke: var(--chart-axis); }
  .chart .axis-label  { fill: var(--chart-label); }
  .spark { vertical-align: middle; }
  .spark .spark-line { stroke: var(--coral); }
  .spark .spark-area { fill: var(--coral); opacity: 0.15; }
  .delta {
    display: inline-block;
    padding: 1px 6px; border-radius: 4px;
    font-size: 0.7rem; font-weight: 800;
    margin-left: 6px; vertical-align: 4px;
    font-variant-numeric: tabular-nums;
  }
  .delta--up   { background: var(--coral-bg); color: var(--coral-deep); }
  .delta--down { background: var(--blue-bg);  color: var(--blue-deep);  }
  .delta--flat { background: var(--border);   color: var(--text-muted); }
  .delta--new  { background: var(--green-bg); color: var(--green-text); }
  .kpi__sub .delta { vertical-align: 1px; margin-left: 0; }
  .footer { margin-top: 32px; font-size: 0.78rem; color: var(--ink-500); text-align: center; }
  .footer code { background: var(--ink-100); padding: 1px 6px; border-radius: 4px; }
`;

// ---------------------------------------------------------------------------
// Main analytics dashboard.
// ---------------------------------------------------------------------------
function analyticsHtml(d, { token = '', showPii = false, theme = null } = {}) {
  const tokenSuffix = token ? `&token=${encodeURIComponent(token)}` : '';
  const piiSuffix = showPii ? '&show_pii=1' : '';
  const themeSuffix = theme ? `&theme=${theme}` : '';
  // Toggle target: flip whatever is currently rendered. If no theme is
  // set (auto), assume we're showing light and offer dark.
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const themeToggleSuffix = `&theme=${nextTheme}`;
  const themeLabel = theme === 'dark'
    ? '☀ Light mode'
    : theme === 'light'
      ? '🌙 Dark mode'
      : '🌙 Dark mode';

  // Pre-mask everything for HTML rendering.
  const engaged = (d.engagedUsers || []).map((u) => maskUser(u, showPii));
  const items = (d.itemsWithClickers || []).map((it) => ({
    ...it,
    clickers: it.clickers.map((c) => maskUser(c, showPii)),
  }));

  const engagedRows = engaged.length
    ? engaged
        .map((u, i) => `
        <tr>
          <td class="rank">${i + 1}</td>
          <td>${userLabel(u, { workspaceId: d.tenant.workspaceId, token })}</td>
          <td>${shopCell(u.shop)}</td>
          <td>${sparklineSvg(u.sparkline || [])}</td>
          <td class="num">${fmt(u.clicks)}</td>
          <td class="num">${fmt(u.renders)}</td>
          <td class="num"><span class="muted">${dt(u.lastSeen).slice(0, 16)}</span></td>
        </tr>`)
        .join('')
    : `<tr><td colspan="7" class="muted-cell">No identified visitors yet in this window.</td></tr>`;

  // Top-shops section. Only render if Intercom is actually sending shop
  // data — otherwise show a helpful empty-state explaining how to wire it.
  const shopRows = (d.engagementByShop || []).length
    ? d.engagementByShop
        .map((s, i) => `
        <tr>
          <td class="rank">${i + 1}</td>
          <td>${shopCell(s.shop, { strong: true })}</td>
          <td>${sparklineSvg(s.sparkline || [])}</td>
          <td class="num">${fmt(s.uniqueVisitors)}</td>
          <td class="num">${fmt(s.clicks)}</td>
          <td class="num">${fmt(s.renders)}</td>
        </tr>`)
        .join('')
    : `<tr><td colspan="6" class="muted-cell">
         No shop attribution yet. Intercom contacts (or their companies) need a
         <code>shopify_domain</code> custom attribute set — or the myshopify
         domain stored in Intercom's <code>user_id</code> field — for Loop to
         surface this. Loop also recognises <code>shop_domain</code>,
         <code>myshopify_domain</code>, <code>store_domain</code>, and a few others.
       </td></tr>`;

  const itemRows = items.length
    ? items
        .map((it, i) => {
          // Render top 3 clickers inline per item; rest summarized.
          const top = it.clickers.slice(0, 3);
          const extra = it.clickers.length - top.length;
          const clickersHtml = top.length
            ? top
                .map((c) => `<span class="clicker">${userLabel(c, { workspaceId: d.tenant.workspaceId, token })} <span class="count">· ${fmt(c.clicks)}</span></span>`)
                .join('') +
              (extra > 0 ? `<span class="clicker muted">+ ${extra} more</span>` : '')
            : `<span class="muted">no contact data</span>`;
          return `
        <tr>
          <td class="rank">${i + 1}</td>
          <td><strong>${escape(it.title || it.itemId)}</strong></td>
          <td><div class="clicker-list">${clickersHtml}</div></td>
          <td class="num">${fmt(it.clicks)}</td>
        </tr>`;
        })
        .join('')
    : `<tr><td colspan="4" class="muted-cell">No item clicks recorded yet in this window.</td></tr>`;

  return `<!doctype html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Loop analytics — ${escape(d.tenant.workspaceId)}</title>
<style>${sharedStyle}</style>
</head>
<body>
<div class="container">
  <h1>Loop analytics</h1>
  <div class="sub">Last ${d.periodDays} days</div>
  <div class="ws-pill">${escape(d.tenant.workspaceId)}</div>

  <div class="toolbar">
    <div class="range-nav">
      <a class="${d.periodDays === 7   ? 'active' : ''}" href="?format=html&days=7${tokenSuffix}${piiSuffix}${themeSuffix}">7 days</a>
      <a class="${d.periodDays === 30  ? 'active' : ''}" href="?format=html&days=30${tokenSuffix}${piiSuffix}${themeSuffix}">30 days</a>
      <a class="${d.periodDays === 90  ? 'active' : ''}" href="?format=html&days=90${tokenSuffix}${piiSuffix}${themeSuffix}">90 days</a>
      <a class="${d.periodDays === 365 ? 'active' : ''}" href="?format=html&days=365${tokenSuffix}${piiSuffix}${themeSuffix}">1 year</a>
    </div>
    <div class="toolbar-right">
      <a class="toggle toggle--off" href="?format=html&days=${d.periodDays}${tokenSuffix}${piiSuffix}${themeToggleSuffix}">
        ${themeLabel}
      </a>
      <a class="toggle ${showPii ? 'toggle--on' : 'toggle--off'}"
         href="?format=html&days=${d.periodDays}${tokenSuffix}${themeSuffix}${showPii ? '' : '&show_pii=1'}">
        ${showPii ? '🔓 Hide identities' : '🔒 Show full identities'}
      </a>
    </div>
  </div>

  ${showPii ? `
  <div class="pii-banner">
    ⚠ Full names and email addresses are visible. Be careful with screen-shares.
  </div>` : ''}

  <div class="grid">
    <div class="kpi kpi--accent">
      <div class="kpi__label">Cards rendered</div>
      <div class="kpi__value">${fmt(d.period.cardsRendered)} ${deltaBadge(d.period.cardsRendered, d.priorPeriod?.cardsRendered)}</div>
      <div class="kpi__sub">${fmt(d.priorPeriod?.cardsRendered || 0)} in prior ${d.periodDays} days</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">Unique visitors</div>
      <div class="kpi__value">${fmt(d.period.uniqueVisitors)} ${deltaBadge(d.period.uniqueVisitors, d.priorPeriod?.uniqueVisitors)}</div>
      <div class="kpi__sub">${fmt(d.priorPeriod?.uniqueVisitors || 0)} in prior ${d.periodDays} days</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">Item clicks</div>
      <div class="kpi__value">${fmt(d.period.itemClicks)} ${deltaBadge(d.period.itemClicks, d.priorPeriod?.itemClicks)}</div>
      <div class="kpi__sub">${fmt(d.priorPeriod?.itemClicks || 0)} in prior ${d.periodDays} days</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">Click-through rate</div>
      <div class="kpi__value">${pct(d.period.clickThroughRate)}</div>
      <div class="kpi__sub">clicks ÷ renders</div>
    </div>
  </div>

  <div class="chart-card">
    <div class="chart-card__head">
      <div class="chart-card__title">Daily activity (last ${d.periodDays} days)</div>
      <div class="chart-card__legend">
        <span><span class="sw sw--clicks"></span>Clicks</span>
        <span><span class="sw sw--renders"></span>Renders</span>
      </div>
    </div>
    ${dailyChartSvg(d.dailyActivity || [])}
  </div>

  <h2>Most engaged visitors (last ${d.periodDays} days)</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Visitor</th>
        <th>Shop</th>
        <th style="width: 100px;">7-day trend</th>
        <th class="num">Item clicks</th>
        <th class="num">Renders</th>
        <th class="num">Last seen</th>
      </tr>
    </thead>
    <tbody>${engagedRows}</tbody>
  </table>

  <h2>Engagement by shop (last ${d.periodDays} days)</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Shop</th>
        <th style="width: 100px;">7-day trend</th>
        <th class="num">Unique visitors</th>
        <th class="num">Clicks</th>
        <th class="num">Renders</th>
      </tr>
    </thead>
    <tbody>${shopRows}</tbody>
  </table>

  <h2>Top items, with who clicked (last ${d.periodDays} days)</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Item</th>
        <th>Clicked by</th>
        <th class="num">Total clicks</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <h2>Workspace details</h2>
  <dl class="meta">
    <dt>Workspace ID</dt><dd>${escape(d.tenant.workspaceId)}</dd>
    <dt>First event seen</dt><dd>${dt(d.tenant.installedAt)}</dd>
    <dt>Last active</dt><dd>${dt(d.tenant.lastUsedAt)}</dd>
  </dl>

  <div class="footer">
    Loop internal analytics · window: <code>?days=${d.periodDays}</code> ·
    <a href="?format=json&days=${d.periodDays}${tokenSuffix}${piiSuffix}">view as JSON</a> ·
    <a href="/admin/events?${token ? `token=${encodeURIComponent(token)}` : ''}">recent events</a>
  </div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Per-user timeline page — same dual-theme treatment as the main dashboard.
// Per-user timeline page. Reached from the dashboard by clicking a name.
// ---------------------------------------------------------------------------
function userTimelineHtml(d, { workspaceId, token = '', showPii = false, theme = null } = {}) {
  const tokenSuffix = token ? `&token=${encodeURIComponent(token)}` : '';
  const piiSuffix = showPii ? '&show_pii=1' : '';
  const themeSuffix = theme ? `&theme=${theme}` : '';
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const themeToggleSuffix = `&theme=${nextTheme}`;
  const themeLabel = theme === 'dark'
    ? '☀ Light mode'
    : theme === 'light'
      ? '🌙 Dark mode'
      : '🌙 Dark mode';
  const u = maskUser(d.user, showPii);

  function eventPill(event) {
    if (event === 'item_clicked') return '<span class="event-pill event-pill--click">click</span>';
    if (event === 'card_rendered') return '<span class="event-pill event-pill--render">render</span>';
    if (event.startsWith('configure_')) return '<span class="event-pill event-pill--config">config</span>';
    return `<span class="event-pill event-pill--other">${escape(event)}</span>`;
  }

  function eventDetail(e) {
    const m = e.metadata || {};
    if (e.event === 'item_clicked') {
      return `<strong>${escape(m.item_title || m.item_id || 'unknown item')}</strong>`;
    }
    if (e.event === 'card_rendered') {
      const trigger = m.trigger || 'cold_open';
      const count = m.entry_count != null ? ` · ${m.entry_count} items shown` : '';
      return `<span class="muted">${escape(trigger)}${count}</span>`;
    }
    if (e.event.startsWith('configure_')) {
      return `<span class="muted">${escape(e.event)}</span>`;
    }
    return `<span class="muted">${escape(e.event)}</span>`;
  }

  const timelineRows = d.events.length
    ? d.events
        .map((e) => `
        <tr class="timeline-row">
          <td>${eventPill(e.event)}</td>
          <td>${eventDetail(e)}</td>
          <td class="num"><span class="muted">${dt(e.at)}</span></td>
        </tr>`)
        .join('')
    : `<tr><td colspan="3" class="muted-cell">No events for this user in the last ${d.periodDays} days.</td></tr>`;

  return `<!doctype html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escape(u.name || u.email || u.contactId)} — Loop analytics</title>
<style>${sharedStyle}</style>
</head>
<body>
<div class="container">
  <div class="sub"><a href="/admin/analytics/${encodeURIComponent(workspaceId)}?format=html&days=${d.periodDays}${tokenSuffix}${piiSuffix}${themeSuffix}">← All analytics</a></div>
  <h1>${u.name ? escape(u.name) : '<span class="muted">Unnamed visitor</span>'}</h1>
  <div class="sub">${u.email ? `<span class="email">${escape(u.email)}</span> · ` : ''}${escape(u.type || 'visitor')}${d.user.shop ? ` · ${shopCell(d.user.shop)}` : ''} · Last ${d.periodDays} days</div>
  <div class="ws-pill">${escape(workspaceId)}</div>

  <div class="toolbar">
    <div class="range-nav">
      <a class="${d.periodDays === 30  ? 'active' : ''}" href="?format=html&days=30${tokenSuffix}${piiSuffix}${themeSuffix}">30 days</a>
      <a class="${d.periodDays === 90  ? 'active' : ''}" href="?format=html&days=90${tokenSuffix}${piiSuffix}${themeSuffix}">90 days</a>
      <a class="${d.periodDays === 365 ? 'active' : ''}" href="?format=html&days=365${tokenSuffix}${piiSuffix}${themeSuffix}">1 year</a>
    </div>
    <div class="toolbar-right">
      <a class="toggle toggle--off" href="?format=html&days=${d.periodDays}${tokenSuffix}${piiSuffix}${themeToggleSuffix}">
        ${themeLabel}
      </a>
      <a class="toggle ${showPii ? 'toggle--on' : 'toggle--off'}"
         href="?format=html&days=${d.periodDays}${tokenSuffix}${themeSuffix}${showPii ? '' : '&show_pii=1'}">
        ${showPii ? '🔓 Hide identities' : '🔒 Show full identities'}
      </a>
    </div>
  </div>

  ${showPii ? `
  <div class="pii-banner">
    ⚠ Full names and email addresses are visible. Be careful with screen-shares.
  </div>` : ''}

  <div class="grid">
    <div class="kpi kpi--accent">
      <div class="kpi__label">Item clicks</div>
      <div class="kpi__value">${fmt(d.totals.clicks)}</div>
      <div class="kpi__sub">in last ${d.periodDays} days</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">Cards rendered</div>
      <div class="kpi__value">${fmt(d.totals.renders)}</div>
      <div class="kpi__sub">in last ${d.periodDays} days</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">First seen</div>
      <div class="kpi__value" style="font-size: 1rem; font-family: ui-monospace, monospace;">${dt(u.firstSeen).slice(0, 10)}</div>
      <div class="kpi__sub">${dt(u.firstSeen).slice(11, 16)} UTC</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">Last seen</div>
      <div class="kpi__value" style="font-size: 1rem; font-family: ui-monospace, monospace;">${dt(u.lastSeen).slice(0, 10)}</div>
      <div class="kpi__sub">${dt(u.lastSeen).slice(11, 16)} UTC</div>
    </div>
  </div>

  <h2>Activity timeline</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 90px;">Type</th>
        <th>Detail</th>
        <th class="num" style="width: 180px;">When</th>
      </tr>
    </thead>
    <tbody>${timelineRows}</tbody>
  </table>

  <h2>Visitor details</h2>
  <dl class="meta">
    <dt>Contact ID</dt><dd>${escape(u.contactId)}</dd>
    <dt>Name</dt><dd>${u.name ? escape(u.name) : '<span class="muted">—</span>'}</dd>
    <dt>Email</dt><dd>${u.email ? escape(u.email) : '<span class="muted">—</span>'}</dd>
    <dt>Type</dt><dd>${escape(u.type || '—')}</dd>
    <dt>Shop</dt><dd>${d.user.shop ? shopCell(d.user.shop) : '<span class="muted">—</span>'}</dd>
    ${d.user.companyName && d.user.companyName !== d.user.shop ? `<dt>Company</dt><dd>${escape(d.user.companyName)}</dd>` : ''}
  </dl>

  <div class="footer">
    Loop internal analytics ·
    <a href="?format=json&days=${d.periodDays}${tokenSuffix}${piiSuffix}">view as JSON</a> ·
    <a href="/admin/analytics/${encodeURIComponent(workspaceId)}?format=html&days=${d.periodDays}${tokenSuffix}${piiSuffix}${themeSuffix}">back to dashboard</a>
  </div>
</div>
</body>
</html>`;
}
