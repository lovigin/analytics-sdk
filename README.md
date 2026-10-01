# @lovigin/next

First-party, privacy-minimising page analytics for server-capable Next.js 16 sites. It does not use or change `proxy.ts` or its `config.matcher`.

If upgrading from 0.1, remove the old Lovigin import, `createLoviginAnalytics` setup, and `analytics.proxy(request, event)` call from your existing proxy. Keep your original proxy logic and matcher; the old proxy API is no longer exported.

## Install

```sh
npm install @lovigin/next@^0.4.0
```

Put the complete one-time token from your Lovigin dashboard in your site's **server** environment (not `NEXT_PUBLIC_`):

```dotenv
LOVIGIN_TOKEN=<site-id>.<ingest-key>
```

Create `app/api/lovigin/route.ts` (or `src/app/api/lovigin/route.ts` if you use `src/`):

```ts
import { createLoviginHandler } from '@lovigin/next';

export const POST = createLoviginHandler({
  token: process.env.LOVIGIN_TOKEN!,
  exclude: ['/account/**', '/reset-password', '/verify-email'],
});
```

Add the client component inside `<body>` in your existing root `app/layout.tsx`:

```tsx
import { LoviginAnalytics } from '@lovigin/next/client';

// Inside the existing root layout's <body>:
<LoviginAnalytics />
{children}
```

All rendered pages are counted by default. `exclude` can contain exact pages or whole sections ending in `/**`; the example excludes `/account` and every page below it. Always exclude sections with financial, account, recovery, or other sensitive content. The SDK never needs a list of included pages.

The browser converts the pathname to a route template using Next.js dynamic route parameters, then sends only that template to `/api/lovigin` on **your own domain**, without credentials or referrer. `/contacts` remains `/contacts`; `/blog/worthy` becomes `/blog/:slug`. If the SDK cannot safely determine a template, it sends `/other` instead of the raw address. Query strings, dynamic values, IP addresses, cookies, and referrers do not reach Lovigin. An initial rendered page and subsequent client-side navigations are counted; prefetches are not. The client does not set tracking identifiers or analytics storage.

Version 0.3 removes the required `routes` list from 0.2. Replace it with site-specific `exclude` entries when upgrading. `exclude` matches the route template, so exclude whole sensitive sections (for example `/account/**`) rather than one dynamic URL.

## Country totals

No additional configuration is needed. The server-side SDK reads Vercel's country header on Vercel, or performs an offline country-only GeoIP lookup using the rightmost IP appended by a reverse proxy such as Nginx. It never calls an external IP lookup API. If the host provides no usable visitor IP, the result is `ZZ` (unknown), not the server's country. Only the two-letter country code reaches Lovigin; the visitor IP is neither sent nor stored by Lovigin. The dashboard displays a country only once it has at least five views in the selected period; smaller groups are folded into unknown.

The SDK cannot authenticate arbitrary forwarding headers on every possible host. Keep the Next.js server behind a trusted reverse proxy that appends the connecting IP to `X-Forwarded-For` and do not expose its application port publicly. If a hosting platform does not provide a trustworthy client address, country detection remains unavailable rather than guessing. The offline lookup uses GeoLite2 data distributed by `geoip-country`; keep dependencies current. This product includes GeoLite2 data created by MaxMind, available from [maxmind.com](https://www.maxmind.com).

On a privacy page, explain this limited audience measurement and offer an objection control:

```tsx
import { LoviginOptOut } from '@lovigin/next/client';

<LoviginOptOut />
```

The control stores only a first-party opt-out preference cookie after a visitor clicks it. The client also honors Global Privacy Control when available. This preference is not used to identify visitors. No visitor IP address, user agent, cookies, full URL, or referrer is forwarded to Lovigin. The API receives only a day, safe route template, count, and optional country code; source and device remain unspecified defaults. The server logs failed delivery, but a failed or invalid analytics configuration does not break website pages. Counts can be lost when delivery fails.

No automatic scrubber can recognize every possible sensitive static path, rewrite, or custom URL scheme. Review your routes and use `exclude` for those sections. The safe `/other` fallback limits exposure but also combines those page counts in the dashboard.

This package does not certify that an entire site is legally banner-free. Review any other analytics, advertising, embeds, cookies, and applicable local rules. This version needs a Next.js server or serverless route handler; `output: 'export'` on a static-only host cannot run it. A site's existing CSP must allow same-origin requests (`connect-src 'self'` normally does).

## Publish to npm

The publishing account must own or have access to the `@lovigin` scope. From this `sdk/` directory:

```sh
npm login
npm whoami
npm test
npm pack --dry-run
npm publish --access public
```

For login use:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami
npm publish --access public
```

After publishing, verify `npm view @lovigin/next version`. Do not paste npm passwords, one-time codes, or access tokens into this project. A published name and version cannot be reused.
