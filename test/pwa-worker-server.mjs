// B-398: the real Worker (pwa/worker.js) served over HTTP for a test, over an in-memory SQLite standing in for D1 and a
// Map standing in for the R2 bucket. Not a test file. Run as a child process, since the Mac backup's dump
// (core/d1backup.mjs dumpD1) calls curl synchronously: node test/pwa-worker-server.mjs <token> prints "port <n>".
// GET /_rows (no token) returns D1's rows exactly as stored, for the test.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../pwa/worker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [token] = process.argv.slice(2);

const sql = new DatabaseSync(':memory:');
sql.exec(fs.readFileSync(path.join(ROOT, 'pwa/schema.sql'), 'utf8'));
const stmt = (q, args = []) => ({
  bind: (...a) => stmt(q, a),
  first: async () => sql.prepare(q).get(...args) ?? null,
  all: async () => ({ results: sql.prepare(q).all(...args) }),
  run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...args).changes) } }),
});
const DB = {
  prepare: q => stmt(q),
  // D1's batch is one transaction: a failed statement rolls the whole batch back.
  batch: async list => {
    sql.exec('BEGIN');
    try {
      const out = [];
      for (const s of list) out.push(await s.all());
      sql.exec('COMMIT');
      return out;
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  },
};
const objects = new Map();
const EXPORTS = {
  objects,
  head: async k => (objects.has(k) ? { key: k } : null),
  get: async k => (objects.has(k) ? { body: objects.get(k) } : null),
  put: async (k, body) => void objects.set(k, body),
  list: async ({ prefix = '' } = {}) => ({
    objects: [...objects.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })),
    truncated: false,
  }),
};
const env = { EV_TOKEN: token, DB, EXPORTS, ASSETS: { fetch: () => new Response('') } };

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    try {
      if (req.url === '/_rows') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(sql.prepare('SELECT c, id, data, v FROM docs ORDER BY c, id').all()));
      }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await worker.fetch(
        new Request('http://' + (req.headers.host || 'localhost') + req.url, {
          method: req.method,
          headers: req.headers,
          ...(body && req.method !== 'GET' ? { body } : {}),
        }),
        env
      );
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e && e.message) }));
    }
  });
});
server.listen(0, '127.0.0.1', () => console.log('port ' + server.address().port));
