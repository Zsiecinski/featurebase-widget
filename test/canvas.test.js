import test from 'node:test';
import assert from 'node:assert/strict';
import { doneCanvas, errorCanvas } from '../src/canvas.js';

test('doneCanvas: uses list component for posts (not per-post buttons)', () => {
  const out = doneCanvas([
    { id: 'a', title: 'Alpha shipped', postUrl: 'https://example.com/a', upvotes: 12 },
    { id: 'b', title: 'Beta shipped', postUrl: 'https://example.com/b', upvotes: 3 },
  ]);

  const components = out.canvas.content.components;

  // Header + subhead present
  assert.equal(components[0].id, 'header');
  assert.match(components[0].text, /Recently shipped/);
  assert.equal(components[1].id, 'subheader');
  assert.equal(components[1].style, 'muted');

  // One list, not separate text+button+divider per item
  const list = components.find((c) => c.type === 'list');
  assert.ok(list, 'expected a list component');
  assert.equal(list.items.length, 2);

  // List items have title + action, and titles are plain strings (no markdown asterisks)
  const itemA = list.items.find((i) => i.id === 'item_a');
  assert.equal(itemA.title, 'Alpha shipped');
  assert.equal(itemA.action.url, 'https://example.com/a');
  assert.equal(itemA.action.type, 'url');
  assert.equal(itemA.subtitle, '12 upvotes');

  // Singular upvote subtitle for upvotes === 1 omitted because b has 3
  const itemB = list.items.find((i) => i.id === 'item_b');
  assert.equal(itemB.subtitle, '3 upvotes');

  // Footer button is primary (not secondary/link styled) and is the only button
  const buttons = components.filter((c) => c.type === 'button');
  assert.equal(buttons.length, 1, 'expected exactly one button (the footer)');
  assert.equal(buttons[0].id, 'full_roadmap');
  assert.equal(buttons[0].style, 'primary');
});

test('doneCanvas: subtitle hidden when upvotes/comments are zero or missing', () => {
  const out = doneCanvas([
    { id: 'x', title: 'No engagement yet', postUrl: 'https://example.com/x' },
    { id: 'y', title: 'Only comments', postUrl: 'https://example.com/y', commentCount: 5 },
    { id: 'z', title: 'Both', postUrl: 'https://example.com/z', upvotes: 7, commentCount: 2 },
  ]);

  const list = out.canvas.content.components.find((c) => c.type === 'list');
  const itemX = list.items.find((i) => i.id === 'item_x');
  const itemY = list.items.find((i) => i.id === 'item_y');
  const itemZ = list.items.find((i) => i.id === 'item_z');

  assert.equal(itemX.subtitle, undefined, 'no subtitle when no engagement');
  assert.equal(itemY.subtitle, '5 comments');
  assert.equal(itemZ.subtitle, '7 upvotes · 2 comments');
});

test('doneCanvas: empty list shows muted empty-state message + footer button', () => {
  const out = doneCanvas([]);
  const components = out.canvas.content.components;

  assert.ok(components.find((c) => c.id === 'empty'));
  assert.equal(components.find((c) => c.id === 'empty').style, 'muted');
  assert.ok(components.find((c) => c.id === 'full_roadmap'));
  assert.equal(
    components.filter((c) => c.type === 'list').length,
    0,
    'no list when empty',
  );
});

test('errorCanvas: returns title + body + roadmap fallback button', () => {
  const out = errorCanvas();
  const components = out.canvas.content.components;

  assert.equal(components[0].id, 'err_title');
  assert.match(components[0].text, /Couldn't load/);
  assert.equal(components[1].style, 'muted');

  const footer = components.find((c) => c.id === 'full_roadmap');
  assert.equal(footer.action.type, 'url');
  assert.equal(footer.style, 'primary');
});
