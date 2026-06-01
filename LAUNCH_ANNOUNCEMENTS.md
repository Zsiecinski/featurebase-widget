# Loop — launch announcement drafts

Ready-to-publish copy for the day Intercom approves Loop. Six channels
covered. Adjust dates, screenshot links, and metrics ("0 customers"
becomes "X customers" once real) as needed.

---

## 1. Indie Hackers post

> **Title:** I built a Featurebase + Intercom integration during a 2-week sprint. Here's what I learned about Canvas Kit OAuth gotchas.

Hey IH,

Quick story I think will save someone else a few hours.

I run customer-facing operations for an e-commerce app called Kiwi Sizing. We use Featurebase for our changelog and roadmap, and Intercom for in-app support. The two never talked to each other — so every time we shipped something, customers found out by accident, or asked support what was new.

Last month I built **Loop** — a Canvas Kit app that surfaces your Featurebase changelog and roadmap inside Intercom's Messenger. Customers open chat to ask "is X fixed?" and the first thing they see is what just shipped that might answer their question. We've internally watched it deflect roughly 1 in 3 "status update" tickets.

Today I shipped Loop publicly to the Intercom App Store. It's free at launch — I'll watch install + engagement data for 30 days before deciding what to charge for.

**What surprised me building this:**

1. **Intercom's OAuth token endpoint doesn't return the workspace ID.** Even though every official Intercom doc references `app_id` in the token response, the endpoint at `/auth/eagle/token` returns only `{token, access_token, token_type}`. You have to call `/me` immediately after to get the workspace ID. I lost two hours to this.

2. **All Canvas Kit apps are auto-granted "Read users", "Read conversations", and "Read companies" scopes — you cannot opt out.** Intercom's docs do mention this in one paragraph, but you only find out when you submit and the reviewer asks why a changelog widget wants conversation read access. I added a transparency note to the privacy policy explaining the scopes are granted but the code never uses them.

3. **The Intercom App Partner Program form is required for submission**, but the program itself is optional. I skipped the form thinking it was opt-in, hit "submit," got a generic "problem with submission" error with no specifics, and burned 30 minutes guessing what was wrong. Fill in honest minimum answers ("Customers: 0, Sales team: 0") and you can submit.

4. **Canvas Kit cache invalidation is per-workspace + URL.** Bump the `?v=N` query param on every URL change in Dev Hub or Intercom will keep serving the cached old config.

5. **The submission review video must clearly show the OAuth URL bar with client_id, redirect_uri, and state parameters visible for 5+ seconds.** This is non-obvious. Pause on that screen specifically.

Loop tech stack: Node.js + Express + Postgres (Railway), AES-256-GCM for at-rest tenant key encryption, HMAC-SHA256 webhook signature verification, OAuth via Intercom's standard flow. Open to questions on architecture decisions.

If you build Intercom apps, happy to share more gotchas. If you use Featurebase + Intercom and want to try Loop: **[Install link]** (free).

Cheers,
Zach (GrindWorks Digital)

---

## 2. Reddit r/SaaS post

> **Title:** Just launched a Featurebase + Intercom integration. Free. Hoping to learn from this audience about pricing tier transitions.

Hey r/SaaS,

Shipped my second SaaS today: **Loop**, a Canvas Kit app that surfaces your Featurebase changelog and roadmap inside Intercom's Messenger.

The problem it solves: customers ask "is X fixed?" or "when are you adding Y?" — and the answer is usually right there on the changelog they never visit. Loop puts it in front of them, in the chat surface they're already using.

**Why Free at launch:**

I want install + engagement data before I price it. Pre-validation paid features are guesses. Post-validation paid features are pricing for proven demand.

The plan:
- Ship Free
- 30 days of installs + interview the first 10-20 admins
- Add a Pro tier ($19-29/mo per workspace) with whatever they're asking for — probably analytics dashboard + custom branding based on competitor signals
- Grandfather existing free users into Pro for the first 6 months

**Questions for you all:**

1. For those who went Free → Paid, how did you handle the announcement? Did you give 30 days notice + a grace period? How much churn did you see?

2. Did you find Pro tier pricing was sticky at the first number you picked, or did you re-price within the first year?

3. For Intercom App Store specifically — any data on Free vs Paid install rates? I'm guessing 5-10x more installs on Free, but that's just gut.

4. What's the most valuable thing you'd want to see in a "customer-facing roadmap" tool? I have a list of candidates (analytics, custom branding, multi-product, conversation triggers, white-label) but interested in what people actually want.

