# Loop → Intercom App Store launch checklist

Step-by-step guide from "Loop works for Staytuned" to "Loop is live in the
Intercom App Store and any company can install it." Work through these in
order. Each step is one focused task with the exact clicks / commands.

**Estimated total time:** ~6 hours of your work + ~5 business days of Intercom review.

---

## Pre-flight check

Before starting, confirm:

- [ ] You can see the current single-tenant Loop running at
      <https://featurebase-widget-production.up.railway.app>
- [ ] You have access to the `Zsiecinski/featurebase-widget` GitHub repo
- [ ] You can log in to your Railway dashboard
- [ ] You can log in to your Intercom workspace as an admin
- [ ] You have a credit card on file with Railway (Postgres is ~$5/mo)
- [ ] You've read `PROJECT_STATE.md` for context

---

## Phase A — Spin up the public Railway service (~30 min)

This is a SEPARATE Railway service from your current single-tenant one.
The single-tenant Staytuned production keeps running unaffected.

### A.1 — Create the project

1. Go to <https://railway.com/new>
2. Click **Deploy from GitHub repo**
3. Pick **Zsiecinski/featurebase-widget**
4. After it shows up in your dashboard, click into the service
5. Go to **Settings → Source**
6. Change **Watch Branch** from `main` to `multi-tenant`
7. Save → Railway re-deploys from the multi-tenant branch (~60s)

### A.2 — Add Postgres

1. In the same project, click **+ Add → Database → PostgreSQL**
2. Railway auto-creates the database and injects `DATABASE_URL` into your
   Loop service's env vars
3. The Loop service will auto-redeploy and `npm start` runs the migration
   on boot (creates `tenants`, `card_settings`, `tenant_events` tables)

### A.3 — Generate the encryption key

In your terminal:

```bash
openssl rand -hex 32
```

Copy the output. Then in Railway:

1. Loop service → **Variables** tab → **+ New Variable**
2. Name: `FB_ENCRYPTION_KEY`
3. Value: the hex string from `openssl`
4. Save (triggers redeploy)

**⚠️ Save this key somewhere safe.** If you lose it, every encrypted
Featurebase API key in the database becomes permanently unreadable.

### A.4 — Generate the public domain

1. Loop service → **Settings → Networking**
2. Click **Generate Domain**
3. Copy the URL (looks like `loop-public-xxxxx.up.railway.app`)
4. Verify it works:
   ```bash
   curl https://loop-public-xxxxx.up.railway.app/health
   ```
   Expected: `{"ok":true,"mock":true,"uptime":...,"multi_tenant":false,"db":true}`

   `db: true` confirms Postgres is wired up. `multi_tenant: false` is expected
   at this stage — we add the Intercom OAuth vars in the next phase.

### A.5 — Set the admin token

```bash
openssl rand -hex 32
```

Copy the output. In Railway:

1. **+ New Variable** → `ADMIN_TOKEN` → paste the value → save

This unlocks `/admin/tenants` and `/admin/events` for support investigations.
Save the token somewhere safe.

---

## Phase B — Create the public Intercom app (~30 min)

This is a SEPARATE Intercom Developer Hub app from your current Staytuned-
internal Loop. The public version goes through App Store review.

### B.1 — Create the app

1. Go to <https://app.intercom.com/a/apps/_/developer-hub>
2. Click **New app** (top right)
3. **App name**: `Loop`
4. **Workspace**: pick your workspace (this is just where Loop lives in
   Dev Hub — it can be installed in any workspace once published)
5. Click **Create app**

### B.2 — Enable OAuth

1. In the new app's left nav, click **Authentication**
2. Toggle **Use OAuth** to ON
3. **Redirect URLs**: add
   `https://loop-public-xxxxx.up.railway.app/auth/callback`
   (use your actual domain from A.4)
4. Save
5. Copy the **Client ID** and **Client Secret** that appear

### B.3 — Wire the OAuth credentials into Railway

In Railway → Loop service → Variables:

```
INTERCOM_CLIENT_ID=<from B.2>
INTERCOM_CLIENT_SECRET=<from B.2>
INTERCOM_OAUTH_REDIRECT_URI=https://loop-public-xxxxx.up.railway.app/auth/callback
```

After save + auto-redeploy, hit health again:

