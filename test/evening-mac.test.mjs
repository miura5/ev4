// B-21, the Mac lane's evening run: Canvas scripts as files with their parameters filled in, run here against a
// made-up Canvas (a stub fetch), collected through the padded poll and unwrap, folded into dates, announcements and
// materials; then the backup (with the hashes restore-drill checks) and the mirror as device_commit_files calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import EV from '../core/evcore.mjs';
import * as RUN from '../core/run.mjs';
import * as CANVAS from '../core/canvas.mjs';
import { collectionHash } from '../core/seed.mjs';
import { readExport, loadValidator } from '../core/schemas.mjs';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
// B-315, B-317: these tests drive the ArtifactData protocol on the staging record; test/run-worker.test.mjs proves the Worker target.
delete spec.registry.records.staging.runs;
EV.configure(spec);
const validate = loadValidator();
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const NUR = spec.courses['NUR 112'].canvasId; // B-42: Canvas ids live in spec.courses

// ---------------------------------------------------------------- a made-up Canvas
const API = {
  '/api/v1/planner/items': [
    {
      plannable_id: 9001,
      plannable_type: 'assignment',
      course_id: NUR,
      plannable_date: '2026-10-22T04:59:00Z',
      plannable: { title: 'Practice care plan', due_at: '2026-10-22T04:59:00Z', points_possible: 10 },
    },
    {
      plannable_id: 9002,
      plannable_type: 'calendar_event',
      course_id: 1,
      plannable_date: '2026-10-22T15:00:00Z',
      plannable: { title: 'Another course' },
    },
  ],
  '/api/v1/announcements': [
    {
      id: 77,
      title: 'Lab moved',
      message: '<p>Skills lab is in room&nbsp;B this week.</p>',
      posted_at: '2026-10-17T14:00:00Z',
      context_code: 'course_' + NUR,
      html_url: 'https://example.invalid/a/77',
    },
  ],
  [`/api/v1/courses/${NUR}/modules`]: [
    {
      name: 'Exam 5 Content',
      items: [
        { type: 'File', content_id: 501, title: 'Ch 60 Mobility.pdf' },
        { type: 'File', content_id: 502, title: 'Lecture video.mp4' },
      ],
    },
  ],
  [`/api/v1/courses/${NUR}/files/501`]: {
    display_name: 'Ch 60 Mobility.pdf',
    'content-type': 'application/pdf',
    size: 1000,
    updated_at: '2026-10-16T10:00:00Z',
  },
};
/** Runs a printed script the way javascript_tool does, in a page whose fetch answers from API (GET only). */
function browser({ signedOut = false } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' });
    if (signedOut) return { ok: false, status: 401, type: 'basic', text: async () => '' };
    const key = Object.keys(API).find(k => String(url).split('?')[0] === k);
    if (!key) return { ok: false, status: 404, type: 'basic', text: async () => '' };
    return { ok: true, status: 200, type: 'basic', text: async () => 'while(1);' + JSON.stringify(API[key]) };
  };
  const window = {};
  const ctx = vm.createContext({
    window,
    fetch,
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Set,
    RegExp,
    Promise,
    Error,
    Uint8Array,
    DOMParser: class {
      parseFromString(h) {
        return {
          body: {
            textContent: String(h)
              .replace(/<[^>]+>/g, '')
              .replace(/&nbsp;/g, ' '),
          },
        };
      }
    },
  });
  return { run: src => vm.runInContext(src, ctx), calls, window };
}
const settle = () => new Promise(r => setTimeout(r, 20));
/** Start, poll until done, and save the poll result the way the browser tool does ([{type, text}]). */
async function collect(page, script, part, file) {
  assert.equal(page.run(script), 'started ' + part);
  await settle();
  const polled = page.run(CANVAS.canvasScript(ROOT, 'poll', { part }));
  assert.ok(polled.length > 90000, 'padded past the inline limit');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const saved = file + '.tool.json';
  fs.writeFileSync(saved, JSON.stringify([{ type: 'text', text: polled }]));
  const v = CANVAS.unwrap(fs.readFileSync(saved, 'utf8'));
  fs.writeFileSync(file, JSON.stringify(v));
  return v;
}

