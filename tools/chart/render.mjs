// The Chart's generated files and its lint (B-262, D-264): BACKLOG.md with Your turn, DECISIONS.md and CHANGELOG.md
// rendered from the record, the names and Changelog lines they print, and the record's checks that npm test runs.
// tools/chart.mjs re-exports what it exported before, so its importers are unchanged.
import { currentVersion } from '../../core/migrate.mjs';
import {
  TASK_STATUS,
  TASK_KINDS,
  DECISION_STATUS,
  DECISION_KINDS,
  TENET_SCOPES,
  TENET_CHECKS,
  kindOf,
  ids,
  ctDate,
  ctClock,
} from './record.mjs';

// ------------------------------------------------------------------------------------------------ BACKLOG.md
// As BACKLOG.md reads since the cutover (B-97, D-140); the Chart imported it once from v3 (B-92).
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
/** A waiting task's ask: the last sentence of its notes (B-148), at most 300 characters, or its title's first line. */
export function askOf(t) {
  if (t.ask) return String(t.ask).slice(0, 300); // B-182: the ask log --ask set
  const last = String(t.notes || '')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
    .at(-1);
  // A reported task's title starts "Bug (reported Oct 21): ..."; its ask is what follows, his words.
  const title = String(t.title || t.id).replace(/^(Bug|Request) \(reported [^)]*\):\s*/, '');
  const s = last || title.split(/[:;(]/)[0];
  return s.length > 300 ? s.slice(0, 299).replace(/\s+\S*$/, '') + '…' : s;
}
/** B-178 (D-196): system/yourturn's body: the Chart's Your turn by place, each task with its ask and status. */
export function yourTurnDoc(rec, { at, commit, source }) {
  return {
    schema: currentVersion('system'),
    writer: 'deploy',
    at,
    source,
    commit,
    groups: yourTurn(rec).map(g => ({
      place: g.place,
      label: g.label,
      tasks: g.tasks.map(t => ({
        id: t.id,
        ask: askOf(t),
        status: ['open', 'in progress', 'blocked'].includes(t.status) ? t.status : 'open',
        ...(g.place === 'decision' && Array.isArray(t.choices) && t.choices.length ? { choices: t.choices } : {}),
      })),
    })),
  };
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
export function renderBacklog(rec) {
  const tasks = rec.tasks.filter(t => !INBOX.has(t.status) && t.status !== 'done'),
    done = rec.tasks.filter(t => t.status === 'done'),
    inbox = rec.tasks.filter(t => INBOX.has(t.status));
  const out = [...BACKLOG_HEADER, '', COLUMNS, ...tasks.map(backlogRow)];
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
/** DECISIONS.md: every decision and tenet in the record, newest first, with its reasoning and status. */
export function renderDecisions(rec) {
  const ds = [...rec.decisions].sort((a, b) => Number(b.id.slice(2)) - Number(a.id.slice(2)));
  const kind = d =>
    d.kind === 'tenet' ? `Tenet (${(d.scope || []).join(', ')}; checked by ${d.check || 'review'})` : '';
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
        `| ${d.id} | ${cell(d.date || '')} | ${cell([kind(d), d.title].filter(Boolean).join(': '))} | ${cell(d.why || '')} | ${d.status} | ${cell(links(d))} |`
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

// ------------------------------------------------------------------------------------------------ names and lines
export const boardName = t => (t.board && t.board.row) || `v4 ${t.id}: ${t.name || t.title.split(/[:(]/)[0].trim()}`;

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
