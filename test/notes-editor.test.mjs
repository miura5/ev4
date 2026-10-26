// B-402 (D-325): the Notes editor's block model (core/notes.mjs): a round trip through the editor's tree, the typing
// shortcuts, Enter and Backspace, marks, and a paste read into blocks with no HTML and no script getting through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import E from '../core/evcore.mjs';
import { loadValidator } from '../core/schemas.mjs';
import { makeNotes } from '../core/notes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (text, m = {}) => ({ text, ...m });

// a DOM-like tree, as the page's document.createElement would make it
const h = (tag, attrs, kids) => ({
  nodeType: 1,
  nodeName: tag.toUpperCase(),
  childNodes: kids,
  getAttribute: k => (k in attrs ? attrs[k] : null),
});
const t = text => ({ nodeType: 3, nodeName: '#text', nodeValue: text, childNodes: [] });
const tree = blocks => ({
  nodeType: 1,
  nodeName: 'DIV',
  childNodes: E.noteRender(blocks, h, t),
  getAttribute: () => null,
});
/** Every string the rendered tree holds as markup: tag names and attribute values (text nodes aside). */
const tags = n => (n.nodeType === 1 ? [n.nodeName, ...n.childNodes.flatMap(tags)] : []);

const SAMPLE = [
  { type: 'h1', runs: [r('Fluids and electrolytes')] },
  {
    type: 'p',
    runs: [r('Two of them, '), r('bold', { b: true }), r(' and '), r('both', { b: true, i: true, u: true })],
  },
  { type: 'h2', runs: [r('Potassium')] },
  { type: 'ul', runs: [r('Normal range: '), r('3.5 to 5.0', { s: true })] },
  { type: 'ul', indent: 1, runs: [r('nested item')] },
  { type: 'ol', runs: [r('first')] },
  { type: 'ol', runs: [r('second')] },
  { type: 'todo', checked: true, runs: [r('done thing')] },
  { type: 'todo', checked: false, runs: [r('open thing')] },
  { type: 'h3', runs: [r('A link')] },
  { type: 'p', runs: [r('see '), r('the page', { href: 'https://example.com/a?b=1' }), r(' after')] },
  { type: 'p', runs: [] },
];

test('B-402: blocks round-trip through the editor tree unchanged', () => {
  const blocks = E.noteBlocks(SAMPLE);
  const back = E.noteFromTree(tree(blocks)).blocks;
  assert.deepEqual(back, blocks);
  // and the stored shape fits notes.schema.json
  const v = loadValidator();
  const doc = E.noteDoc(null, { blocks: back, course: 'NUR 112', at: '2026-10-26T15:00:00.000Z' });
  const res = v('notes', doc, { id: 'n-20261026-150000-abcdefghijkl' });
  assert.ok(res.ok, JSON.stringify(res.errors));
  assert.equal(doc.title, 'Fluids and electrolytes');
  assert.equal(doc.createdAt, doc.at);
});

test('B-402: the editor tree is made only of the editor’s own tags; text never becomes markup', () => {
  const evil = [{ type: 'p', runs: [r('<script>alert(1)</script><img src=x onerror=alert(2)>')] }];
  const tr = tree(evil);
  assert.deepEqual([...new Set(tags(tr))].sort(), ['DIV', 'P']);
  assert.equal(E.noteFromTree(tr).blocks[0].runs[0].text, evil[0].runs[0].text);
  // a stored href that is not http(s) is never rendered as a link
  const bad = E.noteRender([{ type: 'p', runs: [{ text: 'x', href: 'javascript:alert(1)' }] }], h, t);
  assert.deepEqual(tags(bad[0]), ['P']);
});

