# Loop — Intercom App Store listing draft

Everything you need to submit Loop for App Store review. Each section maps
1:1 to a field in Intercom Developer Hub's listing form.

---

## App name

**Loop**

(Backup if taken: *Loop for Featurebase*, *Loop Roadmap*)

## Tagline (one line, shown on listing card in App Store grid)

**Close the feedback loop in Messenger.**

Alternatives:
- Show your Featurebase roadmap to customers in chat.
- Customers see what you shipped, right inside the Messenger.

## Short description (~140 chars, shown above the fold on the listing page)

Surface your Featurebase changelog and roadmap inside the Intercom Messenger. Customers see what you shipped and what's coming next — without leaving chat.

## Long description (500–800 words, the body of the listing page)

> Replace this with your actual copy before submitting. Below is a starter
> draft hitting all the points reviewers look for.

### Why Loop exists

Most support questions start with one of two things: *"Is this fixed yet?"*
or *"Can you add this feature?"*. Your team probably ships the answers
every week — but customers never see it unless they wander to your
changelog page, which most never do.

Loop puts your Featurebase changelog and roadmap inside the Intercom
Messenger they're already in. When a customer opens the Messenger to ask
about a feature, the first thing they see is **what you just shipped that
they might have missed**, plus **what's coming next**. Half of "is this
fixed yet" tickets disappear before they're filed.

### What Loop shows

**Recently shipped section.** Pulls live entries from your Featurebase
changelog (the public-facing customer changelog, not internal "done"
posts). Filterable to a specific product line. Each entry has:

- A colored type badge (NEW / IMPROVED / FIXED)
- The feature name
- When it shipped (relative date for recent items, absolute for older)
- Comment count from your Featurebase board

Customers tap any item to see the full update inline — title, hero image,
body content with proper section formatting, link to the full Featurebase
post for comments.

**Coming next section (optional).** Show 1–5 in-progress roadmap items
right under the shipped list. Customers see what's actively being built
with an "IN PROGRESS" badge and upvote count. Builds anticipation; turns
Loop from a retrospective view into a forward-looking habit.

**See full roadmap button.** Drives qualified customers to your full
Featurebase board to upvote, comment, or submit new requests.

### How it stays in sync

Loop reads directly from the Featurebase API in real time. No syncing,
no daily jobs, no caching beyond what Intercom controls. Publish a
changelog entry in Featurebase → it appears in Loop within seconds.
Move a roadmap item to In Progress → it appears in the Coming Next
section. Update an entry's content → Loop reflects the change next
time it's opened.

Loop respects Featurebase's own visibility flags. If your team marks
an entry as "Hide from changelog board / widget embeds" in Featurebase,
Loop won't show it. The public face of your roadmap stays consistent
between your Featurebase site and your Messenger.

### Configurable per workspace

After installing, an admin connects their Featurebase API key (from
Featurebase Settings → API). Optional filter to a single category for
multi-product orgs.

Per-card display options (no developer work needed):

- Show / hide colored pill badges
- Show / hide the Coming Next section
- Show / hide comment counts
- Show / hide the "See full roadmap" footer button
- Choose how many items appear before "Show more"
- Custom header text, button label, button URL

### Privacy & data

- Your Featurebase API key is encrypted at rest with AES-256-GCM.
- No customer data from your Messenger is read or stored by Loop.
- We store only what's required for Loop to function: your Intercom
  workspace ID, the OAuth access token, and your Featurebase config.
- Uninstall any time — your data is deleted on request.

### What you'll need

- A Featurebase organization with the changelog feature enabled
- An Intercom workspace on a plan that supports Messenger apps
- 2 minutes to install and paste your Featurebase API key

---

## Category

**Customer Feedback** (primary) — or **Help Desk** if that's not available.

## Pricing

(Pick one before submitting)

- **Free** — easiest path to listing approval. Maximizes installs. No
  ongoing revenue.
- **$9/mo flat, billed via Intercom** — modest revenue, low support cost.
  Intercom takes ~20% cut.
- **$19/mo per workspace, billed via Intercom** — better revenue but
  bigger commitment to support obligations.
- **Free with paid features** — basic Loop free, e.g. Coming Next section
  + multiple products paid. Hardest to maintain.

Recommended for v1: **Free**. Validate engagement first, add pricing later
if data supports it.

## Support details

- **Support email**: `support@kbpulse.com`
- **Documentation URL**: `https://loop.kbpulse.com/website/docs.html`
- **Privacy policy URL**: `https://loop.kbpulse.com/website/privacy.html`
- **Terms of service URL**: `https://loop.kbpulse.com/website/terms.html`
- **Website URL**: `https://loop.kbpulse.com/`
- **Built by**: GrindWorks Digital (Missouri, USA)

## Screenshots required (5 images, 1280×800 or 2560×1600)

Take these against Staytuned's actual Messenger:

1. **Hero / home view** — Loop card with 3 recently shipped items, pills visible, "Show more" button visible. Title overlay: "See what shipped, right in chat."
2. **Detail / drill-down view** — A tapped entry with the back button, pill badge, title, meta line, body content, "Open on Featurebase" button. Overlay: "Full updates without leaving Messenger."
3. **Coming Next section** — Loop card scrolled to show both Recently Shipped and Coming Next sections. Overlay: "Anticipate what's coming, not just what shipped."
4. **Configure form** — Loop settings screen showing the Featurebase connection input + toggles. Overlay: "Customize everything without code."
5. **Type badges close-up** — Three list items, one of each badge color. Overlay: "Color-coded by update type."

## Marketing icon

Use `assets/logo-256.png` (the coral infinity). For App Store hero/banner,
`assets/og.png` is already 1200×630.

## App permissions / scopes

When configuring OAuth in Intercom Developer Hub, request these scopes:

- `read_admins` — to identify the installing admin for support contact
- `read_app` — to get the workspace ID

We don't request conversation/contact read or write scopes. Loop never
reads your Messenger data.

---

## Submission checklist (final, before clicking Submit)

- [ ] App icon uploaded (logo-256.png and logo-512.png)
- [ ] Listing name, tagline, descriptions filled in
- [ ] Category selected
- [ ] Pricing decided and configured (or set to Free)
- [ ] 5 screenshots uploaded
- [ ] Privacy policy URL is live and reachable
- [ ] Terms of service URL is live and reachable
- [ ] Support email forwards to someone real
- [ ] OAuth flow tested end-to-end with a fresh Intercom workspace
- [ ] Webhook signature verification confirmed working
- [ ] Documentation page is live (even a stub)
- [ ] Tested install → configure → render flow with a Featurebase test org

Expected review time: 5 business days. Reviewers may request changes
to copy, screenshots, or onboarding flow — usually small.
