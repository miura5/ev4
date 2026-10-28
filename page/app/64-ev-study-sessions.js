    // ---------------------------------------------------------------- study sessions
    // B-408 (D-325): on desktop a session is in Notes (a note's session, or a Today task's); on the phone (no Notes) the
    // Conversation's session keeps time and asks about his objectives and weak spots. Study Watch and its reader are
    // retired from the page. Rules (timer, new-text diff, prompts, filing) live in E.V. core; a note's text goes to
    // Claude through sample at a check (D-328), and the session keeps only its length and hash.
    const SWC = (EV_SPEC.constants && EV_SPEC.constants.studyWatch) || {};
    const SS = {
      view: Math.random().toString(36).slice(2, 10),
      busy: false,
      text: null,
      added: '',
      said: new Set(),
      audio: null,
      // B-87: a view claims a running session it can drive (on open and each time the tab comes back).
      mayClaim: true,
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
    const isTimed = s => !!(s && (Number(s.planned) > 0 || s.clock === 'writing'));
    // B-438: a note's session counts the time he writes: paused after writingIdleMinutes with no typing, going again
    // at his next keystroke, whether she reads along or not
    const isWriting = s => !!(s && s.clock === 'writing');
    const WRITE_IDLE_MS = (SWC.writingIdleMinutes || 2) * 60e3;
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
        RA.nextRead = 0; // B-418: the open note's read-along reads at once too
      }
    });
    /** B-438: the note he is writing changed (25-notes' noteChanged): a writing session paused on it goes on. */
    function noteTyped(id) {
      SS.typedAt = Date.now();
      const s = activeSession();
      if (!s || s.status !== 'active' || !isWriting(s) || noteOfSession(s) !== id || SS.resuming) return;
      if (!E.sessionState(s, now()).paused) return;
      SS.resuming = true;
      sessEvent(s, 'write')
        .catch(() => {})
        .finally(() => {
          SS.resuming = false;
          render();
        });
    }
    /** B-438: the driving view pauses a writing session once nothing was typed for WRITE_IDLE_MS, at the last typing. */
    function writingTick(s, st) {
      if (!isWriting(s) || st.paused || st.onBreak || SS.pausing) return false;
      const doc = (S.notes || []).find(n => n.id === noteOfSession(s));
      const last = Math.max(
        SS.typedAt || 0,
        Date.parse((doc && doc.editedAt) || '') || 0,
        Date.parse(st.activeSince || '') || 0
      );
      if (!last || Date.now() - last < WRITE_IDLE_MS) return false;
      SS.pausing = true;
      sessEvent(s, 'pause', { from: new Date(last).toISOString() })
        .catch(() => {})
        .finally(() => {
          SS.pausing = false;
          render();
        });
      return true;
    }
    // B-314 (D-298): a session not on a note in Notes (the phone's, or a Today task's) reads no note: it keeps time,
    // breaks and +5, and its checks and Quiz me now ask about his objectives and weak spots instead.
    const noteless = s => !!s && !s.noteId;
    const noteLabel = t => String(t || '').replace(/\.(md|markdown|txt|rtf)$/i, ''); // B-383: a note's name as its title
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
      if (!sample || T.sampleOff)
        return [
          'Study sessions need permission to ask Claude for the checks. Allow Claude for this page from its Permissions menu.',
          [],
        ];
      // B-408 (D-325): on desktop a study session is in Notes: a new note with its 25-minute session (a running one is
      // ended first, with Undo in the strip); her line is in the session's own chat
      if (notesOn()) {
        const from = whereNow();
        showTab('notes');
        await newNote(from);
        return [null, []];
      }
      const cur = activeSession();
      if (cur)
        return [
          `A session on **${noteLabel(cur.topic) || 'Study session'}** is already running. End it from the bar at the top when you’re done.`,
          [],
        ];
      // The phone's session (no Notes under 1024 px): no note; it keeps time and asks about his objectives and weak spots
      const at = now();
      const stamp = at.replace(/\D/g, '').slice(0, 14);
      const id = E.safeId(`ss-${stamp.slice(0, 8)}-${stamp.slice(8)}-study-session`);
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
          topic: 'Study session',
          noteId: '',
          folder: '',
          driver: { view: SS.view, at },
          events: { [pageKey(at)]: { type: 'start' } },
        },
      });
      SS.text = null;
      SS.added = '';
      SS.said.clear();
      SS.seen = null;
      SS.note = null;
      SS.nextRead = Date.now() + (SWC.readSeconds || 30) * 1e3;
      SS.changedAt = Date.now();
      return [
        COMMENT
          ? 'Session started. I’ll keep time; tap Quiz me now whenever you want questions on your objectives and weak spots.'
          : `Session started. Every ${SWC.checkMinutes || 7} minutes I’ll post questions on your objectives and weak spots.`,
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
        } else p = await sessionNote(s); // B-406: a Notes session reads its own note
        if (!p.found) {
          await skip('no-note', 'I can’t see the note this session is on right now. The session keeps time.');
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
          code === 'ceiling' && e.message
            ? e.message + ' The session keeps time.' // B-418: the Worker's words
            : code === 'rate_limited'
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
    // B-418 (D-339): she reads along in the note he is writing by default, session or not, unless the note's toggle is
    // off. A session's note is read by readTick, the open note with no session on it by freeReadTick; both ask through
    // readAlong, whose rules are core's readAlongAsk (new text only, at most once per commentGapSeconds, none after
    // readAlongIdleMinutes with nothing written). In the app the ask carries the note's mark, and the Worker holds the
    // same text and gap limits and the hourly and daily token ceilings (pwa/claude.js).
    const readMark = (id, text) => {
      if (!(window.claude && window.claude.host === 'ev-app')) return {};
      const m = E.noteMark(text);
      return { read: { note: id, h: m.len + '-' + m.h } };
    };
    // the open note's own chat, for her lines on it when no session runs on it (derived, like a session's)
    const noteThread = id => 'th-' + ('note-' + String(id)).replace(/[^A-Za-z0-9-]/g, '-').slice(0, 77);
    async function readAlong(st, note, s) {
      if (!readAlongOn(note.id)) {
        st.seen = null; // off: what he writes meanwhile is never read; turned back on, reading starts from there
        return;
      }
      const text = String(note.text || '');
      const prev = st.text;
      st.text = text;
      if (prev !== text) st.changedAt = Date.now();
      const a = E.readAlongAsk({
        text,
        seen: st.seen,
        typing: prev !== text, // still typing: complete lines only
        changedAt: st.changedAt || 0,
        lastAsk: st.lastAsk || 0,
        now: Date.now(),
      });
      if (a.why === 'first') st.seen = a.seen; // opened mid-way: what is already written counts as read
      if (!a.ask || !sample || T.sampleOff) return;
      st.lastAsk = Date.now();
      if (s) {
        SS.thinking = true;
        renderSession();
      }
      let out;
      try {
        out = await sample.json(
          E.commentPrompt({
            noteName: note.name,
            opening: text.slice(0, SWC.openingChars || 800),
            before: a.before,
            added: a.added,
            context: sessCtx(),
          }),
          { modelTier: 'quick', cache: false, ...readMark(note.id, text) }
        );
      } catch (e) {
        const code = (e && e.code) || 'error';
        if (HIDE.has(code)) T.sampleOff = code;
        if (code === 'unchanged') st.seen = a.seenNext; // another view already read this text
        if (code === 'rate_limited') st.lastAsk = Date.now() + 10 * 60e3;
        if (code === 'ceiling') {
          // B-430: no reads until the ceiling resets (the gate opens a gap after lastAsk), and its words said once
          const until = Number(e.until) > Date.now() ? Number(e.until) : Date.now() + 10 * 60e3;
          st.lastAsk = until - (SWC.commentGapSeconds || 75) * 1e3;
          const key = (e.scope || 'ceiling') + '@' + until;
          if (e.message && T.ceilingSaid !== key) {
            T.ceilingSaid = key;
            toast(e.message); // the Worker's own words: which limit, and until when
          }
        }
        return;
      }
      // B-409: a reply that lands after a switch belongs to a session no longer running: dropped; a free read's, once
      // the note is closed or its toggle turned off
      if (s) {
        const cur = activeSession();
        if (!cur || cur.id !== s.id || cur.status !== 'active') return;
      } else if (NOTE.open !== note.id || !readAlongOn(note.id)) return;
      st.seen = a.seenNext;
      if (s) SS.added = a.added;
      const c = E.parseComment(out, a.added);
      if (!c) return;
      const id = msgId('e');
      if (c.quote) SS.quotes.set(id, c.quote);
      await postMsg({
        id,
        role: 'ev',
        text: c.say,
        at: now(),
        tier: 'quick',
        ...(s ? thOf(s) : { thread: noteThread(note.id) }),
      });
      if (s) {
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
      } else popPing(noteThread(note.id), false, true);
      SS.alertUntil = Date.now() + 4500;
    }
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
        SS.note = { id: note.id, name: note.name, folder: note.folder || '', title: note.title || '' };
        await readAlong(SS, note, s);
      } finally {
        SS.reading = false;
        SS.thinking = false;
      }
    }
    // B-418: the note open in Notes when no running session is on it
    const RA = { noteId: null, seen: null, text: null, changedAt: 0, lastAsk: 0, nextRead: 0, reading: false };
    function freeReadTick(s) {
      if (!COMMENT || !M || RA.reading || SS.busy || document.visibilityState === 'hidden') return;
      if (!notesOn() || ui.tab !== 'notes' || NOTE.view !== 'editor' || !NOTE.open || !NOTE.blocks) return;
      if (s && s.status === 'active' && noteOfSession(s) === NOTE.open) return; // its session reads it (readTick)
      const id = NOTE.open;
      if (RA.noteId !== id)
        Object.assign(RA, { noteId: id, seen: null, text: null, changedAt: Date.now(), nextRead: 0 });
      if (Date.now() < RA.nextRead) return;
      RA.nextRead = Date.now() + (SWC.readSeconds || 30) * 1e3;
      RA.reading = true;
      const blocks = NOTE.blocks;
      readAlong(
        RA,
        { id, name: E.noteTitleOf(blocks) || 'Untitled', text: blocks.map(b => E.noteText(b)).join('\n') },
        null
      )
        .catch(() => {})
        .finally(() => {
          RA.reading = false;
        });
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
        const p = await sessionNote(s);
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
    const MARK_SETTLE_MS = 800; // B-411 review: views racing to mark one session read back after both marks land
    const sessRead = async id => {
      const d = await db.collection('sessions').doc(id).get();
      return d && d.exists ? { ...d.data(), id } : null;
    };
    async function fileSession(s2, reason, { recheck = null } = {}) {
      const st = E.sessionState(s2, now());
      let wrap = {};
      let note = '';
      // B-411: a filing a reload interrupted goes on from its mark (its time and summary), with no second summary
      const resumed = !!E.filingOf(s2);
      if (!resumed && (st.checks || st.comments || st.reads) && sample && !T.sampleOff) {
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
      if (recheck) {
        // B-406 review: the session as it stands now, after Claude's summary: an Undo or another view may have
        // reopened or filed it meanwhile, and then this view files nothing
        const now2 = sessOf(s2.id);
        if (!now2 || !recheck(now2)) return null;
        s2 = now2;
      }
      // B-411: the filing mark lands before any finding, so a reload between them files the same findings once. B-411
      // review: a mark already there wins (the shim refuses a different one), and every view files from the mark the
      // record holds once both have landed, so two views filing at once make the same writes.
      let held = (await sessRead(s2.id)) || s2;
      if (!E.filingOf(held)) {
        try {
          await write(E.filingMark(held, wrap, { now: now() }));
        } catch (e) {
          if (!(e && e.conflict)) throw e;
        }
        await new Promise(ok => setTimeout(ok, MARK_SETTLE_MS));
        held = await sessRead(s2.id);
      }
      if (!held || !E.filingOf(held) || held.filedAt) return null;
      s2 = held;
      const r = E.closeSession(s2, wrap, {
        weakspots: M.models,
        objectives: S.objectives,
        ideas: S.ideas || [],
        now: now(),
        endedBy: reason,
      });
      // B-411 review: every finding first, the session's own update (which marks it filed) last
      await run(E.closeFindings(r.writes));
      await run(E.closeUpdate(r.writes));
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
    // B-407 (D-237): the weak spots a filing proposed wait in Study's To review, and her line says so
    function waitsLine(r) {
      const n = ((r && r.writes) || []).filter(
        w => w.collection === 'weakspots' && w.op === 'set' && w.data && w.data.proposed
      ).length;
      return n
        ? n === 1
          ? ' I proposed a weak spot; it waits in Study’s To review.'
          : ` I proposed ${n} weak spots; they wait in Study’s To review.`
        : '';
    }
    // B-409: her band under the header once a session ends: "Ended the session on “<note>”: N minutes, logged to
    // Record." It has no Undo: End files the session at once (its summary, findings and minutes are written once), and
    // the only reopen there is (core undoSwitch) is for a switched session whose filing still waits.
    const ENDED_MS = 6000;
    SS.ended = null;
    function noteEnded(s, name, mins) {
      const until = Date.now() + ENDED_MS;
      SS.ended = { id: s.id, note: noteOfSession(s), name, mins: Math.max(0, Math.round(Number(mins) || 0)), until };
      setTimeout(() => SS.ended && SS.ended.until === until && render(), ENDED_MS + 50);
    }
    // B-438: how long a writing session waits paused before it saves itself, in words
    const wrapWords = m => (m === 60 ? 'an hour' : m % 60 === 0 ? m / 60 + ' hours' : plural(m, 'minute'));
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
        const endedName = sessName(s2);
        const res = await fileSession(s2, reason);
        if (res) noteEnded(s2, endedName, res.up.minutes);
        if (!res) return ['Session saved.', [{ type: 'go', label: 'Open in Record', to: 'record', id: s.id }]]; // filed elsewhere
        const { up, st, r, note } = res;
        SS.text = null;
        SS.added = '';
        SS.seen = null;
        SS.note = null;
        const lead =
          reason === 'idle'
            ? isWriting(s)
              ? `You haven’t written for ${wrapWords(SWC.writingWrapMinutes || 60)}, so I saved the session. `
              : 'No new writing for a while, so I wrapped up. '
            : reason === 'time'
              ? 'Time. '
              : '';
        return [
          `${lead}Session saved: ${savedBits(up, st)}.${waitsLine(r)}${r.questions.length ? ' One thing to settle on the card.' : ''}${note}`,
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
    // B-408 (D-325): a session's controls are the strip's on desktop (renderSlot) and the header's line on the phone
    // (phoneBar); her ring is the stretch to the next check on both (B-273).
    function renderSession() {
      const s = activeSession();
      document.body.classList.toggle('in-session', !!s);
      renderSlot();
      CORE.setRing(s ? ringFill(E.sessionState(s, now()), s.status === 'ending') : -1);
      phoneBar(s);
    }
    // B-86 (Matt, Oct 19), B-353 (D-314): under 1024 px the session is one quiet line under the pane header, the demo's
    // strip: the topic in bold, the minutes, Break and End. From 1024 px it is the strip's (renderSlot).
    function phoneBar(s) {
      const bar = $('sbar');
      // B-211 (D-217): the line is the pane header's, after its title, on every tab
      const mh = $('mh');
      if (bar.parentNode !== mh) mh.insertBefore(bar, $('status').nextSibling);
      if (!s || WIDE_STRIP.matches) {
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
        // buttons change with the state; the clock line updates in place every second
        bar.dataset.k = k;
        const led = el('span', 's-led');
        led.setAttribute('aria-hidden', 'true');
        const main = el('span', 's-main');
        main.append(el('b', 's-topic', sessName(s)), el('span', 's-clock', ''));
        bar.setAttribute('aria-label', 'Study session: ' + sessName(s));
        bar.title = sessName(s);
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
              : isWriting(s)
                ? (st.paused ? 'Paused · ' : '') + `${st.minutes} min writing` // B-438
                : `${minsLeft(st) ?? st.minutes} min${minsLeft(st) == null ? '' : ' to next check'}`; // B-383: what it counts
        return;
      }
      bar.querySelector('.s-clock').textContent = ending
        ? 'Wrapping up…'
        : SS.busy
          ? 'Reading your note…'
          : st.onBreak
            ? `On a break · ${tickClock(st.breakRemainingMs)} to the check`
            : `${tickClock(Date.parse(st.nextCheckAt) - Date.now())} left to the check`;
    }
    // B-290: the minutes left to her next check, or of the break; null when the session has no next check.
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
      const s = activeSession();
      renderSession();
      freeReadTick(s); // B-418 (D-339): read-along in the open note, session or not
      if (M && loaded.has('sessions')) switchTick(); // B-406: a switch's Undo runs out, then its session is filed
      if (!s || !M || SS.busy) return;
      if (s.status === 'ending') {
        endingTick(s);
        return;
      }
      if (s.status !== 'active') return;
      const st = E.sessionState(s, now());
      // B-87: the view in front of him takes the session over at once (a reload or a reopened tab used to wait two minutes
      // past a due check, the clock at 0:00). B-408: a session on a Study Watch note (the retired reader) is never
      // driven here; a noteless one or one on a note in Notes is.
      const free = noteless(s) || !!noteOfSession(s);
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
      if (writingTick(s, st)) return; // B-438
      if (st.shouldWrap) {
        endSession('idle')
          .then(([t, c]) => evSay(t, c, { tier: 'local', ...thOf(s) }))
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
    // B-406 review: a switched session is filed only once its Undo is over by the record's own clock (its end event's
    // time + UNDO_MS + this margin), in every view; Undo is refused past UNDO_MS by the same clock.
    const FILE_MARGIN_MS = 5000;
    const undoEndsAt = s => {
      const at = E.switchedAt(s);
      return at ? Date.parse(at) + UNDO_MS : 0;
    };
    SS.undo = null;
    SS.filing = new Set();
    // The note a Notes session reads: the open note as he is writing it, else as saved. Its text goes to Claude
    // through sample() at a check (D-328); the record keeps its length and hash only.
    async function sessionNote(s) {
      const id = noteOfSession(s);
      if (!id) return { found: false }; // B-408: a session on a Study Watch note (the retired reader) reads nothing here
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
      if (isTimed(s)) popPing(sThread(s), open);
    }
    // B-418: a free read's line goes to its note's chat (keep: never taking over a pop-up open on another chat)
    function popPing(th, open, keep = false) {
      if (!popReady() || !DESK.matches) return;
      if (keep && POP.open && POP.th && POP.th !== th) return;
      POP.th = th;
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
    async function startTimed({
      noteId = '',
      topic,
      planned = NOTE_MINUTES,
      fresh = false,
      say,
      from = whereNow(),
      clock = '',
    }) {
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
        await run(E.switchSession(cur, { at, key: pageKey(at), view: SS.view }));
        // B-411: the Undo lasts as long as the record says it does: from the switch's end event
        prior.until = undoEndsAt(sessOf(cur.id)) || Date.now() + UNDO_MS;
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
            clock,
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
      SS.typedAt = Date.now(); // B-438: the writing clock starts with the session
      SS.undo = prior ? { ...prior, next: id } : null;
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
        clock: 'writing',
        say: fresh
          ? 'Started a session on your new note. The clock counts the time you spend writing.'
          : `Started a session on “${name}”. The clock counts the time you spend writing.`,
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
      const prev = u && sessOf(u.prev);
      if (!u || Date.now() >= u.until || !prev || Date.now() >= undoEndsAt(prev)) {
        SS.undo = null;
        if (u) toast(`Too late to undo: “${u.name}” is saved.`); // B-411: a refused Undo says so
        render();
        return;
      }
      const at = now();
      const o = { at, keys: [pageKey(at), pageKey(at)], windowMs: UNDO_MS };
      const next = sessOf(u.next);
      SS.undo = null;
      if (!E.undoSwitch(prev, next, o).length) {
        toast(`Too late to undo: “${u.name}” is saved.`);
        render();
        return;
      }
      // held until the reopen lands, so switchTick never files the session in the middle of its Undo
      SS.filing.add(u.prev);
      try {
        await run(E.undoSwitch(prev, next, o));
      } catch (e) {
        SS.filing.delete(u.prev);
        throw e;
      }
      SS.filing.delete(u.prev); // active again: if it is switched later, that switch is filed in its turn
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
        // every view waits out the Undo by the record's clock; the view that switched files it, and any other view
        // only after the takeover delay past that
        const due = undoEndsAt(s) + FILE_MARGIN_MS;
        const sw = E.switchedEnd(s);
        const mine = !!sw && sw.view === SS.view; // B-411: the view that switched, which held the Undo
        if (Date.now() < due + (mine ? 0 : (SWC.takeoverMinutes || 2) * 60e3)) continue;
        SS.filing.add(s.id); // once per page load, whatever happens
        fileSession(s, 'switched', { recheck: E.switchedUnfiled })
          .then(res => {
            if (!res) return;
            const { up, st, r, note } = res;
            return evSay(
              `Saved “${sessName(s)}”: ${savedBits(up, st)}.${waitsLine(r)}${r.questions.length ? ' One thing to settle on the card.' : ''}${note}`,
              r.questions.length
                ? [{ type: 'session', id: s.id }]
                : [{ type: 'go', label: 'Open in Record', to: 'record', id: s.id }],
              { tier: 'local', ...thOf(s) }
            );
          })
          .catch(() => {});
      }
    }
    // B-411 review: a session left wrapping up (a reload or a closed view mid-End) is filed again: from its mark once
    // that is MARK_STALE_MS old (its filer is gone), or with no mark once the takeover delay has passed since its end
    const MARK_STALE_MS = 30e3;
    function endingTick(s) {
      const e = E.endingOf(s);
      if (!e || SS.filing.has(s.id)) return;
      const mark = E.filingOf(s);
      const since = mark ? Date.parse(mark.at) + MARK_STALE_MS : Date.parse(e.at) + (SWC.takeoverMinutes || 2) * 60e3;
      if (!(Date.now() >= since)) return;
      SS.filing.add(s.id); // once per page load
      fileSession(s, e.why, { recheck: x => !!E.endingOf(x) })
        .then(res => {
          if (!res) return;
          const { up, st, r, note } = res;
          return evSay(
            `Session saved: ${savedBits(up, st)}.${waitsLine(r)}${r.questions.length ? ' One thing to settle on the card.' : ''}${note}`,
            r.questions.length
              ? [{ type: 'session', id: s.id }]
              : [{ type: 'go', label: 'Open in Record', to: 'record', id: s.id }],
            { tier: 'local', ...thOf(s) }
          );
        })
        .catch(() => {});
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
    // B-438: a writing session's clock counts up: the time written, or Paused with it
    const clockUp = ms => {
      const t = Math.max(0, Math.floor(ms / 1000));
      return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    };
    const writingClock = st => (st.paused ? 'Paused · ' + clockUp(st.activeMs) : clockUp(st.activeMs) + ' writing');
    /** A Notes session's chat, as the pop-up names it: {title, sub, chip}; null for any other chat. */
    function sessThreadInfo(th) {
      if (!th || !/^th-ss-/.test(th)) return null;
      const s = S.sessions.find(x => isTimed(x) && sThread(x) === th);
      if (!s) return null;
      const name = sessName(s);
      let sub = 'Session ended · ' + name;
      if (s.status === 'active' || s.status === 'ending') {
        const st = E.sessionState(s, now());
        sub =
          (st.onBreak ? 'On a break' : isWriting(s) ? writingClock(st) : clockLeft(st.leftMs) + ' left') + ' · ' + name;
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
      // B-408: any running session shows here on desktop, one the phone started too (it reads no note and has no end
      // of its own, so its line counts to the next check)
      const s = activeSession();
      const u = SS.undo && Date.now() < SS.undo.until ? SS.undo : null;
      if (!s && !u) {
        if (slot.firstChild) slot.replaceChildren();
        slot.dataset.k = '';
        return;
      }
      const st = s ? E.sessionState(s, now()) : null;
      const ending = !!s && s.status === 'ending';
      const k = [s && s.id, s && s.status, st && st.onBreak, SS.busy === true, u && u.next].join('|');
      slot.classList.toggle('paused', !!(st && st.paused)); // B-438
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
            else showTab(isTimed(s) ? 'today' : 'ev');
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
          : isWriting(s)
            ? writingClock(st)
            : isTimed(s)
              ? clockLeft(st.leftMs) + ' left'
              : `${minsLeft(st) ?? st.minutes} min${minsLeft(st) == null ? '' : ' to next check'}`;
      const go = slot.querySelector('.tn');
      const nm = sessName(s);
      const name = noteOfSession(s) && nm === 'New note' ? 'your new note' : nm; // the demo's words for an empty one
      if (go.textContent !== name) {
        go.textContent = name;
        go.title = noteOfSession(s) ? 'Open the note: ' + name : (isTimed(s) ? 'Open Today: ' : 'Open E.V.: ') + name;
      }
    }

    setInterval(sessionTick, 1000);

