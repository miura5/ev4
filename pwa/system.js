// B-473 (D-367): the system documents a scheduled run bootstraps from, held by the Worker instead of the claude.ai
// record. The deploy workflow (pwa-staging.yml, pwa-live.yml) puts the build's documents here after it deploys
// (tools/pwa-system.mjs put); a run gets system/manifest here before its gate checks the commit out.
//   GET /api/run/system/<name>   the document as stored, or 404
//   PUT /api/run/system/<name>   the whole document (the workflow's write; one row per name, replaced each deploy)
// Behind the Worker's one token like every /api route (guard.js tokenOk, in worker.js). The table is system_docs, apart
// from docs, so the page's sync, the run API's list and batch, the backups and the copy never see or touch it.
import { canonicalJson } from './runapi.js';

/** The documents the Worker holds for runs and ship: built by tools/build.mjs (manifest, spec, environments) and the
 *  Chart's Your turn (tools/pwa-system.mjs). */
export const SYSTEM_NAMES = ['manifest', 'spec', 'environments', 'yourturn'];
/** Under D1's 2 MB row; system/spec is about 200 KB. */
export const MAX_SYSTEM = 1536 * 1024;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The system route, or null when the path is not one. */
export async function handleSystem(request, env, url) {
  const m = url.pathname.match(/^\/api\/run\/system\/([^/]+)$/);
  if (!m) return null;
  const name = m[1];
  if (!SYSTEM_NAMES.includes(name)) return json({ error: `not a system document: ${SYSTEM_NAMES.join(', ')}` }, 404);
  if (request.method === 'GET') {
    const r = await env.DB.prepare('SELECT data, at FROM system_docs WHERE name = ?').bind(name).first();
    if (!r) return json({ error: 'not found', name }, 404);
    return new Response(r.data, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (request.method === 'PUT') {
    const text = await request.text();
    if (text.length > MAX_SYSTEM) return json({ error: 'the document is over 1.5 MiB' }, 413);
    const body = canonicalJson(text);
    if (body.error) return json({ error: body.error }, 400);
    const at = Date.now();
    await env.DB.prepare(
      'INSERT INTO system_docs (name, data, at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET data = excluded.data, at = excluded.at'
    )
      .bind(name, body.text, at)
      .run();
    return json({ ok: true, name, at, bytes: body.text.length });
  }
  return json({ error: 'GET or PUT' }, 405);
}
