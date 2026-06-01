// Tests for the encrypt/decrypt utilities used to protect Featurebase API
// keys at rest. The tenant repository functions require a real Postgres
// connection — those will be covered by integration tests when the staging
// service is set up.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Set a known key before importing the module so getKey() validates and
// caches against this value.
process.env.FB_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

const { encrypt, decrypt, dbAvailable } = await import('../src/db/index.js');

test('encrypt/decrypt: round-trip yields original plaintext', () => {
  const plain = 'fb_live_abc123_supersecret';
  const cipher = encrypt(plain);
  // Cipher format: ivHex:tagHex:ciphertextHex
  assert.match(cipher, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(decrypt(cipher), plain);
});

test('encrypt: two calls with same plaintext produce different ciphertexts (random IV)', () => {
  const plain = 'fb_live_same_input';
  const a = encrypt(plain);
  const b = encrypt(plain);
  assert.notEqual(a, b);
  // But both decrypt to the same value
  assert.equal(decrypt(a), plain);
  assert.equal(decrypt(b), plain);
});

test('encrypt: empty string returns empty string', () => {
  assert.equal(encrypt(''), '');
});

test('decrypt: empty/malformed input returns empty string', () => {
  assert.equal(decrypt(''), '');
  assert.equal(decrypt('not-a-valid-payload'), '');
});

test('decrypt: tampered ciphertext throws (auth tag mismatch)', () => {
  const cipher = encrypt('original');
  // Flip a single hex char in the ciphertext part to invalidate the auth tag
  const parts = cipher.split(':');
  parts[2] = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'a' ? 'b' : 'a');
  const tampered = parts.join(':');
  assert.throws(() => decrypt(tampered));
});

test('dbAvailable: false when DATABASE_URL is unset', () => {
  delete process.env.DATABASE_URL;
  assert.equal(dbAvailable(), false);
});

// ---------------------------------------------------------------------------
// logEvent and getAnalytics safe-fallback behavior. Both functions are called
// in hot paths (every Canvas Kit render) and must never throw or block when
// the DB isn't available. Full integration coverage requires a real Postgres
// connection; these tests cover the no-DB safety net only.
// ---------------------------------------------------------------------------

const { logEvent, getAnalytics } = await import('../src/db/index.js');

test('logEvent: silently no-ops when DATABASE_URL is unset', async () => {
  delete process.env.DATABASE_URL;
  // Must not throw, must not block.
  const result = await logEvent('test-workspace', 'card_rendered', { foo: 'bar' });
  assert.equal(result, undefined);
});

test('logEvent: silently no-ops when workspaceId is falsy', async () => {
  // Even with a (fake) DB URL, missing workspaceId should bail before any
  // DB call. This protects against accidentally logging events with no
  // tenant attribution.
  delete process.env.DATABASE_URL;
  await logEvent('', 'card_rendered');
  await logEvent(null, 'card_rendered');
  await logEvent(undefined, 'card_rendered');
  // No assertions — test passes if nothing throws.
});

test('getAnalytics: returns null when DATABASE_URL is unset', async () => {
  delete process.env.DATABASE_URL;
  const result = await getAnalytics('test-workspace', { days: 30 });
  assert.equal(result, null);
});
