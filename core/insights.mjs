// E.V. core's insights: readiness and its prediction, answer statistics, calibration, the exam retrospective and the
// readiness audit. Split from core/evcore.mjs (B-159, D-166) as one factory with no imports, so the same file
// runs in node (evcore.mjs imports it) and in the page (the build writes it into core.js ahead of E.V. core). It takes
// the core names it uses and returns the names the rest of core and core's export map use.

export function makeInsights(core) {
  'use strict';
  const {
    addDays,
    citeMaterial,
    collectAttempts,
    diffDays,
    examOf,
    isActive,
    isSolid,
    untriaged,
    planTasks,
    reviewNeed,
    searchLibrary,
    taskDone,
  } = core;

  // ---------------------------------------------------------------- insights
  function answerStats(attempts, { date, days = 7 } = {}) {
    const tally = key => {
      const m = {};
      for (const a of attempts) {
        const k = key(a);
        if (k == null) continue;
        const s = (m[k] = m[k] || { right: 0, n: 0, score: 0 });
        s.n++;
        s.score += a.score;
        if (a.correct) s.right++;
      }
      return m;
    };
    const byDate = tally(a => a.date);
    const lastDays = [];
    if (date)
      for (let i = days - 1; i >= 0; i--) {
        const d = addDays(date, -i);
        lastDays.push({ date: d, ...(byDate[d] || { right: 0, n: 0, score: 0 }) });
      }
    return {
      byObjective: tally(a => a.objective || '—'),
      byType: tally(a => a.type),
      byCjStep: tally(a => a.cjStep || null),
      byDate,
      lastDays,
      total: attempts.length,
      right: attempts.filter(a => a.correct).length,
    };
  }
  function readiness({ examId, weakspots }) {
    const active = weakspots.filter(w => isActive(w) && examOf(w) === examId);
    const solid = weakspots.filter(w => isSolid(w) && examOf(w) === examId).length;
    const need = active.reduce((s, w) => s + reviewNeed(w), 0);
    const one = active.filter(w => !w.derived.preRead && (w.derived.streak || 0) >= 1).length;
    const preRead = active.filter(w => w.derived.preRead).length;
    const total = active.length + solid;
    return {
      examId,
      active: active.length,
      solid,
      need,
      rightOnce: one,
      preRead,
      notYet: active.length - one - preRead,
      pctSolid: total ? Math.round((100 * solid) / total) : null,
    };
  }
  /**
   * The readiness audit (Features: "Readiness audit"): per objective of an exam, its weak spots solid, right once and
   * not yet, the topics not yet right, and with a library index the passages to reread for them (cited by file and
   * page). Objectives with the most not yet first; objectives with no weak spots are left out.
   * {examId, objectives, weakspots, index?, k?} -> [{id, text, solid, rightOnce, notYet, preRead, topics, passages}]
   */
  function readinessAudit({ examId, objectives = [], weakspots = [], index = null, k = 2 } = {}) {
    const mine = weakspots.filter(
      w =>
        (w.kind || 'concept') === 'concept' &&
        examOf(w) === examId &&
        w.derived &&
        !['parked', 'moved'].includes(w.derived.status) &&
        !untriaged(w) // B-232 (D-235): proposed, snoozed, declined and duplicate spots count nowhere
    );
    const rows = [];
    for (const o of objectives.filter(o => o.exam === examId || String(o.id).split('-')[0] === examId)) {
      const ws = mine.filter(w => w.objective === o.id);
      if (!ws.length) continue;
      const open = ws.filter(isActive);
      const notYetWs = open.filter(w => !w.derived.preRead && (w.derived.streak || 0) === 0);
      const row = {
        id: o.id,
        text: o.text || '',
        solid: ws.filter(isSolid).length,
        rightOnce: open.filter(w => !w.derived.preRead && (w.derived.streak || 0) >= 1).length,
        notYet: notYetWs.length,
        preRead: open.filter(w => w.derived.preRead).length,
        topics: notYetWs.map(w => w.topic).slice(0, 3),
        passages: [],
      };
      if (index && (row.notYet || row.rightOnce)) {
        const q = (row.topics.length ? row.topics : open.map(w => w.topic)).join(' ') + ' ' + row.text;
        const seen = new Set();
        for (const h of searchLibrary(index, q, { k: k + 3 })) {
          const key = h.id + '#' + (h.page || '');
          if (seen.has(key)) continue;
          seen.add(key);
          row.passages.push({ id: h.id, page: h.page || null, cite: citeMaterial(h) });
          if (row.passages.length >= k) break;
        }
      }
      rows.push(row);
    }
    return rows.sort(
      (a, b) => b.notYet - a.notYet || b.rightOnce - a.rightOnce || String(a.id).localeCompare(String(b.id))
    );
  }
  /** D-042 prediction: transparent, deterministic, and checked against the score afterward. */
  function predictReadiness({ examId, exams, weakspots, attempts, date, now }) {
    const past = (exams || []).filter(e => e.kind === 'unit' && typeof e.score === 'number');
    const pastAvg = past.length ? past.reduce((s, e) => s + e.score, 0) / past.length : null;
    const rel = (attempts || []).filter(a => a.objective && String(a.objective).startsWith(examId + '-'));
    const last7 = rel.filter(a => a.date && diffDays(a.date, date) <= 7 && diffDays(a.date, date) >= 0);
    const acc7 = last7.length ? last7.reduce((s, a) => s + a.score, 0) / last7.length : null;
    const r = readiness({ examId, weakspots });
    let center =
      pastAvg != null && acc7 != null
        ? 0.5 * pastAvg + 0.5 * 100 * acc7
        : pastAvg != null
          ? pastAvg
          : acc7 != null
            ? 100 * acc7
            : null;
    if (center == null) return null;
    if (r.pctSolid != null) center += (r.pctSolid / 100 - 0.5) * 6;
    const lo = Math.max(0, Math.round(center - 4)),
      hi = Math.min(100, Math.round(center + 4));
    return {
      at: new Date(now || Date.now()).toISOString(),
      percentSolid: r.pctSolid,
      activeWeakSpots: r.active,
      accuracyLast7: acc7 != null ? Math.round(1000 * acc7) / 10 : null,
      answersLast7: last7.length,
      predictedRange: [lo, hi],
      basis: [
        pastAvg != null ? `past unit exams average ${Math.round(pastAvg * 10) / 10}` : null,
        acc7 != null
          ? `${Math.round(acc7 * 100)}% on ${examId} questions in the last 7 days (${last7.length} answers)`
          : null,
        r.pctSolid != null ? `${r.pctSolid}% of ${examId} weak spots solid` : null,
      ]
        .filter(Boolean)
        .join('; '),
    };
  }
  /**
   * An exam as readers see it (D-094): the Fact, with Matt's score and any status override from examedits/<id> and the
   * night-before prediction from predictions/<id>. Nothing of either is stored on the exam.
   */
  function examView(exam, edit, prediction) {
    if (!exam) return exam;
    const v = { ...exam };
    if (edit) {
      if (typeof edit.score === 'number') v.score = edit.score;
      if (edit.scoreAt) v.scoreAt = edit.scoreAt;
      if (edit.status) v.status = edit.status;
    }
    if (prediction && Array.isArray(prediction.predictedRange)) {
      const { schema, writer, source, examId, ...p } = prediction;
      v.prediction = p;
    }
    return v;
  }
  function examViews(exams, examedits, predictions) {
    const e = new Map((examedits || []).map(x => [x.id, x])),
      p = new Map((predictions || []).map(x => [x.id, x]));
    return (exams || []).map(x => examView(x, e.get(x.id), p.get(x.id)));
  }
  function calibrate(exam) {
    if (!exam || !exam.prediction || typeof exam.score !== 'number') return null;
    const [lo, hi] = exam.prediction.predictedRange;
    const mid = (lo + hi) / 2;
    return {
      score: exam.score,
      predictedRange: [lo, hi],
      inRange: exam.score >= lo && exam.score <= hi,
      error: Math.round((exam.score - mid) * 10) / 10,
    };
  }
  /**
   * The post-exam retro (D-104): the night-before prediction against the score Matt typed (calibrate on the exam's
   * view), accuracy by objective from E.V.'s own practice answers on that exam up to its date, the exam's weak spots
   * made solid and still open (an auto-parked one is still open: it was never made solid), and the plan tasks ticked
   * and left. Only E.V.'s sets and his answers to them and the score he entered; never the exam's questions or his
   * graded answers. Returns null for an unknown exam. weakspots are models (buildWeakspots); plans are planViews.
   */
  function examRetro({ examId, exams, examedits, predictions, sets, answers, weakspots, plans, objectives } = {}) {
    const exam = examViews(exams || [], examedits || [], predictions || []).find(e => e.id === examId);
    if (!exam) return null;
    const until = exam.date || '9999-12-31';
    const atts = collectAttempts(sets || [], answers || []).all.filter(
      a => a.objective && String(a.objective).startsWith(examId + '-') && a.date <= until
    );
    const pctOf = (r, n) => (n ? Math.round((1000 * r) / n) / 10 : null);
    const objText = new Map((objectives || []).map(o => [o.id, o.text || '']));
    const byObjective = Object.entries(answerStats(atts).byObjective)
      .map(([id, s]) => ({ id, text: objText.get(id) || '', right: s.right, n: s.n, pct: pctOf(s.right, s.n) }))
      .sort((a, b) => a.right / a.n - b.right / b.n || b.n - a.n || (a.id < b.id ? -1 : 1));
    const mine = (weakspots || []).filter(
      w =>
        (w.kind || 'concept') === 'concept' &&
        examOf(w) === examId &&
        w.derived &&
        w.derived.status !== 'moved' &&
        !untriaged(w) // B-232
    );
    const byNeed = (a, b) =>
      (b.derived.recurrence || 1) - (a.derived.recurrence || 1) ||
      (b.derived.misses || 0) - (a.derived.misses || 0) ||
      (a.id < b.id ? -1 : 1);
    const solid = mine.filter(isSolid),
      open = mine.filter(w => !isSolid(w)).sort(byNeed);
    const ticked = [],
      left = [];
    for (const p of (plans || []).filter(x => (x.exam || x.id) === examId))
      for (const t of planTasks(p)) {
        if (t.date > until) continue;
        (taskDone(p, t, until, sets, answers) ? ticked : left).push({
          date: t.date,
          text: t.text,
          kind: t.kind || null,
        });
      }
    const pred = exam.prediction
      ? { predictedRange: exam.prediction.predictedRange, basis: exam.prediction.basis || '' }
      : null;
    return {
      examId,
      title: exam.title || examId,
      date: exam.date || null,
      score: typeof exam.score === 'number' ? exam.score : null,
      prediction: pred,
      calibration: calibrate(exam),
      practice: {
        answered: atts.length,
        right: atts.filter(a => a.correct).length,
        pct: pctOf(atts.filter(a => a.correct).length, atts.length),
        byObjective,
      },
      weakSpots: {
        solid: solid.length,
        open: open.length,
        openTopics: open
          .slice(0, 8)
          .map(w => ({ topic: w.topic, objective: w.objective || null, recurrence: w.derived.recurrence || 1 })),
      },
      plan: { tasks: ticked.length + left.length, ticked: ticked.length, left: left.slice(0, 10) },
    };
  }

  return { answerStats, readiness, readinessAudit, predictReadiness, examViews, calibrate, examRetro };
}
