// spec/ev.spec.json structure (B-01): the collection map, tasks, environments, capacity, boundaries and working
// agreements, checked against the rules of the Data and Operational architecture tabs of E.V. Foundation v4.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORD_COLLECTIONS } from '../tools/personal-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8');
const spec = JSON.parse(RAW);

const CLASSES = ['Fact', 'Edit', 'Derived', 'Log', 'Config'];
const PIPELINES = [
  'morning',
  'evening-cloud',
  'evening-mac',
  'weekly',
  'worker',
  'watchdog',
  'restore-drill',
  'diagnostic',
];
const SURFACES = ['cloud-run', 'mac-run', 'browser-tab', 'page', 'build-chat'];
// Every collection in the Data architecture tab's collection map.
const COLLECTIONS = [
  'weakspots',
  'sets',
  'answers',
  'exams',
  'examedits',
  'predictions',
  'objectives',
  'plans',
  'planedits',
  'dates',
  'dateedits',
  'days',
  'dayedits',
  'weeks',
  'runs',
  'health',
  'state',
  'sessions',
  'ideas',
  'workouts',
  'journal',
  'talk',
  'jobs',
  'jobresults',
  'materials',
  'materialedits',
  'libindex',
  'announcements',
  'concepts',
  'system',
  'legacy',
  'debug',
];
const CRON = /^CRON_TZ=America\/Chicago (\S+ ){4}\S+$/;

test('the spec is JSON with indent 1 and no trailing newline', () => {
  assert.equal(RAW, JSON.stringify(spec, null, 1));
});

test('top-level sections and a v4 release string', () => {
  for (const k of [
    'specVersion',
    'roles',
    'pipelines',
    'classes',
    'registry',
    'collections',
    'tasks',
    'environments',
    'capacity',
    'boundaries',
    'workingAgreements',
  ])
    assert.ok(k in spec, `missing ${k}`);
  assert.match(spec.specVersion, /^4\.\d+$/);
  assert.deepEqual(Object.keys(spec.classes).sort(), CLASSES.slice().sort());
  assert.deepEqual(
    Object.keys(spec.pipelines)
      .filter(k => k !== '_rules')
      .sort(),
    PIPELINES.slice().sort()
  );
  for (const p of PIPELINES) assert.ok(spec.roles.includes(p), `pipeline ${p} is not a role`);
});

test('the collection map covers every collection of the design, and only those', () => {
  assert.deepEqual(Object.keys(spec.collections).sort(), COLLECTIONS.slice().sort());
});

test('every collection names its class, writers, key and schema file', () => {
  for (const [name, c] of Object.entries(spec.collections)) {
    assert.ok(CLASSES.includes(c.class), `${name}: class ${c.class}`);
    assert.ok(Array.isArray(c.writers), `${name}: writers`);
    for (const w of c.writers) assert.ok(spec.roles.includes(w), `${name}: writer ${w} is not a role`);
    assert.ok(
      typeof c.key === 'string'
        ? c.key.length
        : Array.isArray(c.key) && c.key.length && c.key.every(k => typeof k === 'string' && k),
      `${name}: key`
    );
    assert.equal(c.schema, `spec/schemas/${name}.schema.json`, `${name}: schema file`);
    assert.ok(c.holds && c.fromV3, `${name}: holds and fromV3`);
    if (name !== 'legacy') assert.ok(c.writers.length >= 1, `${name}: no writer`);
  }
});

