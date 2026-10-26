// B-401 (D-325, D-326, D-328): the notes record. A notes collection written by the page only, its body blocks with
// inline marks (never HTML), archived and discarded as marks; sessions name the note they study and talk lines carry a
// thread with a closed mark. Pipelines skip notes as they skip the journal (an edited note is no lint error and no
// fact-changed); evening-mac reads them only for its backup and mirror; the mirror writes notes/<id>.md; backups,
// pwa-copy and the app's made-up record carry them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import EV from '../core/evcore.mjs';
import * as RUN from '../core/run.mjs';
import { readExport, loadValidator, loadSchemas, PAGE_ONLY } from '../core/schemas.mjs';
import { lintRecord } from '../core/lint.mjs';
import { rebuild, asOf, factFields } from '../core/derive.mjs';
import { linked, linkIssues, linkProblems } from '../core/links.mjs';
import { macBackup, CODE_STEPS } from '../core/steps.mjs';
import { backupOf, manifestSync } from '../core/d1backup.mjs';
import { registryProblems } from '../tools/build.mjs';
import { recordCollections } from '../tools/pwa-copy.mjs';
import { seedRecord, LEFT_OUT } from '../pwa/seed.mjs';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator();
const schemas = loadSchemas();
const RECORD = path.join(ROOT, 'test/data/record');
const NOTE_ID = 'n-20261016-150000-sample';
const load = () => {
  const db = {};
  for (const { collection, id, doc } of readExport(RECORD))
    (db[collection] = db[collection] || []).push({ ...doc, id });
  return db;
};
const note = (extra = {}) => ({ ...load().notes.find(n => n.id === NOTE_ID), ...extra });
const ok = (col, doc, id = doc.id) => {
  const { id: _drop, ...data } = doc;
  return validate(col, data, { id }).ok;
};
const synthetic = () =>
  createRequire(import.meta.url)('./data/synthetic.cjs').syntheticRecord(new Date('2026-10-23T12:00:00Z'));

test('B-401: notes is a page-only collection with its schema, marks, his fields, capacity and links', () => {
  const c = spec.collections.notes;
  assert.equal(c.class, 'Fact');
  assert.deepEqual(c.writers, ['page']);
  assert.equal(c.schema, 'spec/schemas/notes.schema.json');
  assert.deepEqual(Object.keys(c.marks), [
    'title',
    'course',
    'label',
    'blocks',
    'editedAt',
    'archivedAt',
    'discardedAt',
  ]);
  for (const roles of Object.values(c.marks)) assert.deepEqual(roles, ['page']);
  assert.deepEqual(c.his, ['title', 'label', 'blocks']);
  assert.ok(spec.capacity.collections.notes, 'a capacity row');
  assert.ok(spec.capacity.documentBytes > 0, 'a note is capped at documentBytes like every document');
  assert.deepEqual(schemas.notes['x-ev'].writers, ['page']);
  assert.deepEqual(schemas.talk['x-ev'].marks, { closed: ['page'] });
  assert.deepEqual(spec.collections.talk.marks, { closed: ['page'] });
  assert.deepEqual(registryProblems(spec, schemas), []);
  assert.deepEqual(linkProblems(spec, schemas), []);
  const rows = spec.links.rows.filter(
    r => r.collection === 'notes' || (r.collection === 'sessions' && r.field === 'note')
  );
  assert.deepEqual(rows.map(r => `${r.collection}.${r.field}->${r.to} ${r.link}`).sort(), [
    'notes.course->spec.courses optional',
    'notes.earlierOf->notes optional',
    'sessions.note->named optional',
  ]);
  assert.deepEqual(PAGE_ONLY, ['journal', 'notes']);
});

