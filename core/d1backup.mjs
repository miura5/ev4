// B-317: backups and the restore drill for a record whose runs go to the Worker (spec.registry.records.<r>.runs).
// A backup has the shape of the Worker's nightly R2 export (pwa/backup.js, B-316): {schema, kind, at, collections, docs}
// with docs [{c, id, data}] (data the JSON string D1 holds) and collections the per-collection count and SHA-256 that
// manifestOf gives. So one drill restores either source, a Mac backup or the newest R2 export, and checks the same way.
// The hashes here are pwa/backup.js manifestOf's, computed synchronously (a test holds the two equal).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EXPORT_KIND, manifestDiffs } from '../pwa/backup.js';

export { EXPORT_KIND, manifestDiffs };

/** pwa/backup.js manifestOf, synchronously: { collection: { count, sha256 } } for rows [{ c, id, data }]. */
export function manifestSync(rows) {
  const by = {};
  for (const r of rows) (by[r.c] = by[r.c] || []).push(r);
  const out = {};
  for (const c of Object.keys(by).sort()) {
    const docs = by[c].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const text = docs.map(d => JSON.stringify([d.id, d.data])).join('\n');
    out[c] = { count: docs.length, sha256: crypto.createHash('sha256').update(text).digest('hex') };
  }
  return out;
}

/** The rows a run API pull saved (<pullDir>/<collection>/<id>.json), each data as D1 holds it: the JSON string the
 *  Worker stored, which is JSON.stringify of the object (the pull saved it pretty-printed; parsing undoes that). */
export function rowsFromPull(pullDir, skip = ['system']) {
  const rows = [];
  if (!fs.existsSync(pullDir)) return rows;
  for (const c of fs.readdirSync(pullDir).sort()) {
    const dir = path.join(pullDir, c);
    if (skip.includes(c) || !fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')))
      rows.push({
        c,
        id: f.slice(0, -5),
        data: JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))),
      });
  }
  return rows.sort((a, b) => (a.c + '\n' + a.id < b.c + '\n' + b.id ? -1 : 1));
}

/** A backup of those rows, in the export's shape. */
export function backupOf(rows, { at, label, release }) {
  return { schema: 1, kind: EXPORT_KIND, at, label, release, collections: manifestSync(rows), docs: rows };
}

/** "schema versions days:2 exams:2" for a backup's rows (collections past schema 1), or "schema versions all 1". */
export function schemaLineOf(rows) {
  const max = {};
  for (const r of rows) {
    let s = 1;
    try {
      s = Math.max(1, JSON.parse(r.data).schema || 1);
    } catch {
      /* not JSON: counted as 1 */
    }
    max[r.c] = Math.max(max[r.c] || 1, s);
  }
  const v = Object.entries(max)
    .filter(([, n]) => n > 1)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return 'schema versions ' + (v.length ? v.map(([c, n]) => `${c}:${n}`).join(' ') : 'all 1');
}

/** A backup checked against its own manifest: [] when sound, else one line per problem. */
export function backupProblems(b) {
  if (!b || b.kind !== EXPORT_KIND || !Array.isArray(b.docs) || !b.collections)
    return [`not a ${EXPORT_KIND} backup (no kind, docs or collections)`];
  const bad = b.docs.filter(
    d => !d || typeof d.c !== 'string' || typeof d.id !== 'string' || typeof d.data !== 'string'
  );
  if (bad.length) return [`${bad.length} documents are not {c, id, data}`];
  return manifestDiffs(manifestSync(b.docs), b.collections).map(l => 'against its own manifest: ' + l);
}

/** Where a drill restores into the scratch database: its own collections, new to it, so nothing there is replaced. */
export const drillCollection = (runId, c) => `drills/${runId}/${c}`;

/** A document id as the run API takes it, reversibly (B-317): any character it refuses, and ~ itself, as ~<hex>. The
 *  drill's scratch copy keeps an id like "a b" as "a~20b"; decodeId gives it back for the hash check. */
export const encodeId = id =>
  String(id).replace(/[^A-Za-z0-9_\-.:@+]/gu, ch =>
    [...new TextEncoder().encode(ch)].map(b => '~' + b.toString(16).padStart(2, '0')).join('')
  );
export const decodeId = id => decodeURIComponent(String(id).replace(/~([0-9a-f]{2})/g, (_, h) => '%' + h));
