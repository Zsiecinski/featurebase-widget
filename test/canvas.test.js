import test from 'node:test';
import assert from 'node:assert/strict';
import { doneCanvas, errorCanvas, rangeFor, DEFAULT_TIME_RANGE, TIME_RANGES } from '../src/canvas.js';

const day = 86400 * 1000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

const sampleEntries = [
  {
    id: 'a',
    title: 'Alpha shipped',
    url: 'https://example.com/a',
    date: iso(0),
    commentCount: 5,
    categories: ['Kiwi Sizing'],
    featuredImage: 'https://example.com/a.png',
  },
  {
    id: 'b',
    title: 'Beta shipped',
    url: 'https://example.com/b',
    date: iso(3 * day),
    categories: [{ name: 'Kiwi Sizing' }],
  },
  {
    id: 'c',
    title: 'Gamma shipped',
    url: 'https://example.com/c',
    date: iso(60 * day),
    commentCount: 1,
  },
];

function componentsOf(canvas) {
  return canvas.canvas.content.components;
}

test('doneCanvas: header + smart subhead with count and range', () => {
  const out = doneCanvas(sampleEntries, { timeRange: '90d' });
  const comps = componentsOf(out);
  assert.equal(comps[0].text, 'Recently shipped');
  assert.equal(comps[1].id, 'subhead');
  assert.equal(comps[1].text, '3 features in the last 90 days.');
});

test('doneCanvas: subhead reads "feature" singular at count=1', () => {
  const out = doneCanvas([sampleEntries[0]], { timeRange: '30d' });
  assert.match(componentsOf(out)[1].text, /1 feature in/);
});

test('doneCanvas: subhead omits range when "all time"', () => {
  const out = doneCanvas(sampleEntries, { timeRange: 'all' });
  assert.equal(componentsOf(out)[1].text, '3 features shipped so far.');
});

test('doneCanvas: time-range dropdown auto-submits on change', () => {
  const out = doneCanvas(sampleEntries, { timeRange: '30d' });
  const dropdown = componentsOf(out).find((c) => c.id === 'time_range');
  assert.ok(dropdown, 'expected time_range dropdown');
  assert.equal(dropdown.type, 'single-select');
  assert.equal(dropdown.value, '30d');
  assert.equal(dropdown.action.type, 'submit');
  assert.equal(dropdown.options.length, TIME_RANGES.length);
  assert.deepEqual(
    dropdown.options.map((o) => o.id),
    TIME_RANGES.map((r) => r.id),
  );
});

test('doneCanvas: dropdown can be suppressed via showFilter:false', () => {
  const out = doneCanvas(sampleEntries, { timeRange: '30d', showFilter: false });
  assert.equal(
    componentsOf(out).find((c) => c.id === 'time_range'),
    undefined,
  );
});

test('doneCanvas: featuredImage attaches as item.image (string and object shape)', () => {
  const out = doneCanvas(sampleEntries, { timeRange: '30d' });
  const list = componentsOf(out).find((c) => c.type === 'list');
  const itemA = list.items.find((i) => i.id === 'item_a');
  assert.equal(itemA.image, 'https://example.com/a.png');
  // b has no featuredImage → image field omitted
  const itemB = list.items.find((i) => i.id === 'item_b');
  assert.equal(itemB.image, undefined);
});

test('doneCanvas: subtitle includes category badge when no category filter is active', () => {
  // No FEATUREBASE_CATEGORY set in this test process — badges should render.
  const out = doneCanvas(sampleEntries, { timeRange: '30d' });
  const list = componentsOf(out).find((c) => c.type === 'list');
  const itemA = list.items.find((i) => i.id === 'item_a');
  assert.match(itemA.subtitle, /^Kiwi Sizing · Shipped today · 5 comments$/);
  const itemB = list.items.find((i) => i.id === 'item_b');
  // object-shaped category resolves to its .name
  assert.match(itemB.subtitle, /^Kiwi Sizing · Shipped 3 days ago$/);
});

test('doneCanvas: subtitle omits category badge when FEATUREBASE_CATEGORY is set', async () => {
  process.env.FEATUREBASE_CATEGORY = 'Kiwi';
  try {
    // Re-import canvas to pick up the new env (config.featurebase.category is a
    // lazy getter, so the same import works).
    const { doneCanvas: dc } = await import(`../src/canvas.js?env=${Date.now()}`);
    const out = dc(sampleEntries, { timeRange: '30d' });
    const list = out.canvas.content.components.find((c) => c.type === 'list');
    const itemA = list.items.find((i) => i.id === 'item_a');
    assert.match(itemA.subtitle, /^Shipped today · 5 comments$/);
  } finally {
    delete process.env.FEATUREBASE_CATEGORY;
  }
});

test('doneCanvas: empty state explains current range', () => {
  const out = doneCanvas([], { timeRange: '7d' });
  const empty = componentsOf(out).find((c) => c.id === 'empty');
  assert.match(empty.text, /last 7 days/);
});

test('doneCanvas: singular comment renders correctly', () => {
  const out = doneCanvas([sampleEntries[2]], { timeRange: 'all' });
  const item = componentsOf(out).find((c) => c.type === 'list').items[0];
  assert.match(item.subtitle, /1 comment$/);
});

test('rangeFor: defaults to DEFAULT_TIME_RANGE on unknown id', () => {
  const r = rangeFor('bogus');
  assert.equal(r.id, DEFAULT_TIME_RANGE);
});

test('errorCanvas: title + muted body + primary fallback button', () => {
  const out = errorCanvas();
  const comps = componentsOf(out);
  assert.equal(comps[0].id, 'err_title');
  assert.match(comps[0].text, /Couldn't load/);
  assert.equal(comps[1].style, 'muted');
  const footer = comps.find((c) => c.id === 'full_roadmap');
  assert.equal(footer.action.type, 'url');
  assert.equal(footer.style, 'primary');
});
