// The run protocol (Operational architecture, "The run protocol"): every scheduled run is the same six moves, and the
// agent makes only the calls these functions print.
//   1 gate     the task prompt's own one-liner (not here)
//   2 start    one ArtifactData set: runs/<id> with startedAt, release, pipeline, the planned steps
//   3 pull     the pipeline's read set as ArtifactData list/query calls into <dir>/pull; then `pulled` takes each
//              document's version from the replies in this session's transcript
//   4 compute  the code steps in order on the pulled record (each step sees the writes before it); an agent step
//              stops the command with its question, material and answer shape until <dir>/answers/<step>.json exists;
//              every write validated, scanned for identifiers, pinned to its version, chunked, the plan checksummed
//   5 apply    the batch calls in order; a batch refused on its version pin is re-pulled and re-planned, never patched
//   6 end      one ArtifactData update: endedAt, status, step results, the plan's hash, the push line, the audit
// Everything a run decides is in <dir>: run.json (the calls printed so far), versions.json, plan.json, writes/.
import fs from 'node:fs';
import path from 'node:path';
import EV from './evcore.mjs';
import { readExport } from './schemas.mjs';
import { chunkWrites } from './batches.mjs';
import { describeErrors, validateAgainst } from './validate.mjs';
import { writersOf, classOf, appendEntries, appendDepth, keyWriter } from './derive.mjs';
import { toolResults, resultBody } from './transcript.mjs';
import { CODE_STEPS, AGENT_MATERIAL, AGENT_FOLDS } from './steps.mjs';

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 1));
};
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const merge = (a, b) => {
  const o = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) o[k] = isObj(v) && isObj(o[k]) ? merge(o[k], v) : v;
  return o;
};

/** The pipeline's step list from the spec (B-09 writes them); an error names what is missing. */
export function pipelineDef(spec, pipeline) {
  const p = spec.pipelines && !Array.isArray(spec.pipelines) ? spec.pipelines[pipeline] : null;
  if (!p || !Array.isArray(p.steps))
    throw new Error(
      `no step list for ${pipeline} in spec.pipelines${p && p.pendingIn ? ` (its steps arrive with ${p.pendingIn})` : ''}`
    );
  for (const s of p.steps || []) {
    if (s.kind === 'code' && !CODE_STEPS[s.fn || s.id]) throw new Error(`${pipeline}: no code step ${s.fn || s.id}`);
    if (s.kind === 'agent' && (!s.output || !AGENT_FOLDS[s.fold]))
      throw new Error(`${pipeline}: agent step ${s.id} needs an output shape and a fold`);
  }
  return p;
}
export const runIdFor = (pipeline, at) => `${pipeline}-${EV.compactTime(at)}`;
const recordUrl = (spec, record) => {
  const r = spec.registry.records[record];
  if (!r) throw new Error('no record ' + record);
  return `https://claude.ai/artifact/${r.artifact}`;
};

function loadRun(dir) {
  const f = path.join(dir, 'run.json');
  if (!fs.existsSync(f)) throw new Error(`no run in ${dir}: run start first`);
  return readJson(f);
}
function saveRun(dir, run) {
  writeJson(path.join(dir, 'run.json'), run);
}
/** Records calls as printed, so audit can hold the transcript against them. */
function printed(dir, run, move, calls) {
  run.calls.push(...calls.map(c => ({ move, ...c })));
  saveRun(dir, run);
  return calls;
}

/**
 * B-172: the one line a failed run ends on, so Matt's push says what happened. It names the pipeline and the reason
 * in plain words and never leads with 'E.V.': on Oct 21 a push cut at the first sentence end said only 'E.V.'.
 * failed is spec.pipelines.<p>.failed; reason is a move ('pull', 'apply'...), 'gate', or words of its own.
 */
const FAIL_REASONS = {
  gate: 'its code check failed',
  start: 'the record refused its start',
  pull: "it couldn't read the record",
  pulled: "it couldn't read the record",
  compute: "it couldn't work out its changes",
  apply: "it couldn't save its changes",
};
// A step of its own, said plainly: the backup or mirror on the Mac, Canvas; else its leading words, never cut mid-word.
const FAIL_STEPS = [
  [/\b(backup|mirror)\b/i, m => `it couldn't save the ${m[1].toLowerCase()}`],
  [/\bcanvas\b/i, () => "it couldn't read Canvas"],
];
function stepWords(reason) {
  const r = String(reason).trim();
  for (const [re, say] of FAIL_STEPS) {
    const m = re.exec(r);
    if (m) return say(m);
  }
  let out = '';
  for (const w of r.replace(/[_]+/g, ' ').split(/\s+/)) {
    if ((out + ' ' + w).trim().length > 16) break;
    out = (out + ' ' + w).trim();
  }
  return `it stopped at ${out || r.slice(0, 16)}`;
}
export function failLine({ failed, pipeline, reason }) {
  const why = FAIL_REASONS[reason] || (reason ? stepWords(reason) : 'it stopped');
  return `${failed || `The ${pipeline} run didn't finish`} (${pipeline}): ${why}. A build chat will look.`;
}