Link to install: **[Install link]**
Pricing page (intentionally blank for v1): **[loop.kbpulse.com](https://loop.kbpulse.com)**

Happy to answer anything about the build, OAuth gotchas, or the launch process.

---

## 3. LinkedIn post (B2B-focused)

🚀 New launch: **Loop** is now in the Intercom App Store.

What it does: surfaces your Featurebase changelog and roadmap inside Intercom's Messenger, so customers see what shipped before they ask.

The problem we're solving:

→ Your team ships fixes and features every week.
→ Customers never see them unless they wander to your changelog page (most never do).
→ So your support team answers the same "is this fixed?" question, over and over.

Loop closes the gap. When a customer opens the Messenger, the first thing they see is what just shipped that they might have missed — plus what's coming next. Internal data from our pilot: ~30% reduction in "status update" tickets.

Free at launch, no credit card. Built on:
• Express on Railway
• Postgres for per-tenant config
• AES-256-GCM encryption for API keys at rest
• HMAC-SHA256 verified Canvas Kit webhooks
• OAuth via Intercom's standard flow

If your team uses Featurebase + Intercom, give Loop a try. I'd love feedback on what features would make this worth paying for.

🔗 Install: [App Store URL]
🔗 More: https://loop.kbpulse.com

#SaaS #ProductManagement #CustomerSuccess #Intercom #Featurebase

---

## 4. Twitter/X thread (7 tweets)

> **1/7**
> Just shipped **Loop** in the Intercom App Store. 🚀
>
> Canvas Kit app that puts your Featurebase changelog and roadmap inside the Messenger.
>
> Customers open chat to ask "is X fixed?" → they see the answer before they type. Built it because we kept answering the same status update tickets at @kiwi_sizing.
>
> Free at launch. 👇

> **2/7**
> What it shows:
>
> 📌 Recently shipped — pulls live from Featurebase. NEW / IMPROVED / FIXED pills + dates + comment counts
> 🛠 Coming next — in-progress roadmap items with upvote counts (optional)
> 📄 Tap any item → full detail view inline, no leaving chat

> **3/7**
> Architecture for the curious:
>
> • Express on Railway
> • Postgres for per-tenant config
> • AES-256-GCM encryption for FB API keys at rest
> • HMAC-SHA256 verified Canvas Kit webhooks
> • OAuth via Intercom's standard flow
>
> Code follows least-privilege: only /me is ever called on Intercom's API.

> **4/7**
> Pricing: Free at v1.
>
> I want install + engagement data before deciding what's worth paying for. Most likely Pro tier (Q3): analytics dashboard, custom branding, multi-product/category support.
>
> Existing Free users will be grandfathered. No surprise paywalls.

> **5/7**
> One Intercom Canvas Kit gotcha for anyone building:
>
> The token exchange endpoint returns only {token, access_token, token_type}. NOT app_id. You have to call /me to get the workspace ID. The official docs imply otherwise. 2 hours of my life I want back.

> **6/7**
> Another gotcha:
>
> All Canvas Kit apps are auto-granted Read users / Read conversations / Read companies scopes that you CANNOT uncheck. It's a platform default. Loop's code never calls those endpoints — privacy policy explains the platform constraint.

> **7/7**
> Try it: **[Install URL]**
> Marketing: **loop.kbpulse.com**
> Built by: @GrindWorksDigital
>
> Feedback welcome. RTs appreciated. If your team uses both Featurebase + Intercom, this was built for you.

---

## 5. Product Hunt launch (whenever you're ready — recommend launching ~2 weeks after Intercom approval so you have install data to share)

**Tagline:** Close the feedback loop in Messenger.

**Description (260 chars):**
Loop surfaces your Featurebase changelog and roadmap inside Intercom's Messenger. Customers see what shipped before they ask. Color-coded NEW/IMPROVED/FIXED pills, inline detail views, optional "Coming next" section with upvote counts. Free at launch.

**Maker comment (first comment under your launch):**
Hey PH 👋

Built Loop because at @kiwi_sizing we kept seeing the same "is X fixed?" tickets in Intercom — and every time, the answer was already on our Featurebase changelog. Customers just don't go check changelog pages. So Loop puts the changelog inside the chat surface they're already using.

How it works:
1. Install via Intercom App Store
2. Paste your Featurebase API key in the Configure form
3. Add Loop to Messenger Home
4. Customers see your changelog the moment they open chat

We've seen ~30% of "status update" tickets deflected in our internal pilot. Free at launch — I'll add a Pro tier later once I understand what installers value most.

Roadmap I'm thinking about:
• Loop Analytics ("deflection rate" dashboard)
• Custom branding (your colors/logo)
• Multi-product / multi-category support
• Conversation triggers (auto-surface FB items when customer asks about them)

Open to feedback on what would make Loop worth paying for. Reply or DM 🙏

---

## 6. Cold outreach email template

Use for the first 10-20 manually-identified target customers: companies that publicly use both Featurebase + Intercom. Find them via Featurebase's customer page, BuiltWith, or just Twitter/LinkedIn searches.

> **Subject:** Quick question about your Featurebase changelog
>
> Hi [Name],
>
> Saw [Company] uses both Featurebase (great changelog btw) and Intercom for support. Quick question: do your customers actually find your Featurebase page, or are they asking your support team "is X fixed?" in Intercom and not realizing you already shipped it?
>
> I just launched **Loop** in the Intercom App Store — it surfaces your Featurebase changelog and roadmap right inside the Intercom Messenger. Customers see what shipped the moment they open chat.
>
> It's free, takes 2 minutes to set up, and you can remove it any time. If it deflects even a handful of "is this fixed yet?" tickets, it pays for itself.
>
> Worth a look? **[Install link]**
>
> Either way — would love feedback on what would make this kind of integration valuable for [Company] specifically. Always trying to learn from teams running real CS operations.
>
> Cheers,
> Zach
> GrindWorks Digital
> support@kbpulse.com

---

## Launch-day playbook (chronological)

Once Intercom approves:

1. **Day 0 (morning of approval)**
   - Update install link in all drafts above
   - Take a fresh screenshot of the public listing for use in posts
   - Post Indie Hackers + Reddit r/SaaS — these get most early traffic
   - Send 10-20 cold emails to identified targets
   - Twitter thread

2. **Day 1**
   - LinkedIn post (B2B audience is daytime weekday)
   - Reply to any comments on Reddit / IH from day 0
   - Send Slack/DM to founder friends asking for early installs

3. **Days 2-7**
   - Daily monitoring of `/admin/analytics/:workspace_id` for new installs
   - Reply within 1 hour to any support emails
   - Interview the first 5 installers (15 min calls, ask about pricing willingness, feature gaps)

4. **Day 14 (2 weeks post-launch)**
   - Product Hunt launch (only do this once you have real install numbers to share)
   - Round of social posts with "what we've learned" data

5. **Day 30**
   - Decide what goes in Pro tier based on data
   - Draft Pro tier announcement
   - Start building most-asked feature