test('B-402: the typing shortcuts', () => {
  const p = text => ({ type: 'p', runs: [r(text)] });
  const cases = [
    ['# Title', 2, 'h1', 'Title'],
    ['## Sub', 3, 'h2', 'Sub'],
    ['### Small', 4, 'h3', 'Small'],
    ['- item', 2, 'ul', 'item'],
    ['* item', 2, 'ul', 'item'],
    ['1. step', 3, 'ol', 'step'],
    ['[] task', 3, 'todo', 'task'],
    ['[ ] task', 4, 'todo', 'task'],
  ];
  for (const [text, o, type, rest] of cases) {
    const s = E.noteShortcut(p(text), o);
    assert.ok(s, text);
    assert.equal(s.block.type, type, text);
    assert.equal(E.noteText(s.block), rest, text);
    assert.equal(s.o, 0);
    if (type === 'todo') assert.equal(s.block.checked, false);
  }
  assert.equal(E.noteShortcut(p('[x] done'), 4).block.checked, true);
  // only right after the marker's space, only in a paragraph, only at the line's start
  assert.equal(E.noteShortcut(p('# Title'), 5), null);
  assert.equal(E.noteShortcut(p('a # b'), 4), null);
  assert.equal(E.noteShortcut({ type: 'h2', runs: [r('# x')] }, 2), null);
  assert.equal(E.noteShortcut(p('#Title'), 1), null);
  // the text after the marker keeps its marks
  const marked = E.noteShortcut({ type: 'p', runs: [r('- '), r('bold', { b: true })] }, 2);
  assert.deepEqual(marked.block.runs, [r('bold', { b: true })]);
});

test('B-402: Enter splits and continues a list; an empty item ends it; Backspace at a start steps back', () => {
  const blocks = E.noteBlocks([{ type: 'ul', runs: [r('ab', { b: true }), r('cd')] }]);
  const e1 = E.noteEnter(blocks, { a: { b: 0, o: 1 }, f: { b: 0, o: 1 } });
  assert.deepEqual(e1.blocks, [
    { type: 'ul', runs: [r('a', { b: true })] },
    { type: 'ul', runs: [r('b', { b: true }), r('cd')] },
  ]);
  assert.deepEqual(e1.pos, { b: 1, o: 0 });
  const empty = E.noteEnter(E.noteBlocks([{ type: 'todo', checked: true, runs: [] }]), {
    a: { b: 0, o: 0 },
    f: { b: 0, o: 0 },
  });
  assert.deepEqual(empty.blocks, [{ type: 'p', runs: [] }]);
  const head = E.noteEnter(E.noteBlocks([{ type: 'h1', runs: [r('Title')] }]), {
    a: { b: 0, o: 5 },
    f: { b: 0, o: 5 },
  });
  assert.deepEqual(
    head.blocks.map(b => b.type),
    ['h1', 'p']
  );
  const todo = E.noteEnter(E.noteBlocks([{ type: 'todo', checked: true, runs: [r('x')] }]), {
    a: { b: 0, o: 1 },
    f: { b: 0, o: 1 },
  });
  assert.deepEqual(todo.blocks[1], { type: 'todo', runs: [], checked: false });

  const two = E.noteBlocks([
    { type: 'p', runs: [r('one')] },
    { type: 'ul', indent: 1, runs: [r('two')] },
  ]);
  let b = E.noteBackspaceStart(two, 1);
  assert.deepEqual(b.blocks[1], { type: 'ul', runs: [r('two')] }); // outdent first
  b = E.noteBackspaceStart(b.blocks, 1);
  assert.deepEqual(b.blocks[1], { type: 'p', runs: [r('two')] }); // then a paragraph
  b = E.noteBackspaceStart(b.blocks, 1);
  assert.deepEqual(b.blocks, [{ type: 'p', runs: [r('onetwo')] }]); // then joins the line above
  assert.deepEqual(b.pos, { b: 0, o: 3 });
  assert.equal(E.noteBackspaceStart(b.blocks, 0), null);
});

