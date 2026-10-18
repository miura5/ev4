// The steps a pipeline is made of (Operational architecture, "The run protocol", move 4). A pipeline in the spec
// names its steps; each `code` step is one function here and each `agent` step names the judgment, the material it is
// shown, the shape of its answer and how the answer folds into the plan. Pure: (db, ctx, spec) in, writes out.
//   code step   (db, ctx, spec) -> {writes?: [{op, collection, id, data}], say?: [lines], push?: string}
//   material    (db, ctx, spec) -> any JSON the agent reads before answering
//   fold        (answer, db, ctx, spec) -> {writes?, say?, push?}
// ctx: {runId, pipeline, writer, date (Central), now (ISO), source}; a code step may leave a brief on ctx for the
// agent step after it (compute runs every step again on each call, so nothing is carried between calls).
// A material builder returns {skip: reason} when its agent has nothing to do today.
import fs from 'node:fs';
import path from 'node:path';
import EV from './evcore.mjs';
import { produce } from './derive.mjs';
import { watch } from './watch.mjs';
import { canvasRaw } from './canvas.mjs';
import { collectionHash } from './seed.mjs';

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

// ------------------------------------------------------------------------------------------------ worker
/** The job this run does: the one the firing named, or the oldest with no result; with its guide and material. */
CODE_STEPS['job-brief'] = function jobBrief(db, ctx, spec) {
  const results = new Map((db.jobresults || []).map(r => [r.id, r]));
  const wanted = ctx.input && ctx.input.job;
  const job = wanted ? (db.jobs || []).find(j => j.id === wanted) : [...(db.jobs || [])].filter(j => !results.has(j.id)).sort((a, b) => EV.toMs(a.at) - EV.toMs(b.at) || (a.id < b.id ? -1 : 1))[0];
  if (!job) { ctx.job = null; ctx.jobSkip = wanted ? `no job ${wanted} in the record` : 'no job is waiting'; return { say: [ctx.jobSkip] }; }
  const done = results.get(job.id);
  if (done && done.status !== 'running') { ctx.job = null; ctx.jobSkip = `job ${job.id} already has a result (${done.status})`; return { say: [ctx.jobSkip] }; }
  const kinds = (spec.jobs && spec.jobs.kinds) || {}; const kind = kinds[job.kind] ? job.kind : 'general';
  const ms = models(db); const idx = library(db); const q = `${job.title} ${job.brief}`;
  const context = {};
  if (kind === 'study-guide') context.passages = passages(idx, q, 6);
  if (kind === 'practice-set') {
    context.weakSpots = EV.rankDue(ms.filter(EV.isActive), '9999-12-31', db.exams || []).map(w => ({ w, s: EV.similarity(q, w.topic + ' ' + w.objective) })).sort((a, b) => b.s - a.s).slice(0, 15).map(({ w }) => ({ weakspotId: w.id, topic: w.topic, objective: w.objective }));
    context.passages = passages(idx, q, 6);
  }
  if (kind === 'exam-plan') {
    const exam = (db.exams || []).find(e => new RegExp(`\\b${e.id}\\b`).test(q) || (e.title && q.toLowerCase().includes(e.title.toLowerCase()))) || null;
    context.exam = exam ? { id: exam.id, title: exam.title, date: exam.date, course: exam.course } : null;
    context.objectives = (db.objectives || []).filter(o => !exam || o.exam === exam.id).map(o => ({ id: o.id, text: o.text, chapters: o.chapters || '' }));
    context.dates = EV.liveDates(db.dates, db.dateedits).filter(d => d.date >= ctx.date && (!exam || !exam.date || d.date <= exam.date)).map(d => ({ date: d.date, title: d.title, kind: d.kind, graded: !!d.graded }));
    context.passages = passages(idx, q, 4);
  }
  ctx.job = job;
  ctx.jobBrief = { job: { id: job.id, kind, title: job.title, brief: job.brief }, guide: kinds[kind] ? kinds[kind].guide : '', today: ctx.date, context };
  return { say: [`Job ${job.id} (${kind}): ${job.title}`] };
};

