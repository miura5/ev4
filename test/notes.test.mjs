// B-401 (D-325, D-326, D-328): the notes record. A notes collection written by the page only, its body blocks with
// inline marks (never HTML), archived and discarded as marks; sessions name the note they study and talk lines carry a
// thread with a closed mark. No Derived document hashes or rebuilds from notes, as none does the journal (an edited
// note is no lint error and no fact-changed); runs read them with the rest of the record (D-335); the mirror writes
// notes/<id>.md; backups, pwa-copy and the app's made-up record carry them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import EV from '../core/evcore.mjs';
import * as RUN from '../core/run.mjs';
import { readExport, loadValidator, loadSchemas, PAGE_ONLY } from '../core/schemas.mjs';
import { lintRecord } from '../core/lint.mjs';
import { rebuild, asOf, factFields } from '../core/derive.mjs';
import { linked, linkIssues, linkProblems } from '../core/links.mjs';
import { macBackup, CODE_STEPS } from '../core/steps.mjs';
import { backupOf, manifestSync } from '../core/d1backup.mjs';
import { registryProblems, pageSpecFor } from '../tools/build.mjs';
import * as V from '../core/validate.mjs';
import worker from '../pwa/worker.js';
import { DOCUMENT_BYTES } from '../pwa/notes.js';
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
/** Blocks that fit the schema (20 runs of 20,000 characters) but hold more than capacity.documentBytes. */
const bigBlocks = () => Array.from({ length: 20 }, () => ({ type: 'p', runs: [{ text: 'm'.repeat(20000) }] }));
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

