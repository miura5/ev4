// B-139 (T-3 of the v4.1 review): the three pipeline steps no test named, run as the pipeline runs them, on planted
// records: the watchdog's watch step (a missed slot inside and outside its re-fire window, a start the scheduler fired
// that left no run, a stalled job, a Mac miss, the watchdog's own entry), weekly's week-brief and evening-mac's
// mac-files. Every document a step writes validates against its schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EV from '../core/evcore.mjs';
import { readExport, loadValidator } from '../core/schemas.mjs';
import { CODE_STEPS, AGENT_MATERIAL, AGENT_FOLDS, MAC_FILES } from '../core/steps.mjs';
import { ROOT } from './helpers.mjs';

const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(base);
const validate = loadValidator();
// The record's own trigger ids, and no since cut: the cases sit on Oct 18 and 19.
const specFor = target => {
  const s = JSON.parse(JSON.stringify(base));
  let n = 0;
  for (const t of Object.values(s.tasks[target])) t.trigger = t.trigger || 'trig_test' + ++n;
  delete s.constants.watchdog.since;
  return s;
};
const run = (id, pipeline, startedAt, extra = {}) => ({
  id,
  schema: 1,
  writer: pipeline,
  at: startedAt,
  source: 'test',
  release: 'v4.0.0',
  pipeline,
  startedAt,
  endedAt: extra.status === 'running' ? null : startedAt,
  status: 'ok',
  ...extra,
});
const ctxAt = (now, record, extra = {}) => ({
  now,
  record,
  source: 'watchdog test',
  release: 'v4.0.0',
  scheduler: null,
  ...extra,
});
const valid = writes => {
  for (const w of writes) {
    const r = validate(w.collection, w.data, { id: w.id });
    assert.ok(r.ok, `${w.collection}/${w.id}: ${JSON.stringify(r.errors || r)}`);
  }
};

test('B-139: watch re-fires a missed morning inside its window with a valid record and one fire, and only reports it after', () => {
  const spec = specFor('live');
  const db = { runs: [run('evening-cloud-x', 'evening-cloud', '2026-10-18T01:15:00Z')], jobs: [], jobresults: [] };
  const inside = CODE_STEPS.watch(db, ctxAt('2026-10-18T10:30:00Z', 'live'), spec); // 5:30am CDT
  const refire = inside.writes.find(w => /^watchdog-refire-morning-/.test(w.id));
  assert.ok(refire, 'the re-fire is recorded');
  valid(inside.writes);
  assert.deepEqual(refire.data.detail, `re-fired morning slot 2026-10-18T09:25:00.000Z: missed its slot`);
  assert.ok(inside.fires.some(f => f.trigger_id === spec.tasks.live.morning.trigger && !f.text));
  assert.match(inside.push, /^Watchdog: .*re-fired morning slot/);
  assert.match(inside.say[0], /^\d+ missed, 0 unfinished, 0 stalled; re-firing \d+\.$/);
  // Past 6:00am Central: nothing re-fired for the morning, the miss reported in the push and the say.
  const outside = CODE_STEPS.watch(db, ctxAt('2026-10-18T11:30:00Z', 'live'), spec);
  assert.ok(!outside.writes.some(w => /morning/.test(w.id)));
  assert.ok(!outside.fires.some(f => f.trigger_id === spec.tasks.live.morning.trigger));
  assert.ok(outside.say.some(l => /^Not re-fired: morning slot .*\(past its re-fire window\)\.$/.test(l)));
  assert.match(outside.push, /morning slot [^;]* past its re-fire window/);
});

test('B-139: a firing the scheduler recorded that left no run is named as refused at start; a slot never fired as never fired', () => {
  const spec = specFor('live');
  const db = { runs: [run('evening-cloud-x', 'evening-cloud', '2026-10-18T01:15:00Z')], jobs: [], jobresults: [] };
  const fired = [
    { task: 'morning', pipeline: 'morning', trigger: spec.tasks.live.morning.trigger, firedAt: '2026-10-18T09:25:40Z' },
  ];
  const out = CODE_STEPS.watch(db, ctxAt('2026-10-18T10:30:00Z', 'live', { scheduler: fired }), spec);
  assert.match(out.push, /^Watchdog: morning fired but left no run \(04:25\)/);
  valid(out.writes);
  const never = CODE_STEPS.watch(db, ctxAt('2026-10-18T10:30:00Z', 'live', { scheduler: [] }), spec);
  assert.match(never.push, /morning was never fired \(04:25\)/);
});

