// E.V. core's skills practice (Features: "Skills practice mode"), the Quizlet cards from weak spots, and workouts
// (D-108). Split from core/evcore.mjs (B-158, D-166) as one factory with no imports, so the same file runs in node
// (evcore.mjs imports it) and in the page (the build writes it into core.js ahead of E.V. core). It takes the core names
// it uses, C and SPEC through getters (configure() replaces them), and returns the names core's export map uses.

export function makeSkills(core) {
  'use strict';
  const {
    citeMaterial,
    chicagoDate,
    collectAttempts,
    compactTime,
    defaultCourse,
    entryTime,
    envelope,
    eventKey,
    isActive,
    isoOf,
    safeId,
    scanIdentifiers,
    slug,
    toMs,
  } = core;

  // ---------------------------------------------------------------- skills practice (Features: "Skills practice mode")
  // A validation checklist from the Skills Packet, run step by step in the conversation: Matt marks each step done or
  // missed; a miss is a weak spot of kind skill at once, and a later pass on that step marks it done. The steps come
  // from the checklist page as printed: numbered 1, 2, 3 …, an asterisk before a number marks a step he may not miss.
  /** The checklist starting on `page` of a material: {materialId, title, page, cite, steps: [{n, text, critical}], rule}. */
  function skillSteps(m, { page } = {}) {
    const t = String((m && m.text) || '');
    let from = 0;
    if (page) {
      const i = t.search(new RegExp('\\[(?:p|s|Page |Slide )' + Number(page) + '\\]'));
      if (i >= 0) from = i;
    }
    let body = t.slice(from, from + 40000);
    // One checklist: from its own heading to the next checklist's (each opens "Student Name Date Instructor Name <TITLE>").
    const heads = [...body.matchAll(/Student Name\s+Date\s+Instructor Name/g)];
    if (heads.length > 1) {
      const cut = body.slice(0, heads[1].index).search(/\d\s*st Attempt: S or U[^]*$/);
      body = body.slice(0, cut > heads[0].index ? cut : heads[1].index);
    }
    const heading =
      /Student Name\s+Date\s+Instructor Name\s+(.+?)\s+(?:\*?The (?:grading|student)|\*Preparing|The grade)/.exec(body);
    const title = heading
      ? heading[1].replace(/\s+/g, ' ').trim().slice(0, 100)
      : m && m.title
        ? String(m.title).replace(/\.(pdf|docx|pptx)$/i, '')
        : 'Skill';
    const re = /(\*\s*)?(\d{1,2})\.\s+(?=[A-Za-z(])/g;
    const marks = [];
    let x;
    let next = 1;
    while ((x = re.exec(body))) {
      const n = Number(x[2]);
      if (n === next) {
        marks.push({ n, critical: !!x[1], at: x.index, start: x.index + x[0].length });
        next++;
      } else if (n === 1 && marks.length >= 3) break;
    }
    const clean = s =>
      s
        .replace(/(?:Overall Performance|_{3,}|\s\d\s*(?:st|nd)\s*Attempt)[^]*$/, '')
        .replace(/\[(?:p|s|Page |Slide )\d+\]\s*\d*\s*/g, ' ')
        .replace(/\d\s*(?:st|nd)\s*Attempt[^]*?Instructor Name/g, ' ')
        .replace(/1\s*st Attempt\s*2\s*nd Attempt\s*S\s*U\s*S\s*U/g, ' ')
        .replace(/\s*\*\s*$/, '')
        .replace(/(?:\s+[A-Z][A-Z/&,'-]+){2,}\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    const steps = marks
      .map((mk, i) => ({
        n: mk.n,
        critical: mk.critical,
        text: clean(
          body.slice(mk.start, i + 1 < marks.length ? marks[i + 1].at : Math.min(body.length, mk.start + 400))
        ).slice(0, 300),
      }))
      .filter(st => st.text);
    const atLeast = /AT LEAST (\d+) of the following/i.exec(body);
    const allow = /only (\d+) of the non-asterisk/i.exec(body);
    const rule = {
      ...(atLeast ? { atLeast: Number(atLeast[1]) } : {}),
      ...(allow ? { missNonCritical: Number(allow[1]) } : {}),
    };
    return {
      materialId: m && m.id,
      title,
      page: page || null,
      cite: citeMaterial({ title: m && m.title, id: m && m.id, page }),
      steps,
      rule,
    };
  }
  /** A skills session's state from its events: the step results, the next step, the tally and whether it passes. */
  function skillState(s) {
    const steps = (s && s.skill && s.skill.steps) || [];
    const results = {};
    const evs = Object.entries((s && s.events) || {})
      .filter(([, e]) => e && e.type === 'step')
      .map(([k, e]) => [entryTime(k, e), e])
      .sort(([a], [b]) => toMs(a) - toMs(b));
    for (const [, e] of evs)
      if (steps.some(st => st.n === e.n) && (e.result === 'pass' || e.result === 'miss')) results[e.n] = e.result;
    const next = steps.find(st => !results[st.n]) || null;
    const missed = steps.filter(st => results[st.n] === 'miss');
    const passed = steps.filter(st => results[st.n] === 'pass');
    const rule = (s && s.skill && s.skill.rule) || {};
    const criticalMissed = missed.filter(st => st.critical).length;
    const satisfactory =
      criticalMissed === 0 &&
      (rule.missNonCritical != null ? missed.length - criticalMissed <= rule.missNonCritical : true) &&
      (rule.atLeast != null ? passed.length >= rule.atLeast : true);
    // When the run last moved: its start or its latest step (the idle end counts from here).
    const times = [
      s && s.startedAt,
      ...Object.entries((s && s.events) || {})
        .filter(([, e]) => e && (e.type === 'start' || e.type === 'step'))
        .map(([k, e]) => entryTime(k, e)),
    ].filter(t => t && Number.isFinite(toMs(t)));
    const moved = times.sort((x, y) => toMs(y) - toMs(x))[0] || null;
    return {
      total: steps.length,
      done: passed.length + missed.length,
      next,
      passed: passed.length,
      missed: missed.map(st => st.n),
      criticalMissed,
      satisfactory: !next && satisfactory,
      complete: !next,
      results,
      lastAt: moved,
    };
  }
  /**
   * Whether a running skills run has sat untouched for the conversation idle gap (B-82, Matt Oct 19: it ends on its own
   * after the same time a conversation starts anew; constants.conversation.idleGapMin), counted from its last step or
   * its start.
   */
  function skillIdle(s, now, o = {}) {
    if (!s || s.status !== 'active') return false;
    const st = skillState(s);
    if (!st.next || !st.lastAt) return false;
    const gap = (o.idleGapMin != null ? o.idleGapMin : core.C.conversation.idleGapMin) * 60000;
    return toMs(isoOf(now)) - toMs(st.lastAt) >= gap;
  }
  /** The greeting's chip that brings a waiting skills run back (B-82): "Resume Head-to-toe assessment · 4 of 32". */
  function skillResumeChip(s) {
    if (!s || !s.skill) return null;
    const st = skillState(s);
    if (!st.next) return null;
    // The checklist's own title, shortened: no "validation checklist", sentence case when the packet shouts, 22 characters.
    let t =
      String(s.topic || s.skill.title || 'skills run')
        .replace(/\s+/g, ' ')
        .replace(/\s*\b(validation\s+)?checklist\b\s*$/i, '')
        .trim() || 'skills run';
    if (t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase();
    const name = t.length <= 22 ? t : t.slice(0, 22).replace(/\s+\S*$/, '') + '…';
    return `Resume ${name} · ${st.next.n} of ${st.total}`;
  }
  const skillWeakspotId = (s, n) =>
    safeId('skill-' + slug((s.skill && s.skill.title) || s.topic || 'skill', 30) + '-' + n);
  /**
   * One step marked: the session's step event, and the weak spot it leads to: a miss opens (or sees again) the step's
   * weak spot of kind skill, a pass marks an open one done. Returns the writes.
   */
  function skillStep(s, n, result, { weakspots = [], now, by = 'Matt' } = {}) {
    const at = isoOf(now);
    const st = ((s.skill && s.skill.steps) || []).find(x => x.n === Number(n));
    if (!st) throw new Error('no step ' + n + ' in this checklist');
    if (result !== 'pass' && result !== 'miss') throw new Error('result must be pass or miss');
    const writes = [
      {
        op: 'update',
        collection: 'sessions',
        id: s.id,
        data: { events: { [eventKey('page', at)]: { type: 'step', n: st.n, result, at } } },
      },
    ];
    const id = skillWeakspotId(s, st.n);
    const open = weakspots.find(w => w.id === id && w.derived && w.derived.status === 'open');
    const title = (s.skill && s.skill.title) || s.topic || 'Skill';
    if (result === 'miss' && open)
      writes.push({
        op: 'update',
        collection: 'weakspots',
        id,
        data: { events: { [eventKey('page', at)]: { type: 'seen', by, note: 'Skills practice', at } } },
      });
    else if (result === 'miss')
      writes.push({
        op: 'set',
        collection: 'weakspots',
        id,
        data: {
          ...envelope('page', 'Skills practice · ' + title, at),
          topic: (title + ': step ' + st.n + ', ' + st.text).slice(0, 200),
          objective: '',
          exam: '',
          course: defaultCourse(),
          kind: 'skill',
          addedBy: by,
          origin: {
            session: s.id,
            step: st.n,
            at,
            material: (s.skill && s.skill.materialId) || null,
            page: (s.skill && s.skill.page) || null,
          },
          initial: { streak: 0, nextDue: null, recurrence: 1, misses: 1 },
          events: {},
        },
      });
    else if (open)
      writes.push({
        op: 'update',
        collection: 'weakspots',
        id,
        data: { events: { [eventKey('page', at)]: { type: 'done', by, note: 'Skills practice: done right', at } } },
      });
    return writes;
  }
  /** A new skills session (sessions/ss-skill-*): the checklist it runs, from skillSteps. */
  function startSkill(sk, { now, date } = {}) {
    if (!sk || !(sk.steps || []).length) throw new Error('no numbered steps on that page');
    const at = isoOf(now);
    const id = safeId('ss-skill-' + compactTime(at).slice(0, 15) + '-' + slug(sk.title, 24));
    return {
      op: 'set',
      collection: 'sessions',
      id,
      data: {
        ...envelope('page', 'E.V. Home', at),
        schema: 2, // B-74
        kind: 'skill',
        status: 'active',
        date: date || chicagoDate(at),
        startedAt: at,
        topic: sk.title,
        skill: {
          materialId: sk.materialId || null,
          page: sk.page || null,
          cite: sk.cite || '',
          steps: sk.steps,
          rule: sk.rule || {},
        },
        events: { [eventKey('page', at)]: { type: 'start', at } },
      },
    };
  }
  /** Ending a skills session: its status, minutes and a one-line summary. */
  function endSkill(s, { now, endedBy = 'ended' } = {}) {
    const at = isoOf(now);
    const st = skillState(s);
    // A run that ended itself (idle) counts its minutes to the last step, not to the moment it was closed.
    const until = endedBy === 'idle' && st.lastAt ? st.lastAt : at;
    const minutes = Math.max(0, Math.round((toMs(until) - toMs(s.startedAt)) / 60000));
    const summary =
      `${st.passed} of ${st.total} steps done right${st.missed.length ? ', missed step' + (st.missed.length > 1 ? 's ' : ' ') + st.missed.join(', ') : ''}.` +
      (st.complete
        ? st.satisfactory
          ? ' That run meets the checklist’s bar.'
          : ' That run would not meet the checklist’s bar yet.'
        : endedBy === 'idle'
          ? ' Left unfinished; nothing was logged for the steps not reached.'
          : ' Stopped before the end.');
    return {
      op: 'update',
      collection: 'sessions',
      id: s.id,
      data: {
        status: 'ended',
        endedAt: at,
        minutes,
        endedBy,
        summary,
        events: { [eventKey('page', at)]: { type: 'end', at, why: endedBy } },
      },
    };
  }

  // ---------------------------------------------------------------- workouts (D-108)
  /** The sequences spec.workouts names, by id: {id, title, kind: amrap|ladder, ...}. */
  function workoutSequences() {
    const q = (core.SPEC && core.SPEC.workouts && core.SPEC.workouts.sequences) || {};
    return Object.fromEntries(Object.entries(q).map(([id, s]) => [id, { id, ...s }]));
  }
  /** The moves of round n (1-based): amrap repeats its round; a ladder's rung r is each move times its per. */
  function workoutMoves(seq, n) {
    if (!seq) return [];
    if (seq.kind === 'amrap') return seq.round.map(m => ({ move: m.move, reps: m.reps }));
    const r = (seq.rungs || [])[n - 1];
    return r == null ? [] : seq.moves.map(m => ({ move: m.move, reps: m.per * r }));
  }
  const workoutRoundReps = (seq, n) => workoutMoves(seq, n).reduce((a, m) => a + m.reps, 0);
  /** A new workouts/<id> (status active) for a sequence, started now. */
  function startWorkout(seq, { now, date } = {}) {
    if (!seq || !seq.id) throw new Error('no such workout');
    const at = isoOf(now);
    const id = safeId('wo-' + compactTime(at).slice(0, 15) + '-' + seq.id);
    return {
      op: 'set',
      collection: 'workouts',
      id,
      data: {
        ...envelope('page', 'E.V. Home', at),
        sequence: seq.id,
        title: seq.title,
        date: date || chicagoDate(at),
        status: 'active',
        startedAt: at,
        endedAt: null,
        events: {},
        result: null,
        energy: null,
        mood: null,
      },
    };
  }
  /**
   * Where a workout stands: rounds done, the round he is on and its moves, the clock (elapsed, and for an amrap what is
   * left of the cap), whether it is over (an amrap at its cap, a ladder past its last rung) and the reps so far.
   */
  function workoutState(w, seq, now) {
    const rounds = Object.entries((w && w.events) || {})
      .filter(([, e]) => e && e.type === 'round')
      .map(([, e]) => e.n);
    const done = rounds.length ? Math.max(...rounds) : 0;
    const total = seq && seq.kind === 'ladder' ? seq.rungs.length : null;
    const end = w && w.endedAt ? toMs(w.endedAt) : toMs(isoOf(now));
    const elapsedMs = Math.max(0, end - toMs(w.startedAt));
    const capMs = seq && seq.kind === 'amrap' ? seq.capMinutes * 60000 : null;
    const leftMs = capMs != null ? Math.max(0, capMs - elapsedMs) : null;
    let reps = 0;
    for (let n = 1; n <= done; n++) reps += workoutRoundReps(seq, n);
    const over = capMs != null ? leftMs === 0 : done >= total;
    const current = over ? null : done + 1;
    return {
      done,
      current,
      total,
      moves: current ? workoutMoves(seq, current) : [],
      elapsedMs,
      capMs,
      leftMs,
      over,
      reps,
    };
  }
  /** One round done (the next round's number), appended as an event. */
  function workoutRound(w, seq, { now } = {}) {
    const at = isoOf(now);
    const st = workoutState(w, seq, at);
    if (w.status !== 'active') throw new Error('this workout is over');
    if (!st.current) throw new Error(seq.kind === 'amrap' ? 'the time cap has passed' : 'every round is done');
    return {
      op: 'update',
      collection: 'workouts',
      id: w.id,
      data: { events: { [eventKey('page', at)]: { type: 'round', n: st.current, at } } },
    };
  }
  /**
   * Ending a workout: an amrap keeps its rounds in the cap plus the extra reps he typed; a ladder keeps its total time and,
   * when stopped early, the round he stopped in (completed false). status done or stopped, endedAt now.
   */
  function endWorkout(w, seq, { now, extraReps = 0, stopped = false } = {}) {
    const at = isoOf(now);
    const st = workoutState(w, seq, at);
    const extra = Math.max(0, Math.floor(Number(extraReps) || 0));
    let result;
    if (seq.kind === 'amrap')
      result = {
        rounds: st.done,
        extraReps: extra,
        reps: st.reps + extra,
        totalSeconds: Math.round(Math.min(st.elapsedMs, st.capMs) / 1000),
        completed: !stopped,
      };
    else {
      const completed = st.done >= st.total;
      result = {
        rounds: st.done,
        totalSeconds: Math.round(st.elapsedMs / 1000),
        reps: st.reps,
        completed,
        ...(completed ? {} : { stopRound: st.done + 1 }),
      };
    }
    return {
      op: 'update',
      collection: 'workouts',
      id: w.id,
      data: { status: result.completed ? 'done' : 'stopped', endedAt: at, result },
    };
  }
  /** The energy and mood line at the end (energy 1 to 5; mood in his words, at most 200 characters, no identifiers). */
  function workoutCheckin(w, { energy, mood } = {}) {
    const e = Number(energy);
    if (!(e >= 1 && e <= 5)) throw new Error('energy is 1 to 5');
    const m = String(mood || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    if (scanIdentifiers(m).length) throw new Error('that note ' + scanIdentifiers(m)[0]);
    return { op: 'update', collection: 'workouts', id: w.id, data: { energy: Math.round(e), mood: m || null } };
  }
  /** One line for a finished workout, for the card, the list and the conversation. */
  function workoutSummary(w, seq) {
    const r = w && w.result;
    if (!r) return '';
    const t = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const main =
      seq && seq.kind === 'amrap'
        ? `${r.rounds} round${r.rounds === 1 ? '' : 's'}${r.extraReps ? ' + ' + r.extraReps + ' reps' : ''} in ${r.completed ? seq.capMinutes + ' min' : t(r.totalSeconds) + ', stopped before the ' + seq.capMinutes + '-minute cap'}`
        : r.completed
          ? `all ${seq ? seq.rungs.length : r.rounds} rounds in ${t(r.totalSeconds)}`
          : `stopped in round ${r.stopRound} after ${t(r.totalSeconds)} (${r.reps} reps)`;
    return [main, w.energy ? 'energy ' + w.energy + '/5' : '', w.mood ? '“' + w.mood + '”' : '']
      .filter(Boolean)
      .join(' · ');
  }

  function cardsText(cards) {
    return (cards || []).map(c => `${c.term}\t${c.definition}`).join('\n');
  }
  /**
   * The open weak spots as Quizlet cards (B-41, Matt's pick 5): the topic as the term; the objective's text and the
   * rationale of the last question he missed on it (the right answer's) as the definition. Concept weak spots only,
   * due soonest first. Tabs and line breaks become spaces so each card stays one import line.
   */
  function weakspotCards({ weakspots = [], objectives = [], sets = [], answers = [] } = {}) {
    const flat = t =>
      String(t || '')
        .replace(/[\t\r\n]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    const objText = new Map((objectives || []).map(o => [o.id, o.text]));
    const items = new Map();
    for (const st of sets || []) for (const q of st.items || []) items.set(st.id + '/' + q.id, q);
    const { byWeakspot } = collectAttempts(sets, answers);
    const why = q => {
      if (!q) return '';
      if (q.matrix && Array.isArray(q.matrix.rows))
        return q.matrix.rows
          .map(r => r.rationale)
          .filter(Boolean)
          .join(' ');
      const right = (q.correct || [])[0];
      const r = (q.rationales || [])[right];
      return [q.options && q.options[right] != null ? `Answer: ${q.options[right]}.` : '', r || '']
        .filter(Boolean)
        .join(' ');
    };
    return (weakspots || [])
      .filter(w => (w.kind || 'concept') === 'concept' && isActive(w))
      .sort(
        (a, b) =>
          String(a.derived.nextDue || '9').localeCompare(String(b.derived.nextDue || '9')) ||
          String(a.topic).localeCompare(String(b.topic))
      )
      .map(w => {
        const missed = (byWeakspot[w.id] || []).filter(a => !a.correct).pop();
        const parts = [
          objText.get(w.objective) ? `${w.objective}: ${objText.get(w.objective)}` : w.objective || '',
          missed ? why(items.get(missed.setId + '/' + missed.itemId)) : '',
        ];
        return { term: flat(w.topic), definition: flat(parts.filter(Boolean).join(' · ')) || 'Open weak spot' };
      });
  }

  return {
    skillSteps,
    skillState,
    skillIdle,
    skillResumeChip,
    skillStep,
    startSkill,
    endSkill,
    workoutSequences,
    workoutMoves,
    startWorkout,
    workoutState,
    workoutRound,
    endWorkout,
    workoutCheckin,
    workoutSummary,
    cardsText,
    weakspotCards,
  };
}
