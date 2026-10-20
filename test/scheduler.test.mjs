// B-61 (D-112): the watchdog compares the scheduler's record with the record's. Its list_triggers pages (read and
// saved by the run, as the weekly reads them for verify) give each task's last firing; a firing with no run document
// within 5 minutes is refused-at-start, a slot past its grace with no firing is not-fired; both are health/current.missing
// entries with a kind and are named in the push. Made-up triggers and runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import EV from '../core/evcore.mjs';
import { watch, schedulerView, healthBody } from '../core/watch.mjs';
import { CODE_STEPS, AGENT_MATERIAL, AGENT_FOLDS } from '../core/steps.mjs';
import { rebuildOne } from '../core/derive.mjs';
import { loadValidator } from '../core/schemas.mjs';
import { ROOT } from './helpers.mjs';

const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(base);
const spec = (() => { const s = JSON.parse(JSON.stringify(base)); let n = 0; for (const t of Object.values(s.tasks.live)) t.trigger = 'trig_test' + (++n); delete s.constants.watchdog.since; return s; })();
const T = name => spec.tasks.live[name].trigger;
const run = (id, pipeline, startedAt, extra = {}) => ({ id, schema: 1, writer: pipeline, at: startedAt, source: 'test', release: 'v4.0.0', pipeline, startedAt, endedAt: startedAt, status: 'ok', ...extra });
const page = (...xs) => ({ data: xs.map(([id, firedAt, status = 'ROUTINE_RUN_STATUS_SUCCEEDED']) => ({ id, enabled: true, last_fired_at: firedAt, ...(firedAt ? { last_run: { status, fired_at: firedAt } } : {}) })), has_more: false });

test('schedulerView: each task of the record with its trigger\'s last firing; triggers the record does not name are left out', () => {
  const v = schedulerView([page([T('morning'), '2026-10-20T09:25:28Z']), page([T('watchdog'), '2026-10-20T09:55:10Z'], ['trig_other', '2026-10-20T09:00:00Z'])], { record: 'live', spec });
  assert.deepEqual(v.map(x => [x.task, x.firedAt, x.status]), [['morning', '2026-10-20T09:25:28Z', 'SUCCEEDED'], ['watchdog', '2026-10-20T09:55:10Z', 'SUCCEEDED']]);
});

test('a SUCCEEDED firing with no run document within 5 minutes is refused-at-start; a slot with no firing is not-fired', () => {
  const now = '2026-10-20T10:40:00Z'; // 5:40am CDT: the 4:25 morning slot is past its grace
  const db = { runs: [run('watchdog-a', 'watchdog', '2026-10-20T08:55:00Z')] };
  // Tonight's case: the scheduler fired the morning, the run refused at its start and left nothing.
  let v = watch(db, { now, record: 'live', spec, scheduler: schedulerView([page([T('morning'), '2026-10-20T09:25:28Z'])], { record: 'live', spec }) });
  assert.equal(v.missing.find(m => m.pipeline === 'morning').kind, 'refused-at-start');
  // No firing since the slot: not-fired.
  v = watch(db, { now, record: 'live', spec, scheduler: schedulerView([page([T('morning'), '2026-10-19T09:25:28Z'])], { record: 'live', spec }) });
  assert.equal(v.missing.find(m => m.pipeline === 'morning').kind, 'not-fired');
  // Without the scheduler's read the miss stays, with no kind it can tell.
  assert.equal(watch(db, { now, record: 'live', spec }).missing.find(m => m.pipeline === 'morning').kind, 'no-run');
  // A run document within 5 minutes of the firing: nothing missing.
  const ok = { runs: [...db.runs, run('morning-b', 'morning', '2026-10-20T09:26:10Z')] };
  assert.equal(watch(ok, { now, record: 'live', spec, scheduler: schedulerView([page([T('morning'), '2026-10-20T09:25:28Z'])], { record: 'live', spec }) }).missing.some(m => m.pipeline === 'morning'), false);
  // A failed gate leaves runs/<pipeline>-failed-*: that is a trace, not a refusal with nothing.
  const traced = { runs: [...db.runs, { id: 'morning-failed-x', schema: 1, writer: 'morning', at: '2026-10-20T09:26:00Z', source: 'morning gate', pipeline: 'morning', startedAt: '2026-10-20T09:25:30Z', endedAt: '2026-10-20T09:26:00Z', status: 'failed' }] };
  assert.equal(watch(traced, { now, record: 'live', spec, scheduler: schedulerView([page([T('morning'), '2026-10-20T09:25:28Z'])], { record: 'live', spec }) }).missing.some(m => m.pipeline === 'morning'), false);
});