test('B-139: a job stalled in the queue is re-fired once with its id; a run that never ended likewise; fresh ones are left alone', () => {
  const spec = specFor('staging');
  const now = '2026-10-18T15:00:00Z';
  const job = (id, at) => ({
    id,
    schema: 1,
    writer: 'page',
    at,
    source: 'x',
    kind: 'general',
    title: id,
    brief: id,
    fired: { at, ok: true },
  });
  const db = {
    runs: [
      run('morning-x', 'morning', '2026-10-18T09:30:00Z'),
      run('weekly-old', 'weekly', '2026-10-18T13:20:00Z', { status: 'running' }),
    ],
    jobs: [job('job-a', '2026-10-18T14:30:00Z'), job('job-b', '2026-10-18T14:55:00Z')],
    jobresults: [],
  };
  const out = CODE_STEPS.watch(db, ctxAt(now, 'staging'), spec);
  valid(out.writes);
  assert.deepEqual(
    out.fires.filter(f => f.text).map(f => [f.trigger_id, f.text]),
    [[spec.tasks.staging.worker.trigger, 'Job job-a']]
  );
  assert.ok(out.writes.some(w => w.id === 'watchdog-refire-job-job-a'));
  assert.ok(!out.writes.some(w => /job-b/.test(w.id)), 'a job five minutes old is not stalled');
  assert.ok(out.writes.some(w => w.id === 'watchdog-refire-weekly-old'));
  assert.match(out.say[0], /, 1 unfinished, 1 stalled; /);
  // Once re-fired, the next watch reports instead of firing again.
  const again = CODE_STEPS.watch(
    { ...db, runs: [...db.runs, ...out.writes.map(w => ({ ...w.data, id: w.id }))] },
    ctxAt('2026-10-18T15:10:00Z', 'staging'),
    spec
  );
  assert.ok(!again.fires.some(f => f.text === 'Job job-a'));
  assert.ok(again.say.some(l => /job-a.*already re-fired once/.test(l)));
});

test('B-139: a missed Mac slot is named in the push and never re-fired (D-087)', () => {
  const spec = specFor('live');
  const db = { runs: [run('evening-cloud-x', 'evening-cloud', '2026-10-19T01:15:00Z')], jobs: [], jobresults: [] };
  const out = CODE_STEPS.watch(db, ctxAt('2026-10-19T02:00:00Z', 'live', { scheduler: [] }), spec);
  assert.match(out.push, /evening-mac was never fired \(20:20\)/);
  assert.ok(!out.fires.some(f => f.trigger_id === spec.tasks.live['evening-mac'].trigger));
  assert.ok(!out.writes.some(w => /evening-mac/.test(w.id)));
});

test("B-139: the watchdog's own entry, running as it watches, is neither a stalled run nor a miss, and the health it writes validates", () => {
  const spec = specFor('live');
  const now = '2026-10-18T12:56:00Z'; // 7:56am CDT, its 7:55 slot
  const db = {
    runs: [
      run('morning-x', 'morning', '2026-10-18T09:25:30Z'),
      run('watchdog-20261018-125530000', 'watchdog', '2026-10-18T12:55:30Z', { status: 'running' }),
      run('watchdog-20261018-095530000', 'watchdog', '2026-10-18T09:55:30Z'),
    ],
    jobs: [],
    jobresults: [],
  };
  const out = CODE_STEPS.watch(db, ctxAt(now, 'live'), spec);
  assert.ok(!out.writes.some(w => /watchdog-refire-watchdog/.test(w.id)));
  assert.ok(!out.fires.some(f => f.trigger_id === spec.tasks.live.watchdog.trigger));
  assert.match(out.say[0], /, 0 unfinished, /);
  // Hours later its own entry is still running: the watchdog never re-fires itself (stalledRuns skip it).
  const later = CODE_STEPS.watch(db, ctxAt('2026-10-18T15:00:00Z', 'live'), spec);
  assert.ok(!later.writes.some(w => /watchdog-refire-watchdog-2026/.test(w.id)));
  const health = CODE_STEPS.health(db, ctxAt(now, 'live'), spec);
  valid(health.writes);
  assert.equal(health.writes[0].id, 'current');
});