test('B-402: marks toggle across a selection, and a multi-block selection deletes into one line', () => {
  const blocks = E.noteBlocks([
    { type: 'p', runs: [r('hello world')] },
    { type: 'p', runs: [r('second')] },
  ]);
  const sel = { a: { b: 0, o: 6 }, f: { b: 1, o: 3 } };
  const on = E.noteSetMark(blocks, sel, 'b');
  assert.deepEqual(on[0].runs, [r('hello '), r('world', { b: true })]);
  assert.deepEqual(on[1].runs, [r('sec', { b: true }), r('ond')]);
  assert.ok(E.noteHasMark(on, sel, 'b'));
  assert.deepEqual(E.noteSetMark(on, sel, 'b'), blocks); // pressed again: off
  assert.equal(E.noteSetMark(blocks, sel, 'href', 'javascript:alert(1)'), null);
  const linked = E.noteSetMark(blocks, { a: { b: 0, o: 0 }, f: { b: 0, o: 5 } }, 'href', 'https://example.com');
  assert.deepEqual(linked[0].runs[0], r('hello', { href: 'https://example.com' }));
  const d = E.noteDelete(blocks, { a: { b: 1, o: 3 }, f: { b: 0, o: 5 } });
  assert.deepEqual(d.blocks, [{ type: 'p', runs: [r('helloond')] }]);
  assert.deepEqual(d.pos, { b: 0, o: 5 });
  const typed = E.noteInsertText(blocks, { a: { b: 0, o: 5 }, f: { b: 0, o: 5 } }, '!', { b: true });
  assert.deepEqual(typed.blocks[0].runs, [r('hello'), r('!', { b: true }), r(' world')]);
});

test('B-402: a paste is stripped of HTML and script: text, blocks, lists and marks only', () => {
  const html =
    '<html><head><style>p{color:red}</style><title>x</title><script>alert(1)</script></head><body>' +
    '<!--StartFragment--><h1 onclick="alert(2)">Heading</h1>' +
    '<p>Plain <b>bold</b> <span style="font-style:italic;text-decoration:underline">styled</span>' +
    '<script>document.cookie</script><img src=x onerror="alert(3)"><iframe src="https://evil.example"></iframe>' +
    '<a href="javascript:alert(4)">bad link</a> <a href="https://ok.example/x">good link</a></p>' +
    '<ul><li>one<li>two<ul><li>deeper</li></ul></ul><ol><li>first</li></ol>' +
    '<ul class="contains-task-list"><li><input type="checkbox" checked> ticked</li></ul>' +
    '<h5>Small &amp; tidy &lt;b&gt;</h5><table><tr><td>a</td><td>b</td></tr></table>' +
    '<svg><text>svg text</text></svg><template><p>hidden</p></template><!--EndFragment--></body></html>';
  const blocks = E.notePaste({ html, text: 'ignored' });
  assert.deepEqual(blocks, [
    { type: 'h1', runs: [r('Heading')] },
    {
      type: 'p',
      runs: [
        r('Plain '),
        r('bold', { b: true }),
        r(' '),
        r('styled', { i: true, u: true }),
        r('bad link '),
        r('good link', { href: 'https://ok.example/x' }),
      ],
    },
    { type: 'ul', runs: [r('one')] },
    { type: 'ul', runs: [r('two')] },
    { type: 'ul', indent: 1, runs: [r('deeper')] },
    { type: 'ol', runs: [r('first')] },
    { type: 'todo', checked: true, runs: [r('ticked')] },
    { type: 'h3', runs: [r('Small & tidy <b>')] },
    { type: 'p', runs: [r('ab')] },
  ]);
  const all = JSON.stringify(blocks);
  for (const bad of [
    'alert',
    'script',
    'cookie',
    'onerror',
    'iframe',
    'evil',
    'javascript',
    'svg text',
    'hidden',
    'color:red',
  ])
    assert.ok(!all.includes(bad), bad);
  // an unclosed script swallows the rest rather than leaking it
  assert.deepEqual(E.notePaste({ html: '<p>ok</p><script>alert(1)' }), [{ type: 'p', runs: [r('ok')] }]);
  // Google Docs' wrapper <b style="font-weight:normal"> is not bold
  assert.deepEqual(E.notePaste({ html: '<b style="font-weight:normal"><span>plain</span></b>' }), [
    { type: 'p', runs: [r('plain')] },
  ]);
  // plain text: a line a block, with the typing shortcuts at each line's start
  assert.deepEqual(E.notePaste({ text: '# Title\n- a\n[] b\nplain <i>not markup</i>\n' }), [
    { type: 'h1', runs: [r('Title')] },
    { type: 'ul', runs: [r('a')] },
    { type: 'todo', checked: false, runs: [r('b')] },
    { type: 'p', runs: [r('plain <i>not markup</i>')] },
  ]);
  // E.V.'s own copy comes back as stored, its marks checked again
  assert.deepEqual(
    E.notePaste({ json: JSON.stringify([{ type: 'h2', runs: [{ text: 'x', href: 'data:text/html,hi' }] }]) }),
    [{ type: 'h2', runs: [r('x')] }]
  );
});

