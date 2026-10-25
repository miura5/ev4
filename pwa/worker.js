// E.V. PWA demo Worker: one Cloudflare Worker for one person.
//   - The page's files (public/) are served by Cloudflare's static assets before this code runs.
//   - /api/db reads and writes the record in D1 (env.DB). Every /api call needs the token (env.EV_TOKEN).
// The record is one table: docs(c = collection, id, data = the document as JSON, at = when it last changed).
//   - /api/claude asks Claude (Haiku) with the key the Worker holds as a secret (env.ANTHROPIC_API_KEY, D-299).
//   - /api/run/* is the run API (B-312, runapi.js): list, get and an all-or-nothing batch pinned to versions (v, one
//     more on every write, the page's saves here included). Nothing is ever deleted.
import { handleRun } from './runapi.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // The one lock: the token you set with `wrangler secret put EV_TOKEN`.
    if (!env.EV_TOKEN || request.headers.get('authorization') !== 'Bearer ' + env.EV_TOKEN)
      return json({ error: 'wrong token' }, 401);

    if (url.pathname.startsWith('/api/run/')) return handleRun(request, env, url);

    // GET /api/db?since=<ms>: every document changed after `since` (0 = the whole record).
    if (url.pathname === '/api/db' && request.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      const { results } = await env.DB.prepare('SELECT c, id, data, at FROM docs WHERE at > ?').bind(since).all();
      return json({
        now: Date.now(),
        docs: results.map(r => ({ c: r.c, id: r.id, data: JSON.parse(r.data), at: r.at })),
      });
    }

    // PUT /api/db/<collection>/<id> with the whole document: saves it (the page merges updates before sending), one
    // version more, so a run pinned to the version it read sees the page's save (B-312).
    const m = url.pathname.match(/^\/api\/db\/([^/]+)\/([^/]+)$/);
    if (m && request.method === 'PUT') {
      const data = await request.text();
      JSON.parse(data); // refuses anything that is not JSON
      const at = Date.now();
      await env.DB.prepare(
        'INSERT INTO docs (c, id, data, at, v) VALUES (?, ?, ?, ?, 1) ON CONFLICT (c, id) DO UPDATE SET data = excluded.data, at = excluded.at, v = docs.v + 1'
      )
        .bind(decodeURIComponent(m[1]), decodeURIComponent(m[2]), data, at)
        .run();
      return json({ ok: true, at });
    }

    // POST /api/claude with {messages, tools?, tool_choice?}: one Claude API request on Haiku. The key is added here
    // and never leaves Cloudflare (D-299); the model and the length cap are set here, not by the page.
    if (url.pathname === '/api/claude' && request.method === 'POST') {
      if (!env.ANTHROPIC_API_KEY) return json({ error: 'no ANTHROPIC_API_KEY secret on the Worker' }, 503);
      const { messages, tools, tool_choice } = await request.json();
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: env.CLAUDE_MODEL || 'claude-haiku-5-5',
          max_tokens: 4096,
          messages,
          ...(tools && tools.length ? { tools, ...(tool_choice ? { tool_choice } : {}) } : {}),
        }),
      });
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
    }

    return json({ error: 'no such route' }, 404);
  },
};
