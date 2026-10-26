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
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import EV from './evcore.mjs';
import { verify, verifyReads } from './deploy.mjs';
import { readState, withShell } from './verifystate.mjs';
import { produce, classOf, factsSplitFor, examTomorrow } from './derive.mjs';
import { watch, schedulerView } from './watch.mjs';
import * as STUDY from './study.mjs';
import { buildRecap, chartFromMain } from './recap.mjs';
import { canvasRaw } from './canvas.mjs';
import { collectionHash, migrateBackup, migratedLine } from './seed.mjs';
import { lintRecord, lintSummary } from './lint.mjs';
import { loadValidator, loadSchemas } from './schemas.mjs';
import { describeErrors } from './validate.mjs';
import { models, ITEM_FIELDS, pick, library, passages } from './steps-shared.mjs';
import * as WORKER from './steps-worker.mjs';
import * as DIAGNOSTIC from './steps-diagnostic.mjs';
import * as D1B from './d1backup.mjs';

/**
 * The evening push line (B-40, Matt's pick 8), composed from state/current (just written by the state step) and
 * days/<tomorrow> (or tomorrow's plan as the morning will make it, when that document is not written yet): today's
 * review answered or left, weak spots made solid or reopened today, tomorrow's day type and first item, and last
 * night's Canvas note (D-097), and tomorrow's pack check when tomorrow is a prep day (B-107, D-143). Fits
 * spec.constants.push.maxChars.
 */
export function eveningPush(db, ctx, spec) {
  const max = ((spec.constants || {}).push || {}).maxChars || 120;
  const date = ctx.date,
    tomorrow = EV.addDays(date, 1);
  const stale = healthStale(db, ctx.now, spec);
  const st = (db.state || []).find(d => d.id === 'current');
  const today = st && st.snapshot && st.snapshot.date === date ? st.snapshot.today : null;
  const set = (db.sets || []).find(s => s.id === 'review-' + date);
  const items = today && today.reviewItems != null ? today.reviewItems : set ? (set.items || []).length : 0;
  const answered =
    today && today.answered != null ? today.answered : set ? EV.answeredItems(set, db.answers || []).length : 0;
  const parts = [];
  if (stale) parts.push({ text: stale }); // D-111: first, so fitting the line never drops it
  // B-107 (D-143): the night-before pack check, from tomorrow's prep check in the snapshot just written; before the
  // rest, so fitting the line shortens its title but never drops it.
  const prep = st && st.snapshot && st.snapshot.date === date ? st.snapshot.prep : null;
  if (prep)
    parts.push(
      prep.empty && !prep.items.length
        ? { text: 'Prep: nothing in your materials for ', tail: prep.title }
        : { text: `Pack ${prep.items.length} for `, tail: prep.title }
    );
  if (items)
    parts.push({
      text:
        answered >= items
          ? `Review done (${items})`
          : answered
            ? `Review ${answered}/${items}, ${items - answered} left`
            : `Review: ${items} left`,
    });
  const ms = models(db);
  const on = x => x && EV.chicagoDate(x) === date;
  const solid = ms.filter(w => (w.kind || 'concept') === 'concept' && EV.isSolid(w) && on(w.derived.solidAt)).length;
  const back = ms.filter(w => (w.kind || 'concept') === 'concept' && EV.isActive(w) && on(w.derived.reopenedAt)).length;
  if (solid || back)
    parts.push({
      text: [solid ? `${solid} solid` : null, back ? `${back} reopened` : null].filter(Boolean).join(', '),
    });
  const day =
    (db.days || []).find(d => d.id === tomorrow) ||
    produce(db, spec, 'days', { date: tomorrow, now: ctx.now }, { source: ctx.source });
  const first = day && day.list && (day.list.items || [])[0];
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][EV.weekday(tomorrow)];
  if (day)
    parts.push({ text: `${wd}: ${day.dayType || 'day'}${first ? ', first ' : ''}`, tail: first ? first.text : '' });
  const macs = (db.runs || [])
    .filter(r => r.pipeline === 'evening-mac' && r.status !== 'running' && EV.toMs(r.startedAt) < EV.toMs(ctx.now))
    .sort((a, b) => EV.toMs(b.startedAt) - EV.toMs(a.startedAt));
  const mac = macs[0];
  if (mac && EV.toMs(ctx.now) - EV.toMs(mac.startedAt) < 36 * 3600e3)
    parts.push(
      mac.status === 'ok'
        ? { text: 'Canvas: ', tail: String(mac.push || 'synced').replace(/^Canvas:\s*/i, '') }
        : { text: "Canvas: last night's sync failed" }
    );
  const line = ps => ps.map(p => p.text + (p.tail || '')).join(' · ');
  // Fit: shorten the tails (tomorrow's first item, the Canvas note), then drop parts from the end.
  let ps = parts.slice();
  while (ps.length && line(ps).length > max) {
    const over = line(ps).length - max;
    const t = ps
      .slice()
      .reverse()
      .find(p => p.tail && p.tail.length > 12);
    if (t) {
      t.tail = t.tail.slice(0, Math.max(10, t.tail.length - over - 1)).replace(/\s+\S*$/, '') + '…';
      continue;
    }
    ps = ps.slice(0, -1);
  }
  return line(ps) || 'Evening snapshot saved';
}

/**
 * D-111 (trace or caught): the words a push line leads with when health/current is older than
 * spec.constants.health.staleHours (the watchdog that writes it may have stopped), or null when it is fresh.
 */
