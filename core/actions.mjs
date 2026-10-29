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

/** core: E.V. core (or any object with survivors and duplicateOf), for the weak-spot rows (B-233). */
export function makeActions(validateAgainst, evcore) {
  'use strict';
  const core = evcore || {};
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
  // ---------------------------------------------------------------- weak spots and triage (B-233, D-235, D-242)
  /** An event key: <writer>-YYYYMMDD-HHMMSSmmm, or ctx.key(at) when the code path keeps its keys unique (the page's). */
  const evKey = (at, ctx) => {
    if (ctx && typeof ctx.key === 'function') return ctx.key(at);
    const d = String(at).replace(/\D/g, '');
    return `page-${d.slice(0, 8)}-${d.slice(8, 17)}`;
  };
  // B-233 (D-240): the duplicate-of link and the survivor walk are E.V. core's (duplicateOf, survivors), injected by
  // makeActions' second argument, so the chain walk lives in one place. ctx.weakspots is the code's list of spots as
  // read; a weak-spot row with no core or no list refuses rather than guess.
  const spotsOf = ctx => (ctx && Array.isArray(ctx.weakspots) ? ctx.weakspots : null);
  const spotIn = (ctx, id) => (spotsOf(ctx) || []).find(w => w && w.id === id) || null;
  const noCore = () =>
    typeof core.survivors !== 'function' || typeof core.duplicateOf !== 'function'
      ? 'E.V. core (survivors, duplicateOf) was not given to makeActions'
      : null;
  /** A new weak spot, schema 2. weakspot-log is his (never proposed); weakspot-propose is her candidate (D-235). A
   * set over an id already in the record would erase its events and links: refused, the caller picks another id. */
  const SPOT = ['topic', 'words', 'objective', 'exam', 'course', 'kind', 'origin', 'preRead', 'readingDue', 'initial'];
  const newSpot = proposed => (args, ctx) => {
    if (!spotsOf(ctx)) return { refused: 'no weak spots read to check the id against (ctx.weakspots)' };
    if (spotIn(ctx, args.id)) return { refused: `weakspots/${args.id} already exists: a set would erase its events` };
    const at = ctx.now || new Date().toISOString();
    const data = {
      schema: 2,
      writer: ctx.caller === 'worker' ? 'worker' : 'page',
      at,
      source: args.source || (proposed ? 'E.V.' : 'Logged by you'),
    };
    for (const f of SPOT) if (args[f] !== undefined) data[f] = args[f];
    const objective = args.objective || '';
    Object.assign(data, {
      objective,
      exam: args.exam !== undefined ? args.exam : objective.split('-')[0] || '',
      kind: args.kind || 'concept',
      addedBy: ctx.caller === 'worker' ? 'worker' : 'page',
      initial: args.initial,
      events: {},
    });
    if (proposed) data.proposed = true;
    return { writes: [{ op: 'set', collection: 'weakspots', id: args.id, data }], effects: [] };
  };
  /** One of his triage taps (or Mark solid) on one or several spots: an event on each, once each. A spot that is not
   * in the record, or is itself joined to another (a duplicate), is refused: his tap names the row he saw. */
  const spotEvent = (type, extra) => (args, ctx) => {
    const bad = noCore() || (!spotsOf(ctx) && 'no weak spots read (ctx.weakspots)');
    if (bad) return { refused: bad };
    const surv = core.survivors(spotsOf(ctx));
    const at = ctx.now || new Date().toISOString();
    const key = evKey(at, ctx);
    const done = new Set();
    const writes = [];
    for (const it of args.items || [{ id: args.id }]) {
      if (done.has(it.id)) continue;
      done.add(it.id);
      if (!spotIn(ctx, it.id)) return { refused: `weakspots/${it.id} is not in the record` };
      if (surv(it.id) !== it.id) return { refused: `weakspots/${it.id} is already joined to ${surv(it.id)}` };
      const e = { type, by: 'owner', at, ...extra(args, it) };
      writes.push({ op: 'update', collection: 'weakspots', id: it.id, data: { events: { [key]: e } } });
    }
    return { writes, effects: [] };
  };
  /** His Join (D-240, D-284): a duplicate-of link to the spot it repeats, resolved to that spot's survivor, built from
   * the spot as read (an update replaces the whole links array), so its other links stay; any spot joined to this one
   * is re-pointed to the same survivor in the same act, so no chain is made. Nothing is merged away. */
  function join(args, ctx) {
    const bad = noCore() || (!spotsOf(ctx) && 'no weak spots read (ctx.weakspots)');
    if (bad) return { refused: bad };
    const spot = spotIn(ctx, args.id);
    if (!spot) return { refused: `weakspots/${args.id} is not in the record` };
    if (!spotIn(ctx, args.to)) return { refused: `weakspots/${args.to} is not in the record` };
    const to = core.survivors(spotsOf(ctx))(args.to);
    if (to === args.id) return { refused: 'a spot cannot join itself or a spot joined to it' };
    if (core.duplicateOf(spot) === to) return { refused: `weakspots/${args.id} is already joined to ${to}` };
    const at = ctx.now || new Date().toISOString();
    const link = { to: 'weakspots/' + to, type: 'duplicate-of', createdAt: at, createdBy: 'owner' };
    const relinked = w => [...(w.links || []).filter(l => !(l && l.type === 'duplicate-of')), link];
    const writes = [{ op: 'update', collection: 'weakspots', id: args.id, data: { links: relinked(spot) } }];
    for (const w of spotsOf(ctx))
      if (w && w.id !== args.id && core.duplicateOf(w) === args.id)
        writes.push({ op: 'update', collection: 'weakspots', id: w.id, data: { links: relinked(w) } });
    return { writes, effects: [] };
  }
  const COMPOSERS = {
    'weakspot-log': newSpot(false),
    'weakspot-propose': newSpot(true),
    // B-499: an Accept with no objective files the spot under its course; the objective can be picked later
    'weakspot-accept': spotEvent('accept', (a, it) => (it.objective ? { objective: it.objective } : {})),
    'weakspot-join': join,
    'weakspot-snooze': spotEvent('snooze', a => ({ until: a.until })),
    'weakspot-decline': spotEvent('decline', a => (a.note ? { note: a.note } : {})),
    'weakspot-solid': spotEvent('solid', () => ({})),
    'build-ask': jobAsk('build'),
    reply: jobAsk('reply'),
    'design-ask': jobAsk('design'),
    'plan-ask': jobAsk('plan'),
    'ship-it': jobAsk('ship'),
    // B-180: the fire_trigger's answer on the job the page just fired, so its card says queued or not started.
    'job-fired': args => ({
      writes: [{ op: 'update', collection: 'jobs', id: args.job, data: { fired: args.fired } }],
      effects: [],
    }),
    trace,
    // B-405 (D-327): a closed pop-up chat is a mark on the day it was closed (talk/<day>.closed), never a deletion; the
    // day's document is made with no messages when it has none yet.
    'chat-close': args => ({
      writes: [
        args.exists
          ? { op: 'update', collection: 'talk', id: args.date, data: { closed: { [args.thread]: args.at } } }
          : {
              op: 'set',
              collection: 'talk',
              id: args.date,
              data: {
                schema: 4,
                writer: 'page',
                at: args.at,
                source: 'E.V. Home',
                date: args.date,
                messages: {},
                closed: { [args.thread]: args.at },
              },
            },
      ],
      effects: [],
    }),
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
    // B-233 (D-235): a row marked fromHis takes a tool call only for his own words: args.from names the talk line the
    // call answers, and the code's ctx.line(id) must find it written by him, never by her.
    if (row.fromHis && ctx.caller === 'tool') {
      const line = args && args.from && typeof ctx.line === 'function' ? ctx.line(args.from) : null;
      if (!line || line.role !== 'matt')
        return no(
          `a tool may call it only from his own line: ${args && args.from ? args.from + ' is not his' : 'no from'}`
        );
    }
    const compose = composers[name];
    if (typeof compose !== 'function') return no('no composer for it yet');
    const out = compose(args, ctx) || {};
    if (out.refused) return no(out.refused);
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
  /**
   * B-409: a closed chat's mark saved without ever replacing the day it lands on. The mark goes on the day as an update
   * first; only when the store says the day is not there (a missing update is refused, nothing written) is the day made,
   * after one more look, so a day written meanwhile (another tab, her reply) keeps its messages. The app's store also
   * lays a create over a day that appeared under the day's own fields (pwa/bridge.js mergeUnder).
   * send(exists): runs the chat-close tap with that exists (an update when true, the day's create when false);
   * exists(): reads the day from the store.
   */
  async function closeChat({ send, exists }) {
    try {
      return await send(true);
    } catch (e) {
      // the day is there (made since, or the update failed for its own reason): the mark goes on it, once more
      if (await exists()) return send(true);
    }
    return send(false);
  }
  return { act, actor, rowProblem, CALLERS, COSTS, COMPOSERS, closeChat };
}
