// Used when FEATUREBASE_API_KEY is empty or FEATUREBASE_MOCK=true.
// Lets you wire up Intercom and iterate on the Canvas without the real API key.

export const mockStatuses = [
  { id: 'mock_status_open', type: 'open', name: 'Under Review' },
  { id: 'mock_status_progress', type: 'in_progress', name: 'In Progress' },
  { id: 'mock_status_done', type: 'completed', name: 'Done' },
];

export const mockPosts = [
  {
    id: 'mock_p1',
    title: 'Bulk size chart import via CSV',
    postUrl: 'https://staytuned.featurebase.app/p/mock-bulk-import',
    upvotes: 47,
    commentCount: 12,
  },
  {
    id: 'mock_p2',
    title: 'Shopify Markets multi-currency support',
    postUrl: 'https://staytuned.featurebase.app/p/mock-shopify-markets',
    upvotes: 23,
    commentCount: 4,
  },
  {
    id: 'mock_p3',
    title: 'AI-generated size recommendations v2',
    postUrl: 'https://staytuned.featurebase.app/p/mock-ai-recs-v2',
    upvotes: 89,
    commentCount: 21,
  },
];
