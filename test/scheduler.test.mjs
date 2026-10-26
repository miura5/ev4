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
import { CODE_STEPS } from '../core/steps.mjs';
import * as RUN from '../core/run.mjs';
import os from 'node:os';
import { rebuildOne } from '../core/derive.mjs';
import { loadValidator } from '../core/schemas.mjs';
import { ROOT, preCutoverSpec } from './helpers.mjs';

const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(base);
const spec = (() => {
  const s = JSON.parse(JSON.stringify(base));
  let n = 0;
  for (const t of Object.values(s.tasks.live)) t.trigger = 'trig_test' + ++n;
  delete s.constants.watchdog.since;
  return s;
})();
const T = name => spec.tasks.live[name].trigger;
const run = (id, pipeline, startedAt, extra = {}) => ({
  id,
  schema: 1,
  writer: pipeline,
  at: startedAt,
  source: 'test',
  release: 'v4.0.0',
  pipeline,
  startedAt,
  endedAt: startedAt,
  status: 'ok',
  ...extra,
});
const page = (...xs) => ({
  data: xs.map(([id, firedAt, status = 'ROUTINE_RUN_STATUS_SUCCEEDED']) => ({
    id,
    enabled: true,
    last_fired_at: firedAt,
    ...(firedAt ? { last_run: { status, fired_at: firedAt } } : {}),
  })),
  has_more: false,
});

test("schedulerView: each task of the record with its trigger's last firing; triggers the record does not name are left out", () => {
  const v = schedulerView(
    [
      page([T('morning'), '2026-10-20T09:25:28Z']),
      page([T('watchdog'), '2026-10-20T09:55:10Z'], ['trig_other', '2026-10-20T09:00:00Z']),
    ],
    { record: 'live', spec }
  );
  assert.deepEqual(
    v.map(x => [x.task, x.firedAt, x.status]),
    [
      ['morning', '2026-10-20T09:25:28Z', 'SUCCEEDED'],
      ['watchdog', '2026-10-20T09:55:10Z', 'SUCCEEDED'],
    ]
  );
});

test('a SUCCEEDED firing with no run document within 5 minutes is refused-at-start; a slot with no firing is not-fired', () => {
  const now = '2026-10-20T10:40:00Z'; // 5:40am CDT: the 4:25 morning slot is past its grace
  const db = { runs: [run('watchdog-a', 'watchdog', '2026-10-20T08:55:00Z')] };
  // Tonight's case: the scheduler fired the morning, the run refused at its start and left nothing.
  let v = watch(db, {
    now,
    record: 'live',
    spec,
    scheduler: schedulerView([page([T('morning'), '2026-10-20T09:25:28Z'])], { record: 'live', spec }),
  });
  assert.equal(v.missing.find(m => m.pipeline === 'morning').kind, 'refused-at-start');
  // No firing since the slot: not-fired.
  v = watch(db, {
    now,
    record: 'live',
    spec,
    scheduler: schedulerView([page([T('morning'), '2026-10-19T09:25:28Z'])], { record: 'live', spec }),
  });
  assert.equal(v.missing.find(m => m.pipeline === 'morning').kind, 'not-fired');
  // Without the scheduler's read the miss stays, with no kind it can tell.
  assert.equal(watch(db, { now, record: 'live', spec }).missing.find(m => m.pipeline === 'morning').kind, 'no-run');
  // A run document within 5 minutes of the firing: nothing missing.
  const ok = { runs: [...db.runs, run('morning-b', 'morning', '2026-10-20T09:26:10Z')] };
  assert.equal(
    watch(ok, {
      now,
      record: 'live',
      spec,
      scheduler: schedulerView([page([T('morning'), '2026-10-20T09:25:28Z'])], { record: 'live', spec }),
    }).missing.some(m => m.pipeline === 'morning'),
    false
  );
  // A failed gate leaves runs/<pipeline>-failed-*: that is a trace, not a refusal with nothing.
  const traced = {
    runs: [
      ...db.runs,
      {
        id: 'morning-failed-x',
        schema: 1,
        writer: 'morning',
        at: '2026-10-20T09:26:00Z',
        source: 'morning gate',
        pipeline: 'morning',
        startedAt: '2026-10-20T09:25:30Z',
        endedAt: '2026-10-20T09:26:00Z',
        status: 'failed',
      },
    ],
  };
  assert.equal(
    watch(traced, {
      now,
      record: 'live',
      spec,
      scheduler: schedulerView([page([T('morning'), '2026-10-20T09:25:28Z'])], { record: 'live', spec }),
    }).missing.some(m => m.pipeline === 'morning'),
    false
  );
});

