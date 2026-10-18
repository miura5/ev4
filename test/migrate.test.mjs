// The v3 -> v4 migration (B-06): every split document, envelopes and writers, legacy copies, zero mismatches,
// idempotence, and batch chunking. The v3 record below is made up; the real-export gate runs only where
// fixtures/v3-export exists (it is gitignored and never committed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';
import { currentVersion, migrateV3, verifyMigration, applyWrites } from '../core/migrate.mjs';
import { chunkWrites, writeBytes } from '../core/batches.mjs';
import { loadValidator, readExport } from '../core/schemas.mjs';
import { describeErrors } from '../core/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
EV.configure(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8')));
const validate = loadValidator();
const AT = '2026-10-18T05:30:00Z';
const REAL = path.join(ROOT, 'fixtures/v3-export');

// Two right answers on different days make w1 solid (the v2 rule); w2 was parked by a legacy event; w3 is untouched.
const item = (id, weakspotId) => ({ id, type: 'single', objective: 'E9-1', stem: 'A made-up question stem here?', options: ['a', 'b'], correct: [0], rationales: ['r', 'r'], ...(weakspotId ? { weakspotId } : {}), chapters: 'Fund 9' });
const derived = d => ({ status: 'open', streak: 0, nextDue: null, misses: 0, recurrence: 1, lastReviewed: null, lastResult: null, solidBy: null, solidAt: null, preRead: false, reopenedAt: null, answered: 0, right: 0, history: [], computedAt: '2026-10-17T00:00:00Z', by: 'page', ...d });
const V3 = {
  weakspots: [
    { id: 'w1', schema: 2, topic: 'Made-up topic one', objective: 'E9-1', exam: 'E9', course: 'NUR 112', kind: 'concept', source: 'test', addedAt: '2026-10-11T15:00:00Z', addedBy: 'E.V.', initial: { streak: 0, nextDue: '2026-10-12', recurrence: 1, misses: 0 }, events: {},
      derived: derived({ status: 'reviewed', streak: 2, nextDue: '2026-10-15', lastReviewed: '2026-10-13', lastResult: 'right', solidBy: 'review', solidAt: '2026-10-13T15:00:00.000Z', answered: 2, right: 2, history: [{ correct: true, date: '2026-10-12' }, { date: '2026-10-13', correct: true }] }) },
    { id: 'w2', schema: 2, topic: 'Made-up topic two', objective: 'E9-1', exam: 'E9', course: 'NUR 112', kind: 'concept', source: 'test', addedAt: '2026-10-11T15:00:00Z', addedBy: 'page', initial: { streak: 0, nextDue: '2026-10-12', recurrence: 1, misses: 0 }, parkedReason: 'not on the exam',
      events: { '2026-10-11T12:00:00Z': { type: 'park', by: 'legacy', note: 'not on the exam' }, '2026-10-12T00:51:05-05:00': { type: 'seen', by: 'Study Watch' } },
      derived: derived({ status: 'parked', nextDue: '2026-10-13', recurrence: 2 }) },
    { id: 'w3', schema: 2, topic: 'Made-up topic three', objective: 'E9-2', exam: 'E9', course: 'NUR 112', kind: 'concept', source: 'test', addedAt: '2026-10-16T15:00:00Z', addedBy: 'page', initial: { streak: 0, nextDue: '2026-10-17', recurrence: 1, misses: 0 }, events: {}, derived: derived({ nextDue: '2026-10-17' }) },
  ],
  sets: [{ id: 'review-2026-10-13', schema: 1, kind: 'review', date: '2026-10-13', title: 'Review', createdAt: '2026-10-13T04:25:00-05:00', source: 'morning', items: [item('q1', 'w1'), item('q2')],
    answers: { q1: { chosen: [0], correct: true, at: '2026-10-13T15:00:00Z', outcome: 'x' } },
    pastAttempts: [{ endedAt: '2026-10-12T16:00:00Z', answers: { q1: { chosen: [0], correct: true, at: '2026-10-12T15:00:00Z' } } }] }],
  days: [{ id: '2026-10-13', schema: 1, date: '2026-10-13', dayType: 'class', source: 'morning', list: { items: [{ id: 'plan-t1', text: 'Read', tag: 'READING', minutes: 45 }], focus: [] }, push: 'Class day',
    checks: { 'plan-t1': { at: '2026-10-13T20:00:00Z' }, gone: null }, added: { 'add-x': { text: 'Made-up added item', kind: 'todo', minutes: 10, at: '2026-10-13T18:00:00Z', by: 'Matt' } }, skipped: { 'plan-t9': { at: '2026-10-13T19:00:00Z', by: 'Matt' }, 'plan-t8': null },
    checkin: { energy: 2, at: '2026-10-13T12:00:00Z' },
    runs: { 'morning-0425': { pipeline: 'morning', startedAt: '2026-10-13T09:25:00Z', endedAt: '2026-10-13T09:31:00Z', status: 'ok', steps: [{ id: 'plan', status: 'ok' }] }, 'old-v2': { pipeline: 'v2 Daily list', startedAt: '2026-10-13T09:00:00Z', status: 'ok' } },
    weekly: { review: 'A made-up week.', at: '2026-10-13T22:57:00Z' } }],
  dates: [
    { id: 'canvas-1', schema: 1, source: 'Canvas', canvasId: 1, date: '2026-10-20', title: 'Made-up quiz', kind: 'due', graded: true, course: 'NUR 112', notes: 'Covers Ch 9', editedAt: '2026-10-14T01:00:00Z', editedBy: 'Matt', syncedAt: '2026-10-12T01:00:00Z' },
    { id: 'own-1', schema: 1, source: 'owner', date: '2026-10-21', title: 'Made-up study block', kind: 'other', graded: false, course: 'BIO 201', addedAt: '2026-10-12T01:00:00Z', removed: { at: '2026-10-14T02:00:00Z', by: 'Matt' } },
    { id: 'plain', date: '2026-10-22', title: 'Made-up plan date', kind: 'clinical', course: 'NUR 112' },
  ],
  plans: [{ id: 'E9', schema: 1, exam: 'E9', title: 'Exam 9 plan', sourceUrl: 'https://example.com/plan', source: 'Exam plan', createdAt: '2026-10-10T00:00:00Z', days: [{ date: '2026-10-13', label: 'Tue 10/13', tasks: [{ id: 't1', text: 'Read Ch 9', kind: 'reading' }] }], done: { t1: { at: '2026-10-13T20:00:00Z' } } }],
  jobs: [{ id: 'job-20261013-150000-guide', schema: 1, kind: 'study-guide', title: 'Made-up guide', brief: 'Made-up brief', createdAt: '2026-10-13T15:00:00Z', status: 'done', fired: { at: '2026-10-13T15:00:01Z', ok: true }, startedAt: '2026-10-13T15:01:00Z', finishedAt: '2026-10-13T15:09:00Z', result: { text: 'Done.', links: [{ title: 'Guide', url: 'https://example.com/g' }] } }],
  materials: [{ id: 'up-2026-10-13-sheet', schema: 2, course: 'NUR 112', kind: 'upload', title: 'Made-up sheet', fileType: 'pdf', text: '[p1] Made-up text', chars: 16, source: 'upload', addedBy: 'Matt', addedAt: '2026-10-13T01:00:00Z', status: 'removed' },
    { id: 'NUR112-5', schema: 1, course: 'NUR 112', title: 'Ch 9 slides.pdf', module: 'Exam 9', text: '[p1] Made-up slide', chars: 18, source: 'Canvas', fileId: 5, fetchedAt: '2026-10-12T01:00:00Z', needsOcr: false }],
  talk: [{ id: '2026-10-13', schema: 1, date: '2026-10-13', messages: { m20261013150000123m: { role: 'matt', text: 'Made up?', at: '2026-10-13T15:00:00.123Z' }, m20261013150001456e: { role: 'ev', text: 'Made up.', at: '2026-10-13T15:00:01.456Z', replyTo: 'm20261013150000123m' } } },
    { id: 'memory', schema: 1, summary: '', upTo: 'm20261013150001456e', lastSeenAt: '2026-10-13T16:00:00Z' }],
  exams: [{ id: 'E9', schema: 1, course: 'NUR 112', kind: 'unit', date: '2026-10-30', title: 'Exam 9', status: 'upcoming', source: 'Exam 9 plan', prediction: { predictedRange: [80, 88] } }],
  objectives: [{ id: 'E9-1', exam: 'E9', num: 1, text: 'Made-up objective', chapters: 'Ch 9', source: 'plan' }],
  sessions: [{ id: '2026-10-13-1900-Made-up', schema: 1, date: '2026-10-13', topic: 'Made-up', source: 'Study Watch', filedAt: '2026-10-13T00:51:05-05:00', summary: 'Made up.', weakSpots: [], cardCount: 0 }],
  ideas: [{ id: 'made-up-idea', schema: 1, text: 'A made-up idea', objective: '', status: 'open', source: 'Study Watch', links: [{ to: 'sessions/2026-10-13-1900-Made-up', type: 'seen-in', createdAt: '2026-10-13T00:51:05-05:00' }] }],
  announcements: [{ id: 'canvas-9', schema: 1, course: 'NUR 112', title: 'Made up', text: 'Made-up announcement', postedAt: '2026-10-12T14:00:00Z', source: 'Canvas' }],
  state: [{ id: 'current', schema: 1, date: '2026-10-13' }],
  system: [{ id: 'code', schema: 2, version: '3.5.0' }],
  reviews: [{ id: '2026-10-01', migratedTo: 'sets/review-2026-10-01' }],
  runs: [{ id: '2026-10-01-daily', routine: 'Daily list', at: '2026-10-01T09:00:00Z', migratedTo: 'days/2026-10-01' }],
};
const write = (r, col, id) => r.writes.find(w => w.collection === col && w.id === id);

test('every migrated write validates against its v4 schema and carries the envelope', () => {
  const r = migrateV3(V3, { at: AT });
  for (const w of r.writes) {
    const v = validate(w.collection, w.data, { id: w.id });
    assert.ok(v.ok, describeErrors(`${w.collection}/${w.id}`, v));
    if (w.collection !== 'legacy') { assert.equal(w.data.schema, currentVersion(w.collection), `${w.collection}/${w.id} at today's version`); assert.ok(w.data.writer && w.data.at && w.data.source, `${w.collection}/${w.id} envelope`); }
  }
  assert.deepEqual(r.skipped.map(s => s.ref), ['days/2026-10-13#runs/old-v2']);
});

test('weak spots: derived dropped, events keyed <writer>-<time> with their original instant, writers by role', () => {
  const r = migrateV3(V3, { at: AT });
  const w1 = write(r, 'weakspots', 'w1').data, w2 = write(r, 'weakspots', 'w2').data;
  assert.ok(!('derived' in w1)); assert.equal(w1.writer, 'morning'); assert.equal(w2.writer, 'page');
  assert.deepEqual(Object.keys(w2.events), ['page-20261011-120000000', 'filing-20261012-055105000']);
  assert.equal(w2.events['filing-20261012-055105000'].at, '2026-10-12T05:51:05.000Z', 'the entry keeps its instant, in UTC');
  assert.equal(w2.at, '2026-10-11T15:00:00.000Z');
});

test('sets: items stay, every attempt moves to answers/<setId>, past attempts included', () => {
  const r = migrateV3(V3, { at: AT });
  const s = write(r, 'sets', 'review-2026-10-13').data;
  assert.ok(!('answers' in s) && !('pastAttempts' in s));
  assert.deepEqual(s.items, V3.sets[0].items);
  assert.equal(s.createdAt, '2026-10-13T09:25:00.000Z', 'offset times become UTC');
  const a = write(r, 'answers', 'review-2026-10-13').data;
  assert.deepEqual(Object.keys(a.answers.q1), ['page-20261012-150000000', 'page-20261013-150000000']);
  assert.equal(a.setId, 'review-2026-10-13');
});

test('days split four ways: Derived day, dayedits (no nulls), runs/<id> per v3 run, weeks/<date>', () => {
  const r = migrateV3(V3, { at: AT });
  const d = write(r, 'days', '2026-10-13').data;
  assert.deepEqual(Object.keys(d).sort(), ['at', 'date', 'dayType', 'list', 'plan', 'push', 'schema', 'source', 'writer']);
  const e = write(r, 'dayedits', '2026-10-13').data;
  assert.deepEqual(Object.keys(e.checks), ['plan-t1']); assert.deepEqual(Object.keys(e.skipped), ['plan-t9']);
  assert.equal(e.added['add-x'].by, 'Matt'); assert.equal(e.checkin.energy, 2); assert.equal(e.updatedAt, '2026-10-13T20:00:00.000Z');
  const runs = r.writes.filter(w => w.collection === 'runs');
  assert.equal(runs.length, 1); assert.match(runs[0].id, /^morning-20261013-092500-[0-9a-f]{4}$/); assert.equal(runs[0].data.release, 'v3');
  assert.equal(write(r, 'weeks', '2026-10-13').data.review, 'A made-up week.');
});

test('dates: removal and Matt\'s notes on a Canvas entry move to dateedits; owner fields stay', () => {
  const r = migrateV3(V3, { at: AT });
  const c = write(r, 'dates', 'canvas-1').data;
  assert.equal(c.writer, 'canvas-sync'); assert.ok(!('notes' in c) && !('editedAt' in c));
  assert.equal(write(r, 'dateedits', 'canvas-1').data.notes, 'Covers Ch 9');
  const own = write(r, 'dates', 'own-1').data;
  assert.equal(own.writer, 'page'); assert.ok(!('removed' in own));
  assert.deepEqual(write(r, 'dateedits', 'own-1').data.removed, { at: '2026-10-14T02:00:00.000Z', by: 'Matt' });
  assert.equal(write(r, 'dateedits', 'plain'), undefined, 'no edit when there was nothing to move');
  const live = EV.liveDates(applyWrites(V3, r.writes).dates.filter(d => d.writer), applyWrites(V3, r.writes).dateedits);
  assert.deepEqual(live.map(d => d.id).sort(), ['canvas-1', 'plain']); assert.equal(live.find(d => d.id === 'canvas-1').notes, 'Covers Ch 9');
});

test('plans, jobs, materials, talk and the rest: ticks to planedits, results to jobresults, removal to materialedits, talk keys rewritten', () => {
  const r = migrateV3(V3, { at: AT });
  assert.ok(!('done' in write(r, 'plans', 'E9').data)); assert.deepEqual(Object.keys(write(r, 'planedits', 'E9').data.ticks), ['t1']);
  const j = write(r, 'jobs', 'job-20261013-150000-guide').data; assert.ok(!('status' in j) && !('result' in j));
  assert.equal(write(r, 'jobresults', 'job-20261013-150000-guide').data.status, 'done');
  assert.ok(!('status' in write(r, 'materials', 'up-2026-10-13-sheet').data));
  assert.equal(write(r, 'materialedits', 'up-2026-10-13-sheet').data.removed.by, 'Matt');
  assert.equal(write(r, 'materials', 'NUR112-5').data.kind, 'slides', 'an older material gets the kind v3 inferred');
  const t = write(r, 'talk', '2026-10-13').data;
  assert.deepEqual(Object.keys(t.messages), ['m-20261013-150000123-matt', 'm-20261013-150001456-ev']);
  assert.equal(t.messages['m-20261013-150001456-ev'].replyTo, 'm-20261013-150000123-matt');
  assert.equal(write(r, 'talk', 'memory').data.upTo, 'm-20261013-150001456-ev');
  assert.ok(!('prediction' in write(r, 'exams', 'E9').data));
  assert.equal(write(r, 'sessions', '2026-10-13-1900-Made-up').data.writer, 'filing');
});

test('nothing is lost: every v3 document has a legacy copy marked migratedTo (or kept as written), state and system are not migrated', () => {
  const r = migrateV3(V3, { at: AT });
  const legacy = r.writes.filter(w => w.collection === 'legacy');
  const total = Object.values(V3).reduce((s, d) => s + d.length, 0);
  assert.equal(legacy.length, total);
  assert.equal(write(r, 'legacy', 'v3-weakspots-w1').data.migratedTo, 'weakspots/w1');
  assert.ok(write(r, 'legacy', 'v3-weakspots-w1').data.derived, 'the original keeps its derived block');
  assert.equal(write(r, 'legacy', 'v3-state-current').data.migratedTo, null);
  assert.equal(r.writes.filter(w => ['state', 'system'].includes(w.collection)).length, 0);
});

test('verify-migration: zero mismatches on the made-up record; a planted wrong answer is caught', () => {
  const r = migrateV3(V3, { at: AT });
  const vm = verifyMigration(V3, r.writes);
  assert.equal(vm.compared, 3); assert.deepEqual(vm.mismatches, []);
  const broken = JSON.parse(JSON.stringify(V3)); broken.sets[0].answers.q1.correct = false;
  const bad = verifyMigration(broken, migrateV3(broken, { at: AT }).writes);
  assert.ok(bad.mismatches.some(m => m.id === 'w1' && m.field === 'status'));
});

test('idempotent and deterministic: the same export gives the same writes; a migrated record gives none', () => {
  const a = migrateV3(V3, { at: AT }), b = migrateV3(JSON.parse(JSON.stringify(V3)), { at: AT });
  assert.deepEqual(a.writes, b.writes);
  assert.deepEqual(migrateV3(applyWrites(V3, a.writes), { at: AT }).writes, []);
  assert.throws(() => migrateV3({ ...V3, journal: [{ id: 'j' }] }, { at: AT }), /journal is page-only/);
  assert.throws(() => migrateV3(V3, {}), /needs opts\.at/);
});

test('batches: at most 50 writes and 1 MiB each, one write per document per batch, order kept', () => {
  const writes = Array.from({ length: 120 }, (_, i) => ({ op: 'set', collection: 'c', doc_id: 'd' + i, data: { n: i } }));
  const b = chunkWrites(writes, { maxWrites: 50, maxBytes: 1048576 });
  assert.deepEqual(b.map(x => x.length), [50, 50, 20]); assert.deepEqual(b.flat(), writes);
  const big = Array.from({ length: 5 }, (_, i) => ({ op: 'set', collection: 'c', doc_id: 'b' + i, data: { t: 'x'.repeat(400000) } }));
  assert.ok(chunkWrites(big).every(x => x.reduce((s, w) => s + writeBytes(w), 0) <= 1048576));
  assert.deepEqual(chunkWrites([{ collection: 'c', doc_id: 'a' }, { collection: 'c', doc_id: 'a' }]).map(x => x.length), [1, 1]);
  assert.throws(() => chunkWrites([{ collection: 'c', doc_id: 'x', data: { t: 'x'.repeat(1048577) } }]), /over the 1048576-byte batch limit/);
});

test('cli: migrate v3 writes document files and chunked batches; verify-migration is green', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-mig-'));
  const exp = path.join(dir, 'export'); const out = path.join(dir, 'out');
  for (const [col, docs] of Object.entries(V3)) { fs.mkdirSync(path.join(exp, col), { recursive: true }); for (const { id, ...d } of docs) fs.writeFileSync(path.join(exp, col, id + '.json'), JSON.stringify(d)); }
  const cli = (...a) => execFileSync('node', [path.join(ROOT, 'core/cli.mjs'), ...a], { encoding: 'utf8' });
  assert.match(cli('verify-migration', '--from', exp, '--at', AT), /^verify-migration: GREEN: 3 weak spots recomputed from the migrated Facts, 0 mismatches; a second run writes 0; deterministic/);
  assert.match(cli('migrate', 'v3', '--from', exp, '--at', AT, '--out', out, '--record', 'live'), /writes in 2 batches/);
  const plan = JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8'));
  assert.equal(plan.record, 'https://claude.ai/artifact/Bu8RevP4r1twPdSGc77nfg');
  const w = plan.batches[0][0];
  assert.deepEqual(Object.keys(w).sort(), ['collection', 'doc_id', 'file_path', 'op']);
  assert.ok(fs.existsSync(w.file_path));
});