test('class rules: Edits are the page only, Config is deploy only, Derived names a rebuild, legacy is frozen', () => {
  for (const [name, c] of Object.entries(spec.collections)) {
    if (c.class === 'Edit') assert.deepEqual(c.writers, ['page'], `${name}: an Edit is written by the page only`);
    if (c.class === 'Config') assert.deepEqual(c.writers, ['deploy'], `${name}: Config is written by deploy only`);
    if (c.class === 'Derived') assert.match(c.rebuild || '', /^rebuild /, `${name}: Derived needs its rebuild command`);
    for (const [doc, d] of Object.entries(c.documents || {})) {
      assert.ok(CLASSES.includes(d.class), `${name}/${doc}: class`);
      for (const w of d.writers) assert.ok(spec.roles.includes(w), `${name}/${doc}: writer ${w}`);
      if (d.class === 'Derived') assert.match(d.rebuild || '', /^rebuild /, `${name}/${doc}: rebuild`);
    }
  }
  assert.equal(spec.collections.legacy.frozen, true);
  assert.deepEqual(spec.collections.legacy.writers, []);
});

test('appended maps are appended only by roles, on Facts', () => {
  for (const [name, c] of Object.entries(spec.collections)) {
    for (const [field, by] of Object.entries(c.appends || {})) {
      assert.equal(c.class, 'Fact', `${name}.${field}: only Facts have append-only maps`);
      assert.ok(by.length && by.every(w => spec.roles.includes(w)), `${name}.${field}: appenders`);
    }
  }
});

test('the journal is private and in no read set', () => {
  assert.equal(spec.collections.journal.private, true);
  assert.deepEqual(spec.collections.journal.writers, ['page']);
});

test('the personal-data scan knows every collection', () => {
  for (const name of Object.keys(spec.collections))
    assert.ok(RECORD_COLLECTIONS.includes(name), `${name} missing from tools/personal-data.mjs`);
});

function checkTask(id, t, record) {
  assert.ok(PIPELINES.includes(t.pipeline), `${id}: pipeline ${t.pipeline}`);
  assert.equal(t.record, record, `${id}: record`);
  assert.ok(['cloud', 'mac'].includes(t.lane), `${id}: lane`);
  assert.equal(t.macBound, t.lane === 'mac', `${id}: macBound follows the lane`);
  assert.ok(t.schedule === null || CRON.test(t.schedule), `${id}: schedule ${t.schedule}`);
  assert.equal(typeof t.push, 'boolean', `${id}: push`);
  assert.ok(Array.isArray(t.folders), `${id}: folders`);
  if (t.lane === 'cloud') assert.deepEqual(t.folders, [], `${id}: the cloud never waits on the Mac (P6)`);
  if (t.lane === 'mac') assert.ok(t.folders.length >= 1, `${id}: a mac task names its folders`);
  assert.ok(t.trigger === null || /^trig_/.test(t.trigger), `${id}: trigger`);
}

test('tasks: every live pipeline has a task, every pipeline has a staging task, with the design schedules', () => {
  const { live, staging } = spec.tasks;
  assert.deepEqual(Object.keys(live).sort(), [
    'evening-cloud',
    'evening-mac',
    'morning',
    'watchdog',
    'weekly',
    'worker',
  ]);
  assert.deepEqual(Object.keys(staging).sort(), [
    'evening-cloud',
    'evening-mac',
    'morning',
    'restore-drill',
    'watchdog',
    'weekly',
    'worker',
  ]);
  for (const [id, t] of Object.entries(live)) checkTask(`live.${id}`, t, 'live');
  for (const [id, t] of Object.entries(staging)) checkTask(`staging.${id}`, t, 'staging');
  checkTask('diagnostic', spec.tasks.diagnostic, 'staging');
  const at = id => live[id].schedule;
  assert.equal(at('morning'), 'CRON_TZ=America/Chicago 25 4 * * *');
  assert.equal(at('evening-cloud'), 'CRON_TZ=America/Chicago 15 20 * * *');
  assert.equal(at('evening-mac'), 'CRON_TZ=America/Chicago 20 20 * * *');
  assert.equal(at('weekly'), 'CRON_TZ=America/Chicago 57 17 * * 0');
  assert.equal(
    at('watchdog'),
    'CRON_TZ=America/Chicago 55 1,4,7,10,13,16,19,22 * * *',
    'hours spelled out (D-084): an every-3-hours cron anchors to its creation minute'
  );
  assert.equal(at('worker'), null);
});