test('a firing outside any slot (a fire-only staging task) that left no run is refused-at-start; one too fresh to judge is not', () => {
  const s = JSON.parse(JSON.stringify(base));
  delete s.constants.watchdog.since;
  const stagingWorker = s.tasks.staging.worker.trigger;
  const sched = schedulerView([page([stagingWorker, '2026-10-20T03:00:00Z'])], { record: 'staging', spec: s });
  let v = watch({ runs: [] }, { now: '2026-10-20T03:30:00Z', record: 'staging', spec: s, scheduler: sched });
  assert.deepEqual(
    v.missing.filter(m => m.pipeline === 'worker').map(m => [m.slot, m.kind]),
    [['2026-10-20T03:00:00Z', 'refused-at-start']]
  );
  v = watch({ runs: [] }, { now: '2026-10-20T03:03:00Z', record: 'staging', spec: s, scheduler: sched });
  assert.equal(
    v.missing.some(m => m.pipeline === 'worker'),
    false,
    'under 5 minutes: the run may still be starting'
  );
});

test('the watch step names both kinds in the push; health/current keeps the scheduler read and rebuilds the same', () => {
  const now = '2026-10-20T10:40:00Z';
  const db = { runs: [run('watchdog-a', 'watchdog', '2026-10-20T08:55:00Z')], jobs: [], jobresults: [], state: [] };
  const ctx = {
    now,
    record: 'live',
    release: 'v4.0.0',
    source: 'watchdog test',
    scheduler: schedulerView([page([T('morning'), '2026-10-20T09:25:28Z'])], { record: 'live', spec }),
  };
  const r = CODE_STEPS.watch(db, ctx, spec);
  assert.match(r.push, /^Watchdog: morning fired but left no run \(04:25\)/);
  const h = CODE_STEPS.health(db, ctx, spec).writes[0].data;
  assert.equal(h.missing.find(m => m.pipeline === 'morning').kind, 'refused-at-start');
  assert.equal(h.scheduler.length, 1);
  assert.equal(loadValidator()('health', h, { id: 'current' }).ok, true);
  assert.ok(
    ['same', 'inexact-same'].includes(
      rebuildOne({ ...db, health: [{ id: 'current', ...h }] }, spec, 'health', { id: 'current', ...h }).status
    )
  );
});

