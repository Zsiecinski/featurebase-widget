import test from 'node:test';
import assert from 'node:assert/strict';

// Force non-mock mode before importing the module so config picks up a key.
process.env.FEATUREBASE_API_KEY = 'test_key';
process.env.FEATUREBASE_MOCK = 'false';
process.env.FEATUREBASE_RETRIES = '2';
process.env.FEATUREBASE_TIMEOUT_MS = '1000';

const { getChangelogs, getChangelogById } = await import('../src/featurebase.js');

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

  assert.match(capturedUrl, /\/v2\/changelogs\?/);
  assert.match(capturedUrl, /state=live/);
  assert.match(capturedUrl, /sortBy=date/);
  assert.match(capturedUrl, /sortOrder=desc/);
  assert.doesNotMatch(capturedUrl, /categories=/, 'no category param when env var unset');
  assert.doesNotMatch(capturedUrl, /startDate=/, 'no startDate when daysBack is null');
});

test('getChangelogById: returns the single matching entry', async () => {
  stubFetch(async (url) => {
    assert.match(url, /\/v2\/changelogs\?id=mock_c1/);
    return jsonResponse({ data: [{ id: 'mock_c1', title: 'Found it' }] });
  });

  // First arg is `credentials` (null = use env-var fallback). Tests
  // pre-set FEATUREBASE_API_KEY so the fallback gives valid creds.
  const entry = await getChangelogById(null, 'mock_c1');
  assert.equal(entry.id, 'mock_c1');
  assert.equal(entry.title, 'Found it');
});

test('getChangelogById: returns null when API returns empty data', async () => {
  stubFetch(async () => jsonResponse({ data: [] }));
  const entry = await getChangelogById(null, 'missing');
  assert.equal(entry, null);
});

test('getChangelogById: returns null for empty id without hitting the API', async () => {
  let called = false;
  stubFetch(async () => {
    called = true;
    return jsonResponse({ data: [] });
  });
  const entry = await getChangelogById(null, '');
  assert.equal(entry, null);
  assert.equal(called, false);
});

test('getChangelogs: returns [] when API returns empty data array', async () => {
  stubFetch(async () => jsonResponse({ object: 'list', data: [] }));
  const out = await getChangelogs();
  assert.deepEqual(out, []);
});

test('getChangelogs: hides entries with notifications.<locale>.hideFromBoardAndWidgets=true', async () => {
  stubFetch(async () =>
    jsonResponse({
      data: [
        {
          id: 'visible',
          title: 'Public',
          url: 'https://x.test/1',
          locale: 'en',
          notifications: { en: { hideFromBoardAndWidgets: false } },
        },
        {
          id: 'hidden',
          title: 'Hidden by flag',
          url: 'https://x.test/2',
          locale: 'en',
          notifications: { en: { hideFromBoardAndWidgets: true } },
        },
      ],
    }),
  );

  const out = await getChangelogs();
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'visible');
});

test('getChangelogs: still shows segment-restricted entries (Loop does not enforce audience)', async () => {
  stubFetch(async () =>
    jsonResponse({
      data: [
        { id: 'unrestricted', title: 'Public', url: 'https://x.test/1', allowedSegmentIds: [] },
        { id: 'segment_only', title: 'Restricted', url: 'https://x.test/2', allowedSegmentIds: ['seg_123'] },
      ],
    }),
  );

  const out = await getChangelogs();
  assert.equal(out.length, 2);
  // Both entries surface; segment-restriction is a publisher-side concern Loop
  // intentionally does not enforce (no Featurebase-segment <-> Intercom-user
  // mapping available). hideFromBoardAndWidgets is the only respected gate.
});

test('getChangelogs: missing notifications object is treated as visible', async () => {
  stubFetch(async () =>
    jsonResponse({
      data: [{ id: 'plain', title: 'No notifications field', url: 'https://x.test/p' }],
    }),
  );
  const out = await getChangelogs();
  assert.equal(out.length, 1);
});

test('getChangelogs: visibility filter applies before category filter', async () => {
  process.env.FEATUREBASE_CATEGORY = 'Kiwi';
  try {
    stubFetch(async () =>
      jsonResponse({
        data: [
          {
            id: 'kiwi_hidden',
            title: 'Hidden Kiwi entry',
            url: 'https://x.test/1',
            locale: 'en',
            categories: ['Kiwi Sizing'],
            notifications: { en: { hideFromBoardAndWidgets: true } },
          },
          {
            id: 'kiwi_visible',
            title: 'Public Kiwi entry',
            url: 'https://x.test/2',
            locale: 'en',
            categories: ['Kiwi Sizing'],
            notifications: { en: { hideFromBoardAndWidgets: false } },
          },
          {
            id: 'tickets_visible',
            title: 'Public tickets entry',
            url: 'https://x.test/3',
            locale: 'en',
            categories: ['Tickets'],
            notifications: { en: { hideFromBoardAndWidgets: false } },
          },
        ],
      }),
    );

    const out = await getChangelogs();
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'kiwi_visible');
  } finally {
    delete process.env.FEATUREBASE_CATEGORY;
  }
});

test('getChangelogs: filters by category substring client-side (case-insensitive)', async () => {
  process.env.FEATUREBASE_CATEGORY = 'kiwi';
  try {
    stubFetch(async () =>
      jsonResponse({
        data: [
          { id: '1', title: 'Tickets thing', categories: ['Tickets & Events'] },
          { id: '2', title: 'Kiwi thing A', categories: ['Kiwi Size Chart & Recommender'] },
          { id: '3', title: 'General thing', categories: ['General feedback'] },
          { id: '4', title: 'Kiwi thing B', categories: [{ name: 'Kiwi Size Chart & Recommender' }] },
          { id: '5', title: 'Multi-cat', categories: ['Other', 'Kiwi Size Chart & Recommender'] },
        ],
      }),
    );

    const out = await getChangelogs();
    assert.equal(out.length, 3, 'should return only Kiwi-tagged entries');
    assert.deepEqual(out.map((e) => e.id).sort(), ['2', '4', '5']);
  } finally {
    delete process.env.FEATUREBASE_CATEGORY;
  }
});

test('getChangelogs: fetches a wider batch when filtering client-side', async () => {
  process.env.FEATUREBASE_CATEGORY = 'Kiwi';
  try {
    let capturedUrl;
    stubFetch(async (url) => {
      capturedUrl = url;
      return jsonResponse({ data: [] });
    });

    await getChangelogs();
    // limit=8 (config.maxItems) when no filter, but bumped to ~50 when filtering
    // so we don't miss matches.
    assert.match(capturedUrl, /limit=50/);
    // The category param should NOT be sent — filtering is local.
    assert.doesNotMatch(capturedUrl, /categories=/);
  } finally {
    delete process.env.FEATUREBASE_CATEGORY;
  }
});

test('getChangelogs: deprecated FEATUREBASE_BOARD env var still works as a fallback', async () => {
  process.env.FEATUREBASE_BOARD = 'kiwi';
  try {
    stubFetch(async () =>
      jsonResponse({
        data: [
          { id: '1', title: 'Match', categories: ['Kiwi Size Chart & Recommender'] },
          { id: '2', title: 'No match', categories: ['Tickets'] },
        ],
      }),
    );

    const out = await getChangelogs();
    assert.equal(out.length, 1);
    assert.equal(out[0].id, '1');
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