function healthStale(db, now, spec) {
  const hours = ((spec.constants || {}).health || {}).staleHours || 4;
  const h = (db.health || []).find(d => d.id === 'current');
  // B-138 (D-180): the words say who acts on them, so a stale line is never only an alarm for Matt.
  const look = ', a build chat will look';
  if (!h) return 'No health check yet' + look;
  const age = (EV.toMs(now) - EV.toMs(h.at)) / 3600e3;
  return age > hours ? `Health check ${Math.floor(age)} h old${look}` : null;
}
/** A push line led by the stale-health words when there are any, cut to spec.constants.push.maxChars. */
function withStale(line, db, ctx, spec) {
  const stale = healthStale(db, ctx.now, spec);
  if (!stale) return line;
  const max = ((spec.constants || {}).push || {}).maxChars || 120;
  const out = line ? `${stale} · ${line}` : stale;
  return out.length <= max ? out : out.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

export const CODE_STEPS = {
  /** Weak spots whose exam has passed are parked: one event each, appended (never a change to the Fact). */
  'auto-park'(db, ctx) {
    const writes = EV.autoParkEvents({
      weakspots: models(db),
      exams: db.exams || [],
      date: ctx.date,
      now: ctx.now,
      writer: ctx.writer,
    });
    return { writes, say: writes.length ? [`Parked ${writes.length} weak spot(s) whose exam has passed.`] : [] };
  },
  /** state/current: the snapshot, the derived hash and the Fact hashes lint checks against. */
  state(db, ctx, spec) {
    // D-090: the nightly record lint, on this run's pull and before the fact hashes are taken again, so a Fact changed
    // since last night is caught here; kept in state/current.lint, which the System tab's Checks card shows.
    const lint = lintSummary(lintRecord(db, spec, loadValidator(), { date: ctx.date, commit: ctx.commit || null }), {
      at: ctx.now,
      commit: ctx.commit || null,
    });
    const inputs = { date: ctx.date, now: ctx.now, specVersion: spec.specVersion, release: ctx.release || null, lint };
    let data = produce(db, spec, 'state', inputs, { source: ctx.source });
    // B-37 (D-093): past its warnBytes, state/current keeps the snapshot and the fact hashes move per collection.
    const split = factsSplitFor(spec, data);
    const writes = [];
    if (split.length) {
      data = produce(db, spec, 'state', { ...inputs, split }, { source: ctx.source });
      for (const c of split)
        writes.push({
          op: 'set',
          collection: 'state',
          id: 'facts-' + c,
          data: produce(db, spec, 'state', { ...inputs, part: c }, { source: ctx.source }),
        });
    }
    writes.unshift({ op: 'set', collection: 'state', id: 'current', data });
    return {
      writes,
      say: [
        `Lint: ${lint.errors} errors, ${lint.warnings} warnings, ${lint.notes} notes.`,
        `Snapshot: ${data.snapshot.weakspots.active} active weak spots, ${data.snapshot.due.count} due.${split.length ? ` Fact hashes split into ${split.length} state/facts-* documents (state/current reached its budget).` : ''}`,
      ],
    };
  },
  /** The evening push line (B-40): what today did and what tomorrow starts with, from the snapshot just written. */
  push(db, ctx, spec) {
    const line = eveningPush(db, ctx, spec);
    return { push: line, say: ['Push: ' + line] };
  },
  /** predictions/<examId> on the day before a NUR unit exam (D-094): the readiness prediction calibrate reads later. */
  prediction(db, ctx, spec) {
    const e = examTomorrow(db, ctx.date);
    if (!e) return { say: [] };
    const data = produce(
      db,
      spec,
      'predictions',
      { examId: e.id, date: ctx.date, now: ctx.now },
      { source: ctx.source }
    );
    if (!data.predictedRange)
      return { say: [`No prediction for ${e.id}: no past scores and no answers in the last 7 days.`] };
    return {
      writes: [{ op: 'set', collection: 'predictions', id: e.id, data }],
      say: [`Prediction for ${e.id}: ${data.predictedRange.join('–')}.`],
    };
  },
  /** days/<date>: the plan and the list. */
  day(db, ctx, spec) {
    const data = produce(db, spec, 'days', { date: ctx.date, now: ctx.now }, { source: ctx.source });
    // The run's push leads with a stale health check (D-111); the days document keeps its own push as built.
    return {
      writes: [{ op: 'set', collection: 'days', id: ctx.date, data }],
      push: withStale(data.push, db, ctx, spec),
      say: [`Day list: ${data.list.items.length} items.`],
    };
  },
};

// ------------------------------------------------------------------------------------------------ morning
/**
 * B-43 (D-100): the library's dosage material (spec.items.dosage: a file whose title or module matches, never the
 * syllabus, a calendar, drug cards or a medication table), the only ground a dosage drill or numeric item stands on.
 */
function dosageLibrary(db, spec) {
  const mats = EV.liveMaterials(db.materials, db.materialedits)
    .filter(m => !(m.needsOcr && !m.ocr))
    .filter(m => EV.isDosageMaterial(m));
  return {
    ids: new Set(mats.map(m => 'materials/' + m.id)),
    index: mats.length ? EV.libraryIndex(EV.libraryChunks(mats)) : null,
  };
}
/** The day's practice to write: review targets, new checks, drills the plan calls for, each with its passages. */
CODE_STEPS['practice-brief'] = function practiceBrief(db, ctx, spec) {
  const ms = models(db);
  const byId = Object.fromEntries(ms.map(w => [w.id, w]));
  const day = EV.planDay({
    date: ctx.date,
    dates: db.dates || [],
    dateedits: db.dateedits || [],
    exams: db.exams || [],
    plans: db.plans || [],
    planedits: db.planedits || [],
    weakspots: ms,
    objectives: db.objectives || [],
    sets: db.sets || [],
    answers: db.answers || [],
    // B-170: the same pick days/<date> shows, by spec.study's scheduler and aim (B-68's scheduler too, so a flip of
    // either writes the review set it lists).
    pickReviews: STUDY.dayPicker(EV, spec, { weeks: db.weeks || [], date: ctx.date }),
  });
  const setId = 'review-' + ctx.date;
  const existing = (db.sets || []).find(x => x.id === setId);
  const have = !!(existing && (existing.items || []).length);
  const idx = library(db);
  const objective = id => (db.objectives || []).find(o => o.id === id) || { id, text: '' };
  const targets = have
    ? []
    : day.reviews.ids.map(id => {
        const w = byId[id];
        return {
          weakspotId: id,
          topic: w.topic,
          objective: w.objective,
          preRead: !!w.derived.preRead,
          misses: w.derived.misses,
          recurrence: w.derived.recurrence,
          lastResult: w.derived.lastResult,
          history: w.derived.history.slice(-4),
          passages: passages(idx, w.topic + ' ' + objective(w.objective).text),
        };
      });
  const checks = have
    ? []
    : day.reviews.checks.map(id => {
        const o = objective(id);
        return {
          objective: id,
          text: o.text || '',
          chapters: o.chapters || '',
          passages: passages(idx, (o.text || '') + ' ' + (o.chapters || '')),
        };
      });
  const drills = [];
  for (const b of day.blocks.filter(b => ['drill', 'sim'].includes(b.kind) && !b.done && !b.deferred && b.drill)) {
    if ((db.sets || []).some(x => x.planTaskId === b.taskId)) continue;
    const weakFocused = /weak spot/i.test(b.title);
    const aimed = weakFocused
      ? EV.rankDue(
          ms.filter(w => EV.isActive(w) && EV.examOf(w) === b.plan),
          '9999-12-31',
          db.exams || []
        )
          .sort((x, y) => EV.reviewNeed(y) - EV.reviewNeed(x))
          .slice(0, 15)
          .map(w => ({ weakspotId: w.id, topic: w.topic, objective: w.objective }))
      : [];
    const topics = aimed.length ? aimed.map(t => t.topic) : [b.title + ' ' + (b.chapters || []).join(' ')];
    drills.push({
      setId: `${b.plan}-drill-${b.drill}`,
      planTaskId: b.taskId,
      exam: b.plan,
      title: b.title,
      count: b.kind === 'sim' ? 30 : 15,
      chapters: b.chapters || [],
      objectives: (db.objectives || []).filter(o => o.exam === b.plan).map(o => o.id),
      targets: aimed,
      passages: topics.slice(0, 8).flatMap(t => passages(idx, t, 1)),
    });
  }
  // B-43 (D-100): dosage drills. A plan's drill on dosage is one, and so is a drill of its own on each day within
  // nearExamWithinDays of an exam of kind dosage; each is numeric items only, on dosage material passages alone.
  const dcfg = ((spec && spec.items) || {}).dosage || {};
  const dose = dosageLibrary(db, spec);
  const dosePassages = extra =>
    dose.index ? passages(dose.index, `${dcfg.query || 'dosage calculation'} ${extra || ''}`, 6) : [];
  for (const d of drills)
    if (EV.isDosageTopic(d.title)) {
      d.numeric = true;
      d.passages = dosePassages(d.title);
    }
  const near = EV.constants().review.nearExamWithinDays;
  const doneExam = id => (db.examedits || []).some(x => x.id === id && x.status === 'done');
  for (const ex of db.exams || []) {
    if (ex.kind !== 'dosage' || ex.status === 'done' || doneExam(ex.id) || !ex.date || ex.date < ctx.date) continue;
    if (EV.diffDays(ctx.date, ex.date) > near) continue;
    const id = `${ex.id}-dosage-${ctx.date}`;
    if ((db.sets || []).some(x => x.id === id) || drills.some(d => d.numeric && d.exam === ex.id)) continue;
    drills.push({
      setId: id,
      exam: ex.id,
      title: 'Dosage drill · ' + String(ex.title || ex.id).replace(/:.*$/, ''),
      count: dcfg.count || 10,
      numeric: true,
      chapters: [],
      objectives: (db.objectives || []).filter(o => o.exam === ex.id).map(o => o.id),
      targets: [],
      passages: dosePassages(ex.title),
    });
  }
  const ungrounded = drills.filter(d => d.numeric && !d.passages.length);
  const kept = drills.filter(d => !ungrounded.includes(d));
  ctx.brief = {
    date: ctx.date,
    dayType: day.dayType,
    review: { setId, exists: have, targets, checks },
    drills: kept,
    dosageRefs: [...dose.ids],
  };
  const say = [
    `Practice to write: ${targets.length} review target(s), ${checks.length} check(s), ${kept.length} drill(s).`,
  ];
  for (const d of ungrounded)
    say.push(`${d.title}: not written, no dosage material in the library to ground it in (spec.items.dosage).`);
  if (day.deferred.length) say.push('Deferred: ' + day.deferred.map(d => `${d.title} (${d.reason})`).join('; '));
  return { say };
};

// ------------------------------------------------------------------------------------------------ weekly
CODE_STEPS['week-brief'] = function weekBrief(db, ctx, spec) {
  // B-201: the build recap, from the Chart on origin/main in this run's clone; a run whose clone cannot give it says so
  // and writes the week without one.
  const chart = ctx.chart || chartFromMain(ROOT);
  ctx.recap = chart.refused ? null : buildRecap(chart, { from: EV.addDays(ctx.date, -6), to: ctx.date });
  const week = produce(db, spec, 'weeks', { date: ctx.date, now: ctx.now, recap: ctx.recap }, { source: ctx.source });
  const ms = models(db);
  const ahead = EV.liveDates(db.dates, db.dateedits)
    .filter(d => d.date > ctx.date && d.date <= EV.addDays(ctx.date, 7))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(d => ({ date: d.date, title: d.title, graded: !!d.graded, kind: d.kind }));
  const stillWeak = EV.rankDue(ms.filter(EV.isActive), '9999-12-31', db.exams || [])
    .slice(0, 5)
    .map(w => ({ topic: w.topic, objective: w.objective, recurrence: w.derived.recurrence }));
  // B-72 (D-120): the week's insights travel with the brief; the review interprets them and never recomputes them.
  ctx.week = {
    ...week.rollups,
    calibration: week.calibration,
    health: week.health,
    ahead,
    stillWeak,
    insights: week.insights,
  };
  return {
    say: [
      `Week ${week.rollups.from}..${week.rollups.to}: ${week.rollups.right}/${week.rollups.answered} right, ${week.rollups.newWeakSpots.length} new weak spots, ${week.rollups.solid.length} made solid.`,
      chart.refused ? `No build recap: the Chart on origin/main could not be read (${chart.refused}).` : ctx.recap,
    ],
  };
};

// ------------------------------------------------------------------------------------------------ worker
Object.assign(CODE_STEPS, WORKER.CODE_STEPS); // job-brief: core/steps-worker.mjs

// ------------------------------------------------------------------------------------------------ watchdog
/** The scheduler's last firing per task, from the pages the pull saved; null when there are none (B-61). */
const schedulerOf = (ctx, spec) => {
  if (ctx.scheduler !== undefined) return ctx.scheduler;
  const pages = ctx.dir ? schedulerPages(ctx) : [];
  return (ctx.scheduler = pages.length ? schedulerView(pages, { record: ctx.record, spec }) : null);
};
CODE_STEPS.watch = function watchStep(db, ctx, spec) {
  const v = watch(db, { now: ctx.now, record: ctx.record, spec, scheduler: schedulerOf(ctx, spec) });
  const writes = v.refires.map(r => ({
    op: 'set',
    collection: 'runs',
    id: r.id,
    data: {
      ...EV.envelope('watchdog', ctx.source, ctx.now),
      release: ctx.release,
      pipeline: 'watchdog',
      startedAt: ctx.now,
      endedAt: ctx.now,
      status: 'ok',
      detail: `re-fired ${r.target}: ${r.reason}`,
    },
  }));
  const fires = v.refires.map(r => ({ trigger_id: r.trigger, ...(r.text ? { text: r.text } : {}) }));
  const say = [
    `${v.missing.length} missed, ${v.stalledRuns.length} unfinished, ${v.stalledJobs.length} stalled; re-firing ${v.refires.length}.`,
    ...v.reported.map(r => `Not re-fired: ${r.target} (${r.why}).`),
  ];
  // B-61 (D-112): a firing with no run and a slot with no firing are named in the push, beside what was re-fired.
  const KIND_WORDS = { 'refused-at-start': 'fired but left no run', 'not-fired': 'was never fired' };
  const named = v.missing
    .filter(m => KIND_WORDS[m.kind])
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'refused-at-start' ? -1 : 1))
    .map(m => `${m.pipeline} ${KIND_WORDS[m.kind]} (${EV.chicagoClock(m.slot)})`);
  const parts = [
    ...named,
    ...v.refires.map(r => 're-fired ' + r.target),
    ...v.reported.map(r => r.target + ' ' + r.why),
  ];
  const push = parts.length ? `Watchdog: ${parts.join('; ')}`.slice(0, 120) : null;
  return { writes, fires, say, ...(push ? { push } : {}) };
};
CODE_STEPS.health = function healthStep(db, ctx, spec) {
  const data = produce(
    db,
    spec,
    'health',
    { now: ctx.now, record: ctx.record, scheduler: schedulerOf(ctx, spec) },
    { source: ctx.source }
  );
  return { writes: [{ op: 'set', collection: 'health', id: 'current', data }], say: ['health/current written.'] };
};

