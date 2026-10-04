'use client';

import { useParams, usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { safeRouteTemplate } from './route.js';
import { UTM_KEYS, utmFromSearch } from './utm.js';

const OPT_OUT_COOKIE = 'lovigin_analytics_opt_out';

function optedOut(): boolean {
  return document.cookie.split(';').some(part => part.trim() === `${OPT_OUT_COOKIE}=1`) ||
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/** Counts rendered page navigations, including client-side Next.js navigation. */
export function LoviginAnalytics({ endpoint = '/api/lovigin' }: { endpoint?: string }) {
  const pathname = usePathname();
  const params = useParams();
  const route = pathname ? safeRouteTemplate(pathname, params) : null;
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (!pathname || !route || pathname === lastPath.current) return;
    lastPath.current = pathname;
    if (optedOut()) return;
    const search = location.pathname === pathname ? location.search : '';
    void (async () => {
      let utm = {};
      if (UTM_KEYS.some(key => new URLSearchParams(search).has(key))) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: route, config: true }),
            credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(1500)
          });
          const config = await response.json() as { utmKeys?: unknown };
          if (Array.isArray(config.utmKeys)) utm = utmFromSearch(search, config.utmKeys);
        } catch { /* Configuration failure drops UTM, not the page view. */ }
      }
      if (optedOut()) return;
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: route, ...(Object.keys(utm).length ? { utm } : {}) }),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        keepalive: true
      });
    })().catch(() => { /* Analytics never affects the page. */ });
  }, [endpoint, pathname, route]);
  return null;
}

/** Place this button on the site's privacy page to offer an easy objection. */
export function LoviginOptOut() {
  const [disabled, setDisabled] = useState(false);
  useEffect(() => { setDisabled(optedOut()); }, []);

  function changePreference() {
    if (disabled) {
      document.cookie = `${OPT_OUT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    } else {
      document.cookie = `${OPT_OUT_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    }
    setDisabled(optedOut());
  }

  return <button type="button" onClick={changePreference} disabled={disabled && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true}>
    {disabled ? 'Enable anonymous analytics' : 'Disable anonymous analytics'}
  </button>;
}
