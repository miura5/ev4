// B-312: the Worker's run API, the calls a run makes on the record in place of ArtifactData's:
//   GET  /api/run/list?collection=<c>[&limit=<1-1000>][&cursor=<next_cursor>]   a page of a collection, by id
//   GET  /api/run/get?collection=<c>&doc_id=<id>                                   one document, or 404
//   POST /api/run/batch {writes: [{op, collection, doc_id, data, if_version}]}     1 to 50 writes, all or nothing
//   GET  /api/run/collections                                                      B-319: every collection and its count
// Every document carries a version: 1 when it is created, one more on each write (the page's own saves included).
// if_version means what it means in ArtifactData: a write to a document that exists names the version last read, or
// it is refused; a stale one writes nothing and the answer names the entry and the current version; a create carries
// none. set replaces a document; update merges into it (objects deeply, arrays and values replaced; a field given as
// {"__delete__": true} is removed), and creates it when it does not exist. The Worker never hard-deletes: a delete
// op, or any DELETE request, is refused and the batch writes nothing.
// Pure functions first (tested in test/pwa-run-api.test.mjs with no Worker); `handleRun` is what worker.js calls.

import { writeProblem } from './notes.js';

/** The run API suite's own collection (pwa/run-api.test.mjs): the only one it writes, never in the seed. */
export const SUITE = 'runapi-suite';
/** What one run of the suite leaves there: the staging count check expects a whole number of runs' worth. */
export const SUITE_DOCS_PER_RUN = 25;

export const MAX_WRITES = 50;
export const MAX_BODY = 1024 * 1024;
export const LIST_LIMIT = { default: 100, max: 1000 };

// B-319: an id is any text a claude.ai record can hold as one path segment: 1 to 200 characters, no "/" (the path
// separator there), no control character, and not "." or "..". A course key with a space (libindex/NUR 112) is one.
// Ids travel encoded (encodeURIComponent in a query or path, JSON in a batch) and are stored exactly as given.
const SEG = '(?!\\.\\.?(?:/|$))[^/\\u0000-\\u001f\\u007f]{1,200}';
const COLLECTION = new RegExp(`^${SEG}(?:/${SEG}){0,14}$`);
const DOC_ID = new RegExp(`^${SEG}$`);

/** A collection path as ArtifactData takes it: an odd number of segments, 1 to 15. */
export const validCollection = c =>
  typeof c === 'string' && c.length <= 1000 && COLLECTION.test(c) && c.split('/').length % 2 === 1;
export const validDocId = id => typeof id === 'string' && DOC_ID.test(id);

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isDel = v => isObj(v) && v.__delete__ === true && Object.keys(v).length === 1;
const hasDel = v => (isDel(v) ? true : Array.isArray(v) ? v.some(hasDel) : isObj(v) && Object.values(v).some(hasDel));

// B-398: every write stores a document in one canonical JSON form: the text JSON.stringify gives for the value JSON.parse
// read, so compact, with the keys in the order every reader already sees them (integer-like keys first, the rest as
// written). It is the form a read gives back (run API, GET /api/db), so a Mac backup, which re-serialises what it reads
// (core/d1backup.mjs dumpD1), and the R2 export, which keeps D1's text (pwa/backup.js), hash the same. Only whitespace,
// escapes and the spelling of numbers change; the data a reader parses is the same. A number JSON cannot hold (1e400
// parses to Infinity, which would be stored as null) is refused instead, so nothing is changed by canonicalising.
/** Whether every number in v is finite (JSON.parse gives Infinity for a number too large to hold). */
export const finiteJson = v =>
  typeof v === 'number'
    ? Number.isFinite(v)
    : Array.isArray(v)
      ? v.every(finiteJson)
      : isObj(v)
        ? Object.values(v).every(finiteJson)
        : true;
/** The canonical text of a parsed document. */
export const canonicalText = v => JSON.stringify(v);
/** A body as the Worker stores it: {text} (canonical) or {error} when it is not JSON or holds a number JSON cannot. */
export function canonicalJson(text) {
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    return { error: 'the body is not JSON' };
  }
  if (!finiteJson(v)) return { error: 'a number too large for JSON (it would be stored as null); nothing was written' };
  return { text: canonicalText(v) };
}