// ------------------------------------------------------------------------------------------------ 2 start
export function start({
  spec,
  pipeline,
  record = 'staging',
  at,
  dir,
  release,
  commit = null,
  input = {},
  outputs = '/mnt/user-data/outputs/ev',
}) {
  const def = pipelineDef(spec, pipeline);
  const id = runIdFor(pipeline, at);
  const url = recordUrl(spec, record);
  // The run directory is scratch: a previous run's is replaced, anything else is refused.
  if (fs.existsSync(dir) && fs.readdirSync(dir).length && !fs.existsSync(path.join(dir, 'run.json')))
    throw new Error(`${dir} is not empty and holds no run; give --dir an empty or run directory`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const k of Object.keys(input)) if (!(def.input || {})[k]) throw new Error(`${pipeline} takes no --${k}`);
  const data = {
    ...EV.envelope(pipeline, `${pipeline} run`, at),
    release,
    pipeline,
    startedAt: EV.envelope(pipeline, '', at).at,
    endedAt: null,
    status: 'running',
    ...(commit ? { commit } : {}),
    planned: def.steps.map(s => s.id),
    ...(Object.keys(input).length
      ? {
          detail: Object.entries(input)
            .map(([k, v]) => `${k} ${v}`)
            .join(', '),
        }
      : {}),
  };
  const file = path.join(dir, 'out', 'runs', id + '.json');
  writeJson(file, data);
  const run = {
    id,
    pipeline,
    record,
    url,
    release,
    ...(commit ? { commit } : {}),
    startedAt: data.startedAt,
    input,
    ...(def.failed ? { failed: def.failed } : {}),
    allowed: def.agentCalls || [],
    dir,
    outputs,
    calls: [],
  };
  saveRun(dir, run);
  return printed(dir, run, 'start', [
    { tool: 'ArtifactData', args: { action: 'set', url, collection: 'runs', doc_id: id, file_path: file } },
  ]);
}

// ------------------------------------------------------------------------------------------------ 3 pull
export function pull({ spec, dir, at }) {
  const run = loadRun(dir);
  const def = pipelineDef(spec, run.pipeline);
  const out = path.join(dir, 'pull');
  const calls = (def.reads || []).map(r => {
    // D-113 (B-62): the journal is a named read: a pipeline pulls it only for a step it names (r.for), never by default.
    if (r.collection === 'journal' && !(r.for && (def.steps || []).some(s => s.id === r.for)))
      throw new Error(
        "the journal is read only for a step that names it (D-113): give the read a for naming one of this pipeline's steps"
      );
    const query = { limit: 1000 };
    if (r.windowDays) query.where = [['at', '>=', new Date(EV.toMs(at) - r.windowDays * 864e5).toISOString()]];
    return {
      tool: 'ArtifactData',
      args: { action: query.where ? 'query' : 'list', url: run.url, collection: r.collection, query, out_dir: out },
    };
  });
  // B-61 (D-112): a pipeline that compares the scheduler with the record reads it with its pull, read-only.
  if (def.schedulerRead) calls.push({ tool: SCHEDULER_TOOL, args: { limit: 100, enabled: true } });
  return printed(dir, run, 'pull', calls);
}
const SCHEDULER_TOOL = 'mcp__claude-code-remote__list_triggers';
/**
 * B-61: the scheduler pages the pull's list_triggers call returned (its next_cursor pages too), saved to
 * <dir>/scheduler/triggers-<n>.json as the transcript holds them. {pages, more: the next call | null}. No result (the
 * tool not offered to this run) is no pages: the watchdog then keeps the kind no-run, and the run goes on.
 */
function schedulerPull(dir, transcript) {
  const results = toolResults(transcript, 'list_triggers').filter(
    r => r.input && r.input.limit === 100 && r.input.enabled === true && !r.isError
  );
  const sdir = path.join(dir, 'scheduler');
  const pages = [];
  results.forEach((r, i) => {
    const body = resultBody(r);
    writeJson(path.join(sdir, `triggers-${i + 1}.json`), JSON.parse(body.trim().startsWith('{') ? body : '{}'));
    pages.push(r);
  });
  const last = results[results.length - 1];
  let more = null;
  if (last) {
    try {
      const j = JSON.parse(resultBody(last));
      if (j.has_more && j.next_cursor)
        more = { tool: SCHEDULER_TOOL, args: { limit: 100, enabled: true, cursor: j.next_cursor } };
    } catch {
      /* not JSON: no next page */
    }
  }
  return { pages: pages.length, more };
}

