import { config } from './config.js';
import { mockPosts, mockStatuses } from './mock.js';

let completedStatusIdCache = null;
let boardIdCache = null;

// Featurebase IDs are 24-char hex (MongoDB ObjectId). If the user pasted one
// directly into FEATUREBASE_BOARD, skip the name-lookup step.
const OBJECT_ID = /^[a-f0-9]{24}$/i;

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

export async function getCompletedStatusId() {
  if (config.mock) {
    return mockStatuses.find((s) => s.type === 'completed').id;
  }
  if (completedStatusIdCache) return completedStatusIdCache;

  const data = await fb('/v2/post_statuses', {
    retries: config.featurebase.retries,
  });
  // Per Featurebase docs, /v2/post_statuses returns a bare array — unlike
  // /v2/posts which returns { data: [...] }. Accept both shapes defensively.
  const list = Array.isArray(data) ? data : data.data || [];
  const done = list.find((s) => s.type === 'completed');
  if (!done) throw new Error("No status with type 'completed' found");
  completedStatusIdCache = done.id;
  return done.id;
}

export async function getBoardId() {
  if (config.mock) return null;
  if (!config.featurebase.board) return null;
  if (boardIdCache) return boardIdCache;

  // Already a board ID? Use it directly.
  if (OBJECT_ID.test(config.featurebase.board)) {
    boardIdCache = config.featurebase.board;
    return boardIdCache;
  }

  // Otherwise look up by name substring.
  const data = await fb('/v2/boards', {
    retries: config.featurebase.retries,
  });
  // /v2/boards returns a bare array, same shape as /v2/post_statuses.
  const list = Array.isArray(data) ? data : data.data || [];
  const needle = config.featurebase.board.toLowerCase();
  const match = list.find((b) => (b.name || '').toLowerCase().includes(needle));
  if (!match) {
    const names = list.map((b) => `"${b.name}"`).join(', ');
    throw new Error(
      `No Featurebase board matches "${config.featurebase.board}". Available: ${names}`,
    );
  }
  boardIdCache = match.id;
  return boardIdCache;
}

export async function getDonePosts() {
  if (config.mock) return mockPosts;

  const [statusId, boardId] = await Promise.all([
    getCompletedStatusId(),
    getBoardId(),
  ]);

  const qs = new URLSearchParams({
    statusId,
    sortBy: 'recent',
    sortOrder: 'desc',
    limit: String(config.maxItems),
  });
  if (boardId) qs.set('boardId', boardId);

  const data = await fb(`/v2/posts?${qs.toString()}`);
  return data.data || [];
}

export function _resetCacheForTests() {
  completedStatusIdCache = null;
  boardIdCache = null;
}
