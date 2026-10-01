import { isIP } from 'node:net';

let lookupWarningShown = false;

function publicIp(value: string | null): string | undefined {
  if (!value) return;
  const ip = value.trim();
  const family = isIP(ip);
  if (!family) return;
  if (family === 4) {
    const [first, second] = ip.split('.').map(Number);
    if (first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)) return;
  } else {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return;
  }
  return ip;
}

function countryCode(value: string | null | undefined): string | undefined {
  const code = value?.toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : undefined;
}

/** Resolve locally on the site's server; never return or transmit the visitor IP. */
export async function requestCountry(request: Request): Promise<string> {
  // Vercel overwrites this header for requests to its functions.
  if (process.env.VERCEL === '1') {
    const country = countryCode(request.headers.get('x-vercel-ip-country'));
    if (country) return country;
  }

  // The rightmost forwarded address is the last address appended by the site's proxy.
  // Do not use the leftmost value: a visitor can prepend their own address.
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = publicIp(forwarded?.split(',').at(-1) ?? null);
  if (!ip) return 'ZZ';
  try {
    const geoip = await import('geoip-country');
    return countryCode(geoip.lookup(ip)?.country) ?? 'ZZ';
  } catch {
    if (!lookupWarningShown) {
      lookupWarningShown = true;
      console.warn('[Lovigin Analytics] Country lookup unavailable. In next.config, add geoip-country to serverExternalPackages, install dependencies, and rebuild the site. Page views are still counted with country ZZ.');
    }
    return 'ZZ';
  }
}
