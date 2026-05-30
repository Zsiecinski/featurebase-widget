// Admin endpoints for support and operational use. Gated by ADMIN_TOKEN env
// var — without that set, the routes return 404 (functionally disabled).
// With it set, the token must be passed as `Authorization: Bearer <token>`.
//
// Endpoints
// ─────────
//   GET /admin/tenants               List of installed tenants (summary view)
//   GET /admin/tenants/:workspace_id Tenant detail (no plaintext FB key)
//
// Use case: a customer emails support saying Loop isn't rendering. Look up
// their workspace, see when they installed, whether Featurebase was
// configured, when they last used it. Faster than asking them for screenshots.

import { findTenantByWorkspace, dbAvailable } from './db/index.js';

function requireAdminToken(req, res, next) {
  const required = process.env.ADMIN_TOKEN;
  if (!required) return res.status(404).end();
  const auth = req.get('Authorization') || '';
  if (auth !== `Bearer ${required}`) {
    return res.status(401).json({ error: 'invalid admin token' });
  }
  next();
}

export function registerAdminRoutes(app) {
  app.get('/admin/tenants', requireAdminToken, async (_req, res) => {
    if (!dbAvailable()) return res.json({ tenants: [], note: 'DB not configured' });
    // The findTenantByWorkspace function isn't a list endpoint — we'd add
    // listTenants() to db/index.js if this gets used heavily. For now,
    // return a placeholder noting that single-tenant lookup is by ID.
    res.json({
      tenants: [],
      note: 'Add listTenants() to src/db/index.js for full listing. Use /admin/tenants/:workspace_id for individual lookups.',
    });
  });

  app.get('/admin/tenants/:workspaceId', requireAdminToken, async (req, res) => {
    if (!dbAvailable()) return res.status(503).json({ error: 'DB not configured' });
    const tenant = await findTenantByWorkspace(req.params.workspaceId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    // Redact the API key — only show whether it's set, not its value.
    res.json({
      id: tenant.id,
      workspaceId: tenant.workspaceId,
      featurebase: {
        org: tenant.featurebase.org,
        category: tenant.featurebase.category,
        baseUrl: tenant.featurebase.baseUrl,
        apiKeySet: Boolean(tenant.featurebase.apiKey),
      },
      configured: tenant.configured,
    });
  });
}
