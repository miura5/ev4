#!/usr/bin/env node
// The Chart: E.V.'s project record (M12; design https://claude.ai/artifact/8DVSMh5WdybjeHVV5m2uQT, approved by Matt
// Oct 19). chart/ holds the facts; BACKLOG.md, DECISIONS.md and CHANGELOG.md are generated from them; these commands are
// the only way in. chart/ and this file sit outside the manifest's
// file list (tools/build.mjs HASHED), so a bookkeeping commit never changes what a deploy ships.
//   report <bug|request> --from-chat ["<words>"] | --from-comment <id> | "<words>" --source <where> [--reworded "<his point>"]
//            in Matt's words as written, taken from this session's transcript (his message, a Board comment) (B-95)
//   inbox                    session start: the Board comments to file and the entries to triage, as commands
//   quarantine --runs <file> the quarantined timing checks and their green nightlies in a row (B-152)
//   log <id> [--status s] [--note t] [--commit sha] [--name n] [--waiting-on who] [--dod d] [--title t]
//            [--ask "<one line>" [--choices "A|B"]] [--note --from-job <job id>]
//            [--triage task --dod d --milestone m [--depends ids] | --triage join <id> | --triage decline --reason r]
//   log deploy --target <staging|live> --commit sha [--time ISO] [--ok Matt] [--verify green] [--rollback sha]
//              [--tasks ids] [--summary s] [--why w] [--decisions ids]
//   log rule <R-id> --rule t --decision D-id --command c --fn name [--task B-id]   a rule ship enforces
//   log decision <D-id> --title t [--status s] [--why w] [--supersedes ids] [--amends ids]
//            each writes one change to chart/, regenerates BACKLOG.md, commits (--no-commit to skip; --trailer adds a
//            commit trailer line, repeatable)
//   plan --from <doc link> [--apply]   a design doc's hand-off (D-141, B-106): from this session's
//            read of the doc, its 'Tasks to add' and 'Decisions proposed' tables as the log new and log decision commands
//            that file them (the next free ids, P-n rewritten to its D-id); --apply runs them; filed rows are skipped
//   lint [--json]            the record's checks: ids, dependencies, decisions, commits, the inbox (B-94; npm test runs it)
//   ship <staging|live> [--done B-nn --commit sha]   the deploy checklist: the rules, the reads, deploy's calls, verify,
//            the record (B-96); --done records those tasks done in the same command (B-147)
//   rollback live [--to sha] [--matt-ok --apply] [--no-test]   the way back (B-60): the previous live build's content at main's
//            head, as a restore commit, then ship staging and ship live; without --apply a dry run that prints it all
//   brief --task <id>        one page for a new session: the inbox, the task, its dependencies, decisions, limits
//   backlog [--check]        regenerate BACKLOG.md (--check: exit 1 when the file differs)
//   trace --job <id> --record <staging|live> --status done|failed [--note t] [--kickoff | --filed]   a builder run's
//            trace of its job, as the calls that write it (B-178, B-183)
// Options: --root <repo> (default this checkout). Exit 0 green, 1 red or refused, 2 usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newestTranscript, toolResults } from '../core/transcript.mjs';
import {
  verify,
  verifyReads,
  deployCalls,
  formatDeploy,
  canonical,
  SYSTEM_IDS,
  contentHash,
  artifactUrl,
} from '../core/deploy.mjs';
import { builderRun, pushRefusal } from './guard.mjs';
import { makeActions } from '../core/actions.mjs';
import { validateAgainst } from '../core/validate.mjs';
import { currentVersion } from '../core/migrate.mjs';
import EVCORE from '../core/evcore.mjs';

const ACTIONS = makeActions(validateAgainst);
import { commitsBehind, mainHead } from '../core/cli.mjs';
import { readState, withShell } from '../core/verifystate.mjs';
import { build, BOOKKEEPING } from './build.mjs';

// The record, its constants and the shared helpers live in tools/chart/record.mjs (B-262).
export {
  FILES,
  TASK_STATUS,
  TASK_KINDS,
  DECISION_STATUS,
  DECISION_KINDS,
  TENET_SCOPES,
  TENET_CHECKS,
  kindOf,
  chartDir,
  loadChart,
  saveChart,
  findTask,
  nextTaskId,
  nextDecisionId,
  ctDate,
  ctClock,
} from './chart/record.mjs';
import {
  FILES,
  TASK_STATUS,
  DECISION_KINDS,
  TENET_SCOPES,
  TENET_CHECKS,
  kindOf,
  chartDir,
  loadChart,
  saveChart,
  findTask,
  nextTaskId,
  nextDecisionId,
  ctDate,
  ctClock,
  HERE,
  readJson,
  readJsonIf,
  readSpec,
  transcriptOf,
  waitOnNoOne,
  commitMessage,
  sha256,
  git,
  ids,
  list,
  parts,
} from './chart/record.mjs';

// The generated files and the lint live in tools/chart/render.mjs (B-262).
export {
  BACKLOG_HEADER,
  taskText,
  dependsText,
  backlogRow,
  PLACES,
  yourTurn,
  askOf,
  yourTurnDoc,
  yourTurnLines,
  renderBacklog,
  renderDecisions,
  renderChangelog,
  generatedFiles,
  boardName,
  changelogLine,
  lintChart,
  formatLint,
} from './chart/render.mjs';
import {
  taskText,
  dependsText,
  PLACES,
  yourTurn,
  yourTurnDoc,
  yourTurnLines,
  generatedFiles,
  boardName,
  lintChart,
  formatLint,
} from './chart/render.mjs';

// ------------------------------------------------------------------------------------------------ Docs reads
/** XML's five entities decoded (&amp; last, so "&amp;lt;" stays "&lt;"). */
const ent = s =>
  s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
/** A Docs read's prose XML as {rev, rows: [{id, h, cells: [{id, h, text, dropdown}]}]} for one table (ids in full). */
export function parseTableXml(xml) {
  let session = null;
  // A read prints a session's first id in full and later ones short (.90 is <that session>.90).
  const full = id => {
    if (id.startsWith('.')) return session + id;
    session = id.split('.')[0];
    return id;
  };
  const rev = Number((xml.match(/<doc [^>]*rev='(\d+)'/) || [])[1]);
  const rows = [];
  let row = null,
    cellNow = null;
  for (const m of xml.matchAll(/<(\/?)(table|row|cell|text|dropdown|paragraph|[a-z]+)\b([^>]*?)(\/?)>|([^<]+)/g)) {
    if (m[5] != null) {
      if (cellNow && m[5]) cellNow.text += ent(m[5]);
      continue;
    }
    const [, close, tag, attrs, selfClose] = m;
    const id = (attrs.match(/\bid='([^']+)'/) || [])[1];
    const h = (attrs.match(/\bh='([^']+)'/) || [])[1];
    const fid = id ? full(id) : null;
    if (close) {
      if (tag === 'row') {
        rows.push(row);
        row = null;
      } else if (tag === 'cell') {
        row.cells.push(cellNow);
        cellNow = null;
      }
      continue;
    }
    if (tag === 'row') row = { id: fid, h, cells: [] };
    else if (tag === 'cell') cellNow = { id: fid, h, text: '', dropdown: null };
    else if (tag === 'dropdown' && cellNow)
      cellNow.dropdown = {
        enum: (attrs.match(/\benum='([^']+)'/) || [])[1],
        index: Number((attrs.match(/\bindex='(\d+)'/) || [])[1]),
      };
    else if (tag === 'paragraph' && cellNow && cellNow.text) cellNow.text += '\n';
    if (selfClose && tag === 'row') {
      rows.push(row);
      row = null;
    }
  }
  return { rev, rows };
}

/** A Docs read result's {rev, xml}, following the file a large result was saved to. */
export function readBody(texts) {
  let t = texts.join('');
  const saved = t.match(/Output has been saved to (\S+?\.txt)/);
  // A large result is saved as [{type, text}] or, as plain text, the result itself.
  if (saved && fs.existsSync(saved[1])) {
    const a = readJson(saved[1]);
    t = Array.isArray(a) ? a.map(x => x.text || '').join('') : typeof a === 'string' ? a : JSON.stringify(a);
  }
  const i = t.indexOf('{"verdict"');
  if (i < 0) return null;
  const v = JSON.parse(t.slice(i, t.lastIndexOf('}') + 1));
  return v.verdict === 'allow' && v.data ? { rev: v.data.rev, xml: v.data.xml } : null;
}
// The Claude Docs connector's tools: named Claude_Docs in most sessions, by the connector's id in others.
const DOCS = '(?:Claude_Docs|1a59c906-04da-521d-bda7-7f71b9f9e01c)__';
export const isDocsTool = (name, tool) => new RegExp(DOCS + '(?:' + tool + ')$').test(String(name));

