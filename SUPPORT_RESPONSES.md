# Loop — support response templates

Pre-written replies for common support requests. Customize the
specifics, but the structure handles 80% of inquiries Loop will get
in the first 90 days post-launch.

**Response time goal:** within 1 business day. The footer in every email
should remind people of the support address: `support@kbpulse.com`.

**Tone:** friendly, direct, action-oriented. No fluff. We're an indie
SaaS competing on care — every email should feel personal.

---

## 1. "Loop card is showing 'Loop needs setup'"

> Hi [Name],
>
> Thanks for reaching out — happy to get this fixed quickly.
>
> "Loop needs setup" means the Featurebase API key check failed during Configure save. Two most common causes:
>
> 1. The key in the Configure form is empty (Loop never received it) — please re-open the form via **Messenger → Spaces → Home → Loop → Settings** and confirm the API key field is filled.
>
> 2. The key was rejected when Loop tested it against Featurebase. Common reasons: typo, the key was revoked/rotated, or the Featurebase plan doesn't allow API access.
>
> Quick test: grab a fresh API key from **Featurebase → Settings → API**, paste it into Loop's Configure form, hit Save. If it still fails, send me the error message Loop shows in the form (don't send the key itself).
>
> If the form looks right but the card still shows "needs setup," send me your Intercom workspace ID (find it in Intercom Settings → Workspace data) and I'll look at the server-side logs.
>
> — Zach
> support@kbpulse.com

---

## 2. "Where do I find my Featurebase API key?"

> Hi [Name],
>
> Easy one — Featurebase keeps API keys at:
>
> **Featurebase admin → Settings → API → Generate API Key**
>
> You'll need to be a Featurebase admin in your org to see this section. The key looks like `fb_live_...` and is shown only once when generated — copy it immediately and paste it into Loop's Configure form.
>
> If your Featurebase plan doesn't include API access, the section may be hidden. Most paid plans support it; free trials and starter plans sometimes don't.
>
> Let me know if anything's confusing and I'll walk you through it.
>
> — Zach
> support@kbpulse.com

---

## 3. "Loop shows old data — when do changes appear?"

> Hi [Name],
>
> Loop pulls live from Featurebase every time a customer opens the Messenger — but Intercom caches Canvas Kit responses per-workspace for 15-30 minutes, so changes can take a bit to surface.
>
> Three ways to force a refresh:
>
> 1. Hard-refresh the page where the Messenger is loaded (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac)
> 2. Open the Messenger from a different browser with the same login — fresh cache
> 3. Wait it out — Intercom's TTL usually clears within 30 minutes
>
> If changes still don't appear after an hour, something else is going on — send me your workspace ID and I'll dig into the logs.
>
> — Zach
> support@kbpulse.com

---

## 4. "My Loop card is empty — no items showing"

> Hi [Name],
>
> Three things to check, in order of likelihood:
>
> 1. **Do you have published changelog entries?** Loop pulls from your Featurebase *changelog* (not the roadmap Done column). Visit `https://<your-org>.featurebase.app/changelog` in an incognito window — if it's empty there, Loop will be too.
>
> 2. **Is your category filter blocking everything?** If Loop's Configure form has a category filter set, it only shows entries tagged with that category. Try removing the filter to confirm entries exist, then narrow back down.
>
> 3. **Are entries marked "Hide from changelog board / widget embeds"?** Loop respects that flag. If your entries have it set, they won't appear in Loop (same as on your public board).
>
> If none of those explain it, send me your workspace ID and I'll check the server logs to see what Featurebase is returning.
>
> — Zach
> support@kbpulse.com

---

## 5. "Can I customize Loop's colors / branding?"

