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
  assert.ok(!/db\.collection/.test(part)); // no write around write()
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
  assert.equal(doc.title, 'Renal system');
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
