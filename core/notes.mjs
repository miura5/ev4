// E.V. core's note model (B-402, D-325): his notes as blocks of plain-text runs with inline marks, never HTML.
// One factory with no imports, so the same file runs in node (evcore.mjs imports it; test/notes-editor.test.mjs) and in
// the page (the build writes it into core.js ahead of E.V. core). The editor (page/app/25-notes.js) keeps a note as these
// blocks, reads its contenteditable back into them, and sends a paste through them: clipboard HTML is tokenized here
// into an inert tree that is read for text and a few marks, and nothing from it is ever put into the page as markup.
//   block: {type: p|h1|h2|h3|ul|ol|todo, runs: [{text, b?, i?, u?, s?, href?}], checked? (todo), indent? (1 to 6)}
//   pos:   {b: block index, o: offset in the block's text}; a selection is {a: pos, f: pos} in either order.

export function makeNotes() {
  'use strict';
  const TYPES = ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo'];
  const LISTS = ['ul', 'ol', 'todo'];
  const MARKS = ['b', 'i', 'u', 's'];
  // notes.schema.json's limits: 4000 blocks, 400 runs a block, 20000 characters a run, 2000 an href, 300 a title
  const MAX = { blocks: 4000, runs: 400, text: 20000, href: 2000, title: 300, indent: 6 };
  const HREF = /^https?:\/\/[^\s<>"]+$/;
  const ID = /^n-\d{8}-\d{6}-[A-Za-z0-9]{8,40}$/;

  // ---------------------------------------------------------------- ids
  /**
   * A new note's id, n-<YYYYMMDD-HHMMSS>-<random> (spec.collections.notes.key): the time in UTC and at least 12
   * characters from a random source (the page passes crypto.getRandomValues), so two devices never make the same one.
   */
  function newNoteId(at, random) {
    const t = new Date(at);
    if (isNaN(t)) throw new Error('newNoteId: no time');
    const tail = String(random || '').replace(/[^A-Za-z0-9]/g, '');
    if (tail.length < 12) throw new Error('newNoteId: the random part needs 12 or more letters and digits');
    const iso = t.toISOString();
    return (
      'n-' + iso.slice(0, 10).replace(/-/g, '') + '-' + iso.slice(11, 19).replace(/:/g, '') + '-' + tail.slice(0, 40)
    );
  }
  const noteIdOk = id => ID.test(String(id || ''));

  // ---------------------------------------------------------------- runs and blocks
  const cleanText = s =>
    String(s == null ? '' : s)
      .replace(/ /g, ' ')
      .replace(/[​‌‍⁠﻿]/g, '')
      .replace(/\t/g, ' ')
      .replace(/[\u0000-\u001f\u007f]/g, '');
  const linkOk = h => typeof h === 'string' && h.length <= MAX.href && HREF.test(h);
  /** The marks a run carries, in the stored shape (true marks only, an href only when it is a safe http(s) link). */
  function marksOf(r) {
    const m = {};
    for (const k of MARKS) if (r && r[k] === true) m[k] = true;
    if (r && linkOk(r.href)) m.href = r.href;
    return m;
  }
  const sameMarks = (a, b) => MARKS.every(k => !a[k] === !b[k]) && (a.href || '') === (b.href || '');
  /** Runs as stored: no empty text, neighbours with the same marks joined, each within the schema's limits. */
  function noteRuns(runs) {
    const out = [];
    for (const r of runs || []) {
      if (!r || typeof r.text !== 'string') continue;
      const text = cleanText(r.text);
      if (!text) continue;
      const m = marksOf(r);
      const last = out[out.length - 1];
      if (last && sameMarks(last, m)) last.text += text;
      else out.push({ text, ...m });
    }
    // a run longer than the schema's 20000 characters goes on as more runs with the same marks; nothing is cut. A block
    // past 400 runs is kept whole here: a paste splits it (noteSplitWide), and the editor refuses any other change
    // that would leave one (B-402 review: text was folded and cut here before)
    const capped = [];
    for (const r of out) {
      for (let i = 0; i < r.text.length; i += MAX.text) capped.push({ ...r, text: r.text.slice(i, i + MAX.text) });
    }
    return capped;
  }
  /** One block as stored: a known type, its runs, checked on a checklist item only, indent 1 to 6 or none. */
  function noteBlock(b) {
    const type = b && TYPES.includes(b.type) ? b.type : 'p';
    const out = { type, runs: noteRuns(b && b.runs) };
    if (type === 'todo') out.checked = !!(b && b.checked);
    const ind = Math.max(0, Math.min(MAX.indent, Math.floor(Number(b && b.indent) || 0)));
    if (ind && LISTS.includes(type)) out.indent = ind;
    return out;
  }
  /**
   * A note's blocks as stored: at least one (an empty paragraph). Never cut to the schema's 4000: the editor refuses a
   * change past it (noteFits), and a save past it is refused by the schema, so no text is ever silently dropped.
   */
  function noteBlocks(blocks) {
    const out = (Array.isArray(blocks) ? blocks : []).map(noteBlock);
    return out.length ? out : [{ type: 'p', runs: [] }];
  }
  /** Blocks with more than the schema's 400 runs split into following paragraphs of 400 runs each, all text kept. */
  function noteSplitWide(blocks) {
    const out = [];
    for (const b of noteBlocks(blocks)) {
      if (b.runs.length <= MAX.runs) {
        out.push(b);
        continue;
      }
      for (let i = 0; i < b.runs.length; i += MAX.runs) {
        const runs = b.runs.slice(i, i + MAX.runs);
        out.push(i ? { type: 'p', runs } : { ...b, runs });
      }
    }
    return out;
  }
  /**
   * Why these blocks can't be kept in one note, in his words, or '' when they can: past the schema's 4000 blocks or 400
   * runs a block. The editor refuses such a change and leaves the note as it was (B-402 review).
   */
  function noteFits(blocks) {
    if (blocks.length > MAX.blocks) return 'A note holds up to 4,000 lines. Start a new note for the rest.';
    if (blocks.some(b => b.runs.length > MAX.runs))
      return 'A line holds up to 400 changes of formatting. Split it into shorter lines.';
    return '';
  }
  const blockText = b => (b && b.runs ? b.runs.map(r => r.text).join('') : '');
  /** The note's title: its first heading 1, else its first heading, cut to 300 characters; empty when it has none. */
  function noteTitleOf(blocks) {
    const h = (blocks || []).find(b => b.type === 'h1') || (blocks || []).find(b => /^h[23]$/.test(b.type));
    return h ? blockText(h).replace(/\s+/g, ' ').trim().slice(0, MAX.title) : '';
  }
  const EARLIER = ' (earlier)';
  /**
   * B-404 (D-326): the title of the second note a stale save becomes, '<title> (earlier)': his title (or Untitled), cut
   * so the whole fits in 300 characters, and never '(earlier)' twice. pwa/bridge.js names a note it keeps on reconnect
   * the same way (test/pwa-offline.test.mjs holds the two equal).
   */
  function noteEarlierTitle(title) {
    const t = String(title || '').endsWith(EARLIER) ? String(title).slice(0, -EARLIER.length) : String(title || '');
    return (t.trim() || 'Untitled').slice(0, MAX.title - EARLIER.length) + EARLIER;
  }
  /** The runs between two offsets of a block's text, with their marks. */
  function sliceRuns(runs, from, to = Infinity) {
    const out = [];
    let at = 0;
    for (const r of runs) {
      const end = at + r.text.length;
      const a = Math.max(from, at),
        z = Math.min(to, end);
      if (z > a) out.push({ ...r, text: r.text.slice(a - at, z - at) });
      at = end;
    }
    return out;
  }
  /** The marks a character typed at this offset takes: those of the character before it (the first one's at 0). */
  function marksAt(block, o) {
    let at = 0;
    for (const r of block.runs) {
      const end = at + r.text.length;
      if (o > at && o <= end) return marksOf(r);
      at = end;
    }
    return o === 0 && block.runs[0] ? marksOf(block.runs[0]) : {};
  }

  // ---------------------------------------------------------------- positions and selections
  const cmp = (p, q) => p.b - q.b || p.o - q.o;
  const order = sel => (cmp(sel.a, sel.f) <= 0 ? [sel.a, sel.f] : [sel.f, sel.a]);
  const clampPos = (blocks, p) => {
    const b = Math.max(0, Math.min(blocks.length - 1, p.b | 0));
    return { b, o: Math.max(0, Math.min(blockText(blocks[b]).length, p.o | 0)) };
  };
  const copy = blocks => blocks.map(b => ({ ...b, runs: b.runs.map(r => ({ ...r })) }));

  /** The note with the selection taken out; the caret where it began. */
  function noteDelete(blocks, sel) {
    const [s, e] = order(sel).map(p => clampPos(blocks, p));
    const out = copy(blocks);
    if (!cmp(s, e)) return { blocks: out, pos: s };
    const first = out[s.b],
      last = out[e.b];
    const joined = noteBlock({
      ...first,
      runs: [...sliceRuns(first.runs, 0, s.o), ...sliceRuns(last.runs, e.o)],
    });
    out.splice(s.b, e.b - s.b + 1, joined);
    return { blocks: out, pos: s };
  }
  /** Text typed at a caret (the selection replaced), with the marks given or those at the caret. */
  function noteInsertText(blocks, sel, text, marks) {
    const d = noteDelete(blocks, sel);
    const out = d.blocks,
      p = d.pos,
      b = out[p.b];
    const t = cleanText(text).replace(/[\r\n]+/g, ' ');
    const m = marks ? marksOf(marks) : marksAt(b, p.o);
    out[p.b] = noteBlock({ ...b, runs: [...sliceRuns(b.runs, 0, p.o), { text: t, ...m }, ...sliceRuns(b.runs, p.o)] });
    return { blocks: out, pos: { b: p.b, o: p.o + t.length } };
  }
  /**
   * Enter at a caret: the block splits there. A list item goes on as one more of its kind (a checklist item unticked);
   * after a heading the new line is a paragraph; Enter in an empty list item ends the list (it becomes a paragraph).
   */
  function noteEnter(blocks, sel) {
    const d = noteDelete(blocks, sel);
    const out = d.blocks,
      p = d.pos,
      b = out[p.b];
    if (LISTS.includes(b.type) && !blockText(b)) {
      out[p.b] = noteBlock({ type: 'p', runs: [] });
      return { blocks: out, pos: { b: p.b, o: 0 } };
    }
    const len = blockText(b).length;
    const left = noteBlock({ ...b, runs: sliceRuns(b.runs, 0, p.o) });
    const nextType = LISTS.includes(b.type) ? b.type : 'p';
    // Enter at the very start of a heading keeps the heading below and leaves an empty paragraph above
    if (p.o === 0 && len && /^h[123]$/.test(b.type)) {
      out.splice(p.b, 1, noteBlock({ type: 'p', runs: [] }), b);
      return { blocks: out, pos: { b: p.b + 1, o: 0 } };
    }
    const right = noteBlock({ type: nextType, indent: b.indent, runs: sliceRuns(b.runs, p.o), checked: false });
    out.splice(p.b, 1, left, right);
    return { blocks: out, pos: { b: p.b + 1, o: 0 } };
  }
  /**
   * Backspace with the caret at a block's start: an indented item steps out, a list item or heading becomes a
   * paragraph, and a paragraph joins the block above. null at the very start of the note's first paragraph.
   */
  function noteBackspaceStart(blocks, b) {
    const out = copy(blocks);
    const cur = out[b];
    if (!cur) return null;
    if (cur.indent) {
      out[b] = noteBlock({ ...cur, indent: cur.indent - 1 });
      return { blocks: out, pos: { b, o: 0 } };
    }
    if (cur.type !== 'p') {
      out[b] = noteBlock({ ...cur, type: 'p' });
      return { blocks: out, pos: { b, o: 0 } };
    }
    if (b === 0) return null;
    return noteJoin(out, b - 1);
  }
  /** The block after this one joined onto its end (Delete at a block's end, Backspace at the next one's start). */
  function noteJoin(blocks, b) {
    if (b < 0 || b >= blocks.length - 1) return null;
    const out = copy(blocks);
    const o = blockText(out[b]).length;
    out.splice(b, 2, noteBlock({ ...out[b], runs: [...out[b].runs, ...out[b + 1].runs] }));
    return { blocks: out, pos: { b, o } };
  }
  /** The blocks the selection touches, each set to a type (a checklist item keeps its tick only while a checklist). */
  function noteSetType(blocks, sel, type) {
    if (!TYPES.includes(type)) return copy(blocks);
    const [s, e] = order(sel).map(p => clampPos(blocks, p));
    return copy(blocks).map((b, i) => (i < s.b || i > e.b ? b : noteBlock({ ...b, type, checked: b.checked })));
  }
  /** Indent or outdent the list items the selection touches (by +1 or -1, within 0 to 6). */
  function noteIndent(blocks, sel, by) {
    const [s, e] = order(sel).map(p => clampPos(blocks, p));
    return copy(blocks).map((b, i) =>
      i < s.b || i > e.b || !LISTS.includes(b.type) ? b : noteBlock({ ...b, indent: (b.indent || 0) + by })
    );
  }
  /** Whether every character of the selection carries a mark (for href: the same link). */
  function noteHasMark(blocks, sel, mark) {
    const [s, e] = order(sel).map(p => clampPos(blocks, p));
    let any = false;
    for (let i = s.b; i <= e.b; i++) {
      const runs = sliceRuns(blocks[i].runs, i === s.b ? s.o : 0, i === e.b ? e.o : Infinity);
      for (const r of runs) {
        any = true;
        if (mark === 'href' ? !r.href : !r[mark]) return false;
      }
    }
    return any;
  }
  /**
   * A mark set on (value true, or the link for href) or taken off (false) across the selection; with on omitted it
   * toggles: off when every selected character has it, else on. A link that is not http(s) is refused (null).
   */
  function noteSetMark(blocks, sel, mark, on) {
    if (!MARKS.includes(mark) && mark !== 'href') return null;
    if (mark === 'href' && on && !linkOk(on)) return null;
    const value = on === undefined ? !noteHasMark(blocks, sel, mark) : on;
    const [s, e] = order(sel).map(p => clampPos(blocks, p));
    const out = copy(blocks);
    for (let i = s.b; i <= e.b; i++) {
      const b = out[i];
      const from = i === s.b ? s.o : 0,
        to = i === e.b ? e.o : Infinity;
      const mid = sliceRuns(b.runs, from, to).map(r => {
        const x = { ...r };
        if (value) x[mark] = mark === 'href' ? value : true;
        else delete x[mark];
        return x;
      });
      out[i] = noteBlock({ ...b, runs: [...sliceRuns(b.runs, 0, from), ...mid, ...sliceRuns(b.runs, to)] });
    }
    return out;
  }

  // ---------------------------------------------------------------- Markdown-style typing
  const SHORTCUTS = [
    [/^###\s$/, 'h3'],
    [/^##\s$/, 'h2'],
    [/^#\s$/, 'h1'],
    [/^[-*•]\s$/, 'ul'],
    [/^1[.)]\s$/, 'ol'],
    [/^\[\s?\]\s$/, 'todo'],
    [/^\[[xX]\]\s$/, 'todo', true],
  ];
  /**
   * Quip's typing shortcuts: in a paragraph, '# ', '## ' or '### ' at the start makes a heading, '- ' (or '* ') a
   * bulleted item, '1. ' a numbered one and '[] ' a checklist item ('[x] ' ticked). Fires only with the caret right
   * after the space that ends the marker; the marker goes. {block, o} or null.
   */
  function noteShortcut(block, o) {
    if (!block || block.type !== 'p') return null;
    const head = blockText(block).slice(0, o);
    for (const [re, type, checked] of SHORTCUTS) {
      if (!re.test(head)) continue;
      const out = noteBlock({ type, runs: sliceRuns(block.runs, o), checked: !!checked });
      return { block: out, o: 0 };
    }
    return null;
  }

  // ---------------------------------------------------------------- reading a tree (the editor, or a paste) into blocks
  const SKIP = new Set(
    'script style template noscript iframe frame frameset object embed applet svg math canvas video audio img picture source track map area head title meta link base input select option optgroup textarea button dialog form noembed noframes xmp plaintext'.split(
      ' '
    )
  );
  const BLOCK = new Set(
    'p div h1 h2 h3 h4 h5 h6 li pre blockquote section article header footer aside nav main address figure figcaption dt dd dl tr table tbody thead tfoot caption hr details summary center'.split(
      ' '
    )
  );
  const nameOf = n => String(n.nodeName || '').toLowerCase();
  const attr = (n, k) => (n.getAttribute ? n.getAttribute(k) : null);
  /** The marks an element adds (tags always; inline styles only in a paste, where Docs and Word carry marks that way). */
  function elMarks(n, name, marks, styles) {
    const m = { ...marks };
    if (name === 'b' || name === 'strong') m.b = true;
    if (name === 'i' || name === 'em' || name === 'cite' || name === 'dfn') m.i = true;
    if (name === 'u' || name === 'ins') m.u = true;
    if (name === 's' || name === 'strike' || name === 'del') m.s = true;
    if (name === 'a') {
      const h = String(attr(n, 'href') || '').trim();
      if (linkOk(h)) m.href = h;
    }
    if (styles) {
      const st = String(attr(n, 'style') || '').toLowerCase();
      const w = st.match(/font-weight\s*:\s*([a-z0-9]+)/);
      if (w) m.b = w[1] === 'bold' || w[1] === 'bolder' || Number(w[1]) >= 600;
      if (/font-style\s*:\s*italic/.test(st)) m.i = true;
      const dec = st.match(/text-decoration(?:-line)?\s*:\s*([^;]+)/);
      if (dec && /underline/.test(dec[1])) m.u = true;
      if (dec && /line-through/.test(dec[1])) m.s = true;
    }
    return m;
  }
  const isTodoItem = n => {
    const cls = ' ' + String(attr(n, 'class') || '') + ' ';
    if (
      attr(n, 'data-t') === 'todo' ||
      attr(n, 'role') === 'checkbox' ||
      / (todo|task-list-item|checklist) /i.test(cls)
    )
      return true;
    const kids = n.childNodes || [];
    for (let i = 0; i < Math.min(kids.length, 3); i++) {
      const k = kids[i];
      if (k.nodeType === 1 && nameOf(k) === 'input' && String(attr(k, 'type') || '').toLowerCase() === 'checkbox')
        return true;
    }
    return false;
  };
  const isChecked = n => {
    if (attr(n, 'data-checked') === 'true' || attr(n, 'aria-checked') === 'true') return true;
    if (/(^|\s)(checked|done)(\s|$)/.test(String(attr(n, 'class') || ''))) return true;
    for (const k of n.childNodes || [])
      if (k.nodeType === 1 && nameOf(k) === 'input' && attr(k, 'checked') != null) return true;
    return false;
  };

  /**
   * A tree read into blocks. node: a DOM node or the inert tree noteParseHtml makes (nodeType, nodeName, childNodes,
   * nodeValue, getAttribute). The editor's own blocks are elements with data-t (and data-indent, data-checked); any
   * other markup is read for its text, its block breaks, its lists and the marks above. paste: true for clipboard
   * markup (HTML whitespace collapses, inline styles count). track: [{node, offset}] DOM positions, each returned as
   * the {b, o} it falls at (null where it falls outside). Returns {blocks, at}.
   */
  function noteFromTree(root, { paste = false, track = [] } = {}) {
    const out = [];
    const at = track.map(() => null);
    let cur = null; // the block text goes into, made on its first text
    let want = { type: 'p' }; // what that block will be
    let lastSpace = true; // collapsing HTML whitespace across nodes (paste only)
    const open = () => {
      if (!cur) {
        cur = { type: want.type, runs: [], ...(want.checked != null ? { checked: want.checked } : {}) };
        if (want.indent) cur.indent = want.indent;
        out.push(cur);
        lastSpace = true;
      }
      return cur;
    };
    const len = b => b.runs.reduce((n, r) => n + r.text.length, 0);
    const mark = (node, offset, o) => {
      track.forEach((t, i) => {
        if (at[i] == null && t.node === node && (offset == null || t.offset === offset)) at[i] = o;
      });
    };
    const hereEl = (node, idx) =>
      track.forEach((t, i) => {
        if (at[i] == null && t.node === node && t.offset === idx) {
          const b = open();
          at[i] = { b: out.indexOf(b), o: len(b) };
        }
      });
    function text(node, marks) {
      let s = String(node.nodeValue || '');
      if (paste) {
        s = s.replace(/[\t\n\r\f ]+/g, ' ');
        if (lastSpace || !cur) s = s.replace(/^ /, '');
      } else s = s.replace(/[\r\n]+/g, ' ');
      const tracked = track.some(t => t.node === node);
      if (!s && !tracked) return;
      const b = open();
      const base = len(b);
      if (tracked)
        track.forEach((t, i) => {
          if (at[i] == null && t.node === node)
            at[i] = { b: out.indexOf(b), o: base + cleanText(String(node.nodeValue || '').slice(0, t.offset)).length };
        });
      const c = cleanText(s);
      if (!c) return;
      b.runs.push({ text: c, ...marks });
      lastSpace = / $/.test(c);
    }
    function block(want0, fn) {
      const keep = want;
      cur = null;
      want = want0;
      const n0 = out.length;
      fn();
      if (out.length === n0 && want0.keepEmpty) open(); // an empty line of the editor, or an empty item, stays
      cur = null;
      want = keep;
    }
    function walk(node, marks, list) {
      const kids = node.childNodes || [];
      for (let i = 0; i < kids.length; i++) {
        hereEl(node, i);
        visit(kids[i], marks, list);
      }
      hereEl(node, kids.length);
    }
    function visit(n, marks, list) {
      if (n.nodeType === 3) return text(n, marks);
      if (n.nodeType !== 1) return;
      const name = nameOf(n);
      if (SKIP.has(name) || attr(n, 'data-nb-skip') != null || attr(n, 'aria-hidden') === 'true') {
        hereEl(n, 0);
        return;
      }
      if (name === 'br') {
        if (cur) cur = null;
        else if (out.length && !paste) open(); // a second line break makes an empty line
        return;
      }
      const t = attr(n, 'data-t');
      if (t && TYPES.includes(t) && !paste) {
        const ind = Number(attr(n, 'data-indent')) || 0;
        return block(
          { type: t, indent: ind, checked: t === 'todo' ? attr(n, 'data-checked') === 'true' : null, keepEmpty: true },
          () => walk(n, {}, null)
        );
      }
      if (name === 'ul' || name === 'ol') {
        const todoList = /(^|\s)(todo|contains-task-list|checklist)(\s|$)/.test(String(attr(n, 'class') || ''));
        const l = { type: name === 'ol' ? 'ol' : todoList ? 'todo' : 'ul', indent: list ? list.indent + 1 : 0 };
        return block(want, () => walk(n, marks, l));
      }
      if (name === 'li') {
        const type = isTodoItem(n) ? 'todo' : list ? list.type : 'ul';
        const ind = Math.min(MAX.indent, list ? list.indent : 0);
        return block({ type, indent: ind, checked: type === 'todo' ? isChecked(n) : null, keepEmpty: !paste }, () =>
          walk(n, marks, list)
        );
      }
      if (BLOCK.has(name)) {
        const h = name.match(/^h([1-6])$/);
        const type = h ? 'h' + Math.min(3, Number(h[1])) : 'p';
        return block({ type, keepEmpty: !paste && name !== 'div' }, () => walk(n, h ? {} : marks, null));
      }
      return walk(n, elMarks(n, name, marks, paste), list);
    }
    walk(root, {}, null);
    if (paste)
      for (const b of out) {
        // HTML's whitespace at a block's end is not text (a meaningful one comes as &nbsp;)
        const lastRun = b.runs[b.runs.length - 1];
        if (lastRun) lastRun.text = lastRun.text.replace(/[\t\n\r\f ]+$/, '');
      }
    const blocks = noteBlocks(out);
    // a tracked position past a dropped block, or in a node never reached, falls at the note's end
    return { blocks, at: at.map(p => (p ? clampPos(blocks, p) : null)) };
  }

  // ---------------------------------------------------------------- clipboard markup, tokenized into an inert tree
  const HTML_MAX = 2000000;
  const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  const RAW = new Set('script style textarea title xmp iframe noembed noframes noscript plaintext'.split(' '));
  const ENT = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
    bull: '•',
    middot: '·',
    deg: '°',
    plusmn: '±',
    times: '×',
    divide: '÷',
    micro: 'µ',
    frac12: '½',
    frac14: '¼',
    frac34: '¾',
    le: '≤',
    ge: '≥',
    ne: '≠',
    larr: '←',
    rarr: '→',
    uarr: '↑',
    darr: '↓',
    copy: '©',
    reg: '®',
    trade: '™',
    sup2: '²',
    sup3: '³',
    alpha: 'α',
    beta: 'β',
    gamma: 'γ',
    delta: 'δ',
    mu: 'μ',
    shy: '',
  };
  const decode = s =>
    s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, e) => {
      if (e[0] === '#') {
        const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
      }
      const v = ENT[e] != null ? ENT[e] : ENT[e.toLowerCase()];
      return v != null ? v : m;
    });
  const mkEl = (name, attrs) => ({
    nodeType: 1,
    nodeName: name,
    attrs,
    childNodes: [],
    getAttribute: k => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null),
  });
  /**
   * Clipboard HTML as an inert tree for noteFromTree: a small tokenizer, never the browser's parser and never the
   * page's DOM, so nothing in it can run or load. Script, style and the like keep no content; comments and
   * declarations go; entities are decoded into text.
   */
  function noteParseHtml(html) {
    const src = String(html || '').slice(0, HTML_MAX); // notePaste never sends more
    const root = mkEl('#root', {});
    const stack = [root];
    const top = () => stack[stack.length - 1];
    const closeTo = name => {
      for (let i = stack.length - 1; i > 0; i--)
        if (stack[i].nodeName === name) {
          stack.length = i;
          return true;
        }
      return false;
    };
    let i = 0;
    while (i < src.length) {
      const lt = src.indexOf('<', i);
      if (lt < 0 || lt > i) {
        const t = src.slice(i, lt < 0 ? src.length : lt);
        top().childNodes.push({ nodeType: 3, nodeName: '#text', nodeValue: decode(t), childNodes: [] });
        if (lt < 0) break;
        i = lt;
        continue;
      }
      if (src.startsWith('<!--', i)) {
        const e = src.indexOf('-->', i + 4);
        i = e < 0 ? src.length : e + 3;
        continue;
      }
      if (src[i + 1] === '!' || src[i + 1] === '?') {
        const e = src.indexOf('>', i);
        i = e < 0 ? src.length : e + 1;
        continue;
      }
      const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(src.slice(i, i + 64));
      if (!m) {
        top().childNodes.push({ nodeType: 3, nodeName: '#text', nodeValue: '<', childNodes: [] });
        i++;
        continue;
      }
      const name = m[2].toLowerCase();
      // the tag's attributes, quoted or not, up to its '>'
      let j = i + m[0].length;
      const attrs = {};
      let selfClose = false;
      while (j < src.length && src[j] !== '>') {
        const a = /^[\s/]*([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/.exec(src.slice(j, j + 4096));
        if (!a || !a[0]) {
          if (src[j] === '/') selfClose = true;
          j++;
          continue;
        }
        const k = a[1].toLowerCase();
        if (!(k in attrs)) attrs[k] = decode(a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : '');
        j += a[0].length;
        if (/\/\s*$/.test(a[0]) && src[j] === '>') selfClose = true;
      }
      if (src[j - 1] === '/') selfClose = true;
      i = j + 1;
      if (m[1]) {
        closeTo(name);
        continue;
      }
      if (RAW.has(name)) {
        // its content is text to the browser and nothing to a note: skip to its end tag
        const e = src.toLowerCase().indexOf('</' + name, i);
        const g = e < 0 ? -1 : src.indexOf('>', e);
        i = g < 0 ? src.length : g + 1;
        top().childNodes.push(mkEl(name, attrs));
        continue;
      }
      // the implied ends a paste meets: a new block ends an open paragraph, a new item ends the open one
      if (BLOCK.has(name) || name === 'ul' || name === 'ol') if (top().nodeName === 'p') stack.pop();
      if (name === 'li') {
        for (let k = stack.length - 1; k > 0; k--) {
          const nn = stack[k].nodeName;
          if (nn === 'ul' || nn === 'ol') break;
          if (nn === 'li') {
            stack.length = k;
            break;
          }
        }
      }
      const node = mkEl(name, attrs);
      top().childNodes.push(node);
      if (!VOID.has(name) && !selfClose) stack.push(node);
    }
    return root;
  }
  /** Plain text as blocks: a line each, with the typing shortcuts applied at each line's start. */
  function noteFromText(text) {
    const lines = String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n');
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return noteBlocks(
      lines.map(l => {
        const b = noteBlock({ type: 'p', runs: [{ text: l }] });
        const m = /^(#{1,3}|[-*•]|1[.)]|\[[\sxX]?\])\s/.exec(l);
        const s = m ? noteShortcut(b, m[0].length) : null;
        return s ? s.block : b;
      })
    );
  }
  /**
   * What a paste brings, sanitized: E.V.'s own copied blocks (its JSON, checked as stored), else the HTML read for text,
   * blocks, lists and the marks above, else the plain text. Never HTML out.
   */
  function notePaste({ json, html, text } = {}) {
    if (json) {
      try {
        const v = JSON.parse(json);
        if (Array.isArray(v) && v.length) return noteSplitWide(v);
      } catch (e) {
        /* not ours after all */
      }
    }
    // markup past what the tokenizer reads whole is not read at all: the plain text comes instead, all of it
    if (html && html.length <= HTML_MAX && /<[a-z!]/i.test(html)) {
      const r = noteFromTree(noteParseHtml(html), { paste: true });
      if (r.blocks.some(b => blockText(b).trim())) return noteSplitWide(r.blocks);
    }
    return noteFromText(text || '');
  }
  /** Pasted blocks at a caret (the selection replaced): the first joins the line it lands in, the rest follow it. */
  function noteInsertBlocks(blocks, sel, pasted) {
    const d = noteDelete(blocks, sel);
    const out = d.blocks,
      p = d.pos,
      b = out[p.b];
    const add = noteBlocks(pasted);
    if (add.length === 1) {
      const r = noteInsertText(out, { a: p, f: p }, '', null);
      // B-439: one pasted line into an empty paragraph keeps its own style (a heading pasted stays a heading)
      const into = r.blocks[p.b];
      const bb = !blockText(into) && into.type === 'p' && add[0].type !== 'p' ? { ...into, type: add[0].type } : into;
      const ins = add[0].runs;
      r.blocks[p.b] = noteBlock({ ...bb, runs: [...sliceRuns(bb.runs, 0, p.o), ...ins, ...sliceRuns(bb.runs, p.o)] });
      return { blocks: r.blocks, pos: { b: p.b, o: p.o + blockText(add[0]).length } };
    }
    const head = noteBlock({ ...b, runs: [...sliceRuns(b.runs, 0, p.o), ...add[0].runs] });
    const lastAdd = add[add.length - 1];
    const tail = noteBlock({ ...lastAdd, runs: [...lastAdd.runs, ...sliceRuns(b.runs, p.o)] });
    const mid = add.slice(1, -1);
    const all = [
      ...out.slice(0, p.b),
      blockText(b).slice(0, p.o) ? head : noteBlock({ ...add[0] }),
      ...mid,
      tail,
      ...out.slice(p.b + 1),
    ];
    return {
      blocks: all, // past the schema's limits the editor refuses the paste (noteFits); nothing is cut here
      pos: clampPos(all, { b: p.b + add.length - 1, o: blockText(lastAdd).length }),
    };
  }
  /** The selection's blocks, cut at its ends (for copy and cut), and its plain text, a line a block. */
  function noteCopy(blocks, sel) {
    const [s, e] = order(sel).map(p => clampPos(blocks, p));
    const part = [];
    for (let i = s.b; i <= e.b; i++)
      part.push(
        noteBlock({ ...blocks[i], runs: sliceRuns(blocks[i].runs, i === s.b ? s.o : 0, i === e.b ? e.o : Infinity) })
      );
    return { blocks: part, text: part.map(blockText).join('\n') };
  }

  /**
   * B-439: blocks as plain HTML for the clipboard, which a paste here (notePaste) or another app reads back: headings
   * and paragraphs as themselves, list items in real ul / ol lists (a checklist as a ul), runs as strong, em, u, s and
   * checked links. Text is escaped; nothing else goes in.
   */
  function noteHtml(blocks) {
    const esc = x =>
      String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const run = r => {
      let x = esc(r.text);
      if (r.s) x = '<s>' + x + '</s>';
      if (r.u) x = '<u>' + x + '</u>';
      if (r.i) x = '<em>' + x + '</em>';
      if (r.b) x = '<strong>' + x + '</strong>';
      if (r.href && linkOk(r.href)) x = '<a href="' + esc(r.href) + '">' + x + '</a>';
      return x;
    };
    let out = '',
      open = null;
    for (const b of noteBlocks(blocks)) {
      const list = b.type === 'ol' ? 'ol' : LISTS.includes(b.type) ? 'ul' : null;
      if (open && open !== list) {
        out += '</' + open + '>';
        open = null;
      }
      const inner = b.runs.map(run).join('') || '<br>';
      if (list) {
        if (!open) out += '<' + (open = list) + '>';
        out += '<li>' + inner + '</li>';
      } else out += '<' + b.type + '>' + inner + '</' + b.type + '>';
    }
    return open ? out + '</' + open + '>' : out;
  }

  // ---------------------------------------------------------------- rendering (through the caller's element maker)
  /**
   * The editor's tree for these blocks through h(tag, attrs, children) and t(text): one element a block (p, h1 to h3,
   * or a div for a list item, data-t naming its type), its runs as nested strong, em, u, s and a. Text goes in only
   * as text nodes and a link only as a checked http(s) href. noteFromTree reads it back into the same blocks.
   */
  function noteRender(blocks, h, t) {
    return noteBlocks(blocks).map(b => {
      const kids = b.runs.map(r => {
        let n = t(r.text);
        if (r.s) n = h('s', {}, [n]);
        if (r.u) n = h('u', {}, [n]);
        if (r.i) n = h('em', {}, [n]);
        if (r.b) n = h('strong', {}, [n]);
        if (r.href && linkOk(r.href)) n = h('a', { href: r.href, rel: 'noopener noreferrer', target: '_blank' }, [n]);
        return n;
      });
      const tag = /^h[123]$/.test(b.type) || b.type === 'p' ? b.type : 'div';
      const attrs = { 'data-t': b.type, class: 'nb' };
      if (b.indent) attrs['data-indent'] = String(b.indent);
      if (b.type === 'todo') attrs['data-checked'] = String(!!b.checked);
      if (!kids.length) kids.push(h('br', {}, []));
      return h(tag, attrs, kids);
    });
  }

  // ---------------------------------------------------------------- the document a save writes
  /**
   * notes/<id> as the page saves it (notes.schema.json): the earlier document's identity and marks kept, blocks
   * and title from the editor, the envelope stamped now. course: a spec.courses key or null.
   */
  function noteDoc(prev, { blocks, course, label, at, source }) {
    const b = noteBlocks(blocks);
    const doc = {
      schema: 1,
      writer: 'page',
      at,
      source: source || 'E.V. Home',
      createdAt: (prev && prev.createdAt) || at,
      title: prev && prev.earlierOf ? noteEarlierTitle(noteTitleOf(b)) : noteTitleOf(b),
      course: course === undefined ? (prev && prev.course !== undefined ? prev.course : null) : course,
      blocks: b,
      editedAt: at,
    };
    const lab = label !== undefined ? label : prev && prev.label;
    if (typeof lab === 'string' && lab) doc.label = lab.slice(0, 80);
    for (const k of ['earlierOf', 'archivedAt', 'discardedAt']) if (prev && prev[k] !== undefined) doc[k] = prev[k];
    return doc;
  }

  return {
    NOTE_TYPES: TYPES,
    newNoteId,
    noteIdOk,
    noteRuns,
    noteBlock,
    noteBlocks,
    noteSplitWide,
    noteFits,
    noteText: blockText,
    noteTitleOf,
    noteEarlierTitle,
    noteMarksAt: marksAt,
    noteDelete,
    noteInsertText,
    noteEnter,
    noteBackspaceStart,
    noteJoin,
    noteSetType,
    noteIndent,
    noteHasMark,
    noteSetMark,
    noteShortcut,
    noteFromTree,
    noteParseHtml,
    noteFromText,
    notePaste,
    noteInsertBlocks,
    noteCopy,
    noteRender,
    noteHtml,
    noteDoc,
  };
}