test('the pull prints the list_triggers read; pulled saves its pages and asks for the next one; no result leaves the kinds at no-run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-b61-'));
  // B-320: live's watchdog is on the ev-live Worker since the cutover; its pull still ends with the list_triggers read
  const wdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-b61w-'));
  const wfile = path.join(wdir, 'worker.json');
  fs.writeFileSync(
    wfile,
    JSON.stringify({ schema: 1, url: 'https://ev-live.x.workers.dev', token: 'planted-' + 'x7Q9'.repeat(8) })
  );
  fs.mkdirSync(path.join(wdir, 'run'));
  const at = '2026-10-20T10:40:00Z';
  RUN.start({
    spec,
    pipeline: 'watchdog',
    record: 'live',
    at,
    dir: path.join(wdir, 'run'),
    release: 'v4.0.0',
    worker: wfile,
  });
  const wcalls = RUN.pull({ spec, dir: path.join(wdir, 'run'), at });
  assert.match(wcalls[0].args.command, /^node core\/cli\.mjs api pull /);
  assert.deepEqual(wcalls.at(-1), {
    tool: 'mcp__claude-code-remote__list_triggers',
    args: { limit: 100, enabled: true },
  });
  fs.rmSync(wdir, { recursive: true, force: true });
  // the paging itself, on a record still on ArtifactData (live before the cutover)
  const pre = preCutoverSpec(spec);
  RUN.start({ spec: pre, pipeline: 'watchdog', record: 'live', at, dir, release: 'v4.0.0' });
  const calls = RUN.pull({ spec: pre, dir, at });
  assert.deepEqual(calls[calls.length - 1], {
    tool: 'mcp__claude-code-remote__list_triggers',
    args: { limit: 100, enabled: true },
  });
  const lines = [];
  let n = 0;
  const say = (name, input, text) => {
    n++;
    lines.push(JSON.stringify({ message: { content: [{ type: 'tool_use', id: 'u' + n, name, input }] } }));
    lines.push(
      JSON.stringify({
        message: { content: [{ type: 'tool_result', tool_use_id: 'u' + n, content: [{ type: 'text', text }] }] },
      })
    );
  };
  for (const c of calls.slice(0, -1))
    say('ArtifactData', c.args, `No documents matched in collection "${c.args.collection}".`);
  // Without the scheduler's result the run goes on, with no pages.
  assert.equal(RUN.pulled({ spec: pre, dir, transcript: lines.join('\n') }).done, true);
  assert.equal(fs.existsSync(path.join(dir, 'scheduler')), false);
  // With a first page that has more, pulled asks for the next page; with both, it is done and both are saved.
  say(
    'mcp__claude-code-remote__list_triggers',
    { limit: 100, enabled: true },
    JSON.stringify({ ...page([T('morning'), '2026-10-20T09:25:28Z']), has_more: true, next_cursor: 'c2' })
  );
  const more = RUN.pulled({ spec: pre, dir, transcript: lines.join('\n') });
  assert.deepEqual([more.done, more.calls[0].args], [false, { limit: 100, enabled: true, cursor: 'c2' }]);
  say(
    'mcp__claude-code-remote__list_triggers',
    { limit: 100, enabled: true, cursor: 'c2' },
    JSON.stringify(page([T('watchdog'), '2026-10-20T09:55:10Z']))
  );
  assert.equal(RUN.pulled({ spec: pre, dir, transcript: lines.join('\n') }).done, true);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'scheduler')).sort(), ['triggers-1.json', 'triggers-2.json']);
  const ctx = { dir, record: 'live', now: '2026-10-20T10:40:00Z', release: 'v4.0.0', source: 't' };
  const r = CODE_STEPS.watch({ runs: [] }, ctx, spec);
  assert.equal(r.say.length > 0, true);
  assert.deepEqual(
    ctx.scheduler.map(x => x.task),
    ['morning', 'watchdog']
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B-66: health/current marks the watchdog's own run as ended, not running", () => {
  const now = '2026-10-20T10:56:00Z';
  const h = healthBody(
    {
      runs: [run('watchdog-now', 'watchdog', '2026-10-20T10:55:10Z', { status: 'running', endedAt: null })],
      jobs: [],
      jobresults: [],
      state: [],
    },
    { now, record: 'live' },
    spec
  );
  assert.deepEqual(
    [h.pipelines.watchdog.status, h.pipelines.watchdog.endedAt, h.pipelines.watchdog.self],
    ['ok', now, true]
  );
  const stale = healthBody(
    {
      runs: [run('watchdog-old', 'watchdog', '2026-10-20T08:55:10Z', { status: 'running', endedAt: null })],
      jobs: [],
      jobresults: [],
      state: [],
    },
    { now, record: 'live' },
    spec
  );
  assert.equal(
    stale.pipelines.watchdog.status,
    'running',
    'an older watchdog left running is not this run: it stays as it is'
  );
});
