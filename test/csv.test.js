// Tests for the CSV export helpers used by the analytics dashboard.
// RFC 4180 escape rules: wrap in double quotes when the value contains
// a comma, double quote, or newline; double up internal quotes; otherwise
// pass through unchanged. Header row first, CRLF line endings.
import test from 'node:test';
import assert from 'node:assert/strict';

const { csvEscape, rowsToCsv } = await import('../src/admin-routes.js');

test('csvEscape: passes through simple values', () => {
  assert.equal(csvEscape('hello'), 'hello');
  assert.equal(csvEscape(42), '42');
  assert.equal(csvEscape('acme.myshopify.com'), 'acme.myshopify.com');
});

test('csvEscape: returns empty string for null/undefined', () => {
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
});

test('csvEscape: quotes values containing commas', () => {
  // "Smith, Bob" must be wrapped or it breaks the CSV row.
  assert.equal(csvEscape('Smith, Bob'), '"Smith, Bob"');
});

test('csvEscape: quotes and doubles internal quotes', () => {
  // O'Hara becomes O''Hara wrapped in quotes — CSV's quote-doubling rule.
  assert.equal(csvEscape('She said "hi"'), '"She said ""hi"""');
});

test('csvEscape: quotes values containing newlines', () => {
  assert.equal(csvEscape('line one\nline two'), '"line one\nline two"');
  assert.equal(csvEscape('line one\r\nline two'), '"line one\r\nline two"');
});

test('csvEscape: stringifies objects (for raw metadata dumps)', () => {
  // Used when we want to export the raw event metadata JSON column.
  const out = csvEscape({ item_id: 'abc', clicks: 3 });
  // Quoted because contains a comma.
  assert.equal(out, '"{""item_id"":""abc"",""clicks"":3}"');
});

test('rowsToCsv: produces a header row followed by data rows with CRLF', () => {
  const csv = rowsToCsv(
    ['name', 'email', 'clicks'],
    [
      ['Bob Smith', 'bob@acme.com', 3],
      ['Jane Chen', 'jane@beta.io', 8],
    ],
  );
  // Strip the BOM so the assertion is readable.
  const noBom = csv.replace(/^﻿/, '');
  assert.equal(
    noBom,
    'name,email,clicks\r\nBob Smith,bob@acme.com,3\r\nJane Chen,jane@beta.io,8\r\n',
  );
});

test('rowsToCsv: handles empty row array gracefully (header only, no trailing newline)', () => {
  const csv = rowsToCsv(['name', 'clicks'], []);
  const noBom = csv.replace(/^﻿/, '');
  // Header + CRLF, no body, no extra newline.
  assert.equal(noBom, 'name,clicks\r\n');
});

test('rowsToCsv: prefixes output with a UTF-8 BOM for Excel compatibility', () => {
  // Without the BOM, Excel renders emoji and accented characters as
  // mojibake when the CSV is opened directly. The BOM tells Excel
  // "this file is UTF-8."
  const csv = rowsToCsv(['name'], [['Zoë']]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
});
