import 'dotenv/config';

const apiKey = process.env.FEATUREBASE_API_KEY || '';

export const config = {
  port: Number(process.env.PORT) || 3000,
  featurebase: {
    apiKey,
    baseUrl: process.env.FEATUREBASE_BASE_URL || 'https://do.featurebase.app',
    version: process.env.FEATUREBASE_VERSION || '2026-01-01.nova',
    timeoutMs: Number(process.env.FEATUREBASE_TIMEOUT_MS) || 5000,
    retries: Number(process.env.FEATUREBASE_RETRIES) || 2,
    // Optional. Restricts the Done list to a single Featurebase board.
    // Accepts either a board ID (24-char hex) or a board-name substring
    // (case-insensitive). Empty = show completed posts from every board.
    // Lazy getter so tests can mutate process.env between calls without
    // re-importing the module graph.
    get board() {
      return process.env.FEATUREBASE_BOARD || '';
    },
  },
  roadmapUrl:
    process.env.ROADMAP_URL ||
    'https://staytuned.featurebase.app/roadmap/kiwi-sizing',
  maxItems: Number(process.env.MAX_ITEMS) || 8,
  mock: process.env.FEATUREBASE_MOCK === 'true' || apiKey === '',
};
