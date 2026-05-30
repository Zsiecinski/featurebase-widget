// Thin Postgres client + tenant repository for the multi-tenant Loop build.
// Uses `postgres` (postgres.js) — lightweight, no ORM, tagged-template SQL.
//
// Environment
// ───────────
//   DATABASE_URL          - Railway Postgres connection string. Required in
//                           production. If absent, db calls return null and
//                           upstream code falls back to single-tenant env vars.
//   FB_ENCRYPTION_KEY     - 32-byte hex string. Used to AES-GCM encrypt the
//                           per-tenant Featurebase API key at rest. NEVER
//                           checked into git. Generate with:
//                             openssl rand -hex 32

import postgres from 'postgres';
import crypto from 'node:crypto';

let sql = null;

function init() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  sql = postgres(url, {
    // Railway Postgres requires SSL; postgres.js auto-negotiates.
    ssl: process.env.PGSSLMODE === 'disable' ? false : 'require',
    max: 5,
    idle_timeout: 30,
  });
  return sql;
}

export function dbAvailable() {
  return Boolean(init());
}

// ---------------------------------------------------------------------------
// AES-GCM encryption for the Featurebase API key. We never want the
// plaintext key in our Postgres backups or row dumps.
// ---------------------------------------------------------------------------
function getKey() {
  const hex = process.env.FB_ENCRYPTION_KEY;
  if (!hex) throw new Error('FB_ENCRYPTION_KEY env var is required');
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error('FB_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }
  return buf;
}

export function encrypt(plaintext) {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as `iv:tag:ciphertext`, all hex.
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decrypt(payload) {
  if (!payload) return '';
  const [ivHex, tagHex, ctHex] = payload.split(':');
  if (!ivHex || !tagHex || !ctHex) return '';
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(ctHex, 'hex')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

// ---------------------------------------------------------------------------
// Tenant repository
// ---------------------------------------------------------------------------

export async function findTenantByWorkspace(workspaceId) {
  const s = init();
  if (!s) return null;
  const rows = await s`
    SELECT id, intercom_workspace_id, intercom_access_token,
           featurebase_org, featurebase_api_key_enc, featurebase_category,
           featurebase_base_url, configured_at, uninstalled_at
    FROM tenants
    WHERE intercom_workspace_id = ${workspaceId}
      AND uninstalled_at IS NULL
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    workspaceId: r.intercom_workspace_id,
    intercomAccessToken: r.intercom_access_token,
    featurebase: {
      org: r.featurebase_org,
      apiKey: r.featurebase_api_key_enc ? decrypt(r.featurebase_api_key_enc) : '',
      category: r.featurebase_category || '',
      baseUrl: r.featurebase_base_url || 'https://do.featurebase.app',
    },
    configured: Boolean(r.configured_at),
  };
}

export async function upsertTenantOnInstall({ workspaceId, accessToken, email }) {
  const s = init();
  if (!s) return null;
  const [row] = await s`
    INSERT INTO tenants (intercom_workspace_id, intercom_access_token, intercom_admin_email)
    VALUES (${workspaceId}, ${accessToken}, ${email || null})
    ON CONFLICT (intercom_workspace_id) DO UPDATE
      SET intercom_access_token = EXCLUDED.intercom_access_token,
          intercom_admin_email  = COALESCE(EXCLUDED.intercom_admin_email, tenants.intercom_admin_email),
          uninstalled_at        = NULL,
          updated_at            = NOW()
    RETURNING id
  `;
  await s`
    INSERT INTO tenant_events (tenant_id, event)
    VALUES (${row.id}, 'install')
  `;
  return row.id;
}

export async function saveFeaturebaseConfig({ workspaceId, org, apiKey, category, baseUrl }) {
  const s = init();
  if (!s) return null;
  await s`
    UPDATE tenants
    SET featurebase_org         = ${org || null},
        featurebase_api_key_enc = ${apiKey ? encrypt(apiKey) : null},
        featurebase_category    = ${category || null},
        featurebase_base_url    = ${baseUrl || 'https://do.featurebase.app'},
        configured_at           = COALESCE(configured_at, NOW()),
        updated_at              = NOW()
    WHERE intercom_workspace_id = ${workspaceId}
  `;
}

export async function markUninstalled(workspaceId) {
  const s = init();
  if (!s) return null;
  await s`
    UPDATE tenants
    SET uninstalled_at = NOW(), updated_at = NOW()
    WHERE intercom_workspace_id = ${workspaceId}
  `;
}

/**
 * Light list of tenants for support / admin views. Excludes plaintext FB
 * keys — only returns whether each tenant is configured. Capped + offset
 * for safety in case the table grows large.
 */
export async function listTenants({ limit = 50, offset = 0, includeUninstalled = false } = {}) {
  const s = init();
  if (!s) return [];
  const max = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const rows = includeUninstalled
    ? await s`
        SELECT id, intercom_workspace_id, intercom_admin_email,
               featurebase_org, featurebase_category, featurebase_api_key_enc,
               configured_at, last_used_at, installed_at, uninstalled_at
        FROM tenants
        ORDER BY id DESC
        LIMIT ${max} OFFSET ${off}
      `
    : await s`
        SELECT id, intercom_workspace_id, intercom_admin_email,
               featurebase_org, featurebase_category, featurebase_api_key_enc,
               configured_at, last_used_at, installed_at
        FROM tenants
        WHERE uninstalled_at IS NULL
        ORDER BY id DESC
        LIMIT ${max} OFFSET ${off}
      `;
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.intercom_workspace_id,
    email: r.intercom_admin_email,
    featurebase: {
      org: r.featurebase_org,
      category: r.featurebase_category,
      apiKeySet: Boolean(r.featurebase_api_key_enc),
    },
    installedAt: r.installed_at,
    configuredAt: r.configured_at,
    lastUsedAt: r.last_used_at,
    uninstalledAt: r.uninstalled_at || null,
  }));
}

/**
 * Recent tenant_events for support / ops visibility. Useful for spotting
 * a spike in fb_auth_failed events or unusual install rates.
 */
export async function recentEvents({ limit = 100, tenantId = null } = {}) {
  const s = init();
  if (!s) return [];
  const max = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const rows = tenantId
    ? await s`
        SELECT id, tenant_id, event, metadata, created_at
        FROM tenant_events
        WHERE tenant_id = ${tenantId}
        ORDER BY id DESC
        LIMIT ${max}
      `
    : await s`
        SELECT id, tenant_id, event, metadata, created_at
        FROM tenant_events
        ORDER BY id DESC
        LIMIT ${max}
      `;
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    event: r.event,
    metadata: r.metadata,
    at: r.created_at,
  }));
}

export async function close() {
  if (sql) await sql.end({ timeout: 5 });
  sql = null;
}