test('B-401: lint and rebuild take no note as a Fact, as with the journal: an edited or archived note is no error', () => {
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

test('B-401 review: lint still holds a note a run read to its schema and size, never as fact-changed', () => {
  const db = load();
  const codes = r =>
    r.issues
      .filter(i => /^notes/.test(i.ref))
      .map(i => [i.severity, i.code, i.ref])
      .sort((a, b) => a[2].localeCompare(b[2]));
  db.notes.push({ ...note(), id: 'n-made-up-html', html: '<p>never</p>' });
  db.notes.push({
    ...note(),
    id: 'n-made-up-js',
    blocks: [{ type: 'p', runs: [{ text: 'x', href: 'javascript:alert(1)' }] }],
  });
  db.notes.push({ ...note(), id: 'n-made-up-big', blocks: bigBlocks() });
  assert.deepEqual(codes(lintRecord(db, spec, validate, { date: '2026-10-17' })), [
    ['error', 'over-budget', 'notes/n-made-up-big'],
    ['error', 'invalid', 'notes/n-made-up-html'],
    ['error', 'invalid', 'notes/n-made-up-js'],
  ]);
  // with no notes pulled (a run whose reads leave them out), nothing about notes is judged
  delete db.notes;
  assert.deepEqual(codes(lintRecord(db, spec, validate, { date: '2026-10-17' })), []);
});

test('D-335: evening-cloud and evening-mac pull notes and the journal with the rest of the record', () => {
  for (const name of ['evening-cloud', 'evening-mac'])
    for (const c of ['notes', 'journal'])
      assert.deepEqual(
        spec.pipelines[name].reads.filter(r => r.collection === c),
        [{ collection: c }],
        `${name} reads ${c} with no step named`
      );
  // the pull prints a list of each, as of any collection (the named read of D-113 is ended)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b401-pull-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'run.json'),
      JSON.stringify({
        pipeline: 'evening-cloud',
        id: 'evening-cloud-made-up',
        url: 'https://example.invalid',
        calls: [],
      })
    );
    const calls = RUN.pull({ spec, dir, at: '2026-10-17T01:15:00Z' });
    for (const c of ['notes', 'journal'])
      assert.ok(
        calls.some(x => x.args.collection === c && x.args.action === 'list'),
        c
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

test('B-401 second review: a line break inside a title or a run, \\r or \\n, never opens a block in the mirror', () => {
  const n = note({
    title: 'Title\n\n---\n\n- list\n\n    code',
    blocks: [
      { type: 'p', runs: [{ text: 'a\r- list\r\r    code' }] },
      { type: 'p', runs: [{ text: 'b\u2028- list' }] },
    ],
  });
  const body = EV.noteMarkdown(n);
  assert.ok(!/\r/.test(body), 'no carriage return survives');
  for (const line of body.split('\n')) assert.ok(!/^(\s*[-+*]\s|\s*\d+[.)]\s|---|\s{4})/.test(line), line);
  assert.match(body, /^# Title --- - list code$/m);
});

test('B-401 review: the mirror escapes what a block opens with, so note text never starts a list, rule, quote or code', () => {
  const p = text => ({ type: 'p', runs: [{ text }] });
  const n = note({
    title: '- made-up title',
    blocks: [
      p('- not a list'),
      p('+ not a list'),
      p('* not a list'),
      p('= not a heading line'),
      p('12. not numbered'),
      p('3) not numbered'),
      p('---'),
      p('***'),
      p('==='),
      p('> not a quote'),
      p('    not code'),
      { type: 'ul', runs: [{ text: '1. not nested' }] },
      { type: 'todo', runs: [{ text: '  - not nested' }] },
      { type: 'p', runs: [{ text: '  ' }, { text: 'bold', b: true }, { text: ' and 2. mid-line stays' }] },
    ],
  });
  const body = EV.noteMarkdown(n);
  assert.equal(
    body,
    [
      '# \\- made-up title',
      '',
      '\\- not a list',
      '',
      '\\+ not a list',
      '',
      '\\* not a list',
      '',
      '\\= not a heading line',
      '',
      '12\\. not numbered',
      '',
      '3\\) not numbered',
      '',
      '\\---',
      '',
      '\\*\\*\\*',
      '',
      '\\===',
      '',
      '\\> not a quote',
      '',
      'not code',
      '',
      '- 1\\. not nested',
      '',
      '- [ ] \\- not nested',
      '',
      '**bold** and 2. mid-line stays',
      '',
    ].join('\n')
  );
  // no line of the body opens a block its text did not ask for (only the mirror's own heading and list markers do)
  for (const line of body.split('\n')) assert.doesNotMatch(line, /^(?:\s|[+=>]|\d+[.)]|---|\*\*\*|\*\s)/, line);
});

// ---------------------------------------------------------------- B-401 review: every notes write is checked whole

const NOTE = () => {
  const { id: _id, ...data } = note();
  return data;
};
const JS_RUN = { blocks: [{ type: 'p', runs: [{ text: 'click', href: 'javascript:alert(1)' }] }] };
const MOVED = { createdAt: '2026-10-01T00:00:00Z' };

/** The page's own write() (page/app/04-model.js), lifted out of the app with an in-memory record behind it. */
function pageWrite() {
  const src = fs.readFileSync(path.join(ROOT, 'page/app/04-model.js'), 'utf8');
  const from = src.indexOf('    async function write(w) {');
  const to = src.indexOf('\n    async function run(', from);
  assert.ok(from > 0 && to > from, 'write() is in 04-model.js');
  const EV_SPEC = pageSpecFor(spec, schemas, { target: 'staging', release: 'test' });
  const store = new Map();
  const db = {
    collection: c => ({
      doc: id => {
        const key = c + '/' + id;
        return {
          get: async () => ({ exists: store.has(key), data: () => structuredClone(store.get(key)) }),
          set: async d => void store.set(key, structuredClone(d)),
          update: async d => void store.set(key, V.mergeUpdate(store.get(key), d)),
        };
      },
    }),
  };
  const make = new Function(
    'READ_ONLY',
    'READ_ONLY_TEXT',
    'WORK',
    'db',
    'validate',
    'window',
    'EV_SPEC',
    'paintSet',
    'unpaint',
    src.slice(from, to) + '\nreturn write;'
  );
  const write = make(
    false,
    '',
    { collect: null },
    db,
    V.makeValidator(EV_SPEC.schemas),
    { EVValidate: V },
    EV_SPEC,
    () => false,
    () => {}
  );
  return { write, store };
}

test('B-401 review: the page refuses a notes update with a script link, a moved createdAt or over documentBytes', async () => {
  const { write, store } = pageWrite();
  const id = NOTE_ID;
  await write({ op: 'set', collection: 'notes', id, data: NOTE() });
  const kept = JSON.stringify(store.get('notes/' + id));
  await write({
    op: 'update',
    collection: 'notes',
    id,
    data: { title: 'A made-up edit', editedAt: '2026-10-17T01:00:00Z' },
  });
  assert.equal(store.get('notes/' + id).title, 'A made-up edit', 'a sound edit is saved');
  const before = JSON.stringify(store.get('notes/' + id));
  assert.notEqual(before, kept);
  await assert.rejects(write({ op: 'update', collection: 'notes', id, data: JS_RUN }), /does not match/);
  await assert.rejects(write({ op: 'update', collection: 'notes', id, data: MOVED }), /createdAt is written once/);
  await assert.rejects(
    write({ op: 'update', collection: 'notes', id, data: { earlierOf: 'n-20261016-150000-other' } }),
    /earlierOf is written once/
  );
  await assert.rejects(write({ op: 'update', collection: 'notes', id, data: { html: '<p>x</p>' } }), /unknown field/);
  await assert.rejects(write({ op: 'update', collection: 'notes', id, data: { blocks: bigBlocks() } }), /bytes/);
  // a set over the note is held to the same write-once identity, and a too-big new note is refused too
  await assert.rejects(write({ op: 'set', collection: 'notes', id, data: { ...NOTE(), ...MOVED } }), /createdAt/);
  await assert.rejects(
    write({ op: 'set', collection: 'notes', id: 'n-made-up-big', data: { ...NOTE(), blocks: bigBlocks() } }),
    /bytes/
  );
  await assert.rejects(write({ op: 'update', collection: 'notes', id: 'n-made-up-none', data: { title: 'x' } }));
  assert.equal(JSON.stringify(store.get('notes/' + id)), before, 'nothing refused reached the record');
  assert.ok(!store.has('notes/n-made-up-big'));
});

/** D1 over node:sqlite (as test/pwa-save.test.mjs), with the app's schema. */
function workerEnv() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(path.join(ROOT, 'pwa/schema.sql'), 'utf8'));
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async () => sql.prepare(q).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...args).changes) } }),
  });
  const TOKEN = 'notes-suite-token-not-a-secret';
  const env = {
    EV_TOKEN: TOKEN,
    DB: { prepare: q => stmt(q), batch: async list => Promise.all(list.map(s => s.all())) },
    ASSETS: { fetch: () => new Response('') },
  };
  const call = async (method, route, body) => {
    const r = await worker.fetch(
      new Request('https://ev.example' + route, {
        method,
        headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env
    );
    return { status: r.status, body: await r.json() };
  };
  const row = id => {
    const r = sql.prepare('SELECT data, v FROM docs WHERE c = ? AND id = ?').get('notes', id);
    return r && { data: JSON.parse(r.data), v: r.v };
  };
  return { call, row };
}

test('B-401 review: the Worker refuses a note that fails the schema, size or write-once check, on a save and in a batch', async () => {
  assert.equal(DOCUMENT_BYTES, spec.capacity.documentBytes, 'pwa/notes.js holds the spec size');
  const { call, row } = workerEnv();
  const id = NOTE_ID;
  const put = (data, v) => call('PUT', `/api/db/notes/${id}` + (v ? '?if_version=' + v : ''), data);
  const batch = w => call('POST', '/api/run/batch', { writes: [w] });
  assert.equal((await put(NOTE())).status, 200);
  // the page's save sends the whole merged document
  for (const bad of [
    { ...NOTE(), ...JS_RUN },
    { ...NOTE(), ...MOVED },
    { ...NOTE(), blocks: bigBlocks() },
  ]) {
    const r = await put(bad, 1);
    assert.equal(r.status, 400, JSON.stringify(r.body).slice(0, 200));
    assert.match(r.body.error, /nothing was written/);
  }
  assert.equal((await put({ ...NOTE(), title: 'A made-up edit' }, 1)).status, 200, 'a sound edit is saved');
  assert.equal(row(id).v, 2);
  // a too-big or malformed new note is refused on create too
  const big = await call('PUT', '/api/db/notes/n-made-up-big', { ...NOTE(), blocks: bigBlocks() });
  assert.equal(big.status, 400);
  // the run API: an update is judged merged into the stored note
  for (const data of [JS_RUN, MOVED, { blocks: bigBlocks() }, { createdAt: { __delete__: true } }, { html: 'x' }]) {
    const r = await batch({ op: 'update', collection: 'notes', doc_id: id, data, if_version: 2 });
    assert.equal(r.status, 400, JSON.stringify(r.body).slice(0, 200));
    assert.equal(r.body.entry, 0);
  }
  const set = await batch({ op: 'set', collection: 'notes', doc_id: id, data: { ...NOTE(), ...MOVED }, if_version: 2 });
  assert.equal(set.status, 400);
  assert.equal(row(id).v, 2, 'nothing refused was written');
  assert.equal(row(id).data.title, 'A made-up edit');
  assert.equal(row('n-made-up-big'), undefined);
  const good = await batch({
    op: 'update',
    collection: 'notes',
    doc_id: id,
    data: { archivedAt: '2026-10-18T01:00:00Z' },
    if_version: 2,
  });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.equal(row(id).data.archivedAt, '2026-10-18T01:00:00Z');
});
