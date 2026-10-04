import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoviginHandler } from '../src/index.js';

const siteId = 'cm12345678901234567890';
const token = `${siteId}.${'a'.repeat(43)}`;
const config = { token, routes: ['/', '/pricing', '/blog/:slug'] };

function request(path: unknown, headers: Record<string, string> = {}) {
  return new Request('https://example.com/api/lovigin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://example.com', ...headers },
    body: JSON.stringify({ path })
  });
}

test('sends only an allowlisted route template, without visitor headers or dynamic path', async () => {
  let endpoint = '';
  let body = '';
  let headers = new Headers();
  const handler = createLoviginHandler(config, async (input, init) => {
    endpoint = String(input);
    body = String(init?.body);
    headers = new Headers(init?.headers);
    return new Response(null, { status: 202 });
  });
  const response = await handler(request('/blog/alice@example.com', { cookie: 'secret=1', 'user-agent': 'Private Agent', 'x-forwarded-for': '192.0.2.1' }));
  assert.equal(response.status, 204);
  assert.equal(endpoint, 'https://api.analytics.lovigin.com/v1/aggregate');
  assert.equal(headers.get('x-lovigin-key'), 'a'.repeat(43));
  assert.equal(headers.get('cookie'), null);
  assert.equal(headers.get('user-agent'), null);
  const parsed = JSON.parse(body);
  assert.equal(parsed.siteId, siteId);
  assert.deepEqual(parsed.rows[0], { day: new Date().toISOString().slice(0, 10), event: 'page_view', label: '', path: '/blog/:slug', source: 'direct', country: 'ZZ', device: 'unknown', count: 1 });
  assert.doesNotMatch(body, /alice|secret|192\.0\.2\.1|Private Agent/);
});

test('ignores routes not explicitly listed and rejects cross-site requests', async () => {
  let calls = 0;
  const handler = createLoviginHandler(config, async () => { calls++; return new Response(null, { status: 202 }); });
  assert.equal((await handler(request('/account/123'))).status, 204);
  assert.equal((await handler(request('/pricing', { origin: 'https://attacker.example' }))).status, 403);
  assert.equal((await handler(request('/pricing', { 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal(calls, 0);
});

test('rejects query strings and malformed input without sending', async () => {
  let calls = 0;
  const handler = createLoviginHandler(config, async () => { calls++; return new Response(null, { status: 202 }); });
  assert.equal((await handler(request('/pricing?email=alice@example.com'))).status, 400);
  assert.equal((await handler(request('https://example.com/pricing'))).status, 400);
  assert.equal((await handler(new Request('https://example.com/api/lovigin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status, 400);
  assert.equal(calls, 0);
});

test('bad configuration and failed delivery never break the page', async () => {
  const messages: string[] = [];
  const original = console.error;
  console.error = (message: string) => { messages.push(message); };
  try {
    const disabled = createLoviginHandler({ token: 'invalid', routes: ['/'] });
    assert.equal((await disabled(request('/'))).status, 503);
    const failing = createLoviginHandler(config, async () => new Response(null, { status: 401 }));
    assert.equal((await failing(request('/pricing'))).status, 204);
    assert.match(messages.join('\n'), /Invalid Lovigin token/);
    assert.match(messages.join('\n'), /API returned 401/);
  } finally {
    console.error = original;
  }
});
