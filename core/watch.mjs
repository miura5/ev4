// The watchdog's judgment, done by code (Operational architecture, "Observability"): which scheduled slots were missed,
// which runs never ended, which jobs stalled in the queue, and which of them to re-fire. Each is re-fired once: the
// re-fire writes runs/watchdog-refire-<target> (a Log), so a second miss finds it and is reported, not retried. A
// missed morning is re-fired until 6:00am Central and never after; the windows live in spec.constants.watchdog. A
// mac-lane slot (evening-mac, the restore drill) is reported and never re-fired (D-087): only the Mac can run it. Pure.
import EV from './evcore.mjs';

const ms = x => EV.toMs(x);
const W = spec => ({
  jobStallMinutes: 15,
  runTimeoutMinutes: 60,
  graceMinutes: 30,
  refireWithinMinutes: 180,
  refireUntil: {},
  ...((spec.constants && spec.constants.watchdog) || {}),
});

/** A cron field (numbers, *, a,b, a-b, * /n) as a set test. */
function field(spec, lo, hi) {
  if (spec === '*') return () => true;
  const ok = new Set();
  for (const part of spec.split(',')) {
    const [range, step] = part.split('/');
    const n = Number(step || 1);
    const [a, b] =
      range === '*' ? [lo, hi] : range.includes('-') ? range.split('-').map(Number) : [Number(range), Number(range)];
    for (let i = a; i <= b; i += n) ok.add(i);
  }
  return v => ok.has(v);
}
/** UTC instant of a Central wall-clock time (handles daylight time by trying both offsets). */
function chicagoInstant(date, hh, mm) {
  for (const off of [5, 6]) {
    const t = Date.parse(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`) + off * 36e5;
    const iso = new Date(t).toISOString();
    if (
      EV.chicagoDate(iso) === date &&
      EV.chicagoClock(iso) === `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    )
      return iso;
  }
  return null;
}
/** The latest slot of a `CRON_TZ=America/Chicago m h dom mon dow` schedule at or before `now`, within 8 days. */
export function lastSlot(schedule, now) {
  const m = /^CRON_TZ=America\/Chicago (\S+) (\S+) (\S+) (\S+) (\S+)$/.exec(schedule || '');
  if (!m) return null;
  const [mi, ho, dom, mon, dow] = [
    field(m[1], 0, 59),
    field(m[2], 0, 23),
    field(m[3], 1, 31),
    field(m[4], 1, 12),
    field(m[5], 0, 6),
  ];
  const today = EV.chicagoDate(now);
  for (let back = 0; back <= 8; back++) {
    const d = EV.addDays(today, -back);
    const [y, mo, da] = d.split('-').map(Number);
    if (!dom(da) || !mon(mo) || !dow(new Date(Date.UTC(y, mo - 1, da)).getUTCDay())) continue;
    for (let h = 23; h >= 0; h--) {
      if (!ho(h)) continue;
      for (let x = 59; x >= 0; x--) {
        if (!mi(x)) continue;
        const t = chicagoInstant(d, h, x);
        if (t && ms(t) <= ms(now)) return t;
      }
    }
  }
  return null;
}

/**
 * B-61 (D-112): the scheduler's side, from the list_triggers pages a run saved: for each task of spec.tasks.<record>,
 * its trigger's last firing {task, pipeline, trigger, firedAt, status}. Tasks the scheduler does not list are left out.
 */
export function schedulerView(pages, { record, spec }) {
  const tasks = (spec.tasks && spec.tasks[record]) || {};
  const all = [];
  for (const p of pages || []) all.push(...((p && p.data) || []));
  const out = [];
  for (const [name, t] of Object.entries(tasks).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!t.trigger || !t.pipeline) continue;
    const tr = all.find(x => x.id === t.trigger);
    if (!tr) continue;
    const lr = tr.last_run || null;
    out.push({
      task: name,
      pipeline: t.pipeline,
      trigger: t.trigger,
      firedAt: (lr && lr.fired_at) || tr.last_fired_at || null,
      status: lr ? String(lr.status || '').replace(/^ROUTINE_RUN_STATUS_/, '') : null,
    });
  }
  return out;
}

/**
 * db: runs, jobs, jobresults, state (as pulled). Returns {pipelines, missing, stalledRuns, stalledJobs, refires,
 * reported}: refires are {id (the runs record), target, trigger, text?, reason}; reported are second misses and
 * misses past their window. With `scheduler` (schedulerView, B-61) each missing slot has a kind: refused-at-start (the
 * scheduler fired it and no run document came within 5 minutes) or not-fired (no firing for the slot); without it,
 * no-run. A firing outside any slot (a fire-only task) that left no run is refused-at-start too.
 */
