// B-186 (D-203): actions as data. Every new thing E.V. does from the page or a builder session is a row of
// spec.actions (args as a JSON schema, the writes it may make, its effects, who may call it, what it costs), and this
// one function composes and checks it: act(name, args, ctx) returns {ok, writes, effects} or {ok: false, refused}.
// The page runs the writes through run(writes) and makes the effects; the builder's commands print them as calls.
// No imports: the same file runs in node and in the page (the build writes it into core.js after core/validate.mjs,
// as window.EVActions). makeActions takes the validator's validateAgainst.
//
// ctx.caller is set by code, never by the caller: an actor (actor(spec, 'tap'), 'tool', 'builder', 'worker') is
// made once by the code path that calls it, and it overwrites any caller the call itself claims.

export const CALLERS = ['tap', 'tool', 'builder', 'worker'];
export const COSTS = ['nothing', 'staging', 'ok'];
// What a row may never do (D-200, D-203): write the table itself (it lives in system/spec) or change a scheduled task.
const FORBIDDEN_EFFECT = /\b(create|update|delete)_trigger\b|\btrigger_(create|update|delete)\b/i;
const ENVELOPE = ['schema', 'writer', 'at', 'source'];
const OPS = ['set', 'update'];

/** Why a row may not exist, or null: the shape the lint and act() both hold it to. his: core/his.mjs hisFields(spec), node side only. */
export function rowProblem(name, row, his = {}) {
  if (!row || typeof row !== 'object') return `${name}: not a row`;
  if (!Array.isArray(row.callers) || !row.callers.length || row.callers.some(c => !CALLERS.includes(c)))
    return `${name}: callers must be among ${CALLERS.join(', ')}`;
  if (!COSTS.includes(row.cost)) return `${name}: cost must be one of ${COSTS.join(', ')}`;
  if (!row.args || typeof row.args !== 'object') return `${name}: args must be a JSON schema`;
  for (const w of row.writes || []) {
    if (!w || !w.collection || !w.key || !Array.isArray(w.fields))
      return `${name}: a write needs collection, key, fields`;
    if (w.collection === 'system' && new RegExp(w.key).test('spec'))
      return `${name}: no row may write system/spec, where the actions table lives (D-203)`;
    if (w.collection === 'actions' || w.fields.includes('actions'))
      return `${name}: no row may write the actions table (D-203)`;
    if ((w.ops || OPS).some(o => !OPS.includes(o)))
      return `${name}: a write is a set or an update, never a delete (B-11)`;
    // B-229 (D-233): his words are his: only his own tap writes a field spec marks as his
    const mine = (his[w.collection] || []).filter(f => w.fields.includes(f));
    if (mine.length && row.callers.some(c => c !== 'tap'))
      return `${name}: ${w.collection}.${mine.join(', ')} is his to write: only a tap may (D-233), not ${row.callers
        .filter(c => c !== 'tap')
        .join(' or ')}`;
  }
  for (const e of row.effects || []) {
    const s = JSON.stringify(e);
    if (FORBIDDEN_EFFECT.test(s)) return `${name}: no row creates, changes or deletes a scheduled task (D-200)`;
    if (!e || !['fire_trigger', 'publish'].includes(e.kind)) return `${name}: an effect is fire_trigger or publish`;
  }
  return null;
}

