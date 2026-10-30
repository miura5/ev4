    // ------------------------------------------------------------ notes: the editor (B-402, D-325, D-327)
    // His notes, desktop only (1024 px and wider; the phone layout is unchanged). A page-less contenteditable whose
    // truth is the block model in core/notes.mjs: typing goes into the editable as the browser does it and is read back
    // into blocks; Enter, joins, styles, marks, links, paste, undo and redo change the blocks and repaint them. A paste
    // is read into blocks (never inserted as HTML), and the page writes text only as text nodes. Each change saves the
    // whole note through write() after a short pause; New note writes a fresh note at once, under an id with a random
    // part from crypto, so two devices never make the same one. The list here is the minimum way in: Notes' own list,
    // the L-frame strip and sessions are B-403, B-405 and B-406.
    const NOTE_BYTES = (EV_SPEC.capacity || {}).documentBytes || 262144; // the size write() and the Worker allow
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
      seen: new Set(), // B-404: the versions (their `at`) this editor knows: the one it opened and its own saves
      pick: null, // B-404 (D-326): the two versions after a stale save, until he picks one (and while Undo is offered)
      keeping: null, // B-404: the second note being written
      gen: 0, // B-404: one more each time another version replaces the editor's; a save made before it lands quietly
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
      syncing: 'M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6M18 3v4h-4M6 21v-4h4',
      offline: 'M8 18h9a4 4 0 0 0 1.2-7.8A6 6 0 0 0 7 9.2 4.4 4.4 0 0 0 8 18zM4 4l16 16',
      two: 'M8 3h7l3 3v11H8zM5 7v14h10',
      device: 'M5 6h14v9H5zM3 18h18',
      other: 'M8 3h8v18H8zM11 18h2',
      eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z',
      eyeOff: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM4 4l16 16',
    };
    // B-404: the app's connection, as its shim tells it (pwa/bridge.js 'ev-sync'); on claude.ai always online
    const NET = { online: true, pending: 0, syncing: false, refused: [] };
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
    // B-512 (D-376): every Notes button is Proprietary's Button, its old classes riding along (D-387)
    const nBtn = (cls, label, d, on) =>
      DS.button({ cls, ariaLabel: label || undefined, icon: d ? nIcon(d) : undefined, onClick: on || undefined });
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

    // ---- the list (B-403, the demo's NotesList board): the course filters and New note on the toolbar, his notes by
    // course, newest edited first, and the picked note's preview in the right panel (from 1200 px; under it, below)
    const NOTE_LIST = { filter: 'all', pick: null }; // the course shown ('all' or a spec.courses key) and the picked note
    const nList = el('div', 'panel n-list');
    nList.id = 'notes-list';
    const nListBar = el('div', 'n-toolbar');
    // B-512: the course filters are Proprietary's Segmented, made again on each paint (renderNotes)
    let nFilters = DS.segmented({ label: 'Course', cls: 'n-filters' });
    nFilters.id = 'notes-filters';
    const nNew = nBtn('btn primary sm', null, NI.plus, () => newNote());
    nNew.id = 'notes-new';
    nNew.append('New note');
    nListBar.append(nFilters, el('span', 'sp'), nNew);
    const nRows = el('div', 'n-rows');
    nRows.id = 'notes-rows';
    const nCols = el('div', 'cols'),
      nMain = el('div', 'col-main'),
      nSide = el('div', 'col-side n-pv');
    nSide.id = 'notes-preview';
    nSide.setAttribute('aria-label', 'Preview');
    nMain.append(nRows);
    nCols.append(nMain, nSide);
    nList.append(nListBar, nCols);

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
    const nPick = el('div', 'n-pick'); // B-404 (D-326): the two versions, above his text, never changing a word of it
    nPick.hidden = true;
    nDoc.append(nMeta, nPick, body);
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
    // B-418 (D-339): E.V. reads along in the open note by default; this turns it off and on for the note, remembered
    // per note on this device. While it is off, nothing of the note goes to Claude between a session's checks.
    const raKey = id => 'readalong-off-' + id;
    const readAlongOn = id => !!id && store.get(raKey(id)) !== '1';
    const nRead = nBtn('btn ghost sm n-read', null, null, () => {
      const id = NOTE.open;
      if (!id) return;
      store.set(raKey(id), readAlongOn(id) ? '1' : '0');
      syncHead();
    });
    nRead.id = 'notes-read';
    nRead.hidden = true;
    if (mhTitle) {
      mhTitle.before(nBack);
      mhTitle.after(nCrumb);
      nCrumb.after(nSync);
      nSync.after(nRead);
    }
    function syncHead() {
      const on = document.body.dataset.view === 'notes' && NOTE.view === 'editor' && !!NOTE.open;
      nBack.hidden = nCrumb.hidden = nSync.hidden = nRead.hidden = !on;
      if (!on) return;
      const ra = readAlongOn(NOTE.open);
      nRead.replaceChildren(nIcon(ra ? NI.eye : NI.eyeOff), ra ? 'Reading along' : 'Not reading');
      nRead.setAttribute('aria-pressed', String(ra));
      nRead.title = ra
        ? 'E.V. reads along as you write this note. Click to turn it off for this note.'
        : 'E.V. isn’t reading this note. Click to have her read along as you write.';
      nCrumb.textContent = '/ ' + (E.noteTitleOf(NOTE.blocks || []) || 'New note').split(':')[0];
      // B-404: one quiet line in the same place in every state, as NoteStates shows it
      const refused = NET.refused.find(r => r.c === 'notes' && r.id === NOTE.open);
      const [text, icon, cls] =
        NOTE.pick && !NOTE.pick.kept
          ? ['Two versions · pick one', NI.two, 'warn']
          : NOTE.state === 'saving'
            ? ['Saving…', null, '']
            : NOTE.state === 'failed' || refused
              ? ['Not saved', null, 'bad']
              : !NET.online
                ? ['Offline · saved on this device', NI.offline, '']
                : NET.pending || NET.syncing
                  ? ['Syncing…', NI.syncing, '']
                  : ['Saved', NI.saved, ''];
      nSync.replaceChildren(...(icon ? [nIcon(icon)] : []), text);
      nSync.classList.toggle('bad', cls === 'bad');
      nSync.classList.toggle('warn', cls === 'warn');
      nSync.title =
        NOTE.state === 'failed'
          ? NOTE.why || ''
          : refused
            ? 'The record refused this note (' + refused.why + '). Your words are kept on this device.'
            : '';
    }
    // the view follows showTab (02) through the body's data-view; leaving Notes saves what is pending
    new MutationObserver(() => {
      if (document.body.dataset.view !== 'notes') saveNote();
      syncHead();
    }).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });

    // ---- desktop only: no Notes entry below 1024 px, and no way into it by address
    function notesWidth() {
      const wide = WIDE.matches && !READ_ONLY; // the claude.ai page after the cutover writes nothing (B-320)
      if (notesTab) notesTab.hidden = !wide;
      if (!wide && ui.tab === 'notes') {
        saveNote();
        showTab('ev');
      }
    }
    WIDE.addEventListener('change', notesWidth);
    notesWidth();
    window.addEventListener('hashchange', () => {
      if (location.hash === '#notes' && (!WIDE.matches || READ_ONLY)) showTab('ev');
    });
    if (location.hash === '#notes' && WIDE.matches && !READ_ONLY) showTab('notes'); // 02 opened the address before Notes existed

    // ---- the list
    const NO_COURSE = '\u0000none'; // the group key of notes in no course (shown under All only)
    const noteWords = n => (n.blocks || []).reduce((t, b) => t + (E.noteText(b).match(/[^\s]+/g) || []).length, 0);
    const listWhen = iso => {
      const d = iso ? new Date(iso) : null;
      if (!d || isNaN(d)) return '';
      const day = E.chicagoDate(d);
      if (day === today) return clock12(iso);
      return day === E.addDays(today, -1) ? 'Yesterday' : short(day);
    };
    const longWhen = iso => {
      const d = iso ? new Date(iso) : null;
      if (!d || isNaN(d)) return '';
      const day = E.chicagoDate(d);
      const at = clock12(iso);
      return (day === today ? 'Today' : day === E.addDays(today, -1) ? 'Yesterday' : short(day)) + ', ' + at;
    };
    // the last session that studied this note (sessions name it, D-325): its minutes and day, as the demo says it
    function noteStudied(id) {
      const s = (S.sessions || [])
        .filter(x => x && x.status !== 'discarded' && (x.note === 'notes/' + id || x.noteId === id) && x.date)
        .sort((a, b) => String(b.date + (b.at || '')).localeCompare(String(a.date + (a.at || ''))))[0];
      if (!s) return 'Not yet';
      if (s.status === 'active') return 'Now';
      const day = s.date === today ? 'today' : s.date === E.addDays(today, -1) ? 'yesterday' : WD3[E.weekday(s.date)];
      return (s.minutes > 0 ? durFmt(s.minutes) + ', ' : '') + day;
    }
    const courseName = k => (k === NO_COURSE ? 'No course' : k);
    function renderNotes() {
      noteFollow();
      syncHead();
      if (NOTE.view !== 'list') return;
      const all = (S.notes || [])
        .filter(n => !n.archivedAt && !n.discardedAt)
        .sort((a, b) => String(b.editedAt || b.at || '').localeCompare(String(a.editedAt || a.at || '')));
      // B-409: an "(earlier)" note (earlierOf, D-326) sits directly below the note it copies
      const kept = new Set(all.map(n => n.id));
      const isCopy = n => !!(n.earlierOf && kept.has(n.earlierOf) && n.earlierOf !== n.id);
      const tops = all.filter(n => !isCopy(n));
      all.splice(0, all.length, ...tops.flatMap(n => [n, ...all.filter(c => isCopy(c) && c.earlierOf === n.id)]));
      const keyOf = n => (n.course && typeof n.course === 'string' ? n.course : NO_COURSE);
      // the filters: All, then each active course (and any course a note names), with its count
      const known = courseKeys().filter(k => (EV_SPEC.courses[k] || {}).status !== 'done');
      const order = [...known, ...all.map(keyOf).filter(k => k !== NO_COURSE && !known.includes(k))].filter(
        (k, i, a) => a.indexOf(k) === i
      );
      if (NOTE_LIST.filter !== 'all' && !order.includes(NOTE_LIST.filter)) NOTE_LIST.filter = 'all';
      const keys = ['all', ...order];
      const seg = DS.segmented({
        label: 'Course',
        cls: 'n-filters',
        value: NOTE_LIST.filter,
        options: keys.map(k => ({
          value: k,
          label: k === 'all' ? 'All' : k,
          count: k === 'all' ? all.length : all.filter(n => keyOf(n) === k).length,
        })),
        onPick: k => {
          NOTE_LIST.filter = k;
          renderNotes();
        },
      });
      seg.id = 'notes-filters';
      [...seg.children].forEach((b, i) => (b.dataset.filter = keys[i]));
      nFilters.replaceWith(seg);
      nFilters = seg;
      const shown = all.filter(n => NOTE_LIST.filter === 'all' || keyOf(n) === NOTE_LIST.filter);
      // a filter that hides the picked note moves the preview to the first note shown
      // B-409: never an "(earlier)" copy by default
      const pick = shown.find(n => n.id === NOTE_LIST.pick) || shown.find(n => !n.earlierOf) || shown[0] || null;
      const groups = [...order, NO_COURSE]
        .map(k => ({ k, rows: shown.filter(n => keyOf(n) === k) }))
        .filter(g => g.rows.length);
      const rowOf = n => {
        // B-512: the row keeps today's markup (Line's own rules would move it, D-376); data-key names the note (D-387)
        const r = el('div', 'li n-row' + (pick && pick.id === n.id ? ' sel' : ''));
        r.dataset.key = n.id;
        r.dataset.part = 'row';
        r.dataset.note = n.id;
        const nm = el('button', 'nm', noteName(n));
        nm.type = 'button';
        nm.title = noteName(n);
        if (pick && pick.id === n.id) nm.setAttribute('aria-current', 'true');
        nm.addEventListener('click', () => {
          NOTE_LIST.pick = n.id;
          renderNotes();
        });
        nm.addEventListener('dblclick', () => openNote(n.id));
        const op = btn('Open', () => openNote(n.id), { cls: 'btn ghost sm hov n-open' });
        op.setAttribute('aria-label', 'Open ' + noteName(n));
        // B-410: a note the record refused (kept on this device only) says so in the list, as its header does
        const unsaved = NET.refused.some(x => x.c === 'notes' && x.id === n.id);
        r.append(
          nIcon(NI.note, 'ico sicon'),
          nm,
          op,
          ...(unsaved ? [el('span', 'mini n-unsaved', 'Not saved')] : []),
          el('span', 'mini nk', n.label || ''),
          el('span', 't', listWhen(n.editedAt || n.at))
        );
        return r;
      };
      nRows.replaceChildren(
        ...groups.flatMap(g => {
          const h = el('div', 'dayh n-grp', courseName(g.k));
          h.append(el('span', 'n', String(g.rows.length)));
          return [h, ...g.rows.map(rowOf)];
        })
      );
      const empty = (title, line, act) => {
        const e = el('div', 'nempty');
        e.append(nIcon(NI.note), el('b', null, title), el('span', null, line));
        if (act) e.append(act);
        nRows.append(e);
      };
      if (!all.length)
        empty(
          'No notes yet',
          'A new note is where you study: it starts a 25-minute session, and E.V. follows along as you write.'
        );
      else if (!shown.length)
        empty(
          'No ' + courseName(NOTE_LIST.filter) + ' notes yet',
          'Notes for this course show here, newest first.',
          btn(
            'Show all notes',
            () => {
              NOTE_LIST.filter = 'all';
              renderNotes();
            },
            { cls: 'btn neutral sm' }
          )
        );
      renderPreview(pick, all.length);
    }
    // the right panel: the picked note's course, title, where it came from, when it was edited, its length, when he
    // last studied it and its sections, with Open note and Study with E.V.
    function renderPreview(n, any) {
      if (!n) {
        nSide.replaceChildren(
          el(
            'span',
            'mini n-pvnone',
            any
              ? 'Nothing to preview in this course.'
              : 'Your notes show here, by course, newest first. Start one with New note.'
          )
        );
        return;
      }
      const prop = (k, v) => {
        const p = el('div', 'prop');
        p.append(el('span', null, k), el('span', 'prop-v', v));
        return p;
      };
      const props = el('div', 'n-props');
      const words = noteWords(n);
      props.append(
        prop('From', n.label || '—'),
        prop('Edited', longWhen(n.editedAt || n.at)),
        prop('Length', words.toLocaleString('en-US') + (words === 1 ? ' word' : ' words')),
        prop('Studied', noteStudied(n.id))
      );
      const heads = (n.blocks || [])
        .filter(b => b && b.type === 'h2')
        .map(b => E.noteText(b).trim())
        .filter(Boolean);
      const outline = el('div', 'n-outline');
      // B-409: at most six entries, then "N more"
      const OTL_MAX = 6;
      const otl = heads.slice(0, OTL_MAX);
      outline.append(...(otl.length ? otl : ['No sections yet']).map(t => el('div', 'si static', t)));
      if (otl.length < heads.length)
        outline.append(el('div', 'si static n-otl-more', heads.length - otl.length + ' more'));
      const acts = el('div', 'n-acts');
      const bOpen = btn('Open note', () => openNote(n.id), { cls: 'btn neutral wide' });
      bOpen.id = 'notes-pv-open';
      const bStudy = nBtn('btn neutral wide', null, 'M8 5l11 7-11 7z', () => studyNote(n.id));
      bStudy.id = 'notes-pv-study';
      bStudy.append('Study with E.V.');
      acts.append(bOpen, bStudy);
      nSide.replaceChildren(
        DS.badge({ course: courseName(n.course || NO_COURSE) }),
        el('h2', 'n-pvt', noteName(n)),
        props,
        el('span', 'lab n-otl', 'On this page'),
        outline,
        acts,
        el(
          'span',
          'mini n-pvfoot',
          'You study where you write: a new note starts a session, and E.V. follows along beside it. She never edits your note.'
        )
      );
    }
    // Study with E.V. opens the note; the session itself is B-406's, which listens for this event
    async function studyNote(id) {
      await openNote(id);
      if (NOTE.open === id) document.dispatchEvent(new CustomEvent('ev:note-study', { detail: { id } }));
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
      const ask = !on && document.getElementById('note-ask'); // B-442: the Ask E.V. chip goes with the editor
      if (ask) ask.hidden = true;
      closeStyleMenu(false);
      closeLink(false);
      closeCourseMenu();
      syncHead();
      renderFrame(); // B-409: the strip's suggestion and the pop-up's words follow the open note
      if (!on) {
        renderNotes();
        // B-441: the list shows from its top: no scroller in Notes is left at the long note's place (in Safari the
        // pane read as blank, the list above the view)
        const top = () => {
          window.scrollTo(0, 0);
          for (const e of [document.scrollingElement, pane(), nList, nScroll, ...nList.querySelectorAll('*')])
            if (e && e.scrollTop) e.scrollTop = 0;
        };
        top();
        requestAnimationFrame(top);
      }
    }
    function loadNote(id, doc) {
      NOTE.open = id;
      nEd.dataset.note = id; // B-520: the open note's id, written or not yet (an empty new note never is)
      NOTE.doc = doc;
      NOTE.blocks = E.noteBlocks(doc ? doc.blocks : []);
      NOTE.course = doc ? (doc.course === undefined ? null : doc.course) : defaultCourse();
      NOTE.undo = [];
      NOTE.redo = [];
      NOTE.pend = null;
      NOTE.dirty = false;
      NOTE.state = 'saved';
      NOTE.why = '';
      NOTE.seen = new Set(doc && doc.at ? [doc.at] : []);
      NOTE.pick = null;
      NOTE.edited = doc ? doc.editedAt || doc.at : null;
      paintPick();
      showEditor(true);
      paintMeta();
      notePaint({ a: { b: 0, o: 0 }, f: { b: 0, o: 0 } }, false);
      updateBar();
    }
    async function openNote(id) {
      if (!(await flushNote())) return;
      const doc = (S.notes || []).find(n => n.id === id);
      if (!doc) return;
      const { id: _drop, ...data } = doc;
      void _drop;
      loadNote(id, data);
      nScroll.scrollTop = 0;
      paneTo(0);
      const last = NOTE.blocks.length - 1;
      body.focus();
      setNoteSel({ a: { b: last, o: E.noteText(NOTE.blocks[last]).length } });
    }
    /** B-520 (F-46): the course a new note takes: the one asked for, else the course Notes is filtered to. */
    const newNoteCourse = course =>
      course !== undefined ? course : NOTE_LIST.filter !== 'all' ? NOTE_LIST.filter : defaultCourse();
    async function newNote(from, { course, title = '' } = {}) {
      const was = from && from.tab ? from : whereNow(); // B-406: where he was, for the session's Undo
      if (!(await flushNote())) return;
      const at = now();
      const id = E.newNoteId(at, noteRandom());
      loadNote(id, null);
      NOTE.course = newNoteCourse(course);
      paintMeta();
      // B-440: a new note opens on its title line, a heading 1 that reads a grey "Untitled" until he names it; B-520: a
      // note task's Write opens it titled as the task
      const t = String(title || '')
        .replace(/\s+/g, ' ')
        .trim();
      NOTE.blocks = [{ type: 'h1', runs: t ? [{ text: t }] : [] }, ...(t ? [{ type: 'p', runs: [] }] : [])];
      notePaint({ a: { b: 0, o: 0 } }, false);
      updateBar();
      NOTE.doc = { createdAt: at }; // written once (noteProblem): every save of this note carries the same createdAt
      // B-520 (F-46): a new note is written once it has words (a task's title counts); an empty one never is, so leaving
      // it leaves nothing behind (nothing deleted)
      NOTE.dirty = !!t;
      body.focus();
      setNoteSel(t ? { a: { b: 1, o: 0 } } : { a: { b: 0, o: 0 } });
      saveNote();
      await noteSession(id, true, was).catch(e =>
        toast('Couldn’t start the session: ' + ((e && (e.message || e.code)) || 'error'))
      ); // B-406: a new note starts a session
    }
    async function closeNote() {
      if (!(await flushNote())) return;
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
      syncEmpty();
      if (sel && focus) setNoteSel(sel);
      syncHead();
    }
    // B-440: the placeholders follow every change, typed or painted (the hint used to stay over his first words until
    // the next repaint): a grey "Untitled" in an empty first heading 1, and the hint under it while the note is empty
    function syncEmpty() {
      const first = NOTE.blocks && NOTE.blocks[0];
      const blank = !!first && !E.noteText(first);
      body.classList.toggle('untitled', blank && first.type === 'h1');
      body.classList.toggle('empty', blank && NOTE.blocks.length === 1 && (first.type === 'p' || first.type === 'h1'));
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
    // A change past notes.schema.json's limits (4000 lines, 400 runs a line) or past the size a save may write is
    // refused here, with a line saying why, and the note stays as it was: never cut short, never refused only at save.
    // A note already past a limit (made elsewhere) can still be cut down: only a change that leaves it past a limit and
    // larger than it is now is refused.
    function apply(kind, r, sel) {
      if (!r) return;
      const why = E.noteFits(r.blocks) || noteTooBig(r.blocks);
      if (why && !noteShrinks(r.blocks)) {
        toast(why);
        if (sel) setNoteSel(sel);
        return;
      }
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
    // B-442: words selected in the note offer Ask E.V., which opens the chat with them quoted in its box
    const askChip = el('button', 'btn neutral sm n-ask', 'Ask E.V.');
    askChip.type = 'button';
    askChip.id = 'note-ask';
    askChip.hidden = true;
    askChip.setAttribute('aria-label', 'Ask E.V. about the selected words');
    askChip.addEventListener('mousedown', e => e.preventDefault()); // the selection stays
    askChip.addEventListener('click', () => {
      const q = String(getSelection() || '');
      askChip.hidden = true;
      popQuote(q);
    });
    document.body.append(askChip);
    function placeAsk() {
      const s = getSelection();
      const on =
        NOTE.view === 'editor' &&
        !nEd.hidden &&
        ui.tab === 'notes' &&
        !notesPanel.hidden &&
        s &&
        s.rangeCount &&
        !s.isCollapsed &&
        body.contains(s.anchorNode) &&
        body.contains(s.focusNode) &&
        String(s).trim().length > 1;
      if (!on) {
        askChip.hidden = true;
        return;
      }
      const r = s.getRangeAt(0).getBoundingClientRect();
      askChip.hidden = false;
      const w = askChip.offsetWidth || 80,
        h = askChip.offsetHeight || 28;
      askChip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
      askChip.style.top = (r.bottom + h + 12 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    }
    document.addEventListener('selectionchange', placeAsk);
    nScroll.addEventListener('scroll', placeAsk, { passive: true });

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
      if (h && !/^https?:\/\/[^\s<>\x22]+$/.test(h)) {
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
      syncEmpty();
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
      // B-439: the formatting as HTML too (the editor's own tree, which a paste reads back): Safari doesn't carry a custom
      // type like NOTE_MIME across a copy, so without it a paste here got the plain text only
      e.clipboardData.setData('text/html', E.noteHtml(c.blocks));
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
      if (NOTE.pick && NOTE.pick.kept) closePick(); // Undo swaps whole versions: offered only until he writes again
      NOTE.dirty = true;
      NOTE.edited = now();
      noteTyped(NOTE.open); // B-438: a writing session's clock goes on at his first keystroke after a pause
      clearTimeout(NOTE.timer);
      NOTE.timer = setTimeout(saveNote, NOTE_SAVE_MS);
      if (NOTE.state !== 'failed') NOTE.state = 'saving';
      updateBar();
      syncHead();
    }
    /** The size the note's saved document would be, in bytes, for these blocks. */
    const noteBytes = blocks =>
      new Blob([JSON.stringify(E.noteDoc(NOTE.doc, { blocks, course: NOTE.course, at: now(), source: 'E.V. Home' }))])
        .size;
    // B-404 review: a note is saved only with room left under the cap for it to become a second note, '<title>
    // (earlier)' with its earlierOf link (D-326), so a stale save can always be kept whole; the Worker's cap is unchanged
    const NOTE_ROOM = 256;
    /** Why these blocks are too big to save, or '' (the cap write() and the Worker hold a note to, less NOTE_ROOM). */
    function noteTooBig(blocks) {
      const bytes = noteBytes(blocks);
      if (bytes <= NOTE_BYTES - NOTE_ROOM) return '';
      // B-410: in tenths of a KB, the size rounded up and the limit down, so a note just over the limit never reads as
      // equal to it (it read '256 KB of 256')
      const kb = (b, round) => (round((b / 1024) * 10) / 10).toFixed(1);
      return (
        'This note would be too long to save: ' +
        kb(bytes, Math.ceil) +
        ' KB, and a note holds up to ' +
        kb(NOTE_BYTES - NOTE_ROOM, Math.floor) +
        ' KB. Start a new note for the rest.'
      );
    }
    const maxRuns = blocks => blocks.reduce((m, b) => Math.max(m, b.runs.length), 0);
    /** These blocks are no further past any limit than the note is now: no more lines, runs a line, or bytes. */
    const noteShrinks = blocks =>
      !!NOTE.blocks &&
      blocks.length <= NOTE.blocks.length &&
      maxRuns(blocks) <= maxRuns(NOTE.blocks) &&
      noteBytes(blocks) <= noteBytes(NOTE.blocks);

    // ---- B-404 (D-326): a note changed elsewhere is never merged. When the version in the record is one this editor
    // does not know while he has unsaved words, both are kept at once: the newer stays the note, his becomes a second
    // note '<title> (earlier)' linked to it, and the two-versions picker shows. With nothing unsaved the newer one is
    // simply shown (that is sync, not a conflict).
    /** The open note as the record holds it now, when that is a version this editor does not know; else null. */
    function noteElsewhere() {
      if (!NOTE.open) return null;
      const cur = (S.notes || []).find(n => n.id === NOTE.open);
      if (!cur || !cur.at || NOTE.seen.has(cur.at)) return null;
      const { id: _drop, ...data } = cur;
      void _drop;
      return data;
    }
    const wordsOf = d =>
      JSON.stringify([E.noteBlocks(d.blocks || []), d.course === undefined ? null : d.course, d.label || '']);
    /** The same words (blocks, course and label): a version that holds them is no other device's. */
    const sameWords = (a, b) => !!a && !!b && wordsOf(a) === wordsOf(b);
    function noteFollow() {
      if (NOTE.view !== 'editor' || NOTE.saving || NOTE.keeping) return;
      const theirs = noteElsewhere();
      if (!theirs) return;
      if (NOTE.dirty && NOTE.doc && sameWords(theirs, NOTE.doc)) {
        // his own last save, landed by another way (sent from this device's outbox): his newer words go on from it
        NOTE.seen.add(theirs.at);
        NOTE.doc = theirs;
        return;
      }
      if (NOTE.dirty) return void keepBoth(theirs);
      NOTE.seen.add(theirs.at);
      showVersion(theirs);
    }
    /** `doc` in the editor in place of what it shows, the caret kept where it can be. */
    function showVersion(doc) {
      const sel = NOTE.sel;
      const focus = document.activeElement === body;
      // a version brought in ends any pick and its Undo: they were about the versions before it
      if (NOTE.pick) {
        NOTE.pick = null;
        paintPick();
      }
      NOTE.gen++;
      NOTE.doc = doc;
      NOTE.blocks = E.noteBlocks(doc.blocks);
      NOTE.course = doc.course === undefined ? null : doc.course;
      NOTE.edited = doc.editedAt || doc.at;
      NOTE.undo = [];
      NOTE.redo = [];
      NOTE.dirty = false;
      NOTE.state = 'saved';
      NOTE.why = '';
      const last = NOTE.blocks.length - 1;
      const clamp = p =>
        p && p.b <= last ? { b: p.b, o: Math.min(p.o, E.noteText(NOTE.blocks[p.b]).length) } : { b: 0, o: 0 };
      paintMeta();
      notePaint(sel ? { a: clamp(sel.a), f: clamp(sel.f || sel.a) } : { a: { b: 0, o: 0 } }, focus);
      updateBar();
      syncHead();
    }
    /** The second note's document: `blocks` as '<title> (earlier)', earlierOf the open note (prev: as it is stored). */
    const earlierDoc = (prev, blocks, at) =>
      E.noteDoc(prev, {
        blocks,
        course: prev.course === undefined ? NOTE.course : prev.course,
        at,
        source: 'E.V. Home',
      });
    /** The version in the record now, read from the record (a 409 can come before the page has seen it). */
    async function noteInRecord(id) {
      const snap = await db.collection('notes').doc(id).get();
      const d = snap && snap.exists ? snap.data() : null;
      return d ? Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'id')) : null;
    }
    /** D-326 on this page: his words (the editor's, all of them) written as the second note first, then the newer
     * version shown with the picker. A second note that can't be written leaves his words in the editor, unsaved. */
    function keepBoth(theirs) {
      if (NOTE.keeping) return NOTE.keeping;
      if (sameWords(theirs, { blocks: NOTE.blocks, course: NOTE.course, label: NOTE.doc && NOTE.doc.label })) {
        NOTE.seen.add(theirs.at); // the record already holds his words: nothing to keep twice
        showVersion(theirs);
        return Promise.resolve();
      }
      const big = noteTooBig(NOTE.blocks);
      if (big) {
        // his words can't be one note as they are: they stay here, unsaved, until he cuts them (D-332)
        NOTE.dirty = true;
        NOTE.state = 'failed';
        NOTE.why = big;
        syncHead();
        return Promise.resolve();
      }
      const id = NOTE.open;
      const at = now();
      const eid = E.newNoteId(at, noteRandom());
      const base = {
        createdAt: at,
        earlierOf: id,
        course: NOTE.course,
        ...(NOTE.doc && NOTE.doc.label ? { label: NOTE.doc.label } : {}),
      };
      clearTimeout(NOTE.timer);
      NOTE.state = 'saving';
      syncHead();
      const hisAt = NOTE.edited;
      NOTE.keeping = (async () => {
        let his;
        let doc = base;
        // words typed while the second note is written go into it too, until it holds the editor's last word
        while (NOTE.open === id && his !== NOTE.blocks) {
          his = NOTE.blocks;
          doc = earlierDoc(doc, his, now());
          await write({ op: 'set', collection: 'notes', id: eid, data: doc });
        }
        if (NOTE.open !== id) return;
        NOTE.seen.add(theirs.at);
        showVersion(theirs);
        openPick({ id, earlierId: eid, earlier: doc, his, hisAt, theirs, offline: false });
      })()
        .catch(e => {
          if (NOTE.open !== id)
            return toast('Couldn’t keep your version: ' + ((e && (e.message || e.code)) || 'error'));
          NOTE.dirty = true; // his words stay in the editor; the next save tries again
          NOTE.state = 'failed';
          NOTE.why = 'Couldn’t keep your version: ' + ((e && (e.message || e.code)) || 'error');
          NOTE.timer = setTimeout(saveNote, NOTE_RETRY_MS);
        })
        .finally(() => {
          NOTE.keeping = null;
          syncHead();
        });
      return NOTE.keeping;
    }
    // the app's shim kept a stale save from this device's outbox as the second note (pwa/bridge.js keepBoth)
    window.addEventListener('ev-note-kept', e => {
      const d = e.detail;
      if (!d || !d.current || NOTE.open !== d.id) return;
      const typed = NOTE.dirty && NOTE.blocks;
      NOTE.seen.add(d.current.at);
      let earlier = d.earlier;
      if (typed) {
        // words typed after the last save on this device go into the second note as well
        earlier = earlierDoc(d.earlier, typed, now());
        write({ op: 'set', collection: 'notes', id: d.earlierId, data: earlier }).catch(x =>
          toast('Couldn’t keep your last words: ' + ((x && (x.message || x.code)) || 'error'))
        );
      }
      clearTimeout(NOTE.timer);
      showVersion(d.current);
      openPick({
        id: d.id,
        earlierId: d.earlierId,
        earlier,
        his: typed || E.noteBlocks(d.earlier.blocks),
        hisAt: (typed && now()) || d.earlier.editedAt,
        theirs: d.current,
        offline: true,
        earlierAts: [d.earlier.at],
      });
    });
    window.addEventListener('ev-sync', e => {
      const d = e.detail || {};
      NET.online = d.online !== false;
      NET.pending = d.pending || 0;
      NET.syncing = !!d.syncing;
      NET.refused = Array.isArray(d.refused) ? d.refused : [];
      syncHead();
      if (NOTE.view === 'list') renderNotes(); // the list marks a refused note
    });

    // ---- the two-versions picker (NoteStates): this device's version and the other, each with Keep this version
    function openPick(p) {
      NOTE.pick = {
        ...p,
        his: E.noteBlocks(p.his),
        theirsBlocks: E.noteBlocks(p.theirs.blocks),
        kept: null,
        earlierSeen: new Set([p.earlier.at, ...(p.earlierAts || [])]), // the second note's versions this page wrote
      };
      paintPick();
      syncHead();
    }
    function closePick() {
      NOTE.pick = null;
      paintPick();
      syncHead();
    }
    const lineTexts = blocks => blocks.map(b => E.noteText(b).trim()).filter(Boolean);
    function verCard(name, icon, at, blocks, other, keep) {
      const o = new Set(lineTexts(other));
      const v = el('div', 'ver');
      const head = el('div', 'vrow');
      const who = el('span', 'vwho');
      who.append(nIcon(icon, 'ico sicon'), el('b', null, name));
      head.append(who, el('span', 'mini', at ? 'Edited ' + editedText(at) : ''));
      const x = el('div', 'vx');
      const shown = blocks.filter(b => E.noteText(b).trim());
      const only = shown.filter(b => !o.has(E.noteText(b).trim()));
      const list = shown.length <= 8 ? shown : [...new Set([...only, ...shown])].slice(0, 8);
      for (const b of list)
        x.append(
          el(
            'span',
            /^h[123]$/.test(b.type)
              ? 'vt' + (o.has(E.noteText(b).trim()) ? '' : ' only')
              : 'vl' + (only.includes(b) ? ' only' : ''),
            E.noteText(b)
          )
        );
      if (shown.length > list.length)
        x.append(el('span', 'mini', 'and ' + (shown.length - list.length) + ' more lines'));
      const n = only.length;
      const b = btn('Keep this version', keep, { cls: 'btn neutral sm' });
      v.append(
        head,
        x,
        el(
          'span',
          'mini',
          n ? n + (n === 1 ? ' line' : ' lines') + ' only in this version' : 'No line only in this version'
        ),
        b
      );
      return v;
    }
    function paintPick() {
      const p = NOTE.pick;
      nPick.hidden = !p;
      if (!p) return nPick.replaceChildren();
      const earlierName = noteName(p.earlier);
      if (p.kept) {
        const line = el('div', 'endline');
        line.setAttribute('role', 'status');
        line.append(
          el(
            'span',
            'sp',
            p.kept === 'his'
              ? 'Kept this device’s version. The other device’s version is saved as a second note, “' +
                  earlierName +
                  '”.'
              : 'Kept the other device’s version. This device’s version is saved as a second note, “' +
                  earlierName +
                  '”.'
          ),
          btn('Undo', () => undoPick(), { cls: 'btn ghost sm' })
        );
        return nPick.replaceChildren(line);
      }
      const box = el('div', 'vpick');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Two versions of this note');
      const h = el('div', 'vh');
      const words = el('div', 'vhw');
      words.append(
        el(
          'b',
          null,
          p.offline
            ? 'This note changed on two devices while both were offline.'
            : 'This note changed on another device while you were writing.'
        ),
        el(
          'span',
          null,
          'E.V. doesn’t merge them. Pick the one to keep here; the other is saved as a second note, so nothing is lost.'
        )
      );
      h.append(nIcon(NI.two), words);
      const grid = el('div', 'vgrid');
      grid.append(
        verCard('This device', NI.device, p.hisAt, p.his, p.theirsBlocks, () => keepVersion('his')),
        verCard('Another device', NI.other, p.theirs.editedAt || p.theirs.at, p.theirsBlocks, p.his, () =>
          keepVersion('theirs')
        )
      );
      box.append(h, grid);
      nPick.replaceChildren(box);
    }
    /**
     * The two notes' words swapped: the note takes what the second note holds now, and the second note takes what the
     * note holds now (NOTE.blocks: words typed into the shown version included, so nothing is dropped). A version of
     * the note from elsewhere goes through keepBoth instead (false: a new pick opens); a second note changed elsewhere
     * keeps its words, and the note's go into a new second note.
     */
    async function swapVersions() {
      const p = NOTE.pick;
      const theirs = noteElsewhere();
      if (theirs) {
        NOTE.dirty = true;
        await keepBoth(theirs);
        return false;
      }
      const stored = (S.notes || []).find(n => n.id === p.earlierId);
      const cur = stored ? Object.fromEntries(Object.entries(stored).filter(([k]) => k !== 'id')) : p.earlier;
      const at = now();
      const mine = NOTE.blocks;
      let eid = p.earlierId;
      let prev = cur;
      if (!p.earlierSeen.has(cur.at)) {
        eid = E.newNoteId(at, noteRandom());
        prev = {
          createdAt: at,
          earlierOf: NOTE.open,
          course: NOTE.course,
          ...(NOTE.doc && NOTE.doc.label ? { label: NOTE.doc.label } : {}),
        };
      }
      const edoc = earlierDoc(prev, mine, at);
      await write({ op: 'set', collection: 'notes', id: eid, data: edoc });
      p.earlierId = eid;
      p.earlier = edoc;
      p.earlierSeen.add(edoc.at);
      NOTE.blocks = E.noteBlocks(cur.blocks);
      NOTE.undo = [];
      NOTE.redo = [];
      notePaint({ a: { b: 0, o: 0 } }, false);
      NOTE.dirty = true;
      NOTE.edited = at;
      await saveNote();
      return true;
    }
    /** Keep this version: his swaps the two notes' words; the other's leaves both as they are. Undo is offered. */
    async function keepVersion(which) {
      const p = NOTE.pick;
      if (!p || p.kept) return;
      if (which === 'his') {
        try {
          if (!(await swapVersions())) return;
        } catch (e) {
          return toast('Couldn’t swap the versions: ' + ((e && (e.message || e.code)) || 'error'));
        }
      }
      if (NOTE.pick !== p) return;
      p.kept = which;
      paintPick();
      syncHead();
    }
    async function undoPick() {
      const p = NOTE.pick;
      if (!p || !p.kept) return;
      if (p.kept === 'his') {
        try {
          if (!(await swapVersions())) return;
        } catch (e) {
          return toast('Couldn’t undo: ' + ((e && (e.message || e.code)) || 'error'));
        }
      }
      if (NOTE.pick !== p) return;
      p.kept = null;
      paintPick();
      syncHead();
    }

    function saveNote() {
      clearTimeout(NOTE.timer);
      if (!NOTE.open || !NOTE.dirty) return NOTE.saving || NOTE.keeping || Promise.resolve();
      if (NOTE.keeping) return NOTE.keeping;
      // B-520 (F-46): a new note with no words yet is not written; its first words write it
      if (!(NOTE.doc && NOTE.doc.at) && !NOTE.saving && E.noteBlank(NOTE.blocks)) {
        NOTE.dirty = false;
        NOTE.state = 'saved';
        syncHead();
        return Promise.resolve();
      }
      if (NOTE.saving) {
        NOTE.again = true;
        return NOTE.saving;
      }
      // D-326: never written over a version from elsewhere; both are kept instead
      const theirs = noteElsewhere();
      if (theirs) return keepBoth(theirs);
      const big = noteTooBig(NOTE.blocks);
      if (big) {
        NOTE.state = 'failed';
        NOTE.why = big;
        syncHead();
        return Promise.resolve();
      }
      const id = NOTE.open;
      const at = now();
      const doc = E.noteDoc(NOTE.doc, { blocks: NOTE.blocks, course: NOTE.course, at, source: 'E.V. Home' });
      NOTE.seen.add(at); // known before the write lands: the record may show it before write() answers
      const gen = NOTE.gen;
      NOTE.dirty = false;
      NOTE.state = 'saving';
      syncHead();
      let stale = null;
      NOTE.saving = write({ op: 'set', collection: 'notes', id, data: doc })
        .then(
          () => {
            if (NOTE.open === id && NOTE.gen === gen) {
              NOTE.doc = doc;
              if (!NOTE.dirty) NOTE.state = 'saved';
              NOTE.why = '';
              paintMeta();
            }
          },
          e => {
            if (NOTE.open === id && NOTE.gen !== gen) {
              // another version took the editor while this save was out (the shim kept both): nothing more to do
            } else if (NOTE.open === id && e && (e.conflict || e.code === 'conflict')) {
              // a stale save (409): another device wrote it since. Never tried again over it (D-326): both are kept.
              NOTE.dirty = true;
              stale = e.current || true;
            } else if (NOTE.open === id) {
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
            if (!stale && NOTE.dirty && NOTE.open === id && NOTE.state !== 'failed') saveNote();
          }
        });
      return NOTE.saving.then(async () => {
        if (!stale || NOTE.open !== id) return;
        const theirs = stale === true ? noteElsewhere() || (await noteInRecord(id).catch(() => null)) : stale;
        if (theirs && NOTE.open === id) await keepBoth(theirs);
        else if (NOTE.open === id && NOTE.gen === gen) {
          // B-409: the other version couldn't be read: say so, keep his text, and try again shortly
          NOTE.state = 'failed';
          NOTE.why = 'Not saved: changed elsewhere, and that version couldn’t be read yet';
          clearTimeout(NOTE.timer);
          NOTE.timer = setTimeout(saveNote, NOTE_RETRY_MS);
          syncHead();
        }
      });
    }
    /** Every pending change of the open note saved (before another note opens, or the view or page goes). */
    /**
     * Every pending change of the open note saved, before another note opens or the editor closes; a refused save is
     * tried once more here. false while the note is still not saved: it stays open with its text, and he is told why.
     */
    async function flushNote() {
      if (NOTE.saving) await NOTE.saving.catch(() => {});
      if (NOTE.keeping) await NOTE.keeping.catch(() => {});
      if (NOTE.dirty) await saveNote();
      if (NOTE.saving) await NOTE.saving.catch(() => {});
      if (NOTE.keeping) await NOTE.keeping.catch(() => {});
      if (!NOTE.open || !NOTE.dirty) return true;
      toast('This note isn’t saved yet, so it stays open. ' + (NOTE.why || ''));
      return false;
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
