import test from 'node:test';
import assert from 'node:assert/strict';
import { homeCanvas, detailCanvas, errorCanvas, COLLAPSED_COUNT } from '../src/canvas.js';

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

function manyEntries(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    title: `Entry ${i}`,
    url: `https://example.com/${i}`,
    date: iso(i * day),
  }));
}

function comp(canvas) {
  return canvas.canvas.content.components;
}

// ---------------------------------------------------------------------------
// Home canvas
// ---------------------------------------------------------------------------

test('homeCanvas: header + simple subhead (no count, no filter)', () => {
  const out = homeCanvas(sampleEntries);
  const c = comp(out);
  assert.equal(c[0].text, 'Recently shipped');
  assert.equal(c[1].id, 'subhead');
  assert.match(c[1].text, /Tap an item/);
  // No time-range component anywhere
  assert.equal(c.find((x) => x.id === 'time_range'), undefined);
});

test('homeCanvas: items use sheet action with absolute URL', () => {
  const out = homeCanvas(sampleEntries, { baseUrl: 'https://loop.example.com' });
  const list = comp(out).find((c) => c.type === 'list');
  assert.equal(list.items.length, sampleEntries.length);
  const itemA = list.items.find((i) => i.id === 'item_a');
  assert.equal(itemA.action.type, 'sheet');
  assert.equal(itemA.action.url, 'https://loop.example.com/sheet/a');
});

test('homeCanvas: entry id is URL-encoded in sheet URL', () => {
  const out = homeCanvas(
    [{ id: 'has spaces/&', title: 'Weird ID', url: 'https://x.test' }],
    { baseUrl: 'https://loop.example.com' },
  );
  const item = comp(out).find((c) => c.type === 'list').items[0];
  assert.equal(item.action.url, 'https://loop.example.com/sheet/has%20spaces%2F%26');
});

test('homeCanvas: collapsed by default to COLLAPSED_COUNT items', () => {
  const out = homeCanvas(manyEntries(8));
  const list = comp(out).find((c) => c.type === 'list');
  assert.equal(list.items.length, COLLAPSED_COUNT);
});

test('homeCanvas: Show N more shows the exact hidden count', () => {
  const out = homeCanvas(manyEntries(8));
  const seeMore = comp(out).find((c) => c.id === 'see_more');
  assert.ok(seeMore);
  assert.match(seeMore.label, /Show 5 more/);
  assert.equal(seeMore.action.type, 'submit');
});

test('homeCanvas: expanded shows all + Show less, no see_more', () => {
  const out = homeCanvas(manyEntries(8), { expanded: true });
  const list = comp(out).find((c) => c.type === 'list');
  assert.equal(list.items.length, 8);
  assert.ok(comp(out).find((c) => c.id === 'show_less'));
  assert.equal(comp(out).find((c) => c.id === 'see_more'), undefined);
});

test('homeCanvas: no toggle when total <= COLLAPSED_COUNT', () => {
  const out = homeCanvas(manyEntries(2));
  assert.equal(comp(out).find((c) => c.id === 'see_more'), undefined);
  assert.equal(comp(out).find((c) => c.id === 'show_less'), undefined);
});

test('homeCanvas: stored_data persists expanded as string', () => {
  assert.deepEqual(
    homeCanvas(manyEntries(5), { expanded: true }).canvas.stored_data,
    { expanded: 'true' },
  );
  assert.deepEqual(
    homeCanvas(manyEntries(5)).canvas.stored_data,
    { expanded: 'false' },
  );
});

test('homeCanvas: featuredImage attaches as item.image (string + object shapes)', () => {
  const out = homeCanvas(sampleEntries);
  const list = comp(out).find((c) => c.type === 'list');
  assert.equal(list.items.find((i) => i.id === 'item_a').image, 'https://example.com/a.png');
  assert.equal(list.items.find((i) => i.id === 'item_b').image, undefined);
});

test('homeCanvas: empty state shows muted message', () => {
  const out = homeCanvas([]);
  const empty = comp(out).find((c) => c.id === 'empty');
  assert.ok(empty);
  assert.match(empty.text, /Nothing shipped yet/);
});

// ---------------------------------------------------------------------------
// Detail canvas
// ---------------------------------------------------------------------------

test('detailCanvas: title + meta + body paragraphs + open-on-Featurebase button', () => {
  const entry = {
    id: 'x',
    title: 'Big new thing',
    url: 'https://staytuned.featurebase.app/changelog/big-new-thing',
    date: iso(2 * day),
    commentCount: 3,
    categories: ['Kiwi Sizing'],
    markdownContent: '## What changed\n\nThis is paragraph one with **bold** text.\n\nThis is paragraph two with a [link](https://x.test).',
  };
  const out = detailCanvas(entry);
  const c = comp(out);

  assert.equal(c.find((x) => x.id === 'd_title').text, 'Big new thing');
  assert.match(c.find((x) => x.id === 'd_meta').text, /Shipped 2 days ago · Kiwi Sizing · 3 comments/);

  // Markdown stripped
  const bodyTexts = c.filter((x) => x.id?.startsWith('d_body_'));
  assert.ok(bodyTexts.length >= 2, 'expected at least 2 body paragraphs');
  assert.match(bodyTexts[0].text, /What changed/);
  // ** stripped, plain text remains
  assert.match(bodyTexts.map((b) => b.text).join(' '), /This is paragraph one with bold text\./);
  // [link](url) → just text
  assert.match(bodyTexts.map((b) => b.text).join(' '), /with a link\./);

  const openBtn = c.find((x) => x.id === 'd_open_full');
  assert.equal(openBtn.action.url, entry.url);
});

test('detailCanvas: includes hero image when featuredImage exists', () => {
  const entry = {
    id: 'x',
    title: 't',
    url: 'https://x.test',
    featuredImage: 'https://example.com/hero.png',
  };
  const out = detailCanvas(entry);
  const hero = comp(out).find((c) => c.id === 'hero');
  assert.ok(hero);
  assert.equal(hero.type, 'image');
  assert.equal(hero.url, 'https://example.com/hero.png');
});

test('detailCanvas: long body is truncated with "continue reading" hint', () => {
  const longText = 'word '.repeat(500); // ~2500 chars
  const out = detailCanvas({ id: 'x', title: 't', url: 'https://x.test', markdownContent: longText });
  const more = comp(out).find((c) => c.id === 'd_body_more');
  assert.ok(more, 'expected continue-reading hint');
  assert.match(more.text, /Continue reading/);
});

test('detailCanvas: not-found state when entry is null', () => {
  const out = detailCanvas(null);
  const c = comp(out);
  assert.equal(c[0].id, 'd_nf_title');
  assert.match(c[0].text, /Update unavailable/);
});

// ---------------------------------------------------------------------------
// Error canvas
// ---------------------------------------------------------------------------

test('errorCanvas: title + muted body + primary fallback button', () => {
  const out = errorCanvas();
  const c = comp(out);
  assert.equal(c[0].id, 'err_title');
  assert.equal(c.find((x) => x.id === 'full_roadmap').style, 'primary');
});
