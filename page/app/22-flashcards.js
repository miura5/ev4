    // ------------------------------------------------------------ B-487 (D-368): flashcard decks
    // Study's Flashcards card per course lists its decks (title, cards, due today); a deck opens in one sheet: its
    // cards (+ New card, Edit, Retire; nothing deleted) and a session in Flip (term, Show answer, Again / Hard / Good /
    // Easy with the next interval under each, keys 1 to 4) or Multiple choice (a wrong pick is Again; a right one asks
    // Hard / Good / Easy). Each rating is one card's update through core's composer (E.deckReview), merged into the deck
    // as it is now. Today's "Cards · n due" opens a session over every course's due cards.
    const FC = { view: 'deck', deck: null, edit: null, s: null, local: {} };
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
        card = el('div', 'ui-card ov-sets ov-decks');
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
        btn('New deck', () => openDeckNew(course), { cls: 'btn ghost sm fc-newdeck' })
      );
      hd.append(el('span', 'lab', 'Flashcards'), right);
      const list = el('div', 'st-list');
      for (const d of decks) {
        const n = E.deckCards(d).length,
          k = dueIn(d);
        const r = el('div', 'st-row');
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
          const go = btn('Study', () => startCards([d.id], 'flip'), { cls: 'btn ghost sm' });
          go.setAttribute('aria-label', 'Study ' + (d.title || d.id));
          slot.append(go);
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
      d = el('dialog', 'new-dlg fc-dlg');
      d.id = 'fc-dlg';
      d.setAttribute('aria-label', 'Flashcards');
      d.addEventListener('click', e => e.target === d && d.close()); // a tap outside closes it
      d.addEventListener('close', () => {
        FC.s = null;
        FC.edit = null;
        render();
      });
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
      const lab = all ? ' all ' + cards.length : due ? ' · ' + due + ' due' : '';
      go.append(
        btn('Flip' + lab, () => startCards([deck.id], 'flip', all), { primary: true, disabled: !cards.length }),
        btn('Multiple choice' + lab, () => startCards([deck.id], 'mc', all), {
          cls: 'btn neutral',
          disabled: cards.length < 2,
        })
      );
      if (!due && cards.length)
        go.append(el('span', 'meta fc-note', 'Nothing due today: a run now still moves each card.'));
      body.append(go);
      const lh = el('div', 'fc-lh');
      lh.append(
        el('span', 'lab', 'Cards'),
        btn('New card', () => ((FC.edit = 'new'), paintDeck()), { cls: 'btn ghost sm' })
      );
      body.append(lh);
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
      FC.s = { decks: deckIds, mode, queue, i: 0, shown: false, picked: null, done: 0, again: 0, seed: now() };
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
      body.append(fcHead(s.mode === 'mc' ? 'Multiple choice' : 'Flip', deck.title + ' · ' + left + ' left'));
      const bar = el('div', 'fc-bar');
      const fill = el('i');
      fill.style.width = (100 * s.done) / Math.max(1, s.done + left) + '%';
      bar.append(fill);
      body.append(bar);
      const face = el('div', 'fc-card' + (s.shown ? ' shown' : ''));
      face.append(el('div', 'fc-q', card.term));
      if (s.mode === 'flip') {
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
        body.append(face);
        const ch = E.cardChoices(deck, cur.id, s.seed + s.i);
        const opts = el('div', 'fc-opts');
        ch.options.forEach((o, k) => {
          const picked = s.picked != null;
          const cls =
            'fc-opt' +
            (picked && k === ch.correct ? ' right' : '') +
            (picked && k === s.picked && k !== ch.correct ? ' wrong' : '');
          const b = el('button', cls);
          b.type = 'button';
          b.append(el('span', 'fc-k', String(k + 1)), el('span', null, o));
          b.disabled = picked;
          b.addEventListener('click', () => fcPick(k, ch.correct));
          opts.append(b);
        });
        body.append(opts);
        if (s.picked != null && s.picked === ch.correct) body.append(rateRow(card, ['hard', 'good', 'easy']));
        else if (s.picked != null) {
          const nx = btn('Next', () => fcNext(), { primary: true });
          nx.classList.add('fc-show');
          body.append(el('p', 'meta fc-why', 'Counted as Again: it comes back this session.'), nx);
        }
      }
      d.replaceChildren(body);
      const f = body.querySelector('.fc-show, .fc-rate button.good, .fc-opt:not([disabled])');
      if (f) f.focus({ preventScroll: true });
    }
    function rateRow(card, which) {
      const lbl = E.cardNextLabels(card);
      const row = el('div', 'fc-rate');
      for (const r of which) {
        const n = E.CARD_RATINGS.indexOf(r) + 1;
        const b = el('button', 'btn neutral ' + r);
        b.type = 'button';
        b.append(el('span', 'fc-rl', RATE_LABEL[r]), el('span', 'fc-ri', lbl[r]));
        b.setAttribute('aria-label', RATE_LABEL[r] + ', next in ' + lbl[r] + ' (key ' + n + ')');
        b.addEventListener('click', () => fcRate(r));
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
      s.shown = false;
      s.picked = null;
      paintStudy();
    }
    /** One rating: the card's update is written (through core's composer) and the session moves on at once. */
    function fcSave(rating, advance = true) {
      const s = FC.s;
      const cur = s.queue[s.i];
      const deck = deckById(cur.deck);
      const card = fcCard(cur.deck, cur.id);
      if (!deck || !card) return;
      const r = E.rateCard(card, rating, today, now());
      FC.local[cur.deck + '/' + cur.id] = { ...card, ...r.sched };
      // the deck as the record has it, with this tab's newer card, so the composer builds on what he saw
      const seen = { ...deck, cards: { ...(deck.cards || {}), [cur.id]: card } };
      guard(null, () => write(E.deckReview(seen, cur.id, rating, now()).write));
      s.done++;
      if (rating === 'again') s.again++;
      if (r.again) s.queue.splice(Math.min(s.queue.length, s.i + 1 + (rating === 'hard' ? 6 : 3)), 0, { ...cur });
      if (advance) fcNext();
    }
    const fcRate = r => fcSave(r, true);
    function fcKey(e) {
      if (FC.view !== 'study' || !FC.s || e.target.closest('input, textarea')) return;
      const s = FC.s;
      const n = Number(e.key);
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