// ------------------------------------------------------------------------------------------------ evening-mac
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** B-317 (D-322): a Worker record's backup setting (spec.registry.records.<r>.runs.backup), or null. */
export function backupSetting(spec, record) {
  const runs = ((spec.registry || {}).records || {})[record];
  return (runs && runs.runs && runs.runs.backup) || null;
}
/** The Mac folder this run's record writes to: a Worker record's one backup folder (D-322), else
 *  spec.tasks.<record>.evening-mac.folders[0]. */
function macFolder(spec, record) {
  const b = backupSetting(spec, record);
  if (b && b.folder) return b.folder;
  const t = ((spec.tasks || {})[record] || {})['evening-mac'];
  if (!t || !(t.folders || []).length) throw new Error(`spec.tasks.${record}.evening-mac names no Mac folder`);
  return t.folders[0];
}
/** E.V. v4's own files in that folder: names v3's files never use, so the two never overwrite each other. */
export const MAC_FILES = { backup: day => `backup/E.V.-v4-backup-${day}.json`, mirror: 'mirror-v4' };
/** A backup as restore-drill checks it: every collection the run pulled (the journal and his notes too, D-335; never system), with counts and hashes. */
export function macBackup(db, { now, label, release }) {
  const collections = {};
  for (const col of Object.keys(db)
    .filter(c => c !== 'system')
    .sort())
    collections[col] = [...db[col]].sort((a, b) => (a.id < b.id ? -1 : 1));
  const b = EV.buildBackup(collections, { now, label, release });
  const hashes = Object.fromEntries(Object.entries(collections).map(([c, docs]) => [c, collectionHash(docs)]));
  return { ...b, hashes };
}
/** "schema versions days:2 exams:2" (collections past schema 1, in name order), or "schema versions all 1". */
export function backupSchemaLine(collections) {
  const v = Object.entries(collections || {})
    .map(([c, docs]) => [c, Math.max(1, ...(docs || []).map(d => d.schema || 1))])
    .filter(([, n]) => n > 1)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return 'schema versions ' + (v.length ? v.map(([c, n]) => `${c}:${n}`).join(' ') : 'all 1');
}