test('the scripts are files with only their parameters and E.V. core functions filled in, and they compile', () => {
  for (const part of ['dates', 'files', 'texts', 'poll']) {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/canvas', part + '.js'), 'utf8');
    assert.match(src, /\/\*@PARAMS\*\/null/, part);
    const params =
      part === 'poll' ? { part: 'dates' } : CANVAS.scriptParams(part, { spec, db: {}, batch: 1, files: [] });
    const out = CANVAS.canvasScript(ROOT, part, params);
    assert.doesNotMatch(out, /\/\*@/, part);
    assert.doesNotThrow(() => new vm.Script(out), part);
    assert.doesNotMatch(out, /method:\s*['"](POST|PUT|PATCH|DELETE)/i, `${part} makes GET requests only`);
    assert.doesNotMatch(out, /\b(eval|Function)\(/, part);
  }
  assert.match(
    CANVAS.canvasScript(ROOT, 'files', CANVAS.scriptParams('files', { spec, db: {} })),
    /function libraryPick\(course, modules, rules\)/
  );
  assert.throws(() => CANVAS.canvasScript(ROOT, 'grades', {}), /no Canvas script grades/);
});

test('dates and files run against a stub Canvas, are collected by poll and unwrap, and only GET', async () => {
  const dir = tmp('ev4-canvas-');
  const page = browser();
  const d = await collect(
    page,
    CANVAS.canvasScript(ROOT, 'dates', CANVAS.scriptParams('dates', { spec, db: { announcements: [] } })),
    'dates',
    path.join(dir, 'in/canvas-dates.json')
  );
  assert.deepEqual(
    d.planner.map(p => p.plannable_id),
    [9001],
    "only the registry's courses"
  );
  assert.equal(d.announcements[0].text, 'Skills lab is in room B this week.');
  const f = await collect(
    page,
    CANVAS.canvasScript(ROOT, 'files', CANVAS.scriptParams('files', { spec, db: {} })),
    'files',
    path.join(dir, 'in/canvas-files.json')
  );
  assert.deepEqual(
    f.files.map(x => [x.fileId, x.fileType, x.updatedAt]),
    [[501, 'pdf', '2026-10-16T10:00:00Z']],
    'the video is not a library file'
  );
  assert.ok(page.calls.every(c => c.method === 'GET'));
  assert.deepEqual(
    CANVAS.changedFiles(f, [{ fileId: 501, fileUpdatedAt: '2026-10-16T10:00:00Z' }]),
    [],
    'an unchanged file is not read again'
  );
  assert.equal(CANVAS.textBatches(CANVAS.changedFiles(f, []), null).length, 1);
  // Signed out: the part fails with signed-out and the raw gather says so.
  const out = browser({ signedOut: true });
  const s = await collect(
    out,
    CANVAS.canvasScript(ROOT, 'dates', CANVAS.scriptParams('dates', { spec, db: {} })),
    'dates',
    path.join(dir, 'out/canvas-dates.json')
  );
  assert.equal(s.failed, 'signed-out');
  assert.equal(CANVAS.canvasRaw(path.join(dir, 'out'), spec).collected.signedOut, true);
  // A result the bridge cut is said to be cut, never guessed at.
  assert.throws(
    () => CANVAS.unwrap(JSON.stringify([{ type: 'text', text: '{"result":{"part":"texts","files":[{"text":"abc' }])),
    /cut by the device bridge/
  );
  assert.throws(() => CANVAS.unwrap('still running (12 s): poll again in a little while'), /not a finished result/);
});

test('an evening-mac run: Canvas folds into the record, the backup and mirror become device calls after the batches', async () => {
  const dir = tmp('ev4-emac-');
  const outputs = tmp('ev4-out-');
  const AT = '2026-10-19T01:20:00Z'; // Sunday 8:20pm Central
  RUN.start({ spec, pipeline: 'evening-mac', record: 'staging', at: AT, dir, release: 'v4.0.0', outputs });
  const pullCalls = RUN.pull({ spec, dir, at: AT });
  assert.ok(!pullCalls.some(c => c.args.collection === 'system'), 'system is never pulled');
  assert.ok(
    pullCalls.some(c => c.args.collection === 'journal'),
    'the journal is a named read for the backup and mirror (D-113)'
  );
  // The pull, as files and versions (the transcript side is run.test's).
  const versions = {};
  for (const { collection, id, doc } of readExport(path.join(ROOT, 'test/data/record'))) {
    if (collection === 'system') continue;
    const f = path.join(dir, 'pull', collection, id + '.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(EV.docData({ ...doc, id })));
    (versions[collection] = versions[collection] || {})[id] = 3;
  }
  fs.writeFileSync(path.join(dir, 'versions.json'), JSON.stringify(versions));
  let r = RUN.compute({ spec, dir, validate, at: AT });
  assert.equal(r.status, 'waiting');
  assert.equal(r.step, 'canvas');
  assert.match(r.question.material.parts[0].print, new RegExp(`node core/cli\\.mjs canvas-script dates --dir ${dir}`));
  // The agent collects dates and files (texts: none changed in this made-up Canvas but one new file; skip its text).
  const page = browser();
  await collect(
    page,
    CANVAS.canvasScript(ROOT, 'dates', CANVAS.scriptParams('dates', { spec, db: RUN.loadPulled(dir) })),
    'dates',
    path.join(dir, 'in/canvas-dates.json')
  );
  await collect(
    page,
    CANVAS.canvasScript(ROOT, 'files', CANVAS.scriptParams('files', { spec, db: {} })),
    'files',
    path.join(dir, 'in/canvas-files.json')
  );
  fs.mkdirSync(path.join(dir, 'answers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'answers/canvas.json'), JSON.stringify({ status: 'ok' }));
  r = RUN.compute({ spec, dir, validate, at: AT });
  assert.equal(r.status, 'planned', JSON.stringify(r.problems || r.question));
  const plan = r.plan;
  const written = plan.batches.flat().map(w => `${w.op} ${w.collection}/${w.doc_id}`);
  assert.ok(written.includes('set dates/canvas-9001'), written.join(', '));
  assert.ok(written.includes('set announcements/canvas-77'));
  const date = JSON.parse(fs.readFileSync(plan.batches.flat().find(w => w.doc_id === 'canvas-9001').file_path, 'utf8'));
  assert.equal(date.writer, 'canvas-sync');
  assert.equal(date.graded, true);
  assert.match(date.notes, /^Due 11:59pm\. Graded\.$/);
  assert.ok(
    /modules BIO 201/.test(JSON.stringify(CANVAS.canvasRaw(path.join(dir, 'in'), spec).errors)),
    'the stub has no BIO 201 modules: one fetch error, kept'
  );
  assert.equal(
    plan.steps.find(s => s.id === 'note').status,
    'skipped',
    'no conflict and not Saturday: no note to write'
  );
  assert.match(
    plan.detail,
    /Canvas: 1 new and 0 changed dates, 1 announcements, 0 files, 1 fetch errors · backup backup\/E\.V\.-v4-backup-sunday\.json \(\d+ documents, \d+ KB; schema versions [a-z:0-9 ]+\), mirror \d+ files/
  );
  // The Mac's files: staged under outputs, committed into E.V.'s own names in the staging folder.
  const folder = spec.tasks.staging['evening-mac'].folders[0];
  const files = plan.device.flatMap(c => c.args.files);
  assert.ok(plan.device.every(c => c.tool === 'mcp__remote-devices__device_commit_files' && c.args.files.length <= 50));
  assert.ok(files.every(f => f.stagedPath.startsWith(outputs) && f.devicePath.startsWith(folder + '/')));
  assert.ok(
    files.every(f => /\/(backup\/E\.V\.-v4-backup-\w+\.json|mirror-v4\/.+\.md)$/.test(f.devicePath)),
    "never one of v3's file names"
  );
  const backup = JSON.parse(fs.readFileSync(files.find(f => /backup/.test(f.devicePath)).stagedPath, 'utf8'));
  assert.equal(backup.kind, 'E.V. record backup');
  assert.ok(!backup.collections.system);
  assert.equal(
    !!backup.collections.journal,
    fs.existsSync(path.join(ROOT, 'test/data/record/journal')),
    'the journal is in the backup when there is one (D-113)'
  );
  assert.ok(
    backup.collections.dates.some(d => d.id === 'canvas-9001'),
    "the backup holds tonight's Canvas writes"
  );
  for (const [c, docs] of Object.entries(backup.collections)) {
    assert.equal(backup.counts[c], docs.length);
    assert.equal(backup.hashes[c], collectionHash(docs), c);
  }
  // apply prints the record's batches first, then the Mac's files.
  const calls = RUN.apply({ dir });
  assert.deepEqual([...new Set(calls.map(c => c.tool))], ['ArtifactData', 'mcp__remote-devices__device_commit_files']);
  // Signed out: nothing written to the record, the backup still goes to the Mac.
  fs.writeFileSync(path.join(dir, 'answers/canvas.json'), JSON.stringify({ status: 'signed-out' }));
  r = RUN.compute({ spec, dir, validate, at: AT });
  assert.equal(r.status, 'planned');
  assert.equal(r.plan.writes, 0);
  assert.match(r.plan.detail, /^Canvas skipped: signed-out · backup/);
  assert.ok(r.plan.device.length >= 1);
});

test('restore drill: the newest backup restores into staging, counts and hashes checked; a tampered backup is refused', () => {
  const pullFixture = dir => {
    const versions = {};
    for (const { collection, id, doc } of readExport(path.join(ROOT, 'test/data/record'))) {
      if (collection === 'journal' || collection === 'system') continue;
      const f = path.join(dir, 'pull', collection, id + '.json');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(EV.docData({ ...doc, id })));
      (versions[collection] = versions[collection] || {})[id] = 3;
    }
    fs.writeFileSync(path.join(dir, 'versions.json'), JSON.stringify(versions));
  };
  const AT = '2026-11-02T02:55:00Z';
  // A backup made from the fixture record plus one Canvas date the record does not have (as if written after a loss).
  const db = RUN.loadPulled(
    (() => {
      const d = tmp('ev4-src-');
      pullFixture(d);
      return d;
    })()
  );
  const lost = {
    id: 'canvas-424242',
    ...EV.envelope('canvas-sync', 'Canvas sync', '2026-10-30T01:20:00Z'),
    date: '2026-11-05',
    dueAt: '2026-11-06T04:59:00Z',
    title: 'Made-up care plan',
    course: 'NUR 112',
    kind: 'due',
    graded: true,
    canvasType: 'assignment',
    canvasId: 424242,
    syncedAt: '2026-10-30T01:20:00Z',
  };
  const backup = await_ => {
    const { macBackup } = await_;
    return macBackup(
      { ...db, dates: [...db.dates, lost] },
      { now: '2026-11-01T01:20:00Z', label: 'evening-mac test', release: 'v4.0.0' }
    );
  };
  return import('../core/steps.mjs').then(steps => {
    const b = backup(steps);
    const run = (
      body,
      answer = { status: 'ok', path: '/Users/x/E.V. Study Watch/staging/backup/E.V.-v4-backup-saturday.json' }
    ) => {
      const dir = tmp('ev4-drill-');
      RUN.start({ spec, pipeline: 'restore-drill', record: 'staging', at: AT, dir, release: 'v4.0.0' });
      assert.ok(!RUN.pull({ spec, dir, at: AT }).some(c => ['journal', 'system'].includes(c.args.collection)));
      pullFixture(dir);
      let r = RUN.compute({ spec, dir, validate, at: AT });
      assert.equal(r.status, 'waiting');
      assert.equal(r.step, 'fetch-backup');
      assert.deepEqual(r.question.material.look, [
        // D-322: the drill's folder is staging's one backup folder.
        spec.tasks.staging['restore-drill'].folders[0] + '/backup',
        spec.tasks.staging['restore-drill'].folders[0] + '/staging/backup',
      ]);
      if (body != null) {
        fs.mkdirSync(path.join(dir, 'in'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'in/backup.json'), body);
      }
      fs.mkdirSync(path.join(dir, 'answers'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'answers/fetch-backup.json'), JSON.stringify(answer));
      return RUN.compute({ spec, dir, validate, at: AT });
    };
    const ok = run(JSON.stringify(b));
    assert.equal(ok.status, 'planned', JSON.stringify(ok.problems));
    assert.deepEqual(
      ok.plan.batches.flat().map(w => `${w.op} ${w.collection}/${w.doc_id}`),
      ['set dates/canvas-424242'],
      'only what differs is written back'
    );
    assert.match(
      ok.plan.detail,
      /^drill ok: E\.V\.-v4-backup-saturday\.json .* counts and hashes match its manifest; every document already at this build.s schema; 1 restored, \d+ already identical/
    );
    const tampered = JSON.parse(JSON.stringify(b));
    tampered.collections.dates[0].title = 'changed after the backup';
    const bad = run(JSON.stringify(tampered));
    assert.equal(bad.status, 'refused');
    assert.match(bad.problems.join(' '), /dates: its documents do not hash to its manifest/);
    assert.equal(run(null, { status: 'none' }).status, 'refused');
    assert.match(run('{"kind":"E.V. record backup"}').problems.join(' '), /not a v4 backup/);
  });
});

test('B-62 (D-113): the mirror holds the journal the run read; the restore drill takes a backup that holds it', () => {
  const files = EV.toMarkdown(
    { journal: [{ id: 'j-made-up', kind: 'free', createdAt: '2026-10-19T02:00:00Z', text: 'A made-up entry.' }] },
    { date: '2026-10-19' }
  );
  const j = files.find(f => f.path === 'journal/j-made-up.md');
  assert.ok(j && /A made-up entry\./.test(j.content), JSON.stringify(files.map(f => f.path)));
});
