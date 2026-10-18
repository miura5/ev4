// The steps a pipeline is made of (Operational architecture, "The run protocol", move 4). A pipeline in the spec
// names its steps; each `code` step is one function here and each `agent` step names the judgment, the material it is
// shown, the shape of its answer and how the answer folds into the plan. Pure: (db, ctx, spec) in, writes out.
//   code step   (db, ctx, spec) -> {writes?: [{op, collection, id, data}], say?: [lines], push?: string}
//   material    (db, ctx, spec) -> any JSON the agent reads before answering
//   fold        (answer, db, ctx, spec) -> {writes?, say?, push?}
// ctx: {runId, pipeline, writer, date (Central), now (ISO), source}; a code step may leave a brief on ctx for the
// agent step after it (compute runs every step again on each call, so nothing is carried between calls).
// A material builder returns {skip: reason} when its agent has nothing to do today.
import EV from './evcore.mjs';
import { produce } from './derive.mjs';

const models = db => EV.buildWeakspots({ weakspots: db.weakspots || [], sets: db.sets || [], answers: db.answers || [], exams: db.exams || [] });
/** Fields a set item may carry (spec/schemas/sets.schema.json); anything else an agent adds is dropped. */
const ITEM_FIELDS = ['type', 'stem', 'options', 'correct', 'rationales', 'matrix', 'weakspotId', 'objective', 'topic', 'cjStep', 'verify', 'sourceRef', 'chapters'];
const pick = (q, keys) => Object.fromEntries(keys.filter(k => q[k] !== undefined).map(k => [k, q[k]]));
/** The library's passages, as the page searches them (D-079): materials Matt can read, minus pictures not yet read. */
function library(db) {
  const mats = EV.liveMaterials(db.materials, db.materialedits).filter(m => !(m.needsOcr && !m.ocr));
  return EV.libraryIndex(EV.libraryChunks(mats));
}
const passages = (idx, q, n = 2) => EV.searchLibrary(idx, q, { k: n }).map(h => ({ ref: 'materials/' + h.id, page: h.page || null, title: h.title, text: h.text.slice(0, 600) }));

export const CODE_STEPS = {
  /** Weak spots whose exam has passed are parked: one event each, appended (never a change to the Fact). */
  'auto-park'(db, ctx) {
    const writes = EV.autoParkEvents({ weakspots: models(db), exams: db.exams || [], date: ctx.date, now: ctx.now, writer: ctx.writer });
    return { writes, say: writes.length ? [`Parked ${writes.length} weak spot(s) whose exam has passed.`] : [] };
  },
  /** state/current: the snapshot, the derived hash and the Fact hashes lint checks against. */
  state(db, ctx, spec) {
    const data = produce(db, spec, 'state', { date: ctx.date, now: ctx.now, specVersion: spec.specVersion }, { source: ctx.source });
    return { writes: [{ op: 'set', collection: 'state', id: 'current', data }], say: [`Snapshot: ${data.snapshot.weakspots.active} active weak spots, ${data.snapshot.due.count} due.`] };
  },
  /** days/<date>: the plan and the list. */
  day(db, ctx, spec) {
    const data = produce(db, spec, 'days', { date: ctx.date, now: ctx.now }, { source: ctx.source });
    return { writes: [{ op: 'set', collection: 'days', id: ctx.date, data }], push: data.push, say: [`Day list: ${data.list.items.length} items.`] };
  },
};

