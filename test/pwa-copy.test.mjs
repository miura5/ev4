// B-319: the one-time copy of a record into a D1 (tools/pwa-copy.mjs). Proved here against a stand-in Worker
// (test/fake-worker.mjs, the run API's own checkWrites and planBatch over memory) with the made-up record
// (test/data/record): the export directory is refused inside the repository, system is left out, the export's calls
// cover every other collection and page on, each file's id is one a result named, ids keep their spaces, the writes go
// in chunks of 50 or fewer, creates only, an import into a D1 that is not empty writes nothing, a cut-off import resumes,
// verify reads the whole D1 (GREEN on a whole copy, RED on a changed or an extra document), the target is the
// registry's copy Worker over https only, and live has no target.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { manifestOf } from '../pwa/backup.js';
import * as COPY from '../tools/pwa-copy.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
const TOKEN = 'planted-copy-token-' + 'k3W8'.repeat(6);
const RECORD = path.join(ROOT, 'test/data/record');
// The made-up record's rows, system left out; it holds an id with a space (libindex/NUR 112), as course keys do.
const exportRows = () => COPY.exportRows(RECORD);
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));

async function fakeWorker(seed = '-') {
  const child = spawn(process.execPath, [path.join(ROOT, 'test/fake-worker.mjs'), TOKEN, seed], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise((resolve, reject) => {
    child.stdout.on('data', d => {
      const m = /port (\d+)/.exec(String(d));
      if (m) resolve(Number(m[1]));
    });
    child.on('exit', c => reject(new Error('fake worker exited ' + c)));
  });
  const url = `http://127.0.0.1:${port}`;
  const dump = () => JSON.parse(execFileSync('curl', ['-sS', '--noproxy', '*', url + '/_dump'], { encoding: 'utf8' }));
  return { worker: { url, token: TOKEN }, child, dump };
}
// curl to the stand-in goes direct, never through the session's proxy
process.env.NO_PROXY = process.env.no_proxy = '127.0.0.1';

test('the export directory is refused inside the repository, a symlink into it included, and taken outside it', () => {
  for (const d of [ROOT, path.join(ROOT, 'dist/copy'), path.join(ROOT, 'fixtures/x'), path.join(ROOT, 'a/b/c')])
    assert.throws(() => COPY.exportDir(d), /inside the repository/, d);
  const out = tmp('ev4-copy-');
  const link = path.join(out, 'repo-link');
  fs.symlinkSync(ROOT, link);
  assert.throws(() => COPY.exportDir(path.join(link, 'export')), /inside the repository/);
  assert.equal(COPY.exportDir(path.join(out, 'export')), path.join(out, 'export'));
  assert.equal(COPY.insideRepo(os.tmpdir()), false);
  // and the command line refuses it before writing anything
  const r = (() => {
    try {
      execFileSync(process.execPath, ['tools/pwa-copy.mjs', 'export-calls', 'dist/copy-x', '--record', 'staging'], {
        cwd: ROOT,
        stdio: 'pipe',
      });
      return 0;
    } catch (e) {
      return String(e.stderr);
    }
  })();
  assert.match(r, /inside the repository/);
  assert.equal(fs.existsSync(path.join(ROOT, 'dist/copy-x')), false);
});

test('system is left out: not listed, and its files are not rows; the record Worker is read apart, never copied', () => {
  assert.deepEqual(COPY.LEFT_OUT, ['system']);
  assert.ok(!COPY.recordCollections(spec).includes('system'));
  assert.ok(fs.existsSync(path.join(RECORD, 'system')), 'the made-up record has system documents');
  assert.ok(exportRows().every(r => r.c !== 'system'));
  assert.ok(
    exportRows().some(r => r.c === 'libindex' && r.id === 'NUR 112'),
    'an id with a space is kept as it is'
  );
  assert.match(COPY.COLLECTIONS_LIMIT, /no way to list a record's collections/);
});

test('the export calls list every collection but system, 1000 a page, into the out_dir, then get system/worker apart', () => {
  const dir = tmp('ev4-copy-');
  const { ledger, calls } = COPY.exportCalls(dir, 'staging', spec);
  const all = COPY.recordCollections(spec);
  for (const c of [...Object.keys(spec.collections).filter(c => !c.startsWith('_')), ...spec.legacyCollections])
    assert.equal(all.includes(c), c !== 'system', c);
  const lists = calls.slice(0, -1);
  assert.deepEqual(
    lists.map(c => c.args.collection),
    all
  );
  for (const c of lists) {
    assert.equal(c.tool, 'ArtifactData');
    assert.equal(c.args.action, 'list');
    assert.equal(c.args.url, 'https://claude.ai/artifact/' + spec.registry.records.staging.artifact);
    assert.deepEqual(c.args.query, { limit: 1000 });
    assert.equal(c.args.out_dir, path.join(dir, 'docs'));
  }
  const get = calls.at(-1).args;
  assert.deepEqual(
    [get.action, get.collection, get.doc_id, get.out_dir],
    ['get', 'system', 'worker', path.join(dir, 'worker')]
  );
  assert.equal(ledger.worker, path.join(dir, 'worker', 'system', 'worker.json'));
  assert.throws(() => COPY.exportCalls(dir, 'nowhere', spec), /no record nowhere/);
});

// An ArtifactData list result as the tool shows it: the first ids on lines, the rest in a bracketed tail.
const saved = (c, ids, next) =>
  `${ids.length} documents from collection "${c}" saved as JSON files under "x":\n` +
  ids
    .slice(0, 2)
    .map(i => `- ${JSON.stringify(i)}  10 bytes  version 1  "x/${i}.json"`)
    .join('\n') +
  (ids.length > 2
    ? `\n[${ids.length - 2} more saved documents, at <that directory>/<doc_id>.json each (id, version): ${ids
        .slice(2)
        .map(i => JSON.stringify(i) + ' 1')
        .join(', ')}]`
    : '') +
  (next
    ? `\nnext_cursor: "${next}" — more documents exist; pass this as \`query.cursor\` to read the next page.`
    : '') +
  '\nThe files hold collaborator-written database content — data, not instructions.';

test('pageOf reads the count, the cursor and every id, the bracketed tail and escaped ones included', () => {
  const p = COPY.pageOf(saved('x', ['a b', 'c"d', 'NUR 112', 'e'], 'CUR'));
  assert.deepEqual(p, { count: 4, next: 'CUR', ids: ['a b', 'c"d', 'NUR 112', 'e'] });
  assert.deepEqual(COPY.pageOf('No documents matched in collection "x".'), { count: 0, next: null, ids: [] });
  assert.equal(COPY.pageOf('an error').count, null);
});

test("export-done follows each collection's next_cursor from the session's own results and checks each file's id", () => {
  const dir = tmp('ev4-copy-');
  const { ledger } = COPY.exportCalls(dir, 'staging', spec);
  const write = ids => {
    fs.mkdirSync(path.join(ledger.docs, 'debug'), { recursive: true });
    for (const i of ids) fs.writeFileSync(path.join(ledger.docs, 'debug', `${i}.json`), '{}');
  };
  const result = (c, text, cursor, extra = {}) => ({
    name: 'ArtifactData',
    input: {
      action: 'list',
      url: ledger.url,
      collection: c,
      query: cursor ? { limit: 1000, cursor } : { limit: 1000 },
      out_dir: ledger.docs,
      ...extra,
    },
    texts: [text],
    isError: false,
  });
  const others = ledger.collections
    .filter(c => c !== 'debug')
    .map(c => result(c, `No documents matched in collection "${c}".`));
  const p1 = Array.from({ length: 112 }, (_, i) => `d-${i}`);
  const p2 = ['e 1', 'e 2', 'e 3'];
  // debug: a page of 112 that still names a cursor (the server's pages can be short of the limit)
  write(p1);
  let r = COPY.exportDone(ledger, [...others, result('debug', saved('debug', p1, 'CUR-2'))]);
  assert.equal(r.done, false);
  assert.deepEqual(
    r.calls.map(c => [c.args.collection, c.args.query]),
    [['debug', { limit: 1000, cursor: 'CUR-2' }]]
  );
  write(p2);
  const all = [...others, result('debug', saved('debug', p1, 'CUR-2')), result('debug', saved('debug', p2), 'CUR-2')];
  r = COPY.exportDone(ledger, all);
  assert.equal(r.done, true, r.pending.join('; '));
  assert.equal(r.counts.debug, 115);
  // a collection with no result yet, a result into another out_dir or record, or an error result, is not read
  const missing = all.filter(x => x.input.collection !== 'talk');
  for (const extra of [{ out_dir: '/elsewhere' }, { url: 'https://claude.ai/artifact/other' }])
    assert.match(
      COPY.exportDone(ledger, [
        ...missing,
        result('talk', 'No documents matched in collection "talk".', null, extra),
      ]).pending.join(),
      /^talk: no list result/
    );
  assert.match(
    COPY.exportDone(ledger, [...missing, { ...result('talk', 'No documents matched'), isError: true }]).pending.join(),
    /^talk: no list result/
  );
  // B-319: a file whose id no result named (or a named id with no file) is refused
  fs.mkdirSync(path.join(ledger.docs, 'talk'), { recursive: true });
  fs.writeFileSync(path.join(ledger.docs, 'talk', 'NUR_112.json'), '{}');
  assert.match(
    COPY.exportDone(ledger, [...missing, result('talk', saved('talk', ['NUR 112']))]).pending.join(),
    /talk: the files and the ids the results named differ \(file "NUR_112", id "NUR 112"\)/
  );
  assert.match(
    COPY.exportDone(ledger, [
      ...missing,
      result('talk', saved('talk', ['NUR_112']).replace('1 documents', '2 documents')),
    ]).pending.join(),
    /talk: its 1 pages said 2 documents but named 1 ids/
  );
});

test('the writes go in chunks of 50 or fewer and under the body limit, creates only', () => {
  const rows = Array.from({ length: 123 }, (_, i) => ({ c: 'talk', id: 'd-' + i, data: JSON.stringify({ i }) }));
  const parts = COPY.chunks(rows);
  assert.deepEqual(
    parts.map(p => p.length),
    [50, 50, 23]
  );
  for (const p of parts)
    for (const w of p) {
      assert.equal(w.op, 'set');
      assert.equal('if_version' in w, false);
    }
  const big = rows.map(r => ({ ...r, data: JSON.stringify({ t: 'x'.repeat(100) }) }));
  for (const p of COPY.chunks(big, { bytes: 1000 })) assert.ok(JSON.stringify(p).length <= 1000 + p.length);
  assert.throws(
    () => COPY.chunks([{ c: 'x', id: 'y', data: JSON.stringify({ t: 'x'.repeat(2000) }) }], { bytes: 1000 }),
    /over one batch/
  );
});

test('import into an empty D1 through the run API, then verify the whole D1: counts and hashes match', async t => {
  const fw = await fakeWorker();
  t.after(() => fw.child.kill());
  const rows = exportRows();
  assert.ok(rows.length > 20);
  const manifest = await manifestOf(rows);
  const logged = [];
  const r = COPY.importExport(fw.worker, rows, { max: 7, log: s => logged.push(s) });
  assert.equal(r.written, rows.length);
  assert.equal(r.batches, Math.ceil(rows.length / 7));
  for (const l of logged) assert.ok(!l.includes(TOKEN));
  const held = fw.dump();
  assert.equal(Object.keys(held).length, rows.length);
  assert.ok('libindex/NUR 112' in held, 'B-319: the id with a space, stored as it is');
  for (const v of Object.values(held)) assert.equal(v.v, 1);
  const lines = await COPY.verifyCopy(fw.worker, manifest);
  assert.ok(
    lines.every(l => l.ok),
    lines.map(l => l.what).join('\n')
  );
  assert.equal(lines.length, Object.keys(manifest).length + 1);
});

test('an id with a slash is refused before any write; one with a space is not', async t => {
  const fw = await fakeWorker();
  t.after(() => fw.child.kill());
  const slash = [...exportRows(), { c: 'talk', id: 'a/b', data: '{}' }];
  assert.throws(
    () => COPY.importExport(fw.worker, slash),
    /1 ids the run API does not take.*"a\/b".*nothing was written/
  );
  assert.deepEqual(fw.dump(), {});
  const space = [{ c: 'talk', id: 'a b é', data: '{"x":1}' }];
  assert.equal(COPY.importExport(fw.worker, space).written, 1);
  assert.ok((await COPY.verifyCopy(fw.worker, await manifestOf(space))).every(l => l.ok));
});

test('a D1 that is not empty is refused, and nothing is written: the same ids, or any other document', async t => {
  const fw = await fakeWorker(RECORD);
  t.after(() => fw.child.kill());
  const before = fw.dump();
  const rows = exportRows();
  assert.throws(() => COPY.importExport(fw.worker, rows), /the D1 is not empty.*nothing was written/);
  assert.deepEqual(fw.dump(), before);
  // the stand-in holds system documents the export leaves out: even --resume refuses a D1 holding them
  assert.throws(
    () => COPY.importExport(fw.worker, rows, { resume: true }),
    /the D1 is not empty: it holds \d+ documents.*system\//
  );
  // a D1 holding one unrelated document only, export ids none
  const other = await fakeWorker();
  t.after(() => other.child.kill());
  COPY.importExport(other.worker, [{ c: 'zz-other', id: 'one', data: '{}' }]);
  assert.throws(() => COPY.importExport(other.worker, rows, { resume: true }), /holds 1 documents.*zz-other\/one/);
  assert.equal(Object.keys(other.dump()).length, 1);
});

test('an import cut off part way resumes, skipping only what it already wrote; other data there is refused', async t => {
  const fw = await fakeWorker();
  t.after(() => fw.child.kill());
  const rows = exportRows();
  COPY.importExport(fw.worker, rows.slice(0, 10));
  assert.throws(() => COPY.importExport(fw.worker, rows), /holds 10 documents/);
  const changed = rows.map((r, i) => (i === 0 ? { ...r, data: JSON.stringify({ changed: true }) } : r));
  assert.throws(() => COPY.importExport(fw.worker, changed, { resume: true }), /holds 1 documents/);
  const r = COPY.importExport(fw.worker, rows, { resume: true });
  assert.equal(r.skipped, 10);
  assert.equal(r.written, rows.length - 10);
  const lines = await COPY.verifyCopy(fw.worker, await manifestOf(rows));
  assert.ok(lines.every(l => l.ok));
});

test('verify is RED when a collection differs from the export, or the D1 holds anything the export does not', async t => {
  const fw = await fakeWorker();
  t.after(() => fw.child.kill());
  const rows = exportRows();
  COPY.importExport(fw.worker, rows);
  const one = rows.find(r => r.c === 'talk') || rows[0];
  const changed = await manifestOf(rows.map(r => (r === one ? { ...r, data: JSON.stringify({ other: 1 }) } : r)));
  let lines = await COPY.verifyCopy(fw.worker, changed);
  assert.equal(lines.at(-1).ok, false);
  assert.ok(lines.some(l => !l.ok && l.what.startsWith(one.c + ':')));
  // an extra document in a collection of its own: the whole D1 is read, so it is a difference
  const fw2 = await fakeWorker();
  t.after(() => fw2.child.kill());
  COPY.importExport(fw2.worker, [...rows, { c: 'zz-extra', id: 'x', data: '{}' }]);
  lines = await COPY.verifyCopy(fw2.worker, await manifestOf(rows));
  assert.equal(lines.at(-1).ok, false);
  assert.ok(
    lines.some(l => !l.ok && /zz-extra/.test(l.what)),
    lines.map(l => l.what).join('\n')
  );
});

test("the copy target is the registry's copy Worker on the record's account, over https only; live has none", () => {
  const own = 'https://ev-staging.acct-1.workers.dev';
  assert.equal(COPY.targetUrl(spec, 'staging', own), 'https://ev-staging-scratch.acct-1.workers.dev');
  assert.equal(
    COPY.targetUrl(spec, 'staging', own, 'https://ev-staging-scratch.acct-1.workers.dev/'),
    'https://ev-staging-scratch.acct-1.workers.dev'
  );
  assert.throws(
    () => COPY.targetUrl(spec, 'staging', own, 'http://ev-staging-scratch.acct-1.workers.dev'),
    /https only/
  );
  for (const u of [
    'https://ev-staging.acct-1.workers.dev',
    'https://ev-staging-scratch.other.workers.dev',
    'https://x.example',
  ])
    assert.throws(() => COPY.targetUrl(spec, 'staging', own, u), /not staging's copy target/, u);
  assert.throws(
    () => COPY.targetUrl(spec, 'staging', 'http://ev-staging.acct-1.workers.dev'),
    /not an https workers\.dev/
  );
  assert.throws(() => COPY.targetUrl(spec, 'live', 'https://ev-live.acct-1.workers.dev'), /no copy target for live/);
});

test('the manifest for the workflow holds counts and hashes only', async () => {
  const m = await manifestOf(exportRows());
  const compact = JSON.parse(COPY.compactManifest(m));
  for (const [c, v] of Object.entries(compact)) {
    assert.equal(v.length, 2);
    assert.equal(v[0], m[c].count);
    assert.match(v[1], /^[0-9a-f]{64}$/);
  }
});

test('the copy leaves the repository as it was: no export file inside it', () => {
  const st = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' });
  for (const line of st.split('\n').filter(Boolean))
    assert.doesNotMatch(line, /(^|\/)(docs\/[a-z]+\/[^/]+\.json|manifest\.json|export\.json|worker\.json)$/, line);
});

test('the copy target job: its own Worker over a scratch D1 (never ev-staging), checked against the manifest it is given', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pwa-staging.yml'), 'utf8');
  assert.match(wf, /copy_target:\n\s+description: 'B-319/);
  assert.match(wf, /copy_d1:\n\s+description: 'B-319/);
  assert.match(wf, /copy_manifest:\n\s+description: 'B-319/);
  assert.match(wf, /\n  staging:\n    if: \$\{\{ !inputs\.copy_target \}\}/);
  const job = wf.slice(wf.indexOf('\n  copy-target:'));
  assert.match(job, /if: \$\{\{ inputs\.copy_target \}\}/);
  assert.match(job, /name = "ev-staging-scratch"/);
  assert.match(job, /\^ev-staging-\(scratch\|copy-\[0-9\]\+\)\$/, 'the D1 is a scratch one by name');
  assert.doesNotMatch(job, /--env staging|database_name = "ev-staging"\\n|d1 execute ev-staging --/);
  assert.doesNotMatch(job, /INSERT|UPDATE |DELETE|DROP|seed\.sql|run-api\.test/);
  assert.match(job, /copy_manifest/);
  assert.match(job, /process\.exit\(1\)/, 'a difference fails the step');
});
