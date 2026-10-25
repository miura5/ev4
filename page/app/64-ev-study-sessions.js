    // ---------------------------------------------------------------- study sessions (D-073: all in this conversation)
    // Study Watch (reader mode) saves the school note he is writing, and the read-only reader connector serves it to
    // this page inside the Claude desktop app. Rules (timer, new-text diff, prompts, filing) live in E.V. core. The note's
    // text stays in this page's memory; the record keeps only its length and hash.
    const READER = EV_SPEC.reader || {};
    const SWC = (EV_SPEC.constants && EV_SPEC.constants.studyWatch) || {};
    const SS = {
      view: Math.random().toString(36).slice(2, 10),
      busy: false,
      text: null,
      added: '',
      said: new Set(),
      audio: null,
      readerOk: null,
      probing: false,
      // B-87: a view claims a running session once the reader answers (on open and each time the tab comes back).
      mayClaim: true,
      reprobeAt: 0,
      // B-88: comment mode reads every readSeconds; seen is what she has read, quotes keep her quoted lines in memory only.
      seen: null,
      nextRead: 0,
      reading: false,
      lastAsk: 0,
      quotes: new Map(),
      note: null,
      changedAt: 0,
    };
    const COMMENT = SWC.mode === 'comment';
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        SS.mayClaim = true;
        SS.nextRead = 0;
      }
    });
    const READER_COPY = {
      mcp_unavailable:
        'I can’t reach the Study Watch reader in this view. Open E.V. Home in the Claude desktop app on your Mac.',
      server_not_connected:
        'I can’t reach the Study Watch reader from here. Open E.V. Home in the Claude desktop app on your Mac, with the E.V. Study Watch reader extension turned on.',
      not_in_manifest:
        'The Study Watch reader is switched off for this page. Turn it on in the page’s Permissions menu, then try again.',
      cancelled: 'You declined the reader just now, so I didn’t read your note.',
      approval_required: 'Reading your note needs your OK. Try again and choose Allow when the app asks.',
      blocked_by_policy: 'Your organization blocks local connectors, so I can’t read your note.',
      not_granted: 'Reading your note isn’t available in this view.',
      capability_disabled:
        'Reading your note isn’t available in this view. Open E.V. Home in the Claude desktop app on your Mac.',
    };
    const readerCopy = (code, msg) =>
      READER_COPY[code] ||
      (code === 'tool_error' && msg
        ? 'The Study Watch reader says: ' + msg
        : `Couldn’t read your note (${code}). I’ll try again at the next check.`);
    async function readerCall(tool, input) {
      if (!mcp || !READER.host) throw Object.assign(new Error('no connector'), { code: 'mcp_unavailable' });
      const r = await mcp.callTool(READER.host, tool, input || {}, { cache: false });
      SS.readerOk = true;
      return (r && r.payload) || {};
    }
    async function probeReader() {
      if (SS.probing || SS.readerOk != null) return;
      SS.probing = true;
      try {
        await readerCall('status');
      } catch {
        SS.readerOk = false;
      } finally {
        SS.probing = false;
      }
    }
    const sessOf = id => S.sessions.find(s => s.id === id) || null;
    // D-130: the level his last study session (not a skills run) was left at, else Some.
    const lastComments = () => {
      const prev = S.sessions
        .filter(x => String(x.id).startsWith('ss-') && x.kind !== 'skill' && x.comments)
        .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0];
      return (prev && prev.comments) || 'some';
    };
    const activeSession = () =>
      S.sessions
        .filter(s => s.source === 'E.V. Home' && s.kind !== 'skill' && (s.status === 'active' || s.status === 'ending'))
        .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] || null;
    const sessEvent = (s, type, extra = {}) => {
      const at = now();
      return write({
        op: 'update',
        collection: 'sessions',
        id: s.id,
        data: { events: { [pageKey(at)]: { type, at, ...extra } } },
      });
    };
    const withDerived = writes => writes; // v4 stores no derived state (D-047): core's writes go as they are
    const sessCtx = () =>
      E.sessionContext({ date: today, exams: S.exams, objectives: S.objectives, weakspots: M.models });
    function unlockAudio() {
      try {
        if (!SS.audio) {
          const A = window.AudioContext || window.webkitAudioContext;
          if (A) SS.audio = new A();
        }
        if (SS.audio && SS.audio.state === 'suspended') SS.audio.resume();
      } catch {}
    }
    function chime() {
      // a soft two-note cue when a check lands; sound only works after a click on this page
      try {
        const a = SS.audio;
        if (!a || a.state !== 'running') return;
        [660, 880].forEach((f, i) => {
          const o = a.createOscillator(),
            g = a.createGain(),
            t = a.currentTime + i * 0.16;
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
          o.connect(g).connect(a.destination);
          o.start(t);
          o.stop(t + 0.32);
        });
      } catch {}
    }
    const idWhy = w => (/^(mentions|looks|has)/.test(w) ? w : 'has a ' + w);

    async function startSession() {
      unlockAudio();
      const cur = activeSession();
      if (cur)
        return [
          `A session on **${cur.topic}** is already running. End it from the bar at the top when you’re done.`,
          [],
        ];
      if (!sample || T.sampleOff)
        return [
          'Study sessions need permission to ask Claude for the checks. Allow Claude for this page from its Permissions menu.',
          [],
        ];
      let p;
      try {
        p = await readerCall('latest_note');
      } catch (e) {
        SS.readerOk = false;
        return [readerCopy((e && e.code) || 'upstream_error', e && e.message), []];
      }
      if (!p.found)
        return [
          p.refused
            ? 'Study Watch’s latest note isn’t in ' +
              E.courses().join(' or ') +
              ', so I won’t read it. Type a line in a school note, then start again.'
            : 'Study Watch hasn’t saved a school note yet. Check that it’s running in reader mode, type a line in your NUR 112 or BIO 201 note, then start again.',
          [],
        ];
      const n = p.note || {};
      if (p.graded)
        return [`**${n.name}** is tagged #graded, so I stay out of it. Open another note and start again.`, []];
      const at = now();
      const stamp = at.replace(/\D/g, '').slice(0, 14);
      const mark = E.noteMark(n.text || '');
      const id = E.safeId(`ss-${stamp.slice(0, 8)}-${stamp.slice(8)}-${E.slug(n.name || 'note', 24)}`);
      await write({
        op: 'set',
        collection: 'sessions',
        id,
        data: {
          ...envelope('E.V. Home', at),
          schema: 2, // B-74
          status: 'active',
          // D-130: the comments level carries over from his last study session; Some until he changes it.
          comments: lastComments(),
          date: today,
          startedAt: at,
          topic: String(n.name || 'Study session').slice(0, 120),
          noteId: String(n.id || ''),
          folder: String(n.folder || ''),
          driver: { view: SS.view, at },
          events: {
            [pageKey(at)]: { type: 'start', noteId: n.id, len: mark.len, h: mark.h, modifiedAt: n.modifiedAt || null },
          },
        },
      });
      SS.text = n.text || '';
      SS.added = '';
      SS.said.clear();
      SS.seen = SS.text;
      SS.note = { id: n.id, name: n.name, folder: n.folder || '', title: n.title || '' };
      SS.nextRead = Date.now() + (SWC.readSeconds || 30) * 1e3;
      SS.changedAt = Date.now();
      renderNotes();
      if (COMMENT)
        return [
          `Session started on **${n.name}**. I’m reading along as you write and I’ll only chime in when a line makes a connection. Tap Quiz me now whenever you want questions. Break and End are in the bar at the top.`,
          [],
        ];
      return [
        `Session started on **${n.name}**. I’ll check your new writing every ${SWC.checkMinutes || 7} minutes and post the questions here. Break, +5 and End are in the bar at the top.`,
        [],
      ];
    }

    async function runCheck(s, { quiz = false } = {}) {
      if (SS.busy) return;
      SS.busy = true;
      render();
      const st = E.sessionState(s, now());
      const n = st.checks + 1;
      const skip = async (why, say) => {
        await sessEvent(s, 'skip', { why });
        if (say && !SS.said.has(why)) {
          SS.said.add(why);
          await evSay(say, [], { tier: 'local' });
        }
      };
      try {
        if (!s.driver || s.driver.view !== SS.view)
          await write({
            op: 'update',
            collection: 'sessions',
            id: s.id,
            data: { driver: { view: SS.view, at: now() } },
          });
        let p;
        try {
          p = await readerCall('latest_note');
        } catch (e) {
          const code = (e && e.code) || 'upstream_error';
          if (['server_not_connected', 'mcp_unavailable', 'capability_disabled', 'not_granted'].includes(code))
            SS.readerOk = false;
          await skip('reader-' + code, readerCopy(code, e && e.message));
          return;
        }
        if (!p.found) {
          await skip('no-note', 'I can’t see a saved school note right now. Is Study Watch running in reader mode?');
          return;
        }
        const note = p.note || {};
        if (p.graded) {
          await skip(
            'graded',
            `**${note.name}** is tagged #graded, so I’m staying out of it. Checks pick up when you’re back in a study note.`
          );
          return;
        }
        const base = quiz ? st.lastQuizMark : st.lastMark;
        const mark = base && base.noteId === note.id ? base : null;
        const text = String(note.text || '');
        let d = E.noteDelta(text, mark);
        if (d.same && quiz) d = { added: text.slice(-(SWC.fallbackChars || 2500)), same: false, rewritten: true }; // Quiz me now on an unchanged note: the note so far
        if (d.same) {
          await sessEvent(s, 'idle');
          return;
        }
        const ids = idUnpassed(d.added).map(c => c.why); // B-197: values only (a note's "verify DOB" is no candidate)
        if (ids.length) {
          await skip('identifiers', `Your new writing ${idWhy(ids[0])}. I skipped this check.`);
          return;
        }
        const msg = msgId('e');
        const m2 = E.noteMark(text);
        const switched = st.lastMark && st.lastMark.noteId && st.lastMark.noteId !== note.id;
        const pargs = { noteName: note.name, text, added: d.added, n, context: sessCtx(), rewritten: d.rewritten };
        // B-75 (D-133): the formats alternate from multiple choice; an open check whose note gives no two grounded key
        // points, or whose item fails its check function, falls back to multiple choice and is stored as one.
        if (E.checkFormat(s, now()) === 'open') {
          const item = E.parseOpenCheck(
            await sample.json(E.openCheckPrompt(pargs), { modelTier: 'quick', cache: false }),
            {
              text,
              noteId: note.id,
              id: 'o1',
              topic: note.name,
            }
          );
          if (item) {
            const setId = E.safeId(`check-${s.id}-${n}`);
            await write({
              op: 'set',
              collection: 'sets',
              id: setId,
              data: {
                ...envelope('Study session', now()),
                schema: 3,
                kind: 'check',
                title: `Check ${n} · ${note.name}`,
                date: E.chicagoDate(now()),
                exam: null,
                items: [item],
              },
            });
            await postMsg({
              id: msg,
              role: 'ev',
              text: `One question on what you just wrote${switched ? ' in **' + note.name + '**' : ''}. Answer it in your own words.`,
              cards: [
                { type: 'check', session: s.id, n, format: 'open', setId, items: [{ text: item.stem, kind: 'why' }] },
              ],
              at: now(),
              tier: 'quick',
            });
            await sessEvent(s, 'check', {
              n,
              format: 'open',
              items: 1,
              msgId: msg,
              noteId: note.id,
              len: m2.len,
              h: m2.h,
              modifiedAt: note.modifiedAt || null,
            });
            SS.text = text;
            SS.added = d.added;
            SS.alertUntil = Date.now() + 4500;
            chime();
            if (SS.seen != null && text.startsWith(SS.seen)) SS.seen = text;
            return;
          }
        }
        const out = await sample.json(E.checkPrompt(pargs), { modelTier: 'quick', cache: false });
        const items = E.parseCheck(out);
        if (!items.length) {
          await skip('no-items');
          return;
        }
        const count =
          ['One question', 'Two questions', 'Three questions'][items.length - 1] || plural(items.length, 'question');
        await postMsg({
          id: msg,
          role: 'ev',
          text: `${count} on what you just wrote${switched ? ' in **' + note.name + '**' : ''}.`,
          cards: [{ type: 'check', session: s.id, n, items }],
          at: now(),
          tier: 'quick',
        });
        await sessEvent(s, 'check', {
          n,
          format: 'mc', // D-133 (B-75): an open check that fell back is stored as multiple choice
          items: items.length,
          msgId: msg,
          noteId: note.id,
          len: m2.len,
          h: m2.h,
          modifiedAt: note.modifiedAt || null,
        });
        SS.text = text;
        SS.added = d.added;
        SS.alertUntil = Date.now() + 4500;
        chime();
        if (SS.seen != null && text.startsWith(SS.seen)) SS.seen = text;
      } catch (e) {
        const code = (e && e.code) || 'error';
        if (HIDE.has(code)) T.sampleOff = code;
        await skip(
          'sample-' + code,
          code === 'rate_limited'
            ? 'You’ve hit a usage limit, so checks pause until it resets. The session keeps time.'
            : SAMPLE_COPY[code] || 'That check didn’t go through. I’ll try again at the next one.'
        ).catch(() => {});
      } finally {
        SS.busy = false;
        render();
      }
    }

    // B-88 (Matt, Oct 19; the Captions artboard). Comment mode: she reads the note every readSeconds and, when new lines
    // land, asks Claude whether one of them earns a word (a connection, an exam point, a slip). Most reads say nothing.
    // Her line is posted to the conversation; the line of his it answers stays in this page's memory (SS.quotes), never
    // in the record. A comment writes a check event marked comment, so the note's mark and the idle count move with it.
    async function readTick(s) {
      if (SS.reading || SS.busy || Date.now() < SS.nextRead) return;
      SS.reading = true;
      SS.nextRead = Date.now() + (SWC.readSeconds || 30) * 1e3;
      try {
        let p;
        try {
          p = await readerCall('latest_note');
        } catch {
          return;
        }
        if (!p || !p.found || p.graded) return;
        const note = p.note || {};
        const text = String(note.text || '');
        const prev = SS.text,
          was = SS.note && SS.note.title;
        SS.text = text;
        SS.note = { id: note.id, name: note.name, folder: note.folder || '', title: note.title || '' };
        if (prev !== text) {
          SS.changedAt = Date.now();
          renderNotes();
        } else if ((was || '') !== SS.note.title) renderNotes(); // a reader updated mid-session names the note

        if (SS.seen == null) {
          SS.seen = text;
          return;
        } // opened mid-session: what is already written counts as read
        const grew = text.startsWith(SS.seen);
        let added = grew ? text.slice(SS.seen.length) : text.slice(-1200);
        if (prev !== text) {
          const k = added.lastIndexOf('\n');
          added = k >= 0 ? added.slice(0, k + 1) : '';
        } // still typing: complete lines only
        if (
          added.replace(/\s/g, '').length < (SWC.commentMinChars || 20) ||
          Date.now() - SS.lastAsk < (SWC.commentGapSeconds || 75) * 1e3
        )
          return;
        const seenNext = grew ? SS.seen + added : text;
        const before = grew ? SS.seen.slice(-800) : '';
        const ids = idUnpassed(added).map(c => c.why);
        if (ids.length) {
          SS.seen = seenNext;
          if (!SS.said.has('identifiers')) {
            SS.said.add('identifiers');
            await sessEvent(s, 'skip', { why: 'identifiers' });
            await evSay(`Your new writing ${idWhy(ids[0])}, so I skipped reading it.`, [], { tier: 'local' });
          }
          return;
        }
        if (!sample || T.sampleOff) return;
        SS.lastAsk = Date.now();
        SS.thinking = true;
        renderBar();
        let out;
        try {
          out = await sample.json(
            E.commentPrompt({
              noteName: note.name,
              opening: text.slice(0, SWC.openingChars || 800),
              before,
              added,
              context: sessCtx(),
            }),
            { modelTier: 'quick', cache: false }
          );
        } catch (e) {
          const code = (e && e.code) || 'error';
          if (HIDE.has(code)) T.sampleOff = code;
          if (code === 'rate_limited') SS.lastAsk = Date.now() + 10 * 60e3;
          return;
        }
        SS.seen = seenNext;
        SS.added = added;
        const c = E.parseComment(out, added);
        if (!c) return;
        const id = msgId('e');
        if (c.quote) SS.quotes.set(id, c.quote);
        await postMsg({ id, role: 'ev', text: c.say, at: now(), tier: 'quick' });
        const m2 = E.noteMark(text);
        await sessEvent(s, 'check', {
          comment: true,
          kind: c.kind,
          msgId: id,
          noteId: note.id,
          len: m2.len,
          h: m2.h,
          modifiedAt: note.modifiedAt || null,
        });
        SS.alertUntil = Date.now() + 4500;
      } finally {
        SS.reading = false;
        SS.thinking = false;
      }
    }
    // The checkpoint every checkMinutes in comment mode: no Claude call, only whether he wrote (the idle count that ends a
    // session left alone, and the mark a quiz starts from).
    async function runCheckpoint(s) {
      if (SS.busy) return;
      SS.busy = 'quiet';
      try {
        const st = E.sessionState(s, now());
        if (!s.driver || s.driver.view !== SS.view)
          await write({
            op: 'update',
            collection: 'sessions',
            id: s.id,
            data: { driver: { view: SS.view, at: now() } },
          });
        let p;
        try {
          p = await readerCall('latest_note');
        } catch (e) {
          const code = (e && e.code) || 'upstream_error';
          if (['server_not_connected', 'mcp_unavailable', 'capability_disabled', 'not_granted'].includes(code))
            SS.readerOk = false;
          await sessEvent(s, 'skip', { why: 'reader-' + code });
          if (!SS.said.has('reader-' + code)) {
            SS.said.add('reader-' + code);
            await evSay(readerCopy(code, e && e.message), [], { tier: 'local' });
          }
          return;
        }
        if (!p.found || p.graded) {
          await sessEvent(s, 'skip', { why: p.graded ? 'graded' : 'no-note' });
          return;
        }
        const note = p.note || {};
        const text = String(note.text || '');
        const mark = st.lastMark && st.lastMark.noteId === note.id ? st.lastMark : null;
        if (E.noteDelta(text, mark).same) {
          await sessEvent(s, 'idle');
          return;
        }
        const m2 = E.noteMark(text);
        await sessEvent(s, 'check', {
          quiet: true,
          noteId: note.id,
          len: m2.len,
          h: m2.h,
          modifiedAt: note.modifiedAt || null,
        });
      } finally {
        SS.busy = false;
      }
    }
    async function quizNow() {
      const s = activeSession();
      if (!s || s.status !== 'active') return ['No session is running. Say “start a study session” first.', []];
      if (!sample || T.sampleOff) return ['Quizzing needs permission to ask Claude, which this view doesn’t have.', []];
      if (SS.busy) return ['One moment, I’m reading your note.', []];
      await runCheck(s, { quiz: true });
      return null;
    }
    // What she is reading (B-88): a Reading line above the input, and on desktop the Your notes column beside her.
    const noteLines = t =>
      String(t || '')
        .split('\n')
        .map(x => x.trim())
        .filter(Boolean);
    function renderNotes() {
      const s = activeSession();
      const on = !!(s && s.status !== 'ended' && SS.text != null && SS.note);
      const rd = $('sread');
      const lines = on ? noteLines(SS.text) : [];
      const last = lines[lines.length - 1] || '';
      rd.hidden = !on || !last;
      if (!rd.hidden) {
        // D-131: the reader's title (NUR 112 › Cardiac output), else Your notes against a reader without it.
        const t = E.noteTitle(SS.note);
        const k = t + '|' + last;
        if (rd.dataset.k !== k) {
          rd.dataset.k = k;
          const [where, ...rest] = t.split(' › ');
          const w = el('span', 'sr-where', 'Reading · ' + where);
          if (rest.length) w.append(el('span', 'sr-nm', ' › ' + rest.join(' › ')));
          rd.replaceChildren(w, el('span', 'sr-line', last));
          rd.title = t + ': ' + last;
        }
      }
      let panel = $('snotes');
      const wide = innerWidth >= 1200; // B-210 (D-210): the details panel from 1200 px
      if (!on || !wide) {
        if (panel) panel.remove();
        return;
      }
      if (!panel) {
        panel = el('section', 'card snotes');
        panel.id = 'snotes';
        panel.setAttribute('aria-label', 'Your notes');
        capSide.append(panel);
      }
      const quoted = new Set(SS.quotes.values());
      const show = lines.slice(-14);
      const k = show.join('\n') + '|' + [...quoted].join('|');
      if (panel.dataset.k === k) return;
      panel.dataset.k = k;
      const head = el('div', 'card-head');
      head.append(el('h2', null, 'Your notes'), el('span', 'meta', SS.note.title || ''));
      const ul = el('ul', 'sn-lines');
      show.forEach((l, i) => {
        const li = el(
          'li',
          (i === show.length - 1 ? 'new' : '') + ([...quoted].some(q => l.includes(q)) ? ' said' : ''),
          l
        );
        ul.append(li);
      });
      panel.replaceChildren(head, ul, el('p', 'meta sn-foot', 'E.V. reads new lines as you write them.'));
    }
    addEventListener('resize', () => {
      try {
        renderNotes();
      } catch {}
    });

    function sessionTranscript(s) {
      return allMsgs()
        .filter(m => !m.pending && !m.greeting && String(m.at) >= String(s.startedAt))
        .map(m => {
          const chk = (m.cards || []).find(c => c && c.type === 'check' && c.session === s.id);
          return {
            who: m.role === 'matt' ? 'Matt' : 'E.V.',
            text: chk ? `Check ${chk.n}: ` + (chk.items || []).map((x, i) => `${i + 1}. ${x.text}`).join(' ') : m.text,
          };
        })
        .filter(t => t.text);
    }
    async function endSession(reason = 'ended') {
      const s = activeSession();
      if (!s) return ['No session is running. Say “start a study session” when you’re ready.', []];
      if (SS.busy && s.status === 'ending') return ['Already wrapping up.', []];
      SS.busy = true;
      render();
      try {
        const at = now();
        let s2 = s;
        if (s.status !== 'ending') {
          const k = pageKey(at);
          await write({
            op: 'update',
            collection: 'sessions',
            id: s.id,
            data: { status: 'ending', events: { [k]: { type: 'end', why: reason, at } } },
          });
          s2 = { ...s, status: 'ending', events: { ...(s.events || {}), [k]: { type: 'end', why: reason, at } } };
        }
        const st = E.sessionState(s2, now());
        let wrap = {};
        let note = '';
        if ((st.checks || st.comments || st.reads) && sample && !T.sampleOff) {
          try {
            wrap =
              (await sample.json(
                E.wrapPrompt({
                  noteName: s.topic,
                  transcript: sessionTranscript(s),
                  context: sessCtx(),
                  opening: SS.text ? SS.text.slice(0, 800) : '',
                }),
                { modelTier: 'default', cache: false }
              )) || {};
          } catch (e) {
            note = ` I couldn’t write the summary (${(e && e.code) || 'error'}), so it’s saved without one.`;
          }
        }
        const r = E.closeSession(s2, wrap, {
          weakspots: M.models,
          objectives: S.objectives,
          now: now(),
          endedBy: reason,
        });
        await run(withDerived(r.writes));
        const up = r.writes[0].data;
        SS.text = null;
        SS.added = '';
        SS.seen = null;
        SS.note = null;
        renderNotes();
        const bits = [
          `${up.minutes} min`,
          ...(COMMENT
            ? [st.comments ? plural(st.comments, 'comment') : '', up.questions ? plural(up.questions, 'question') : '']
            : [plural(up.checks, 'check')]),
          up.weakSpots.length ? plural(up.weakSpots.length, 'weak spot') : '',
          up.cardCount ? plural(up.cardCount, 'card') : '',
        ]
          .filter(Boolean)
          .join(', ');
        return [
          `${reason === 'idle' ? 'No new writing for a while, so I wrapped up. ' : ''}Session saved: ${bits}.${r.questions.length ? ' One thing to settle on the card.' : ''}${note}`,
          [{ type: 'session', id: s.id }],
        ];
      } finally {
        SS.busy = false;
        render();
      }
    }
    async function sessionCmd(type) {
      unlockAudio();
      const s = activeSession();
      if (!s || s.status !== 'active') return 'No session is running.';
      const st = E.sessionState(s, now());
      if (type === 'break' && st.onBreak) return 'Already on a break.';
      if (type === 'resume' && !st.onBreak) return 'Checks are already running.';
      await sessEvent(s, type);
      return type === 'break'
        ? 'Break started. No checks until you resume, and breaks don’t count as study time.'
        : type === 'resume'
          ? 'Welcome back. Checks resume.'
          : 'Next check moved 5 minutes later.';
    }
    async function decideSession(s, key, decision) {
      await run(
        withDerived(
          E.decideSessionQuestion(s, key, decision, { weakspots: M.models, objectives: S.objectives, now: now() })
        )
      );
    }
    function noteAnswer(mid) {
      // a message he sends during a session answers the newest check he hasn't answered yet
      const s = activeSession();
      if (!s || s.status !== 'active') return;
      const st = E.sessionState(s, now());
      if (st.lastCheck && !st.answered[st.lastCheck.n])
        sessEvent(s, 'answer', { n: st.lastCheck.n, msgId: mid }).catch(() => {});
    }

    const tickClock = ms => {
      const t = Math.max(0, Math.round(ms / 1000));
      return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    };
    async function barPress(b, fn) {
      b.disabled = true;
      try {
        await fn();
      } catch (e) {
        toast('Couldn’t save: ' + ((e && (e.message || e.code)) || 'error'));
      } finally {
        b.disabled = false;
      }
    }
    // Break (or Resume), +5 and End (or Finish) for a running session: the header's line and the right panel's card
    // (B-290) make the same calls. o.cls styles them; o.long names +5 as "+5 min".
    function sessButtons(s, st, ending, o = {}) {
      const mk = (label, fn) => {
        const b = btn(label, () => barPress(b, fn));
        if (o.cls) b.className = o.cls;
        return b;
      };
      const out = [];
      if (!ending) {
        out.push(
          mk(st.onBreak ? 'Resume' : 'Break', async () => toast(await sessionCmd(st.onBreak ? 'resume' : 'break')))
        );
        if (!COMMENT) {
          const ext = mk(o.long ? '+5 min' : '+5', async () => toast(await sessionCmd('extend')));
          ext.setAttribute('aria-label', 'Add 5 minutes before the next check');
          out.push(ext);
        }
      }
      const end = mk(ending ? 'Finish' : 'End', async () => {
        const [t, c] = await endSession('ended');
        await evSay(t, c, { tier: 'local' });
      });
      end.classList.add('end');
      if (SS.busy === true) end.disabled = true;
      out.push(end);
      return out;
    }
    // B-84 (the Captions v2 artboard): a session's progress to the next check is the particle ring round her own core.
    // B-86 (Matt, Oct 19): its stats are one quiet line under her core (a dot, the minutes and the next check, then Break,
    // +5 and End as text buttons), not a pill above her; the note's title is in the line's label and tooltip.
    function renderBar() {
      const bar = $('sbar');
      // B-211 (D-217): the session's bar is the pane header's, after its title, on every tab; the session folds to it.
      const mh = $('mh');
      if (bar.parentNode !== mh) mh.insertBefore(bar, $('status').nextSibling);
      renderSessCard();
      const s = activeSession();
      document.body.classList.toggle('in-session', !!s);
      if (!s) {
        CORE.setRing(-1);
        if (!bar.hidden) {
          bar.hidden = true;
          bar.replaceChildren();
          bar.dataset.k = '';
        }
        return;
      }
      const st = E.sessionState(s, now());
      const ending = s.status === 'ending';
      const k = [s.id, s.status, st.onBreak, !!SS.busy].join('|');
      bar.hidden = false;
      bar.classList.toggle('brk', st.onBreak);
      bar.classList.toggle('busy', SS.busy === true || SS.thinking || ending);
      bar.classList.toggle('alert', Date.now() < (SS.alertUntil || 0));
      if (bar.dataset.k !== k) {
        // buttons change with the state; the clock line and the ring update in place every second
        bar.dataset.k = k;
        const led = el('span', 's-led');
        led.setAttribute('aria-hidden', 'true');
        const main = el('span', 's-main');
        main.append(el('span', 's-clock', ''));
        bar.setAttribute('aria-label', 'Study session: ' + (s.topic || 'untitled'));
        bar.title = s.topic || '';
        const acts = el('div', 's-acts');
        acts.append(...sessButtons(s, st, ending));
        bar.replaceChildren(led, main, acts);
      }
      if (COMMENT) {
        // B-88: she reads along; the ring sweeps toward the next check (B-273)
        bar.querySelector('.s-clock').textContent = ending
          ? 'Wrapping up…'
          : SS.busy === true
            ? 'Writing your quiz…'
            : st.onBreak
              ? `On a break · ${minsLeft(st)} min left`
              : `${minsLeft(st) ?? st.minutes} min${minsLeft(st) == null ? '' : ' left'} · ${SS.thinking ? 'thinking about that line' : 'reading along'}`;
        CORE.setRing(ringFill(st, ending));
        return;
      }
      bar.querySelector('.s-clock').textContent = ending
        ? 'Wrapping up…'
        : SS.busy
          ? 'Reading your note…'
          : st.onBreak
            ? `On a break · ${tickClock(st.breakRemainingMs)} to the check`
            : `${tickClock(Date.parse(st.nextCheckAt) - Date.now())} left to the check`;
      CORE.setRing(ringFill(st, ending));
    }
    // B-290 (D-245): the session in E.V.'s right panel, shown from 1200 px (CSS), where the header's line gives way to
    // it on her view so the minutes show once. Idle, it starts a session on his Study Watch note (the chip's call);
    // running, it shows the session's state, the minutes left to her next check, and Break, +5 min and End.
    // B-290: the minutes left, the one figure the header's line and the card both show: to her next check, or of the
    // break; null when the session has no next check.
    function minsLeft(st) {
      const m = ms => Math.max(0, Math.ceil(ms / 60e3));
      if (st.onBreak) return m(st.breakRemainingMs);
      const next = Date.parse(st.nextCheckAt);
      return Number.isFinite(next) ? m(next - Date.now()) : null;
    }
    function renderSessCard() {
      let card = $('ev-sess');
      if (!card) {
        card = el('section', 'card ev-sess rest');
        card.id = 'ev-sess';
        capSide.append(card);
      }
      const s = activeSession();
      if (!s) {
        if (card.dataset.k === 'idle') return;
        card.dataset.k = 'idle';
        card.setAttribute('aria-label', 'Start a study session');
        const go = btn('Start study session', () => guard(go, () => quick('Start a study session')), {
          cls: 'btn neutral sm wide',
        });
        go.insertAdjacentHTML('afterbegin', PLAY_ICON);
        card.replaceChildren(
          el('h2', null, 'Start a study session'),
          el('p', 'ss-topic', 'Your Study Watch note'),
          el('p', 'meta', 'Its latest line in ' + E.courses().join(' or ') + ', read when you start.'),
          go
        );
        return;
      }
      const st = E.sessionState(s, now());
      const ending = s.status === 'ending';
      const k = [s.id, s.status, st.onBreak, !!SS.busy].join('|');
      if (card.dataset.k !== k) {
        card.dataset.k = k;
        card.setAttribute('aria-label', 'Study session: ' + (s.topic || 'untitled'));
        const head = el('div', 'card-head');
        head.append(
          el('h2', null, 'Study session'),
          el(
            'span',
            'badge ' + (ending ? '' : st.onBreak ? 'x-yellow' : 'x-green'),
            ending ? 'Ending' : st.onBreak ? 'On a break' : 'Running'
          )
        );
        const acts = el('div', 'ss-acts');
        acts.append(...sessButtons(s, st, ending, { cls: 'btn neutral sm', long: true }));
        card.replaceChildren(
          head,
          el('p', 'ss-topic', s.topic || 'Your Study Watch note'),
          el('p', 'ss-left'),
          el('p', 'meta ss-sub'),
          acts
        );
      }
      const left = minsLeft(st);
      card.querySelector('.ss-left').textContent = ending
        ? 'Wrapping up'
        : left == null
          ? st.minutes + ' min'
          : left + ' min left';
      card.querySelector('.ss-sub').textContent = ending
        ? st.minutes + ' min in'
        : (st.onBreak ? 'on the break' : COMMENT ? 'until she reads along again' : 'to the next check') +
          ' · ' +
          st.minutes +
          ' min in';
    }
    // B-273 (D-267, Matt's answer): her ring is the stretch to the next check. Her segments fill clockwise toward it and
    // start over after it; the checks he answered show on their cards (D-217). The ring is full while she wraps up.
    function ringFill(st, ending) {
      return ending ? 1 : st.toCheck;
    }
    function sessionTick() {
      const sk = activeSkill(); // B-82: a skills run left alone for the conversation idle gap ends itself, saved as left unfinished
      if (sk && !SK.ending && E.skillIdle(sk, now())) {
        SK.ending = true;
        finishSkill(sk, 'idle')
          .catch(() => {})
          .finally(() => {
            SK.ending = false;
          });
      }
      if (!FILE.opened && M && mcp && loaded.has('sessions')) {
        FILE.opened = true;
        fileSessions({ quiet: true })
          .then(r => {
            if (r) evSay(r.text, r.cards, { tier: 'local' });
          })
          .catch(() => {
            FILE.quiet = FILE.quiet || { ok: false };
          })
          .finally(regreet);
      }
      const s = activeSession();
      renderBar();
      renderNotes();
      if (!s || !M || SS.busy) return;
      if (SS.readerOk === false && Date.now() > SS.reprobeAt) {
        SS.reprobeAt = Date.now() + 30e3;
        SS.readerOk = null;
      } // B-87: a failed probe is retried
      if (SS.readerOk == null) probeReader();
      if (s.status !== 'active') return;
      const st = E.sessionState(s, now());
      // B-87: the view in front of him takes the session over as soon as its reader answers (a reload or a reopened tab
      // used to wait two minutes past a due check, the clock at 0:00).
      if (
        SS.readerOk === true &&
        SS.mayClaim &&
        document.visibilityState !== 'hidden' &&
        (!s.driver || s.driver.view !== SS.view)
      ) {
        SS.mayClaim = false;
        write({ op: 'update', collection: 'sessions', id: s.id, data: { driver: { view: SS.view, at: now() } } }).catch(
          () => {
            SS.mayClaim = true;
          }
        );
        return;
      }
      const mine =
        (s.driver && s.driver.view === SS.view) ||
        (SS.readerOk === true && (!s.driver || st.overdueMs > (SWC.takeoverMinutes || 2) * 60e3));
      if (!mine) return;
      if (st.shouldWrap) {
        endSession('idle')
          .then(([t, c]) => evSay(t, c, { tier: 'local' }))
          .catch(e => toast('Couldn’t wrap up: ' + ((e && (e.message || e.code)) || 'error')));
        return;
      }
      if (st.due) {
        if (COMMENT) runCheckpoint(s);
        else runCheck(s);
        return;
      }
      if (COMMENT && !st.onBreak) readTick(s);
    }
    setInterval(sessionTick, 1000);

