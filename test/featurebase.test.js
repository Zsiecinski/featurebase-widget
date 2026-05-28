import test from 'node:test';
import assert from 'node:assert/strict';

// Force non-mock mode before importing the module so config picks up a key.
process.env.FEATUREBASE_API_KEY = 'test_key';
process.env.FEATUREBASE_MOCK = 'false';
// Keep retry waits short so the "retries" test doesn't slow the suite.
process.env.FEATUREBASE_RETRIES = '2';
process.env.FEATUREBASE_TIMEOUT_MS = '1000';

const { getCompletedStatusId, getBoardId, _resetCacheForTests } = await import(
  '../src/featurebase.js'
);

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

test('getCompletedStatusId: parses the bare-array response shape (per Featurebase docs)', async () => {
  _resetCacheForTests();
  // /v2/post_statuses returns a bare JSON array, not { data: [...] }.
  stubFetch(async () =>
    jsonResponse([
      { id: 's1', type: 'reviewing', name: 'Under Review' },
      { id: 's2', type: 'active', name: 'In Progress' },
      { id: 's3', type: 'completed', name: 'Done' },
    ]),
  );

  const id = await getCompletedStatusId();
  assert.equal(id, 's3');
});

test('getCompletedStatusId: also tolerates a { data: [...] } envelope', async () => {
  _resetCacheForTests();
  stubFetch(async () =>
    jsonResponse({
      data: [
        { id: 's1', type: 'active' },
        { id: 's2', type: 'completed' },
      ],
    }),
  );

  const id = await getCompletedStatusId();
  assert.equal(id, 's2');
});

test('getCompletedStatusId: caches result across calls', async () => {
  _resetCacheForTests();
  let calls = 0;
  stubFetch(async () => {
    calls++;
    return jsonResponse([{ id: 'cached_id', type: 'completed' }]);
  });

  const first = await getCompletedStatusId();
  const second = await getCompletedStatusId();
  assert.equal(first, 'cached_id');
  assert.equal(second, 'cached_id');
  assert.equal(calls, 1, 'second call should hit cache, not fetch');
});

test('getCompletedStatusId: throws when no completed status exists', async () => {
  _resetCacheForTests();
  stubFetch(async () =>
    jsonResponse([{ id: 's1', type: 'active' }]),
  );

  await assert.rejects(
    () => getCompletedStatusId(),
    /No status with type 'completed'/,
  );
});

test('getBoardId: returns null when FEATUREBASE_BOARD is empty', async () => {
  _resetCacheForTests();
  // No board configured — no API call should happen and we should get null.
  let calls = 0;
  stubFetch(async () => {
    calls++;
    return jsonResponse([]);
  });
  // Ensure module reads the live env (config is captured at import time, so we
  // rely on the fact that no env was set when this test file loaded).
  const id = await getBoardId();
  assert.equal(id, null);
  assert.equal(calls, 0, 'should not hit the API when no board is configured');
});

test('getBoardId: resolves a name substring to a board id', async () => {
  _resetCacheForTests();
  process.env.FEATUREBASE_BOARD = 'kiwi';
  try {
    stubFetch(async () =>
      jsonResponse([
        { id: 'board_tickets', name: 'Tickets & Events' },
        { id: 'board_kiwi', name: 'Kiwi Size Chart & Recommender' },
        { id: 'board_general', name: 'General feedback' },
      ]),
    );

    const id = await getBoardId();
    assert.equal(id, 'board_kiwi');
  } finally {
    delete process.env.FEATUREBASE_BOARD;
  }
});

test('getBoardId: passes a 24-char hex value through without an API call', async () => {
  _resetCacheForTests();
  process.env.FEATUREBASE_BOARD = '507f1f77bcf86cd799439011';
  try {
    let calls = 0;
    stubFetch(async () => {
      calls++;
      return jsonResponse([]);
    });

    const id = await getBoardId();
    assert.equal(id, '507f1f77bcf86cd799439011');
    assert.equal(calls, 0, 'should not hit the API when a board ID is given directly');
  } finally {
    delete process.env.FEATUREBASE_BOARD;
  }
});

test('getBoardId: throws a helpful error when no board name matches', async () => {
  _resetCacheForTests();
  process.env.FEATUREBASE_BOARD = 'nonexistent';
  try {
    stubFetch(async () =>
      jsonResponse([
        { id: 'b1', name: 'Tickets & Events' },
        { id: 'b2', name: 'Kiwi Size Chart & Recommender' },
      ]),
    );

    await assert.rejects(
      () => getBoardId(),
      /No Featurebase board matches "nonexistent".*Tickets.*Kiwi/s,
    );
  } finally {
    delete process.env.FEATUREBASE_BOARD;
  }
});

test('getCompletedStatusId: retries on failure before surfacing error', async () => {
  _resetCacheForTests();
  let calls = 0;
  stubFetch(async () => {
    calls++;
    throw new Error('network down');
  });

  await assert.rejects(() => getCompletedStatusId(), /network down/);
  // FEATUREBASE_RETRIES=2 means 1 initial + 2 retries = 3 total attempts.
  assert.equal(calls, 3, `expected 3 attempts, got ${calls}`);
});