// ------------------------------------------------------------------------------------------------ log, report
/** One change to the record. Returns {rec, what, id}; throws on a refusal. */
export function applyLog(rec, o, { now = new Date().toISOString(), builder = builderRun(), jsonl = null } = {}) {
  const [, id] = o._;
  if (id === 'deploy') {
    const target = o.target;
    if (!['staging', 'live'].includes(target)) throw new Error('log deploy needs --target staging|live');
    if (!o.commit) throw new Error('log deploy needs --commit');
    // B-144: a recorded deploy is corrected by a note, never rewritten or deleted.
    if (o.correct) {
      const had = rec.deploys.filter(x => x.target === target && x.commit === String(o.commit).slice(0, 7)).at(-1);
      if (!had) throw new Error(`no ${target} deploy at ${o.commit} in the record`);
      if (typeof o.note !== 'string' || !o.note) throw new Error('log deploy --correct needs --note');
      had.notes = [...(had.notes || []), o.note];
      return { rec, what: `${target} deploy at ${had.commit}: note`, id: 'deploy' };
    }
    const live = rec.deploys.filter(d => d.target === 'live').at(-1);
    const d = {
      target,
      commit: o.commit.slice(0, 7),
      time: o.time || now,
      okFrom: o.ok || null,
      verify: o.verify || null,
      rollback: target === 'live' ? o.rollback || (live && live.commit) || null : null,
      from: o.from ? String(o.from).slice(0, 7) : null,
      tasks: list(o.tasks),
      summary: o.summary || null,
      why: o.why || null,
      decisions: list(o.decisions),
      source: o.source || 'log',
    };
    // B-175 (D-173): the release a live deploy carries, so tools/tags.mjs can put a refused tag on origin.
    if (typeof o.release === 'string') {
      if (!/^v\d+\.\d+\.\d+$/.test(o.release)) throw new Error('log deploy --release takes a tag like v4.3.2');
      d.release = o.release;
    }
    if (target === 'live' && d.okFrom !== 'Matt')
      throw new Error('a live deploy is recorded with --ok Matt: there is none without his OK');
    if (rec.deploys.some(x => x.target === target && x.commit === d.commit && !x.line))
      throw new Error(`a ${target} deploy at ${d.commit} is already recorded`);
    rec.deploys.push(d);
    return {
      rec,
      what: `${target} deploy at ${d.commit}`,
      id: d.tasks.at(-1) || 'deploy',
    };
  }
  if (id === 'decision') {
    const did = o._[2];
    if (!/^D-\d{3}$/.test(did || '')) throw new Error('log decision <D-id> --title ...');
    const old = rec.decisions.find(d => d.id === did);
    if (!old && did !== nextDecisionId(rec))
      throw new Error(`the next free decision id is ${nextDecisionId(rec)}, not ${did}`);
    // B-184 (D-200): a builder run never files, changes, supersedes or amends a tenet.
    if (builder) {
      const tenet = x => (rec.decisions.find(y => y.id === x) || {}).kind === 'tenet';
      const hit = [
        o.kind === 'tenet' || (old && old.kind === 'tenet') ? did : null,
        ...list(o.supersedes || '').filter(tenet),
        ...list(o.amends || '').filter(tenet),
      ].filter(Boolean);
      if (hit.length)
        throw new Error(
          `a builder run never files or changes a tenet (D-200): ${hit.join(', ')}; that is a chat with Matt present`
        );
    }
    const d = old || {
      id: did,
      date: ctDate(now),
      title: '',
      why: '',
      status: 'proposed',
      supersedes: [],
      amends: [],
      source: 'log',
    };
    // A decision restated after it was filed (Matt, Oct 20: D-123 to D-126 to the UI tenets) is marked with the date.
    if (old && ((o.title && o.title !== d.title) || (o.why && o.why !== d.why))) d.restated = ctDate(now);
    if (o.title) d.title = o.title;
    if (o.why) d.why = o.why;
    if (o.status) d.status = o.status;
    if (!old && o.source) d.source = o.source;
    if (o.supersedes) d.supersedes = list(o.supersedes);
    if (o.amends) d.amends = list(o.amends);
    if (!d.title) throw new Error('a decision needs --title');
    // B-109: --kind tenet --scope ui[,data] --checked-by harness|lint|ship|review (--check is lint's flag).
    if (typeof o.kind === 'string') {
      if (!DECISION_KINDS.includes(o.kind)) throw new Error(`--kind ${DECISION_KINDS.join('|')}`);
      d.kind = o.kind;
    }
    if (typeof o.scope === 'string') d.scope = list(o.scope);
    if (typeof o['checked-by'] === 'string') d.check = o['checked-by'];
    if (typeof o.how === 'string') d.how = o.how;
    if (kindOf(d) === 'tenet') {
      if (!(d.scope || []).length || d.scope.some(x => !TENET_SCOPES.includes(x)))
        throw new Error(`a tenet needs --scope, one or more of ${TENET_SCOPES.join(', ')}`);
      if (!TENET_CHECKS.includes(d.check))
        throw new Error(`a tenet needs --checked-by, one of ${TENET_CHECKS.join(', ')}`);
    } else {
      delete d.scope;
      delete d.check;
      delete d.how;
    }
    if (!old) rec.decisions.unshift(d);
    for (const s of d.supersedes) {
      const x = rec.decisions.find(y => y.id === s);
      if (x) x.status = 'superseded';
    }
    return {
      rec,
      what: `${kindOf(d)} ${did} (${d.status}${kindOf(d) === 'tenet' ? `, ${d.scope.join(', ')}, ${d.check}` : ''})`,
      id: o.task || did,
    };
  }
  if (id === 'rule') {
    // A rule ship enforces: a new one takes the next free R- and rests on a decision in the record; --fn names the
    // check in ship that enforces it (--check is lint's flag).
    const rid = o._[2],
      had = rec.rules.find(r => r.id === rid),
      next = 'R-' + String(Math.max(0, ...rec.rules.map(r => Number(r.id.slice(2)))) + 1).padStart(2, '0');
    if (!had && rid !== next)
      throw new Error(`log rule ${next} --rule ... --decision D-... --command ... --fn ... [--task B-...]`);
    const r = had || { id: rid, rule: '', decision: '', task: null, command: '', check: '' };
    for (const [k, f] of [
      ['rule', 'rule'],
      ['decision', 'decision'],
      ['task', 'task'],
      ['command', 'command'],
      ['check', 'fn'],
    ])
      if (typeof o[f] === 'string') r[k] = o[f];
    // B-141: a rule whose reason is gone is marked ended, with the decision that ended it, and kept (nothing deleted).
    if (typeof o.ended === 'string') {
      if (!rec.decisions.some(d => o.ended.startsWith(d.id)))
        throw new Error('--ended starts with the decision that ended the rule (D-...)');
      r.ended = o.ended;
    }
    if (!r.rule || !r.decision || !r.command || !r.check)
      throw new Error('log rule needs --rule, --decision, --command and --fn');
    if (!rec.decisions.some(d => d.id === r.decision)) throw new Error(`${r.decision} is not in the record`);
    if (!had) rec.rules.push(r);
    return { rec, what: `rule ${rid} (${r.check}${r.ended ? ', ended' : ''})`, id: r.task || rid };
  }
  if (id === 'new') {
    // A task the design names that the record lacks (the Build plan tab's B-74, say): never an id already in use.
    const nid = o._[2];
    if (!/^B-\d{2,3}$/.test(nid || '') || findTask(rec, nid).length)
      throw new Error(`log new <B-id not in the record> --title ... --dod ... --milestone ...`);
    if (!o.title || !o.milestone) throw new Error('log new needs --title and --milestone (and --dod)');
    const t = {
      id: nid,
      kind: 'task',
      title: o.title,
      dod: o.dod || null,
      milestone: o.milestone,
      status: 'open',
      depends: list(o.depends).filter(x => /^B-\d+$/.test(x)),
      notes: o.note || '',
      commit: null,
      source: o.source || 'log new',
    };
    if (o.depends && list(o.depends).join(', ') !== t.depends.join(', ')) t.dependsText = o.depends;
    rec.tasks.push(t);
    return { rec, what: `new task (${t.milestone})`, id: nid };
  }
  const tasks = findTask(rec, id);
  if (!tasks.length) throw new Error(`no task ${id} in the record`);
  const which = o.which ? Number(o.which) : null;
  if (tasks.length > 1 && !which)
    throw new Error(
      `${tasks.length} tasks carry ${id}: renumber one first (log ${id} --which <n> --renumber ${nextTaskId(rec)})`
    );
  const t = tasks[(which || 1) - 1],
    what = [];
  if (!t) throw new Error(`--which ${which}: only ${tasks.length} tasks carry ${id}`);
  if (o.renumber) {
    if (o.renumber !== nextTaskId(rec)) throw new Error(`renumber to the next free id, ${nextTaskId(rec)}`);
    if (t.board && t.board.row) {
      t.board.row = t.board.row.replace(`v4 ${t.id}:`, `v4 ${o.renumber}:`);
    }
    t.renumberedFrom = t.id;
    t.id = o.renumber;
    what.push(`renumbered from ${id} (it shared that id)`);
  }
  if (o.triage) {
    const how = o.triage === true ? '' : o.triage;
    // A task Matt declines after it left the inbox (B-67, Oct 20) takes the same decline: open or blocked only, never one
    // started or done, and always with his reason. An open or blocked task joins another the same way (B-130 into
    // B-143, Oct 21: the task that retires the views it fixed).
    const declineTask = ['decline', 'join'].includes(how) && ['open', 'blocked'].includes(t.status);
    if (t.status !== 'inbox' && !declineTask) throw new Error(`${id} is ${t.status}, not in the inbox`);
    if (how === 'task') {
      if (!o.dod || !o.milestone) throw new Error('--triage task needs --dod and --milestone');
      Object.assign(t, {
        status: 'open',
        dod: o.dod,
        milestone: o.milestone,
        depends: list(o.depends).filter(x => /^B-\d+$/.test(x)),
        triage: { outcome: 'task', at: now },
      });
      if (o.title) t.title = o.title;
      what.push('triaged into a task');
    } else if (how === 'join') {
      const into = o._[2];
      if (!into || !findTask(rec, into).length) throw new Error('--triage join needs the task it joins');
      Object.assign(t, {
        status: 'declined',
        triage: { outcome: 'joined', into, reason: o.reason || `joins ${into}`, at: now },
      });
      what.push(`joins ${into}`);
    } else if (how === 'decline') {
      if (!o.reason) throw new Error('--triage decline needs --reason');
      Object.assign(t, { status: 'declined', triage: { outcome: 'declined', reason: o.reason, at: now } });
      what.push('declined');
    } else throw new Error('--triage task|join <id>|decline');
    // B-142: a declined or joined task waits on no one.
    if (t.status === 'declined' && t.waitingOn) waitOnNoOne(t);
  }
  if (o.status) {
    if (!TASK_STATUS.includes(o.status) || ['inbox', 'declined'].includes(o.status))
      throw new Error(`status ${o.status}: one of open, in progress, blocked, done`);
    if (t.status === 'inbox') throw new Error(`${id} is in the inbox: triage it first`);
    // Triage comes first in every session, before taking a task (the design's "Reporting bugs and requests").
    const waiting = rec.tasks.filter(x => x.status === 'inbox');
    if (o.status === 'in progress' && waiting.length)
      throw new Error(
        `triage first: ${waiting.map(x => x.id).join(', ')} wait${waiting.length === 1 ? 's' : ''} in the inbox`
      );
    if (o.status === 'done' && !(o.commit || t.commit))
      throw new Error(`${id} done needs --commit (the commit that did it)`);
    what.push(`${t.status} -> ${o.status}`);
    t.status = o.status;
    // B-142: a finished task waits on no one.
    if (o.status === 'done' && t.waitingOn && o['waiting-on'] == null) {
      waitOnNoOne(t);
      what.push('no longer waiting');
    }
  }
  // A task's definition of done or title, rewritten when a decision changes it (outside triage, which sets both).
  if (!o.triage && typeof o.dod === 'string') {
    t.dod = o.dod;
    what.push('definition of done');
  }
  if (!o.triage && typeof o.title === 'string') {
    t.title = o.title;
    what.push('title');
  }
  // Depends set after filing (a design hand-off's rows get ids only when plan files them; Oct 21, the v4.1 review):
  // the list replaces the task's own, each id must be in the record, and a task never depends on itself.
  if (!o.triage && typeof o.depends === 'string') {
    const deps = list(o.depends).filter(x => /^B-\d+$/.test(x));
    for (const d of deps) {
      if (d === t.id) throw new Error(`${t.id} cannot depend on itself`);
      if (!findTask(rec, d).length) throw new Error(`--depends ${d}: no such task`);
    }
    t.depends = deps;
    delete t.dependsText;
    what.push('depends');
  }
  if (o.commit) {
    t.commit = String(o.commit).slice(0, 7);
    what.push(`commit ${t.commit}`);
  }
  if (o['from-job']) {
    // B-179 (D-194): Matt's reply reaches the task from his job, the words from this session's get of it, never retyped.
    const j = jobFrom(jsonl, o['from-job']);
    if (!j) throw new Error(jobReadMissing(o['from-job']));
    if (typeof o.note === 'string' && o.note.trim() !== j.words)
      throw new Error(`--from-job ${j.id}: the words come from the job, never retyped (give --note with no text)`);
    t.notes = [t.notes, `Matt's reply (job ${j.id}, ${ctDate(j.doc.at || now)}): ${j.words}`]
      .filter(Boolean)
      .join('\n');
    t.jobs = [...new Set([...(t.jobs || []), j.id])];
    what.push(`notes from job ${j.id}`);
  } else if (o.note != null) {
    t.notes = o.note;
    what.push('notes');
  }
  if (o.name) {
    t.board = { ...t.board, row: `v4 ${t.id}: ${o.name}` };
    what.push('board');
  }
  // B-182 (D-196): what Your turn asks him, one line, and a decision's named choices (2 to 4, each a chip).
  if (o.ask != null) {
    const ask = o.ask === true ? '' : String(o.ask).replace(/\s+/g, ' ').trim();
    if (ask.length > 300) throw new Error('--ask is one line of at most 300 characters');
    if (ask) t.ask = ask;
    else {
      delete t.ask;
      delete t.choices;
    }
    what.push(ask ? 'ask' : 'ask cleared');
  }
  if (o.choices != null) {
    const cs = String(o.choices === true ? '' : o.choices)
      .split('|')
      .map(x => x.trim())
      .filter(Boolean);
    if (cs.length && (cs.length < 2 || cs.length > 4 || cs.some(x => x.length > 24)))
      throw new Error('--choices "A|B": 2 to 4 choices, each at most 24 characters');
    if (cs.length && !(t.ask || o.ask)) throw new Error('--choices goes with an --ask');
    if (cs.length) t.choices = cs;
    else delete t.choices;
    what.push(cs.length ? 'choices' : 'choices cleared');
  }
  if (o['waiting-on'] != null) {
    if (o['waiting-on'] && o['waiting-on'] !== 'none') t.waitingOn = o['waiting-on'];
    else waitOnNoOne(t);
    what.push('waiting on');
  }
  // B-148: where what waits on Matt happens (mac, staging, github, decision).
  if (typeof o.where === 'string') {
    if (!PLACES[o.where]) throw new Error(`--where ${o.where}: one of ${Object.keys(PLACES).join(', ')}`);
    t.waitingWhere = o.where;
    what.push('where');
  }
  if (!what.length) throw new Error('nothing to log: give --status, --note, --commit, --triage or --name');
  return { rec, what: what.join(', '), id: t.id };
}
export function applyReport(rec, o, { now = new Date().toISOString(), jsonl = null } = {}) {
  const [, kind, ...rest] = o._;
  let words = rest.join(' '),
    at = o.at || null;
  if (o['from-chat'] && !o.job) {
    // Matt's words come from his message in this session's transcript, never retyped.
    const w = jsonl && wordsFromChat(jsonl, o['from-chat'] === true ? null : o['from-chat']);
    if (!w)
      throw new Error(
        'no message in this session says "bug: ..." or "idea: ..."' +
          (o['from-chat'] === true ? '' : ` or holds "${o['from-chat']}"`)
      );
    words = w.words;
    at = at || w.at;
    o.source = o.source || 'build chat';
  }
  if (o['from-comment']) {
    const c = jsonl && (commentsFrom(jsonl, rec.views.board.node) || []).find(x => x.id === o['from-comment']);
    if (!c) throw new Error(`no Board comment ${o['from-comment']} in this session's newest comment query (run inbox)`);
    if (rec.tasks.some(t => t.source === `Board comment ${c.id}`))
      throw new Error(`Board comment ${c.id} is already filed`);
    words = c.body;
    o.source = `Board comment ${c.id}`;
    o.reply = c.id;
  }
  let job = null;
  if (o.job) {
    // B-179 (D-194): a build job from the page. Its words are the fired message's lines after "Job <id>", or the job's
    // brief from this session's get of jobs/<id>; the get is required either way, and nothing is retyped.
    job = jobFrom(jsonl, o.job);
    if (!job) throw new Error(jobReadMissing(o.job));
    if (rest.length) throw new Error(`--job ${job.id}: the words come from the job, never retyped`);
    if (rec.tasks.some(t => t.job === job.id)) throw new Error(`job ${job.id} is already filed`);
    const fired = o['from-chat'] ? firedJobWords(jsonl, job.id) : null;
    words = ((fired && fired.words) || job.words).replace(/^\s*(build|bug|idea|request)\s*:\s*/i, '');
    at = o.at || (fired && fired.at) || job.doc.at || null;
    o.source = o.source && o.source !== 'build chat' ? o.source : `E.V. page, job ${job.id}`;
  }
  // D-263: the repository is public, so Matt's words are filed reworded: the lookup above still proves his message,
  // comment or job exists, and --reworded carries his point in clear, neutral words instead of his own.
  let reworded = false;
  if (typeof o.reworded === 'string') {
    if (!words)
      throw new Error(
        '--reworded rewords a message, comment or job it found: give --from-chat, --from-comment or --job'
      );
    words = o.reworded.replace(/\s+/g, ' ').trim();
    reworded = true;
  }
  if (!['bug', 'request'].includes(kind) || !words)
    throw new Error(
      'report <bug|request> "<the words as written>" --source <where> | --from-chat ["<words to find>"] | --from-comment <id> | --job <id>, each with --reworded "<his point>"'
    );
  if (!o.source) throw new Error('report needs --source (the chat, a Board comment, the page)');
  now = at || now;
  const id = nextTaskId(rec);
  const name = words
    .replace(/\s+/g, ' ')
    .slice(0, 70)
    .replace(/\s\S*$/, words.length > 70 ? '…' : '');
  rec.tasks.push({
    id,
    kind,
    title: `${kind === 'bug' ? 'Bug' : 'Request'} (reported ${ctDate(now)}): ${words}`,
    dod: null,
    milestone: 'Inbox',
    status: 'inbox',
    depends: [],
    notes: '',
    commit: null,
    source: o.source,
    words,
    ...(reworded ? { reworded: true } : {}),
    reportedAt: now,
    ...(job ? { job: job.id } : {}),
    board: { row: `v4 ${id}: ${name}` },
  });
  return {
    rec,
    what: `${kind} reported`,
    id,
    reply: o.reply
      ? commentReply(
          rec,
          o.reply,
          `Filed as ${id} (${kind}). It is triaged at the start of the next build session and shows on this Board with what happened to it.`
        )
      : null,
  };
}

// ------------------------------------------------------------------------------------------------ Matt's words
// B-187: a fired builder session receives its text inside a <routine-fire-payload> envelope; the words are what is
// inside it, never the tags.
const stripReminders = t =>
  String(t)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?routine-fire-payload[^>]*>/g, '')
    .trim();
