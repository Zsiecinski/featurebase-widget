import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getChangelogs, getChangelogById } from './featurebase.js';
import { homeCanvas, detailCanvas, errorCanvas } from './canvas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '..', 'assets');

const app = express();
// Trust Railway / nginx / Cloudflare X-Forwarded-* headers so req.protocol
// reports 'https' in production. Needed for absolute sheet URLs.
app.set('trust proxy', true);
app.use(express.json());
app.use('/assets', express.static(assetsDir, { maxAge: '7d', immutable: false }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, mock: config.mock, uptime: process.uptime() });
});

app.get('/favicon.svg', (_req, res) =>
  res.sendFile(path.join(assetsDir, 'favicon.svg')),
);
app.get('/favicon.ico', (_req, res) =>
  res.sendFile(path.join(assetsDir, 'favicon.svg')),
);

app.get('/', (_req, res) => {
  const mode = config.mock ? 'MOCK mode' : 'Live';
  const modeColor = config.mock ? '#F59E0B' : '#10B981';
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Loop — Featurebase Roadmap for Intercom</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Surface your Featurebase 'Done' roadmap column inside the Intercom Messenger.">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <meta property="og:title" content="Loop — Featurebase Roadmap for Intercom">
  <meta property="og:description" content="Close the feedback loop in Messenger.">
  <meta property="og:image" content="/assets/og.png">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #f5f3ff 0%, #eef2ff 100%);
      color: #0f172a;
      padding: 2rem;
    }
    @media (prefers-color-scheme: dark) {
      body { background: linear-gradient(135deg, #1e1b4b 0%, #0f0a2e 100%); color: #e2e8f0; }
      .card { background: rgba(15,23,42,0.6); border-color: rgba(148,163,184,0.15); }
      .muted { color: #94a3b8; }
      code { background: rgba(255,255,255,0.08); color: #c7d2fe; }
    }
    .card {
      max-width: 520px; width: 100%;
      background: rgba(255,255,255,0.7);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(15,23,42,0.08);
      border-radius: 24px;
      padding: 2.5rem;
      box-shadow: 0 25px 50px -12px rgba(79,70,229,0.18);
    }
    .logo { width: 80px; height: 80px; margin-bottom: 1.5rem; display: block; }
    h1 { font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; margin: 0 0 0.5rem; }
    .tagline { font-size: 1.05rem; margin: 0 0 1.75rem; opacity: 0.7; }
    .status {
      display: inline-flex; align-items: center; gap: 0.5rem;
      font-size: 0.875rem; font-weight: 500;
      padding: 0.375rem 0.75rem; border-radius: 999px;
      background: ${modeColor}1a; color: ${modeColor};
      margin-bottom: 1.5rem;
    }
    .status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: ${modeColor}; }
    .muted { color: #64748b; font-size: 0.9rem; line-height: 1.6; }
    code { background: rgba(15,23,42,0.05); padding: 0.125rem 0.375rem; border-radius: 4px; font-size: 0.85em; }
    .endpoints { margin-top: 1.25rem; font-size: 0.85rem; }
    .endpoints div { padding: 0.25rem 0; }
  </style>
</head>
<body>
  <main class="card">
    <img src="/assets/logo.svg" alt="Loop" class="logo">
    <h1>Loop</h1>
    <p class="tagline">Close the feedback loop in Messenger.</p>
    <div class="status">${mode}</div>
    <p class="muted">Intercom Canvas Kit app surfacing the Featurebase &ldquo;Done&rdquo; roadmap column inside the Messenger.</p>
    <div class="endpoints muted">
      <div><code>POST /initialize</code> &middot; Canvas render</div>
      <div><code>POST /submit</code> &middot; Re-render on tap (drill-down, back, expand)</div>
      <div><code>GET /health</code> &middot; Uptime check</div>
    </div>
  </main>
</body>
</html>`);
});

// ---------------------------------------------------------------------------
// Canvas Kit endpoints
// ---------------------------------------------------------------------------
//
// One handler serves both /initialize and /submit. Intercom uses component_id
// to tell us which UI element was tapped:
//
//   undefined       /initialize cold open -> homeCanvas
//   "see_more"      Show N more clicked -> homeCanvas expanded=true
//   "show_less"     Show less clicked   -> homeCanvas expanded=false
//   "back_to_home"  Back from detail    -> homeCanvas, preserve expanded
//   "item_<id>"     List item tapped    -> detailCanvas(entry)
//
// State (currently just `expanded`) rides through Canvas Kit's stored_data
// blob, which Intercom echoes back to us on every submit.

function readState(req) {
  const stored = req.body?.current_canvas?.stored_data || {};
  const componentId = req.body?.component_id || '';
  let expanded = stored.expanded === 'true';
  if (componentId === 'see_more') expanded = true;
  if (componentId === 'show_less') expanded = false;
  return { expanded, componentId };
}

function baseUrlFor(req) {
  return `${req.protocol}://${req.get('host')}`;
}

async function renderCanvas(req, res) {
  const { expanded, componentId } = readState(req);
  const baseUrl = baseUrlFor(req);

  // Tell every intermediary — Intercom's backend cache, any CDN, the browser —
  // never to reuse this response. Canvas Kit responses are personalised and
  // change based on Featurebase data; serving a stale copy = users seeing
  // entries we've intentionally hidden.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    // Item tapped — render the detail view of that entry.
    if (componentId.startsWith('item_')) {
      const entryId = componentId.slice('item_'.length);
      const entry = await getChangelogById(entryId);
      return res.send(detailCanvas(entry, { expanded, baseUrl }));
    }

    // Otherwise (cold open, see_more/show_less, back_to_home) — home view.
    const entries = await getChangelogs();
    res.send(homeCanvas(entries, { expanded, baseUrl }));
  } catch (err) {
    console.error('[loop] failed:', err.message);
    res.send(errorCanvas());
  }
}

app.post('/initialize', renderCanvas);
app.post('/submit', renderCanvas);

// Backward-compat fallback. An earlier Loop version used sheet actions
// pointing at /sheet/:id. Intercom's Messenger caches canvases per session,
// so users with a stale Home card may still POST here. Redirect to the
// roadmap URL — Featurebase entry pages don't render well inside the sheet
// iframe (the SPA shell shows but the entry content doesn't load), and the
// roadmap page does render correctly.
// Self-heals on next /initialize: new canvas has submit-action items that
// route through /submit + detailCanvas instead of through this fallback.
app.post('/sheet/:id', (_req, res) => {
  res.redirect(302, config.roadmapUrl);
});

// ---------------------------------------------------------------------------
// Debug endpoint — gated by DEBUG_TOKEN env var. Returns the raw
// /v2/changelogs response so we can inspect which fields Featurebase actually
// populates (isPublished, state, publishedLocales, etc.).
// Remove the DEBUG_TOKEN env var when done diagnosing to disable the route.
// ---------------------------------------------------------------------------
app.get('/debug/changelogs', async (req, res) => {
  const required = process.env.DEBUG_TOKEN;
  if (!required) {
    return res.status(404).json({ error: 'debug endpoint disabled (set DEBUG_TOKEN env var to enable)' });
  }
  if (req.query.token !== required) {
    return res.status(401).json({ error: 'invalid or missing token' });
  }

  try {
    const url = `${config.featurebase.baseUrl}/v2/changelogs?state=live&limit=20`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.featurebase.apiKey}`,
        'Featurebase-Version': config.featurebase.version,
      },
    });
    const raw = await r.json();
    const entries = raw.data || [];

    // Summary view of every entry's diagnostic fields — the ones most likely
    // to explain why the public URL is empty.
    const summary = entries.map((e) => {
      const noteEn = e.notifications?.en || e.notifications?.[e.locale] || {};
      return {
        id: e.id,
        title: e.title,
        slug: e.slug,
        url: e.url,
        date: e.date,
        state: e.state,
        isPublished: e.isPublished,
        isDraftDiffersFromLive: e.isDraftDiffersFromLive,
        publishedLocales: e.publishedLocales,
        availableLocales: e.availableLocales,
        categories: (e.categories || []).map((c) =>
          typeof c === 'string' ? c : c?.name,
        ),
        // ⚠️ Visibility flags — likely culprits for "public URL is empty"
        hideFromBoardAndWidgets: noteEn.hideFromBoardAndWidgets,
        scheduledDate: noteEn.scheduledDate,
        sendEmailNotification: noteEn.sendEmailNotification,
        allowedSegmentIdsCount: (e.allowedSegmentIds || []).length,
        commentCount: e.commentCount,
        markdownContentLength: e.markdownContent?.length || 0,
        emailSentToSubscribers: e.emailSentToSubscribers,
      };
    });

    res.json({
      meta: {
        count: entries.length,
        all_field_keys: entries[0] ? Object.keys(entries[0]).sort() : [],
      },
      summary,
      // Full raw shape of the first entry so we see every field's value.
      first_entry_raw: entries[0] || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    const mode = config.mock ? ' (MOCK mode — no API key set)' : '';
    console.log(`Listening on ${config.port}${mode}`);
  });
}

export default app;
