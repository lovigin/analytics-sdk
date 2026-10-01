export const ROUTE_PATTERN = /^\/(?:[a-z][a-z0-9_-]*|:[a-z][a-z0-9_-]*)(?:\/(?:[a-z][a-z0-9_-]*|:[a-z][a-z0-9_-]*))*$/;

type Params = Record<string, string | string[] | undefined> | null;

/** Never return a concrete dynamic value or a query string. */
export function safeRouteTemplate(pathname: string, params: Params): string {
  if (!params || !pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('?') || pathname.includes('#')) return '/other';
  if (pathname === '/') return '/';
  const rawParts = pathname.replace(/\/$/, '').slice(1).split('/');
  if (rawParts.length > 8) return '/other';
  let parts: string[];
  try {
    parts = rawParts.map(part => decodeURIComponent(part));
  } catch {
    return '/other';
  }
  if (parts.some(part => !part || part.includes('/'))) return '/other';

  for (const [name, value] of Object.entries(params)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) return '/other';
    if (value === undefined) return '/other';
    const values = Array.isArray(value) ? value : [value];
    if (!values.length || values.some(part => typeof part !== 'string' || !part)) return '/other';
    const matches: number[] = [];
    for (let start = 0; start <= parts.length - values.length; start++) {
      if (values.every((part, offset) => parts[start + offset] === part)) matches.push(start);
    }
    // Ambiguous matches cannot be safely assigned to a route parameter.
    if (matches.length !== 1) return '/other';
    for (let offset = 0; offset < values.length; offset++) parts[matches[0] + offset] = `:${name}`;
  }

  if (parts.some(part => !part.startsWith(':') && (part.length > 32 || /^[0-9a-f]{16,}$/i.test(part)))) return '/other';
  const route = `/${parts.join('/')}`;
  return route.length <= 160 && ROUTE_PATTERN.test(route) ? route : '/other';
}
