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
 */
export async function getChangelogs() {
  if (config.mock) return mockChangelogs;

  const qs = new URLSearchParams({
    state: 'live',
    sortBy: 'date',
    sortOrder: 'desc',
    limit: String(config.maxItems),
  });
  if (config.featurebase.category) {
    qs.set('categories', config.featurebase.category);
  }

  const data = await fb(`/v2/changelogs?${qs.toString()}`, {
    retries: config.featurebase.retries,
  });
  return data.data || [];
}
