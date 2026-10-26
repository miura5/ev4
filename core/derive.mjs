// Derived documents and how each is produced (Data architecture, "Derivation and the nightly zero-mismatch rebuild").
// A producer is the one function a pipeline computes a Derived document with; `rebuild` runs the same function on
// the record as it stood at the stored document's time, so the two cannot disagree unless the code or a later Edit
// changed. Pure: the record goes in as {collection: [docs with id]}, data comes out. The rule this puts on a run
// (core/run.mjs compute): each step sees the writes of the steps before it, and every write is stamped with the
// run's one compute time, so the record a Derived document was computed from is exactly the record as of its `at`.
import EV from './evcore.mjs';
import * as STUDY from './study.mjs';
import { healthBody } from './watch.mjs';
import { loadSchemas, PAGE_ONLY } from './schemas.mjs';

const ms = x => EV.toMs(x);

/** The class of one document: a collection's own, or the one its spec `documents` entry names (talk/memory). */
export function classOf(spec, collection, id) {
  const c = spec.collections[collection];
  if (!c) return null;
  const d = c.documents && c.documents[id];
  return (d && d.class) || c.class;
}
/** Who may write one document: the collection's writers, or its `documents` entry's. */
export function writersOf(spec, collection, id) {
  const c = spec.collections[collection];
  if (!c) return [];
  const d = c.documents && c.documents[id];
  return (d && d.writers) || c.writers || [];
}

// An append map keeps entries keyed <writer>-<YYYYMMDD-HHMMSSmmm>. answers/<setId>.answers nests one level
// (item id -> attempts); every other append map is flat.
// The key patterns the schemas allow: <writer>-<YYYYMMDD-HHMMSS[mmm]>[-n], and talk's m-<time>-<by>, where a message
// by the worker is "job" and every other one is the page's.
const EVENT_KEY = /^([a-z][a-z-]*)-\d{8}-\d{6}(?:\d{3})?(?:-[a-z0-9]+)?$/;
const TALK_KEY = /^m-\d{8}-\d{6}(?:\d{3})?-([a-z]+)$/;
/** Who appended an entry, from its key; null when the key is not an append key (the schema reports it). */
export function keyWriter(collection, field, key) {
  if (collection === 'talk' && field === 'messages') {
    const m = TALK_KEY.exec(key);
    return m ? (m[1] === 'job' ? 'worker' : 'page') : null;
  }
  const m = EVENT_KEY.exec(key);
  return m ? m[1] : null;
}
export const appendDepth = (collection, field) => (collection === 'answers' && field === 'answers' ? 2 : 1);
/** Every entry of an append map as [path, key, value], at its depth. */
export function appendEntries(value, depth, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  if (depth <= 1) return Object.entries(value).map(([k, v]) => [prefix + k, k, v]);
  return Object.entries(value).flatMap(([k, v]) => appendEntries(v, depth - 1, prefix + k + '.'));
}
function cutMap(value, at, depth) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (depth > 1) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cutMap(v, at, depth - 1)]));
  return Object.fromEntries(Object.entries(value).filter(([k, v]) => !(ms(EV.entryTime(k, v)) > at)));
}

/**
 * The record as it stood at `at`: documents created by then, their append maps cut to entries made by then. An Edit
 * is replaced whole, so one changed since `at` cannot be wound back; it is used as it is now and named in `inexact`.
 * Config documents (system/*) are always current. The journal and his notes are left out: no pipeline reads them (D-059, D-325).
 */
