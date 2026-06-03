// Tests for the analytics db layer. Real Postgres integration is covered
// on staging; these tests cover the safe-fallback behavior — every db
// function must no-op cleanly when DATABASE_URL is unset, so the Canvas
// Kit hot path is never blocked or broken by a missing database.
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  dbAvailable,
  defaultWorkspaceId,
  logEvent,
  getAnalytics,
  recentEvents,
  getEngagedUsers,
  getEngagementByShop,
  getUniqueVisitors,
  getTopItemsWithClickers,
  getUserTimeline,
  resolveShop,
} = await import('../src/db/index.js');

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

test('getEngagedUsers: returns [] when DATABASE_URL is unset', async () => {
  delete process.env.DATABASE_URL;
  assert.deepEqual(await getEngagedUsers('staytuned', { days: 30 }), []);
});

test('getUniqueVisitors: returns 0 when DATABASE_URL is unset', async () => {
  delete process.env.DATABASE_URL;
  assert.equal(await getUniqueVisitors('staytuned', { days: 30 }), 0);
});

test('getTopItemsWithClickers: returns [] when DATABASE_URL is unset', async () => {
  delete process.env.DATABASE_URL;
  assert.deepEqual(await getTopItemsWithClickers('staytuned', { days: 30 }), []);
});

test('getUserTimeline: returns null when DATABASE_URL is unset', async () => {
  delete process.env.DATABASE_URL;
  assert.equal(await getUserTimeline('staytuned', 'abc123', { days: 90 }), null);
});

test('getEngagementByShop: returns [] when DATABASE_URL is unset', async () => {
  delete process.env.DATABASE_URL;
  assert.deepEqual(await getEngagementByShop('staytuned', { days: 30 }), []);
});

// ---------------------------------------------------------------------------
// resolveShop tests — the priority order matters because Staytuned's
// Intercom may set BOTH a contact-level attribute and a company-level one.
// First match wins; canonical key (shopify_domain) takes priority over
// less-standard ones (shop, store). Fallback to company_name only when
// no custom attribute matches.
// ---------------------------------------------------------------------------

test('resolveShop: returns null for null/empty input', () => {
  assert.equal(resolveShop(null), null);
  assert.equal(resolveShop({}), null);
  assert.equal(resolveShop({ contact_custom_attributes: {} }), null);
});

test('resolveShop: picks shopify_domain from contact custom attributes', () => {
  assert.equal(
    resolveShop({ contact_custom_attributes: { shopify_domain: 'acme-store.myshopify.com' } }),
    'acme-store.myshopify.com',
  );
});

test('resolveShop: falls back to shop_domain when shopify_domain not present', () => {
  assert.equal(
    resolveShop({ contact_custom_attributes: { shop_domain: 'beta.myshopify.com' } }),
    'beta.myshopify.com',
  );
});

test('resolveShop: shopify_domain wins over shop_domain when both present', () => {
  // Priority order matters — first match in the candidate list wins so
  // that the canonical key takes precedence over legacy ones.
  assert.equal(
    resolveShop({ contact_custom_attributes: { shop_domain: 'old', shopify_domain: 'new' } }),
    'new',
  );
});

test('resolveShop: contact attrs take priority over company attrs', () => {
  // If both are present we prefer contact-level (more specific).
  assert.equal(
    resolveShop({
      contact_custom_attributes: { shopify_domain: 'contact.myshopify.com' },
      company_custom_attributes: { shopify_domain: 'company.myshopify.com' },
    }),
    'contact.myshopify.com',
  );
});

test('resolveShop: falls back to company custom_attributes', () => {
  assert.equal(
    resolveShop({
      contact_custom_attributes: {},
      company_custom_attributes: { shopify_domain: 'fromco.myshopify.com' },
    }),
    'fromco.myshopify.com',
  );
});

test('resolveShop: final fallback to company_name', () => {
  assert.equal(
    resolveShop({ company_name: 'acme-store.myshopify.com' }),
    'acme-store.myshopify.com',
  );
});

test('resolveShop: custom attributes take priority over company_name', () => {
  assert.equal(
    resolveShop({
      contact_custom_attributes: { shopify_domain: 'attrs.myshopify.com' },
      company_name: 'fallback-name',
    }),
    'attrs.myshopify.com',
  );
});

test('resolveShop: handles non-string custom attribute values (numeric IDs)', () => {
  // Defensive: Intercom can store any JSON type in custom_attributes.
  // resolveShop should stringify so the renderer always gets a string.
  assert.equal(
    resolveShop({ contact_custom_attributes: { shop_domain: 12345 } }),
    '12345',
  );
});

// ---------------------------------------------------------------------------
// Intercom `user_id` as shop source. Many setups (including Staytuned's)
// store the myshopify domain in Intercom's "external user ID" field. We
// accept it only when it LOOKS LIKE a domain — so an Intercom install
// that uses user_id for internal customer IDs ("cust_12345") doesn't get
// those IDs surfaced as fake shops.
// ---------------------------------------------------------------------------

test('resolveShop: picks up myshopify domain from contact_user_id', () => {
  assert.equal(
    resolveShop({ contact_user_id: 'acme-store.myshopify.com' }),
    'acme-store.myshopify.com',
  );
});

test('resolveShop: contact_user_id falls behind custom attributes', () => {
  // If both are set, the explicit attribute wins — it's more specific.
  assert.equal(
    resolveShop({
      contact_custom_attributes: { shopify_domain: 'attr.myshopify.com' },
      contact_user_id: 'uid.myshopify.com',
    }),
    'attr.myshopify.com',
  );
});

test('resolveShop: contact_user_id beats company fallback', () => {
  assert.equal(
    resolveShop({
      contact_user_id: 'acme.myshopify.com',
      company_name: 'fallback',
    }),
    'acme.myshopify.com',
  );
});

test('resolveShop: ignores contact_user_id that does NOT look domain-shaped', () => {
  // Guard against surfacing internal IDs like "cust_12345" as shop values.
  assert.equal(resolveShop({ contact_user_id: 'cust_12345' }), null);
  assert.equal(resolveShop({ contact_user_id: '7891234' }), null);
  assert.equal(resolveShop({ contact_user_id: 'Bob Smith' }), null); // has space
  assert.equal(resolveShop({ contact_user_id: '' }), null);
});

test('resolveShop: accepts contact_user_id even if not strictly myshopify.com', () => {
  // Some setups store the shop's custom domain instead of the .myshopify one.
  // As long as it looks domain-shaped we surface it.
  assert.equal(
    resolveShop({ contact_user_id: 'acme.shop' }),
    'acme.shop',
  );
  assert.equal(
    resolveShop({ contact_user_id: 'www.acmestore.com' }),
    'www.acmestore.com',
  );
});
