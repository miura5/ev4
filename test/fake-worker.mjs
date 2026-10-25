// A stand-in for the Worker's run API (pwa/runapi.js) for test/run-worker.test.mjs: the same routes, token and
// version rules (checkWrites, planBatch), over an in-memory record. Not a test file. Run as a child process, since a
// run's api command calls curl synchronously: node test/fake-worker.mjs <token> <seed dir|-> prints "port <n>".
// GET /_dump returns the whole store and /_bump?c=&id= edits a document's version (no token), for the test.
import http from 'node:http';
import { readExport } from '../core/schemas.mjs';
import { checkWrites, planBatch, encodeCursor, decodeCursor } from '../pwa/runapi.js';
import { manifestOf, EXPORT_KIND, perTarget } from '../pwa/backup.js';

const [token, seed] = process.argv.slice(2);
// Two databases on one port, by the Host header's first label (B-317): ev-staging-scratch.* is the drill's scratch D1,
// anything else the record. "c\nid" -> {v, data}
const main = new Map();
const scratch = new Map();
if (seed && seed !== '-')
  for (const { collection, id, doc } of readExport(seed)) main.set(collection + '\n' + id, { v: 1, data: doc });

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const server = http.createServer((req, res) => {
  let text = '';
  req.on('data', c => (text += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const store =
      String(req.headers.host || '').startsWith('ev-staging-scratch.') || url.searchParams.get('store') === 'scratch'
        ? scratch
        : main;
    if (url.pathname === '/_dump')
      return send(res, 200, Object.fromEntries([...store].map(([k, v]) => [k.replace('\n', '/'), v])));
    if (url.pathname === '/_bump') {
      const k = url.searchParams.get('c') + '\n' + url.searchParams.get('id');
      store.get(k).v++;
      return send(res, 200, { v: store.get(k).v });
    }
    if (req.headers.authorization !== 'Bearer ' + token) return send(res, 401, { error: 'wrong token' });
    // The R2 export routes (B-316, B-317), over the record as it is now.
    if (url.pathname === '/api/backup/newest') return send(res, 200, { key: 'exports/2026-10-25/now.json' });
    if (url.pathname === '/api/backup/get') {
      const docs = [...main]
        .filter(([k]) => !perTarget(k.split('\n')[0], k.split('\n')[1])) // as exportToR2 (D-321)
        .map(([k, v]) => ({ c: k.split('\n')[0], id: k.split('\n')[1], data: JSON.stringify(v.data), at: 0, v: v.v }));
      return manifestOf(docs).then(collections =>
        send(res, 200, { schema: 1, kind: EXPORT_KIND, at: '2026-10-25T00:00:00.000Z', collections, docs })
      );
    }
    const route = url.pathname.replace('/api/run/', '');
    if (route === 'collections') {
      const n = {};
      for (const k of store.keys()) n[k.split('\n')[0]] = (n[k.split('\n')[0]] || 0) + 1;
      return send(res, 200, {
        collections: Object.keys(n)
          .sort()
          // a collection named cutshort counts one more than it holds: a page the Worker cut (the dump's test)
          .map(c => ({ collection: c, count: n[c] + (c === 'cutshort' ? 1 : 0) })),
      });
    }
    if (route === 'list') {
      const c = url.searchParams.get('collection');
      const limit = Number(url.searchParams.get('limit') || 100);
      const after = url.searchParams.get('cursor') ? decodeCursor(url.searchParams.get('cursor')) : '';
      const ids = [...store.keys()]
        .filter(k => k.startsWith(c + '\n'))
        .map(k => k.slice(c.length + 1))
        .filter(id => id > after)
        .sort();
      const page = ids.slice(0, limit);
      return send(res, 200, {
        collection: c,
        documents: page.map(id => ({ id, version: store.get(c + '\n' + id).v, data: store.get(c + '\n' + id).data })),
        next_cursor: ids.length > limit ? encodeCursor(page[page.length - 1]) : null,
      });
    }
    if (route === 'batch' && req.method === 'POST') {
      const { writes } = JSON.parse(text);
      const wall = checkWrites(writes);
      if (wall) return send(res, wall.status, { error: wall.error, entry: wall.entry });
      const plan = planBatch(writes, store);
      if (!plan.ok) {
        const { ok, status, ...rest } = plan;
        return send(res, status, rest);
      }
      for (const r of plan.rows) store.set(r.c + '\n' + r.id, { v: r.v, data: r.data });
      return send(res, 200, {
        ok: true,
        results: plan.rows.map(r => ({ collection: r.c, doc_id: r.id, version: r.v })),
      });
    }
    send(res, 404, { error: 'no such run route' });
  });
});
server.listen(0, '127.0.0.1', () => console.log('port ' + server.address().port));