test('B-401: a note validates as blocks of plain-text runs; HTML, unknown marks or blocks and script links are refused', () => {
  assert.ok(ok('notes', note()), 'the fixture note');
  // every block type and every inline mark
  const all = note({
    blocks: ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo'].map(type => ({
      type,
      runs: [{ text: 'made-up', b: true, i: true, u: true, s: true, href: 'https://example.com/a' }],
      ...(type === 'todo' ? { checked: true } : {}),
      ...(type === 'ul' ? { indent: 1 } : {}),
    })),
  });
  assert.ok(ok('notes', all));
  const bad = {
    'an html body': note({ html: '<p>made-up</p>' }),
    'an html block': note({ blocks: [{ type: 'html', runs: [{ text: '<b>x</b>' }] }] }),
    'a block holding html': note({ blocks: [{ type: 'p', runs: [], html: '<p>x</p>' }] }),
    'an unknown mark': note({ blocks: [{ type: 'p', runs: [{ text: 'x', color: 'red' }] }] }),
    'a false mark': note({ blocks: [{ type: 'p', runs: [{ text: 'x', b: false }] }] }),
    'a script link': note({ blocks: [{ type: 'p', runs: [{ text: 'x', href: 'javascript:alert(1)' }] }] }),
    'a link with a tag': note({ blocks: [{ type: 'p', runs: [{ text: 'x', href: 'https://a.example/<script>' }] }] }),
    'another writer': note({ writer: 'worker' }),
    'no blocks': (() => {
      const n = note();
      delete n.blocks;
      return n;
    })(),
    'a bad earlierOf': note({ earlierOf: 'notes/../x' }),
  };
  for (const [what, doc] of Object.entries(bad)) assert.equal(ok('notes', doc), false, what);
  // archived and discarded are marks: set, and cleared again with null; the note is never deleted
  assert.ok(ok('notes', note({ archivedAt: '2026-10-20T01:00:00Z', discardedAt: null })));
  assert.ok(ok('notes', note({ archivedAt: null, discardedAt: '2026-10-20T01:00:00Z' })));
  assert.ok(ok('notes', note({ earlierOf: 'n-20261016-150000-other', course: null })));
});

test('B-401: sessions gain note (notes/<id>); talk lines gain thread and talk/<date> a closed mark', () => {
  const db = load();
  const s = db.sessions[0];
  assert.ok(ok('sessions', { ...s, note: `notes/${NOTE_ID}` }));
  for (const v of [NOTE_ID, 'notes/', 'journal/j-sample', 'notes/n-x/y'])
    assert.equal(ok('sessions', { ...s, note: v }), false, v);
  const t = db.talk.find(d => d.id !== 'memory');
  const [k, m] = Object.entries(t.messages)[0];
  const threaded = { ...t, messages: { ...t.messages, [k]: { ...m, thread: 'th-20261016-140000' } } };
  assert.ok(ok('talk', threaded));
  assert.ok(ok('talk', { ...threaded, closed: { 'th-20261016-140000': '2026-10-16T15:00:00Z' } }));
  assert.equal(ok('talk', { ...t, closed: { 'not-a-thread': '2026-10-16T15:00:00Z' } }), false);
  assert.equal(ok('talk', { ...t, closed: { 'th-1': 'yesterday' } }), false);
  assert.equal(ok('talk', { ...t, messages: { ...t.messages, [k]: { ...m, thread: 'x' } } }), false);
  // closed is a mark, so closing a thread is no change to a Fact's own fields; note is a session's own field
  assert.ok(!factFields(spec, 'talk').includes('closed'));
  assert.ok(factFields(spec, 'sessions').includes('note'));
});

test('B-401: links: a session names its note; a run that did not read notes does not judge the link', () => {
  const db = load();
  const s = { ...db.sessions[0], note: `notes/${NOTE_ID}` };
  const hit = linked(db, s, 'sessions.note', spec);
  assert.equal(hit.found.length, 1);
  assert.equal(hit.found[0].doc.id, NOTE_ID);
  assert.deepEqual(linked(db, { ...s, note: 'notes/n-made-up-missing' }, 'sessions.note', spec).missing, [
    'notes/n-made-up-missing',
  ]);
  // a pull without notes (every pipeline but evening-mac's backup): nothing dangles
  const pulled = { ...db, sessions: [s, ...db.sessions.slice(1)] };
  delete pulled.notes;
  assert.deepEqual(linked(pulled, s, 'sessions.note', spec).missing, []);
  assert.deepEqual(
    linkIssues(pulled, spec).filter(i => i.ref.startsWith('sessions/')),
    []
  );
  // with notes read, an earlier note naming one that is not there is a note (optional), never an error
  const withNotes = { ...db, notes: [note({ id: 'n-20261016-150000-earlier', earlierOf: 'n-20261016-150000-gone' })] };
  const issues = linkIssues(withNotes, spec).filter(i => i.ref.startsWith('notes/'));
  assert.deepEqual(
    issues.map(i => [i.severity, i.ref]),
    [['info', 'notes/n-20261016-150000-earlier']]
  );
});

