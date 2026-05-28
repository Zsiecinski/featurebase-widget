// Used when FEATUREBASE_API_KEY is empty or FEATUREBASE_MOCK=true.
// Lets you wire up Intercom and iterate on the Canvas without the real API key.

const day = 86400 * 1000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

export const mockChangelogs = [
  {
    id: 'mock_c1',
    title: 'Drag-and-drop size chart editor',
    url: 'https://staytuned.featurebase.app/changelog/mock-drag-drop',
    date: iso(2 * day),
    commentCount: 4,
    categories: ['Kiwi Size Chart & Recommender'],
    state: 'live',
  },
  {
    id: 'mock_c2',
    title: 'Front-end app localization (5 new languages)',
    url: 'https://staytuned.featurebase.app/changelog/mock-localization',
    date: iso(9 * day),
    commentCount: 2,
    categories: ['Kiwi Size Chart & Recommender'],
    state: 'live',
  },
  {
    id: 'mock_c3',
    title: 'Jewelry size chart template',
    url: 'https://staytuned.featurebase.app/changelog/mock-jewelry',
    date: iso(21 * day),
    commentCount: 0,
    categories: ['Kiwi Size Chart & Recommender'],
    state: 'live',
  },
];
