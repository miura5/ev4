    // ---------------------------------------------------------------- skills practice (Features: "Skills practice mode")
    const activeSkill = () =>
      S.sessions
        .filter(s => s.kind === 'skill' && s.status === 'active')
        .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] || null;
    // B-82 (Matt, Oct 19). The runner is the bottom sheet (D-107, D-124); while a run goes her line carries no card. A run
    // found already going when the page opens waits behind a Resume chip, so the greeting is never covered; Hide does
    // the same on purpose. A run untouched for the conversation idle gap ends itself (skillIdle).
    const SK = { open: false, parked: null, ending: false, chip: null };
    const skillGoing = s => !!(s && s.status === 'active' && s.skill && E.skillState(s).next);
    function skillParkInit() {
      if (SK.parked == null && loaded.has('sessions')) SK.parked = skillGoing(activeSkill());
    }
    const skillShown = () => {
      skillParkInit();
      return !SK.parked && skillGoing(activeSkill());
    };
    const resumeChip = () => {
      skillParkInit();
      const s = activeSkill();
      return SK.parked && skillGoing(s) ? E.skillResumeChip(s) : null;
    };
    function skillPark(on) {
      SK.parked = on;
      SK.open = false;
      regreet();
      render();
    }
    // A reply's cards as Captions shows them: a running skills run's card stays out (the sheet is the runner).
    // B-183: a copy card is the message's own Copy chip (68-ev-thread), never a surface.
    const shownCards = m =>
      (m.cards || []).filter(c => c && c.type !== 'copy' && !(c.type === 'skill' && skillGoing(sessOf(c.session))));
    async function startSkillRun(skill, page) {
      if (activeSkill()) {
        SK.parked = false;
        return {
          text: 'A skills run is already going; it’s in the sheet above the composer. Finish or stop it first.',
          card: { type: 'skill', session: activeSkill().id },
        };
      }
      const L = await library();
      let sk = null;
      const hits = page ? [] : E.searchLibrary(L.idx, (skill || '') + ' validation checklist', { kind: 'lab', k: 8 });
      // A hit can land on the page after a checklist begins (or on its documentation page), so its neighbors are tried too.
      const tries = page
        ? L.mats.filter(m => E.materialKind(m) === 'lab').map(m => ({ id: m.id, page }))
        : hits.flatMap(h => (h.page ? [h, { id: h.id, page: h.page - 1 }, { id: h.id, page: h.page + 1 }] : [h]));
      // Every candidate page's checklist, kept when its own title names the skill he asked for (a search hit can be the
      // table of contents or the checklist before it); otherwise the first checklist found.
      const want = new Set(E.libTokens(skill || ''));
      let best = -1;
      for (const h of tries) {
        const m = L.mats.find(x => x.id === h.id);
        if (!m) continue;
        const got = E.skillSteps(m, { page: h.page });
        if (got.steps.length < 3) continue;
        const tt = E.libTokens(got.title);
        const score = tt.filter(w => want.has(w)).length - 0.1 * tt.filter(w => !want.has(w)).length;
        if (score > best) {
          best = score;
          sk = got;
        }
      }
      if (!sk)
        return {
          text: `I couldn’t find a numbered checklist for “${skill}” in your materials. Name the skill as the Skills Packet does, or tell me its page.`,
        };
      const w = E.startSkill(sk, { now: now(), date: today });
      SK.parked = false;
      await write(w);
      return {
        text: `${sk.title}: ${plural(sk.steps.length, 'step')} from ${sk.cite}. Mark each one as you go.`,
        card: { type: 'skill', session: w.id },
      };
    }
    async function skillMark(s, n, result) {
      await run(E.skillStep(s, n, result, { weakspots: M.models, now: now(), by: 'Matt' }));
      const s2 = sessOf(s.id);
      if (s2 && E.skillState(s2).complete) await finishSkill(s2, 'complete');
    }
    async function finishSkill(s, why) {
      await write(E.endSkill(s, { now: now(), endedBy: why }));
    }
    // D-107: the checklist stays in view while he practises, so he never scrolls up to tick a step. On the phone a bottom
    // sheet rides on the composer: a peek bar (the current step, its count, Missed it and Did it) that opens to the whole
    // ticked list; at 1024px and up a side panel beside the thread. Both mark through skillMark, like the card.
    function skillList(s, st) {
      const ol = el('ol', 'sk-steps');
      for (const step of s.skill.steps) {
        const r = st.results[step.n];
        const cur = st.next && st.next.n === step.n;
        const li = el('li', 'sk-step' + (r ? ' ' + r : '') + (cur ? ' cur' : ''));
        const mark = el('span', 'sk-mark', r === 'pass' ? '✓' : r === 'miss' ? '✗' : cur ? '•' : '');
        mark.setAttribute('aria-hidden', 'true');
        const txt = el('span', 'sk-txt');
        txt.append(el('b', null, step.n + '. '), document.createTextNode(step.text));
        if (step.critical) txt.append(el('span', 'sk-crit', ' must not miss'));
        li.append(mark, txt);
        li.setAttribute(
          'aria-label',
          `Step ${step.n}${r === 'pass' ? ', done' : r === 'miss' ? ', missed' : cur ? ', current' : ''}: ${step.text}`
        );
        if (cur) li.setAttribute('aria-current', 'step');
        ol.append(li);
      }
      return ol;
    }
    function skillButtons(s, step, cls) {
      const a = el('div', 'sk-acts' + (cls ? ' ' + cls : ''));
      const miss = btn('Missed it', ev =>
        guard(ev.target, () => skillMark(s, step.n, 'miss'), 'Logged as a skill to practice')
      );
      const did = btn('Did it', ev => guard(ev.target, () => skillMark(s, step.n, 'pass')), { primary: true });
      a.append(miss, did);
      return a;
    }
    // B-212 (D-217): a run follows the session pattern: its one quiet line in the pane header (where it is, and End),
    // its current step and buttons in the pane, its whole list in the right panel from 1200 px.
    function runBar(text, acts, label) {
      let bar = $('kbar');
      if (!bar) {
        bar = el('div', 'sbar kbar');
        bar.id = 'kbar';
        bar.setAttribute('role', 'region');
        $('mh').insertBefore(bar, $('status').nextSibling);
      }
      if (!text) {
        if (!bar.hidden) {
          bar.hidden = true;
          bar.replaceChildren();
          bar.dataset.k = '';
        }
        return bar;
      }
      bar.hidden = false;
      bar.setAttribute('aria-label', label);
      const k = text + '|' + acts.map(b => b.textContent).join(',');
      if (bar.dataset.k !== k) {
        bar.dataset.k = k;
        const led = el('span', 's-led');
        led.setAttribute('aria-hidden', 'true');
        const main = el('span', 's-main');
        main.append(el('span', 's-clock', text));
        const a = el('div', 's-acts');
        a.append(...acts);
        bar.replaceChildren(led, main, a);
      }
      return bar;
    }
    const runWide = () => innerWidth >= 1200;
    function placePanel(panel, on) {
      if (on && runWide()) {
        if (panel.parentNode !== capSide) capSide.append(panel);
      } else if (panel.parentNode) panel.remove();
    }
    addEventListener('resize', () => {
      const p = $('skpanel') || SK.panel;
      if (p) placePanel(p, document.body.classList.contains('skill-on'));
    });
    // D-108 on the runner pattern: a running workout keeps its clock, the round's moves and its buttons in the same dock.
    function renderWorkoutDock(w, q, sheet, panel) {
      const st = E.workoutState(w, q, now());
      // From 1200 px the workout's card is the right panel's surface already (its clock and moves): no second copy.
      placePanel(panel, false);
      const k = ['wo', w.id, st.done, st.over].join('|');
      if (sheet.dataset.k === k && panel.dataset.k === k) return;
      sheet.dataset.k = panel.dataset.k = k;
      sheet.hidden = panel.hidden = false;
      sheet.classList.remove('open');
      const where =
        q.kind === 'ladder'
          ? `Round ${Math.min(st.done + 1, st.total)} of ${st.total}`
          : st.over
            ? plural(st.done, 'round')
            : `Round ${st.done + 1}`;
      const clock = () => {
        const c = el('span', 'sk-clock', clockText(w, q));
        c.dataset.woClock = w.id;
        return c;
      };
      const acts = () => {
        const a = el('div', 'sk-acts');
        if (st.over) {
          a.append(
            btn(
              'Show the card',
              () => {
                const n = [...document.querySelectorAll('#ev-surf .wo-extra')].pop(); // B-78: the card is a surface
                if (n) n.scrollIntoView({ block: 'center' });
              },
              { primary: true }
            )
          );
          a.style.gridTemplateColumns = '1fr';
          return a;
        }
        a.style.gridTemplateColumns = '1fr';
        a.append(
          btn(
            'Round done',
            ev =>
              guard(ev.target, async () => {
                await write(E.workoutRound(w, q, { now: now() }));
                const w2 = woOf(w.id);
                if (w2 && q.kind === 'ladder' && E.workoutState(w2, q, now()).over)
                  await write(E.endWorkout(w2, q, { now: now() }));
              }),
            { primary: true }
          )
        );
        return a;
      };
      const stop = st.over
        ? []
        : [
            btn(q.kind === 'ladder' ? 'Stop here' : 'Finish', ev =>
              guard(ev.target, () => write(E.endWorkout(w, q, { now: now(), stopped: true })), 'Workout saved')
            ),
          ];
      if (stop[0]) stop[0].classList.add('end');
      runBar(q.title + ' · ' + where, stop, 'Workout: ' + q.title);
      const bc = $('kbar').querySelector('.s-clock');
      if (bc && !bc.querySelector('[data-wo-clock]')) bc.append(document.createTextNode(' · '), clock());
      const moves = st.over
        ? 'Time! Enter the reps into your next round on the card.'
        : st.moves.map(m => m.reps + ' ' + m.move).join(' · ');
      const peek = el('div', 'sk-peek');
      const top = el('div', 'sk-tog sk-static');
      const line = el('span', 'sk-count');
      line.append(document.createTextNode(q.title + ' · ' + where + ' · '), clock());
      top.append(line, el('span', 'sk-now', moves));
      peek.append(top, acts());
      sheet.replaceChildren(peek);
      const ph = el('div', 'sk-head');
      const t = el('div', 'sk-headtxt');
      t.append(el('span', 'sk-title', 'Workout · ' + q.title), el('span', 'meta', where));
      ph.append(t);
      const big = el('p', 'wo-clock');
      big.append(clock());
      const ul = el('ul', 'wo-moves');
      if (!st.over)
        for (const m of st.moves) {
          const li = el('li');
          li.append(el('b', null, String(m.reps)), document.createTextNode(' ' + m.move));
          ul.append(li);
        }
      panel.replaceChildren(ph, big, ...(st.over ? [el('p', 'meta', moves)] : [ul]), el('p', 'meta', q.source || ''));
    }
    function renderSkillDock() {
      const s = activeSkill();
      const st = s && s.skill ? E.skillState(s) : null;
      const live = !!(st && st.next) && skillShown();
      const rc = resumeChip();
      if (rc !== SK.chip) {
        SK.chip = rc;
        regreet();
      }
      document.body.classList.toggle('skill-on', live);
      let sheet = $('sksheet'),
        panel = $('skpanel');
      if (!sheet) {
        sheet = el('div', 'sk-sheet');
        sheet.id = 'sksheet';
        sheet.setAttribute('role', 'region');
        sheet.setAttribute('aria-label', 'Skills checklist');
        $('composer').prepend(sheet);
      }
      if (!panel) panel = SK.panel;
      if (!panel) {
        panel = SK.panel = el('section', 'sk-panel');
        panel.id = 'skpanel';
        panel.setAttribute('aria-label', 'Skills checklist');
      }
      if (!live) {
        const w = activeWorkout();
        const q = w && SEQ[w.sequence];
        if (w && q) {
          document.body.classList.add('skill-on');
          renderWorkoutDock(w, q, sheet, panel);
          return;
        }
        if (!sheet.hidden) {
          sheet.hidden = true;
          sheet.replaceChildren();
        }
        if (!panel.hidden) {
          panel.hidden = true;
          panel.replaceChildren();
        }
        placePanel(panel, false);
        runBar(null);
        sheet.dataset.k = panel.dataset.k = '';
        SK.open = false;
        return;
      }
      placePanel(panel, true);
      const k = [s.id, JSON.stringify(st.results), SK.open, SK.pfold].join('|');
      if (sheet.dataset.k === k && panel.dataset.k === k) return;
      sheet.dataset.k = panel.dataset.k = k;
      sheet.hidden = panel.hidden = false;
      const step = st.next;
      const count = `Step ${step.n} of ${st.total}`;
      const tally = `${st.done} of ${st.total} done${st.missed.length ? ' · ' + st.missed.length + ' missed' : ''}`;
      const endB = btn('End', ev => guard(ev.target, () => finishSkill(s, 'ended'), 'Skills run saved'));
      endB.classList.add('end');
      runBar(count + (st.missed.length ? ' · ' + st.missed.length + ' missed' : ''), [endB], 'Skills run: ' + s.topic);
      // Phone: the peek bar, and the list above it when open.
      sheet.classList.toggle('open', SK.open);
      const peek = el('div', 'sk-peek');
      // B-212: End is the header bar's; no Hide, its peek line folds the sheet (B-122, D-161).
      const top = el('div', 'sk-top');
      top.append(el('span', 'sk-count', count));
      const tog = el('button', 'sk-tog');
      tog.type = 'button';
      tog.setAttribute('aria-expanded', String(SK.open));
      tog.setAttribute('aria-controls', 'sksheet-list');
      tog.setAttribute('aria-label', (SK.open ? 'Fold' : 'Open') + ' the full checklist. ' + count + ': ' + step.text);
      tog.append(el('span', 'sk-now', step.text));
      tog.addEventListener('click', () => {
        SK.open = !SK.open;
        renderSkillDock();
      });
      peek.append(top, tog, skillButtons(s, step));
      const body = el('div', 'sk-body');
      body.id = 'sksheet-list';
      body.hidden = !SK.open;
      if (SK.open) {
        const h = el('div', 'sk-head');
        const t = el('div', 'sk-headtxt');
        t.append(el('span', 'sk-title', s.topic), el('span', 'meta', tally));
        h.append(t);
        body.append(h, skillList(s, st));
      }
      sheet.replaceChildren(body, peek);
      // Desktop: the whole list beside the thread, the current step with its buttons on top.
      // Its head line folds the panel to that one line and back (B-122, D-160).
      const pf = el('button', 'fold-line sk-pfold', 'Skills · ' + s.topic);
      pf.type = 'button';
      pf.setAttribute('aria-expanded', String(!SK.pfold));
      pf.addEventListener('click', () => {
        SK.pfold = !SK.pfold;
        renderSkillDock();
      });
      const ph = el('div', 'sk-head');
      ph.append(pf, el('span', 'meta', tally));
      const pr = el('div', 'progress');
      const bar = el('i');
      bar.style.width = (st.total ? (100 * st.done) / st.total : 0) + '%';
      pr.append(bar);
      panel.classList.toggle('folded', !!SK.pfold);
      // B-212: the right panel is the list; the current step and its buttons are the pane's.
      panel.replaceChildren(ph, ...(SK.pfold ? [] : [pr, skillList(s, st), el('p', 'meta', s.skill.cite || '')]));
      const curLi = sheet.querySelector('.sk-step.cur');
      if (curLi && SK.open) curLi.scrollIntoView({ block: 'nearest' });
    }

