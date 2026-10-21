// E.V. study: the review scheduler (B-68, D-116; the adaptive rule is D-117). Two schedulers pick a day's reviews:
// fixed, today's rule (E.V. core's pickReviews: due open weak spots in priority order, up to the day's load); and
// adaptive, which also draws solid weak spots whose interval has come round, after the open ones, inside the same
// load. spec.study.scheduler says which one drives the morning; the morning writes the other one's pick beside the
// list as days/<date>.shadow, and the weekly compares the two into weeks/<date>.study. Pure functions, no imports:
// the same file runs in node (passed E.V. core) and in the page (published inside core.js as window.EVStudy).

export const SCHEDULERS = ['fixed', 'adaptive'];

/** The scheduler that drives the morning, from spec.study.scheduler (fixed when unset). */
export function schedulerOf(spec) {
  const s = spec && spec.study && spec.study.scheduler;
  return SCHEDULERS.includes(s) ? s : 'fixed';
}
export const otherScheduler = s => (s === 'adaptive' ? 'fixed' : 'adaptive');
const paramsOf = spec => ({ base: 3, cap: 14, nearExam: 1, ...((spec && spec.study && spec.study.params) || {}) });

/**
 * D-117: when a solid weak spot is next due. Solid stays two right days (core's rule); after it, each further right
 * day doubles the interval: base, 2 x base, 4 x base, capped (3, 6, 12, 14 days); inside its exam's window
 * (nearExamWithinDays) the interval is nearExam. Counted from his last review of it. Null for anything not solid.
 */
export function solidDue(EV, w, date, exams, params) {
  const d = w && w.derived;
  if (!d || d.status !== 'reviewed' || !d.lastReviewed || (w.kind || 'concept') !== 'concept') return null;
  const solidDay = d.solidAt ? EV.chicagoDate(d.solidAt) : null;
  const rightDays = new Set(
    (d.history || []).filter(h => h.correct && (!solidDay || h.date > solidDay)).map(h => h.date)
  );
  const exam = (exams || []).find(e => e.id === EV.examOf(w));
  const toExam = exam && exam.date && exam.date >= date ? EV.diffDays(date, exam.date) : null;
  if (exam && exam.date && exam.date < date) return null; // its exam has passed: the evening parks it
  const near = toExam != null && toExam <= EV.constants().review.nearExamWithinDays;
  const days = near ? params.nearExam : Math.min(params.cap, params.base * 2 ** rightDays.size);
  return EV.addDays(d.lastReviewed, days);
}

/** The adaptive pick: the fixed pick, then the solid weak spots due by D-117 in the room left of the day's load. */
function adaptivePick(EV, ctx, params) {
  const base = EV.pickReviews(ctx);
  const due = (ctx.weakspots || [])
    .map(w => ({ w, on: solidDue(EV, w, ctx.date, ctx.exams, params) }))
    .filter(x => x.on && x.on <= ctx.date)
    .sort((a, b) => a.on.localeCompare(b.on) || String(a.w.id).localeCompare(String(b.w.id)))
    .map(x => x.w);
  const room = Math.max(0, base.load.load - base.picked.length);
  return {
    ...base,
    picked: [...base.picked, ...due.slice(0, room)],
    deferred: [
      ...base.deferred,
      ...due
        .slice(room)
        .map(w => ({ id: w.id, topic: w.topic, reason: `solid, due again; over today's load of ${base.load.load}` })),
    ],
  };
}

/** The pickReviews a scheduler uses, for E.V. core's planDay (ctx.pickReviews). */
export function picker(EV, scheduler, spec) {
  if (scheduler === 'fixed') return ctx => EV.pickReviews(ctx);
  const params = paramsOf(spec);
  return ctx => adaptivePick(EV, ctx, params);
}

/** The other scheduler's pick for the day, as days/<date>.shadow holds it: its reviews and what it deferred. */
export function shadowOf(day, scheduler) {
  return {
    scheduler,
    ids: [...((day.reviews && day.reviews.ids) || [])],
    deferred: (day.deferred || []).filter(x => x.kind === 'weakspot').map(x => x.id),
  };
}

/**
 * weeks/<date>.study (D-116): over the week's days that carry a shadow, the weak spots both schedulers picked, the ones
 * only the list picked and only the shadow picked, and how each one-sided pick was answered from that day to the end
 * of the week (right, missed, not answered). Null when no day of the week carries a shadow.
 */
export function compareWeek(days, attempts, { from, to } = {}) {
  const withShadow = (days || [])
    .filter(d => d && d.shadow && Array.isArray(d.shadow.ids) && (!from || d.date >= from) && (!to || d.date <= to))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!withShadow.length) return null;
  const tally = () => ({ picks: 0, right: 0, missed: 0, unanswered: 0 });
  const out = {
    scheduler: null,
    shadow: withShadow[0].shadow.scheduler,
    days: withShadow.length,
    both: 0,
    onlyList: tally(),
    onlyShadow: tally(),
  };
  const by = {};
  for (const a of attempts || []) if (a.weakspotId) (by[a.weakspotId] = by[a.weakspotId] || []).push(a);
  const answered = (id, date) => {
    const later = (by[id] || [])
      .filter(a => a.date >= date && (!to || a.date <= to))
      .sort((a, b) => (a.at < b.at ? -1 : 1));
    return later.length ? (later[0].correct ? 'right' : 'missed') : 'unanswered';
  };
  for (const d of withShadow) {
    const list = new Set((d.plan && d.plan.reviews && d.plan.reviews.ids) || []),
      shadow = new Set(d.shadow.ids);
    out.scheduler = out.scheduler || otherScheduler(d.shadow.scheduler);
    for (const id of list) if (shadow.has(id)) out.both++;
    for (const [side, mine, theirs] of [
      ['onlyList', list, shadow],
      ['onlyShadow', shadow, list],
    ])
      for (const id of [...mine].sort())
        if (!theirs.has(id)) {
          out[side].picks++;
          out[side][answered(id, d.date)]++;
        }
  }
  return out;
}