/** What Matt typed in this session, oldest first: his messages, and his own words in answers to a question. */
export function chatMessages(jsonl) {
  const out = [];
  for (const line of jsonl.split('\n')) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || row.type !== 'user' || row.isMeta || !row.message) continue;
    const c = row.message.content;
    if (typeof c === 'string') {
      out.push({ text: stripReminders(c), at: row.timestamp });
      continue;
    }
    if (!Array.isArray(c) || row.sourceToolUseID) continue;
    const texts = c.filter(b => b.type === 'text').map(b => b.text);
    if (texts.length && !c.some(b => b.type === 'tool_result'))
      out.push({ text: stripReminders(texts.join('\n')), at: row.timestamp });
    for (const b of c.filter(b => b.type === 'tool_result')) {
      const t =
        typeof b.content === 'string'
          ? b.content
          : (b.content || [])
              .filter(x => x.type === 'text')
              .map(x => x.text)
              .join('\n');
      for (const m of String(t).matchAll(/"[^"]*"="([^"]*)"/g))
        out.push({ text: m[1], at: row.timestamp, answer: true });
    }
  }
  return out.filter(m => m.text);
}
const MARK = /(?:^|\n)\s*(bug|idea|request)\s*:\s*/i;
/** The words of the newest message that says "bug: ..." / "idea: ..." (or holds --match), exactly as written. */
export function wordsFromChat(jsonl, match) {
  const msgs = chatMessages(jsonl).filter(m =>
    match ? m.text.toLowerCase().includes(String(match).toLowerCase()) : MARK.test(m.text)
  );
  const m = msgs.at(-1);
  if (!m) return null;
  const k = m.text.search(MARK);
  let words = k < 0 ? m.text : m.text.slice(k).replace(MARK, '');
  const para = words.indexOf('\n\n');
  if (para > 0) words = words.slice(0, para);
  if (match && !words.toLowerCase().includes(String(match).toLowerCase()))
    words = m.text.split('\n\n').find(p => p.toLowerCase().includes(String(match).toLowerCase()));
  // Several reports on consecutive lines ("bug: …\nbug: …\nquestion: …"): the match takes only its own line, from its
  // mark, so each is filed on its own (Oct 23: four lines filed as one entry).
  let said = (m.text.match(MARK) || [])[1];
  if (match) {
    const lines = words.split('\n');
    const led = lines.filter(l => /^\s*[a-z]+\s*:\s/i.test(l)).length;
    const own = lines.find(l => l.toLowerCase().includes(String(match).toLowerCase()));
    if (led > 1 && own) {
      const mk = own.match(MARK);
      said = mk ? mk[1] : said;
      words = mk ? own.replace(MARK, '') : own;
    }
  }
  return { words: words.trim(), at: m.at, said };
}
/** The comment threads of the newest comment query on a node in this session: [{id, body, by, self}]. */
export function commentsFrom(jsonl, node) {
  const rs = toolResults(jsonl, '*').filter(
    r =>
      isDocsTool(r.name, 'query') &&
      r.input &&
      r.input.payload &&
      r.input.payload.under &&
      r.input.payload.under.id === node &&
      !r.isError
  );
  const r = rs.at(-1);
  if (!r) return null;
  const t = r.texts.join('');
  const i = t.indexOf('{"verdict"');
  const v = JSON.parse(t.slice(i, t.lastIndexOf('}') + 1));
  const rows = v.rows || [];
  const replies = new Set(
    rows
      .filter(
        x => x.payload && x.payload.value && x.payload.value.parent && x.payload.value.parent.object === 'utterance'
      )
      .map(x => x.payload.value.parent.id)
  );
  return rows
    .filter(
      x =>
        x.payload &&
        x.payload.value &&
        x.payload.value.body &&
        x.payload.value.parent &&
        x.payload.value.parent.object === 'node'
    )
    .map(x => ({
      id: x.id,
      body: x.payload.value.body,
      by: (x.actor && (x.actor.name || x.actor.principal)) || '?',
      self: Boolean(x.actor && x.actor.self),
      replied: replies.has(x.id),
    }));
}
export const commentQuery = rec => ({
  tool: 'mcp__Claude_Docs__query',
  args: {
    object: 'utterance',
    container: { kind: 'project', id: rec.views.doc },
    payload: { under: { object: 'node', id: rec.views.board.node } },
  },
});
export const commentReply = (rec, threadId, body) => ({
  tool: 'mcp__Claude_Docs__create',
  args: {
    object: 'utterance',
    container: { kind: 'project', id: rec.views.doc },
    payload: { value: { body, parent: { object: 'utterance', id: threadId } } },
  },
});
// B-152 (D-176): a quarantined timing check (test/harness/quarantine.json) returns to blocking after N green
// scheduled nightlies in a row since its date. runs: gh run list --json conclusion,createdAt,event. Returns
// [{id, greens, due}] for every quarantined check.
export function quarantineDue(q, runs) {
  const n = q.returnAfterGreenNightlies || 20;
  const nightly = (runs || []).filter(r => r.event === 'schedule').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return Object.entries(q.checks || {}).map(([id, c]) => {
    const since = nightly.filter(r => r.createdAt.slice(0, 10) >= c.since);
    let greens = 0;
    for (let i = since.length - 1; i >= 0 && since[i].conclusion === 'success'; i--) greens++;
    return { id, greens, due: greens >= n };
  });
}

// B-151 (T-1): the nightly check (.github/workflows/nightly.yml) is part of the inbox. A red last run is a report.
export const NIGHTLY_READ = [
  'Nightly: gh run list --workflow nightly.yml --limit 1 --json conclusion,databaseId,createdAt,url',
  '  quarantined timing checks (B-152): gh run list --workflow nightly.yml --limit 60 --json conclusion,createdAt,event > /tmp/ev/nightly.json, then node tools/chart.mjs quarantine --runs /tmp/ev/nightly.json names the ones back to blocking',
  '  red (conclusion "failure"): report bug "<the step that failed, from gh run view <id> --log-failed>" --source "nightly <id>" unless an open task covers it; its screenshots are the run\'s check-shots artifact',
];

/** Session start: the Board comments to file, then the inbox to triage, each as the exact command or call. */
export function inboxPlan(rec, jsonl) {
  const out = { query: null, comments: [], triage: rec.tasks.filter(t => t.status === 'inbox') };
  const comments = jsonl ? commentsFrom(jsonl, rec.views.board.node) : null;
  if (!comments) out.query = commentQuery(rec);
  else
    for (const c of comments)
      if (!rec.tasks.some(t => t.source === `Board comment ${c.id}`) && !c.replied) out.comments.push(c);
  return out;
}
export function formatInbox(plan) {
  const out = [];
  if (plan.query)
    out.push(
      "inbox: read the Board's comments first (the result stays in this session's transcript), then run inbox again:",
      `  ${plan.query.tool}`,
      '  ' + JSON.stringify(plan.query.args)
    );
  for (const c of plan.comments)
    out.push(
      `Board comment ${c.id} by ${c.by}: "${c.body}"`,
      `  file it: node tools/chart.mjs report <bug|request> --from-comment ${c.id}   (its words come from the query, never retyped; it prints the reply)`
    );
  for (const t of plan.triage)
    out.push(
      `${t.id} (${t.kind}, ${t.reportedAt}, from ${t.source}): "${t.words}"`,
      `  triage: node tools/chart.mjs log ${t.id} --triage task --dod "..." --milestone M.. [--depends ...] | --triage join <id> | --triage decline --reason "..."`
    );
  if (!out.length) out.push('inbox: empty; no Board comment waits to be filed');
  else if (!plan.query && (plan.comments.length || plan.triage.length))
    out.push(
      '',
      'Triage comes first: log refuses to start a task while an entry waits in the inbox. A bug that breaks studying is taken before any other open task.'
    );
  out.push('', ...NIGHTLY_READ);
  return out.join('\n');
}

// B-145 (D-177): a record change is one move. Before the change: take origin/main (fetch, rebase, keeping any work in
// progress with --autostash), so the change lands on the newest record; after the commit: push at once. Only with an
// origin and on main; a refused push is printed with the next step, never retried another way.
const firstLine = e =>
  String((e && (e.stderr || e.message)) || e)
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(-1)[0] || '';
const onMainWithOrigin = root => {
  try {
    git(root, ['remote', 'get-url', 'origin']);
    return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim() === 'main';
  } catch {
    return false;
  }
};
export function syncRecord(root) {
  if (!onMainWithOrigin(root)) return 'no origin to take first';
  git(root, ['fetch', '-q', 'origin', 'main']);
  try {
    git(root, ['rebase', '-q', '--autostash', 'origin/main']);
  } catch (e) {
    try {
      git(root, ['rebase', '--abort']);
    } catch {
      /* nothing to abort */
    }
    throw new Error(
      `the record could not take origin/main first (${firstLine(e)}): run git pull --rebase origin main, then the command again`
    );
  }
  return null;
}
export function pushRecord(root, run = builderRun()) {
  if (!onMainWithOrigin(root)) return { pushed: false, why: 'no origin', next: null };
  // B-184 (D-200): a builder run never pushes a change to a guarded path.
  const refused = pushRefusal(root, run);
  if (refused) return { pushed: false, why: refused, next: 'leave the commit for a build chat with Matt present' };
  try {
    git(root, ['push', '-q', 'origin', 'HEAD:main']);
    return { pushed: true };
  } catch (e) {
    return { pushed: false, why: firstLine(e), next: 'git pull --rebase origin main, then git push origin main' };
  }
}
const pushedText = (sha, p) =>
  p.pushed
    ? `; committed ${sha} and pushed`
    : p.next
      ? `; committed ${sha}; the push was refused (${p.why}). Next: ${p.next}`
      : `; committed ${sha} (no origin: nothing pushed)`;

function commitRecord(root, message, trailers) {
  git(root, ['add', 'chart', 'BACKLOG.md', 'DECISIONS.md', 'CHANGELOG.md']);
  const staged = git(root, ['diff', '--cached', '--name-only']).trim();
  if (!staged) return null;
  git(root, ['commit', '-q', '-m', commitMessage(message, trailers)]);
  return git(root, ['rev-parse', '--short=7', 'HEAD']).trim();
}

// ------------------------------------------------------------------------------------------------ ship (B-96)
const tasksHash = tasks =>
  canonical(
    Object.fromEntries(
      Object.entries(tasks || {}).map(([k, t]) => [
        k,
        [t.name, t.schedule, t.promptSha256, t.trigger, t.macBound, t.push, t.folders],
      ])
    )
  );
const pageHash = p => canonical(p ? [p.files, p.capabilities] : null);
/**
 * What this deploy can skip reading, from the deployed system/manifest: its tasks (list_triggers) when the build's
 * tasks equal the deployed ones, its page (the page reads) when the build's page files and capabilities do, each only
 * when the record holds a green deploy of this target at the deployed commit (so what is there was verified).
 */
export function skips({ manifest, target, deployed, rec }) {
  if (!deployed) return { tasks: false, pages: false, from: null };
  const greenAt = rec.deploys.some(
    d => d.target === target && d.verify === 'green' && String(deployed.commit).startsWith(d.commit)
  );
  const tasks = m =>
    Object.fromEntries(
      Object.entries(m.tasks || {}).filter(
        ([k, t]) => t.record === target || (target === 'staging' && k.startsWith('build.'))
      )
    );
  return {
    tasks: greenAt && tasksHash(tasks(deployed)) === tasksHash(tasks(manifest)),
    pages: greenAt && pageHash(deployed.pages && deployed.pages[target]) === pageHash(manifest.pages[target]),
    from: String(deployed.commit).slice(0, 7),
  };
}
/** Which part of a deploy a read or call (by its tool) or a verify line (by its what) is about: 'tasks' or 'pages'. */
const PARTS = [
  ['tasks', /trigger/, /^(task |scheduled tasks read|retired tasks)/],
  ['pages', /^Artifact$/, /^(\w+ page read|page stamp|published page files|page capability declaration)/],
];
const partOf = x =>
  (PARTS.find(([, tool, what]) => (x.tool !== undefined ? tool : what).test(x.tool ?? x.what)) || [])[0];
/**
 * The deploy checklist as one pure step: the refusals; else the reads still to make; else, when verify is green, the
 * deploy to record; else deploy's calls (minus the task and page calls the skips make needless).
 */
export function shipStep({ target, manifest, state, verifyResult, reads, deploy, rec, refusals, skip, stale }) {
  if (refusals.length) return { kind: 'refused', refusals };
  const deployedRead = state.record && state.record.manifest;
  const need = reads.filter(r => !partOf(r) || (deployedRead && !skip[partOf(r)]));
  const missing = need.filter(r => !r.have);
  // After the calls, only what they changed is read again: a deploy with no task or page call leaves those reads true.
  const changed = r => !partOf(r) || stale[partOf(r)];
  if (stale)
    return {
      kind: 'reads',
      reads: need.filter(changed),
      why: 'the saved state predates the calls ship printed: read what they changed again',
    };
  if (missing.length)
    return {
      kind: 'reads',
      reads: missing,
      why: deployedRead ? null : 'the deployed system documents first: they say which other reads this deploy needs',
    };
  const why = what =>
    `not read: the build's ${what} equal the deployed manifest's (${skip.from}, green when deployed), so this deploy changes none`;
  const lines = verifyResult.lines.map(l =>
    !l.ok && skip[partOf(l)] ? { ...l, ok: true, detail: why(partOf(l) === 'tasks' ? 'tasks' : 'page files') } : l
  );
  if (lines.every(l => l.ok))
    return {
      kind: 'verified',
      lines,
      recorded: rec.deploys.some(d => d.target === target && d.commit === manifest.commit.slice(0, 7) && !d.line),
    };
  if (!deploy.ok) return { kind: 'refused', refusals: deploy.refusals, lines };
  const calls = deploy.calls.filter(c => !skip[partOf(c)]);
  return {
    kind: 'deploy',
    lines,
    calls,
    skipped: [
      ...(deploy.skipped || []).filter(x => !(skip.tasks && /^\w+\.\w+(-\w+)?: /.test(x))),
      ...(skip.tasks ? [why('tasks').replace('not read: ', 'no task call: ')] : []),
      ...(skip.pages ? [why('page files').replace('not read: ', 'no page publish: ')] : []),
    ],
  };
}
/** This session's ArtifactData reads that succeeded and whose input passes `match`, oldest first. */
const dataReads = (jsonl, match) =>
  toolResults(jsonl || '', 'ArtifactData').filter(r => !r.isError && match(r.input || {}));
/** A get's version: n, 0 when the document is absent (B-178: so it is created), undefined when the text names neither. */
const versionIn = r => {
  const text = r.texts.join('\n');
  const m = text.match(/\bversion\D{0,4}(\d+)/i);
  return m ? Number(m[1]) : /^No document /.test(text.trim()) ? 0 : undefined;
};
/** The record's versions of the system documents, from this session's ArtifactData gets of them. */
export function versionsFrom(jsonl, url) {
  const out = {};
  const ids = [...SYSTEM_IDS, 'yourturn'];
  for (const r of dataReads(
    jsonl,
    i => i.action === 'get' && i.collection === 'system' && i.url === url && ids.includes(i.doc_id)
  )) {
    const v = versionIn(r);
    if (v !== undefined) out[r.input.doc_id] = v;
  }
  return out;
}
/** B-178: a document's version from this session's newest ArtifactData get of it: n, 0 when absent, null unread. */
export function docVersionFrom(jsonl, url, collection, id) {
  let out = null;
  for (const r of dataReads(
    jsonl,
    i => i.action === 'get' && i.collection === collection && i.doc_id === id && i.url === url
  )) {
    const v = versionIn(r);
    if (v !== undefined) out = v;
  }
  return out;
}
/** The newest get of collection/id: {url, doc} with the document from the file it saved (doc null when none), or null. */
function savedGet(jsonl, collection, id) {
  const r = dataReads(jsonl, i => i.action === 'get' && i.collection === collection && i.doc_id === id).at(-1);
  if (!r) return null;
  const file = (r.texts.join('\n').match(/"(\/[^"]+\.json)"/) || [])[1];
  let doc = null;
  try {
    doc = file ? readJson(file) : null;
  } catch {
    doc = null;
  }
  return { url: r.input.url, doc };
}
/**
 * B-179 (D-194): a builder job from this session's newest ArtifactData get of jobs/<id> (either record): the document
 * from the file the get saved, and its words (the brief, as Matt typed it). null when no get of it was made or saved.
 */
export function jobFrom(jsonl, id) {
  const g = savedGet(jsonl, 'jobs', id);
  const doc = g && g.doc;
  return doc && typeof doc.brief === 'string' && doc.brief.trim()
    ? { id, url: g.url, doc, words: doc.brief.trim() }
    : null;
}
const jobReadMissing = id =>
  `no read of job ${id} in this session: make ArtifactData {"action":"get","url":"<the record the job is in>","collection":"jobs","doc_id":"${id}"} first`;
/** B-179: the words of the message a builder run was fired with, the lines after "Job <id>" (null when none). */
export function firedJobWords(jsonl, id) {
  const first = t => t.trimStart().split('\n')[0].trim();
  const m = chatMessages(jsonl || '')
    .filter(x => first(x.text) === `Job ${id}`)
    .at(-1);
  if (!m) return null;
  const words = m.text.trimStart().split('\n').slice(1).join('\n').trim();
  return words ? { words, at: m.at } : null;
}
/** The tasks a range of commits did, oldest first: each subject's leading id ("B-07: ..."), not every id it mentions
 * (a hand-off commit names the ids it filed, "D-146 to D-165, B-111 to B-126: plan ..."). */
