// The watchdog's judgment, done by code (Operational architecture, "Observability"): which scheduled slots were missed,
// which runs never ended, which jobs stalled in the queue, and which of them to re-fire. Each is re-fired once: the
// re-fire writes runs/watchdog-refire-<target> (a Log), so a second miss finds it and is reported, not retried. A
// missed morning is re-fired until 6:00am Central and never after; the windows live in spec.constants.watchdog. Pure.
import EV from './evcore.mjs';

const ms = x => EV.toMs(x);
const W = spec => ({ jobStallMinutes: 15, runTimeoutMinutes: 60, graceMinutes: 30, refireWithinMinutes: 180, refireUntil: {}, ...((spec.constants && spec.constants.watchdog) || {}) });

/** A cron field (numbers, *, a,b, a-b, * /n) as a set test. */
function field(spec, lo, hi) {
  if (spec === '*') return () => true;
  const ok = new Set();
  for (const part of spec.split(',')) {
    const [range, step] = part.split('/'); const n = Number(step || 1);
    const [a, b] = range === '*' ? [lo, hi] : range.includes('-') ? range.split('-').map(Number) : [Number(range), Number(range)];
    for (let i = a; i <= b; i += n) ok.add(i);
  }
  return v => ok.has(v);
}
/** UTC instant of a Central wall-clock time (handles daylight time by trying both offsets). */
function chicagoInstant(date, hh, mm) {
  for (const off of [5, 6]) { const t = Date.parse(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`) + off * 36e5; const iso = new Date(t).toISOString(); if (EV.chicagoDate(iso) === date && EV.chicagoClock(iso) === `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) return iso; }
  return null;
}
/** The latest slot of a `CRON_TZ=America/Chicago m h dom mon dow` schedule at or before `now`, within 8 days. */
export function lastSlot(schedule, now) {
  const m = /^CRON_TZ=America\/Chicago (\S+) (\S+) (\S+) (\S+) (\S+)$/.exec(schedule || ''); if (!m) return null;
  const [mi, ho, dom, mon, dow] = [field(m[1], 0, 59), field(m[2], 0, 23), field(m[3], 1, 31), field(m[4], 1, 12), field(m[5], 0, 6)];
  const today = EV.chicagoDate(now);
  for (let back = 0; back <= 8; back++) {
    const d = EV.addDays(today, -back); const [y, mo, da] = d.split('-').map(Number);
    if (!dom(da) || !mon(mo) || !dow(new Date(Date.UTC(y, mo - 1, da)).getUTCDay())) continue;
    for (let h = 23; h >= 0; h--) { if (!ho(h)) continue; for (let x = 59; x >= 0; x--) { if (!mi(x)) continue; const t = chicagoInstant(d, h, x); if (t && ms(t) <= ms(now)) return t; } }
  }
  return null;
}

/**
 * db: runs, jobs, jobresults, state (as pulled). Returns {pipelines, missing, stalledRuns, stalledJobs, refires,
 * reported}: refires are {id (the runs record), target, trigger, text?, reason}; reported are second misses and
 * misses past their window.
 */
