import test from 'node:test';
import assert from 'node:assert/strict';
import { doneCanvas, errorCanvas } from '../src/canvas.js';

const day = 86400 * 1000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

test('doneCanvas: uses list component for entries with date subtitles', () => {
  const out = doneCanvas([
    { id: 'a', title: 'Alpha shipped', url: 'https://example.com/a', date: iso(0), commentCount: 5 },
    { id: 'b', title: 'Beta shipped', url: 'https://example.com/b', date: iso(3 * day) },
    { id: 'c', title: 'Gamma shipped', url: 'https://example.com/c', date: iso(60 * day), commentCount: 1 },
  ]);

  const components = out.canvas.content.components;
  assert.equal(components[0].id, 'header');
  assert.equal(components[1].style, 'muted');

  const list = components.find((c) => c.type === 'list');
  assert.ok(list, 'expected list component');
  assert.equal(list.items.length, 3);

  const itemA = list.items.find((i) => i.id === 'item_a');
  assert.equal(itemA.title, 'Alpha shipped');
  assert.equal(itemA.action.url, 'https://example.com/a');
  assert.equal(itemA.subtitle, 'Shipped today · 5 comments');

  const itemB = list.items.find((i) => i.id === 'item_b');
  assert.equal(itemB.subtitle, 'Shipped 3 days ago');

  const itemC = list.items.find((i) => i.id === 'item_c');
  // 60 days ago renders as an absolute "Mon DD" label
  assert.match(itemC.subtitle, /Shipped [A-Z][a-z]{2} \d+ · 1 comment/);

  const buttons = components.filter((c) => c.type === 'button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].id, 'full_roadmap');
  assert.equal(buttons[0].style, 'primary');
});

test('doneCanvas: subtitle omitted when entry has no date and no comments', () => {
  const out = doneCanvas([
    { id: 'x', title: 'No metadata', url: 'https://example.com/x' },
  ]);
  const item = out.canvas.content.components
    .find((c) => c.type === 'list')
    .items[0];
  assert.equal(item.subtitle, undefined);
});

test('doneCanvas: yesterday and singular comment render correctly', () => {
  const out = doneCanvas([
    { id: 'y', title: 'Recent', url: 'https://example.com/y', date: iso(1 * day), commentCount: 1 },
  ]);
  const item = out.canvas.content.components
    .find((c) => c.type === 'list')
    .items[0];
  assert.equal(item.subtitle, 'Shipped yesterday · 1 comment');
});

test('doneCanvas: empty list shows muted empty-state message + footer button', () => {
  const out = doneCanvas([]);
  const components = out.canvas.content.components;

  assert.ok(components.find((c) => c.id === 'empty'));
  assert.ok(components.find((c) => c.id === 'full_roadmap'));
  assert.equal(components.filter((c) => c.type === 'list').length, 0);
});

test('errorCanvas: title + muted body + primary fallback button', () => {
  const out = errorCanvas();
  const components = out.canvas.content.components;

  assert.equal(components[0].id, 'err_title');
  assert.match(components[0].text, /Couldn't load/);
  assert.equal(components[1].style, 'muted');

  const footer = components.find((c) => c.id === 'full_roadmap');
  assert.equal(footer.action.type, 'url');
  assert.equal(footer.style, 'primary');
});
