// B-232 (D-235, D-236, D-240, D-115): weak-spot schema 2. A proposed spot counts nowhere until his tap; accept, snooze
// and decline are events; a duplicate is kept with a duplicate-of link and its answers count on its survivor; the
// 1 to 2 migration keeps a D-115 legacy copy, changes nothing else and runs twice to the same result. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import EV from '../core/evcore.mjs';
import { spec, at, ev, ws, E4, assertValid } from './core-fixtures.mjs';
import { readExport, loadValidator } from '../core/schemas.mjs';
import { migrateBumps, applyWrites, fromLegacy, currentVersion, BUMPS } from '../core/migrate.mjs';
import { lintRecord } from '../core/lint.mjs';
import { factHash, factFields } from '../core/derive.mjs';
import { ROOT } from './helpers.mjs';

const validate = loadValidator();
const build = (docs, extra = {}) =>
  EV.buildWeakspots({ weakspots: docs, sets: [], answers: [], exams: [E4], ...extra });
const one = (docs, id, extra) => build(docs, extra).find(w => w.id === id);
const ids = xs => xs.map(w => w.id).sort();
const proposed = (id, extra = {}) => ws(id, { proposed: true, words: 'mixing up ' + id, ...extra });

test('B-232: a proposed spot is in no review pick, no readiness count and no audit row', () => {
  const docs = [
    ws('counted', { initial: { streak: 0, nextDue: '2026-10-16', recurrence: 1, misses: 0 } }),
    proposed('waiting', { initial: { streak: 0, nextDue: '2026-10-16', recurrence: 1, misses: 0 } }),
  ];
  const models = build(docs);
  const w = models.find(x => x.id === 'waiting');
  assert.equal(w.derived.status, 'proposed');
  assert.equal(EV.isActive(w), false);
  assert.equal(EV.isDue(w, '2026-10-17'), false);
  assert.equal(EV.untriaged(w), true);
  assert.deepEqual(ids(EV.rankDue(models, '2026-10-17', [E4])), ['counted']);
  const r = EV.pickReviews({ date: '2026-10-17', dayType: 'off', exams: [E4], weakspots: models, objectives: [] });
  assert.deepEqual(ids(r.picked), ['counted']);
  const rd = EV.readiness({ examId: 'E4', weakspots: models });
  assert.equal(rd.active + rd.solid, 1, 'readiness counts only the counted spot');
  const audit = EV.readinessAudit({ examId: 'E4', objectives: [{ id: 'E4-3', exam: 'E4' }], weakspots: models });
  assert.equal(audit[0].notYet + audit[0].rightOnce + audit[0].solid + audit[0].preRead, 1);
  assert.deepEqual(ids(EV.toReview(models, '2026-10-17')), ['waiting']);
  // An answer on a proposed spot changes nothing and makes no new spot.
  const set = {
    id: 'review-2026-10-17',
    kind: 'review',
    items: [
      {
        id: 'q1',
        type: 'single',
        stem: 'A made-up stem',
        options: ['a', 'b'],
        correct: [0],
        objective: 'E4-3',
        topic: 'waiting',
        weakspotId: 'waiting',
      },
    ],
  };
  const p = EV.planAnswer({
    set,
    item: set.items[0],
    chosen: [1],
    weakspots: models,
    sets: [set],
    answers: [],
    exams: [E4],
    now: at('2026-10-17'),
  });
  assert.equal(p.writes.filter(x => x.collection === 'weakspots').length, 0);
  assert.equal(p.state, null);
});

test('B-232: accept makes a proposed spot open and due tomorrow, under the objective he confirmed', () => {
  const doc = proposed('acc', {
    objective: '',
    exam: '',
    events: ev(at('2026-10-17'), { type: 'accept', by: 'owner', objective: 'E4-2', at: at('2026-10-17') }),
  });
  const w = one([doc], 'acc');
  assert.equal(w.derived.status, 'open');
  assert.equal(w.derived.nextDue, '2026-10-18');
  assert.equal(w.objective, 'E4-2');
  assert.equal(w.exam, 'E4');
  assert.equal(EV.isDue(w, '2026-10-17'), false);
  assert.equal(EV.isDue(w, '2026-10-18'), true);
  assertValid({ op: 'set', collection: 'weakspots', id: 'acc', data: EV.docData(doc) });
});