test('a firing outside any slot (a fire-only staging task) that left no run is refused-at-start; one too fresh to judge is not', () => {
  const s = JSON.parse(JSON.stringify(base)); delete s.constants.watchdog.since;
  const stagingWorker = s.tasks.staging.worker.trigger;
  const sched = schedulerView([page([stagingWorker, '2026-10-20T03:00:00Z'])], { record: 'staging', spec: s });
  let v = watch({ runs: [] }, { now: '2026-10-20T03:30:00Z', record: 'staging', spec: s, scheduler: sched });
  assert.deepEqual(v.missing.filter(m => m.pipeline === 'worker').map(m => [m.slot, m.kind]), [['2026-10-20T03:00:00Z', 'refused-at-start']]);
  v = watch({ runs: [] }, { now: '2026-10-20T03:03:00Z', record: 'staging', spec: s, scheduler: sched });
  assert.equal(v.missing.some(m => m.pipeline === 'worker'), false, 'under 5 minutes: the run may still be starting');
});

test('the watch step names both kinds in the push; health/current keeps the scheduler read and rebuilds the same', () => {
  const now = '2026-10-20T10:40:00Z';
  const db = { runs: [run('watchdog-a', 'watchdog', '2026-10-20T08:55:00Z')], jobs: [], jobresults: [], state: [] };
  const ctx = { now, record: 'live', release: 'v4.0.0', source: 'watchdog test', scheduler: schedulerView([page([T('morning'), '2026-10-20T09:25:28Z'])], { record: 'live', spec }) };
  const r = CODE_STEPS.watch(db, ctx, spec);
  assert.match(r.push, /^Watchdog: morning fired but left no run \(04:25\)/);
  const h = CODE_STEPS.health(db, ctx, spec).writes[0].data;
  assert.equal(h.missing.find(m => m.pipeline === 'morning').kind, 'refused-at-start');
  assert.equal(h.scheduler.length, 1);
  assert.equal(loadValidator()('health', h, { id: 'current' }).ok, true);
  assert.ok(['same', 'inexact-same'].includes(rebuildOne({ ...db, health: [{ id: 'current', ...h }] }, spec, 'health', { id: 'current', ...h }).status));
});

test('the scheduler read is a printed list_triggers call, and an unsaved read leaves the kinds at no-run', () => {
  const ctx = { dir: '/tmp/ev-b61-test-' + process.pid, record: 'live' };
  const m = AGENT_MATERIAL['scheduler-brief']({}, ctx, spec);
  assert.deepEqual(m.groups[0].calls, [{ tool: 'mcp__claude-code-remote__list_triggers', args: { limit: 100, enabled: true } }]);
  const f = AGENT_FOLDS['scheduler-result']({ saved: false, refused: 'tool not available' }, {}, ctx, spec);
  assert.equal(ctx.scheduler, null); assert.match(f.say[0], /no-run/);
  fs.mkdirSync(path.join(ctx.dir, 'scheduler'), { recursive: true });
  fs.writeFileSync(path.join(ctx.dir, 'scheduler', 'triggers-1.json'), JSON.stringify(page([T('morning'), '2026-10-20T09:25:28Z'])));
  AGENT_FOLDS['scheduler-result']({ saved: true }, {}, ctx, spec);
  assert.equal(ctx.scheduler[0].task, 'morning');
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