/** Versions from an ArtifactData list/query reply: {collection, versions: {id: n}, more: cursor | null}. */
export function parseListReply(text) {
  const col = (/from collection "([^"]+)"/.exec(text) || [])[1] || null;
  const versions = {};
  for (const m of text.matchAll(/^- "([^"]+)"\s+\d+ bytes\s+version (\d+)/gm)) versions[m[1]] = Number(m[2]);
  const rest = /\(id, version\): ([^\]]*)\]/.exec(text);
  if (rest) for (const m of rest[1].matchAll(/"((?:[^"\\]|\\.)*)" (\d+)/g)) versions[m[1]] = Number(m[2]);
  const empty = /^0 documents|no documents/im.test(text);
  const more = (/next_cursor["']?\s*[:=]\s*["']?([A-Za-z0-9_=-]+)/.exec(text) || [])[1] || null;
  return { collection: col, versions, more, empty };
}

/** After the pull calls: every read accounted for in the transcript, versions saved, or the follow-up calls to make. */
export function pulled({ spec, dir, transcript }) {
  const run = loadRun(dir);
  const def = pipelineDef(spec, run.pipeline);
  const pullDir = path.join(dir, 'pull');
  const results = toolResults(transcript, 'ArtifactData').filter(
    r => r.input && r.input.out_dir === pullDir && ['list', 'query'].includes(r.input.action) && r.input.url === run.url
  );
  const versions = {};
  const followUps = [];
  const missing = [];
  for (const read of def.reads || []) {
    const mine = results.filter(r => r.input.collection === read.collection);
    if (!mine.length) {
      missing.push(read.collection);
      continue;
    }
    if (mine.some(r => r.isError)) throw new Error(`the pull of ${read.collection} failed; run it again as printed`);
    const v = (versions[read.collection] = versions[read.collection] || {});
    for (const r of mine) Object.assign(v, parseListReply(r.texts.join('\n')).versions);
    const last = parseListReply(mine[mine.length - 1].texts.join('\n'));
    if (last.more)
      followUps.push({
        tool: 'ArtifactData',
        args: {
          ...mine[mine.length - 1].input,
          query: { ...(mine[mine.length - 1].input.query || {}), cursor: last.more },
        },
      });
  }
  if (missing.length) throw new Error(`no pull result for ${missing.join(', ')}: make the printed pull calls first`);
  if (def.schedulerRead) {
    const sc = schedulerPull(dir, transcript);
    if (sc.more) followUps.push(sc.more);
  }
  if (followUps.length) return { done: false, calls: printed(dir, run, 'pull', followUps) };
  writeJson(path.join(dir, 'versions.json'), versions);
  return { done: true, versions };
}

// ------------------------------------------------------------------------------------------------ 4 compute
export function loadPulled(dir) {
  const db = {};
  const p = path.join(dir, 'pull');
  if (fs.existsSync(p))
    for (const { collection, id, doc } of readExport(p)) (db[collection] = db[collection] || []).push({ ...doc, id });
  return db;
}
function applyInMemory(db, w) {
  const list = (db[w.collection] = db[w.collection] || []);
  const i = list.findIndex(d => d.id === w.id);
  const doc = w.op === 'update' ? { ...merge(i >= 0 ? list[i] : {}, w.data), id: w.id } : { ...w.data, id: w.id };
  if (i >= 0) list[i] = doc;
  else list.push(doc);
}
/** Two writes to one document in a plan become one: a set then updates is a set; updates merge. */
function coalesce(writes) {
  const out = [];
  const at = new Map();
  for (const w of writes) {
    const k = `${w.collection}/${w.id}`;
    if (!at.has(k)) {
      at.set(k, out.length);
      out.push({ ...w });
      continue;
    }
    const prev = out[at.get(k)];
    out[at.get(k)] = w.op === 'set' ? { ...w } : { ...prev, data: merge(prev.data, w.data) };
  }
  return out;
}
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
};

/**
 * Runs the steps. Returns {status: 'waiting', step, question} while an agent answer is missing, {status: 'refused',
 * problems} when any write fails a check (nothing is planned), or {status: 'planned', plan}.
 */