/** update: `patch` merged into `doc`, objects deeply; {"__delete__": true} removes that field. */
export function merge(doc, patch) {
  const out = isObj(doc) ? { ...doc } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (isDel(v)) delete out[k];
    else if (isObj(v)) out[k] = merge(out[k], v);
    else out[k] = v;
  }
  return out;
}

/** A batch's own walls, before anything is read: null when sound, else {status, error, entry?}. */
export function checkWrites(writes) {
  if (!Array.isArray(writes) || writes.length < 1 || writes.length > MAX_WRITES)
    return { status: 400, error: `writes: 1 to ${MAX_WRITES} entries` };
  const seen = new Set();
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i];
    const at = (status, error) => ({ status, error, entry: i });
    if (!isObj(w)) return at(400, 'an entry is an object');
    if (w.op === 'delete') return at(403, 'the Worker never deletes: a delete is refused, and nothing was written');
    if (w.op !== 'set' && w.op !== 'update') return at(400, `op: set or update, not ${JSON.stringify(w.op)}`);
    if (!validCollection(w.collection)) return at(400, 'collection: not a collection path');
    if (!validDocId(w.doc_id)) return at(400, 'doc_id: not a document id');
    if (!isObj(w.data)) return at(400, 'data: a JSON object');
    if (w.op === 'set' && hasDel(w.data)) return at(400, 'set rejects {"__delete__": true}; use update');
    if (!finiteJson(w.data)) return at(400, 'data: a number too large for JSON (it would be stored as null)'); // B-398
    if (w.if_version != null && !(Number.isInteger(w.if_version) && w.if_version >= 1))
      return at(400, 'if_version: a whole number from 1');
    const key = w.collection + '\n' + w.doc_id;
    if (seen.has(key)) return at(400, 'each document is addressed at most once in a batch');
    seen.add(key);
  }
  return null;
}

/**
 * The batch planned against what the record holds now (`current`: key -> {v, data} for the documents that exist).
 * {ok: true, rows: [{c, id, data, from, v}]} where `from` is the version the row must still have (null: must not
 * exist), or {ok: false, status: 409, ...} naming the first entry whose pin does not hold. Nothing is written here.
 */
export function planBatch(writes, current) {
  const rows = [];
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i];
    const cur = current.get(w.collection + '\n' + w.doc_id) || null;
    const have = cur ? cur.v : null;
    const want = w.if_version == null ? null : w.if_version;
    if (have !== want) {
      return {
        ok: false,
        status: 409,
        error:
          have == null
            ? `entry ${i} (${w.collection}/${w.doc_id}) is pinned to version ${want}, but the document does not exist; nothing was written`
            : want == null
              ? `entry ${i} (${w.collection}/${w.doc_id}) exists at version ${have} and carries no if_version: read it first; nothing was written`
              : `entry ${i} (${w.collection}/${w.doc_id}) is pinned to version ${want}, but it is now at version ${have}; nothing was written`,
        entry: i,
        collection: w.collection,
        doc_id: w.doc_id,
        if_version: want,
        current_version: have,
      };
    }
    const data = w.op === 'set' ? w.data : merge(cur ? cur.data : {}, w.data);
    // B-401 (D-325): a note is judged on the document the write leaves (pwa/notes.js); nothing in the batch is written
    const bad = writeProblem(w.collection, w.doc_id, data, cur ? cur.data : null);
    if (bad) return { ok: false, status: 400, error: `entry ${i}: ${bad}; nothing was written`, entry: i };
    rows.push({ c: w.collection, id: w.doc_id, data, from: have, v: have == null ? 1 : have + 1 });
  }
  return { ok: true, rows };
}