test('B-232: snooze hides a spot until its date, then it is proposed again; decline hides it and keeps it', () => {
  const sn = proposed('sn', {
    events: ev(at('2026-10-17'), { type: 'snooze', by: 'owner', until: '2026-10-20', at: at('2026-10-17') }),
  });
  const de = proposed('de', { events: ev(at('2026-10-17'), { type: 'decline', by: 'owner', at: at('2026-10-17') }) });
  const models = build([sn, de]);
  const s = models.find(w => w.id === 'sn'),
    d = models.find(w => w.id === 'de');
  assert.equal(s.derived.status, 'snoozed');
  assert.equal(s.derived.snoozedUntil, '2026-10-20');
  assert.deepEqual(ids(EV.toReview(models, '2026-10-19')), []);
  assert.deepEqual(ids(EV.toReview(models, '2026-10-20')), ['sn'], 'proposed again on its date');
  assert.equal(EV.triageStatus(s, '2026-10-20'), 'proposed');
  for (const date of ['2026-10-17', '2026-10-20', '2026-10-30']) {
    assert.deepEqual(ids(EV.rankDue(models, date, [E4])), [], date);
    assert.equal(EV.isActive(s) || EV.isActive(d), false);
  }
  assert.equal(d.derived.status, 'declined');
  assert.equal(models.length, 2, 'a declined spot is kept');
  for (const doc of [sn, de]) assertValid({ op: 'set', collection: 'weakspots', id: doc.id, data: EV.docData(doc) });
  // A snooze names its date.
  const bad = { ...EV.docData(sn), events: { 'page-20261017-150000': { type: 'snooze', by: 'owner' } } };
  assert.equal(validate('weakspots', bad, { id: 'sn' }).ok, false);
});

test("B-232 (D-240): a duplicate's two answers count on its survivor, and the duplicate is kept", () => {
  const survivor = ws('surv', { initial: { streak: 0, nextDue: '2026-10-16', recurrence: 1, misses: 1 } });
  const dup = ws('dupe', {
    links: [{ to: 'weakspots/surv', type: 'duplicate-of', createdAt: at('2026-10-16'), createdBy: 'owner' }],
  });
  const set = { id: 'drill-made-up', kind: 'drill', items: [{ id: 'q1', weakspotId: 'dupe', objective: 'E4-3' }] };
  const answers = [
    {
      setId: 'drill-made-up',
      answers: { q1: { a1: { at: at('2026-10-16'), correct: true }, a2: { at: at('2026-10-17'), correct: true } } },
    },
  ];
  const attempts = EV.collectAttempts([set], answers, [survivor, dup]);
  assert.deepEqual(Object.keys(attempts.byWeakspot), ['surv']);
  assert.ok(attempts.all.every(a => a.creditedFrom === 'dupe'));
  assert.deepEqual(
    Object.keys(EV.collectAttempts([set], answers).byWeakspot),
    ['dupe'],
    'without the weak spots nothing moves'
  );
  const models = build([survivor, dup], { sets: [set], answers });
  const s = models.find(w => w.id === 'surv'),
    d = models.find(w => w.id === 'dupe');
  assert.equal(s.derived.answered, 2);
  assert.equal(s.derived.status, 'reviewed', 'right on two days makes the survivor solid');
  assert.equal(d.derived.status, 'duplicate');
  assert.equal(d.derived.duplicateOf, 'surv');
  assert.equal(d.derived.answered, 0);
  assert.equal(EV.isActive(d), false);
  assertValid({ op: 'set', collection: 'weakspots', id: 'dupe', data: EV.docData(dup) });
  // An item on the duplicate answered now lands on the survivor.
  const q = {
    id: 'q2',
    type: 'single',
    stem: 'A made-up stem',
    options: ['a', 'b'],
    correct: [0],
    objective: 'E4-3',
    weakspotId: 'dupe',
  };
  const fresh = build([ws('surv'), dup]);
  const p = EV.planAnswer({
    set: { ...set, items: [q] },
    item: q,
    chosen: [1],
    weakspots: fresh,
    sets: [],
    answers: [],
    exams: [E4],
    now: at('2026-10-17'),
  });
  assert.equal(p.weakspotId, 'surv');
});

