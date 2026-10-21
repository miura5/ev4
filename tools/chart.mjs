#!/usr/bin/env node
// The Chart: E.V.'s project record (M12; design https://claude.ai/artifact/8DVSMh5WdybjeHVV5m2uQT, approved by Matt
// Oct 19). chart/ holds the facts; BACKLOG.md, the Board and Changelog tables of the v3 doc and the overview doc's status
// line are generated from them; these commands are the only way in. chart/ and this file sit outside the manifest's
// file list (tools/build.mjs HASHED), so a bookkeeping commit never changes what a deploy ships.
//   report <bug|request> --from-chat ["<words>"] | --from-comment <id> | "<words>" --source <where>   an inbox entry
//            in Matt's words as written, taken from this session's transcript (his message, a Board comment) (B-95)
//   inbox                    session start: the Board comments to file and the entries to triage, as commands
//   quarantine --runs <file> the quarantined timing checks and their green nightlies in a row (B-152)
//   log <id> [--status s] [--note t] [--board-note t] [--commit sha] [--name n] [--why w] [--waiting-on who] [--dod d] [--title t]
//            [--triage task --dod d --milestone m [--depends ids] | --triage join <id> | --triage decline --reason r]
//   log deploy --target <staging|live> --commit sha [--time ISO] [--ok Matt] [--verify green] [--rollback sha]
//              [--tasks ids] [--summary s] [--why w] [--decisions ids]
//   log rule <R-id> --rule t --decision D-id --command c --fn name [--task B-id]   a rule ship enforces
//   log decision <D-id> --title t [--status s] [--why w] [--supersedes ids] [--amends ids] [--restated]
//            each writes one change to chart/, regenerates BACKLOG.md, commits (--no-commit to skip; --trailer adds a
//            commit trailer line, repeatable), then prints the view updates to make (views)
//   views [--transcript f]   the exact Docs calls that bring the Board, the Changelog and the overview's status line in
//            line with the record, from this session's newest read of each (or the reads to make first)
//   plan --from <doc link> [--apply] [--handoff-note]   a design doc's hand-off (D-141, B-106): from this session's
//            read of the doc, its 'Tasks to add' and 'Decisions proposed' tables as the log new and log decision commands
//            that file them (the next free ids, P-n rewritten to its D-id); --apply runs them; filed rows are skipped
//   lint [--json]            the record's checks: ids, dependencies, decisions, commits, the inbox (B-94; npm test runs it)
//   ship <staging|live> [--done B-nn --commit sha]   the deploy checklist: the rules, the reads, deploy's calls, verify,
//            the record (B-96); --done records those tasks done in the same command (B-147)
//   rollback live [--to sha] [--matt-ok --apply] [--no-test]   the way back (B-60): the previous live build's content at main's
//            head, as a restore commit, then ship staging and ship live; without --apply a dry run that prints it all
//   brief --task <id>        one page for a new session: the inbox, the task, its dependencies, decisions, limits
//   backlog [--check]        regenerate BACKLOG.md (--check: exit 1 when the file differs)
//   import --from <dir>      the one-time import (B-92) from saved copies of BACKLOG.md and the doc tabs
// Options: --root <repo> (default this checkout). Exit 0 green, 1 red or refused, 2 usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newestTranscript, toolResults } from '../core/transcript.mjs';
import { verify, verifyReads, deployCalls, formatDeploy, canonical, SYSTEM_IDS, contentHash } from '../core/deploy.mjs';
import { commitsBehind, mainHead } from '../core/cli.mjs';
import { readState, withShell } from '../core/verifystate.mjs';
import { build, BOOKKEEPING } from './build.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FILES = ['tasks', 'decisions', 'deploys', 'rules', 'views'];
export const TASK_STATUS = ['inbox', 'open', 'in progress', 'blocked', 'done', 'declined'];
export const TASK_KINDS = ['task', 'bug', 'request'];
// The design's three, plus revisit: three rows of the Decisions tab carry it and the import keeps what it finds.
export const DECISION_STATUS = ['proposed', 'accepted', 'superseded', 'revisit'];
// B-109: a decision is one-time; a tenet is a standing principle, with the parts of E.V. it governs and how it is checked.
export const DECISION_KINDS = ['decision', 'tenet'];
export const TENET_SCOPES = ['ui', 'data', 'ops', 'pipelines'];
export const TENET_CHECKS = ['harness', 'lint', 'ship', 'review'];
export const kindOf = d => d.kind || 'decision';
const TZ = 'America/Chicago';
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
// Same as the spec: indent 1, no trailing newline.
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 1));
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const git = (root, a, opts = {}) =>
  execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const ids = s => [...String(s || '').matchAll(/\b([BD]-\d{2,3})\b/g)].map(m => m[1]);
const list = s =>
  s == null || s === true
    ? []
    : String(s)
        .split(/[\s,]+/)
        .filter(Boolean);

// ------------------------------------------------------------------------------------------------ the record
export const chartDir = root => path.join(root, 'chart');
export function loadChart(root = HERE) {
  const dir = chartDir(root);
  return Object.fromEntries(FILES.map(f => [f, readJson(path.join(dir, f + '.json'))]));
}
export function saveChart(root, rec) {
  fs.mkdirSync(chartDir(root), { recursive: true });
  for (const f of FILES) writeJson(path.join(chartDir(root), f + '.json'), rec[f]);
}
export const findTask = (rec, id) => rec.tasks.filter(t => t.id === id);
/** The next free B- id: one past the highest in the record. */
export function nextTaskId(rec) {
  const n = Math.max(0, ...rec.tasks.map(t => Number(t.id.slice(2))).filter(Number.isFinite));
  return 'B-' + String(n + 1).padStart(2, '0');
}
export function nextDecisionId(rec) {
  return 'D-' + String(Math.max(0, ...rec.decisions.map(d => Number(d.id.slice(2)))) + 1).padStart(3, '0');
}

// ------------------------------------------------------------------------------------------------ time
const parts = (d, o) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...o }).formatToParts(d).map(p => [p.type, p.value])
  );
/** "Oct 19" in Central time. */
export const ctDate = iso => {
  const p = parts(new Date(iso), { month: 'short', day: 'numeric' });
  return `${p.month} ${p.day}`;
};
/** "16:20" in Central time. */
export const ctClock = iso => {
  const p = parts(new Date(iso), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}`;
};
/** "4:20pm", or "4pm" on the hour, in Central time. */
export const ctTwelve = iso => {
  const p = parts(new Date(iso), { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${p.hour}${p.minute === '00' ? '' : ':' + p.minute}${p.dayPeriod.toLowerCase()}`;
};

// ------------------------------------------------------------------------------------------------ BACKLOG.md
// As BACKLOG.md stood when the Chart imported it (B-92), and as it reads since the cutover (B-97, D-140).
export const BACKLOG_HEADER_IMPORTED = [
  '# E.V. v4 build backlog',
  '',
  'The sequence every build session follows. Full definitions of done are in the Build plan tab of E.V. Foundation',
  'v4; this file is the live status board. Status: `open` · `in progress` · `blocked` · `done`. A task opens when',
  'every id in Depends is `done`. Edit only the Status and Notes columns; commit every change.',
];
export const BACKLOG_HEADER = [
  '# E.V. v4 build backlog',
  '',
  '**Generated from the Chart (chart/tasks.json) by `node tools/chart.mjs`: never edit this file by hand** (D-140).',
  'Change the record with `log`, `report` or `ship`; npm test fails when this file and the record differ.',
  'Status: `open` · `in progress` · `blocked` · `done`. A task opens when every id in Depends is `done`.',
];
const COLUMNS = '| Id | Task | Depends | Milestone | Status | Notes |\n| --- | --- | --- | --- | --- | --- |';
// A | inside a field would split the cell (GFM splits on every unescaped |), so the generator escapes it.
const cell = s => String(s == null ? '' : s).replace(/\|/g, '\\|');
export const taskText = t => t.title + (t.dod ? ' Done when: ' + t.dod : '');
export const dependsText = t => (t.dependsText != null ? t.dependsText : t.depends.length ? t.depends.join(', ') : '—');
export const backlogRow = t =>
  `| ${t.id} | ${cell(taskText(t))} | ${cell(dependsText(t))} | ${cell(t.milestone)} | ${t.status} | ${cell(t.notes)} |`;
const INBOX = new Set(['inbox', 'declined']);
// B-148 (M-1, D-181): where what waits on Matt happens, so his list is one sitting per place.
export const PLACES = {
  mac: 'At the Mac',
  staging: 'On the staging page',
  github: 'On GitHub',
  decision: 'A decision (a reply in a build chat)',
};
/** Everything waiting on Matt, grouped by where it happens (a task with no place is a decision). */
export function yourTurn(rec) {
  const waiting = rec.tasks.filter(t => t.waitingOn === 'Matt' && !['done', 'declined'].includes(t.status));
  return Object.entries(PLACES)
    .map(([k, label]) => ({
      place: k,
      label,
      tasks: waiting.filter(t => (PLACES[t.waitingWhere] ? t.waitingWhere : 'decision') === k),
    }))
    .filter(g => g.tasks.length);
}
/** The Your turn section as Markdown lines: per place, each task with what it waits on (its notes' last sentence). */
export function yourTurnLines(rec) {
  const groups = yourTurn(rec);
  if (!groups.length) return ['Nothing waits on Matt.'];
  const out = [];
  for (const g of groups) {
    out.push(`### ${g.label}`, '');
    for (const t of g.tasks) out.push(`- ${t.id} (${t.status}): ${cell(boardName(t).replace(/^v4 B-\d+: /, ''))}`);
    out.push('');
  }
  return out.slice(0, -1);
}
/**
 * BACKLOG.md from the record (B-148, D-4): the open, blocked and in-progress tasks first, then Your turn (what waits on
 * Matt, by place), then the done tasks under one heading, then the inbox (reports untriaged or declined).
 */