/**
 * This build's schema version per collection: the version its documents must carry (the registry's schema const). A
 * collection whose schema fixes none (legacy, which keeps copies of other documents as they were) maps to null: its
 * documents are restored as written, never migrated or refused for their version.
 */
function registryVersions(schemas = loadSchemas()) {
  return Object.fromEntries(
    Object.entries(schemas).map(([c, s]) => {
      const v = ((s.properties || {}).schema || {}).const;
      return [c, Number.isInteger(v) ? v : null];
    })
  );
}

/**
 * The restore a drill plans from a backup (D-186): {writes, detail, push, say, schemas} or {problems}. The backup is
 * checked as written against its own manifest, migrated to `versions` (this build's schemas), then compared with the
 * record. Pure but for the clock in ctx.now.
 */
export function planRestore(b, db, ctx, spec, name = 'backup', versions = registryVersions()) {
  if (!b || b.kind !== 'E.V. record backup' || !b.hashes || !b.collections)
    return { problems: ['not a v4 backup (no kind, hashes or collections)'] };
  const problems = [];
  if (b.collections.system) problems.push('the backup holds system, which no backup may'); // the journal is in backups (D-335)
  for (const [c, docs] of Object.entries(b.collections)) {
    if (!spec.collections[c]) {
      problems.push(`the backup holds ${c}, which is no collection`);
      continue;
    }
    if (b.counts[c] !== docs.length) problems.push(`${c}: ${docs.length} documents, its manifest says ${b.counts[c]}`);
    if (b.hashes[c] !== collectionHash(docs)) problems.push(`${c}: its documents do not hash to its manifest`);
  }
  for (const c of Object.keys(b.counts))
    if (!b.collections[c]) problems.push(`${c}: in the manifest, not in the backup`);
  if (problems.length) return { problems };
  const m = migrateBackup(b.collections, versions, { at: ctx.now });
  if (m.problems.length) return { problems: m.problems };
  const target = m.collections;
  // Linted as migrated: every document the restore would leave in the record validates against this build's schema.
  // A document with no v4 envelope (no schema or no writer) predates v4 (the v3 era before the Oct 18 cutover): no v4
  // writer made it, so it is restored as written, never refused for its shape, and the drill's line names how many.
  const validate = loadValidator();
  const preV4 = [];
  for (const [c, list] of Object.entries(target))
    for (const d of list) {
      const data = EV.docData(d);
      const r = validate(c, data, { id: d.id });
      if (r.ok) continue;
      if (data && (data.schema == null || data.writer == null)) preV4.push(`${c}/${d.id}`);
      else problems.push(describeErrors(`${c}/${d.id} after migration`, r).split('\n')[0]);
    }
  if (problems.length) return { problems: problems.slice(0, 20) };
  const same = (x, y) => EV.stableStringify(EV.docData(x)) === EV.stableStringify(EV.docData(y));
  const writes = [];
  let identical = 0,
    logsKept = 0,
    extra = 0;
  const after = {};
  for (const [c, docs] of Object.entries(target)) {
    const have = Object.fromEntries((db[c] || []).map(d => [d.id, d]));
    for (const d of docs) {
      const cur = have[d.id];
      if (cur && same(cur, d)) {
        identical++;
        continue;
      }
      if (cur && classOf(spec, c, d.id) === 'Log') {
        logsKept++;
        continue;
      }
      // asWritten (B-163): the record already holds this document as the backup does; planRestore has checked its shape
      // (a pre-v4 one has none to check), so the run's write check takes its shape and writer from here.
      writes.push({ op: 'set', collection: c, id: d.id, data: EV.docData(d), asWritten: true });
      have[d.id] = d;
    }
    const ids = new Set(docs.map(d => d.id));
    extra += (db[c] || []).filter(d => !ids.has(d.id)).length;
    after[c] = docs.map(d => have[d.id]);
  }
  for (const [c, docs] of Object.entries(after)) {
    const kept = docs.filter((d, i) => !same(d, target[c][i]));
    if (kept.some(d => classOf(spec, c, d.id) !== 'Log'))
      problems.push(`${c}: the record would not match the backup after the restore`);
    else if (!kept.length && collectionHash(docs) !== collectionHash(target[c]))
      problems.push(`${c}: restored, but its hash would differ`);
  }
  if (problems.length) return { problems };
  const docs = Object.values(b.counts).reduce((x, y) => x + y, 0);
  const moved = migratedLine(m.schemas);
  const detail = `drill ok: ${name} (${b.at}), ${Object.keys(b.collections).length} collections and ${docs} documents; counts and hashes match its manifest; ${moved ? 'migrated to this build: ' + moved : "every document already at this build's schema"}; ${writes.length} restored, ${identical} already identical, ${logsKept} log entries kept as they are, ${extra} documents not in the backup kept${preV4.length ? `; ${preV4.length} pre-v4 documents (no envelope) kept as written: ${preV4.slice(0, 6).join(', ')}${preV4.length > 6 ? ', …' : ''}` : ''}`;
  return {
    writes,
    detail,
    schemas: m.schemas,
    push: `Restore drill passed: ${docs} documents match the backup${moved ? ', migrated to this build' : ''}.`,
    say: [detail + '.'],
  };
}

