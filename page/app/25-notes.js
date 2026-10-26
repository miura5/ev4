    // ------------------------------------------------------------ notes: the editor (B-402, D-325, D-327)
    // His notes, desktop only (1024 px and wider; the phone layout is unchanged). A page-less contenteditable whose
    // truth is the block model in core/notes.mjs: typing goes into the editable as the browser does it and is read back
    // into blocks; Enter, joins, styles, marks, links, paste, undo and redo change the blocks and repaint them. A paste
    // is read into blocks (never inserted as HTML), and the page writes text only as text nodes. Each change saves the
    // whole note through write() after a short pause; New note writes a fresh note at once, under an id with a random
    // part from crypto, so two devices never make the same one. The list here is the minimum way in: Notes' own list,
    // the L-frame strip and sessions are B-403, B-405 and B-406.
    const NOTE_BYTES = 262144; // spec.capacity.documentBytes (test/notes-editor.test.mjs holds them equal)
    const NOTE_SAVE_MS = 800; // the autosave's pause after the last change
    const NOTE_RETRY_MS = 15000; // a refused save tries again after this, or on the next change
    const NOTE = {
      view: 'list', // list | editor
      open: null, // the open note's id
      doc: null, // its document as last saved (or as read when opened)
      blocks: null,
      course: undefined,
      sel: null, // the last selection in the editable, as {a, f} positions
      pend: null, // marks for the next character typed at a caret (B, I, U or S pressed with nothing selected)
      undo: [],
      redo: [],
      last: { kind: '', at: 0 },
      dirty: false,
      saving: null,
      again: false,
      timer: 0,
      state: 'saved', // saved | saving | failed
      edited: null,
    };
    const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    // the demo's shortcuts (Quip's), as the Mac writes them; Ctrl and Alt elsewhere
    const keysText = k => (IS_MAC ? k : k.replace('⌘', 'Ctrl+').replace('⌥', 'Alt+').replace('⇧', 'Shift+'));
    const NI = {
      undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
      redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
      chev: 'M6 9l6 6 6-6',
      back: 'M15 6l-6 6 6 6',
      bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
      italic: 'M10 5h8M6 19h8M14 5l-4 14',
      underline: 'M7 4v7a5 5 0 0 0 10 0V4M5 20h14',
      strike:
        'M5 12h14M16 7.5C15.4 6 13.9 5 12 5c-2.5 0-4 1.3-4 3 0 1.3.8 2.2 2.4 2.8M8 16.5c.6 1.5 2.1 2.5 4 2.5 2.5 0 4-1.3 4-3',
      link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
      bullets: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
      numbers: 'M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 14.5c.5-.8 2.5-.9 2.5.6 0 1.1-2.5 2-2.5 3.4h2.8',
      checks: 'M4 4.5h5v5H4zM5.5 7l1 1 2-2M12 7h8M4 14.5h5v5H4zM12 17h8',
      tick: 'M5 12l5 5 9-10',
      plus: 'M12 5v14M5 12h14',
      note: 'M6 4h9l3 3v13H6zM9 10h6M9 14h6',
      saved: 'M5 12l5 5 9-10',
    };
    const NSTYLES = [
      ['p', 'Paragraph', '¶', '⌘⌥0'],
      ['h1', 'Heading 1', 'H1', '⌘⌥1'],
      ['h2', 'Heading 2', 'H2', '⌘⌥2'],
      ['h3', 'Heading 3', 'H3', '⌘⌥3'],
      ['ul', 'Bulleted list', 'bullets', '⌘⇧L'],
      ['ol', 'Numbered list', 'numbers', '⌘⇧7'],
      ['todo', 'Checklist', 'checks', '⌘⇧9'],
    ];
    const NFMTS = [
      ['b', 'Bold', 'bold', '⌘B'],
      ['i', 'Italic', 'italic', '⌘I'],
      ['u', 'Underline', 'underline', '⌘U'],
      ['s', 'Strikethrough', 'strike', '⌘⇧X'],
    ];
    const nIcon = (d, cls = 'ico') => {
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('viewBox', '0 0 24 24');
      s.setAttribute('aria-hidden', 'true');
      s.setAttribute('class', cls);
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      s.append(p);
      return s;
    };
    const nGlyph = g => (NI[g] ? nIcon(NI[g]) : document.createTextNode(g));
    const nBtn = (cls, label, d, on) => {
      const b = el('button', cls);
      b.type = 'button';
      if (label) b.setAttribute('aria-label', label);
      if (d) b.append(nIcon(d));
      if (on) b.addEventListener('click', on);
      return b;
    };
    const courseKeys = () => Object.keys(EV_SPEC.courses || {}).filter(k => !k.startsWith('_'));
    const defaultCourse = () => courseKeys().find(k => EV_SPEC.courses[k].default) || courseKeys()[0] || null;
    const noteName = n => (n && (n.title || E.noteTitleOf(n.blocks || []))) || 'Untitled';
    const editedText = iso => {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d)) return '';
      const day = E.chicagoDate(d);
      const time = d
        .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })
        .toLowerCase();
      return day === today ? time : short(day) + ', ' + time;
    };

    // ---- the way in: a Notes tab after Study (the demo's order), desktop only
    const notesTab = (() => {
      const study = $('tab-study');
      if (!study) return null;
      const b = el('button', 'tab');
      b.type = 'button';
      b.id = 'tab-notes';
      b.dataset.tab = 'notes';
      b.title = 'Notes';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', 'false');
      const ic = nIcon(NI.note, '');
      ic.setAttribute('fill', 'none');
      ic.setAttribute('stroke', 'currentColor');
      ic.setAttribute('stroke-width', '1.7');
      ic.setAttribute('stroke-linecap', 'round');
      ic.setAttribute('stroke-linejoin', 'round');
      b.append(ic, el('span', null, 'Notes'));
      study.after(b);
      tabs.push(b); // showTab marks it selected with the others
      b.addEventListener('click', () => showTab('notes'));
      return b;
    })();
    const notesPanel = (() => {
      const p = el('section', 'panel');
      p.id = 'p-notes';
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('aria-labelledby', 'tab-notes');
      p.hidden = true;
      const after = $('p-study');
      if (after) after.after(p);
      else (document.querySelector('.wrap') || document.body).append(p);
      return p;
    })();

    // ---- the list (the minimum: New note and his notes, newest edited first)
    const nList = el('div', 'n-list');
    nList.id = 'notes-list';
    const nListBar = el('div', 'n-toolbar');
    const nNew = nBtn('btn primary sm', null, NI.plus, () => newNote());
    nNew.id = 'notes-new';
    nNew.append('New note');
    nListBar.append(el('span', 'sp'), nNew);
    const nRows = el('div', 'n-rows');
    nRows.id = 'notes-rows';
    nList.append(nListBar, nRows);

    // ---- the editor: the format bar, then the page-less document
    const nEd = el('div', 'n-ed');
    nEd.id = 'notes-editor';
    nEd.hidden = true;
    const fbar = el('div', 'n-fbar');
    fbar.setAttribute('role', 'toolbar');
    fbar.setAttribute('aria-label', 'Formatting');
    const bUndo = nBtn('btn ghost icon sm', 'Undo', NI.undo, () => noteUndo());
    bUndo.title = 'Undo  ' + keysText('⌘Z');
    const bRedo = nBtn('btn ghost icon sm', 'Redo', NI.redo, () => noteRedo());
    bRedo.title = 'Redo  ' + keysText('⌘⇧Z');
    const bStyle = nBtn('btn ghost sm n-stb', null, null, () => toggleStyleMenu());
    bStyle.setAttribute('aria-haspopup', 'menu');
    bStyle.setAttribute('aria-expanded', 'false');
    const bStyleGl = el('span', 'gl'),
      bStyleLb = el('span', 'lb');
    bStyle.append(bStyleGl, bStyleLb, nIcon(NI.chev, 'ico sicon'));
    const fmtBtns = {};
    for (const [k, label, ic, keys] of NFMTS) {
      const b = nBtn('btn ghost icon sm', label, NI[ic], () => noteToggleMark(k));
      b.title = label + '  ' + keysText(keys);
      b.setAttribute('aria-pressed', 'false');
      fmtBtns[k] = b;
    }
    const bLink = nBtn('btn ghost icon sm', 'Link', NI.link, () => toggleLink());
    bLink.title = 'Link  ' + keysText('⌘K');
    bLink.setAttribute('aria-haspopup', 'dialog');
    bLink.setAttribute('aria-expanded', 'false');
    const stMenu = el('div', 'menu n-stm');
    stMenu.setAttribute('role', 'menu');
    stMenu.setAttribute('aria-label', 'Text style');
    stMenu.hidden = true;
    const stItems = NSTYLES.map(([k, name, gl, keys]) => {
      const b = el('button', 'mi');
      b.type = 'button';
      b.dataset.style = k;
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', 'false');
      const g = el('span', 'gl');
      g.append(nGlyph(gl));
      b.append(g, el('span', 'lb', name), el('span', 'ks', keysText(keys)));
      b.addEventListener('click', () => {
        closeStyleMenu(false);
        noteSetStyle(k);
      });
      stMenu.append(b);
      return b;
    });
    const lkPop = el('div', 'n-lkp');
    lkPop.setAttribute('role', 'dialog');
    lkPop.setAttribute('aria-label', 'Add a link');
    lkPop.hidden = true;
    const lkLab = el('label', 'lab', 'Link');
    lkLab.htmlFor = 'n-lkin';
    const lkIn = el('input', 'in');
    lkIn.id = 'n-lkin';
    lkIn.type = 'url';
    lkIn.placeholder = 'Paste or type a link';
    const lkErr = el('span', 'n-lkerr');
    lkErr.setAttribute('role', 'status');
    const lkRow = el('div', 'n-lkrow');
    const lkCancel = btn('Cancel', () => closeLink(true), { cls: 'btn ghost sm' });
    const lkAdd = btn('Add link', () => addLink(), { cls: 'btn neutral sm' });
    lkRow.append(lkCancel, lkAdd);
    lkPop.append(lkLab, lkIn, lkErr, lkRow);
    const sep = () => el('span', 'fsep');
    fbar.append(bUndo, bRedo, sep(), bStyle, sep(), ...Object.values(fmtBtns), sep(), bLink, stMenu, lkPop);
    // a format bar click keeps the editable's selection (focus stays in the note)
    fbar.addEventListener('mousedown', e => {
      if (e.target.closest('button') && !e.target.closest('.n-lkp')) e.preventDefault();
    });
    const nScroll = el('div', 'n-scroll');
    const nDoc = el('article', 'n-doc');
    const nMeta = el('div', 'n-meta');
    const bCourse = nBtn('btn ghost sm n-course', null, null, () => toggleCourseMenu());
    bCourse.setAttribute('aria-haspopup', 'menu');
    bCourse.setAttribute('aria-expanded', 'false');
    const courseMenu = el('div', 'menu n-cmenu');
    courseMenu.setAttribute('role', 'menu');
    courseMenu.setAttribute('aria-label', 'Course');
    courseMenu.hidden = true;
    const mLabel = el('span', 'dt'),
      mEdited = el('span', 'dt');
    nMeta.append(bCourse, courseMenu, mLabel, mEdited);
    const body = el('div', 'n-body');
    body.id = 'note-body';
    body.contentEditable = 'true';
    body.spellcheck = true;
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-multiline', 'true');
    body.setAttribute('aria-label', 'Note');
    body.dataset.placeholder =
      'Write as the lecture goes. Type “# ” for a heading, “- ” for a list, “[] ” for a checklist, or use the bar above.';
    nDoc.append(nMeta, body);
    nScroll.append(nDoc);
    nEd.append(fbar, nScroll);
    notesPanel.append(nList, nEd);

    // ---- the pane header while a note is open: back to Notes, the note's name, and whether it is saved
    const mhTitle = $('mh-title');
    const nBack = nBtn('btn ghost icon sm n-back', 'Back to Notes', NI.back, () => closeNote());
    nBack.hidden = true;
    const nCrumb = el('span', 'n-crumb');
    nCrumb.hidden = true;
    const nSync = el('span', 'n-sync');
    nSync.setAttribute('role', 'status');
    nSync.hidden = true;
    if (mhTitle) {
      mhTitle.before(nBack);
      mhTitle.after(nCrumb);
      nCrumb.after(nSync);
    }
    function syncHead() {
      const on = document.body.dataset.view === 'notes' && NOTE.view === 'editor' && !!NOTE.open;
      nBack.hidden = nCrumb.hidden = nSync.hidden = !on;
      if (!on) return;
      nCrumb.textContent = '/ ' + (E.noteTitleOf(NOTE.blocks || []) || 'New note').split(':')[0];
      nSync.replaceChildren(
        ...(NOTE.state === 'saved' ? [nIcon(NI.saved)] : []),
        NOTE.state === 'saving' ? 'Saving…' : NOTE.state === 'failed' ? 'Not saved' : 'Saved'
      );
      nSync.classList.toggle('bad', NOTE.state === 'failed');
      nSync.title = NOTE.state === 'failed' ? NOTE.why || '' : '';
    }
    // the view follows showTab (02) through the body's data-view; leaving Notes saves what is pending
    new MutationObserver(() => {
      if (document.body.dataset.view !== 'notes') saveNote();
      syncHead();
    }).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });

    // ---- desktop only: no Notes entry below 1024 px, and no way into it by address
    function notesWidth() {
      const wide = WIDE.matches;
      if (notesTab) notesTab.hidden = !wide;
      if (!wide && ui.tab === 'notes') {
        saveNote();
        showTab('ev');
      }
    }
    WIDE.addEventListener('change', notesWidth);
    notesWidth();
    window.addEventListener('hashchange', () => {
      if (location.hash === '#notes' && !WIDE.matches) showTab('ev');
    });
    if (location.hash === '#notes' && WIDE.matches) showTab('notes'); // 02 opened the address before Notes existed

    // ---- the list
    function renderNotes() {
      syncHead();
      if (NOTE.view !== 'list') return;
      const rows = (S.notes || [])
        .filter(n => !n.archivedAt && !n.discardedAt)
        .sort((a, b) => String(b.editedAt || b.at || '').localeCompare(String(a.editedAt || a.at || '')));
      nRows.replaceChildren(
        ...rows.map(n => {
          const r = el('button', 'li n-row');
          r.type = 'button';
          r.dataset.note = n.id;
          r.append(
            nIcon(NI.note, 'ico sicon'),
            el('span', 'nm', noteName(n)),
            el('span', 'sp'),
            el('span', 'mini nk', n.label || ''),
            el('span', 'mini nc', n.course || ''),
            el('span', 't', editedText(n.editedAt || n.at))
          );
          r.addEventListener('click', () => openNote(n.id));
          return r;
        })
      );
      if (!rows.length) {
        const e = el('div', 'nempty');
        e.append(nIcon(NI.note), el('b', null, 'No notes yet'), el('span', null, 'Start one with New note.'));
        nRows.append(e);
      }
    }

    // ---- opening, creating, closing
    function noteRandom() {
      const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const v = new Uint32Array(16);
      crypto.getRandomValues(v);
      return Array.from(v, x => A[x % 62]).join('');
    }
    function showEditor(on) {
      NOTE.view = on ? 'editor' : 'list';
      nList.hidden = on;
      nEd.hidden = !on;
      closeStyleMenu(false);
      closeLink(false);
      closeCourseMenu();
      syncHead();
      if (!on) renderNotes();
    }
    function loadNote(id, doc) {
      NOTE.open = id;
      NOTE.doc = doc;
      NOTE.blocks = E.noteBlocks(doc ? doc.blocks : []);
      NOTE.course = doc ? (doc.course === undefined ? null : doc.course) : defaultCourse();
      NOTE.undo = [];
      NOTE.redo = [];
      NOTE.pend = null;
      NOTE.dirty = false;
      NOTE.state = 'saved';
      NOTE.edited = doc ? doc.editedAt || doc.at : null;
      showEditor(true);
      paintMeta();
      notePaint({ a: { b: 0, o: 0 }, f: { b: 0, o: 0 } }, false);
      updateBar();
    }
    async function openNote(id) {
      await flushNote();
      const doc = (S.notes || []).find(n => n.id === id);
      if (!doc) return;
      const { id: _drop, ...data } = doc;
      void _drop;
      loadNote(id, data);
      nScroll.scrollTop = 0;
      window.scrollTo(0, 0);
      const last = NOTE.blocks.length - 1;
      body.focus();
      setNoteSel({ a: { b: last, o: E.noteText(NOTE.blocks[last]).length } });
    }
    async function newNote() {
      await flushNote();
      const at = now();
      const id = E.newNoteId(at, noteRandom());
      loadNote(id, null);
      NOTE.dirty = true; // a new note is written at once, so it is in the record before a word is typed
      body.focus();
      setNoteSel({ a: { b: 0, o: 0 } });
      saveNote();
    }
    async function closeNote() {
      await flushNote();
      showEditor(false);
    }

    // ---- painting the blocks, and positions between the model and the editable
    const nh = (tag, attrs, kids) => {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      e.append(...kids);
      return e;
    };
    const nt = t => document.createTextNode(t);
    function nCheck(on) {
      const c = el('span', 'n-chk' + (on ? ' done' : ''));
      c.contentEditable = 'false';
      c.setAttribute('data-nb-skip', '');
      c.setAttribute('role', 'checkbox');
      c.setAttribute('aria-checked', String(!!on));
      c.setAttribute('aria-label', 'Done');
      c.append(nIcon(NI.tick));
      return c;
    }
    function notePaint(sel, focus = true) {
      const nodes = E.noteRender(NOTE.blocks, nh, nt);
      nodes.forEach((n, i) => {
        if (NOTE.blocks[i].type === 'todo') n.prepend(nCheck(NOTE.blocks[i].checked));
      });
      body.replaceChildren(...nodes);
      body.classList.toggle(
        'empty',
        NOTE.blocks.length === 1 && !E.noteText(NOTE.blocks[0]) && NOTE.blocks[0].type === 'p'
      );
      if (sel && focus) setNoteSel(sel);
      syncHead();
    }
    const canonical = () =>
      body.childNodes.length === NOTE.blocks.length &&
      [...body.childNodes].every(
        (n, i) =>
          n.nodeType === 1 &&
          n.getAttribute('data-t') === NOTE.blocks[i].type &&
          !n.querySelector('p,div,h1,h2,h3,h4,h5,h6,li,ul,ol,[data-t],table')
      );
    const ZW = /[​‌‍⁠﻿]/g;
    /** A DOM position in the (canonical) editable as {b, o}. */
    function posOf(node, off) {
      if (!body.contains(node)) return null;
      if (node === body) {
        const b = Math.min(off, NOTE.blocks.length - 1);
        return { b, o: off >= body.childNodes.length ? E.noteText(NOTE.blocks[b]).length : 0 };
      }
      let blk = node;
      while (blk.parentNode !== body) blk = blk.parentNode;
      const b = [...body.childNodes].indexOf(blk);
      const r = document.createRange();
      r.setStart(blk, 0);
      try {
        r.setEnd(node, off);
      } catch (e) {
        return { b, o: 0 };
      }
      return { b, o: r.toString().replace(ZW, '').length };
    }
    function readSel() {
      const s = getSelection();
      if (!s || !s.rangeCount || !body.contains(s.anchorNode)) return NOTE.sel;
      if (!canonical()) return NOTE.sel;
      const a = posOf(s.anchorNode, s.anchorOffset),
        f = posOf(s.focusNode, s.focusOffset);
      return a && f ? { a, f } : NOTE.sel;
    }
    /** The DOM spot for {b, o}: in the text node holding it, the one before at a boundary (so typing keeps its marks). */
    function domAt(p) {
      const b = Math.max(0, Math.min(body.childNodes.length - 1, p.b));
      const blk = body.childNodes[b];
      if (!blk) return [body, 0];
      const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT, {
        acceptNode: n => (n.parentNode.closest('[data-nb-skip]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      let left = p.o,
        n,
        lastN = null;
      while ((n = w.nextNode())) {
        const len = n.nodeValue.length;
        if (left <= len) return [n, left];
        left -= len;
        lastN = n;
      }
      if (lastN) return [lastN, lastN.nodeValue.length];
      const skip = blk.firstChild && blk.firstChild.nodeType === 1 && blk.firstChild.hasAttribute('data-nb-skip');
      return [blk, skip ? 1 : 0];
    }
    function setNoteSel(sel) {
      const a = sel.a,
        f = sel.f || sel.a;
      const s = getSelection();
      const [an, ao] = domAt(a),
        [fn, fo] = domAt(f);
      try {
        s.setBaseAndExtent(an, ao, fn, fo);
      } catch (e) {
        /* a node gone while painting: the caret stays where it was */
      }
      NOTE.sel = { a: { ...a }, f: { ...f } };
    }
    const collapsed = sel => sel && sel.a.b === sel.f.b && sel.a.o === sel.f.o;
    const ordered = sel =>
      sel.a.b < sel.f.b || (sel.a.b === sel.f.b && sel.a.o <= sel.f.o) ? [sel.a, sel.f] : [sel.f, sel.a];

    // ---- undo and redo: snapshots of the blocks and the selection; typing in one burst is one step
    function remember(kind, sel) {
      const t = Date.now();
      const burst = kind === 'type' && NOTE.last.kind === 'type' && t - NOTE.last.at < 1200;
      NOTE.last = { kind, at: t };
      if (burst) return;
      NOTE.undo.push({ blocks: NOTE.blocks, sel: sel || NOTE.sel, course: NOTE.course });
      if (NOTE.undo.length > 200) NOTE.undo.shift();
      NOTE.redo = [];
    }
    function restore(from, to) {
      const snap = from.pop();
      if (!snap) return;
      to.push({ blocks: NOTE.blocks, sel: readSel() || NOTE.sel, course: NOTE.course });
      NOTE.blocks = snap.blocks;
      NOTE.course = snap.course;
      NOTE.last = { kind: '', at: 0 };
      NOTE.pend = null;
      body.focus();
      notePaint(snap.sel || { a: { b: 0, o: 0 } });
      paintMeta();
      noteChanged();
    }
    const noteUndo = () => restore(NOTE.undo, NOTE.redo);
    const noteRedo = () => restore(NOTE.redo, NOTE.undo);
    /** A model change: remembered for undo, painted, the caret placed, saved after the pause. */
    function apply(kind, r, sel) {
      if (!r) return;
      remember(kind, sel);
      NOTE.blocks = r.blocks;
      NOTE.pend = null;
      notePaint(r.sel || { a: r.pos });
      noteChanged();
    }

    // ---- the toolbar's state follows the selection
    function updateBar() {
      if (!NOTE.blocks) return;
      const sel = NOTE.sel || { a: { b: 0, o: 0 }, f: { b: 0, o: 0 } };
      const blk = NOTE.blocks[Math.min(sel.f.b, NOTE.blocks.length - 1)];
      const st = NSTYLES.find(x => x[0] === blk.type) || NSTYLES[0];
      bStyleGl.replaceChildren(nGlyph(st[2]));
      bStyleLb.textContent = st[1];
      bStyle.setAttribute('aria-label', 'Text style: ' + st[1]);
      stItems.forEach(b => {
        const on = b.dataset.style === st[0];
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
      const marks = collapsed(sel) ? NOTE.pend || E.noteMarksAt(blk, sel.f.o) : null;
      for (const [k, b] of Object.entries(fmtBtns)) {
        const on = marks ? !!marks[k] : E.noteHasMark(NOTE.blocks, sel, k);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
      const linked = marks ? !!marks.href : E.noteHasMark(NOTE.blocks, sel, 'href');
      bLink.classList.toggle('on', linked || !lkPop.hidden);
      bUndo.disabled = !NOTE.undo.length;
      bRedo.disabled = !NOTE.redo.length;
    }
    document.addEventListener('selectionchange', () => {
      if (NOTE.view !== 'editor' || document.activeElement !== body) return;
      const s = readSel();
      if (s && NOTE.sel && JSON.stringify(s) !== JSON.stringify(NOTE.sel)) NOTE.pend = null;
      NOTE.sel = s;
      updateBar();
    });

    // ---- styles, marks and links
    function noteSetStyle(type) {
      const sel = readSel() || NOTE.sel;
      if (!sel) return;
      body.focus();
      const blocks = E.noteSetType(NOTE.blocks, sel, type);
      apply('style', { blocks, sel }, sel);
    }
    function noteToggleMark(k) {
      body.focus();
      const sel = readSel() || NOTE.sel;
      if (!sel) return;
      if (collapsed(sel)) {
        // nothing selected: the next characters typed take the mark (or lose it)
        const cur = NOTE.pend || E.noteMarksAt(NOTE.blocks[sel.f.b], sel.f.o);
        NOTE.pend = { ...cur, [k]: !cur[k] };
        if (!NOTE.pend[k]) delete NOTE.pend[k];
        setNoteSel(sel);
        updateBar();
        return;
      }
      apply('mark', { blocks: E.noteSetMark(NOTE.blocks, sel, k), sel }, sel);
      updateBar();
    }
    function toggleLink() {
      if (!lkPop.hidden) return closeLink(true);
      closeStyleMenu(false);
      NOTE.linkSel = readSel() || NOTE.sel;
      const sel = NOTE.linkSel;
      const blk = sel && NOTE.blocks[sel.f.b];
      const m = sel && collapsed(sel) ? E.noteMarksAt(blk, sel.f.o) : {};
      lkIn.value = m.href || '';
      lkErr.textContent = '';
      lkPop.hidden = false;
      bLink.setAttribute('aria-expanded', 'true');
      bLink.classList.add('on');
      lkIn.focus();
    }
    function closeLink(refocus) {
      if (lkPop.hidden) return;
      lkPop.hidden = true;
      bLink.setAttribute('aria-expanded', 'false');
      if (refocus) {
        body.focus();
        if (NOTE.linkSel) setNoteSel(NOTE.linkSel);
      }
      updateBar();
    }
    function addLink() {
      let h = lkIn.value.trim();
      if (h && !/^[a-z][a-z0-9+.-]*:/i.test(h)) h = 'https://' + h;
      const sel = NOTE.linkSel;
      if (!sel) return closeLink(true);
      if (h && !/^https?:\/\/[^\s<>"]+$/.test(h)) {
        lkErr.textContent = 'Only a web link (http or https).';
        return;
      }
      lkPop.hidden = true;
      bLink.setAttribute('aria-expanded', 'false');
      body.focus();
      if (collapsed(sel)) {
        if (!h) return setNoteSel(sel);
        // nothing selected: the link goes in as its own text
        const r = E.noteInsertText(NOTE.blocks, sel, h, { ...E.noteMarksAt(NOTE.blocks[sel.f.b], sel.f.o), href: h });
        return apply('link', r, sel);
      }
      const blocks = E.noteSetMark(NOTE.blocks, sel, 'href', h || false);
      if (blocks) apply('link', { blocks, sel }, sel);
    }
    lkPop.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLink(true);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        addLink();
      }
    });
    function toggleStyleMenu() {
      if (!stMenu.hidden) return closeStyleMenu(true);
      closeLink(false);
      NOTE.menuSel = readSel() || NOTE.sel;
      stMenu.hidden = false;
      bStyle.setAttribute('aria-expanded', 'true');
      (stMenu.querySelector('.mi.on') || stItems[0]).focus();
    }
    function closeStyleMenu(refocus) {
      if (stMenu.hidden) return;
      stMenu.hidden = true;
      bStyle.setAttribute('aria-expanded', 'false');
      if (refocus) {
        body.focus();
        if (NOTE.menuSel) setNoteSel(NOTE.menuSel);
      } else if (NOTE.menuSel && NOTE.view === 'editor') {
        body.focus();
        setNoteSel(NOTE.menuSel);
      }
    }
    stMenu.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeStyleMenu(true);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = stItems.indexOf(document.activeElement);
        stItems[(i + (e.key === 'ArrowDown' ? 1 : -1) + stItems.length) % stItems.length].focus();
      }
    });
    document.addEventListener('mousedown', e => {
      if (!stMenu.hidden && !stMenu.contains(e.target) && !bStyle.contains(e.target)) closeStyleMenu(false);
      if (!lkPop.hidden && !lkPop.contains(e.target) && !bLink.contains(e.target)) closeLink(false);
      if (!courseMenu.hidden && !courseMenu.contains(e.target) && !bCourse.contains(e.target)) closeCourseMenu();
    });

    // ---- the course: one of spec.courses, or none
    function paintMeta() {
      bCourse.replaceChildren(el('span', null, NOTE.course || 'No course'), nIcon(NI.chev));
      bCourse.setAttribute('aria-label', 'Course: ' + (NOTE.course || 'none') + '. Change it');
      const lab = NOTE.doc && NOTE.doc.label;
      mLabel.textContent = lab || '';
      mLabel.hidden = !lab;
      mEdited.textContent = NOTE.edited ? 'Edited ' + editedText(NOTE.edited) : 'New';
    }
    function toggleCourseMenu() {
      if (!courseMenu.hidden) return closeCourseMenu();
      courseMenu.replaceChildren(
        ...[...courseKeys(), null].map(k => {
          const b = el('button', 'mi' + (k === NOTE.course ? ' on' : ''), k || 'No course');
          b.type = 'button';
          b.setAttribute('role', 'menuitemradio');
          b.setAttribute('aria-checked', String(k === NOTE.course));
          b.addEventListener('click', () => {
            closeCourseMenu();
            if (k === NOTE.course) return;
            remember('course');
            NOTE.course = k;
            paintMeta();
            noteChanged();
          });
          return b;
        })
      );
      courseMenu.hidden = false;
      bCourse.setAttribute('aria-expanded', 'true');
      courseMenu.querySelector('button').focus();
    }
    function closeCourseMenu() {
      courseMenu.hidden = true;
      bCourse.setAttribute('aria-expanded', 'false');
    }
    courseMenu.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCourseMenu();
        bCourse.focus();
      }
    });

    // ---- typing: the browser types; the page reads it back, and owns Enter, joins, paste, cut, undo and shortcuts
    let lastTyped = '';
    function syncFromDom(kind) {
      const s = getSelection();
      const track =
        s && s.rangeCount
          ? [
              { node: s.anchorNode, offset: s.anchorOffset },
              { node: s.focusNode, offset: s.focusOffset },
            ]
          : [];
      const before = NOTE.sel;
      const r = E.noteFromTree(body, { track });
      const pos = r.at[1] || r.at[0] || { b: 0, o: 0 };
      const sel = { a: r.at[0] || pos, f: pos };
      remember(kind, before);
      NOTE.blocks = r.blocks;
      if (kind === 'type' && lastTyped === ' ' && collapsed(sel)) {
        const sc = E.noteShortcut(NOTE.blocks[pos.b], pos.o);
        if (sc) {
          // the marker typed and its space are their own undo step
          NOTE.undo.push({ blocks: NOTE.blocks, sel, course: NOTE.course });
          NOTE.last = { kind: '', at: 0 };
          NOTE.blocks = NOTE.blocks.map((b, i) => (i === pos.b ? sc.block : b));
          notePaint({ a: { b: pos.b, o: sc.o } });
          return noteChanged();
        }
      }
      if (!canonical()) notePaint(sel);
      else NOTE.sel = sel;
      noteChanged();
    }
    body.addEventListener('beforeinput', e => {
      const t = e.inputType;
      if (t === 'historyUndo' || t === 'historyRedo') {
        e.preventDefault();
        return t === 'historyUndo' ? noteUndo() : noteRedo();
      }
      if (/^format/.test(t)) {
        e.preventDefault();
        const k = { formatBold: 'b', formatItalic: 'i', formatUnderline: 'u', formatStrikeThrough: 's' }[t];
        if (k) noteToggleMark(k);
        return;
      }
      if (e.isComposing) return;
      const sel = readSel();
      if (!sel) return;
      lastTyped = t === 'insertText' ? e.data || '' : '';
      const multi = sel.a.b !== sel.f.b;
      if (t === 'insertParagraph' || t === 'insertLineBreak') {
        e.preventDefault();
        return apply('enter', E.noteEnter(NOTE.blocks, sel), sel);
      }
      if (t === 'insertText' && (multi || (NOTE.pend && collapsed(sel)))) {
        e.preventDefault();
        const marks = collapsed(sel) ? NOTE.pend : null;
        const r = E.noteInsertText(NOTE.blocks, sel, e.data || '', marks);
        apply('type', r, sel);
        if (marks) NOTE.pend = null;
        return;
      }
      if (/^delete/.test(t) && t !== 'deleteByCut' && t !== 'deleteByDrag') {
        const back = /Backward$/.test(t);
        if (multi) {
          e.preventDefault();
          return apply('delete', E.noteDelete(NOTE.blocks, sel), sel);
        }
        if (collapsed(sel) && back && sel.f.o === 0) {
          e.preventDefault();
          return apply('delete', E.noteBackspaceStart(NOTE.blocks, sel.f.b), sel);
        }
        if (collapsed(sel) && !back && sel.f.o === E.noteText(NOTE.blocks[sel.f.b]).length) {
          e.preventDefault();
          return apply('delete', E.noteJoin(NOTE.blocks, sel.f.b), sel);
        }
      }
      if (t === 'insertFromDrop' || t === 'deleteByDrag') e.preventDefault();
    });
    body.addEventListener('input', e => {
      if (e.isComposing) return;
      syncFromDom(e.inputType === 'insertText' ? 'type' : 'edit');
    });
    body.addEventListener('compositionend', () => syncFromDom('type'));
    body.addEventListener('dragstart', e => e.preventDefault());
    body.addEventListener('drop', e => e.preventDefault());
    const NOTE_MIME = 'application/x-ev-note+json';
    function clip(e, cut) {
      const sel = readSel();
      if (!sel || collapsed(sel) || !e.clipboardData) return;
      e.preventDefault();
      const c = E.noteCopy(NOTE.blocks, sel);
      e.clipboardData.setData('text/plain', c.text);
      e.clipboardData.setData(NOTE_MIME, JSON.stringify(c.blocks));
      if (cut) apply('delete', E.noteDelete(NOTE.blocks, sel), sel);
    }
    body.addEventListener('copy', e => clip(e, false));
    body.addEventListener('cut', e => clip(e, true));
    body.addEventListener('paste', e => {
      e.preventDefault();
      const sel = readSel();
      const d = e.clipboardData;
      if (!sel || !d) return;
      const pasted = E.notePaste({
        json: d.getData(NOTE_MIME),
        html: d.getData('text/html'),
        text: d.getData('text/plain'),
      });
      apply('paste', E.noteInsertBlocks(NOTE.blocks, sel, pasted), sel);
    });
    // a checklist tick, and a link opened with ⌘ or Ctrl held (a plain click puts the caret in it)
    body.addEventListener('mousedown', e => {
      if (e.target.closest('.n-chk')) e.preventDefault();
    });
    body.addEventListener('click', e => {
      const c = e.target.closest('.n-chk');
      if (c) {
        const b = [...body.childNodes].indexOf(c.parentNode);
        if (b < 0) return;
        const sel = readSel() || NOTE.sel;
        const blocks = NOTE.blocks.map((x, i) => (i === b ? { ...x, checked: !x.checked } : x));
        return apply('tick', { blocks, sel }, sel);
      }
      const a = e.target.closest('a[href]');
      if (a && (e.metaKey || e.ctrlKey) && /^https?:\/\//.test(a.getAttribute('href'))) {
        e.preventDefault();
        window.open(a.getAttribute('href'), '_blank', 'noopener,noreferrer');
      }
    });
    body.addEventListener('keydown', e => {
      if (e.isComposing) return;
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      if (e.key === 'Tab') {
        const sel = readSel();
        if (sel && ['ul', 'ol', 'todo'].includes(NOTE.blocks[sel.f.b].type)) {
          e.preventDefault();
          return apply('indent', { blocks: E.noteIndent(NOTE.blocks, sel, e.shiftKey ? -1 : 1), sel }, sel);
        }
        return;
      }
      if (!mod) return;
      const code = e.code;
      let style = null;
      if (e.altKey && !e.shiftKey) style = { Digit0: 'p', Digit1: 'h1', Digit2: 'h2', Digit3: 'h3' }[code];
      if (e.shiftKey && !e.altKey) style = { KeyL: 'ul', Digit7: 'ol', Digit9: 'todo' }[code];
      if (style) {
        e.preventDefault();
        return noteSetStyle(style);
      }
      if (e.altKey) return;
      const k = e.shiftKey ? { KeyX: 's' }[code] : { KeyB: 'b', KeyI: 'i', KeyU: 'u' }[code];
      if (k) {
        e.preventDefault();
        return noteToggleMark(k);
      }
      if (code === 'KeyK' && !e.shiftKey) {
        e.preventDefault();
        return toggleLink();
      }
      if (code === 'KeyZ' || code === 'KeyY') {
        e.preventDefault();
        return code === 'KeyY' || e.shiftKey ? noteRedo() : noteUndo();
      }
    });

    // ---- saving: the whole note through write(), a pause after the last change; nothing typed is dropped on a refusal
    function noteChanged() {
      NOTE.dirty = true;
      NOTE.edited = now();
      clearTimeout(NOTE.timer);
      NOTE.timer = setTimeout(saveNote, NOTE_SAVE_MS);
      if (NOTE.state !== 'failed') NOTE.state = 'saving';
      updateBar();
      syncHead();
    }
    function saveNote() {
      clearTimeout(NOTE.timer);
      if (!NOTE.open || !NOTE.dirty) return NOTE.saving || Promise.resolve();
      if (NOTE.saving) {
        NOTE.again = true;
        return NOTE.saving;
      }
      const id = NOTE.open;
      const at = now();
      const doc = E.noteDoc(NOTE.doc, { blocks: NOTE.blocks, course: NOTE.course, at, source: 'E.V. Home' });
      const bytes = new Blob([JSON.stringify(doc)]).size;
      if (bytes > NOTE_BYTES) {
        NOTE.state = 'failed';
        NOTE.why =
          'This note is too long to save (' +
          Math.round(bytes / 1024) +
          ' KB of ' +
          NOTE_BYTES / 1024 +
          '). Split it into two notes.';
        syncHead();
        return Promise.resolve();
      }
      NOTE.dirty = false;
      NOTE.state = 'saving';
      syncHead();
      NOTE.saving = write({ op: 'set', collection: 'notes', id, data: doc })
        .then(
          () => {
            if (NOTE.open === id) {
              NOTE.doc = doc;
              if (!NOTE.dirty) NOTE.state = 'saved';
              NOTE.why = '';
              paintMeta();
            }
          },
          e => {
            if (NOTE.open === id) {
              NOTE.dirty = true; // the text stays in the editor and goes with the next save
              NOTE.state = 'failed';
              NOTE.why = 'Couldn’t save: ' + ((e && (e.message || e.code)) || 'error');
              clearTimeout(NOTE.timer);
              NOTE.timer = setTimeout(saveNote, NOTE_RETRY_MS);
            } else toast('Couldn’t save your note: ' + ((e && (e.message || e.code)) || 'error'));
          }
        )
        .finally(() => {
          NOTE.saving = null;
          syncHead();
          if (NOTE.again) {
            NOTE.again = false;
            if (NOTE.dirty && NOTE.open === id && NOTE.state !== 'failed') saveNote();
          }
        });
      return NOTE.saving;
    }
    /** Every pending change of the open note saved (before another note opens, or the view or page goes). */
    async function flushNote() {
      if (NOTE.saving) await NOTE.saving.catch(() => {});
      if (NOTE.dirty && NOTE.state !== 'failed') await saveNote();
    }
    window.addEventListener('pagehide', () => saveNote());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveNote();
    });
    window.addEventListener('beforeunload', e => {
      if (NOTE.dirty || NOTE.saving) {
        saveNote();
        e.preventDefault();
        e.returnValue = '';
      }
    });
