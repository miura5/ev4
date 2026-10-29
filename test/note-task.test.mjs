// B-520 (UX map F-31, F-45, F-46): a note task on Today has Write, which opens the note it names (or starts one titled
// as the task) in the task's course; New note takes the course picked; an empty new note is never written, so leaving
// it leaves nothing behind (nothing deleted). Made-up notes throughout. The page's side is test/harness/notes.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';
import './core-fixtures.mjs';

const note = (id, title, course, editedAt, more = {}) => ({
  id,
  title,
  course,
  editedAt,
  blocks: [{ type: 'h1', runs: [{ text: title }] }],
  ...more,
});

test('B-520: a note with no words is blank; a title or a line of words is not', () => {
  assert.equal(EV.noteBlank([{ type: 'h1', runs: [] }]), true);
  assert.equal(
    EV.noteBlank([
      { type: 'h1', runs: [{ text: '   ' }] },
      { type: 'p', runs: [] },
    ]),
    true
  );
  assert.equal(EV.noteBlank([]), true);
  assert.equal(
    EV.noteBlank([
      { type: 'h1', runs: [] },
      { type: 'p', runs: [{ text: 'Osteoclasts' }] },
    ]),
    false
  );
  assert.equal(EV.noteBlank([{ type: 'h1', runs: [{ text: 'Bones' }] }]), false);
});

test('B-520 (F-45): a note task finds his note titled as it reads, in its course, newest first; else none', () => {
  const notes = [
    note('n-1', 'Finish the ‘calcium stimulates’ line', 'BIO 201', '2026-10-20T10:00:00Z'),
    note('n-2', 'Finish the calcium stimulates line', 'BIO 201', '2026-10-21T10:00:00Z'),
    note('n-3', 'Finish the calcium stimulates line', 'NUR 112', '2026-10-22T10:00:00Z'),
    note('n-4', 'Finish the calcium stimulates line', 'BIO 201', '2026-10-23T10:00:00Z', { archivedAt: 'x' }),
  ];
  const text = 'Finish the ‘Calcium stimulates’ line';
  assert.equal(EV.noteForTask(notes, { text, course: 'BIO 201' }).id, 'n-2');
  assert.equal(EV.noteForTask(notes, { text, course: 'NUR 112' }).id, 'n-3');
  assert.equal(EV.noteForTask(notes, { text: 'Another line entirely', course: 'BIO 201' }), null);
  assert.equal(EV.noteForTask(notes, { text: '' }), null);
  // a note with no title of its own is matched by its first heading
  assert.equal(
    EV.noteForTask([{ id: 'n-5', course: null, blocks: [{ type: 'h1', runs: [{ text: 'Bone remodeling' }] }] }], {
      text: 'bone remodeling',
      course: 'BIO 201',
    }).id,
    'n-5'
  );
});

test('B-520 (F-46): the editor writes a new note only once it has words, and New note takes the course picked', () => {
  const src = fs.readFileSync(new URL('../page/app/25-notes.js', import.meta.url), 'utf8');
  const at = src.indexOf('function saveNote()');
  const save = src.slice(at, src.indexOf('const theirs = noteElsewhere();', at));
  assert.match(save, /!\(NOTE\.doc && NOTE\.doc\.at\) && !NOTE\.saving && E\.noteBlank\(NOTE\.blocks\)/);
  assert.match(src, /NOTE\.dirty = !!t;/);
  assert.match(src, /NOTE_LIST\.filter !== 'all' \? NOTE_LIST\.filter : defaultCourse\(\)/);
  const today = fs.readFileSync(new URL('../page/app/10-today.js', import.meta.url), 'utf8');
  assert.match(today, /it\.tag === 'NOTES' && !isDone\(it\)/);
  assert.match(today, /btn\('Write', \(\) => writeTask\(it, f\.course\)/);
});