// ------------------------------------------------------------------------------------------------ watchdog
CODE_STEPS.watch = function watchStep(db, ctx, spec) {
  const v = watch(db, { now: ctx.now, record: ctx.record, spec });
  const writes = v.refires.map(r => ({ op: 'set', collection: 'runs', id: r.id, data: { ...EV.envelope('watchdog', ctx.source, ctx.now), release: ctx.release, pipeline: 'watchdog', startedAt: ctx.now, endedAt: ctx.now, status: 'ok', detail: `re-fired ${r.target}: ${r.reason}` } }));
  const fires = v.refires.map(r => ({ trigger_id: r.trigger, ...(r.text ? { text: r.text } : {}) }));
  const say = [`${v.missing.length} missed, ${v.stalledRuns.length} unfinished, ${v.stalledJobs.length} stalled; re-firing ${v.refires.length}.`, ...v.reported.map(r => `Not re-fired: ${r.target} (${r.why}).`)];
  const push = v.refires.length || v.reported.length ? `Watchdog: ${[...v.refires.map(r => 're-fired ' + r.target), ...v.reported.map(r => r.target + ' ' + r.why)].join('; ')}`.slice(0, 120) : null;
  return { writes, fires, say, ...(push ? { push } : {}) };
};
CODE_STEPS.health = function healthStep(db, ctx, spec) {
  const data = produce(db, spec, 'health', { now: ctx.now, record: ctx.record }, { source: ctx.source });
  return { writes: [{ op: 'set', collection: 'health', id: 'current', data }], say: ['health/current written.'] };
};


// ------------------------------------------------------------------------------------------------ evening-mac
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** The Mac folder this run's record writes to (spec.tasks.<record>.evening-mac.folders[0]). */
export function macFolder(spec, record) {
  const t = ((spec.tasks || {})[record] || {})['evening-mac'];
  if (!t || !(t.folders || []).length) throw new Error(`spec.tasks.${record}.evening-mac names no Mac folder`);
  return t.folders[0];
}
/** E.V. v4's own files in that folder: names v3's files never use, so the two never overwrite each other. */
export const MAC_FILES = { backup: day => `backup/E.V.-v4-backup-${day}.json`, mirror: 'mirror-v4' };
/** A backup as restore-drill checks it: every collection the run pulled (never journal or system), with counts and hashes. */
export function macBackup(db, { now, label, release }) {
  const collections = {};
  for (const col of Object.keys(db).filter(c => c !== 'journal' && c !== 'system').sort()) collections[col] = [...db[col]].sort((a, b) => (a.id < b.id ? -1 : 1));
  const b = EV.buildBackup(collections, { now, label });
  const hashes = Object.fromEntries(Object.entries(collections).map(([c, docs]) => [c, collectionHash(docs)]));
  return { ...b, release: release || b.release, hashes };
}
/**
 * The nightly backup (and, on Sundays or when the run is told to, the Markdown mirror) written under ctx.outputs and
 * handed to the Mac as device_commit_files calls the apply move prints. Nothing on the Mac is read or deleted.
 */
CODE_STEPS['mac-files'] = function macFiles(db, ctx, spec) {
  const folder = macFolder(spec, ctx.record);
  const out = path.join(ctx.outputs || '/mnt/user-data/outputs/ev', ctx.runId);
  const day = WEEKDAYS[EV.weekday(ctx.date)];
  const files = [];
  const put = (rel, body) => { const f = path.join(out, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); files.push({ stagedPath: f, devicePath: folder + '/' + rel }); };
  const backup = macBackup(db, { now: ctx.now, label: `${ctx.pipeline} ${ctx.runId}`, release: ctx.release });
  const body = JSON.stringify(backup, null, 1);
  put(MAC_FILES.backup(day), body);
  const docs = Object.values(backup.counts).reduce((a, b) => a + b, 0);
  const mirror = day === 'sunday' || /^(yes|true|1)$/i.test(String((ctx.input || {}).mirror || ''));
  let mirrored = 0;
  if (mirror) {
    const weakspotModels = models(db);
    for (const f of EV.toMarkdown({ ...db, weakspotModels }, { date: ctx.date })) { put(MAC_FILES.mirror + '/' + f.path, f.content); mirrored++; }
  }
  const device = [];
  for (let i = 0; i < files.length; i += 50) device.push({ tool: 'mcp__remote-devices__device_commit_files', args: { files: files.slice(i, i + 50) } });
  const detail = `backup ${MAC_FILES.backup(day)} (${docs} documents, ${Math.round(Buffer.byteLength(body) / 1024)} KB)${mirror ? `, mirror ${mirrored} files` : ''}`;
  return { device, detail, say: [`Mac files: ${detail}, to ${folder}.`] };
};

