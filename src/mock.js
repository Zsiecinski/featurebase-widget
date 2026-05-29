// Used when FEATUREBASE_API_KEY is empty or FEATUREBASE_MOCK=true.
// Lets you wire up Intercom and iterate on the Canvas without the real API key.

const day = 86400 * 1000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

const heroImage = 'https://featurebase-widget-production.up.railway.app/assets/logo-512.png';

// Categories array mirrors Featurebase's real shape: one type tag
// (New / Improved / Fixed) plus one board tag.
const BOARD = 'Kiwi Size Chart & Recommender';

export const mockInProgressPosts = [
  {
    id: 'mock_ip1',
    title: 'AI-powered size recommendations v3',
    url: 'https://staytuned.featurebase.app/p/mock-ai-v3',
    upvotes: 47,
    commentCount: 12,
  },
  {
    id: 'mock_ip2',
    title: 'Bulk size chart editor',
    url: 'https://staytuned.featurebase.app/p/mock-bulk-editor',
    upvotes: 23,
    commentCount: 4,
  },
];

export const mockChangelogs = [
  {
    id: 'mock_c1',
    title: 'Drag-and-drop size chart editor',
    url: 'https://staytuned.featurebase.app/changelog/mock-drag-drop',
    date: iso(2 * day),
    commentCount: 4,
    categories: ['New', BOARD],
    featuredImage: heroImage,
    markdownContent:
      '## What changed\n\nYou can now reorder size chart rows by **dragging** them. No more deleting and recreating rows just to fix a typo.\n\n## Why it matters\n\nOur top-requested feature this quarter. Saves merchants ~5 minutes per chart update.',
    state: 'live',
  },
  {
    id: 'mock_c2',
    title: 'Front-end app localization (5 new languages)',
    url: 'https://staytuned.featurebase.app/changelog/mock-localization',
    date: iso(9 * day),
    commentCount: 2,
    categories: ['Improved', BOARD],
    featuredImage: { url: heroImage },
    markdownContent:
      'Customers in Germany, France, Spain, Italy, and Japan can now use Kiwi in their own language.',
    state: 'live',
  },
  {
    id: 'mock_c3',
    title: 'Fixed recommender showing stale data on first load',
    url: 'https://staytuned.featurebase.app/changelog/mock-fix-stale',
    date: iso(14 * day),
    commentCount: 0,
    categories: ['Fixed', BOARD],
    markdownContent: 'The recommender widget was sometimes painting cached recommendations from the previous product. Now invalidated correctly on product change.',
    state: 'live',
  },
  {
    id: 'mock_c4',
    title: 'Jewelry size chart template',
    url: 'https://staytuned.featurebase.app/changelog/mock-jewelry',
    date: iso(21 * day),
    commentCount: 0,
    categories: ['New', BOARD],
    markdownContent: 'New built-in template for jewelry stores — ring sizes (US/EU/UK), bracelet circumference, necklace lengths.',
    state: 'live',
  },
  {
    id: 'mock_c5',
    title: 'Bulk import via CSV',
    url: 'https://staytuned.featurebase.app/changelog/mock-csv',
    date: iso(45 * day),
    commentCount: 11,
    categories: ['Improved', BOARD],
    markdownContent: 'Upload a CSV of size measurements and Kiwi will turn it into a properly-formatted chart.',
    state: 'live',
  },
  {
    id: 'mock_c6',
    title: 'Recommender accuracy improvements',
    url: 'https://staytuned.featurebase.app/changelog/mock-accuracy',
    date: iso(60 * day),
    commentCount: 7,
    categories: ['Improved', BOARD],
    markdownContent: 'Updated the recommender ML model with 18 months of return-data signal.',
    state: 'live',
  },
];
