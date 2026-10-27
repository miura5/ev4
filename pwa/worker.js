// E.V. PWA demo Worker: one Cloudflare Worker for one person.
//   - The page's files (public/) are served by Cloudflare's static assets before this code runs.
//   - /api/db reads and writes the record in D1 (env.DB). Every /api call needs the token (env.EV_TOKEN).
// The record is one table: docs(c = collection, id, data = the document as JSON, at = when it last changed).
//   - /api/claude asks Claude (Haiku) with the key the Worker holds as a secret (env.ANTHROPIC_API_KEY, D-299), within
//     an hourly and a daily token ceiling and the read-along limits (B-418, D-339: claude.js).
//   - B-389: a page save (PUT /api/db/<c>/<id>) carries the version it read, as the run API's if_version: a save to a
//     document that changed since is refused with 409 and the current version. The token is compared in constant time.
//   - /api/run/* is the run API (B-312, runapi.js): list, get and an all-or-nothing batch pinned to versions (v, one
//     more on every write, the page's saves here included). Nothing is ever deleted.
//   - B-316: a nightly export of D1 to R2 (backup.js) on the cron in wrangler.toml, and POST /api/backup/export to make
//     one now; GET /api/backup/newest names the newest export. Exports are never overwritten or deleted.
//   - B-398: every write (a page save here, a run API batch) stores the document in one canonical JSON form
//     (runapi.js canonicalJson), so a Mac backup and the R2 export of the same D1 hash the same.
import { handleRun, validCollection, validDocId, canonicalJson } from './runapi.js';
import { exportToR2, newestExport, EXPORT_PREFIX } from './backup.js';
import { tokenOk, ifVersionOf } from './guard.js';
import { writeProblem } from './notes.js';
import { handleClaude } from './claude.js';

