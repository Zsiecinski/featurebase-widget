// Tests for the analytics db layer. Real Postgres integration is covered
// on staging; these tests cover the safe-fallback behavior — every db
// function must no-op cleanly when DATABASE_URL is unset, so the Canvas
// Kit hot path is never blocked or broken by a missing database.
import test from 'node:test';
import assert from 'node:assert/strict';

const { dbAvailable, defaultWorkspaceId, logEvent, getAnalytics, recentEvents } =
  await import('../src/db/index.js');

test('dbAvailable: false when DATABASE_URL is unset', () => {
  delete process.env.DATABASE_URL;
  assert.equal(dbAvailable(), false);
});

test('defaultWorkspaceId: uses SINGLE_TENANT_WORKSPACE when set, else "staytuned"', () => {
  delete process.env.SINGLE_TENANT_WORKSPACE;
  assert.equal(defaultWorkspaceId(), 'staytuned');
  process.env.SINGLE_TENANT_WORKSPACE = 'my-org';
  assert.equal(defaultWorkspaceId(), 'my-org');
  delete process.env.SINGLE_TENANT_WORKSPACE;
});

test('logEvent: silently no-ops when DATABASE_URL is unset', async () => {
  delete process.env.DATABASE_URL;
  // Must not throw, must not block. Hot path safety.
  const result = await logEvent('staytuned', 'card_rendered', { foo: 'bar' });
  assert.equal(result, undefined);
});

test('logEvent: silently no-ops when workspaceId or event is falsy', async () => {
  delete process.env.DATABASE_URL;
  await logEvent('', 'card_rendered');
  await logEvent(null, 'card_rendered');
  await logEvent('staytuned', '');
  await logEvent('staytuned', null);
  // Pass if nothing throws.
});

test('getAnalytics: returns null when DATABASE_URL is unset', async () => {
  delete process.env.DATABASE_URL;
  const result = await getAnalytics('staytuned', { days: 30 });
  assert.equal(result, null);
});

test('recentEvents: returns [] when DATABASE_URL is unset', async () => {
  delete process.env.DATABASE_URL;
  const result = await recentEvents({ limit: 10 });
  assert.deepEqual(result, []);
});