test('staging is not a second live: no pushes, Mac writes only under staging/ except the drill reading the backup', () => {
  for (const [id, t] of Object.entries(spec.tasks.staging)) {
    assert.equal(t.push, false, `staging.${id} pushes`);
    if (id !== 'restore-drill') assert.equal(t.schedule, null, `staging.${id} has a schedule`);
    if (t.lane === 'mac' && id !== 'restore-drill')
      for (const f of t.folders) assert.match(f, /\/staging$/, `staging.${id}: ${f}`);
  }
});

test('tasks: name templates carry the minor; retired is a list; the builder is registered', () => {
  // B-149 (D-173): task names carry the minor, renamed only at a minor.
  assert.match(spec.tasks.nameTemplate.live, /\(<minor>\)$/);
  assert.match(spec.tasks.nameTemplate.staging, /\(<minor>\)$/);
  assert.ok(Array.isArray(spec.tasks.retired));
  assert.match(spec.tasks.build['ev4-builder'].trigger, /^trig_/);
});

test('environments: the five surfaces, each capability with a proof', () => {
  const env = spec.environments;
  assert.deepEqual(
    Object.keys(env)
      .filter(k => !k.startsWith('_'))
      .sort(),
    SURFACES.slice().sort()
  );
  for (const s of SURFACES) {
    assert.ok(env[s].proven.length >= 1, `${s}: nothing proven`);
    assert.ok(Array.isArray(env[s].limits), `${s}: limits`);
    for (const p of env[s].proven) {
      assert.equal(p.proven, true, `${s}: ${p.capability}`);
      assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/, `${s}: ${p.capability} date`);
      assert.ok(p.run === null || /^cse_/.test(p.run), `${s}: ${p.capability} run`);
      assert.ok(p.evidence, `${s}: ${p.capability} evidence`);
      // D-179 (B-136): every proven row names the task its proof ran as (or the session kind), a live one by its key.
      assert.ok(typeof p.task === 'string' && p.task.length > 5, `${s}: ${p.capability} names its task`);
      const key = /^(live|staging)\.([\w-]+) \((trig_\w+), created /.exec(p.task);
      if (!/^(v3 |no task: )/.test(p.task)) {
        assert.ok(key, `${s}: ${p.capability}: ${p.task}`);
        const task = spec.tasks[key[1]][key[2]] || (key[2] === 'diagnostic' && spec.tasks.diagnostic);
        assert.ok(task, `${s}: ${key[1]}.${key[2]} is a task`);
        assert.equal(task.trigger, key[3], `${s}: ${key[1]}.${key[2]}'s trigger`);
      }
    }
    for (const p of env[s].unproven || []) assert.equal(p.proven, false);
  }
  assert.deepEqual(env['browser-tab'].numbers, { callSeconds: 45, resultBytes: 250000 });
});

test('capacity: the design constants, a budget row per collection, nothing guessed before measurement', () => {
  const cap = spec.capacity;
  assert.equal(cap.materialTextChars, 200000);
  // B-14: the document and batch limits rest on the measured cloud-run rows, not on guesses.
  const measured = spec.environments['cloud-run'].numbers;
  assert.equal(cap.measured, true);
  assert.equal(cap.documentBytes, measured.documentBytes);
  assert.equal(cap.batch.maxWrites, measured.batchWrites);
  assert.equal(cap.batch.ceilingBytes, measured.batchRequestBytes);
  assert.ok(cap.batch.maxBytes < measured.batchRequestBytes, "room for the call's own fields");
  for (const n of ['documentBytes', 'batchWrites', 'batchRequestBytes']) {
    assert.ok(
      spec.environments['cloud-run'].proven.some(
        p => /^cse_/.test(p.run || '') && p.date && p.evidence.includes('runs/diagnostic-')
      ),
      'a diagnostic row proves ' + n
    );
  }
  assert.deepEqual(cap.readWindowDays, { talk: 7, days: 14, dayedits: 14, jobs: 30, runs: 7 });
  assert.deepEqual(Object.keys(cap.collections).sort(), COLLECTIONS.slice().sort());
  if (!cap.measured)
    for (const [k, b] of Object.entries(cap.collections)) {
      for (const f of ['warnDocs', 'failDocs', 'warnBytes', 'failBytes'])
        assert.equal(b[f], null, `capacity.${k}.${f} set before the platform was measured`);
    }
});

