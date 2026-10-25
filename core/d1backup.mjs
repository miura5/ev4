// B-317: backups and the restore drill for a record whose runs go to the Worker (spec.registry.records.<r>.runs).
// A backup has the shape of the Worker's nightly R2 export (pwa/backup.js, B-316): {schema, kind, at, collections, docs}
// with docs [{c, id, data}] (data the JSON string D1 holds) and collections the per-collection count and SHA-256 that
// manifestOf gives. So one drill restores either source, a Mac backup or the newest R2 export, and checks the same way.
// The hashes here are pwa/backup.js manifestOf's, computed synchronously (a test holds the two equal).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EXPORT_KIND, manifestDiffs, perTarget, SYSTEM_PER_TARGET } from '../pwa/backup.js';
import { request } from './runapi-client.mjs';

export { EXPORT_KIND, manifestDiffs, perTarget, SYSTEM_PER_TARGET };

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

/**
 * B-317: the whole D1 as the R2 export holds it, read through the run API: every collection the Worker names
 * (GET /api/run/collections), every page of each, each id exactly as the list result gives it, the per-target system
 * documents left out (D-321). Refused, with the reason, when a read is refused or a collection's rows do not come to
 * the count the Worker named (a page cut short). {ok, rows} or {ok: false, error}.
 */
export function dumpD1(worker, { maxPages = 10000 } = {}) {
  const cols = request(worker, { route: 'collections' });
  if (cols.status !== 200)
    return { ok: false, error: `collections refused (${cols.status}): ${cols.body.error || ''}` };
  const rows = [];
  for (const { collection: c, count } of cols.body.collections || []) {
    let cursor = null,
      pages = 0,
      n = 0;
    do {
      const r = request(worker, { route: 'list', params: { collection: c, limit: 1000, cursor } });
      if (r.status !== 200) return { ok: false, error: `${c}: list refused (${r.status}): ${r.body.error || ''}` };
      for (const d of r.body.documents || []) {
        n++;
        if (!perTarget(c, d.id)) rows.push({ c, id: d.id, data: JSON.stringify(d.data) });
      }
      cursor = r.body.next_cursor || null;
      if (++pages > maxPages) return { ok: false, error: `${c}: more than ${maxPages} pages; nothing saved` };
    } while (cursor);
    if (n !== count)
      return { ok: false, error: `${c}: ${n} documents read, the Worker counts ${count}; nothing saved` };
  }
  return { ok: true, rows: rows.sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : a.id < b.id ? -1 : 1)) };
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
