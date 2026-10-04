import { randomUUID } from 'node:crypto';
import { ROUTE_PATTERN } from './route.js';
import { requestCountry } from './country.js';
import { sanitizeUtm, UTM_KEYS } from './utm.js';

const DEFAULT_API_URL = 'https://api.analytics.lovigin.com';

export type LoviginHandlerConfig = {
  token: string;
  /** Exact routes or section prefixes ending in /**, e.g. ['/web/**']. */
  exclude?: string[];
  apiUrl?: string;
};

function validTemplate(path: string): boolean {
  return path === '/' || (path.length <= 160 && ROUTE_PATTERN.test(path));
}

function normalizeExclusion(value: string): { path: string; prefix: boolean } {
  const prefix = value.endsWith('/**');
  const path = prefix ? value.slice(0, -3) : value;
  if (!validTemplate(path)) throw new Error(`Unsafe exclusion: ${value}`);
  return { path, prefix };
}

function isExcluded(path: string, exclusions: { path: string; prefix: boolean }[]): boolean {
  return exclusions.some(rule => rule.prefix
    ? path === rule.path || path.startsWith(`${rule.path}/`)
    : path === rule.path);
}

/** A standalone Next.js route handler. It never participates in proxy.ts. */
export function createLoviginHandler(config: LoviginHandlerConfig, fetchImpl: typeof fetch = fetch) {
  let cachedKeys: string[] = [];
  let cacheUntil = 0;
  async function enabledKeys(): Promise<string[]> {
    if (!connection) return [];
    if (Date.now() < cacheUntil) return cachedKeys;
    try {
      const url = new URL('/v1/config', connection.endpoint);
      url.searchParams.set('siteId', connection.siteId);
      const response = await fetchImpl(url.toString(), { headers: { 'x-lovigin-key': connection.ingestKey }, cache: 'no-store', signal: AbortSignal.timeout(1000) });
      if (!response.ok) throw new Error('Configuration unavailable');
      const data = await response.json() as { utmKeys?: unknown };
      const keys = data.utmKeys;
      cachedKeys = Array.isArray(keys) ? UTM_KEYS.filter(key => keys.includes(key)) : [];
      cacheUntil = Date.now() + 60000;
    } catch { cachedKeys = []; cacheUntil = Date.now() + 2000; }
    return cachedKeys;
  }
  let connection: { siteId: string; ingestKey: string; endpoint: string; exclusions: { path: string; prefix: boolean }[] } | undefined;
  try {
    if (config.exclude !== undefined && (!Array.isArray(config.exclude) || config.exclude.length > 200)) throw new Error('Provide at most 200 exclusions');
    const exclusions = (config.exclude ?? []).map(normalizeExclusion);
    const match = /^(c[a-z0-9]{20,35})\.([A-Za-z0-9_-]{43})$/.exec(config.token);
    if (!match) throw new Error('Invalid Lovigin token');
    const endpoint = new URL('/v1/aggregate', config.apiUrl ?? DEFAULT_API_URL).toString();
    connection = { siteId: match[1], ingestKey: match[2], endpoint, exclusions };
  } catch (error) {
    console.error(`[Lovigin Analytics] Disabled: ${(error as Error).message}`);
  }

  return async function POST(request: Request): Promise<Response> {
    if (!connection) return new Response(null, { status: 503 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return new Response(null, { status: 415 });
    const site = request.headers.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') return new Response(null, { status: 403 });
    const origin = request.headers.get('origin');
    if (origin) {
      try {
        const ownHost = request.headers.get('host') ?? new URL(request.url).host;
        if (new URL(origin).host !== ownHost) return new Response(null, { status: 403 });
      } catch {
        return new Response(null, { status: 403 });
      }
    }

    let input: unknown;
    try {
      const body = await request.text();
      if (body.length > 4096) return new Response(null, { status: 413 });
      input = JSON.parse(body);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return new Response(null, { status: 400 });
    const path = (input as { path?: unknown }).path;
    if (typeof path !== 'string' || !validTemplate(path)) return new Response(null, { status: 400 });
    if (isExcluded(path, connection.exclusions)) return new Response(null, { status: 204 });

    if ((input as { config?: unknown }).config === true) {
      return Response.json({ utmKeys: await enabledKeys() }, { headers: { 'cache-control': 'no-store' } });
    }
    const rawUtm = (input as { utm?: unknown }).utm;
    const utm = rawUtm ? sanitizeUtm(rawUtm, await enabledKeys()) : {};

    const country = await requestCountry(request);

    try {
      const response = await fetchImpl(connection.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-lovigin-key': connection.ingestKey },
        body: JSON.stringify({
          siteId: connection.siteId,
          batchId: randomUUID(),
          rows: [{ day: new Date().toISOString().slice(0, 10), event: 'page_view', label: '', path, source: 'direct', country, device: 'unknown', count: 1, ...(Object.keys(utm).length ? { utm } : {}) }]
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(3000)
      });
      if (!response.ok) console.error(`[Lovigin Analytics] Page view delivery failed: API returned ${response.status}`);
    } catch (error) {
      console.error(`[Lovigin Analytics] Page view delivery failed: ${(error as Error).message}`);
    }
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  };
}