test('the real v3 export: every write validates, zero mismatches, a second run writes nothing (fixtures/v3-export, local only)', { skip: !fs.existsSync(REAL) && 'no fixtures/v3-export in this checkout' }, () => {
  const v3 = {}; for (const { collection, id, doc } of readExport(REAL)) (v3[collection] = v3[collection] || []).push({ ...doc, id });
  assert.equal(v3.journal, undefined, 'an export never holds the journal');
  const r = migrateV3(v3, { at: AT });
  const bad = r.writes.map(w => validate(w.collection, w.data, { id: w.id }).ok ? null : `${w.collection}/${w.id}`).filter(Boolean);
  assert.deepEqual(bad, []);
  const vm = verifyMigration(v3, r.writes);
  assert.ok(vm.compared > 0); assert.deepEqual(vm.mismatches, []);
  assert.deepEqual(migrateV3(applyWrites(v3, r.writes), { at: AT }).writes, []);
});

test('no migrated document is stamped after the export: a date with no creation time takes the migration time', () => {
  const v3 = { dates: [{ id: 'd-future', schema: 1, date: '2026-12-01', title: 'A made-up date', kind: 'due', source: 'owner' }] };
  const { writes } = migrateV3(v3, { at: '2026-10-18T05:00:00Z' });
  const d = writes.find(w => w.collection === 'dates' && w.id === 'd-future');
  assert.equal(d.data.at, '2026-10-18T05:00:00.000Z');
  for (const w of writes) assert.ok(!(Date.parse(w.data.at) > Date.parse('2026-10-18T05:00:00Z')), `${w.collection}/${w.id}`);
});