/** A list cursor: the last id of the page as base64url of its UTF-8 (B-319: any id, not only ASCII), opaque to the caller. */
export const encodeCursor = id => {
  let bin = '';
  for (const b of new TextEncoder().encode(id)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const decodeCursor = s => {
  try {
    // B-397: base64url as given now, and the btoa cursors given before B-319 (+, / and = padding) all decode the same
    if (typeof s !== 'string' || !/^[A-Za-z0-9_+/-]+={0,2}$/.test(s)) return null;
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, ''));
    const id = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
    return validDocId(id) ? id : null;
  } catch {
    return null;
  }
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const doc = r => ({ id: r.id, version: r.v, data: JSON.parse(r.data) });

/** /api/run/*, after the token was checked. */
export async function handleRun(request, env, url) {
  const route = url.pathname.slice('/api/run/'.length);
  if (request.method === 'DELETE')
    return json({ error: 'the Worker never deletes: a delete is refused, and nothing was written' }, 403);

  if (route === 'list' && request.method === 'GET') {
    const c = url.searchParams.get('collection');
    if (!validCollection(c)) return json({ error: 'collection: not a collection path' }, 400);
    const raw = url.searchParams.get('limit');
    const limit = raw == null ? LIST_LIMIT.default : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMIT.max)
      return json({ error: `limit: 1 to ${LIST_LIMIT.max}` }, 400);
    const cursor = url.searchParams.get('cursor');
    const after = cursor == null ? '' : decodeCursor(cursor);
    if (after == null) return json({ error: 'cursor: not one this API gave' }, 400);
    const { results } = await env.DB.prepare('SELECT id, data, v FROM docs WHERE c = ? AND id > ? ORDER BY id LIMIT ?')
      .bind(c, after, limit + 1)
      .all();
    const page = results.slice(0, limit);
    return json({
      collection: c,
      documents: page.map(doc),
      next_cursor: results.length > limit ? encodeCursor(page[page.length - 1].id) : null,
    });
  }

  // B-319: what the D1 holds, by collection (the copy refuses a target that is not empty and checks it whole)
  if (route === 'collections' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT c, COUNT(*) AS n FROM docs GROUP BY c ORDER BY c').all();
    return json({ collections: results.map(r => ({ collection: r.c, count: r.n })) });
  }

  if (route === 'get' && request.method === 'GET') {
    const c = url.searchParams.get('collection');
    const id = url.searchParams.get('doc_id');
    if (!validCollection(c)) return json({ error: 'collection: not a collection path' }, 400);
    if (!validDocId(id)) return json({ error: 'doc_id: not a document id' }, 400);
    const r = await env.DB.prepare('SELECT id, data, v FROM docs WHERE c = ? AND id = ?').bind(c, id).first();
    if (!r) return json({ error: 'not found', collection: c, doc_id: id }, 404);
    return json({ collection: c, ...doc(r) });
  }

  if (route === 'batch' && request.method === 'POST') {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: 'the batch body is over 1 MiB' }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'the body is not JSON' }, 400);
    }
    const writes = body && body.writes;
    const wall = checkWrites(writes);
    if (wall) return json({ error: wall.error, ...(wall.entry != null ? { entry: wall.entry } : {}) }, wall.status);

    const reads = await env.DB.batch(
      writes.map(w =>
        env.DB.prepare('SELECT c, id, data, v FROM docs WHERE c = ? AND id = ?').bind(w.collection, w.doc_id)
      )
    );
    const current = new Map();
    for (const r of reads)
      for (const x of r.results) current.set(x.c + '\n' + x.id, { v: x.v, data: JSON.parse(x.data) });
    const plan = planBatch(writes, current);
    if (!plan.ok) {
      const { ok, status, ...rest } = plan;
      return json(rest, status);
    }

    // One transaction: each row first proves its version is still the one planned against (json() of a non-JSON
    // string fails the statement, and a failed statement rolls the whole batch back), then is written.
    const at = Date.now();
    const stmts = [];
    for (const r of plan.rows) {
      stmts.push(
        env.DB.prepare(
          "SELECT json(CASE WHEN (SELECT v FROM docs WHERE c = ?1 AND id = ?2) IS ?3 THEN '1' ELSE 'changed' END) AS ok"
        ).bind(r.c, r.id, r.from)
      );
      stmts.push(
        r.from == null
          ? env.DB.prepare('INSERT INTO docs (c, id, data, at, v) VALUES (?, ?, ?, ?, 1)').bind(
              r.c,
              r.id,
              canonicalText(r.data), // B-398
              at
            )
          : env.DB.prepare('UPDATE docs SET data = ?, at = ?, v = ? WHERE c = ? AND id = ? AND v = ?').bind(
              canonicalText(r.data),
              at,
              r.v,
              r.c,
              r.id,
              r.from
            )
      );
    }
    try {
      await env.DB.batch(stmts);
    } catch (e) {
      return json(
        { error: 'a document changed while the batch was written; nothing was written: read again and resend' },
        409
      );
    }
    return json({ ok: true, results: plan.rows.map(r => ({ collection: r.c, doc_id: r.id, version: r.v })) });
  }

  return json({ error: 'no such run route' }, 404);
}
