# Deploy

PromptAlong is a static single-page app on Vercel (Hobby) with a Supabase project (Free) behind
it. Nothing on either side costs money; keep it that way.

## How a change reaches production

1. Open a pull request. CI runs every gate (see the README) and Vercel builds a preview.
2. Merge to `main`. Vercel builds `main` and serves it at the production address.
3. Database changes are SQL files in `supabase/migrations`. Apply them to the hosted project
   before merging code that needs them (SQL Editor, in file order), as described in
   [database.md](database.md).

## Settings on Vercel

| Setting               | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| Root directory        | `apps/web`                                                         |
| Framework             | Vite                                                               |
| Environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public by design)   |
| Optional              | `VITE_SITE_URL` - public address used in link previews (see below) |

`apps/web/vercel.json` holds the SPA rewrite, the cache rule for `/assets/*` and the security
headers. `vite preview` reads the same file, so the end-to-end tests run under the same policy.

## Checks after a deploy

```bash
curl -sI https://promptalong.vercel.app/demo | grep -iE 'content-security|x-frame|strict-transport'
```

Then open the site with the browser console open: landing, `/demo` until "Your turn", a new room
with one Send, `/about`. There should be no Content-Security-Policy messages.

## Moving to an own domain

The app does not depend on its address. To serve it at, for example,
`promptalong.example.com`:

1. Vercel > Project > Settings > Domains: add the domain; Vercel shows the DNS record it needs.
2. At the DNS host: add that record (a `CNAME` to Vercel for a subdomain).
3. Vercel > Settings > Environment Variables: set `VITE_SITE_URL` to the new address (Production),
   then redeploy so link previews use it.
4. Supabase > Authentication > URL Configuration: add the new address to the redirect URLs (only
   needed if email or GitHub sign-in is ever turned on; anonymous sign-in does not use it).
5. Keep the old `*.vercel.app` address working; it is free and old links keep opening.

## Free-tier limits to watch

- Supabase pauses a free project after a week without requests; open the dashboard and restore it
  ([database.md](database.md)). Realtime: 200 concurrent connections and 100 messages per second;
  edits are batched to stay well below that.
- Anonymous sign-ins are rate-limited per IP (set to 200 an hour); raise it before an event where
  many people share one Wi-Fi.
- Vercel Hobby: 100 GB bandwidth a month; the app's first load is about 105 KB of JavaScript.
