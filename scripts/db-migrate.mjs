// Applies src/db/schema.sql to the Postgres pointed at by DATABASE_URL.
// Idempotent — re-running is safe (every CREATE uses IF NOT EXISTS).
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/db-migrate.mjs
//
// On Railway: this runs automatically as part of `npm start` (see package.json)
// so a fresh Postgres instance gets schema applied on first boot.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'src', 'db', 'schema.sql');

const url = process.env.DATABASE_URL;
if (!url) {
  console.log('[db-migrate] DATABASE_URL not set, skipping.');
  process.exit(0);
}

const sql = postgres(url, {
  ssl: process.env.PGSSLMODE === 'disable' ? false : 'require',
  max: 1,
});

const schema = await readFile(schemaPath, 'utf8');
try {
  await sql.unsafe(schema);
  console.log('[db-migrate] schema applied.');
} catch (err) {
  console.error('[db-migrate] failed:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
