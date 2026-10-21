    // ---------------------------------------------------------------- surfaces (B-78; D-123, D-125, D-126, D-160)
    // The cards of her latest reply that carries any are surfaces: one open at a time, the others one-line rows under
    // its head line (each its title and state, never a pill), opening in place and folding the open one. Below 1024 px
    // they sit in the sheet over the composer (330 to 410 px, growing to its content); from 1024 px in the side column
    // (#ev-side), which slides in while it holds something. Every surface folds to its own line with a chevron by
    // tapping that line (on the phone the sheet also swipes down) and unfolds the same way; nothing closes it. An open
    // check holds the surface and a card that arrives meanwhile waits as a row. A library citation in her line, current
    // or earlier, opens the material surface in place of the open one, which folds to a row. She glances toward a
    // surface as it opens and nods at a check-off made in it.
    const SF = { src: null, list: [], open: -1, last: 0, el: null, glanced: null, more: new Set() };
    const SF_CHEV =
      '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    const sfTitle = {
      quizlet: 'Quizlet',
      workout: 'Workout',
      skill: 'Skills run',
      job: 'Background job',
      checkin: 'Check-in',
      session: 'Study session',
      plan: 'Exam plan',
      link: 'Link',
    };
    // A surface's line: its title and its state, the same words folded or open (Review · 3 of 10).
    function sfLine(c) {
      try {
        if (c.type === 'review') {
          const { rs, total, left } = reviewState();
          return total
            ? `Review · ${total - left} of ${total}`
            : rs
              ? 'Review · empty today'
              : 'Review · arrives at 4:25am';
        }
        if (c.type === 'set') {
          const s = S.sets.find(x => x.id === c.id);
          if (!s) return 'Practice set';
          const items = E.validItems(s),
            a = answersOf(s);
          return `${s.title || 'Practice set'} · ${items.filter(q => a[q.id]).length} of ${items.length}`;
        }
        if (c.type === 'check') {
          const s = sessOf(c.session);
          const st = s ? E.sessionState(s, now()) : null;
          const oset = c.setId ? S.sets.find(x => x.id === c.setId) : null;
          const answered = (st && st.answered[c.n]) || (oset && Object.keys(answersOf(oset)).length > 0);
          return `Check ${c.n} · ${answered ? 'answered' : plural((c.items || []).length || 1, 'question')}`;
        }
        if (c.type === 'material') {
          const m = c.id ? matById(c.id) : E.citeTarget(LIB.mats, c);
          if (c.cite) return c.cite;
          return m ? (m.title || m.id).replace(/\.(pdf|docx|pptx)$/i, '') : 'From your library';
        }
        if (c.type === 'today' && c.filter === 'open') {
          const { items, isDone } = dayState();
          const all = items.filter(it => !it.deferred);
          return `Today’s list · ${all.filter(isDone).length} of ${all.length} done`;
        }
        // B-177 (review): a job's line names its kind and its state (Build · queued), since the card's own head is
        // the surface's line.
        if (c.type === 'job') {
          const j = S.jobs.find(x => x.id === c.id);
          return j ? `${kindLabel(j.kind) || 'Background job'} · ${jobState(j).label}` : 'Background job';
        }
        if (LINES[c.type]) return LINES[c.type](c).text;
        if (c.type === 'link') return c.title || 'Link';
        return sfTitle[c.type] || 'Card';
      } catch (e) {
        console.error(e);
        return 'Card';
      }
    }
    // The reply whose cards are the surfaces: her latest line in this conversation that carries any.
    function sfSource() {
      const convs = viewConvs();
      const cur = convs.length ? convs[convs.length - 1].messages : [];
      for (let i = cur.length - 1; i >= 0; i--) {
        const m = cur[i];
        if (m.role !== 'matt' && !m.greeting && shownCards(m).length) return m;
      }
      return null;
    }
    function sfHolds(it) {
      if (!it || it.c.type !== 'check') return false;
      const s = sessOf(it.c.session);
      const st = s ? E.sessionState(s, now()) : null;
      const oset = it.c.setId ? S.sets.find(x => x.id === it.c.setId) : null;
      const answered = (st && st.answered[it.c.n]) || (oset && Object.keys(answersOf(oset)).length > 0);
      return !answered && !!s && s.status === 'active';
    }
    function sfSync() {
      const m = sfSource(),
        id = m ? m.id : null;
      if (id !== SF.src) {
        const was = SF.open >= 0 ? SF.list[SF.open] : null;
        const fresh = m ? shownCards(m).map((c, i) => ({ c, key: m.id + '-' + i })) : [];
        SF.src = id;
        if (sfHolds(was) && !fresh.some(x => x.key === was.key)) {
          SF.list = [was, ...fresh];
          SF.open = 0;
        } else {
          SF.list = fresh;
          SF.open = fresh.length ? 0 : -1;
        }
        SF.last = 0;
        return;
      }
      if (!m) return;
      // The same reply: its cards are live (a job's result lands in its card), so each is read again by its place.
      const cards = shownCards(m);
      SF.list = SF.list
        .map(it => {
          if (it.cite || !it.key.startsWith(m.id + '-')) return it;
          const c = cards[Number(it.key.slice(m.id.length + 1))];
          return c ? { ...it, c } : null;
        })
        .filter(Boolean);
      if (SF.open >= SF.list.length) SF.open = SF.list.length - 1;
    }
    function sfShow(i) {
      if (SF.open >= 0 && SF.open !== i) SF.last = SF.open;
      SF.open = i;
      renderThread();
    }
    function sfFold() {
      if (SF.open >= 0) {
        SF.last = SF.open;
        SF.open = -1;
      } else SF.open = Math.min(SF.last, SF.list.length - 1);
      renderThread();
    }
    // D-126: a citation opens the passage in place of the open surface, which folds to a row under it.
    function openCite(cite) {
      const p = E.parseCite(cite);
      if (!p) return;
      const key = 'cite:' + p.cite;
      let i = SF.list.findIndex(x => x.key === key);
      if (i < 0) {
        SF.list.unshift({
          c: { type: 'material', cite: p.cite, title: p.title, page: p.page, unit: p.unit },
          key,
          cite: true,
        });
        if (SF.open >= 0) SF.open++;
        SF.last = Math.max(0, SF.open);
        i = 0;
      }
      sfShow(i);
      if (!LIB.mats && !LIB.loading) library().catch(() => {});
    }
    capIn.addEventListener('click', e => {
      const a = e.target.closest('a.cite');
      if (!a) return;
      e.preventDefault();
      openCite(a.dataset.cite);
    });
    function sfBody(it) {
      const box = el('div', 'card ev-card');
      try {
        (
          CARDS[it.c.type] ||
          (() => {
            throw new Error('unknown card');
          })
        )(box, it.c, it.key);
      } catch (e) {
        box.replaceChildren(el('p', 'empty', 'This card couldn’t load.'));
        console.error(e);
      }
      return box;
    }
    function sfRowBtn(cls, text, open) {
      const b = el('button', cls);
      b.type = 'button';
      b.append(el('span', 'sf-t', text));
      b.insertAdjacentHTML('beforeend', SF_CHEV);
      b.setAttribute('aria-expanded', String(open));
      return b;
    }
    function renderSurface() {
      sfSync();
      let host = SF.el;
      if (!SF.list.length) {
        if (host && host.isConnected) host.remove();
        document.body.classList.remove('surface-open');
        SF.glanced = null;
        return;
      }
      if (!host) {
        host = SF.el = el('section', 'surf');
        host.id = 'ev-surf';
        host.setAttribute('aria-label', 'Cards');
        host.append(el('div', 'sf-top'), el('div', 'sf-rows'), el('div', 'sf-body'));
        // On the phone the sheet also folds with a swipe down on its head line.
        let y0 = null;
        host.addEventListener('touchstart', e => {
          y0 = e.target.closest('.sf-head') && e.touches[0] ? e.touches[0].clientY : null;
        });
        host.addEventListener('touchend', e => {
          const t = e.changedTouches[0];
          if (y0 != null && t && t.clientY - y0 > 48 && SF.open >= 0) sfFold();
          y0 = null;
        });
      }
      if (host.parentNode !== capSide || capSide.firstChild !== host) capSide.prepend(host);
      const openIt = SF.open >= 0 ? SF.list[SF.open] : null;
      const headI = openIt ? SF.open : Math.min(SF.last, SF.list.length - 1);
      const [top, rows, body] = host.children;
      const head = sfRowBtn('sf-head', sfLine(SF.list[headI].c), !!openIt);
      if (!top.firstChild || top.firstChild.outerHTML !== head.outerHTML) top.replaceChildren(head);
      top.firstChild.onclick = sfFold;
      const want = SF.list
        .map((it, i) => [it, i])
        .filter(([, i]) => i !== headI)
        .map(([it, i]) => {
          const b = sfRowBtn('sf-row', sfLine(it.c), false);
          b.dataset.i = String(i);
          b.dataset.type = it.c.type;
          return b;
        });
      if (want.map(b => b.outerHTML).join() !== [...rows.children].map(b => b.outerHTML).join())
        rows.replaceChildren(...want);
      [...rows.children].forEach(b => (b.onclick = () => sfShow(Number(b.dataset.i))));
      host.classList.toggle('folded', !openIt);
      host.dataset.type = SF.list[headI].c.type;
      if (openIt) {
        const fresh = sfBody(openIt),
          old = body.firstChild;
        fresh.dataset.key = openIt.key;
        if (!old) body.append(fresh);
        else if (old.outerHTML !== fresh.outerHTML) {
          // the same card: keep it, with whatever he has typed or picked in it; else swap, keeping his focus
          const f = document.activeElement;
          const lbl = f && old.contains(f) && old.dataset.key === openIt.key ? f.getAttribute('aria-label') : null;
          old.replaceWith(fresh);
          if (lbl) {
            const t = [...fresh.querySelectorAll('[aria-label]')].find(x => x.getAttribute('aria-label') === lbl);
            if (t) t.focus({ preventScroll: true });
          }
        }
      } else body.replaceChildren();
      document.body.classList.toggle('surface-open', !!openIt);
      // She glances toward a surface as it opens (D-123); once per opening, and not for history at load.
      const gk = openIt ? openIt.key : null;
      if (gk && gk !== SF.glanced && T.ready) CORE.gesture('glance', host);
      SF.glanced = gk;
    }
    // A check-off made in a surface: her nod (D-163: nothing he is ticking moves).
    function sfNod(node) {
      if (node && node.closest && node.closest('#ev-surf')) CORE.gesture('done');
    }
