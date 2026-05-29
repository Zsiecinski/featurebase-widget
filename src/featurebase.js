import { config } from './config.js';
import { mockChangelogs } from './mock.js';

// ---------------------------------------------------------------------------
// Credentials handling
// ---------------------------------------------------------------------------
// Multi-tenant Loop passes per-tenant credentials on every call. Single-tenant
// callers can omit them — credsOrDefault() falls back to the env-var config
// so existing Staytuned behavior keeps working unchanged.
//
// Credentials shape:
//   { apiKey, baseUrl, version, timeoutMs, retries, category, maxItems }
function credsOrDefault(c) {
  if (!c || !c.apiKey) {
    return {
      apiKey: config.featurebase.apiKey,
      baseUrl: config.featurebase.baseUrl,
      version: config.featurebase.version,
      timeoutMs: config.featurebase.timeoutMs,
      retries: config.featurebase.retries,
      category: config.featurebase.category,
      maxItems: config.maxItems,
      mock: config.mock,
    };
  }
  return {
    apiKey: c.apiKey,
    baseUrl: c.baseUrl || config.featurebase.baseUrl,
    version: c.version || config.featurebase.version,
    timeoutMs: c.timeoutMs || config.featurebase.timeoutMs,
    retries: c.retries ?? config.featurebase.retries,
    category: c.category || '',
    maxItems: c.maxItems || config.maxItems,
    mock: false,  // Real credentials means real API. No mock fallthrough.
  };
}

// ---------------------------------------------------------------------------
// Low-level HTTP
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fb(creds, path, { retries = 0 } = {}) {
  const url = `${creds.baseUrl}${path}`;
  const headers = {
    Authorization: `Bearer ${creds.apiKey}`,
    'Featurebase-Version': creds.version,
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { headers }, creds.timeoutMs);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Featurebase ${res.status}: ${text}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Visibility + filtering helpers
// ---------------------------------------------------------------------------
const CLIENT_FILTER_FETCH_LIMIT = 50;

function matchesCategory(entry, needle) {
  if (!needle) return true;
  const n = needle.toLowerCase();
  const categories = entry.categories || [];
  return categories.some((c) => {
    const name = typeof c === 'string' ? c : c?.name || '';
    return name.toLowerCase().includes(n);
  });
}

// Respect Featurebase's "hide from board/widgets" flag — explicit publisher
// opt-out from public surfaces. Segment restrictions (allowedSegmentIds) are
// NOT enforced: Loop's stance is "show what was shipped, let viewers self-
// select."
function isPubliclyVisible(entry) {
  const localeKey = entry.locale || 'en';
  const note = entry.notifications?.[localeKey] || {};
  if (note.hideFromBoardAndWidgets === true) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Status ID cache — keyed by org base URL so different tenants don't clobber
// each other. Status IDs are stable for a given Featurebase org.
// ---------------------------------------------------------------------------
const statusIdCache = new Map(); // key: `${baseUrl}|${type}`

async function getStatusIdByType(creds, type) {
  const key = `${creds.baseUrl}|${type}`;
  if (statusIdCache.has(key)) return statusIdCache.get(key);
  const data = await fb(creds, '/v2/post_statuses', { retries: creds.retries });
  const list = Array.isArray(data) ? data : data.data || [];
  const match = list.find((s) => s.type === type);
  if (!match) return null;
  statusIdCache.set(key, match.id);
  return match.id;
}

// ---------------------------------------------------------------------------
// Public API — all take an optional `credentials` arg for multi-tenant mode.
// ---------------------------------------------------------------------------

/**
 * Validate a Featurebase API key by making the cheapest possible authenticated
 * call (lists statuses). Returns { ok, status, error? } so the Configure
 * handler can show inline feedback before persisting.
 */
export async function validateCredentials(credentials) {
  try {
    const creds = credsOrDefault(credentials);
    if (!creds.apiKey) return { ok: false, error: 'API key required' };
    const res = await fetchWithTimeout(
      `${creds.baseUrl}/v2/post_statuses`,
      {
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          'Featurebase-Version': creds.version,
        },
      },
      creds.timeoutMs,
    );
    if (!res.ok) {
      return { ok: false, status: res.status, error: `Featurebase rejected the key (${res.status})` };
    }
    return { ok: true, status: 200 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function getInProgressPosts(credentials, { limit = 3 } = {}) {
  const creds = credsOrDefault(credentials);
  if (creds.mock) {
    const { mockInProgressPosts } = await import('./mock.js');
    return (mockInProgressPosts || []).slice(0, limit);
  }

  const statusId = await getStatusIdByType(creds, 'active');
  if (!statusId) return [];

  const needle = creds.category;
  const useClientFilter = Boolean(needle);
  const apiLimit = useClientFilter ? 30 : limit;

  const qs = new URLSearchParams({
    statusId,
    sortBy: 'upvotes',
    sortOrder: 'desc',
    limit: String(apiLimit),
  });

  const data = await fb(creds, `/v2/posts?${qs.toString()}`, { retries: creds.retries });
  const all = data.data || [];

  const filtered = needle
    ? all.filter((p) => {
        const board = p.board?.name || p.boardName || '';
        if (board && board.toLowerCase().includes(needle.toLowerCase())) return true;
        return (p.title || '').toLowerCase().includes(needle.toLowerCase());
      })
    : all;

  return filtered.slice(0, limit).map((p) => ({
    id: p.id,
    title: p.title,
    url: p.postUrl || p.url,
    upvotes: p.upvotes || 0,
    commentCount: p.commentCount || 0,
  }));
}

export async function getChangelogById(credentials, id) {
  if (!id) return null;
  const creds = credsOrDefault(credentials);
  if (creds.mock) {
    const { mockChangelogs } = await import('./mock.js');
    return mockChangelogs.find((e) => e.id === id) || null;
  }
  const qs = new URLSearchParams({ id });
  const data = await fb(creds, `/v2/changelogs?${qs.toString()}`, { retries: creds.retries });
  const list = data.data || [];
  return list[0] || null;
}

export async function getChangelogs(credentials, { daysBack = null } = {}) {
  const creds = credsOrDefault(credentials);
  if (creds.mock) {
    if (!daysBack) return mockChangelogs;
    const cutoff = Date.now() - daysBack * 86400 * 1000;
    return mockChangelogs.filter(
      (e) => !e.date || new Date(e.date).getTime() >= cutoff,
    );
  }

  const needle = creds.category;
  const useClientFilter = Boolean(needle) || Boolean(daysBack);
  const apiLimit = useClientFilter ? CLIENT_FILTER_FETCH_LIMIT : creds.maxItems;

  const qs = new URLSearchParams({
    state: 'live',
    sortBy: 'date',
    sortOrder: 'desc',
    limit: String(apiLimit),
  });
  if (daysBack) {
    const startDate = new Date(Date.now() - daysBack * 86400 * 1000);
    qs.set('startDate', startDate.toISOString());
  }

  const data = await fb(creds, `/v2/changelogs?${qs.toString()}`, { retries: creds.retries });
  const all = data.data || [];
  const visible = all.filter(isPubliclyVisible);
  const filtered = needle
    ? visible.filter((entry) => matchesCategory(entry, needle))
    : visible;
  return filtered.slice(0, creds.maxItems);
}
