# E.V., the app

E.V. as an installable app (hand-off 3, B-309 onward): the page `node tools/build.mjs` writes, wrapped by a shim,
served by a Cloudflare Worker over a D1 database. It wraps the built page and never changes it: nothing here touches
`page/`, `test/harness/` or the styles. For now it runs on **made-up data** (the harnesses' synthetic record); the
live E.V. Home on claude.ai, its record and its scheduled runs are not touched. Proved first on the `pwa-demo` branch.

```
phone (installed app) ──/api + token──► Worker ──► D1 (the record)
                      ◄── page files ──┘
```

- `worker.js`: the Worker. Serves `public/`, and `/api/db` (read changes, save a document). Every `/api` call needs
  the token.
- `bridge.js`: the shim. Gives the page the `window.claude.use('db' | 'user')` it has on claude.ai, backed by the
  Worker. Adapted from `test/harness/stub.js`.
- `sw.js`, `manifest.webmanifest`, `icon-*.png`: what makes it installable.
- `../tools/build-pwa.mjs --record staging|live`: builds `public/` from that record's built page, wrapped byte for
  byte, with the app named "E.V." (window title and icon label).

- Claude: the shim's `sample` goes to the Worker's `/api/claude`, which adds your API key and asks Haiku (D-299: the key is only a Cloudflare secret, under a $5 monthly spend limit set in the Anthropic Console).
  The key is a Cloudflare secret: never in this repository, the page or a browser.

Images to Claude (B-322): a photo or an image-only PDF page attached in the conversation goes with the ask as a
base64 image block; a type the API does not take (an iPhone's HEIC photo) or one over 3.5 MB is redrawn as a JPEG first.

Not in the demo: scheduled runs, the Study Watch reader, your real record.
With no Study Watch reader a study session reads no note: it keeps time, and its questions come from your objectives
and weak spots (B-314).

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
npx wrangler secret put ANTHROPIC_API_KEY   # paste your key from console.anthropic.com
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
printf 'EV_TOKEN=demo-token\nANTHROPIC_API_KEY=<your key>\n' > .dev.vars
npm run dev                             # http://localhost:8787, token demo-token
```

## The smoke (B-313)

`npm ci --prefix pwa`, then `npm run smoke:pwa` from the repository root: the app's page boots through the shim against
`wrangler dev` on a fresh local D1 holding the synthetic record, with a stub answering `/api/claude`. It checks boot,
each tab, a check-off that survives a reload, a chat reply, and that a planted patient identifier is held by the page
with no call to `/api/claude`. B-314: a study session runs with no note (start, a break, +5 minutes, Quiz me now, end),
`use('mcp')` resolves null, and no request leaves the app (no Study Watch reader, no builder). The smoke workflow runs it on
every push, and once more with `--plant page-error` to prove it turns red. B-322: a photographed page attached in the conversation reaches `/api/claude` as an image, the
stub transcribes it and the reading is saved to the library in D1; a BMP is redrawn as a JPEG before it is sent.

## The demo's Worker

The demo's `ev-demo` Worker and D1 stay as they are, unused once the staging pair (B-311) exists; nothing is deleted.