export function asOf(db, at, spec, { since = null, self = null } = {}) {
  const t = ms(at);
  const s = since == null ? null : ms(since);
  const out = {};
  const inexact = [];
  // What changed while the producing run ran (after its start, by its write): its pull may have seen the version before.
  const during = (col, d) =>
    s != null &&
    !(col === 'runs' && d.id === self) &&
    [d.at, d.endedAt, d.updatedAt].some(x => Number.isFinite(ms(x)) && ms(x) > s && ms(x) <= t);
  for (const [col, docs] of Object.entries(db || {})) {
    const c = spec.collections[col];
    if (!c || PAGE_ONLY.includes(col)) continue; // no producer reads the journal or his notes (D-059, D-325)
    const appends = Object.keys(c.appends || {});
    out[col] = [];
    for (const d of docs || []) {
      if (!d) continue;
      const cls = classOf(spec, col, d.id);
      if (cls === 'Config') {
        out[col].push(d);
        continue;
      }
      // A Derived document rewritten since: the version this time saw is gone. One dated after this time (days/<date>,
      // weeks/<date>: B-170's morning reads the weeks) did not exist yet, so nothing was lost.
      if (Number.isFinite(ms(d.at)) && ms(d.at) > t) {
        if (cls === 'Derived' && !(/^\d{4}-\d{2}-\d{2}$/.test(d.id) && d.id > EV.chicagoDate(at)))
          inexact.push(`${col}/${d.id}`);
        continue;
      }
      if (during(col, d)) inexact.push(`${col}/${d.id}`);
      if (cls === 'Edit') {
        if (ms(d.updatedAt || d.at) > t) inexact.push(`${col}/${d.id}`);
        out[col].push(d);
        continue;
      }
      // A run's ledger entry is written at its start and completed at its end: before its end it was still running.
      if (col === 'runs' && d.endedAt && ms(d.endedAt) > t) {
        const { steps, planHash, push, ...open } = d;
        out[col].push({ ...open, status: 'running', endedAt: null });
        continue;
      }
      if (!appends.length) {
        out[col].push(d);
        continue;
      }
      const cut = { ...d };
      for (const f of appends) if (cut[f]) cut[f] = cutMap(cut[f], t, appendDepth(col, f));
      out[col].push(cut);
    }
  }
  return { db: out, inexact };
}

/** Weak spot models, dates and plans as every producer sees them. */
function views(db) {
  const exams = EV.examViews(db.exams, db.examedits, db.predictions),
    sets = db.sets || [],
    answers = db.answers || [];
  return {
    exams,
    sets,
    answers,
    models: EV.buildWeakspots({ weakspots: db.weakspots || [], sets, answers, exams }),
    dates: EV.liveDates(db.dates, db.dateedits),
    plans: EV.planViews(db.plans, db.planedits),
  };
}

/** sha256 of a Fact's own fields: everything but its envelope's time and its append maps. */
// B-32 (D-089): a Fact's own fields are write-once: set once, never changed. Its marks (spec.collections.<c>.marks)
// change in place by their named roles and its append maps gain keys, so neither is hashed. A fact hash is
// "<sha256>.<mask>": the hash of the fields present when it was taken, and which of the collection's hashed fields
// (factFields, kept beside the hashes in state/current) those were, so a field set for the first time later (a
// session's summary when it ends, a canvasId on a hand-entered date) is a first write, not a change.
let SCHEMAS = null;
/** The fields a Fact's hash covers: its schema's properties less at, its append maps and its marks, sorted. */
export function factFields(spec, collection) {
  const c = spec.collections[collection] || {};
  SCHEMAS = SCHEMAS || loadSchemas();
  const props = Object.keys((SCHEMAS[collection] || {}).properties || {});
  const skip = new Set(['at', ...Object.keys(c.appends || {}), ...Object.keys(c.marks || {})]);
  return props.filter(k => !skip.has(k)).sort();
}
/** The hash of a Fact's own fields: those present (or exactly `only`), indexed against `fields`. */
export function factHash(spec, collection, doc, { fields = factFields(spec, collection), only = null } = {}) {
  const data = EV.docData(doc);
  const covered = only || fields.filter(k => data[k] !== undefined);
  const body = Object.fromEntries(covered.map(k => [k, data[k] === undefined ? null : data[k]]));
  let mask = 0n;
  for (const k of covered) {
    const i = fields.indexOf(k);
    if (i >= 0) mask |= 1n << BigInt(i);
  }
  return EV.sha256(EV.stableStringify(body)) + '.' + mask.toString(36);
}
const fromBase36 = t => [...String(t)].reduce((n, ch) => n * 36n + BigInt(parseInt(ch, 36)), 0n);
/**
 * Whether a Fact still matches the hash state/current kept for it: every field it had then holds the same value.
 * {ok: true} | {ok: false, why} | {ok: null} when the stored hash predates masks (nothing to compare against).
 */
export function factCheck(spec, collection, doc, stored, fields) {
  const [, m] = String(stored || '').split('.');
  if (m === undefined || !fields) return { ok: null };
  const mask = fromBase36(m);
  const had = fields.filter((_, i) => (mask >> BigInt(i)) & 1n);
  if (factHash(spec, collection, doc, { fields, only: had }) === stored) return { ok: true };
  const data = EV.docData(doc);
  const gone = had.filter(k => data[k] === undefined);
  return { ok: false, why: gone.length ? `${gone.join(', ')} removed` : `one of ${had.join(', ')} changed` };
}

