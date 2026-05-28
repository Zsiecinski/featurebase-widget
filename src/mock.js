// Used when FEATUREBASE_API_KEY is empty or FEATUREBASE_MOCK=true.
// Lets you wire up Intercom and iterate on the Canvas without the real API key.

const day = 86400 * 1000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

const heroImage = 'https://featurebase-widget-production.up.railway.app/assets/logo-512.png';

export const mockChangelogs = [
  {
    id: 'mock_c1',
    title: 'Drag-and-drop size chart editor',
    url: 'https://staytuned.featurebase.app/changelog/mock-drag-drop',
    date: iso(2 * day),
    commentCount: 4,
    categories: ['Kiwi Size Chart & Recommender'],
    featuredImage: heroImage,
    markdownContent:
      '## What changed\n\nYou can now reorder size chart rows by **dragging** them. No more deleting and recreating rows just to fix a typo.\n\n## Why it matters\n\nOur top-requested feature this quarter. Saves merchants ~5 minutes per chart update.\n\n## How to use it\n\n1. Open any size chart in the editor\n2. Hover over a row to reveal the drag handle\n3. Drag and drop into the new position',
    state: 'live',
  },
  {
    id: 'mock_c2',
    title: 'Front-end app localization (5 new languages)',
    url: 'https://staytuned.featurebase.app/changelog/mock-localization',
    date: iso(9 * day),
    commentCount: 2,
    categories: ['Kiwi Size Chart & Recommender'],
    featuredImage: { url: heroImage },
    markdownContent:
      'Customers in Germany, France, Spain, Italy, and Japan can now use Kiwi in their own language. Translations applied to the size recommender widget, the size chart modal, and all email notifications.',
    state: 'live',
  },
  {
    id: 'mock_c3',
    title: 'Jewelry size chart template',
    url: 'https://staytuned.featurebase.app/changelog/mock-jewelry',
    date: iso(21 * day),
    commentCount: 0,
    categories: ['Kiwi Size Chart & Recommender'],
    markdownContent: 'New built-in template for jewelry stores — ring sizes (US/EU/UK), bracelet circumference, necklace lengths. Apply it in one click from the template gallery.',
    state: 'live',
  },
  {
    id: 'mock_c4',
    title: 'Bulk import via CSV',
    url: 'https://staytuned.featurebase.app/changelog/mock-csv',
    date: iso(45 * day),
    commentCount: 11,
    categories: ['Kiwi Size Chart & Recommender'],
    markdownContent: 'Upload a CSV of size measurements and Kiwi will turn it into a properly-formatted chart. Handles up to 1000 rows.',
    state: 'live',
  },
  {
    id: 'mock_c5',
    title: 'Recommender accuracy improvements',
    url: 'https://staytuned.featurebase.app/changelog/mock-accuracy',
    date: iso(60 * day),
    commentCount: 7,
    categories: ['Kiwi Size Chart & Recommender'],
    markdownContent: 'Updated the recommender ML model with 18 months of return-data signal. Recommendation accuracy up ~12% across apparel categories.',
    state: 'live',
  },
  {
    id: 'mock_c6',
    title: 'Shopify Markets multi-currency support',
    url: 'https://staytuned.featurebase.app/changelog/mock-markets',
    date: iso(85 * day),
    commentCount: 3,
    categories: ['Kiwi Size Chart & Recommender'],
    markdownContent: 'Kiwi now respects the active Shopify Market, swapping size units (cm/in) and currency display automatically.',
    state: 'live',
  },
];
