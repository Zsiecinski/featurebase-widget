// Tests for the analytics admin endpoints. Verifies the gate behavior
// (ADMIN_TOKEN required, returns 404 when unset) and the no-DB fallback
// shape. Postgres-backed query paths are covered by integration tests
// against a real database.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;

const { default: app } = await import('../src/server.js');
const request = (await import('node:http')).default;

// Spin up a one-shot listener so we can hit the routes.
async function withServer(fn) {
  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  const { port } = server.address();
  try {
    await fn(port);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request.get(
      { host: '127.0.0.1', port, path, headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      },
    );
    req.on('error', reject);
  });
}

test('admin/analytics: returns 404 when ADMIN_TOKEN is unset', async () => {
  delete process.env.ADMIN_TOKEN;
  await withServer(async (port) => {
    const r = await get(port, '/admin/analytics/staytuned');
    assert.equal(r.status, 404);
  });
});

test('admin/analytics: returns 401 when token is wrong', async () => {
  process.env.ADMIN_TOKEN = 'secret-token-123';
  await withServer(async (port) => {
    const r = await get(port, '/admin/analytics/staytuned', {
      Authorization: 'Bearer nope',
    });
    assert.equal(r.status, 401);
  });
  delete process.env.ADMIN_TOKEN;
});

test('admin/analytics: returns 503 when token valid but DB unconfigured', async () => {
  process.env.ADMIN_TOKEN = 'secret-token-123';
  delete process.env.DATABASE_URL;
  await withServer(async (port) => {
    const r = await get(port, '/admin/analytics/staytuned', {
      Authorization: 'Bearer secret-token-123',
    });
    assert.equal(r.status, 503);
    const body = JSON.parse(r.body);
    assert.match(body.error, /DB not configured/i);
  });
  delete process.env.ADMIN_TOKEN;
});

test('admin/analytics: accepts ?token= query param (browser convenience)', async () => {
  process.env.ADMIN_TOKEN = 'secret-token-123';
  delete process.env.DATABASE_URL;
  await withServer(async (port) => {
    const r = await get(port, '/admin/analytics/staytuned?token=secret-token-123');
    // Same 503 (DB unconfigured) — but the auth gate passed.
    assert.equal(r.status, 503);
  });
  delete process.env.ADMIN_TOKEN;
});

test('admin/events: returns empty list when DB unconfigured (does NOT 503)', async () => {
  process.env.ADMIN_TOKEN = 'secret-token-123';
  delete process.env.DATABASE_URL;
  await withServer(async (port) => {
    const r = await get(port, '/admin/events?token=secret-token-123');
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body);
    assert.deepEqual(body.events, []);
    assert.match(body.note || '', /DB not configured/i);
  });
  delete process.env.ADMIN_TOKEN;
});

test('health: includes db: false when DATABASE_URL is unset', async () => {
  delete process.env.DATABASE_URL;
  await withServer(async (port) => {
    const r = await get(port, '/health');
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body);
    assert.equal(body.db, false);
    assert.equal(body.ok, true);
  });
});

test('admin/analytics/:ws/user/:contactId returns 404 when ADMIN_TOKEN is unset', async () => {
  delete process.env.ADMIN_TOKEN;
  await withServer(async (port) => {
    const r = await get(port, '/admin/analytics/staytuned/user/abc123');
    assert.equal(r.status, 404);
  });
});

test('admin/analytics/:ws/user/:contactId returns 503 when DB unconfigured', async () => {
  process.env.ADMIN_TOKEN = 'secret-token-123';
  delete process.env.DATABASE_URL;
  await withServer(async (port) => {
    const r = await get(port, '/admin/analytics/staytuned/user/abc123?token=secret-token-123');
    assert.equal(r.status, 503);
    const body = JSON.parse(r.body);
    assert.match(body.error, /DB not configured/i);
  });
  delete process.env.ADMIN_TOKEN;
});