```bash
curl https://loop-public-xxxxx.up.railway.app/health
```

Expected: `multi_tenant: true` now.

### B.4 — Configure Canvas Kit URLs

In Intercom Dev Hub → your Loop app → **Canvas Kit**:

- **Initialize URL**: `https://loop-public-xxxxx.up.railway.app/initialize?v=1`
- **Submit URL**: `https://loop-public-xxxxx.up.railway.app/submit?v=1`
- **Configure URL**: `https://loop-public-xxxxx.up.railway.app/configure?v=1`

Tick the capability boxes for the surfaces you want Loop on (at minimum:
**Messenger Home**). Save.

### B.5 — Set the install URL

In Intercom Dev Hub → your Loop app → **Basic information**:

- **Install URL**: `https://loop-public-xxxxx.up.railway.app/auth/install`

This is where Intercom sends users when they click "Add to Intercom" from
the App Store listing.

---

## Phase C — End-to-end install test (~30 min)

Verify the OAuth + Configure + render flow works before submitting to review.

### C.1 — Install in a test workspace

The cleanest way to test multi-tenant: create a fresh Intercom test
workspace specifically for this.

1. Intercom → Settings → **Workspace** → create a new workspace
   (most Intercom plans allow at least one test workspace)
2. Switch into the test workspace
3. From your Loop's Dev Hub Basic info page → click **Install in workspace**
4. Authorize when Intercom prompts → you'll be redirected to Loop's success
   page at `/auth/callback` showing your workspace ID

### C.2 — Verify the tenant row exists

```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
  https://loop-public-xxxxx.up.railway.app/admin/tenants
```

Expected: JSON with at least one tenant entry. `featurebase.apiKeySet: false`
because you haven't configured Featurebase yet.

### C.3 — Add Loop to the test workspace's Messenger Home

1. In the test workspace: Settings → **Messenger** → **Web** → **Home**
2. Toggle to the **Users** tab (or **Visitors**, your choice)
3. Click **Add an app** → pick Loop
4. The **Configure form** appears (this is the multi-tenant version with
   Featurebase fields)
5. Paste a real Featurebase API key
6. Optionally set the Filter to category
7. Click **Save settings**

The modal should close cleanly. Loop's card now appears in the Home preview.

### C.4 — Verify Loop renders with real data

1. Open the test workspace's Messenger preview (or test it from a page where
   the Messenger is loaded)
2. The Recently Shipped card should show entries from your Featurebase

If you see "Loop needs setup" instead, the FB key validation failed during
save. Check Railway logs for the error message.

### C.5 — Test uninstall

1. In the test workspace: Settings → Apps → find Loop → **Uninstall**
2. Verify the tenant row was marked uninstalled:
   ```bash
   curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
     "https://loop-public-xxxxx.up.railway.app/admin/tenants?uninstalled=true"
   ```
3. Verify `/admin/events` shows the uninstall event:
   ```bash
   curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
     https://loop-public-xxxxx.up.railway.app/admin/events
   ```

---

## Phase D — Customer-facing materials (~2 hrs)

### D.1 — Fill in privacy and terms placeholders

Edit on the `multi-tenant` branch (so the deployed version updates):

**`PRIVACY_POLICY.md`** and **`website/privacy.html`**:
- Replace `[YOUR COMPANY NAME]` with your registered company name
- Replace `[YOUR CONTACT EMAIL]` with your real support email
- Replace `[YOUR JURISDICTION]` with where your company is registered
  (e.g., "Delaware, USA" or "Ontario, Canada")
- Replace `[YOUR ADDRESS]` with your business address
- Replace `[DATE BEFORE PUBLISHING]` with today's date

**`TERMS.md`** and **`website/terms.html`**:
- Same placeholders + pick which **Fees** block applies (Free or Paid)

Commit and push. Railway auto-redeploys with the updated content.

**⚠️ Strongly consider having a lawyer review** before publishing. Loop
templates are a starting point, not legal advice.

### D.2 — Set up a support email

You have options:

- **Cheapest**: a Google Workspace email (`support@yourdomain.com`),
  $6/user/mo, takes 15 min to set up. Auto-forward to your personal inbox.
- **Free**: an alias on your existing email if your provider supports it
- **Productized**: Front, Help Scout, etc. — overkill for v1

