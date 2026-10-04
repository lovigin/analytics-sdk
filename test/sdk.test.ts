import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoviginHandler } from '../src/index.js';
import { safeRouteTemplate } from '../src/route.js';

const siteId = 'cm12345678901234567890';
const token = `${siteId}.${'a'.repeat(43)}`;
const config = { token, exclude: ['/web/**', '/reset-password', '/verify-email'] };

function request(path: unknown, headers: Record<string, string> = {}) {
  return new Request('https://example.com/api/lovigin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://example.com', ...headers },
    body: JSON.stringify({ path })
  });
}

test('static pages keep their names and dynamic values become route parameters', () => {
  assert.equal(safeRouteTemplate('/', {}), '/');
  assert.equal(safeRouteTemplate('/contacts', {}), '/contacts');
  assert.equal(safeRouteTemplate('/legal/privacy', {}), '/legal/privacy');
  assert.equal(safeRouteTemplate('/blog/alice%40example.com', { slug: 'alice@example.com' }), '/blog/:slug');
  assert.equal(safeRouteTemplate('/docs/one/two', { slug: ['one', 'two'] }), '/docs/:slug/:slug');
});

test('ambiguous or unsafe addresses fall back to one aggregate bucket', () => {
  assert.equal(safeRouteTemplate('/blog/blog', { slug: 'blog' }), '/other');
  assert.equal(safeRouteTemplate('/alice@example.com', {}), '/other');
  assert.equal(safeRouteTemplate('/pricing?token=secret', {}), '/other');
  assert.equal(safeRouteTemplate('/reset/0123456789abcdef0123456789abcdef', {}), '/other');
  assert.equal(safeRouteTemplate('/blog/%ZZ', { slug: '%ZZ' }), '/other');
  assert.equal(safeRouteTemplate('/blog/secret', null), '/other');
});

test('sends page templates by default without visitor headers or dynamic values', async () => {
  const bodies: string[] = [];
  let headers = new Headers();
  const handler = createLoviginHandler(config, async (input, init) => {
    assert.equal(String(input), 'https://api.analytics.lovigin.com/v1/aggregate');
    bodies.push(String(init?.body));
    headers = new Headers(init?.headers);
    return new Response(null, { status: 202 });
  });
  assert.equal((await handler(request('/'))).status, 204);
  assert.equal((await handler(request('/contacts'))).status, 204);
  assert.equal((await handler(request('/blog/:slug', { cookie: 'secret=1', 'user-agent': 'Private Agent', 'x-forwarded-for': '192.0.2.1' }))).status, 204);
  assert.equal(headers.get('x-lovigin-key'), 'a'.repeat(43));
  assert.equal(headers.get('cookie'), null);
  assert.equal(headers.get('user-agent'), null);
  assert.deepEqual(bodies.map(body => JSON.parse(body).rows[0].path), ['/', '/contacts', '/blog/:slug']);
  assert.doesNotMatch(bodies.join('\n'), /alice|secret|192\.0\.2\.1|Private Agent/);
});

test('excludes exact pages and whole sections without changing other pages', async () => {
  const paths: string[] = [];
  const handler = createLoviginHandler(config, async (_input, init) => {
    paths.push(JSON.parse(String(init?.body)).rows[0].path);
    return new Response(null, { status: 202 });
  });
  for (const path of ['/web', '/web/account', '/web/:id', '/reset-password', '/verify-email']) {
    assert.equal((await handler(request(path))).status, 204);
  }
  assert.equal((await handler(request('/blog'))).status, 204);
  assert.deepEqual(paths, ['/blog']);
});

test('resolves country locally from the proxy-appended IP without forwarding visitor identifiers', async () => {
  let upstream = '';
  let upstreamHeaders = new Headers();
  const handler = createLoviginHandler({ token }, async (_input, init) => {
    upstream = String(init?.body);
    upstreamHeaders = new Headers(init?.headers);
    return new Response(null, { status: 202 });
  });
  assert.equal((await handler(request('/contacts', { 'x-forwarded-for': '203.0.113.1, 8.8.8.8', cookie: 'private=1' }))).status, 204);
  assert.equal(JSON.parse(upstream).rows[0].country, 'US');
  assert.equal(upstreamHeaders.get('x-forwarded-for'), null);
  assert.equal(upstreamHeaders.get('cookie'), null);
  assert.doesNotMatch(upstream, /203\.0\.113\.1|8\.8\.8\.8|private=1/);
});

test('missing or private proxy address falls back to unknown', async () => {
  const countries: string[] = [];
  const handler = createLoviginHandler({ token }, async (_input, init) => {
    countries.push(JSON.parse(String(init?.body)).rows[0].country);
    return new Response(null, { status: 202 });
  });
  for (const headers of [{}, { 'x-forwarded-for': '127.0.0.1' }, { 'x-forwarded-for': '8.8.8.8, 127.0.0.1' }]) {
    assert.equal((await handler(request('/', headers))).status, 204);
  }
  assert.deepEqual(countries, ['ZZ', 'ZZ', 'ZZ']);
});

test('rejects raw sensitive paths, malformed input, and cross-site requests', async () => {
  let calls = 0;
  const handler = createLoviginHandler(config, async () => { calls++; return new Response(null, { status: 202 }); });
  assert.equal((await handler(request('/blog/alice@example.com'))).status, 400);
  assert.equal((await handler(request('/pricing?email=alice@example.com'))).status, 400);
  assert.equal((await handler(request('/pricing', { origin: 'https://attacker.example' }))).status, 403);
  assert.equal((await handler(request('/pricing', { 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal((await handler(new Request('https://example.com/api/lovigin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status, 400);
  assert.equal(calls, 0);
});

test('bad configuration and failed delivery never break the page', async () => {
  const messages: string[] = [];
  const original = console.error;
  console.error = (message: string) => { messages.push(message); };
  try {
    const disabled = createLoviginHandler({ token: 'invalid' });
    assert.equal((await disabled(request('/'))).status, 503);
    const failing = createLoviginHandler(config, async () => new Response(null, { status: 401 }));
    assert.equal((await failing(request('/pricing'))).status, 204);
    assert.match(messages.join('\n'), /Invalid Lovigin token/);
    assert.match(messages.join('\n'), /API returned 401/);
  } finally {
    console.error = original;
  }
});