// ------------------------------------------------------------------------------------------------ producers
// Each: {writer, id(stored) -> the inputs it needs besides the record, build(db, inputs, spec) -> data (no envelope)}.

/**
 * D-105 (B-48): readiness per upcoming exam of every active course as of `date`: percent solid, active and solid weak
 * spots, and accuracy on the exam's objectives over the last seven days (the window predictReadiness uses), so the
 * Progress tab can draw it over time. {<examId>: {pctSolid, active, solid, accuracy7, answers7}}.
 */
export function readinessStamp(v, date) {
  const atts = EV.collectAttempts(v.sets, v.answers).all.filter(a => a.date && a.date <= date);
  const out = {};
  for (const e of EV.nextExams(v.exams, date)) {
    const r = EV.readiness({ examId: e.id, weakspots: v.models });
    const last7 = atts.filter(
      a =>
        String(a.objective || '').startsWith(e.id + '-') &&
        EV.diffDays(a.date, date) <= 7 &&
        EV.diffDays(a.date, date) >= 0
    );
    const score = last7.reduce((s, a) => s + a.score, 0);
    out[e.id] = {
      pctSolid: r.pctSolid,
      active: r.active,
      solid: r.solid,
      accuracy7: last7.length ? Math.round((1000 * score) / last7.length) / 10 : null,
      answers7: last7.length,
    };
  }
  return out;
}

/**
 * D-120 (B-72): weeks/<date>.insights, the week's measurements for what plans next, computed by code. Accuracy by
 * objective, format and clinical-judgment step over the last 28 days (four weeks, so an objective has answers enough to
 * rank), each with its counts; the items that discriminate (missed on every attempt, at least two, against those never
 * missed); the recurrence leaders; and each day of the week's study minutes (sessions) and check-in energy against the
 * next day's accuracy. weakestObjective is the lowest-accuracy objective with at least three answers; lines are the
 * three the Progress tab shows. The weekly's review interprets these numbers; it never recomputes them.
 */
export function weekInsights(v, db, date) {
  const from28 = EV.addDays(date, -27),
    from7 = EV.addDays(date, -6);
  const all = EV.collectAttempts(v.sets, v.answers).all.filter(a => a.date && a.date <= date);
  const atts = all.filter(a => a.date >= from28);
  const pct = (r, n) => (n ? Math.round((100 * r) / n) : null);
  const group = key => {
    const m = {};
    for (const a of atts) {
      const k = key(a);
      if (!k) continue;
      const g = (m[k] = m[k] || { right: 0, n: 0 });
      g.n++;
      if (a.correct) g.right++;
    }
    return Object.entries(m)
      .map(([id, g]) => ({ id, right: g.right, n: g.n, pct: pct(g.right, g.n) }))
      .sort((a, b) => a.pct - b.pct || b.n - a.n || (a.id < b.id ? -1 : 1));
  };
  const byObjective = group(a => a.objective);
  const byItem = {};
  for (const a of atts) {
    const k = a.setId + '#' + a.itemId;
    const it = (byItem[k] = byItem[k] || {
      ref: 'sets/' + k,
      topic: a.topic,
      objective: a.objective,
      attempts: 0,
      missed: 0,
    });
    it.attempts++;
    if (!a.correct) it.missed++;
  }
  const items = Object.values(byItem).filter(i => i.attempts >= 2);
  const missedEvery = items
    .filter(i => i.missed === i.attempts)
    .sort((a, b) => b.attempts - a.attempts || (a.ref < b.ref ? -1 : 1))
    .slice(0, 5);
  const recurrence = v.models
    .filter(w => (w.derived.recurrence || 1) > 1 && w.derived.status !== 'parked' && !EV.untriaged(w))
    .sort((a, b) => b.derived.recurrence - a.derived.recurrence || (a.id < b.id ? -1 : 1))
    .slice(0, 5)
    .map(w => ({ weakspotId: w.id, topic: w.topic, recurrence: w.derived.recurrence }));
  const edits = Object.fromEntries((db.dayedits || []).map(e => [e.id || e.date, e]));
  const studyVsNextDay = [];
  for (let d = from7; d <= date; d = EV.addDays(d, 1)) {
    const next = EV.addDays(d, 1);
    const na = all.filter(a => a.date === next);
    const minutes = (db.sessions || [])
      .filter(s => s.date === d && s.status !== 'discarded')
      .reduce((n, s) => n + (Number(s.minutes) || 0), 0);
    const ci = edits[d] && edits[d].checkin;
    studyVsNextDay.push({
      date: d,
      minutes,
      energy: ci ? ci.energy : null,
      nextAnswers: next <= date ? na.length : null,
      nextPct: next <= date ? pct(na.filter(a => a.correct).length, na.length) : null,
    });
  }
  const weakest = byObjective.find(o => o.n >= 3) || null;
  const lines = [];
  if (weakest)
    lines.push(`Weakest objective: ${weakest.id}, ${weakest.right} of ${weakest.n} right (${weakest.pct}%).`);
  if (missedEvery.length)
    lines.push(
      `Missed every time: ${missedEvery[0].topic || missedEvery[0].ref} (${missedEvery[0].missed} of ${missedEvery[0].attempts}).`
    );
  if (recurrence.length) lines.push(`Back most often: ${recurrence[0].topic} (${recurrence[0].recurrence} times).`);
  const studied = studyVsNextDay.filter(x => x.minutes > 0 && x.nextAnswers);
  const rest = studyVsNextDay.filter(x => !x.minutes && x.nextAnswers);
  if (lines.length < 3 && studied.length && rest.length) {
    const avg = xs => Math.round(xs.reduce((n, x) => n + x.nextPct, 0) / xs.length);
    lines.push(`After a study session the next day ran ${avg(studied)}%; after none, ${avg(rest)}%.`);
  }
  return {
    window: { from: from28, to: date },
    byObjective,
    byFormat: group(a => a.type),
    byCjStep: group(a => a.cjStep),
    missedEvery,
    neverMissed: items.filter(i => i.missed === 0).length,
    recurrence,
    studyVsNextDay,
    weakestObjective: weakest ? weakest.id : null,
    lines: lines.slice(0, 3),
  };
}

