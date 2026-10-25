// B-316 (D-302): the nightly export of the record in D1 to Cloudflare R2, and the checks a restore is held to.
//   - exportToR2(env): every document in D1 (env.DB) but the per-target system ones (D-321), written as one JSON file to the R2 bucket env.EXPORTS, under a key
//     new to it. An export is never overwritten or deleted: a key already in the bucket is never written again.
//   - The Worker runs it on its cron (wrangler.toml, staging only for now) and on POST /api/backup/export (the token).
//   - manifestOf(rows): per collection, the document count and a SHA-256 over its documents in id order, each as
//     [id, data] with data exactly as D1 stores it. A restore matches when its rows give the same manifest.
// Shared by the Worker and node (tools/pwa-backup.mjs, the tests): Web Crypto and nothing else.

export const EXPORT_PREFIX = 'exports/';
/** D-321 (B-317): the per-target system documents a backup or export leaves out: each target's own deploy writes them,
 *  and a Worker's token is never kept in a copy of the database it protects. Other system documents are kept. */
export const SYSTEM_PER_TARGET = ['worker', 'manifest', 'spec', 'environments', 'yourturn', 'seed', 'config', 'code'];
export const perTarget = (c, id) => c === 'system' && SYSTEM_PER_TARGET.includes(id);
export const EXPORT_KIND = 'ev-d1-export';

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/** { collection: { count, sha256 } } for rows [{ c, id, data }] (data as the string D1 holds). */
export async function manifestOf(rows) {
  const by = {};
  for (const r of rows) (by[r.c] = by[r.c] || []).push(r);
  const out = {};
  for (const c of Object.keys(by).sort()) {
    const docs = by[c].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out[c] = { count: docs.length, sha256: await sha256(docs.map(d => JSON.stringify([d.id, d.data])).join('\n')) };
  }
  return out;
}

/** One line per collection whose count or hash differs between two manifests; empty when they match. */
export function manifestDiffs(got, want) {
  return [...new Set([...Object.keys(want), ...Object.keys(got)])].sort().flatMap(c => {
    const g = got[c] || { count: 0, sha256: null };
    const w = want[c] || { count: 0, sha256: null };
    if (g.count !== w.count) return [`${c}: ${g.count} restored, ${w.count} in the export`];
    if (g.sha256 !== w.sha256) return [`${c}: the hash differs`];
    return [];
  });
}

/** The key for an export made at `now`: exports/<day>/<time>.json, so the newest sorts last. */
export function exportKey(now) {
  const iso = new Date(now).toISOString();
  return `${EXPORT_PREFIX}${iso.slice(0, 10)}/${iso.replace(/[:.]/g, '-')}.json`;
}

/** Writes body under key, or under key~2, key~3 ... when a key is taken: an earlier export is never replaced. One
 * export a night, keyed to the millisecond, so two writers racing for one key does not arise. */
export async function putNew(bucket, key, body) {
  for (let n = 1; n <= 50; n++) {
    // key~2 sorts after key, so the newest export still sorts last.
    const k = n === 1 ? key : key.replace(/\.json$/, `~${n}.json`);
    if (await bucket.head(k)) continue;
    await bucket.put(k, body, { httpMetadata: { contentType: 'application/json' } });
    return k;
  }
  throw new Error('no free key for the export near ' + key);
}

/** The export: every document in D1 but the per-target system ones (D-321), its manifest, written to R2 under a new key. Returns { key, at, collections }. */
export async function exportToR2(env, now = Date.now()) {
  if (!env.EXPORTS) throw new Error('no EXPORTS bucket bound to this Worker');
  const { results: all } = await env.DB.prepare('SELECT c, id, data, at, v FROM docs ORDER BY c, id').all();
  const results = all.filter(r => !perTarget(r.c, r.id)); // D-321
  const collections = await manifestOf(results);
  const body = JSON.stringify({
    schema: 1,
    kind: EXPORT_KIND,
    at: new Date(now).toISOString(),
    collections,
    docs: results.map(r => ({ c: r.c, id: r.id, data: r.data, at: r.at, v: r.v })),
  });
  const key = await putNew(env.EXPORTS, exportKey(now), body);
  return { key, at: new Date(now).toISOString(), collections };
}

/** The newest export's key in the bucket, or null. */
export async function newestExport(bucket) {
  let newest = null;
  let cursor;
  do {
    const page = await bucket.list({ prefix: EXPORT_PREFIX, cursor });
    for (const o of page.objects) if (!newest || o.key > newest) newest = o.key;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return newest;
}
