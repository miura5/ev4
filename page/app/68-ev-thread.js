    // ---------------------------------------------------------------- thread
    function storedMsgs() {
      const out = [];
      for (const d of S.talk)
        for (const [id, m] of Object.entries(d.messages || {}))
          if (m && m.role) out.push({ ...m, id, day: d.date || d.id });
      return out;
    }
    // B-405 (D-327): a line with a thread belongs to a chat in the desktop pop-up, never to the Conversation's own thread;
    // allMsgs() is the Conversation's (no thread), everyMsg() every line, for the pop-up to pick its thread from.
    function allMsgs() {
      return everyMsg().filter(m => !m.thread);
    }
    function everyMsg() {
      const map = new Map(storedMsgs().map(m => [m.id, m]));
      for (const [id, m] of T.local) {
        if (map.has(id) && !m.pending) T.local.delete(id);
        else map.set(id, m);
      }
      if (T.greet) map.set(T.greet.id, T.greet);
      return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
    }
    function msgEl(m, showAv, isLastEv) {
      let rec = T.els.get(m.id);
      const sig = JSON.stringify([
        m.text,
        m.cards,
        !!m.pending,
        m.error,
        showAv,
        isLastEv,
        T.busy,
        T.retry.has(m.id),
        m.greeting && m.prep ? prepNow(m.prep) : null,
        m.greeting ? summaryLine(m) : null,
        m.work || null,
        m.work ? T.workOpen.has(m.id) : null,
      ]);
      if (rec && rec.sig === sig) {
        rec.msg = m;
        return rec;
      }
      // New messages rise into place (the greeting always; others once the page has settled). One core, shared, sits on
      // the newest E.V. message and follows E.V.'s state; earlier E.V. messages keep its column empty.
      const rise = rec ? rec.rise : !!(m.greeting || T.ready);
      const node = rec ? rec.el : el('div');
      node.className =
        'msg ' + (m.role === 'matt' ? 'matt' : 'ev') + (m.greeting ? ' greet' : '') + (rise ? ' rise' : '');
      node.dataset.id = m.id;
      node.dataset.key = m.id; // B-514 (D-387): the message's record id, for the harnesses
      node.dataset.kind = m.role === 'matt' ? 'his' : 'hers';
      const kids = [];
      if (m.role !== 'matt') {
        if (showAv) {
          if (!T.msgOrb) T.msgOrb = CORE.make(32, { follow: true });
          kids.push(T.msgOrb.el);
        } else kids.push(el('span', 'av-slot'));
      }
      // A line that arrives while the page is open (a reply from its first dots) reveals word by word; history shows whole.
      // B-183: a line to copy (the design kickoff) shows at once as a short preview; it is text to paste, not speech.
      const toCopy = m.role !== 'matt' && !!m.text && (m.cards || []).some(c => c && c.type === 'copy');
      // B-368 (D-316): as the demo's Main board, her greeting has no large line of its own: the thread opens with
      // her grey summary line (briefEl below); the greeting's text stays in the record and her context.
      const quiet = !!m.greeting;
      if (m.role !== 'matt' && !rec && (m.greeting || T.ready) && !toCopy && !quiet) revealQueue(m);
      const body = el('div', 'msg-body');
      if (m.pending && !m.text) {
        const b = el('div', 'bubble');
        const d = el('span', 'dots');
        d.setAttribute('aria-label', 'E.V. is thinking');
        d.append(el('i'), el('i'), el('i'));
        b.append(d);
        body.append(b);
      } else if (m.text && !quiet) {
        const b = el('div', 'bubble' + (m.error ? ' err' : '') + (toCopy ? ' to-copy' : ''));
        b.append(m.role === 'matt' || toCopy ? fmt(m.text) : capWords(fmt(m.text)));
        body.append(b);
        // B-626 (D-415): a reply from general knowledge carries one quiet tag (its mark never shows as text)
        if (m.role !== 'matt' && m.general && !m.pending)
          body.append(DS.badge({ text: 'general knowledge', tone: 'quiet', cls: 'gen-tag', key: 'general' }));
        const st = CAP.rv.get(m.id);
        if (st && CAP.queue.includes(m.id)) {
          b.classList.add('reveal');
          const on = [...b.querySelectorAll('.w')].slice(0, st.n);
          on.forEach(w => w.classList.add('on'));
          if (CAP.typing && !b.contains(CAP.typing)) CAP.typing = null; // the word being typed was rebuilt: shown whole
          const cs = on.length ? on[on.length - 1].querySelectorAll('.c') : [];
          if (cs.length) caretAfter(b, cs[cs.length - 1]);
        } else if (reduced() && m.role !== 'matt' && !m.pending && (m.greeting || T.ready)) {
          announce(m.id + ':0', [...b.querySelectorAll('.w')].map(w => w.textContent).join(' '));
          if (!CAP.said.has(m.id + ':end')) {
            CAP.said.add(m.id + ':end');
            CORE.speechEnd();
            CORE.gesture(endGesture(m));
          }
        }
      }
      const q = SS.quotes.get(m.id);
      if (q && m.text) body.append(el('p', 'cap-quote', `on “${q}”`)); // B-88: the line of his she answered (memory only)
      if (m.greeting) body.append(briefEl(m));
      if (m.greeting && m.prep) {
        const pe = prepEl(m);
        if (pe) body.append(pe);
      }
      // B-362 (D-316): as in the demo, her newest line carries its one action as a button under it (Open the week).
      const gos = m.role !== 'matt' && !m.pending ? (m.cards || []).filter(c => c && c.type === 'go' && c.label) : [];
      if (gos.length && isLastEv) {
        const r = el('div', 'msg-acts');
        r.append(...gos.map(c => btn(c.label, () => goTo(c), { cls: 'btn neutral sm' })));
        body.append(r);
      }
      const cardsBox = el('div', 'msg-cards');
      body.append(cardsBox);
      // B-227 (D-232): a reply that changed something carries its work line, opening in place to what it changed.
      if (m.role !== 'matt' && m.work && !m.pending) body.append(workEl(m.work, m.id));
      // B-183 (D-197): a line with a copy card (the design kickoff) carries a Copy chip: the text as written, to paste.
      if (toCopy) {
        const cp = el('button', 'qchip copy-chip', 'Copy');
        cp.type = 'button';
        cp.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(m.text);
            cp.textContent = 'Copied'; // B-380: said on the chip itself, no toast
          } catch {
            toast('Couldn’t copy here. Select the text and copy it.');
          }
        });
        body.append(cp);
      }
      const meta = el('div', 'msg-meta');
      meta.append(
        el(
          'span',
          null,
          (m.greeting ? 'just now' : clock12(m.at)) +
            (m.role !== 'matt' && m.tier && m.tier !== 'local' ? ' · ' + m.tier : '')
        )
      );
      if (m.role !== 'matt' && !m.pending && !T.busy) {
        // B-265: a line that failed on a transient error keeps its Try again after a reload, while it is her last line
        const asked = isLastEv && m.error === 'upstream_error' && m.replyTo && allMsgs().find(x => x.id === m.replyTo);
        const ask = T.retry.get(m.id) || (asked && { text: asked.text, tier: m.tier, replyTo: m.replyTo });
        // B-452 (Matt): no Go deeper under a quick reply; asking again goes deeper.
        if (ask)
          meta.append(
            btn('Try again', () => {
              T.retry.delete(m.id);
              chat(ask.text, { tier: ask.tier, replyTo: ask.replyTo });
            })
          );
      }
      if (m.pending && T.ctl) meta.append(btn('Stop', () => T.ctl && T.ctl.abort()));
      body.append(meta);
      node.replaceChildren(...kids, body);
      rec = { el: node, sig, cardsBox, rise, msg: m };
      T.els.set(m.id, rec);
      return rec;
    }
    // The present: the newest line at the bottom; but when her current line (with its card) is taller than the captions,
    // its start pins to the top and the rest runs on below it (a card never scrolls inside itself; her line never leaves
    // view). That pinned place counts as now for Back to now.
    function pinNow() {
      const cur = capIn.querySelector('.msg.ev.current');
      CAP.anchorTop = null;
      if (cur) {
        const r = cur.getBoundingClientRect(),
          t = capBox.getBoundingClientRect();
        if (r.height > capBox.clientHeight - 16) {
          capBox.scrollTop += r.top - t.top - 8;
          CAP.anchorTop = capBox.scrollTop;
          return;
        }
      }
      capBox.scrollTop = capBox.scrollHeight;
    }
    function dayDivider(day) {
      T.dayDivs = T.dayDivs || new Map();
      let d = T.dayDivs.get(day);
      if (!d) {
        const label = day === today ? 'Today' : day === E.addDays(today, -1) ? 'Yesterday' : short(day);
        d = el('div', 'cap-div cap-day', label);
        d.dataset.day = day;
        T.dayDivs.set(day, d);
      }
      return d;
    }
    function renderThread() {
      // Captions: the current conversation (core.conversations' idle-gap rule), plus the earlier ones pulled back today.
      const convs = viewConvs(),
        shown = Math.min(convs.length, 1 + CAP.loaded);
      const earlierConvs = convs.slice(convs.length - shown, convs.length - 1);
      // B-377 (D-316): in a session the whole conversation stays, as the demo (D-122's two-line trim is retired)
      const cur = convs.length ? convs[convs.length - 1].messages : [];
      const lastEv = [...cur].reverse().find(m => m.role !== 'matt'),
        lastMatt = [...cur].reverse().find(m => m.role === 'matt');
      const kids = [capPull];
      // Earlier days come under a date divider (Yesterday, Fri, Oct 16), and today's under Today once any came before.
      let prevDay = null;
      for (const c of earlierConvs) {
        const day = E.chicagoDate(c.start);
        if (day !== prevDay && (day !== today || prevDay)) kids.push(dayDivider(day));
        prevDay = day;
        for (const m of c.messages) {
          const rec = msgEl(m, false, false);
          rec.el.classList.add('earlier');
          rec.el.classList.remove('current', 'last');
          kids.push(rec.el);
        }
      }
      const curDay = convs.length ? E.chicagoDate(convs[convs.length - 1].start) : today;
      if (prevDay && prevDay !== curDay) kids.push(dayDivider(curDay));
      if (earlierConvs.length) {
        if (!T.capDiv) {
          T.capDiv = el('div', 'cap-div', 'Now');
          T.capDiv.setAttribute('aria-hidden', 'true');
        }
        kids.push(T.capDiv);
      }
      const nowIdx = lastEv ? cur.indexOf(lastEv) : -1,
        mattIdx = lastMatt ? cur.indexOf(lastMatt) : -1;
      for (const m of cur) {
        const rec = msgEl(m, m === lastEv && !m.greeting, m === lastEv); // B-572: her Arc beside her newest line
        rec.el.classList.remove('earlier');
        rec.el.classList.toggle('current', m === lastEv && !(mattIdx > nowIdx));
        rec.el.classList.toggle('last', m === lastMatt);
        kids.push(rec.el);
      }
      if (!convs.length) kids.push(T.waking || (T.waking = el('p', 'empty', 'Waking up…')));
      // Patch in place: nodes already where they belong stay put (no replayed animations, no lost card state).
      let at = capIn.firstChild;
      for (const k of kids) {
        if (k === at) {
          at = at.nextSibling;
          continue;
        }
        capIn.insertBefore(k, at);
      }
      while (at) {
        const n = at.nextSibling;
        at.remove();
        at = n;
      }
      if (convs.length && !T.readyAt)
        T.readyAt = setTimeout(() => {
          T.ready = true;
        }, 900);
      renderSurface(); // B-78: the reply's cards as surfaces, beside her or in the sheet
      renderStage();
      // The newest line stays in view unless he has scrolled up to read.
      // B-452: a pin the page makes on its own waits while he scrolls (autoPin); his own send pins at once.
      if ((CAP.stick || T.scrollTo) && ui.tab === 'ev') {
        const his = !!T.scrollTo;
        T.scrollTo = null;
        T.firstScroll = false;
        requestAnimationFrame(his ? pinNow : autoPin);
        clearTimeout(CAP.repin);
        CAP.repin = setTimeout(() => {
          if (CAP.stick && ui.tab === 'ev') autoPin();
        }, 450);
      } // again once late layout (cards, folded lines) settles
    }