/** days/<date>, the morning run: the plan and the list at 4:25am. */
function dayBody(db, { date, now }, spec, stored) {
  const v = views(db);
  // B-68 (D-116): spec.study.scheduler drives the day; the other scheduler's pick is the shadow beside it.
  const scheduler = STUDY.schedulerOf(spec);
  // B-170 (D-120, D-190): spec.study.aim says what the new checks lead with; the other aim's checks are the day's aim.
  const aim = STUDY.aimOf(spec);
  const weeks = db.weeks || [];
  const dayCtx = (sched, a = aim) => ({
    date,
    dates: db.dates || [],
    dateedits: db.dateedits || [],
    exams: v.exams,
    plans: db.plans || [],
    planedits: db.planedits || [],
    weakspots: v.models,
    objectives: db.objectives || [],
    sets: v.sets,
    answers: v.answers,
    pickReviews: STUDY.dayPicker(EV, spec, { weeks, date }, { scheduler: sched, aim: a }),
  });
  const day = EV.planDay(dayCtx(scheduler));
  const other = STUDY.otherScheduler(scheduler);
  // A day written before the shadow existed (migrated with shadow null) rebuilds as it was written.
  const shadow = stored && stored.shadow === null ? null : STUDY.shadowOf(EV.planDay(dayCtx(other)), other);
  // A day written before the aim existed (migrated with aim null) rebuilds as it was written.
  const aimDoc =
    stored && stored.aim === null
      ? null
      : STUDY.aimRecord(aim, STUDY.weakestOf(EV, weeks, date), EV.planDay(dayCtx(scheduler, STUDY.otherAim(aim))));
  const reviewSet = v.sets.find(s => s.id === 'review-' + date) || null;
  const reviewSetId = reviewSet ? reviewSet.id : null;
  const newSets = v.sets.filter(
    s => s.kind !== 'review' && s.kind !== 'more' && EV.chicagoDate(s.at || s.createdAt || '') === date
  );
  // New on Canvas: announcements the sync brought in during the 24 hours before this run.
  const since = ms(now) - 864e5;
  const canvasFlags = (db.announcements || [])
    .filter(a => ms(a.at) > since && ms(a.at) <= ms(now))
    .sort((a, b) => ms(a.at) - ms(b.at) || (a.id < b.id ? -1 : 1))
    .map(a => ({ id: a.id, text: 'New on Canvas: ' + (a.title || 'announcement'), ref: 'announcements/' + a.id }));
  const notes = v.models.filter(w => w.kind === 'note' && w.derived.status === 'open');
  const focus = EV.rankDue(v.models, date, v.exams)
    .sort(
      (a, b) =>
        (b.derived.recurrence || 1) - (a.derived.recurrence || 1) || (b.derived.misses || 0) - (a.derived.misses || 0)
    )
    .slice(0, 3);
  const list = EV.buildDayList(day, { reviewSetId, newSets, canvasFlags, notes, focus, sets: v.sets });
  const open = reviewSet ? (reviewSet.items || []).length - EV.answeredItems(reviewSet, v.answers).length : 0;
  list.push = list.push.replace(/\d+ reviews? ready/, `${open} review${open === 1 ? '' : 's'} ready`);
  return {
    schema: 4, // B-68: the shadow; B-48: readiness; B-170: the aim
    date,
    dayType: day.dayType,
    plan: { budget: day.budget, blocks: day.blocks, deferred: day.deferred, reviews: day.reviews },
    list,
    push: list.push,
    shadow,
    // A day written before the stamp existed (migrated with readiness null) rebuilds as it was written.
    readiness: stored && stored.readiness === null ? null : readinessStamp(v, date),
    aim: aimDoc,
  };
}

