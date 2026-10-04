import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLoviginHandler } from '../src/index.js';
import { sanitizeUtm, utmFromSearch, UTM_KEYS } from '../src/utm.js';

const token = 'cm12345678901234567890.' + 'a'.repeat(43);
const request = (body: unknown) => new Request('https://example.com/api/lovigin', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: JSON.stringify(body) });

test('collects only enabled UTM fields, not click IDs or repeated parameters', () => {
  assert.deepEqual(utmFromSearch('?utm_source=Google&utm_campaign=summer-sale&gclid=secret&utm_content=a&utm_content=b', ['utm_source', 'utm_content']), { utm_source: 'google' });
  assert.deepEqual(utmFromSearch('?utm_source=google', []), {});
});
test('rejects obvious personal formats, URLs, long values and numeric identifiers', () => {
  for (const value of ['alice@example.com', 'https://example.com', 'user_12345678', '+1234567890', 'a'.repeat(97), '1234']) {
    assert.deepEqual(sanitizeUtm({ utm_term: value }, UTM_KEYS), {});
  }
  assert.deepEqual(sanitizeUtm({ utm_term: '  Swift   SDK ' }, UTM_KEYS), { utm_term: 'swift sdk' });
});
test('configuration handshake does not count views or expose credentials', async () => {
  const calls: string[] = [];
  const handler = createLoviginHandler({ token }, (async url => { calls.push(String(url)); return Response.json({ utmKeys: ['utm_source', 'unknown'] }); }) as typeof fetch);
  const response = await handler(request({ path: '/', config: true }));
  assert.deepEqual(await response.json(), { utmKeys: ['utm_source'] });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('/v1/config'));
});
test('server filters disabled fields and sends one page view', async () => {
  const batches: any[] = [];
  const handler = createLoviginHandler({ token }, (async (url, init) => {
    if (String(url).includes('/v1/config')) return Response.json({ utmKeys: ['utm_campaign'] });
    batches.push(JSON.parse(String(init?.body)));
    return Response.json({ accepted: 1 });
  }) as typeof fetch);
  await handler(request({ path: '/', utm: { utm_campaign: 'Summer-Sale', utm_source: 'google', gclid: 'secret' } }));
  assert.equal(batches.length, 1);
  assert.equal(batches[0].rows[0].count, 1);
  assert.deepEqual(batches[0].rows[0].utm, { utm_campaign: 'summer-sale' });
});
test('configuration failure drops UTM without losing the view', async () => {
  const batches: any[] = [];
  const handler = createLoviginHandler({ token }, (async (url, init) => {
    if (String(url).includes('/v1/config')) throw new Error('Offline');
    batches.push(JSON.parse(String(init?.body)));
    return Response.json({ accepted: 1 });
  }) as typeof fetch);
  await handler(request({ path: '/', utm: { utm_source: 'google' } }));
  assert.equal(batches.length, 1);
  assert.equal(batches[0].rows[0].utm, undefined);
});
