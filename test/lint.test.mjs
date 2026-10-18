// lint and rebuild (B-07): rebuild reproduces every Derived fixture byte for byte; lint catches a planted wrong
// writer, a changed fact and an over-budget document, and a Derived document that drifted. The record is the
// synthetic one in test/data/record.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import EV from '../core/evcore.mjs';
import { readExport, loadValidator } from '../core/schemas.mjs';
import { lintRecord } from '../core/lint.mjs';
import { rebuild, rebuildOne, asOf, produce, factHash, PRODUCERS, NOT_REBUILDABLE } from '../core/derive.mjs';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator();
const RECORD = path.join(ROOT, 'test/data/record');
const load = () => { const db = {}; for (const { collection, id, doc } of readExport(RECORD)) (db[collection] = db[collection] || []).push({ ...doc, id }); return db; };
const lint = db => lintRecord(db, spec, validate, { date: '2026-10-17' });
const codes = (r, code) => r.issues.filter(i => i.code === code);
const doc = (db, col, id) => db[col].find(d => d.id === id);

test('rebuild reproduces every Derived fixture byte for byte, and names the ones without a producer', () => {
  const db = load();
  const results = rebuild(db, spec);
  const derived = Object.entries(db).flatMap(([c, ds]) => ds.filter(d => (spec.collections[c].documents && spec.collections[c].documents[d.id] ? spec.collections[c].documents[d.id].class : spec.collections[c].class) === 'Derived').map(d => `${c}/${d.id}`));
  assert.deepEqual(results.map(r => r.ref).sort(), derived.sort(), 'every stored Derived document is visited');
  for (const r of results.filter(r => r.status !== 'skipped')) {
    assert.equal(r.status, 'same', r.ref);
    const [col, ...rest] = r.ref.split('/');
    assert.equal(JSON.stringify(r.data, null, 1), fs.readFileSync(path.join(RECORD, col, rest.join('/') + '.json'), 'utf8'), `${r.ref} byte for byte`);
  }
  assert.deepEqual(results.filter(r => r.status !== 'skipped').map(r => r.ref.split('/')[0]).sort(), Object.keys(PRODUCERS).sort(), 'one fixture per producer');
  for (const r of results.filter(r => r.status === 'skipped')) assert.ok(NOT_REBUILDABLE[r.ref] || NOT_REBUILDABLE[r.ref.split('/')[0]], r.ref);
});

test('the fixture record lints green', () => {
  const r = lint(load());
  assert.deepEqual(r.issues.filter(i => i.severity !== 'info'), []);
});

test('lint catches a planted wrong writer, on a document and on an appended entry', () => {
  const db = load();
  const w = db.weakspots[0]; w.writer = 'weekly';
  w.events = { ...w.events, [EV.eventKey('morning', '2026-10-16T12:00:00Z')]: { type: 'seen', by: 'E.V.' } };
  const r = lint(db);
  const wrong = codes(r, 'wrong-writer').map(i => i.ref);
  assert.ok(wrong.includes(`weakspots/${w.id}`));
  assert.ok(wrong.some(ref => ref.startsWith(`weakspots/${w.id}#events.morning-`)));
  assert.ok(r.issues.every(i => i.severity !== 'error' || ['wrong-writer', 'invalid', 'fact-changed', 'derived-differs'].includes(i.code)), 'nothing unrelated is reported');
});

test('lint catches a planted changed fact, and not an appended event', () => {
  const db = load();
  const state = doc(db, 'state', 'current');
  const e = db.exams[0]; assert.ok(state.factHashes[`exams/${e.id}`], 'the fixture state hashed this exam');
  const answers = db.answers[0];
  const first = Object.keys(answers.answers)[0];
  answers.answers[first] = { ...answers.answers[first], [EV.eventKey('page', '2026-10-17T15:00:00Z')]: { chosen: [0], correct: true, score: 1, at: '2026-10-17T15:00:00Z' } };
  assert.equal(codes(lint(db), 'fact-changed').length, 0, 'an append is not a change');
  e.title = 'A different title';
  assert.deepEqual(codes(lint(db), 'fact-changed').map(i => i.ref), [`exams/${e.id}`]);
  assert.equal(factHash(spec, 'exams', { ...e, at: '2030-01-01T00:00:00Z' }), factHash(spec, 'exams', e), 'the envelope time is not a fact');
});

