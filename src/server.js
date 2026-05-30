import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import {
  getChangelogs,
  getChangelogById,
  getInProgressPosts,
  validateCredentials,
} from './featurebase.js';
import { homeCanvas, detailCanvas, errorCanvas, needsSetupCanvas } from './canvas.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerAdminRoutes } from './admin-routes.js';
import { isMultiTenantEnabled, verifyCanvasKitSignature } from './intercom.js';
import { workspaceRateLimit } from './rate-limit.js';
import { initSentry, errorHandler } from './observability.js';

await initSentry();
import {
  dbAvailable,
  findTenantByWorkspace,
  saveFeaturebaseConfig,
} from './db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '..', 'assets');
const websiteDir = path.join(__dirname, '..', 'website');

const app = express();
// Trust Railway / nginx / Cloudflare X-Forwarded-* headers so req.protocol
// reports 'https' in production. Needed for absolute sheet URLs.
app.set('trust proxy', true);

// Capture raw body for HMAC verification. Intercom signs the EXACT bytes
// it sent; we need the unparsed payload to recompute the signature.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use('/assets', express.static(assetsDir, { maxAge: '7d', immutable: false }));
// Marketing site (HTML + CSS) served at /website/*. The root / handler
// also serves website/index.html for a clean landing URL.
app.use('/website', express.static(websiteDir, { maxAge: '1h' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    mock: config.mock,
    uptime: process.uptime(),
    multi_tenant: isMultiTenantEnabled(),
    db: dbAvailable(),
  });
});

// OAuth install flow for the multi-tenant App Store build. No-op when
// INTERCOM_CLIENT_ID is unset (single-tenant deploys).
registerAuthRoutes(app);
registerAdminRoutes(app);

app.get('/favicon.svg', (_req, res) =>
  res.sendFile(path.join(assetsDir, 'favicon.svg')),
);
app.get('/favicon.ico', (_req, res) =>
  res.sendFile(path.join(assetsDir, 'favicon.svg')),
);

