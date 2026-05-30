// Integration tests for the marketing site routes. Boots the Express app
// in mock mode and hits each public URL to verify it serves correctly.
//
// Catches regressions when someone moves files, changes routes, or breaks
// the express.static mount order. Cheap to run, runs in CI on every push.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../src/server.js');

// Tiny supertest-style helper using the native fetch.
function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function get(base, path) {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  return { status: res.status, contentType: res.headers.get('content-type') || '', text };
}

test('GET / serves the marketing landing page', async () => {
  const { server, base } = await listen();
  try {
    const r = await get(base, '/');
    assert.equal(r.status, 200);
    assert.match(r.contentType, /text\/html/);
    assert.match(r.text, /Close the feedback loop in Messenger/);
    assert.match(r.text, /<title>Loop/);
  } finally {
    server.close();
  }
});

test('GET /website/styles.css serves the stylesheet', async () => {
  const { server, base } = await listen();
  try {
    const r = await get(base, '/website/styles.css');
    assert.equal(r.status, 200);
    assert.match(r.contentType, /text\/css/);
    assert.match(r.text, /--coral-500:\s*#F43F5E/);
  } finally {
    server.close();
  }
});

test('GET /website/privacy.html serves the privacy page', async () => {
  const { server, base } = await listen();
  try {
    const r = await get(base, '/website/privacy.html');
    assert.equal(r.status, 200);
    assert.match(r.contentType, /text\/html/);
    assert.match(r.text, /Privacy Policy/);
  } finally {
    server.close();
  }
});

test('GET /website/terms.html serves the terms page', async () => {
  const { server, base } = await listen();
  try {
    const r = await get(base, '/website/terms.html');
    assert.equal(r.status, 200);
    assert.match(r.contentType, /text\/html/);
    assert.match(r.text, /Terms of Service/);
  } finally {
    server.close();
  }
});

test('GET /website/docs.html serves the documentation', async () => {
  const { server, base } = await listen();
  try {
    const r = await get(base, '/website/docs.html');
    assert.equal(r.status, 200);
    assert.match(r.contentType, /text\/html/);
    assert.match(r.text, /Loop documentation/);
    // Sanity check the side-nav anchors are wired up
    assert.match(r.text, /id="install"/);
    assert.match(r.text, /id="api-key"/);
    assert.match(r.text, /id="configure"/);
  } finally {
    server.close();
  }
});

test('GET /assets/logo.svg serves the brand mark', async () => {
  const { server, base } = await listen();
  try {
    const r = await get(base, '/assets/logo.svg');
    assert.equal(r.status, 200);
    assert.match(r.contentType, /svg/);
    assert.match(r.text, /<svg/);
  } finally {
    server.close();
  }
});

test('GET /favicon.svg serves the favicon', async () => {
  const { server, base } = await listen();
  try {
    const r = await get(base, '/favicon.svg');
    assert.equal(r.status, 200);
    assert.match(r.text, /<svg/);
  } finally {
    server.close();
  }
});

test('GET /health returns JSON status', async () => {
  const { server, base } = await listen();
  try {
    const r = await get(base, '/health');
    assert.equal(r.status, 200);
    assert.match(r.contentType, /application\/json/);
    const parsed = JSON.parse(r.text);
    assert.equal(parsed.ok, true);
    assert.equal(typeof parsed.uptime, 'number');
  } finally {
    server.close();
  }
});

test('GET /nonexistent returns 404', async () => {
  const { server, base } = await listen();
  try {
    const r = await get(base, '/this-route-does-not-exist');
    assert.equal(r.status, 404);
  } finally {
    server.close();
  }
});