/**
 * The tasks a deploy ships: each product commit's own task, oldest first. B-144 (W-2): a record commit (its subject
 * ends "(chart)") or a commit that touched only bookkeeping (tools/build.mjs BOOKKEEPING) ships nothing, so it credits
 * nothing. Takes the subjects as text (one per line) or [{subject, files}].
 */
export function commitTasks(commits) {
  const list = Array.isArray(commits)
    ? commits
    : String(commits)
        .split('\n')
        .map(subject => ({ subject }));
  return [
    ...new Set(
      list
        .filter(c => !/\(chart\)\s*$/.test(c.subject))
        .filter(c => !c.files || !c.files.length || !c.files.every(f => BOOKKEEPING.some(re => re.test(f))))
        .map(c => (c.subject.match(/^(B-\d{2,3})\b/) || [])[1])
        .filter(Boolean)
    ),
  ].reverse();
}
/** The commits in a range, newest first, with their subjects and the files each touched. */
export function commitsIn(root, range) {
  return git(root, ['log', '--name-only', '--format=%x00%s', range])
    .split('\0')
    .filter(Boolean)
    .map(block => {
      const [subject, ...files] = block.split('\n');
      return { subject, files: files.filter(Boolean) };
    });
}
// ------------------------------------------------------------------------------------------------ ship it (B-185)
// D-198: R-04's second form. Matt's Ship it tap writes a ship job naming one commit; a builder run deploys live on it
// with ship live --from-job <id>, which holds the job, as fetched in this session, to exactly that: kind ship, writer
// page, the build's own commit, no result yet (one shot) and under SHIP_JOB_HOURS old. Rollback stays a build chat's act.
export const SHIP_JOB_HOURS = 24;
/** The newest fetch of jobs/<id> in the transcript: the document as saved, or null. */
export function shipJobFrom(jsonl, id) {
  const g = savedGet(jsonl, 'jobs', id);
  return g && g.doc;
}
/** Whether this session read jobresults/<id>: 'none' (no such document), 'exists', or null (not read). */
export function jobResultSeen(jsonl, id) {
  let out = null;
  for (const r of toolResults(jsonl || '', 'ArtifactData')) {
    const i = r.input || {};
    if (i.action !== 'get' || i.collection !== 'jobresults' || i.doc_id !== id) continue;
    const t = r.texts.join('\n');
    out =
      /"(\/[^"]+\.json)"/.test(t) && !r.isError
        ? 'exists'
        : /not found|no (such )?document|does not exist|0 documents/i.test(t)
          ? 'none'
          : out;
  }
  return out;
}
/** The reasons a ship job does not carry Matt's OK for this commit (empty when it does). */
export function shipJobRefusals({ id, job, result, commit, now = Date.now() }) {
  const why = [];
  const r = s => why.push(`R-04 (D-198): ship job ${id} ${s}`);
  if (!job) return [`R-04 (D-198): no fetch of jobs/${id} in this session: ArtifactData get it first`];
  if (job.kind !== 'ship') r(`is a ${job.kind || 'kindless'} job, not a ship job`);
  if (job.writer !== 'page') r(`was written by ${job.writer || 'no one'}, not his page`);
  const c = String(job.commit || '');
  if (!/^[0-9a-f]{7,40}$/.test(c) || !String(commit).startsWith(c))
    r(`names ${c ? c.slice(0, 7) : 'no commit'}, not this build's ${String(commit).slice(0, 7)}`);
  if (result === 'exists') r('has a result already: one tap is one deploy');
  if (result == null) r(`has no jobresults read in this session: ArtifactData get jobresults/${id} first`);
  const age = now - Date.parse(job.at || '');
  if (!(age >= 0) || age > SHIP_JOB_HOURS * 3600e3)
    r(
      `is ${Number.isFinite(age) ? Math.round(age / 3600e3) + ' hours' : 'of no known'} old; a ship job holds ${SHIP_JOB_HOURS} hours`
    );
  return why;
}

/**
 * R-06 (D-226, B-219): null when the full check passed at this commit, here (dist/check-full.json) or as a green
 * nightly run on GitHub (read through gh, when it answers); else the refusal, with the two ways to get one.
 */
export function fullCheckRefusal(root, commit, runs = null) {
  const file = path.join(root, 'dist', 'check-full.json');
  const here = fs.existsSync(file) ? readJson(file) : null;
  if (here && here.commit === commit) return null;
  let list = runs;
  if (!list)
    try {
      list = JSON.parse(
        execFileSync(
          'gh',
          ['run', 'list', '--workflow', 'nightly.yml', '--limit', '30', '--json', 'headSha,conclusion,databaseId'],
          { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }
        )
      );
    } catch {
      list = [];
    }
  if (list.some(r => r.headSha === commit && r.conclusion === 'success')) return null;
  return `R-06 (D-226): live takes only a commit the full check passed; ${commit.slice(0, 7)} has none${here ? ` (the last full check here was at ${String(here.commit).slice(0, 7)})` : ''}. Run npm run check in the background (about 30 min), or gh workflow run nightly.yml --ref main and wait for it green, then ship live again`;
}

async function ship(o) {
  const root = rootOf(o),
    target = o._[1];
  if (!['staging', 'live'].includes(target)) throw new Error('ship <staging|live>');
  const rec = loadChart(root),
    refusals = [];
  let shipJobOk = null;
  const red = lintChart(rec).filter(f => f.level === 'error');
  if (red.length) refusals.push(`the Chart lints red (${red.length}): node tools/chart.mjs lint`);
  const dist = path.join(root, 'dist'),
    stateDir = path.join(dist, 'state', target);
  const { manifest } = await build({ root, out: dist });
  const read = f => readJson(path.join(dist, 'system', f + '.json'));
  const distDocs = { spec: read('spec'), environments: read('environments') };
  let pushed = false;
  try {
    git(root, ['merge-base', '--is-ancestor', manifest.commit, 'origin/main']);
    pushed = true;
  } catch {
    /* not pushed */
  }
  const state = withShell(readState(stateDir), manifest, target, dist);
  const deployed = state.record && state.record.manifest;
  if (target === 'live') {
    // R-04 (D-083): Matt's explicit OK.
    // R-04 in its second form (D-198, B-185): a ship job he wrote for this commit, as fetched in this session, checked
    // here and by the ship-live row; it stands in for his words in the chat.
    const fromJob = typeof o['from-job'] === 'string' ? o['from-job'] : null;
    if (fromJob) {
      const jl = transcriptOf(o);
      const job = shipJobFrom(jl, fromJob);
      const why = shipJobRefusals({ id: fromJob, job, result: jobResultSeen(jl, fromJob), commit: manifest.commit });
      if (!why.length) {
        const spec = readSpec(root);
        const a = ACTIONS.actor(spec, 'builder')('ship-live', { job: fromJob, commit: job.commit }, { ok: { job } });
        if (!a.ok) why.push(a.refused);
      }
      refusals.push(...why);
      shipJobOk = why.length ? null : fromJob;
    } else if (!o['matt-ok'])
      refusals.push("R-04 (D-083): a live deploy needs Matt's explicit OK in the chat (then pass --matt-ok)");
    // R-06 (D-226, B-219): the touched check is for working; live takes a commit the full check passed: a full GREEN
    // here (dist/check-full.json, which check writes for the build's commit) or a green nightly at it.
    if (rec.rules.some(r => r.check === 'fullCheck' && !r.ended)) {
      const why = fullCheckRefusal(root, manifest.commit);
      if (why) refusals.push(why);
    }
    // B-149 (D-173): what goes live is a tagged release. With every other gate passed and the commit untagged, ship
    // tags it here (pushed once live is recorded); the tag renames the build, so staging carries it first.
    if (!refusals.length) {
      const spec = readSpec(root);
      try {
        const at = tagAt(root, manifest.commit);
        if (!at) {
          const tag = nextTag(root, { specVersion: spec.specVersion, minor: !!o.minor });
          git(root, ['tag', '-a', tag, manifest.commit, '-m', `E.V. ${tag} (ship live, D-173)`]);
          refusals.push(
            `B-149 (D-173): tagged ${tag} at ${manifest.commit.slice(0, 7)} here (pushed once live is recorded). The release is now ${tag}, so staging must carry it: ship staging, then ship live again`
          );
        }
      } catch (e) {
        refusals.push(`B-149 (D-173): ${e.message}`);
      }
    }
  }
  const shipFile = path.join(dist, `ship-${target}.json`),
    last = readJsonIf(shipFile);
  // Once the calls ship printed are made, the deployed manifest is this build's own: keep the skips it printed them on.
  const skip =
    deployed && last && last.skip && deployed.commit === manifest.commit && last.commit === manifest.commit
      ? last.skip
      : skips({ manifest, target, deployed, rec });
  const have = p => (p.endsWith('/') ? fs.existsSync(p) && fs.readdirSync(p).length > 0 : fs.existsSync(p));
  const reads = verifyReads({ manifest, target, stateDir }).map(r => ({ ...r, have: have(r.save) }));
  const savedAt = f => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);
  const stale =
    last &&
    last.commit === manifest.commit &&
    savedAt(path.join(stateDir, 'record', 'system', 'manifest.json')) < last.at
      ? { tasks: last.touched ? last.touched.tasks : true, pages: last.touched ? last.touched.pages : true }
      : null;
  const buildInfo = {
    pushed,
    behind: c => commitsBehind(root, c, manifest.commit),
    behindMain: c => commitsBehind(root, c, mainHead(root)),
    contentHash: contentHash(manifest, distDocs.spec, sha256),
  };
  const verifyResult = verify({ manifest, target, state, build: buildInfo, dist: distDocs, sha256 });
  const file = o.transcript || newestTranscript(),
    jsonl = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const recordUrl = artifactUrl(manifest.records[target].artifact);
  const versions = {
    ...versionsFrom(jsonl, recordUrl),
    ...(o.version
      ? Object.fromEntries(
          list(o.version)
            .map(kv => kv.split('='))
            .map(([k, v]) => [k, Number(v)])
        )
      : {}),
  };
  const stagingVerify = readJsonIf(path.join(dist, 'verify-staging.json'));
  // B-178 (D-196): the Chart's Your turn as of this ship, written beside the system documents.
  const yourturnFile = path.join(dist, 'system', 'yourturn.json');
  fs.mkdirSync(path.dirname(yourturnFile), { recursive: true });
  fs.writeFileSync(
    yourturnFile,
    JSON.stringify(
      yourTurnDoc(loadChart(root), {
        at: new Date().toISOString(),
        commit: manifest.commit.slice(0, 7),
        source: `ship ${target}`,
      }),
      null,
      1
    )
  );
  const yourturnWrite = { op: 'set', collection: 'system', doc_id: 'yourturn', file_path: yourturnFile };
  if (versions.yourturn) yourturnWrite.if_version = versions.yourturn;
  const deploy = deployCalls({
    builder: Boolean(builderRun()), // B-184 (D-200)
    extraWrites: [yourturnWrite],
    manifest,
    target,
    distDir: dist,
    build: buildInfo,
    versions,
    mattOk: Boolean(o['matt-ok'] || shipJobOk),
    duringSession: Boolean(o['during-session']),
    state,
    sha256,
    stagingVerify,
    stateDir,
  });
  const step = shipStep({ target, manifest, state, verifyResult, reads, deploy, rec, refusals, skip, stale });
  const head = `ship ${target}: ${manifest.release} at ${manifest.commit.slice(0, 7)}`;
  if (step.kind === 'refused') {
    console.log([`${head}: REFUSED`, ...step.refusals.map(r => '  ' + r)].join('\n'));
    return 1;
  }
  if (step.kind === 'reads') {
    console.log(
      [
        `${head}: ${step.reads.length} read${step.reads.length === 1 ? '' : 's'} to make${step.why ? ` (${step.why})` : ''}, then run ship ${target} again:`,
        ...step.reads.flatMap(r => [
          `  ${r.tool} ${JSON.stringify(r.args)}`,
          `    -> ${r.save}${r.note ? '  (' + r.note + ')' : ''}`,
        ]),
        ...(skip.tasks
          ? [`  not needed: list_triggers (the build's tasks equal the deployed manifest's, ${skip.from})`]
          : []),
        ...(skip.pages
          ? [`  not needed: the page reads (the build's page files equal the deployed manifest's, ${skip.from})`]
          : []),
      ].join('\n')
    );
    return 1;
  }
  if (step.kind === 'deploy') {
    if (!('yourturn' in versions)) {
      console.log(
        `${head}: read system/yourturn first, so its write carries its version (or creates it):\n  ArtifactData ${JSON.stringify({ action: 'get', url: recordUrl, collection: 'system', doc_id: 'yourturn', out_dir: path.join(stateDir, 'record') })}\n  then run ship ${target} again (or pass --version yourturn=<n>, 0 when it does not exist yet).`
      );
      return 1;
    }
    const missingV = SYSTEM_IDS.filter(id => state.record && state.record[id] && !versions[id]);
    if (missingV.length) {
      console.log(
        `${head}: the versions of ${missingV.join(', ')} are not in this session's ArtifactData replies: pass --version ${missingV.map(id => id + '=<n>').join(',')}`
      );
      return 1;
    }
    const touched = {
      tasks: step.calls.some(c => partOf(c) === 'tasks'),
      pages: step.calls.some(c => partOf(c) === 'pages'),
    };
    // B-58: ship live prints these calls only on Matt's OK (R-04), so the live-write guard lets them through for a while.
    if (target === 'live')
      fs.writeFileSync(
        path.join(dist, 'live-ok'),
        JSON.stringify({
          at: Date.now(),
          commit: manifest.commit,
          by: shipJobOk ? `ship live --from-job ${shipJobOk}` : 'ship live --matt-ok',
          ...(shipJobOk ? { job: shipJobOk } : {}),
        })
      );
    fs.writeFileSync(
      shipFile,
      JSON.stringify({
        commit: manifest.commit,
        at: Date.now(),
        skip,
        touched,
      })
    );
    console.log(
      formatDeploy(target, { ...deploy, calls: step.calls, skipped: step.skipped })
        .replace(`deploy ${target}:`, `${head}:`)
        .replace(`then run verify-deploy ${target}.`, `then make the reads below again and run ship ${target}.`)
    );
    const again = reads.filter(r => !partOf(r) || touched[partOf(r)]);
    console.log(
      [
        '',
        'Reads after the calls (only what they change):',
        ...again.map(r => `  ${r.tool} ${JSON.stringify(r.args)}`),
        // B-178: system/yourturn's new version, for the next ship's write and the builder's trace
        `  ArtifactData ${JSON.stringify({ action: 'get', url: recordUrl, collection: 'system', doc_id: 'yourturn', out_dir: path.join(stateDir, 'record') })}`,
      ].join('\n')
    );
    return 0;
  }
  // verified: the gate file deploy live reads (B-35), then the deploy in the record.
  fs.writeFileSync(
    path.join(dist, `verify-${target}.json`),
    JSON.stringify(
      {
        target,
        release: manifest.release,
        commit: manifest.commit,
        contentHash: buildInfo.contentHash,
        green: true,
        lines: step.lines,
        by: 'ship',
      },
      null,
      1
    )
  );
  console.log(
    [
      `${head}: GREEN`,
      ...step.lines.map(l => `  ${l.ok ? 'ok ' : 'NO '} ${l.what}${l.detail ? ': ' + l.detail : ''}`),
    ].join('\n')
  );
  return recordShip(root, o, { target, manifest, recorded: step.recorded });
}
/** B-149: the v4.* tag at a commit, or null. */
export function tagAt(root, commit) {
  return git(root, ['tag', '--points-at', commit, '--list', 'v4.*']).split('\n').filter(Boolean).sort().at(-1) || null;
}
/**
 * B-149 (D-173): the tag the next live deploy takes. A patch is v<major.minor>.<n+1> on the newest tag of the spec's
 * major.minor; a minor (--minor) is v<major.minor>.0 when that minor has no tag yet. The spec's specVersion names the
 * major.minor being shipped.
 */
