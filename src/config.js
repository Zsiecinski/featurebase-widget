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
    // Optional. Restricts the changelog feed to one category by name.
    // The Featurebase /v2/changelogs API filters by category name string,
    // e.g. "Kiwi Size Chart & Recommender". Substring partial-matches are
    // NOT supported server-side here (unlike the old board lookup); pass the
    // category name exactly as it appears in Featurebase.
    // Empty = show every live changelog entry across all categories.
    // Accepts the deprecated FEATUREBASE_BOARD name for migration.
    // Lazy getter so tests can mutate process.env between calls.
    get category() {
      return (
        process.env.FEATUREBASE_CATEGORY ||
        process.env.FEATUREBASE_BOARD ||
        ''
      );
    },
  },
  roadmapUrl:
    process.env.ROADMAP_URL ||
    'https://staytuned.featurebase.app/roadmap/kiwi-sizing',
  maxItems: Number(process.env.MAX_ITEMS) || 8,
  mock: process.env.FEATUREBASE_MOCK === 'true' || apiKey === '',
};
