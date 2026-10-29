// E.V. core's course scope (B-498): which course a weak spot belongs to, by one rule for every
// reader. One factory with no imports, as core's other sections: the same file runs in node (evcore.mjs imports it) and
// in the page (the build writes it into core.js ahead of E.V. core). No course is named here (B-42): the courses come
// from spec.courses (courseTable) and the record's exams.

export function makeCourseScope(core) {
  'use strict';
  const { defaultCourse } = core;
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
  return { spotCourse };
}