// Root serves the marketing site's index.html. The full static site (CSS,
// privacy, terms) lives at /website/*. A symlink-style root → index keeps
// the public URL clean (loop-app.example/ instead of /website/index.html).
app.get('/', (_req, res) => {
  res.sendFile(path.join(websiteDir, 'index.html'));
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

// Per-instance configuration is stored in card_creation_options. Set by the
// Configure URL flow when a teammate adds Loop to a Messenger surface,
// returned to us on every subsequent /initialize call for that instance.
// Defaults are picked so empty/missing values reproduce current behavior —
// installers who don't change anything see Loop exactly as it is now.
function readConfig(req) {
  // Different Canvas Kit versions use different field names for the
  // persisted-config payload. Check both, prefer card_creation_options.
  const opts = req.body?.card_creation_options
    || req.body?.results
    || req.body?.input_values
    || {};
  return {
    // Toggles
    showPills: opts.show_pills !== 'false',                 // default true
    showComingNext: opts.show_coming_next === 'true',       // default false
    showFullRoadmap: opts.show_full_roadmap !== 'false',    // default true
    showComments: opts.show_comments !== 'false',           // default true
    // Counts (defaults match the original hardcoded behavior)
    collapsedCount: Number(opts.collapsed_count) || 3,
    comingNextCount: Number(opts.coming_next_count) || 3,
    // Text overrides (empty = use default in canvas builder)
    headerText: opts.header_text || '',
    comingHeaderText: opts.coming_header_text || '',
    footerLabel: opts.footer_label || '',
    footerUrl: opts.footer_url || '',
  };
}

function baseUrlFor(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// Resolve which Featurebase credentials this Canvas Kit request should use.
//
//   1. Multi-tenant mode (DB available + workspace_id in request):
//      Look up the tenant; if configured, return their credentials.
//      If found but not configured, return { needsSetup: true }.
//   2. Single-tenant mode: return null (featurebase.js will fall back to
//      env-var config).
async function resolveCredentials(req) {
  if (!dbAvailable()) return { credentials: null };

  const workspaceId =
    req.body?.workspace_id ||
    req.body?.context?.workspace_id ||
    req.body?.contact?.app_id;

  if (!workspaceId) return { credentials: null };

  const tenant = await findTenantByWorkspace(workspaceId);
  if (!tenant) {
    // Workspace ID present but no tenant row — install OAuth hasn't run yet.
    return { needsSetup: true, reason: 'not_installed' };
  }
  if (!tenant.featurebase.apiKey) {
    return { needsSetup: true, reason: 'not_configured', workspaceId };
  }
  return {
    credentials: tenant.featurebase,
    workspaceId,
  };
}

async function renderCanvas(req, res) {
  const { expanded, componentId } = readState(req);
  const config = readConfig(req);
  const baseUrl = baseUrlFor(req);

  // Tell every intermediary — Intercom's backend cache, any CDN, the browser —
  // never to reuse this response. Canvas Kit responses are personalised and
  // change based on Featurebase data; serving a stale copy = users seeing
  // entries we've intentionally hidden.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  // Configure-save click from the configure canvas → persist every field as
  // card_creation_options and acknowledge. Empty text values are stored as
  // empty strings, which readConfig() interprets as "use the default."
  if (componentId === 'save_config') {
    // Diagnostic: log the full save request so we can see what fields
    // Intercom sends and where it expects the response to live. Remove
    // once the configure flow is confirmed working.
    console.log('[loop] save_config request body:', JSON.stringify(req.body, null, 2));

    const v = req.body?.input_values || {};
    const saved = {
      show_pills: v.show_pills === 'false' ? 'false' : 'true',
      show_coming_next: v.show_coming_next === 'true' ? 'true' : 'false',
      show_full_roadmap: v.show_full_roadmap === 'false' ? 'false' : 'true',
      show_comments: v.show_comments === 'false' ? 'false' : 'true',
      collapsed_count: ['3', '5', '8'].includes(v.collapsed_count) ? v.collapsed_count : '3',
      coming_next_count: ['2', '3', '5'].includes(v.coming_next_count) ? v.coming_next_count : '3',
      header_text: (v.header_text || '').trim(),
      coming_header_text: (v.coming_header_text || '').trim(),
      footer_label: (v.footer_label || '').trim(),
      footer_url: (v.footer_url || '').trim(),
    };
    return res.send(configSavedResponse(saved));
  }

  // Resolve which tenant's Featurebase credentials to use (multi-tenant) or
  // fall back to env-var config (single-tenant). In multi-tenant mode, an
  // unconfigured tenant shows a friendly "needs setup" canvas instead of an
  // error — the configure form is where they fix it.
  const resolved = await resolveCredentials(req);
  if (resolved.needsSetup) {
    return res.send(needsSetupCanvas({ reason: resolved.reason, baseUrl }));
  }
  const credentials = resolved.credentials;

  try {
    // Item tapped — render the detail view of that entry.
    if (componentId.startsWith('item_')) {
      const entryId = componentId.slice('item_'.length);
      const entry = await getChangelogById(credentials, entryId);
      return res.send(detailCanvas(entry, { expanded, baseUrl }));
    }

    // Otherwise (cold open, see_more/show_less, back_to_home) — home view.
    // Fetch in-progress posts in parallel only if Coming Next is enabled;
    // otherwise skip the extra Featurebase round-trip.
    const [entries, inProgress] = await Promise.all([
      getChangelogs(credentials),
      config.showComingNext
        ? getInProgressPosts(credentials, { limit: config.comingNextCount })
        : Promise.resolve([]),
    ]);
    res.send(
      homeCanvas(entries, {
        expanded,
        baseUrl,
        inProgress,
        showComingNext: config.showComingNext,
        showPills: config.showPills,
        showFullRoadmap: config.showFullRoadmap,
        showComments: config.showComments,
        collapsedCount: config.collapsedCount,
        headerText: config.headerText,
        comingHeaderText: config.comingHeaderText,
        footerLabel: config.footerLabel,
        footerUrl: config.footerUrl,
      }),
    );
  } catch (err) {
    console.error('[loop] failed:', err.message);
    res.send(errorCanvas());
  }
}

// ---------------------------------------------------------------------------
// Configure flow: Intercom calls this URL when a teammate adds Loop to a
// surface (Messenger Home, etc.). The returned canvas's form values are saved
// as card_creation_options on Save, and passed back to us on every render.
// ---------------------------------------------------------------------------
// Reusable factory for a Yes/No single-select toggle.
function toggle(id, label, value, yesText = 'Yes', noText = 'No') {
  return {
    type: 'single-select',
    id,
    label,
    value: value ? 'true' : 'false',
    options: [
      { type: 'option', id: 'true', text: yesText },
      { type: 'option', id: 'false', text: noText },
    ],
  };
}

function configureCanvas(current, { multiTenant = false, tenantFb = null } = {}) {
  const components = [
    { type: 'text', id: 'cfg_title', text: 'Loop settings', style: 'header' },
    {
      type: 'text',
      id: 'cfg_sub',
      text: 'Customize how Loop appears to your users. Leave any field blank to use the default.',
      style: 'muted',
    },
  ];

  // ─── Featurebase connection (multi-tenant only) ───
  if (multiTenant) {
    components.push(
      { type: 'spacer', id: 'cfg_fb_sp1', size: 's' },
      { type: 'divider', id: 'cfg_fb_div' },
      { type: 'spacer', id: 'cfg_fb_sp2', size: 'xs' },
      { type: 'text', id: 'cfg_h_fb', text: 'Featurebase connection', style: 'header' },
      {
        type: 'text',
        id: 'cfg_fb_help',
        text: 'Loop needs your Featurebase API key to pull roadmap and changelog data. Get yours at Featurebase → Settings → API.',
        style: 'muted',
      },
      {
        type: 'input',
        id: 'fb_api_key',
        label: tenantFb?.apiKey ? 'Featurebase API key (saved — paste a new one to replace)' : 'Featurebase API key',
        placeholder: 'fb_live_…',
        value: '',
      },
      {
        type: 'input',
        id: 'fb_category',
        label: 'Filter to category (optional, e.g. "Kiwi")',
        placeholder: 'leave blank to show all',
        value: tenantFb?.category || '',
      },
    );
  }

  // ─── Sections ───
  components.push(
    { type: 'spacer', id: 'cfg_sp1', size: 's' },
    { type: 'divider', id: 'cfg_div1' },
    { type: 'spacer', id: 'cfg_sp1b', size: 'xs' },
    { type: 'text', id: 'cfg_h_sec', text: 'Sections', style: 'header' },
    toggle('show_pills', 'Show colored pill badges', current.showPills),
    toggle('show_coming_next', "Show 'Coming next' section", current.showComingNext,
      'Yes — show in-progress roadmap items', 'No — only show recently shipped'),
    toggle('show_full_roadmap', "Show 'See full roadmap' button", current.showFullRoadmap),
    toggle('show_comments', 'Show comment counts on items', current.showComments),
  );

  // ─── Counts ───
  components.push(
    { type: 'spacer', id: 'cfg_sp_counts', size: 's' },
    { type: 'divider', id: 'cfg_div_counts' },
    { type: 'spacer', id: 'cfg_sp_counts2', size: 'xs' },
    { type: 'text', id: 'cfg_h_counts', text: 'Counts', style: 'header' },
    {
      type: 'single-select',
      id: 'collapsed_count',
      label: "Items shown before 'Show more'",
      value: String(current.collapsedCount || 3),
      options: [
        { type: 'option', id: '3', text: '3 items' },
        { type: 'option', id: '5', text: '5 items' },
        { type: 'option', id: '8', text: '8 items' },
      ],
    },
    {
      type: 'single-select',
      id: 'coming_next_count',
      label: "Items in 'Coming next' section",
      value: String(current.comingNextCount || 3),
      options: [
        { type: 'option', id: '2', text: '2 items' },
        { type: 'option', id: '3', text: '3 items' },
        { type: 'option', id: '5', text: '5 items' },
      ],
    },
  );

  // ─── Text overrides ───
  components.push(
    { type: 'spacer', id: 'cfg_sp2', size: 's' },
    { type: 'divider', id: 'cfg_div2' },
    { type: 'spacer', id: 'cfg_sp2b', size: 'xs' },
    { type: 'text', id: 'cfg_h_text', text: 'Text', style: 'header' },
    {
      type: 'input',
      id: 'header_text',
      label: 'Main header (default: Recently shipped)',
      placeholder: 'Recently shipped',
      value: current.headerText,
    },
    {
      type: 'input',
      id: 'coming_header_text',
      label: "'Coming next' section title (default: Coming next)",
      placeholder: 'Coming next',
      value: current.comingHeaderText,
    },
    {
      type: 'input',
      id: 'footer_label',
      label: 'Footer button label (default: See full roadmap)',
      placeholder: 'See full roadmap',
      value: current.footerLabel,
    },
    {
      type: 'input',
      id: 'footer_url',
      label: 'Footer button URL (default: your roadmap URL)',
      placeholder: 'https://...',
      value: current.footerUrl,
    },
  );

  components.push(
    { type: 'spacer', id: 'cfg_sp3', size: 's' },
    {
      type: 'button',
      id: 'save_config',
      label: 'Save settings',
      style: 'primary',
      action: { type: 'submit' },
    },
  );

  return { canvas: { content: { components } } };
}

function configSavedResponse(saved) {
  // CRITICAL: do NOT include a `canvas` field. Intercom's configure flow
  // interprets any canvas in the response as "render this content in the
  // modal" — which keeps the modal open and looks like a page refresh.
  //
  // For the save to actually persist + close the modal, the response must
  // be ONLY the options payload. Different Canvas Kit versions look for
  // the data under different keys; we send all known variants.
  return {
    card_creation_options: saved,
    results: saved,
    stored_data: saved,
  };
}

app.post('/configure', verifyCanvasKitSignature, async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const componentId = req.body?.component_id || '';
  console.log('[loop] /configure call. component_id:', componentId || '(initial load)');

  // SAVE PATH: clicking Save settings inside the configure form loops back
  // to /configure (not /submit, as some Canvas Kit versions do). Detect by
  // the component_id of our Save button and persist the options here,
  // returning NO canvas so the modal closes.
  if (componentId === 'save_config') {
    console.log('[loop] /configure save_config body keys:', Object.keys(req.body || {}));
    const v = req.body?.input_values || {};
    const saved = {
      show_pills: v.show_pills === 'false' ? 'false' : 'true',
      show_coming_next: v.show_coming_next === 'true' ? 'true' : 'false',
      show_full_roadmap: v.show_full_roadmap === 'false' ? 'false' : 'true',
      show_comments: v.show_comments === 'false' ? 'false' : 'true',
      collapsed_count: ['3', '5', '8'].includes(v.collapsed_count) ? v.collapsed_count : '3',
      coming_next_count: ['2', '3', '5'].includes(v.coming_next_count) ? v.coming_next_count : '3',
      header_text: (v.header_text || '').trim(),
      coming_header_text: (v.coming_header_text || '').trim(),
      footer_label: (v.footer_label || '').trim(),
      footer_url: (v.footer_url || '').trim(),
    };

    // Multi-tenant: persist Featurebase credentials to the DB if the
    // configure form included them. The API key is validated by making
    // a real Featurebase call before saving — bad keys are rejected.
    if (dbAvailable() && isMultiTenantEnabled()) {
      const workspaceId =
        req.body?.workspace_id ||
        req.body?.context?.workspace_id;
      const newKey = (v.fb_api_key || '').trim();
      const newCategory = (v.fb_category || '').trim();

      if (workspaceId && newKey) {
        const check = await validateCredentials({ apiKey: newKey });
        if (!check.ok) {
          // Re-render the form with an error message so the teammate can fix it.
          return res.send(
            configureCanvas(
              { ...readConfig(req), fbError: check.error },
              { multiTenant: true, tenantFb: { category: newCategory } },
            ),
          );
        }
        await saveFeaturebaseConfig({
          workspaceId,
          apiKey: newKey,
          category: newCategory,
        });
      } else if (workspaceId && newCategory) {
        // Category-only update (key already saved previously).
        await saveFeaturebaseConfig({ workspaceId, category: newCategory });
      }
    }

    return res.send(configSavedResponse(saved));
  }

  // INITIAL LOAD: teammate opened the configure modal — return the form,
  // pre-filled with whatever's currently saved.
  const opts = { multiTenant: false, tenantFb: null };
  if (dbAvailable() && isMultiTenantEnabled()) {
    const workspaceId =
      req.body?.workspace_id ||
      req.body?.context?.workspace_id;
    if (workspaceId) {
      const tenant = await findTenantByWorkspace(workspaceId);
      opts.multiTenant = true;
      opts.tenantFb = tenant?.featurebase || null;
    }
  }
  res.send(configureCanvas(readConfig(req), opts));
});

// Signature middleware short-circuits to next() in single-tenant deploys
// (INTERCOM_CLIENT_SECRET unset). In multi-tenant production it rejects any
// request not signed with our app's client secret.
// Rate limiter runs after signature so we don't count rejected unauthenticated
// requests against any tenant's quota.
app.post('/initialize', verifyCanvasKitSignature, workspaceRateLimit, renderCanvas);
app.post('/submit', verifyCanvasKitSignature, workspaceRateLimit, renderCanvas);

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

// Last-resort error handler — catches any unhandled exception thrown by
// route handlers, logs it to Sentry (if configured) + console, and returns
// 500 to the caller. Must be registered AFTER all routes.
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    const mode = config.mock ? ' (MOCK mode — no API key set)' : '';
    console.log(`Listening on ${config.port}${mode}`);
  });
}

export default app;
