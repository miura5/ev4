// B-319: the one-time copy of a record into a D1 (tools/pwa-copy.mjs). Proved here against a stand-in Worker
// (test/fake-worker.mjs, the run API's own checkWrites and planBatch over memory) with the made-up record
// (test/data/record): the export directory is refused inside the repository, the export's calls cover every collection
// and page on, the writes go in chunks of 50 or fewer, creates only, an import into a D1 that holds any of the ids
// writes nothing, a cut-off import resumes, and verify is GREEN on a whole copy and RED on a changed document.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { manifestOf } from '../pwa/backup.js';
import * as COPY from '../tools/pwa-copy.mjs';
import { validDocId } from '../pwa/runapi.js';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
const TOKEN = 'planted-copy-token-' + 'k3W8'.repeat(6);
const RECORD = path.join(ROOT, 'test/data/record');
// The made-up record has one id no claude.ai record can hold (a space: libindex/NUR 112); the copy refuses it up front.
const exportRows = () => COPY.exportRows(RECORD).filter(r => validDocId(r.id));
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

test('the export calls list every collection of the record, 1000 a page, into the out_dir', () => {
  const dir = tmp('ev4-copy-');
  const { ledger, calls } = COPY.exportCalls(dir, 'staging', spec);
  const all = COPY.recordCollections(spec);
  for (const c of [...Object.keys(spec.collections).filter(c => !c.startsWith('_')), ...spec.legacyCollections])
    assert.ok(all.includes(c), c);
  assert.deepEqual(
    calls.map(c => c.args.collection),
    all
  );
  for (const c of calls) {
    assert.equal(c.tool, 'ArtifactData');
    assert.equal(c.args.action, 'list');
    assert.equal(c.args.url, 'https://claude.ai/artifact/' + spec.registry.records.staging.artifact);
    assert.deepEqual(c.args.query, { limit: 1000 });
    assert.equal(c.args.out_dir, path.join(dir, 'docs'));
  }
  assert.equal(ledger.record, 'staging');
  assert.throws(() => COPY.exportCalls(dir, 'nowhere', spec), /no record nowhere/);
});

