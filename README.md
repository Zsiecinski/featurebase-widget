# featurebase-intercom

Intercom Canvas Kit Messenger app that surfaces the **Done** column of the
Staytuned Featurebase roadmap (`/roadmap/kiwi-sizing`) inside the Intercom chat
widget.

- `POST /initialize` – rendered when a user opens the app in Messenger.
- `POST /submit`     – Intercom requires this even when the app has no form.
- `GET /health`      – `{ ok, mock, uptime }` for uptime checks / Railway health.
- `GET /`            – plain-text liveness string.

Read-only for now. No DB, no submit form.

## Quick start

```bash
cd "D:/FeatureBase - Widget"
npm install
cp .env.example .env
# Leave FEATUREBASE_API_KEY blank to run in MOCK mode.
npm run dev
```

Open <http://localhost:3000/> – you should see `Kiwi Done app is running (MOCK mode).`

Hit the Canvas endpoint:

```bash
curl -X POST http://localhost:3000/initialize
```

You'll get a Canvas JSON object with three mocked "shipped" posts. When your
real `FEATUREBASE_API_KEY` arrives, drop it in `.env` and restart — the app
will switch to live data automatically.

## Tests

```bash
npm test
```

Uses the built-in `node:test` runner. No extra dev dependencies. Tests cover:

- `doneCanvas` / `errorCanvas` shape (header, per-post block, footer, empty state, error)
- `getCompletedStatusId` resolution, caching, missing-status error, retry-on-failure

Both Featurebase tests stub `globalThis.fetch` – no network is touched.

## Configuration

All config is read from environment variables (see `.env.example`):

| Var                          | Default                                       | Notes                                                   |
| ---------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| `PORT`                       | `3000`                                        | Railway injects this automatically.                     |
| `FEATUREBASE_API_KEY`        | *(empty → mock)*                              | Get from Featurebase dashboard → Settings → API.        |
| `FEATUREBASE_BASE_URL`       | `https://do.featurebase.app`                  |                                                         |
| `FEATUREBASE_VERSION`        | `2026-01-01.nova`                             | Sent as `Featurebase-Version` header.                   |
| `FEATUREBASE_TIMEOUT_MS`     | `5000`                                        | Per-request abort timeout.                              |
| `FEATUREBASE_RETRIES`        | `2`                                           | Retry count on the status-lookup call.                  |
| `FEATUREBASE_MOCK`           | `false`                                       | Force mock data. Auto-on when API key is empty.         |
| `ROADMAP_URL`                | `…/roadmap/kiwi-sizing`                       | "See full roadmap" button target.                       |
| `MAX_ITEMS`                  | `8`                                           | Max posts shown.                                        |

## Resilience

- `fetch` is wrapped in an `AbortController` honouring `FEATUREBASE_TIMEOUT_MS`.
- The status-lookup call retries `FEATUREBASE_RETRIES` times with linear backoff
  (200ms × attempt). The post-list call does not retry – Intercom expects a fast
  response, and the status id is cached after the first success anyway.
- Any error during `/initialize` or `/submit` returns `errorCanvas()` – the user
  sees a clean "Couldn't load the roadmap right now." card with a fallback
  button to the public roadmap.

## Deploy to Railway

The simplest host for this. Railway auto-detects Node via `package.json`,
injects `PORT`, and runs `npm start`.

1. **Push to GitHub.**
   ```bash
   git add .
   git commit -m "Initial Featurebase Intercom Canvas app"
   gh repo create featurebase-intercom --private --source=. --push
   ```
2. **Create the Railway project.** From the dashboard: *New Project → Deploy
   from GitHub repo → featurebase-intercom*. Or via CLI: `railway init` then
   `railway up`.
3. **Set env vars** in the Railway service → Variables tab:
   - `FEATUREBASE_API_KEY` (required to leave MOCK mode)
   - `ROADMAP_URL` (optional override)
   - Everything else can use defaults.
4. **Get the public URL.** Railway → Settings → Networking → *Generate Domain*.
   You'll get something like `https://featurebase-intercom-production.up.railway.app`.
5. **Wire up Intercom.** Developer Hub → your app → Canvas Kit, set:
   - Initialize URL: `https://<your-domain>/initialize`
   - Submit URL:     `https://<your-domain>/submit`
6. **Sanity check.**
   ```bash
   curl https://<your-domain>/health
   curl -X POST https://<your-domain>/initialize
   ```

### Alternatives if you'd rather not use Railway

- **Render** (free tier exists, similar flow — connect repo, set env vars).
- **Fly.io** (`fly launch` from the repo; needs `fly.toml`).
- **Vercel** would require refactoring the Express app into serverless functions
  — not worth it for this size of app.

## Deploy to your own VPS (no GitHub required)

Two scripts in `scripts/`:

- **`provision.sh`** — runs once on the VPS as root. Installs Node 20, Caddy
  (auto-TLS), creates a hardened `fbapp` system user, writes the systemd unit,
  configures the firewall, and grants your SSH user passwordless sudo for the
  deploy hook (and *only* the deploy hook).
- **`deploy.ps1`** — runs from Windows every time you want to push an update.
  Tars the project, scp's it up, runs the remote hook, and smoke-tests `/health`.

### One-time setup

```powershell
# 1. Point a DNS A record (e.g. intercom-canvas.example.com) at the VPS IP.
# 2. Copy provision.sh up and run it.
scp scripts/provision.sh ubuntu@your-vps:/tmp/
ssh ubuntu@your-vps "sudo DOMAIN=intercom-canvas.example.com bash /tmp/provision.sh"
```

The script is idempotent — safe to re-run if anything fails.

### Every deploy after that

```powershell
scripts\deploy.ps1 -VpsHost your-vps -User ubuntu -Domain intercom-canvas.example.com
```

That's the whole loop. Edit code → run `deploy.ps1` → done. The script bundles,
uploads, syncs (preserving `.env` and `node_modules`), runs `npm ci --omit=dev`,
restarts the service, and confirms `/health` is responding over HTTPS.

### When the Featurebase API key arrives

The first deploy lands in MOCK mode (provision wrote a placeholder `.env` with
the key blank). To go live:

```bash
ssh ubuntu@your-vps
sudo nano /opt/featurebase-intercom/.env       # set FEATUREBASE_API_KEY=...
sudo systemctl restart featurebase-intercom
curl https://intercom-canvas.example.com/health   # should now show "mock":false
```

The `.env` file lives on the server only and is **never** overwritten by
`deploy.ps1` (the rsync inside `fb-deploy-finish` excludes it explicitly).

## Project layout

```
src/
  config.js        env loading + defaults
  featurebase.js   API client (timeout + retry), status-id cache
  canvas.js        doneCanvas + errorCanvas builders
  mock.js          mock data for offline dev
  server.js        Express app, routes, logging
test/
  canvas.test.js
  featurebase.test.js
.env.example
.gitignore
package.json
```

## Notes

- The folder name contains a space (`D:\FeatureBase - Widget`). Harmless for
  Node, but quote it in shell commands. Railway sees only the repo, so the
  local folder name doesn't reach production.
- The `body-parser` dependency from the original draft was dropped — Express
  4.16+ ships `express.json()` natively.
- No submit-flow form yet (read-only Done list). When you're ready to add
  interactive components, the `/submit` handler is the entry point.
