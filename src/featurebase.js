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

export async function getChangelogs() {
  if (config.mock) return mockChangelogs;

  const needle = config.featurebase.category;
  const apiLimit = needle ? CLIENT_FILTER_FETCH_LIMIT : config.maxItems;

  const qs = new URLSearchParams({
    state: 'live',
    sortBy: 'date',
    sortOrder: 'desc',
    limit: String(apiLimit),
  });

  const data = await fb(`/v2/changelogs?${qs.toString()}`, {
    retries: config.featurebase.retries,
  });
  const all = data.data || [];

  if (!needle) return all.slice(0, config.maxItems);

  const filtered = all.filter((entry) => matchesCategory(entry, needle));
  return filtered.slice(0, config.maxItems);
}