test('B-401: lint and rebuild skip notes as they skip the journal: an edited, archived or even malformed note is no error', () => {
  const db = load();
  const green = lintRecord(db, spec, validate, { date: '2026-10-17' });
  const errors = r => r.issues.filter(i => i.severity === 'error');
  assert.deepEqual(errors(green), []);
  // state/current never hashes a note, so nothing in it can come back as fact-changed
  const state = db.state.find(d => d.id === 'current');
  assert.ok(!Object.keys(state.factHashes).some(k => k.startsWith('notes/')));
  assert.ok(!('notes' in state.factFields));
  const n = db.notes.find(d => d.id === NOTE_ID);
  Object.assign(n, {
    title: 'A made-up new title',
    blocks: [{ type: 'p', runs: [{ text: 'Made-up edited text' }] }],
    editedAt: '2026-10-17T02:00:00Z',
    archivedAt: '2026-10-17T02:00:00Z',
    createdAt: '2026-10-15T00:00:00Z', // even its write-once field
  });
  db.notes.push({ id: 'n-made-up-bad', html: '<p>never</p>' });
  const after = lintRecord(db, spec, validate, { date: '2026-10-17' });
  assert.deepEqual(errors(after), []);
  assert.ok(
    !after.issues.some(i => /^notes/.test(i.ref)),
    JSON.stringify(after.issues.filter(i => /^notes/.test(i.ref)))
  );
  // rebuild and asOf never read them: the same Derived documents with or without notes
  const without = load();
  delete without.notes;
  assert.deepEqual(
    rebuild(db, spec).map(r => [r.ref, r.status]),
    rebuild(without, spec).map(r => [r.ref, r.status])
  );
  assert.ok(!('notes' in asOf(db, '2026-10-17T12:00:00Z', spec).db));
});