export function nextTag(root, { specVersion, minor = false }) {
  const [M, m] = String(specVersion).split('.').map(Number);
  const tags = git(root, ['tag', '--list', 'v4.*'])
    .split('\n')
    .map(t => /^v(\d+)\.(\d+)\.(\d+)$/.exec(t.trim()))
    .filter(Boolean)
    .map(x => x.slice(1).map(Number));
  const same = tags.filter(([a, b]) => a === M && b === m);
  if (minor) {
    if (same.length) throw new Error(`v${M}.${m} is tagged already: a minor needs the next specVersion (D-173)`);
    return `v${M}.${m}.0`;
  }
  if (!same.length)
    throw new Error(`no v${M}.${m} tag yet: this live deploy is the minor (ship live --matt-ok --minor)`);
  return `v${M}.${m}.${Math.max(...same.map(t => t[2])) + 1}`;
}
/** B-149: pushes the tag a live deploy carries; a refused push is made by tags.yml from the recorded release (B-175). */
export function pushTag(root, tag) {
  try {
    git(root, ['push', '-q', 'origin', `refs/tags/${tag}`]);
    return { pushed: true, line: `tag ${tag} pushed to origin` };
  } catch (e) {
    return {
      pushed: false,
      line: `the tag push was refused (${firstLine(e)}): tags.yml makes ${tag} on origin from this deploy's release`,
    };
  }
}

/**
 * The record half of a green ship: the deploy (once), and with --done B-nn[,B-mm] those tasks done at --commit (the
 * task's own commit; default the deployed one) in the same command (B-147, W-6). Exported for its test.
 */
export function recordShip(root, o, { target, manifest, recorded = false }) {
  const short = manifest.commit.slice(0, 7);
  const tag = target === 'live' ? tagAt(root, manifest.commit) : null;
  // B-175: the deploy records its release, so a refused push is made on origin by tags.yml.
  if (tag) console.log(pushTag(root, tag).line);
  if (typeof o.done === 'string')
    for (const id of list(o.done))
      record(
        {
          _: ['log', id],
          status: 'done',
          commit: typeof o.commit === 'string' ? o.commit : short,
          note: typeof o.note === 'string' ? o.note : `Shipped to ${target} at ${short}: ship ${target} GREEN.`,
          trailer: o.trailer || [],
          'no-commit': o['no-commit'],
          root: o.root,
          transcript: o.transcript,
        },
        applyLog
      );
  const rec = loadChart(root);
  if (recorded || rec.deploys.some(d => d.target === target && d.commit === short)) {
    console.log(`the ${target} deploy at ${short} is in the record`);
    return 0;
  }
  const prev = rec.deploys.filter(d => d.target === target).at(-1);
  let tasks = list(o.tasks);
  if (!tasks.length && prev) {
    try {
      tasks = commitTasks(commitsIn(root, `${prev.commit}..${manifest.commit}`));
    } catch {
      /* history too shallow */
    }
  }
  const names = tasks
    .map(id => rec.tasks.find(t => t.id === id) || {})
    .filter(t => t.id)
    .map(t => boardName(t).replace(/^v4 B-\d+: /, ''));
  return record(
    {
      _: ['log', 'deploy'],
      target,
      commit: manifest.commit,
      verify: 'green',
      ok: target === 'live' ? 'Matt' : undefined,
      release: tag || undefined,
      tasks: tasks.join(','),
      from: prev && prev.commit,
      summary: o.summary || names.join('; ') || null,
      why: o.why || null,
      decisions: o.decisions || null,
      trailer: o.trailer || [],
      'no-commit': o['no-commit'],
      root: o.root,
      transcript: o.transcript,
    },
    applyLog
  );
}

// ------------------------------------------------------------------------------------------------ trace (B-178)
export const TRACE_OK_MINUTES = 10;
/**
 * B-178 (D-195, D-203): the builder's trace, the trace action's writes as calls: its job's result, one talk line as
 * E.V. with the job card, and system/yourturn. Composed and checked by core/actions.mjs act with the builder's actor
 * (the caller is this command's, never the call's), printed as one ArtifactData call each, and named in
 * dist/trace-ok, which the live-guard reads (tools/hooks.mjs): a live write it names passes for ten minutes.
 * Returns {reads} when a document's version is unknown, else {calls, traceOk}.
 */
export function traceCalls(root, o, { jsonl = '', now = new Date().toISOString() } = {}) {
  const spec = readSpec(root);
  const record = o.record || 'staging';
  if (!['staging', 'live'].includes(record)) throw new Error('trace --record staging|live');
  const art = spec.registry.records[record] && spec.registry.records[record].artifact;
  if (!art) throw new Error(`no ${record} record in spec.registry.records`);
  const url = `https://claude.ai/artifact/${art}`;
  if (typeof o.job !== 'string') throw new Error('trace --job <id> --status done|failed --note "<one line>"');
  if (!['done', 'failed'].includes(o.status)) throw new Error('trace --status done|failed');
  // B-183: a design job's trace carries the kickoff (built here from this session's reads, never typed), a plan job's
  // its line from what the record now holds from that doc; either stands in for --note.
  let kickoff = null;
  const job = o.kickoff || o.filed === true ? jobFrom(jsonl, o.job) : null;
  if ((o.kickoff || o.filed === true) && !job) throw new Error(jobReadMissing(o.job));
  if (o.kickoff) {
    // The theme is the job's own brief, as fetched ("design" alone asks for the next theme).
    const theme = job.words === 'the next theme' ? null : job.words;
    const k = kickoffFrom(root, jsonl, { theme, now });
    if (k.missing.length) throw new Error(`trace --kickoff: read ${k.missing.join(' and ')} in this session first`);
    kickoff = k.text;
    if (typeof o.note !== 'string') o = { ...o, note: 'Your design kickoff is ready: copy it into a new design chat.' };
  }
  if (o.filed === true) {
    const docId = docIdOf(job.words); // the doc link is the plan job's brief, as fetched
    if (typeof o.note !== 'string') o = { ...o, note: planTraceText(filedFrom(loadChart(root), docId), docId) };
  }
  if (typeof o.note !== 'string' || !o.note.trim()) throw new Error('trace --note "<one line>"');
  const date = EVCORE.chicagoDate(now);
  const given = o.version
    ? Object.fromEntries(
        list(o.version)
          .map(kv => kv.split('='))
          .map(([k, v]) => [k, Number(v)])
      )
    : {};
  const ver = {
    talk: 'talk' in given ? given.talk : docVersionFrom(jsonl, url, 'talk', date),
    yourturn: 'yourturn' in given ? given.yourturn : docVersionFrom(jsonl, url, 'system', 'yourturn'),
  };
  const outDir = path.join(root, 'dist', 'state', record, 'record');
  const reads = [
    ver.talk == null && { action: 'get', url, collection: 'talk', doc_id: date, out_dir: outDir },
    ver.yourturn == null && { action: 'get', url, collection: 'system', doc_id: 'yourturn', out_dir: outDir },
  ].filter(Boolean);
  if (reads.length) return { reads };
  let release = typeof o.release === 'string' ? o.release : null;
  if (!release)
    try {
      release = readJson(path.join(outDir, 'system', 'manifest.json')).release;
    } catch {
      throw new Error(`pass --release, or read the ${record} record's system/manifest first`);
    }
  const commit = git(root, ['rev-parse', '--short=7', 'HEAD']).trim();
  const args = {
    job: o.job,
    status: o.status,
    text: o.note.trim().slice(0, 1500),
    ...(kickoff ? { kickoff } : {}),
    date,
    talkExists: ver.talk > 0,
    release,
    ...(typeof o.task === 'string' ? { task: o.task } : {}),
    ...(typeof o.commit === 'string' ? { commit: String(o.commit).slice(0, 7) } : {}),
    schemas: {
      jobresults: currentVersion('jobresults'),
      talk: currentVersion('talk'),
      system: currentVersion('system'),
    },
    yourturn: { commit, groups: yourTurnDoc(loadChart(root), { at: now, commit, source: 'trace' }).groups },
  };
  const r = ACTIONS.actor(spec, 'builder')('trace', args, { now });
  if (!r.ok) throw new Error(r.refused);
  const dir = path.join(root, 'dist', 'trace');
  fs.mkdirSync(dir, { recursive: true });
  const calls = r.writes.map((w, i) => {
    const file = path.join(dir, `${i + 1}-${w.collection}-${w.id}.json`);
    fs.writeFileSync(file, JSON.stringify(w.data, null, 1));
    const v = w.collection === 'talk' ? ver.talk : w.collection === 'system' ? ver.yourturn : 0;
    return {
      action: w.op,
      url,
      collection: w.collection,
      doc_id: w.id,
      file_path: file,
      ...(v > 0 ? { if_version: v } : {}),
    };
  });
  const traceOk = {
    at: Date.parse(now),
    record,
    url,
    job: o.job,
    calls: calls.map(c => ({ action: c.action, collection: c.collection, doc_id: c.doc_id })),
  };
  fs.writeFileSync(path.join(root, 'dist', 'trace-ok'), JSON.stringify(traceOk));
  return { calls, traceOk };
}
function trace(o) {
  const root = rootOf(o),
    jsonl = transcriptOf(o);
  const t = traceCalls(root, o, { jsonl });
  if (t.reads) {
    console.log(
      [
        `trace ${o.job}: ${t.reads.length} read${t.reads.length > 1 ? 's' : ''} first (the versions its writes carry), then trace again:`,
        ...t.reads.map(r => `  ArtifactData ${JSON.stringify(r)}`),
      ].join('\n')
    );
    return 1;
  }
  console.log(
    [
      `trace ${o.job}: ${t.calls.length} calls, in order (dist/trace-ok names them for ${TRACE_OK_MINUTES} minutes):`,
      ...t.calls.map((c, i) => `${i + 1}. ArtifactData\n${JSON.stringify(c, null, 1)}`),
    ].join('\n')
  );
  return 0;
}