export const AGENT_MATERIAL = {
  /** The probe this diagnostic run answers, and the surfaces the environments registry tracks. */
  'probe-brief'(db, ctx, spec) {
    if (!ctx.input || !ctx.input.probe) return { skip: 'no probe named' };
    const surfaces = Object.keys((spec.environments && spec.environments.surfaces) || spec.environments || {}).filter(k => !k.startsWith('_'));
    const named = probeNamed(spec, ctx.input.probe);
    if (!named) return { probe: ctx.input.probe, surfaces };
    return { probe: ctx.input.probe, surfaces, measures: named.def.measures, groups: probeGroups(named, ctx) };
  },
  'job-brief'(db, ctx) { return ctx.job ? ctx.jobBrief : { skip: ctx.jobSkip || 'no job' }; },
  'practice-brief'(db, ctx) {
    const b = ctx.brief;
    if (!b || (!b.review.targets.length && !b.review.checks.length && !b.drills.length)) return { skip: b && b.review.exists ? 'today\'s review set already exists and no drill is due' : 'nothing to write today' };
    return b;
  },
  /** How to bring Canvas in: the tab, then each part's script, poll and unwrap, as commands of this checkout. */
  'canvas-brief'(db, ctx, spec) {
    const c = spec.registry.canvas; const d = ctx.dir; const cli = 'node core/cli.mjs';
    const part = p => ({ part: p, print: `${cli} canvas-script ${p} --dir ${d}`, poll: `${cli} canvas-script poll --of ${p} --dir ${d}`, unwrap: `${cli} unwrap <the file the tool saved> --to ${d}/in/canvas-${p}.json` });
    return {
      host: c.host, tab: `a tab on ${c.host.replace(/^https:\/\//, '')} in the built-in browser (tools: ToolSearch query "mcp__remote-devices__Claude_Browser__", max_results 64; tabs_context lists the tabs; with none, preview_start ${c.host})`,
      parts: [part('dates'), part('files'), { part: 'texts', print: `${cli} canvas-script texts --dir ${d} --batch <n>`, poll: `${cli} canvas-script poll --of texts --dir ${d}`, unwrap: `${cli} unwrap <the file the tool saved> --to ${d}/in/canvas-texts-<n>.json`, batches: 'the first texts command says how many batches there are (none when no file is new or changed); do each n in turn, one at a time (start, poll, unwrap); if unwrap says a batch was cut, run that batch again with --ids <one fileId> per file and unwrap each to canvas-texts-<n>-<fileId>.json' }],
      rules: ['GET requests only, through the printed scripts', 'never click, type, submit, sign in or sign out on Canvas', 'never open quizzes, exams, assignments, grades, submissions or feedback', 'never retype a result: only unwrap files the tool saved'],
    };
  },
  /** What the Canvas sync found that Matt should hear about tonight, and on Saturdays his Quizlet home page. */
  'evening-note'(db, ctx) {
    const c = ctx.canvas; if (!c) return { skip: 'no Canvas step ran' };
    const saturday = EV.weekday(ctx.date) === 6;
    if (!saturday && !c.candidates.length) return { skip: 'no possible conflicts and not Saturday' };
    const ms = models(db).filter(w => EV.isActive(w));
    const soon = (db.exams || []).filter(e => e.date && e.date >= ctx.date && e.date <= EV.addDays(ctx.date, 7)).map(e => ({ id: e.id, title: e.title, date: e.date }));
    return {
      canvas: { status: c.status, changes: c.changes.map(x => x.text), possibleConflicts: c.candidates, errors: c.errors },
      ...(saturday ? { quizlet: 'Saturday: in the built-in browser, open https://quizlet.com/latest in a new tab with preview_start and read it with get_page_text (max_chars 1500): only the "Jump back in" decks with their % done and the "Recents" list. Never click, type, start or change anything there; a sign-in page means skip it and say so.', openWeakSpots: ms.slice(0, 15).map(w => w.topic), examsThisWeek: soon } : {}),
    };
  },
  'week-brief'(db, ctx) { return ctx.week; },
  /** What the day looks like, for a one-line note. */
  'day-summary'(db, ctx) {
    const day = (db.days || []).find(d => d.id === ctx.date);
    return { date: ctx.date, dayType: day ? day.dayType : null, items: day ? day.list.items.map(i => i.text) : [] };
  },
};