test('B-401: no pipeline reads notes but evening-mac, and that only for its backup and mirror (a named read)', () => {
  for (const [name, p] of Object.entries(spec.pipelines)) {
    if (name.startsWith('_')) continue;
    const reads = (p.reads || []).filter(r => r.collection === 'notes');
    if (name === 'evening-mac') assert.deepEqual(reads, [{ collection: 'notes', for: 'mac-files' }]);
    else assert.deepEqual(reads, [], `${name} reads no notes`);
  }
  // a read with no step named is refused, as the journal's is
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b401-pull-'));
  try {
    const DEF = spec.pipelines['evening-cloud'];
    const bad = {
      ...spec,
      pipelines: { ...spec.pipelines, 'evening-cloud': { ...DEF, reads: [...DEF.reads, { collection: 'notes' }] } },
    };
    fs.writeFileSync(
      path.join(dir, 'run.json'),
      JSON.stringify({ pipeline: 'evening-cloud', id: 'evening-cloud-made-up', url: 'https://example.invalid' })
    );
    assert.throws(
      () => RUN.pull({ spec: bad, dir, at: '2026-10-17T01:15:00Z' }),
      /notes are read only for a step that names it/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('B-401: the mirror writes notes/<id>.md from the blocks, escaped, archived and discarded marked, none left out', () => {
  const n = note({
    archivedAt: '2026-10-18T01:00:00Z',
    blocks: [
      { type: 'h1', runs: [{ text: 'Made-up heading' }] },
      {
        type: 'p',
        runs: [{ text: 'Plain, ' }, { text: 'bold ', b: true }, { text: '<script>x</script> *not* #markup' }],
      },
      { type: 'ul', runs: [{ text: 'one' }] },
      { type: 'ul', indent: 1, runs: [{ text: 'two', i: true }] },
      { type: 'ol', runs: [{ text: 'first' }] },
      { type: 'ol', runs: [{ text: 'second', s: true }] },
      { type: 'todo', checked: true, runs: [{ text: 'done', u: true }] },
      { type: 'todo', runs: [{ text: 'a link', href: 'https://example.com/x' }] },
      { type: 'h2', runs: [{ text: 'Next' }] },
    ],
  });
  const gone = note({
    id: 'n-20261016-160000-discarded',
    discardedAt: '2026-10-18T01:00:00Z',
    title: 'Made-up discarded',
    blocks: [{ type: 'p', runs: [{ text: 'Made-up body' }] }],
  });
  const files = EV.toMarkdown({ notes: [n, gone] }, { date: '2026-10-18' });
  const f = files.find(x => x.path === `notes/${NOTE_ID}.md`);
  assert.ok(f, files.map(x => x.path).join(', '));
  assert.equal(
    f.content,
    [
      '---',
      'course: "NUR 112"',
      'label: "Lecture 1"',
      'created: "2026-10-16T15:00:00Z"',
      'edited: "2026-10-16T15:20:00Z"',
      'archived: "2026-10-18T01:00:00Z"',
      '---',
      '',
      '# Made-up heading',
      '',
      'Plain, **bold** \\<script\\>x\\</script\\> \\*not\\* \\#markup',
      '',
      '- one',
      '  - *two*',
      '',
      '1. first',
      '2. ~~second~~',
      '',
      '- [x] done',
      '- [ ] [a link](https://example.com/x)',
      '',
      '## Next',
      '',
    ].join('\n')
  );
  assert.ok(!/<script>/.test(f.content), 'stored text never becomes HTML');
  const g = files.find(x => x.path === 'notes/n-20261016-160000-discarded.md');
  assert.match(g.content, /discarded: "2026-10-18T01:00:00Z"/);
  assert.match(g.content, /\n# Made-up discarded\n/, 'its title heads a body with no heading of its own');
  assert.match(files.find(x => x.path === 'index.md').content, /- Notes: 2/);
  // a record with no notes read writes no notes line (the cloud runs never read them)
  assert.doesNotMatch(EV.toMarkdown({}, {}).find(x => x.path === 'index.md').content, /Notes/);
});

test('B-401: backups carry notes: the Mac backup, the D1 export shape, mac-files on a Worker run and its mirror', () => {
  const db = load();
  const b = macBackup(db, { now: '2026-10-18T01:00:00Z', label: 'made-up', release: null });
  assert.equal(b.counts.notes, db.notes.length);
  assert.ok(b.hashes.notes);
  const rows = Object.entries(db)
    .filter(([c]) => c !== 'system')
    .flatMap(([c, docs]) => docs.map(d => ({ c, id: d.id, data: JSON.stringify(EV.docData(d)) })));
  const d1 = backupOf(rows, { at: '2026-10-18T01:00:00Z', label: 'made-up', release: null });
  assert.deepEqual(d1.collections.notes, manifestSync(rows.filter(r => r.c === 'notes')).notes);
  assert.equal(d1.collections.notes.count, db.notes.length);
  // mac-files on a Worker run: the backup is the whole D1 dump (notes in it) and Sunday's mirror writes each note
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b401-mac-'));
  try {
    fs.mkdirSync(path.join(dir, 'd1'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'd1', 'rows.json'), JSON.stringify(rows));
    const r = CODE_STEPS['mac-files'](
      db,
      {
        record: 'staging',
        target: 'worker',
        dir,
        outputs: path.join(dir, 'out'),
        runId: 'evening-mac-made-up',
        pipeline: 'evening-mac',
        date: '2026-10-18', // a Sunday
        now: '2026-10-18T01:00:00Z',
      },
      spec
    );
    assert.ok(!r.problems, JSON.stringify(r.problems));
    const files = r.device.flatMap(c => c.args.files);
    const backupFile = files.find(f => /backup\/E\.V\.-v4-backup-sunday\.json$/.test(f.devicePath));
    const saved = JSON.parse(fs.readFileSync(backupFile.stagedPath, 'utf8'));
    assert.equal(saved.collections.notes.count, db.notes.length);
    assert.equal(saved.docs.filter(d => d.c === 'notes').length, db.notes.length);
    assert.ok(
      files.some(f => f.devicePath.endsWith(`mirror-v4/notes/${NOTE_ID}.md`)),
      'the mirror writes the note'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('B-401: pwa-copy and the app carry notes; the synthetic record holds made-up notes that validate', () => {
  assert.ok(recordCollections(spec).includes('notes'), 'the one-time copy exports notes');
  assert.ok(!LEFT_OUT.includes('notes'));
  const seeded = seedRecord(new Date('2026-10-23T12:00:00Z'));
  assert.ok(Object.keys(seeded.notes || {}).length >= 3, 'the app is seeded with made-up notes');
  const rec = synthetic();
  const notes = Object.entries(rec.notes);
  assert.ok(notes.length >= 3);
  for (const [id, doc] of notes) {
    assert.match(id, /^n-\d{8}-\d{6}-[a-z0-9]+$/);
    assert.ok(validate('notes', doc, { id }).ok, id);
  }
  assert.ok(
    notes.some(([, d]) => d.archivedAt),
    'an archived note'
  );
  assert.ok(
    notes.some(([, d]) => d.earlierOf && rec.notes[d.earlierOf]),
    'an earlier version linked to its note (D-326)'
  );
  assert.ok(new Set(notes.map(([, d]) => d.course)).size >= 2, 'notes in both courses');
});