// ------------------------------------------------------------------------------------------------ morning
/** The day's practice to write: review targets, new checks, drills the plan calls for, each with its passages. */
CODE_STEPS['practice-brief'] = function practiceBrief(db, ctx) {
  const ms = models(db); const byId = Object.fromEntries(ms.map(w => [w.id, w]));
  const day = EV.planDay({ date: ctx.date, dates: db.dates || [], dateedits: db.dateedits || [], exams: db.exams || [], plans: db.plans || [], planedits: db.planedits || [], weakspots: ms, objectives: db.objectives || [], sets: db.sets || [], answers: db.answers || [] });
  const setId = 'review-' + ctx.date;
  const existing = (db.sets || []).find(x => x.id === setId);
  const have = !!(existing && (existing.items || []).length);
  const idx = library(db); const objective = id => (db.objectives || []).find(o => o.id === id) || { id, text: '' };
  const targets = have ? [] : day.reviews.ids.map(id => { const w = byId[id]; return { weakspotId: id, topic: w.topic, objective: w.objective, preRead: !!w.derived.preRead, misses: w.derived.misses, recurrence: w.derived.recurrence, lastResult: w.derived.lastResult, history: w.derived.history.slice(-4), passages: passages(idx, w.topic + ' ' + objective(w.objective).text) }; });
  const checks = have ? [] : day.reviews.checks.map(id => { const o = objective(id); return { objective: id, text: o.text || '', chapters: o.chapters || '', passages: passages(idx, (o.text || '') + ' ' + (o.chapters || '')) }; });
  const drills = [];
  for (const b of day.blocks.filter(b => ['drill', 'sim'].includes(b.kind) && !b.done && !b.deferred && b.drill)) {
    if ((db.sets || []).some(x => x.planTaskId === b.taskId)) continue;
    const weakFocused = /weak spot/i.test(b.title);
    const aimed = weakFocused ? EV.rankDue(ms.filter(w => EV.isActive(w) && EV.examOf(w) === b.plan), '9999-12-31', db.exams || []).sort((x, y) => EV.reviewNeed(y) - EV.reviewNeed(x)).slice(0, 15).map(w => ({ weakspotId: w.id, topic: w.topic, objective: w.objective })) : [];
    const topics = aimed.length ? aimed.map(t => t.topic) : [b.title + ' ' + (b.chapters || []).join(' ')];
    drills.push({ setId: `${b.plan}-drill-${b.drill}`, planTaskId: b.taskId, exam: b.plan, title: b.title, count: b.kind === 'sim' ? 30 : 15, chapters: b.chapters || [], objectives: (db.objectives || []).filter(o => o.exam === b.plan).map(o => o.id), targets: aimed, passages: topics.slice(0, 8).flatMap(t => passages(idx, t, 1)) });
  }
  ctx.brief = { date: ctx.date, dayType: day.dayType, review: { setId, exists: have, targets, checks }, drills };
  const say = [`Practice to write: ${targets.length} review target(s), ${checks.length} check(s), ${drills.length} drill(s).`];
  if (day.deferred.length) say.push('Deferred: ' + day.deferred.map(d => `${d.title} (${d.reason})`).join('; '));
  return { say };
};

// ------------------------------------------------------------------------------------------------ weekly
CODE_STEPS['week-brief'] = function weekBrief(db, ctx, spec) {
  const week = produce(db, spec, 'weeks', { date: ctx.date, now: ctx.now }, { source: ctx.source });
  const ms = models(db);
  const ahead = EV.liveDates(db.dates, db.dateedits).filter(d => d.date > ctx.date && d.date <= EV.addDays(ctx.date, 7)).sort((a, b) => (a.date < b.date ? -1 : 1)).map(d => ({ date: d.date, title: d.title, graded: !!d.graded, kind: d.kind }));
  const stillWeak = EV.rankDue(ms.filter(EV.isActive), '9999-12-31', db.exams || []).slice(0, 5).map(w => ({ topic: w.topic, objective: w.objective, recurrence: w.derived.recurrence }));
  ctx.week = { ...week.rollups, calibration: week.calibration, health: week.health, ahead, stillWeak };
  return { say: [`Week ${week.rollups.from}..${week.rollups.to}: ${week.rollups.right}/${week.rollups.answered} right, ${week.rollups.newWeakSpots.length} new weak spots, ${week.rollups.solid.length} made solid.`] };
};

