// E.V. core's measures (B-522): one source for each count a view shows, so Today, Study and Progress never disagree.
// Open weak spots, an objective's readiness state, and study time per day and course (ended sessions, a running one at
// its clock, and today's ticked task minutes). One factory with no imports, as core's other sections: the same file
// runs in node (evcore.mjs imports it) and in the page (the build writes it into core.js ahead of E.V. core). It reads
// the core's own rules (isActive, untriaged, sessionState, chicagoDate) through `core()` when a measure runs.

export function makeMeasures(core) {
  'use strict';
  const L = new Proxy({}, { get: (_, k) => core()[k] }); // core's rules, read when a measure runs
  const concept = w => !!w && (w.kind || 'concept') === 'concept';
  /**
   * The open weak spots: a concept spot still open, not a preview (preRead), in `course` when one is named (a spot
   * whose course is unknown counts in every course). Study's list, its count and Progress's "N open" are this list.
   */
  function openSpots(models, { course = null, courseOf = null } = {}) {
    return (models || []).filter(w => {
      if (!L.isActive(w) || (w.derived && w.derived.preRead)) return false;
      if (!course || !courseOf) return true;
      const c = courseOf(w);
      return !c || c === course;
    });
  }
  /**
   * An objective's readiness: Not yet while one of its open spots is not yet right (or nothing is answered), Almost
   * while its open ones are right once, Solid once none is open. `acc` is its answer stats ({n}); spots waiting for his
   * triage, parked or moved count nowhere. Today, Study and Progress all read this one.
   */
  function objectiveState(o, models, acc) {
    const ws = (models || []).filter(
      w =>
        concept(w) &&
        w.objective === o.id &&
        w.derived &&
        !['parked', 'moved'].includes(w.derived.status) &&
        !L.untriaged(w)
    );
    const open = ws.filter(L.isActive);
    const notYet = open.filter(w => !w.derived.preRead && !((w.derived.streak || 0) > 0));
    const state = notYet.length ? 'notyet' : open.length ? 'almost' : ws.length || (acc && acc.n) ? 'solid' : 'notyet';
    return { state, open, ws };
  }
  /** A session's study minutes and day: an ended one its own minutes, a running one (active or ending) its clock now. */
  function sessionMinutes(s, now) {
    if (!s || s.status === 'discarded') return null;
    const running = s.status === 'active' || s.status === 'ending';
    const minutes = running || s.minutes == null ? L.sessionState(s, now).minutes || 0 : s.minutes || 0;
    const date = s.date || (s.startedAt ? L.chicagoDate(s.startedAt) : null);
    if (!date || !(minutes > 0)) return null;
    return { date, minutes, running };
  }
  /**
   * Study time by day and course: {cells: {'<date>|<course>': minutes}, sessions: [{s, date, minutes, course}]}.
   * Sessions count at sessionMinutes; `ticked` ([{date, course, minutes}], today's ticked tasks) counts too, but a day
   * and course takes the larger of its session time and its ticked minutes, so a task done in a session is not counted
   * twice.
   */
  function studyTime(sessions, { now, courseOf, ticked = [] } = {}) {
    const ses = [],
      byS = {},
      byT = {};
    for (const s of sessions || []) {
      const m = sessionMinutes(s, now);
      if (!m) continue;
      const course = courseOf(s);
      ses.push({ s, date: m.date, minutes: m.minutes, course, running: m.running });
      const k = m.date + '|' + course;
      byS[k] = (byS[k] || 0) + m.minutes;
    }
    for (const t of ticked || []) {
      const mins = Number(t && t.minutes) || 0;
      if (!(mins > 0) || !t.date) continue;
      const k = t.date + '|' + t.course;
      byT[k] = (byT[k] || 0) + mins;
    }
    const cells = {};
    for (const k of new Set([...Object.keys(byS), ...Object.keys(byT)])) cells[k] = Math.max(byS[k] || 0, byT[k] || 0);
    return { cells, sessions: ses };
  }
  /** The minutes of studyTime's cells from `from` to `to` (dates, inclusive), all courses or one. */
  function minutesIn(st, from, to, course = null) {
    let t = 0;
    for (const [k, v] of Object.entries((st && st.cells) || {})) {
      const [d, c] = k.split('|');
      if (d >= from && d <= to && (!course || c === course)) t += v;
    }
    return t;
  }
  /** studyTime's minutes from `from` to `to` by course. */
  function minutesByCourse(st, from, to) {
    const out = {};
    for (const [k, v] of Object.entries((st && st.cells) || {})) {
      const [d, c] = k.split('|');
      if (d >= from && d <= to) out[c] = (out[c] || 0) + v;
    }
    return out;
  }
  return { openSpots, objectiveState, sessionMinutes, studyTime, minutesIn, minutesByCourse };
}