// ------------------------------------------------------------------------------------------------ kickoff (B-183)
// D-197: the design kickoff is a draft E.V. hands Matt as text with a Copy chip. It is assembled from what this session
// read (the north star's tab, the latest weeks insights, never retyped), the Chart and tools/kickoff.md, at most
// KICKOFF_MAX characters. It reads the north star only to draft and files nothing from it.
export const NORTH_STAR = 'https://claude.ai/artifact/4SJmAvp26TbGAXFUwfGqcd';
export const CHART_DESIGN = 'https://claude.ai/artifact/8DVSMh5WdybjeHVV5m2uQT';
export const KICKOFF_MAX = 4000;
/** The newest Docs read in the transcript of a tab of the doc docId: {rev, xml}, or null. */
export function docTabRead(jsonl, docId) {
  // A whole tab: a view of one block (parent=) or a search is not the page.
  return newestDocsRead(
    jsonl,
    docId,
    (b, i) =>
      i.ref &&
      i.ref.object === 'node' &&
      !/^<doc\b[^>]*\bparent='/.test(b.xml) &&
      !(i.payload && i.payload.kind === 'search')
  );
}
/** The newest Docs read of the doc docId whose body passes accept(body, input): {rev, xml}, or null. */
function newestDocsRead(jsonl, docId, accept) {
  const rs = toolResults(jsonl || '', '*').filter(
    r =>
      isDocsTool(r.name, 'read') &&
      !r.isError &&
      r.input &&
      r.input.container &&
      docIdOf(r.input.container.id) === docId
  );
  for (const r of rs.reverse()) {
    const b = readBody(r.texts);
    if (b && b.xml && accept(b, r.input)) return b;
  }
  return null;
}
const xmlWords = x =>
  ent(String(x || '').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
/** The north star as read: its six workflows (name, where it stands) and its "When v5 may start" line. */
export function northStarFrom(read) {
  if (!read || !read.xml) return null;
  const rows = tableUnder(read.xml, 'The six workflows') || [];
  const workflows = rows
    .slice(1)
    .filter(r => r.length >= 4 && r[1])
    .map(r => ({ n: r[0], name: r[1], stands: r[3] }));
  const para = [...read.xml.matchAll(/<paragraph\b[^>]*>([\s\S]*?)<\/paragraph>/g)]
    .map(m => xmlWords(m[1]))
    .find(t => /^When v5 may start\./.test(t));
  return { workflows, v5: para || null };
}
/** The newest weeks document this session fetched (a get, list or query with out_dir): {date, insights} or null. */
export function weekFrom(jsonl) {
  let best = null;
  for (const r of dataReads(jsonl, i => i.collection === 'weeks' && ['get', 'list', 'query'].includes(i.action))) {
    for (const m of r.texts.join('\n').matchAll(/"(\/[^"]+\/weeks\/([^"/]+)\.json)"/g)) {
      let doc = null;
      try {
        doc = readJson(m[1]);
      } catch {
        doc = null;
      }
      if (doc && (!best || m[2] > best.date)) best = { date: m[2], insights: doc.insights || null };
    }
  }
  return best;
}
/** The decisions filed after the last design hand-off: numbered above the newest decision a plan filed. */
export function decisionsSincePlan(rec) {
  const num = id => Number(String(id).slice(2));
  const planned = rec.decisions.filter(d => /^plan /.test(d.source || '')).map(d => num(d.id));
  const floor = planned.length ? Math.max(...planned) : 0;
  return rec.decisions.filter(d => num(d.id) > floor).sort((a, b) => num(a.id) - num(b.id));
}
/** What the record holds from one design doc's hand-off, in planTraceText's shape. */
export function filedFrom(rec, docId) {
  const src = `plan ${docId}`;
  const num = id => Number(String(id).slice(2));
  const by = (a, b) => num(a.id) - num(b.id);
  return {
    decisions: rec.decisions.filter(d => d.source === src || String(d.source || '').startsWith(src + ' ')).sort(by),
    tasks: rec.tasks.filter(t => t.source === src).sort(by),
    skipped: [],
  };
}
const shortTitle = (t, n = 60) => {
  const s = String(t || '')
    .replace(/^(?:Bug|Request) \(reported [^)]*\): /, '')
    .split(/ \(|: /)[0]
    .trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
};
/**
 * The kickoff text from the Chart and the reads: {text, length, missing}. Lists shorten to fit KICKOFF_MAX, the longest
 * first; a read this session did not make says so in its slot (missing names it), never a guess.
 */
export function kickoffText(
  rec,
  { ns = null, week = null, theme = null, template, now = new Date().toISOString() } = {}
) {
  if (!template) throw new Error('kickoff: no template (tools/kickoff.md)');
  const missing = [];
  const live = [...rec.deploys].reverse().find(d => d.target === 'live');
  const by = s => rec.tasks.filter(t => t.status === s);
  const open = by('open'),
    blocked = by('blocked'),
    going = by('in progress');
  const list = (ts, n) =>
    ts
      .slice(0, n)
      .map(t => `${t.id} ${shortTitle(t.title)}`)
      .join('; ') + (ts.length > n ? '; …' : '');
  const yt = yourTurnDoc(rec, { at: now, commit: 'kickoff', source: 'kickoff' }).groups.flatMap(g => g.tasks);
  const decided = decisionsSincePlan(rec);
  const ins = week && week.insights;
  const fill = n => {
    const slots = {
      live: live ? `${live.release || '?'} at ${live.commit}` : 'not deployed yet',
      northStar: NORTH_STAR,
      chartDesign: CHART_DESIGN,
      goal: theme
        ? `design "${theme}". Read the north star with that in mind, then ask Matt what he wants from it.`
        : 'pick the next theme with Matt: the workflow the north star and the insights say moves most, his call.',
      chart: [
        `${rec.tasks.filter(t => t.status === 'done').length} tasks done, ${going.length} in progress, ${open.length} open, ${blocked.length} blocked.`,
        going.length ? `In progress: ${list(going, n)}.` : '',
        open.length ? `Open: ${list(open, n)}.` : '',
        blocked.length ? `Blocked: ${list(blocked, n)}.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      workflows:
        ns && ns.workflows.length
          ? ns.workflows.map(w => `${w.n}. ${w.name}: ${w.stands}`).join('\n') + (ns.v5 ? `\n${ns.v5}` : '')
          : '(the north star was not read in this session)',
      weekDate: week ? `weeks/${week.date}` : 'none read',
      insights:
        ins && ((ins.lines || []).length || ins.weakestObjective)
          ? [
              ...(ins.lines || []).slice(0, 3),
              ...(ins.weakestObjective ? [`Weakest objective: ${JSON.stringify(ins.weakestObjective)}`] : []),
            ].join('\n')
          : week
            ? '(that week has no insights yet)'
            : '(no weeks document was read in this session)',
      yourTurn: yt.length
        ? yt
            .slice(0, n)
            .map(t => `${t.id}: ${t.ask}`)
            .join('\n')
        : 'Nothing.',
      decisions: decided.length
        ? decided
            .slice(-n)
            .map(d => `${d.id} ${shortTitle(d.title, 110)}`)
            .join('\n')
        : 'None.',
    };
    return template
      .replace(/^<!--[\s\S]*?-->\n/, '')
      .replace(/\{\{(\w+)\}\}/g, (_, k) => (k in slots ? slots[k] : `{{${k}}}`))
      .trim();
  };
  if (!ns) missing.push('the north star');
  if (!week) missing.push('the latest weeks document');
  let text = fill(12);
  for (let n = 11; text.length > KICKOFF_MAX && n >= 1; n--) text = fill(n);
  if (text.length > KICKOFF_MAX) text = text.slice(0, KICKOFF_MAX - 1) + '…';
  return { text, length: text.length, missing };
}
/** The kickoff from this session's reads (the north star's tab, the weeks fetch), as trace --kickoff uses it. */
export function kickoffFrom(root, jsonl, { theme = null, now } = {}) {
  const template = fs.readFileSync(new URL('./kickoff.md', import.meta.url), 'utf8'); // the template is code, beside this file
  return kickoffText(loadChart(root), {
    ns: northStarFrom(docTabRead(jsonl, docIdOf(NORTH_STAR))),
    week: weekFrom(jsonl),
    theme,
    template,
    now,
  });
}
/** B-183: the plan job's trace line, from plan's own result: what was filed from which doc, in ids. */
export function planTraceText(p, docId) {
  const span = xs => (xs.length > 1 ? `${xs[0]} to ${xs.at(-1)}` : xs[0]);
  const d = p.decisions.filter(x => x.kind !== 'tenet').map(x => x.id),
    t = p.decisions.filter(x => x.kind === 'tenet').map(x => x.id),
    k = p.tasks.map(x => x.id);
  const parts = [
    d.length && `${d.length} decision${d.length > 1 ? 's' : ''} (${span(d)})`,
    t.length && `${t.length} tenet${t.length > 1 ? 's' : ''} (${span(t)})`,
    k.length && `${k.length} task${k.length > 1 ? 's' : ''} (${span(k)})`,
  ].filter(Boolean);
  return parts.length
    ? `Filed from the design doc ${docId}: ${parts.join(', ')}.${p.skipped.length ? ` ${p.skipped.length} already filed, skipped.` : ''}`
    : `Nothing new to file from the design doc ${docId}${p.skipped.length ? `: all ${p.skipped.length} rows were filed before` : ''}.`;
}

// ------------------------------------------------------------------------------------------------ brief
// B-109: the parts of E.V. a task touches, from its milestone and the files and spec keys it names; brief --scope
// overrides. A tenet applies to a task when their scopes meet.
const SCOPE_OF = {
  ui: {
    milestone: /\bUI\b|\bpage\b/i,
    file: /^(?:page\/|test\/harness\/)/,
    spec: /^(?:copy|persona|page|look|layout|motion)$/,
  },
  pipelines: {
    milestone: /\bpipelines?\b/i,
    file: /^(?:core\/(?:run|steps|watch|pipelines)\.mjs|tools\/prompts\.mjs|studywatch\/)/,
    spec: /^(?:pipelines|tasks|jobs)$/,
  },
  data: {
    milestone: /\b(?:data|schema|migration)\b/i,
    file: /^(?:core\/(?:migrate|schema|derive|lint)\.mjs|spec\/schema)/,
    spec: /^(?:schema|collections|migrations)$/,
  },
  ops: {
    milestone: /\b(?:ops|workflow|deploy)\b/i,
    file: /^(?:core\/(?:deploy|cli)\.mjs|tools\/(?:chart|check|build|hooks)\.mjs|\.claude\/|chart\/)/,
    spec: /^(?:registry|environments)$/,
  },
};
export function taskScope(t, override) {
  if (override && override !== true) return list(override).filter(x => TENET_SCOPES.includes(x));
  const text = [t.title, t.dod, t.notes].join(' ');
  const files = [
    ...text.matchAll(/(?:^|[\s(`'"])((?:core|page|tools|spec|test|studywatch|chart|\.claude)\/[\w./-]+)/g),
  ].map(m => m[1]);
  const keys = [...text.matchAll(/\bspec\.(\w+)/g)].map(m => m[1]);
  return TENET_SCOPES.filter(
    k =>
      SCOPE_OF[k].milestone.test(t.milestone || '') ||
      files.some(f => SCOPE_OF[k].file.test(f)) ||
      keys.some(x => SCOPE_OF[k].spec.test(x))
  );
}
export const tenetsFor = (rec, scope) =>
  rec.decisions.filter(d => kindOf(d) === 'tenet' && d.status === 'accepted' && d.scope.some(x => scope.includes(x)));
/**
 * B-138 (D-180): the live record's health/current, from the copy a read saved under dist/state/live/record (the read is
 * printed when there is none), and how old it is. Over spec.constants.health.staleHours it is the first thing to take.
 */
export function healthLines(root = HERE, now = Date.now(), builder = builderRun()) {
  const spec = readSpec(root);
  const hours = ((spec.constants || {}).health || {}).staleHours || 4;
  // B-179: a builder session cannot read the live record (its auto mode refuses it, B-187), so its health read is the
  // live watchdog's last_run, which list_triggers gives it.
  if (builder) {
    const w = ((spec.tasks || {}).live || {}).watchdog || {};
    return {
      stale: null,
      lines: [
        `- A builder run reads no live record: read the live watchdog's last_run with list_triggers (${w.trigger || 'live.watchdog'}).`,
        `- Older than ${hours} h: file it with report bug --source "builder: live watchdog last_run stale" unless an open task already covers it, and take that task before any other. Fresher: go on.`,
      ],
    };
  }
  const live = spec.registry.records.live.artifact;
  const file = path.join(root, 'dist', 'state', 'live', 'record', 'health', 'current.json');
  const read = `ArtifactData {"action":"get","url":"https://claude.ai/artifact/${live}","collection":"health","doc_id":"current","out_dir":"${path.join(root, 'dist', 'state', 'live', 'record')}"}`;
  let h = null;
  try {
    h = readJson(file);
  } catch {
    /* none saved */
  }
  const at = h && Date.parse(h.at);
  if (!Number.isFinite(at)) return { stale: null, lines: [`- Not read in this session: ${read}, then brief again.`] };
  const age = (now - at) / 36e5;
  const stale = age > hours;
  return {
    stale,
    lines: [
      `- health/current is ${age < 1 ? 'under an hour' : Math.floor(age) + ' h'} old (written ${h.at}; stale past ${hours} h).`,
      stale
        ? '- STALE: take this first (D-180). Read the live watchdog\'s last_run with list_triggers, file it with report bug --source "brief: health/current stale" unless an open task already covers it, and take that task before any other.'
        : '- Fresh: go on.',
    ],
  };
}

export function brief(rec, id, { root = HERE, scope: override, now = Date.now() } = {}) {
  const ts = findTask(rec, id);
  if (!ts.length) throw new Error(`no task ${id}`);
  const t = ts[0],
    byId = Object.fromEntries(rec.tasks.map(x => [x.id, x]));
  const decisions = Object.fromEntries(rec.decisions.map(d => [d.id, d]));
  const named = [...new Set([...ids(t.title), ...ids(t.dod), ...ids(t.notes)].filter(x => x.startsWith('D-')))];
  const inbox = rec.tasks.filter(x => x.status === 'inbox');
  const lintF = lintChart(rec).filter(f => f.level === 'error');
  const live = rec.deploys.filter(d => d.target === 'live').at(-1),
    staging = rec.deploys.filter(d => d.target === 'staging').at(-1);
  const out = [
    `# Brief: ${t.id}`,
    '',
    `Read first: CLAUDE.md (the hard limits and the every-session steps). Design: E.V. Foundation v4 (https://claude.ai/artifact/Fgb2KjoLKcRgCRrBmM6kEf, Build plan tab); the Chart's own: ${rec.views.design}.`,
    '',
  ];
  // B-138 (D-180): a missing run outranks every open task, so the record's health leads the page.
  out.push('## Health first (D-180)', ...healthLines(root, now).lines, '');
  out.push(
    '## Inbox first',
    inbox.length
      ? inbox
          .map(
            x =>
              `- ${x.id} (${x.kind}, ${x.reportedAt}, from ${x.source}): "${x.words}". Triage: log ${x.id} --triage task --dod "..." --milestone M.. | --triage join <id> | --triage decline --reason "..."`
          )
          .join('\n')
      : '- Empty: nothing to triage.',
    ''
  );
  out.push(
    `## The task: ${t.id} (${t.status}, ${t.milestone})`,
    taskText(t),
    '',
    t.notes ? `Notes: ${t.notes}` : 'Notes: none yet.',
    ''
  );
  out.push(
    '## Depends on',
    t.depends.length
      ? t.depends
          .map(
            d =>
              `- ${d}: ${byId[d] ? byId[d].status : 'NOT IN THE RECORD'}${byId[d] ? ' (' + byId[d].title.slice(0, 80) + ')' : ''}`
          )
          .join('\n')
      : '- Nothing.',
    t.dependsText ? `As written: ${t.dependsText}` : '',
    ''
  );
  out.push(
    '## Decisions it rests on',
    named.length
      ? named
          .map(d =>
            decisions[d]
              ? `- ${d} (${decisions[d].status}): ${decisions[d].title.slice(0, 240)}${decisions[d].title.length > 240 ? '…' : ''}`
              : `- ${d}: not in the record`
          )
          .join('\n')
      : '- None named in the task; the hard limits and D-139 below still hold.',
    'Reasoning in full: DECISIONS.md',
    ''
  );
  const scope = taskScope(t, override),
    tenets = tenetsFor(rec, scope);
  out.push(
    `## Tenets in scope (${scope.length ? scope.join(', ') : 'none found: brief --scope ui,data,ops,pipelines names them'})`,
    tenets.length
      ? tenets
          .map(
            d =>
              `- ${d.id} (${d.scope.join(', ')}; checked by ${d.check}): ${d.title}${d.how ? `\n  Check: ${d.how}` : ''}`
          )
          .join('\n')
      : '- None accepted in this scope.',
    'Every one applies to this task; the review skill checks the diff against each. A tenet changes only by a superseding tenet plus a sweep task.',
    ''
  );
  out.push('## Where to look', ...whereToLook(root, [t.title, t.dod, t.notes].join(' ')), '');
  out.push(
    '## What it may touch',
    '- The repository, on main; npm test green before every push.',
    '- Staging: deploy and verify through `node tools/chart.mjs ship staging`.',
    "- Never live without Matt's explicit OK in the chat (R-04); live goes through `ship live`, which refuses what rules.json forbids:",
    ...rec.rules.filter(r => !r.ended).map(r => `  - ${r.id} (${r.decision}${r.task ? ', ' + r.task : ''}): ${r.rule}`),
    ...rec.rules
      .filter(r => r.ended)
      .map(r => `  - ${r.id}: ended (${r.ended}); kept in chart/rules.json, not enforced`),
    "- A change to tools/prompts.mjs, spec.pipelines or spec.tasks changes scheduled-task prompts: deploy prints update_trigger for the cloud ones; a Mac-bound one changes only from a chat linked to the Mac with Matt present; a task prompt's hard limits stay absolute.",
    '- The hard limits in CLAUDE.md: no help on graded work, no patient identifiers, Canvas read-only, nothing posted as Matt, nothing deleted.',
    ''
  );
  out.push('## The next 24 hours of live runs', ...runWindows(root), '');
  out.push(
    '## Where things stand',
    `- Live: ${live ? `${live.commit}, ${live.time}` : 'none recorded'}. Staging: ${staging ? `${staging.commit}, ${staging.time}` : 'none recorded'}.`,
    `- Chart lint: ${lintF.length ? lintF.length + ' errors (node tools/chart.mjs lint)' : 'green'}.`,
    ''
  );
  out.push(
    '## Record as you go',
    `- Start: node tools/chart.mjs log ${t.id} --status "in progress" --note "..."`,
    `- Finish: node tools/chart.mjs log ${t.id} --status done --commit <sha> --note "one line"`
  );
  return out.join('\n');
}
/** The files and spec keys a task's text names, resolved against the checkout (spec.persona -> spec/ev.spec.json "persona"). */
export function whereToLook(root, text) {
  const out = [],
    seen = new Set();
  let spec = {};
  try {
    spec = readSpec(root);
  } catch {
    /* none */
  }
  for (const m of String(text).matchAll(/\b((?:core|page|tools|spec|scripts|test|studywatch)\/[\w./-]+\.\w+)\b/g))
    if (!seen.has(m[1]) && fs.existsSync(path.join(root, m[1]))) {
      seen.add(m[1]);
      out.push(`- ${m[1]}`);
    }
  for (const m of String(text).matchAll(/\bspec\.(\w+)(?:\.(\w+))?/g)) {
    const k = m[1] + (m[2] && spec[m[1]] && spec[m[1]][m[2]] !== undefined ? '.' + m[2] : '');
    if (spec[m[1]] !== undefined && !seen.has(k)) {
      seen.add(k);
      out.push(
        `- spec/ev.spec.json "${k}" (${Buffer.byteLength(JSON.stringify(k.split('.').reduce((o, x) => o[x], spec)))} bytes)`
      );
    }
  }
  for (const w of ['page copy', 'prompts', 'harness'])
    if (new RegExp(`\\b${w}\\b`).test(text) && !seen.has(w)) {
      seen.add(w);
      out.push(
        `- ${{ 'page copy': "page/app.js and page/index.src.html (the page's words)", prompts: 'tools/prompts.mjs (every task prompt) and the guides in spec.jobs', harness: 'test/harness/*.cjs (the page harness, at phone and desktop width)' }[w]}`
      );
    }
  return out.length
    ? [...out, "- Then grep for the task's own words; dist/ is build output, never a source."]
    : ['- The task names no file: grep for its words (dist/ is build output, never a source).'];
}
/** The live tasks' runs in the next 24 hours, Central time, from their cron schedules (minute, hour, day, weekday). */
export function nextRuns(tasks, now = new Date()) {
  const field = (f, lo, hi) =>
    f === '*'
      ? null
      : new Set(
          f
            .split(',')
            .map(Number)
            .filter(n => n >= lo && n <= hi)
        );
  const out = [];
  for (const [k, t] of Object.entries(tasks || {})) {
    const m = String((t && t.schedule) || '').match(/^(?:CRON_TZ=\S+ )?(\S+) (\S+) (\S+) (\S+) (\S+)$/);
    if (!m) continue;
    const [mins, hours, doms, , dows] = [
      field(m[1], 0, 59),
      field(m[2], 0, 23),
      field(m[3], 1, 31),
      null,
      field(m[5], 0, 6),
    ];
    for (let i = 0; i < 24 * 60; i++) {
      const at = new Date(Math.ceil(now.getTime() / 60e3) * 60e3 + i * 60e3);
      const p = parts(at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', day: 'numeric', weekday: 'short' });
      const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
      if (
        (!mins || mins.has(Number(p.minute))) &&
        (!hours || hours.has(Number(p.hour))) &&
        (!doms || doms.has(Number(p.day))) &&
        (!dows || dows.has(wd))
      )
        out.push({ task: k, at, macBound: Boolean(t.macBound) });
    }
  }
  return out.sort((x, y) => x.at - y.at);
}
function runWindows(root, now = new Date()) {
  try {
    const spec = readSpec(root);
    const runs = nextRuns(spec.tasks.live, now);
    return runs.length
      ? runs
          .map(
            r =>
              `- ${ctDate(r.at.toISOString())} ${ctClock(r.at.toISOString())} CT: ${r.task}${r.macBound ? ' (on the Mac)' : ''}`
          )
          .concat([
            '- A live deploy waits while a study session runs (R-03); a staging deploy is best kept clear of the staging proofs pending in the notes.',
          ])
      : ['- none in the next 24 hours'];
  } catch {
    return ['- (spec not readable)'];
  }
}

// ------------------------------------------------------------------------------------------------ the design hand-off
// D-141: a design chat proposes decisions as P-1, P-2 ... and tasks in a 'Tasks to add' table; a build chat files both
// through plan, which takes the ids. The Build plan tab is design history from then on.
/** The doc id a link ends with (or the id itself). */
export const docIdOf = link =>
  String(link || '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .split('/')
    .pop()
    .replace(/^.*-(?=[A-Za-z0-9]{22}$)/, '');
/** The table under the heading that reads `title` in a prose read, as rows of cell texts (header row first). */
export function tableUnder(xml, title) {
  for (const m of xml.matchAll(/<paragraph\b[^>]*\bheading='\d'[^>]*>([\s\S]*?)<\/paragraph>/g)) {
    if (
      ent(m[1].replace(/<[^>]+>/g, ''))
        .trim()
        .toLowerCase() !== title.toLowerCase()
    )
      continue;
    const from = xml.indexOf('<table', m.index + m[0].length),
      next = xml.slice(m.index + m[0].length).search(/<paragraph\b[^>]*\bheading='/);
    if (from < 0 || (next >= 0 && from > m.index + m[0].length + next)) return null;
    const table = xml.slice(from, xml.indexOf('</table>', from) + 8);
    return parseTableXml(`<doc rev='0'>${table}</doc>`).rows.map(r => r.cells.map(c => c.text.trim()));
  }
  return null;
}
/** The newest Docs read in the transcript of the doc that holds a 'Tasks to add', 'Decisions proposed' or 'Tenets proposed' heading. */
export function designRead(jsonl, docId) {
  return newestDocsRead(jsonl, docId, b => /Tasks to add|Decisions proposed|Tenets proposed/i.test(b.xml));
}
/** A Check cell's kind: the first of harness, lint, ship or review it names (the look pass is the harness's). */
export function checkOf(text) {
  const hits = [
    ...String(text || '')
      .toLowerCase()
      .matchAll(/\b(harness|lint|ship|review|look pass)\b/g),
  ].map(m => (m[1] === 'look pass' ? 'harness' : m[1]));
  return (
    hits[0] ||
    String(text || '')
      .trim()
      .toLowerCase()
  );
}
const byHeader = (rows, names) => {
  if (!rows || !rows.length) return [];
  const head = rows[0].map(h => h.toLowerCase());
  const col = Object.fromEntries(Object.entries(names).map(([k, n]) => [k, head.findIndex(h => n.some(x => h === x))]));
  return rows
    .slice(1)
    .filter(r => r.some(Boolean))
    .map(r => Object.fromEntries(Object.entries(col).map(([k, i]) => [k, i < 0 ? '' : (r[i] || '').trim()])));
};
/**
 * The hand-off from a design doc's read: the decisions and tasks to file, with ids, as `log` argument lists, in order
 * (decisions first, so a task can name a decision's id). A row already filed from this doc is skipped.
 */
export function planFrom(rec, read, docId) {
  if (!read)
    throw new Error(
      `no read of ${docId} with a 'Tasks to add', 'Decisions proposed' or 'Tenets proposed' table in this session: read the doc's tab first`
    );
  const tasks = byHeader(tableUnder(read.xml, 'Tasks to add'), {
    title: ['task'],
    depends: ['depends'],
    dod: ['definition of done', 'done when'],
    milestone: ['milestone'],
  });
  const props = [
    ...byHeader(tableUnder(read.xml, 'Decisions proposed'), {
      pid: ['p-n', 'p', 'id'],
      title: ['decision'],
      why: ['why'],
      status: ['status'],
    }),
    // B-109: tenets share the P-n numbering and the D-ids; each carries its scope and how it is checked.
    ...byHeader(tableUnder(read.xml, 'Tenets proposed'), {
      pid: ['p-n', 'p', 'id'],
      title: ['tenet'],
      scope: ['scope'],
      check: ['check', 'checked by'],
      why: ['why'],
      status: ['status'],
    }).map(d => ({ ...d, kind: 'tenet' })),
  ].sort((a, b) => Number(String(a.pid).slice(2)) - Number(String(b.pid).slice(2))); // ids follow the doc's P-order
  const src = `plan ${docId}`,
    P = {},
    out = { decisions: [], tasks: [], skipped: [], commands: [] };
  let dn = Number(nextDecisionId(rec).slice(2)),
    tn = Number(nextTaskId(rec).slice(2));
  for (const d of props) {
    const table = d.kind === 'tenet' ? 'Tenets proposed' : 'Decisions proposed';
    if (!/^P-\d+$/.test(d.pid) || !d.title)
      throw new Error(`${table}: a row needs a P-n and a ${d.kind || 'decision'} (${JSON.stringify(d)})`);
    if (props.filter(x => x.pid === d.pid).length > 1) throw new Error(`${d.pid} is proposed twice`);
    if (d.kind === 'tenet') {
      d.scope = list(d.scope.toLowerCase());
      d.how = d.check;
      d.check = checkOf(d.check);
      if (!d.scope.length || d.scope.some(x => !TENET_SCOPES.includes(x)))
        throw new Error(`${table}: ${d.pid} needs a scope, one or more of ${TENET_SCOPES.join(', ')}`);
      if (!TENET_CHECKS.includes(d.check))
        throw new Error(`${table}: ${d.pid} needs a check, one of ${TENET_CHECKS.join(', ')}`);
    }
    const had = rec.decisions.find(x => x.source === `${src} ${d.pid}`);
    if (had) {
      P[d.pid] = had.id;
      out.skipped.push(`${d.pid}: filed as ${had.id}`);
      continue;
    }
    P[d.pid] = 'D-' + String(dn++).padStart(3, '0');
  }
  const rewrite = s => String(s || '').replace(/\bP-\d+\b/g, x => P[x] || x);
  for (const d of props) {
    if (out.skipped.some(x => x.startsWith(d.pid + ':'))) continue;
    const e = {
      id: P[d.pid],
      pid: d.pid,
      title: rewrite(d.title),
      why: rewrite(d.why),
      status: (d.status || 'accepted').toLowerCase(),
      kind: d.kind || 'decision',
      ...(d.kind === 'tenet'
        ? { scope: d.scope, check: d.check, how: d.how && d.how.toLowerCase() !== d.check ? d.how : '' }
        : {}),
    };
    out.decisions.push(e);
    out.commands.push([
      'log',
      'decision',
      e.id,
      '--title',
      e.title,
      ...(e.why ? ['--why', e.why] : []),
      '--status',
      e.status,
      ...(e.kind === 'tenet'
        ? ['--kind', 'tenet', '--scope', e.scope.join(','), '--checked-by', e.check, ...(e.how ? ['--how', e.how] : [])]
        : []),
      '--source',
      `${src} ${d.pid}`,
    ]);
  }
  for (const t of tasks) {
    if (!t.title || !t.milestone)
      throw new Error(`Tasks to add: a row needs a task and a milestone (${JSON.stringify(t)})`);
    const title = rewrite(t.title),
      had = rec.tasks.find(x => x.source === src && x.title === title);
    if (had) {
      out.skipped.push(`"${title.slice(0, 60)}": filed as ${had.id}`);
      continue;
    }
    const e = {
      id: 'B-' + String(tn++).padStart(2, '0'),
      title,
      dod: rewrite(t.dod),
      milestone: t.milestone,
      depends: rewrite(t.depends).replace(/^[—-]$/, ''),
    };
    out.tasks.push(e);
    out.commands.push([
      'log',
      'new',
      e.id,
      '--title',
      e.title,
      ...(e.dod ? ['--dod', e.dod] : []),
      '--milestone',
      e.milestone,
      ...(e.depends ? ['--depends', e.depends] : []),
      '--source',
      src,
    ]);
  }
  return out;
}
const shellQuote = a => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
export function formatPlan(p) {
  const out = [];
  if (p.skipped.length) out.push(`plan: already filed: ${p.skipped.join('; ')}`);
  if (!p.commands.length) {
    out.push('plan: nothing to file');
    return out.join('\n');
  }
  const n = (k, w) => {
    const c = p.decisions.filter(d => (d.kind || 'decision') === k).length;
    return `${c} ${w}${c === 1 ? '' : 's'}`;
  };
  out.push(
    `plan: ${n('decision', 'decision')}, ${n('tenet', 'tenet')} and ${p.tasks.length} task${p.tasks.length === 1 ? '' : 's'} to file (run again with --apply to file them):`
  );
  for (const c of p.commands) out.push('  node tools/chart.mjs ' + c.map(shellQuote).join(' '));
  return out.join('\n');
}

// ------------------------------------------------------------------------------------------------ rollback (B-60)
// Going back is the previous live build's content at main's head: a restore commit, then ship staging and ship live on
// Matt's OK (D-145). Not a redeploy of the old commit itself: runs clone main only 50 deep (B-110), and an old commit
// falls out of reach as main moves on, while deploying main's head again would undo the rollback.
/** What a restore commit keeps as it is: the record and the docs. The tools and tests go back with the code they import
 * (tools/chart.mjs imports core/), so the restored tree builds, ships and tests as that build did. */
export const ROLLBACK_KEEP = [/^chart\//, /^BACKLOG\.md$/, /^CLAUDE\.md$/, /^\.claude\/skills\//];
/** The live build to go back to: --to (a live build in chart/deploys.json), else the live build before the current one. */
export function rollbackTarget(rec, to = null) {
  const lives = rec.deploys.filter(d => d.target === 'live' && d.commit);
  const from = lives.at(-1);
  if (!from) throw new Error('no live deploy in chart/deploys.json');
  const earlier = lives.filter(d => d.commit !== from.commit && d.verify === 'green');
  const t = to
    ? earlier.filter(d => d.commit.startsWith(String(to).slice(0, 7))).at(-1)
    : earlier.find(d => d.commit === from.rollback) || earlier.at(-1);
  if (!t)
    throw new Error(
      to
        ? `${to} is not an earlier live build that verified green in chart/deploys.json`
        : 'no earlier live build that verified green in chart/deploys.json'
    );
  return { from, to: t };
}
/** The files a restore commit changes: each one that differs between the build and HEAD, restored or removed. */
export function restoreFiles(root, to, head = 'HEAD') {
  const changed = git(root, ['diff', '--name-only', '--no-renames', to, head])
    .split('\n')
    .filter(Boolean)
    .filter(f => !ROLLBACK_KEEP.some(re => re.test(f)));
  const has = f => {
    try {
      git(root, ['cat-file', '-e', `${to}:${f}`]);
      return true;
    } catch {
      return false;
    }
  };
  return { restore: changed.filter(has), remove: changed.filter(f => !has(f)) };
}
function applyRestore(dir, to, files) {
  if (files.restore.length) git(dir, ['checkout', to, '--', ...files.restore]);
  if (files.remove.length) git(dir, ['rm', '-q', '--', ...files.remove]);
}
/** Each schema's x-ev version at a commit: {collection: n}. */
export function schemaVersions(root, commit) {
  const out = {};
  for (const f of git(root, ['ls-tree', '--name-only', commit, 'spec/schemas/'])
    .split('\n')
    .filter(x => x.endsWith('.schema.json'))) {
    try {
      const x = JSON.parse(git(root, ['show', `${commit}:${f}`]))['x-ev'] || {};
      if (x.collection) out[x.collection] = x.schema || 1;
    } catch {
      /* unreadable: not a schema */
    }
  }
  return out;
}
/** The schemas a rollback goes back across: a collection newer (or new) in the current build. */
export function schemaCrossings(now, then) {
  return Object.entries(now)
    .filter(([c, v]) => (then[c] || 0) < v)
    .map(([c, v]) => ({ collection: c, now: v, then: then[c] || null }));
}
/** The live tasks whose prompt differs between two builds' manifests. */
export function promptChanges(now, then) {
  return Object.entries(then.tasks || {})
    .filter(([, t]) => t.record === 'live')
    .filter(([k, t]) => !now.tasks[k] || now.tasks[k].promptSha256 !== t.promptSha256)
    .map(([k, t]) => ({ task: k, macBound: Boolean(t.macBound) }));
}
function buildIn(root, commit, files, label) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `ev4-${label}-`)),
    dir = path.join(base, 'tree'),
    out = path.join(base, 'dist');
  git(root, ['worktree', 'add', '--detach', '-q', dir, commit]);
  try {
    if (files) applyRestore(dir, files.to, files);
    // The build's own tools: what it ships is what its commit built.
    execFileSync('node', [path.join(dir, 'tools', 'build.mjs'), '--root', dir, '--out', out], { stdio: 'pipe' });
    const manifest = readJson(path.join(out, 'manifest.json')),
      spec = readJson(path.join(out, 'system', 'spec.json'));
    return { dir, out, manifest, hash: contentHash(manifest, spec, sha256) };
  } catch (e) {
    git(root, ['worktree', 'remove', '--force', dir]);
    throw e;
  }
}
async function rollback(o) {
  const root = rootOf(o);
  if (o._[1] !== 'live') throw new Error('rollback live [--to <sha>] (a dry run) | rollback live --matt-ok --apply');
  const rec = loadChart(root),
    { from, to } = rollbackTarget(rec, o.to && o.to !== true ? o.to : null);
  const toFull = git(root, ['rev-parse', to.commit]).trim(),
    head = git(root, ['rev-parse', 'HEAD']).trim();
  const files = { ...restoreFiles(root, toFull), to: toFull };
  const crossings = schemaCrossings(schemaVersions(root, head), schemaVersions(root, toFull));
  const then = buildIn(root, toFull, null, `then-${to.commit}`),
    now = buildIn(root, head, null, `now-${from.commit}`),
    restored = buildIn(root, head, files, 'restore');
  try {
    const same = restored.hash === then.hash,
      prompts = promptChanges(now.manifest, then.manifest);
    const tasksBetween = (() => {
      try {
        // B-144: the same attribution ship uses, so what going back undoes is what those deploys shipped.
        return commitTasks(commitsIn(root, `${toFull}..${from.commit}`));
      } catch {
        return [];
      }
    })();
    const out = [
      `rollback live: from ${from.commit} (live since ${from.time}) to ${to.commit} (live since ${to.time}, verified green; chart/deploys.json)${o.apply ? '' : ': DRY RUN, nothing is written or deployed'}`,
      '',
    ];
    out.push(
      `Going back undoes what ${tasksBetween.length ? tasksBetween.join(', ') : 'the builds since'} shipped: the page (shell, core.js, app.js, spec.json, styles.css), system/manifest, system/spec and system/environments, so every scheduled run from then on runs ${to.commit}'s code, and the live tasks' prompts where they differ (below).`
    );
    out.push(
      "It does not undo: documents the live record holds (runs, state, health, his own entries) stay as written; an applied schema bump or migration stays applied and its legacy copies are kept (D-145); a Mac-bound task's prompt changes only from a chat linked to the Mac, with Matt present.",
      ''
    );
    out.push(
      crossings.length
        ? `Schema: going back crosses ${crossings.map(c => `${c.collection} (schema ${c.now} now, ${c.then ? 'schema ' + c.then : 'no such collection'} in ${to.commit})`).join('; ')}. The live documents stay at the newer schema; before live, ship staging at the restore commit and fire the staging evening-cloud and watchdog (the staging record is seeded from live, so it holds the same shapes), and go live only when their runs/<id> read back ok.`
        : `Schema: none crossed (every schema in ${from.commit} has the version it has in ${to.commit}); documents written since keep their fields, and ${to.commit}'s code reads them as before.`
    );
    out.push(
      prompts.length
        ? `Live tasks' prompts: ${prompts.map(p => p.task + (p.macBound ? ' (Mac-bound: only from a chat linked to the Mac, with Matt present)' : '')).join(', ')} differ: ship live prints update_trigger for each cloud one.`
        : `Live tasks' prompts: the same in both builds: no task call.`,
      ''
    );
    out.push(
      `The restore commit (on main, at its head, so the runs' clone always reaches it, B-110): ${files.restore.length} file${files.restore.length === 1 ? '' : 's'} back to ${to.commit}${files.restore.length ? ': ' + files.restore.join(', ') : ''}; ${files.remove.length} added since, removed from the tree (kept in history)${files.remove.length ? ': ' + files.remove.join(', ') : ''}. Kept as they are: chart/, BACKLOG.md, CLAUDE.md, .claude/skills/.`
    );
    out.push(
      `Content: the restore build ${same ? 'equals' : 'DIFFERS FROM'} ${to.commit}'s build (content hash ${restored.hash.slice(0, 12)}${same ? '' : ' vs ' + then.hash.slice(0, 12)}).`
    );
    if (!same) {
      console.log(
        out
          .concat(['', 'rollback refused: the restore would not ship the same content; nothing was written'])
          .join('\n')
      );
      return 1;
    }
    // The restored tree works as that build did: its own npm test (the Chart's lint on today's record included).
    if (!o['no-test']) {
      const nm = path.join(root, 'node_modules');
      if (fs.existsSync(nm) && !fs.existsSync(path.join(restored.dir, 'node_modules')))
        fs.symlinkSync(nm, path.join(restored.dir, 'node_modules'));
      let log = '';
      try {
        log = execFileSync('npm', ['test', '--silent'], {
          cwd: restored.dir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          maxBuffer: 64 << 20,
        });
      } catch (e) {
        log = String(e.stdout || '') + String(e.stderr || '');
      }
      const n = k => Number((log.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0),
        pass = n('pass'),
        fail = n('fail');
      out.push(
        `Tests: npm test in the restored tree: ${pass} pass, ${fail} fail${fail || !pass ? ': ' + (log.match(/^not ok .*$/gm) || ['no result']).slice(0, 5).join('; ') : ''}.`
      );
      if (fail || !pass) {
        console.log(
          out
            .concat(['', 'rollback refused: the restored tree does not pass its own tests; nothing was written'])
            .join('\n')
        );
        return 1;
      }
    }
    // The calls ship live will print for the restore build, against the saved live state (versions from this
    // session's last get; the file paths are where ship builds, dist/).
    const stateDir = path.join(root, 'dist', 'state', 'live'),
      state = withShell(readState(stateDir), restored.manifest, 'live', restored.out);
    const versions = versionsFrom(
      transcriptOf(o),
      `https://claude.ai/artifact/${restored.manifest.records.live.artifact}`
    );
    const calls = deployCalls({
      builder: Boolean(builderRun()), // B-184 (D-200)
      manifest: { ...restored.manifest, dirty: false },
      target: 'live',
      distDir: path.join(root, 'dist'),
      build: { pushed: true, contentHash: restored.hash },
      versions,
      mattOk: true,
      duringSession: true,
      state,
      sha256,
      stagingVerify: { green: true, contentHash: restored.hash },
      stateDir,
    });
    out.push(
      '',
      "Steps (each on Matt's explicit OK in the chat; never between 6pm Tuesday and the end of Wednesday of an exam week unless he names that window):",
      `  1. node tools/chart.mjs rollback live${o.to && o.to !== true ? ' --to ' + to.commit : ''} --matt-ok --apply   (the restore commit, with the session's --trailer lines)`,
      '  2. npm test, then git push origin main',
      `  3. node tools/chart.mjs ship staging, with every call and read it prints, until GREEN${crossings.length ? '; then fire the staging evening-cloud and watchdog and read their runs back' : ''}`,
      '  4. node tools/chart.mjs ship live --matt-ok, with every call and read it prints, until GREEN; it records the deploy (its rollback names the build left)',
      `  5. log a decision naming why live went back; bringing the newer work back later is git revert <the restore commit> and the normal path`,
      '',
      `The live calls step 4 will print (from the saved live state; the shell's live page files and system documents become ${to.commit}'s):`,
      formatDeploy('live', calls)
        .replace(/^deploy live: /, '')
        .replace(', then run verify-deploy live.', '.')
    );
    if (o.apply) {
      if (!o['matt-ok']) throw new Error("rollback --apply needs Matt's explicit OK in the chat (then pass --matt-ok)");
      if (git(root, ['status', '--porcelain']).trim())
        throw new Error('the checkout has uncommitted changes: commit or stash them first');
      applyRestore(root, toFull, files);
      git(root, ['add', '-A', '--', ...files.restore]);
      const message = `B-60: roll live back to ${to.commit}'s content, from ${from.commit} (restore commit, on Matt's OK)`;
      git(root, ['commit', '-q', '-m', commitMessage(message, o.trailer)]);
      out.push('', `restore commit ${git(root, ['rev-parse', '--short=7', 'HEAD']).trim()} made: go on with step 2`);
    }
    console.log(out.join('\n'));
    return 0;
  } finally {
    for (const b of [then, now, restored]) {
      try {
        git(root, ['worktree', 'remove', '--force', b.dir]);
      } catch {
        /* gone */
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ the command line
function args(argv) {
  const o = { _: [], trailer: [] };
  const flags = new Set([
    '--json',
    '--check',
    '--no-commit',
    '--matt-ok',
    '--during-session',
    '--apply',
    '--correct',
    '--matt',
    '--minor',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags.has(a)) o[a.slice(2)] = true;
    else if (a === '--trailer') o.trailer.push(argv[++i]);
    else if (a.startsWith('--'))
      o[a.slice(2)] = argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else o._.push(a);
  }
  return o;
}
const rootOf = o => (o.root ? path.resolve(o.root) : HERE);
/** The tests' sources, for lint's superseded-tenet check (B-109). */
export function testTexts(root) {
  const out = {};
  for (const dir of ['test', 'test/harness']) {
    const d = path.join(root, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d))
      if (/\.(?:mjs|cjs|js)$/.test(f)) out[`${dir}/${f}`] = fs.readFileSync(path.join(d, f), 'utf8');
  }
  return out;
}
function writeBacklog(root, rec) {
  for (const [f, text] of Object.entries(generatedFiles(rec))) fs.writeFileSync(path.join(root, f), text);
}

const commands = {
  backlog(o) {
    const root = rootOf(o),
      rec = loadChart(root);
    if (o.check) {
      let red = 0;
      for (const [f, text] of Object.entries(generatedFiles(rec))) {
        const p = path.join(root, f),
          same = fs.existsSync(p) && fs.readFileSync(p, 'utf8') === text;
        if (!same) red++;
        console.log(
          same ? `${f}: generated from chart/, in step` : `${f}: differs from chart/ (node tools/chart.mjs backlog)`
        );
      }
      return red ? 1 : 0;
    }
    writeBacklog(root, rec);
    console.log('BACKLOG.md, DECISIONS.md and CHANGELOG.md regenerated from chart/');
    return 0;
  },
  lint(o) {
    const f = lintChart(loadChart(rootOf(o)), {
      tests: testTexts(rootOf(o)),
      spec: readSpec(rootOf(o)),
    });
    console.log(o.json ? JSON.stringify(f, null, 1) : formatLint(f));
    return f.some(x => x.level === 'error') ? 1 : 0;
  },
  inbox(o) {
    console.log(formatInbox(inboxPlan(loadChart(rootOf(o)), transcriptOf(o))));
    return 0;
  },
  quarantine(o) {
    // B-152 (D-176): which quarantined timing checks have had their green nightlies.
    const root = rootOf(o);
    const q = readJson(path.join(root, 'test/harness/quarantine.json'));
    if (!o.runs)
      throw new Error(
        'quarantine --runs <file>: save gh run list --workflow nightly.yml --limit 60 --json conclusion,createdAt,event first'
      );
    const rows = quarantineDue(q, readJson(o.runs));
    const n = q.returnAfterGreenNightlies || 20;
    for (const r of rows)
      console.log(
        `${r.id}: ${r.greens} green nightl${r.greens === 1 ? 'y' : 'ies'} in a row of ${n}${r.due ? ': back to blocking: take its row out of test/harness/quarantine.json' : ''}`
      );
    if (!rows.length) console.log('quarantine: none; every timing check is blocking');
    return 0;
  },
  log(o) {
    return record(o, applyLog);
  },
  report(o) {
    return record(o, applyReport);
  },
  brief(o) {
    if (o.matt) {
      console.log(['# Your turn', '', ...yourTurnLines(loadChart(rootOf(o)))].join('\n'));
      return 0;
    }
    const id = o.task || o._[1];
    if (!id) throw new Error('brief --task <id> [--scope ui,data,ops,pipelines] | brief --matt');
    console.log(brief(loadChart(rootOf(o)), id, { root: rootOf(o), scope: o.scope }));
    return 0;
  },
  ship(o) {
    return ship(o);
  },
  trace(o) {
    return trace(o);
  },
  rollback(o) {
    return rollback(o);
  },
  plan(o) {
    if (!o.from || o.from === true) throw new Error('plan --from <design doc link> [--apply]');
    const root = rootOf(o),
      docId = docIdOf(o.from);
    const p = planFrom(loadChart(root), designRead(transcriptOf(o), docId), docId);
    console.log(formatPlan(p));
    if (!o.apply || !p.commands.length) return 0;
    // One commit for the whole hand-off (each record write would be its own, and runs clone main only so deep, B-110).
    if (!o['no-commit']) syncRecord(root);
    const rec = loadChart(root),
      filed = [];
    for (const c of p.commands) {
      applyLog(rec, args(c));
      filed.push(c[2]);
    }
    const errors = lintChart(rec).filter(f => f.level === 'error' && filed.includes(f.id));
    if (errors.length)
      throw new Error('the record would not lint: ' + errors.map(f => `${f.id}: ${f.detail}`).join('; '));
    saveChart(root, rec);
    writeBacklog(root, rec);
    const span = pre => {
      const x = filed.filter(i => i.startsWith(pre));
      return x.length ? (x.length > 1 ? `${x[0]} to ${x.at(-1)}` : x[0]) : null;
    };
    const what = `plan ${docId}: ${[p.decisions.filter(d => d.kind !== 'tenet').length + ' decisions', p.decisions.filter(d => d.kind === 'tenet').length + ' tenets', p.tasks.length + ' tasks'].join(', ')}`;
    const sha = o['no-commit']
      ? null
      : commitRecord(root, `${[span('D-'), span('B-')].filter(Boolean).join(', ')}: ${what} (chart)`, o.trailer);
    console.log(
      `plan: filed ${filed.join(', ')}${sha ? pushedText(sha, pushRecord(root)) : '; not committed (--no-commit)'}`
    );
    console.log('BACKLOG.md regenerated.');
    return 0;
  },
};
function record(o, apply) {
  const root = rootOf(o);
  if (!o['no-commit']) syncRecord(root);
  const rec = loadChart(root);
  const { what, id, reply } = apply(rec, o, { jsonl: transcriptOf(o) });
  const errors = lintChart(rec).filter(f => f.level === 'error' && f.id === id);
  if (errors.length) throw new Error('the record would not lint: ' + errors.map(f => f.detail).join('; '));
  saveChart(root, rec);
  writeBacklog(root, rec);
  const sha = o['no-commit'] ? null : commitRecord(root, `${id}: ${what} (chart)`, o.trailer);
  const pushed = sha ? pushRecord(root) : null;
  console.log(
    `${o._[0]} ${id}: ${what}${sha ? pushedText(sha, pushed) : o['no-commit'] ? '; not committed (--no-commit)' : '; nothing changed'}`
  );
  console.log('BACKLOG.md regenerated.');
  if (reply)
    console.log(`Reply in the comment's thread with the id it got: ${reply.tool}\n${JSON.stringify(reply.args)}`);
  return 0;
}

export async function main(argv) {
  const o = args(argv),
    cmd = commands[o._[0]];
  if (!cmd) {
    console.error(`Commands: ${Object.keys(commands).join(', ')} (usage in the header of tools/chart.mjs)`);
    return 2;
  }
  try {
    return await cmd(o);
  } catch (e) {
    console.error(`${o._[0]} refused: ${e.message}`);
    return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.argv.slice(2));
