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

- Claude: the shim's `sample` goes to the Worker's `/api/claude`, which adds your API key and asks Haiku (D-299: the key is only a Cloudflare secret, under a $5 monthly spend limit set in the Anthropic Console). B-418 (D-339): the Worker also keeps an hourly and a daily token ceiling (`claude.js`, counted from the API's usage numbers in D1's `claude_usage`; `CLAUDE_HOUR_TOKENS` and `CLAUDE_DAY_TOKENS` override the defaults) and read-along's limits (new text only, one read per note per 75 s, `claude_reads`); `GET /api/claude/usage` reads the counts.
  The key is a Cloudflare secret: never in this repository, the page or a browser.

Images to Claude (B-322): a photo or an image-only PDF page attached in the conversation goes with the ask as a
base64 image block; a type the API does not take (an iPhone's HEIC photo) or one over 3.5 MB is redrawn as a JPEG first.

Not in the demo: scheduled runs, the Study Watch reader, your real record. Jobs run in the app itself (B-324).
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
each tab, a check-off that survives a reload, and a chat reply. B-314: a study session runs with no note (start, a break, +5 minutes, Quiz me now, end),
`use('mcp')` resolves null, and no request leaves the app (no Study Watch reader, no builder). The smoke workflow runs it on
every push, and once more with `--plant page-error` to prove it turns red. B-322: a photographed page attached in the conversation reaches `/api/claude` as an image, the
stub transcribes it and the reading is saved to the library in D1; a BMP is redrawn as a JPEG before it is sent.

## The run API (B-312)

`runapi.js`, behind the same token: `GET /api/run/list?collection=<c>&limit=&cursor=`, `GET /api/run/get?collection=<c>&doc_id=<id>`
and `POST /api/run/batch {writes}`, the calls a run makes in place of ArtifactData's. Every document has a version (1
when created, one more on each write, the page's saves included), and `if_version` means what it means in
ArtifactData: a write to a document that exists names the version it read, and a stale one writes nothing and names
the conflict. A batch of up to 50 writes lands whole or not at all. A delete is refused. `npm run test:run-api` runs
its suite against `wrangler dev` on a fresh local D1; the pwa-staging workflow adds the version column to the staging
D1 once and runs the same suite against the staging Worker, writing only into the suite's own `runapi-suite`
collection.

## Jobs through the API (B-324, D-308)

A job the page starts (a study guide, a practice set, an exam plan, a retro, a clinical prep, a background task) runs at
once, in the app, instead of waiting on the scheduled worker. The page saves `jobs/<id>` and asks to fire the worker;
with no mcp that ask finds none, and for a worker kind the shim records the hand-off as made and hands the job to
`jobs.mjs`. It builds the job's brief with the worker pipeline's own code step (the kind's guide, with the passages,
objectives, weak spots and dates core gathers), asks Haiku once through `/api/claude` with the do-job answer shape as a
tool, and checks the reply as the worker run does: its shape, the job-result fold, each write's
schema, writers and size. A reply that fails any of them writes nothing it made; the job is marked failed with the
reason, to try again. What passes goes to D1 through the run API (`jobresults/<id>`, what the job made, one message in
`talk/<date>`), pinned to versions. Two kinds
differ from claude.ai: a study guide is saved in E.V. (its text in the job's result and message), not as a Claude Doc;
a shareable practice page is published on claude.ai only, so the app says so. Builder kinds stay off the app (D-304).
In the browser the runner and the core modules it imports are served as ES modules (`build-pwa` copies them, with
`jobs-spec.json`, the spec sections and schemas it reads); `node-fs.mjs` and `node-path.mjs` stand in for node's.
The smoke starts one job of each kind from the conversation; the pwa-staging workflow with `jobs: true` runs one real
Haiku job of each kind on staging (`tools/pwa-jobs.mjs`) and reads it back from the staging D1.

## The demo's Worker

The demo's `ev-demo` Worker and D1 stay as they are, unused once the staging pair (B-311) exists; nothing is deleted.