/** Every string in a value, with a function that rebuilds the value with each string mapped (for holding values back). */
function mapStrings(v, f) {
  if (typeof v === 'string') return f(v);
  if (Array.isArray(v)) return v.map(x => mapStrings(x, f));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)]));
  return v;
}
/**
 * B-197: the identifier check in a run, after every step has planned its writes. Candidates come from the patterns
 * (EV.identifierCandidates) in every planned write and in the push and detail lines. One with a kept verdict (idchecks,
 * pulled or among this plan's own writes, as a restore's are) is decided by it, so nothing is judged twice. The rest wait
 * on this run's identifiers step: its answer, one verdict per candidate, is kept as idchecks/<key>. A pipeline with no
 * judgment step (its prompt has no way to answer one) holds them as unsure and says so. Practice passes; real and
 * unsure hold back only that value ([left out]); the detail line says how many, in plain words.
 */
function identifierStage({ planned, push, detail, pulledDb, dir, run, def, now, spec }) {
  const writer = def.writer || run.pipeline;
  const own = planned.filter(w => w.collection === 'idchecks').map(w => ({ id: w.id, ...w.data }));
  const kept = EV.keptVerdicts([...(pulledDb.idchecks || []), ...own]);
  const found = new Map();
  const look = (ref, text) => {
    for (const c of EV.identifierCandidates(text))
      if (!found.has(c.key)) found.set(c.key, { ...c, ref, around: EV.idContext(text, c) });
  };
  // A document's strings joined in order, so the words around a value include its neighbors (a reply's question).
  for (const w of planned) if (w.collection !== 'idchecks') look(`${w.collection}/${w.id}`, strings(w.data).join('\n'));
  if (push) look(`runs/${run.id}`, push);
  if (detail) look(`runs/${run.id}`, detail);
  const fresh = [...found.values()].filter(c => !kept[c.key]);
  const same = { planned, push, detail, problems: [], judged: null };
  if (!found.size) return same;
  let judged = [];
  let answered = false;
  if (fresh.length) {
    const canAsk = (def.steps || []).some(s => s.kind === 'agent');
    const answerPath = path.join(dir, 'answers', 'identifiers.json');
    if (canAsk && !fs.existsSync(answerPath))
      return {
        waiting: {
          status: 'waiting',
          step: 'identifiers',
          question: {
            judgment: EV.ID_JUDGMENT,
            material: { candidates: fresh.map(c => ({ key: c.key, kind: c.why, where: c.ref, around: c.around })) },
            output: EV.ID_ANSWER_SHAPE,
            answerPath,
          },
        },
      };
    if (canAsk) {
      const answer = readJson(answerPath);
      const v = validateAgainst(EV.ID_ANSWER_SHAPE, answer);
      if (!v.ok)
        return {
          ...same,
          problems: [`identifiers: the answer does not fit its shape: ${describeErrors('answer', v).split('\n')[0]}`],
        };
      judged = EV.readVerdicts(fresh, answer);
      answered = true;
    } else
      judged = fresh.map(c => ({ ...c, verdict: 'unsure', reason: 'held where no judgment step could look at it' }));
  }
  const verdictOf = c => (kept[c.key] ? kept[c.key].verdict : judged.find(j => j.key === c.key).verdict);
  const held = [...found.values()].filter(c => verdictOf(c) !== 'practice');
  const hold = t =>
    EV.holdBack(
      t,
      held.map(c => c.value)
    );
  const out = held.length
    ? planned.map(w => (w.collection === 'idchecks' ? w : { ...w, data: mapStrings(w.data, hold) }))
    : planned.slice();
  // Only an answered judgment is kept: a value held where none could look is looked at the next time one can.
  for (const j of answered ? judged : [])
    out.push({
      op: 'set',
      collection: 'idchecks',
      id: j.key,
      data: {
        schema: 1,
        writer,
        at: now,
        source: `${run.pipeline} ${run.id}`,
        release: run.release,
        key: j.key,
        verdict: j.verdict,
        reason: EV.holdBack(j.reason, [j.value]).slice(0, 200) || 'no reason given',
        kind: String(j.why).slice(0, 80),
        ref: String(j.ref).slice(0, 120),
        by: 'judgment',
      },
    });
  const n = held.length;
  const said = n
    ? `${n} detail${n === 1 ? '' : 's'} that could be a real patient's left out (B-04); ${found.size - n} from practice kept`
    : `${found.size} detail${found.size === 1 ? '' : 's'} checked: from practice, kept`;
  return {
    planned: out,
    push: push && hold(push),
    detail: detail ? hold(detail) + (n ? ' · ' + said : '') : n ? said : detail,
    problems: [],
    judged: said,
  };
}