Whatever you pick, update the address in:
- `PRIVACY_POLICY.md`, `TERMS.md`
- `website/privacy.html`, `website/terms.html`, `website/docs.html`
- `website/index.html` (footer)
- `APP_STORE_LISTING.md` (support email field)

Commit and push.

### D.3 — Take 5 marketing screenshots

The APP_STORE_LISTING.md has the shot brief. You have two ways to capture them:

**Option A: Real Messenger** (more authentic, slower)

1. In your test workspace, configure Loop with various states
2. Open the Messenger on a page where it's loaded
3. Use the browser's screenshot tool or a tool like CleanShot
4. Resize/crop to 2560×1600 for retina, or 1280×800 for standard
5. Add the tagline overlays in any image editor (or skip overlays — they're optional for App Store)

**Option B: CSS mockups** (faster, pixel-perfect, less authentic)

1. Open `https://loop-public-xxxxx.up.railway.app/website/mockups.html`
   in Chrome
2. Open DevTools → Toolbar → "Device toolbar"
3. Set Device Pixel Ratio to 2 (for retina) or 3 (for 3x)
4. Use DevTools' "Capture node screenshot" on each `<figure class="shot">`
5. You get retina-quality PNGs ready to upload

Recommended: Option A for the hero shot, Option B for the rest. The hero
needs to look real; the others can be branded mockups.

### D.4 — Pricing decision

Final call to make:

| Choice | Notes |
|---|---|
| **Free** (recommended for v1) | Easiest review approval, maximizes installs, no payment infrastructure needed |
| **Paid via Intercom** | Intercom handles billing, takes ~20% cut. Set a flat monthly price ($9–29 is typical for niche apps) |
| **Free + paid upgrades** | Most complex. Probably skip for v1. |

Whatever you pick, update:
- `APP_STORE_LISTING.md` (Pricing section + the long description)
- `TERMS.md` (Fees section)
- `website/index.html` (Pricing card)

### D.5 — Optional: custom domain

`loop-public-xxxxx.up.railway.app` is functional but unbranded. Options:

- Buy `loop.app` or similar via Namecheap/Cloudflare (~$15-50/yr for nice TLDs)
- Use a subdomain of an existing domain you own (`loop.yourdomain.com`, free)
- Skip — Railway domain works but looks DIY

If you buy a domain:

1. Railway → Loop service → Settings → Networking → **+ Custom Domain**
2. Add your domain → Railway shows you a CNAME target
3. In your DNS provider, create the CNAME record pointing at the Railway target
4. Wait for SSL provisioning (~5 min)
5. Update `INTERCOM_OAUTH_REDIRECT_URI` to use the new domain
6. Update Intercom Dev Hub's Authentication redirect URL to match
7. Update Intercom Canvas Kit URLs to use the new domain
8. Bump the `?v=N` query param on all Canvas Kit URLs to bust cache

---

## Phase E — Submit to Intercom for review (~30 min + 5 days waiting)

### E.1 — Fill out the App Store listing

In Intercom Dev Hub → your Loop app → **App Store listing**:

Use the content from `APP_STORE_LISTING.md`:

- App name: **Loop**
- Tagline: from the doc
- Short description: from the doc
- Long description: from the doc (paste, then edit company-specific bits)
- Category: **Customer Feedback** (or Help Desk if not available)
- Icon: upload `assets/logo-256.png` (the coral infinity)
- Screenshots: upload your 5 shots from D.3
- Support email: yours from D.2
- Documentation URL: `https://<your-domain>/website/docs.html`
- Privacy policy URL: `https://<your-domain>/website/privacy.html`
- Terms of service URL: `https://<your-domain>/website/terms.html`

### E.2 — Verify OAuth scopes

In **Authentication** → scopes requested:

- `read_admins` — to identify the installing admin for support contact
- `read_app` — to get the workspace ID

Don't request conversation/contact scopes. Loop doesn't read those, and
requesting them slows down review.

### E.3 — Test one more time

Before submitting, do a final fresh install in a new test workspace and
verify the entire flow:

1. Click your Install URL
2. OAuth authorization
3. Land on success page
4. Add to Messenger Home
5. Configure → paste FB key → save
6. Card renders
7. Tap an item → detail view appears
8. Back → returns to list
9. Uninstall → tenant marked uninstalled

### E.4 — Click Submit

In Intercom Dev Hub → your Loop app → **Submission**:

- Tick the agreement boxes
- Click **Submit for review**

You'll get an email confirming submission. Review typically takes 5 business
days. Intercom may:

- Approve as-is → Loop appears in the App Store
- Request changes (usually small — wording, screenshot composition, data
  handling clarity)

Be responsive to their messages. Each round of feedback is typically 1-2
days to address + 2-3 days for re-review.

---

## Phase F — Post-launch (ongoing)

### F.1 — Monitor

Watch Railway HTTP logs in the first week. Look for:

- Install rate (`POST /auth/callback` lines)
- Configure save rate (`POST /configure` with `component_id=save_config`)
- Render rate (`POST /initialize` and `/submit`)
- Error rate (anything 500)

If you set up Sentry (optional — add `SENTRY_DSN` env var + `npm install
@sentry/node`), errors will go there too.

### F.2 — Respond to support

Set up a routine for the support email. First-week installs may have
questions about:

- "Where do I find my Featurebase API key" (point at docs)
- "Can I customize X" (check the Configure form options)
- "It says 'Loop needs setup' — what now?" (point at docs troubleshooting)

### F.3 — Iterate

Once you have real install data, look at:

- Configure form completion rate (installs → configured-and-rendering)
- Most-changed Configure setting (where are people customizing?)
- Common support questions (what's not in the docs?)

This is the actual product feedback loop. The features built in Phases 1-4
were guesses; this data tells you what to build next.

---

## Quick reference: what env vars do I need on Railway?

```bash
# Required for multi-tenant
DATABASE_URL=<auto-injected by Railway Postgres plugin>
FB_ENCRYPTION_KEY=<openssl rand -hex 32>
INTERCOM_CLIENT_ID=<from Intercom Dev Hub Authentication tab>
INTERCOM_CLIENT_SECRET=<from same place>
INTERCOM_OAUTH_REDIRECT_URI=https://<your-domain>/auth/callback

# Recommended
ADMIN_TOKEN=<openssl rand -hex 32>     # unlocks /admin/* support endpoints
RATE_LIMIT_PER_MINUTE=120              # default is fine for v1

# Optional
SENTRY_DSN=                            # error reporting
SENTRY_TRACES_SAMPLE_RATE=0            # tracing
NODE_ENV=production                    # disables debug niceties
```

---

## Troubleshooting common launch issues

### "/health shows multi_tenant: false even though I set INTERCOM_CLIENT_ID"

Check `INTERCOM_CLIENT_SECRET` is also set. Both are required for
multi-tenant to enable.

### Install redirects to a "no code in callback" error

The Intercom Dev Hub redirect URL doesn't exactly match
`INTERCOM_OAUTH_REDIRECT_URI`. They have to be identical — including
trailing slashes, http vs https, etc.

### Loop card shows "Loop needs setup" even after Configure save

Featurebase API key validation failed during save. Check Railway HTTP logs
for the error. Common causes: typo in the key, key revoked, Featurebase
plan doesn't include API access.

### Configure form opens but doesn't include Featurebase fields

`dbAvailable()` is returning false even though Postgres is plugged in. Check
that `DATABASE_URL` is actually injected (look at the service's Variables
tab — should show `DATABASE_URL` with a value reference to Postgres).

### Signature verification 401s for every request

`INTERCOM_CLIENT_SECRET` is set but doesn't match the actual app's client
secret in Dev Hub. Recopy from Authentication tab.

### Privacy/Terms placeholder text is showing in production

You committed the file but forgot to push, or you edited the wrong file
(there are two: the markdown source and the website HTML version). Both
need to be updated.

### Intercom review feedback says "data handling isn't clear"

The privacy policy is too generic. Reviewers want specifics: exactly what
data, exactly where stored, exactly retention period, exactly deletion
process. Be concrete, not boilerplate.

---

## Done?

When all the boxes above are ticked and Intercom has approved:

1. Update `CHANGELOG.md` with a `[1.0.0]` release section
2. Tag the release in git: `git tag -a v1.0.0 -m "Public launch"`
3. Update `PROJECT_STATE.md` to reflect launched status
4. Tell your customer base, post on relevant subreddits / Twitter, etc.

🎉 You're live in the Intercom App Store.
