# E.V., the app

E.V.'s one view (D-367): the page `node tools/build.mjs` writes, wrapped by a shim, served by a Cloudflare Worker
over a D1 database.

```
phone or browser (installed app) ──/api + token──► Worker ──► D1 (the record)
                                 ◄── page files ──┘
```

## What is here

- `worker.js`: the Worker and its routes. Serves `public/` and every `/api` call (each needs the token): `/api/db`
  (the page's reads and saves), `/api/claude` (adds the API key, a Cloudflare secret only, D-299), `/api/run/*`
  and `/api/backup/*`.
- `bridge.js`: the shim. Gives the page the `window.claude.use(...)` it expects, backed by the Worker.
- `runapi.js`: the run API, `GET /api/run/list`, `GET /api/run/get`, `POST /api/run/batch {writes}`: versioned
  documents, `if_version` as in ArtifactData, up to 50 writes landing whole or not at all, no deletes.
- `jobs.mjs`, `claude.js`, `planjob.js`: jobs the page starts run in the app; a study plan job runs in the
  `PlanJob` Durable Object (B-459), whose alarm gives it 15 minutes of wall time.
- `backup.js`: the nightly export of D1 to R2 on the Worker's cron, and `POST /api/backup/export`.
- `images.js`: photos and image-only PDF pages go to Claude as images; HEIC or over 3.5 MB is redrawn as JPEG.
- `sw.js`, `manifest.webmanifest`, the icons (`node tools/pwa-icons.mjs` remakes them): what makes it installable.
- `schema.sql`, `seed.mjs`: the D1 table and the made-up record staging is seeded with.
- `../tools/build-pwa.mjs --record staging|live`: builds `public/` from that record's built page.

## Staging and live

`wrangler.toml` names two Workers, each over its own D1, deployed only by GitHub Actions with `--env`:

- **ev-staging** (`--env staging`): `.github/workflows/pwa-staging.yml`, seeded with the made-up record only.
- **ev-live** (`--env live`): `.github/workflows/pwa-live.yml`, in the GitHub environment live, on Matt's OK only
  (`ship live --matt-ok`); never seeded.

The top-level Worker and its D1 are the local one: `wrangler dev`, the smoke and the run API suite use it.

## Local checks

`npm ci --prefix pwa`, then from the repository root:

- `npm run smoke:pwa`: boots the app's page through the shim against `wrangler dev` on a fresh local D1 holding the
  synthetic record, with a stub for `/api/claude`; checks boot, each tab, a save that survives a reload, a chat
  reply, a study session and an image attachment. The smoke workflow runs it on every push.
- `npm run test:run-api`: the run API suite against `wrangler dev`; pwa-staging runs it against staging too.
