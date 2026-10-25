    // ------------------------------------------------------------ question runner (single, select-all, matrix)
    const views = {};
    const sels = {};
    // D-095: every attempt is truth. A retake shows a set fresh: only the attempts since it began count in the runner;
    // every new answer is appended like any other, the weak spots see all of them, and outside the retake the page shows
    // each item's latest attempt.
    const retakes = {};
    // B-222 (D-227): an answer paints on Check answer, before the record answers: painted[setId][itemId] holds it until
    // the record carries an attempt at least as new (then the record's own is shown), or a refusal takes it back.
    const painted = {};
    // B-370 (D-316): whether Study's open quiz ('rv' or 'pr') shows its results; her line under the header goes then
    const quizAtEnd = {};
    function withPainted(set, out) {
      const p = set && painted[set.id];
      if (!p) return out;
      const res = { ...out },
        from = retakes[set.id],
        rec = answersOf(set);
      for (const [qid, a] of Object.entries(p)) {
        if (rec[qid] && rec[qid].at >= a.at)
          delete p[qid]; // the record has it now
        else if (!(from && a.at < from)) res[qid] = a; // a retake shows only what came after it
      }
      return res;
    }
    function answersFor(set) {
      return withPainted(set, answersRecorded(set));
    }
    function answersRecorded(set) {
      const from = set && retakes[set.id];
      if (!from) return answersOf(set);
      const doc = S.answers.find(a => a.id === set.id || a.setId === set.id);
      const out = {};
      for (const [qid, tries] of Object.entries((doc && doc.answers) || {})) {
        const k = Object.keys(tries || {})
          .filter(x => tries[x] && tries[x].at && tries[x].at >= from)
          .sort()
          .pop();
        if (k) out[qid] = tries[k];
      }
      return out;
    }
    function renderStudySide() {
      const side = $('study-side');
      if (!side) return;
      // B-365 (D-316): as the demo, the side pane sits beside the pane from 1200 px and under it below that (a quiz's
      // questions, Weak spots' triage card); the objective opens under its row and the plan leads its rows there instead
      const shown = [...studyLists.entries()].find(
        ([b]) => b.isConnected && !b.closest('[hidden]') && ui.tab === 'study'
      );
      // B-337 (D-312): with no set open, Objectives' picked objective (ui.objPanel, 20-study) fills the panel
      const obj =
        !shown && ui.tab === 'study'
          ? ui.study === 'weak' // B-347: Weak spots' panel card
            ? ui.weakPanel
            : !PANEL.matches
              ? null
              : ui.study === 'objectives'
                ? ui.objPanel
                : ui.study === 'plan' // B-348: the plan's summary
                  ? ui.planPanel
                  : null
          : null;
      side.hidden = !shown && !obj;
      side.setAttribute(
        'aria-label',
        obj
          ? ui.study === 'weak'
            ? 'How triage works'
            : ui.study === 'plan'
              ? 'The plan'
              : 'The picked objective'
          : 'This quiz'
      );
      if (obj) return side.replaceChildren(obj);
      if (!shown) return side.replaceChildren();
      // B-348 (D-312): the demo's "This quiz": a dot per question (green right, red missed, violet now), then one note
      const card = el('div', 'ov-detail qz-side'),
        n = shown[1].list.children.length;
      card.append(
        el('span', 'lab', 'This quiz'),
        shown[1].list,
        el(
          'span',
          'mini od-note',
          plural(n, 'question') +
            '. Keys A to ' +
            'ABCDEFGHI'[Math.min(8, Math.max(0, (shown[1].opts || 4) - 1))] +
            ' answer; Enter goes on.'
        )
      );
      side.replaceChildren(card);
    }
    function retake(set, key) {
      retakes[set.id] = now();
      views[key] = null;
      for (const k of Object.keys(sels)) if (k.startsWith(key)) delete sels[k];
      render();
    }
    // B-126 (D-165): the folds the page keeps while it is open: a set's list under its counter, the other options' whys
    // under an answer, a finished set's lines and its right answers.
    const setOpen = {},
      whyOpen = {},
      sumOpen = {},
      accepted = new Set(); // B-376: the weak spots whose misses he has accepted from a results card
    const verdictWord = (a, type) =>
      a.grade // B-75 (D-132, D-165): an open answer's grade, in a word
        ? { right: 'Right', partial: 'Partly right', wrong: 'Missed' }[a.grade] || 'Missed'
        : a.correct
          ? 'Right'
          : type !== 'single' && a.score > 0
            ? `Partly right (${Math.round(a.score * 100)}%)`
            : 'Missed';
    // The outcome core wrote ("Right. One more correct check on Wed 10/21 makes it solid.") as the verdict's second half.
    function outcomeLine(o) {
      let t = String(o || '')
        .trim()
        .replace(/^(right|correct|not quite|missed|wrong|partly right)[^.!]*[.!]\s*/i, '')
        .replace(/[.\s]+$/, '');
      return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
    }
    function oneLine(q, a) {
      const i = (q.correct || [])[0],
        tidy = t =>
          String(t || '')
            .trim()
            .replace(/[.\s]+$/, ''),
        why = tidy((q.rationales || [])[i]).replace(/^(right|correct|yes)\b[.!:,;]?\s*/i, ''),
        Why = why ? why.charAt(0).toUpperCase() + why.slice(1) : '';
      return a.correct
        ? 'Right.' + (Why ? ' ' + Why + '.' : '')
        : 'Not quite. ' + tidy((q.options || [])[i]) + (why ? '; ' + why : '') + '.';
    }
    function setLines(key, items, answers, current) {
      // the set as one line per question, under its counter
      const ul = el('ul', 'list set-list');
      items.forEach((q, i) => {
        const a = answers[q.id];
        const li = el('li', 'row set-item' + (q.id === current ? ' current' : ''));
        const b = el('button', 'set-q');
        b.type = 'button';
        if (q.id === current) b.setAttribute('aria-current', 'true');
        const dot = el('i', 'dot sq-d' + (a ? (a.correct ? ' ok' : ' no') : q.id === current ? ' now' : ''));
        dot.setAttribute('aria-hidden', 'true');
        // B-365: in Study the pane lists the questions themselves, as the demo's This quiz
        const words = key === 'rv' || key.startsWith('pr-') ? q.stem || q.topic : q.topic || q.stem;
        b.setAttribute('aria-label', 'Question ' + (i + 1) + ': ' + words);
        b.title = words;
        b.append(
          dot,
          el('span', 'sq-t', words),
          el(
            'span',
            'sq-s' + (a ? (a.correct ? ' ok' : ' no') : ''),
            a ? (a.correct ? 'right' : 'missed') : q.id === current ? 'now' : ''
          )
        );
        b.addEventListener('click', () => {
          views[key] = q.id;
          if (!WIDE.matches) setOpen[key] = false;
          render();
        });
        li.append(b);
        ul.append(li);
      });
      return ul;
    }
    function foldLine(text, open, onToggle, cls) {
      const f = el('button', 'fold-line' + (cls ? ' ' + cls : ''), text);
      f.type = 'button';
      f.setAttribute('aria-expanded', String(!!open));
      f.addEventListener('click', onToggle);
      return f;
    }
    function runner(o) {
      // o: {key, set, items, body, countEl, barEl, label, summaryExtra, more, next}
      const { key, set, items, body } = o;
      const inStudy = key === 'rv' || key.startsWith('pr-');
      if (inStudy) studyLists.delete(body);
      const answers = answersFor(set);
      const done = items.filter(q => answers[q.id]).length;
      if (o.barEl) o.barEl.style.width = items.length ? (100 * done) / items.length + '%' : '0';
      let view = views[key];
      if (view !== '__summary' && (!view || !items.find(q => q.id === view)))
        view = views[key] = (items.find(q => !answers[q.id]) || {}).id || '__summary';
      if (view === '__summary' && items.some(q => !answers[q.id]))
        view = views[key] = items.find(q => !answers[q.id]).id; // the score waits for the last answer
      if (inStudy) quizAtEnd[key === 'rv' ? 'rv' : 'pr'] = view === '__summary';
      // B-126 (D-165): the counter is the set's fold line (it replaces All questions); a finished set has nothing under it.
      if (o.countEl) {
        const c = o.countEl,
          flat = view === '__summary' || inStudy; // B-365: in Study the pane holds the list at every width
        // B-348 (D-312): the demo's card label, "Question 2 of 8 · Today's review", and "3 right so far" beside it
        const at = items.findIndex(x => x.id === view);
        c.textContent = !items.length
          ? ''
          : o.title
            ? view === '__summary'
              ? o.title + ' · done'
              : 'Question ' + (at + 1) + ' of ' + items.length + ' · ' + o.title
            : done + ' of ' + items.length;
        c.hidden = !items.length;
        c.classList.toggle('flat', flat);
        c.disabled = flat;
        c.setAttribute('aria-expanded', String(!flat && !!setOpen[key]));
        c.onclick = () => {
          setOpen[key] = !setOpen[key];
          render();
        };
      }
      if (o.barEl && o.barEl.parentElement.classList.contains('qz-bar'))
        o.barEl.parentElement.hidden = view === '__summary';
      if (o.scoreEl)
        o.scoreEl.textContent =
          view === '__summary'
            ? ''
            : items.filter(q => answers[q.id] && answers[q.id].correct).length + ' right so far';
      if (view === '__summary') {
        if (inStudy) studyLists.set(body, { key, list: setLines(key, items, answers, null) });
        return summary(o, items, answers);
      }
      const q = items.find(x => x.id === view);
      const a = answers[q.id];
      const type = E.itemType(q);
      // B-192: options and matrix rows show in the set's seeded order (set id and item id, never the place); his picks and
      // the answers stay in the item's own indices, so nothing is remapped.
      const shown = E.displayOrder(set, items)[q.id] || {};
      const sel =
        sels[key + q.id] ||
        (sels[key + q.id] = type === 'matrix' ? [] : type === 'numeric' || type === 'open' ? { v: '' } : new Set());
      // B-116 (D-146, D-276): the stem leads; what kind of question it is follows as one quiet line, no chips, no second count.
      const tags = el(
        'p',
        'meta q-tags',
        [
          q.weakspotId ? 'Weak spot' : q.kind === 'check' ? 'New check' : 'Practice',
          q.objective,
          q.cjStep ? cjLabel(q.cjStep) : '',
          type === 'sata'
            ? 'Select all that apply'
            : type === 'matrix'
              ? 'One choice per row'
              : type === 'open'
                ? 'In your own words'
                : '',
        ]
          .filter(Boolean)
          .join(' · ')
      );
      // B-365 (D-316): in Study a one-answer question grades on the tap (or A to D), as the demo: no Check answer, no
      // skip, and no kind line under the stem
      const instant = inStudy && type === 'single';
      const parts = [el('p', 'stem q-stem', q.stem), ...(instant ? [] : [tags])];
      // B-193 (D-205): a question resting on another course's passage names its source; its writer adds it to the stem, and
      // one written before that shows it under the stem once the library is open (it is never loaded just for this).
      const cross = LIB.mats ? E.crossCourse(q, { materials: LIB.mats, exams: S.exams, set }) : null;
      if (cross && cross.source && cross.item !== q)
        parts.push(el('p', 'meta q-src', cross.source.label.charAt(0).toUpperCase() + cross.source.label.slice(1)));
      // B-126 (D-165): answered, the verdict is one line under the stem (nothing above it moves); his pick and the right
      // answer carry their why; the other whys fold under one line.
      // B-348 (D-312): as the demo, the verdict line sits under the answers, above Next
      // B-370 (D-316): in Study a one-answer question's feedback is the demo's one sentence: Right, or Not quite with the
      // right answer, and its why; no line per answer, no Why not the others, no weak-spot outcome
      const verdict =
        a && instant
          ? el('p', 'verdict q-expl ' + (a.correct ? 'ok' : 'no'), oneLine(q, a))
          : a
            ? el(
                'p',
                'verdict ' + (a.correct ? 'ok' : 'no'),
                verdictWord(a, type) + (outcomeLine(a.outcome) ? ' · ' + outcomeLine(a.outcome) : '')
              )
            : null;
      const wk = key + q.id,
        restOpen = !!whyOpen[wk];
      let hasRest = false;
      const why = (text, keep) => {
        const s = el('span', 'why' + (keep ? '' : ' why-rest'), text);
        if (!keep) {
          hasRest = true;
          s.hidden = !restOpen;
        }
        return s;
      };
      const submit = btn('Check answer', null, { primary: true });
      const ready = () =>
        type === 'matrix'
          ? q.matrix.rows.every((_, i) => Number.isInteger(sel[i]))
          : type === 'numeric'
            ? !!E.numericGiven(sel.v)
            : type === 'open'
              ? !!String(sel.v).trim()
              : sel.size > 0;
      if (type === 'open') parts.push(...openParts(key, set, q, a, sel, () => (submit.disabled = !ready())));
      else if (type === 'numeric') {
        // B-43 (D-100): a number and its unit; answered, his number, the answer when he missed, and the worked steps.
        const row = el('div', 'num-row');
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.inputMode = 'decimal';
        inp.autocomplete = 'off';
        inp.className = 'num-in';
        inp.setAttribute('aria-label', 'Your answer in ' + q.unit);
        inp.value = a ? String((a.chosen && a.chosen.value) ?? '') : sel.v;
        inp.disabled = !!a;
        inp.addEventListener('input', () => {
          sel.v = inp.value;
          submit.disabled = !ready();
        });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !submit.disabled) submit.click();
        });
        row.append(inp, el('span', 'num-unit', q.unit));
        if (a) row.classList.add(a.correct ? 'right' : 'wrong');
        parts.push(row);
        if (a) {
          if (!a.correct) parts.push(el('p', 'num-answer', `Answer: ${q.answer} ${q.unit}`));
          const ol = el('ol', 'num-steps');
          ol.setAttribute('aria-label', 'Worked steps');
          (q.steps || []).forEach(t => ol.append(el('li', null, t)));
          parts.push(ol);
        }
      } else if (type === 'matrix') {
        const wrap = el('div', 'scroll');
        const t = el('table', 'mx');
        const hr = el('tr');
        hr.append(el('th', null, ''));
        q.matrix.columns.forEach(c => hr.append(el('th', null, c)));
        const th = el('thead');
        th.append(hr);
        t.append(th);
        const tb = el('tbody');
        (shown.rows || q.matrix.rows.map((_, i) => i)).forEach(ri => {
          const r = q.matrix.rows[ri];
          const tr = el('tr');
          const name = el('td');
          name.append(document.createTextNode(r.text));
          tr.append(name);
          if (a) {
            const ok = Array.isArray(a.chosen) && a.chosen[ri] === r.correct;
            tr.className = ok ? 'right' : 'wrong';
            if (r.rationale)
              name.append(why((ok ? '' : 'Answer: ' + q.matrix.columns[r.correct] + '. ') + r.rationale, !ok));
          }
          q.matrix.columns.forEach((c, ci) => {
            const td = el('td');
            const inp = document.createElement('input');
            inp.type = 'radio';
            inp.name = 'mx-' + key + q.id + '-' + ri;
            inp.setAttribute('aria-label', r.text + ': ' + c);
            inp.checked = a ? (a.chosen || [])[ri] === ci : sel[ri] === ci;
            inp.disabled = !!a;
            inp.addEventListener('change', () => {
              sel[ri] = ci;
              submit.disabled = !ready();
            });
            td.append(inp);
            tr.append(td);
          });
          tb.append(tr);
        });
        t.append(tb);
        wrap.append(t);
        parts.push(wrap);
      } else {
        const opts = el('fieldset', 'opts');
        (shown.options || q.options.map((_, i) => i)).forEach((i, pos) => {
          const txt = q.options[i];
          const lab = el('label', 'opt' + (a ? ' locked' : ''));
          const inp = document.createElement('input');
          inp.type = type === 'sata' ? 'checkbox' : 'radio';
          inp.name = 'q-' + key + q.id;
          inp.checked = a ? (a.chosen || []).includes(i) : sel.has(i);
          inp.disabled = !!a;
          inp.addEventListener('change', () => {
            if (type === 'sata') inp.checked ? sel.add(i) : sel.delete(i);
            else {
              sel.clear();
              sel.add(i);
            }
            submit.disabled = !ready();
          });
          // B-365: a tap answers at once, a second tap on the same answer included (after a refused save)
          if (instant)
            inp.addEventListener('click', () => {
              sel.clear();
              sel.add(i);
              if (!a && !submit.dataset.busy) {
                submit.dataset.busy = '1';
                submit.disabled = false;
                submit.click();
              }
            });
          const span = el('span', 'grow');
          span.append(document.createTextNode(txt));
          if (a) {
            const picked = (a.chosen || []).includes(i),
              right = q.correct.includes(i);
            if (right) lab.classList.add('right');
            else if (picked) lab.classList.add('wrong');
            if (!instant && q.rationales && q.rationales[i]) span.append(why(q.rationales[i], right || picked));
          }
          // B-211 (D-217): answers lettered as the demo (B-348), and keys A to D or 1 to 4 pick them
          const kb = el('kbd', 'opt-n', 'ABCDEFGHI'[pos] || String(pos + 1));
          kb.setAttribute('aria-hidden', 'true');
          lab.append(inp, kb, span);
          if (a && (lab.classList.contains('right') || lab.classList.contains('wrong')))
            lab.append(svgIcon(lab.classList.contains('right') ? 'M5 12.5l4.5 4.5L19 7.5' : 'M6 6l12 12M18 6L6 18'));
          opts.append(lab);
        });
        parts.push(opts);
      }
      if (verdict) parts.push(verdict);
      if (a && hasRest)
        parts.push(
          foldLine(
            type === 'matrix' ? 'Why the other rows' : 'Why not the others',
            restOpen,
            () => {
              whyOpen[wk] = !whyOpen[wk];
              render();
            },
            'why-fold'
          )
        );
      const actions = el('div', 'actions');
      // B-191: Back and Next walk the set in its order; an answered question shows its answer and why, an unanswered one
      // stays open to answer, so he can answer out of order. The score waits for the last answer.
      const at = items.findIndex(x => x.id === q.id),
        prev = items[at - 1],
        after = items[at + 1],
        go = id => {
          views[key] = id;
          render();
          // B-370: the next question (or the score) starts at the card's top, as the demo's, when it had scrolled away
          const card = inStudy && body.closest('.qz-card');
          if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start' });
        };
      if (prev && !instant) {
        const b = btn('Back', () => go(prev.id), { cls: 'quiet q-back' });
        b.setAttribute('aria-label', 'Back to question ' + at);
        actions.append(b);
      }
      if (a) {
        if (q.verify) parts.push(el('p', 'meta', 'Built from general knowledge: check it against your materials.'));
        const open = items.find(x => !answers[x.id] && x.id !== q.id);
        const nx = btn(
          after ? 'Next question' : open ? 'Next unanswered' : 'See results',
          () => go(after ? after.id : open ? open.id : '__summary'),
          { primary: true }
        );
        nx.classList.add('q-go');
        const kE = el('span', 'kbd', 'Enter');
        kE.setAttribute('aria-hidden', 'true');
        nx.append(kE);
        actions.append(nx);
      } else {
        submit.disabled = !ready();
        submit.addEventListener('click', async () => {
          submit.disabled = true;
          let chosen =
            type === 'matrix'
              ? q.matrix.rows.map((_, i) => sel[i])
              : type === 'numeric'
                ? { value: E.numericGiven(sel.v).value, unit: E.numericGiven(sel.v).unit || q.unit }
                : [...(sel.size != null ? sel : [])].sort((x, y) => x - y);
          if (type === 'open') {
            submit.textContent = 'Checking…';
            chosen = await gradeOpen(q, String(sel.v).trim());
            if (!chosen) {
              submit.disabled = false;
              submit.textContent = 'Check answer';
              return;
            }
          }
          let r;
          try {
            r = E.planAnswer({
              set,
              item: q,
              chosen,
              now: Date.now(),
              weakspots: M.models,
              exams: S.exams,
              plans: S.plansRaw,
              planedits: S.planedits,
              answers: S.answers,
              sets: S.sets,
              byWeakspot: M.attempts.byWeakspot,
              label: o.label,
            });
          } catch (e) {
            toast('Couldn’t check that answer: ' + (e.message || e.code));
            delete submit.dataset.busy;
            submit.disabled = false;
            submit.textContent = 'Check answer';
            return;
          }
          // The verdict and its why paint now; the write catches up (D-227). A refusal puts the question back unanswered,
          // his pick still in it, with one line saying why.
          (painted[set.id] = painted[set.id] || {})[q.id] = r.answer;
          if (r.correct) T.happyUntil = Date.now() + 1800;
          render();
          sfNod(body); // B-78: answered in a surface, she nods
          try {
            await run(r.writes);
          } catch (e) {
            if (painted[set.id] && painted[set.id][q.id] === r.answer) delete painted[set.id][q.id];
            render();
            toast('Couldn’t save that answer: ' + (e.message || e.code));
          }
        });
        const later = !inStudy && (after || items.find(x => !answers[x.id] && x.id !== q.id));
        if (later) {
          const b = btn('Next', () => go(later.id), { cls: 'quiet q-next' });
          b.setAttribute('aria-label', 'Next question, leaving this one open');
          actions.append(b);
        }
        if (!instant) actions.append(submit);
      }
      if (actions.children.length) parts.push(actions);
      if (inStudy)
        studyLists.set(body, {
          key,
          list: setLines(key, items, answers, q.id),
          opts: q.options && type !== 'matrix' ? q.options.length : 4,
        });
      // From 1024 px the set sits beside the question; below, it opens in place above it (from 1200 px in Study, the
      // right panel holds it instead).
      if (setOpen[key] && !inStudy) {
        const list = setLines(key, items, answers, q.id);
        if (WIDE.matches) {
          const main = el('div', 'q-main'),
            side = el('div', 'q-set');
          main.append(...parts);
          side.append(list);
          body.classList.add('q-beside');
          body.replaceChildren(main, side);
          return;
        }
        parts.unshift(list);
      }
      body.classList.remove('q-beside');
      body.replaceChildren(...parts);
    }
    // B-75 (D-132): an open answer. Graded by one model call (a hit per key point, shape-checked, gradeTimeoutMs),
    // else by core.gradeOpenLocal from the keyword groups, and the answer says Checked offline. His text is scanned for
    // identifiers before anything is sent or saved.
    async function gradeOpen(q, text) {
      const o = (EV_SPEC.items && EV_SPEC.items.open) || {};
      text = text.slice(0, o.answerMaxChars || 600);
      const ids = idUnpassed(text); // B-197: values only; a field name alone is no candidate
      if (ids.length) {
        toast(`Your answer looks like it ${ids[0].why}, so I didn’t send it. Take that detail out and check again.`);
        return null;
      }
      let hits = null;
      if (sample && !T.sampleOff)
        try {
          const out = await Promise.race([
            sample.json(E.gradePrompt(q, text), { modelTier: 'quick', cache: false }),
            new Promise(ok => setTimeout(() => ok(null), o.gradeTimeoutMs || 8000)),
          ]);
          hits = E.parseGrade(out, q);
        } catch (e) {
          hits = null;
        }
      return hits ? { text, hits, gradedBy: 'model' } : { text, gradedBy: 'local' };
    }
    const addOpen = {};
    // Answered, the verdict line stays above; under it his answer, then each key point as a line, hit or missed; Checked
    // offline when the keyword groups graded it; the model answer; and after a partial grade, Add to it once (D-165).
    function openParts(key, set, q, a, sel, changed) {
      const parts = [];
      if (!a) {
        const ta = document.createElement('textarea');
        ta.className = 'open-in';
        ta.rows = 3;
        ta.maxLength = ((EV_SPEC.items && EV_SPEC.items.open) || {}).answerMaxChars || 600;
        ta.placeholder = 'Explain it in a few sentences';
        ta.setAttribute('aria-label', 'Your answer');
        ta.value = sel.v;
        ta.addEventListener('input', () => {
          sel.v = ta.value;
          changed();
        });
        parts.push(ta);
        return parts;
      }
      parts.push(el('p', 'open-given', a.text || a.chosen || ''));
      const ul = el('ul', 'open-points');
      (q.keyPoints || []).forEach((k, i) => {
        const hit = !!(a.hits || [])[i];
        ul.append(el('li', hit ? 'hit' : 'miss', (hit ? 'Hit: ' : 'Missed: ') + k.text));
      });
      parts.push(ul);
      if (a.gradedBy === 'local') parts.push(el('p', 'meta open-offline', 'Checked offline'));
      if (a.added) parts.push(el('p', 'open-added', 'You added: ' + a.added));
      parts.push(el('p', 'meta open-model', 'Model answer: ' + q.modelAnswer));
      if (a.grade === 'partial' && !a.added) {
        const k = key + q.id;
        if (!addOpen[k]) {
          const t = el('button', 'tlink open-add', 'Add to it');
          t.type = 'button';
          t.addEventListener('click', () => {
            addOpen[k] = { v: '' };
            render();
          });
          parts.push(t);
        } else {
          const ta = document.createElement('textarea');
          ta.className = 'open-in';
          ta.rows = 2;
          ta.maxLength = 600;
          ta.setAttribute('aria-label', 'Add to your answer');
          ta.value = addOpen[k].v;
          const save = btn('Save', null, { primary: true });
          save.disabled = !ta.value.trim();
          ta.addEventListener('input', () => {
            addOpen[k].v = ta.value;
            save.disabled = !ta.value.trim();
          });
          save.addEventListener('click', async () => {
            const text = ta.value.trim().slice(0, 600);
            const ids = idUnpassed(text);
            if (ids.length) return toast(`That looks like it ${ids[0].why}. Take that detail out first.`);
            const doc = S.answers.find(x => x.id === set.id || x.setId === set.id);
            const tries = (doc && doc.answers && doc.answers[q.id]) || {};
            const atKey = Object.keys(tries)
              .filter(x => tries[x] && tries[x].at === a.at)
              .pop();
            if (!doc || !atKey) return toast('Couldn’t find that answer to add to.');
            save.disabled = true;
            // Stored on the same attempt; the grade it was given stays as it was (D-132).
            await run([
              {
                op: 'update',
                collection: 'answers',
                id: doc.id,
                data: { answers: { [q.id]: { [atKey]: { added: text } } } },
              },
            ]);
            delete addOpen[k];
          });
          const row = el('div', 'actions');
          row.append(el('span', 'grow'), save);
          parts.push(ta, row);
        }
      }
      return parts;
    }
    function choiceText(q, idx) {
      return (idx || [])
        .map(i => q.options[i])
        .filter(Boolean)
        .join('; ');
    }
    function sumLine(key, q, a) {
      // a finished question as one line, opening in place to what he picked and why
      const k = key + q.id,
        open = !!sumOpen[k];
      const li = el('li', 'row sum-item' + (open ? ' open' : ''));
      li.dataset.id = q.id;
      const line = el('button', 'sum-line');
      line.type = 'button';
      line.setAttribute('aria-expanded', String(open));
      line.append(el('span', 'sum-t', q.topic || q.stem));
      if (q.cjStep) line.append(el('span', 'sum-k', cjLabel(q.cjStep)));
      line.addEventListener('click', () => {
        sumOpen[k] = !sumOpen[k];
        render();
      });
      const g = el('div', 'grow');
      g.append(line);
      if (open) {
        const more = el('div', 'sum-more'),
          type = E.itemType(q),
          R = q.rationales || [];
        if (type === 'open') {
          // B-75: his answer, then the points it hit and missed.
          more.append(el('p', 'meta', 'You wrote: ' + (a.text || a.chosen || '')));
          (q.keyPoints || []).forEach((kp, i) =>
            more.append(el('p', 'meta', ((a.hits || [])[i] ? 'Hit: ' : 'Missed: ') + kp.text))
          );
        } else if (type === 'numeric') {
          const given = a.chosen && typeof a.chosen.value === 'number' ? `${a.chosen.value} ${q.unit}` : 'nothing';
          if (!a.correct) more.append(el('p', 'meta', 'You gave: ' + given + '.'));
          more.append(
            el(
              'p',
              'meta',
              (a.correct ? 'Your answer: ' : 'Answer: ') + `${q.answer} ${q.unit}. ` + (q.steps || []).join(' · ')
            )
          );
        } else if (type === 'matrix')
          q.matrix.rows.forEach((r, ri) => {
            const ok = (a.chosen || [])[ri] === r.correct;
            if (!ok || a.correct)
              more.append(
                el(
                  'p',
                  'meta',
                  `${r.text}: ${ok ? '' : 'you picked ' + (q.matrix.columns[(a.chosen || [])[ri]] || 'nothing') + '; '}${q.matrix.columns[r.correct]}. ${r.rationale || ''}`.trim()
                )
              );
          });
        else {
          const picked = a.chosen || [],
            right = q.correct || [];
          if (!a.correct)
            more.append(
              el(
                'p',
                'meta',
                'You picked: ' +
                  (choiceText(q, picked) || 'nothing') +
                  '. ' +
                  picked
                    .map(i => R[i])
                    .filter(Boolean)
                    .join(' ')
              )
            );
          more.append(
            el(
              'p',
              'meta',
              (a.correct ? 'Your answer: ' : 'Answer: ') +
                choiceText(q, right) +
                '. ' +
                right
                  .map(i => R[i])
                  .filter(Boolean)
                  .join(' ')
            )
          );
        }
        more.append(
          btn(
            'See the question',
            () => {
              views[key] = q.id;
              render();
            },
            { cls: 'tlink' }
          )
        );
        g.append(more);
      }
      li.append(g);
      return li;
    }
    function summary(o, items, answers) {
      const key = o.key,
        inStudy = key === 'rv' || key.startsWith('pr-'),
        right = items.filter(q => answers[q.id] && answers[q.id].correct),
        answered = items.filter(q => answers[q.id]);
      const missed = answered.filter(q => !answers[q.id].correct);
      const solid = items.filter(q => answers[q.id] && /marked solid/.test(answers[q.id].outcome || '')).length;
      // B-126 (D-165): the score leads with Give me 5 more as the one primary; misses are lines that open to what he
      // picked and why; right answers fold; the next set is one line.
      // B-348 (D-312): as the demo's StudyResults card: the big score, "Logged to Record.", one line on the weak spots
      // the misses made with Review (Weak spots), then New quiz and Back to topics. The misses and right answers stay as
      // lines under it below 1200 px; from 1200 px the panel's "This quiz" lists them.
      const parts = [el('div', 'big set-score', right.length + ' of ' + answered.length)];
      parts.push(
        el('span', 'mini', ['Logged to Record.', solid ? solid + ' marked solid.' : ''].filter(Boolean).join(' '))
      );
      // B-376 (D-316): as the demo's StudyResults: any miss gives her line "N misses are proposed as weak spots." with
      // Accept all and Review. Each miss already wrote its weak spot through the answer's own write (a new spot, or
      // its twin seen again), so Accept all keeps them as filed and the line goes, as the demo's does once accepted.
      const wsOf = q =>
        (answers[q.id] && (answers[q.id].createdWeakspot || answers[q.id].weakspotId)) || q.weakspotId || null;
      const prop = missed.filter(q => !accepted.has(wsOf(q) || key + ':' + q.id));
      if (prop.length) {
        const line = el('div', 'endline');
        line.append(
          el(
            'span',
            'sp',
            prop.length === 1
              ? '1 miss is proposed as a weak spot.'
              : prop.length + ' misses are proposed as weak spots.'
          ),
          btn(
            'Accept all',
            () => {
              for (const q of prop) accepted.add(wsOf(q) || key + ':' + q.id);
              render();
            },
            { cls: 'btn primary sm' }
          ),
          btn(
            'Review',
            () => {
              ui.openSet = null;
              ui.openObj = null;
              ui.mini = null;
              showTab('study');
              setStudy('weak');
              render();
            },
            { cls: 'btn neutral sm' }
          )
        );
        parts.push(line);
      }
      const acts = el('div', 'actions sum-acts');
      // B-370 (D-316): in Study the results card is the demo's: New quiz and Back to topics, no Give me 5 more or Retake
      const more = !inStudy && o.more && o.more();
      if (more) acts.append(more);
      const lst = []; // the misses and right answers as lines, under the card's buttons
      if (missed.length) {
        const ul = el('ul', 'list sum-list'),
          all = !!sumOpen[key + ':missed'];
        (all ? missed : missed.slice(0, 5)).forEach(q => ul.append(sumLine(key, q, answers[q.id])));
        lst.push(el('p', 'meta sum-h', missed.length === 1 ? '1 miss' : missed.length + ' misses'), ul);
        if (missed.length > 5)
          lst.push(
            foldLine(all ? 'Fewer' : missed.length - 5 + ' more', all, () => {
              sumOpen[key + ':missed'] = !all;
              render();
            })
          );
      }
      if (right.length) {
        const open = !!sumOpen[key + ':right'],
          ul = el('ul', 'list sum-list');
        ul.hidden = !open;
        if (open) right.forEach(q => ul.append(sumLine(key, q, answers[q.id])));
        lst.push(
          foldLine(right.length + ' right', open, () => {
            sumOpen[key + ':right'] = !open;
            render();
          }),
          ul
        );
      }
      if (inStudy && o.newQuiz) acts.append(btn('New quiz', () => o.newQuiz(), { cls: 'btn neutral' }));
      else if (o.next) {
        const n = o.next,
          f = btn('New quiz', () => {
            ui.openSet = n.id;
            ui.openObj = null;
            showTab('study');
            setStudy('practice');
            render();
          });
        f.title = 'Next: ' + (n.title || n.id) + ' · ' + plural(E.validItems(n).length, 'question');
        f.setAttribute('aria-label', 'New quiz: ' + (n.title || n.id));
        acts.append(f);
      }
      if (o.summaryExtra && !inStudy)
        for (const x of o.summaryExtra()) acts.append(...(x.classList.contains('actions') ? x.children : [x]));
      if (key === 'rv' || key.startsWith('pr-'))
        acts.append(
          btn(
            'Back to topics',
            () => {
              ui.openSet = null;
              ui.openObj = null;
              ui.mini = null;
              setStudy('objectives');
              render();
            },
            { cls: 'btn ghost' }
          )
        );
      parts.push(acts, ...lst);
      o.body.classList.remove('q-beside');
      o.body.replaceChildren(...parts);
    }
    // B-211 (D-217): a number key picks that answer on the one open question in view (not while he types).
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey || !/^([1-9]|[a-iA-I]|Enter)$/.test(e.key)) return;
      const t = e.target;
      if (
        t &&
        (t.isContentEditable ||
          (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && t.type !== 'radio' && t.type !== 'checkbox'))
      )
        return;
      const vis = n => !!n && n.getClientRects().length > 0;
      if (document.querySelector('dialog[open]')) return;
      // B-348 (D-312): Enter goes on from an answered question, as the demo's card (not while a button has focus)
      if (e.key === 'Enter') {
        if (t && t.closest && t.closest('button,a,label')) return;
        const go = [...document.querySelectorAll('#p-study button.q-go')].filter(vis);
        if (go.length === 1) {
          e.preventDefault();
          go[0].click();
        }
        return;
      }
      const open = [...document.querySelectorAll('fieldset.opts')].filter(
        f => vis(f) && f.querySelector('input:not(:disabled)')
      );
      if (open.length !== 1) return;
      const n = /^[1-9]$/.test(e.key) ? Number(e.key) : 'abcdefghi'.indexOf(e.key.toLowerCase()) + 1;
      const inp = open[0].querySelectorAll('label.opt input')[n - 1];
      if (!inp || inp.disabled) return;
      e.preventDefault();
      inp.click();
    });
