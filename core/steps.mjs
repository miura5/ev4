// The steps a pipeline is made of (Operational architecture, "The run protocol", move 4). A pipeline in the spec
// names its steps; each `code` step is one function here and each `agent` step names the judgment, the material it is
// shown, the shape of its answer and how the answer folds into the plan. Pure: (db, ctx, spec) in, writes out.
//   code step   (db, ctx, spec) -> {writes?: [{op, collection, id, data}], say?: [lines], push?: string}
//   material    (db, ctx, spec) -> any JSON the agent reads before answering
//   fold        (answer, db, ctx, spec) -> {writes?, say?, push?}
// ctx: {runId, pipeline, date (Central), now (ISO), source}
import EV from './evcore.mjs';
import { produce } from './derive.mjs';

const models = db => EV.buildWeakspots({ weakspots: db.weakspots || [], sets: db.sets || [], answers: db.answers || [], exams: db.exams || [] });

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

export const AGENT_MATERIAL = {
  /** What the day looks like, for a one-line note. */
  'day-summary'(db, ctx) {
    const day = (db.days || []).find(d => d.id === ctx.date);
    return { date: ctx.date, dayType: day ? day.dayType : null, items: day ? day.list.items.map(i => i.text) : [] };
  },
};

export const AGENT_FOLDS = {
  /** {push}: the run's push line, as the agent wrote it. */
  'push-line'(answer) { return { push: answer.push }; },
};
