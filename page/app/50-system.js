    // ------------------------------------------------------------ System
    // System: health in plain words (UI and UX, rule 8: visible, never alarming). health/current is the watchdog's
    // Derived document; the page adds what it can see itself (its release, the weak spot state against the evening's hash).
    const PIPE_NAME = {
      morning: 'Morning',
      'evening-cloud': 'Evening (cloud)',
      'evening-mac': 'Evening (Mac)',
      weekly: 'Weekly review',
      worker: 'Background jobs',
      watchdog: 'Watchdog',
      'restore-drill': 'Restore drill',
      diagnostic: 'Diagnostics',
    };
    function when(cron) {
      // 'CRON_TZ=America/Chicago 25 4 * * *' -> 'daily 4:25am'
      if (!cron) return 'when you ask';
      const f = String(cron)
        .replace(/^CRON_TZ=\S+\s+/, '')
        .split(/\s+/);
      const [mi, h, dom, , dow] = f;
      if (/^\*\/\d+$/.test(h)) return 'every ' + h.slice(2) + ' hours';
      // A list of hours, evenly spaced over the day (the watchdog's 1,4,7,…,22 since D-084): 'every 3 hours at :55'.
      if (/^\d+(,\d+)+$/.test(h)) {
        const hs = h.split(',').map(Number);
        const k = hs[1] - hs[0];
        if (k > 0 && hs.every((x, i) => !i || x - hs[i - 1] === k) && hs.length * k === 24)
          return 'every ' + k + ' hours at :' + String(mi).padStart(2, '0');
        return hs.length + ' times a day';
      }
      const t =
        (Number(h) % 12 || 12) + (mi === '0' ? '' : ':' + String(mi).padStart(2, '0')) + (Number(h) < 12 ? 'am' : 'pm');
      if (/^\d+$/.test(dom) && dow === '*') {
        const n = Number(dom);
        const th = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
        return 'monthly on the ' + n + th + ', ' + t;
      }
      const days = { 0: 'Sundays', 1: 'Mondays', 6: 'Saturdays', '1-5': 'weekdays' };
      return (dow === '*' ? 'daily ' : (days[dow] || 'days ' + dow) + ' ') + t;
    }
    const ago = iso => {
      const m = Math.round((Date.now() - E.toMs(iso)) / 60000);
      return m < 2
        ? 'just now'
        : m < 90
          ? m + ' min ago'
          : m < 36 * 60
            ? Math.round(m / 60) + ' h ago'
            : Math.round(m / 1440) + ' days ago';
    };
    function healthLines() {
      // [{text, v}] in plain words, the worst first; [] when there is nothing to say
      const hl = S.health;
      const out = [];
      if (!hl) return [{ text: 'No health check yet. The watchdog writes one every three hours.', v: 'info' }];
      // D-111: a health check older than spec.constants.health.staleHours means the watchdog itself may have stopped.
      const staleH = ((EV_SPEC.constants || {}).health || {}).staleHours || 4;
      const ageH = (Date.now() - E.toMs(hl.at)) / 3600e3;
      if (ageH > staleH)
        out.push({
          text: `This health check is ${Math.floor(ageH)} hours old. The watchdog checks every three hours, so it may have stopped. A build chat should look.`,
          v: 'bad',
          chip: 'stale',
        });
      // B-61 (D-112): what the scheduler's record says about each miss, when the watchdog read it.
      const missWhy = m =>
        m.kind === 'refused-at-start'
          ? ` (it was fired${m.slot ? ' at ' + clock12(m.slot) : ''} but stopped before it began, leaving no run)`
          : m.kind === 'not-fired'
            ? ' (the scheduler never fired it)'
            : '';
      for (const m of hl.missing || [])
        out.push({
          text: `${PIPE_NAME[m.pipeline] || m.pipeline} missed its ${m.slot ? clock12(m.slot) + ' ' : ''}run${missWhy(m)}${m.refired ? '; E.V. started it again' : m.lane === 'mac' ? '. It runs on your Mac, which may have been asleep or offline; it runs again at its next time' : ''}.`,
          v: 'warn',
        });
      for (const r of hl.stalledRuns || [])
        out.push({
          text: `${PIPE_NAME[r.pipeline] || r.pipeline} started ${ago(r.startedAt)} and never finished${r.refired ? '; E.V. started it again' : ''}.`,
          v: 'warn',
        });
      for (const j of hl.stalledJobs || [])
        out.push({
          text: `A background job waited ${j.minutes || '?'} min without starting${j.refired ? '; E.V. sent it again' : ''}.`,
          v: 'warn',
        });
      const why = {
        'already re-fired once': 'still stuck after one retry',
        'no task to fire': 'and there is no task to start it again',
        'past its re-fire window': 'too late in the day to start it again',
      };
      for (const r of hl.reported || [])
        out.push({
          text: `${String(r.target || r.id).replace(/^(run|job) /, '')}: ${r.reason}, ${why[r.why] || r.why}. A build chat should look.`,
          v: 'bad',
        });
      // B-163 (D-186): a backup older than this build's schemas still restores (the drill migrates it); amber, never red.
      const bk = hl.backup;
      if (bk && bk.behind > 0)
        out.push({
          text: `Your latest backup (${short(bk.at)}) is ${bk.behind} schema update${bk.behind === 1 ? '' : 's'} behind this build. It still restores: the drill moves it forward. Tonight’s backup catches up.`,
          v: 'warn',
          chip: 'backup',
        });
      return out;
    }
    // B-119: a line of System that opens in place: one line, its whole text once opened.
    const openSys = new Set();
    function sysLine(key, text, mark, detail) {
      const li = el('li', 'row sys-item' + (openSys.has(key) ? ' open' : ''));
      const b = el('button', 'sys-line');
      b.type = 'button';
      b.setAttribute('aria-expanded', String(openSys.has(key)));
      b.append(el('span', 'sys-t', text));
      if (mark) b.append(el('span', 'sys-mark', mark));
      const more = el('div', 'sys-more');
      if (detail) more.append(el('p', 'meta', detail));
      b.addEventListener('click', () => {
        const on = !openSys.has(key);
        on ? openSys.add(key) : openSys.delete(key);
        li.classList.toggle('open', on);
        b.setAttribute('aria-expanded', String(on));
      });
      li.append(b, more);
      return li;
    }
    function sysFold(lineId, listId, label) {
      // a list folded under one line of its count
      const line = $(lineId),
        list = $(listId);
      line.textContent = label;
      if (!line.dataset.on) {
        line.dataset.on = '1';
        line.addEventListener('click', () => {
          list.hidden = !list.hidden;
          line.setAttribute('aria-expanded', String(!list.hidden));
        });
      }
    }
    let sysProblem = null; // B-120 (D-157): System's first problem, which the header's status line reads
    function renderSystem() {
      const st = S.state;
      const hl = S.health;
      // The last run of each pipeline: the health check's, or a newer one in runs (a run that failed since it was written).
      const fromRuns = E.lastRuns(S.runs),
        fromHealth = (hl && hl.pipelines) || {},
        last = {};
      for (const p of new Set([...Object.keys(fromRuns), ...Object.keys(fromHealth)])) {
        const a = fromRuns[p],
          b = fromHealth[p];
        last[p] = !a ? b : !b ? a : String(a.startedAt || '') > String(b.startedAt || '') ? a : b;
      }
      const names = Object.entries(EV_SPEC.pipelines || {}).filter(([k]) => !k.startsWith('_'));
      const sched = EV_SPEC.schedules || {};
      const exception = r =>
        !r ? null : r.status === 'ok' ? null : r.status === 'running' ? 'still running' : r.status || '?';
      // What to look at, the worst first: a last run that failed, then the health check's own lines.
      const failed = names
        .filter(([p]) => last[p] && !['ok', 'running'].includes(last[p].status))
        .map(([p]) => ({
          text: `${PIPE_NAME[p] || p}’s last run ${last[p].status === 'partial' ? 'finished partly' : 'failed'} (${short(last[p].startedAt)} ${E.chicagoClock(last[p].startedAt)}).`,
          detail: last[p].detail || '',
        }));
      const problems = [
        ...failed,
        ...healthLines()
          .filter(l => l.v !== 'info')
          .map(l => ({ text: l.text, mark: l.chip })),
      ];
      const built = names.filter(([, d]) => d.steps).length;
      sysProblem = problems.length ? problems[0].text : null;
      const lead = problems.length
        ? problems[0].text
        : hl
          ? `All ${built} pipelines on time.`
          : 'Waiting for the first health check.';
      const top = [head2('Health', hl ? 'checked ' + ago(hl.at) : ''), el('p', 'big sys-lead', lead)];
      if (problems.length > 1) {
        const ul = el('ul', 'list');
        problems.slice(1).forEach((p, i) => ul.append(sysLine('p' + i + p.text, p.text, p.mark, p.detail)));
        top.push(ul);
      }
      if (M && hl && hl.derivedHash && hl.derivedHash.evening && E.derivedHash(M.models) !== hl.derivedHash.evening)
        top.push(
          el(
            'p',
            'meta',
            `Your weak spots changed since the evening snapshot (${short(hl.derivedHash.at)} ${E.chicagoClock(hl.derivedHash.at)}), as answers do.`
          )
        );
      const drill = hl && hl.restoreDrill;
      if (drill && drill.status !== 'ok')
        top.push(
          el(
            'p',
            'meta',
            `Backup restore drill: ${drill.status} ${drill.days === 0 ? 'today' : drill.days + ' days ago'}.`
          )
        );
      // B-165 (D-188): the evidence two gated tasks wait on, from the latest weekly, against the spec's numbers.
      const wk = [...(S.weeks || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
      const ev = wk && wk.health && wk.health.evidence;
      const need = ((EV_SPEC.constants || {}).health || {}).evidence || {};
      if (ev)
        top.push(
          el(
            'p',
            'meta sys-evidence',
            `Evidence (week of ${short(wk.date)}): ${ev.answers} of ${need.answers || 300} answers for learned intervals · ${ev.scoredExams} of ${need.scoredExams || 2} exams with a prediction and a score for calibration.`
          )
        );
      $('health-top').replaceChildren(...top);
      const runs = [...S.runs].sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
      const pipeEx = names.filter(([p]) => exception(last[p])).length;
      sysFold('pipes-fold', 'pipes', `Pipelines · ${names.length}${pipeEx ? ' · ' + pipeEx + ' to look at' : ''}`);
      $('pipes').replaceChildren(
        ...names.map(([p, def]) => {
          const r = last[p];
          return sysLine(
            'pipe-' + p,
            (PIPE_NAME[p] || p) + ' · ' + (def.steps ? when(sched[p]) : 'not built yet'),
            exception(r) || (!r && def.steps ? 'no run yet' : null),
            r ? `Last run ${short(r.startedAt)} ${E.chicagoClock(r.startedAt)}${r.detail ? ' · ' + r.detail : ''}` : ''
          );
        })
      );
      const shown = runs.slice(0, 12),
        runEx = shown.filter(r => exception(r)).length;
      sysFold('runs-fold', 'runs', `Recent runs · ${shown.length}${runEx ? ' · ' + runEx + ' to look at' : ''}`);
      $('runs').replaceChildren(
        ...shown.map(r =>
          sysLine(
            'run-' + r.id,
            `${short(r.startedAt)} ${E.chicagoClock(r.startedAt)} · ${PIPE_NAME[r.pipeline] || r.pipeline || r.id}`,
            exception(r),
            r.detail ? String(r.detail).slice(0, 220) : ''
          )
        )
      );
      $('runs-fold').hidden = !shown.length;
      // The record against its budgets (D-093): absent until the watchdog measures it; a line per budgeted collection.
      const cap = (hl && hl.capacity) || null;
      $('cap-card').hidden = !(cap && cap.docs != null);
      if (cap && cap.docs != null) {
        const kib = n => (n >= 1048576 ? Math.round(n / 104857.6) / 10 + ' MiB' : Math.round(n / 1024) + ' KiB');
        const limit = b =>
          [
            b.warnDocs != null ? `warns at ${Number(b.warnDocs).toLocaleString()}` : null,
            b.warnBytes != null ? `warns at ${kib(b.warnBytes)}` : null,
            b.failBytes != null ? `fails at ${kib(b.failBytes)}` : null,
          ]
            .filter(Boolean)
            .join(', ');
        const used = b =>
          [
            b.warnDocs != null || b.failDocs != null ? `${Number(b.docs).toLocaleString()} documents` : null,
            b.bytes != null ? kib(b.bytes) : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'measured by the nightly check';
        const over = (cap.budgets || []).filter(b => b.level !== 'ok').length;
        sysFold(
          'cap-card-line',
          'capacity',
          `Capacity · ${Number(cap.docs).toLocaleString()} documents in your record${over ? ' · ' + over + ' near or over budget' : ''}`
        );
        const ul = el('ul', 'list');
        ul.append(
          ...(cap.budgets || []).map(b =>
            sysLine(
              'cap-' + b.collection,
              b.collection,
              b.level === 'ok' ? null : b.level === 'warn' ? 'near budget' : 'over budget',
              `${used(b)} · ${limit(b)}${b.level !== 'ok' && b.relief ? ' · relief: ' + b.relief : ''}`
            )
          )
        );
        $('capacity').replaceChildren(
          ul,
          el('p', 'meta', 'Nothing is ever deleted; budgets bound what E.V. reads each night, not what it keeps.')
        );
      }
      // The nightly record lint (D-090): absent until evening-cloud has run it; its issues fold under their count.
      const lt = st && st.lint && typeof st.lint.errors === 'number' ? st.lint : null;
      $('lint-card').hidden = !lt;
      if (lt) {
        const issues = lt.top || [];
        const nb = lt.notesByCode || {};
        const NOTE = {
          frozen: 'kept from before, frozen',
          'fact-migrated': 'updated by a schema change',
          retired: 'in a retired collection',
          'not-rebuilt': 'rebuilt by their next run',
          'derived-inexact': 'built from something since edited',
        };
        sysFold(
          'lint-card-line',
          'lint-body',
          `Checks · ${plural(lt.errors, 'error')}, ${plural(lt.warnings, 'warning')} · ${short(lt.at)} ${E.chicagoClock(lt.at)}`
        );
        $('lint').replaceChildren(...issues.map((i, n) => sysLine('lint-' + n + i.msg, i.msg, i.severity, i.ref)));
        const extra = [
          lt.rebuilt && lt.rebuilt.of ? `${lt.rebuilt.same} of ${lt.rebuilt.of} built documents reproduced.` : '',
          Object.entries(nb).length
            ? 'Notes, not problems: ' +
              Object.entries(nb)
                .map(([c, n]) => `${n} ${NOTE[c] || c}`)
                .join(' · ') +
              '.'
            : '',
        ].filter(Boolean);
        $('lint-body')
          .querySelectorAll(':scope > p.meta')
          .forEach(p => p.remove());
        $('lint-body').append(...extra.map(t => el('p', 'meta', t)));
      }
      const js = [...S.jobs]
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, 10);
      $('jobs-card').hidden = !js.length;
      if (js.length) {
        sysFold('jobs-card-line', 'jobs', `Background jobs · ${js.length}`);
        $('jobs').replaceChildren(
          ...js.map(j => {
            const s2 = jobState(j);
            return sysLine(
              'job-' + j.id,
              `${short(j.createdAt)} · ${j.title || j.id}`,
              s2.v === 'ok' ? null : s2.label,
              [(KINDS[j.kind] || {}).label, s2.detail].filter(Boolean).join(' · ')
            );
          })
        );
      }
      $('versions').textContent =
        `Release ${EV_BUILD} · core ${E.VERSION} · spec ${EV_SPEC.specVersion} · ${EV_SPEC.target === 'staging' ? 'staging record' : 'your record'}${st ? ' · snapshot ' + short(st.generatedAt) + ' ' + E.chicagoClock(st.generatedAt) : ''}`;
    }

