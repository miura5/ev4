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
    // ---- Session filing from the page (Features: reader v2 list_sessions/read_session, core.intakeSession). Runs once
    // when E.V. Home opens where the reader answers (the desktop app on his Mac) and on "file it". Only findings ever
    // leave the reader (never note text); a #graded session is left alone; a near-repeat waits on Same or Different.
    const FILE = { running: null, opened: false, quiet: null };
    // Sessions waiting to be filed, for the greeting's File it chip (D-125 as amended): quiet filing on open is the main
    // path; the chip is the fallback when it cannot run (no Mac reader here, the reader unreachable) or left some behind.
    const fileUnfiled = () =>
      !mcpKnown ? 0 : !mcp || (FILE.quiet && !FILE.quiet.ok) ? 1 : FILE.quiet ? FILE.quiet.left : 0;
    const filedIds = () => new Set(S.sessions.map(s => (/^(sw|ss)-/.test(s.id) ? s.id : 'sw-' + s.id))); // v3 filed them without the prefix
    async function fileSessions({ quiet = false } = {}) {
      if (FILE.running) return FILE.running;
      FILE.running = (async () => {
        let list;
        try {
          list = await readerCall('list_sessions', {
            sinceModifiedAt: new Date(Date.now() - 30 * 864e5).toISOString(),
          });
        } catch (e) {
          if (quiet) FILE.quiet = { ok: false };
          if (!quiet)
            return {
              text: readerCopy((e && e.code) || 'upstream_error', e && e.message).replace(
                'read your note',
                'reach your sessions'
              ),
              cards: [],
            };
          return null;
        }
        const known = filedIds();
        const todo = ((list && list.sessions) || []).filter(x => x && x.id && !known.has('sw-' + x.id)).slice(0, 10);
        let unread = 0;
        if (quiet) FILE.quiet = { ok: true, left: 0 };
        if (!todo.length)
          return quiet
            ? null
            : {
                text: 'Nothing new to file: every Study Watch session from the last 30 days is already in your record.',
                cards: [],
              };
        const filed = [];
        let graded = 0,
          weak = 0,
          ideas = 0,
          asks = 0;
        for (const x of todo) {
          let f;
          try {
            f = await readerCall('read_session', { id: x.id });
          } catch {
            unread++;
            continue;
          }
          if (!f || !f.found) {
            unread++;
            continue;
          }
          if (f.graded) {
            graded++;
            continue;
          }
          const r = E.intakeSession(
            { ...f, id: 'sw-' + x.id },
            {
              weakspots: M.models,
              sessions: S.sessions.map(s => ({ ...s, id: /^(sw|ss)-/.test(s.id) ? s.id : 'sw-' + s.id })),
              objectives: S.objectives,
              now: now(),
              writer: 'page',
            }
          );
          if (r.skip) continue;
          const writes = r.writes.map(w =>
            w.collection === 'sessions' && w.id === r.id && r.questions.length
              ? {
                  ...w,
                  data: {
                    ...w.data,
                    pending: Object.fromEntries(
                      r.questions.map(q => [q.key, { topic: q.topic, objective: q.objective, candidate: q.candidate }])
                    ),
                  },
                }
              : w
          );
          await run(writes);
          filed.push(r.id);
          weak += writes.filter(w => w.collection === 'weakspots' && w.op === 'set').length;
          ideas += writes.filter(w => w.collection === 'ideas').length;
          asks += r.questions.length;
        }
        if (quiet) FILE.quiet = { ok: true, left: unread };
        if (!filed.length)
          return quiet && !graded
            ? null
            : {
                text: graded
                  ? `${plural(graded, 'session')} tagged #graded stayed out of the record. Nothing else new to file.`
                  : 'Nothing new to file.',
                cards: [],
              };
        const bits = [
          plural(filed.length, 'Study Watch session'),
          weak ? plural(weak, 'new weak spot') : '',
          ideas ? plural(ideas, 'idea') : '',
        ]
          .filter(Boolean)
          .join(', ');
        return {
          text: `Filed ${bits}.${asks ? ' ' + (asks === 1 ? 'One near-repeat waits' : asks + ' near-repeats wait') + ' on Same or Different.' : ''}${graded ? ' Sessions tagged #graded stayed out.' : ''}`,
          cards: filed.slice(0, 3).map(id => ({ type: 'session', id })),
        };
      })().finally(() => {
        FILE.running = null;
      });
      return FILE.running;
    }
    async function fileItReply() {
      const r = await fileSessions();
      return r ? [r.text, r.cards] : ['Nothing new to file.', []];
    }
    const jobText = id => (TASKS.jobText || 'Job {id}').replace('{id}', id);
    async function startJob({ kind, title, brief }) {
      kind = KINDS[kind] ? kind : 'general';
      title =
        String(title || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 90) || KINDS[kind].label;
      brief = String(brief || '')
        .trim()
        .slice(0, 1500);
      if (E.scanIdentifiers(title + ' ' + brief).length)
        throw new Error('The brief looks like it has patient details. Leave real patient details out.');
      const st = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      const id = E.safeId(`job-${st.slice(0, 8)}-${st.slice(8)}-${E.slug(title, 24)}`);
      await write({
        op: 'set',
        collection: 'jobs',
        id,
        data: { ...envelope('E.V. Home'), schema: 2, kind, title, brief },
      }); // B-177: jobs schema 2
      const fired = await fire(TASKS.worker, jobText(id));
      await write({ op: 'update', collection: 'jobs', id, data: { fired } });
      return { id, fired };
    }
    // B-180 (D-194): a message starting build:, bug: or idea: is a build ask, with no model call: the build-ask row
    // writes jobs/<id> (kind build, his words) and fires the builder with "Job <id>" and his message as typed; the
    // job-fired row records the answer. An identifier holds it outright: a build ask's words go into the Chart.
    const BUILD_ASK = /^\s*(build|bug|idea)\s*:/i;
    async function buildAsk(text) {
      const typed = String(text).trim();
      await mattSay(typed);
      const args = {
        title: typed.replace(/\s+/g, ' ').slice(0, 90),
        brief: typed.slice(0, 1500),
        text: typed.slice(0, 1600),
      };
      const ctx = { now: new Date().toISOString() }; // one time, so the composition below is this one
      const a = ACT ? ACT.tap('build-ask', args, ctx) : { ok: false, refused: 'the actions table did not load' };
      if (!a.ok) {
        await evSay('I couldn’t hand that to the builder (' + a.refused + ').', [], { tier: 'local' });
        return;
      }
      await run(ACT.tap('build-ask', args, ctx).writes);
      const id = a.writes[0].id;
      let fired = { at: now(), ok: false, error: 'no_task' };
      for (const e of a.effects) if (e.kind === 'fire_trigger') fired = await fire(TASKS.builder, e.text);
      await run(ACT.tap('job-fired', { job: id, fired }).writes);
      await evSay(
        fired.ok
          ? 'Sent to the builder. It files this as a task in your words, builds it and puts it on staging; this card follows it.'
          : 'Saved it, but I couldn’t start the builder. ' + fireCopy(fired.error),
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
      await run(ACT.tap('reply', args, ctx).writes);
      const id = a.writes[0].id;
      let fired = { at: now(), ok: false, error: 'no_task' };
      for (const e of a.effects) if (e.kind === 'fire_trigger') fired = await fire(TASKS.builder, e.text);
      await run(ACT.tap('job-fired', { job: id, fired }).writes);
      T.replied.set(task, said);
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
      if (j.status === 'running')
        return mins(j.startedAt) > (forBuilder ? stall : 40)
          ? {
              label: 'running',
              v: 'warn',
              detail: `Running for ${mins(j.startedAt)} min. It may have stalled.`,
              retry: !forBuilder,
            }
          : { label: 'running', v: 'info', detail: 'Working on it since ' + clock12(j.startedAt) + '.' };
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
      return ul;
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

