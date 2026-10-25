#!/usr/bin/env node
// B-319: the one-time copy of a claude.ai record into a D1, through the Worker's run API. One way and once: it reads
// the artifact's database, writes a D1 that holds none of its documents, and checks the two match; it never writes the
// artifact and never syncs (D-297, D-307: this copy is the one move from one store to the other, not a bridge).
//   node tools/pwa-copy.mjs export-calls <dir> --record staging|live
//       prints one ArtifactData list (limit 1000, out_dir <dir>/docs) per collection of the record (spec.collections
//       and spec.legacyCollections) and notes the export in <dir>/export.json. Make every call it prints.
//   node tools/pwa-copy.mjs export-done <dir> [--transcript <this session's .jsonl>]
//       after the calls: reads this session's own list results (core/transcript.mjs; a cursor is never retyped) and
//       follows each collection's next_cursor, printing the next page's call (a page can be short of the limit and
//       still name one); a collection is whole when its last result names none and its files add up to its results.
//       Then it writes <dir>/manifest.json: per collection the count and the SHA-256 of pwa/backup.js.
//   node tools/pwa-copy.mjs import <dir> --worker <system/worker file> [--url <Worker url>] [--resume]
//       creates every exported document in the Worker's D1 through POST /api/run/batch, 50 writes or fewer and under
//       the 1 MiB body a batch, creates only (no if_version, so the Worker refuses a document that exists). Before any
//       write it lists each collection in the D1 and refuses when the D1 already holds one of the ids. --resume (after
//       an import cut off part way) skips an id the D1 holds with the same data at version 1, and refuses any other.
//   node tools/pwa-copy.mjs verify <dir> --worker <file> [--url <Worker url>]
//       reads each collection back through GET /api/run/list and checks counts and SHA-256 per collection against the
//       export's manifest (tools/pwa-backup.mjs verify): GREEN or RED.
// The export holds the record, so <dir> must be outside the repository (under /tmp or the session's scratchpad): every
// command refuses a directory inside it. Nothing printed is a document or the token: counts, ids, short hashes and the
// Worker's own error words only. The token goes to curl on stdin (core/runapi-client.mjs). Nothing is deleted anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readExport } from '../core/schemas.mjs';
import { newestTranscript, toolResults } from '../core/transcript.mjs';
import { readWorker, request, batch } from '../core/runapi-client.mjs';
import { manifestOf, manifestDiffs } from '../pwa/backup.js';
import { validCollection, validDocId } from '../pwa/runapi.js';
import { verify as verifyLines } from './pwa-backup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE = 1000;
export const CHUNK = 50;
/** Under the Worker's 1 MiB batch body (pwa/runapi.js MAX_BODY), with room for the envelope. */
export const CHUNK_BYTES = 900 * 1024;

const realish = p => {
  // the nearest existing ancestor's real path, plus the rest: a symlink into the repository is still inside it
  let cur = path.resolve(p);
  const rest = [];
  while (!fs.existsSync(cur)) {
    rest.unshift(path.basename(cur));
    cur = path.dirname(cur);
  }
  return path.join(fs.realpathSync(cur), ...rest);
};