export function compute({ spec, dir, validate, at }) {
  const run = loadRun(dir);
  const def = pipelineDef(spec, run.pipeline);
  const versionsFile = path.join(dir, 'versions.json');
  if ((def.reads || []).length && !fs.existsSync(versionsFile))
    throw new Error('run pulled first: no document versions yet');
  const versions = fs.existsSync(versionsFile) ? readJson(versionsFile) : {};
  const db = loadPulled(dir);
  const pulledDb = loadPulled(dir);
  const now = EV.envelope('x', '', at).at;
  const ctx = {
    runId: run.id,
    pipeline: run.pipeline,
    record: run.record,
    writer: def.writer || run.pipeline,
    date: EV.chicagoDate(now),
    now,
    source: `${run.pipeline} ${run.id}`,
    release: run.release,
    commit: run.commit || null,
    startedAt: run.startedAt,
    input: run.input || {},
    url: run.url,
    dir,
    outputs: run.outputs,
  };
  const writes = [];
  const steps = [];
  let push = null,
    detail = null;
  const problems = [];
  const fires = [];
  const device = [];
  for (const s of def.steps) {
    let r;
    if (s.kind === 'code') r = CODE_STEPS[s.fn || s.id](db, ctx, spec);
    else if (s.kind === 'agent') {
      const answerPath = path.join(dir, 'answers', s.id + '.json');
      const pre = s.material ? AGENT_MATERIAL[s.material](db, ctx, spec) : null;
      if (pre && pre.skip) {
        steps.push({ id: s.id, status: 'skipped', detail: pre.skip });
        continue;
      }
      if (!fs.existsSync(answerPath)) {
        // Calls a material lists are printed calls: the audit holds the agent to them (registered once per step).
        const listed = ((pre && pre.groups) || []).flatMap(g => g.calls || []);
        if (listed.length && !run.calls.some(c => c.move === 'agent:' + s.id))
          printed(dir, run, 'agent:' + s.id, listed);
        return {
          status: 'waiting',
          step: s.id,
          question: { judgment: s.judgment, material: pre, output: s.output, answerPath },
        };
      }
      const answer = readJson(answerPath);
      const v = validateAgainst(s.output, answer);
      if (!v.ok) {
        problems.push(`${s.id}: the answer does not fit its shape: ${describeErrors('answer', v).split('\n')[0]}`);
        steps.push({ id: s.id, status: 'refused' });
        continue;
      }
      r = AGENT_FOLDS[s.fold](answer, db, ctx, spec);
    } else {
      steps.push({ id: s.id, status: 'skipped', detail: `${s.kind} step: printed by its own move` });
      continue;
    }
    for (const x of r.problems || []) problems.push(`${s.id}: ${x}`);
    for (const w of r.writes || []) {
      if (w.op === 'delete' || !['set', 'update'].includes(w.op)) {
        problems.push(`${s.id}: plans never delete (${w.collection}/${w.id})`);
        continue;
      }
      writes.push(w);
      applyInMemory(db, w);
    }
    if (r.push) push = r.push;
    if (r.detail) detail = detail ? detail + ' · ' + r.detail : r.detail;
    for (const c of r.device || []) {
      if (
        c.tool !== 'mcp__remote-devices__device_commit_files' ||
        !(c.args.files || []).every(
          f =>
            String(f.stagedPath).startsWith('/mnt/user-data/outputs/') ||
            String(f.stagedPath).startsWith(run.outputs || '/mnt/user-data/outputs/')
        )
      )
        problems.push(`${s.id}: a device call commits only staged outputs`);
      else device.push(c);
    }
    for (const f of r.fires || []) {
      if (!/^trig_/.test(f.trigger_id || '')) problems.push(`${s.id}: a fire needs a trigger id`);
      else fires.push(f);
    }
    steps.push({
      id: s.id,
      status: 'ok',
      detail: (r.say || []).join(' ').slice(0, 300) || `${(r.writes || []).length} write(s)`,
    });
  }
  let planned = coalesce(writes);
  // B-197: the identifier check's two stages. The patterns nominate candidates; a kept verdict decides one already seen;
  // the rest go to this run's judgment step (or are held as unsure where the pipeline has none).
  const ids = identifierStage({ planned, push, detail, pulledDb, dir, run, def, now, spec });
  if (ids.waiting) return ids.waiting;
  planned = ids.planned;
  push = ids.push;
  detail = ids.detail;
  for (const x of ids.problems) problems.push(x);
  if (ids.judged) steps.push({ id: 'identifiers', status: 'ok', detail: ids.judged });
  const files = [];
  for (const w of planned) {
    const ref = `${w.collection}/${w.id}`;
    if (!spec.collections[w.collection]) {
      problems.push(`${ref}: no such collection`);
      continue;
    }
    const existing = (pulledDb[w.collection] || []).find(d => d.id === w.id) || null;
    const doc = w.op === 'update' ? merge(existing ? EV.docData(existing) : null, w.data) : w.data;
    if (w.op === 'update' && !existing) problems.push(`${ref}: an update needs the document in the pull`);
    // B-32 (D-089): an update to a Fact changes only its append maps, its marks (by a role the mark names) and fields
    // it does not have yet; every other field is write-once.
    if (w.op === 'update' && existing && classOf(spec, w.collection, w.id) === 'Fact') {
      const c = spec.collections[w.collection];
      const roles = [def.writer || run.pipeline, ...(def.roles || [])];
      for (const [k, v] of Object.entries(w.data)) {
        if ((c.appends || {})[k]) continue;
        const mark = (c.marks || {})[k];
        if (mark) {
          if (!mark.some(r => roles.includes(r)))
            problems.push(`${ref}: ${k} is a mark ${mark.join(', ')} changes, not ${roles.join(' or ')}`);
          continue;
        }
        if (existing[k] !== undefined && EV.stableStringify(existing[k]) !== EV.stableStringify(v))
          problems.push(`${ref}: ${k} is write-once on a Fact (not a mark)`);
      }
    }
    // B-163: the restore drill's copies of documents as the backup holds them (a v3-era run, a legacy copy that keeps
    // the writer it was made by) were checked against the backup by planRestore; only the drill may mark one so.
    const asWritten = w.asWritten === true && run.pipeline === 'restore-drill';
    const vr = asWritten ? { ok: true } : validate(w.collection, doc, { id: w.id });
    if (!vr.ok) problems.push(describeErrors(ref, vr).split('\n').slice(0, 2).join(' · '));
    if (!asWritten && w.op === 'set' && doc.writer && !writersOf(spec, w.collection, w.id).includes(doc.writer))
      problems.push(`${ref}: written as ${doc.writer}, not a writer of ${w.collection}`);
    for (const [field, allowed] of Object.entries(spec.collections[w.collection].appends || {})) {
      for (const [p, k] of appendEntries(w.data[field], appendDepth(w.collection, field))) {
        const by = keyWriter(w.collection, field, k);
        if (by && !allowed.includes(by))
          problems.push(`${ref}: ${field}.${p} appended by ${by}; ${field} is appended by ${allowed.join(', ')}`);
      }
    }
    const size = Buffer.byteLength(JSON.stringify(doc));
    if (spec.capacity.documentBytes && size > spec.capacity.documentBytes)
      problems.push(`${ref}: ${size} bytes, over the ${spec.capacity.documentBytes}-byte budget`);
    const version = (versions[w.collection] || {})[w.id];
    if (existing && version == null) problems.push(`${ref}: exists but its version was not pulled`);
    const file = path.join(dir, 'writes', w.collection, w.id + '.json');
    writeJson(file, w.data);
    files.push({
      op: w.op,
      collection: w.collection,
      doc_id: w.id,
      file_path: file,
      ...(version != null ? { if_version: version } : {}),
      data: w.data,
    });
  }
  if (problems.length) return { status: 'refused', problems, steps };
  const batches = chunkWrites(files, spec.capacity.batch).map(b => b.map(({ data, ...x }) => x));
  const plan = {
    runId: run.id,
    pipeline: run.pipeline,
    url: run.url,
    computedAt: now,
    push,
    ...(detail ? { detail } : {}),
    steps,
    writes: files.length,
    batches,
    fires,
    ...(device.length ? { device } : {}),
    hash: null,
    replans: [],
  };
  plan.hash = planHash(plan);
  writeJson(path.join(dir, 'plan.json'), plan);
  return { status: 'planned', plan };
}