export function watch(db, { now, record, spec, scheduler = null }) {
  const w = W(spec);
  const tasks = (spec.tasks && spec.tasks[record]) || {};
  const runs = (db.runs || []).filter(r => r.pipeline);
  const done = new Map(runs.map(r => [r.id, r]));
  const minutes = since => Math.round((ms(now) - ms(since)) / 6e4);
  const pipelines = {};
  for (const r of [...runs].sort((a, b) => ms(a.startedAt) - ms(b.startedAt) || (a.id < b.id ? -1 : 1)))
    if (!/^watchdog-refire-/.test(r.id))
      pipelines[r.pipeline] = {
        id: r.id,
        status: r.status,
        startedAt: r.startedAt,
        endedAt: r.endedAt || null,
        release: r.release || null,
      };
  const refires = [];
  const reported = [];
  const consider = (id, target, task, reason, deadline, text) => {
    const entry = { id, target, reason };
    const rec = done.get(id);
    // A record stamped at this run's own time is this run's re-fire (health is written after it), not a second miss.
    if (rec) {
      if (ms(rec.startedAt || rec.at) !== ms(now)) reported.push({ ...entry, why: 'already re-fired once' });
      return true;
    }
    if (!task || !task.trigger) {
      reported.push({ ...entry, why: 'no task to fire' });
      return false;
    }
    if (deadline && ms(now) > ms(deadline)) {
      reported.push({ ...entry, why: 'past its re-fire window' });
      return false;
    }
    refires.push({ ...entry, trigger: task.trigger, ...(text ? { text } : {}) });
    return true;
  };
  // A scheduled pipeline's window is a Central clock time where the spec names one (a missed morning until 6:00am);
  // a fire-only task's (staging) is a span from the slot or start, except a staging slot watched on the live
  // schedule (watchSchedule), which keeps the live window so staging shows what live would do.
  const deadlineFor = (pipeline, from, task, slotMiss = false) => {
    const until = task && (task.schedule || (slotMiss && task.watchSchedule)) ? w.refireUntil[pipeline] : null;
    if (until) {
      const [h, m] = until.split(':').map(Number);
      return chicagoInstant(EV.chicagoDate(from), h, m);
    }
    return new Date(ms(from) + w.refireWithinMinutes * 6e4).toISOString();
  };

  const missing = [];
  // A missed slot's kind, from the scheduler's last firing of that task (B-61): fired at or after the slot is
  // refused-at-start (it fired and no run came), never fired since the slot is not-fired; unknown without the reads.
  const kindAt = (name, slot) => {
    if (!scheduler) return 'no-run';
    const f = scheduler.find(x => x.task === name);
    return f && f.firedAt && ms(f.firedAt) >= ms(slot) - 5 * 6e4 ? 'refused-at-start' : 'not-fired';
  };
  for (const [name, t] of Object.entries(tasks).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const sched = t.schedule || t.watchSchedule;
    if (!t.pipeline || !sched || (t.lane !== 'cloud' && t.lane !== 'mac')) continue;
    const slot = lastSlot(sched, now);
    if (!slot || minutes(slot) < w.graceMinutes) continue;
    // A slot before this record's v4 tasks existed (spec.constants.watchdog.since) was never this task's to run.
    if (w.since && w.since[record] && ms(slot) < ms(w.since[record])) continue;
    if (runs.some(r => r.pipeline === t.pipeline && ms(r.startedAt) >= ms(slot) - 5 * 6e4)) continue;
    const kind = kindAt(name, slot);
    if (t.lane === 'mac') {
      missing.push({ pipeline: t.pipeline, slot, kind, refired: false, lane: 'mac' });
      continue;
    } // D-087: reported, never re-fired
    const id = `watchdog-refire-${t.pipeline}-${EV.compactTime(slot)}`;
    missing.push({
      pipeline: t.pipeline,
      slot,
      kind,
      refired: consider(id, `${name} slot ${slot}`, t, 'missed its slot', deadlineFor(t.pipeline, slot, t, true)),
    });
  }
  // B-61: a firing the scheduler recorded with no run document within 5 minutes of it, outside the slots above (a
  // fire-only task, or a firing after its slot): the run was refused at its start and left nothing.
  for (const f of scheduler || []) {
    if (!f.firedAt || minutes(f.firedAt) < 5 || minutes(f.firedAt) > 9 * 24 * 60) continue;
    if (w.since && w.since[record] && ms(f.firedAt) < ms(w.since[record])) continue;
    if (missing.some(m => m.pipeline === f.pipeline && Math.abs(ms(m.slot) - ms(f.firedAt)) <= 60 * 6e4)) continue;
    if (runs.some(r => r.pipeline === f.pipeline && Math.abs(ms(r.startedAt || r.at) - ms(f.firedAt)) <= 5 * 6e4))
      continue;
    missing.push({
      pipeline: f.pipeline,
      slot: f.firedAt,
      kind: 'refused-at-start',
      refired: false,
      ...(tasks[f.task] && tasks[f.task].lane === 'mac' ? { lane: 'mac' } : {}),
    });
  }
  const stalledRuns = [];
  for (const r of runs
    .filter(r => r.status === 'running' && r.pipeline !== 'watchdog' && minutes(r.startedAt) > w.runTimeoutMinutes)
    .sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const t = Object.values(tasks).find(x => x.pipeline === r.pipeline && x.lane === 'cloud');
    stalledRuns.push({
      id: r.id,
      pipeline: r.pipeline,
      startedAt: r.startedAt,
      minutes: minutes(r.startedAt),
      refired: consider(
        `watchdog-refire-${r.id}`,
        `run ${r.id}`,
        t,
        'never ended',
        deadlineFor(r.pipeline, r.startedAt, t)
      ),
    });
  }
  const results = new Map((db.jobresults || []).map(r => [r.id, r]));
  const worker = Object.values(tasks).find(x => x.pipeline === 'worker');
  const stalledJobs = [];
  for (const j of (db.jobs || []).filter(j => j.fired && j.fired.ok).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const r = results.get(j.id);
    if (r && r.status !== 'running') continue;
    if (minutes(j.fired.at) <= w.jobStallMinutes) continue;
    stalledJobs.push({
      id: j.id,
      firedAt: j.fired.at,
      minutes: minutes(j.fired.at),
      refired: consider(`watchdog-refire-job-${j.id}`, `job ${j.id}`, worker, 'queued too long', null, `Job ${j.id}`),
    });
  }
  return { pipelines, missing, stalledRuns, stalledJobs, refires, reported };
}

