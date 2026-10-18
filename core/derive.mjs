// Derived documents and how each is produced (Data architecture, "Derivation and the nightly zero-mismatch rebuild").
// A producer is the one function a pipeline computes a Derived document with; `rebuild` runs the same function on
// the record as it stood at the stored document's time, so the two cannot disagree unless the code or a later Edit
// changed. Pure: the record goes in as {collection: [docs with id]}, data comes out. The rule this puts on a run
// (core/run.mjs compute): each step sees the writes of the steps before it, and every write is stamped with the
// run's one compute time, so the record a Derived document was computed from is exactly the record as of its `at`.
import EV from './evcore.mjs';
import { healthBody } from './watch.mjs';
import { loadSchemas } from './schemas.mjs';

const ms = x => EV.toMs(x);


/** The class of one document: a collection's own, or the one its spec `documents` entry names (talk/memory). */
export function classOf(spec, collection, id) {
  const c = spec.collections[collection]; if (!c) return null;
  const d = c.documents && c.documents[id];
  return (d && d.class) || c.class;
}
/** Who may write one document: the collection's writers, or its `documents` entry's. */
export function writersOf(spec, collection, id) {
  const c = spec.collections[collection]; if (!c) return [];
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
  if (collection === 'talk' && field === 'messages') { const m = TALK_KEY.exec(key); return m ? (m[1] === 'job' ? 'worker' : 'page') : null; }
  const m = EVENT_KEY.exec(key); return m ? m[1] : null;
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
 * Config documents (system/*) are always current. The journal is left out: no pipeline reads it (D-059).
 */
export function asOf(db, at, spec, { since = null, self = null } = {}) {
  const t = ms(at); const s = since == null ? null : ms(since); const out = {}; const inexact = [];
  // What changed while the producing run ran (after its start, by its write): its pull may have seen the version before.
  const during = (col, d) => s != null && !(col === 'runs' && d.id === self) && [d.at, d.endedAt, d.updatedAt].some(x => Number.isFinite(ms(x)) && ms(x) > s && ms(x) <= t);
  for (const [col, docs] of Object.entries(db || {})) {
    const c = spec.collections[col]; if (!c || col === 'journal') continue; // no producer reads the journal (D-059)
    const appends = Object.keys(c.appends || {});
    out[col] = [];
    for (const d of docs || []) {
      if (!d) continue;
      const cls = classOf(spec, col, d.id);
      if (cls === 'Config') { out[col].push(d); continue; }
      // A Derived document rewritten since: the version this time saw is gone.
      if (Number.isFinite(ms(d.at)) && ms(d.at) > t) { if (cls === 'Derived') inexact.push(`${col}/${d.id}`); continue; }
      if (during(col, d)) inexact.push(`${col}/${d.id}`);
      if (cls === 'Edit') { if (ms(d.updatedAt || d.at) > t) inexact.push(`${col}/${d.id}`); out[col].push(d); continue; }
      // A run's ledger entry is written at its start and completed at its end: before its end it was still running.
      if (col === 'runs' && d.endedAt && ms(d.endedAt) > t) { const { steps, planHash, push, ...open } = d; out[col].push({ ...open, status: 'running', endedAt: null }); continue; }
      if (!appends.length) { out[col].push(d); continue; }
      const cut = { ...d }; for (const f of appends) if (cut[f]) cut[f] = cutMap(cut[f], t, appendDepth(col, f));
      out[col].push(cut);
    }
  }
  return { db: out, inexact };
}

/** Weak spot models, dates and plans as every producer sees them. */
function views(db) {
  const exams = db.exams || [], sets = db.sets || [], answers = db.answers || [];
  return {
    exams, sets, answers,
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
  const props = Object.keys(((SCHEMAS[collection] || {}).properties) || {});
  const skip = new Set(['at', ...Object.keys(c.appends || {}), ...Object.keys(c.marks || {})]);
  return props.filter(k => !skip.has(k)).sort();
}
/** The hash of a Fact's own fields: those present (or exactly `only`), indexed against `fields`. */
export function factHash(spec, collection, doc, { fields = factFields(spec, collection), only = null } = {}) {
  const data = EV.docData(doc);
  const covered = only || fields.filter(k => data[k] !== undefined);
  const body = Object.fromEntries(covered.map(k => [k, data[k] === undefined ? null : data[k]]));
  let mask = 0n; for (const k of covered) { const i = fields.indexOf(k); if (i >= 0) mask |= 1n << BigInt(i); }
  return EV.sha256(EV.stableStringify(body)) + '.' + mask.toString(36);
}
const fromBase36 = t => [...String(t)].reduce((n, ch) => n * 36n + BigInt(parseInt(ch, 36)), 0n);
/**
 * Whether a Fact still matches the hash state/current kept for it: every field it had then holds the same value.
 * {ok: true} | {ok: false, why} | {ok: null} when the stored hash predates masks (nothing to compare against).
 */
export function factCheck(spec, collection, doc, stored, fields) {
  const [, m] = String(stored || '').split('.'); if (m === undefined || !fields) return { ok: null };
  const mask = fromBase36(m); const had = fields.filter((_, i) => (mask >> BigInt(i)) & 1n);
  if (factHash(spec, collection, doc, { fields, only: had }) === stored) return { ok: true };
  const data = EV.docData(doc); const gone = had.filter(k => data[k] === undefined);
  return { ok: false, why: gone.length ? `${gone.join(', ')} removed` : `one of ${had.join(', ')} changed` };
}

// ------------------------------------------------------------------------------------------------ producers
// Each: {writer, id(stored) -> the inputs it needs besides the record, build(db, inputs, spec) -> data (no envelope)}.

/** days/<date>, the morning run: the plan and the list at 4:25am. */
function dayBody(db, { date, now }) {
  const v = views(db);
  const day = EV.planDay({ date, dates: db.dates || [], dateedits: db.dateedits || [], exams: v.exams, plans: db.plans || [], planedits: db.planedits || [], weakspots: v.models, objectives: db.objectives || [], sets: v.sets, answers: v.answers });
  const reviewSet = v.sets.find(s => s.id === 'review-' + date) || null;
  const reviewSetId = reviewSet ? reviewSet.id : null;
  const newSets = v.sets.filter(s => s.kind !== 'review' && s.kind !== 'more' && EV.chicagoDate(s.at || s.createdAt || '') === date);
  // New on Canvas: announcements the sync brought in during the 24 hours before this run.
  const since = ms(now) - 864e5;
  const canvasFlags = (db.announcements || []).filter(a => ms(a.at) > since && ms(a.at) <= ms(now))
    .sort((a, b) => ms(a.at) - ms(b.at) || (a.id < b.id ? -1 : 1))
    .map(a => ({ id: a.id, text: 'New on Canvas: ' + (a.title || 'announcement'), ref: 'announcements/' + a.id }));
  const notes = v.models.filter(w => w.kind === 'note' && w.derived.status === 'open');
  const focus = EV.rankDue(v.models, date, v.exams).sort((a, b) => (b.derived.recurrence || 1) - (a.derived.recurrence || 1) || (b.derived.misses || 0) - (a.derived.misses || 0)).slice(0, 3);
  const list = EV.buildDayList(day, { reviewSetId, newSets, canvasFlags, notes, focus, sets: v.sets });
  const open = reviewSet ? (reviewSet.items || []).length - EV.answeredItems(reviewSet, v.answers).length : 0;
  list.push = list.push.replace(/\d+ reviews? ready/, `${open} review${open === 1 ? '' : 's'} ready`);
  return { date, dayType: day.dayType, plan: { budget: day.budget, blocks: day.blocks, deferred: day.deferred, reviews: day.reviews }, list, push: list.push };
}

/** state/current, the evening-cloud run: the snapshot, the derived hash, and every Fact's hash for lint. */
function stateBody(db, { date, now, specVersion }, spec) {
  const v = views(db);
  // The counts are of what the run reads: state/current leaves itself out (the run sees the previous one, a rebuild
  // the one it wrote), and Config (system/*) is the deploy's, not the record's.
  const counts = Object.fromEntries(Object.entries(db).filter(([k, d]) => k !== 'state' && spec.collections[k] && spec.collections[k].class !== 'Config' && d.length).map(([k, d]) => [k, d.length]).sort(([a], [b]) => (a < b ? -1 : 1)));
  const content = EV.lint({ ...db, journal: [], weakspotModels: v.models, counts }, { date });
  const snapshot = EV.buildSnapshot({ date, now, exams: v.exams, weakspots: v.models, sets: v.sets, answers: v.answers, days: db.days || [], dates: db.dates || [], dateedits: db.dateedits || [], plans: db.plans || [], planedits: db.planedits || [], runs: db.runs || [], counts, versions: { spec: specVersion || null }, lint: content, canvas: null });
  const factHashes = {}; const fieldLists = {};
  for (const [col, docs] of Object.entries(db).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (col === 'journal') continue; // pipelines never read it (D-059)
    for (const d of [...docs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (classOf(spec, col, d.id) !== 'Fact') continue;
      const fields = fieldLists[col] = fieldLists[col] || factFields(spec, col);
      factHashes[`${col}/${d.id}`] = factHash(spec, col, d, { fields });
    }
  }
  return { snapshot, derivedHash: snapshot.derivedHash, factHashes, factFields: fieldLists };
}

/** weeks/<Sunday>, the weekly run: the week's roll-ups, calibration and health line. The review and reflection are
 *  the run's own writing (an agent step), kept as written. */
function weekBody(db, { date }, spec, stored) {
  const v = views(db); const from = EV.addDays(date, -6);
  const atts = EV.collectAttempts(v.sets, v.answers).all.filter(a => a.date >= from && a.date <= date);
  const stats = EV.answerStats(atts, { date });
  const added = v.models.filter(w => w.addedAt && EV.chicagoDate(w.addedAt) >= from && EV.chicagoDate(w.addedAt) <= date);
  const solid = v.models.filter(w => w.derived.solidAt && EV.chicagoDate(w.derived.solidAt) >= from);
  const sessions = (db.sessions || []).filter(s => s.date >= from && s.date <= date);
  const runs = (db.runs || []).filter(r => r.pipeline && EV.chicagoDate(r.startedAt || r.at) >= from && EV.chicagoDate(r.startedAt || r.at) <= date);
  const byPipeline = {}; for (const r of runs) { const p = byPipeline[r.pipeline] = byPipeline[r.pipeline] || { ok: 0, failed: 0, running: 0 }; if (r.status === 'ok') p.ok++; else if (r.status === 'running') p.running++; else p.failed++; }
  const sorted = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  const calibration = {};
  for (const e of [...v.exams].sort((a, b) => (a.id < b.id ? -1 : 1))) { const c = EV.calibrate(e); if (c) calibration[e.id] = c; }
  const ended = runs.filter(r => r.status !== 'running'); const failed = ended.filter(r => r.status !== 'ok').length;
  const body = {
    date,
    calibration,
    health: ended.length ? `${ended.length - failed} of ${ended.length} runs ok` + (failed ? `; failed: ${[...new Set(ended.filter(r => r.status !== 'ok').map(r => r.pipeline))].sort().join(', ')}` : '') : 'no runs this week',
    rollups: {
      from, to: date, answered: stats.total, right: stats.right, byObjective: sorted(stats.byObjective), byType: sorted(stats.byType),
      newWeakSpots: added.map(w => w.id).sort(), solid: solid.map(w => w.id).sort(), active: v.models.filter(EV.isActive).length,
      sessions: sessions.length, studyMinutes: sessions.reduce((s, x) => s + (Number(x.minutes) || 0), 0), runs: sorted(byPipeline),
    },
  };
  for (const k of AUTHORED.weeks) if (stored && stored[k] !== undefined) body[k] = stored[k];
  return body;
}

/** libindex/<course>, the evening-cloud run: the course's library cut into the passages the page searches. */
function libindexBody(db, { course }) {
  const mats = EV.liveMaterials(db.materials, db.materialedits).filter(m => EV.normCourse(m.course) === course).sort((a, b) => (a.id < b.id ? -1 : 1));
  const chunks = EV.libraryChunks(mats).map(c => ({ id: c.id, page: c.page, unit: c.unit, kind: c.kind, text: c.text }));
  const materials = Object.fromEntries(mats.filter(m => m.text).map(m => [m.id, { title: m.title || m.id, kind: EV.materialKind(m), chars: String(m.text).length }]));
  return { course, chunks, materials };
}

/** Fields a run writes by judgment rather than computes; rebuild keeps them as stored and checks everything else. */
export const AUTHORED = { weeks: ['review', 'reflection'] };

export const PRODUCERS = {
  days: { writer: 'morning', inputs: (s) => ({ date: s.date || s.id, now: s.at }), build: (db, i) => dayBody(db, i) },
  state: { writer: 'evening-cloud', inputs: (s) => ({ date: (s.snapshot && s.snapshot.date) || EV.chicagoDate(s.at), now: s.at, specVersion: s.snapshot ? s.snapshot.specVersion : null }), build: (db, i, spec) => stateBody(db, i, spec) },
  weeks: { writer: 'weekly', inputs: (s) => ({ date: s.date || s.id, now: s.at }), build: (db, i, spec, stored) => weekBody(db, i, spec, stored) },
  libindex: { writer: 'evening-cloud', inputs: (s) => ({ course: s.course || s.id, now: s.at }), build: (db, i) => libindexBody(db, i) },
  health: { writer: 'watchdog', inputs: (s) => ({ now: s.at, record: s.record || 'staging' }), build: (db, i, spec) => healthBody(db, i, spec) },
};

/** Derived documents with no producer yet, and why. lint reports them; rebuild skips them. */
export const NOT_REBUILDABLE = {
  concepts: 'grouping weak spots under a concept is not specified as a computation (design question)',
  'talk/memory': 'the running summary is written by a model on the page (design question)',
};
const pendingReason = (col, id) => NOT_REBUILDABLE[`${col}/${id}`] || NOT_REBUILDABLE[col] || null;

/** A stored Derived document's own data, comparable with a rebuild: the envelope minus `source`, which names the run. */
const comparable = d => { const x = EV.docData(d); delete x.source; return x; };

/**
 * Rebuilds one stored Derived document from the record as it stood at its `at`. Returns {ref, status, data?, reason?,
 * inexact?}: status 'same' (byte for byte), 'differs', 'skipped' (no producer, or migrated from v3) or 'inexact-same'
 * / 'inexact-differs' when an Edit it read has changed since.
 */
export function rebuildOne(db, spec, collection, stored) {
  const ref = `${collection}/${stored.id}`;
  const pending = pendingReason(collection, stored.id);
  if (pending) return { ref, status: 'skipped', reason: pending };
  const p = PRODUCERS[collection]; if (!p) return { ref, status: 'skipped', reason: 'not a Derived collection' };
  if (/^migrated from v3/.test(stored.source || '')) return { ref, status: 'skipped', reason: 'migrated from v3; the next run rebuilds it' };
  const inputs = p.inputs(stored);
  const runId = String(stored.source || '').split(' ')[1] || null;
  const run = runId ? (db.runs || []).find(r => r.id === runId) : null;
  const { db: then, inexact: changed } = asOf(db, stored.at, spec, { since: run ? run.startedAt : null, self: runId });
  // Only what the producing pipeline reads can explain a difference.
  const reads = run && spec.pipelines[run.pipeline] ? (spec.pipelines[run.pipeline].reads || []).map(r => r.collection || r) : null;
  const inexact = changed.filter(r => r !== `${collection}/${stored.id}` && (!reads || reads.includes(r.split('/')[0])));
  const body = p.build(then, inputs, spec, stored);
  const data = { schema: 1, writer: p.writer, at: stored.at, source: stored.source || p.writer, ...body };
  const same = EV.stableStringify(comparable(data)) === EV.stableStringify(comparable(stored));
  const status = (inexact.length ? 'inexact-' : '') + (same ? 'same' : 'differs');
  return { ref, status, data, ...(inexact.length ? { inexact } : {}) };
}

/** Builds a new Derived document the way its pipeline will: the producer's data with the run's envelope. */
export function produce(db, spec, collection, inputs, { source, at, stored } = {}) {
  const p = PRODUCERS[collection]; if (!p) throw new Error('no producer for ' + collection);
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
