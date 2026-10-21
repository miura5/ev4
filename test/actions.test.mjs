// B-186 (D-203): actions as data. spec.actions holds one row per thing E.V. does from the page or a builder session;
// core/actions.mjs act composes and checks every call. This file is also D-200's lint: no row writes the actions table
// (system/spec) or changes a scheduled task, and every page write site and every record write a tools command prints
// comes from act or a core composer, except today's legacy sites (test/data/actions-legacy.json), which only shrink.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { makeActions, rowProblem, CALLERS, COSTS } from '../core/actions.mjs';
import { validateAgainst, checkSchema } from '../core/validate.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
const A = makeActions(validateAgainst);
const rows = Object.entries(spec.actions).filter(([k]) => !k.startsWith('_'));
const NOW = '2026-10-21T23:30:00.000Z';
const tap = A.actor(spec, 'tap'),
  builder = A.actor(spec, 'builder'),
  tool = A.actor(spec, 'tool');
const traceArgs = {
  job: 'job-20261021-233000-the-timer',
  status: 'done',
  text: 'B-190 (your "the timer sat at 0:00") is built and green on staging at abc1234; say ship it when you want it live.',
  date: '2026-10-21',
  talkExists: true,
  release: 'v4.4.0+1',
  task: 'B-190',
  commit: 'abc1234',
  schemas: { jobresults: 2, talk: 3, system: 2 },
  yourturn: { commit: 'abc1234', groups: [] },
};

test('B-186: spec.actions has its _rules and the v4.4 rows, each a valid row with an args schema', () => {
  assert.ok(Array.isArray(spec.actions._rules) && spec.actions._rules.length >= 3);
  assert.deepEqual(rows.map(([k]) => k).sort(), [
    'build-ask',
    'design-ask',
    'plan-ask',
    'reply',
    'ship-it',
    'ship-live',
    'trace',
  ]);
  for (const [name, row] of rows) {
    assert.equal(rowProblem(name, row), null, name);
    assert.doesNotThrow(() => checkSchema(row.args), `${name}: args is a schema the validator reads`);
    assert.ok(row.callers.every(c => CALLERS.includes(c)) && COSTS.includes(row.cost), name);
  }
  // The tap rows are the page's; the trace and the live deploy are the builder's; the row is the OK for ship-it.
  for (const n of ['build-ask', 'reply', 'design-ask', 'plan-ask', 'ship-it'])
    assert.deepEqual(spec.actions[n].callers, ['tap']);
  assert.deepEqual([spec.actions.trace.callers, spec.actions['ship-live'].callers], [['builder'], ['builder']]);
  assert.deepEqual(
    [spec.actions['ship-it'].cost, spec.actions['ship-live'].cost, spec.actions.trace.cost],
    ['ok', 'ok', 'nothing']
  );
});

