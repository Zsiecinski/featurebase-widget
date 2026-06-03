// Tests for the PII masking helpers used by the analytics dashboard.
// Default-on masking is the single most important privacy guarantee of
// the dashboard — accidentally rendering a real customer's email in a
// screenshare/recording is the leak we're trying to prevent. These tests
// make sure that "show_pii=false" really means masked.
import test from 'node:test';
import assert from 'node:assert/strict';

const { maskName, maskEmail } = await import('../src/admin-routes.js');

test('maskName: returns null for null/empty (anonymous lead path)', () => {
  assert.equal(maskName(null, false), null);
  assert.equal(maskName('', false), null);
  assert.equal(maskName(undefined, false), null);
});

test('maskName: masks "Bob Smith" → "B. S."', () => {
  assert.equal(maskName('Bob Smith', false), 'B. S.');
});

test('maskName: handles single-word names', () => {
  assert.equal(maskName('Bob', false), 'B.');
});

test('maskName: handles three-part names', () => {
  assert.equal(maskName('Bob R. Smith', false), 'B. R. S.');
});

test('maskName: upper-cases initials even if input is lowercase', () => {
  assert.equal(maskName('bob smith', false), 'B. S.');
});

test('maskName: trims surrounding whitespace cleanly', () => {
  assert.equal(maskName('  Bob   Smith  ', false), 'B. S.');
});

test('maskName: passes through unchanged when showPii is true', () => {
  assert.equal(maskName('Bob Smith', true), 'Bob Smith');
});

test('maskEmail: returns null for null/empty', () => {
  assert.equal(maskEmail(null, false), null);
  assert.equal(maskEmail('', false), null);
});

test('maskEmail: masks "bob@acme.com" → "b•••@acme.com"', () => {
  assert.equal(maskEmail('bob@acme.com', false), 'b•••@acme.com');
});

test('maskEmail: short locals get the same 3-dot mask (no length leak)', () => {
  // Always 3 dots regardless of input length so the rendered length
  // doesn't whisper how long the original local was.
  assert.equal(maskEmail('ab@x.com', false), 'a•••@x.com');
});

test('maskEmail: long locals also get exactly 3 dots so output stays compact', () => {
  assert.equal(maskEmail('jonathan@acme.com', false), 'j•••@acme.com');
});

test('maskEmail: preserves domain so engagement-by-org pattern is still visible', () => {
  // "Loop got 5 clicks from someone @acme.com" is still actionable
  // intelligence even with the local masked.
  assert.equal(maskEmail('whoever@acme.com', false).endsWith('@acme.com'), true);
});

test('maskEmail: passes through unchanged when showPii is true', () => {
  assert.equal(maskEmail('bob@acme.com', true), 'bob@acme.com');
});

test('maskEmail: falls back gracefully for malformed addresses', () => {
  // No @ → return as-is. Belt-and-suspenders for whatever weird strings
  // Intercom might emit if its data is corrupt.
  assert.equal(maskEmail('not-an-email', false), 'not-an-email');
});
