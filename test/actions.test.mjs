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
import { hisFields } from '../core/his.mjs';
import { validateAgainst, checkSchema } from '../core/validate.mjs';
import EVCore from '../core/evcore.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
const A = makeActions(validateAgainst, EVCore);
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
  schemas: { jobresults: 2, talk: 4, system: 2 },
  yourturn: { commit: 'abc1234', groups: [] },
};

test('B-186: spec.actions has its _rules and the v4.4 rows, each a valid row with an args schema', () => {
  assert.ok(Array.isArray(spec.actions._rules) && spec.actions._rules.length >= 3);
  assert.deepEqual(rows.map(([k]) => k).sort(), [
    'build-ask',
    'chat-close',
    'design-ask',
    'job-fired',
    'plan-ask',
    'reply',
    'ship-it',
    'ship-live',
    'trace',
    'weakspot-accept',
    'weakspot-decline',
    'weakspot-join',
    'weakspot-log',
    'weakspot-propose',
    'weakspot-snooze',
    'weakspot-solid',
  ]);
  for (const [name, row] of rows) {
    assert.equal(rowProblem(name, row), null, name);
    assert.doesNotThrow(() => checkSchema(row.args), `${name}: args is a schema the validator reads`);
    assert.ok(row.callers.every(c => CALLERS.includes(c)) && COSTS.includes(row.cost), name);
  }
  // The tap rows are the page's; the trace and the live deploy are the builder's; the row is the OK for ship-it.
  for (const n of ['build-ask', 'reply', 'design-ask', 'plan-ask', 'ship-it', 'job-fired', 'chat-close'])
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

test('B-405 (D-327): chat-close marks a pop-up chat closed on its day, makes the day when missing, and nothing else', async () => {
  const { loadValidator } = await import('../core/schemas.mjs');
  const v = loadValidator();
  const th = 'th-20261021-233000123';
  const u = tap('chat-close', { thread: th, date: '2026-10-21', at: NOW, exists: true });
  assert.equal(u.ok, true, u.refused);
  assert.deepEqual(u.writes, [{ op: 'update', collection: 'talk', id: '2026-10-21', data: { closed: { [th]: NOW } } }]);
  assert.deepEqual(u.effects, []);
  const s = tap('chat-close', { thread: th, date: '2026-10-21', at: NOW, exists: false });
  assert.equal(s.ok, true, s.refused);
  assert.deepEqual(
    s.writes.map(w => [w.op, w.collection, w.id, w.data.messages, w.data.closed]),
    [['set', 'talk', '2026-10-21', {}, { [th]: NOW }]]
  );
  const r = v('talk', s.writes[0].data, { id: '2026-10-21' });
  assert.ok(r.ok, JSON.stringify(r.errors));
  // only his tap closes a chat; a bad thread or day does not fit
  assert.match(tool('chat-close', { thread: th, date: '2026-10-21', at: NOW, exists: true }).refused, /may not call/);
  assert.match(tap('chat-close', { thread: 'x', date: '2026-10-21', at: NOW, exists: true }).refused, /do not fit/);
  assert.match(tap('chat-close', { thread: th, date: 'memory', at: NOW, exists: true }).refused, /do not fit/);
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
// Whether a / here starts a regex literal: after nothing, an operator or opening punctuation, or a keyword that
// takes an expression; after a name, a number or a closing bracket it is division.
function regexAt(out) {
  const t = out.replace(/\s+$/, '');
  if (!t) return true;
  const last = t[t.length - 1];
  if ('(,=:[!&|?{};+-*%<>~^'.includes(last)) return true;
  return /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(t);
}
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
    // a regex literal (a / where an expression starts): its body is blanked, so a quote inside a character class
    // (/[^"]/) never opens a string that would hide the rest of the file
    if (c === '/' && regexAt(out)) {
      ((out += c), i++);
      let cls = false;
      while (i < n && src[i] !== '\n' && (cls || src[i] !== '/')) {
        if (src[i] === '\\') ((out += '  '), (i += 2));
        else {
          if (src[i] === '[') cls = true;
          else if (src[i] === ']') cls = false;
          ((out += blank(src[i])), i++);
        }
      }
      if (src[i] === '/') ((out += '/'), i++);
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
  assert.match(core, /window\.EVActions = makeActions\(window\.EVValidate\.validateAgainst, window\.EVCore\);/);
  assert.ok(
    Buffer.byteLength(JSON.stringify(JSON.parse(pages.live['spec.json']).actions)) < 12000,
    'actions under 12 KB (B-233: the seven weak-spot rows)'
  );
  const g = {};
  new Function('window', core.slice(core.indexOf('// ---- core/validate.mjs')))(g);
  const pageSpec = JSON.parse(pages.staging['spec.json']);
  const pageTap = g.EVActions.actor(pageSpec, 'tap');
  assert.equal(pageTap('build-ask', { brief: 'idea: a planted ask' }, { now: NOW }).ok, true);
  assert.match(pageTap('trace', traceArgs, { caller: 'builder', now: NOW }).refused, /a tap may not call it/);
});

test('B-229 (D-233) lint: his words are his: no row with a tool, worker or builder caller writes a field spec marks as his', () => {
  const his = hisFields(spec);
  // every marked field, listed: his journal text, the dates he adds, his ideas' text, his plan ticks, his notes (B-401)
  assert.deepEqual(his, {
    dateedits: ['title'],
    ideas: ['text'],
    journal: ['text'],
    notes: ['title', 'label', 'blocks'],
    planedits: ['ticks'],
    settings: ['instructions'], // B-449: his study plan instructions
  });
  for (const [c, fields] of Object.entries(his))
    for (const f of fields) {
      const schema = fs.readFileSync(path.join(ROOT, 'spec', 'schemas', `${c}.schema.json`), 'utf8');
      assert.ok(schema.includes(`"${f}"`), `${c}.${f} is in its schema`);
    }
  // the real table passes
  for (const [name, row] of rows) assert.equal(rowProblem(name, row, his), null, name);
  // a planted row whose worker caller writes journal text fails the lint, and act() refuses it
  const planted = {
    ...spec,
    actions: {
      ...spec.actions,
      'planted-journal': {
        does: 'a worker writes a journal entry',
        args: { type: 'object' },
        writes: [{ collection: 'journal', key: '^.+$', ops: ['set'], fields: ['text'] }],
        effects: [],
        callers: ['worker'],
        cost: 'nothing',
      },
    },
  };
  assert.match(rowProblem('planted-journal', planted.actions['planted-journal'], his), /journal\.text is his to write/);
  // and the build refuses to build with it (tools/build.mjs runs the same check over spec.actions)
  const build = fs.readFileSync(path.join(ROOT, 'tools', 'build.mjs'), 'utf8');
  assert.match(build, /rowProblem\(k, row, his\)/);
  // the same row as his own tap is fine
  const tapRow = { ...planted.actions['planted-journal'], callers: ['tap'] };
  assert.equal(rowProblem('planted-journal', tapRow, his), null);
});

// ------------------------------------------------------------------------------------ B-233: the weak-spot rows
const worker = A.actor(spec, 'worker');
const INITIAL = { streak: 0, nextDue: '2026-10-21', recurrence: 1, misses: 0 };
const spotArgs = { id: 'ws-2026-10-21-E9-2-pump-rates', topic: 'pump rates', objective: 'E9-2', initial: INITIAL };
const HIS = 'm-20261021-232900000-m',
  HERS = 'm-20261021-232930000-e';
const talk = {
  [HIS]: { role: 'matt', text: 'log pump rates as a weak spot' },
  [HERS]: { role: 'ev', text: 'Pump rates?' },
};
const line = id => talk[id] || null;
const KEY = 'page-20261021-233000000';
// a is a survivor with a link of another kind; b is joined to a; c is joined to b (a chain lint fails, planted);
// d's duplicate-of dangles; e stands alone
const SEEN = { to: 'sets/s1', type: 'seen-in' };
const spots = [
  { id: 'ws-a', links: [SEEN] },
  { id: 'ws-b', links: [{ to: 'weakspots/ws-a', type: 'duplicate-of' }] },
  { id: 'ws-c', links: [{ to: 'weakspots/ws-b', type: 'duplicate-of' }] },
  { id: 'ws-d', links: [{ to: 'weakspots/ws-gone', type: 'duplicate-of' }] },
  { id: 'ws-e', links: [] },
];
const W = { now: NOW, weakspots: spots };
const TRIAGE = ['weakspot-accept', 'weakspot-join', 'weakspot-snooze', 'weakspot-decline'];
const triageArgs = {
  'weakspot-accept': { items: [{ id: 'ws-a', objective: 'E9-2' }] },
  'weakspot-join': { id: 'ws-e', to: 'ws-a' },
  'weakspot-snooze': { items: [{ id: 'ws-a' }], until: '2026-10-23' },
  'weakspot-decline': { items: [{ id: 'ws-a' }], note: 'not mine' },
};
const v2 = async () => (await import('../core/schemas.mjs')).loadValidator();
const BASE = {
  schema: 2,
  writer: 'page',
  at: NOW,
  source: 'x',
  topic: 't',
  objective: 'E9-2',
  kind: 'concept',
  initial: {},
};

test('B-233 (D-235, D-242): the weak-spot rows are as section 6 gives them, and only his tap triages', () => {
  const R = n => spec.actions[n];
  assert.deepEqual(R('weakspot-log').callers, ['tap', 'tool']);
  assert.equal(R('weakspot-log').fromHis, true);
  assert.deepEqual(R('weakspot-propose').callers, ['tap', 'worker']);
  for (const n of [...TRIAGE, 'weakspot-solid']) assert.deepEqual(R(n).callers, ['tap'], n);
  for (const n of Object.keys(spec.actions).filter(n => n.startsWith('weakspot-'))) {
    assert.equal(R(n).cost, 'nothing', n);
    assert.ok(
      R(n).writes.every(w => w.collection === 'weakspots'),
      n
    );
  }
  assert.ok(!R('weakspot-log').writes[0].fields.includes('proposed'));
  assert.ok(R('weakspot-propose').writes[0].fields.includes('proposed'));
  assert.ok(
    !('links' in R('weakspot-join').args.properties),
    'join builds links from the spot as read, never from args'
  );
  for (const n of TRIAGE)
    for (const who of ['tool', 'worker', 'builder']) {
      const r = A.actor(spec, who)(n, triageArgs[n], W);
      assert.equal(r.ok, false, `${n} from ${who}`);
      assert.match(r.refused, new RegExp(`a ${who} may not call it \\(callers: tap\\)`));
      assert.deepEqual(r.writes, []);
    }
  for (const n of TRIAGE) assert.equal(tap(n, triageArgs[n], W).ok, true, n);
  // without E.V. core injected, the weak-spot rows refuse rather than guess
  const bare = makeActions(validateAgainst).actor(spec, 'tap');
  assert.match(bare('weakspot-join', triageArgs['weakspot-join'], W).refused, /E\.V\. core .* was not given/);
});

test('B-233: weakspot-log and weakspot-propose write a schema-2 spot that fits; only hers is proposed', async () => {
  const v = await v2();
  const mine = tap('weakspot-log', spotArgs, W);
  assert.equal(mine.ok, true, mine.refused);
  const [w] = mine.writes;
  assert.deepEqual([w.op, w.collection, w.id], ['set', 'weakspots', spotArgs.id]);
  assert.deepEqual(
    [w.data.schema, w.data.writer, w.data.exam, w.data.kind, w.data.proposed, w.data.events],
    [2, 'page', 'E9', 'concept', undefined, {}]
  );
  assert.ok(v('weakspots', w.data, { id: w.id }).ok, JSON.stringify(v('weakspots', w.data, { id: w.id }).errors));
  const hers = worker(
    'weakspot-propose',
    { ...spotArgs, words: 'Which rate for 1 L over 8 h?', origin: { set: 's1', item: 'q3', at: NOW } },
    W
  );
  assert.equal(hers.ok, true, hers.refused);
  assert.deepEqual([hers.writes[0].data.proposed, hers.writes[0].data.writer], [true, 'worker']);
  assert.ok(v('weakspots', hers.writes[0].data, { id: spotArgs.id }).ok);
  assert.equal(tap('weakspot-propose', spotArgs, W).writes[0].data.writer, 'page');
  assert.match(tool('weakspot-propose', spotArgs, W).refused, /a tool may not call it/);
  const planted = A.act(
    spec,
    'weakspot-log',
    spotArgs,
    { caller: 'tap', now: NOW },
    {
      'weakspot-log': () => ({
        writes: [{ op: 'set', collection: 'weakspots', id: spotArgs.id, data: { topic: 'x', proposed: true } }],
      }),
    }
  );
  assert.match(planted.refused, /sets proposed, outside the row's fields/);
  assert.match(tap('weakspot-log', { ...spotArgs, id: 'jobs-x' }, W).refused, /do not fit/);
  assert.match(tap('weakspot-log', { ...spotArgs, proposed: true }, W).refused, /do not fit/);
});

test('B-233: a new spot is never set over an id already in the record (its events would be erased)', () => {
  for (const n of ['weakspot-log', 'weakspot-propose']) {
    const r = tap(n, { ...spotArgs, id: 'ws-a' }, W);
    assert.equal(r.ok, false, n);
    assert.match(r.refused, /weakspots\/ws-a already exists: a set would erase its events/);
    assert.deepEqual(r.writes, []);
    assert.match(tap(n, spotArgs, { now: NOW }).refused, /no weak spots read to check the id against/);
  }
  assert.match(tool('weakspot-log', { ...spotArgs, id: 'ws-a', from: HIS }, { ...W, line }).refused, /already exists/);
});

test("B-233 (D-235): weakspot-log's tool call is checked against his talk line; her line or none is refused", () => {
  const ok = tool('weakspot-log', { ...spotArgs, from: HIS }, { ...W, line });
  assert.equal(ok.ok, true, ok.refused);
  assert.equal(ok.writes[0].data.proposed, undefined);
  const hers = tool('weakspot-log', { ...spotArgs, from: HERS }, { ...W, line });
  assert.equal(hers.ok, false);
  assert.match(
    hers.refused,
    /weakspot-log: a tool may call it only from his own line: m-20261021-232930000-e is not his/
  );
  assert.deepEqual(hers.writes, []);
  assert.match(tool('weakspot-log', spotArgs, { ...W, line }).refused, /only from his own line: no from/);
  assert.match(
    tool('weakspot-log', { ...spotArgs, from: 'm-20261021-000000000-m' }, { ...W, line }).refused,
    /is not his/
  );
  assert.match(tool('weakspot-log', { ...spotArgs, from: HIS }, W).refused, /is not his/, 'no line lookup');
  assert.match(tool('weakspot-log', { ...spotArgs, from: HERS }, { ...W, line, caller: 'tap' }).refused, /not his/);
  assert.equal(tap('weakspot-log', spotArgs, W).ok, true, 'his tap needs no line');
});

test('B-233 (D-235): the page path: her add_weakspot tool always goes through the tool actor, so a turn with no line of his is refused', async () => {
  const forms = fs.readFileSync(path.join(ROOT, 'page', 'app', '91-forms.js'), 'utf8');
  const body = forms.slice(forms.indexOf('async function toolLogWeakspot'), forms.indexOf('async function weakAct'));
  assert.match(body, /ACT\.tool\('weakspot-log'/);
  assert.doesNotMatch(body, /ACT\.tap\(/, 'no tap fallback on the tool path');
  assert.doesNotMatch(forms, /ACT\.tap\('weakspot-log'/);
  const chat = fs.readFileSync(path.join(ROOT, 'page', 'app', '72-ev-talking-with-claude.js'), 'utf8');
  assert.match(chat, /toolLogWeakspot\(\{ topic, objective, from: pend\.replyTo \}\)/);
  // the page's own tool actor, as built into core.js over E.V. core, refuses the args that path makes with no from
  const { buildPages, loadSchemas } = await import('../tools/build.mjs');
  const pages = buildPages({ root: ROOT, spec, schemas: loadSchemas(ROOT), release: 'v' + spec.specVersion });
  const g = {};
  new Function('window', pages.staging['core.js'])(g);
  assert.equal(typeof g.EVCore.survivors, 'function');
  const pageTool = g.EVActions.actor(JSON.parse(pages.staging['spec.json']), 'tool');
  const args = { ...spotArgs, course: 'NUR 112', source: 'Told E.V.' };
  const none = pageTool('weakspot-log', args, { ...W, line });
  assert.equal(none.ok, false);
  assert.match(none.refused, /only from his own line: no from/);
  assert.equal(pageTool('weakspot-log', { ...args, from: HIS }, { ...W, line }).ok, true);
});

test('B-233 (D-242): accept, snooze, decline and solid are events on each spot named; a duplicate is refused', async () => {
  const v = await v2();
  const a = tap(
    'weakspot-accept',
    {
      items: [
        { id: 'ws-e', objective: 'E9-2' },
        { id: 'ws-a', objective: 'E9-1' },
        { id: 'ws-e', objective: 'E9-3' },
      ],
    },
    W
  );
  assert.equal(a.ok, true, a.refused);
  assert.deepEqual(a.writes, [
    {
      op: 'update',
      collection: 'weakspots',
      id: 'ws-e',
      data: { events: { [KEY]: { type: 'accept', by: 'owner', at: NOW, objective: 'E9-2' } } },
    },
    {
      op: 'update',
      collection: 'weakspots',
      id: 'ws-a',
      data: { events: { [KEY]: { type: 'accept', by: 'owner', at: NOW, objective: 'E9-1' } } },
    },
  ]);
  // a spot joined to another is refused, whichever tap; nothing is written for the rest of the call
  for (const [n, args] of [
    [
      'weakspot-accept',
      {
        items: [
          { id: 'ws-e', objective: 'E9-2' },
          { id: 'ws-b', objective: 'E9-1' },
        ],
      },
    ],
    ['weakspot-snooze', { items: [{ id: 'ws-c' }], until: '2026-10-23' }],
    ['weakspot-decline', { items: [{ id: 'ws-b' }] }],
    ['weakspot-solid', { id: 'ws-b' }],
  ]) {
    const r = tap(n, args, W);
    assert.equal(r.ok, false, n);
    assert.match(r.refused, /weakspots\/ws-[bc] is already joined to ws-a/);
    assert.deepEqual(r.writes, []);
  }
  assert.match(
    tap('weakspot-decline', { items: [{ id: 'ws-zz' }] }, W).refused,
    /weakspots\/ws-zz is not in the record/
  );
  assert.equal(tap('weakspot-accept', { items: [{ id: 'ws-a' }] }, W).ok, true, 'accept without an objective (B-499)');
  assert.match(tap('weakspot-accept', { items: [] }, W).refused, /do not fit/);
  const s = tap(
    'weakspot-snooze',
    { items: [{ id: 'ws-d' }], until: '2026-10-23' },
    { ...W, key: () => 'page-20261021-233000123' }
  );
  assert.equal(s.ok, true, s.refused);
  assert.equal(s.writes[0].id, 'ws-d', 'a dangling duplicate-of is no duplicate: the spot stands');
  assert.deepEqual(s.writes[0].data.events, {
    'page-20261021-233000123': { type: 'snooze', by: 'owner', at: NOW, until: '2026-10-23' },
  });
  assert.match(tap('weakspot-snooze', { items: [{ id: 'ws-a' }] }, W).refused, /do not fit/, 'a snooze needs until');
  const d = tap('weakspot-decline', { items: [{ id: 'ws-a' }] }, W);
  assert.deepEqual(d.writes[0].data.events[KEY], { type: 'decline', by: 'owner', at: NOW });
  assert.equal(
    tap('weakspot-decline', { items: [{ id: 'ws-a' }], note: 'not mine' }, W).writes[0].data.events[KEY].note,
    'not mine'
  );
  const solid = tap('weakspot-solid', { id: 'ws-a' }, W);
  assert.deepEqual([solid.writes[0].id, solid.writes[0].data.events[KEY].type], ['ws-a', 'solid']);
  for (const r of [a, s, d, solid])
    for (const w of r.writes) assert.ok(v('weakspots', { ...BASE, ...w.data }, { id: w.id }).ok, JSON.stringify(w));
});

test('B-233 (D-240, D-284): his Join links the spot to the survivor of what it repeats, from the spot as read, keeping its other links', async () => {
  const v = await v2();
  const dup = to => ({ to: 'weakspots/' + to, type: 'duplicate-of', createdAt: NOW, createdBy: 'owner' });
  // e joins b, whose survivor is a: e links to a
  const j = tap('weakspot-join', { id: 'ws-e', to: 'ws-b' }, W);
  assert.equal(j.ok, true, j.refused);
  assert.deepEqual(j.writes, [{ op: 'update', collection: 'weakspots', id: 'ws-e', data: { links: [dup('ws-a')] } }]);
  // a's other links are kept though no links come in the args (an update replaces the whole array)
  const ka = tap('weakspot-join', { id: 'ws-a', to: 'ws-e' }, W);
  assert.equal(ka.ok, true, ka.refused);
  assert.deepEqual(ka.writes[0], {
    op: 'update',
    collection: 'weakspots',
    id: 'ws-a',
    data: { links: [SEEN, dup('ws-e')] },
  });
  for (const w of ka.writes) assert.ok(v('weakspots', { ...BASE, events: {}, ...w.data }, { id: w.id }).ok);
  // re-pointed: an old duplicate-of is replaced, not doubled
  const re = tap('weakspot-join', { id: 'ws-d', to: 'ws-e' }, W);
  assert.deepEqual(re.writes[0].data.links, [dup('ws-e')]);
  // itself, a spot joined to it, one already joined there, or a spot not in the record: refused
  assert.match(tap('weakspot-join', { id: 'ws-a', to: 'ws-a' }, W).refused, /cannot join itself/);
  assert.match(
    tap('weakspot-join', { id: 'ws-a', to: 'ws-c' }, W).refused,
    /cannot join itself or a spot joined to it/
  );
  assert.match(
    tap('weakspot-join', { id: 'ws-b', to: 'ws-a' }, W).refused,
    /weakspots\/ws-b is already joined to ws-a/
  );
  assert.match(tap('weakspot-join', { id: 'ws-zz', to: 'ws-a' }, W).refused, /weakspots\/ws-zz is not in the record/);
  assert.match(tap('weakspot-join', { id: 'ws-e', to: 'ws-zz' }, W).refused, /weakspots\/ws-zz is not in the record/);
  assert.match(tap('weakspot-join', { id: 'ws-e', to: 'ws-a', links: [] }, W).refused, /do not fit/);
});

test('B-233 (D-240): a Join makes no chain: the spots joined to the one he joins are re-pointed to its new survivor', () => {
  // y is a duplicate of x; he joins x to z: x and y both name z, and the chain lint finds nothing
  const xyz = [
    { id: 'ws-x', links: [{ to: 'notes/n1', type: 'related' }] },
    { id: 'ws-y', links: [SEEN, { to: 'weakspots/ws-x', type: 'duplicate-of', createdAt: NOW, createdBy: 'owner' }] },
    { id: 'ws-z', links: [] },
  ];
  const r = tap('weakspot-join', { id: 'ws-x', to: 'ws-z' }, { now: NOW, weakspots: xyz });
  assert.equal(r.ok, true, r.refused);
  const dupZ = { to: 'weakspots/ws-z', type: 'duplicate-of', createdAt: NOW, createdBy: 'owner' };
  assert.deepEqual(r.writes, [
    { op: 'update', collection: 'weakspots', id: 'ws-x', data: { links: [{ to: 'notes/n1', type: 'related' }, dupZ] } },
    { op: 'update', collection: 'weakspots', id: 'ws-y', data: { links: [SEEN, dupZ] } },
  ]);
  const after = xyz.map(w => ({ ...w, ...((r.writes.find(x => x.id === w.id) || {}).data || {}) }));
  const chains = after.filter(w => {
    const to = EVCore.duplicateOf(w);
    return to && EVCore.duplicateOf(after.find(x => x.id === to));
  });
  assert.deepEqual(chains, [], 'no duplicate-of reaches another duplicate');
  assert.deepEqual(
    after.map(w => EVCore.survivors(after)(w.id)),
    ['ws-z', 'ws-z', 'ws-z']
  );
});

test('B-233: the page writes weak spots only through act: no weak-spot write object is left in page/app', () => {
  const dir = path.join(ROOT, 'page', 'app');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /collection:\s*'weakspots'/, `${f} writes a weak spot outside act`);
  }
  // the page gives act() the spots as read, its own event keys and its talk lines
  assert.match(fs.readFileSync(path.join(dir, '91-forms.js'), 'utf8'), /weakspots: S\.weak, line: talkLine/);
});

test('B-409: a regex literal with a quote in it hides no write site from the D-200 lint', () => {
  const src = [
    "const ok = h => /^https?:\\/\\/[^\\s<>\"]+$/.test(h) && h.split('/').length / 2;",
    "const t = /'/; const u = x => x / 2 / 3;",
    "write({ op: 'set', collection: 'notes', id: 'n', data: {} });",
  ].join('\n');
  assert.equal(writeSites(src).length, 1, JSON.stringify(writeSites(src)));
  assert.match(codeOnly(src), /write\(\{ op: /, 'the code after the regex is still code');
});