test('D-200 lint: no row writes system/spec or the table, and no effect creates, changes or deletes a scheduled task', () => {
  for (const [name, row] of rows) {
    for (const w of row.writes || []) {
      assert.ok(!(w.collection === 'system' && new RegExp(w.key).test('spec')), `${name} writes system/spec`);
      assert.ok(!w.fields.includes('actions'), `${name} writes the actions table`);
    }
    assert.ok(!/(create|update|delete)_trigger/.test(JSON.stringify(row.effects || [])), `${name} changes a task`);
  }
  // The planted rows: the lint's check refuses them, and so does act() at run time.
  const planted = {
    ...spec,
    actions: {
      ...spec.actions,
      'planted-spec': {
        ...spec.actions['build-ask'],
        writes: [{ collection: 'system', key: '^spec$', fields: ['actions'] }],
      },
      'planted-task': { ...spec.actions['build-ask'], effects: [{ kind: 'fire_trigger', task: 'update_trigger' }] },
    },
  };
  assert.match(rowProblem('planted-spec', planted.actions['planted-spec']), /no row may write system\/spec/);
  assert.match(rowProblem('planted-task', planted.actions['planted-task']), /no row creates, changes or deletes/);
  const run = A.actor(planted, 'tap');
  const r = run('planted-spec', { brief: 'x' }, { now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.refused, /planted-spec: no row may write system\/spec, where the actions table lives/);
  assert.deepEqual(r.writes, []);
  assert.match(run('planted-task', { brief: 'x' }, { now: NOW }).refused, /no row creates, changes or deletes/);
});

test('B-186: a valid call returns only the row writes and effects', () => {
  const r = tap(
    'build-ask',
    { brief: 'build: the timer sat at 0:00', text: 'build: the timer sat at 0:00' },
    { now: NOW }
  );
  assert.equal(r.ok, true, r.refused);
  assert.deepEqual(r.writes, [
    {
      op: 'set',
      collection: 'jobs',
      id: 'job-20261021-233000-build-the-timer-sat-at-0',
      data: {
        schema: 2,
        writer: 'page',
        at: NOW,
        source: 'E.V. Home',
        kind: 'build',
        title: 'build: the timer sat at 0:00',
        brief: 'build: the timer sat at 0:00',
      },
    },
  ]);
  assert.deepEqual(r.effects, [
    {
      kind: 'fire_trigger',
      task: 'build.ev4-builder',
      text: 'Job job-20261021-233000-build-the-timer-sat-at-0\nbuild: the timer sat at 0:00',
    },
  ]);
  const t = builder('trace', traceArgs, { now: NOW });
  assert.equal(t.ok, true, t.refused);
  assert.deepEqual(
    t.writes.map(w => `${w.op} ${w.collection}/${w.id}`),
    ['set jobresults/job-20261021-233000-the-timer', 'update talk/2026-10-21', 'set system/yourturn']
  );
  assert.equal(builder('ship-live', { job: 'job-x', commit: 'abc1234' }, { ok: { mattOk: true } }).ok, true);
});

test('B-186: a wrong caller, a bad shape, a write outside the row and an unmet cost are each refused with the reason', () => {
  assert.match(
    tool('ship-it', { brief: 'ship it', commit: 'abc1234', tasks: ['B-1'] }, {}).refused,
    /a tool may not call it/
  );
  assert.match(tap('build-ask', { brief: '' }, { now: NOW }).refused, /its arguments do not fit/);
  assert.match(tap('build-ask', { brief: 'x', caller: 'builder' }, { now: NOW }).refused, /its arguments do not fit/);
  const outside = A.act(
    spec,
    'build-ask',
    { brief: 'x' },
    { caller: 'tap', now: NOW },
    {
      'build-ask': () => ({ writes: [{ op: 'set', collection: 'weakspots', id: 'w1', data: {} }], effects: [] }),
    }
  );
  assert.match(outside.refused, /set weakspots\/w1 is outside the row/);
  const field = A.act(
    spec,
    'build-ask',
    { brief: 'x' },
    { caller: 'tap', now: NOW },
    {
      'build-ask': () => ({
        writes: [
          { op: 'set', collection: 'jobs', id: 'job-20261021-233000-x', data: { kind: 'build', status: 'done' } },
        ],
        effects: [],
      }),
    }
  );
  assert.match(field.refused, /sets status, outside the row's fields/);
  const fire = A.act(
    spec,
    'build-ask',
    { brief: 'x' },
    { caller: 'tap', now: NOW },
    { 'build-ask': () => ({ writes: [], effects: [{ kind: 'fire_trigger', task: 'live.worker' }] }) }
  );
  assert.match(fire.refused, /effect .* is outside the row/);
  // The cost: the live deploy needs his OK in either form, bound to the commit.
  assert.match(builder('ship-live', { job: 'job-x', commit: 'abc1234' }, {}).refused, /it needs Matt's OK \(R-04\)/);
  const job = { kind: 'ship', writer: 'page', commit: 'abc1234' };
  assert.equal(builder('ship-live', { job: 'job-x', commit: 'abc1234' }, { ok: { job } }).ok, true);
  assert.match(builder('ship-live', { job: 'job-x', commit: 'def5678' }, { ok: { job } }).refused, /R-04/);
  assert.match(A.act(spec, 'no-such', {}, { caller: 'tap' }).refused, /no such action/);
  assert.match(A.act(spec, 'build-ask', { brief: 'x' }, {}).refused, /no caller set by code/);
});

test('D-203: ctx.caller is set by code; a planted tap call claiming to be a builder is refused', () => {
  // The page's tap path calls the trace with a context that claims the builder: the actor's own caller wins.
  const claim = tap('trace', traceArgs, { caller: 'builder', now: NOW });
  assert.equal(claim.ok, false);
  assert.match(claim.refused, /trace: a tap may not call it \(callers: builder\)/);
  assert.throws(() => A.actor(spec, 'matt'), /no such caller/);
});

// ------------------------------------------------------------------------------------------------ the write-site lint
const LEGACY = path.join(ROOT, 'test', 'data', 'actions-legacy.json');
const COMPOSED = /^(E\.|act\(|ACT\.|EVActions\.)/;
/** Each write or run call in a page file whose writes do not come from act or a core composer (E.<name>). */
export function writeSites(text) {
  const out = [];
  for (const m of String(text).matchAll(/(?<![\w.$])(write|run)\(\s*/g)) {
    const before = text.slice(Math.max(0, m.index - 16), m.index);
    if (/function\s+$/.test(before)) continue; // the definitions themselves
    const arg = text.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (!COMPOSED.test(arg)) out.push(arg.split('\n')[0]);
  }
  return out;
}
function todaysSites() {
  const dir = path.join(ROOT, 'page', 'app');
  const out = {};
  for (const f of fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .sort()) {
    const n = writeSites(fs.readFileSync(path.join(dir, f), 'utf8')).length;
    if (n) out[`page/app/${f}`] = n;
  }
  return out;
}

test('D-200 lint: every page write site is act, a core composer, or on the legacy list, which only shrinks', () => {
  const legacy = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
  const now = todaysSites();
  for (const [f, n] of Object.entries(now))
    assert.ok(
      n <= (legacy.sites[f] || 0),
      `${f}: ${n} write sites outside act, ${legacy.sites[f] || 0} on the legacy list: a new write goes through act (D-203)`
    );
  // The list equals today's sites: when one moves to act, the list shrinks with it.
  assert.deepEqual(now, legacy.sites, 'test/data/actions-legacy.json is today’s sites; shrink it as sites move to act');
  // Planted: a new write site outside the table is caught.
  assert.equal(writeSites("await write({ op: 'set', collection: 'jobs', id, data });").length, 1);
  assert.equal(writeSites('await run(E.skillStep(s));').length, 0);
  assert.equal(writeSites("await run(act('build-ask', a).writes);").length, 0);
  assert.equal(writeSites('async function write(w) {').length, 0);
});

test('D-200 lint: no tools command prints a record write of its own; they come from core (deploy, run, act)', () => {
  const dir = path.join(ROOT, 'tools');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.mjs'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.deepEqual(
      [...text.matchAll(/action: '(set|update|batch|str_replace|delete)'/g)].map(m => m[0]),
      [],
      `tools/${f} composes a record write itself`
    );
  }
});

test("B-186: the page's spec.json carries actions, and spec.actions is a guarded spec key", async () => {
  const { pageSpecFor } = await import('../tools/build.mjs');
  const p = pageSpecFor(spec, {}, { target: 'staging', release: 'v4.4.0' });
  // Each row as it stands, without its does line (the node side's description); _rules stay in the spec.
  const bare = row => Object.fromEntries(Object.entries(row).filter(([f]) => f !== 'does'));
  assert.deepEqual(p.actions, Object.fromEntries(rows.map(([k, row]) => [k, bare(row)])));
  assert.ok(spec.boundaries.guarded.spec.includes('actions'));
});

test('B-186: the page gets EVActions in core.js, over the validator, and its tap actor refuses a builder row', async () => {
  const { buildPages, loadSchemas } = await import('../tools/build.mjs');
  const pages = buildPages({ root: ROOT, spec, schemas: loadSchemas(ROOT), release: 'v' + spec.specVersion });
  const core = pages.staging['core.js'];
  assert.match(core, /window\.EVActions = makeActions\(window\.EVValidate\.validateAgainst\);/);
  assert.ok(
    Buffer.byteLength(JSON.stringify(JSON.parse(pages.live['spec.json']).actions)) < 6000,
    'actions under 6 KB'
  );
  const g = {};
  new Function('window', core.slice(core.indexOf('// ---- core/validate.mjs')))(g);
  const pageSpec = JSON.parse(pages.staging['spec.json']);
  const pageTap = g.EVActions.actor(pageSpec, 'tap');
  assert.equal(pageTap('build-ask', { brief: 'idea: a planted ask' }, { now: NOW }).ok, true);
  assert.match(pageTap('trace', traceArgs, { caller: 'builder', now: NOW }).refused, /a tap may not call it/);
});