// ------------------------------------------------------------------------------------------------ named probes
/** The named probe a firing text asks for ('ceilings', or 'Probe: ceilings'), or null for a free-form probe. */
export function probeNamed(spec, text) {
  const probes = ((spec.pipelines.diagnostic || {}).probes) || {};
  const name = String(text || '').trim().replace(/^probe:\s*/i, '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(probes, name) && !name.startsWith('_') ? { name, def: probes[name] } : null;
}
const PAD = 'E.V. probe padding, not study data. ';
/** One probe document of about `bytes` bytes as JSON: the envelope, its label and padding. */
export function probeDoc(ctx, label, bytes) {
  const base = { schema: 1, writer: 'diagnostic', at: ctx.now, source: ctx.source, release: ctx.release, run: ctx.runId, label, bytes, pad: '' };
  const room = Math.max(0, bytes - Buffer.byteLength(JSON.stringify(base)));
  base.pad = PAD.repeat(Math.ceil(room / PAD.length)).slice(0, room);
  return base;
}
const kib = n => String(n).padStart(4, '0');
/**
 * The groups of exact calls a named probe makes, each document written to <ctx.dir>/probe/ first (so a call names a
 * file, never inline data). Ids are debug/<run id>-<label>; nothing is created twice and nothing is deleted.
 */
export function probeGroups(named, ctx) {
  const dir = path.join(ctx.dir, 'probe');
  const file = (label, bytes) => { const f = path.join(dir, label + '.json'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(probeDoc(ctx, label, bytes))); return f; };
  return named.def.groups.map(g => {
    const calls = [];
    for (const k of g.documentKiB || []) { const label = 'doc-' + kib(k) + 'k'; calls.push({ tool: 'ArtifactData', args: { action: 'set', url: ctx.url, collection: 'debug', doc_id: ctx.runId + '-' + label, file_path: file(label, k * 1024) } }); }
    for (const b of g.batches || []) {
      const writes = [];
      for (let i = 1; i <= b.writes; i++) { const label = `batch-${b.writes}x${kib(b.kib)}k-${String(i).padStart(2, '0')}`; writes.push({ op: 'set', collection: 'debug', doc_id: ctx.runId + '-' + label, file_path: file(label, b.kib * 1024) }); }
      calls.push({ tool: 'ArtifactData', args: { action: 'batch', url: ctx.url, writes } });
    }
    return { name: g.name, rule: g.rule, calls };
  });
}

export const AGENT_FOLDS = {
  /** {findings, proven?, limits?}: the run's ledger entry carries them (a design chat turns them into registry rows). */
  'probe-result'(answer, db, ctx) {
    const numbers = answer.numbers || {};
    const parts = [answer.findings, ...(answer.proven || []).map(p => 'proven: ' + p), ...(answer.limits || []).map(l => 'limit: ' + l), ...Object.entries(numbers).map(([k, v]) => `${k}=${v}`)];
    const doc = { ...EV.envelope('diagnostic', ctx.source, ctx.now), release: ctx.release, run: ctx.runId, probe: String(ctx.input.probe).slice(0, 500), findings: answer.findings, proven: answer.proven || [], limits: answer.limits || [], numbers };
    return { writes: [{ op: 'set', collection: 'debug', id: ctx.runId, data: doc }], detail: parts.join(' | ').slice(0, 500), push: ('Diagnostic: ' + answer.findings).slice(0, 120), say: [`${(answer.proven || []).length} proven, ${(answer.limits || []).length} limits, ${Object.keys(numbers).length} numbers.`] };
  },
  /** {text, links?, items?, plan?, failed?}: jobresults/<id>, what the job made, and E.V.'s message in talk/<date>. */
  'job-result'(answer, db, ctx) {
    const job = ctx.job; const writes = []; const say = [];
    const failed = answer.failed ? String(answer.failed) : null;
    const result = { text: failed ? 'I couldn’t finish this one: ' + failed : answer.text, links: (answer.links || []).map(l => ({ ...(l.title ? { title: String(l.title).slice(0, 120) } : {}), url: l.url })) };
    const doc = result.links.find(l => /^https:\/\/claude\.ai\//.test(l.url)); if (doc && job.kind === 'study-guide') result.docUrl = doc.url;
    if (!failed && job.kind === 'practice-set') {
      const raw = answer.items || []; const items = [];
      for (const r of raw) { const q = { id: 'p' + (items.length + 1), kind: r && r.weakspotId ? 'review' : 'check', ...pick(r || {}, ITEM_FIELDS) }; if (q.weakspotId && !(db.weakspots || []).some(w => w.id === q.weakspotId)) delete q.weakspotId; if (EV.validateItem(q, { strict: true }).ok) items.push(q); }
      if (items.length) {
        const setId = 'job-' + job.id.replace(/^job-/, '');
        const target = EV.targetExam({ exams: db.exams || [], objectives: db.objectives || [], weakspots: models(db), date: ctx.date });
        writes.push({ op: 'set', collection: 'sets', id: setId, data: { ...EV.envelope('worker', ctx.source, ctx.now), kind: 'job', date: ctx.date, ...(target ? { exam: target.id } : {}), title: job.title, items, createdAt: ctx.now } });
        result.setId = setId; say.push(`Practice set ${setId}: ${items.length} of ${raw.length} questions kept.`);
      } else result.text += ' (The questions didn’t pass my checks, so nothing was saved.)';
    }
    if (!failed && job.kind === 'exam-plan' && answer.plan && answer.plan.exam && Array.isArray(answer.plan.days) && answer.plan.days.length) {
      const p = answer.plan; const exists = (db.plans || []).some(x => x.id === p.exam);
      const planId = exists ? p.exam + '-draft' : p.exam;
      writes.push({ op: 'set', collection: 'plans', id: planId, data: { ...EV.envelope('worker', ctx.source, ctx.now), ...pick(p, ['exam', 'title', 'days']) } });
      result.text += exists ? ` (Your current ${p.exam} plan stays; this one is saved as plans/${planId}.)` : '';
      say.push(`Plan ${planId}: ${p.days.length} days.`);
    }
    const key = `m-${EV.compactTime(ctx.now)}-job`;
    const message = { role: 'ev', text: result.text.slice(0, 4000), cards: [{ type: 'job', id: job.id }, ...(result.setId ? [{ type: 'set', id: result.setId }] : [])], at: ctx.now, jobId: job.id };
    const day = (db.talk || []).find(t => t.id === ctx.date);
    writes.push(day ? { op: 'update', collection: 'talk', id: ctx.date, data: { messages: { [key]: message } } } : { op: 'set', collection: 'talk', id: ctx.date, data: { ...EV.envelope('worker', ctx.source, ctx.now), date: ctx.date, messages: { [key]: message } } });
    writes.unshift({ op: 'set', collection: 'jobresults', id: job.id, data: { ...EV.envelope('worker', ctx.source, ctx.now), release: ctx.release, status: failed ? 'failed' : 'done', startedAt: ctx.startedAt, finishedAt: ctx.now, result, message: key, error: failed } });
    say.push(`Job ${job.id} ${failed ? 'failed' : 'done'}; message posted to talk/${ctx.date}.`);
    return { writes, say, push: result.text.split(/(?<=[.!?])\s/)[0].slice(0, 120) };
  },
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
  /** {status, problem?}: the Canvas files the run collected become dates, announcements and library materials. */
  'canvas-sync'(answer, db, ctx, spec) {
    const skip = (why) => { ctx.canvas = { status: answer.status, changes: [], candidates: [], errors: [why] }; return { detail: 'Canvas skipped: ' + why, say: ['Canvas skipped: ' + why] }; };
    if (answer.status !== 'ok') return skip(`${answer.status}${answer.problem ? ' (' + answer.problem + ')' : ''}`);
    const raw = canvasRaw(path.join(ctx.dir, 'in'), spec);
    if (raw.collected.signedOut) return skip('signed-out (a script found the Canvas sign-in page)');
    if (!raw.collected.dates) return skip('no dates collected');
    const res = EV.normalizeCanvas(raw, db, { now: ctx.now });
    const writes = [
      ...res.dates.map(d => ({ op: d.op || ((db.dates || []).some(x => x.id === d.id) ? 'update' : 'set'), collection: 'dates', id: d.id, data: d.data })),
      ...res.announcements.map(a => ({ op: 'set', collection: 'announcements', id: a.id, data: a.data })),
      ...res.materials.map(m => ({ op: 'set', collection: 'materials', id: m.id, data: m.data })),
    ];
    ctx.canvas = { status: 'ok', changes: res.changes, candidates: res.candidates, errors: raw.errors };
    const n = k => res.changes.filter(c => c.type === k).length;
    const detail = `Canvas: ${n('new-date')} new and ${n('changed-date')} changed dates, ${res.announcements.length} announcements, ${res.materials.length} files${res.candidates.length ? `, ${res.candidates.length} possible conflicts` : ''}${raw.errors.length ? `, ${raw.errors.length} fetch errors` : ''}`;
    return { writes, detail, say: [detail + '.'] };
  },
  /** {note}: the one short note the run ends with. */
  'evening-note'(answer) { return { detail: answer.note, push: answer.note.slice(0, 120) }; },
  /** {review, reflection, push}: weeks/<Sunday> with the week's roll-ups and the review as written. */
  'week-doc'(answer, db, ctx, spec) {
    const data = produce(db, spec, 'weeks', { date: ctx.date, now: ctx.now }, { source: ctx.source, stored: { review: answer.review, reflection: answer.reflection } });
    return { writes: [{ op: 'set', collection: 'weeks', id: ctx.date, data }], push: answer.push, say: ['Weekly review written.'] };
  },
  /** {push}: the run's push line, as the agent wrote it. */
  'push-line'(answer) { return { push: answer.push }; },
};
