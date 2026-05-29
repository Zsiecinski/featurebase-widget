import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { verifyCanvasKitSignature, isMultiTenantEnabled } from '../src/intercom.js';

// Tiny mock req/res to drive the middleware.
function mockReq({ body = '{}', signature } = {}) {
  return {
    rawBody: Buffer.from(body),
    body: JSON.parse(body),
    headers: { 'x-body-signature': signature },
    get(name) { return this.headers[name.toLowerCase()]; },
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    send(b) { this.body = b; return this; },
  };
  return res;
}

test('verifyCanvasKitSignature: bypass in single-tenant mode (no secret)', () => {
  delete process.env.INTERCOM_CLIENT_SECRET;
  const req = mockReq();
  const res = mockRes();
  let called = false;
  verifyCanvasKitSignature(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.statusCode, 200);
});

test('verifyCanvasKitSignature: rejects missing signature when secret is set', () => {
  process.env.INTERCOM_CLIENT_SECRET = 'test_secret';
  try {
    const req = mockReq();
    const res = mockRes();
    let called = false;
    verifyCanvasKitSignature(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
    assert.match(JSON.stringify(res.body), /missing signature/);
  } finally {
    delete process.env.INTERCOM_CLIENT_SECRET;
  }
});

test('verifyCanvasKitSignature: rejects invalid signature when secret is set', () => {
  process.env.INTERCOM_CLIENT_SECRET = 'test_secret';
  try {
    const req = mockReq({ signature: 'wrong' });
    const res = mockRes();
    let called = false;
    verifyCanvasKitSignature(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
    assert.match(JSON.stringify(res.body), /invalid signature/);
  } finally {
    delete process.env.INTERCOM_CLIENT_SECRET;
  }
});

test('verifyCanvasKitSignature: passes valid HMAC-SHA256 signature', () => {
  process.env.INTERCOM_CLIENT_SECRET = 'test_secret';
  try {
    const body = '{"hello":"world"}';
    const sig = crypto.createHmac('sha256', 'test_secret').update(body).digest('hex');
    const req = mockReq({ body, signature: sig });
    const res = mockRes();
    let called = false;
    verifyCanvasKitSignature(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(res.statusCode, 200);
  } finally {
    delete process.env.INTERCOM_CLIENT_SECRET;
  }
});

test('isMultiTenantEnabled: false when client id missing', () => {
  delete process.env.INTERCOM_CLIENT_ID;
  delete process.env.INTERCOM_CLIENT_SECRET;
  assert.equal(isMultiTenantEnabled(), false);
});

test('isMultiTenantEnabled: false when client secret missing', () => {
  process.env.INTERCOM_CLIENT_ID = 'id';
  delete process.env.INTERCOM_CLIENT_SECRET;
  try {
    assert.equal(isMultiTenantEnabled(), false);
  } finally {
    delete process.env.INTERCOM_CLIENT_ID;
  }
});

test('isMultiTenantEnabled: true when both set', () => {
  process.env.INTERCOM_CLIENT_ID = 'id';
  process.env.INTERCOM_CLIENT_SECRET = 'sec';
  try {
    assert.equal(isMultiTenantEnabled(), true);
  } finally {
    delete process.env.INTERCOM_CLIENT_ID;
    delete process.env.INTERCOM_CLIENT_SECRET;
  }
});