test('B-232 (D-240): lint fails a duplicate-of that reaches another duplicate, itself or nothing', () => {
  const RECORD = path.join(ROOT, 'test/data/record');
  const db = {};
  for (const { collection, id, doc } of readExport(RECORD))
    (db[collection] = db[collection] || []).push({ ...doc, id });
  const base = db.weakspots[0];
  const link = to => [{ to: 'weakspots/' + to, type: 'duplicate-of' }];
  const lint = extra => {
    const rec = { ...db, weakspots: [...db.weakspots, ...extra] };
    return lintRecord(rec, spec, validate, { date: '2026-10-17' }).issues.filter(i => /^duplicate-/.test(i.code));
  };
  const plant = (id, to) => ({ ...EV.docData(base), id, topic: 'Made-up ' + id, links: link(to) });
  assert.deepEqual(lint([plant('ok-dup', base.id)]), [], 'a duplicate of a survivor is fine');
  const chain = lint([plant('dup-a', base.id), plant('dup-b', 'dup-a')]);
  assert.deepEqual(
    chain.map(i => [i.severity, i.code, i.ref]),
    [['error', 'duplicate-chain', 'weakspots/dup-b']]
  );
  assert.equal(lint([plant('self', 'self')])[0].code, 'duplicate-chain');
  assert.equal(lint([plant('lost', 'nowhere')])[0].code, 'duplicate-dangling');
  // spec.links names the link field, as ideas' links.
  assert.ok(spec.links.rows.some(r => r.collection === 'weakspots' && r.field === 'links[].to' && r.to === 'named'));
});