export function makeActions(validateAgainst) {
  'use strict';
  /** Whether the row's cost is met: staging is R-02's check (a green staging verify at the commit), ok is R-04's in
   * either form (his tap on a row that is the OK, his words in a build chat, or a ship job he wrote, as fetched). */
  function costMet(row, args, ctx) {
    if (row.cost === 'nothing') return null;
    if (row.cost === 'staging') {
      const v = ctx.staging;
      return v && v.green && (!args.commit || String(v.commit || '').startsWith(String(args.commit)))
        ? null
        : 'it needs staging green at the commit (R-02)';
    }
    if (ctx.caller === 'tap') return null; // the tap is his OK, bound to the one commit the row names (D-198)
    const ok = ctx.ok || null;
    if (ok && ok.mattOk === true) return null;
    if (
      ok &&
      ok.job &&
      ok.job.kind === 'ship' &&
      ok.job.writer === 'page' &&
      (!args.commit || ok.job.commit === args.commit)
    )
      return null;
    return "it needs Matt's OK (R-04): his words in a build chat or a ship job he wrote for this commit";
  }
  /** A write is inside the row: its collection, its key pattern, its op and only the row's fields (plus the envelope). */
  function writeProblem(row, w) {
    const r = (row.writes || []).find(
      x => x.collection === w.collection && new RegExp(x.key).test(String(w.id)) && (x.ops || OPS).includes(w.op)
    );
    if (!r) return `${w.op} ${w.collection}/${w.id} is outside the row`;
    const extra = Object.keys(w.data || {}).filter(k => !r.fields.includes(k) && !ENVELOPE.includes(k));
    if (extra.length) return `${w.collection}/${w.id} sets ${extra.join(', ')}, outside the row's fields`;
    return null;
  }
  // ---------------------------------------------------------------- the v4.4 composers (D-194 to D-198)
  const compact = iso => String(iso).replace(/\D/g, '').slice(0, 14);
  const slug = (s, n) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, n)
      .replace(/-+$/, '') || 'job';
  /** A job the page writes and hands to the builder: jobs/<id> (schema 2) and one fire_trigger with "Job <id>" and,
   * on the next line, the words as typed. */
  const jobAsk = kind => (args, ctx) => {
    const at = ctx.now || new Date().toISOString();
    const t = compact(at);
    const title = String(args.title || args.brief)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90);
    const id = `job-${t.slice(0, 8)}-${t.slice(8)}-${slug(title, 24)}`;
    const data = {
      schema: 2,
      writer: 'page',
      at,
      source: 'E.V. Home',
      kind,
      title,
      brief: String(args.brief).slice(0, 1500),
    };
    if (args.commit) data.commit = args.commit;
    if (args.tasks) data.tasks = args.tasks;
    return {
      writes: [{ op: 'set', collection: 'jobs', id, data }],
      effects: [
        { kind: 'fire_trigger', task: 'build.ev4-builder', text: `Job ${id}` + (args.text ? '\n' + args.text : '') },
      ],
    };
  };
  /** The builder's trace (D-195): its job's result, one talk line as E.V. with the job card, and system/yourturn. */
  function trace(args, ctx) {
    const at = ctx.now || new Date().toISOString();
    const key = `m-${compact(at).slice(0, 8)}-${compact(at).slice(8)}000-job`;
    // B-183 (D-197): a design job's line is the kickoff itself, with a Copy chip under it.
    const message = args.kickoff
      ? {
          role: 'ev',
          text: args.kickoff,
          cards: [{ type: 'job', id: args.job }, { type: 'copy' }],
          at,
          jobId: args.job,
        }
      : { role: 'ev', text: args.text, cards: [{ type: 'job', id: args.job }], at, jobId: args.job };
    const result = {
      text: args.text,
      ...(args.task ? { task: args.task } : {}),
      ...(args.commit ? { commit: args.commit } : {}),
    };
    return {
      writes: [
        {
          op: 'set',
          collection: 'jobresults',
          id: args.job,
          data: {
            schema: args.schemas.jobresults,
            writer: 'builder',
            at,
            source: `trace ${args.job}`,
            release: args.release,
            status: args.status,
            startedAt: args.startedAt || at,
            finishedAt: at,
            result,
            message: key,
            error: args.status === 'failed' ? args.text : null,
          },
        },
        args.talkExists
          ? { op: 'update', collection: 'talk', id: args.date, data: { messages: { [key]: message } } }
          : {
              op: 'set',
              collection: 'talk',
              id: args.date,
              data: {
                schema: args.schemas.talk,
                writer: 'builder',
                at,
                source: `trace ${args.job}`,
                date: args.date,
                messages: { [key]: message },
              },
            },
        {
          op: 'set',
          collection: 'system',
          id: 'yourturn',
          data: {
            schema: args.schemas.system,
            writer: 'deploy',
            at,
            source: `trace ${args.job}`,
            commit: args.yourturn.commit,
            groups: args.yourturn.groups,
          },
        },
      ],
      effects: [],
    };
  }
  const COMPOSERS = {
    'build-ask': jobAsk('build'),
    reply: jobAsk('reply'),
    'design-ask': jobAsk('design'),
    'plan-ask': jobAsk('plan'),
    'ship-it': jobAsk('ship'),
    // B-180: the fire_trigger's answer on the job the page just fired, so its card says queued or not started.
    // B-197: identifier verdicts the page keeps, one document per value's fingerprint; his own answer beside it (-matt).
    'id-check': (args, ctx) => {
      const at = ctx.now || new Date().toISOString();
      return {
        writes: args.checks.map(c => ({
          op: 'set',
          collection: 'idchecks',
          id: c.by === 'matt' ? c.key + '-matt' : c.key,
          data: {
            schema: 1,
            writer: 'page',
            at,
            source: 'E.V. Home',
            ...(ctx.release ? { release: ctx.release } : {}),
            key: c.key,
            verdict: c.verdict,
            reason: c.reason,
            kind: c.kind,
            ref: c.ref,
            by: c.by,
          },
        })),
        effects: [],
      };
    },
    'job-fired': args => ({
      writes: [{ op: 'update', collection: 'jobs', id: args.job, data: { fired: args.fired } }],
      effects: [],
    }),
    trace,
    // The live deploy's gate (D-198): its caller and cost; the deploy itself is core/deploy.mjs's printout, never a row's
    // writes (no row writes system/spec).
    'ship-live': () => ({ writes: [], effects: [{ kind: 'publish' }] }),
  };
  /** The one place an action is composed and checked. */
  function act(spec, name, args, ctx = {}, composers = COMPOSERS) {
    const no = refused => ({ ok: false, refused: `${name}: ${refused}`, writes: [], effects: [] });
    const row = ((spec && spec.actions) || {})[name];
    if (!row || name.startsWith('_')) return no('no such action in spec.actions');
    const bad = rowProblem(name, row); // his fields (D-233) are the build's check: spec.collections stays off the page
    if (bad) return no(bad.replace(`${name}: `, ''));
    if (!CALLERS.includes(ctx.caller)) return no('no caller set by code');
    if (!row.callers.includes(ctx.caller))
      return no(`a ${ctx.caller} may not call it (callers: ${row.callers.join(', ')})`);
    const shape = validateAgainst(row.args, args);
    if (!shape.ok) return no(`its arguments do not fit: ${shape.errors.map(e => e.path + ' ' + e.message).join('; ')}`);
    const unmet = costMet(row, args || {}, ctx);
    if (unmet) return no(unmet);
    const compose = composers[name];
    if (typeof compose !== 'function') return no('no composer for it yet');
    const out = compose(args, ctx) || {};
    const writes = out.writes || [],
      effects = out.effects || [];
    for (const w of writes) {
      const p = writeProblem(row, w);
      if (p) return no(p);
    }
    for (const e of effects) {
      const allowed = (row.effects || []).some(x => x.kind === e.kind && (!x.task || x.task === e.task));
      if (!allowed || FORBIDDEN_EFFECT.test(JSON.stringify(e)))
        return no(`effect ${JSON.stringify(e)} is outside the row`);
    }
    return { ok: true, refused: null, writes, effects };
  }
  /** An actor for one code path: the caller is fixed here, so a call cannot claim another (D-203). */
  function actor(spec, caller, composers = COMPOSERS) {
    if (!CALLERS.includes(caller)) throw new Error(`no such caller: ${caller}`);
    return (name, args, ctx = {}) => act(spec, name, args, { ...ctx, caller }, composers);
  }
  return { act, actor, rowProblem, CALLERS, COSTS, COMPOSERS };
}
