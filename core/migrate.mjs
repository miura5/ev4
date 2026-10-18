// The v3 -> v4 migration (Data architecture, "Schema registry and the v3 -> v4 migration"). Pure: takes a v3 export
// ({collection: [docs with id]}) and returns the v4 writes, plus what it skipped. Nothing is deleted: every v3
// original whose document changes is kept as legacy/v3-<collection>-<id>, marked migratedTo. Deterministic: the
// same export and `at` give the same writes, every output id comes from its input id, and an export that already
// holds the v4 documents yields no writes (so running it twice changes nothing).
// Never reads the journal: it is not in an export, and a journal collection passed in is refused.
import EV from './evcore.mjs';

export const MIGRATION = 'v3-to-v4';
const ISO_KEY = /^\d{4}-\d{2}-\d{2}T/;
const clone = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
const iso = x => { const t = EV.toMs(x); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const isV4 = d => !!d && Number.isInteger(d.schema) && d.schema >= 1 && typeof d.writer === 'string' && typeof d.at === 'string';
const env = (writer, source, at, extra = {}) => ({ schema: 1, writer, at: iso(at) || at, source: String(source || writer), ...extra });
const without = (o, keys) => { const r = { ...o }; for (const k of keys) delete r[k]; return r; };
/** v3 wrote some times with a UTC offset (-05:00); v4 documents hold ISO UTC. Same instant, normalized. */
const utc = (o, fields) => { const r = { ...o }; for (const f of fields) if (typeof r[f] === 'string' && !/Z$/.test(r[f]) && iso(r[f])) r[f] = iso(r[f]); return r; };

// Which v4 role a v3 document's creator maps to. The v3 field (addedBy, source, by) names a person or a process;
// v4 names the role that writes it (Data architecture, rule 1).
const wsWriter = w => (['page', 'owner', 'Matt'].includes(w.addedBy) ? 'page' : ['Study Watch', 'Study session'].includes(w.addedBy) ? 'filing' : 'morning');
const eventWriter = e => (['owner', 'Matt', 'page', 'legacy'].includes(e && e.by) ? 'page' : ['Study Watch', 'Study session'].includes(e && e.by) ? 'filing' : 'evening-cloud');
const setWriter = s => (s.kind === 'job' || s.jobId ? 'worker' : s.kind === 'more' ? 'page' : 'morning');
const fromCanvas = d => d.source === 'Canvas' || d.canvasId != null;
const V3_PIPELINES = { morning: 'morning', evening: 'evening-mac', weekly: 'weekly', job: 'worker', worker: 'worker', fileNow: 'evening-mac', file: 'evening-mac' };
const TALK_BY = { m: 'matt', e: 'ev', j: 'job', g: 'greeting' };

/** Keys an append-only map by <writer>-<time>, keeping each entry's own time in `at`; collisions get -2, -3. */
function rekey(map, writerOf, timeOf) {
  const out = {};
  const entries = Object.entries(map || {}).filter(([, v]) => v).map(([k, v]) => ({ k, v, at: iso(timeOf(k, v)) })).sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.k.localeCompare(b.k));
  for (const { k, v, at } of entries) {
    if (!at) continue;
    const base = EV.eventKey(writerOf(v), at); let key = base;
    for (let n = 2; out[key]; n++) key = `${base}-${n}`;
    out[key] = { ...clone(v), at: v.at || at };
  }
  return out;
}
/** v3 talk keys m<17 digits><by letter> -> m-<YYYYMMDD>-<HHMMSSmmm>-<by>. */
function talkKey(k) {
  const m = /^m(\d{8})(\d{6})(\d{3})([a-z])$/.exec(k);
  return m ? `m-${m[1]}-${m[2]}${m[3]}-${TALK_BY[m[4]] || m[4]}` : null;
}
// A run id from its pipeline and start: <pipeline>-<YYYYMMDD-HHMMSS>-<4 hex of the v3 key>.
const runId = (pipeline, startedAt, v3key) => `${pipeline}-${EV.compactTime(startedAt).slice(0, 15)}-${EV.hash(v3key).slice(0, 4)}`;

/**
 * v3: {collection: [{id, ...data}]}. opts.at: the migration stamp (ISO), written into migratedAt on legacy copies.
 * Returns {writes: [{op: 'set', collection, id, data}], skipped: [{ref, why}], counts}.
 */