export function watch(db, { now, record, spec }) {
  const w = W(spec); const tasks = (spec.tasks && spec.tasks[record]) || {};
  const runs = (db.runs || []).filter(r => r.pipeline);
  const done = new Map(runs.map(r => [r.id, r]));
  const minutes = since => Math.round((ms(now) - ms(since)) / 6e4);
  const pipelines = {};
  for (const r of [...runs].sort((a, b) => ms(a.startedAt) - ms(b.startedAt) || (a.id < b.id ? -1 : 1))) if (!/^watchdog-refire-/.test(r.id)) pipelines[r.pipeline] = { id: r.id, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt || null, release: r.release || null };
  const refires = []; const reported = [];
  const consider = (id, target, task, reason, deadline, text) => {
    const entry = { id, target, reason };
    const rec = done.get(id);
    // A record stamped at this run's own time is this run's re-fire (health is written after it), not a second miss.
    if (rec) { if (ms(rec.startedAt || rec.at) !== ms(now)) reported.push({ ...entry, why: 'already re-fired once' }); return true; }
    if (!task || !task.trigger) { reported.push({ ...entry, why: 'no task to fire' }); return false; }
    if (deadline && ms(now) > ms(deadline)) { reported.push({ ...entry, why: 'past its re-fire window' }); return false; }
    refires.push({ ...entry, trigger: task.trigger, ...(text ? { text } : {}) }); return true;
  };
  // A scheduled pipeline's window is a Central clock time where the spec names one (a missed morning until 6:00am);
  // a fire-only task's (staging) is a span from the slot or start.
  const deadlineFor = (pipeline, from, task) => { const until = task && task.schedule ? w.refireUntil[pipeline] : null; if (until) { const [h, m] = until.split(':').map(Number); return chicagoInstant(EV.chicagoDate(from), h, m); } return new Date(ms(from) + w.refireWithinMinutes * 6e4).toISOString(); };

  const missing = [];
  for (const [name, t] of Object.entries(tasks).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!t.pipeline || !t.schedule || t.lane !== 'cloud') continue;
    const slot = lastSlot(t.schedule, now); if (!slot || minutes(slot) < w.graceMinutes) continue;
    if (runs.some(r => r.pipeline === t.pipeline && ms(r.startedAt) >= ms(slot) - 5 * 6e4)) continue;
    const id = `watchdog-refire-${t.pipeline}-${EV.compactTime(slot)}`;
    missing.push({ pipeline: t.pipeline, slot, refired: consider(id, `${name} slot ${slot}`, t, 'missed its slot', deadlineFor(t.pipeline, slot, t)) });
  }
  const stalledRuns = [];
  for (const r of runs.filter(r => r.status === 'running' && r.pipeline !== 'watchdog' && minutes(r.startedAt) > w.runTimeoutMinutes).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const t = Object.values(tasks).find(x => x.pipeline === r.pipeline && x.lane === 'cloud');
    stalledRuns.push({ id: r.id, pipeline: r.pipeline, startedAt: r.startedAt, minutes: minutes(r.startedAt), refired: consider(`watchdog-refire-${r.id}`, `run ${r.id}`, t, 'never ended', deadlineFor(r.pipeline, r.startedAt, t)) });
  }
  const results = new Map((db.jobresults || []).map(r => [r.id, r]));
  const worker = Object.values(tasks).find(x => x.pipeline === 'worker');
  const stalledJobs = [];
  for (const j of (db.jobs || []).filter(j => j.fired && j.fired.ok).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const r = results.get(j.id); if (r && r.status !== 'running') continue;
    if (minutes(j.fired.at) <= w.jobStallMinutes) continue;
    stalledJobs.push({ id: j.id, firedAt: j.fired.at, minutes: minutes(j.fired.at), refired: consider(`watchdog-refire-job-${j.id}`, `job ${j.id}`, worker, 'queued too long', null, `Job ${j.id}`) });
  }
  return { pipelines, missing, stalledRuns, stalledJobs, refires, reported };
}

/** health/current's own fields (the producer adds the envelope). */
export function healthBody(db, { now, record }, spec) {
  const v = watch(db, { now, record, spec });
  const state = (db.state || []).find(s => s.id === 'current') || null;
  const drill = (db.runs || []).filter(r => r.pipeline === 'restore-drill').sort((a, b) => ms(b.startedAt) - ms(a.startedAt))[0] || null;
  return {
    record, pipelines: v.pipelines, missing: v.missing, stalledRuns: v.stalledRuns, stalledJobs: v.stalledJobs, reported: v.reported,
    verifyDeploy: null,
    derivedHash: state ? { evening: state.derivedHash || null, at: state.at } : null,
    capacity: state && state.snapshot && state.snapshot.health ? state.snapshot.health.capacity || null : null,
    restoreDrill: drill ? { id: drill.id, status: drill.status, at: drill.startedAt, days: Math.floor((ms(now) - ms(drill.startedAt)) / 864e5) } : null,
  };
}