test('lint catches a planted over-budget document: bytes, and a material past the text cap', () => {
  const db = load();
  const m = db.materials[0]; m.text = 'Made-up course text. '.repeat(Math.ceil((spec.capacity.documentBytes + 10) / 21));
  const over = codes(lint(db), 'over-budget').map(i => i.ref + ' ' + i.msg);
  assert.ok(over.some(s => s.startsWith(`materials/${m.id} `) && /bytes; the budget is 262144/.test(s)));
  assert.ok(over.some(s => s.startsWith(`materials/${m.id} `) && /characters of text; the cap is 200000/.test(s)));
});

test('lint catches a Derived document that drifted from its rebuild', () => {
  const db = load();
  doc(db, 'days', '2026-10-16').push = 'Something no rebuild would say';
  const r = lint(db);
  assert.deepEqual(codes(r, 'derived-differs').map(i => i.ref), ['days/2026-10-16', 'state/current'], 'state/current reads the day, so it moves with it');
});

test('the record as of a time: later documents and entries are left out; an Edit changed since is named', () => {
  const db = load();
  const at = '2026-10-16T14:00:00Z';
  const late = EV.eventKey('page', '2026-10-16T20:00:00Z');
  const a = db.answers[0]; const item = Object.keys(a.answers)[0];
  a.answers[item] = { ...a.answers[item], [late]: { chosen: [0], correct: true, score: 1, at: '2026-10-16T20:00:00Z' } };
  db.exams.push({ id: 'E10', schema: 1, writer: 'canvas-sync', at: '2026-10-16T21:00:00Z', source: 'later', course: 'NUR 112', kind: 'unit', title: 'Later', status: 'upcoming' });
  const pe = db.planedits[0]; pe.updatedAt = '2026-10-16T22:00:00Z';
  const { db: then, inexact } = asOf(db, at, spec);
  assert.ok(!then.exams.some(e => e.id === 'E10'));
  assert.ok(!(late in then.answers[0].answers[item]));
  assert.deepEqual(inexact, [`planedits/${pe.id}`]);
  assert.ok(!('journal' in then), 'the journal is never read');
  assert.equal(rebuildOne(db, spec, 'state', doc(db, 'state', 'current')).status.startsWith('inexact-'), true);
});

test('a document migrated from v3 is not compared; it is rebuilt by its next run', () => {
  const db = load();
  db.days.push({ id: '2026-10-15', schema: 1, writer: 'morning', at: '2026-10-15T09:25:00Z', source: 'migrated from v3', date: '2026-10-15', list: { items: [] } });
  const r = rebuildOne(db, spec, 'days', doc(db, 'days', '2026-10-15'));
  assert.equal(r.status, 'skipped'); assert.match(r.reason, /migrated from v3/);
});

test('produce writes what its pipeline will: the producer\'s data under the run\'s envelope, valid for its schema', () => {
  const db = load();
  const day = produce(db, spec, 'days', { date: '2026-10-17', now: '2026-10-17T09:25:00Z' }, { source: 'morning run-x' });
  assert.deepEqual([day.writer, day.at, day.source], ['morning', '2026-10-17T09:25:00.000Z', 'morning run-x']);
  assert.ok(validate('days', day, { id: '2026-10-17' }).ok);
  const st = produce(db, spec, 'state', { date: '2026-10-17', now: '2026-10-17T01:15:00Z', specVersion: spec.specVersion });
  assert.equal(st.snapshot.specVersion, spec.specVersion);
  assert.equal(st.derivedHash, EV.derivedHash(EV.buildWeakspots({ weakspots: db.weakspots, sets: db.sets, answers: db.answers, exams: db.exams })));
  assert.ok(validate('state', st, { id: 'current' }).ok);
});

