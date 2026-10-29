// E.V. core's course scope (B-498, B-497): which course a weak spot or a chat note belongs to, by one rule for every
// reader. One factory with no imports, as core's other sections: the same file runs in node (evcore.mjs imports it) and
// in the page (the build writes it into core.js ahead of E.V. core). No course is named here (B-42): the courses come
// from spec.courses (courseTable) and the record's exams.

export function makeCourseScope(core) {
  'use strict';
  const { courseTable, defaultCourse } = core;
  const key = s =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const examCourse = (id, exams) => {
    const e = id ? (exams || []).find(x => x && x.id === id) : null;
    return (e && e.course) || null;
  };
  /** An objective's exam: its own document's, else its id's prefix (E4-3 is E4's). */
  const objectiveExam = (id, objectives) => {
    if (!id) return null;
    const o = (objectives || []).find(x => x && x.id === id);
    return (o && o.exam) || String(id).split('-')[0] || null;
  };
  /**
   * B-498: the course a weak spot counts toward: its objective's exam's course (B-193: an item's own course is its
   * objective's), else its exam's, else the course it was filed under, else the default course. So a spot filed under
   * the wrong course before B-498 shows under its own.
   */
  function spotCourse(w, { exams = [], objectives = [] } = {}) {
    return (
      examCourse(objectiveExam(w && w.objective, objectives), exams) ||
      examCourse(w && w.exam, exams) ||
      (w && w.course) ||
      defaultCourse()
    );
  }
  /** B-497: the course a line names: a course's own name (any spacing or case), else its guess words; null for none. */
  function namedCourse(text, { guess = true } = {}) {
    const t = String(text || '');
    const k = key(t);
    const table = courseTable();
    const byName = table.find(c => key(c.name) && k.includes(key(c.name)));
    if (byName) return byName.name;
    if (!guess) return null;
    const byGuess = table.find(c => c.guess && new RegExp(c.guess, 'i').test(t));
    return byGuess ? byGuess.name : null;
  }
  /** The course of the next exam on or after date that is not done; null when none. */
  function nextExamCourse(exams, date) {
    const next = (exams || [])
      .filter(e => e && DAY.test(String(e.date || '')) && e.date >= date && e.status !== 'done' && e.course)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return next ? next.course : null;
  }
  /**
   * B-497: a chat note's course: a course its own words name, else the conversation's (its recent lines, newest first:
   * a course named, then its guess words), else the next exam's. null when there is none of these.
   */
  function noteCourse({ text = '', recent = [], exams = [], date = '' } = {}) {
    const lines = (recent || []).map(String);
    return (
      namedCourse(text, { guess: false }) ||
      lines.map(l => namedCourse(l, { guess: false })).find(Boolean) ||
      namedCourse(text) ||
      lines.map(l => namedCourse(l)).find(Boolean) ||
      nextExamCourse(exams, date) ||
      null
    );
  }
  /**
   * B-497: a chat note's short title and its whole words: the title is its first line, cut at a word to at most
   * `max` characters with an ellipsis when longer; the body is the rest, or the whole text when the title was cut, so
   * nothing he wrote is lost. {title, body}.
   */
  function noteParts(text, { max = 80 } = {}) {
    const all = String(text || '')
      .replace(/\r\n?/g, '\n')
      .trim();
    const nl = all.indexOf('\n');
    const first = (nl < 0 ? all : all.slice(0, nl)).replace(/\s+/g, ' ').trim();
    const rest = nl < 0 ? '' : all.slice(nl + 1).trim();
    if (first.length <= max) return { title: first, body: rest };
    const cut = first.slice(0, max - 1);
    const at = cut.lastIndexOf(' ');
    return { title: (at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:.–—-]+$/, '') + '…', body: all };
  }
  return { spotCourse, namedCourse, noteCourse, noteParts, nextExamCourse };
}