/**
 * The plan's checksum, recomputed from the plan and every write file it names (B-33): the run id, the push line, the
 * detail, the fires, the device calls and each batch's writes with the data read back from disk. A write file edited
 * after compute changes it.
 */
export function planHash(plan) {
  const batches = plan.batches.map(b => b.map(w => ({ ...w, data: readJson(w.file_path) })));
  return EV.sha256(
    EV.stableStringify({
      runId: plan.runId,
      push: plan.push,
      detail: plan.detail,
      fires: plan.fires,
      ...(plan.device && plan.device.length ? { device: plan.device } : {}),
      batches,
    })
  );
}
/** The plan, refused when its files no longer hash to what compute (or the last replan) stored. */
function checkedPlan(dir) {
  const plan = readJson(path.join(dir, 'plan.json'));
  let now;
  try {
    now = planHash(plan);
  } catch (e) {
    throw new Error(
      `a write file of the plan cannot be read (${e.message}): run compute again; never edit a plan or a write by hand`
    );
  }
  if (now !== plan.hash)
    throw new Error(
      `the plan's write files changed since it was computed (plan ${String(plan.hash).slice(0, 12)}, files ${now.slice(0, 12)}): run compute again; never edit a plan or a write by hand`
    );
  return plan;
}

// ------------------------------------------------------------------------------------------------ 5 apply
const batchCall = (url, writes) => ({ tool: 'ArtifactData', args: { action: 'batch', url, writes } });
export function apply({ dir }) {
  const run = loadRun(dir);
  const plan = checkedPlan(dir);
  // Writes first, so a re-fire's record exists before the task starts; the Mac's files after the record's.
  return printed(dir, run, 'apply', [
    ...plan.batches.map(b => batchCall(run.url, b)),
    ...(plan.device || []),
    ...(plan.fires || []).map(f => ({ tool: 'mcp__claude-code-remote__fire_trigger', args: f })),
  ]);
}
/** Batch n (1-based) was refused on a version pin: the fresh pull of its collections, into <dir>/repull-<n>. */
export function applyFailed({ dir, batch }) {
  const run = loadRun(dir);
  const plan = checkedPlan(dir);
  const b = plan.batches[batch - 1];
  if (!b) throw new Error(`no batch ${batch}`);
  const out = path.join(dir, `repull-${batch}`);
  const cols = [...new Set(b.map(w => w.collection))];
  return printed(
    dir,
    run,
    'repull',
    cols.map(c => ({
      tool: 'ArtifactData',
      args: { action: 'list', url: run.url, collection: c, query: { limit: 1000 }, out_dir: out },
    }))
  );
}
/**
 * Re-plans batch n from its fresh pull: appends are keyed and Derived documents are whole, so the same writes are
 * re-pinned to the versions now current. A Fact that now exists was written by an earlier attempt: its set is dropped.
 * A repull reply with a next_cursor is followed first (B-33): {done: false, calls} until every page is in, then
 * {done: true, calls: [the batch]}. The plan's hash is recomputed for the re-pinned batch.
 */
