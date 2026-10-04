export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
export type UtmKey = typeof UTM_KEYS[number];

export function sanitizeUtm(input: unknown, enabled: readonly string[]): Partial<Record<UtmKey, string>> {
  const result: Partial<Record<UtmKey, string>> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  for (const key of UTM_KEYS) {
    if (!enabled.includes(key)) continue;
    const raw = (input as Record<string, unknown>)[key];
    if (typeof raw !== 'string' || raw.length > 96) continue;
    const value = raw.normalize('NFKC').trim().toLowerCase().replace(/ +/g, ' ');
    if (!value || value.length > 96 || !/^[\p{L}\p{N} _.-]+$/u.test(value) || /\d{7,}/.test(value) || /^[\d ._-]+$/.test(value)) continue;
    result[key] = value;
  }
  return result;
}

export function utmFromSearch(search: string, enabled: readonly string[]) {
  const params = new URLSearchParams(search);
  const values: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    if (enabled.includes(key) && params.getAll(key).length === 1) values[key] = params.get(key)!;
  }
  return sanitizeUtm(values, enabled);
}
