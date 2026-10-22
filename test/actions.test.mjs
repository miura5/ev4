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
    'job-fired',
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
  for (const n of ['build-ask', 'reply', 'design-ask', 'plan-ask', 'ship-it', 'job-fired'])
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
  // B-180: the fire's answer lands on the job it fired, and only there; a model tool may not mark one.
  const job = 'job-20261021-233000-build-the-timer-sat-at-0';
  const f = tap('job-fired', { job, fired: { at: NOW, ok: false, error: 'mcp_unavailable' } });
  assert.equal(f.ok, true, f.refused);
  assert.deepEqual(f.writes, [
    { op: 'update', collection: 'jobs', id: job, data: { fired: { at: NOW, ok: false, error: 'mcp_unavailable' } } },
  ]);
  assert.deepEqual(f.effects, []);
  assert.match(tap('job-fired', { job: 'talk', fired: { at: NOW, ok: true } }).refused, /do not fit/);
  assert.match(tap('job-fired', { job, fired: { at: NOW, ok: true, status: 'done' } }).refused, /do not fit/);
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

test('B-186: the costs: his tap on ship-it is the OK, bound to its commit; staging needs a green verify at the commit', () => {
  const r = tap('ship-it', { brief: 'ship it', commit: 'abc1234', tasks: ['B-190'] }, { now: NOW });
  assert.equal(r.ok, true, r.refused);
  assert.deepEqual(
    [r.writes[0].data.kind, r.writes[0].data.commit, r.writes[0].data.tasks, r.effects[0].task],
    ['ship', 'abc1234', ['B-190'], 'build.ev4-builder']
  );
  assert.match(tap('ship-it', { brief: 'ship it', tasks: ['B-190'] }, { now: NOW }).refused, /do not fit/, 'no commit');
  // A planted row whose cost is a staging proof (no v4.4 row has one yet).
  const planted = {
    ...spec,
    actions: { ...spec.actions, 'planted-staging': { ...spec.actions['build-ask'], cost: 'staging' } },
  };
  const go = (ctx, args = { brief: 'x', title: 'x' }) =>
    A.act(planted, 'planted-staging', args, { caller: 'tap', now: NOW, ...ctx }, { 'planted-staging': () => ({}) });
  assert.match(go({}).refused, /it needs staging green at the commit \(R-02\)/);
  assert.match(go({ staging: { green: false, commit: 'abc1234' } }).refused, /R-02/);
  assert.equal(go({ staging: { green: true, commit: 'abc1234def' } }).ok, true);
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
/** The code of a source with its comments and string and template text blanked (a template's ${...} code is kept). */
export function codeOnly(src) {
  let out = '',
    i = 0;
  const stack = [];
  const n = src.length;
  const blank = ch => (ch === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = src[i],
      d = src[i + 1];
    if (stack.at(-1) === '`') {
      if (c === '\\') ((out += '  '), (i += 2));
      else if (c === '`') (stack.pop(), (out += c), i++);
      else if (c === '$' && d === '{') (stack.push('}'), (out += '${'), (i += 2));
      else ((out += blank(c)), i++);
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') ((out += ' '), i++);
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) ((out += blank(src[i])), i++);
      ((out += '  '), (i += 2));
      continue;
    }
    if (c === "'" || c === '"') {
      ((out += c), i++);
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') ((out += ' '), i++);
        ((out += blank(src[i])), i++);
      }
      ((out += c), i++);
      continue;
    }
    if (c === '`') stack.push('`');
    else if (c === '{' && stack.length) stack.push('{');
    else if (c === '}' && stack.length) stack.pop();
    ((out += c), i++);
  }
  return out;
}
/** The text of a call's arguments, from the index just after its "(" to the matching ")". */
const argsOf = (code, k) => {
  let depth = 1,
    i = k;
  for (; i < code.length && depth; i++) depth += code[i] === '(' ? 1 : code[i] === ')' ? -1 : 0;
  return code.slice(k, i - 1);
};
// Writes from act or a core composer: the page's actors (ACT.tap, ACT.tool) or E.<composer>(...), never a write
// object written in place.
const COMPOSED = /^\s*(E\.\w+|ACT\.(tap|tool))\(/;
/**
 * Each record write site in a page file whose writes do not come from act or a core composer: a write or run call
 * with any other argument, any other reference to write or run (an alias, .then(write), write.call), and a direct
 * db.collection(...) set, update, add or delete. src is the file's text; funnel marks 04-model.js, where write and
 * run are defined and the one db write lives.
 */
export function writeSites(src, { funnel = false } = {}) {
  const code = codeOnly(String(src));
  const out = [];
  for (const m of code.matchAll(/(?<![\w.$])(write|run)\b/g)) {
    const before = code.slice(Math.max(0, m.index - 16), m.index),
      rest = code.slice(m.index + m[0].length);
    if (/function\s+$/.test(before) || /^\s*\|/.test(rest) || /\|\s*$/.test(before)) continue; // a definition; a regex alternation
    if (/^\s*:/.test(rest)) continue; // an object key named write or run
    const call = /^\s*\(/.exec(rest);
    if (!call) {
      out.push(`${m[1]} by reference`);
      continue;
    }
    const args = argsOf(code, m.index + m[0].length + call[0].length);
    if (funnel && m[1] === 'write' && args.trim() === 'w') continue; // run's own loop over the writes it was given
    if (!COMPOSED.test(args) || /\bop\s*:/.test(args)) out.push(`${m[1]}(${args.trim().slice(0, 40)}`);
  }
  if (!funnel)
    for (const m of code.matchAll(/\bdb\s*\.\s*collection\s*\(/g)) {
      const stmt = code.slice(m.index, code.indexOf(';', m.index) + 1 || undefined);
      if (/\.\s*(set|update|add|delete)\s*\(/.test(stmt)) out.push('db.collection(...) write');
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
    const n = writeSites(fs.readFileSync(path.join(dir, f), 'utf8'), { funnel: f === '04-model.js' }).length;
    if (n) out[`page/app/${f}`] = n;
  }
  return out;
}
// A record write a tools command prints as a call (JSON, a JS object or prose), outside core's composers.
const PRINTED =
  /"action"\s*:\s*"(set|update|batch|delete|str_replace)"|action: '(set|update|batch|delete|str_replace)'|ArtifactData \\?"?(set|update|batch|delete|str_replace)\b/g;
function todaysToolSites() {
  const out = {};
  for (const f of fs
    .readdirSync(path.join(ROOT, 'tools'))
    .filter(f => f.endsWith('.mjs'))
    .sort()) {
    const n = [...fs.readFileSync(path.join(ROOT, 'tools', f), 'utf8').matchAll(PRINTED)].length;
    if (n) out[`tools/${f}`] = n;
  }
  return out;
}

// EV_SHRINK_LEGACY=1 node --test test/actions.test.mjs rewrites the list from today's sites, after a site moved to act;
// review the diff: the list only shrinks.
if (process.env.EV_SHRINK_LEGACY) {
  const old = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
  const sites = todaysSites(),
    tools = todaysToolSites();
  const total = Object.values(sites).reduce((a, b) => a + b, 0);
  fs.writeFileSync(LEGACY, JSON.stringify({ ...old, total, sites, tools }, null, 1) + '\n');
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
  // Planted: each form of a new write site is caught; act's actors and core composers are not.
  const caught = s => writeSites(s).length;
  assert.equal(caught("await write({ op: 'set', collection: 'jobs', id, data });"), 1);
  assert.equal(caught('p.then(write);'), 1, 'by reference');
  assert.equal(caught('const put = write; put(w);'), 1, 'an alias');
  assert.equal(caught('write.call(null, w);'), 1, 'write.call');
  assert.equal(caught("run(E.skillStep(s).concat([{ op: 'set', collection: 'x', id: 'y', data: {} }]));"), 1);
  assert.equal(caught("db.collection('journal').add(data);"), 1, 'a direct db write');
  assert.equal(caught("db.collection('jobs').doc(id).set(data);"), 1, 'a direct db write');
  assert.equal(caught("run(EVActions.act(EV_SPEC, 'ship-it', a, { caller: 'tap' }).writes);"), 1, 'raw act');
  assert.equal(caught("db.collection('talk').doc(d).get();"), 0, 'a read');
  assert.equal(caught('await run(E.skillStep(s));'), 0);
  assert.equal(caught("await run(ACT.tap('build-ask', a).writes);"), 0);
  assert.equal(caught("toast('Couldn’t write: ' + e); // run(it)"), 0, 'strings and comments');
  assert.equal(caught('async function write(w) {'), 0);
});

test("D-203: only the page's model file sees EVActions; it makes the two actors and removes the factory", () => {
  const dir = path.join(ROOT, 'page', 'app');
  const users = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.js') && /EVActions/.test(codeOnly(fs.readFileSync(path.join(dir, f), 'utf8'))));
  assert.deepEqual(users, ['04-model.js']);
  const model = codeOnly(fs.readFileSync(path.join(dir, '04-model.js'), 'utf8'));
  assert.match(model, /delete window\.EVActions/);
  assert.doesNotMatch(model, /\.act\s*\(/, 'never the raw act');
});

test('D-200 lint: no tools command prints a record write of its own beyond the legacy list; they come from core', () => {
  const legacy = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
  assert.deepEqual(todaysToolSites(), legacy.tools, 'tools sites equal the legacy list (only the gate-failure log)');
  const count = s => [...s.matchAll(PRINTED)].length;
  assert.equal(count('console.log(`ArtifactData {"action":"set","collection":"runs"}`)'), 1, 'printed JSON');
  assert.equal(count("calls.push({ tool: 'ArtifactData', args: { action: 'update' } })"), 1, 'a JS object');
  assert.equal(count('ArtifactData "batch" on the record'), 1, 'prose');
  assert.equal(count('ArtifactData {"action":"get","collection":"system"}'), 0, 'a read');
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
