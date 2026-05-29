// OAuth routes for the multi-tenant build. Registered separately from the
// Canvas Kit routes so we can toggle on/off based on whether multi-tenant
// mode is configured (INTERCOM_CLIENT_ID + INTERCOM_CLIENT_SECRET set).
//
// Flow
// ────
//   GET  /auth/install   -> redirect installer to Intercom OAuth
//   GET  /auth/callback  -> exchange code, store tenant, render success page
//
// The install URL is what Intercom will redirect users to when they click
// "Add to Intercom" from the App Store listing.

import {
  authorizeUrl,
  exchangeCodeForToken,
  fetchInstaller,
} from './intercom.js';
import { upsertTenantOnInstall, dbAvailable } from './db/index.js';

export function registerAuthRoutes(app) {
  app.get('/auth/install', (_req, res) => {
    if (!process.env.INTERCOM_CLIENT_ID) {
      return res.status(503).send('OAuth not configured (set INTERCOM_CLIENT_ID).');
    }
    res.redirect(302, authorizeUrl());
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, error: oauthError } = req.query;
    if (oauthError) {
      return res
        .status(400)
        .type('html')
        .send(installErrorPage(`Intercom returned: ${oauthError}`));
    }
    if (!code) {
      return res.status(400).type('html').send(installErrorPage('No code in callback'));
    }
    try {
      const tokenResp = await exchangeCodeForToken(code);
      const accessToken = tokenResp.token || tokenResp.access_token;
      const workspaceId =
        tokenResp.app_id || tokenResp.workspace_id || tokenResp.app?.id_code;
      if (!accessToken || !workspaceId) {
        throw new Error('Token response missing access_token or workspace_id');
      }
      const me = await fetchInstaller(accessToken).catch(() => null);
      if (dbAvailable()) {
        await upsertTenantOnInstall({
          workspaceId,
          accessToken,
          email: me?.email,
        });
      } else {
        console.warn('[auth] DB unavailable, tenant not persisted (dev mode).');
      }
      res.type('html').send(installSuccessPage({ workspaceId, email: me?.email }));
    } catch (err) {
      console.error('[auth/callback] failed:', err.message);
      res.status(500).type('html').send(installErrorPage(err.message));
    }
  });
}

function installSuccessPage({ workspaceId, email }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Loop installed</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    body { font-family: Inter, system-ui, sans-serif; max-width: 520px; margin: 6rem auto; color: #0f172a; padding: 0 1.5rem; }
    h1 { font-size: 2rem; letter-spacing: -0.03em; margin: 0 0 1rem; }
    p { color: #475569; line-height: 1.6; }
    code { background: #f1f5f9; padding: 0.125rem 0.375rem; border-radius: 4px; font-size: 0.9em; }
    .ok { display: inline-block; background: #FB7185; color: white; padding: 0.375rem 0.75rem; border-radius: 999px; font-size: 0.875rem; font-weight: 500; margin-bottom: 1.5rem; }
  </style>
</head>
<body>
  <div class="ok">✓ Installed</div>
  <h1>Loop is connected to your Intercom workspace.</h1>
  <p>Workspace: <code>${escapeHtml(workspaceId)}</code>${email ? `<br>Admin: <code>${escapeHtml(email)}</code>` : ''}</p>
  <p>Next: go to Intercom → Messenger → Home → add the Loop app to your Home screen. Loop's Configure form will prompt you for your Featurebase API key before it can render any roadmap data.</p>
</body>
</html>`;
}

function installErrorPage(message) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Loop install error</title></head>
<body style="font-family: Inter, system-ui, sans-serif; max-width: 520px; margin: 6rem auto; color: #0f172a; padding: 0 1.5rem;">
  <h1 style="color:#dc2626">Couldn't complete Loop install</h1>
  <p>${escapeHtml(message)}</p>
  <p>Need help? <a href="mailto:support@loop.example.com">Contact support</a> with this message attached.</p>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
