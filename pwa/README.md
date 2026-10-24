# E.V. PWA demo

A test of one question: does E.V. install as an app, with a Cloudflare Worker and a D1 database behind it? It runs
the real page on **made-up data** (the harnesses' synthetic record), at its own address. The live E.V. Home on
claude.ai, its record and its scheduled runs are not touched. Branch `pwa-demo` only.

```
phone (installed app) ──/api + token──► Worker ──► D1 (the record)
                      ◄── page files ──┘
```

- `worker.js`: the Worker. Serves `public/`, and `/api/db` (read changes, save a document). Every `/api` call needs
  the token.
- `bridge.js`: the shim. Gives the page the `window.claude.use('db' | 'user')` it has on claude.ai, backed by the
  Worker. Adapted from `test/harness/stub.js`.
- `sw.js`, `manifest.webmanifest`, `icon-*.png`: what makes it installable.
- `../tools/build-pwa.mjs`: builds `public/` from the normal build's staging page.

Not in the demo: Claude calls (B-10, no API key), scheduled runs, the Study Watch reader, your real record.

## Deploy (about 30 minutes, once)

On your Mac, in this folder (`pwa/`), with Node 22:

```
npm install
npx wrangler login                      # opens Cloudflare in the browser; make a free account if needed
npx wrangler d1 create ev-demo          # prints a database_id: paste it into wrangler.toml
npx wrangler d1 execute ev-demo --remote --file schema.sql
npm run seed
npx wrangler d1 execute ev-demo --remote --file seed.sql
npx wrangler secret put EV_TOKEN        # type a long password; this is your token
npm run deploy                          # prints https://ev-demo.<you>.workers.dev
```

Open that address on your phone, type the token, then install it: Safari → Share → Add to Home Screen (iPhone), or
the install prompt in Chrome (Android, desktop).

## After a UI change

`npm run deploy` again. The app picks the new version up the next time it opens.

## Try it locally (no Cloudflare account)

```
npm install && npm run build && npm run seed
npx wrangler d1 execute ev-demo --local --file schema.sql
npx wrangler d1 execute ev-demo --local --file seed.sql
echo 'EV_TOKEN=demo-token' > .dev.vars
npm run dev                             # http://localhost:8787, token demo-token
```

## Throwing it away

Delete the branch, then `npx wrangler delete` and `npx wrangler d1 delete ev-demo`. `main` never changed.