/** health/current's own fields (the producer adds the envelope). */
export function healthBody(db, { now, record, scheduler = null }, spec) {
  const v = watch(db, { now, record, spec, scheduler });
  // B-66: the watchdog's own run is still running while it writes this page; it ends right after, so its entry here
  // says so instead of showing the watchdog as running forever.
  const own = v.pipelines.watchdog;
  if (own && own.status === 'running' && ms(now) - ms(own.startedAt) < 15 * 6e4)
    v.pipelines.watchdog = { ...own, status: 'ok', endedAt: now, self: true };
  const state = (db.state || []).find(s => s.id === 'current') || null;
  const drill =
    (db.runs || []).filter(r => r.pipeline === 'restore-drill').sort((a, b) => ms(b.startedAt) - ms(a.startedAt))[0] ||
    null;
  return {
    record,
    pipelines: v.pipelines,
    missing: v.missing,
    stalledRuns: v.stalledRuns,
    stalledJobs: v.stalledJobs,
    reported: v.reported,
    verifyDeploy: null,
    derivedHash: state ? { evening: state.derivedHash || null, at: state.at } : null,
    capacity: state && state.snapshot && state.snapshot.health ? state.snapshot.health.capacity || null : null,
    restoreDrill: drill
      ? {
          id: drill.id,
          status: drill.status,
          at: drill.startedAt,
          days: Math.floor((ms(now) - ms(drill.startedAt)) / 864e5),
        }
      : null,
    // B-61: the scheduler's last firing per task as this run read it: an input, so a rebuild takes it as stored.
    ...(scheduler ? { scheduler } : {}),
  };
}

/**
 * D-084, the schedule test: for every scheduled cloud task, over the next `days`, the watchdog slot that would see a
 * missed slot (the first one at least graceMinutes after it) falls inside that pipeline's re-fire window. Returns the
 * slots no watchdog slot covers, as {task, slot, deadline}; empty means every miss can be re-fired.
 */
export function uncoveredSlots(
  spec,
  { watchdog = (spec.tasks.live.watchdog || {}).schedule, from = '2026-10-19T00:00:00Z', days = 14 } = {}
) {
  const w = W(spec);
  const out = [];
  for (const [name, t] of Object.entries(spec.tasks.live || {})) {
    if (!t.schedule || t.lane !== 'cloud' || t.pipeline === 'watchdog') continue;
    const seen = new Set();
    for (let h = 0; h <= days * 24; h++) {
      const slot = lastSlot(t.schedule, new Date(ms(from) + h * 36e5).toISOString());
      if (!slot || seen.has(slot) || ms(slot) < ms(from)) continue;
      seen.add(slot);
      const until = w.refireUntil[t.pipeline];
      const deadline = until
        ? (() => {
            const [hh, mm] = until.split(':').map(Number);
            return chicagoInstant(EV.chicagoDate(slot), hh, mm);
          })()
        : new Date(ms(slot) + w.refireWithinMinutes * 6e4).toISOString();
      const seenBy = lastSlot(watchdog, deadline);
      if (!seenBy || ms(seenBy) < ms(slot) + w.graceMinutes * 6e4) out.push({ task: name, slot, deadline });
    }
  }
  return out;
}