export function renderBacklog(rec, { header = BACKLOG_HEADER } = {}) {
  const tasks = rec.tasks.filter(t => !INBOX.has(t.status) && t.status !== 'done'),
    done = rec.tasks.filter(t => t.status === 'done'),
    inbox = rec.tasks.filter(t => INBOX.has(t.status));
  const out = [...header, '', COLUMNS, ...tasks.map(backlogRow)];
  out.push(
    '',
    '## Your turn',
    '',
    'What waits on Matt, by where it happens (`brief --matt` prints the same list).',
    '',
    ...yourTurnLines(rec)
  );
  out.push('', '## Done', '', COLUMNS, ...done.map(backlogRow));
  if (inbox.length) {
    out.push(
      '',
      '## Inbox',
      '',
      "Reports in Matt's words, untriaged or declined. Nothing is deleted: a declined entry stays, with its reason.",
      '',
      '| Id | Kind | Reported | Words | Source | Status | Notes |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...inbox.map(
        t =>
          `| ${t.id} | ${t.kind} | ${t.reportedAt || ''} | ${cell(t.words)} | ${cell(t.source)} | ${t.status} | ${cell(t.notes)} |`
      )
    );
  }
  return out.join('\n');
}
// B-143 (D-172): the Decisions tab and the Changelog, generated into the repository beside BACKLOG.md, with the same
// drift test; the Docs views are retired and nothing prints a Docs call for them.
const GENERATED =
  '**Generated from the Chart by `node tools/chart.mjs`: never edit this file by hand** (D-140, D-172).';
const decisionDate = d => d.date || (d.at ? ctDate(d.at) : '');
/** DECISIONS.md: every decision and tenet in the record, newest first, with its reasoning and status. */
export function renderDecisions(rec) {
  const ds = [...rec.decisions].sort((a, b) => Number(b.id.slice(2)) - Number(a.id.slice(2)));
  const kind = d =>
    d.kind === 'tenet' ? `Tenet (${(d.scope || []).join(', ')}; checked by ${d.checkedBy || d.check || 'review'})` : '';
  const links = d =>
    [
      d.supersedes && d.supersedes.length ? 'supersedes ' + d.supersedes.join(', ') : '',
      d.amends && d.amends.length ? 'amends ' + d.amends.join(', ') : '',
    ]
      .filter(Boolean)
      .join('; ');
  return [
    '# DECISIONS.md: E.V. v4 decisions and tenets',
    '',
    GENERATED,
    'Change one with `log decision`; npm test fails when this file and chart/decisions.json differ. D-001 to D-043 are',
    "in the v2 doc's decision log.",
    '',
    '| Id | Date | Decision | Why | Status | Links |',
    '| --- | --- | --- | --- | --- | --- |',
    ...ds.map(
      d =>
        `| ${d.id} | ${cell(decisionDate(d))} | ${cell([kind(d), d.title].filter(Boolean).join(': '))} | ${cell(d.why || '')} | ${d.status} | ${cell(links(d))} |`
    ),
  ].join('\n');
}
/** CHANGELOG.md: every deploy in the record, newest first, as the Changelog tab printed it. */
export function renderChangelog(rec) {
  const rows = [...rec.deploys].reverse().map(d => changelogLine(d));
  return [
    '# CHANGELOG.md: E.V. v4 deploys',
    '',
    GENERATED,
    'A deploy reaches it through `ship` (or `log deploy`); npm test fails when this file and chart/deploys.json differ.',
    '',
    '| Date | Change | Why | Decision |',
    '| --- | --- | --- | --- |',
    ...rows.map(l => `| ${cell(l.date)} | ${cell(l.change)} | ${cell(l.why)} | ${cell(l.decision)} |`),
  ].join('\n');
}
/** The three generated files, by name. */
export const generatedFiles = rec => ({
  'BACKLOG.md': renderBacklog(rec),
  'DECISIONS.md': renderDecisions(rec),
  'CHANGELOG.md': renderChangelog(rec),
});
/** A backlog table row as its six fields (the notes keep any " | " a hand edit left in them). */
export function parseBacklogRow(line) {
  const c = line
    .slice(2, line.endsWith(' |') ? -2 : -1)
    .split(/(?<!\\) \| /)
    .map(s => s.replace(/\\\|/g, '|'));
  return [c[0], c[1], c[2], c[3], c[4], c.slice(5).join(' | ')];
}

