    // ------------------------------------------------------------ B-487 (D-368): flashcard decks
    // Study's Flashcards card per course lists its decks (title, cards, due today); a deck opens in one sheet: its
    // cards (+ New card, Edit, Retire; nothing deleted) and a session in Flip (term, Show answer, Again / Hard / Good /
    // Easy with the next interval under each, keys 1 to 4) or Multiple choice (a wrong pick is Again; a right one asks
    // Hard / Good / Easy). Each rating is one card's update through core's composer (E.deckReview), merged into the deck
    // as it is now. Today's "Cards · n due" opens a session over every course's due cards.
    // B-488: Written (the definition; he types the term, forgiving of case, spacing, punctuation and a small typo) and
    // Learn (rounds of about 7 cards, each climbing from Multiple choice to Written; only a card's first answer in the
    // session writes its rating). The last mode he used on a deck is remembered in this browser (store: try/catch).
    const FC = { view: 'deck', deck: null, edit: null, s: null, local: {} };
    const MODES = [
      ['flip', 'Flip'],
      ['mc', 'Multiple choice'],
      ['written', 'Written'],
      ['learn', 'Learn'],
    ];
    const MODE_NAME = Object.fromEntries(MODES);
    const modeOf = id => {
      const m = store.get('fc-mode-' + id);
      return MODE_NAME[m] ? m : 'flip';
    };
    /** A mode needs this many cards: Multiple choice and Learn need a second card's definition. */
    const modeMin = m => (m === 'mc' || m === 'learn' ? 2 : 1);
    const deckById = id => S.decks.find(d => d.id === id) || null;
    const liveDecks = () => S.decks.filter(d => d && !d.retired);
    const decksOf = course => liveDecks().filter(d => (d.course || E.defaultCourse()) === course);
    const dueIn = d => E.cardsDue([d], today).length;
    /** The card as this tab last rated it (the record may still be catching up). */
    const fcCard = (deckId, id) => FC.local[deckId + '/' + id] || ((deckById(deckId) || {}).cards || {})[id] || null;
    function renderStudyDecks(course) {
      course = course || E.defaultCourse();
      let card = $('ov-decks');
      if (!card) {
        card = DS.card({ cls: 'ov-sets ov-decks' });
        card.id = 'ov-decks';
        $('ov-grid').append(card);
      } else if (card.nextElementSibling) $('ov-grid').append(card); // after Practice sets
      card.hidden = false;
      const decks = decksOf(course).sort((a, b) =>
        String(b.createdAt || b.at || '').localeCompare(String(a.createdAt || a.at || ''))
      );
      const hd = el('div', 'up-head');
      const due = decks.reduce((n, d) => n + dueIn(d), 0);
      const right = el('span', 'fc-hr');
      right.append(
        el('span', 'mini', decks.length ? due + ' due today' : ''),
        btn('Import', () => openImport(course), { cls: 'btn ghost sm fc-import' }),
        btn('New deck', () => openDeckNew(course), { cls: 'btn ghost sm fc-newdeck' })
      );
      hd.append(el('span', 'lab', 'Flashcards'), right);
      const list = el('div', 'st-list');
      for (const d of decks) {
        const n = E.deckCards(d).length,
          k = dueIn(d);
        const r = el('div', 'st-row');
        r.dataset.key = d.id;
        const b = el('button', 'st');
        b.type = 'button';
        const nm = el('span', 'sn');
        nm.append(el('span', 'stt', d.title || d.id), el('span', 'sm', plural(n, 'card')));
        b.append(
          nm,
          el('span', 'ss' + (k ? ' fin' : ''), k ? k + ' due' : n ? 'Done for today' : 'No cards'),
          el(
            'span',
            'sd',
            d.createdAt ? (E.chicagoDate(d.createdAt) === today ? 'Today' : dayMonth(E.chicagoDate(d.createdAt))) : ''
          )
        );
        b.setAttribute('aria-label', 'Open deck ' + (d.title || d.id));
        b.addEventListener('click', () => openDeck(d.id));
        const slot = el('span', 'sx');
        if (k) {
          const sel = el('select', 'fc-mode');
          sel.setAttribute('aria-label', 'Mode for ' + (d.title || d.id));
          for (const [m, name] of MODES) {
            const o = el('option', null, name);
            o.value = m;
            o.disabled = n < modeMin(m);
            sel.append(o);
          }
          sel.value = n >= modeMin(modeOf(d.id)) ? modeOf(d.id) : 'flip';
          sel.addEventListener('change', () => store.set('fc-mode-' + d.id, sel.value));
          const go = btn('Study', () => startCards([d.id], sel.value), { cls: 'btn ghost sm' });
          go.setAttribute('aria-label', 'Study ' + (d.title || d.id));
          slot.append(sel, go);
        }
        r.append(b, slot);
        list.append(r);
      }
      if (!decks.length)
        list.append(el('p', 'empty fc-none', 'No decks yet. Ask E.V. for flashcards on a topic, or start one here.'));
      card.replaceChildren(hd, list);
      const dlg = $('fc-dlg');
      if (dlg && dlg.open && FC.view === 'deck') paintDeck();
    }
    /** The one sheet decks open in. */
    function fcDialog() {
      let d = $('fc-dlg');
      if (d) return d;
      // B-511: a Proprietary Sheet (a native dialog: Esc, a tap on the backdrop, focus back to what opened it); each
      // view paints its own head and body into it, so its parts start empty; the old classes ride along (D-376)
      d = DS.sheet({
        label: 'Flashcards',
        cls: 'new-dlg fc-dlg',
        onClose: () => {
          FC.s = null;
          FC.edit = null;
          render();
          // the deck's row is painted anew on the next frame, so focus goes back to its new button then (B-511)
          const deck = FC.deck;
          requestAnimationFrame(() => {
            const box = document.activeElement === document.body && deck && $('ov-decks');
            const row = box && [...box.querySelectorAll('.st-row')].find(x => x.dataset.key === deck);
            if (row) row.querySelector('.st').focus();
          });
        },
      });
      d.replaceChildren();
      d.id = 'fc-dlg';
      d.addEventListener('keydown', fcKey);
      document.body.append(d);
      return d;
    }
    function fcShow() {
      const d = fcDialog();
      if (!d.open) d.showModal();
      return d;
    }
    function openDeck(id) {
      FC.addEv = false;
      FC.deck = id;
      FC.view = 'deck';
      FC.edit = null;
      FC.s = null;
      fcShow();
      paintDeck();
    }
    function openDeckNew(course) {
      FC.view = 'new';
      FC.newCourse = course;
      fcShow();
      paintNewDeck();
    }
    // B-489: Import from Quizlet: his pasted export text, split by core (E.quizletParse) with a preview, made into a new
    // deck or added to one of the course's decks (only new cards; a term the deck has is left out). Nothing is fetched
    // from or sent to Quizlet, and no model reads it.
    function openImport(course) {
      FC.view = 'import';
      FC.imp = { course, text: '', sep: 'auto', custom: '', dest: 'new', title: '' };
      fcShow();
      paintImport();
    }
    function importParsed() {
      const m = FC.imp;
      const sep = m.sep === 'auto' ? null : m.sep === 'custom' ? m.custom || null : m.sep;
      const p = E.quizletParse(m.text, sep);
      const deck = m.dest !== 'new' && deckById(m.dest);
      if (!deck) return { ...p, add: Math.min(p.items.length, E.IMPORT_MAX), dupes: 0, deck: null };
      const r = E.deckCardsAdd(deck, p.items, now());
      return { ...p, add: r.added, dupes: r.dupes, deck };
    }
    function paintImport() {
      const d = fcDialog();
      const m = FC.imp;
      const f = el('form', 'fc-body fc-imp');
      f.addEventListener('submit', e => e.preventDefault());
      f.append(
        fcHead('Import from Quizlet', m.course),
        el(
          'p',
          'meta fc-ihint',
          'In Quizlet, open the set, choose Export and copy the text. Paste it here: one card per line. Nothing is sent to Quizlet.'
        )
      );
      const ta = el('textarea', 'fc-in fc-paste');
      ta.rows = 6;
      ta.placeholder = 'Term<tab>Definition, one card per line';
      ta.setAttribute('aria-label', 'Quizlet export text');
      ta.value = m.text;
      const opts = el('div', 'fc-iopts');
      const sel = (label, cls, list, val, on) => {
        const w = el('label', 'fc-iopt');
        const x = el('select', cls);
        for (const [v, t] of list) {
          const o = el('option', null, t);
          o.value = v;
          x.append(o);
        }
        x.value = val;
        x.addEventListener('change', () => on(x.value));
        w.append(el('span', 'lab', label), x);
        return w;
      };
      opts.append(
        sel(
          'Between term and definition',
          'fc-sep',
          [
            ['auto', 'Tab or comma'],
            ['tab', 'Tab'],
            ['comma', 'Comma'],
            ['custom', 'Custom'],
          ],
          m.sep,
          v => ((m.sep = v), paintImport())
        ),
        sel(
          'Into',
          'fc-dest',
          [['new', 'A new deck'], ...decksOf(m.course).map(x => [x.id, x.title || x.id])],
          m.dest,
          v => ((m.dest = v), paintImport())
        )
      );
      if (m.sep === 'custom') {
        const c = el('input', 'fc-in fc-custom');
        c.type = 'text';
        c.placeholder = 'e.g. -';
        c.setAttribute('aria-label', 'Custom separator');
        c.value = m.custom;
        c.addEventListener('input', () => ((m.custom = c.value), preview()));
        opts.append(c);
      }
      let ti = null;
      if (m.dest === 'new') {
        ti = el('input', 'fc-in fc-ititle');
        ti.type = 'text';
        ti.placeholder = 'Deck title';
        ti.setAttribute('aria-label', 'Deck title');
        ti.value = m.title;
        ti.addEventListener('input', () => (m.title = ti.value));
      }
      const pv = el('div', 'fc-prev');
      const go = btn('Import', ev => importSave(ev, ti), { primary: true });
      go.classList.add('fc-igo');
      function preview() {
        const r = importParsed();
        const lines = [];
        if (m.text.trim()) {
          let t = plural(r.add, 'card') + ' to import';
          if (r.skipped) t += ' · ' + plural(r.skipped, 'line') + ' without a term and definition skipped';
          if (r.dupes) t += ' · ' + r.dupes + ' already in the deck, left out';
          if (r.items.length - r.dupes > E.IMPORT_MAX) t += ' · the first ' + E.IMPORT_MAX + ' only';
          lines.push(el('span', 'meta fc-pn', t));
        }
        const list = el('div', 'fc-list');
        for (const it of r.items.slice(0, 5)) {
          const row = el('div', 'fc-row');
          const tx = el('div', 'fc-tx');
          tx.append(el('span', 'fc-term', it.term), el('span', 'fc-def', it.definition));
          row.append(tx);
          list.append(row);
        }
        if (r.items.length > 5) list.append(el('p', 'meta fc-more', 'and ' + (r.items.length - 5) + ' more'));
        pv.replaceChildren(...lines, ...(r.items.length ? [list] : []));
        go.textContent = r.add ? 'Import ' + plural(r.add, 'card') : 'Import';
        go.disabled = !r.add;
      }
      ta.addEventListener('input', () => ((m.text = ta.value), preview()));
      const ft = el('div', 'new-foot');
      ft.append(
        btn('Cancel', () => d.close(), { cls: 'btn neutral' }),
        go
      );
      f.append(ta, opts);
      if (ti) f.append(ti);
      f.append(pv, ft);
      preview();
      const had = document.activeElement && document.activeElement.className;
      d.replaceChildren(f);
      const back = had && f.querySelector('select.' + String(had).split(' ')[0]);
      (back || ta).focus({ preventScroll: true });
    }
    function importSave(ev, ti) {
      const m = FC.imp;
      const r = importParsed();
      if (!r.add) return;
      if (!r.deck && !m.title.trim()) return ti && ti.focus();
      guard(ev.currentTarget, async () => {
        let id;
        if (r.deck) {
          await write(E.deckCardsAdd(r.deck, r.items, now()).write);
          id = r.deck.id;
        } else {
          const at = now();
          id = E.deckNew({ title: m.title, course: m.course, now: at }).id;
          await write(
            E.deckNew({
              title: m.title,
              course: m.course,
              items: r.items,
              source: 'Quizlet paste',
              now: at,
              id,
              max: E.IMPORT_MAX,
            })
          );
        }
        toast(plural(r.add, 'card') + ' imported');
        openDeck(id);
      });
    }
    function fcHead(title, sub) {
      const h = el('div', 'fc-head');
      const t = el('div', 'fc-ht');
      t.append(el('h2', null, title));
      if (sub) t.append(el('span', 'meta', sub));
      const x = btn('Close', () => $('fc-dlg').close(), { cls: 'btn ghost sm fc-x' });
      h.append(t, x);
      return h;
    }
    function paintNewDeck() {
      const d = fcDialog();
      const f = el('form', 'fc-body');
      f.addEventListener('submit', e => e.preventDefault());
      const inp = el('input', 'fc-in');
      inp.id = 'fc-title';
      inp.placeholder = 'Deck title, e.g. Cardiac meds';
      inp.setAttribute('aria-label', 'Deck title');
      const ft = el('div', 'new-foot');
      ft.append(
        btn('Cancel', () => d.close(), { cls: 'btn neutral' }),
        btn(
          'Make deck',
          ev => {
            const title = inp.value.trim();
            if (!title) return inp.focus();
            const w = E.deckNew({ title, course: FC.newCourse, now: now() });
            guard(ev.currentTarget, async () => {
              await write(E.deckNew({ title, course: FC.newCourse, now: w.data.at, id: w.id }));
              FC.deck = w.id;
              FC.view = 'deck';
              FC.edit = 'new';
              paintDeck();
            });
          },
          { primary: true }
        )
      );
      f.append(fcHead('New deck', FC.newCourse), inp, ft);
      d.replaceChildren(f);
      inp.focus();
    }
    /** The deck's sheet: study buttons, then its cards with + New card, Edit and Retire. */
    function paintDeck() {
      const d = fcDialog();
      const deck = deckById(FC.deck);
      if (!deck) return d.replaceChildren(fcHead('Deck'), el('p', 'empty', 'Loading the deck…'));
      const cards = E.deckCards(deck);
      const due = dueIn(deck);
      const body = el('div', 'fc-body');
      body.append(fcHead(deck.title, deck.course + ' · ' + plural(cards.length, 'card') + ' · ' + due + ' due'));
      const go = el('div', 'fc-go');
      const all = !due && cards.length;
      const last = modeOf(deck.id);
      for (const [m, name] of MODES)
        go.append(
          btn(name, () => startCards([deck.id], m, all), {
            cls: 'btn ' + (m === last ? 'primary' : 'neutral'),
            disabled: cards.length < modeMin(m),
          })
        );
      if (!due && cards.length)
        go.append(el('span', 'meta fc-note', 'Nothing due today: a run now still moves each card.'));
      else if (due) go.append(el('span', 'meta fc-note', 'A run takes the ' + plural(due, 'card') + ' due.'));
      body.append(go);
      const lh = el('div', 'fc-lh');
      const lr = el('span', 'fc-hr');
      lr.append(
        btn('Add with E.V.', () => ((FC.addEv = !FC.addEv), paintDeck()), { cls: 'btn ghost sm fc-addev' }),
        btn('New card', () => ((FC.edit = 'new'), paintDeck()), { cls: 'btn ghost sm' })
      );
      lh.append(el('span', 'lab', 'Cards'), lr);
      body.append(lh);
      if (FC.addEv) body.append(addEvForm(deck));
      const ul = el('div', 'fc-list');
      if (FC.edit === 'new') ul.append(cardForm(deck, null));
      for (const c of cards) ul.append(FC.edit === c.id ? cardForm(deck, c) : cardRow(deck, c));
      if (!cards.length && FC.edit !== 'new') ul.append(el('p', 'empty', 'No cards yet: add the first with New card.'));
      body.append(ul);
      const gone = Object.entries(deck.cards || {}).filter(([, c]) => c && c.retired);
      if (gone.length) {
        const o = !!FC.showRetired;
        body.append(
          foldLine('Retired · ' + gone.length, o, () => {
            FC.showRetired = !o;
            paintDeck();
          })
        );
        if (o)
          for (const [id, c] of gone) {
            const r = el('div', 'fc-row retired');
            const t = el('div', 'fc-tx');
            t.append(el('span', 'fc-term', c.term), el('span', 'fc-def', c.definition));
            r.append(
              t,
              btn(
                'Bring back',
                ev => guard(ev.currentTarget, () => write(E.deckCardRetire(deck, id, false, now())).then(paintDeck)),
                {
                  cls: 'btn ghost sm',
                }
              )
            );
            body.append(r);
          }
      }
      const keep = d.querySelector('.fc-body');
      const top = keep ? keep.scrollTop : 0;
      d.replaceChildren(body);
      body.scrollTop = top;
      const f = body.querySelector('.fc-form textarea');
      if (f) f.focus();
    }
    /**
     * B-496: Add with E.V.: a flashcards job that names this deck; its new cards join it (terms it has are left out) and
     * the cards it has keep their schedules. How many, and what they should cover (optional).
     */
    function addEvForm(deck) {
      const f = el('form', 'fc-row fc-form fc-addf');
      f.addEventListener('submit', e => e.preventDefault());
      const row = el('div', 'fc-iopts');
      const n = el('select', 'fc-addn');
      n.setAttribute('aria-label', 'How many cards');
      for (const k of [10, 20, 40, 100]) {
        const o = el('option', null, k + ' cards');
        o.value = String(k);
        n.append(o);
      }
      n.value = '20';
      const topic = el('input', 'fc-in fc-addt');
      topic.type = 'text';
      topic.placeholder = 'What they should cover (optional)';
      topic.setAttribute('aria-label', 'What the new cards should cover');
      row.append(n, topic);
      const a = el('div', 'fc-acts');
      a.append(
        btn('Cancel', () => ((FC.addEv = false), paintDeck()), { cls: 'btn ghost sm' }),
        btn(
          'Ask E.V.',
          ev => {
            const k = Number(n.value) || 20;
            const t = topic.value.replace(/\s+/g, ' ').trim().slice(0, 120);
            guard(ev.currentTarget, async () => {
              const r = await startJob({
                kind: 'flashcards',
                title: 'Flashcards: ' + deck.title,
                brief: `${k} more flashcards for the deck ${deck.title}${t ? ' on ' + t : ''}.`,
                course: deck.course,
                deck: deck.id,
              });
              FC.addEv = false;
              toast(
                r.fired.ok
                  ? `E.V. is making ${k} cards for ${deck.title}`
                  : 'Couldn’t start it: ' + fireCopy(r.fired.error)
              );
              paintDeck();
            });
          },
          { cls: 'btn primary sm' }
        )
      );
      f.append(row, a);
      return f;
    }
    function cardRow(deck, c) {
      const r = el('div', 'fc-row');
      const t = el('div', 'fc-tx');
      t.append(el('span', 'fc-term', c.term), el('span', 'fc-def', c.definition));
      if (c.verify) t.append(el('span', 'badge x-yellow fc-verify', 'Verify'));
      const due = !c.due || c.due <= today ? 'Due' : dayMonth(c.due);
      const a = el('div', 'fc-acts');
      a.append(
        el('span', 'meta fc-due', due),
        btn('Edit', () => ((FC.edit = c.id), paintDeck()), { cls: 'btn ghost sm' }),
        btn(
          'Retire',
          ev => guard(ev.currentTarget, () => write(E.deckCardRetire(deck, c.id, true, now())).then(paintDeck)),
          {
            cls: 'btn ghost sm',
          }
        )
      );
      a.lastChild.setAttribute('aria-label', 'Retire ' + c.term);
      r.append(t, a);
      return r;
    }
    function cardForm(deck, c) {
      const f = el('div', 'fc-row fc-form');
      const term = el('textarea', 'fc-in');
      term.rows = 1;
      term.placeholder = 'Term';
      term.setAttribute('aria-label', 'Term');
      term.value = c ? c.term : '';
      const def = el('textarea', 'fc-in');
      def.rows = 2;
      def.placeholder = 'Definition';
      def.setAttribute('aria-label', 'Definition');
      def.value = c ? c.definition : '';
      const a = el('div', 'fc-acts');
      a.append(
        btn('Cancel', () => ((FC.edit = null), paintDeck()), { cls: 'btn ghost sm' }),
        btn(
          c ? 'Save' : 'Add card',
          ev => {
            if (!term.value.trim() || !def.value.trim()) return (term.value.trim() ? def : term).focus();
            const v = { term: term.value, definition: def.value };
            guard(ev.currentTarget, async () => {
              if (c) await write(E.deckCardEdit(deck, c.id, v, now()));
              else await write(E.deckCardAdd(deck, v, now()));
              FC.edit = c ? null : 'new'; // a new card's form stays open for the next one
              paintDeck();
            });
          },
          { cls: 'btn primary sm' }
        )
      );
      f.append(term, def, a);
      return f;
    }
    // ---------------------------------------------------------------- a session
    /** Start a session over these decks' due cards (all of them when `all`), in Flip or Multiple choice. */
    function startCards(deckIds, mode, all) {
      const decks = deckIds.map(deckById).filter(Boolean);
      const queue = (
        all ? decks.flatMap(d => E.deckCards(d).map(c => ({ ...c, deck: d.id }))) : E.cardsDue(decks, today)
      ).map(c => ({ deck: c.deck, id: c.id }));
      if (deckIds.length === 1) store.set('fc-mode-' + deckIds[0], mode);
      FC.s = { decks: deckIds, mode, queue, i: 0, shown: false, picked: null, done: 0, again: 0, seed: now() };
      Object.assign(FC.s, { typed: '', verdict: null, prev: null, requeue: -1 });
      if (mode === 'learn') FC.s.learn = E.learnStart(queue);
      FC.view = 'study';
      fcShow();
      paintStudy();
    }
    /** Today's item: every course's due cards, Flip. */
    function startDueCards() {
      startCards(
        liveDecks()
          .filter(d => dueIn(d))
          .map(d => d.id),
        'flip'
      );
    }
    const RATE_LABEL = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
    function paintStudy() {
      const d = fcDialog();
      const s = FC.s;
      const body = el('div', 'fc-body fc-study');
      if (s && s.mode === 'learn') return paintLearn(d, body);
      const cur = s && s.queue[s.i];
      if (!cur) {
        const reviewed = s ? s.done : 0;
        body.append(
          fcHead('Done for now', plural(reviewed, 'card') + ' reviewed'),
          el(
            'p',
            'fc-end',
            reviewed
              ? 'Each card is scheduled. Due cards come back on Today.'
              : 'Nothing due right now. New cards and due ones show on Today.'
          )
        );
        const ft = el('div', 'new-foot');
        const back = FC.deck && deckById(FC.deck);
        if (back) ft.append(btn('Back to deck', () => openDeck(back.id), { cls: 'btn neutral' }));
        ft.append(btn('Close', () => d.close(), { primary: true }));
        body.append(ft);
        d.replaceChildren(body);
        ft.lastChild.focus();
        return;
      }
      const deck = deckById(cur.deck);
      const card = fcCard(cur.deck, cur.id);
      if (!deck || !card) {
        s.i++;
        return paintStudy();
      }
      const left = s.queue.length - s.i;
      body.append(fcHead(MODE_NAME[s.mode], deck.title + ' · ' + left + ' left'));
      const bar = el('div', 'fc-bar');
      const fill = el('i');
      fill.style.width = (100 * s.done) / Math.max(1, s.done + left) + '%';
      bar.append(fill);
      body.append(bar);
      const face = el('div', 'fc-card' + (s.shown ? ' shown' : ''));
      if (s.mode === 'written') {
        face.append(el('div', 'fc-q fc-dq', card.definition));
        body.append(face, ...writtenBlock(card, s, false), ...(s.verdict ? writtenActions(card, s) : []));
      } else if (s.mode === 'flip') {
        face.append(el('div', 'fc-q', card.term));
        if (s.shown) {
          face.append(el('div', 'fc-a', card.definition));
          if (card.verify) face.append(el('span', 'badge x-yellow fc-verify', 'Verify'));
        } else {
          face.setAttribute('role', 'button');
          face.tabIndex = 0;
          face.setAttribute('aria-label', 'Show answer');
          face.addEventListener('click', () => fcReveal());
        }
        body.append(face);
        if (!s.shown) {
          const sh = btn('Show answer', () => fcReveal(), { primary: true });
          sh.classList.add('fc-show');
          body.append(sh);
        } else body.append(rateRow(card, E.CARD_RATINGS));
      } else {
        face.append(el('div', 'fc-q', card.term));
        const ch = E.cardChoices(deck, cur.id, s.seed + s.i);
        body.append(
          face,
          mcBlock(ch, s.picked, k => fcPick(k, ch.correct))
        );
        if (s.picked != null && s.picked === ch.correct) body.append(rateRow(card, ['hard', 'good', 'easy']));
        else if (s.picked != null) {
          const nx = btn('Next', () => fcNext(), { primary: true });
          nx.classList.add('fc-show');
          body.append(el('p', 'meta fc-why', 'Counted as Again: it comes back this session.'), nx);
        }
      }
      d.replaceChildren(body);
      fcFocus(body);
    }
    /** Multiple choice's options; once one is picked, the right one and a wrong pick are marked. */
    function mcBlock(ch, picked, onPick) {
      const opts = el('div', 'fc-opts');
      ch.options.forEach((o, k) => {
        const done = picked != null;
        const cls =
          'fc-opt' +
          (done && k === ch.correct ? ' right' : '') +
          (done && k === picked && k !== ch.correct ? ' wrong' : '');
        const b = el('button', cls);
        b.type = 'button';
        b.append(el('span', 'fc-k', String(k + 1)), el('span', null, o));
        b.disabled = done;
        b.addEventListener('click', () => onPick(k));
        opts.append(b);
      });
      return opts;
    }
    // ---------------------------------------------------------------- Learn (B-488)
    /**
     * Learn: core's session (E.learnStart) says what is asked; s.lcur holds the card on screen until he moves on. A card's
     * first answer writes its rating (a miss Again at once; right asks Hard / Good / Easy), later ones write nothing.
     */
    function paintLearn(d, body) {
      const s = FC.s;
      const st = s.learn;
      if (!s.lcur && !s.ended) s.lcur = E.learnCur(st);
      const cur = s.lcur;
      const back = () => {
        const ft = el('div', 'new-foot');
        const b = FC.deck && deckById(FC.deck);
        if (b) ft.append(btn('Back to deck', () => openDeck(b.id), { cls: 'btn neutral' }));
        ft.append(btn('Close', () => d.close(), { primary: true }));
        return ft;
      };
      const bar = () => {
        const w = el('div', 'fc-lp');
        const b = el('div', 'fc-bar');
        const fill = el('i');
        fill.style.width = (100 * st.learned.length) / Math.max(1, st.total) + '%';
        b.append(fill);
        w.append(b, el('span', 'meta fc-lpn', st.learned.length + ' of ' + st.total + ' learned'));
        return w;
      };
      const termOf = k => (fcCard(k.deck, k.id) || {}).term || k.id;
      if (!cur || s.ended) {
        const sum = E.learnSummary(st);
        body.append(
          fcHead(sum.done === sum.total ? 'Learned' : 'Learn: so far', (deckById(FC.deck) || {}).title || 'Flashcards'),
          bar()
        );
        const list = (lab, items, note) => {
          if (!items.length) return;
          const box = el('div', 'fc-sum');
          box.append(el('span', 'lab', lab + ' · ' + items.length));
          const ul = el('ul', 'fc-sl');
          for (const k of items) {
            const li = el('li', null, termOf(k));
            if (note) li.append(el('span', 'meta', note(k)));
            ul.append(li);
          }
          box.append(ul);
          body.append(box);
        };
        list('Learned', sum.learned);
        list('Still shaky', sum.shaky, k =>
          k.missed ? 'missed ' + (k.missed === 1 ? 'once' : k.missed + ' times') : 'not learned yet'
        );
        if (!sum.total) body.append(el('p', 'fc-end', 'Nothing due right now. New cards and due ones show on Today.'));
        body.append(back());
        d.replaceChildren(body);
        body.querySelector('.new-foot').lastChild.focus();
        return;
      }
      if (cur.roundDone) {
        body.append(fcHead('Round ' + st.roundNo + ' done', plural(st.total - st.learned.length, 'card') + ' to go'));
        body.append(bar());
        const nx = btn('Next round', () => {
          E.learnNextRound(st);
          s.lcur = null;
          paintStudy();
        });
        nx.className = 'btn primary fc-show';
        body.append(nx);
        d.replaceChildren(body);
        nx.focus({ preventScroll: true });
        return;
      }
      const deck = deckById(cur.deck);
      const card = fcCard(cur.deck, cur.id);
      if (!deck || !card) {
        st.queue.shift(); // a card gone from the deck (retired elsewhere): out of the session
        st.total--;
        s.lcur = null;
        return paintStudy();
      }
      const stage = cur.stage === 'mc' ? 'Multiple choice' : 'Written';
      body.append(fcHead('Learn', deck.title + ' · round ' + st.roundNo), bar());
      const face = el('div', 'fc-card');
      face.append(el('span', 'meta fc-stage', stage));
      const res = s.lres; // the answer to the card on screen, once given
      if (cur.stage === 'mc') {
        face.append(el('div', 'fc-q', card.term));
        const ch = E.cardChoices(deck, cur.id, s.seed + st.roundNo + ':' + (st.rated[cur.deck + '/' + cur.id] ? 1 : 0));
        body.append(
          face,
          mcBlock(ch, s.picked, k => {
            if (s.picked != null) return;
            s.picked = k;
            learnGive(k === ch.correct);
          })
        );
      } else {
        face.append(el('div', 'fc-q fc-dq', card.definition));
        body.append(face, ...writtenBlock(card, s, true));
      }
      if (res) {
        if (res.right && res.first) body.append(rateRow(card, ['hard', 'good', 'easy'], r => learnRate(r)));
        else {
          const a = el('div', 'fc-wa');
          if (!res.right && cur.stage === 'written')
            a.append(btn('I was right', () => learnOver(), { cls: 'btn neutral fc-over' }));
          const nx = btn('Continue', () => learnMove(), { primary: true });
          nx.classList.add('fc-show');
          a.append(nx);
          body.append(
            el(
              'p',
              'meta fc-why',
              res.right
                ? res.learned
                  ? 'Learned.'
                  : 'Right: next time you write it.'
                : res.first
                  ? 'Counted as Again: it comes back in this round.'
                  : 'It comes back in this round.'
            ),
            a
          );
        }
      }
      const end = btn('End session', () => ((s.ended = true), paintStudy()), { cls: 'btn ghost sm fc-endl' });
      body.append(end);
      d.replaceChildren(body);
      fcFocus(body);
    }
    /** An answer in Learn: the session moves (core), and a card's first answer writes its rating (a miss is Again). */
    function learnGive(right) {
      const s = FC.s;
      const cur = s.lcur;
      const r = E.learnAnswer(s.learn, right);
      s.lres = { right, ...r };
      s.prev = null;
      if (r.first && !right) s.prev = (fcWriteRating(cur.deck, cur.id, 'again') || {}).prev || null;
      paintStudy();
    }
    function learnChecked() {
      learnGive(FC.s.verdict !== 'wrong');
    }
    /** I was right on a Written miss: counted right; when it was the card's first answer, its Again becomes Good. */
    function learnOver() {
      const s = FC.s;
      const cur = s.lcur;
      const r = E.learnOverride(s.learn);
      if (r.first && s.prev) fcWriteRating(cur.deck, cur.id, 'good', s.prev);
      s.verdict = 'exact';
      s.lres = { right: true, ...r, first: false };
      learnMove();
    }
    function learnRate(rating) {
      const cur = FC.s.lcur;
      fcWriteRating(cur.deck, cur.id, rating);
      learnMove();
    }
    function learnMove() {
      Object.assign(FC.s, { lcur: null, lres: null, picked: null, typed: '', verdict: null, prev: null });
      paintStudy();
    }
    function fcFocus(body) {
      const f = body.querySelector('.fc-type, .fc-show, .fc-rate button.good, .fc-opt:not([disabled])');
      if (f) f.focus({ preventScroll: true });
    }
    /**
     * Written: a field for the term with Check and Don't know; once checked, what he typed against the term. Right or
     * near (shown with the right spelling) asks Hard / Good / Easy when the answer is rated; a miss shows the answer
     * with I was right. In Written mode a miss is Again at once; in Learn the session says what is written.
     */
    function writtenBlock(card, s, learn) {
      if (!s.verdict) {
        const f = el('form', 'fc-wf');
        const inp = el('input', 'fc-in fc-type');
        inp.type = 'text';
        inp.placeholder = 'Type the term';
        inp.setAttribute('aria-label', 'Your answer');
        for (const [k, v] of [
          ['autocomplete', 'off'],
          ['autocapitalize', 'off'],
          ['autocorrect', 'off'],
          ['spellcheck', 'false'],
          ['enterkeyhint', 'done'],
        ])
          inp.setAttribute(k, v);
        inp.value = s.typed || '';
        const check = () => {
          s.typed = inp.value;
          s.verdict = E.answerMatch(card.term, inp.value).verdict;
          (learn ? learnChecked : writtenChecked)();
        };
        f.addEventListener('submit', e => (e.preventDefault(), inp.value.trim() ? check() : inp.focus()));
        const a = el('div', 'fc-wa');
        a.append(
          btn("Don't know", () => ((inp.value = ''), check()), { cls: 'btn ghost' }),
          btn('Check', () => f.requestSubmit(), { primary: true })
        );
        f.append(inp, a);
        return [f];
      }
      const out = [];
      const res = el('div', 'fc-res ' + s.verdict);
      if (s.verdict === 'exact') res.append(el('span', 'fc-rh', 'Correct'));
      else if (s.verdict === 'near') {
        res.append(el('span', 'fc-rh', 'Almost: check the spelling'), el('span', 'fc-ans', card.term));
        if (s.typed) res.append(el('span', 'meta fc-you', 'You wrote ' + s.typed));
      } else {
        res.append(el('span', 'fc-rh', s.typed.trim() ? 'Not quite' : 'The answer'), el('span', 'fc-ans', card.term));
        if (s.typed.trim()) res.append(el('span', 'meta fc-you', 'You wrote ' + s.typed));
      }
      out.push(res);
      return out;
    }
    /** Written mode, once checked: right or near asks Hard / Good / Easy; a miss is Again at once (I was right undoes it). */
    function writtenChecked() {
      const s = FC.s;
      if (s.verdict === 'wrong') fcSave('again', false);
      paintStudy();
    }
    function writtenActions(card, s) {
      if (s.verdict !== 'wrong') return [rateRow(card, ['hard', 'good', 'easy'])];
      const a = el('div', 'fc-wa');
      const nx = btn('Next', () => fcNext(), { primary: true });
      nx.classList.add('fc-show');
      a.append(
        btn('I was right', () => fcOverride(), { cls: 'btn neutral fc-over' }),
        nx
      );
      return [el('p', 'meta fc-why', 'Counted as Again: it comes back this session.'), a];
    }
    function rateRow(card, which, onRate = fcRate) {
      const lbl = E.cardNextLabels(card);
      const row = el('div', 'fc-rate');
      for (const r of which) {
        const n = E.CARD_RATINGS.indexOf(r) + 1;
        const b = el('button', 'btn neutral ' + r);
        b.type = 'button';
        b.append(el('span', 'fc-rl', RATE_LABEL[r]), el('span', 'fc-ri', lbl[r]));
        b.setAttribute('aria-label', RATE_LABEL[r] + ', next in ' + lbl[r] + ' (key ' + n + ')');
        b.addEventListener('click', () => onRate(r));
        row.append(b);
      }
      return row;
    }
    function fcReveal() {
      if (!FC.s || FC.s.shown) return;
      FC.s.shown = true;
      paintStudy();
    }
    function fcPick(k, correct) {
      const s = FC.s;
      if (!s || s.picked != null) return;
      s.picked = k;
      if (k !== correct) fcSave('again', false); // a wrong pick is Again, on its own
      paintStudy();
    }
    function fcNext() {
      const s = FC.s;
      if (!s) return;
      s.i++;
      Object.assign(s, { shown: false, picked: null, typed: '', verdict: null, prev: null, requeue: -1 });
      paintStudy();
    }
    /**
     * One card's rating written through core's composer, from `base` (the card as it was before a rating I was right
     * replaces) or the card as this tab last rated it. { r, prev } or null.
     */
    function fcWriteRating(deckId, id, rating, base) {
      const deck = deckById(deckId);
      const card = base || fcCard(deckId, id);
      if (!deck || !card) return null;
      const r = E.rateCard(card, rating, today, now());
      FC.local[deckId + '/' + id] = { ...card, ...r.sched };
      // the deck as the record has it, with this tab's newer card, so the composer builds on what he saw
      const seen = { ...deck, cards: { ...(deck.cards || {}), [id]: card } };
      guard(null, () => write(E.deckReview(seen, id, rating, now()).write));
      return { r, prev: card };
    }
    /** One rating: the card's update is written and the session moves on at once. */
    function fcSave(rating, advance = true, base) {
      const s = FC.s;
      const cur = s.queue[s.i];
      const w = fcWriteRating(cur.deck, cur.id, rating, base);
      if (!w) return;
      s.prev = w.prev;
      s.done++;
      if (rating === 'again') s.again++;
      s.requeue = -1;
      if (w.r.again) {
        s.requeue = Math.min(s.queue.length, s.i + 1 + (rating === 'hard' ? 6 : 3));
        s.queue.splice(s.requeue, 0, { ...cur });
      }
      if (advance) fcNext();
    }
    /** I was right (Written): the Again is replaced by Good, from the card as it was, and it no longer comes back. */
    function fcOverride() {
      const s = FC.s;
      if (!s || !s.prev) return;
      if (s.requeue >= 0) s.queue.splice(s.requeue, 1);
      s.done--;
      s.again--;
      fcSave('good', true, s.prev);
    }
    const fcRate = r => fcSave(r, true);
    function fcKey(e) {
      if (FC.view !== 'study' || !FC.s || e.target.closest('input, textarea, select')) return;
      const s = FC.s;
      const n = Number(e.key);
      if (s.mode === 'written' || s.mode === 'learn') {
        // keys 1 to 4: a choice while they are open, else the rating of that number; Enter and Space press the button
        if (!(n >= 1 && n <= 4)) return;
        const dlg = $('fc-dlg');
        const b =
          dlg.querySelectorAll('.fc-opt:not([disabled])')[n - 1] ||
          dlg.querySelector('.fc-rate .' + E.CARD_RATINGS[n - 1]);
        if (b) {
          e.preventDefault();
          b.click();
        }
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        if (s.mode === 'flip' && !s.shown) {
          e.preventDefault();
          fcReveal();
        } else if (s.mode === 'mc' && s.picked != null && !document.activeElement.closest('.fc-rate')) {
          const b = $('fc-dlg').querySelector('.fc-show');
          if (b) {
            e.preventDefault();
            b.click();
          }
        }
        return;
      }
      if (!(n >= 1 && n <= 4)) return;
      e.preventDefault();
      if (s.mode === 'flip' && s.shown) fcRate(E.CARD_RATINGS[n - 1]);
      else if (s.mode === 'mc' && s.picked == null) {
        const b = $('fc-dlg').querySelectorAll('.fc-opt')[n - 1];
        if (b) b.click();
      } else if (s.mode === 'mc' && n > 1) {
        const b = $('fc-dlg').querySelector('.fc-rate .' + E.CARD_RATINGS[n - 1]);
        if (b) b.click();
      }
    }