export function replan({ spec, dir, batch, transcript }) {
  const run = loadRun(dir);
  const plan = checkedPlan(dir);
  const b = plan.batches[batch - 1];
  if (!b) throw new Error(`no batch ${batch}`);
  const out = path.join(dir, `repull-${batch}`);
  const fresh = {};
  const last = {};
  for (const r of toolResults(transcript, 'ArtifactData').filter(
    r => r.input && r.input.out_dir === out && !r.isError
  )) {
    const p = parseListReply(r.texts.join('\n'));
    Object.assign((fresh[r.input.collection] = fresh[r.input.collection] || {}), p.versions);
    last[r.input.collection] = { input: r.input, more: p.more };
  }
  const cols = [...new Set(b.map(w => w.collection))];
  const missing = cols.filter(c => !fresh[c]);
  if (missing.length) throw new Error(`no fresh pull for ${missing.join(', ')}: make the printed calls first`);
  const followUps = cols
    .filter(c => last[c].more)
    .map(c => ({
      tool: 'ArtifactData',
      args: { ...last[c].input, query: { ...(last[c].input.query || {}), cursor: last[c].more } },
    }));
  if (followUps.length) return { done: false, calls: printed(dir, run, 'repull', followUps) };
  const dropped = [];
  const next = b.flatMap(w => {
    const v = fresh[w.collection][w.doc_id];
    if (w.op === 'set' && w.if_version == null && v != null && classOf(spec, w.collection, w.doc_id) === 'Fact') {
      dropped.push(`${w.collection}/${w.doc_id}`);
      return [];
    }
    if (v == null) {
      const { if_version, ...x } = w;
      return [x];
    }
    return [{ ...w, if_version: v }];
  });
  const from = plan.hash;
  plan.batches[batch - 1] = next;
  plan.hash = planHash(plan);
  plan.replans.push({ batch, dropped, from });
  writeJson(path.join(dir, 'plan.json'), plan);
  return { done: true, calls: printed(dir, run, 'apply', [batchCall(run.url, next)]) };
}

