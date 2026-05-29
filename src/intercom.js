// Intercom OAuth + Canvas Kit signature verification.
//
// Required env vars for the multi-tenant build (only in production):
//   INTERCOM_CLIENT_ID           - From Intercom Developer Hub
//   INTERCOM_CLIENT_SECRET       - From Intercom Developer Hub (DO NOT log)
//   INTERCOM_OAUTH_REDIRECT_URI  - https://<your-domain>/auth/callback
//
// If INTERCOM_CLIENT_SECRET is missing, signature verification is bypassed
// for development — but in production we always enforce it.

import crypto from 'node:crypto';

export function isMultiTenantEnabled() {
  return Boolean(
    process.env.INTERCOM_CLIENT_ID && process.env.INTERCOM_CLIENT_SECRET,
  );
}

// ---------------------------------------------------------------------------
// Canvas Kit webhook signature verification
// ---------------------------------------------------------------------------
// Intercom sends X-Body-Signature: <hex-encoded HMAC-SHA256 of raw body>
// using the app's client secret. We reject any request that fails verification
// in production. This is REQUIRED for App Store apps.
//
// Express middleware: must run after a raw-body parser that exposes req.rawBody.
export function verifyCanvasKitSignature(req, res, next) {
  // Dev-mode bypass when no secret is configured
  if (!process.env.INTERCOM_CLIENT_SECRET) {
    return next();
  }
  const signature = req.get('X-Body-Signature');
  if (!signature) {
    return res.status(401).send({ error: 'missing signature' });
  }
  const expected = crypto
    .createHmac('sha256', process.env.INTERCOM_CLIENT_SECRET)
    .update(req.rawBody || JSON.stringify(req.body))
    .digest('hex');
  if (signature !== expected) {
    return res.status(401).send({ error: 'invalid signature' });
  }
  next();
}

// ---------------------------------------------------------------------------
// OAuth: redirect users to Intercom to authorize, then exchange code for token
// ---------------------------------------------------------------------------
export function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.INTERCOM_CLIENT_ID || '',
    state: state || crypto.randomBytes(16).toString('hex'),
  });
  // The redirect URI is configured in the Intercom Developer Hub, not passed
  // here — Intercom uses the saved value automatically.
  return `https://app.intercom.com/oauth?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  if (!process.env.INTERCOM_CLIENT_ID || !process.env.INTERCOM_CLIENT_SECRET) {
    throw new Error('Intercom OAuth credentials not configured');
  }
  const r = await fetch('https://api.intercom.io/auth/eagle/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      code,
      client_id: process.env.INTERCOM_CLIENT_ID,
      client_secret: process.env.INTERCOM_CLIENT_SECRET,
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Intercom token exchange failed: ${r.status} ${txt}`);
  }
  return r.json(); // { token, token_type, app_id, ... }
}

// Fetches the installing admin's profile from Intercom (for support contact)
// using the freshly-issued access token from OAuth.
export async function fetchInstaller(accessToken) {
  const r = await fetch('https://api.intercom.io/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!r.ok) return null;
  return r.json(); // { id, email, name, app: { id_code, ... }, ... }
}