test('cli: lint exits 0 green and 1 red; rebuild --out writes the regenerated documents', () => {
  const run = (...a) => { try { return { code: 0, out: execFileSync('node', [path.join(ROOT, 'core/cli.mjs'), ...a], { encoding: 'utf8' }) }; } catch (e) { return { code: e.status, out: e.stdout }; } };
  let r = run('lint', '--from', RECORD, '--date', '2026-10-17');
  assert.equal(r.code, 0); assert.match(r.out, /^lint: GREEN/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-lint-'));
  fs.cpSync(RECORD, dir, { recursive: true });
  const f = path.join(dir, 'exams', fs.readdirSync(path.join(dir, 'exams'))[0]);
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), writer: 'weekly' }, null, 1));
  r = run('lint', '--from', dir, '--date', '2026-10-17');
  assert.equal(r.code, 1); assert.match(r.out, /NO  wrong-writer exams\//);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-rebuild-'));
  r = run('rebuild', 'days', 'state', '--from', RECORD, '--out', out);
  assert.equal(r.code, 0); assert.match(r.out, /rebuild: 2 reproduced, 0 differ/);
  assert.equal(fs.readFileSync(path.join(out, 'days', '2026-10-16.json'), 'utf8'), fs.readFileSync(path.join(RECORD, 'days', '2026-10-16.json'), 'utf8'));
});

test('a run ended after the as-of time reads as still running then', () => {
  const db = { runs: [{ id: 'evening-cloud-x', schema: 1, writer: 'evening-cloud', at: '2026-10-18T06:00:00Z', source: 's', release: 'v4.0.0', pipeline: 'evening-cloud', startedAt: '2026-10-18T06:00:00Z', endedAt: '2026-10-18T06:02:00Z', status: 'ok', steps: [{ id: 'a', status: 'ok' }], planHash: 'f'.repeat(64), push: 'x' }] };
  const mid = asOf(db, '2026-10-18T06:01:00Z', spec).db.runs[0];
  assert.deepEqual([mid.status, mid.endedAt, 'steps' in mid, 'push' in mid], ['running', null, false, false]);
  assert.equal(asOf(db, '2026-10-18T06:03:00Z', spec).db.runs[0].status, 'ok');
});

test('what changed while the producing run ran, or a Derived input rewritten since, makes a rebuild inexact', () => {
  const ledger = (id, startedAt, endedAt) => ({ id, schema: 1, writer: id.split('-20')[0], at: startedAt, source: 's', release: 'v4.0.0', pipeline: id.split('-20')[0], startedAt, endedAt, status: 'ok', steps: [] });
  const db = {
    runs: [ledger('watchdog-20261018-060000000', '2026-10-18T06:00:00Z', '2026-10-18T06:01:30Z'), ledger('weekly-20261018-055000000', '2026-10-18T05:50:00Z', '2026-10-18T05:52:00Z')],
    health: [{ id: 'current', schema: 1, writer: 'watchdog', at: '2026-10-18T06:05:00Z', source: 'watchdog x' }],
  };
  const during = asOf(db, '2026-10-18T06:02:00Z', spec, { since: '2026-10-18T06:01:00Z' }).inexact;
  assert.deepEqual(during, ['runs/watchdog-20261018-060000000', 'health/current'], 'ended mid-run; rewritten since');
  assert.deepEqual(asOf(db, '2026-10-18T06:02:00Z', spec).inexact, ['health/current'], 'with no run window, only the rewrite');
  assert.deepEqual(asOf(db, '2026-10-18T06:02:00Z', spec, { since: '2026-10-18T06:01:00Z', self: 'watchdog-20261018-060000000' }).inexact, ['health/current'], 'its own ledger entry never counts');
});

test('a Derived document built by an earlier build is stale, a warning; by this build, an error', () => {
  const db = load();
  const day = doc(db, 'days', '2026-10-16'); day.push = 'Something this build would not say';
  db.runs.push({ id: 'morning-x', schema: 1, writer: 'morning', at: day.at, source: 's', release: 'v4.0.0', pipeline: 'morning', startedAt: day.at, endedAt: day.at, status: 'ok', commit: 'a'.repeat(40) });
  day.source = 'morning morning-x';
  const stale = lintRecord(db, spec, validate, { date: '2026-10-17', commit: 'b'.repeat(40) });
  assert.ok(codes(stale, 'derived-stale').some(i => i.ref === 'days/2026-10-16' && /build aaaaaaaaaaaa/.test(i.msg)));
  assert.ok(!codes(stale, 'derived-differs').some(i => i.ref === 'days/2026-10-16'));
  const same = lintRecord(db, spec, validate, { date: '2026-10-17', commit: 'a'.repeat(40) });
  assert.ok(codes(same, 'derived-differs').some(i => i.ref === 'days/2026-10-16'));
});