/** state/current, the evening-cloud run: the snapshot, the derived hash, and every Fact's hash for lint. */
function stateBody(all, { date, now, specVersion, release = null, part = null, split = null, lint = null }, spec) {
  // What the evening-cloud run pulls and nothing else, so a rebuild from a fuller export (debug, say) counts the same.
  const reads = new Set(((spec.pipelines['evening-cloud'] || {}).reads || []).map(r => r.collection));
  const db = reads.size ? Object.fromEntries(Object.entries(all).filter(([c]) => reads.has(c))) : all;
  const v = views(db);
  // The counts are of what the run reads: state/current leaves itself out (the run sees the previous one, a rebuild
  // the one it wrote), and Config (system/*) is the deploy's, not the record's.
  const counts = Object.fromEntries(
    Object.entries(db)
      .filter(
        ([k, d]) =>
          k !== 'state' &&
          spec.collections[k] &&
          spec.collections[k].class !== 'Config' &&
          !spec.collections[k].retired &&
          d.length
      )
      .map(([k, d]) => [k, d.length])
      .sort(([a], [b]) => (a < b ? -1 : 1))
  );
  const content = EV.lint({ ...db, journal: [], notes: [], weakspotModels: v.models, counts }, { date });
  // Bytes for the collections a byte budget watches (D-093). state leaves itself out, as the counts do (it cannot
  // measure the document it is writing); lint measures it.
  const budgets = (spec.capacity && spec.capacity.collections) || {};
  const bytes = Object.fromEntries(
    Object.entries(budgets)
      .filter(([c, b]) => c !== 'state' && b && (b.warnBytes != null || b.failBytes != null) && db[c])
      .map(([c]) => [c, db[c].reduce((s, d) => s + Buffer.byteLength(JSON.stringify(EV.docData(d)), 'utf8'), 0)])
  );
  const snapshot = EV.buildSnapshot({
    date,
    now,
    exams: v.exams,
    weakspots: v.models,
    sets: v.sets,
    answers: v.answers,
    days: db.days || [],
    dates: db.dates || [],
    dateedits: db.dateedits || [],
    plans: db.plans || [],
    planedits: db.planedits || [],
    runs: db.runs || [],
    counts,
    bytes,
    budgets,
    // B-149: the release is the run's own (its manifest), an input like specVersion; core carries none.
    versions: { spec: specVersion || null, release: release || null },
    lint: content,
    canvas: null,
    // B-107: tomorrow's prep check from the library the run reads (pictures not read yet left out) and his own items.
    materials: EV.liveMaterials(db.materials || [], db.materialedits || []).filter(m => !(m.needsOcr && !m.ocr)),
    dayedits: db.dayedits || [],
    announcements: db.announcements || [], // B-189: the Canvas announcements that name tomorrow
  });
  const factHashes = {};
  const fieldLists = {};
  for (const [col, docs] of Object.entries(db).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (PAGE_ONLY.includes(col)) continue; // pipelines never read them (D-059, D-325)
    for (const d of [...docs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (classOf(spec, col, d.id) !== 'Fact') continue;
      const fields = (fieldLists[col] = fieldLists[col] || factFields(spec, col));
      factHashes[`${col}/${d.id}`] = factHash(spec, col, d, { fields });
    }
  }
  // D-090: the record lint the state step ran on this run's pull. It is an input, not recomputed here: lint itself
  // rebuilds state/current, so rebuild takes it as stored, as it takes the date and spec version.
  const linted = lint ? { lint } : {};
  const full = { snapshot, derivedHash: snapshot.derivedHash, factHashes, factFields: fieldLists, ...linted };
  // B-37 (D-093): state/current past its warnBytes keeps the snapshot; each collection's fact hashes move to
  // state/facts-<collection>. `split` (from the stored document, or the state step's measure) says which.
  if (part)
    return {
      facts: part,
      factHashes: Object.fromEntries(Object.entries(factHashes).filter(([ref]) => ref.split('/')[0] === part)),
      factFields: { [part]: fieldLists[part] || [] },
    };
  if (!split || !split.length) return full;
  const keep = Object.fromEntries(Object.entries(factHashes).filter(([ref]) => !split.includes(ref.split('/')[0])));
  const keepFields = Object.fromEntries(Object.entries(fieldLists).filter(([c]) => !split.includes(c)));
  return {
    snapshot,
    derivedHash: snapshot.derivedHash,
    factHashes: keep,
    factFields: keepFields,
    factsSplit: split,
    ...linted,
  };
}
/** The collections whose fact hashes move out of state/current: all of them once the whole document reaches warnBytes. */
export function factsSplitFor(spec, body) {
  const b = ((spec.capacity || {}).collections || {}).state || {};
  if (b.warnBytes == null || Buffer.byteLength(JSON.stringify(body), 'utf8') < b.warnBytes) return [];
  return Object.keys(body.factFields || {}).sort();
}
/** Every fact hash and field list state keeps, from state/current and any state/facts-<collection>. */
export function knownFacts(stateDocs) {
  const hashes = {},
    fields = {};
  for (const d of stateDocs || [])
    if (d.id === 'current' || /^facts-/.test(d.id)) {
      Object.assign(hashes, d.factHashes || {});
      Object.assign(fields, d.factFields || {});
    }
  return { hashes, fields };
}

/** weeks/<Sunday>, the weekly run: the week's roll-ups, calibration and health line. The review and reflection are
 *  the run's own writing (an agent step), kept as written. */
function weekBody(db, { date, verify = null, recap = null }, spec, stored) {
  const v = views(db);
  const from = EV.addDays(date, -6);
  const atts = EV.collectAttempts(v.sets, v.answers).all.filter(a => a.date >= from && a.date <= date);
  const stats = EV.answerStats(atts, { date });
  const added = v.models.filter(
    w => w.addedAt && EV.chicagoDate(w.addedAt) >= from && EV.chicagoDate(w.addedAt) <= date
  );
  const solid = v.models.filter(w => w.derived.solidAt && EV.chicagoDate(w.derived.solidAt) >= from);
  // B-406: a session an Undo took back (discarded) is kept, never counted
  const sessions = (db.sessions || []).filter(s => s.status !== 'discarded' && s.date >= from && s.date <= date);
  const runs = (db.runs || []).filter(
    r => r.pipeline && EV.chicagoDate(r.startedAt || r.at) >= from && EV.chicagoDate(r.startedAt || r.at) <= date
  );
  const byPipeline = {};
  for (const r of runs) {
    const p = (byPipeline[r.pipeline] = byPipeline[r.pipeline] || { ok: 0, failed: 0, running: 0 });
    if (r.status === 'ok') p.ok++;
    else if (r.status === 'running') p.running++;
    else p.failed++;
  }
  const sorted = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  const calibration = {};
  for (const e of [...v.exams].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const c = EV.calibrate(e);
    if (c) calibration[e.id] = c;
  }
  const ended = runs.filter(r => r.status !== 'running');
  const failed = ended.filter(r => r.status !== 'ok').length;
  const summary = ended.length
    ? `${ended.length - failed} of ${ended.length} runs ok` +
      (failed
        ? `; failed: ${[...new Set(ended.filter(r => r.status !== 'ok').map(r => r.pipeline))].sort().join(', ')}`
        : '')
    : 'no runs this week';
  // B-165 (D-188): the evidence B-70 and B-71 wait on, counted here so triage reads it instead of counting by hand:
  // every answer in the record (not only this week's), and the exams that carry both a prediction and a score. An
  // optional field (no bump): a week written before it has none and rebuilds as it was written.
  const evidence =
    stored && stored.health && !stored.health.evidence
      ? undefined
      : { answers: EV.collectAttempts(v.sets, v.answers).all.length, scoredExams: Object.keys(calibration).length };
  const body = {
    schema: 4, // B-29: health is {summary, verify}; B-48: rollups.readiness; B-72: insights
    date,
    calibration,
    // The verify result comes from the run's own reads of its record (verify-deploy, read-only), an input as stored.
    // B-201: the build recap is the Chart's sentence, read by the run from origin/main: an input as stored, and an
    // optional field (no bump): a week written before it has none.
    health: { summary, verify, ...(evidence ? { evidence } : {}), ...(recap ? { recap } : {}) },
    rollups: {
      from,
      to: date,
      answered: stats.total,
      right: stats.right,
      byObjective: sorted(stats.byObjective),
      byType: sorted(stats.byType),
      newWeakSpots: added.map(w => w.id).sort(),
      solid: solid.map(w => w.id).sort(),
      active: v.models.filter(EV.isActive).length,
      sessions: sessions.length,
      studyMinutes: sessions.reduce((s, x) => s + (Number(x.minutes) || 0), 0),
      runs: sorted(byPipeline),
      // D-105 (B-48): the week's closing readiness per exam; a week written before it (migrated, null) rebuilds as it was.
      readiness: stored && stored.rollups && stored.rollups.readiness === null ? null : readinessStamp(v, date),
    },
  };
  // D-120 (B-72): the week's insights; a week written before them (migrated, null) rebuilds as it was.
  body.insights = stored && stored.insights === null ? null : weekInsights(v, db, date);
  // B-68 (D-116): the week's two schedulers side by side, when its days carry a shadow (none before B-68).
  const weekAtts = EV.collectAttempts(v.sets, v.answers).all;
  const study = STUDY.compareWeek(db.days || [], weekAtts, { from, to: date });
  // B-170 (D-190): the week's two aims side by side, when its days carry one (none before B-170).
  const aimed = STUDY.compareAim(db.days || [], weekAtts, { from, to: date });
  if (study || aimed) body.study = { ...(study || {}), ...(aimed ? { aim: aimed } : {}) };
  for (const k of authoredOf(spec, 'weeks')) if (stored && stored[k] !== undefined) body[k] = stored[k];
  return body;
}

/** predictions/<examId>, the morning run the day before the exam (D-094): readiness as of that morning. */
function predictionBody(db, { examId, date, now }) {
  const v = views(db);
  const atts = EV.collectAttempts(v.sets, v.answers).all;
  // The exam being predicted never informs its own prediction (its score, once entered, comes after).
  const exams = v.exams.filter(e => e.id !== examId);
  const p = EV.predictReadiness({ examId, exams, weakspots: v.models, attempts: atts, date, now });
  if (!p) return null;
  const { at, ...rest } = p;
  return { examId, date, ...rest };
}
/** The exam a morning run predicts: tomorrow's exam of a kind its course scores (spec.courses scoredKinds, D-094), or null. */
export function examTomorrow(db, date) {
  const t = EV.addDays(date, 1);
  return (db.exams || []).find(e => e.date === t && EV.examIs(e, 'scoredKinds') && e.status !== 'done') || null;
}

/** libindex/<course>, the evening-cloud run: the course's library cut into the passages the page searches. */
function libindexBody(db, { course }) {
  const mats = EV.liveMaterials(db.materials, db.materialedits)
    .filter(m => EV.normCourse(m.course) === course)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const chunks = EV.libraryChunks(mats).map(c => ({
    id: c.id,
    page: c.page,
    unit: c.unit,
    kind: c.kind,
    text: c.text,
  }));
  const materials = Object.fromEntries(
    mats
      .filter(m => m.text)
      .map(m => [m.id, { title: m.title || m.id, kind: EV.materialKind(m), chars: String(m.text).length }])
  );
  return { course, chunks, materials };
}

/** Fields a run writes by judgment rather than computes (D-096: spec.collections.<c>.authored, x-ev.authored in the
 *  schema); rebuild keeps them as stored and checks everything else. */
export const authoredOf = (spec, collection) => ((spec.collections || {})[collection] || {}).authored || [];
export const AUTHORED = { weeks: ['review', 'reflection'] }; // the spec's list for weeks, kept for older callers

export const PRODUCERS = {
  days: {
    writer: 'morning',
    inputs: s => ({ date: s.date || s.id, now: s.at }),
    build: (db, i, spec, stored) => dayBody(db, i, spec, stored),
  },
  state: {
    writer: 'evening-cloud',
    inputs: s => ({
      date: (s.snapshot && s.snapshot.date) || EV.chicagoDate(s.at),
      now: s.at,
      specVersion: s.snapshot ? s.snapshot.specVersion : s.specVersion || null,
      release: s.snapshot ? s.snapshot.release : null,
      part: s.facts || null,
      split: s.factsSplit || null,
      lint: s.lint || null,
    }),
    build: (db, i, spec) => stateBody(db, i, spec),
  },
  weeks: {
    writer: 'weekly',
    inputs: s => ({
      date: s.date || s.id,
      now: s.at,
      verify: (s.health && typeof s.health === 'object' && s.health.verify) || null,
      recap: (s.health && typeof s.health === 'object' && s.health.recap) || null,
    }),
    build: (db, i, spec, stored) => weekBody(db, i, spec, stored),
  },
  predictions: {
    writer: 'morning',
    inputs: s => ({ examId: s.examId || s.id, date: s.date, now: s.at }),
    build: (db, i) => predictionBody(db, i),
  },
  libindex: {
    writer: 'evening-cloud',
    inputs: s => ({ course: s.course || s.id, now: s.at }),
    build: (db, i) => libindexBody(db, i),
  },
  health: {
    writer: 'watchdog',
    inputs: s => ({ now: s.at, record: s.record || 'staging', scheduler: s.scheduler || null }),
    build: (db, i, spec) => healthBody(db, i, spec),
  },
};

/** Derived documents with no producer yet, and why. lint reports them; rebuild skips them. */
export const NOT_REBUILDABLE = {
  concepts: 'grouping weak spots under a concept is not specified as a computation (design question)',
};
const pendingReason = (col, id) => NOT_REBUILDABLE[`${col}/${id}`] || NOT_REBUILDABLE[col] || null;

/** A stored Derived document's own data, comparable with a rebuild: the envelope minus `source`, which names the run. */
const comparable = d => {
  const x = EV.docData(d);
  delete x.source;
  return x;
};

/**
 * Rebuilds one stored Derived document from the record as it stood at its `at`. Returns {ref, status, data?, reason?,
 * inexact?}: status 'same' (byte for byte), 'differs', 'skipped' (no producer, or migrated from v3) or 'inexact-same'
 * / 'inexact-differs' when an Edit it read has changed since.
 */
export function rebuildOne(db, spec, collection, stored) {
  const ref = `${collection}/${stored.id}`;
  const pending = pendingReason(collection, stored.id);
  if (pending) return { ref, status: 'skipped', reason: pending };
  const p = PRODUCERS[collection];
  if (!p) return { ref, status: 'skipped', reason: 'not a Derived collection' };
  if (/^migrated from v3/.test(stored.source || ''))
    return { ref, status: 'skipped', reason: 'migrated from v3; the next run rebuilds it' };
  const inputs = p.inputs(stored);
  const runId = String(stored.source || '').split(' ')[1] || null;
  const run = runId ? (db.runs || []).find(r => r.id === runId) : null;
  const { db: then, inexact: changed } = asOf(db, stored.at, spec, { since: run ? run.startedAt : null, self: runId });
  // Only what the producing pipeline reads can explain a difference.
  // A read marked derived: false (the morning's health/current, for its push line: D-111) feeds no Derived document.
  const reads =
    run && spec.pipelines[run.pipeline]
      ? (spec.pipelines[run.pipeline].reads || []).filter(r => r.derived !== false).map(r => r.collection || r)
      : null;
  const inexact = changed.filter(
    r => r !== `${collection}/${stored.id}` && (!reads || reads.includes(r.split('/')[0]))
  );
  const body = p.build(then, inputs, spec, stored);
  const data = { schema: 1, writer: p.writer, at: stored.at, source: stored.source || p.writer, ...body };
  const same = EV.stableStringify(comparable(data)) === EV.stableStringify(comparable(stored));
  const status = (inexact.length ? 'inexact-' : '') + (same ? 'same' : 'differs');
  return { ref, status, data, ...(inexact.length ? { inexact } : {}) };
}

/** Builds a new Derived document the way its pipeline will: the producer's data with the run's envelope. */
export function produce(db, spec, collection, inputs, { source, at, stored } = {}) {
  const p = PRODUCERS[collection];
  if (!p) throw new Error('no producer for ' + collection);
  return { ...EV.envelope(p.writer, source || p.writer, at || inputs.now), ...p.build(db, inputs, spec, stored) };
}

/** Rebuilds every stored document of the given Derived collections (all of them when none are named). */
export function rebuild(db, spec, collections) {
  const want = collections && collections.length ? collections : Object.keys(spec.collections);
  const out = [];
  for (const col of want) {
    for (const d of db[col] || []) if (classOf(spec, col, d.id) === 'Derived') out.push(rebuildOne(db, spec, col, d));
  }
  return out;
}