/**
 * B-317 (D-322): a Worker record's drill. The backup (a Mac backup or an R2 export, one shape) is checked against its
 * own manifest and planned as writes into the scratch D1 under drills/<run id>/<collection>, new there, so nothing is
 * replaced. It writes nothing to the record but its own runs entry; the apply move restores, then reads the scratch
 * back and checks every collection's count and SHA-256 against the backup's manifest.
 */
function restoreToScratch(answer, db, ctx, spec) {
  const file = path.join(ctx.dir, 'in', 'backup.json');
  if (!fs.existsSync(file)) return { problems: [`no ${file}: save the backup there first`] };
  let b;
  try {
    b = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { problems: ['the backup does not parse: ' + e.message] };
  }
  const problems = D1B.backupProblems(b);
  if (problems.length) return { problems: problems.slice(0, 20) };
  // D-321: the per-target system documents are never restored (an export from before D-321 may hold them); the
  // read-back is held to the manifest of what is restored, checked above against the backup's own.
  const left = b.docs.filter(d => D1B.perTarget(d.c, d.id)).length;
  b = { ...b, docs: b.docs.filter(d => !D1B.perTarget(d.c, d.id)) };
  b.collections = D1B.manifestSync(b.docs.map(d => ({ ...d })));
  const scratch = (((spec.registry || {}).records || {})[ctx.record] || {}).runs || {};
  if (!scratch.scratch || !scratch.scratch.host)
    return { problems: ['spec names no scratch database for this record'] };
  const writes = b.docs.map(d => ({
    op: 'set',
    collection: D1B.drillCollection(ctx.runId, d.c),
    id: d.id,
    data: JSON.parse(d.data),
  }));
  const docs = b.docs.length;
  const n = Object.keys(b.collections).length;
  const from = path.basename(String(answer.path || 'backup'));
  return {
    writes: [],
    scratch: { host: scratch.scratch.host, prefix: `drills/${ctx.runId}`, want: b.collections, writes },
    detail: `drill: ${from} (${b.at}), ${n} collections and ${docs} documents; counts and hashes match its own manifest${left ? `; ${left} per-target system documents left out (D-321)` : ''}; restored into the scratch D1 under drills/${ctx.runId}`,
    push: `Restore drill passed: ${docs} documents match the backup.`,
    say: [`Restore drill: ${docs} documents in ${n} collections from ${from}, into the scratch D1.`],
  };
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
  const put = (rel, body) => {
    const f = path.join(out, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
    files.push({ stagedPath: f, devicePath: folder + '/' + rel });
  };
  // B-317: a Worker run's backup is its pull of D1, in the R2 export's shape with pwa/backup.js's hashes (D-322).
  const worker = ctx.target === 'worker';
  // The whole D1, as the pull's api dump saved it (every collection and page, the per-target system documents out).
  const dumped = worker ? path.join(ctx.dir, 'd1', 'rows.json') : null;
  if (worker && !fs.existsSync(dumped)) return { problems: [`no ${dumped}: make the printed api dump call first`] };
  const rows = worker ? JSON.parse(fs.readFileSync(dumped, 'utf8')) : null;
  const backup = worker
    ? D1B.backupOf(rows, { at: ctx.now, label: `${ctx.pipeline} ${ctx.runId}`, release: ctx.release })
    : macBackup(db, { now: ctx.now, label: `${ctx.pipeline} ${ctx.runId}`, release: ctx.release });
  const body = JSON.stringify(backup, null, 1);
  put(MAC_FILES.backup(day), body);
  const docs = worker ? rows.length : Object.values(backup.counts).reduce((a, b) => a + b, 0);
  const mirror = day === 'sunday' || /^(yes|true|1)$/i.test(String((ctx.input || {}).mirror || ''));
  let mirrored = 0;
  if (mirror) {
    const weakspotModels = models(db);
    for (const f of EV.toMarkdown({ ...db, weakspotModels }, { date: ctx.date })) {
      put(MAC_FILES.mirror + '/' + f.path, f.content);
      mirrored++;
    }
  }
  const device = [];
  for (let i = 0; i < files.length; i += 50)
    device.push({ tool: 'mcp__remote-devices__device_commit_files', args: { files: files.slice(i, i + 50) } });
  // B-163 (D-186): the backup's schema versions, so the watchdog can say how many bumps behind the latest backup is.
  const detail = `backup ${MAC_FILES.backup(day)} (${docs} documents, ${Math.round(Buffer.byteLength(body) / 1024)} KB; ${worker ? D1B.schemaLineOf(rows) : backupSchemaLine(backup.collections)})${mirror ? `, mirror ${mirrored} files` : ''}`;
  return { device, detail, say: [`Mac files: ${detail}, to ${folder}.`] };
};

export const AGENT_MATERIAL = {
  ...DIAGNOSTIC.AGENT_MATERIAL, // probe-brief: core/steps-diagnostic.mjs
  ...WORKER.AGENT_MATERIAL, // job-brief
  'practice-brief'(db, ctx) {
    const b = ctx.brief;
    if (!b || (!b.review.targets.length && !b.review.checks.length && !b.drills.length))
      return {
        skip: b && b.review.exists ? "today's review set already exists and no drill is due" : 'nothing to write today',
      };
    return b;
  },
  /** How to bring Canvas in: the tab, then each part's script, poll and unwrap, as commands of this checkout. */
  'canvas-brief'(db, ctx, spec) {
    const c = spec.registry.canvas;
    const d = ctx.dir;
    const cli = 'node core/cli.mjs';
    const part = p => ({
      part: p,
      print: `${cli} canvas-script ${p} --dir ${d}`,
      poll: `${cli} canvas-script poll --of ${p} --dir ${d}`,
      unwrap: `${cli} unwrap <the file the tool saved> --to ${d}/in/canvas-${p}.json`,
    });
    return {
      host: c.host,
      tab: `a tab on ${c.host.replace(/^https:\/\//, '')} in the built-in browser (tools: ToolSearch query "mcp__remote-devices__Claude_Browser__", max_results 64; tabs_context lists the tabs; with none, preview_start ${c.host})`,
      parts: [
        part('dates'),
        part('files'),
        {
          part: 'texts',
          print: `${cli} canvas-script texts --dir ${d} --batch <n>`,
          poll: `${cli} canvas-script poll --of texts --dir ${d}`,
          unwrap: `${cli} unwrap <the file the tool saved> --to ${d}/in/canvas-texts-<n>.json`,
          batches:
            'the first texts command says how many batches there are (none when no file is new or changed); do each n in turn, one at a time (start, poll, unwrap); if unwrap says a batch was cut, run that batch again with --ids <one fileId> per file and unwrap each to canvas-texts-<n>-<fileId>.json',
        },
      ],
      rules: [
        'GET requests only, through the printed scripts',
        'never click, type, submit, sign in or sign out on Canvas',
        'never open quizzes, exams, assignments, grades, submissions or feedback',
        'never retype a result: only unwrap files the tool saved',
      ],
    };
  },
  /** What the Canvas sync found that Matt should hear about tonight, and on Saturdays his Quizlet home page. */
  'evening-note'(db, ctx) {
    const c = ctx.canvas;
    if (!c) return { skip: 'no Canvas step ran' };
    const saturday = EV.weekday(ctx.date) === 6;
    if (!saturday && !c.candidates.length) return { skip: 'no possible conflicts and not Saturday' };
    const ms = models(db).filter(w => EV.isActive(w));
    const soon = (db.exams || [])
      .filter(e => e.date && e.date >= ctx.date && e.date <= EV.addDays(ctx.date, 7))
      .map(e => ({ id: e.id, title: e.title, date: e.date }));
    return {
      canvas: {
        status: c.status,
        changes: c.changes.map(x => x.text),
        possibleConflicts: c.candidates,
        errors: c.errors,
      },
      ...(saturday
        ? {
            quizlet:
              'Saturday: in the built-in browser, open https://quizlet.com/latest in a new tab with preview_start and read it with get_page_text (max_chars 1500): only the "Jump back in" decks with their % done and the "Recents" list. Never click, type, start or change anything there; a sign-in page means skip it and say so.',
            openWeakSpots: ms.slice(0, 15).map(w => w.topic),
            examsThisWeek: soon,
          }
        : {}),
    };
  },
  /** Where the newest v4 backup is on the Mac, and where the run wants its copy (restore-drill). */
  'backup-brief'(db, ctx, spec) {
    // B-317 (D-322): a Worker record's drill restores from its one backup folder, or the newest R2 export.
    const setting = ctx.target === 'worker' ? backupSetting(spec, ctx.record) : null;
    if (setting) {
      const saveTo = path.join(ctx.dir, 'in', 'backup.json');
      if (setting.restoreFrom === 'r2')
        return {
          source: 'the newest nightly export in R2 (B-316)',
          saveTo,
          how: 'run the one printed command; it saves the export to saveTo. Then answer {status: ok, path: <the key it printed>}.',
          groups: [
            {
              name: 'export',
              rule: 'one command, as printed',
              calls: [
                {
                  tool: 'Bash',
                  args: { command: `node core/cli.mjs api export --out ${saveTo} --worker ${ctx.worker}` },
                },
              ],
            },
          ],
        };
      return {
        source: 'the newest backup on the Mac',
        look: [setting.folder + '/backup'],
        files: 'E.V.-v4-backup-<weekday>.json',
        pick: 'the one with the newest mtimeMs',
        saveTo,
        how: "device_list_dir on the folder in look; device_stage_files with that one file's full path; then copy the staged file (the stage result names where it landed, under /mnt/user-data/uploads/) to saveTo with cp. Read nothing else on the Mac and change nothing there.",
      };
    }
    const t = ((spec.tasks || {})[ctx.record] || {})['restore-drill'];
    if (!t || !(t.folders || []).length) return { skip: `spec.tasks.${ctx.record}.restore-drill names no Mac folder` };
    const folder = t.folders[0];
    return {
      look: [folder + '/backup', folder + '/staging/backup'],
      files: 'E.V.-v4-backup-<weekday>.json (only these: v3 and v2 backups are other shapes)',
      pick: 'the one with the newest mtimeMs across both folders',
      saveTo: path.join(ctx.dir, 'in', 'backup.json'),
      how: "device_list_dir on each folder in look; device_stage_files with that one file's full path; then copy the staged file (the stage result names where it landed, under /mnt/user-data/uploads/) to saveTo with cp. Read nothing else on the Mac and change nothing there.",
    };
  },
  'week-brief'(db, ctx) {
    return ctx.week;
  },
  /**
   * B-29: the reads verify-deploy needs for this run's own record, as exact calls: list_triggers (paged by its cursor),
   * the record's system/*, its page and the page's files. This checkout is built into the run folder first (the gate
   * proved it is the deployed commit), so the run compares the record with what that commit builds, read-only.
   */
  'verify-brief'(db, ctx) {
    const v = verifyPaths(ctx);
    if (!fs.existsSync(path.join(v.build, 'manifest.json')))
      execFileSync(
        process.execPath,
        // B-149: the run's clone has no tags, so the build takes the deployed release to compare like with like.
        [
          path.join(ROOT, 'tools', 'build.mjs'),
          '--root',
          ROOT,
          '--out',
          v.build,
          '--now',
          ctx.now,
          ...(ctx.release ? ['--release', ctx.release] : []),
        ],
        { stdio: 'pipe' }
      );
    const manifest = JSON.parse(fs.readFileSync(path.join(v.build, 'manifest.json'), 'utf8'));
    const reads = verifyReads({ manifest, target: ctx.record, stateDir: v.state });
    return {
      target: ctx.record,
      rules: [
        'make each call exactly as listed, in order',
        'save each result as its note says, with the printed tool-result command (never retyped)',
        'a list_triggers result with a next_cursor: call it again with the same arguments plus cursor, save it as the next triggers-<n>.json, until there is none',
        'change nothing anywhere: these are reads',
      ],
      groups: [
        {
          name: 'verify-reads',
          rule: 'one call each, in order; stop at the first refusal and quote it',
          calls: reads.map(r => ({ tool: r.tool, args: r.args })),
        },
      ],
      saves: reads.map(r => ({ tool: r.tool, save: r.save, note: r.note })),
    };
  },
  /** What the day looks like, for a one-line note. */
  'day-summary'(db, ctx) {
    const day = (db.days || []).find(d => d.id === ctx.date);
    return { date: ctx.date, dayType: day ? day.dayType : null, items: day ? day.list.items.map(i => i.text) : [] };
  },
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Where a run keeps its verify build and saved reads; the state folder is named for the target, as verify expects. */
const verifyPaths = ctx => ({
  build: path.join(ctx.dir, 'verify', 'build'),
  state: path.join(ctx.dir, 'verify', ctx.record),
});
/** The weekly's verify result (B-29): what verify-deploy <record> says against this checkout's build, from the reads saved. */
function verifyOutcome(answer, ctx) {
  const v = verifyPaths(ctx);
  const base = { at: ctx.now, target: ctx.record };
  const mp = path.join(v.build, 'manifest.json');
  if (!fs.existsSync(mp))
    return { ...base, commit: null, green: null, checked: 0, differences: [], refused: 'the build did not run' };
  const manifest = JSON.parse(fs.readFileSync(mp, 'utf8'));
  if (!answer.saved)
    return {
      ...base,
      commit: manifest.commit,
      green: null,
      checked: 0,
      differences: [],
      refused: String(answer.refused || 'a read was not made').slice(0, 300),
    };
  const dist = Object.fromEntries(
    ['spec', 'environments'].map(id => [
      id,
      JSON.parse(fs.readFileSync(path.join(v.build, 'system', id + '.json'), 'utf8')),
    ])
  );
  const state = withShell(readState(v.state), manifest, ctx.record, v.build);
  // The commit is pushed: the gate found it in this checkout, a clone of origin's main.
  const r = verify({
    manifest,
    target: ctx.record,
    state,
    build: { pushed: true },
    dist,
    sha256: b => crypto.createHash('sha256').update(b).digest('hex'),
    now: ctx.now,
  });
  return {
    ...base,
    commit: manifest.commit,
    green: r.green,
    checked: r.lines.length,
    differences: r.lines
      .filter(l => !l.ok)
      .slice(0, 30)
      .map(l => ({ what: l.what, detail: String(l.detail || '').slice(0, 300) })),
  };
}

/** The scheduler pages a watchdog run's pull saved (triggers-1.json, -2, ... in its run folder), oldest first (B-61). */
function schedulerPages(ctx) {
  const dir = path.join(ctx.dir, 'scheduler');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => /^triggers-\d+\.json$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

export const AGENT_FOLDS = {
  /** {saved, refused?}: the verify result, kept on ctx for the week document written after it (B-29). */
  'verify-result'(answer, db, ctx) {
    const v = (ctx.verify = verifyOutcome(answer, ctx));
    return {
      say: [
        v.refused
          ? `verify-deploy ${v.target}: not run (${v.refused})`
          : `verify-deploy ${v.target}: ${v.green ? 'GREEN' : `RED (${v.differences.length} difference${v.differences.length === 1 ? '' : 's'})`}`,
      ],
    };
  },
  ...DIAGNOSTIC.AGENT_FOLDS, // probe-result
  ...WORKER.AGENT_FOLDS, // job-result
  /** {review: [items], drills: {setId: [items]}}: today's review set and each drill, keeping only valid items. */
  'practice-sets'(answer, db, ctx) {
    const b = ctx.brief;
    const writes = [];
    const say = [];
    const rejects = [];
    const doseRefs = new Set(b.dosageRefs || []);
    const keep = (raw, kind, id, where, drill) => {
      const q = { id, kind, ...pick(raw || {}, ITEM_FIELDS) };
      const v = EV.validateItem(q, { strict: true });
      const name = `${where} ${raw && raw.topic ? raw.topic : id}`;
      if (!v.ok) {
        rejects.push(`${name}: ${v.errors.join(', ')}`);
        return null;
      }
      // B-193 (D-205): an item on another course's passage still targets an objective of its own course.
      const cc = EV.crossCourse(q, {
        materials: db.materials,
        exams: db.exams,
        objectives: db.objectives,
        set: { exam: drill ? drill.exam : b.exam || null },
      });
      if (cc.errors.length) {
        rejects.push(`${name}: ${cc.errors[0]}`);
        return null;
      }
      // B-43 (D-100): a numeric item rests on dosage material, and a dosage drill holds numeric items on its passages.
      if (q.type === 'numeric' && !doseRefs.has(q.sourceRef)) {
        rejects.push(`${name}: a numeric item cites dosage material`);
        return null;
      }
      if (drill && drill.numeric) {
        if (q.type !== 'numeric') {
          rejects.push(`${name}: a dosage drill is numeric items only`);
          return null;
        }
        if (!drill.passages.some(p => p.ref === q.sourceRef)) {
          rejects.push(`${name}: not one of the drill's passages`);
          return null;
        }
      }
      return cc.item; // B-193: its stem names its source when it rests on another course's passage
    };
    const env = () => ({ ...EV.envelope('morning', ctx.source, ctx.now), schema: 3 }); // sets schema 3 (B-43, B-75)
    if (!b.review.exists && (b.review.targets.length || b.review.checks.length)) {
      const want = new Set(b.review.targets.map(t => t.weakspotId));
      const wantChecks = new Set(b.review.checks.map(c => c.objective));
      const used = new Set();
      const items = [];
      for (const raw of answer.review || []) {
        const key = raw && raw.weakspotId ? raw.weakspotId : 'check:' + (raw && raw.objective);
        if (raw && raw.weakspotId ? !want.has(raw.weakspotId) : !wantChecks.has(raw && raw.objective)) {
          rejects.push(`review ${raw && raw.topic}: not asked for today`);
          continue;
        }
        if (used.has(key)) {
          rejects.push(`review ${raw.topic}: a second item for the same target`);
          continue;
        }
        const q = keep(raw, raw.weakspotId ? 'review' : 'check', 'q' + (items.length + 1), 'review');
        if (!q) continue;
        used.add(key);
        items.push(q);
      }
      if (items.length) {
        writes.push({
          op: 'set',
          collection: 'sets',
          id: b.review.setId,
          data: {
            ...env(),
            kind: 'review',
            date: b.date,
            title: 'Review · ' + EV.shortDate(b.date),
            items,
            createdAt: ctx.now,
          },
        });
        say.push(`Review set: ${items.length} items.`);
      }
      const missing = [...want].filter(id => !used.has(id));
      if (missing.length) say.push(`No usable item for ${missing.join(', ')}.`);
    }
    for (const d of b.drills) {
      const items = [];
      for (const raw of (answer.drills || {})[d.setId] || []) {
        const q = keep(raw, 'drill', 'd' + (items.length + 1), d.setId, d);
        if (!q) continue;
        if (q.weakspotId && !(db.weakspots || []).some(w => w.id === q.weakspotId)) delete q.weakspotId;
        items.push(q);
      }
      if (items.length) {
        writes.push({
          op: 'set',
          collection: 'sets',
          id: d.setId,
          data: {
            ...env(),
            kind: 'drill',
            exam: d.exam,
            title: d.title,
            ...(d.planTaskId ? { planTaskId: d.planTaskId } : {}),
            objectives: d.objectives,
            items,
            createdAt: ctx.now,
          },
        });
        say.push(`Drill ${d.setId}: ${items.length} items.`);
      } else say.push(`Drill ${d.setId}: no usable items.`);
    }
    if (rejects.length) say.push(`Dropped ${rejects.length}: ${rejects.slice(0, 6).join('; ')}`);
    return { writes, say };
  },
  /** {status, problem?}: the Canvas files the run collected become dates, announcements and library materials. */
  'canvas-sync'(answer, db, ctx, spec) {
    const skip = why => {
      ctx.canvas = { status: answer.status, changes: [], candidates: [], errors: [why] };
      return { detail: 'Canvas skipped: ' + why, say: ['Canvas skipped: ' + why] };
    };
    if (answer.status !== 'ok') return skip(`${answer.status}${answer.problem ? ' (' + answer.problem + ')' : ''}`);
    const raw = canvasRaw(path.join(ctx.dir, 'in'), spec);
    if (raw.collected.signedOut) return skip('signed-out (a script found the Canvas sign-in page)');
    if (!raw.collected.dates) return skip('no dates collected');
    const res = EV.normalizeCanvas(raw, db, { now: ctx.now });
    const writes = [
      ...res.dates.map(d => ({
        op: d.op || ((db.dates || []).some(x => x.id === d.id) ? 'update' : 'set'),
        collection: 'dates',
        id: d.id,
        data: d.data,
      })),
      ...res.announcements.map(a => ({ op: 'set', collection: 'announcements', id: a.id, data: a.data })),
      ...res.materials.map(m => ({ op: 'set', collection: 'materials', id: m.id, data: m.data })),
    ];
    ctx.canvas = { status: 'ok', changes: res.changes, candidates: res.candidates, errors: raw.errors };
    const n = k => res.changes.filter(c => c.type === k).length;
    const detail = `Canvas: ${n('new-date')} new and ${n('changed-date')} changed dates, ${res.announcements.length} announcements, ${res.materials.length} files${res.candidates.length ? `, ${res.candidates.length} possible conflicts` : ''}${raw.errors.length ? `, ${raw.errors.length} fetch errors` : ''}${(res.refused || []).length ? `, ${res.refused.length} left out for a possible patient identifier` : ''}`;
    return { writes, detail, say: [detail + '.'] };
  },
  /**
   * {status, path?, problem?}: the restore drill. The backup's own counts and hashes are checked against its documents
   * as written; then (D-186, B-163) every document below this build's schema is migrated up to it, and every document
   * that differs from the record is set back to the backup's copy as migrated (Log entries the record already has are
   * kept: a log is never rewritten), and the record as it will stand is checked against the migrated backup. Documents
   * the record has and the backup lacks are kept and counted (nothing is deleted). A mismatch, a backup newer than this
   * build's schema or a version with no migration refuses the plan, with the reason.
   */
  restore(answer, db, ctx, spec) {
    if (ctx.target === 'worker' && answer.status === 'ok') return restoreToScratch(answer, db, ctx, spec);
    if (answer.status !== 'ok')
      return {
        problems: [`no backup to restore: ${answer.status}${answer.problem ? ' (' + answer.problem + ')' : ''}`],
      };
    const file = path.join(ctx.dir, 'in', 'backup.json');
    if (!fs.existsSync(file)) return { problems: [`no ${file}: copy the staged backup there first`] };
    let b;
    try {
      b = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      return { problems: ['the backup does not parse: ' + e.message] };
    }
    return planRestore(b, db, ctx, spec, path.basename(String(answer.path || 'backup')));
  },
  /** {note}: the one short note the run ends with. */
  'evening-note'(answer) {
    return { detail: answer.note, push: answer.note.slice(0, 120) };
  },
  /** {review, reflection, push}: weeks/<Sunday> with the week's roll-ups and the review as written. */
  'week-doc'(answer, db, ctx, spec) {
    const data = produce(
      db,
      spec,
      'weeks',
      { date: ctx.date, now: ctx.now, verify: ctx.verify || null, recap: ctx.recap || null },
      { source: ctx.source, stored: { review: answer.review, reflection: answer.reflection } }
    );
    return {
      writes: [{ op: 'set', collection: 'weeks', id: ctx.date, data }],
      push: answer.push,
      say: ['Weekly review written.'],
    };
  },
  /** {push}: the run's push line, as the agent wrote it. */
  'push-line'(answer) {
    return { push: answer.push };
  },
};
