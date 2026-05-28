import test from 'node:test';
import assert from 'node:assert/strict';

// Force non-mock mode before importing the module so config picks up a key.
process.env.FEATUREBASE_API_KEY = 'test_key';
process.env.FEATUREBASE_MOCK = 'false';
// Keep retry waits short so the "retries" test doesn't slow the suite.
process.env.FEATUREBASE_RETRIES = '2';
process.env.FEATUREBASE_TIMEOUT_MS = '1000';

const { getCompletedStatusId, _resetCacheForTests } = await import(
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
