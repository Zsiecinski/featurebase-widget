import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getDonePosts } from './featurebase.js';
import { doneCanvas, errorCanvas } from './canvas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '..', 'assets');

const app = express();
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
  res.json({
    ok: true,
    mock: config.mock,
    uptime: process.uptime(),
  });
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
      max-width: 520px;
      width: 100%;
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
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      font-weight: 500;
      padding: 0.375rem 0.75rem;
      border-radius: 999px;
      background: ${modeColor}1a;
      color: ${modeColor};
      margin-bottom: 1.5rem;
    }
    .status::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${modeColor};
    }
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
      <div><code>POST /submit</code> &middot; Canvas render</div>
      <div><code>GET /health</code> &middot; Uptime check</div>
    </div>
  </main>
</body>
</html>`);
});

async function renderDoneCanvas(_req, res) {
  try {
    const posts = await getDonePosts();
    res.send(doneCanvas(posts));
  } catch (err) {
    console.error('[featurebase] failed:', err.message);
    res.send(errorCanvas());
  }
}

app.post('/initialize', renderDoneCanvas);
app.post('/submit', renderDoneCanvas);

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    const mode = config.mock ? ' (MOCK mode — no API key set)' : '';
    console.log(`Listening on ${config.port}${mode}`);
  });
}

export default app;