test('B-39 (D-094): the exams 1 to 2 bump moves the score to examedits, keeps the original in legacy, matches its fixture and is idempotent', async () => {
  const { migrateBumps, BUMPS } = await import('../core/migrate.mjs');
  const { readExport: read } = await import('../core/schemas.mjs');
  const dir = path.join(ROOT, 'test/data/bumps/exams-1');
  const load = d => { const db = {}; for (const { collection, id, doc } of read(d)) (db[collection] = db[collection] || []).push({ ...doc, id }); return db; };
  const before = load(path.join(dir, 'before')), after = load(path.join(dir, 'after'));
  assert.ok(BUMPS.exams[1], 'a migration keyed by collection and version');
  const r = migrateBumps(before, { at: '2026-10-18T17:00:00Z' });
  const got = {}; for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
  for (const [c, docs] of Object.entries(after)) assert.deepEqual(EV.stableStringify((got[c] || []).sort((a, b) => (a.id < b.id ? -1 : 1))), EV.stableStringify(docs.sort((a, b) => (a.id < b.id ? -1 : 1))), c);
  assert.deepEqual(Object.keys(got).sort(), Object.keys(after).sort());
  for (const w of r.writes) assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id} validates`);
  assert.ok(!('score' in got.exams.find(e => e.id === 'E1')) && got.examedits.find(e => e.id === 'E1').score === 88.5);
  // Idempotent: the record as it stands after the bump needs nothing more.
  const applied = applyWrites(before, r.writes);
  assert.deepEqual(migrateBumps(applied, { at: '2026-10-19T17:00:00Z' }).writes, []);
  // A score Matt entered after the bump is never overwritten by a later run of it.
  applied.exams = applied.exams.map(e => (e.id === 'E2' ? { ...e, schema: 1, score: 70 } : e));
  applied.examedits.push({ id: 'E2', schema: 1, writer: 'page', at: '2026-11-03T00:00:00Z', source: 'E.V. Home', updatedAt: '2026-11-03T00:00:00Z', score: 91 });
  assert.ok(!migrateBumps(applied, { at: '2026-11-04T00:00:00Z' }).writes.some(w => w.collection === 'examedits'), 'an existing examedits document is kept');
});

test('B-53 (D-109): the ideas 1 to 2 bump makes every earlier idea a learning idea, matches its fixture and is idempotent', async () => {
  const { migrateBumps } = await import('../core/migrate.mjs');
  const { readExport: read } = await import('../core/schemas.mjs');
  const dir = path.join(ROOT, 'test/data/bumps/ideas-1');
  const load = d => { const db = {}; for (const { collection, id, doc } of read(d)) (db[collection] = db[collection] || []).push({ ...doc, id }); return db; };
  const before = load(path.join(dir, 'before')), after = load(path.join(dir, 'after'));
  const r = migrateBumps(before, { at: '2026-10-18T17:00:00Z' });
  const got = {}; for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
  const sorted = l => (l || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const [c, docs] of Object.entries(after)) assert.equal(EV.stableStringify(sorted(got[c])), EV.stableStringify(sorted(docs)), c);
  for (const w of r.writes) assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id} validates`);
  assert.ok(got.ideas.every(i => i.kind === 'learning' && i.schema === 2));
  assert.deepEqual(migrateBumps(applyWrites(before, r.writes), { at: '2026-10-19T17:00:00Z' }).writes, [], 'a second run writes nothing');
});
