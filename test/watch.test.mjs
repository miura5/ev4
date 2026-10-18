// The watchdog (B-11): missed slots, runs that never ended and stalled jobs found by code; each re-fired once, inside
// its window; a second miss reported, not retried; health/current written and rebuildable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EV from '../core/evcore.mjs';
import { loadValidator } from '../core/schemas.mjs';
import { lastSlot, watch } from '../core/watch.mjs';
import * as RUN from '../core/run.mjs';
import { rebuildOne } from '../core/derive.mjs';
import { ROOT } from './helpers.mjs';

const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(base);
const validate = loadValidator();
const withTriggers = target => { const s = JSON.parse(JSON.stringify(base)); let n = 0; for (const t of Object.values(s.tasks[target])) t.trigger = 'trig_test' + (++n); return s; };
const run = (id, pipeline, startedAt, extra = {}) => ({ id, schema: 1, writer: pipeline, at: startedAt, source: 'test', release: 'v4.0.0', pipeline, startedAt, endedAt: extra.status === 'running' ? null : startedAt, status: 'ok', ...extra });

test('lastSlot reads the task table\'s Central schedules, across the change back to standard time', () => {
  assert.equal(lastSlot('CRON_TZ=America/Chicago 25 4 * * *', '2026-10-18T10:00:00Z'), '2026-10-18T09:25:00.000Z');
  assert.equal(lastSlot('CRON_TZ=America/Chicago 25 4 * * *', '2026-10-18T09:00:00Z'), '2026-10-17T09:25:00.000Z');
  assert.equal(lastSlot('CRON_TZ=America/Chicago 57 17 * * 0', '2026-10-19T12:00:00Z'), '2026-10-18T22:57:00.000Z');
  assert.equal(lastSlot('CRON_TZ=America/Chicago 25 4 * * *', '2026-11-02T12:00:00Z'), '2026-11-02T10:25:00.000Z', 'CST after Nov 1');
  assert.equal(lastSlot('CRON_TZ=America/Chicago 0 */3 * * *', '2026-10-18T14:10:00Z'), '2026-10-18T14:00:00.000Z');
  assert.equal(lastSlot('CRON_TZ=America/Chicago 55 20 1 * *', '2026-10-18T14:10:00Z'), null, 'the 1st is more than 8 days back');
  assert.equal(lastSlot(null, '2026-10-18T14:10:00Z'), null);
});

test('a missed morning is re-fired once before 6:00am Central, reported after, and never twice', () => {
  const spec = withTriggers('live');
  const db = { runs: [run('evening-cloud-x', 'evening-cloud', '2026-10-18T01:15:00Z')] };
  let v = watch(db, { now: '2026-10-18T10:30:00Z', record: 'live', spec }); // 5:30am CDT
  const m = v.missing.find(x => x.pipeline === 'morning');
  assert.deepEqual([m.slot, m.refired], ['2026-10-18T09:25:00.000Z', true]);
  const r = v.refires.find(x => x.target.startsWith('morning'));
  assert.deepEqual([r.id, r.trigger, r.text], ['watchdog-refire-morning-20261018-092500000', spec.tasks.live.morning.trigger, undefined]);
  v = watch(db, { now: '2026-10-18T11:30:00Z', record: 'live', spec }); // 6:30am
  assert.ok(!v.refires.some(x => x.target.startsWith('morning')));
  assert.ok(v.reported.some(x => x.target.startsWith('morning') && x.why === 'past its re-fire window'));
  db.runs.push(run('watchdog-refire-morning-20261018-092500000', 'watchdog', '2026-10-18T10:30:00Z'));
  v = watch(db, { now: '2026-10-18T10:45:00Z', record: 'live', spec });
  assert.ok(!v.refires.some(x => x.target.startsWith('morning')));
  assert.ok(v.reported.some(x => x.target.startsWith('morning') && x.why === 'already re-fired once'));
  assert.ok(!v.pipelines.watchdog, 're-fire records are not runs of the watchdog');
});