test('B-402: a paste lands at the caret: its first line joins the line, the rest follow', () => {
  const blocks = E.noteBlocks([{ type: 'p', runs: [r('startend')] }]);
  const at = { a: { b: 0, o: 5 }, f: { b: 0, o: 5 } };
  const one = E.noteInsertBlocks(blocks, at, [{ type: 'p', runs: [r('-mid-', { b: true })] }]);
  assert.deepEqual(one.blocks, [{ type: 'p', runs: [r('start'), r('-mid-', { b: true }), r('end')] }]);
  assert.deepEqual(one.pos, { b: 0, o: 10 });
  const many = E.noteInsertBlocks(blocks, at, [
    { type: 'p', runs: [r('A')] },
    { type: 'ul', runs: [r('B')] },
    { type: 'p', runs: [r('C')] },
  ]);
  assert.deepEqual(many.blocks, [
    { type: 'p', runs: [r('startA')] },
    { type: 'ul', runs: [r('B')] },
    { type: 'p', runs: [r('Cend')] },
  ]);
  assert.deepEqual(many.pos, { b: 2, o: 1 });
});

test('B-402: a new note’s id is fresh every time and fits the key', () => {
  const at = '2026-10-26T15:04:05.123Z';
  const ids = new Set();
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 2000; i++) {
    const rnd = Array.from({ length: 16 }, () => A[Math.floor(Math.random() * 62)]).join('');
    ids.add(E.newNoteId(at, rnd));
  }
  assert.equal(ids.size, 2000);
  for (const id of ids) {
    assert.match(id, /^n-20261026-150405-[A-Za-z0-9]{16}$/);
    assert.ok(E.noteIdOk(id));
    assert.match(id, /^n-[A-Za-z0-9-]{1,120}$/); // the schema's earlierOf pattern takes it
  }
  assert.throws(() => E.newNoteId(at, 'short'));
  // the page draws its random part from crypto
  const part = fs.readFileSync(path.join(ROOT, 'page/app/25-notes.js'), 'utf8');
  assert.match(part, /crypto\.getRandomValues/);
  assert.match(part, /E\.newNoteId\(at, noteRandom\(\)\)/);
});

test('B-402: the page saves only through write(), and its size cap is spec.capacity.documentBytes', () => {
  const part = fs.readFileSync(path.join(ROOT, 'page/app/25-notes.js'), 'utf8');
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
  assert.match(part, /const NOTE_BYTES = \(EV_SPEC\.capacity \|\| \{\}\)\.documentBytes \|\| (\d+);/);
  assert.equal(Number(part.match(/documentBytes \|\| (\d+);/)[1]), spec.capacity.documentBytes);
  assert.ok(!/\binnerHTML\b|insertAdjacentHTML|outerHTML|execCommand|document\.write/.test(part));
  // no write around write(); B-404 reads the note as the record holds it after a 409 (noteInRecord), and only reads
  assert.ok(
    !/db\.collection\([^)]*\)\s*\.doc\([^)]*\)\s*\.(set|update)\b|db\.collection\([^)]*\)\s*\.add\b|\bref\.(set|update)\b/.test(
      part
    )
  );
  assert.equal((part.match(/db\.collection\(/g) || []).length, 1);
  assert.match(part, /db\.collection\('notes'\)\.doc\(id\)\.get\(\)/);
  assert.match(part, /write\(\{ op: 'set', collection: 'notes', id, data: doc \}\)/);
  assert.ok(spec.ui.page.subscribe.some(s => s.collection === 'notes' && !s.windowDays));
});

