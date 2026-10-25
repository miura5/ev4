    // ---------------------------------------------------------------- Captions (B-77; D-122, D-127, D-128)
    // The E.V. tab without the thread: her stage, her lines under her (the current one large, earlier ones above, smaller
    // and dimmer), Matt's line echoed above the composer for about 3 s, the Breath reveal paced with her speech, Back to
    // now, and pull to load one earlier conversation at a time (core.conversations, the idle-gap rule). Screen readers
    // get each finished sentence once, from a polite live region of its own.
    document.body.classList.add('captions');
    // B-224 (D-229): the system's reduced motion, or his Reduce motion On in Preferences (read each time, so a switch
    // takes effect at once).
    const reduceQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const reduced = () => reduceQ.matches || document.documentElement.getAttribute('data-motion') === 'reduce';
    const CAP = {
      loaded: 0,
      pastToday: false,
      stick: true,
      holdT: null,
      pull: null,
      queue: [],
      rv: new Map(),
      said: new Set(),
      timer: null,
      echoT: null,
      end: new Map(),
    };
    const capBox = $('thread');
    capBox.removeAttribute('aria-live');
    const capIn = el('div', 'cap-in');
    capBox.replaceChildren(capIn);
    const capPull = el('div', 'cap-pull');
    capPull.setAttribute('aria-hidden', 'true');
    capPull.innerHTML =
      '<div class="ring"><svg class="r" viewBox="0 0 34 34"><circle class="t" cx="17" cy="17" r="15"/><circle class="a" cx="17" cy="17" r="15"/></svg><span class="arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg></span></div><span class="lbl"></span>';
    const capSay = el('div', 'sr');
    capSay.id = 'ev-say';
    capSay.setAttribute('aria-live', 'polite');
    capSay.setAttribute('aria-atomic', 'false');
    $('p-ev').append(capSay);
    const capEchoEl = el('p', 'cap-echo');
    capEchoEl.id = 'ev-echo';
    capEchoEl.setAttribute('aria-hidden', 'true');
    $('composer').prepend(capEchoEl);
    const capNow = btn('Back to now', () => backToNow(), { cls: 'btn ghost sm cap-now' });
    capNow.id = 'ev-now';
    capNow.hidden = true;
    capNow.insertAdjacentHTML(
      'afterbegin',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>'
    );
    $('mh').append(capNow); // B-209 (D-213): Back to now sits in the pane's header
    const capSide = el('aside');
    capSide.id = 'ev-side';
    capSide.setAttribute('aria-label', 'Beside E.V.');
    $('p-ev').append(capSide);
    // The side column is there only while it holds something (D-122 as amended): B-78's surfaces and a session's notes
    // go in #ev-side; with nothing in it her stage centres in the window.
    // B-223, B-290: the session card (ev-sess) and Coming up (ev-dates) are the panel's resting content from 1200 px
    // (class rest), not something beside her.
    const sideSync = () => {
      const kids = [...capSide.children];
      document.body.classList.toggle(
        'side-on',
        kids.some(c => !c.classList.contains('rest'))
      );
      document.body.classList.toggle(
        'ev-rest-on',
        kids.some(c => c.classList.contains('rest'))
      );
    };
    new MutationObserver(() => {
      sideSync();
      requestAnimationFrame(() => {
        if (CAP.stick) pinNow();
      });
    }).observe(capSide, { childList: true });
    sideSync();
    $('hero').addEventListener('click', () => backToNow());
    // One announcement per finished sentence (D-127); the region keeps its last few.
    function announce(key, text) {
      text = String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text || CAP.said.has(key)) return;
      CAP.said.add(key);
      const p = el('p', null, text);
      capSay.append(p);
      while (capSay.children.length > 6) capSay.firstChild.remove();
    }
    // Her stage (D-122): idle on a new conversation, conversation once he has spoken in it, session while one runs.
    // A reply with cards steps her down to the list size (D-122's 52%, desktop's surface step) until B-78's surfaces,
    // so the card has the height a surface will have.
    // B-91 (Matt, Oct 19): each time he opens the page, her greeting starts a clean view. What he said before it in the
    // same conversation (D-128's idle gap) folds behind the pull like an earlier conversation, so a reopen looks like a
    // first open: her stage at full size, the chips, the briefing with room to unfold. Only the view splits: the
    // conversation itself, and what Claude is given as context, stay as D-128 defines them.
    function viewConvs() {
      const convs = E.conversations(allMsgs());
      const g = T.greet;
      if (!g || !convs.length) return convs;
      const last = convs[convs.length - 1],
        i = last.messages.indexOf(g);
      if (i <= 0) return convs;
      return [
        ...convs.slice(0, -1),
        { ...last, end: last.messages[i - 1].at, messages: last.messages.slice(0, i) },
        { ...last, start: g.at, messages: last.messages.slice(i) },
      ];
    }
    function stageState() {
      if (activeSession()) return 'session';
      if (skillShown()) return 'skills'; // D-122's skills step while the runner is up (B-82)
      const convs = viewConvs();
      const cur = convs.length ? convs[convs.length - 1].messages : [];
      const last = cur[cur.length - 1];
      if (SF.open >= 0 && SF.list.length) return 'list'; // B-78: an open surface steps her down (the desktop's surface step)
      if (cur.some(m => m.role === 'matt')) return 'conversation';
      return T.briefOpen ? 'list' : 'idle'; // B-90: her greeting's briefing open steps her down like a card
    }
    // The stage's height at each step, as the Captions v2 artboards draw it (V2.dc.html, V2Desktop.dc.html: stageH).
    const STAGE_PX = {
      phone: { idle: 300, conversation: 232, session: 196, list: 150, skills: 128 },
      desktop: { idle: 370, conversation: 290, surface: 260 },
    };
    // (coreSize maps the phone's list step to the desktop's surface step.)
    // B-85: on a screen under 800 px tall (a laptop's split-screen pane) each step is shorter, so her lines keep the room;
    // the core shrinks with its stage and keeps its ring.
    const STAGE_SHORT = {
      phone: { idle: 236, conversation: 168, session: 128, list: 120, skills: 108 },
      desktop: { idle: 290, conversation: 220, surface: 200 },
    };
    // B-112 (D-225): under 560 px tall (the phone with its keyboard open) she steps down again, so the composer and her
    // current line stay on screen; her words scroll under her as before.
    const STAGE_TINY = {
      phone: { idle: 132, conversation: 104, session: 92, list: 88, skills: 80 },
      desktop: { idle: 132, conversation: 104, surface: 92 },
    };
    // B-209: when her stage folds or unfolds while he is at now, keep now in view once its height has settled.
    $('hero').addEventListener('transitionend', e => {
      if (e.propertyName !== 'height' || !CAP.stick) return;
      pinNow();
      capBox.dispatchEvent(new Event('scroll'));
    });
    function renderStage(o) {
      // B-209 (D-213): one size per layout (MO_SIZE), 70% in a session; folded to the header's 24 px flower while he
      // reads back or on a screen under 560 px tall.
      const z = MO_SIZE(innerWidth, stageState());
      const h = $('hero');
      const hold = o && o.hold,
        was = hold ? h.getBoundingClientRect().height : 0,
        st = capBox.scrollTop;
      const folded = innerHeight < FZ.foldBelowHeightPx || !capNow.hidden;
      const pad = innerWidth < 600 ? 14 : innerWidth < 1200 ? 24 : 36;
      heroOrb.resize(z.px);
      h.style.setProperty('--core-scale', '1');
      h.style.setProperty('--stage-h', folded ? '0px' : z.px + pad + 12 + 'px');
      h.style.setProperty('--stage-pad', pad + 'px');
      h.dataset.step = z.step;
      h.dataset.px = String(folded ? 24 : z.px);
      h.dataset.short = folded ? '1' : '';
      document.body.classList.toggle('her-folded', folded);
      if (hold) {
        // B-249: at once, and the thread scrolls by what her stage gave or took, so the lines he reads stay put.
        h.classList.add('snap');
        const now = h.getBoundingClientRect().height;
        // From the scroll before the fold, which may clamp it. At the top of a short thread there is no scroll above
        // his place to give: the room under the pull grows by what is missing (the lift), and goes again at now.
        let to = st - (was - now);
        if (to < 0) {
          CAP.lift = (CAP.lift || 0) - to;
          to = 0;
        } else if (!folded && CAP.lift) {
          const r = Math.min(CAP.lift, to);
          CAP.lift -= r;
          to -= r;
        }
        capPull.style.marginBottom = CAP.lift ? CAP.lift + 'px' : '';
        if (to !== st) capBox.scrollTop = to;
        requestAnimationFrame(() => requestAnimationFrame(() => h.classList.remove('snap')));
      }
    }
    // The talk the page holds (the shell's read window, spec.ui.page.subscribe): the edge a pull past today stops at.
    const TALK_DAYS = (
      EV_SPEC.ui.page.subscribe.find(x => x.collection === 'talk' && x.windowDays) || { windowDays: 7 }
    ).windowDays;
    // The conversation a pull would bring next (D-128): its count, or the edge it stops at.
    const nextEarlier = () =>
      E.earlierConversation(viewConvs(), 1 + CAP.loaded, today, {
        pastToday: CAP.pastToday,
        windowStart: E.addDays(today, -TALK_DAYS),
      });
    function pullView(p, mode) {
      capPull.style.setProperty('--pull-o', String(mode ? 1 : Math.pow(p, 1.4).toFixed(2)));
      capPull.style.setProperty('--pull-dash', (94.25 * (1 - (mode ? 1 : p))).toFixed(1));
      capPull.style.setProperty('--pull-rot', Math.round((mode ? 1 : p) * 180) + 'deg');
      // B-250: the lines are already on the page, so a pull shows them at once; the count (D-128) is on the hold line.
      const n = !mode && p > 0.96 ? nextEarlier() : null;
      capPull.querySelector('.lbl').textContent =
        mode === 'start'
          ? 'That’s the start of today'
          : mode === 'window'
            ? `That’s everything from the last ${TALK_DAYS} days`
            : p > 0.96
              ? n && !n.edge && n.count
                ? `Hold for ${n.count} earlier message${n.count === 1 ? '' : 's'}`
                : 'Hold for earlier'
              : 'Keep scrolling for earlier';
    }
    capBox.addEventListener(
      'scroll',
      () => {
        const t = capBox,
          fromBottom = t.scrollHeight - t.clientHeight - t.scrollTop;
        // Now is her latest reply as a whole (D-122 as amended): when it is pinned, scrolling down through its card is
        // still now; Back to now shows once he scrolls above her latest line into earlier ones.
        const atAnchor = CAP.anchorTop != null && Math.abs(t.scrollTop - CAP.anchorTop) < 30;
        CAP.stick = fromBottom < 30 || atAnchor;
        // B-248: the bottom of the thread is always now. A fold above (the surface closing) clamps the scroll under a
        // pinned anchor; the anchor follows it rather than reading as reading back.
        if (fromBottom < 2 && CAP.anchorTop != null && t.scrollTop < CAP.anchorTop) CAP.anchorTop = t.scrollTop;
        // B-249: reading back holds until he is back at now (no flip at one line), and her stage folds once, at once,
        // with his place held.
        const atNow = fromBottom < 30 || (CAP.anchorTop != null && t.scrollTop >= CAP.anchorTop - 30);
        const away =
          !atNow && (!capNow.hidden || (CAP.anchorTop != null ? t.scrollTop < CAP.anchorTop - 40 : fromBottom > 140));
        if (capNow.hidden === away) {
          capNow.hidden = !away;
          renderStage({ hold: true });
        }
        // Leaving the top after an edge (the start of today, the 7-day edge) readies the next full pull.
        if ((CAP.pull === 'start' || CAP.pull === 'window') && t.scrollTop > 40) CAP.pull = null;
        const p = Math.max(0, Math.min(1, (160 - t.scrollTop) / 160));
        if (!CAP.pull) pullView(p, null);
        // Reaching the top and holding there for 0.3 s loads the conversation before the ones on screen (D-128).
        if (t.scrollTop <= 3 && !CAP.holdT) CAP.holdT = setTimeout(pullHold, 300);
      },
      { passive: true }
    );
    function pullHold() {
      CAP.holdT = null;
      if (capBox.scrollTop > 6) return;
      // D-128 as amended: first the pulls stop at the start of today; the next full pull goes on into earlier days, one
      // conversation at a time under a date divider, to the read window's edge.
      const nx = nextEarlier();
      if (nx.edge === 'today') {
        CAP.pull = 'start';
        CAP.pastToday = true;
        pullView(1, 'start');
        return;
      }
      if (nx.edge === 'window') {
        CAP.pull = 'window';
        pullView(1, 'window');
        return;
      }
      {
        // B-249: his place is held by the lines he was reading (her latest line), not by the scroll height, which a
        // short thread's room does not change; the lines loaded above take the room over it.
        const at = () => {
          const c = capBox.querySelector('.msg.ev.current') || capBox.querySelector('.msg');
          return c ? c.getBoundingClientRect().top : null;
        };
        const was = at(),
          h = capBox.scrollHeight,
          top = capBox.scrollTop;
        CAP.loaded++;
        CAP.pull = null;
        renderThread();
        const now = at();
        let want = was != null && now != null ? top + now - was : capBox.scrollHeight - h + top;
        // The lines loaded take the lift's place first (it was only there to hold him).
        if (CAP.lift) {
          const r = Math.min(CAP.lift, want);
          CAP.lift -= r;
          capPull.style.marginBottom = CAP.lift ? CAP.lift + 'px' : '';
          want -= r;
        }
        const max = capBox.scrollHeight - capBox.clientHeight;
        // A thread shorter than the window has no scroll to hold him with: it gets the room under it (past now, with
        // 60 px to spare so the hold is not read as now), until Back to now.
        if (want > max - 60) {
          CAP.room = (CAP.room || 0) + want - max + 60;
          capIn.style.minHeight = `calc(100% + ${160 + CAP.room}px)`;
        }
        capBox.scrollTop = want;
        pullView(0, null);
      }
    }
    function backToNow() {
      if (ui.tab !== 'ev') return;
      CAP.loaded = 0;
      CAP.pastToday = false;
      CAP.pull = null;
      CAP.stick = true;
      capNow.hidden = true;
      CAP.room = 0;
      capIn.style.minHeight = '';
      CAP.lift = 0;
      capPull.style.marginBottom = '';
      renderStage();
      renderThread();
      requestAnimationFrame(() => {
        if (CAP.anchorTop == null)
          capBox.scrollTo({ top: capBox.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });
      });
    }
    // B-209 (D-210, amending D-122): his line stays in the conversation as a quiet right-aligned line instead of a 3 s
    // echo above the composer; it is announced once.
    function capEcho(id, text) {
      announce(id, 'You: ' + text);
    }
    // A caption's words, each its own span (the Breath reveal), from the same paragraphs, bullets and bold fmt() makes.
    function capWords(frag) {
      const walk = n => {
        for (const c of [...n.childNodes]) {
          if (c.nodeType === 3) {
            const parts = c.textContent.split(/(\s+)/);
            const f = document.createDocumentFragment();
            for (const w of parts) {
              if (!w) continue;
              if (/^\s+$/.test(w)) f.append(document.createTextNode(w));
              else f.append(el('span', 'w', w));
            }
            c.replaceWith(f);
          } else if (c.nodeType === 1 && c.tagName !== 'A') walk(c);
          else if (c.nodeType === 1) {
            c.classList.add('w');
          }
        }
      };
      walk(frag);
      return frag;
    }
    // The Breath reveal (D-122, paced by D-137): words fade and un-blur in, the first sentence at speech pace (about 3
    // words a second, pausing at punctuation), then faster, so the whole reply is out within 6 s; a tap on her line, a
    // scroll or a newer line shows the rest at once. Each word shown is one speak() to her core (emphasis, bold, in
    // the text colour), so her swell ends with the last word; a finished sentence is announced; the reply's gesture comes when the
    // last word is out. Reduced motion shows the line whole and announces it once.
    function revealFinish(id) {
      const rec = T.els.get(id),
        st = CAP.rv.get(id);
      if (!rec || !st) return;
      const b = rec.el.querySelector('.bubble');
      const ws = b ? [...b.querySelectorAll('.w')] : [];
      ws.forEach(w => w.classList.add('on'));
      if (st.from < ws.length)
        announce(
          id + ':' + st.from,
          ws
            .slice(st.from)
            .map(x => x.textContent)
            .join(' ')
        );
      st.n = st.from = ws.length;
      if (b) b.classList.remove('reveal');
    }
    function revealQueue(m) {
      if (reduced() || CAP.rv.has(m.id)) return;
      while (CAP.queue.length) revealFinish(CAP.queue.shift());
      CAP.rv.set(m.id, { n: 0, from: 0, t0: null, first: true, all: false });
      CAP.queue.push(m.id);
      if (!CAP.timer) CAP.timer = setTimeout(revealTick, 120);
    }
    // D-137: a tap on her line or a scroll completes the reveal at once (a newer line already does, in revealQueue).
    function revealNow() {
      const id = CAP.queue[0],
        st = id && CAP.rv.get(id);
      if (!st || st.all) return;
      st.all = true;
      clearTimeout(CAP.timer);
      CAP.timer = null;
      revealTick();
    }
    capIn.addEventListener('click', e => {
      if (e.target.closest('.msg.ev.current .bubble')) revealNow();
    });
    for (const k of ['wheel', 'touchmove']) capBox.addEventListener(k, revealNow, { passive: true });
    capBox.addEventListener('keydown', e => {
      if (/^(Page|Arrow)(Up|Down)$|^(Home|End)$/.test(e.key)) revealNow();
    });
    // The pace (D-137): a word's natural gap is its speech time; after the first sentence each gap shrinks to what is
    // left of the 6 s over the words left, and once a gap would be under a frame, several words come out together.
    const PACE = { wordMs: 230, charMs: 14, commaMs: 200, stopMs: 380, maxMs: 6000, frameMs: 16 };
    const naturalMs = w =>
      PACE.wordMs +
      w.length * PACE.charMs +
      (/[,;:—]$/.test(w) ? PACE.commaMs : 0) +
      (/[.?!…]["”’)]*$/.test(w) ? PACE.stopMs : 0);
    // How a reply ends on her core: an error recoils, a reply that changed the record nods, the rest settle.
    const endGesture = m =>
      m.error && m.error !== 'cancelled' ? 'error' : (m.cards || []).length && !m.greeting ? 'done' : 'settle';
    function revealTick() {
      CAP.timer = null;
      const id = CAP.queue[0];
      if (!id) {
        T.revealing = false;
        return;
      }
      const rec = T.els.get(id),
        st = CAP.rv.get(id);
      const ws = rec ? [...rec.el.querySelectorAll('.bubble .w')] : [];
      const later = ms => {
        CAP.timer = setTimeout(revealTick, ms);
      };
      if (st.n < ws.length) {
        if (st.t0 == null) st.t0 = Date.now();
        const left = ws.length - st.n,
          budget = PACE.maxMs - (Date.now() - st.t0);
        // How many words this tick shows: one, or (past the first sentence, short of time, or completed) more at once.
        let k = 1,
          gap = naturalMs(ws[st.n].textContent);
        if (st.all) k = left;
        else if (!st.first) {
          const per = budget / left;
          if (per < PACE.frameMs) k = Math.min(left, Math.ceil(PACE.frameMs / Math.max(1, per)));
          gap = Math.min(gap, Math.max(PACE.frameMs, per * k));
        } else if (budget <= 0) {
          k = left;
        }
        let word = '',
          em = false;
        for (let i = 0; i < k; i++) {
          const w = ws[st.n++];
          w.classList.add('on');
          word = w.textContent;
          em = em || !!w.closest('b');
          const blk = w.closest('p, li'),
            blkWs = blk ? blk.querySelectorAll('.w') : null;
          if (/[.!?…]["”’)]*$/.test(word) || (blkWs && blkWs[blkWs.length - 1] === w)) {
            announce(
              id + ':' + st.from,
              ws
                .slice(st.from, st.n)
                .map(x => x.textContent)
                .join(' ')
            );
            st.from = st.n;
            st.first = false;
          }
        }
        T.revealing = true;
        CORE.speak(word, { emphasis: em });
        if (st.n >= ws.length) gap = Math.min(gap, PACE.frameMs * 4); // the last word out: speech ends with it
        later(st.all ? 0 : gap);
        return;
      }
      const m = rec && rec.msg;
      if (!m || m.pending) {
        later(80);
        return;
      } // still streaming: wait for more words
      if (st.from < ws.length)
        announce(
          id + ':' + st.from,
          ws
            .slice(st.from)
            .map(x => x.textContent)
            .join(' ')
        );
      if (rec) rec.el.querySelector('.bubble') && rec.el.querySelector('.bubble').classList.remove('reveal');
      CAP.queue.shift();
      CORE.speechEnd();
      CORE.gesture(endGesture(m));
      T.revealing = CAP.queue.length > 0;
      if (CAP.queue.length) later(400);
    }

    if (STAGING) $('sys-staging').hidden = false; // B-85: the staging note lives in System with the privacy note

    const clock12 = iso => {
      const c = E.chicagoClock(iso);
      if (!c) return '';
      const [h, m] = c.split(':').map(Number);
      return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
    };
    const dayLabel = d => (d === today ? 'Today' : d === E.addDays(today, -1) ? 'Yesterday' : short(d));
    let lastMs = 0; // message keys: m-<YYYYMMDD-HHMMSSmmm>-<who> (v4); ids sort by time, never the same twice on this page
    function msgId(suffix) {
      let ms = Date.now();
      if (ms <= lastMs) ms = lastMs + 1;
      lastMs = ms;
      return (
        'm-' +
        E.compactTime(new Date(ms).toISOString()) +
        '-' +
        ({ e: 'ev', m: 'matt', g: 'greeting' }[suffix] || suffix)
      );
    }
    const clean = o => JSON.parse(JSON.stringify(o)); // drops undefined before a write

    // Text: paragraphs, "- " bullets, **bold**, and https links. Built from text nodes only.
    function inline(parent, text) {
      for (const part of String(text).split(
        /(\*\*[^*]+\*\*|https:\/\/[^\s)]+|\([^()\n]{2,90}?, (?:p\.|pp\.|page|slide) \d{1,4}\))/gi
      )) {
        if (!part) continue;
        const cite = /^\(.*\)$/.test(part) ? E.parseCite(part.slice(1, -1)) : null;
        if (cite) {
          // B-78 (D-126): a library citation is an underlined file · page span, revealed whole; it opens the passage
          const a = el('a', 'cite', cite.cite);
          a.href = '#';
          a.dataset.cite = cite.cite;
          parent.append('(', a, ')');
        } else if (/^\*\*[^*]+\*\*$/.test(part)) parent.append(el('b', null, part.slice(2, -2)));
        else if (/^https:\/\//.test(part)) {
          const a = el('a', null, part.replace(/^https:\/\/(www\.)?/, '').slice(0, 60));
          a.href = part;
          a.target = '_blank';
          a.rel = 'noopener';
          parent.append(a);
        } else parent.append(document.createTextNode(part));
      }
    }
    function fmt(text) {
      const frag = document.createDocumentFragment();
      let ul = null;
      for (const raw of String(text || '').split('\n')) {
        const line = raw.trimEnd();
        if (/^\s*[-•*]\s+/.test(line)) {
          if (!ul) {
            ul = el('ul');
            frag.append(ul);
          }
          const li = el('li');
          inline(li, line.replace(/^\s*[-•*]\s+/, ''));
          ul.append(li);
          continue;
        }
        ul = null;
        if (!line.trim()) continue;
        const p = el('p');
        inline(p, line.replace(/^#+\s*/, ''));
        frag.append(p);
      }
      return frag;
    }