> Hi [Name],
>
> Great question — and the honest answer: not yet, but it's high on the roadmap.
>
> Currently Loop uses our coral brand colors on the card. Custom branding (your workspace's colors, your logo on the card header) is planned for our Pro tier, which we're launching around Q3 2026.
>
> If custom branding would change whether you'd pay for Pro, please tell me — we prioritize what installers actually ask for. Email back with what you'd want it to look like (colors, logo treatment) and we'll factor it in.
>
> In the meantime, Loop's `header_text` field in the Configure form lets you change the card's header label, which is a partial workaround.
>
> — Zach
> support@kbpulse.com

---

## 6. "Does Loop read my customer data / conversations?"

> Hi [Name],
>
> No, and I want to be clear on this since it's a real concern.
>
> Loop only ever calls one Intercom API endpoint: `/me`, once during install, to fetch the installing admin's email for support contact. Loop's source code does NOT call the conversations endpoint, the users endpoint, the companies endpoint, or any other read-data endpoint.
>
> You may have noticed that Intercom's OAuth authorize screen showed scopes for "Read users and companies" and "Read conversations" — those are platform defaults that Intercom auto-requires for any Canvas Kit app. They cannot be unchecked. Per Intercom's own docs: *"If your app utilizes Canvas Kit, certain permissions are required by default... and cannot be deselected."*
>
> Loop holds those grants but never uses them. Our full data handling disclosure is at https://loop.kbpulse.com/website/privacy.html
>
> If you'd like to verify in code, our repository is private right now but I can share specific snippets. Happy to.
>
> — Zach
> support@kbpulse.com

---

## 7. "Can I cancel / uninstall / delete my data?"

> Hi [Name],
>
> Yes, anytime.
>
> **To uninstall:** Intercom → Settings → Apps → find Loop → Uninstall. We mark your tenant as uninstalled the moment that webhook fires.
>
> **Data retention:** uninstalled tenants are kept for 90 days for easy reinstallation (you don't have to re-enter your Featurebase key if you change your mind within that window). After 90 days, the row is permanently deleted.
>
> **Immediate deletion (GDPR Article 17):** if you want your data purged immediately without the 90-day window, reply to this email with your Intercom workspace ID and I'll confirm deletion within 7 business days.
>
> No hard feelings — and if there's anything specific that drove the uninstall (something missing, something broken, pricing), I'd genuinely love to hear it. Feedback shapes what we build next.
>
> — Zach
> support@kbpulse.com

---

## 8. "Are you adding [feature X]?"

> Hi [Name],
>
> Great suggestion — and good timing, we're in the first month post-launch and very much listening.
>
> [If feature is on the roadmap]:
> Yes — [feature X] is in the [Planned / In progress / Exploring] section of our public roadmap: https://loop.kbpulse.com/website/roadmap.html
> Expected timeframe: [be honest — "next 30-60 days" / "Q3 ish" / "not committed but on the list"]
>
> [If feature is NOT on the roadmap]:
> Not in the immediate roadmap, but I'd love to understand the use case. Could you tell me:
> 1. What problem would [feature X] solve for your team?
> 2. Roughly how often would you use it (daily / weekly / occasionally)?
> 3. If we built it, would it move Loop from "free tool I use" to "paid tool I pay for"?
>
> Honest answers shape our priorities — we're explicitly building toward the things customers will pay for, not the things that sound cool.
>
> — Zach
> support@kbpulse.com

---

## 9. "Loop just stopped working — was working yesterday"

> Hi [Name],
>
> Sorry about that. Let me investigate.
>
> Could you send:
>
> 1. Your Intercom workspace ID
> 2. Approximate time you noticed it stopped (today, yesterday morning, etc.)
> 3. What you see now (blank card? "Loop needs setup"? error message? card showing old data?)
> 4. Did you (or your team) make any changes recently — rotate the Featurebase API key, change Featurebase plan, change Intercom settings?
>
> I'll dig into our server logs and the relevant timeframe and get back to you within a few hours.
>
> — Zach
> support@kbpulse.com

---

## 10. "Is Loop free forever, or will you charge later?"

> Hi [Name],
>
> Honest answer: free at launch, paid Pro tier coming in Q3 2026.
>
> Our plan:
>
> - **Free** (current) — full Loop functionality. We're collecting install + engagement data through our first 90 days.
> - **Pro** (~Q3) — adds Loop Analytics dashboard, custom branding, multi-product/category support. ~$19-29/mo per workspace, billed via Intercom.
> - **Existing free users** — grandfathered. You'll get Pro features free for at least 6 months as a thank-you for installing early. We'll give 30+ days notice before any pricing change.
>
> If you have strong opinions on what Pro should include or what price point makes sense, please share — we're explicitly trying to build a tier people will gladly pay for, not a feature wall.
>
> — Zach
> support@kbpulse.com

---

## How to use this file

1. When you get a support email, find the closest template above
2. Copy it into your reply, swap `[Name]` and any other placeholders
3. Adjust the tone for the specific person (founder vs. CS manager vs. junior dev)
4. Add anything specific you learned from looking at their workspace

After ~10 real responses, you'll have a clearer sense of what comes up
most. Update this file with new templates as patterns emerge — and
remove templates that never get used.

## Tracking what gets asked

In your support inbox, add a label/tag for each template you use
(`needs-setup`, `api-key`, `cache`, `empty`, etc.). After 30 days,
sort by frequency. The top 3 reveal what to put in your docs FAQ.