test('B-402: a saved note keeps its identity and marks; the title follows the first heading', () => {
  const prev = {
    schema: 1,
    writer: 'page',
    at: '2026-10-20T10:00:00Z',
    source: 'E.V. Home',
    createdAt: '2026-10-20T10:00:00Z',
    title: 'Old',
    course: 'BIO 201',
    label: 'Lecture 3',
    blocks: [],
    archivedAt: null,
    earlierOf: 'n-20261019-100000-abcdefghijkl',
  };
  const doc = E.noteDoc(prev, {
    blocks: [
      { type: 'p', runs: [r('x')] },
      { type: 'h2', runs: [r('  Renal   system ')] },
    ],
    at: '2026-10-26T10:00:00Z',
  });
  assert.equal(doc.createdAt, prev.createdAt);
  assert.equal(doc.course, 'BIO 201');
  assert.equal(doc.label, 'Lecture 3');
  assert.equal(doc.earlierOf, prev.earlierOf);
  assert.equal(doc.archivedAt, null);
  // B-404 (D-326): a second note (earlierOf set) is titled '<title> (earlier)'; any other note follows its heading
  assert.equal(doc.title, 'Renal system (earlier)');
  assert.equal(E.noteDoc({ ...prev, earlierOf: undefined }, { blocks: doc.blocks, at: doc.at }).title, 'Renal system');
  assert.equal(doc.editedAt, '2026-10-26T10:00:00Z');
  assert.ok(loadValidator()('notes', doc, { id: 'n-20261020-100000-abcdefghijkl' }).ok);
});

test('B-402: the note model adds names to E.V. core and shadows none', () => {
  const others = fs
    .readdirSync(path.join(ROOT, 'core'))
    .filter(f => f.endsWith('.mjs') && f !== 'notes.mjs')
    .map(f => fs.readFileSync(path.join(ROOT, 'core', f), 'utf8'))
    .join('\n');
  const mine = Object.keys(makeNotes());
  assert.deepEqual(
    mine.filter(k => new RegExp('\\b' + k + '\\b').test(others)),
    []
  );
  for (const k of mine) assert.equal(typeof E[k], typeof makeNotes()[k], k);
});

// ---- B-402's review gaps: nothing pasted is silently dropped; a change past a limit is refused whole, and a stale
// save is never retried over the other device's version (D-326)
const textOf = blocks => blocks.map(E.noteText).join('\n');
const EDITOR = fs.readFileSync(path.join(ROOT, 'page/app/25-notes.js'), 'utf8');

test('B-402 review: a 5,000-line paste keeps every line in the model, and the editor refuses it whole', () => {
  const lines = Array.from({ length: 5000 }, (_, i) => 'line ' + i);
  const pasted = E.notePaste({ text: lines.join('\n') });
  assert.equal(pasted.length, 5000);
  const start = [{ type: 'p', runs: [r('before')] }];
  const res = E.noteInsertBlocks(start, { a: { b: 0, o: 6 }, f: { b: 0, o: 6 } }, pasted);
  assert.equal(res.blocks.length, 5000);
  assert.equal(textOf(res.blocks), 'before' + lines.join('\n'));
  assert.match(E.noteFits(res.blocks), /4,000 lines/);
  assert.equal(E.noteFits(start), '');
  // apply() asks noteFits before it changes anything, and the note is left as it was
  const apply = EDITOR.slice(
    EDITOR.indexOf('function apply('),
    EDITOR.indexOf('remember(kind, sel)', EDITOR.indexOf('function apply('))
  );
  assert.match(apply, /E\.noteFits\(r\.blocks\)/);
  assert.match(apply, /return;\s*}\s*$/);
});