test('B-232 (D-115): the weakspots 1 to 2 bump changes only the version, keeps a D-115 copy and runs twice to the same result', () => {
  assert.equal(currentVersion('weakspots'), 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/schemas/weakspots.schema.json')))['x-ev'].schema, 2);
  const dir = path.join(ROOT, 'test/data/bumps/weakspots-1');
  const load = d => {
    const db = {};
    for (const { collection, id, doc } of readExport(d)) (db[collection] = db[collection] || []).push({ ...doc, id });
    return db;
  };
  const before = load(path.join(dir, 'before')),
    after = load(path.join(dir, 'after'));
  assert.ok(before.weakspots.length >= 5 && before.weakspots.every(d => d.schema === 1));
  const r = migrateBumps(before, { at: '2026-10-26T18:00:00Z' });
  const got = {};
  for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
  const sorted = l => (l || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const [c, docs] of Object.entries(after))
    assert.equal(EV.stableStringify(sorted(got[c])), EV.stableStringify(sorted(docs)), c);
  for (const w of r.writes) assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id}`);
  for (const d of before.weakspots) {
    const moved = got.weakspots.find(x => x.id === d.id);
    assert.deepEqual({ ...moved, schema: 1 }, d, `${d.id}: only the version changes`);
    assert.equal(moved.schema, 2);
    const copy = got.legacy.find(l => l.id === `v4-weakspots-${d.id}-s1`);
    assert.deepEqual(copy.changed, { schema: 1 }, 'D-115: only the changed fields');
    assert.deepEqual(copy.added, []);
    assert.deepEqual(copy.omits, ['events', 'links'], 'the hash leaves out the append map and the mark');
    assert.equal(copy.migratedTo, `weakspots/${d.id}`);
    assert.deepEqual({ ...fromLegacy(moved, copy), id: d.id }, d, 'the original rebuilds from the copy and its hash');
    assert.equal(fromLegacy({ ...moved, topic: 'changed' }, copy), null, 'a hash that disagrees rebuilds nothing');
    // derived state is the same before and after
    assert.deepEqual(EV.deriveWeakspot(EV.weakspotFacts(moved), []), EV.deriveWeakspot(EV.weakspotFacts(d), []), d.id);
  }
  const applied = applyWrites(before, r.writes);
  assert.deepEqual(migrateBumps(applied, { at: '2026-10-27T18:00:00Z' }).writes, [], 'a second run writes nothing');
  assert.equal(EV.stableStringify(applyWrites(applied, [])), EV.stableStringify(applied));
  // A schema-1 spot that somehow carries schema-2 fields keeps them.
  assert.deepEqual(BUMPS.weakspots[1]({ id: 'x', schema: 1, topic: 't', proposed: true }).data, {
    id: 'x',
    schema: 2,
    topic: 't',
    proposed: true,
  });
});

test('B-232: the record fixture and every weak spot core writes are at schema 2', () => {
  const RECORD = path.join(ROOT, 'test/data/record/weakspots');
  for (const f of fs.readdirSync(RECORD)) assert.equal(JSON.parse(fs.readFileSync(path.join(RECORD, f))).schema, 2, f);
  const set = {
    id: 'review-2026-10-17',
    kind: 'review',
    items: [
      {
        id: 'q1',
        type: 'single',
        stem: 'A made-up stem',
        options: ['a', 'b'],
        correct: [0],
        objective: 'E4-3',
        topic: 'brand new',
      },
    ],
  };
  const p = EV.planAnswer({
    set,
    item: set.items[0],
    chosen: [1],
    weakspots: [],
    sets: [set],
    answers: [],
    exams: [E4],
    now: at('2026-10-17'),
  });
  const w = p.writes.find(x => x.collection === 'weakspots');
  assert.equal(w.data.schema, 2);
  assertValid(w);
});

test('B-232: migrate bumps --store worker writes pinned batch files for the run API, and a migrated pull has nothing to do', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-b232-'));
  try {
    const before = path.join(ROOT, 'test/data/bumps/weakspots-1/before');
    const vdir = path.join(tmp, 'versions');
    fs.mkdirSync(vdir);
    const ids = fs.readdirSync(path.join(before, 'weakspots')).map(f => f.slice(0, -5));
    fs.writeFileSync(path.join(vdir, 'weakspots.json'), JSON.stringify(Object.fromEntries(ids.map(id => [id, 4]))));
    const cli = args =>
      execFileSync('node', [path.join(ROOT, 'core/cli.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
    const out = cli([
      'migrate',
      'bumps',
      '--from',
      before,
      '--versions-dir',
      vdir,
      '--record',
      'staging',
      '--store',
      'worker',
      '--worker',
      'w.json',
      '--out',
      path.join(tmp, 'b'),
      '--at',
      '2026-10-26T18:00:00Z',
    ]);
    assert.match(out, /api batch --worker w\.json --label bumps --files /);
    const batch = JSON.parse(fs.readFileSync(path.join(tmp, 'b', 'batch-1.json'), 'utf8'));
    assert.equal(batch.length, ids.length * 2);
    for (const w of batch) {
      assert.ok(fs.existsSync(w.file_path), w.doc_id);
      assert.equal(
        w.if_version,
        w.collection === 'weakspots' ? 4 : undefined,
        'a bumped spot is pinned; a new copy is not'
      );
    }
    // each legacy copy goes before the spot it keeps
    for (const id of ids)
      assert.ok(batch.findIndex(w => w.doc_id === `v4-weakspots-${id}-s1`) < batch.findIndex(w => w.doc_id === id), id);
    assert.match(
      cli([
        'migrate',
        'bumps',
        '--from',
        path.join(ROOT, 'test/data/bumps/weakspots-1/after'),
        '--record',
        'staging',
        '--store',
        'worker',
      ]),
      /nothing to do/
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- the first review's gaps
const loadRecord = () => {
  const db = {};
  for (const { collection, id, doc } of readExport(path.join(ROOT, 'test/data/record')))
    (db[collection] = db[collection] || []).push({ ...doc, id });
  return db;
};
const lintOf = db =>
  lintRecord(db, spec, validate, { date: '2026-10-17' }).issues.filter(i => (i.ref || '').startsWith('weakspots/'));

test('B-232 review: after the migration, a later event or Join leaves the D-115 copy whole: fact-migrated, never fact-changed', () => {
  const db = loadRecord();
  const w = db.weakspots[0];
  w.schema = 1; // the record as it was before the release, hashed by state/current at schema 1
  const cur = db.state.find(s => s.id === 'current');
  const fields = factFields(spec, 'weakspots');
  cur.factHashes[`weakspots/${w.id}`] = factHash(spec, 'weakspots', w, { fields });
  cur.factFields.weakspots = fields;
  assert.deepEqual(
    lintOf(db).filter(i => i.severity !== 'info'),
    [],
    'a schema-1 spot lints green before the migration'
  );
  const r = migrateBumps(db, { at: '2026-10-26T18:00:00Z' });
  const m = applyWrites(db, r.writes);
  const after = JSON.parse(JSON.stringify(m));
  const x = after.weakspots.find(d => d.id === w.id);
  x.events = { ...x.events, 'page-20261026-190000': { type: 'solid', by: 'owner', at: '2026-10-26T19:00:00Z' } };
  x.links = [{ to: 'weakspots/other', type: 'related' }];
  for (const rec of [m, after]) {
    const is = lintOf(rec);
    assert.deepEqual(
      is.filter(i => i.severity !== 'info'),
      [],
      JSON.stringify(is.filter(i => i.severity !== 'info'))
    );
    assert.ok(
      is.some(i => i.code === 'fact-migrated'),
      'the bump is a note until the next state rebuild'
    );
  }
  const copy = after.legacy.find(l => l.id === `v4-weakspots-${w.id}-s1`);
  const orig = fromLegacy(x, copy);
  assert.ok(orig, 'the original still rebuilds');
  assert.equal(orig.schema, 1);
  assert.equal(factHash(spec, 'weakspots', orig, { fields }), cur.factHashes[`weakspots/${w.id}`]);
  // a change to one of its own fields still breaks the copy
  assert.equal(fromLegacy({ ...x, topic: 'changed' }, copy), null);
});

test('B-232 review: a schema-1 spot stays valid until the migration, with none of schema 2', () => {
  const doc = { ...EV.docData(ws('old')), schema: 1 };
  assert.ok(validate('weakspots', doc, { id: 'old' }).ok);
  const parked = {
    ...doc,
    events: { 'evening-cloud-20261026-011500': { type: 'park', by: 'E.V.', note: 'exam passed' } },
  };
  assert.ok(validate('weakspots', parked, { id: 'old' }).ok, "the evening's park on an unmigrated spot");
  for (const extra of [
    { proposed: true },
    { words: 'his words' },
    { links: [] },
    { events: { 'page-20261026-120000': { type: 'accept', by: 'owner' } } },
    { events: { 'page-20261026-120000': { type: 'snooze', by: 'owner', until: '2026-10-28' } } },
    { events: { 'page-20261026-120000': { type: 'decline', by: 'owner' } } },
  ])
    assert.equal(validate('weakspots', { ...doc, ...extra }, { id: 'old' }).ok, false, JSON.stringify(extra));
  assert.ok(validate('weakspots', { ...doc, schema: 2, proposed: true }, { id: 'old' }).ok);
});

test('B-232 review: a duplicate-of naming a missing spot credits no one: the spot keeps its own answers', () => {
  const lost = ws('lost', { links: [{ to: 'weakspots/nowhere', type: 'duplicate-of' }] });
  const set = { id: 'drill-made-up', kind: 'drill', items: [{ id: 'q1', weakspotId: 'lost', objective: 'E4-3' }] };
  const answers = [{ setId: 'drill-made-up', answers: { q1: { a1: { at: at('2026-10-16'), correct: true } } } }];
  const a = EV.collectAttempts([set], answers, [lost]);
  assert.deepEqual(Object.keys(a.byWeakspot), ['lost']);
  assert.equal(a.all[0].creditedFrom, undefined);
  // and it stays counted: open, in review and readiness, with its own answer (lint names the link)
  const lostModel = build([lost], { sets: [set], answers }).find(w => w.id === 'lost');
  assert.equal(lostModel.derived.status, 'open');
  assert.equal(lostModel.derived.answered, 1);
  assert.equal(EV.isActive(lostModel), true);
  assert.equal(EV.readiness({ examId: 'E4', weakspots: [lostModel] }).active, 1);
  // a cycle credits no one either
  const c1 = ws('c1', { links: [{ to: 'weakspots/c2', type: 'duplicate-of' }] });
  const c2 = ws('c2', { links: [{ to: 'weakspots/c1', type: 'duplicate-of' }] });
  const set2 = { ...set, items: [{ id: 'q1', weakspotId: 'c1', objective: 'E4-3' }] };
  assert.deepEqual(Object.keys(EV.collectAttempts([set2], answers, [c1, c2]).byWeakspot), ['c1']);
  assert.deepEqual(
    build([c1, c2]).map(w => w.derived.status),
    ['open', 'open'],
    'a cycle leaves both counted'
  );
});

test("B-232 review (D-240): a duplicate's seen events count on its survivor; a session never matches a duplicate", () => {
  const surv = ws('surv-seen', { topic: 'Made-up potassium topic' });
  const dup = ws('dup-seen', {
    topic: 'Made-up potassium topic again',
    links: [{ to: 'weakspots/surv-seen', type: 'duplicate-of' }],
    events: ev(at('2026-10-17'), { type: 'seen', by: 'E.V.', note: 'Study session', at: at('2026-10-17') }),
  });
  const models = build([surv, dup]);
  const s = models.find(w => w.id === 'surv-seen'),
    d = models.find(w => w.id === 'dup-seen');
  assert.equal(s.derived.recurrence, 2, 'seen again, on the survivor');
  assert.equal(s.derived.nextDue, '2026-10-18');
  assert.equal(d.derived.status, 'duplicate');
  assert.deepEqual(Object.keys(s.events), [], "the survivor's own events are unchanged");
  // planAnswer's recompute of the survivor keeps the credited event
  const q = {
    id: 'q9',
    type: 'single',
    stem: 'A made-up stem',
    options: ['a', 'b'],
    correct: [0],
    objective: 'E4-3',
    weakspotId: 'surv-seen',
  };
  const p = EV.planAnswer({
    set: { id: 'drill-x', kind: 'drill', items: [q] },
    item: q,
    chosen: [0],
    weakspots: models,
    sets: [],
    answers: [],
    exams: [E4],
    now: at('2026-10-18'),
  });
  assert.equal(p.state.recurrence, 2);
  // a session's finding near a duplicate or a proposed spot asks nothing about it and writes no seen to it
  const only = build([
    ws('surv-seen', { topic: 'Cardiac output basics' }),
    dup,
    ws('prop-seen', { topic: 'Made-up potassium topic too', proposed: true }),
  ]);
  const T0 = '2026-10-18T15:00:00.000Z';
  const session = {
    id: 'ss-20261018-150000-made-up',
    source: 'E.V. Home',
    status: 'active',
    topic: 'Made-up topic',
    startedAt: T0,
    events: { [EV.eventKey('page', T0)]: { type: 'start' } },
  };
  const wrap = {
    summary: 's',
    weakSpots: [{ objective: 'E4-3', topic: 'Made-up potassium topic' }],
    connections: [],
    noteTodos: [],
    cards: [],
  };
  const f = EV.closeSession(session, wrap, {
    weakspots: only,
    objectives: [{ id: 'E4-3' }],
    now: '2026-10-18T15:20:00Z',
  });
  assert.equal(f.questions.length, 0);
  assert.ok(!f.writes.some(w => w.op === 'update' && w.collection === 'weakspots'));
});

test('B-232 final: a session finding never sets over a spot already there; a parked one made today keeps its events', () => {
  const T0 = '2026-10-18T15:00:00.000Z';
  const id = 'ws-2026-10-18-E4-3-made-up-sodium-shifts';
  const parkKey = EV.eventKey('page', '2026-10-18T14:00:00.000Z');
  const parked = ws(id, {
    topic: 'Made-up sodium shifts',
    events: { [parkKey]: { type: 'park', by: 'owner', note: 'not on this exam', at: '2026-10-18T14:00:00.000Z' } },
  });
  const models = build([parked]);
  assert.equal(models[0].derived.status, 'parked');
  const session = {
    id: 'ss-20261018-150000-made-up',
    source: 'E.V. Home',
    status: 'active',
    topic: 'Made-up topic',
    startedAt: T0,
    events: { [EV.eventKey('page', T0)]: { type: 'start' } },
  };
  const wrap = {
    summary: 's',
    weakSpots: [
      { objective: 'E4-3', topic: 'Made-up sodium shifts' },
      { objective: 'E4-3', topic: 'Made-up sodium shifts!' },
    ],
    connections: [],
    noteTodos: [],
    cards: [],
  };
  const r = EV.closeSession(session, wrap, {
    weakspots: models,
    objectives: [{ id: 'E4-3' }],
    now: '2026-10-18T15:20:00Z',
  });
  const sets = r.writes.filter(w => w.collection === 'weakspots' && w.op === 'set').map(w => w.id);
  assert.ok(!sets.includes(id), 'the parked spot is never set over');
  assert.deepEqual(sets, [id + '-2', id + '-3'], 'the next free ids, as ideas take them');
  for (const w of r.writes.filter(x => x.collection === 'weakspots')) assertValid(w);
});

test('B-232 final: freeWeakspotId gives the next free id, and her add_weakspot tool logs a topic that has a spot today', async () => {
  const { makeActions } = await import('../core/actions.mjs');
  const { validateAgainst } = await import('../core/validate.mjs');
  const base = 'ws-2026-10-21-E9-2-pump-rates';
  assert.equal(EV.freeWeakspotId(base, []), base);
  assert.equal(EV.freeWeakspotId(base, [{ id: base }]), base + '-2');
  assert.equal(EV.freeWeakspotId(base, [base, base + '-2']), base + '-3');
  const taken = new Set([base]);
  assert.equal(EV.freeWeakspotId(base, taken), base + '-2');
  assert.equal(EV.freeWeakspotId(base, taken), base + '-3', 'a Set the caller keeps gains each id it hands out');
  // the tool path, as toolLogWeakspot calls it: a same-day declined spot holds the base id
  const A = makeActions(validateAgainst, EV);
  const tool = A.actor(spec, 'tool');
  const HIS = 'm-20261021-232900000-m';
  const ctx = {
    now: '2026-10-21T23:30:00.000Z',
    key: () => 'page-20261021-233000000',
    weakspots: [{ id: base, events: { 'page-20261021-120000': { type: 'decline', by: 'owner' } } }],
    line: id => (id === HIS ? { role: 'matt', text: 'log pump rates as a weak spot' } : null),
  };
  const args = id => ({
    id,
    topic: 'pump rates',
    objective: 'E9-2',
    course: 'NUR 112',
    source: 'Told E.V.',
    initial: { streak: 0, nextDue: '2026-10-21', recurrence: 1, misses: 0 },
    from: HIS,
  });
  assert.ok(tool('weakspot-log', args(base), ctx).refused, 'act() still refuses an id already there');
  const free = EV.freeWeakspotId(base, ctx.weakspots);
  const r = tool('weakspot-log', args(free), ctx);
  assert.equal(r.ok, true, JSON.stringify(r.refused));
  assert.equal(r.writes[0].id, base + '-2');
  const forms = fs.readFileSync(path.join(ROOT, 'page', 'app', '91-forms.js'), 'utf8');
  const body = forms.slice(forms.indexOf('async function toolLogWeakspot'), forms.indexOf('async function weakAct'));
  assert.match(body, /E\.freeWeakspotId\([\s\S]*?, S\.weak\)/, 'the page passes a free id, checked against S.weak');
});
