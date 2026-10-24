// E.V. PWA demo Worker: one Cloudflare Worker for one person.
//   - The page's files (public/) are served by Cloudflare's static assets before this code runs.
//   - /api/db reads and writes the record in D1 (env.DB). Every /api call needs the token (env.EV_TOKEN).
// The record is one table: docs(c = collection, id, data = the document as JSON, at = when it last changed).
// No Claude calls in the demo: B-10 (no API key, no API billing) stays as it is.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // The one lock: the token you set with `wrangler secret put EV_TOKEN`.
    if (!env.EV_TOKEN || request.headers.get('authorization') !== 'Bearer ' + env.EV_TOKEN)
      return json({ error: 'wrong token' }, 401);

    // GET /api/db?since=<ms>: every document changed after `since` (0 = the whole record).
    if (url.pathname === '/api/db' && request.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      const { results } = await env.DB.prepare('SELECT c, id, data, at FROM docs WHERE at > ?').bind(since).all();
      return json({
        now: Date.now(),
        docs: results.map(r => ({ c: r.c, id: r.id, data: JSON.parse(r.data), at: r.at })),
      });
    }

    // PUT /api/db/<collection>/<id> with the whole document: saves it (the page merges updates before sending).
    const m = url.pathname.match(/^\/api\/db\/([^/]+)\/([^/]+)$/);
    if (m && request.method === 'PUT') {
      const data = await request.text();
      JSON.parse(data); // refuses anything that is not JSON
      const at = Date.now();
      await env.DB.prepare('INSERT OR REPLACE INTO docs (c, id, data, at) VALUES (?, ?, ?, ?)')
        .bind(decodeURIComponent(m[1]), decodeURIComponent(m[2]), data, at)
        .run();
      return json({ ok: true, at });
    }

    return json({ error: 'no such route' }, 404);
  },
};