test('a run that never ended and a job stalled in the queue are re-fired once; fresh ones are left alone', () => {
  const spec = withTriggers('staging');
  const now = '2026-10-18T15:00:00Z';
  const db = {
    runs: [run('morning-old', 'morning', '2026-10-18T13:20:00Z', { status: 'running' }), run('weekly-new', 'weekly', '2026-10-18T14:40:00Z', { status: 'running' })],
    jobs: [
      { id: 'job-a', schema: 1, writer: 'page', at: '2026-10-18T14:30:00Z', source: 'x', kind: 'general', title: 'A', brief: 'a', fired: { at: '2026-10-18T14:30:00Z', ok: true } },
      { id: 'job-b', schema: 1, writer: 'page', at: '2026-10-18T14:50:00Z', source: 'x', kind: 'general', title: 'B', brief: 'b', fired: { at: '2026-10-18T14:50:00Z', ok: true } },
      { id: 'job-c', schema: 1, writer: 'page', at: '2026-10-18T14:00:00Z', source: 'x', kind: 'general', title: 'C', brief: 'c', fired: { at: '2026-10-18T14:00:00Z', ok: true } },
    ],
    jobresults: [{ id: 'job-c', status: 'done' }],
  };
  const v = watch(db, { now, record: 'staging', spec });
  assert.deepEqual(v.stalledRuns.map(r => [r.id, r.minutes, r.refired]), [['morning-old', 100, true]]);
  assert.deepEqual(v.stalledJobs.map(j => [j.id, j.minutes]), [['job-a', 30]]);
  assert.deepEqual(v.refires.map(r => [r.id, r.trigger, r.text || null]), [
    ['watchdog-refire-morning-old', spec.tasks.staging.morning.trigger, null],
    ['watchdog-refire-job-job-a', spec.tasks.staging.worker.trigger, 'Job job-a'],
  ]);
  assert.deepEqual(v.missing, [], 'staging tasks are fire-only: no slot to miss');
});

test('the watchdog pipeline: re-fire records and health/current in one batch, then the printed fire_trigger calls; health rebuilds', () => {
  const spec = withTriggers('staging');
  const at = '2026-10-18T15:00:00Z';
  const db = {
    runs: [run('morning-old', 'morning', '2026-10-18T13:20:00Z', { status: 'running' })],
    jobs: [{ id: 'job-a', schema: 1, writer: 'page', at: '2026-10-18T14:30:00Z', source: 'x', kind: 'general', title: 'A', brief: 'a', fired: { at: '2026-10-18T14:30:00Z', ok: true } }],
    jobresults: [], state: [],
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-watch-'));
  RUN.start({ spec, pipeline: 'watchdog', record: 'staging', at, dir, release: 'v4.0.0' });
  const lines = [];
  for (const c of RUN.pull({ spec, dir, at })) {
    const docs = (db[c.args.collection] || []).filter(d => !c.args.query.where || EV.toMs(d.at) >= EV.toMs(c.args.query.where[0][2]));
    for (const d of docs) { const f = path.join(c.args.out_dir, c.args.collection, d.id + '.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(EV.docData(d))); }
    lines.push(JSON.stringify({ message: { content: [{ type: 'tool_use', id: 'p' + c.args.collection, name: 'ArtifactData', input: c.args }] } }));
    lines.push(JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: 'p' + c.args.collection, content: [{ type: 'text', text: docs.length ? `${docs.length} documents from collection "${c.args.collection}" saved:\n` + docs.map(d => `- "${d.id}"  1 bytes  version 1  "x"`).join('\n') : '0 documents' }] }] } }));
  }
  RUN.pulled({ spec, dir, transcript: lines.join('\n') });
  const r = RUN.compute({ spec, dir, validate, at });
  assert.equal(r.status, 'planned', JSON.stringify(r.problems));
  assert.deepEqual(r.plan.batches.flat().map(w => `${w.collection}/${w.doc_id}`).sort(), ['health/current', 'runs/watchdog-refire-job-job-a', 'runs/watchdog-refire-morning-old']);
  assert.match(r.plan.push, /^Watchdog: re-fired run morning-old; re-fired job job-a/);
  const calls = RUN.apply({ dir });
  assert.deepEqual(calls.map(c => c.tool), ['ArtifactData', 'mcp__claude-code-remote__fire_trigger', 'mcp__claude-code-remote__fire_trigger']);
  assert.deepEqual(calls.slice(1).map(c => c.args), [{ trigger_id: spec.tasks.staging.morning.trigger }, { trigger_id: spec.tasks.staging.worker.trigger, text: 'Job job-a' }]);
  // The record after the batch: health/current says both were re-fired, and a rebuild agrees.
  const after = JSON.parse(JSON.stringify(db));
  for (const w of r.plan.batches.flat()) (after[w.collection] = after[w.collection] || []).push({ ...JSON.parse(fs.readFileSync(w.file_path, 'utf8')), id: w.doc_id });
  const health = after.health.find(h => h.id === 'current');
  assert.deepEqual([health.stalledRuns[0].refired, health.stalledJobs[0].refired, health.record], [true, true, 'staging']);
  assert.deepEqual(health.reported, [], 'this run\'s own re-fires are not second misses');
  assert.ok(validate('health', EV.docData(health), { id: 'current' }).ok);
  assert.equal(rebuildOne(after, spec, 'health', health).status, 'same');
  // The next watchdog run sees the records and reports instead of re-firing.
  const again = watch(after, { now: '2026-10-18T15:30:00Z', record: 'staging', spec });
  assert.deepEqual(again.refires, []);
  assert.deepEqual(again.reported.map(x => x.why), ['already re-fired once', 'already re-fired once']);
});
