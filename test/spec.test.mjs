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
const PIPELINES = ['morning', 'evening-cloud', 'evening-mac', 'weekly', 'worker', 'watchdog', 'restore-drill', 'diagnostic'];
const SURFACES = ['cloud-run', 'mac-run', 'browser-tab', 'page', 'build-chat'];
// Every collection in the Data architecture tab's collection map.
const COLLECTIONS = ['weakspots', 'sets', 'answers', 'exams', 'objectives', 'plans', 'planedits', 'dates', 'dateedits', 'days',
  'dayedits', 'weeks', 'runs', 'health', 'state', 'sessions', 'ideas', 'journal', 'talk', 'jobs', 'jobresults', 'materials',
  'materialedits', 'libindex', 'announcements', 'concepts', 'system', 'legacy', 'debug'];
const CRON = /^CRON_TZ=America\/Chicago (\S+ ){4}\S+$/;

test('the spec is JSON with indent 1 and no trailing newline', () => {
  assert.equal(RAW, JSON.stringify(spec, null, 1));
});

test('top-level sections and a v4 release string', () => {
  for (const k of ['specVersion', 'roles', 'pipelines', 'classes', 'registry', 'collections', 'tasks', 'environments', 'capacity', 'boundaries', 'workingAgreements']) assert.ok(k in spec, `missing ${k}`);
  assert.match(spec.specVersion, /^4\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(spec.classes).sort(), CLASSES.slice().sort());
  assert.deepEqual(Object.keys(spec.pipelines).filter(k => k !== '_rules').sort(), PIPELINES.slice().sort());
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
    assert.ok(typeof c.key === 'string' ? c.key.length : Array.isArray(c.key) && c.key.length && c.key.every(k => typeof k === 'string' && k), `${name}: key`);
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
  for (const name of Object.keys(spec.collections)) assert.ok(RECORD_COLLECTIONS.includes(name), `${name} missing from tools/personal-data.mjs`);
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
  assert.deepEqual(Object.keys(live).sort(), ['evening-cloud', 'evening-mac', 'morning', 'watchdog', 'weekly', 'worker']);
  assert.deepEqual(Object.keys(staging).sort(), ['evening-cloud', 'evening-mac', 'morning', 'restore-drill', 'watchdog', 'weekly', 'worker']);
  for (const [id, t] of Object.entries(live)) checkTask(`live.${id}`, t, 'live');
  for (const [id, t] of Object.entries(staging)) checkTask(`staging.${id}`, t, 'staging');
  checkTask('diagnostic', spec.tasks.diagnostic, 'staging');
  const at = id => live[id].schedule;
  assert.equal(at('morning'), 'CRON_TZ=America/Chicago 25 4 * * *');
  assert.equal(at('evening-cloud'), 'CRON_TZ=America/Chicago 15 20 * * *');
  assert.equal(at('evening-mac'), 'CRON_TZ=America/Chicago 20 20 * * *');
  assert.equal(at('weekly'), 'CRON_TZ=America/Chicago 57 17 * * 0');
  assert.equal(at('watchdog'), 'CRON_TZ=America/Chicago 0 */3 * * *');
  assert.equal(at('worker'), null);
});

test('staging is not a second live: no pushes, Mac writes only under staging/ except the drill reading the backup', () => {
  for (const [id, t] of Object.entries(spec.tasks.staging)) {
    assert.equal(t.push, false, `staging.${id} pushes`);
    if (id !== 'restore-drill') assert.equal(t.schedule, null, `staging.${id} has a schedule`);
    if (t.lane === 'mac' && id !== 'restore-drill') for (const f of t.folders) assert.match(f, /\/staging$/, `staging.${id}: ${f}`);
  }
});

test('tasks: name templates carry the release; retired is a list; the builder is registered', () => {
  assert.match(spec.tasks.nameTemplate.live, /<release>/);
  assert.match(spec.tasks.nameTemplate.staging, /<release>/);
  assert.ok(Array.isArray(spec.tasks.retired));
  assert.match(spec.tasks.build['ev4-builder'].trigger, /^trig_/);
});

test('environments: the five surfaces, each capability with a proof', () => {
  const env = spec.environments;
  assert.deepEqual(Object.keys(env).filter(k => !k.startsWith('_')).sort(), SURFACES.slice().sort());
  for (const s of SURFACES) {
    assert.ok(env[s].proven.length >= 1, `${s}: nothing proven`);
    assert.ok(Array.isArray(env[s].limits), `${s}: limits`);
    for (const p of env[s].proven) {
      assert.equal(p.proven, true, `${s}: ${p.capability}`);
      assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/, `${s}: ${p.capability} date`);
      assert.ok(p.run === null || /^cse_/.test(p.run), `${s}: ${p.capability} run`);
      assert.ok(p.evidence, `${s}: ${p.capability} evidence`);
    }
    for (const p of env[s].unproven || []) assert.equal(p.proven, false);
  }
  assert.deepEqual(env['browser-tab'].numbers, { callSeconds: 45, resultBytes: 250000 });
});

test('capacity: the design constants, a budget row per collection, nothing guessed before measurement', () => {
  const cap = spec.capacity;
  assert.equal(cap.documentBytes, 256 * 1024);
  assert.equal(cap.materialTextChars, 200000);
  assert.deepEqual(cap.batch, { maxWrites: 50, maxBytes: 1024 * 1024 });
  assert.deepEqual(cap.readWindowDays, { talk: 7, days: 14, dayedits: 14, jobs: 30, runs: 7 });
  assert.deepEqual(Object.keys(cap.collections).sort(), COLLECTIONS.slice().sort());
  if (!cap.measured) for (const [k, b] of Object.entries(cap.collections)) {
    for (const f of ['warnDocs', 'failDocs', 'warnBytes', 'failBytes']) assert.equal(b[f], null, `capacity.${k}.${f} set before the platform was measured`);
  }
});

test('boundaries B-01 to B-14 ported, the explicit-OK list and the working agreements', () => {
  assert.deepEqual(spec.boundaries.rules.map(b => b.id), Array.from({ length: 14 }, (_, i) => `B-${String(i + 1).padStart(2, '0')}`));
  for (const b of spec.boundaries.rules) assert.ok(b.rule.length > 10, b.id);
  for (const ok of ['publishing the live page', 'creating or changing a Mac-bound task', 'reading the journal', 'touching the live record']) assert.ok(spec.boundaries.mattOkRequired.includes(ok), ok);
  assert.ok(spec.workingAgreements.some(w => /No time-gating/.test(w)));
  assert.ok(spec.workingAgreements.some(w => /Nothing is deleted/.test(w)));
});

test('no delete op anywhere in the spec (P10)', () => {
  assert.doesNotMatch(RAW, /"op":\s*"delete"/);
});