export function migrateV3(v3, { at } = {}) {
  if (!at) throw new Error('migrateV3 needs opts.at (the migration stamp)');
  if (v3.journal && v3.journal.length) throw new Error('the journal is page-only and never migrated by a pipeline (D-059)');
  const writes = [], skipped = [];
  const have = {}; for (const [col, docs] of Object.entries(v3)) for (const d of docs || []) have[col + '/' + d.id] = d;
  const set = (collection, id, data) => {
    const existing = have[collection + '/' + id];
    if (existing && JSON.stringify(EV.stableStringify(EV.docData(existing))) === JSON.stringify(EV.stableStringify(data))) return; // already migrated
    writes.push({ op: 'set', collection, id, data });
  };
  const legacy = (collection, d, migratedTo) => set('legacy', EV.safeId(`v3-${collection}-${d.id}`), { ...clone(EV.docData(d)), migratedFrom: `${collection}/${d.id}`, migratedTo, migratedAt: iso(at) });
  const docs = col => (v3[col] || []).filter(d => d && !isV4(d));
  for (const col of Object.keys(v3)) for (const d of v3[col] || []) if (isV4(d) && col !== 'legacy') skipped.push({ ref: `${col}/${d.id}`, why: 'already v4' });

  // Weak spots: facts only (derived dropped), events keyed <writer>-<time>.
  for (const w of docs('weakspots')) {
    const f = without(EV.docData(w), ['schema', 'derived', 'concept']);
    const data = { ...env(wsWriter(w), w.source || 'migrated from v3', w.addedAt || at), ...f, events: rekey(w.events, eventWriter, (k, e) => (ISO_KEY.test(k) ? k : e.at)) };
    set('weakspots', w.id, data); legacy('weakspots', w, `weakspots/${w.id}`);
  }

  // Sets: items stay; answers and past attempts move to answers/<setId>, one attempt per key.
  for (const s of docs('sets')) {
    const data = { ...env(setWriter(s), s.source, s.createdAt || (s.date ? s.date + 'T09:25:00Z' : at)), ...utc(without(EV.docData(s), ['schema', 'answers', 'pastAttempts', 'source']), ['createdAt']) };
    set('sets', s.id, data);
    const answers = {};
    const add = map => { for (const [qid, a] of Object.entries(map || {})) if (a && a.at) (answers[qid] = answers[qid] || []).push(a); };
    (s.pastAttempts || []).forEach(p => add(p && p.answers)); add(s.answers);
    if (Object.keys(answers).length) {
      const keyed = {}; for (const [qid, list] of Object.entries(answers)) keyed[qid] = rekey(Object.fromEntries(list.map((a, i) => [String(i), a])), () => 'page', (k, a) => a.at);
      const first = Object.values(answers).flat().map(a => a.at).sort()[0];
      set('answers', s.id, { ...env('page', 'E.V. Home', first), setId: s.id, answers: keyed });
    }
    legacy('sets', s, `sets/${s.id}`);
  }

  // Days: plan/list/push stay (Derived, morning); checks/added/skipped/checkin move to dayedits; runs become runs/<id>;
  // weekly becomes weeks/<date>.
  for (const d of docs('days')) {
    const date = d.date || d.id;
    const runsMap = d.runs || {};
    const morningRun = Object.values(runsMap).filter(r => r && r.pipeline === 'morning').map(r => r.startedAt).sort()[0];
    if (d.list || d.plan || d.push) {
      const list = d.list ? clone(d.list) : { items: [] };
      set('days', date, { ...env('morning', 'migrated from v3', morningRun || `${date}T09:25:00Z`), date, dayType: d.dayType || (d.plan && d.plan.dayType) || 'class', plan: d.plan || null, list: { ...list, items: list.items || [] }, push: d.push || list.push || null });
    }
    const added = {}; for (const [k, a] of Object.entries(d.added || {})) if (a && a.text) added[k] = { text: a.text, tag: a.tag == null ? null : a.tag, kind: a.kind || 'todo', minutes: Number(a.minutes) || 0, course: a.course || '', at: iso(a.at) || iso(at), by: a.by === 'Matt' ? 'Matt' : 'E.V.' };
    const checks = {}; for (const [k, c] of Object.entries(d.checks || {})) if (c) checks[k] = { at: iso(c.at) || iso(at), ...(c.by ? { by: String(c.by) } : {}) };
    const skips = {}; for (const [k, s] of Object.entries(d.skipped || {})) if (s && s.at) skips[k] = { at: iso(s.at), by: String(s.by || 'Matt') };
    if (Object.keys(added).length || Object.keys(checks).length || Object.keys(skips).length || d.checkin) {
      const times = [...Object.values(added), ...Object.values(checks), ...Object.values(skips)].map(x => x.at).concat(d.checkin && d.checkin.at ? [iso(d.checkin.at)] : []).filter(Boolean).sort();
      const ci = d.checkin && d.checkin.energy != null ? { energy: d.checkin.energy, ...(d.checkin.stress != null ? { stress: d.checkin.stress } : {}), ...(d.checkin.sleepHours != null ? { sleepHours: d.checkin.sleepHours } : {}), at: iso(d.checkin.at) || times[0] } : null;
      set('dayedits', date, { ...env('page', 'E.V. Home', times[0] || at), updatedAt: times[times.length - 1] || iso(at), date, checks, added, skipped: skips, checkin: ci });
    }
    for (const [k, r] of Object.entries(runsMap)) {
      const pipeline = V3_PIPELINES[r && (r.pipeline || k.split('-')[0])];
      if (!pipeline || !r.startedAt) { skipped.push({ ref: `days/${d.id}#runs/${k}`, why: `a ${r && r.pipeline || 'v2'} run: kept in the legacy copy only` }); continue; }
      const steps = Array.isArray(r.steps) ? r.steps.map(s => ({ id: String(s.id || 'step'), status: String(s.status || 'ok'), ...(s.detail ? { detail: String(s.detail) } : {}) })) : [];
      set('runs', runId(pipeline, r.startedAt, k), { ...env(pipeline, `${pipeline} (v3)`, r.startedAt, { release: 'v3' }), pipeline, startedAt: iso(r.startedAt), endedAt: iso(r.endedAt), status: ['ok', 'partial', 'failed'].includes(r.status) ? r.status : 'ok', steps, detail: String(r.detail || '') });
    }
    if (d.weekly) set('weeks', date, { ...env('weekly', 'weekly (v3)', d.weekly.at || `${date}T22:57:00Z`), date, ...without(clone(d.weekly), ['at', 'date', 'schema']) });
    legacy('days', d, `days/${date}`);
  }

  // Dates: owner entries keep their fields; on Canvas entries, Matt's notes (edited) move; removal always moves.
  for (const d of docs('dates')) {
    const canvas = fromCanvas(d);
    const keep = without(EV.docData(d), ['schema', 'removed', 'editedAt', 'editedBy', ...(canvas && d.editedAt ? ['notes'] : [])]);
    set('dates', d.id, { ...env(canvas && d.source === 'Canvas' ? 'canvas-sync' : 'page', d.source || 'migrated from v3', d.syncedAt || d.addedAt || at), ...keep });
    const removed = d.removed && d.removed.at ? { at: iso(d.removed.at), by: String(d.removed.by || 'Matt') } : null;
    const notes = canvas && d.editedAt && d.notes ? d.notes : null;
    if (removed || notes) set('dateedits', d.id, { ...env('page', 'E.V. Home', d.editedAt || (removed && removed.at) || at), updatedAt: iso(d.editedAt) || (removed && removed.at) || iso(at), removed, notes, overrides: {} });
    legacy('dates', d, `dates/${d.id}`);
  }

  // Plans: the ticks move to planedits.
  for (const p of docs('plans')) {
    set('plans', p.id, { ...env('worker', p.source || 'Exam plan', p.createdAt || at), ...without(EV.docData(p), ['schema', 'done', 'source', 'createdAt']) });
    const ticks = {}; for (const [k, t] of Object.entries(p.done || {})) if (t && t.at) ticks[k] = { at: iso(t.at), ...(t.by ? { by: String(t.by) } : {}) };
    if (Object.keys(ticks).length) { const ts = Object.values(ticks).map(t => t.at).sort(); set('planedits', p.id, { ...env('page', 'E.V. Home', ts[0]), updatedAt: ts[ts.length - 1], ticks }); }
    legacy('plans', p, `plans/${p.id}`);
  }

  // Jobs: the request stays; status, result and the posted message move to jobresults.
  for (const j of docs('jobs')) {
    set('jobs', j.id, { ...env('page', 'E.V. Home', j.createdAt || at), ...without(EV.docData(j), ['schema', 'status', 'result', 'startedAt', 'finishedAt', 'createdAt']), fired: j.fired || null });
    if (j.status && j.status !== 'queued') {
      const r = j.result || null;
      set('jobresults', j.id, { ...env('worker', 'worker (v3)', j.startedAt || j.createdAt || at, { release: 'v3' }), status: ['running', 'done', 'failed'].includes(j.status) ? j.status : 'failed', startedAt: iso(j.startedAt || j.createdAt), finishedAt: iso(j.finishedAt), result: r ? { text: String(r.text || ''), links: (r.links || []).filter(l => l && /^https:\/\//.test(l.url || '')).map(l => ({ title: String(l.title || ''), url: l.url })), ...(r.setId ? { setId: r.setId } : {}) } : null, message: r && r.messageId || null, error: j.error || null });
    }
    legacy('jobs', j, `jobs/${j.id}`);
  }

  // Materials: a removed upload becomes a materialedits removal; the text is unchanged.
  for (const m of docs('materials')) {
    // v3 inferred an older (schema 1) material's kind on read (EVCore.materialKind); v4 stores it.
    set('materials', m.id, { ...env(m.source === 'Canvas' || /^[A-Z]+\d+-/.test(m.id) && m.source !== 'upload' ? 'canvas-sync' : 'page', m.source || 'Canvas', m.fetchedAt || m.addedAt || at), ...without(EV.docData(m), ['schema', 'status']), kind: EV.materialKind(m) });
    if (m.status === 'removed') set('materialedits', m.id, { ...env('page', 'E.V. Home', m.removedAt || at), updatedAt: iso(m.removedAt || at), removed: { at: iso(m.removedAt || at), by: 'Matt' } });
    legacy('materials', m, `materials/${m.id}`);
  }

  // Talk: message keys m-<date>-<time>-<by>; memory is the page's Derived summary.
  for (const t of docs('talk')) {
    if (t.id === 'memory') { set('talk', 'memory', { ...env('page', 'E.V. Home', t.summarizedAt || t.lastSeenAt || at), summary: String(t.summary || ''), upTo: talkKey(t.upTo || '') || null, summarizedAt: iso(t.summarizedAt), lastSeenAt: iso(t.lastSeenAt) }); legacy('talk', t, 'talk/memory'); continue; }
    const messages = {};
    for (const [k, m] of Object.entries(t.messages || {})) {
      const nk = talkKey(k); if (!nk || !m) { skipped.push({ ref: `talk/${t.id}#${k}`, why: 'message key not in the v3 shape' }); continue; }
      const out = { ...clone(m) }; if (out.replyTo) out.replyTo = talkKey(out.replyTo) || out.replyTo;
      messages[nk] = out;
    }
    const first = Object.values(messages).map(m => m.at).sort()[0];
    set('talk', t.id, { ...env('page', 'E.V. Home', first || `${t.id}T12:00:00Z`), date: t.date || t.id, messages });
    legacy('talk', t, `talk/${t.id}`);
  }

  // The rest gain the envelope, keyed by who writes them in v4.
  const simple = { exams: e => (e.source === 'Canvas' ? 'canvas-sync' : 'page'), objectives: () => 'worker', announcements: () => 'canvas-sync', ideas: i => (i.source === 'Study Watch' ? 'filing' : 'page'), sessions: s => (s.source === 'E.V. Home' ? 'page' : 'filing'), concepts: () => 'weekly' };
  for (const [col, writerOf] of Object.entries(simple)) for (const d of docs(col)) {
    let data = utc(without(EV.docData(d), ['schema']), ['filedAt', 'startedAt', 'endedAt', 'createdAt', 'postedAt']);
    if (Array.isArray(data.links)) data.links = data.links.map(l => utc(l, ['createdAt']));
    if (col === 'exams') data = without(data, ['prediction', 'calibration']);
    if (col === 'sessions' && d.events) data.events = rekey(d.events, () => 'page', (k, e) => (ISO_KEY.test(k) ? k : e.at));
    const at0 = d.addedAt || d.createdAt || d.filedAt || d.postedAt || d.fetchedAt || d.updatedAt || at;
    set(col, d.id, { ...env(writerOf(d), d.source || 'migrated from v3', at0), ...data });
    legacy(col, d, `${col}/${d.id}`);
  }

  // Not migrated, kept as written: v3's derived snapshot (rebuilt by evening-cloud), its system documents (deploy
  // writes v4's), and the v2 collections v3 already kept (reviews, drills, daily, v2 runs, links).
  for (const col of ['state', 'system', 'reviews', 'drills', 'daily', 'links']) for (const d of v3[col] || []) legacy(col, d, null);
  for (const d of v3.runs || []) if (!isV4(d)) legacy('runs', d, null);
  for (const d of v3.legacy || []) if (!d.migratedFrom) skipped.push({ ref: `legacy/${d.id}`, why: 'already in legacy' });
  const known = new Set(['weakspots', 'sets', 'days', 'dates', 'plans', 'jobs', 'materials', 'talk', 'state', 'system', 'reviews', 'drills', 'daily', 'links', 'runs', 'legacy', ...Object.keys(simple)]);
  for (const col of Object.keys(v3)) if (!known.has(col)) for (const d of v3[col] || []) skipped.push({ ref: `${col}/${d.id}`, why: 'collection not in the migration' });

  const counts = {}; for (const w of writes) counts[w.collection] = (counts[w.collection] || 0) + 1;
  // No document was created after the export it came from: an envelope time past the migration stamp (a date with no
  // creation time, stamped with its own day) is the migration's.
  const stamp = iso(at);
  for (const w of writes) if (w.data && w.data.at && Date.parse(w.data.at) > Date.parse(stamp)) w.data.at = stamp;
  // v4's own schema bumps run on the migrated documents too, so a v3 export lands at today's versions.
  const bumped = []; for (const w of writes) bumped.push(...bumpWrite(w, at));
  const counts2 = {}; for (const w of bumped) counts2[w.collection] = (counts2[w.collection] || 0) + 1;
  return { writes: bumped, skipped, counts: counts2 };
}

// ------------------------------------------------------------------------------------------------ schema bumps
// Data architecture, "Schema registry": bumping a schema means a new schema file version, a migration function here
// keyed by collection and version, a fixture before and after, and a test that the migration is idempotent. No
// document changes shape any other way. Each function takes a document at that version (data, with its id) and
// returns {data: the document at the next version, also: [{collection, id, data}] new documents it implies}.
export const BUMPS = {
  weeks: {
    // B-29 (Matt, Oct 18): health becomes {summary, verify}: the week's run line, and the read-only verify-deploy the
    // weekly runs on its own record (null for a week before it).
    1: d => ({ data: { ...d, schema: 2, health: { summary: typeof d.health === 'string' ? d.health : String((d.health && d.health.summary) || ''), verify: null } }, also: [] }),
  },
  ideas: {
    // D-109: ideas carry a kind; every idea before it came from study (sessions, Study Watch, the conversation), so
    // each becomes a learning idea, the only kind that can become a weak spot.
    1: d => ({ data: { ...d, schema: 2, kind: d.kind || 'learning' }, also: [] }),
  },
  exams: {
    // D-094: the score is Matt's hand entry on a Fact he did not create, so it moves to examedits/<examId> (an Edit
    // the page replaces whole); the exam keeps its own fields; a stored prediction or calibration never existed in v4.
    1: (d, { at }) => {
      const { score, scoreAt, prediction, calibration, ...rest } = d;
      const also = [];
      if (typeof score === 'number') also.push({ collection: 'examedits', id: d.id, data: { schema: 1, writer: 'page', at: iso(scoreAt) || iso(at), source: 'migrated from exams/' + d.id, updatedAt: iso(scoreAt) || iso(at), score, scoreAt: iso(scoreAt) || null, ...(rest.status === 'done' ? { status: 'done' } : {}) } });
      return { data: { ...rest, schema: 2 }, also };
    },
  },
};
/** The version a collection's documents are at today: the highest a bump leads to, else 1. */
export const currentVersion = collection => { const b = BUMPS[collection]; return b ? Math.max(...Object.keys(b).map(Number)) + 1 : 1; };
/** One write carried through every bump its collection has, plus the documents the bumps imply. */
export function bumpWrite(w, at) {
  const steps = BUMPS[w.collection]; if (!steps || !w.data) return [w];
  let data = w.data; const out = [];
  while (steps[data.schema || 1]) { const r = steps[data.schema || 1]({ ...data, id: w.id }, { at }); const { id, ...rest } = r.data; data = rest; for (const a of r.also || []) out.push({ op: 'set', ...a }); }
  return [{ ...w, data }, ...out];
}
/**
 * The bumps a v4 record needs: {collection: [docs with id]} in, {writes, legacy, counts} out. Each document below its
 * collection's version is set at the new version (pinned by the caller to the version it pulled), its old form kept as
 * legacy/v4-<collection>-<id>-s<n> marked migratedTo; documents a bump implies are created unless one already exists
 * with the same data. A record already at today's versions yields no writes, so running it twice changes nothing.
 */
export function migrateBumps(db, { at } = {}) {
  if (!at) throw new Error('migrateBumps needs opts.at');
  const writes = []; const have = {}; for (const [c, ds] of Object.entries(db || {})) for (const d of ds || []) have[c + '/' + d.id] = d;
  for (const [col, steps] of Object.entries(BUMPS)) for (const d of db[col] || []) {
    const from = d.schema || 1; if (!steps[from]) continue;
    const [main, ...also] = bumpWrite({ op: 'set', collection: col, id: d.id, data: EV.docData(d) }, at);
    writes.push({ op: 'set', collection: 'legacy', id: `v4-${col}-${d.id}-s${from}`, data: { ...EV.docData(d), migratedFrom: `${col}/${d.id}`, migratedTo: `${col}/${d.id}`, migratedAt: iso(at), migration: `${col} schema ${from} to ${main.data.schema}` } });
    writes.push(main);
    for (const a of also) { const e = have[a.collection + '/' + a.id]; if (e && EV.stableStringify(EV.docData(e)) === EV.stableStringify(a.data)) continue; if (e) continue; writes.push(a); }
  }
  const counts = {}; for (const w of writes) counts[w.collection] = (counts[w.collection] || 0) + 1;
  return { writes, counts };
}

/** The v4 record a migration's writes produce on top of the export (sets replace whole). */
export function applyWrites(v3, writes) {
  const db = {}; for (const [col, docs] of Object.entries(v3)) db[col] = (docs || []).map(d => ({ ...d }));
  for (const w of writes) {
    const list = db[w.collection] = db[w.collection] || [];
    const i = list.findIndex(d => d.id === w.id); const doc = { id: w.id, ...w.data };
    if (i >= 0) list[i] = doc; else list.push(doc);
  }
  return db;
}

/** Canonical form for comparing a stored v3 value with a recomputed one: key order ignored, ISO times as instants. */
function comparable(v) {
  const walk = x => {
    if (x === undefined) return null;
    if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x) && iso(x)) return iso(x);
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) o[k] = walk(x[k]); return o; }
    return x;
  };
  return JSON.stringify(walk(v));
}
const DERIVED_FIELDS = ['status', 'streak', 'nextDue', 'misses', 'recurrence', 'lastReviewed', 'lastResult', 'solidBy', 'solidAt', 'preRead', 'reopenedAt', 'answered', 'right', 'history'];
/**
 * The gate: recompute every weak spot from the migrated Facts with v4 core and compare with the derived block v3 had
 * stored at export time. Returns {weakspots, compared, mismatches: [{id, field, v3, v4}]}; zero mismatches passes.
 */
export function verifyMigration(v3, writes) {
  const db = applyWrites(v3, writes);
  const v4 = col => (db[col] || []).filter(isV4);
  const models = EV.buildWeakspots({ weakspots: v4('weakspots'), sets: v4('sets'), answers: v4('answers'), exams: v4('exams') });
  const mismatches = []; let compared = 0;
  for (const w of v3.weakspots || []) {
    if (isV4(w) || !w.derived) continue;
    const m = models.find(x => x.id === w.id);
    if (!m) { mismatches.push({ id: w.id, field: '*', v3: 'present', v4: 'missing' }); continue; }
    compared++;
    for (const f of DERIVED_FIELDS) {
      if (!(f in w.derived)) continue;
      if (comparable(w.derived[f]) !== comparable(m.derived[f])) mismatches.push({ id: w.id, field: f, v3: w.derived[f], v4: m.derived[f] });
    }
  }
  return { weakspots: models.length, compared, mismatches, models };
}