// ------------------------------------------------------------------------------------------------ 6 end
export function end({ dir, at, status, detail, transcript }) {
  const run = loadRun(dir);
  const planFile = path.join(dir, 'plan.json');
  const plan = fs.existsSync(planFile) ? readJson(planFile) : null;
  const steps = plan ? [...plan.steps] : [];
  // B-33: end stores the hash recomputed from the files, not the one compute wrote; a difference fails the run.
  let hash = null,
    changed = null;
  if (plan) {
    try {
      hash = planHash(plan);
    } catch (e) {
      changed = `a write file cannot be read: ${e.message}`;
    }
    if (hash && hash !== plan.hash)
      changed = `the plan's write files changed after compute (plan ${String(plan.hash).slice(0, 12)}, files ${hash.slice(0, 12)})`;
  }
  if (transcript != null) {
    const a = audit({ dir, transcript });
    steps.push({
      id: 'audit',
      status: a.ok ? 'ok' : 'extra-calls',
      detail: a.ok
        ? `${a.matched} calls, all printed` + (a.missing.length ? `; ${a.missing.length} printed but not made` : '')
        : a.extra
            .map(c => c.tool + ' ' + c.summary)
            .join('; ')
            .slice(0, 300),
    });
  }
  const why = [changed, detail || (plan && plan.detail)].filter(Boolean).join(' · ');
  const final = changed ? 'failed' : status || (plan ? 'ok' : 'failed');
  // B-40: a failed run's push names the failed step (the detail's "<move>:" lead), never the plan's push; B-172: in
  // plain words, led by what Matt went without (failLine).
  const failedAt =
    final !== 'ok'
      ? String(changed ? 'apply' : (detail || '').split(':')[0] || '')
          .trim()
          .slice(0, 40)
      : '';
  const push =
    final === 'ok'
      ? (plan && plan.push) || null
      : failLine({ failed: run.failed, pipeline: run.pipeline, reason: failedAt });
  const data = {
    endedAt: EV.envelope('x', '', at).at,
    status: final,
    steps,
    ...(plan && hash ? { planHash: hash } : {}),
    ...(plan || final !== 'ok' ? { push } : {}),
    ...(why ? { detail: why.slice(0, 500) } : {}),
  };
  const file = path.join(dir, 'out', 'runs', run.id + '.end.json');
  writeJson(file, data);
  return printed(dir, run, 'end', [
    {
      tool: 'ArtifactData',
      args: { action: 'update', url: run.url, collection: 'runs', doc_id: run.id, file_path: file, if_version: 1 },
    },
  ]);
}

// ------------------------------------------------------------------------------------------------ audit
const IO_TOOL =
  /(^|__)(ArtifactData|Artifact|fire_trigger|update_trigger|create_trigger|delete_trigger|list_triggers|device_commit_files|device_bash|batch|update|create|delete)$/;
const toolName = n => String(n).replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '');
/** A call reduced to what identifies it: the tool and its arguments, key order ignored. */
const callKey = (tool, args) => toolName(tool) + ' ' + EV.stableStringify(args || {});
const summary = args => [args.action, args.collection, args.doc_id].filter(Boolean).join(' ');
/**
 * Holds the transcript's record-touching calls, from the run's start call on, against the calls its commands printed
 * (and the gate's reads of system/*). {ok, matched, extra: calls not printed, missing: printed calls not made}.
 */
export function audit({ dir, transcript }) {
  const run = loadRun(dir);
  const expected = run.calls.map(c => ({ key: callKey(c.tool, c.args), c }));
  const used = toolResults(transcript, '*').filter(r => IO_TOOL.test(String(r.name)) || IO_TOOL.test(toolName(r.name)));
  const startKey = expected.length ? expected[0].key : null;
  const from = used.findIndex(u => callKey(u.name, u.input) === startKey);
  const calls = from >= 0 ? used.slice(from) : used;
  const pool = expected.map(e => e.key);
  const extra = [];
  let matched = 0,
    allowed = 0;
  for (const u of calls) {
    const k = callKey(u.name, u.input);
    const i = pool.indexOf(k);
    if (i >= 0) {
      pool.splice(i, 1);
      matched++;
      continue;
    }
    const a = u.input || {};
    if (toolName(u.name) === 'ArtifactData' && a.action === 'get' && a.collection === 'system') {
      matched++;
      continue;
    } // the gate
    // The next page of a printed list_triggers: the same arguments plus the cursor the last page gave (B-29).
    if (toolName(u.name) === 'list_triggers' && a.cursor) {
      const { cursor, ...rest } = a;
      if (expected.some(e => e.key === callKey(u.name, rest))) {
        matched++;
        continue;
      }
    }
    if ((run.allowed || []).some(p => String(u.name).startsWith(p))) {
      allowed++;
      continue;
    } // what the pipeline's judgment step may do
    extra.push({ tool: toolName(u.name), summary: summary(a) || k.slice(0, 120) });
  }
  return { ok: !extra.length, matched, allowed, extra, missing: pool.map(k => k.slice(0, 160)) };
}

export const formatCalls = calls =>
  calls.map((c, i) => `${i + 1}. ${c.tool}\n${JSON.stringify(c.args, null, 1)}`).join('\n\n');