export const AGENT_MATERIAL = {
  'practice-brief'(db, ctx) {
    const b = ctx.brief;
    if (!b || (!b.review.targets.length && !b.review.checks.length && !b.drills.length)) return { skip: b && b.review.exists ? 'today\'s review set already exists and no drill is due' : 'nothing to write today' };
    return b;
  },
  'week-brief'(db, ctx) { return ctx.week; },
  /** What the day looks like, for a one-line note. */
  'day-summary'(db, ctx) {
    const day = (db.days || []).find(d => d.id === ctx.date);
    return { date: ctx.date, dayType: day ? day.dayType : null, items: day ? day.list.items.map(i => i.text) : [] };
  },
};

export const AGENT_FOLDS = {
  /** {review: [items], drills: {setId: [items]}}: today's review set and each drill, keeping only valid items. */
  'practice-sets'(answer, db, ctx) {
    const b = ctx.brief; const writes = []; const say = []; const rejects = [];
    const keep = (raw, kind, id, where) => { const q = { id, kind, ...pick(raw || {}, ITEM_FIELDS) }; const v = EV.validateItem(q, { strict: true }); if (!v.ok) { rejects.push(`${where} ${raw && raw.topic ? raw.topic : id}: ${v.errors.join(', ')}`); return null; } return q; };
    const env = () => EV.envelope('morning', ctx.source, ctx.now);
    if (!b.review.exists && (b.review.targets.length || b.review.checks.length)) {
      const want = new Set(b.review.targets.map(t => t.weakspotId)); const wantChecks = new Set(b.review.checks.map(c => c.objective)); const used = new Set(); const items = [];
      for (const raw of answer.review || []) {
        const key = raw && raw.weakspotId ? raw.weakspotId : 'check:' + (raw && raw.objective);
        if (raw && raw.weakspotId ? !want.has(raw.weakspotId) : !wantChecks.has(raw && raw.objective)) { rejects.push(`review ${raw && raw.topic}: not asked for today`); continue; }
        if (used.has(key)) { rejects.push(`review ${raw.topic}: a second item for the same target`); continue; }
        const q = keep(raw, raw.weakspotId ? 'review' : 'check', 'q' + (items.length + 1), 'review'); if (!q) continue;
        used.add(key); items.push(q);
      }
      if (items.length) { writes.push({ op: 'set', collection: 'sets', id: b.review.setId, data: { ...env(), kind: 'review', date: b.date, title: 'Review · ' + EV.shortDate(b.date), items, createdAt: ctx.now } }); say.push(`Review set: ${items.length} items.`); }
      const missing = [...want].filter(id => !used.has(id)); if (missing.length) say.push(`No usable item for ${missing.join(', ')}.`);
    }
    for (const d of b.drills) {
      const items = [];
      for (const raw of (answer.drills || {})[d.setId] || []) { const q = keep(raw, 'drill', 'd' + (items.length + 1), d.setId); if (!q) continue; if (q.weakspotId && !(db.weakspots || []).some(w => w.id === q.weakspotId)) delete q.weakspotId; items.push(q); }
      if (items.length) { writes.push({ op: 'set', collection: 'sets', id: d.setId, data: { ...env(), kind: 'drill', exam: d.exam, title: d.title, planTaskId: d.planTaskId, objectives: d.objectives, items, createdAt: ctx.now } }); say.push(`Drill ${d.setId}: ${items.length} items.`); }
      else say.push(`Drill ${d.setId}: no usable items.`);
    }
    if (rejects.length) say.push(`Dropped ${rejects.length}: ${rejects.slice(0, 6).join('; ')}`);
    return { writes, say };
  },
  /** {review, reflection, push}: weeks/<Sunday> with the week's roll-ups and the review as written. */
  'week-doc'(answer, db, ctx, spec) {
    const data = produce(db, spec, 'weeks', { date: ctx.date, now: ctx.now }, { source: ctx.source, stored: { review: answer.review, reflection: answer.reflection } });
    return { writes: [{ op: 'set', collection: 'weeks', id: ctx.date, data }], push: answer.push, say: ['Weekly review written.'] };
  },
  /** {push}: the run's push line, as the agent wrote it. */
  'push-line'(answer) { return { push: answer.push }; },
};