test('boundaries B-01 to B-14 ported (B-15 to B-18 added with D-175), the explicit-OK list and the working agreements', () => {
  assert.deepEqual(
    spec.boundaries.rules.map(b => b.id),
    Array.from({ length: 18 }, (_, i) => `B-${String(i + 1).padStart(2, '0')}`)
  );
  for (const b of spec.boundaries.rules) assert.ok(b.rule.length > 10, b.id);
  for (const ok of ['publishing the live page', 'creating or changing a Mac-bound task', 'touching the live record'])
    assert.ok(spec.boundaries.mattOkRequired.includes(ok), ok);
  assert.ok(
    !spec.boundaries.mattOkRequired.includes('reading the journal'),
    'D-106, D-113: a build session may read the journal'
  );
  assert.ok(spec.workingAgreements.some(w => /No time-gating/.test(w)));
  assert.ok(spec.workingAgreements.some(w => /Nothing is deleted/.test(w)));
});

test('no delete op anywhere in the spec (P10)', () => {
  assert.doesNotMatch(RAW, /"op":\s*"delete"/);
});

test("B-26 (D-084): the watchdog's slots land inside every scheduled cloud pipeline's re-fire window", async () => {
  const { uncoveredSlots } = await import('../core/watch.mjs');
  assert.deepEqual(uncoveredSlots(spec), [], 'every missed slot over two weeks is seen in time');
  const old = uncoveredSlots(spec, { watchdog: 'CRON_TZ=America/Chicago 4 */3 * * *' });
  assert.ok(
    old.some(u => u.task === 'morning'),
    'the Oct 18 schedule sees a missed morning only after 6:00am'
  );
  assert.ok(
    old.some(u => u.task === 'weekly'),
    'and the weekly too late'
  );
  assert.equal(
    spec.tasks.staging.morning.watchSchedule,
    spec.tasks.live.morning.schedule,
    'staging watches its morning on the live slot'
  );
});

test('B-28: spec.tasks.retired keeps every old task with its reason, never a task still in use', () => {
  const inUse = new Set();
  for (const g of ['live', 'staging'])
    for (const t of Object.values(spec.tasks[g])) if (t.trigger) inUse.add(t.trigger);
  for (const t of Object.values(spec.tasks.build)) if (t.trigger) inUse.add(t.trigger);
  if (spec.tasks.diagnostic && spec.tasks.diagnostic.trigger) inUse.add(spec.tasks.diagnostic.trigger);
  const seen = new Set();
  for (const r of spec.tasks.retired) {
    for (const k of ['trigger', 'was', 'name', 'reason'])
      assert.ok(typeof r[k] === 'string' && r[k].length, `${r.trigger}: ${k}`);
    assert.match(r.trigger, /^trig_[A-Za-z0-9]+$/);
    assert.ok(!seen.has(r.trigger), `${r.trigger} listed twice`);
    seen.add(r.trigger);
    assert.ok(!inUse.has(r.trigger), `${r.trigger} is retired and in use`);
  }
  // The four v3 live tasks the rollback procedure names, and the two v3 staging tasks left enabled at the cutover.
  for (const id of [
    'trig_01R7242YzwUXFyNVcmqT8vob',
    'trig_0148JgXzDzGX1zghMymdvMmL',
    'trig_01GHogoFx9Ns7uE1uUmi2i2G',
    'trig_01PxKp1tsgddna4Kt1FzpNhv',
    'trig_01VK4WrkLh2361Bc7MgvcDUY',
    'trig_01VTGsL3VVYKwboByCz8RqZ3',
  ])
    assert.ok(seen.has(id), id);
});