// ---------------------------------------------------------------- weekly and evening-mac, on the fixture record
const recordDb = () => {
  const db = {};
  for (const { collection, id, doc } of readExport(path.join(ROOT, 'test/data/record')))
    (db[collection] = db[collection] || []).push({ ...doc, id });
  return db;
};

test('B-139: week-brief rolls up the week, hands the review step its material, and the weeks document it leads to validates', () => {
  const db = recordDb();
  delete db.journal;
  const ctx = { date: '2026-10-18', now: '2026-10-18T22:57:00.000Z', source: 'weekly test', writer: 'weekly' };
  const out = CODE_STEPS['week-brief'](db, ctx, base);
  assert.match(
    out.say[0],
    /^Week \d{4}-\d\d-\d\d\.\.\d{4}-\d\d-\d\d: \d+\/\d+ right, \d+ new weak spots, \d+ made solid\.$/
  );
  const w = AGENT_MATERIAL['week-brief'](db, ctx);
  assert.equal(w, ctx.week);
  for (const k of ['from', 'to', 'answered', 'right', 'ahead', 'stillWeak']) assert.ok(k in w, k);
  assert.ok(w.ahead.every(d => d.date > ctx.date && d.date <= EV.addDays(ctx.date, 7)));
  assert.ok(w.stillWeak.length <= 5);
  const doc = AGENT_FOLDS['week-doc'](
    { review: 'A steady week.', reflection: 'What went well?', push: 'Weekly review ready' },
    db,
    ctx,
    base
  );
  valid(doc.writes);
  assert.equal(doc.writes[0].id, ctx.date);
});

test('B-139: mac-files writes the backup (and the mirror on a Sunday) under the run outputs, as device_commit_files calls into its folder only', () => {
  const db = recordDb();
  const outputs = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-macfiles-'));
  const ctx = (date, input = {}) => ({
    date,
    now: date + 'T01:20:30.000Z',
    record: 'staging',
    outputs,
    runId: 'evening-mac-' + date,
    pipeline: 'evening-mac',
    release: 'v4.0.0',
    input,
  });
  const folder = base.tasks.staging['evening-mac'].folders[0];
  const wed = CODE_STEPS['mac-files'](db, ctx('2026-10-21'), base); // a Wednesday: the backup only
  const files = wed.device.flatMap(c => c.args.files);
  assert.deepEqual(
    files.map(f => f.devicePath),
    [folder + '/' + MAC_FILES.backup('wednesday')]
  );
  assert.ok(wed.device.every(c => c.tool === 'mcp__remote-devices__device_commit_files' && c.args.files.length <= 50));
  const backup = JSON.parse(fs.readFileSync(files[0].stagedPath, 'utf8'));
  assert.equal(backup.kind, 'E.V. record backup');
  assert.ok(!('system' in backup.collections), 'the system documents are not backed up');
  for (const [col, docs] of Object.entries(backup.collections)) {
    assert.equal(backup.counts[col], docs.length, col);
    assert.match(backup.hashes[col], /^[0-9a-f]{64}$/, col);
    for (const d of docs) {
      const { id, ...data } = d;
      if (fs.existsSync(path.join(ROOT, 'spec/schemas', col + '.schema.json')))
        assert.ok(validate(col, EV.docData ? EV.docData(d) : data, { id }).ok, `${col}/${id}`);
    }
  }
  assert.ok(files[0].stagedPath.startsWith(path.join(outputs, 'evening-mac-2026-10-21')));
  assert.match(wed.detail, /^backup backup\/E\.V\.-v4-backup-wednesday\.json \(\d+ documents, \d+ KB\)$/);
  // A Sunday adds the Markdown mirror, every file under mirror-v4 in the same folder.
  const sun = CODE_STEPS['mac-files'](db, ctx('2026-10-25'), base);
  const sunFiles = sun.device.flatMap(c => c.args.files);
  assert.ok(sunFiles.length > 1);
  assert.ok(sunFiles.slice(1).every(f => f.devicePath.startsWith(folder + '/' + MAC_FILES.mirror + '/')));
  assert.match(sun.detail, /, mirror \d+ files$/);
  assert.ok(
    sunFiles.every(f => f.devicePath.startsWith(folder + '/')),
    "nothing outside E.V.'s folder"
  );
});
