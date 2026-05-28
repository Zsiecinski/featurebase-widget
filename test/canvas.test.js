import test from 'node:test';
import assert from 'node:assert/strict';
import { doneCanvas, errorCanvas } from '../src/canvas.js';

test('doneCanvas: renders header, per-post block, and footer button', () => {
  const out = doneCanvas([
    { id: 'a', title: 'Alpha shipped', postUrl: 'https://example.com/a' },
    { id: 'b', title: 'Beta shipped', postUrl: 'https://example.com/b' },
  ]);

  const components = out.canvas.content.components;

  assert.equal(components[0].id, 'header');
  assert.match(components[0].text, /Recently Shipped/);

  const titleA = components.find((c) => c.id === 'title_a');
  assert.ok(titleA, 'expected title_a component');
  assert.match(titleA.text, /Alpha shipped/);

  const viewB = components.find((c) => c.id === 'view_b');
  assert.ok(viewB, 'expected view_b button');
  assert.equal(viewB.action.type, 'url');
  assert.equal(viewB.action.url, 'https://example.com/b');

  const divA = components.find((c) => c.id === 'div_a');
  assert.equal(divA.type, 'divider');

  const footer = components.find((c) => c.id === 'full_roadmap');
  assert.ok(footer, 'expected full_roadmap footer button');
  assert.equal(footer.type, 'button');
});

test('doneCanvas: empty list shows empty-state message + footer button', () => {
  const out = doneCanvas([]);
  const components = out.canvas.content.components;

  assert.ok(components.find((c) => c.id === 'empty'));
  assert.ok(components.find((c) => c.id === 'full_roadmap'));
  assert.equal(
    components.filter((c) => c.type === 'divider').length,
    0,
    'no per-post dividers when list is empty',
  );
});

test('errorCanvas: returns error text + roadmap fallback button', () => {
  const out = errorCanvas();
  const components = out.canvas.content.components;

  assert.equal(components[0].id, 'err');
  assert.match(components[0].text, /Couldn't load/);

  const footer = components.find((c) => c.id === 'full_roadmap');
  assert.equal(footer.action.type, 'url');
});