test("export-done follows each collection's next_cursor from the session's own results, a short page included", () => {
  const dir = tmp('ev4-copy-');
  const { ledger } = COPY.exportCalls(dir, 'staging', spec);
  const write = (c, n, from = 0) => {
    fs.mkdirSync(path.join(ledger.docs, c), { recursive: true });
    for (let i = from; i < from + n; i++) fs.writeFileSync(path.join(ledger.docs, c, `d-${i}.json`), '{}');
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
  const saved = (n, c, next) =>
    `${n} documents from collection "${c}" saved as JSON files under "x":\n- "d"\n` +
    (next
      ? `next_cursor: "${next}" — more documents exist; pass this as \`query.cursor\` to read the next page.\n`
      : '');
  const others = ledger.collections
    .filter(c => c !== 'debug')
    .map(c => result(c, `No documents matched in collection "${c}".`));
  // debug: a page of 112 that still names a cursor (the server's pages can be short of the limit)
  write('debug', 112);
  let r = COPY.exportDone(ledger, [...others, result('debug', saved(112, 'debug', 'CUR-2'))]);
  assert.equal(r.done, false);
  assert.deepEqual(
    r.calls.map(c => [c.args.collection, c.args.query]),
    [['debug', { limit: 1000, cursor: 'CUR-2' }]]
  );
  write('debug', 30, 112);
  const all = [...others, result('debug', saved(112, 'debug', 'CUR-2')), result('debug', saved(30, 'debug'), 'CUR-2')];
  r = COPY.exportDone(ledger, all);
  assert.equal(r.done, true, r.pending.join('; '));
  assert.equal(r.counts.debug, 142);
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
  // files that do not add up to what the results said
  write('talk', 2);
  assert.match(
    COPY.exportDone(ledger, [...missing, result('talk', saved(1, 'talk'))]).pending.join(),
    /talk: 2 files, but its 1 pages said 1/
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

test('import into an empty D1 through the run API, then verify: counts and hashes match per collection', async t => {
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
  for (const v of Object.values(held)) assert.equal(v.v, 1);
  const lines = await COPY.verifyCopy(fw.worker, manifest);
  assert.ok(
    lines.every(l => l.ok),
    lines.map(l => l.what).join('\n')
  );
  assert.equal(lines.length, Object.keys(manifest).length + 1);
});

test('an id the run API does not take is refused before any write', async t => {
  const fw = await fakeWorker();
  t.after(() => fw.child.kill());
  assert.throws(
    () => COPY.importExport(fw.worker, COPY.exportRows(RECORD)),
    /1 ids the run API does not take.*NUR 112.*nothing was written/
  );
  assert.deepEqual(fw.dump(), {});
});

test('a D1 that already holds any of the ids is refused, and nothing is written', async t => {
  const fw = await fakeWorker(RECORD);
  t.after(() => fw.child.kill());
  const before = fw.dump();
  const rows = exportRows();
  const extra = [...rows, { c: 'talk', id: 'copy-new-1', data: JSON.stringify({ new: true }) }];
  assert.throws(
    () => COPY.importExport(fw.worker, extra),
    /already holds \d+ of the export's ids.*nothing was written/
  );
  assert.deepEqual(fw.dump(), before);
  // one id held with other data is refused even with --resume
  const changed = rows.map((r, i) => (i === 0 ? { ...r, data: JSON.stringify({ changed: true }) } : r));
  assert.throws(() => COPY.importExport(fw.worker, changed, { resume: true }), /already holds 1 of/);
  assert.deepEqual(fw.dump(), before);
});

test('an import cut off part way resumes, skipping only what it already wrote', async t => {
  const fw = await fakeWorker();
  t.after(() => fw.child.kill());
  const rows = exportRows();
  COPY.importExport(fw.worker, rows.slice(0, 10));
  assert.throws(() => COPY.importExport(fw.worker, rows), /already holds 10/);
  const r = COPY.importExport(fw.worker, rows, { resume: true });
  assert.equal(r.skipped, 10);
  assert.equal(r.written, rows.length - 10);
  const lines = await COPY.verifyCopy(fw.worker, await manifestOf(rows));
  assert.ok(lines.every(l => l.ok));
});

test('verify is RED when a collection differs from the export', async t => {
  const fw = await fakeWorker(RECORD);
  t.after(() => fw.child.kill());
  const rows = exportRows();
  const one = rows.find(r => r.c === 'talk') || rows[0];
  const want = await manifestOf(rows.map(r => (r === one ? { ...r, data: JSON.stringify({ other: 1 }) } : r)));
  const lines = await COPY.verifyCopy(fw.worker, want);
  assert.equal(lines.at(-1).ok, false);
  assert.ok(lines.some(l => !l.ok && l.what.startsWith(one.c + ':')));
});

test('the copy leaves the repository as it was: no export file inside it', () => {
  const st = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' });
  for (const line of st.split('\n').filter(Boolean))
    assert.doesNotMatch(line, /(^|\/)(docs\/[a-z]+\/[^/]+\.json|manifest\.json|export\.json)$/, line);
});

test('the copy target is its own Worker over ev-staging-scratch, never ev-staging, and the workflow writes no document', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pwa-staging.yml'), 'utf8');
  assert.match(wf, /copy_target:\n\s+description: 'B-319/);
  assert.match(wf, /\n  staging:\n    if: \$\{\{ !inputs\.copy_target \}\}/);
  const job = wf.slice(wf.indexOf('\n  copy-target:'));
  assert.match(job, /if: \$\{\{ inputs\.copy_target \}\}/);
  assert.match(job, /name = "ev-staging-scratch"/);
  assert.match(job, /database_name = "ev-staging-scratch"/);
  assert.doesNotMatch(job, /--env staging|database_name = "ev-staging"\\n|d1 execute ev-staging --/);
  assert.doesNotMatch(job, /INSERT|UPDATE |DELETE|DROP|seed\.sql|run-api\.test/);
});
