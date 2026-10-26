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
    // B-406 (D-325): a session from Notes (a new note, or Study with E.V. on one) or from a Today task is timed: it runs
    // its planned minutes, its controls are in the strip, and its lines are its own chat in the pop-up (a thread named
    // for the session), never the Conversation's.
    const NOTE_MINUTES = 25;
    const WIDE_STRIP = window.matchMedia ? window.matchMedia('(min-width:1024px)') : { matches: true };
    const isTimed = s => !!(s && Number(s.planned) > 0);
    const sThread = s =>
      'th-' +
      String(s.id)
        .replace(/[^A-Za-z0-9-]/g, '-')
        .slice(0, 77);
    const thOf = s => (isTimed(s) ? { thread: sThread(s) } : {});
    const noteOfSession = s => (s && /^notes\//.test(String(s.note || '')) ? String(s.note).slice(6) : null);
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
    // B-314 (D-298): with no Study Watch reader offered (no mcp, as in the app) a session starts with no note: it keeps
    // time, breaks and +5, and its checks and Quiz me now ask about his objectives and weak spots instead of a note.
    const NOT_OFFERED = ['server_not_connected', 'mcp_unavailable', 'capability_disabled', 'not_granted'];
    const noteless = s => !!s && !s.noteId;
    const noteLabel = t => String(t || '').replace(/\.(md|markdown|txt|rtf)$/i, ''); // B-383: a note's name as its title
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
      const bare = !mcp || !READER.host; // B-314: no reader offered (the app has no mcp), so the session reads no note
      let p = null;
      if (!bare)
        try {
          p = await readerCall('latest_note');
        } catch (e) {
          SS.readerOk = false;
          return [readerCopy((e && e.code) || 'upstream_error', e && e.message), []];
        }
      if (!bare && !p.found)
        return [
          p.refused
            ? 'Study Watch’s latest note isn’t in ' +
              E.courses().join(' or ') +
              ', so I won’t read it. Type a line in a school note, then start again.'
            : 'Study Watch hasn’t saved a school note yet. Check that it’s running in reader mode, type a line in your NUR 112 or BIO 201 note, then start again.',
          [],
        ];
      const n = bare ? { id: '', name: 'Study session', folder: '' } : p.note || {};
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
            [pageKey(at)]: bare
              ? { type: 'start' }
              : { type: 'start', noteId: n.id, len: mark.len, h: mark.h, modifiedAt: n.modifiedAt || null },
          },
        },
      });
      SS.text = bare ? null : n.text || '';
      SS.added = '';
      SS.said.clear();
      SS.seen = SS.text;
      SS.note = bare ? null : { id: n.id, name: n.name, folder: n.folder || '', title: n.title || '' };
      SS.nextRead = Date.now() + (SWC.readSeconds || 30) * 1e3;
      SS.changedAt = Date.now();
      if (bare)
        return [
          COMMENT
            ? 'Session started. I’ll keep time; tap Quiz me now whenever you want questions on your objectives and weak spots.'
            : `Session started. Every ${SWC.checkMinutes || 7} minutes I’ll post questions on your objectives and weak spots.`,
          [],
        ];
      if (COMMENT)
        return [
          `Session started on **${n.name}**. I’m reading along as you write and I’ll only chime in when a line makes a connection. Tap Quiz me now whenever you want questions.`,
          [],
        ];
      return [
        `Session started on **${n.name}**. I’ll check your new writing every ${SWC.checkMinutes || 7} minutes and post the questions here.`,
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
          await evSay(say, [], { tier: 'local', ...thOf(s) });
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
        const bare = noteless(s);
        let p;
        if (bare) {
          // B-314: no note; the check asks about his record (objectives and weak spots) in the note's place
          const ctx = sessCtx();
          if (!ctx.text) {
            await skip(
              'no-material',
              'I don’t have objectives or weak spots to ask about yet. The session keeps time.'
            );
            return;
          }
          p = { found: true, note: { id: '', name: s.topic || 'Study session', text: ctx.text } };
        } else
          try {
            p = await sessionNote(s); // B-406: a Notes session reads its own note, never the reader
          } catch (e) {
            const code = (e && e.code) || 'upstream_error';
            if (NOT_OFFERED.includes(code)) SS.readerOk = false;
            await skip('reader-' + code, readerCopy(code, e && e.message));
            return;
          }
        if (!p.found) {
          await skip('no-note', 'I can’t see a saved school note right now. Is Study Watch running in reader mode?');
          return;
        }
        const note = p.note || {};
        const base = quiz ? st.lastQuizMark : st.lastMark;
        const mark = base && base.noteId === note.id ? base : null;
        const text = String(note.text || '');
        let d = bare ? { added: text, same: false, rewritten: false } : E.noteDelta(text, mark);
        if (d.same && quiz) d = { added: text.slice(-(SWC.fallbackChars || 2500)), same: false, rewritten: true }; // Quiz me now on an unchanged note: the note so far
        if (d.same) {
          await sessEvent(s, 'idle');
          return;
        }
        const msg = msgId('e');
        const m2 = E.noteMark(text);
        const switched = st.lastMark && st.lastMark.noteId && st.lastMark.noteId !== note.id;
        const pargs = bare
          ? { noteName: note.name, text: '', added: '', n, context: sessCtx(), rewritten: false } // his record goes in as labelled data
          : { noteName: note.name, text, added: d.added, n, context: sessCtx(), rewritten: d.rewritten };
        // B-75 (D-133): the formats alternate from multiple choice; an open check whose note gives no two grounded key
        // points, or whose item fails its check function, falls back to multiple choice and is stored as one.
        if (!bare && E.checkFormat(s, now()) === 'open') {
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
              ...thOf(s),
            });
            sessPing(s, true);
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
          text: bare
            ? `${count} on your objectives and weak spots.`
            : `${count} on what you just wrote${switched ? ' in **' + note.name + '**' : ''}.`,
          cards: [{ type: 'check', session: s.id, n, items }],
          at: now(),
          tier: 'quick',
          ...thOf(s),
        });
        sessPing(s, true);
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
        if (!bare) {
          SS.text = text;
          SS.added = d.added;
        }
        SS.alertUntil = Date.now() + 4500;
        chime();
        if (!bare && SS.seen != null && text.startsWith(SS.seen)) SS.seen = text;
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
      if (noteless(s)) return;
      if (SS.reading || SS.busy || Date.now() < SS.nextRead) return;
      SS.reading = true;
      SS.nextRead = Date.now() + (SWC.readSeconds || 30) * 1e3;
      try {
        let p;
        try {
          p = await sessionNote(s);
        } catch {
          return;
        }
        if (!p || !p.found) return;
        const note = p.note || {};
        const text = String(note.text || '');
        const prev = SS.text;
        SS.text = text;
        SS.note = { id: note.id, name: note.name, folder: note.folder || '', title: note.title || '' };
        if (prev !== text) SS.changedAt = Date.now();

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
        await postMsg({ id, role: 'ev', text: c.say, at: now(), tier: 'quick', ...thOf(s) });
        sessPing(s, false);
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
      if (noteless(s)) {
        // B-314: comment mode reads a note at its checkpoints; with none, the checkpoint only moves the clock on
        SS.busy = 'quiet';
        try {
          await sessEvent(s, 'skip', { why: 'no-note' });
        } finally {
          SS.busy = false;
        }
        return;
      }
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
          p = await sessionNote(s);
        } catch (e) {
          const code = (e && e.code) || 'upstream_error';
          if (['server_not_connected', 'mcp_unavailable', 'capability_disabled', 'not_granted'].includes(code))
            SS.readerOk = false;
          await sessEvent(s, 'skip', { why: 'reader-' + code });
          if (!SS.said.has('reader-' + code)) {
            SS.said.add('reader-' + code);
            await evSay(readerCopy(code, e && e.message), [], { tier: 'local', ...thOf(s) });
          }
          return;
        }
        if (!p.found) {
          await sessEvent(s, 'skip', { why: 'no-note' });
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
    // B-362 (D-316): the demo shows no Reading line above the field and no Your notes card beside her (#sread stays
    // hidden from the shell); she still reads along (SS.text), and the session's own line and card say what it is on.

    function sessionTranscript(s) {
      // B-406: a Notes session's lines are its own chat (its thread); the Conversation's session, the lines since it began
      return (isTimed(s) ? everyMsg().filter(m => m.thread === sThread(s)) : allMsgs())
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
    // The summary from Claude (when the session had checks, comments or reads) and the close's writes: one session
    // update and its findings. B-406: also files a session a switch ended once its Undo has passed.
    async function fileSession(s2, reason) {
      const st = E.sessionState(s2, now());
      let wrap = {};
      let note = '';
      if ((st.checks || st.comments || st.reads) && sample && !T.sampleOff) {
        try {
          wrap =
            (await sample.json(
              E.wrapPrompt({
                noteName: s2.topic,
                transcript: sessionTranscript(s2),
                context: sessCtx(),
                opening: SS.text && activeSession() && activeSession().id === s2.id ? SS.text.slice(0, 800) : '',
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
        ideas: S.ideas || [],
        now: now(),
        endedBy: reason,
      });
      await run(withDerived(r.writes));
      return { up: r.writes[0].data, st, r, note };
    }
    function savedBits(up, st) {
      return [
        `${up.minutes} min`,
        ...(COMMENT
          ? [st.comments ? plural(st.comments, 'comment') : '', up.questions ? plural(up.questions, 'question') : '']
          : [plural(up.checks, 'check')]),
        up.weakSpots.length ? plural(up.weakSpots.length, 'weak spot') : '',
        up.cardCount ? plural(up.cardCount, 'card') : '',
      ]
        .filter(Boolean)
        .join(', ');
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
        const { up, st, r, note } = await fileSession(s2, reason);
        SS.text = null;
        SS.added = '';
        SS.seen = null;
        SS.note = null;
        const lead =
          reason === 'idle' ? 'No new writing for a while, so I wrapped up. ' : reason === 'time' ? 'Time. ' : '';
        return [
          `${lead}Session saved: ${savedBits(up, st)}.${r.questions.length ? ' One thing to settle on the card.' : ''}${note}`,
          // B-377 (D-316): as the demo, her one line and Open in Record; the summary card only when a question waits on him
          r.questions.length
            ? [{ type: 'session', id: s.id }]
            : [{ type: 'go', label: 'Open in Record', to: 'record', id: s.id }],
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
    // B-377 (D-316): Break and Resume, from the session's buttons or the break's chip, answer with her line in the thread
    async function breakOrResume(type) {
      const cur = activeSession();
      const st = cur && E.sessionState(cur, now());
      const ok = st && (type === 'break' ? !st.onBreak : st.onBreak);
      const r = await sessionCmd(type);
      await evSay(
        !ok
          ? r
          : type === 'break'
            ? 'Five-minute break. No checks until you’re back, and breaks don’t count as study time.'
            : 'Back to it. Checks resume.',
        [],
        { tier: 'local', ...thOf(cur) }
      );
    }
    async function decideSession(s, key, decision) {
      await run(
        withDerived(
          E.decideSessionQuestion(s, key, decision, {
            weakspots: M.models,
            objectives: S.objectives,
            ideas: S.ideas || [],
            now: now(),
          })
        )
      );
    }
    function noteAnswer(mid, th) {
      // a message he sends during a session answers the newest check he hasn't answered yet; B-406: a Notes session's
      // check is answered in its own chat, the Conversation's in the Conversation
      const s = activeSession();
      if (!s || s.status !== 'active') return;
      if ((th || null) !== (isTimed(s) ? sThread(s) : null)) return;
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
        // B-377 (D-316): as the demo, Break and Resume are her line in the thread, not a toast; +5 min only moves the time
        out.push(mk(st.onBreak ? 'Resume' : 'Break', () => breakOrResume(st.onBreak ? 'resume' : 'break')));
        // B-362 (D-316): the panel's card has +5 min in every mode, as the demo; the header's line keeps Break and End
        if (!COMMENT || o.long) {
          const ext = mk(o.long ? '+5 min' : '+5', async () => {
            const r = await sessionCmd('extend');
            if (!/^Next check moved/.test(r)) toast(r);
          });
          ext.setAttribute('aria-label', 'Add 5 minutes before the next check');
          out.push(ext);
        }
      }
      const end = mk(ending ? 'Finish' : 'End', async () => {
        const [t, c] = await endSession('ended');
        await evSay(t, c, { tier: 'local', ...thOf(s) });
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
      renderSlot(); // B-406: a Notes session's controls are the strip's on desktop
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
      if (isTimed(s) && WIDE_STRIP.matches) {
        // B-406: on desktop a Notes session shows once, in the strip; the header's line stays for the phone
        CORE.setRing(ringFill(st, ending));
        if (!bar.hidden) {
          bar.hidden = true;
          bar.replaceChildren();
          bar.dataset.k = '';
        }
        return;
      }
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
        // B-353 (D-314): the topic and her reading-along words, each its own span: under 600 px (and on her view under
        // 1200 px) the line is the demo's strip under the header, the topic in bold, the minutes, Break and End.
        main.append(
          el('b', 's-topic', noteLabel(s.topic) || 'Study session'),
          el('span', 's-clock', ''),
          el('span', 's-read', '')
        );
        bar.setAttribute('aria-label', 'Study session: ' + (s.topic || 'untitled'));
        bar.title = s.topic || '';
        const acts = el('div', 's-acts');
        acts.append(...sessButtons(s, st, ending, { cls: 'btn ghost sm' })); // B-303 (D-278): ghost, the header's quiet measure
        bar.replaceChildren(led, main, acts);
      }
      if (COMMENT) {
        // B-88: she reads along; the ring sweeps toward the next check (B-273)
        bar.querySelector('.s-clock').textContent = ending
          ? 'Wrapping up…'
          : SS.busy === true
            ? 'Writing your quiz…'
            : st.onBreak
              ? breakLeft(s) // B-377: the demo's 5 min break
              : `${minsLeft(st) ?? st.minutes} min${minsLeft(st) == null ? '' : ' to next check'}`; // B-383: what it counts
        bar.querySelector('.s-read').textContent = ''; // B-362 (D-316): the demo's line is the topic and the minutes
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
    // B-377 (D-316): a break reads as the demo's 5 min break, counting down from when it started; a break has no end of
    // its own (he resumes), so past five minutes it reads Break’s over.
    const BREAK_MIN = 5;
    function breakLeft(s) {
      const since = Math.max(
        0,
        ...Object.values(s.events || {})
          .filter(e => e && e.type === 'break' && e.at)
          .map(e => Date.parse(e.at) || 0)
      );
      const m = Math.ceil((BREAK_MIN * 60e3 - (Date.now() - since)) / 60e3);
      return since && m <= 0 ? 'Break’s over' : Math.min(BREAK_MIN, Math.max(1, m)) + ' min break';
    }
    // B-383: when Study Watch saved the note, as the demo's 'saved 4:10 pm'; an older save names its day
    function savedWhen(at) {
      const d = new Date(at);
      if (isNaN(d)) return '';
      const ymd = E.chicagoDate(at);
      const day =
        !ymd || ymd === today
          ? ''
          : new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }) + ' ';
      return day + clock12(at);
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
        const offered = !!(mcp && READER.host); // B-314: with no reader the session reads no note
        // B-383 (D-316): as the demo, the card names the note before Start: the reader's status (its name and when
        // Study Watch saved it, never its text), read once per page load
        if (offered && SS.noteHead === undefined) {
          SS.noteHead = null;
          readerCall('status')
            .then(p => {
              const n = p && p.latestNote;
              SS.noteHead = n && n.found && n.name ? { name: String(n.name), at: n.modifiedAt || null } : false;
            })
            .catch(() => (SS.noteHead = false))
            .finally(() => renderSessCard());
        }
        const nh = offered && SS.noteHead ? SS.noteHead : null;
        const idleK = 'idle' + offered + (nh ? nh.name + nh.at : '');
        if (card.dataset.k === idleK) return;
        card.dataset.k = idleK;
        card.setAttribute('aria-label', 'Start a study session');
        // B-377 (D-316): as the demo, the panel's button starts the session with her line only, never his
        const go = btn(
          'Start study session',
          () =>
            guard(go, async () => {
              T.bigCore = false;
              const [t, c] = await startSession();
              await evSay(t, c, { tier: 'local' });
            }),
          {
            cls: 'btn primary wide', // B-340 (D-312): the panel's main button, in Ember as in the demo
          }
        );
        go.insertAdjacentHTML('afterbegin', PLAY_ICON);
        card.replaceChildren(
          el('h2', null, 'Start a study session'),
          ...(offered
            ? [
                el('p', 'ss-topic', nh ? noteLabel(nh.name) : 'Your Study Watch note'),
                el(
                  'p',
                  'meta',
                  (nh
                    ? 'Your Study Watch note' + (nh.at ? ' · saved ' + savedWhen(nh.at) : '')
                    : 'Your latest note in ' + E.courses().join(' or ')) +
                    ' · checks every ' +
                    (SWC.checkMinutes || 7) +
                    ' min'
                ),
              ]
            : [el('p', 'meta', 'A timer and breaks, with questions on your objectives and weak spots.')]),
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
          el('span', 'badge x-quiet', ending ? 'Ending' : st.onBreak ? 'Break' : 'Running') // B-362, B-377: the demo's grey-filled quiet badge
        );
        const acts = el('div', 'ss-acts');
        acts.append(...sessButtons(s, st, ending, { cls: 'btn neutral sm', long: true }));
        card.replaceChildren(
          head,
          el('p', 'ss-topic', noteLabel(s.topic) || 'Your Study Watch note'),
          el('p', 'ss-left'),
          el('p', 'meta ss-sub'),
          acts
        );
      }
      const left = minsLeft(st);
      // B-383: the big figure says what it counts, '7 min' then 'to my next check' under it
      const leftEl = card.querySelector('.ss-left');
      const leftK = ending
        ? 'Wrapping up'
        : st.onBreak
          ? breakLeft(s)
          : left == null
            ? durFmt(st.minutes)
            : left + ' min';
      if (leftEl.dataset.k !== leftK) {
        leftEl.dataset.k = leftK;
        leftEl.replaceChildren(leftK);
        if (!ending && !st.onBreak && left != null) leftEl.append(el('span', 'ss-what', 'to my next check'));
      }
      // B-362, B-368 (D-316): as the demo, '<what> · N min': where the session's words come from and its minutes (a
      // session has no planned length, so N is how long it has run)
      card.querySelector('.ss-sub').textContent =
        (isTimed(s)
          ? noteOfSession(s)
            ? 'In Notes'
            : 'A task from Today'
          : noteless(s)
            ? 'Study session'
            : 'Your Study Watch note') +
        ' · ' +
        Math.max(1, st.minutes) +
        ' min';
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
      if (M && loaded.has('sessions')) switchTick(); // B-406: a switch's Undo runs out, then its session is filed
      if (!s || !M || SS.busy) return;
      if (SS.readerOk === false && Date.now() > SS.reprobeAt) {
        SS.reprobeAt = Date.now() + 30e3;
        SS.readerOk = null;
      } // B-87: a failed probe is retried
      if (SS.readerOk == null && !noteless(s) && !noteOfSession(s)) probeReader();
      if (s.status !== 'active') return;
      const st = E.sessionState(s, now());
      // B-87: the view in front of him takes the session over as soon as its reader answers (a reload or a reopened tab
      // used to wait two minutes past a due check, the clock at 0:00).
      // B-314: a session with no note needs no reader to be driven; B-406: nor does one on a note in Notes
      const free = SS.readerOk === true || noteless(s) || !!noteOfSession(s);
      if (free && SS.mayClaim && document.visibilityState !== 'hidden' && (!s.driver || s.driver.view !== SS.view)) {
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
        (free && (!s.driver || st.overdueMs > (SWC.takeoverMinutes || 2) * 60e3));
      if (!mine) return;
      if (isTimed(s) && (st.timeUp || breakOver(s, st))) {
        timedTick(s, st);
        return;
      }
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
    // ---------------------------------------------------------------- B-406 (D-325): study sessions in Notes
    // A new note starts a 25-minute session on it; Study with E.V. starts one on a note he has; a Today task starts one
    // (a study task on a new note, any other task a timed session of its own). Starting one while another runs ends
    // the running one first and offers Undo in the strip for UNDO_MS: Undo marks the new session discarded and the
    // ended one active again (core undoSwitch), and puts back the open note, the tab and the chat. Nothing is deleted.
    // The ended session is filed (summary, findings, minutes) only once Undo is no longer offered, so an Undo never takes
    // back a write-once field or a finding; a page closed before then files it on the next load.
    const UNDO_MS = 12000;
    SS.undo = null;
    SS.filing = new Set();
    // The note a Notes session reads: the open note as he is writing it, else as saved. Its text goes to Claude
    // through sample() at a check (D-328); the record keeps its length and hash only.
    async function sessionNote(s) {
      const id = noteOfSession(s);
      if (!id) return readerCall('latest_note');
      const open = NOTE.open === id && NOTE.blocks;
      const doc = (S.notes || []).find(n => n.id === id) || null;
      const blocks = open ? NOTE.blocks : doc ? E.noteBlocks(doc.blocks || []) : null;
      if (!blocks) return { found: false };
      return {
        found: true,
        note: {
          id,
          name: E.noteTitleOf(blocks) || 'Untitled',
          text: blocks.map(b => E.noteText(b)).join('\n'),
          modifiedAt: (doc && doc.editedAt) || null,
        },
      };
    }
    // What a session is on, as the strip names it: a note's title as it is now (a new note's grows as he writes)
    function sessName(s) {
      const id = noteOfSession(s);
      if (!id) return noteLabel(s && s.topic) || 'Study session';
      const blocks =
        NOTE.open === id && NOTE.blocks ? NOTE.blocks : ((S.notes || []).find(n => n.id === id) || {}).blocks;
      return (blocks && E.noteTitleOf(E.noteBlocks(blocks))) || s.topic || 'New note';
    }
    // the pop-up's state (90-render.js) once the page's parts are all declared
    const popReady = () => {
      try {
        return !!POP && !!F.strip;
      } catch {
        return false;
      }
    };
    const notesOn = () => typeof notesTab !== 'undefined' && !!notesTab && !notesTab.hidden;
    // A line of hers in a Notes session's chat brings the chat up: a check opens the pop-up (without taking the focus
    // from his note), a comment shows as its chip. On Conversation the chip waits.
    function sessPing(s, open) {
      if (!isTimed(s) || !popReady() || !DESK.matches) return;
      POP.th = sThread(s);
      if (open && ui.tab !== 'ev') {
        POP.open = true;
        POP.min = false;
        POP.hist = false;
      } else if (!POP.open) POP.min = true;
      popSave();
      renderFrame();
    }
    /** Starts a timed session; a running one is ended first (the switch), with Undo offered in the strip. */
    // Where he was before a session started, for its Undo: the view and the note open in Notes
    const whereNow = () => ({ tab: ui.tab, note: ui.tab === 'notes' && NOTE.view === 'editor' ? NOTE.open : null });
    async function startTimed({ noteId = '', topic, planned = NOTE_MINUTES, fresh = false, say, from = whereNow() }) {
      unlockAudio();
      const cur = activeSession();
      const at = now();
      let prior = null;
      if (cur) {
        prior = {
          prev: cur.id,
          name: sessName(cur),
          mins: E.sessionState(cur, at).minutes,
          ...from,
          th: popReady() ? POP.th : null,
          open: popReady() && POP.open,
          min: popReady() && POP.min,
          next: null,
          until: Date.now() + 60e3, // held while the new session is written, so the ended one isn't filed meanwhile
        };
        SS.undo = prior;
        await run(E.switchSession(cur, { at, key: pageKey(at) }));
      }
      const stamp = at.replace(/\D/g, '').slice(0, 14);
      let id = E.safeId(`ss-${stamp.slice(0, 8)}-${stamp.slice(8)}-${E.slug(topic || 'note', 24)}`);
      if (sessOf(id)) id = E.safeId(id + '-2');
      const k = pageKey(at);
      try {
        await write(
          E.startTimedSession({
            id,
            at,
            key: k,
            date: today,
            topic,
            planned,
            noteId,
            fresh,
            comments: lastComments(),
            view: SS.view,
          })
        );
      } catch (e) {
        // the new session wasn't saved: the one it ended goes on as it was
        if (prior) {
          SS.undo = null;
          const t = now();
          await run(E.undoSwitch(sessOf(prior.prev), null, { at: t, keys: [pageKey(t), pageKey(t)] })).catch(() => {});
        }
        throw e;
      }
      SS.text = null;
      SS.added = '';
      SS.said.clear();
      SS.seen = null;
      SS.note = null;
      SS.nextRead = Date.now() + (SWC.readSeconds || 30) * 1e3;
      SS.changedAt = Date.now();
      SS.undo = prior ? { ...prior, next: id, until: Date.now() + UNDO_MS } : null;
      if (popReady()) {
        POP.th = sThread({ id }); // the pop-up's chat is the session's now; the one he had stays in history
        if (POP.open && !POP.hist) POP.open = false;
        POP.min = false;
        popSave();
      }
      await evSay(say, [], { tier: 'local', thread: sThread({ id }) });
      render();
      return id;
    }
    /** New note (fresh) or Study with E.V. on a note he has: a 25-minute session on it, the note open in Notes. */
    async function noteSession(id, fresh = false, from = whereNow()) {
      const cur = activeSession();
      if (cur && noteOfSession(cur) === id) {
        if (ui.tab !== 'notes') showTab('notes');
        if (NOTE.open !== id || NOTE.view !== 'editor') await openNote(id);
        return;
      }
      if (!fresh) {
        if (ui.tab !== 'notes') showTab('notes');
        if (NOTE.open !== id || NOTE.view !== 'editor') await openNote(id);
        if (NOTE.open !== id) return; // the open note couldn't be saved, so it stays open and nothing starts
      }
      const doc = (S.notes || []).find(n => n.id === id);
      const name = fresh ? 'New note' : noteName(doc);
      await startTimed({
        noteId: id,
        topic: name,
        fresh,
        from,
        say: fresh
          ? `Started ${NOTE_MINUTES} minutes on your new note. I’ll follow along as you write.`
          : `Started ${NOTE_MINUTES} minutes on “${name}”. I’ll follow along as you read and write.`,
      });
    }
    // B-403's preview: Study with E.V. opens the note, then asks for the session on it
    document.addEventListener('ev:note-study', e => {
      const id = e && e.detail && e.detail.id;
      if (id) guard(null, () => noteSession(id));
    });
    /**
     * A Today task's Start where Notes is (desktop): a study task opens a new note with its session (or the note a
     * session already runs on); any other task gets a timed session of its own, its estimate long. Null elsewhere, so
     * the phone keeps the Conversation's session.
     */
    function taskStudy(it) {
      if (!notesOn()) return null;
      return () =>
        guard(null, async () => {
          const cur = activeSession();
          const from = whereNow();
          if (catOf(it) === 'study') {
            if (cur && noteOfSession(cur)) return noteSession(noteOfSession(cur));
            showTab('notes');
            return newNote(from);
          }
          const name = E.rowText(it);
          const m = Math.max(1, Math.round(Number(it.minutes) || NOTE_MINUTES));
          await startTimed({
            topic: name,
            planned: m,
            from,
            say: `Started ${m} minutes on “${name}”. The clock is in the bar below.`,
          });
        });
    }
    async function undoSwitch() {
      const u = SS.undo;
      if (!u || Date.now() >= u.until) return;
      SS.undo = null;
      const at = now();
      await run(E.undoSwitch(sessOf(u.prev), sessOf(u.next), { at, keys: [pageKey(at), pageKey(at)] }));
      SS.text = null;
      SS.seen = null;
      SS.added = '';
      SS.note = null;
      SS.nextRead = Date.now() + (SWC.readSeconds || 30) * 1e3;
      // the open note, the view and the chat as they were: the restored session's note open again in Notes, or the
      // view he was on
      const prevNote = noteOfSession(sessOf(u.prev));
      if (prevNote && (S.notes || []).some(n => n.id === prevNote)) {
        if (ui.tab !== 'notes') showTab('notes');
        await openNote(prevNote);
      } else if (u.tab === 'notes') {
        if (ui.tab !== 'notes') showTab('notes');
        if (u.note) await openNote(u.note);
        else await closeNote();
      } else if (ui.tab !== u.tab) showTab(u.tab);
      if (popReady()) {
        POP.th = u.th;
        POP.open = !!u.open;
        POP.min = !!u.min && !u.open;
        POP.hist = false;
        popSave();
        renderFrame();
      }
      render();
    }
    // Each second: the switch's Undo runs out, then the ended session is filed; one a closed page left is filed here.
    function switchTick() {
      if (SS.undo && Date.now() >= SS.undo.until) SS.undo = null;
      for (const s of S.sessions) {
        if (SS.filing.has(s.id) || (SS.undo && SS.undo.prev === s.id) || !E.switchedUnfiled(s)) continue;
        if (s.source !== 'E.V. Home') continue;
        SS.filing.add(s.id); // once per page load, whatever happens
        fileSession(s, 'switched')
          .then(({ up, st, r, note }) =>
            evSay(
              `Saved “${sessName(s)}”: ${savedBits(up, st)}.${r.questions.length ? ' One thing to settle on the card.' : ''}${note}`,
              r.questions.length
                ? [{ type: 'session', id: s.id }]
                : [{ type: 'go', label: 'Open in Record', to: 'record', id: s.id }],
              { tier: 'local', ...thOf(s) }
            )
          )
          .catch(() => {});
      }
    }
    // A break in a Notes session is five minutes, as the demo's; then the clock goes on by itself.
    function breakOver(s, st) {
      return !!(st.onBreak && st.breakStartedAt && Date.now() - Date.parse(st.breakStartedAt) >= BREAK_MIN * 60e3);
    }
    function timedTick(s, st) {
      SS.busy = true;
      (async () => {
        try {
          if (st.timeUp) {
            SS.busy = false;
            const [t, c] = await endSession('time');
            await evSay(t, c, { tier: 'local', ...thOf(s) });
            sessPing(s, false); // her saved line waits as the chat's chip
            return;
          }
          await sessEvent(s, 'resume');
          const left = Math.ceil((E.sessionState(sessOf(s.id) || s, now()).leftMs || 0) / 60e3);
          await evSay(`Break’s over: ${plural(left, 'minute')} left.`, [], { tier: 'local', ...thOf(s) });
        } catch (e) {
          toast('Couldn’t update the session: ' + ((e && (e.message || e.code)) || 'error'));
        } finally {
          SS.busy = false;
          render();
        }
      })();
    }
    // The strip's session controls (D-327's L-frame): the time left, what it is on (opens it), Break or Resume, End;
    // after a switch, the ended session's line and Undo.
    const clockLeft = ms => {
      const t = Math.max(0, Math.ceil(ms / 1000));
      return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    };
    /** A Notes session's chat, as the pop-up names it: {title, sub, chip}; null for any other chat. */
    function sessThreadInfo(th) {
      if (!th || !/^th-ss-/.test(th)) return null;
      const s = S.sessions.find(x => isTimed(x) && sThread(x) === th);
      if (!s) return null;
      const name = sessName(s);
      let sub = 'Session ended · ' + name;
      if (s.status === 'active' || s.status === 'ending') {
        const st = E.sessionState(s, now());
        sub = (st.onBreak ? 'On a break' : clockLeft(st.leftMs) + ' left') + ' · ' + name;
      }
      return { title: 'Studying with E.V.', sub, chip: 'Studying: ' + name };
    }
    function renderSlot() {
      if (popReady() && POP.open && !POP.hist && F.sub) {
        const ss = sessThreadInfo(POP.th);
        if (ss && F.sub.textContent !== ss.sub) F.sub.textContent = ss.sub;
      }
      const slot = $('ev-sslot');
      if (!slot) return;
      const s0 = activeSession();
      const s = isTimed(s0) ? s0 : null;
      const u = SS.undo && Date.now() < SS.undo.until ? SS.undo : null;
      if (!s && !u) {
        if (slot.firstChild) slot.replaceChildren();
        slot.dataset.k = '';
        return;
      }
      const st = s ? E.sessionState(s, now()) : null;
      const ending = !!s && s.status === 'ending';
      const k = [s && s.id, s && s.status, st && st.onBreak, SS.busy === true, u && u.next].join('|');
      if (slot.dataset.k !== k) {
        slot.dataset.k = k;
        const kids = [];
        if (s) {
          const led = el('span', 's-led');
          led.setAttribute('aria-hidden', 'true');
          const go = el('button', 'nm tn');
          go.type = 'button';
          go.addEventListener('click', () => {
            const id = noteOfSession(s);
            if (id) noteSession(id).catch(() => {});
            else showTab('today');
          });
          const brk = btn(st.onBreak ? 'Resume' : 'Break', () =>
            barPress(brk, () => breakOrResume(st.onBreak ? 'resume' : 'break'))
          );
          brk.className = 'btn ghost sm s-brk';
          brk.disabled = ending;
          const end = btn('End', () =>
            barPress(end, async () => {
              const [t, c] = await endSession('ended');
              await evSay(t, c, { tier: 'local', ...thOf(s) });
              sessPing(s, false); // her saved line waits as the chat's chip
            })
          );
          end.className = 'btn ghost sm s-end';
          end.disabled = ending || SS.busy === true;
          end.setAttribute('aria-label', 'End the session');
          kids.push(led, el('b', 's-left'), el('span', 's-dot', '·'), go, brk, end);
        }
        if (u) {
          const un = btn('Undo', () => barPress(un, undoSwitch));
          un.className = 'btn neutral sm s-undo';
          un.setAttribute('aria-label', `Undo: go back to “${u.name}”`);
          kids.push(
            el('span', 's-ended', `Ended “${u.name}”: ${plural(Math.max(1, u.mins), 'minute')}, logged to Record.`),
            un
          );
        }
        slot.replaceChildren(...kids);
        slot.setAttribute('aria-label', s ? 'Study session: ' + sessName(s) : 'Session ended');
      }
      if (!s) return;
      slot.classList.toggle('brk', st.onBreak);
      const left = slot.querySelector('.s-left');
      const since = st.breakStartedAt ? Date.parse(st.breakStartedAt) : Date.now();
      left.textContent = ending
        ? 'Wrapping up…'
        : st.onBreak
          ? 'Break · ' + clockLeft(BREAK_MIN * 60e3 - (Date.now() - since))
          : clockLeft(st.leftMs) + ' left';
      const go = slot.querySelector('.tn');
      const nm = sessName(s);
      const name = noteOfSession(s) && nm === 'New note' ? 'your new note' : nm; // the demo's words for an empty one
      if (go.textContent !== name) {
        go.textContent = name;
        go.title = noteOfSession(s) ? 'Open the note: ' + name : 'Open Today: ' + name;
      }
    }

    setInterval(sessionTick, 1000);

