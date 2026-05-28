import { config } from './config.js';
import { mockChangelogs } from './mock.js';

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fb(path, { retries = 0 } = {}) {
  const url = `${config.featurebase.baseUrl}${path}`;
  const headers = {
    Authorization: `Bearer ${config.featurebase.apiKey}`,
    'Featurebase-Version': config.featurebase.version,
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(
        url,
        { headers },
        config.featurebase.timeoutMs,
      );
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

/**
 * Fetches recent published changelog entries from Featurebase.
 *
 * /v2/changelogs is purpose-built for the "what we shipped, customer-facing"
 * use case — entries are curated, dated, and visible on the org's public
 * changelog page. Avoids the noise of /v2/posts + status=completed, which
 * leaks every internally-closed feedback item across every board.
 *
 * Category filtering is done client-side via case-insensitive substring
 * match. That way FEATUREBASE_CATEGORY="Kiwi" matches a category literally
 * named "Kiwi Size Chart & Recommender" without the user having to know
 * the exact string. We fetch a wider batch from the API and slice locally.
 */
const CLIENT_FILTER_FETCH_LIMIT = 50;

function matchesCategory(entry, needle) {
  if (!needle) return true;
  const n = needle.toLowerCase();
  const categories = entry.categories || [];
  return categories.some((c) => {
    // Featurebase docs don't specify whether `categories` is an array of
    // strings or objects. Handle both.
    const name = typeof c === 'string' ? c : c?.name || '';
    return name.toLowerCase().includes(n);
  });
}

/**
 * @param {object} [opts]
 * @param {number|null} [opts.daysBack] - If set, restrict to entries shipped
 *   within the last N days. null/0 = all time.
 */
/**
 * Look up a single changelog entry by id (or slug, per Featurebase docs).
 * Returns null if not found.
 */
export async function getChangelogById(id) {
  if (!id) return null;
  if (config.mock) {
    const { mockChangelogs } = await import('./mock.js');
    return mockChangelogs.find((e) => e.id === id) || null;
  }
  const qs = new URLSearchParams({ id });
  const data = await fb(`/v2/changelogs?${qs.toString()}`, {
    retries: config.featurebase.retries,
  });
  const list = data.data || [];
  return list[0] || null;
}

export async function getChangelogs({ daysBack = null } = {}) {
  if (config.mock) {
    // Apply the same daysBack filter to mocks so the UI behaves the same in
    // mock mode as in production.
    if (!daysBack) return mockChangelogs;
    const cutoff = Date.now() - daysBack * 86400 * 1000;
    return mockChangelogs.filter(
      (e) => !e.date || new Date(e.date).getTime() >= cutoff,
    );
  }

  const needle = config.featurebase.category;
  // When filtering client-side (category or daysBack), fetch a wider batch
  // so we don't miss matches sitting beyond the first `maxItems` rows.
  const useClientFilter = Boolean(needle) || Boolean(daysBack);
  const apiLimit = useClientFilter ? CLIENT_FILTER_FETCH_LIMIT : config.maxItems;

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

  const data = await fb(`/v2/changelogs?${qs.toString()}`, {
    retries: config.featurebase.retries,
  });
  const all = data.data || [];
  const filtered = needle
    ? all.filter((entry) => matchesCategory(entry, needle))
    : all;
  return filtered.slice(0, config.maxItems);
}