// ------------------------------------------------------------------------------------------------ the import (B-92)
const unescapeMd = s => s.replace(/\\([\\`*_{}[\]()#+\-.!<>|~])/g, '$1');
/** The body rows of a Markdown table (header and separator dropped), as cell arrays. */
export function mdRows(md) {
  const rows = md.split('\n').filter(l => l.startsWith('| ') && !/^\| ?---/.test(l));
  return rows.slice(1).map(l => l.slice(2, -2).split(' | ').map(unescapeMd));
}
const DECISION_REFS = [
  { re: /\bsupersed(?:es|ing) (D-\d{3})/g, rel: 'supersedes' },
  { re: /\b(?:refines|amends|narrows|withdraws) (D-\d{3})/g, rel: 'amends' },
  { re: /\bclause of (D-\d{3}) withdrawn/g, rel: 'amends' },
];
/** Decisions from the Decisions tab (Date | ID | Decision | Why | Status), with supersedes and amends read from the text. */
export function importDecisions(md) {
  const out = mdRows(md).map(([date, id, title, why, status]) => ({
    id,
    date,
    title,
    why,
    status: status.toLowerCase(),
    supersedes: [],
    amends: [],
  }));
  const byId = Object.fromEntries(out.map(d => [d.id, d]));
  for (const d of out) {
    for (const { re, rel } of DECISION_REFS)
      for (const m of d.title.matchAll(re)) if (m[1] !== d.id && !d[rel].includes(m[1])) d[rel].push(m[1]);
    // "(narrowed by D-139: ...)" in D-136 is D-139 amending D-136.
    for (const m of d.title.matchAll(/\bnarrowed by (D-\d{3})/g))
      if (byId[m[1]] && !byId[m[1]].amends.includes(d.id)) byId[m[1]].amends.push(d.id);
    for (const m of d.title.matchAll(/\bsuperseded by (D-\d{3})/gi))
      if (byId[m[1]] && !byId[m[1]].supersedes.includes(d.id)) byId[m[1]].supersedes.push(d.id);
  }
  return out;
}

/** A Docs read's prose XML as {rev, rows: [{id, h, cells: [{id, h, text, dropdown}]}]} for one table (ids in full). */
export function parseTableXml(xml) {
  let session = null;
  // A read prints a session's first id in full and later ones short (.90 is <that session>.90).
  const full = id => {
    if (id.startsWith('.')) return session + id;
    session = id.split('.')[0];
    return id;
  };
  const ent = s =>
    s
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
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
/** The text of one paragraph in a prose read, with its id. */
export function parseParagraphXml(xml, id) {
  const ent = s =>
    s
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  const rev = Number((xml.match(/<doc [^>]*rev='(\d+)'/) || [])[1]);
  const i = xml.indexOf(`<paragraph id='${id}'`);
  if (i < 0) return null;
  const end = xml.indexOf('</paragraph>', i);
  const body = xml.slice(i, end),
    h = (body.match(/\bh='([^']+)'/) || [])[1];
  return { rev, h, text: ent(body.replace(/<[^>]+>/g, '')) };
}

// A deploy sentence names a target and a commit it put there; these are the words that say so.
const DEPLOY_VERB =
  /\b(deployed|redeployed|republished|deploy to|at builds?|builds? [0-9a-f]{7}|at [0-9a-f]{7}|then live|live on|staging: )/i;
const NOT_DEPLOYED =
  /\b(?:from|was|stays at|redeploy of|since|ahead of|runs at|proof runs at|until)\s+(?:a |the )?([0-9a-f]{7})\b|\b([0-9a-f]{7}) plus notes/g;
/** A Changelog line's sentences: split at ". " and "; " outside parentheses, never after "E.V". */
function sentences(text) {
  const out = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (
      !depth &&
      (c === '.' || c === ';') &&
      text[i + 1] === ' ' &&
      !(c === '.' && /E\.V$/.test(text.slice(Math.max(0, i - 3), i)))
    ) {
      out.push(text.slice(start, i));
      start = i + 2;
    }
  }
  out.push(text.slice(start));
  return out.filter(Boolean);
}
/** The target(s) a deploy sentence names: both for "staging then live" or "staging and live", else the first named. */
function targetsOf(s) {
  if (/staging (?:\([^)]*\) )?then live|staging and live/i.test(s)) return ['staging', 'live'];
  const l = s.search(/\blive\b/i),
    st = s.search(/\bstaging\b/i);
  if (/^Live stays/i.test(s)) return [];
  if (l < 0 && st < 0) return [];
  return [st >= 0 && (l < 0 || st < l) ? 'staging' : 'live'];
}
/**
 * Deploys from the Changelog's v4 rows (Date | Change | Why | Decision), sentence by sentence: each sentence that
 * deploys names its target(s) and the commits it put there (one entry each), the time when given (CT), the OK, the
 * verify result and the rollback commit. Each entry keeps its row whole in `line`, so nothing is lost to the parse.
 */
export function importDeploys(rows, { year = 2026, isCommit = () => true } = {}) {
  const out = [];
  for (const r of rows) {
    if (!/^Oct (1[89]|[23]\d)$/.test(r.date)) continue; // v4 deploys start Oct 18; earlier rows are v3's
    const day = String(Number(r.date.slice(4))).padStart(2, '0'),
      row = [];
    const rollback =
      (r.change.match(/Rollback is a redeploy of ([0-9a-f]{7})/) ||
        r.change.match(/\b(?:from|was) ([0-9a-f]{7})\b/) ||
        [])[1] || null;
    const verifyOf = target => {
      const v = (r.change.match(new RegExp(`verify-deploy (?:staging and live|${target})[^.;]*`, 'i')) ||
        r.change.match(/verify-deploy[^.;]*/i) || [''])[0];
      return /green/i.test(v) ? (/but for|except/i.test(v) ? 'green with exceptions' : 'green') : v ? 'red' : null;
    };
    let carried = null; // "Staging redeployed three times: at d69f67b, ..." carries its target into the next sentence
    for (const s of sentences(r.change)) {
      if (!DEPLOY_VERB.test(s) || /^verify-deploy|^Rollback/i.test(s.trim())) continue;
      let targets = targetsOf(s);
      if (!targets.length && carried) targets = carried;
      if (!targets.length) continue;
      carried = targets;
      const not = new Set([...s.matchAll(NOT_DEPLOYED)].map(m => m[1] || m[2]));
      const shas = [...new Set([...s.matchAll(/\b([0-9a-f]{7})\b/g)].map(m => m[1]))].filter(
        x => /\d/.test(x) && !not.has(x) && isCommit(x)
      );
      if (!shas.length) continue;
      const times = [...s.matchAll(/\((\d{1,2}):(\d\d) CT\)/g)].map(m => `${m[1].padStart(2, '0')}:${m[2]}`);
      targets.forEach((target, i) => {
        const clock = times[Math.min(i, times.length - 1)];
        for (const commit of shas)
          row.push({
            target,
            commit,
            time: clock ? `${year}-10-${day}T${clock}:00-05:00` : `${year}-10-${day}`,
            okFrom: target === 'live' ? 'Matt' : null,
            verify: verifyOf(target),
            rollback: target === 'live' ? rollback : null,
            tasks: [...new Set(ids(r.change).filter(x => x.startsWith('B-')))],
            line: { date: r.date, change: r.change, why: r.why, decision: r.decision },
            source: 'Changelog tab',
          });
      });
    }
    out.push(...row.reverse()); // the tab is newest first, so is a row's own order once reversed with it
  }
  return out.reverse(); // oldest first
}

/** Board rows "v4 B-nn: ..." (and "v4 B-nn to B-mm: ...") onto their tasks, in order where an id repeats (B-83). */
function attachBoard(tasks, boardRows) {
  const seen = {};
  for (const r of boardRows) {
    const m = r.cells[0].text.match(/^v4 (B-\d{2})(?: to (B-\d{2}))?: /);
    if (!m) continue;
    const n = (seen[m[1]] = (seen[m[1]] || 0) + 1);
    const t = tasks.filter(x => x.id === m[1])[n - 1];
    if (!t) continue;
    const status = r.cells[2].dropdown ? null : r.cells[2].text;
    const waiting = r.cells[2].text === 'Waiting on Matt';
    t.board = {
      row: r.cells[0].text,
      why: r.cells[1].text,
      notes: r.cells[3].text,
      ...(m[2] ? { covers: rangeIds(m[1], m[2]) } : {}),
    };
    if (waiting) t.waitingOn = 'Matt';
    if (status && status !== 'Waiting on Matt') t.board.was = status;
  }
}
const rangeIds = (a, b) => {
  const out = [];
  for (let i = Number(a.slice(2)); i <= Number(b.slice(2)); i++) out.push('B-' + String(i).padStart(2, '0'));
  return out;
};

/** The commit a done task names in its notes (one this repository has), else the newest commit whose subject leads with its id. */
export function commitFinder(root) {
  const has = sha => {
    try {
      git(root, ['rev-parse', '--verify', '-q', sha + '^{commit}']);
      return true;
    } catch {
      return false;
    }
  };
  const subjects = git(root, ['log', '--format=%h %s'])
    .split('\n')
    .filter(Boolean)
    .map(l => [l.slice(0, l.indexOf(' ')), l.slice(l.indexOf(' ') + 1)]);
  const leads = (subject, id) => {
    const lead = subject.split(':')[0];
    return ids(lead).includes(id);
  };
  return {
    isCommit: has,
    commitOf(id, notes) {
      for (const m of String(notes || '').matchAll(/\b([0-9a-f]{7,12})\b/g))
        if (/[a-f]/.test(m[1]) && /\d/.test(m[1]) && has(m[1])) return m[1].slice(0, 7);
      const mine = subjects.filter(([, s]) => leads(s, id));
      const work = mine.find(([, s]) => !/^[^:]*: (done|in progress|blocked)\b/.test(s));
      return (work || mine[0] || [])[0] || null;
    },
  };
}

/**
 * The one-time import: BACKLOG.md as it stood (row for row), the Decisions tab, the Board and Changelog tables (from
 * their Docs reads, so the views compare like with like) and the doc locations. commitOf(id, notes) finds a done
 * task's commit; isCommit(sha) says whether a short sha is one of this repository's.
 */
export function importChart({
  backlog,
  decisionsMd,
  boardXml,
  changelogXml,
  commitOf = () => null,
  isCommit = () => true,
  views,
}) {
  const tasks = backlog
    .split('\n')
    .filter(l => l.startsWith('| B-'))
    .map(l => {
      const [id, text, deps, milestone, status, notes] = parseBacklogRow(l);
      const k = text.indexOf(' Done when: ');
      const depends = deps === '—' ? [] : ids(deps).filter(x => x.startsWith('B-'));
      const t = {
        id,
        kind: 'task',
        title: k < 0 ? text : text.slice(0, k),
        dod: k < 0 ? null : text.slice(k + 12),
        milestone,
        status,
        depends,
      };
      if (deps !== '—' && deps !== depends.join(', ')) t.dependsText = deps;
      return { ...t, notes, commit: status === 'done' ? commitOf(id, notes) : null, source: 'BACKLOG.md' };
    });
  const board = parseTableXml(boardXml).rows.slice(1);
  attachBoard(tasks, board);
  const changelog = parseTableXml(changelogXml)
    .rows.slice(1)
    .map(r => ({ date: r.cells[0].text, change: r.cells[1].text, why: r.cells[2].text, decision: r.cells[3].text }));
  return {
    tasks,
    decisions: importDecisions(decisionsMd),
    deploys: importDeploys(changelog, { isCommit }),
    rules: RULES,
    views,
  };
}

// The rules commands enforce, as the import seeded chart/rules.json (later ones arrive through log rule). `check` names the function in ship that checks it.
export const RULES = [
  {
    id: 'R-01',
    rule: "While D-085's rollback window is open (B-30 not done), a live deploy changes no stored document, pipeline step, prompt, schema or migration since the live build; anything else waits for the window to close",
    decision: 'D-139',
    task: 'B-30',
    command: 'ship live',
    check: 'pageOnlyLive',
  },
  {
    id: 'R-02',
    rule: 'A build reaches live only through staging: verify-deploy staging green at the same commit',
    decision: 'D-049',
    task: 'B-35',
    command: 'ship live (deploy live)',
    check: 'stagingGate',
  },
  {
    id: 'R-03',
    rule: "A live deploy waits while a study session or skills run is going on live (an explicit --during-session on Matt's OK overrides)",
    decision: 'D-139',
    task: 'B-87',
    command: 'ship live (deploy live)',
    check: 'sessionGate',
  },
  {
    id: 'R-04',
    rule: "A live deploy needs Matt's explicit OK in the chat",
    decision: 'D-083',
    task: null,
    command: 'ship live (deploy live --matt-ok)',
    check: 'mattOk',
  },
];
/**
 * R-05 (B-102): the live watchdog window `now` falls in, from the watchdog's cron schedule, as {run, opens}: the run
 * it surrounds and when live deploys may go again; null outside every window.
 */
export function watchdogWindow(schedule, now = new Date(), margin = 10) {
  const m = margin * 60e3;
  const run = nextRuns({ watchdog: { schedule } }, new Date(now.getTime() - m))
    .map(r => r.at)
    .find(at => now >= at.getTime() - m && now < at.getTime() + m);
  return run ? { run, opens: new Date(run.getTime() + m) } : null;
}
/** ship live's R-05 refusal at `now`, or null outside the windows. */
export function watchdogRefusal(schedule, now = new Date()) {
  const w = watchdogWindow(schedule, now);
  return w
    ? `R-05 (D-142): the live watchdog runs at ${ctClock(w.run.toISOString())} CT; live deploys wait until ${ctClock(w.opens.toISOString())} CT`
    : null;
}
// What R-01 protects: the paths and spec keys whose change makes a deploy more than page-only.
export const PAGE_ONLY = {
  paths: [
    /^spec\/schemas\//,
    /^core\/migrate\.mjs$/,
    /^core\/steps\.mjs$/,
    /^core\/run\.mjs$/,
    /^tools\/prompts\.mjs$/,
    /^scripts\//,
  ],
  specKeys: ['pipelines', 'tasks', 'collections', 'jobs', 'legacyCollections'],
};

// ------------------------------------------------------------------------------------------------ lint (B-94)
/**
 * The record against its rules. Errors: a duplicate id, a dependency on a task that doesn't exist, a rule resting on a
 * superseded or missing decision, a done task with no commit, a malformed entry. Warnings: an inbox entry left
 * untriaged (log refuses to start a task while one waits, so triage comes first). Returns [{level, check, id, detail}].
 */
export function lintChart(rec, { tests = {}, spec = null } = {}) {
  const out = [],
    add = (level, check, id, detail) => out.push({ level, check, id, detail });
  const seen = {};
  for (const t of rec.tasks) seen[t.id] = (seen[t.id] || 0) + 1;
  for (const [id, n] of Object.entries(seen))
    if (n > 1)
      add(
        'error',
        'duplicate-id',
        id,
        `${n} tasks carry ${id}: ${rec.tasks
          .filter(t => t.id === id)
          .map(t => `"${t.title.slice(0, 50)}"`)
          .join(' and ')}`
      );
  const dseen = {};
  for (const d of rec.decisions) dseen[d.id] = (dseen[d.id] || 0) + 1;
  for (const [id, n] of Object.entries(dseen))
    if (n > 1) add('error', 'duplicate-id', id, `${n} decisions carry ${id}`);
  const known = new Set(rec.tasks.map(t => t.id)),
    decisions = Object.fromEntries(rec.decisions.map(d => [d.id, d]));
  for (const t of rec.tasks) {
    for (const d of t.depends || [])
      if (!known.has(d)) add('error', 'missing-dependency', t.id, `depends on ${d}, which is not in the record`);
    if (t.status === 'done' && !t.commit) add('error', 'done-without-commit', t.id, 'done with no commit');
    if (!TASK_STATUS.includes(t.status)) add('error', 'bad-status', t.id, `status "${t.status}"`);
    if (!TASK_KINDS.includes(t.kind)) add('error', 'bad-kind', t.id, `kind "${t.kind}"`);
    if (t.status === 'inbox')
      add(
        'warn',
        'untriaged',
        t.id,
        `in the inbox since ${t.reportedAt}: triage it (log ${t.id} --triage task|join|decline) before taking a task`
      );
    if (t.kind !== 'task' && !(t.words && t.source && t.reportedAt))
      add('error', 'bad-report', t.id, 'a report needs its words, source and time');
    if (t.status === 'declined' && !(t.triage && t.triage.reason))
      add('error', 'declined-without-reason', t.id, 'declined with no reason');
    if (t.triage && t.triage.into && !known.has(t.triage.into))
      add('error', 'missing-dependency', t.id, `joined ${t.triage.into}, which is not in the record`);
  }
  for (const d of rec.decisions) {
    if (!DECISION_STATUS.includes(d.status)) add('error', 'bad-status', d.id, `status "${d.status}"`);
    for (const x of [...d.supersedes, ...d.amends])
      if (!decisions[x]) add('error', 'missing-decision', d.id, `names ${x}, which is not in the record`);
    if (!DECISION_KINDS.includes(kindOf(d))) add('error', 'bad-kind', d.id, `kind "${d.kind}"`);
    if (kindOf(d) === 'tenet') {
      if (!(d.scope || []).length || d.scope.some(x => !TENET_SCOPES.includes(x)))
        add(
          'error',
          'tenet-scope',
          d.id,
          `scope "${(d.scope || []).join(', ')}": one or more of ${TENET_SCOPES.join(', ')}`
        );
      if (!TENET_CHECKS.includes(d.check))
        add('error', 'tenet-check', d.id, `checked by "${d.check}": one of ${TENET_CHECKS.join(', ')}`);
    }
  }
  // A superseded tenet still cited by an open task or a test: sweep it (a task that also cites the tenet that
  // superseded it is the sweep itself). A rule resting on one is caught below.
  const superseder = id => rec.decisions.filter(x => x.supersedes.includes(id)).map(x => x.id);
  const oldTenets = rec.decisions.filter(d => kindOf(d) === 'tenet' && d.status === 'superseded');
  for (const d of oldTenets) {
    const by = superseder(d.id),
      byText = by.length ? ` (superseded by ${by.join(', ')})` : '';
    for (const t of rec.tasks) {
      if (!['open', 'in progress', 'blocked'].includes(t.status)) continue;
      const cited = ids([t.title, t.dod, t.notes].join(' '));
      if (cited.includes(d.id) && !by.some(x => cited.includes(x)))
        add(
          'error',
          'superseded-tenet',
          t.id,
          `cites ${d.id}${byText}: bring it in line, or name it in the sweep task`
        );
    }
    for (const [file, text] of Object.entries(tests))
      if (ids(text).includes(d.id)) add('error', 'superseded-tenet', file, `cites ${d.id}${byText}`);
  }
  const rseen = {};
  for (const r of rec.rules) {
    rseen[r.id] = (rseen[r.id] || 0) + 1;
    const d = decisions[r.decision];
    if (!d) add('error', 'rule-decision', r.id, `rests on ${r.decision}, which is not in the record`);
    else if (d.status === 'superseded')
      add(
        'error',
        'rule-decision',
        r.id,
        `rests on ${r.decision}, which is superseded${rec.decisions
          .filter(x => x.supersedes.includes(d.id))
          .map(x => ' by ' + x.id)
          .join('')}`
      );
    if (r.task && !known.has(r.task))
      add('error', 'missing-dependency', r.id, `names ${r.task}, which is not in the record`);
  }
  for (const [id, n] of Object.entries(rseen)) if (n > 1) add('error', 'duplicate-id', id, `${n} rules carry ${id}`);
  // B-142 (W-7): stale flags, each a small lie the next session reads as true. A finished task still waiting on
  // someone; a rule still enforced whose own condition is a task now done (R-01's "B-30 not done"); a retired task's
  // reason that leans on a superseded decision.
  for (const t of rec.tasks)
    if (t.waitingOn && ['done', 'declined'].includes(t.status))
      add('warn', 'stale-waiting', t.id, `is ${t.status} but still waiting on ${t.waitingOn}`);
  const taskOf = Object.fromEntries(rec.tasks.map(t => [t.id, t]));
  for (const r of rec.rules)
    if (!r.ended && r.task && ids(r.rule).includes(r.task) && taskOf[r.task] && taskOf[r.task].status === 'done')
      add(
        'warn',
        'stale-rule',
        r.id,
        `still enforced, but ${r.task} is done: mark it ended (log rule ${r.id} --ended "D-...")`
      );
  const superseded = new Set(rec.decisions.filter(d => d.status === 'superseded').map(d => d.id));
  for (const x of ((spec && spec.tasks && spec.tasks.retired) || []).filter(x => x && x.reason)) {
    const cited = ids(x.reason);
    // Citing a superseded decision is fine beside the one that superseded it ("D-145 closed the rollback (D-085)").
    const stale = cited.filter(
      i => superseded.has(i) && !rec.decisions.some(d => cited.includes(d.id) && (d.supersedes || []).includes(i))
    );
    if (stale.length)
      add('warn', 'stale-retired', x.trigger || x.name, `retired reason cites ${stale.join(', ')}, superseded`);
  }
  for (const d of rec.deploys)
    if (!['staging', 'live'].includes(d.target) || !d.commit)
      add('error', 'bad-deploy', d.commit || '?', `deploy to ${d.target} with commit ${d.commit}`);
  return out;
}
export function formatLint(findings) {
  const e = findings.filter(f => f.level === 'error').length,
    w = findings.length - e;
  return [
    `chart lint: ${e ? 'RED' : 'GREEN'}: ${e} error${e === 1 ? '' : 's'}, ${w} warning${w === 1 ? '' : 's'}`,
    ...findings.map(f => `  ${f.level === 'error' ? 'NO ' : 'warn'} ${f.check} ${f.id}: ${f.detail}`),
  ].join('\n');
}

// ------------------------------------------------------------------------------------------------ the views
export const tenetLabel = d => `Tenet (${(d.scope || []).join(', ')}; checked by ${d.check}): `;
const tabTitle = d => (kindOf(d) === 'tenet' ? tenetLabel(d) : '') + d.title;
// Board status: the record's status in the Board's own words (its Status dropdown), or plain text where it has none.
export function boardStatus(t, rec) {
  if (t.status === 'inbox') return { text: 'New report' };
  if (t.status === 'declined') return { text: t.triage && t.triage.into ? `Joined ${t.triage.into}` : 'Declined' };
  if (t.waitingOn && t.status !== 'done') return { option: 'Waiting on Matt' };
  if (t.status === 'blocked') return { option: 'Waiting on Matt' };
  return { option: { done: 'Done', 'in progress': 'In progress', open: 'Next' }[t.status] };
}
export const boardName = t => (t.board && t.board.row) || `v4 ${t.id}: ${t.name || t.title.split(/[:(]/)[0].trim()}`;
/** The Board row the record says a task has: [task, why, status, notes]. */
export function boardRow(t, rec) {
  const b = t.board || {};
  const notes =
    t.status === 'declined'
      ? `${t.triage.reason}${b.notes ? '. ' + b.notes : ''}`
      : b.notes != null
        ? b.notes
        : t.notes;
  return { name: boardName(t), why: b.why != null ? b.why : t.words || t.title, status: boardStatus(t, rec), notes };
}

const docCall = (doc, node, ops) => ({
  tool: 'mcp__Claude_Docs__update',
  args: {
    ref: { object: 'node', id: node },
    engine: 'prose',
    container: { kind: 'project', id: doc },
    payload: { ops },
  },
});
const textCell = s => ({
  type: 'cell',
  content: [{ type: 'paragraph', content: s ? [{ type: 'text', text: s }] : [] }],
});
const sameStatus = (c, want, opts) =>
  want.option != null ? c.dropdown && opts[c.dropdown.index] === want.option : !c.dropdown && c.text === want.text;

/**
 * The calls that make the Board match the record, from a read of its table. Changed cells are replaced in place by
 * position (guarded on the read's rev); a task with no row gets one at the end (its status as text: the dropdown
 * chip goes in on the next run, which sees the text and replaces it).
 */
export function boardCalls(rec, read) {
  const v = rec.views.board,
    opts = v.statusOptions,
    calls = [],
    notes = [];
  const rows = read.rows.slice(1),
    ops = [];
  const used = new Set();
  for (const t of rec.tasks.filter(t => t.board || t.kind !== 'task')) {
    const want = boardRow(t, rec);
    const names = [want.name, ...((t.board && t.board.were) || [])];
    const i = rows.findIndex((r, k) => !used.has(k) && names.includes(r.cells[0].text));
    if (i < 0) {
      ops.push({
        op: 'insert',
        target: { kind: 'blocks', ids: [v.table] },
        side: 'end',
        source: {
          as: 'blocks',
          from: {
            kind: 'inline',
            content: [
              {
                type: 'row',
                content: [
                  textCell(want.name),
                  textCell(want.why),
                  textCell(want.status.option || want.status.text),
                  textCell(want.notes),
                ],
              },
            ],
          },
        },
      });
      notes.push(`${t.id}: a new row`);
      continue;
    }
    used.add(i);
    const r = rows[i],
      row = i + 1;
    const replace = (col, md, blocks) =>
      ops.push({
        op: 'replace',
        target: { kind: 'cell', table: v.table, row, col },
        ifRev: read.rev,
        with: { as: 'markdown', from: { kind: 'inline', content: md }, ...(blocks ? { blocks } : {}) },
      });
    if (r.cells[0].text !== want.name) {
      replace(0, mdEscape(want.name));
      notes.push(`${t.id}: name "${r.cells[0].text}" -> "${want.name}"`);
    }
    if (r.cells[1].text !== want.why) {
      replace(1, mdEscape(want.why));
      notes.push(`${t.id}: why`);
    }
    if (!sameStatus(r.cells[2], want.status, opts)) {
      if (want.status.option != null)
        replace(2, '<?claude block st?>', {
          st: { type: 'dropdown', enum: v.statusEnum, index: opts.indexOf(want.status.option) },
        });
      else replace(2, mdEscape(want.status.text));
      notes.push(
        `${t.id}: status ${r.cells[2].dropdown ? opts[r.cells[2].dropdown.index] : `"${r.cells[2].text}"`} -> ${want.status.option || want.status.text}`
      );
    }
    if (r.cells[3].text !== want.notes) {
      replace(3, mdEscape(want.notes));
      notes.push(`${t.id}: notes`);
    }
  }
  if (ops.length) calls.push({ step: `Board: ${notes.join('; ')}`, ...docCall(rec.views.doc, v.node, ops) });
  return calls;
}
const mdEscape = s => String(s).replace(/([\\`*_[\]<>|])/g, '\\$1');

/** The Changelog line the record gives a deploy (newest first in the tab), unless it came from the tab itself. */
export function changelogLine(d) {
  if (d.line) return d.line;
  const at = d.time && d.time.length > 10 ? ` (${ctClock(d.time)} CT)` : '';
  const verify = d.verify ? ` verify-deploy ${d.target} ${d.verify === 'green' ? 'GREEN' : d.verify}.` : '';
  const live =
    d.target === 'live' ? ` Rollback is a redeploy of ${d.rollback || '(none named)'}` : ' Live stays where it is';
  const notes = (d.notes || []).map(n => ` Note: ${n}`).join('');
  const change = `v4 ${d.target} deployed at ${d.commit}${at}${d.from ? `, from ${d.from}` : ''}: ${d.summary || 'see the tasks'}${d.tasks && d.tasks.length ? ` (${d.tasks.join(', ')})` : ''}.${verify}${live}${notes}`;
  return {
    date: ctDate(d.time),
    change: change.replace(/\.\./g, '.'),
    why:
      d.why ||
      (d.target === 'live'
        ? `Matt's OK${d.okFrom && d.okFrom !== 'Matt' ? ' (' + d.okFrom + ')' : ''}`
        : 'The B-35 gate: staging first'),
    decision: (d.decisions || []).join(', ') || 'D-049',
  };
}
export function changelogCalls(rec, read) {
  const v = rec.views.changelog,
    have = new Set(read.rows.slice(1).map(r => r.cells[1].text));
  const header = read.rows[0].id,
    rows = [],
    notes = [];
  for (const d of rec.deploys.filter(d => !d.line)) {
    const l = changelogLine(d);
    if (have.has(l.change)) continue;
    rows.push({ type: 'row', content: [textCell(l.date), textCell(l.change), textCell(l.why), textCell(l.decision)] });
    notes.push(`${d.target} ${d.commit}`);
  }
  // One insert right under the header, newest first (Docs refuses two inserts on one anchor: they would read reversed).
  const ops = rows.length
    ? [
        {
          op: 'insert',
          target: { kind: 'blocks', ids: [header] },
          side: 'after',
          source: { as: 'blocks', from: { kind: 'inline', content: rows.reverse() } },
        },
      ]
    : [];
  return ops.length ? [{ step: `Changelog: ${notes.join(', ')}`, ...docCall(rec.views.doc, v.node, ops) }] : [];
}
/** The Decisions tab: a row per decision logged since the import (newest on top), its Status chip, and the intro's next id. */
export function decisionsCalls(rec, read, intro) {
  const v = rec.views.decisions;
  if (!v) return [];
  const ops = [],
    notes = [],
    added = [];
  const rows = read.rows.slice(1),
    header = read.rows[0].id,
    opts = v.statusOptions;
  const word = d => d.status.charAt(0).toUpperCase() + d.status.slice(1);
  for (const d of [...rec.decisions].reverse()) {
    const i = rows.findIndex(r => r.cells[1].text === d.id);
    if (i < 0) {
      if (!d.source) continue; // imported (B-92): its row was in the tab; one filed since (log, plan) is added
      added.push({
        type: 'row',
        content: [textCell(d.date), textCell(d.id), textCell(tabTitle(d)), textCell(d.why), textCell(word(d))],
      });
      notes.push(`${d.id}: a new row`);
      continue;
    }
    // A tenet's row says so (B-109), also when an imported decision is given the kind later.
    if (kindOf(d) === 'tenet' && !rows[i].cells[2].text.startsWith(tenetLabel(d))) {
      ops.push({
        op: 'replace',
        target: { kind: 'cell', table: v.table, row: i + 1, col: 2 },
        ifRev: read.rev,
        with: { as: 'markdown', from: { kind: 'inline', content: mdEscape(tabTitle(d)) } },
      });
      notes.push(`${d.id}: a tenet`);
    }
    if (d.restated)
      for (const [col, text] of [
        [2, tabTitle(d)],
        [3, d.why || ''],
      ])
        if (rows[i].cells[col].text !== text) {
          ops.push({
            op: 'replace',
            target: { kind: 'cell', table: v.table, row: i + 1, col },
            ifRev: read.rev,
            with: { as: 'markdown', from: { kind: 'inline', content: mdEscape(text) } },
          });
          notes.push(`${d.id}: ${col === 2 ? 'restated' : 'why'}`);
        }
    const c = rows[i].cells[4];
    if (!sameStatus(c, { option: word(d) }, opts)) {
      ops.push({
        op: 'replace',
        target: { kind: 'cell', table: v.table, row: i + 1, col: 4 },
        ifRev: read.rev,
        with: {
          as: 'markdown',
          from: { kind: 'inline', content: '<?claude block st?>' },
          blocks: { st: { type: 'dropdown', enum: v.statusEnum, index: opts.indexOf(word(d)) } },
        },
      });
      notes.push(`${d.id}: status ${word(d)}`);
    }
  }
  // One insert under the header, newest first (Docs refuses two inserts on one anchor).
  if (added.length)
    ops.unshift({
      op: 'insert',
      target: { kind: 'blocks', ids: [header] },
      side: 'after',
      source: { as: 'blocks', from: { kind: 'inline', content: added.reverse() } },
    });
  const m = intro && intro.text.match(/next id (D-\d{3})/),
    next = nextDecisionId(rec);
  if (m && m[1] !== next) {
    ops.push({
      op: 'replace',
      target: { kind: 'find', text: m[0] },
      with: { as: 'text', from: { kind: 'inline', content: `next id ${next}` } },
    });
    notes.push(`next id ${next}`);
  }
  // Cell replaces address rows by position on the table as read, so they go before an insert that would shift them.
  ops.sort((a, b) => (a.op === 'insert') - (b.op === 'insert'));
  return ops.length ? [{ step: `Decisions: ${notes.join('; ')}`, ...docCall(rec.views.doc, v.node, ops) }] : [];
}
const STATUS_LINE = /on build ([0-9a-f]{7,}) since (\S+?) on ([A-Z][a-z]{2} \d{1,2})/;
/** The overview doc's status line: the build live runs and since when, from the newest live deploy. */
export function overviewCalls(rec, para) {
  const live = rec.deploys.filter(d => d.target === 'live').at(-1);
  if (!live || !para) return [];
  const m = para.text.match(STATUS_LINE);
  if (!m)
    return [
      {
        note: `the overview's status line no longer reads "on build <commit> since <time> on <date>"; nothing printed`,
      },
    ];
  const want = `on build ${live.commit} since ${live.time.length > 10 ? ctTwelve(live.time) : 'the deploy'} on ${ctDate(live.time)}`;
  if (m[0] === want) return [];
  const v = rec.views.overview;
  return [
    {
      step: `overview status line: "${m[0]}" -> "${want}"`,
      ...docCall(v.doc, v.node, [
        {
          op: 'replace',
          target: { kind: 'find', text: m[0] },
          with: { as: 'text', from: { kind: 'inline', content: want } },
        },
      ]),
    },
  ];
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
/**
 * The newest read of each view in a transcript (a Claude_Docs read whose parentId is the view's table or paragraph),
 * and whether a Docs update to that node came after it (then the read is stale).
 */
// The Claude Docs connector's tools: named Claude_Docs in most sessions, by the connector's id in others.
const DOCS = '(?:Claude_Docs|1a59c906-04da-521d-bda7-7f71b9f9e01c)__';
export const isDocsTool = (name, tool) => new RegExp(DOCS + '(?:' + tool + ')$').test(String(name));
export function viewReads(rec, jsonl) {
  const all = toolResults(jsonl, '*');
  const isRead = r => isDocsTool(r.name, 'read'),
    isUpdate = r => isDocsTool(r.name, 'update|batch');
  const want = {
    board: [rec.views.board.node, rec.views.board.table],
    changelog: [rec.views.changelog.node, rec.views.changelog.table],
    overview: [rec.views.overview.node, rec.views.overview.paragraph],
  };
  if (rec.views.decisions)
    Object.assign(want, {
      decisions: [rec.views.decisions.node, rec.views.decisions.table],
      decisionsIntro: [rec.views.decisions.node, rec.views.decisions.intro],
    });
  const out = {};
  for (const [k, [node, parent]] of Object.entries(want)) {
    let at = -1;
    all.forEach((r, i) => {
      if (
        isRead(r) &&
        r.input &&
        r.input.ref &&
        r.input.ref.id === node &&
        r.input.payload &&
        r.input.payload.parentId === parent &&
        !r.isError
      )
        at = i;
    });
    const updated = all.some((r, i) => i > at && isUpdate(r) && r.input && r.input.ref && r.input.ref.id === node);
    out[k] = at < 0 ? { missing: true } : { stale: updated, body: readBody(all[at].texts) };
  }
  return out;
}
export const readCall = (doc, node, parentId) => ({
  tool: 'mcp__Claude_Docs__read',
  args: {
    ref: { object: 'node', id: node },
    engine: 'prose',
    container: { kind: 'project', id: doc },
    payload: { kind: 'view', parentId },
  },
});
/** Views: the reads still to make, else the calls. which: the views to cover (default all three). */
export function viewsPlan(
  rec,
  reads,
  which = ['board', 'changelog', 'overview', ...(rec.views.decisions ? ['decisions', 'decisionsIntro'] : [])]
) {
  const v = rec.views,
    needs = [],
    calls = [],
    notes = [];
  const call = {
    board: () => readCall(v.doc, v.board.node, v.board.table),
    changelog: () => readCall(v.doc, v.changelog.node, v.changelog.table),
    overview: () => readCall(v.overview.doc, v.overview.node, v.overview.paragraph),
    decisions: () => readCall(v.doc, v.decisions.node, v.decisions.table),
    decisionsIntro: () => readCall(v.doc, v.decisions.node, v.decisions.intro),
  };
  for (const k of which) {
    const r = reads[k];
    if (!r || r.missing || r.stale || !r.body) {
      needs.push({
        view: k,
        ...call[k](),
        why:
          !r || r.missing
            ? 'no read in this session'
            : r.stale
              ? 'updated since the last read'
              : 'the last read was refused',
      });
      continue;
    }
    if (k === 'board') calls.push(...boardCalls(rec, parseTableXml(r.body.xml)));
    if (k === 'changelog') calls.push(...changelogCalls(rec, parseTableXml(r.body.xml)));
    if (k === 'decisions')
      calls.push(
        ...decisionsCalls(
          rec,
          parseTableXml(r.body.xml),
          reads.decisionsIntro && reads.decisionsIntro.body && !reads.decisionsIntro.stale
            ? parseParagraphXml(reads.decisionsIntro.body.xml, v.decisions.intro)
            : null
        )
      );
    if (k === 'overview')
      for (const c of overviewCalls(rec, parseParagraphXml(r.body.xml, v.overview.paragraph)))
        (c.note ? notes : calls).push(c.note || c);
  }
  return { needs, calls, notes };
}
export function formatViews(plan) {
  const out = [];
  if (plan.needs.length) {
    out.push(
      `views: ${plan.needs.length} read${plan.needs.length === 1 ? '' : 's'} first (the results stay in this session's transcript; nothing to save), then run views again:`
    );
    for (const n of plan.needs) out.push(`  ${n.view} (${n.why}): ${n.tool}`, '  ' + JSON.stringify(n.args));
  }
  if (plan.calls.length) {
    out.push(
      `views: ${plan.calls.length} call${plan.calls.length === 1 ? '' : 's'}. Make each exactly as printed, then read the view again and run views (in step when it prints nothing to do).`
    );
    plan.calls.forEach((c, i) => out.push('', `${i + 1}. ${c.step}: ${c.tool}`, JSON.stringify(c.args)));
  }
  for (const n of plan.notes) out.push('note: ' + n);
  if (!plan.needs.length && !plan.calls.length) out.push('views: in step with the record; nothing to do');
  return out.join('\n');
}

// ------------------------------------------------------------------------------------------------ log, report
/** One change to the record. Returns {rec, what, views: [view names it touches]}; throws on a refusal. */
export function applyLog(rec, o, { now = new Date().toISOString() } = {}) {
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
      return { rec, what: `${target} deploy at ${had.commit}: note`, id: 'deploy', views: [] };
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
      views: target === 'live' ? ['changelog', 'overview'] : ['changelog'],
    };
  }
  if (id === 'decision') {
    const did = o._[2];
    if (!/^D-\d{3}$/.test(did || '')) throw new Error('log decision <D-id> --title ...');
    const old = rec.decisions.find(d => d.id === did);
    if (!old && did !== nextDecisionId(rec))
      throw new Error(`the next free decision id is ${nextDecisionId(rec)}, not ${did}`);
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
    // A decision restated after it was filed (Matt, Oct 20: D-123 to D-126 to the UI tenets) carries its new words
    // to the Decisions tab: views replaces its title and why cells while they differ.
    if (old && (o.restated || (o.title && o.title !== d.title) || (o.why && o.why !== d.why))) d.restated = ctDate(now);
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
      views: ['decisions', 'decisionsIntro'],
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
    return { rec, what: `rule ${rid} (${r.check}${r.ended ? ', ended' : ''})`, id: r.task || rid, views: [] };
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
    const at = o.after ? rec.tasks.findIndex(x => x.id === o.after) : -1;
    if (o.after && at < 0) throw new Error(`--after ${o.after}: no such task`);
    rec.tasks.splice(at < 0 ? rec.tasks.length : at + 1, 0, t);
    return { rec, what: `new task (${t.milestone})`, id: nid, views: [] };
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
      t.board.were = [...(t.board.were || []), t.board.row];
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
      const into = o._[2] || o.into;
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
    if (t.status === 'declined' && t.waitingOn) {
      delete t.waitingOn;
      delete t.waitingWhere;
    }
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
      delete t.waitingOn;
      delete t.waitingWhere;
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
  if (o.note != null) {
    t.notes = o.note;
    what.push('notes');
  }
  if (o.name || o.why || o['board-note'] != null || o.board) {
    t.board = t.board || {};
    if (!t.board.row && !o.name && !t.name)
      throw new Error(`${id} has no Board row yet: give --name (its short Board title)`);
    if (o.name) {
      if (t.board.row) {
        t.board.were = [...(t.board.were || []), t.board.row];
      }
      t.board.row = `v4 ${t.id}: ${o.name}`;
    }
    if (o.why) t.board.why = o.why;
    if (o['board-note'] != null) t.board.notes = o['board-note'];
    what.push('board');
  }
  if (o['waiting-on'] != null) {
    if (o['waiting-on']) t.waitingOn = o['waiting-on'];
    else {
      delete t.waitingOn;
      delete t.waitingWhere;
    }
    what.push('waiting on');
  }
  // B-148: where what waits on Matt happens (mac, staging, github, decision).
  if (typeof o.where === 'string') {
    if (!PLACES[o.where]) throw new Error(`--where ${o.where}: one of ${Object.keys(PLACES).join(', ')}`);
    t.waitingWhere = o.where;
    what.push('where');
  }
  if (!what.length) throw new Error('nothing to log: give --status, --note, --commit, --triage or a board field');
  return { rec, what: what.join(', '), id: t.id, views: t.board || t.kind !== 'task' ? ['board'] : [] };
}
export function applyReport(rec, o, { now = new Date().toISOString(), jsonl = null } = {}) {
  const [, kind, ...rest] = o._;
  let words = rest.join(' '),
    at = o.at || null;
  if (o['from-chat']) {
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
  if (!['bug', 'request'].includes(kind) || !words)
    throw new Error(
      'report <bug|request> "<the words as written>" --source <where> | --from-chat ["<words to find>"] | --from-comment <id>'
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
    reportedAt: now,
    board: { row: `v4 ${id}: ${name}`, why: words, notes: `Reported ${ctDate(now)} from ${o.source}` },
  });
  return {
    rec,
    what: `${kind} reported`,
    id,
    views: ['board'],
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
const stripReminders = t =>
  String(t)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
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
  return { words: words.trim(), at: m.at, said: (m.text.match(MARK) || [])[1] };
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
export function pushRecord(root) {
  if (!onMainWithOrigin(root)) return { pushed: false, why: 'no origin', next: null };
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
  git(root, ['commit', '-q', '-m', [message, ...(trailers.length ? ['', ...trailers] : [])].join('\n')]);
  return git(root, ['rev-parse', '--short=7', 'HEAD']).trim();
}

// ------------------------------------------------------------------------------------------------ ship (B-96)
/** R-01: the paths and spec keys a page-only live deploy may not change since the live build. */
export function pageOnlyFindings(root, from, to = 'HEAD') {
  const changed = git(root, ['diff', '--name-only', from, to]).split('\n').filter(Boolean);
  const bad = changed.filter(f => PAGE_ONLY.paths.some(re => re.test(f)));
  const spec = c => {
    try {
      return JSON.parse(git(root, ['show', `${c}:spec/ev.spec.json`]));
    } catch {
      return {};
    }
  };
  const a = spec(from),
    b = spec(to);
  const keys = PAGE_ONLY.specKeys.filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return [...bad.map(f => `${f} changed`), ...keys.map(k => `spec.${k} changed`)];
}
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
const isTaskRead = r => /list_triggers/.test(r.tool),
  isPageRead = r => r.tool === 'Artifact';
const isTaskLine = l => /^(task |scheduled tasks read|retired tasks)/.test(l.what),
  isPageLine = l => /^(\w+ page read|page stamp|published page files|page capability declaration)/.test(l.what);
/**
 * The deploy checklist as one pure step: the refusals; else the reads still to make; else, when verify is green, the
 * deploy to record; else deploy's calls (minus the task and page calls the skips make needless).
 */
export function shipStep({ target, manifest, state, verifyResult, reads, deploy, rec, refusals, skip, stale }) {
  if (refusals.length) return { kind: 'refused', refusals };
  const deployedRead = state.record && state.record.manifest;
  const need = reads.filter(
    r =>
      !(skip.tasks && isTaskRead(r)) &&
      !(skip.pages && isPageRead(r)) &&
      !(!deployedRead && (isTaskRead(r) || isPageRead(r)))
  );
  const missing = need.filter(r => !r.have);
  // After the calls, only what they changed is read again: a deploy with no task or page call leaves those reads true.
  const changed = r =>
    (!isTaskRead(r) && !isPageRead(r)) || (stale.tasks && isTaskRead(r)) || (stale.pages && isPageRead(r));
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
    !l.ok && skip.tasks && isTaskLine(l)
      ? { ...l, ok: true, detail: why('tasks') }
      : !l.ok && skip.pages && isPageLine(l)
        ? { ...l, ok: true, detail: why('page files') }
        : l
  );
  if (lines.every(l => l.ok))
    return {
      kind: 'verified',
      lines,
      recorded: rec.deploys.some(d => d.target === target && d.commit === manifest.commit.slice(0, 7) && !d.line),
    };
  if (!deploy.ok) return { kind: 'refused', refusals: deploy.refusals, lines };
  const calls = deploy.calls.filter(
    c => !(skip.tasks && /trigger/.test(c.tool)) && !(skip.pages && c.tool === 'Artifact')
  );
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
/** The record's versions of the system documents, from this session's ArtifactData gets of them. */
export function versionsFrom(jsonl, url) {
  const out = {};
  for (const r of toolResults(jsonl || '', 'ArtifactData')) {
    const i = r.input || {};
    if (i.action !== 'get' || i.collection !== 'system' || i.url !== url || !SYSTEM_IDS.includes(i.doc_id) || r.isError)
      continue;
    const m = r.texts.join('\n').match(/\bversion\D{0,4}(\d+)/i);
    if (m) out[i.doc_id] = Number(m[1]);
  }
  return out;
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
async function ship(o) {
  const root = rootOf(o),
    target = o._[1];
  if (!['staging', 'live'].includes(target)) throw new Error('ship <staging|live>');
  const rec = loadChart(root),
    refusals = [];
  const red = lintChart(rec).filter(f => f.level === 'error');
  if (red.length) refusals.push(`the Chart lints red (${red.length}): node tools/chart.mjs lint`);
  const dist = path.join(root, 'dist'),
    stateDir = path.join(dist, 'state', target);
  const { manifest } = await build({ root, out: dist });
  const read = f => JSON.parse(fs.readFileSync(path.join(dist, 'system', f + '.json'), 'utf8'));
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
    // R-04 (D-083): Matt's explicit OK. R-01 (D-139): page-only while D-085's window is open (B-30 not done).
    if (!o['matt-ok'])
      refusals.push("R-04 (D-083): a live deploy needs Matt's explicit OK in the chat (then pass --matt-ok)");
    if (rec.rules.some(r => r.check === 'watchdogWindow')) {
      const live = (readJson(path.join(root, 'spec', 'ev.spec.json')).tasks.live || {}).watchdog;
      const why = live && watchdogRefusal(live.schedule, new Date());
      if (why) refusals.push(why);
    }
    const b30 = findTask(rec, 'B-30')[0];
    const r01 = rec.rules.find(r => r.check === 'pageOnlyLive');
    if (r01 && !r01.ended && (!b30 || b30.status !== 'done')) {
      const base = (deployed && deployed.commit) || (rec.deploys.filter(d => d.target === 'live').at(-1) || {}).commit;
      const found = base ? pageOnlyFindings(root, base, manifest.commit) : ['no live build to compare with'];
      if (found.length)
        refusals.push(
          `R-01 (D-139): D-085's rollback window is open (B-30 not done), so live takes page-only changes; since live's ${String(base).slice(0, 7)}: ${found.join('; ')}`
        );
    }
    // B-149 (D-173): what goes live is a tagged release. With every other gate passed and the commit untagged, ship
    // tags it here (pushed once live is recorded); the tag renames the build, so staging carries it first.
    if (!refusals.length) {
      const spec = readJson(path.join(root, 'spec', 'ev.spec.json'));
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
    last = fs.existsSync(shipFile) ? JSON.parse(fs.readFileSync(shipFile, 'utf8')) : null;
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
  const versions = {
    ...versionsFrom(jsonl, `https://claude.ai/artifact/${manifest.records[target].artifact}`),
    ...(o.version
      ? Object.fromEntries(
          list(o.version)
            .map(kv => kv.split('='))
            .map(([k, v]) => [k, Number(v)])
        )
      : {}),
  };
  const stagingVerify = fs.existsSync(path.join(dist, 'verify-staging.json'))
    ? JSON.parse(fs.readFileSync(path.join(dist, 'verify-staging.json'), 'utf8'))
    : null;
  const deploy = deployCalls({
    manifest,
    target,
    distDir: dist,
    build: buildInfo,
    versions,
    mattOk: Boolean(o['matt-ok']),
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
    const missingV = SYSTEM_IDS.filter(id => state.record && state.record[id] && !versions[id]);
    if (missingV.length) {
      console.log(
        `${head}: the versions of ${missingV.join(', ')} are not in this session's ArtifactData replies: pass --version ${missingV.map(id => id + '=<n>').join(',')}`
      );
      return 1;
    }
    // B-58: ship live prints these calls only on Matt's OK (R-04), so the live-write guard lets them through for a while.
    if (target === 'live')
      fs.writeFileSync(
        path.join(dist, 'live-ok'),
        JSON.stringify({ at: Date.now(), commit: manifest.commit, by: 'ship live --matt-ok' })
      );
    fs.writeFileSync(
      shipFile,
      JSON.stringify({
        commit: manifest.commit,
        at: Date.now(),
        skip,
        touched: {
          tasks: step.calls.some(c => /trigger/.test(c.tool)),
          pages: step.calls.some(c => c.tool === 'Artifact'),
        },
      })
    );
    console.log(
      formatDeploy(target, { ...deploy, calls: step.calls, skipped: step.skipped })
        .replace(`deploy ${target}:`, `${head}:`)
        .replace(`then run verify-deploy ${target}.`, `then make the reads below again and run ship ${target}.`)
    );
    const again = reads.filter(
      r =>
        (!isTaskRead(r) && !isPageRead(r)) ||
        (isTaskRead(r) && step.calls.some(c => /trigger/.test(c.tool))) ||
        (isPageRead(r) && step.calls.some(c => c.tool === 'Artifact'))
    );
    console.log(
      [
        '',
        'Reads after the calls (only what they change):',
        ...again.map(r => `  ${r.tool} ${JSON.stringify(r.args)}`),
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
export function healthLines(root = HERE, now = Date.now()) {
  const spec = readJson(path.join(root, 'spec', 'ev.spec.json'));
  const hours = ((spec.constants || {}).health || {}).staleHours || 4;
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
    `Reasoning in full: ${rec.views.retired ? 'DECISIONS.md' : rec.views.decisionsTab}`,
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
    `- Finish: node tools/chart.mjs log ${t.id} --status done --commit <sha> --note "one line"; then views prints the Board call.`
  );
  return out.join('\n');
}
/** The files and spec keys a task's text names, resolved against the checkout (spec.persona -> spec/ev.spec.json "persona"). */
export function whereToLook(root, text) {
  const out = [],
    seen = new Set();
  let spec = {};
  try {
    spec = readJson(path.join(root, 'spec', 'ev.spec.json'));
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
    const spec = readJson(path.join(root, 'spec', 'ev.spec.json'));
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
const BUILD_PLAN = { doc: 'Fgb2KjoLKcRgCRrBmM6kEf', node: '199e3b19-3ad3', after: 'mzaay4nq4t8.5147' };
export const HANDOFF_NOTE =
  "New tasks enter through the Chart (D-140, D-141): a design chat lists them in its doc's Tasks to add table, with its proposed decisions as P-1, P-2 and so on, and a build chat files them with node tools/chart.mjs plan --from <doc link>. This table is design history; BACKLOG.md is the backlog.";
export const handoffNoteCall = () =>
  docCall(BUILD_PLAN.doc, BUILD_PLAN.node, [
    {
      op: 'insert',
      target: { kind: 'blocks', ids: [BUILD_PLAN.after] },
      side: 'after',
      source: { from: { kind: 'inline', content: HANDOFF_NOTE }, as: 'markdown' },
    },
  ]);
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
  const ent = s =>
    s
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
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
  const rs = toolResults(jsonl, '*').filter(
    r =>
      isDocsTool(r.name, 'read') &&
      !r.isError &&
      r.input &&
      r.input.container &&
      docIdOf(r.input.container.id) === docId
  );
  for (const r of rs.reverse()) {
    const b = readBody(r.texts);
    if (b && b.xml && /Tasks to add|Decisions proposed|Tenets proposed/i.test(b.xml)) return b;
  }
  return null;
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
    const file = o.transcript || newestTranscript(),
      jsonl = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const versions = versionsFrom(jsonl, `https://claude.ai/artifact/${restored.manifest.records.live.artifact}`);
    const calls = deployCalls({
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
      git(root, [
        'commit',
        '-q',
        '-m',
        [
          `B-60: roll live back to ${to.commit}'s content, from ${from.commit} (restore commit, on Matt's OK)`,
          ...(o.trailer.length ? ['', ...o.trailer] : []),
        ].join('\n'),
      ]);
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
    '--force',
    '--apply',
    '--handoff-note',
    '--correct',
    '--retire',
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
function printViews(rec, o, which) {
  // B-143 (D-172): the Docs views are retired; the record's own files are their replacement, written with it.
  if (rec.views.retired) {
    console.log(
      `views: retired (${rec.views.retired.by}, ${rec.views.retired.at}): BACKLOG.md, DECISIONS.md and CHANGELOG.md are written with the record; no Docs calls`
    );
    return { needs: [], calls: [], notes: [] };
  }
  const file = o.transcript || newestTranscript();
  const reads = file ? viewReads(rec, fs.readFileSync(file, 'utf8')) : {};
  const plan = viewsPlan(rec, reads, which);
  console.log(formatViews(plan));
  return plan;
}

const commands = {
  import(o) {
    const root = rootOf(o),
      from = path.resolve(o.from || path.join(chartDir(root), 'import'));
    if (fs.existsSync(path.join(chartDir(root), 'tasks.json')) && !o.force)
      throw new Error('chart/tasks.json exists: the import runs once');
    const r = f => fs.readFileSync(path.join(from, f), 'utf8');
    const body = f => readBody([r(f)]).xml;
    const { commitOf, isCommit } = commitFinder(root);
    const rec = importChart({
      backlog: r('BACKLOG.md'),
      decisionsMd: r('Decisions.md'),
      boardXml: body('board-read.json'),
      changelogXml: body('changelog-read.json'),
      commitOf,
      isCommit,
      views: readJson(path.join(from, 'views.json')),
    });
    saveChart(root, rec);
    console.log(
      `import: ${rec.tasks.length} tasks, ${rec.decisions.length} decisions, ${rec.deploys.length} deploys, ${rec.rules.length} rules -> chart/`
    );
    return 0;
  },
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
      spec: readJson(path.join(rootOf(o), 'spec', 'ev.spec.json')),
    });
    console.log(o.json ? JSON.stringify(f, null, 1) : formatLint(f));
    return f.some(x => x.level === 'error') ? 1 : 0;
  },
  views(o) {
    const root = rootOf(o),
      rec = loadChart(root);
    // B-143 (D-172): retiring the Docs views keeps their doc ids, marked with the decision and the date.
    if (o.retire) {
      if (typeof o.by !== 'string' || !rec.decisions.some(d => d.id === o.by))
        throw new Error('views --retire --by <the decision that retires them> [--at YYYY-MM-DD]');
      rec.views.retired = {
        by: o.by,
        at: typeof o.at === 'string' ? o.at : ctDate(new Date().toISOString()),
        views: ['board', 'changelog', 'decisions', 'overview'],
        note: 'The ids above are kept for reading (the inbox still reads Board comments); nothing writes these views.',
      };
      saveChart(root, rec);
      writeBacklog(root, rec);
    }
    printViews(rec, o);
    return 0;
  },
  inbox(o) {
    const file = o.transcript || newestTranscript();
    console.log(
      formatInbox(inboxPlan(loadChart(rootOf(o)), file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null))
    );
    return 0;
  },
  quarantine(o) {
    // B-152 (D-176): which quarantined timing checks have had their green nightlies.
    const root = rootOf(o);
    const q = JSON.parse(fs.readFileSync(path.join(root, 'test/harness/quarantine.json'), 'utf8'));
    if (!o.runs)
      throw new Error(
        'quarantine --runs <file>: save gh run list --workflow nightly.yml --limit 60 --json conclusion,createdAt,event first'
      );
    const rows = quarantineDue(q, JSON.parse(fs.readFileSync(o.runs, 'utf8')));
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
  rollback(o) {
    return rollback(o);
  },
  plan(o) {
    if (o['handoff-note']) {
      const c = handoffNoteCall();
      console.log(`plan: the Build plan tab's hand-off line (once): ${c.tool}\n${JSON.stringify(c.args)}`);
      return 0;
    }
    if (!o.from || o.from === true) throw new Error('plan --from <design doc link> [--apply]');
    const root = rootOf(o),
      file = o.transcript || newestTranscript(),
      docId = docIdOf(o.from);
    const p = planFrom(
      loadChart(root),
      designRead(file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '', docId),
      docId
    );
    console.log(formatPlan(p));
    if (!o.apply || !p.commands.length) return 0;
    // One commit for the whole hand-off (each record write would be its own, and runs clone main only so deep, B-110).
    if (!o['no-commit']) syncRecord(root);
    const rec = loadChart(root),
      filed = [];
    let views = [];
    for (const c of p.commands) {
      const r = applyLog(rec, args(c));
      filed.push(c[2]);
      views = [...new Set([...views, ...r.views])];
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
    if (views.length) printViews(rec, o, views);
    return 0;
  },
};
function record(o, apply) {
  const root = rootOf(o);
  if (!o['no-commit']) syncRecord(root);
  const rec = loadChart(root);
  const file = o.transcript || newestTranscript();
  const jsonl = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const { what, id, views, reply } = apply(rec, o, { jsonl });
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
  if (views.length) printViews(rec, o, views);
  return 0;
}

export async function main(argv) {
  const o = args(argv),
    cmd = commands[o._[0]];
  if (!cmd) {
    console.error(
      'Commands: report, inbox, log, views, lint, ship <staging|live>, brief --task <id>, plan --from <doc link> [--apply], backlog [--check], import --from <dir>'
    );
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
