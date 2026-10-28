    // ---------------------------------------------------------------- jobs
    const FIRE_COPY = {
      no_task: 'Background jobs aren’t set up for this page yet.',
      staging: 'Filing runs from the live page only. It needs your Mac.',
      mcp_unavailable:
        'Background jobs need the Claude Code Remote connector, which this view can’t reach. Open the page in claude.ai.',
      needs_reauth: 'The Claude Code Remote connector needs you to sign in again (claude.ai Settings → Connectors).',
      server_not_connected: 'Add the Claude Code Remote connector in claude.ai Settings → Connectors, then try again.',
      server_not_found: 'Add the Claude Code Remote connector in claude.ai Settings → Connectors, then try again.',
      selection_required:
        'You have more than one Claude Code Remote connector. Pick one when claude.ai asks, then try again.',
      not_in_manifest:
        'Background jobs are switched off for this page. Turn on Claude Code Remote in the page’s Permissions menu.',
      blocked_by_policy: 'Your organization blocks starting tasks from pages.',
      approval_required: 'Starting a job needs your OK. Tap Try again and allow it when claude.ai asks.',
      tool_error: 'The task service turned the request down. Try again in a minute.',
      server_unavailable:
        'Couldn’t reach the task service. It may still have started, so give it a minute before trying again.',
      upstream_error:
        'Couldn’t reach the task service. It may still have started, so give it a minute before trying again.',
      // B-456: on the claude.ai page a new study plan can't run (D-306: the cloud worker refuses it); the app makes it
      app_only: 'Study plans are made in the E.V. app. Open it on your phone or computer to make one.',
      not_granted: 'Background jobs aren’t available in this view.',
      capability_disabled: 'Background jobs aren’t available in this view.',
      capability_removed: 'Background jobs aren’t available in this view.',
    };
    const fireCopy = code => FIRE_COPY[code] || 'Couldn’t start it (' + code + '). Try again in a minute.';
    async function fire(trigger_id, text) {
      const at = now();
      if (!trigger_id) return { at, ok: false, error: 'no_task' };
      if (!mcp) return { at, ok: false, error: 'mcp_unavailable' };
      try {
        await mcp.callTool('Claude Code Remote', 'fire_trigger', { trigger_id, text }, { cache: false });
        return { at, ok: true };
      } catch (e) {
        return { at, ok: false, error: (e && e.code) || 'upstream_error' };
      }
    }
    const jobText = id => (TASKS.jobText || 'Job {id}').replace('{id}', id);
    // B-320 (D-306): the E.V. app (the PWA) names its host; the claude.ai page has none
    const inApp = () => !!(window.claude && window.claude.host === 'ev-app');
    /** The jobs in the record as read now, as views (status from jobresults/<id>, 'queued' when there is none). */
    async function freshJobs() {
      const [js, rs] = await Promise.all(['jobs', 'jobresults'].map(c => db.collection(c).get().then(docs)));
      const by = new Map(rs.map(r => [r.id, r]));
      return js.map(j => ({
        ...j,
        createdAt: j.createdAt || j.at,
        status: by.has(j.id) ? by.get(j.id).status : 'queued',
        startedAt: by.has(j.id) ? by.get(j.id).startedAt || null : null, // B-456: a stalled run frees the plan guard
      }));
    }
    async function startJob({ kind, title, brief, course, revise, said, chip }) {
      kind = KINDS[kind] ? kind : 'general';
      title =
        String(title || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 90) || KINDS[kind].label;
      brief = String(brief || '')
        .trim()
        .slice(0, 1500);
      // D-362 (B-456): one new plan at a time per course, whoever asks (the chip, Make a plan, Remake, another tab).
      // The record is read right before the write: a new-plan job queued or running there is the answer, and the id
      // is the course's next of the day in every tab, so two tabs that both start one make one document.
      let planId = null;
      // B-456: a study plan, new or a change to one, is made in the app only (B-459: the cloud worker refuses every
      // exam-plan job); here nothing is written and the caller says where to make it
      if (kind === 'exam-plan' && !inApp()) return { id: null, fired: { at: now(), ok: false, error: 'app_only' } };
      if (kind === 'exam-plan' && !revise && course) {
        const fresh = await freshJobs();
        const busy = E.studyPlanNewJobRunning(fresh, course);
        if (busy) return { id: busy.id, fired: { ok: true }, existing: true };
        planId = E.studyPlanNewJobId(fresh, course, today);
      }
      const st = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      const id = planId || E.safeId(`job-${st.slice(0, 8)}-${st.slice(8)}-${E.slug(title, 24)}`);
      await write({
        op: 'set',
        collection: 'jobs',
        id,
        data: {
          ...envelope('E.V. Home'),
          schema: 2,
          kind,
          title,
          brief,
          // B-449: a study plan names its course, and a change names the plan it changes (D-356)
          ...(kind === 'exam-plan' && course ? { course: String(course).slice(0, 40) } : {}),
          ...(kind === 'exam-plan' && revise ? { revise: String(revise).slice(0, 80) } : {}),
          // D-362: an edit carries his own line (its chip's brief); a chip's new plan names the chip it came from
          ...(kind === 'exam-plan' && said ? { said: String(said).slice(0, 1500) } : {}),
          ...(kind === 'exam-plan' && chip ? { chip: String(chip).slice(0, 200) } : {}),
        },
      }); // B-177: jobs schema 2
      const fired = await fire(TASKS.worker, jobText(id));
      await write({ op: 'update', collection: 'jobs', id, data: { fired } });
      // B-456: in the app there is no connector: its bridge takes the job recorded as mcp_unavailable, records the
      // hand-off as made and runs it through the Worker (pwa/bridge.js jobHandOff), so for the caller it started. B-459:
      // only when the saved job says so: a hand-off the bridge declined (its job spec unreadable) did not start
      if (!fired.ok && fired.error === 'mcp_unavailable' && inApp()) {
        const saved = await db
          .collection('jobs')
          .doc(id)
          .get()
          .catch(() => null);
        const f = saved && saved.exists ? (saved.data() || {}).fired : null;
        if (f && f.ok === true) return { id, fired: { at: f.at || fired.at, ok: true } };
      }
      return { id, fired };
    }
    // B-180 (D-194): a message starting build:, bug: or idea: is a build ask, with no model call: the build-ask row
    // writes jobs/<id> (kind build, his words) and fires the builder with "Job <id>" and his message as typed; the
    // job-fired row records the answer.
    const BUILD_ASK = /^\s*(build|bug|idea)\s*:/i;
    // B-183 (D-197): "design" or "design: <theme>" asks the builder for the next design chat's kickoff; "file: <doc link>"
    // asks it to file a design doc's hand-off. Both are builder jobs like a build ask, each its own row.
    const DESIGN_ASK = /^\s*design\s*(?::\s*(\S[\s\S]*?))?\s*$/i;
    const FILE_ASK = /^\s*file\s*:\s*(https:\/\/claude\.ai\/\S+)\s*$/i;
    const SENT = {
      'build-ask':
        'Sent to the builder. It files this as a task in your words, builds it and puts it on staging; this card follows it.',
      'design-ask':
        'Sent to the builder. It drafts your design kickoff from the Chart and the north star; it lands here with a Copy chip.',
      'plan-ask': 'Sent to the builder. It reads that doc’s tables and files them; this card follows it.',
    };
    async function buildAsk(text) {
      const typed = String(text).trim();
      const design = DESIGN_ASK.exec(typed),
        file = FILE_ASK.exec(typed);
      const row = file ? 'plan-ask' : design ? 'design-ask' : 'build-ask';
      await mattSay(typed);
      const args = {
        title: (file ? 'File ' + file[1] : design ? 'Design kickoff' + (design[1] ? ': ' + design[1] : '') : typed)
          .replace(/\s+/g, ' ')
          .slice(0, 90),
        brief: (file ? file[1] : design ? design[1] || 'the next theme' : typed).slice(0, 1500),
        text: typed.slice(0, 1600),
      };
      const ctx = { now: new Date().toISOString() }; // one time, so the composition below is this one
      const a = ACT ? ACT.tap(row, args, ctx) : { ok: false, refused: 'the actions table did not load' };
      if (!a.ok) {
        await evSay('I couldn’t hand that to the builder (' + a.refused + ').', [], { tier: 'local' });
        return;
      }
      await run(ACT.tap(row, args, ctx).writes);
      const id = a.writes[0].id;
      let fired = { at: now(), ok: false, error: 'no_task' };
      for (const e of a.effects) if (e.kind === 'fire_trigger') fired = await fire(TASKS.builder, e.text);
      await run(ACT.tap('job-fired', { job: id, fired }).writes);
      await evSay(
        fired.ok ? SENT[row] : 'Saved it, but I couldn’t start the builder. ' + fireCopy(fired.error),
        [{ type: 'job', id }],
        { tier: 'local' }
      );
    }
    // B-182 (D-196): his answer to a Your turn item, a chip's word or his typed words: the reply row writes jobs/<id>
    // (kind reply, title the task, brief his words) and fires the builder with "Job <id>" and "reply B-nn: <words>".
    const REPLY_ASK = /^\s*reply\s+(B-\d+)\s*:\s*(\S[\s\S]*)$/i;
    async function replyAsk(task, words) {
      const said = String(words).trim();
      const args = { title: task, brief: said.slice(0, 1500), text: `reply ${task}: ${said}`.slice(0, 1600) };
      const ctx = { now: new Date().toISOString() };
      const a = ACT ? ACT.tap('reply', args, ctx) : { ok: false, refused: 'the actions table did not load' };
      if (!a.ok) throw new Error('I couldn’t hand that to the builder (' + a.refused + ').');
      // B-210 (D-208): the tap shows its result in the same frame; the write catches up, and a refused write puts the
      // card back with one line saying why (the guard's toast).
      T.replied.set(task, said);
      render();
      try {
        await run(ACT.tap('reply', args, ctx).writes);
      } catch (e) {
        T.replied.delete(task);
        render();
        throw e;
      }
      const id = a.writes[0].id;
      let fired = { at: now(), ok: false, error: 'no_task' };
      for (const e of a.effects) if (e.kind === 'fire_trigger') fired = await fire(TASKS.builder, e.text);
      await run(ACT.tap('job-fired', { job: id, fired }).writes);
      if (!fired.ok) toast('Saved your reply, but I couldn’t start the builder. ' + fireCopy(fired.error));
      try {
        regreet();
      } catch {}
      render();
      return { id, fired };
    }
    async function replyTyped(text) {
      const [, task, words] = REPLY_ASK.exec(text);
      await mattSay(text.trim());
      try {
        const r = await replyAsk(task.toUpperCase(), words);
        await evSay(
          r.fired.ok
            ? `Sent to the builder for ${task.toUpperCase()}. It picks it up from your words.`
            : 'Saved it, but I couldn’t start the builder. ' + fireCopy(r.fired.error),
          [{ type: 'job', id: r.id }],
          { tier: 'local' }
        );
      } catch (e) {
        await evSay(e.message, [], { tier: 'local' });
      }
    }
    /** The Reply and What's off chips: his own words, typed, as "reply B-nn: ...". */
    function startReply(task) {
      const i = $('ev-input');
      i.value = `reply ${task}: `;
      i.focus();
      i.dispatchEvent(new Event('input'));
    }
    /** B-200 (D-208): a job as he sees it: queued from his Try again tap until the record catches up or refuses. */
    // ---------------------------------------------------------------- her work line (B-227, D-232)
    // While a job runs, its line is its one-line plan (its title); once done, "Worked for 40 s". Opened in place, what
    // she changed, each a link that opens its place. A reply whose tools changed something carries the same line.
    function workFor(ms) {
      const s = Math.max(1, Math.round((Number(ms) || 0) / 1000));
      if (s < 60) return s + ' s';
      const m = Math.round(s / 60);
      return durFmt(m);
    }
    const openSeg = (tab, seg) => () => {
      showTab(tab);
      const b = seg && $('seg-' + tab) && $('seg-' + tab).querySelector('[data-v="' + seg + '"]');
      if (b) b.click();
    };
    /** A changed document as {label, go} (go opens its place; href for a page outside), or null for one with none. */
    function changeLink(ref) {
      if (/^https:\/\//.test(ref)) return { label: ref.replace(/^https:\/\/(www\.)?/, '').slice(0, 60), href: ref };
      const i = ref.indexOf('/'),
        col = ref.slice(0, i),
        id = ref.slice(i + 1);
      const cut = t => String(t || id).slice(0, 70);
      if (col === 'ideas') {
        const x = (S.ideas || []).find(d => d.id === id);
        return { label: 'Idea: ' + cut(x && x.text), go: openSeg('record') };
      }
      if (col === 'weakspots') {
        const x = M.models.find(w => w.id === id);
        return { label: 'Weak spot: ' + cut(x && x.topic), go: openSeg('study', 'weak') };
      }
      if (col === 'dates' || col === 'dateedits') {
        const x = S.dates.find(d => d.id === id);
        return { label: 'Date: ' + cut(x && x.title), go: openSeg('today', 'week') };
      }
      if (col === 'dayedits')
        return { label: id === today ? 'Today’s list' : short(id) + '’s list', go: () => showTab('today') };
      if (col === 'sets') {
        const x = S.sets.find(d => d.id === id);
        return {
          label: 'Practice: ' + cut(x && x.title),
          go: () => {
            ui.openSet = id;
            showTab('study');
            setStudy('practice');
            render();
          },
        };
      }
      return null;
    }
    /** What a job changed: its set, and the pages it made outside (a Claude Doc, a shared page). */
    function jobChanges(j) {
      const r = j.result || {};
      return [
        ...(r.setId ? ['sets/' + r.setId] : []),
        ...[r.docUrl, r.pageUrl].filter(u => /^https:\/\//.test(u || '')),
      ];
    }
    /** The work line: one line, "Worked for <duration>", opening in place to the changes as links. */
    function workEl(work, key) {
      const box = el('div', 'work');
      const open = T.workOpen.has(key);
      const links = (work.changed || []).map(changeLink).filter(Boolean);
      const line = el('button', 'fold-line work-line', 'Worked for ' + workFor(work.ms));
      line.type = 'button';
      line.setAttribute('aria-expanded', String(open && links.length > 0));
      if (!links.length) line.disabled = true;
      line.addEventListener('click', () => {
        if (T.workOpen.has(key)) T.workOpen.delete(key);
        else T.workOpen.add(key);
        render();
      });
      box.append(line);
      if (open && links.length) {
        const ul = el('ul', 'list work-changes');
        for (const l of links) {
          const li = el('li');
          if (l.href) {
            const a = el('a', 'tlink', l.label);
            a.href = l.href;
            a.target = '_blank';
            a.rel = 'noopener';
            li.append(a);
          } else {
            const b = el('button', 'tlink', l.label);
            b.type = 'button';
            b.addEventListener('click', l.go);
            li.append(b);
          }
          ul.append(li);
        }
        box.append(ul);
      }
      return box;
    }
    function jobSeen(j) {
      return j && T.retrying.has(j.id) ? { ...j, status: 'queued', fired: null, result: null } : j;
    }
    async function refire(j) {
      await write({ op: 'update', collection: 'jobs', id: j.id, data: { fired: null } }); // null first: update merges nested maps, and the new attempt must not inherit the old error
      const fired = await fire(TASKS.worker, jobText(j.id));
      await write({ op: 'update', collection: 'jobs', id: j.id, data: { fired } });
      if (!fired.ok) toast(fireCopy(fired.error));
    }
    /** A job kind's label: the worker's kinds, then the builder's (B-177 review: a build job's card names its kind). */
    function kindLabel(k) {
      return (KINDS[k] || {}).label || ((EV_SPEC.jobs && EV_SPEC.jobs.builderLabels) || {})[k] || null;
    }
    function jobState(j) {
      const mins = iso => Math.round((Date.now() - E.toMs(iso)) / 60000);
      // D-194 (B-177): a build, reply, design, plan or ship job is the builder's, with its own, longer window.
      const forBuilder = ((EV_SPEC.jobs && EV_SPEC.jobs.builderKinds) || []).includes(j.kind);
      const who = forBuilder ? 'the builder' : 'the worker';
      const stall = forBuilder ? (EV_SPEC.constants.watchdog || {}).builderStallMinutes || 90 : 15;
      if (j.status === 'done')
        return {
          label: 'done',
          v: 'ok',
          detail:
            'Finished ' +
            (j.finishedAt
              ? (E.chicagoDate(j.finishedAt) === today ? '' : short(j.finishedAt) + ' ') + clock12(j.finishedAt)
              : ''),
        };
      if (j.status === 'failed')
        return {
          label: 'failed',
          v: 'bad',
          detail:
            (j.result && (j.result.failed || j.result.text)) ||
            `${forBuilder ? 'The builder' : 'The worker'} stopped before it finished.`,
          retry: !forBuilder,
        };
      if (j.fired && j.fired.ok === false)
        return { label: 'not started', v: 'bad', detail: fireCopy(j.fired.error), retry: !forBuilder };
      // B-456: a new plan that never started, or stopped mid-run, says so; Make a plan starts the next one
      const stalled = E.studyPlanJobStalled(j);
      if (stalled) return { label: 'failed', v: 'bad', detail: stalled, retry: false };
      if (j.status === 'running')
        return mins(j.startedAt) > (forBuilder ? stall : 40)
          ? {
              label: 'running',
              v: 'warn',
              detail: `Running for ${mins(j.startedAt)} min. It may have stalled.`,
              retry: !forBuilder,
            }
          : { label: 'running', v: 'info', detail: 'Running since ' + clock12(j.startedAt) + '.' };
      if (!j.fired) return { label: 'queued', v: '', detail: `Handing it to ${who}…` };
      return mins(j.fired.at) > stall
        ? { label: 'queued', v: 'warn', detail: `No word from ${who} in ${stall} minutes.`, retry: !forBuilder }
        : {
            label: 'queued',
            v: 'info',
            detail: `Sent to ${who} at ` + clock12(j.fired.at) + '. It usually starts within a few minutes.',
          };
    }
    /** B-180 (D-194): a build job's card from its jobresults.result (the builder's trace): filed as B-nnn, built and
     * green on staging at the commit, and what waits, or where it stopped. */
    function buildList(j) {
      const r = j.result || {};
      const failed = j.status === 'failed';
      const ul = el('ul', 'list build-steps');
      // B-183: a kickoff or a filing has one row: what the builder said (the kickoff itself is the line above, to copy).
      if (j.kind === 'design' || j.kind === 'plan' || j.kind === 'ship') {
        const said = failed ? r.failed || r.text || 'The builder stopped before it finished.' : r.text || '';
        const name = { design: 'Kickoff', plan: 'Filed', ship: 'Live' }[j.kind];
        const yet = { design: 'Not drafted yet', plan: 'Not filed yet', ship: 'Not live yet' }[j.kind];
        ul.append(row({ title: failed ? 'Where it stopped' : name, detail: said || yet }));
        return ul;
      }
      ul.append(row({ title: 'Filed', detail: r.task ? 'As ' + r.task : failed ? 'Not filed' : 'Not filed yet' }));
      ul.append(
        row({
          title: 'Built',
          detail: r.commit
            ? 'Staging green at ' + String(r.commit).slice(0, 7)
            : failed
              ? 'Stopped before staging'
              : 'Not built in this run',
        })
      );
      const said = failed ? r.failed || r.text || 'The builder stopped before it finished.' : r.text || '';
      if (said) ul.append(row({ title: failed ? 'Where it stopped' : 'What waits', detail: said }));
      const ship = shipChip(j);
      if (ship) ul.append(ship);
      return ul;
    }
    // B-185 (D-198): Ship it, on a build that is staging green at the commit staging runs now: one confirm, then a ship
    // job naming that commit and its tasks, which is his OK for live, and the builder fired with it. A ship job already
    // sent for the commit shows as sent; nothing is offered for a build that staging has moved past.
    function shipChip(j) {
      const r = j.result || {};
      const c = String(r.commit || '');
      const here = String((S.manifest && S.manifest.commit) || '');
      if (
        !BUILDER_HERE ||
        j.kind !== 'build' ||
        j.status !== 'done' ||
        !/^[0-9a-f]{7,40}$/.test(c) ||
        !here.startsWith(c)
      )
        return null;
      const tasks = r.task ? [r.task] : [];
      if (!tasks.length) return null; // a ship job names the tasks it ships
      const sent = S.jobs.find(x => x.kind === 'ship' && x.commit === c);
      const li = el('li', 'row ship-row');
      if (sent) {
        li.append(el('span', 'meta', `Ship it sent for ${c.slice(0, 7)}${sent.status === 'done' ? ': live' : ''}`));
        return li;
      }
      const go = el('button', 'qchip go', `Ship it (${c.slice(0, 7)})`);
      go.type = 'button';
      go.addEventListener('click', () => {
        li.replaceChildren();
        const ok = el('button', 'qchip go', 'Ship');
        const no = el('button', 'qchip', 'Cancel');
        ok.type = no.type = 'button';
        no.addEventListener('click', () => li.replaceChildren(go));
        ok.addEventListener('click', async () => {
          ok.disabled = no.disabled = true;
          await shipIt(c, tasks);
        });
        li.append(
          el(
            'span',
            'meta ship-ask',
            `Ship ${c.slice(0, 7)}${tasks.length ? ' (' + tasks.join(', ') + ')' : ''} to live? This tap is your OK.`
          ),
          ok,
          no
        );
      });
      li.append(go);
      return li;
    }
    async function shipIt(commit, tasks) {
      const args = {
        brief: 'ship it',
        title: `Ship ${commit.slice(0, 7)}`,
        commit,
        tasks,
        text: `ship it ${commit.slice(0, 7)}`,
      };
      const ctx = { now: new Date().toISOString() };
      const a = ACT ? ACT.tap('ship-it', args, ctx) : { ok: false, refused: 'the actions table did not load' };
      if (!a.ok) {
        toast('I couldn’t hand that to the builder (' + a.refused + ').');
        return;
      }
      await run(ACT.tap('ship-it', args, ctx).writes);
      const id = a.writes[0].id;
      let fired = { at: now(), ok: false, error: 'no_task' };
      for (const e of a.effects) if (e.kind === 'fire_trigger') fired = await fire(TASKS.builder, e.text);
      await run(ACT.tap('job-fired', { job: id, fired }).writes);
      await evSay(
        fired.ok
          ? `Sent: the builder ships ${commit.slice(0, 7)} to live, checks it and says how it went here.`
          : 'Saved it, but I couldn’t start the builder. ' + fireCopy(fired.error),
        [{ type: 'job', id }],
        { tier: 'local' }
      );
    }
    /** D-104: the retro's numbers on its job card, the same ones the narrative was written over. */
    function retroList(x) {
      const ul = el('ul', 'list retro');
      const c = x.calibration;
      const range = x.prediction ? x.prediction.predictedRange.join('–') : null;
      const off = c
        ? c.inRange
          ? 'inside the range'
          : `${Math.abs(Math.round(10 * (c.error < 0 ? c.predictedRange[0] - c.score : c.score - c.predictedRange[1])) / 10)} ${c.error < 0 ? 'below' : 'above'} the range`
        : null;
      ul.append(
        row({
          title: 'Prediction',
          detail: range
            ? `${range}${x.score != null ? ' · you scored ' + x.score + ' (' + off + ')' : ' · no score yet'}`
            : x.score != null
              ? 'No prediction for this exam · you scored ' + x.score
              : 'No prediction for this exam',
        })
      );
      const p = x.practice;
      const weak = p.byObjective[0];
      ul.append(
        row({
          title: 'Practice',
          detail: p.answered
            ? `${p.right} of ${p.answered} right (${p.pct}%)${weak && p.byObjective.length > 1 ? ' · weakest ' + weak.id + ' at ' + weak.pct + '%' : ''}`
            : 'No practice answers on this exam',
        })
      );
      ul.append(
        row({ title: 'Weak spots', detail: `${x.weakSpots.solid} made solid · ${x.weakSpots.open} still open` })
      );
      if (x.plan.tasks) ul.append(row({ title: 'Plan', detail: `${x.plan.ticked} of ${x.plan.tasks} tasks done` }));
      return ul;
    }
    const liveJobs = () =>
      S.jobs.filter(
        j =>
          ['queued', 'running'].includes(j.status) &&
          !(j.fired && j.fired.ok === false) &&
          Date.now() - E.toMs(j.createdAt) < 3 * 3600e3
      );