/** True when `dir` is the repository or inside it. */
export function insideRepo(dir, root = ROOT) {
  const r = fs.realpathSync(root);
  const rel = path.relative(r, realish(dir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** The export directory, refused inside the repository (the record is personal data: CLAUDE.md, Hard limits). */
export function exportDir(dir, root = ROOT) {
  if (!dir) throw new Error('name the export directory (outside the repository: /tmp or the scratchpad)');
  if (insideRepo(dir, root))
    throw new Error(`${dir} is inside the repository: the export holds the record and stays outside it`);
  return path.resolve(dir);
}

/** Every collection a record holds: spec.collections and the legacy ones, sorted. */
export function recordCollections(spec) {
  return [...Object.keys(spec.collections).filter(c => !c.startsWith('_')), ...(spec.legacyCollections || [])].sort();
}

const listCall = (url, collection, out, cursor) => ({
  tool: 'ArtifactData',
  args: {
    action: 'list',
    url,
    collection,
    query: cursor ? { limit: PAGE, cursor } : { limit: PAGE },
    out_dir: out,
  },
});

/** The export's first calls, and its ledger. */
export function exportCalls(dir, record, spec) {
  const rec = spec.registry.records[record];
  if (!rec || !rec.artifact) throw new Error(`no record ${record} in spec.registry.records`);
  const url = `https://claude.ai/artifact/${rec.artifact}`;
  const collections = recordCollections(spec);
  const docs = path.join(dir, 'docs');
  const ledger = { record, url, docs, collections };
  return { ledger, calls: collections.map(c => listCall(url, c, docs, null)) };
}

const countFiles = (docs, c) => {
  const p = path.join(docs, c);
  return fs.existsSync(p) ? fs.readdirSync(p).filter(f => f.endsWith('.json')).length : 0;
};

/** What one ArtifactData list result says: {count, next} (count null when it names none: an error, say). */
export function pageOf(text) {
  const t = String(text || '');
  const n = /^(\d+) documents? from collection/m.exec(t);
  const count = n ? Number(n[1]) : /^No documents matched in collection/m.test(t) ? 0 : null;
  const c = /next_cursor:\s*"([^"]+)"/.exec(t);
  return { count, next: c ? c[1] : null };
}

/**
 * After the calls, from this session's own ArtifactData list results into the export's out_dir (core/transcript.mjs,
 * never retyped): each collection's pages are followed from the first call through each next_cursor. {calls} for the
 * next page of a collection whose last result named a next_cursor, {pending} for a collection with no result yet (or
 * whose files do not add up to what its results said), {done: true, counts} when every collection is whole.
 */
export function exportDone(ledger, results) {
  const byKey = new Map();
  for (const r of results) {
    const a = r.input || {};
    if (r.isError || a.action !== 'list' || a.url !== ledger.url || a.out_dir !== ledger.docs) continue;
    const page = pageOf(r.texts.join('\n'));
    if (page.count == null) continue;
    byKey.set(a.collection + '\n' + ((a.query && a.query.cursor) || ''), page); // the newest result of a page wins
  }
  const calls = [];
  const pending = [];
  const counts = {};
  for (const c of ledger.collections) {
    let cursor = '';
    let total = 0;
    let pages = 0;
    let state = 'whole';
    for (;;) {
      const page = byKey.get(c + '\n' + cursor);
      if (!page) {
        state = pages === 0 ? 'unread' : 'more';
        break;
      }
      total += page.count;
      pages++;
      if (!page.next) break;
      cursor = page.next;
      if (pages > 1000) throw new Error(`${c}: more than 1000 pages`);
    }
    if (state === 'unread') pending.push(`${c}: no list result into the export yet: make its call`);
    else if (state === 'more') calls.push(listCall(ledger.url, c, ledger.docs, cursor));
    else {
      const files = countFiles(ledger.docs, c);
      if (files !== total)
        pending.push(
          `${c}: ${files} files, but its ${pages} pages said ${total}: read it again into a new export directory`
        );
      else counts[c] = total;
    }
  }
  return { calls, pending, counts, done: calls.length === 0 && pending.length === 0 };
}

/** The export's rows as D1 will hold them: data is the document as JSON, exactly as the Worker stores a create. */
export function exportRows(docs) {
  return readExport(docs).map(({ collection, id, doc }) => ({ c: collection, id, data: JSON.stringify(doc) }));
}

/** The writes, in chunks of at most CHUNK entries and CHUNK_BYTES of body: creates only (no if_version). */
export function chunks(rows, { max = CHUNK, bytes = CHUNK_BYTES } = {}) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const r of rows) {
    const w = { op: 'set', collection: r.c, doc_id: r.id, data: JSON.parse(r.data) };
    const s = JSON.stringify(w).length + 1;
    if (s > bytes) throw new Error(`${r.c}/${r.id} is ${s} bytes: over one batch's body on its own`);
    if (cur.length && (cur.length >= max || size + s > bytes)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(w);
    size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Every document of a collection in the Worker's D1: [{id, version, data}], paged by cursor. */
export function listAll(worker, collection) {
  const out = [];
  let cursor = null;
  let pages = 0;
  do {
    const r = request(worker, { route: 'list', params: { collection, limit: PAGE, cursor } });
    if (r.status !== 200) throw new Error(`list ${collection}: ${r.status} ${r.body.error || 'refused'}`);
    out.push(...(r.body.documents || []));
    cursor = r.body.next_cursor || null;
    if (++pages > 1000) throw new Error(`list ${collection}: more than 1000 pages`);
  } while (cursor);
  return out;
}

/** What the D1 already holds of the export: {clash: [c/id], same: Set(c\nid)}. With resume, a same document is skipped. */
export function overlap(rows, held) {
  const clash = [];
  const same = new Set();
  for (const r of rows) {
    const h = held.get(r.c + '\n' + r.id);
    if (!h) continue;
    if (h.version === 1 && JSON.stringify(h.data) === r.data) same.add(r.c + '\n' + r.id);
    else clash.push(`${r.c}/${r.id}`);
  }
  return { clash, same };
}

function heldOf(worker, collections) {
  const held = new Map();
  for (const c of collections) for (const d of listAll(worker, c)) held.set(c + '\n' + d.id, d);
  return held;
}

/** The import. Returns {written, skipped, batches}; throws, having written nothing, when the D1 holds an export id. */
export function importExport(worker, rows, { resume = false, log = () => {}, max = CHUNK, bytes = CHUNK_BYTES } = {}) {
  const bad = rows.filter(r => !validCollection(r.c) || !validDocId(r.id)).map(r => `${r.c}/${JSON.stringify(r.id)}`);
  if (bad.length)
    throw new Error(`${bad.length} ids the run API does not take (${bad.slice(0, 5).join(', ')}): nothing was written`);
  const collections = [...new Set(rows.map(r => r.c))].sort();
  const held = heldOf(worker, collections);
  const { clash, same } = overlap(rows, held);
  if (clash.length || (same.size && !resume))
    throw new Error(
      `the D1 already holds ${clash.length + (resume ? 0 : same.size)} of the export's ids (${[...clash, ...(resume ? [] : [...same].map(k => k.replace('\n', '/')))].slice(0, 5).join(', ')}${clash.length + same.size > 5 ? ', ...' : ''}): nothing was written; the copy goes into a D1 that holds none of them${resume ? '' : ' (--resume skips only ids it holds with the same data)'}`
    );
  const todo = rows.filter(r => !same.has(r.c + '\n' + r.id));
  const parts = chunks(todo, { max, bytes });
  let written = 0;
  for (let i = 0; i < parts.length; i++) {
    const r = batch(worker, parts[i]);
    if (!r.ok)
      throw new Error(
        `batch ${i + 1} of ${parts.length} refused (${r.status} ${r.error}${r.entry != null ? `, entry ${r.entry}` : ''}): ${written} documents written before it; run again with --resume`
      );
    written += parts[i].length;
    log(`batch ${i + 1}/${parts.length}: ${parts[i].length} created (${written} of ${todo.length})`);
  }
  return { written, skipped: same.size, batches: parts.length };
}

/** The check: the D1's documents of each exported collection, read back, against the export's manifest. */
export async function verifyCopy(worker, manifest) {
  const rows = [];
  for (const c of Object.keys(manifest).sort())
    for (const d of listAll(worker, c)) rows.push({ c, id: d.id, data: JSON.stringify(d.data) });
  return verifyLines({ collections: manifest }, rows);
}

const short = m =>
  Object.entries(m)
    .map(([c, x]) => `${c} ${x.count} ${x.sha256.slice(0, 12)}`)
    .join('\n  ');

function workerOf(args) {
  const file = opt(args, '--worker');
  if (!file) throw new Error('--worker <the saved system/worker file> is needed');
  const w = readWorker(file);
  const url = opt(args, '--url');
  if (url) {
    if (!/^https?:\/\/[^\s"\\]+$/.test(url)) throw new Error('--url: not a URL');
    w.url = url.replace(/\/+$/, '');
  }
  return w;
}
function opt(args, k) {
  const i = args.indexOf(k);
  return i >= 0 ? args.splice(i, 2)[1] : null;
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

async function main(argv) {
  const args = argv.slice();
  const cmd = args.shift();
  const resume = args.includes('--resume');
  if (resume) args.splice(args.indexOf('--resume'), 1);
  if (cmd === 'export-calls') {
    const record = opt(args, '--record');
    const dir = exportDir(args[0]);
    const spec = readJson(path.join(ROOT, 'spec/ev.spec.json'));
    const { ledger, calls } = exportCalls(dir, record, spec);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'export.json'), JSON.stringify(ledger, null, 1));
    console.log(`export of ${record} (${ledger.url}) into ${ledger.docs}: make each call, then export-done`);
    for (const c of calls) console.log(`${c.tool} ${JSON.stringify(c.args)}`);
    return 0;
  }
  const dir = exportDir(args[0]);
  const ledgerFile = path.join(dir, 'export.json');
  if (!fs.existsSync(ledgerFile)) throw new Error(`no export at ${dir}: run export-calls first`);
  const ledger = readJson(ledgerFile);
  if (cmd === 'export-done') {
    const file = opt(args, '--transcript') || newestTranscript();
    if (!file || !fs.existsSync(file))
      throw new Error("no session transcript: pass --transcript <this session's .jsonl>");
    const r = exportDone(ledger, toolResults(fs.readFileSync(file, 'utf8'), 'ArtifactData'));
    for (const c of r.calls) console.log(`${c.tool} ${JSON.stringify(c.args)}`);
    for (const p of r.pending) console.log('pending ' + p);
    if (!r.done) {
      console.log('make the calls above, then run export-done again');
      return 1;
    }
    const manifest = await manifestOf(exportRows(ledger.docs));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
    const total = Object.values(manifest).reduce((a, b) => a + b.count, 0);
    console.log(`exported ${total} documents in ${Object.keys(manifest).length} collections:\n  ${short(manifest)}`);
    const empty = ledger.collections.filter(c => !manifest[c]);
    if (empty.length) console.log(`empty: ${empty.join(', ')}`);
    return 0;
  }
  const manifestFile = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error('the export is not finished: run export-done first');
  const manifest = readJson(manifestFile);
  const rows = exportRows(ledger.docs);
  const diffs = manifestDiffs(await manifestOf(rows), manifest);
  if (diffs.length) throw new Error('the export files changed since export-done: ' + diffs.join('; '));
  if (cmd === 'import') {
    const worker = workerOf(args);
    console.log(`import of ${rows.length} documents into ${worker.url}`);
    const r = importExport(worker, rows, { resume, log: s => console.log(s) });
    console.log(
      `imported: ${r.written} created in ${r.batches} batches${r.skipped ? `, ${r.skipped} already there (--resume)` : ''}`
    );
    return 0;
  }
  if (cmd === 'verify') {
    const worker = workerOf(args);
    const lines = await verifyCopy(worker, manifest);
    for (const l of lines) console.log(`${l.ok ? 'ok ' : 'NO '} ${l.what}`);
    const green = lines.every(l => l.ok);
    console.log(`pwa-copy verify (${ledger.record} into ${worker.url}): ${green ? 'GREEN' : 'RED'}`);
    return green ? 0 : 1;
  }
  console.error('usage: node tools/pwa-copy.mjs export-calls|export-done|import|verify <dir> ... (see the header)');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    e => {
      console.error('pwa-copy: ' + e.message);
      process.exit(1);
    }
  );
}
