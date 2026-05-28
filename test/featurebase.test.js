import test from 'node:test';
import assert from 'node:assert/strict';

// Force non-mock mode before importing the module so config picks up a key.
process.env.FEATUREBASE_API_KEY = 'test_key';
process.env.FEATUREBASE_MOCK = 'false';
process.env.FEATUREBASE_RETRIES = '2';
process.env.FEATUREBASE_TIMEOUT_MS = '1000';

const { getChangelogs } = await import('../src/featurebase.js');

function stubFetch(impl) {
  globalThis.fetch = impl;
}

function jsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

test('getChangelogs: hits /v2/changelogs with state=live, sorted by date desc', async () => {
  let capturedUrl;
  stubFetch(async (url) => {
    capturedUrl = url;
    return jsonResponse({
      object: 'list',
      data: [
        { id: 'c1', title: 'Thing one', url: 'https://x.test/p/1', date: '2026-05-01' },
        { id: 'c2', title: 'Thing two', url: 'https://x.test/p/2', date: '2026-04-20' },
      ],
    });
  });

  const out = await getChangelogs();
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'c1');

  // Sanity-check the URL the client builds
  assert.match(capturedUrl, /\/v2\/changelogs\?/);
  assert.match(capturedUrl, /state=live/);
  assert.match(capturedUrl, /sortBy=date/);
  assert.match(capturedUrl, /sortOrder=desc/);
  assert.doesNotMatch(capturedUrl, /categories=/, 'no category param when env var unset');
});

test('getChangelogs: returns [] when API returns empty data array', async () => {
  stubFetch(async () => jsonResponse({ object: 'list', data: [] }));
  const out = await getChangelogs();
  assert.deepEqual(out, []);
});

test('getChangelogs: includes categories= when FEATUREBASE_CATEGORY is set', async () => {
  process.env.FEATUREBASE_CATEGORY = 'Kiwi Size Chart & Recommender';
  try {
    let capturedUrl;
    stubFetch(async (url) => {
      capturedUrl = url;
      return jsonResponse({ data: [] });
    });

    await getChangelogs();
    assert.match(capturedUrl, /categories=Kiwi/);
    // & is URL-encoded
    assert.match(capturedUrl, /categories=Kiwi\+Size\+Chart\+%26\+Recommender/);
  } finally {
    delete process.env.FEATUREBASE_CATEGORY;
  }
});

test('getChangelogs: falls back to deprecated FEATUREBASE_BOARD env var', async () => {
  process.env.FEATUREBASE_BOARD = 'Legacy Board Name';
  try {
    let capturedUrl;
    stubFetch(async (url) => {
      capturedUrl = url;
      return jsonResponse({ data: [] });
    });

    await getChangelogs();
    assert.match(capturedUrl, /categories=Legacy\+Board\+Name/);
  } finally {
    delete process.env.FEATUREBASE_BOARD;
  }
});

test('getChangelogs: surfaces 4xx errors with status code in message', async () => {
  stubFetch(async () => jsonResponse({ error: 'bad key' }, { status: 401 }));
  await assert.rejects(() => getChangelogs(), /Featurebase 401/);
});

test('getChangelogs: retries on transient network failure', async () => {
  let calls = 0;
  stubFetch(async () => {
    calls++;
    if (calls < 3) throw new Error('network glitch');
    return jsonResponse({ data: [{ id: 'c1', title: 'Recovered', url: 'https://x.test/p/1' }] });
  });

  const out = await getChangelogs();
  assert.equal(out.length, 1);
  assert.equal(calls, 3, '2 retries before success');
});