test('B-402 review: a paragraph of 450 formatted spans keeps all its text, split into following lines', () => {
  const spans = Array.from({ length: 450 }, (_, i) => (i % 2 ? '<b>w' + i + ' </b>' : '<i>w' + i + ' </i>')).join('');
  const want = Array.from({ length: 450 }, (_, i) => 'w' + i + ' ')
    .join('')
    .trimEnd();
  const blocks = E.notePaste({ html: '<p>' + spans + '</p>', text: want });
  assert.equal(blocks.map(E.noteText).join(''), want);
  assert.ok(blocks.length >= 2 && blocks.every(b => b.runs.length <= 400), blocks.map(b => b.runs.length).join(','));
  assert.equal(E.noteFits(blocks), '');
  // noteRuns itself never folds or cuts: 450 runs stay 450, and a run past 20000 characters goes on as more runs
  const many = E.noteRuns(Array.from({ length: 450 }, (_, i) => r('x' + i, i % 2 ? { b: true } : {})));
  assert.equal(many.length, 450);
  const long = E.noteRuns([r('y'.repeat(45000), { i: true })]);
  assert.equal(long.map(x => x.text).join('').length, 45000);
  assert.ok(long.every(x => x.i && x.text.length <= 20000));
  // a block past 400 runs in the editor is refused, not folded
  assert.match(E.noteFits([{ type: 'p', runs: many }]), /400/);
  // markup too big to read whole gives way to the plain text, all of it
  const huge = '<p>' + 'a'.repeat(2000001) + '</p>';
  assert.equal(E.noteText(E.notePaste({ html: huge, text: 'z'.repeat(10) })[0]), 'z'.repeat(10));
});

test('B-402 review, B-404, D-332: a change past the size cap is refused in apply() unless it shrinks the note', () => {
  const apply = EDITOR.slice(
    EDITOR.indexOf('function apply('),
    EDITOR.indexOf('remember(kind, sel)', EDITOR.indexOf('function apply('))
  );
  assert.match(apply, /noteTooBig\(r\.blocks\)/);
  // D-332: a note already past a limit can be cut down: only a change that is past a limit and no smaller is refused
  assert.match(apply, /if \(why && !noteShrinks\(r\.blocks\)\)/);
  // B-404 review: the cap less the room a second note needs ('<title> (earlier)' and its earlierOf, D-326)
  assert.match(EDITOR, /function noteTooBig\(blocks\)[\s\S]*?bytes <= NOTE_BYTES - NOTE_ROOM/);
  assert.match(EDITOR, /const noteShrinks = blocks =>[\s\S]*?noteBytes\(blocks\) <= noteBytes\(NOTE\.blocks\)/);
});

test('B-404 (D-326): a stale save is never retried over the other version: both are kept, and the size check is noteTooBig', () => {
  const save = EDITOR.slice(EDITOR.indexOf('    function saveNote('), EDITOR.indexOf('async function flushNote('));
  // the save-time size check is noteTooBig, not a copy of it
  assert.match(save, /const big = noteTooBig\(NOTE\.blocks\);/);
  assert.doesNotMatch(save, /new Blob/);
  // a version from elsewhere is never written over: the save becomes keepBoth
  assert.match(save, /const theirs = noteElsewhere\(\);\s*if \(theirs\) return keepBoth\(theirs\);/);
  const conflict = save.slice(save.indexOf("e.code === 'conflict'"), save.indexOf('} else if (NOTE.open === id)'));
  assert.match(conflict, /NOTE\.dirty = true/);
  assert.doesNotMatch(conflict, /setTimeout|saveNote\(/);
  assert.match(save, /await keepBoth\(theirs\)/);
  // the stopgap is gone: no conflict flag holds the note open
  assert.doesNotMatch(EDITOR, /NOTE\.conflict|Not saved: changed on another device/);
  // the second note is written before the editor shows the newer version (the first showVersion is the case where
  // the record already holds his words, so nothing is kept twice)
  const keep = EDITOR.slice(
    EDITOR.indexOf('function keepBoth('),
    EDITOR.indexOf("window.addEventListener('ev-note-kept'")
  );
  assert.match(keep, /if \(sameWords\(theirs, \{ blocks: NOTE\.blocks/);
  assert.ok(
    keep.indexOf("await write({ op: 'set', collection: 'notes', id: eid, data: doc })") <
      keep.lastIndexOf('showVersion(theirs)')
  );
});