test('B-32 (D-089): x-ev.marks in the five schemas match the spec, and the registry check catches a difference', async () => {
  const { registryProblems, loadSchemas } = await import('../tools/build.mjs');
  const schemas = loadSchemas(ROOT);
  const want = {
    jobs: ['fired'],
    sessions: ['status', 'pending', 'endedAt', 'comments'], // comments: D-130, B-74
    ideas: ['status', 'kind'],
    dates: ['date', 'dueAt', 'syncedAt'],
    materials: ['text', 'fileUpdatedAt', 'fetchedAt', 'needsOcr', 'pages', 'chars', 'ocr'],
  }; // pages, chars, ocr: Matt, Oct 18 (B-32 follow-up)
  for (const [c, fields] of Object.entries(want)) assert.deepEqual(Object.keys(schemas[c]['x-ev'].marks), fields, c);
  assert.deepEqual(registryProblems(spec, schemas), []);
  const s2 = JSON.parse(JSON.stringify(spec));
  s2.collections.dates.marks.title = ['page'];
  assert.ok(registryProblems(s2, schemas).some(p => /dates: marks differ/.test(p)));
});

test('B-37 (D-093): the budgets rest on read cost and the measured ceiling, each with its relief; no 25,000 cap', () => {
  const c = spec.capacity.collections;
  assert.deepEqual([c.state.warnBytes, c.state.failBytes], [192 * 1024, 240 * 1024]);
  assert.ok(c.state.failBytes < spec.capacity.documentBytes, 'state/current fails before the platform refuses it');
  assert.deepEqual(
    [c.sets.warnDocs, c.answers.warnDocs, c.runs.warnDocs, c.materials.warnBytes],
    [400, 400, 1500, 4 * 1024 * 1024]
  );
  for (const k of ['state', 'sets', 'answers', 'runs', 'materials']) assert.ok(c[k].relief, `${k} names its relief`);
  assert.ok(
    !/25,?000/.test(JSON.stringify(spec.constants)) &&
      !/cap: 25000/.test(fs.readFileSync(path.join(ROOT, 'core/evcore.mjs'), 'utf8')),
    'the 25,000 cap is gone'
  );
});

test('lint, D-175 (B-134): CLAUDE.md names every boundary id, and every prompt phrasing names known lanes', () => {
  const md = fs.readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');
  for (const b of spec.boundaries.rules) assert.match(md, new RegExp(`\\b${b.id}\\b`), `CLAUDE.md names ${b.id}`);
  const lanes = ['cloud', 'mac', 'canvas', 'mac-writes', 'mac-reads'];
  for (const b of spec.boundaries.rules.filter(r => r.prompt)) {
    assert.ok(b.prompt.lanes.length && b.prompt.lanes.every(l => lanes.includes(l)), b.id);
    if (typeof b.prompt.text !== 'string') for (const l of b.prompt.lanes) assert.ok(b.prompt.text[l], `${b.id} ${l}`);
  }
});

test('B-140: the collection map tells the truth: health is written only by the watchdog (and restored by the drill); concepts is marked unpopulated', () => {
  const steps = fs.readFileSync(new URL('../core/steps.mjs', import.meta.url), 'utf8');
  assert.equal((steps.match(/collection: 'health'/g) || []).length, 1, 'one producer of health/current');
  assert.deepEqual(spec.collections.health.writers, ['watchdog', 'restore-drill']);
  assert.ok(!spec.pipelines['evening-cloud'].steps.some(s => /health/.test(s.id)), 'evening-cloud has no health step');
  assert.match(spec.collections.concepts.unpopulated, /^D-096/);
  const schema = JSON.parse(fs.readFileSync(new URL('../spec/schemas/concepts.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema['x-ev'].unpopulated, true);
});