const OVERLAP_MS = 5000;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  // B-316: the nightly export, where the Worker has a cron and an EXPORTS bucket (staging, wrangler.toml).
  async scheduled(event, env, ctx) {
    if (env.EXPORTS) ctx.waitUntil(exportToR2(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // The one lock: the token you set with `wrangler secret put EV_TOKEN`.
    // B-389: compared in constant time (tokenOk), never with !==.
    if (!(await tokenOk(request.headers.get('authorization'), env.EV_TOKEN)))
      return json({ error: 'wrong token' }, 401);

    if (url.pathname.startsWith('/api/run/')) return handleRun(request, env, url);

    // B-316: an export now (the staging proof), and the newest export's key. Counts and hashes only, never a document.
    if (url.pathname === '/api/backup/export' && request.method === 'POST') {
      if (!env.EXPORTS) return json({ error: 'no EXPORTS bucket on this Worker' }, 503);
      return json(await exportToR2(env));
    }
    if (url.pathname === '/api/backup/newest' && request.method === 'GET') {
      if (!env.EXPORTS) return json({ error: 'no EXPORTS bucket on this Worker' }, 503);
      return json({ key: await newestExport(env.EXPORTS) });
    }
    // B-317 (D-322): one export's body, read-only, for the restore drill's R2 source. Only keys under exports/.
    if (url.pathname === '/api/backup/get' && request.method === 'GET') {
      if (!env.EXPORTS) return json({ error: 'no EXPORTS bucket on this Worker' }, 503);
      const key = url.searchParams.get('key') || '';
      if (!key.startsWith(EXPORT_PREFIX) || key.includes('..')) return json({ error: 'key: an export key' }, 400);
      const obj = await env.EXPORTS.get(key);
      if (!obj) return json({ error: 'no such export' }, 404);
      return new Response(obj.body, { status: 200, headers: { 'content-type': 'application/json' } });
    }

    // GET /api/db?since=<ms>: every document changed after `since` (0 = the whole record).
    // B-324: `now`, the next since, is taken before the read and a few seconds back, so a save stamped just before the
    // read but landing after it is read again next time, never skipped (reading a document twice changes nothing).
    if (url.pathname === '/api/db' && request.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      const before = Date.now();
      const { results } = await env.DB.prepare('SELECT c, id, data, at, v FROM docs WHERE at > ?').bind(since).all();
      return json({
        now: Math.max(since, before - OVERLAP_MS),
        // B-389: each document's version, which the page's next save of it carries
        docs: results.map(r => ({ c: r.c, id: r.id, data: JSON.parse(r.data), at: r.at, v: r.v })),
      });
    }

    // PUT /api/db/<collection>/<id>?if_version=<n> with the whole document: saves it (the page merges updates before
    // sending), one version more, so a run pinned to the version it read sees the page's save (B-312). B-389: the save
    // carries the version the page read, as the run API's if_version: a document that exists is written only at that
    // version, a create carries none, and anything else writes nothing and answers 409 with the current version. Each
    // case is one statement, so the check and the write cannot be split by another save.
    const m = url.pathname.match(/^\/api\/db\/([^/]+)\/([^/]+)$/);
    if (m && request.method === 'PUT') {
      const want = ifVersionOf(url);
      if (want === undefined) return json({ error: 'if_version: a whole number from 1' }, 400);
      // B-398: stored in the one canonical form every write uses (runapi.js canonicalJson), whatever spacing or escapes
      // the body came with; anything that is not JSON, or holds a number JSON cannot, is refused.
      const body = canonicalJson(await request.text());
      if (body.error) return json({ error: body.error }, 400);
      const data = body.text;
      // B-319: the path carries both encoded (encodeURIComponent); decoded here, an id may hold a space but no "/".
      let c, id;
      try {
        c = decodeURIComponent(m[1]);
        id = decodeURIComponent(m[2]);
      } catch {
        return json({ error: 'the path is not encoded' }, 400);
      }
      if (!validCollection(c) || !validDocId(id)) return json({ error: 'not a collection and document id' }, 400);
      // B-401 (D-325): a note is checked whole (pwa/notes.js) against the version the save names; a save pinned to a
      // version the document no longer has falls through to the 409 below, since its UPDATE matches no row.
      if (c === 'notes') {
        const prev =
          want == null
            ? null
            : await env.DB.prepare('SELECT data FROM docs WHERE c = ? AND id = ? AND v = ?').bind(c, id, want).first();
        const bad = writeProblem(c, id, JSON.parse(data), prev ? JSON.parse(prev.data) : null);
        if (bad) return json({ error: bad + '; nothing was written', collection: c, doc_id: id }, 400);
      }
      const at = Date.now();
      const row =
        want == null
          ? await env.DB.prepare(
              'INSERT INTO docs (c, id, data, at, v) VALUES (?, ?, ?, ?, 1) ON CONFLICT (c, id) DO NOTHING RETURNING v'
            )
              .bind(c, id, data, at)
              .first()
          : await env.DB.prepare(
              'UPDATE docs SET data = ?, at = ?, v = v + 1 WHERE c = ? AND id = ? AND v = ? RETURNING v'
            )
              .bind(data, at, c, id, want)
              .first();
      if (row) return json({ ok: true, at, version: row.v });
      const now = await env.DB.prepare('SELECT v FROM docs WHERE c = ? AND id = ?').bind(c, id).first();
      const have = now ? now.v : null;
      return json(
        {
          error:
            have == null
              ? `${c}/${id} is pinned to version ${want}, but the document does not exist; nothing was written`
              : want == null
                ? `${c}/${id} exists at version ${have} and the save carries no version: read it first; nothing was written`
                : `${c}/${id} was read at version ${want}, but it is now at version ${have}; nothing was written`,
          collection: c,
          doc_id: id,
          if_version: want,
          current_version: have,
        },
        409
      );
    }

    // /api/claude (B-418, claude.js): one Claude API request on Haiku, with the key added here (D-299) and the model,
    // the length cap, the token ceilings and the read-along limits set here, not by the page (D-339).
    if (url.pathname === '/api/claude' || url.pathname === '/api/claude/usage' || url.pathname === '/api/claude/limits')
      return handleClaude(request, env, url);

    return json({ error: 'no such route' }, 404);
  },
};
