# Privacy Policy

**Last updated: 2026-06-01**

This Privacy Policy describes how Loop ("we", "our", "us") collects, uses,
and discloses information when you use our Intercom Canvas Kit app
("Loop", the "Service"). Loop is operated by GrindWorks Digital. By
installing or using Loop, you agree to the practices described here.

## 1. Information we collect

### From your Intercom workspace
When you install Loop, Intercom shares the following with us via OAuth:

- Your Intercom workspace ID
- An OAuth access token (used to identify the workspace on subsequent requests)
- The installing admin's name and email (used for support contact only)

### From your configuration
When you configure Loop, you provide:

- Your Featurebase API key (encrypted at rest with AES-256-GCM)
- Optional category filter (free text)
- Display preferences (toggles, counts, labels) saved as plain text

### From your customers (none)
**Loop does not read, store, or process any messages, contacts, or
profile data from your Intercom Messenger.** When a customer opens
Loop's Canvas Kit card, we receive only metadata required by the
Canvas Kit protocol (the request workspace ID, the component the user
interacted with) to render the response. We do not log customer
identities or message content.

### Automatically collected
Standard server logs:

- HTTP request method, path, timestamp, status code, response time
- Errors and stack traces (without personal data)

Retained for 30 days for debugging and abuse prevention, then deleted.

## 2. How we use information

We use the information collected to:

- Render Loop's Canvas Kit responses (the core functionality)
- Authenticate Canvas Kit requests via HMAC signature verification
- Respond to support requests
- Investigate and prevent abuse, fraud, or security incidents
- Comply with legal obligations

We do **not**:

- Sell your data
- Share your data with advertisers
- Use your data to train AI/ML models
- Read your customers' Messenger conversations

## 3. Third parties

Loop integrates with the following services on your behalf:

- **Intercom** — to receive Canvas Kit requests and respond. Intercom's
  privacy policy: https://www.intercom.com/legal/privacy
- **Featurebase** — to fetch your changelog and roadmap data using your
  API key. Featurebase's privacy policy: https://www.featurebase.app/privacy

Loop is hosted on Railway. Our database is hosted on Railway Postgres.

## 4. Data retention and deletion

- Configuration and OAuth tokens are retained while Loop is installed in
  your workspace, plus 90 days after uninstall to allow easy reinstallation.
- Server logs are retained for 30 days.
- You may request immediate deletion of all your data by emailing
  `support@kbpulse.com`. We will confirm deletion within 7 days.

## 5. Security

- Featurebase API keys are encrypted at rest using AES-256-GCM with
  keys managed outside the database.
- All data in transit is encrypted via TLS.
- Access to production systems is limited to authorized personnel and
  logged.
- Webhook requests from Intercom are verified via HMAC-SHA256
  signature before processing.

No system is perfectly secure. In the event of a breach affecting your
data, we will notify you and the relevant authorities as required by
applicable law within the time frames mandated (typically 72 hours
under GDPR).

## 6. Your rights

Depending on your location, you may have rights to:

- Access the information we hold about you
- Correct inaccurate information
- Request deletion of your data
- Object to or restrict our processing of your data
- Receive your data in a portable format
- Withdraw consent at any time

Email `support@kbpulse.com` to exercise these rights. We will respond
within 30 days.

## 7. International transfers

Loop is operated from Missouri, USA. If you access Loop from
outside Missouri, USA, your data may be transferred to, stored
in, and processed in Missouri, USA. We rely on standard
contractual clauses or equivalent safeguards where required.

## 8. Children's privacy

Loop is not directed at children under 16 and does not knowingly
collect personal information from children. If we learn we have
collected such information, we will delete it.

## 9. Changes to this policy

We may update this policy from time to time. We will notify you of
material changes via email to the installing admin or a banner in the
Configure screen. Continued use of Loop after changes constitutes
acceptance of the updated policy.

## 10. Contact

For questions about this policy or to exercise your rights:

support@kbpulse.com
GrindWorks Digital
Missouri, USA
