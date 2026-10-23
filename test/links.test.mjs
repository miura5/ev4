// B-231 (D-241): typed links. spec.links names every id field that points at another collection or a spec map; the
// build refuses a row the schemas lack; lint reports a dangling required link as an error and an optional one as a
// note; linked() resolves one document's link.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import EV from '../core/evcore.mjs';
import { readExport, loadValidator, loadSchemas } from '../core/schemas.mjs';
import { lintRecord } from '../core/lint.mjs';
import { linked, linkProblems, linkRows, schemaHas, valuesAt } from '../core/links.mjs';
import { build } from '../tools/build.mjs';
import { ROOT, copyRepo } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator();
const schemas = loadSchemas();
const fixture = () => {
  const db = {};
  for (const { collection, id, doc } of readExport(path.join(ROOT, 'test/data/record')))
    (db[collection] = db[collection] || []).push({ ...doc, id });
  return db;
};
const synthetic = () => {
  const rec = createRequire(import.meta.url)('./data/synthetic.cjs').syntheticRecord(new Date('2026-10-23T12:00:00Z'));
  return Object.fromEntries(
    Object.entries(rec).map(([c, docs]) => [
      c,
      Array.isArray(docs) ? docs : Object.entries(docs).map(([id, d]) => ({ id, ...d })),
    ])
  );
};
const dangling = db =>
  lintRecord(db, spec, validate, { date: '2026-10-17' }).issues.filter(i => i.code === 'dangling-link');

test('B-231: spec.links names 36 id fields, each in its schema, with a target the record or the spec has', () => {
  const rows = linkRows(spec);
  assert.equal(rows.length, 36);
  assert.deepEqual(linkProblems(spec, schemas), []);
  assert.equal(rows.filter(r => r.link === 'required').length, 8);
  assert.deepEqual(
    rows.filter(r => r.link === 'external').map(r => `${r.collection}.${r.field}`),
    ['sessions.noteId']
  );
  for (const want of [
    'weakspots.objective',
    'sets.items[].weakspotId',
    'talk.messages.*.jobId',
    'concepts.weakspots[]',
  ])
    assert.ok(
      rows.some(r => `${r.collection}.${r.field}` === want),
      want
    );
});

test('B-231: a row naming a field or collection the schemas lack is a problem, and so is a target nobody has', () => {
  const plant = row => linkProblems({ ...spec, links: { rows: [...linkRows(spec), row] } }, schemas);
  assert.match(
    plant({ collection: 'weakspots', field: 'objectiv', to: 'objectives', link: 'required' })[0],
    /no field objectiv/
  );
  assert.match(
    plant({ collection: 'weakspot', field: 'objective', to: 'objectives', link: 'required' })[0],
    /no collection weakspot/
  );
  assert.match(
    plant({ collection: 'ideas', field: 'title', to: 'objective', link: 'optional' }).join(' | '),
    /points at objective/
  );
  assert.match(plant({ collection: 'sets', field: 'title', to: 'exams', link: 'maybe' }).join(' | '), /link is maybe/);
  assert.equal(schemaHas(schemas.talk, 'messages.*.jobId'), true);
  assert.equal(schemaHas(schemas.talk, 'messages.*.jobid'), false);
  assert.deepEqual(valuesAt({ a: [{ b: 'x' }, { b: '' }, {}], m: { k: { c: 'y' } } }, 'a[].b'), ['x']);
  assert.deepEqual(valuesAt({ m: { k: { c: 'y' }, j: { c: 'z' } } }, 'm.*.c'), ['y', 'z']);
});

test('B-231: the build fails on a planted row naming weakspots.objectiv', async () => {
  const dir = copyRepo();
  const p = path.join(dir, 'spec/ev.spec.json');
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  s.links.rows.push({ collection: 'weakspots', field: 'objectiv', to: 'objectives', link: 'required' });
  fs.writeFileSync(p, JSON.stringify(s, null, 1));
  await assert.rejects(
    build({ root: dir, now: '2026-10-17T12:00:00Z' }),
    /spec\.links:\n {2}weakspots\.objectiv: the weakspots schema has no field objectiv/
  );
});

test('B-231: lint on the fixture and the synthetic record finds no dangling link', () => {
  assert.deepEqual(dangling(fixture()), []);
  assert.deepEqual(dangling(synthetic()), []);
});

test("B-231: a weak spot whose objective is missing is an error; a set item's missing weakspotId is a note", () => {
  const db = synthetic();
  const ws = db.weakspots.find(w => w.objective);
  ws.objective = 'E4-99';
  const set = db.sets.find(s => (s.items || []).length);
  set.items[0] = { ...set.items[0], weakspotId: 'ws-gone' };
  const got = dangling(db).map(i => [i.severity, i.ref, i.msg.split(',')[0]]);
  assert.deepEqual(got, [
    ['error', `weakspots/${ws.id}`, 'objective names E4-99'],
    ['info', `sets/${set.id}`, 'items[].weakspotId names ws-gone'],
  ]);
  const r = lintRecord(db, spec, validate, { date: '2026-10-17' });
  assert.ok(!r.issues.some(i => i.code === 'orphan-item' || i.code === 'unknown-objective'), 'said once, by the link');
});

test('B-231: linked() resolves a required, an optional and a missing link, and leaves an external one alone', () => {
  const db = synthetic();
  const ws = db.weakspots.find(w => w.objective && w.exam);
  const req = linked(db, ws, 'weakspots.objective', spec);
  assert.equal(req.link, 'required');
  assert.deepEqual(req.missing, []);
  assert.equal(req.found[0].doc.id, ws.objective);
  const opt = linked(db, ws, 'weakspots.exam', spec);
  assert.equal(opt.link, 'optional');
  assert.equal(opt.found[0].doc.id, ws.exam);
  const gone = linked(db, { ...ws, objective: 'E4-99' }, 'weakspots.objective', spec);
  assert.deepEqual([gone.found, gone.missing], [[], ['E4-99']]);
  const drill = db.sets.find(s => s.planTaskId);
  assert.equal(linked(db, drill, 'sets.planTaskId', spec).found[0].doc.id, drill.planTaskId, 'a task inside a plan');
  assert.deepEqual(linked(db, { course: 'NUR 112' }, 'dates.course', spec).missing, [], 'a course in spec.courses');
  assert.deepEqual(
    linked(db, { items: [{ sourceRef: 'note/n1#a line' }] }, 'sets.items[].sourceRef', spec),
    { link: 'optional', to: 'named', found: [], missing: [] },
    "his note's line is outside the record"
  );
  assert.deepEqual(linked(db, { noteId: 'x' }, 'sessions.noteId', spec), {
    link: 'external',
    to: 'the Study Watch note',
    found: [],
    missing: [],
  });
  assert.equal(linked(db, ws, 'weakspots.topic', spec), null, 'no such link');
});
