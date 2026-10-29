    // ------------------------------------------------------------ Study: the plan (B-450, D-354, D-356, D-357)
    // The plan lives in Study's overview, under its exam's card, per course tab (Matt's call; the separate Plan screen is
    // retired). Each plan day is one row: its date, its label and its count; today's is open, a tap opens a day to its
    // tasks (tick, words over the done-state, its badge and its minutes) and a second tap folds it. A draft is marked
    // Draft with its rubric score and E.V.'s one question, and is approved from the right panel (under the card below
    // 1200 px). The sliders button in the Study toolbar opens the plan settings: his instructions (Edit opens them in a
    // sheet, Reset to default restores the brief), when something is missing, and where approved tasks go.
    const PLAN_ICON =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v6M6 14v6M12 4v2M12 10v10M18 4v10M18 18v2"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="18" cy="16" r="2"/></svg>';
    const PL_SPARK =
      '<svg viewBox="0 0 24 24" aria-hidden="true" class="el-ico"><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/></svg>';
    // B-456: a new plan that stalls (no result 2 minutes after it was asked, or a run stopped mid-way) frees Make a plan
    // by the clock alone, with no record change, so the page looks again as the window passes
    let plansStalled = '';
    setInterval(() => {
      try {
        const k = (S.jobs || [])
          .filter(j => E.studyPlanJobStalled(j))
          .map(j => j.id)
          .join(',');
        if (k !== plansStalled) {
          plansStalled = k;
          render();
        }
      } catch {}
    }, 15000);
    const PL_CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    const svgEl = (html, tag = 'span', cls = 'pl-ico') => {
      const s = el(tag, cls);
      s.innerHTML = html;
      return s.firstChild;
    };
    // D-357: a study plan task's one badge, from the fixed set; the same label and colour as its row in Today (BADGE).
    const PLAN_TAG_SET = E.STUDY_PLAN_TAGS || ['graded', 'learn', 'practice', 'review', 'clinical-prep', 'skills-prep'];
    // B-450: an older plan's tags (a plan page's legend, any case) show as the nearest of the six, for display only;
    // the record keeps its own. Anything else shows no badge.
    const LEGACY_TAG = {
      drill: 'practice',
      quiz: 'practice',
      practice: 'practice',
      reading: 'learn',
      read: 'learn',
      preview: 'learn',
      lecture: 'learn',
      learn: 'learn',
      clinical: 'clinical-prep',
      'clinical prep': 'clinical-prep',
      val: 'skills-prep',
      validation: 'skills-prep',
      skills: 'skills-prep',
      checkoff: 'skills-prep',
      'skills prep': 'skills-prep',
      review: 'review',
      exam: 'graded',
      graded: 'graded',
      assignment: 'graded',
    };
    const tagOf = t => {
      const k = String(t || '')
        .trim()
        .toLowerCase();
      return PLAN_TAG_SET.includes(k) ? k : LEGACY_TAG[k] || null;
    };
    const tagKey = t => (tagOf(t) ? tagOf(t).replace('-', ' ').toUpperCase() : null);
    function tagBadge(t) {
      const k = tagKey(t);
      const b = k && BADGE[k];
      return b ? el('span', 'badge' + (b[1] ? ' ' + b[1] : ''), b[0]) : null;
    }
    // The rubric's eight criteria, in the brief's order (spec.jobs.kinds.exam-plan's answer holds eight scores).
    const RUBRIC = [
      'Coverage',
      'Pre-exposure',
      'Deadline safety',
      'Retrieval and spacing',
      'Skills progression',
      'Load and recovery',
      'Feedback',
      'Clarity',
    ];
    // B-450: an older plan's day label is often its date ("Thu 10/29"): the row shows the date once, then the theme
    const DATEISH =
      /^\s*(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thur?s?|fri|sat|sun)\b\.?,?\s*)?(?:\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?)?\s*(?:[·:–—-]\s*|$)/i;
    const themeOf = s => {
      const t = String(s || '').trim();
      const m = DATEISH.exec(t);
      return m && m[0].trim() ? t.slice(m[0].length).trim() : t;
    };
    const mShort = m => {
      m = Math.round(m || 0);
      return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
    };
    const exShortOf = ex => (ex && ex.own ? ex.title : String((ex && (ex.title || ex.id)) || '').replace(/:.*$/, ''));
    const planUi = (ui.pl = ui.pl || { open: {}, more: {}, earlier: {}, carry: {}, fold: {}, filter: {} });

    // ---------------------------------------------------------------- the record's plans for an exam
    /** An exam's plan in force (a view with its ticks) and its newest study-plan draft made after it (B-449). */
    function examPlans(ex) {
      const plan = S.plans.find(p => (p.exam || p.id) === ex.id) || null;
      const draft =
        E.planDrafts(S.plansRaw, S.planedits, ex.id).filter(
          p => p.section && (!plan || String(p.at || '') > String(plan.at || ''))
        )[0] || null;
      return { plan, draft };
    }
    /** The newest exam-plan job for an exam (a change names one of its plans; a new plan names its course). */
    const namesExam = (j, id) =>
      new RegExp('\\(' + String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)').test(String(j.brief || ''));
    function planJobFor(ex, course) {
      const mine = j =>
        j.kind === 'exam-plan' &&
        (j.revise
          ? (S.plansRaw.find(p => p.id === j.revise) || {}).exam === ex.id
          : E.studyPlanCourse(j, S.exams) === course &&
            // B-450: the exam its brief names (Make a plan names its card's), else the course's next
            (namesExam(j, ex.id) ||
              (!S.exams.some(e => namesExam(j, e.id)) &&
                (E.studyPlanSection({ exams: S.exams, course, date: today }) || { exam: {} }).exam.id === ex.id)));
      return (
        S.jobs.filter(mine).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] ||
        null
      );
    }
    /** What the newest job means for the card: working, E.V.'s one question (until he answers or skips), a new plan
     * that didn't finish (B-459), or nothing. */
    function planJobState(ex, course, newest) {
      const j = planJobFor(ex, course);
      if (!j) return {};
      const after = String(j.createdAt || '') > String((newest && newest.at) || '');
      if (!after) return {};
      if (['queued', 'running'].includes(j.status) && !(j.fired && j.fired.ok === false) && !E.studyPlanJobStalled(j))
        return { working: j };
      if (j.status === 'done' && j.result && j.result.asked && j.result.text && store.get('plan-skip') !== j.id)
        return { ask: j };
      // B-459: a new plan that didn't finish says so, with its reason, until he tries again
      const why = E.studyPlanJobFailed(j);
      if (why) return { failed: j, why };
      return {};
    }
    const planDays = p => (p.days || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const taskList = p => planDays(p).flatMap(d => (d.tasks || []).map(t => ({ ...t, date: d.date })));
    const planMinutes = ts => ts.reduce((a, t) => a + (Number.isInteger(t.minutes) ? t.minutes : 0), 0);
    function planCounts(p) {
      const isDone = t => planDone(p, t); // B-483: Today's tick and the plan's are one
      const ts = taskList(p);
      const done = ts.filter(isDone).length; // B-450: the count is the ticks: the same test paints each tick
      return {
        ts,
        isDone,
        done,
        missed: ts.filter(t => t.date < today && !isDone(t)),
        todayLeft: ts.filter(t => t.date === today && !isDone(t)),
      };
    }

    // ---------------------------------------------------------------- asks: make, change, approve, answer
    async function makePlan(b, course, ex) {
      return guard(b, async () => {
        const r = await startJob(E.studyPlanJob({ course, exams: S.exams, date: today, examId: ex && ex.id }));
        if (!r.fired.ok)
          toast(r.fired.error === 'app_only' ? fireCopy('app_only') : 'Couldn’t start it: ' + fireCopy(r.fired.error));
        render();
      });
    }
    /** D-362: a new plan starts only from his tap: Remake, beside Ask for changes, is the same ask as Make a plan (a new
     *  plan from today that keeps what is done). Held while a plan ask for the exam runs. */
    function remakeBtn(ex, course) {
      const b = btn('Remake', ev => makePlan(ev.currentTarget, course, ex), { cls: 'btn ghost' });
      b.title = 'A new plan from today; what you ticked stays done';
      b.disabled = !!(planJobState(ex, course, null).working || E.studyPlanNewJobRunning(S.jobs, course));
      return b;
    }
    function askForChanges(ex, p) {
      // through the chat: his words go to the Haiku edit (D-356, D-362) of this card's plan; a new plan is Remake's
      T.planInView = p ? { id: p.id, at: Date.now() } : null;
      showTab('ev');
      const i = $('ev-input');
      i.value = `Change my ${exShortOf(ex)} plan: `;
      // B-461: the send carries this plan's id (the composer starts its edit, no chat routing); cleared words or
      // another view drop it
      ui.planTarget = p ? { id: p.id, prefix: i.value } : null;
      i.focus();
      i.dispatchEvent(new Event('input'));
    }
    function approvePlan(b, draft) {
      return guard(b, () => write(E.studyPlanApproveSet(S.planedits, draft, { now: now() })));
    }
    /** B-469: Put away, beside Ask for changes: one short confirm in the same row, then planedits marks the exam's
     *  plans put away (nothing deleted, B-11) and the card goes back to Make a plan. */
    function putAwayBtn(ex) {
      const b = btn(
        'Put away',
        ev => {
          const row = ev.currentTarget.parentElement;
          const was = [...row.childNodes];
          row.replaceChildren(
            el(
              'span',
              'mini pl-putq',
              'Put this plan away? Its tasks leave Today and Make a plan comes back. The plan stays in your record.'
            ),
            btn(
              'Put away',
              e2 =>
                guard(e2.currentTarget, () =>
                  write(E.studyPlanPutAwaySet(S.plansRaw, S.planedits, ex.id, { now: now() }))
                ),
              { cls: 'btn neutral pl-putgo' }
            ),
            btn('Cancel', () => row.replaceChildren(...was), { cls: 'btn ghost' })
          );
        },
        { cls: 'btn ghost pl-put' }
      );
      b.title = 'Take this plan off Study and Today; it stays in your record';
      return b;
    }
    // E.V.'s one question: kept as one element per job, so his answer and the focus outlast a repaint
    const askEls = new Map();
    function askBlock(j, course, ex) {
      if (askEls.has(j.id)) return askEls.get(j.id);
      const box = el('div', 'pm-ask');
      box.append(svgEl(PL_SPARK));
      const g = el('div', 'grow');
      const inp = el('input');
      inp.type = 'text';
      inp.placeholder = 'Your answer';
      inp.setAttribute('aria-label', 'Your answer to E.V.');
      const send = btn(
        'Answer',
        ev => {
          const a = inp.value.trim();
          if (!a) return inp.focus();
          const tail = ` His answer to “${j.result.text}”: ${a}`;
          const job = j.revise
            ? E.studyPlanJob({ revise: j.revise, changes: String(j.brief || '') + tail })
            : { ...E.studyPlanJob({ course, exams: S.exams, date: today, examId: ex && ex.id }) };
          if (!j.revise) job.brief = String(job.brief || '') + tail;
          return guard(ev.currentTarget, async () => {
            const r = await startJob(job);
            if (!r.fired.ok)
              toast(
                r.fired.error === 'app_only' ? fireCopy('app_only') : 'Couldn’t start it: ' + fireCopy(r.fired.error)
              );
            render();
          });
        },
        { cls: 'btn neutral sm' }
      );
      const skip = btn(
        'Skip',
        () => {
          store.set('plan-skip', j.id);
          render();
        },
        { cls: 'btn ghost sm' }
      );
      inp.addEventListener('keydown', e => e.key === 'Enter' && send.click());
      const ans = el('div', 'ans');
      ans.append(inp, send, skip);
      g.append(el('div', 'q', j.result.text), ans);
      box.append(g);
      askEls.set(j.id, box);
      return box;
    }

    // ---------------------------------------------------------------- the rows
    function taskRow(p, t, isDone, draft) {
      const on = !draft && isDone(t);
      const li = el('li', 'pl-t' + (on ? ' done' : ''));
      const c = el('input', 'tick');
      c.type = 'checkbox';
      c.checked = c.defaultChecked = on;
      c.disabled = !!draft;
      c.setAttribute('aria-label', 'Done: ' + (t.text || t.id));
      c.addEventListener('change', () =>
        guard(
          c,
          async () => {
            li.classList.toggle('done', c.checked);
            await tickPlan(p, t, c.checked);
          },
          null,
          () => li.classList.toggle('done', c.checked) // a refused tick puts the box and the row back together
        )
      );
      const g = el('div', 'grow');
      g.append(el('div', 'title', t.text || t.id));
      if (t.doneWhen) g.append(el('div', 'ds', t.doneWhen));
      li.append(c, g);
      // B-482: a task that made a practice set opens it from its row
      const made = !draft && S.sets.find(s => s.planTaskId === t.id && E.validItems(s).length);
      if (made) {
        const o = btn('Open set', () => openPracticeSet(made, false), { cls: 'btn ghost sm pl-set' });
        o.setAttribute('aria-label', 'Open the set for ' + (t.text || t.id));
        li.append(o);
      }
      const b = tagBadge(t.tag);
      if (b) li.append(b);
      li.append(el('span', 't', Number.isInteger(t.minutes) ? mShort(t.minutes) : ''));
      return li;
    }
    function dayRow(p, d, ts, { cls, label, count, isDone, draft, lead, open }) {
      const key = p.id + '|' + (cls === 'today' ? 'today' : d.date);
      const isOpen = key in planUi.open ? planUi.open[key] : !!open;
      const wrap = el('div', 'pl-day' + (cls ? ' ' + cls : '') + (isOpen ? ' open' : ''));
      const b = el('button', 'pl-dr');
      b.type = 'button';
      b.setAttribute('aria-expanded', String(isOpen));
      b.append(
        svgEl(PL_CHEV),
        el('span', 'd', cls === 'today' ? 'Today' : short(d.date)),
        el('span', 'lb', label),
        count
      );
      const list = () => {
        const ul = el('ul', 'pl-tasks');
        if (lead) ul.append(...lead);
        for (const t of ts) ul.append(taskRow(p, t, isDone, draft));
        return ul;
      };
      // the day opens and folds in place (the row keeps its element, so its chevron turns as the fold's)
      b.addEventListener('click', () => {
        const on = !wrap.classList.contains('open');
        planUi.open[key] = on;
        wrap.classList.toggle('open', on);
        b.setAttribute('aria-expanded', String(on));
        if (on) wrap.append(list());
        else wrap.querySelectorAll(':scope > .pl-tasks').forEach(x => x.remove());
      });
      wrap.append(b);
      if (isOpen) wrap.append(list());
      return wrap;
    }
    const countEl = (text, dot, mins) => {
      const c = el('span', 'c');
      if (dot) c.append(el('i', 'dot ' + dot));
      c.append(text);
      if (mins) c.append(el('span', 'mn', ' · ' + mins));
      return c;
    };
    /** The per-badge counts over a plan's tasks, each filtering its rows (D-357); none when no task has a badge. */
    function badgeFilter(p, ts) {
      const n = {};
      for (const t of ts) if (tagOf(t.tag)) n[tagOf(t.tag)] = (n[tagOf(t.tag)] || 0) + 1; // the badges shown
      const tags = PLAN_TAG_SET.filter(t => n[t]);
      if (!tags.length) return null;
      const f = planUi.filter[p.id] && n[planUi.filter[p.id]] ? planUi.filter[p.id] : 'all';
      const seg = el('div', 'seg pl-filter');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Show tasks by badge');
      for (const t of ['all', ...tags]) {
        const b = el('button', null, t === 'all' ? 'All' : BADGE[tagKey(t)][0]);
        b.type = 'button';
        b.dataset.f = t;
        b.setAttribute('aria-pressed', String(f === t));
        b.append(el('i', null, String(t === 'all' ? ts.length : n[t])));
        b.addEventListener('click', () => {
          planUi.filter[p.id] = t;
          render();
        });
        seg.append(b);
      }
      return { seg, f };
    }
    /** A plan's day rows: today first and open (what is left from earlier days folded once inside it), the next days,
     *  the rest to the exam folded, then the earlier days folded. A draft opens its first day. */
    function planRowsFor(p, ex, { draft, f, isDone }) {
      const keep = t => f === 'all' || tagOf(t.tag) === f;
      const days = planDays(p)
        .map(d => ({ d, ts: (d.tasks || []).map(t => ({ ...t, date: d.date })).filter(keep) }))
        .filter(x => x.ts.length || (f === 'all' && x.d.date === today));
      const rows = el('div', 'pl-rows');
      const label = x => themeOf(x.d.label) || themeOf(x.d.dayLabel) || (x.ts[0] && x.ts[0].text) || '';
      const tdy = days.find(x => x.d.date === today);
      const carry = draft ? [] : days.filter(x => x.d.date < today).flatMap(x => x.ts.filter(t => !isDone(t)));
      if (tdy || carry.length) {
        const ts = tdy ? tdy.ts : [];
        const lead = [];
        if (carry.length) {
          // B-450: what is left from earlier days shows once, folded inside Today
          const ck = p.id,
            co = !!planUi.carry[ck],
            from = carry.map(t => t.date).sort()[0];
          const li = el('li', 'pl-carry');
          const fb = foldLine(
            (carry.length === 1 ? '1 left from ' : carry.length + ' left from ') +
              (carry.every(t => t.date === from) ? short(from) : 'earlier days'),
            co,
            () => {
              planUi.carry[ck] = !co;
              render();
            }
          );
          fb.prepend(el('i', 'dot x-yellow'));
          li.append(fb);
          lead.push(li);
          if (co) for (const t of carry) lead.push(taskRow(p, t, isDone, draft));
        }
        rows.append(
          dayRow(p, tdy ? tdy.d : { date: today }, ts, {
            cls: 'today',
            label: tdy ? label(tdy) : 'Nothing planned',
            count: countEl(draft ? plural(ts.length, 'task') : ts.filter(isDone).length + ' of ' + ts.length),
            isDone,
            draft,
            lead,
            open: true,
          })
        );
      }
      const ahead = days.filter(x => x.d.date > today);
      const N = draft ? 5 : 3,
        more = !!planUi.more[p.id];
      ahead.slice(0, more ? ahead.length : N).forEach((x, i) =>
        rows.append(
          dayRow(p, x.d, x.ts, {
            cls: draft ? 'draft' : '',
            label: label(x),
            count: countEl(plural(x.ts.length, 'task'), null, planMinutes(x.ts) ? mShort(planMinutes(x.ts)) : ''),
            isDone,
            draft,
            open: draft && !tdy && i === 0,
          })
        )
      );
      if (ahead.length > N)
        rows.append(
          foldLine(
            more ? 'Fewer days' : `${plural(ahead.length - N, 'more day')} to ${exShortOf(ex)} · ${short(ex.date)}`,
            more,
            () => {
              planUi.more[p.id] = !more;
              render();
            }
          )
        );
      const past = days.filter(x => x.d.date < today).reverse();
      if (past.length) {
        const eo = !!planUi.earlier[p.id];
        rows.append(
          foldLine(
            'Earlier · ' + plural(past.length, 'day'),
            eo,
            () => {
              planUi.earlier[p.id] = !eo;
              render();
            },
            'pm-earlier'
          )
        );
        if (eo)
          for (const x of past) {
            const n = x.ts.filter(isDone).length;
            rows.append(
              dayRow(p, x.d, x.ts, {
                cls: 'past',
                label: label(x),
                count: countEl(n + ' of ' + x.ts.length, n === x.ts.length ? 'x-green' : null),
                isDone,
                draft,
              })
            );
          }
      }
      return rows;
    }
    function foldList(key, text, items) {
      const o = !!planUi.fold[key];
      const out = [
        foldLine(text, o, () => {
          planUi.fold[key] = !o;
          render();
        }),
      ];
      if (o) {
        const ul = el('ul', 'pl-notes');
        for (const it of items) ul.append(it);
        out.push(ul);
      }
      return out;
    }

    // ---------------------------------------------------------------- the summary (right panel, or the card's head)
    function draftSummary(p, ex, course, { ask, working, inCard }) {
      const ts = taskList(p);
      const d = el('div', 'ov-detail plan-sum');
      d.append(el('span', 'lab', `${course} · ${exShortOf(ex)} plan · draft`));
      const scope = /:/.test(String(ex.title || '')) ? String(ex.title).replace(/^[^:]*:\s*/, '') : p.title || '';
      if (scope) d.append(el('div', 'pm-scope', scope));
      const meta = el('div', 'pm-meta');
      const sec = p.section || {};
      const from = sec.from || (planDays(p)[0] || {}).date,
        to = sec.to || ex.date;
      meta.append(
        el('span', 'mini', `Exam ${short(ex.date)} · ${E.relDay(ex.date, today)}`),
        el('span', 'mini', `${short(from)} – ${short(to)} · ${plural(E.diffDays(from, to) + 1, 'day')}`),
        el(
          'span',
          'mini',
          plural(ts.length, 'task') +
            (planMinutes(ts) >= 60
              ? ' · ' + plural(Math.round(planMinutes(ts) / 60), 'hour') + ' in all'
              : planMinutes(ts)
                ? ' · ' + mShort(planMinutes(ts)) + ' in all'
                : '')
        )
      );
      d.append(meta);
      const sc = p.score;
      if (sc && Number.isFinite(sc.total)) {
        const big = el('div', 'big plan-lead', String(Math.round(sc.total)));
        big.append(el('span', 'of', '/100'));
        d.append(
          big,
          el(
            'span',
            'mini pm-sub',
            'Rubric self-score · ' +
              (p.editedSinceScore
                ? 'edited since it was scored'
                : sc.total >= 85
                  ? 'E.V. hands over 85 or more'
                  : 'under the 85 E.V. aims for')
          )
        );
        const crit = (sc.criteria || []).slice(0, RUBRIC.length);
        if (crit.length) {
          const low = crit.reduce((m, s, i) => (s < crit[m] ? i : m), 0);
          const rk = p.id + '|rubric';
          const ro = !!planUi.fold[rk];
          if (inCard)
            d.append(
              foldLine(
                `${crit.length} criteria · lowest: ${RUBRIC[low]} ${crit[low]}/5`,
                ro,
                () => {
                  planUi.fold[rk] = !ro;
                  render();
                },
                'pm-rubfold'
              )
            );
          if (!inCard || ro || innerWidth >= 600) {
            const rub = el('div', 'pm-rub');
            crit.forEach((s, i) => {
              const r = el('div', 'od-ws');
              r.append(
                el('i', 'dot ' + (s >= 5 ? 'x-green' : s <= 3 ? 'x-yellow' : 'x-quiet')),
                el('span', 'sn', RUBRIC[i]),
                el('span', 'st', s + '/5')
              );
              rub.append(r);
            });
            d.append(rub);
          }
        }
      }
      const act = el('div', 'pm-act');
      const ap = btn('Approve', ev => approvePlan(ev.currentTarget, p), { cls: 'btn tint x-green pm-approve' });
      ap.prepend(svgEl('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'));
      ap.disabled = !!(ask || working); // B-464: held while E.V. is changing this plan
      act.append(
        btn('Ask for changes', () => askForChanges(ex, p), { cls: 'btn neutral' }),
        ap,
        remakeBtn(ex, course),
        putAwayBtn(ex)
      );
      d.append(act);
      if (ask) d.append(el('span', 'mini pm-wait', 'Answer or skip E.V.’s question to approve.'));
      else if (working && !inCard) d.append(el('span', 'mini pm-wait', 'Approve opens when E.V.’s new draft lands.'));
      return d;
    }
    function planSummary(p, ex, course, c) {
      const d = el('div', 'ov-detail plan-sum');
      d.append(
        el('span', 'lab', `${course} · ${exShortOf(ex)} plan`),
        el('div', 'big plan-lead', `${c.done} of ${c.ts.length} done`)
      );
      const bar = el('div', 'pbar');
      const i = el('i');
      i.style.width = (c.ts.length ? (100 * c.done) / c.ts.length : 0) + '%';
      bar.append(i);
      d.append(bar);
      const meta = el('div', 'pm-meta');
      meta.append(
        el(
          'span',
          'mini',
          (c.missed.length ? c.missed.length + ' behind' : 'On track') +
            ` · Exam ${short(ex.date)} · ${E.relDay(ex.date, today)}`
        )
      );
      const made = [p.at ? 'Made ' + short(p.at) : '', p.score ? `Rubric ${Math.round(p.score.total)}/100` : '']
        .filter(Boolean)
        .join(' · ');
      if (made) meta.append(el('span', 'mini', made));
      d.append(meta);
      if (c.todayLeft.length) {
        const r = el('div', 'od-ws');
        r.append(
          el('i', 'dot x-violet'),
          el('span', 'sn', c.todayLeft.length + ' left today'),
          el('span', 'st', planMinutes(c.todayLeft) ? mShort(planMinutes(c.todayLeft)) : '')
        );
        d.append(r);
      }
      const key = (p.keyDates || []).filter(k => k.date > today).sort((a, b) => a.date.localeCompare(b.date))[0];
      if (key) {
        const r = el('div', 'od-ws');
        r.title = key.title + (key.requirement ? ' · ' + key.requirement : '');
        r.append(el('i', 'dot x-quiet'), el('span', 'sn', `${key.title} · ${short(key.date)}`));
        d.append(r);
      }
      const act = el('div', 'pm-act');
      act.append(btn('Ask for changes', () => askForChanges(ex, p), { cls: 'btn neutral' }));
      if (p.section) act.append(remakeBtn(ex, course));
      if (!ex.own) act.append(putAwayBtn(ex));
      d.append(act);
      return d;
    }

    // ---------------------------------------------------------------- the cards
    function planHead(p, ex, extra) {
      const h = el('div', 'pl-head');
      h.append(el('b', 'ov-ex', ex.own ? ex.title : exShortOf(ex) + ' plan'), ...extra);
      return h;
    }
    /** The head's switch between an exam's draft and the version in force: one card per exam (B-450). */
    function swapBtn(ex, toApproved) {
      const b = btn(
        toApproved ? 'Approved version' : 'Back to the draft',
        () => {
          planUi.showApproved = { ...(planUi.showApproved || {}), [ex.id]: toApproved };
          render();
        },
        { cls: 'btn ghost sm pl-swap' }
      );
      return b;
    }
    function approvedCard(p, ex, course, { panelled = true, swap = null, js = {} } = {}) {
      const c = planCounts(p);
      // a card whose summary is not in the right panel keeps its actions at its foot at every width
      const card = el('div', 'ui-card pl-card ok' + (panelled ? '' : ' own-foot'));
      card.dataset.plan = p.id;
      const sec = p.section || {};
      const first = sec.from || (planDays(p)[0] || {}).date;
      card.append(
        planHead(p, ex, [
          ...(first ? [el('span', 'meta pl-span', `·\u00a0${short(first)} – ${short(sec.to || ex.date)}`)] : []),
          el('span', 'sp'),
          ...(swap ? [swap] : []),
          // B-464: the count shows once: the right panel's summary carries it when this card owns the panel
          ...(panelled ? [] : [el('span', 'meta pl-done', `${c.done} of ${c.ts.length} done`)]),
        ])
      );
      // below 1200 px the summary is one line and the bar
      const line = el('div', 'pm-line');
      const bar = el('div', 'pbar'),
        bi = el('i');
      bi.style.width = (c.ts.length ? (100 * c.done) / c.ts.length : 0) + '%';
      bar.append(bi);
      line.append(
        el(
          'span',
          null,
          `${c.done} of ${c.ts.length} done · ${c.missed.length ? c.missed.length + ' behind' : 'on track'} · ${exShortOf(ex)} ${E.relDay(ex.date, today)}`
        ),
        bar
      );
      card.append(line);
      // B-521 (F-13): Remake at work says so, with how long, and a new plan that didn't finish says why
      const making = js.working || (p.section && E.studyPlanNewJobRunning(S.jobs, course));
      if (making)
        card.append(planWorking(making, js.working && js.working.revise ? 'Changing your plan' : 'Making a new plan'));
      else if (js.failed) card.append(el('p', 'mini pl-failed', `Your new plan didn’t finish: ${js.why}`));
      const bf = badgeFilter(p, c.ts);
      if (bf) card.append(bf.seg);
      const rows = planRowsFor(p, ex, { draft: false, f: bf ? bf.f : 'all', isDone: c.isDone });
      rows.append(...planNotes(p)); // B-525 (F-21): approving keeps the instructor questions and the scope map
      card.append(rows);
      const foot = el('div', 'pl-foot');
      foot.append(btn('Ask for changes', () => askForChanges(ex, p), { cls: 'btn neutral' }));
      if (p.section) foot.append(remakeBtn(ex, course));
      if (!ex.own) foot.append(putAwayBtn(ex));
      card.append(foot);
      return { card, panel: () => planSummary(p, ex, course, c) };
    }
    /** The plan's Open questions for the instructor and its Scope map, each one folded line; B-525 (F-21): an approved
     *  plan keeps both, as its draft showed them. */
    function planNotes(p) {
      const out = [];
      const qs = (p.openQuestions || []).filter(Boolean);
      if (qs.length)
        out.push(
          ...foldList(
            p.id + '|q',
            'Open questions for the instructor · ' + qs.length,
            qs.map(q => el('li', null, String(q)))
          )
        );
      const scope = (p.scope || []).filter(s => s && s.topic);
      if (scope.length) {
        const gaps = scope.filter(s => s.gap).length;
        out.push(
          ...foldList(
            p.id + '|s',
            'Scope map · ' + (gaps ? plural(gaps, 'objective') + ' not covered' : plural(scope.length, 'topic')),
            scope.map(s => {
              const li = el('li', s.gap ? 'gap' : null, s.topic + (s.chapters ? ' · ' + s.chapters : ''));
              if (s.gap) li.append(el('span', 'badge x-yellow', 'Not covered'));
              return li;
            })
          )
        );
      }
      return out;
    }
    function draftCard(p, ex, course, js, { panelled = true, swap = null } = {}) {
      const ts = taskList(p);
      const card = el('div', 'ui-card pl-card dr');
      card.dataset.plan = p.id;
      const bdg = el('span', 'badge proposed', 'Draft');
      card.append(
        planHead(p, ex, [
          bdg,
          el('span', 'sp'),
          ...(swap ? [swap] : []),
          el('span', 'meta', `${plural(planDays(p).length, 'day')} · ${plural(ts.length, 'task')}`),
        ])
      );
      if (js.ask) card.append(askBlock(js.ask, course, ex));
      if (js.working) card.append(planWorking(js.working, 'E.V. is changing this plan')); // B-521: with how long
      // the panel holds one summary; a draft whose summary is not there carries its own, with its actions
      if (!PANEL.matches || !panelled)
        card.append(draftSummary(p, ex, course, { ask: js.ask, working: js.working, inCard: true }));
      const bf = badgeFilter(p, ts);
      if (bf) card.append(bf.seg);
      const rows = planRowsFor(p, ex, { draft: true, f: bf ? bf.f : 'all', isDone: () => false });
      rows.append(...planNotes(p));
      card.append(rows);
      return {
        card,
        panel: () => draftSummary(p, ex, course, { ask: js.ask, working: js.working, inCard: false }),
      };
    }
    /** B-521 (F-13): a plan being made, said as it goes: working, how long so far, and where it lands. */
    function planWorking(j, words) {
      const p = el('span', 'mini pl-working');
      p.append(liveSince(jobSince(j), words, 'pl-since'), document.createTextNode('. It shows here when it’s ready.'));
      return p;
    }
    function noPlanCard(ex, course, js) {
      const making = js.working || E.studyPlanNewJobRunning(S.jobs, course); // D-362: one new plan per course
      const card = el('div', 'ui-card pl-card pl-none' + (making ? ' working' : ''));
      card.append(svgEl(PL_SPARK));
      const g = el('div', 'grow');
      const failed = !making && js.failed; // B-459: never a silent "No study plan yet" after a plan that failed
      g.append(
        el('span', 'h', failed ? `Study plan for ${exShortOf(ex)}` : `No study plan for ${exShortOf(ex)} yet`),
        making
          ? planWorking(making, 'Making your plan')
          : el(
              'span',
              failed ? 'mini pl-failed' : 'mini',
              failed
                ? `Your last plan didn’t finish: ${js.why}`
                : `E.V. reads the ${course} calendar and materials, plans each day to ${short(ex.date)}, and scores it before you see it.`
            )
      );
      card.append(g);
      // B-521: the button is Make a plan in every state, held while one is being made
      const mk = btn('Make a plan', ev => makePlan(ev.currentTarget, course, ex), { cls: 'btn neutral' });
      mk.disabled = !!making;
      if (making) mk.setAttribute('aria-busy', 'true');
      card.append(mk);
      const out = [card];
      if (js.ask) out.unshift(askBlock(js.ask, course, ex));
      return out;
    }
    function noPlanPanel(ex, fullName) {
      const d = el('div', 'ov-detail');
      d.append(el('span', 'lab', 'Plan'), el('div', 'od-name', fullName));
      const st = el('div', 'od-row');
      st.append(
        el('span', 'badge', 'No plan yet'),
        el('span', 'mini', `${short(ex.date)} · ${E.relDay(ex.date, today)}`)
      );
      d.append(
        st,
        el(
          'span',
          'mini od-note',
          'Make a plan lays out each day to the exam by your plan instructions, and scores it before you see it.'
        )
      );
      return d;
    }
    /** A later exam's card, shown because it has a plan: its name, date, objectives bar and count. */
    function laterExamCard(ex, course) {
      const card = el('div', 'ui-card ov-card pm-ex');
      const nm = exShortOf(ex);
      const full = nm.includes(course) ? nm : course + ' ' + nm;
      const head = el('div', 'ov-head'),
        n0 = el('span', 'ov-name');
      n0.append(
        el('b', 'ov-ex', full),
        el('span', 'meta', ' ·\u00a0' + nbsp(short(ex.date)) + ' · ' + nbsp(E.relDay(ex.date, today)))
      );
      const objs = S.objectives.filter(o => o.exam === ex.id);
      const acc = E.answerStats(M.attempts.all).byObjective;
      const solid = objs.filter(o => objState(o, acc[o.id]).state === 'solid').length;
      head.append(
        n0,
        el('span', 'meta ov-count', objs.length ? `${solid} of ${objs.length} objectives solid` : 'No objectives yet')
      );
      const bar = el('div', 'pbar ov-bar'),
        g = el('i', 'x-green');
      g.style.width = (objs.length ? (100 * solid) / objs.length : 0) + '%';
      bar.append(g);
      card.append(head, bar);
      return card;
    }

    /**
     * The course's plans under its exam card (called by renderObjectives): the next exam's plan, its draft, or Make a
     * plan; then each later exam of the course that has a plan, its card and its plan. Returns the panel (from 1200 px)
     * the plans want, or null.
     */
    /** Plans in force for no exam in the record (a dosage plan, B-194) that still have days ahead. */
    const ownPlans = () =>
      S.plans.filter(
        p => !p.section && !S.exams.some(e => e.id === (p.exam || p.id)) && planDays(p).some(d => d.date >= today)
      );
    function renderStudyPlans(cur, fullName, hasObjectives, panelFree = true) {
      let box = $('ov-plans');
      if (!box) {
        box = el('div', 'ov-plans');
        box.id = 'ov-plans';
        $('ov-card').after(box);
      }
      // a plan in force for no exam in the record (a dosage plan, B-194) shows on every course tab while it has days,
      // an exam ahead or not; its summary stays on its card
      const own = ownPlans().map(p =>
        approvedCard(
          p,
          { id: p.exam || p.id, title: p.title || 'Plan', date: planDays(p).slice(-1)[0].date, own: true },
          cur ? cur.course : '',
          { panelled: false }
        )
      );
      if (!cur || !cur.exam) {
        box.replaceChildren(...own.map(x => x.card));
        box.hidden = !own.length;
        return null;
      }
      box.hidden = false;
      // each exam shows one plan card: its draft (with a switch to the version in force), or the plan in force; the
      // right panel holds one summary, a draft's first; every other card carries its actions itself
      const parts = [];
      const one = (ex, first) => {
        const { plan, draft } = examPlans(ex);
        const js = planJobState(ex, cur.course, draft || plan);
        if (!plan && !draft) {
          if (!first) return;
          parts.push({
            nodes: () => noPlanCard(ex, cur.course, js),
            panel: hasObjectives ? null : () => noPlanPanel(ex, fullName),
          });
          return;
        }
        if (!first) parts.push({ nodes: () => [laterExamCard(ex, cur.course)] });
        const showPlan = plan && (!draft || (planUi.showApproved || {})[ex.id]);
        if (showPlan) {
          let a;
          const make = panelled =>
            (a = approvedCard(plan, ex, cur.course, { panelled, swap: draft ? swapBtn(ex, false) : null, js }));
          parts.push({ card: true, nodes: panelled => [make(panelled).card], panel: () => a.panel() });
        } else {
          let dr;
          const make = panelled =>
            (dr = draftCard(draft, ex, cur.course, js, { panelled, swap: plan ? swapBtn(ex, true) : null }));
          parts.push({ card: true, draft: true, nodes: panelled => [make(panelled).card], panel: () => dr.panel() });
        }
      };
      one(cur.exam, true);
      for (const ex of S.exams
        .filter(
          e =>
            e.date &&
            e.date > cur.exam.date &&
            E.courseOf(e) === cur.course &&
            e.status !== 'done' &&
            e.id !== cur.exam.id
        )
        .sort((a, b) => a.date.localeCompare(b.date)))
        one(ex, false);
      const usePanel = PANEL.matches && panelFree;
      const owner = usePanel ? parts.find(x => x.card && x.draft) || parts.find(x => x.panel) || null : null;
      const kids = parts.flatMap(x => x.nodes(x === owner));
      box.replaceChildren(...kids, ...own.map(x => x.card));
      return owner && owner.panel ? owner.panel() : null;
    }
    /** B-450: a plan opened from elsewhere (an E.V. card): Study's overview on its exam's course tab. */
    function openPlanInStudy(examId, planId) {
      const ex = examId && S.exams.find(e => e.id === examId);
      if (ex) ui.studyCourse = E.courseOf(ex);
      showTab('study');
      setStudy('objectives');
      render();
      const card =
        (planId && document.querySelector(`#ov-plans .pl-card[data-plan="${CSS.escape(planId)}"]`)) ||
        document.querySelector('#ov-plans .pl-card');
      if (card) card.scrollIntoView({ block: 'nearest' });
    }
    /** B-450: Study's line for a course's plans: a draft to approve (with E.V.'s question), else what is left today of
     *  the next exam's plan and what is still open from earlier days. null when neither has anything to say. */
    function planLine(cur) {
      const exs = S.exams
        .filter(e => e.date && e.date >= cur.exam.date && E.courseOf(e) === cur.course && e.status !== 'done')
        .sort((a, b) => a.date.localeCompare(b.date));
      for (const ex of exs) {
        const { plan, draft } = examPlans(ex);
        if (!draft) continue;
        const js = planJobState(ex, cur.course, draft);
        const sc =
          draft.score && Number.isFinite(draft.score.total) ? ` and scores ${Math.round(draft.score.total)}` : '';
        const lead =
          ex.id === cur.exam.id || plan
            ? `Your ${exShortOf(ex)} plan is drafted${sc}.`
            : `${exShortOf(cur.exam)} is ${E.relDay(cur.exam.date, today)}. Your ${exShortOf(ex)} plan is drafted${sc}.`;
        return { text: lead + (js.ask ? ' One question before you approve it.' : ' Approve it or ask for changes.') };
      }
      const plan = examPlans(cur.exam).plan;
      if (!plan) return null;
      const kept = plan.section && keepsInPlan(); // B-450: its tasks are not on Today, so the line offers no Open Today
      const c = planCounts(plan);
      if (!c.todayLeft.length && !c.missed.length) return null;
      const n = c.todayLeft.length,
        m = c.missed.length,
        from = m ? c.missed.map(t => t.date).sort()[0] : null;
      const tail = m
        ? (m === 1 ? 'one' : numWord(m).toLowerCase()) +
          ' from ' +
          (c.missed.every(t => t.date === from) ? OV_WD[new Date(from + 'T12:00:00Z').getUTCDay()] : 'earlier days') +
          (m === 1 ? ' is' : ' are') +
          ' still open.'
        : '';
      const text = n
        ? `${numWord(n)} ${exShortOf(cur.exam)} ${n === 1 ? 'task is' : 'tasks are'} left today` +
          (tail ? ', and ' + tail : '.')
        : tail.charAt(0).toUpperCase() + tail.slice(1);
      if (kept) return { text: text.replace(' left today', ' planned today') };
      return {
        text,
        act: [
          'Open Today',
          () => {
            ui.todayView = 'list';
            showTab('today');
            render();
          },
        ],
      };
    }
    /** Whether an exam has a plan or a draft to show. */
    const hasStudyPlan = ex => {
      const { plan, draft } = examPlans(ex);
      return !!(plan || draft);
    };
    /** Whether an exam's card folds its objectives to one line: any plan or draft sits under it (B-464). */
    const foldsObjectives = hasStudyPlan;

    // ---------------------------------------------------------------- the plan settings (the toolbar's sliders)
    const briefText = () => String(((EV_SPEC.jobs.kinds || {})['exam-plan'] || {}).instructions || '');
    const ownText = () => {
      const s = S.planSettings;
      return s && typeof s.instructions === 'string' && s.instructions.trim() ? s.instructions : '';
    };
    const editedWord = () =>
      ownText() && S.planSettings.updatedAt ? 'Edited ' + short(S.planSettings.updatedAt) : 'The built-in brief';
    function writePlanSettings(b, change) {
      const was = S.planSettings;
      return guard(
        b,
        () => {
          const at = now();
          const r = E.studyPlanSettingsWrite(was, change, { now: at }); // painted at once (D-208)
          S.planSettings = { id: r.id, ...r.data };
          render();
          return write(E.studyPlanSettingsSet(was, change, { now: at }));
        },
        null,
        () => {
          S.planSettings = was;
          render();
        }
      );
    }
    const plainPreview = t =>
      String(t || '')
        .replace(/^#+\s*/gm, '')
        .replace(/\*\*|__|`/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400);
    function planPop() {
      let pop = $('plan-pop');
      if (!pop) {
        pop = el('div', 'pm-pop');
        pop.id = 'plan-pop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Plan settings');
        pop.hidden = true;
        $('study-planwrap').append(pop);
      }
      return pop;
    }
    function segOf(label, opts, val, onPick) {
      const s = el('div', 'seg');
      s.setAttribute('role', 'group');
      s.setAttribute('aria-label', label);
      for (const [v, n] of opts) {
        const b = el('button', null, n);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(v === val));
        b.addEventListener('click', ev => v !== val && onPick(v, ev.currentTarget));
        s.append(b);
      }
      return s;
    }
    function paintPlanPop() {
      const pop = planPop();
      if (pop.hidden) return;
      const st = S.planSettings || {};
      const pref = (lbl, ...kids) => {
        const p = el('div', 'pref');
        p.append(el('span', 'lbl', lbl), ...kids);
        return p;
      };
      const ins = el('button', 'pm-ins');
      ins.type = 'button';
      ins.title = 'Edit instructions';
      ins.append(el('span', 'pm-ins-t', plainPreview(ownText() || briefText())));
      ins.addEventListener('click', openPlanSheet);
      const row = el('div', 'pm-row');
      const reset = btn('Reset to default', ev => writePlanSettings(ev.currentTarget, { instructions: null }), {
        cls: 'btn ghost sm',
      });
      reset.disabled = !ownText();
      row.append(el('span', 'mini grow', editedWord()), reset, btn('Edit', openPlanSheet, { cls: 'btn neutral sm' }));
      pop.replaceChildren(
        el('div', 'pm-hd', 'Study plans'),
        pref('Instructions', ins, row),
        el('div', 'pm-sep'),
        pref(
          'When something is missing',
          segOf(
            'When something is missing',
            [
              ['ask', 'Ask me'],
              ['note', 'Note it and go on'],
            ],
            st.missing === 'note' ? 'note' : 'ask',
            (v, b) => writePlanSettings(b, { missing: v })
          )
        ),
        pref(
          'Approved tasks',
          segOf(
            'Approved tasks',
            [
              ['today', 'Add to Today'],
              ['plan', 'Keep in the plan'],
            ],
            st.approved === 'plan' ? 'plan' : 'today',
            (v, b) => writePlanSettings(b, { approved: v })
          )
        )
      );
    }
    function togglePlanPop(open) {
      const pop = planPop(),
        b = $('study-planset');
      pop.hidden = !open;
      b.setAttribute('aria-expanded', String(open));
      if (open) paintPlanPop();
    }
    $('study-planset').addEventListener('click', () => togglePlanPop(planPop().hidden));
    document.addEventListener('pointerdown', e => {
      const pop = $('plan-pop');
      if (pop && !pop.hidden && !e.target.closest('#study-planwrap')) togglePlanPop(false);
    });
    document.addEventListener('keydown', e => {
      const pop = $('plan-pop');
      if (e.key === 'Escape' && pop && !pop.hidden) {
        togglePlanPop(false);
        $('study-planset').focus();
      }
    });
    function openPlanSheet() {
      togglePlanPop(false);
      let d = $('plan-dlg');
      if (!d) {
        d = el('dialog', 'new-dlg pm-dlg');
        d.id = 'plan-dlg';
        d.setAttribute('aria-labelledby', 'plan-dlg-h');
        const f = el('form');
        f.method = 'dialog';
        const hd = el('div', 'new-hdr');
        hd.innerHTML = PLAN_ICON;
        const h3 = el('h3', 'new-head grow', 'Study plan instructions');
        h3.id = 'plan-dlg-h';
        hd.append(h3, el('span', 'mini pm-edited'));
        const body = el('div', 'new-body');
        const ta = el('textarea');
        ta.id = 'plan-text';
        ta.setAttribute('aria-label', 'Instructions');
        ta.spellcheck = true;
        body.append(ta);
        const ft = el('div', 'new-foot');
        const hint = el('span', 'pm-hint', 'Used for every new plan and change. Plans already made keep theirs.');
        const reset = btn('Reset to default', () => (ta.value = briefText()), { cls: 'btn ghost' });
        const cancel = btn('Cancel', () => d.close(), { cls: 'btn neutral' });
        const save = btn(
          'Save',
          ev => {
            const v = ta.value.trim();
            const same = v === briefText().trim() || !v;
            d.close();
            return writePlanSettings(ev.currentTarget, { instructions: same ? null : ta.value });
          },
          { primary: true }
        );
        ft.append(hint, reset, cancel, save);
        f.append(hd, body, ft);
        d.append(f);
        d.addEventListener('click', e => e.target === d && d.close()); // a tap outside closes it
        d.addEventListener('close', () => $('study-planset').focus());
        document.body.append(d);
      }
      d.querySelector('.pm-edited').textContent = editedWord();
      $('plan-text').value = ownText() || briefText();
      d.showModal();
      $('plan-text').focus();
      $('plan-text').setSelectionRange(0, 0);
      $('plan-text').scrollTop = 0;
    }
