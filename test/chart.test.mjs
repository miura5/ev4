// The Chart (M12): chart/ is the project record; BACKLOG.md, the Board, the Changelog and the overview's status line
// are generated from it by tools/chart.mjs. B-92: the one-time import keeps today's backlog row for row.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, copyRepo } from './helpers.mjs';
import { build } from '../tools/build.mjs';
import * as C from '../tools/chart.mjs';

const IMPORT = path.join(ROOT, 'chart', 'import');
const read = f => fs.readFileSync(path.join(IMPORT, f), 'utf8');
const rec = () => C.loadChart(ROOT);
// The import as it ran, with each done task's commit taken from the record (so the test needs no git history).
function imported() {
  const now = rec(), commits = {};
  for (const t of now.tasks) (commits[t.id] = commits[t.id] || []).push(t.commit);
  const seen = {};
  return C.importChart({
    backlog: read('BACKLOG.md'), decisionsMd: read('Decisions.md'),
    boardXml: C.readBody([read('board-read.json')]).xml, changelogXml: C.readBody([read('changelog-read.json')]).xml,
    commitOf: id => { const n = seen[id] = (seen[id] || 0) + 1; return (commits[id] || [])[n - 1] || null; },
    views: JSON.parse(read('views.json')),
  });
}
const rows = s => s.split('\n').filter(l => l.startsWith('| B-'));

test('B-92: the import regenerates BACKLOG.md row for row', () => {
  const before = read('BACKLOG.md'), gen = C.renderBacklog(imported());
  const a = rows(before), b = rows(gen);
  assert.equal(b.length, a.length);
  a.forEach((l, i) => assert.deepEqual(C.parseBacklogRow(b[i]), C.parseBacklogRow(l), `row ${i + 1} (${l.slice(0, 8)}) differs`));
  // Text differs only where a | inside a field is now escaped (it split the cell: B-26's notes, B-42's ||).
  assert.deepEqual(a.filter((l, i) => l !== b[i]).map(l => l.slice(2, 6)), ['B-26', 'B-42']);
  assert.equal(C.renderBacklog(imported(), { header: C.BACKLOG_HEADER_IMPORTED }).split('\n| Id |')[0], before.split('\n| Id |')[0], 'the header was today\'s');
  assert.match(gen, /Generated from the Chart .* never edit this file by hand/, 'since the cutover (B-97) it says it is generated');
});

test('B-92: the import holds every decision, the v4 deploys and the Board rows', () => {
  const r = imported();
  assert.equal(r.decisions.length, 96);
  assert.equal(r.decisions[0].id, 'D-139');
  assert.equal(C.nextDecisionId(r), 'D-140');
  assert.deepEqual(r.decisions.find(d => d.id === 'D-106').supersedes, ['D-059']);
  assert.deepEqual(r.decisions.find(d => d.id === 'D-139').amends, ['D-136']);
  assert.equal(r.decisions.find(d => d.id === 'D-059').status, 'superseded');
  const live = r.deploys.filter(d => d.target === 'live');
  assert.equal(live.at(-1).commit, 'c049f48');
  assert.equal(live.at(-1).rollback, '314bb5f');
  assert.equal(live.at(-1).time, '2026-10-19T16:20:00-05:00');
  assert.equal(r.deploys[0].commit, '3fa5d2a', 'the first v4 deploy (staging, Oct 18)');
  for (const d of r.deploys) assert.ok(d.line && d.line.change.includes(d.commit), `${d.target} ${d.commit} keeps its Changelog row`);
  const b83 = r.tasks.filter(t => t.id === 'B-83');
  assert.deepEqual(b83.map(t => t.board && t.board.row), ['v4 B-83: a demo copy and an overview doc', 'v4 B-83: the Mac evening run starts without its code']);
  assert.equal(b83[1].waitingOn, 'Matt');
  for (const t of r.tasks.filter(t => t.status === 'done')) assert.ok(t.commit, `${t.id} done with a commit`);
});

test('chart/ and tools/chart.mjs stay outside the manifest, so a bookkeeping commit ships nothing', async () => {
  const dir = copyRepo(), out = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-chart-dist-'));
  const { manifest } = await build({ root: dir, out, now: '2026-10-19T12:00:00Z' });
  assert.deepEqual(Object.keys(manifest.files).filter(f => f.startsWith('chart/') || f === 'tools/chart.mjs' || f === 'BACKLOG.md'), []);
});

// ------------------------------------------------------------------------------------------------ B-93 log and views
import { execFileSync } from 'node:child_process';
const SAMPLE_VIEWS = { doc: 'DOC', decisionsTab: 'tab', board: { node: 'BN', table: 's1.10', statusEnum: 'E1', statusOptions: ['Done', 'In progress', 'Next', 'Waiting on Matt', 'Later'] }, changelog: { node: 'CN', table: 's1.20' }, overview: { doc: 'OV', node: 'ON', paragraph: 's9.5' } };
const task = (id, o = {}) => ({ id, kind: 'task', title: `Task ${id}`, dod: 'it works', milestone: 'M12', status: 'open', depends: [], notes: '', commit: null, source: 'test', ...o });
const sample = () => ({
  tasks: [task('B-01', { status: 'done', commit: 'abc1234', board: { row: 'v4 B-01: one', why: 'why one', notes: 'n1' } }), task('B-02', { board: { row: 'v4 B-02: two', why: 'why two', notes: 'n2' } }), task('B-03')],
  decisions: [{ id: 'D-002', date: 'Oct 19', title: 'two', why: '', status: 'accepted', supersedes: ['D-001'], amends: [] }, { id: 'D-001', date: 'Oct 18', title: 'one', why: '', status: 'superseded', supersedes: [], amends: [] }],
  deploys: [{ target: 'live', commit: '1111111', time: '2026-10-19T16:20:00-05:00', okFrom: 'Matt', verify: 'green', rollback: '0000000', tasks: [], line: { date: 'Oct 19', change: 'old row', why: 'w', decision: 'D-002' }, source: 'Changelog tab' }],
  rules: [{ id: 'R-01', rule: 'r', decision: 'D-002', task: 'B-01', command: 'ship live', check: 'mattOk' }],
  views: SAMPLE_VIEWS,
});
const cellX = (id, text, dd) => `<cell id='${id}' h='h${id.slice(-2)}'><paragraph id='${id}p'>${dd != null ? `<dropdown id='${id}d' enum='E1' index='${dd}'>${['Done', 'In progress', 'Next', 'Waiting on Matt', 'Later'][dd]}</dropdown>` : `<text id='${id}t'>${text}</text>`}</paragraph></cell>`;
const boardXml = rows => `<doc node='BN' rev='7' parent='s1.10'><table id='s1.10' h='t'><row id='.11' h='r0'>${cellX('.12', 'Task')}${cellX('.13', 'Why')}${cellX('.14', 'Status')}${cellX('.15', 'Notes')}</row>` +
  rows.map((r, i) => `<row id='.${30 + i * 10}' h='r${i}'>${cellX(`.${31 + i * 10}`, r[0])}${cellX(`.${32 + i * 10}`, r[1])}${cellX(`.${33 + i * 10}`, r[2], r[3])}${cellX(`.${34 + i * 10}`, r[4])}</row>`).join('') + '</table></doc>';

test('B-93: log changes one task and refuses what it must', () => {
  const r = sample();
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-02'], status: 'done' }), /needs --commit/);
  const out = C.applyLog(r, { _: ['log', 'B-02'], status: 'done', commit: 'def5678abc', note: 'shipped' });
  assert.equal(out.what, 'open -> done, commit def5678, notes');
  assert.deepEqual(out.views, ['board']);
  assert.equal(r.tasks[1].status, 'done');
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-03'], status: 'in progress', why: 'w' }), /has no Board row yet: give --name/);
  C.applyLog(r, { _: ['log', 'B-03'], status: 'in progress', name: 'three', why: 'why three' });
  assert.equal(r.tasks[2].board.row, 'v4 B-03: three');
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-09'], status: 'done' }), /no task B-09/);
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-01'] }), /nothing to log/);
  // A deploy, a decision.
  const d = C.applyLog(r, { _: ['log', 'deploy'], target: 'staging', commit: '2222222', verify: 'green', tasks: 'B-02', summary: 'two', time: '2026-10-19T21:05:00-05:00' });
  assert.deepEqual(d.views, ['changelog']);
  assert.throws(() => C.applyLog(r, { _: ['log', 'deploy'], target: 'live', commit: '2222222' }), /--ok Matt/);
  assert.throws(() => C.applyLog(r, { _: ['log', 'decision', 'D-009'], title: 'x' }), /next free decision id is D-003/);
  C.applyLog(r, { _: ['log', 'decision', 'D-003'], title: 'three', status: 'accepted', supersedes: 'D-002', now: undefined });
  assert.equal(r.decisions[0].id, 'D-003');
  assert.equal(r.decisions.find(x => x.id === 'D-002').status, 'superseded');
});

test('B-93: the Board calls replace changed cells in place and add missing rows, chip on the next run', () => {
  const r = sample();
  r.tasks[1].status = 'in progress';
  const read = C.parseTableXml(boardXml([['v4 B-01: one', 'why one', 'Done', 0, 'n1'], ['v4 B-02: two', 'why two', 'Next', 2, 'n2']]));
  assert.equal(read.rev, 7);
  assert.equal(read.rows[1].id, 's1.30', 'short ids read in full');
  const calls = C.boardCalls(r, read);
  assert.equal(calls.length, 1);
  const ops = calls[0].args.payload.ops;
  assert.deepEqual(ops, [{ op: 'replace', target: { kind: 'cell', table: 's1.10', row: 2, col: 2 }, ifRev: 7, with: { as: 'markdown', from: { kind: 'inline', content: '<?claude block st?>' }, blocks: { st: { type: 'dropdown', enum: 'E1', index: 1 } } } }]);
  assert.match(calls[0].step, /B-02: status Next -> In progress/);
  // A task with a Board entry and no row: appended, its status as text; the next read sees the text and chips it.
  r.tasks[2].board = { row: 'v4 B-03: three', why: 'w3', notes: '' };
  const add = C.boardCalls(r, read)[0].args.payload.ops.at(-1);
  assert.equal(add.op, 'insert'); assert.equal(add.side, 'end');
  assert.equal(add.source.from.content[0].content[2].content[0].content[0].text, 'Next');
  const after = C.parseTableXml(boardXml([['v4 B-01: one', 'why one', 'Done', 0, 'n1'], ['v4 B-02: two', 'why two', 'In progress', 1, 'n2'], ['v4 B-03: three', 'w3', 'Next', null, '']]));
  const chip = C.boardCalls(r, after)[0].args.payload.ops;
  assert.deepEqual(chip.map(o => [o.op, o.target.row, o.with.blocks.st.index]), [['replace', 3, 2]]);
  r.tasks[2].status = 'open';
  const inStep = C.parseTableXml(boardXml([['v4 B-01: one', 'why one', 'Done', 0, 'n1'], ['v4 B-02: two', 'why two', 'In progress', 1, 'n2'], ['v4 B-03: three', 'w3', 'Next', 2, '']]));
  assert.deepEqual(C.boardCalls(r, inStep), [], 'in step: nothing to print');
});

test('B-93: the Changelog gets a row per logged deploy, newest on top; imported rows are never re-added', () => {
  const r = sample();
  const read = C.parseTableXml(`<doc node='CN' rev='4'><table id='s1.20'><row id='.21'>${cellX('.22', 'Date')}${cellX('.23', 'Change')}${cellX('.24', 'Why')}${cellX('.25', 'Decision')}</row><row id='.31'>${cellX('.32', 'Oct 19')}${cellX('.33', 'old row')}${cellX('.34', 'w')}${cellX('.35', 'D-002')}</row></table></doc>`);
  assert.deepEqual(C.changelogCalls(r, read), []);
  C.applyLog(r, { _: ['log', 'deploy'], target: 'staging', commit: '2222222abc', verify: 'green', tasks: 'B-02', summary: 'the second task', time: '2026-10-19T21:05:00-05:00', decisions: 'D-002' });
  const [call] = C.changelogCalls(r, read);
  const op = call.args.payload.ops[0];
  assert.deepEqual([op.op, op.target.ids, op.side], ['insert', ['s1.21'], 'after']);
  assert.deepEqual(op.source.from.content[0].content.map(c => c.content[0].content[0].text), ['Oct 19', 'v4 staging deployed at 2222222 (21:05 CT): the second task (B-02). verify-deploy staging GREEN. Live stays where it is', 'The B-35 gate: staging first', 'D-002']);
});

test('B-93: the overview status line follows the newest live deploy', () => {
  const r = sample();
  const para = C.parseParagraphXml(`<doc rev='3'><paragraph id='s9.5' h='p'><text id='.6'>The live page has been on build </text><text id='.7'>0000000 since 4pm on Oct 19, after a day</text></paragraph></doc>`, 's9.5');
  const [call] = C.overviewCalls(r, para);
  assert.deepEqual(call.args.payload.ops, [{ op: 'replace', target: { kind: 'find', text: 'on build 0000000 since 4pm on Oct 19' }, with: { as: 'text', from: { kind: 'inline', content: 'on build 1111111 since 4:20pm on Oct 19' } } }]);
  assert.deepEqual(C.overviewCalls(r, { ...para, text: 'on build 1111111 since 4:20pm on Oct 19' }), []);
});

test('B-93: views finds the newest read of each view in the transcript, stale once the view is updated', () => {
  const r = sample(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-views-'));
  const saved = path.join(dir, 'big.txt');
  const verdict = xml => JSON.stringify({ verdict: 'allow', rev: 7, data: { rev: 7, xml } });
  fs.writeFileSync(saved, JSON.stringify([{ type: 'text', text: '<artifact-content-authored-by-others/>' }, { type: 'text', text: verdict(boardXml([['v4 B-01: one', 'why one', 'Done', 0, 'n1']])) }]));
  const line = (id, name, input, result) => [JSON.stringify({ message: { content: [{ type: 'tool_use', id, name, input }] } }), JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: result }] }] } })];
  const boardRead = { ref: { object: 'node', id: 'BN' }, engine: 'prose', container: { kind: 'project', id: 'DOC' }, payload: { kind: 'view', parentId: 's1.10' } };
  let jsonl = line('a', 'mcp__Claude_Docs__read', boardRead, `Error: result (88,413 characters) exceeds maximum allowed tokens. Output has been saved to ${saved}.`).join('\n');
  let plan = C.viewsPlan(r, C.viewReads(r, jsonl), ['board']);
  assert.deepEqual(plan.needs, []);
  assert.match(plan.calls[0].step, /B-02: a new row/);
  jsonl += '\n' + line('b', 'mcp__Claude_Docs__update', { ref: { object: 'node', id: 'BN' }, payload: {} }, '{"verdict":"allow"}').join('\n');
  plan = C.viewsPlan(r, C.viewReads(r, jsonl), ['board']);
  assert.equal(plan.needs[0].why, 'updated since the last read');
  assert.deepEqual(plan.needs[0].args, boardRead);
  assert.equal(C.viewsPlan(r, {}, ['changelog']).needs[0].why, 'no read in this session');
});

test('B-93: log writes the record, regenerates BACKLOG.md and commits both, nothing else', () => {
  const dir = copyRepo();
  const run = (...a) => execFileSync('node', [path.join(dir, 'tools', 'chart.mjs'), ...a, '--root', dir, '--transcript', '/dev/null'], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' } });
  const before = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const open = C.loadChart(dir).tasks.find(t => t.status === 'open' && t.id === 'B-43');
  assert.ok(open);
  const out = run('log', 'B-43', '--note', 'a note from the test', '--trailer', 'Test-Trailer: yes');
  assert.match(out, /log B-43: notes; committed [0-9a-f]{7}/);
  const show = execFileSync('git', ['-C', dir, 'show', '--stat', '--format=%B', 'HEAD'], { encoding: 'utf8' });
  assert.match(show, /^B-43: notes \(chart\)\n\nTest-Trailer: yes/);
  assert.deepEqual(execFileSync('git', ['-C', dir, 'diff', '--name-only', before, 'HEAD'], { encoding: 'utf8' }).trim().split('\n').sort(), ['BACKLOG.md', 'chart/tasks.json']);
  assert.equal(fs.readFileSync(path.join(dir, 'BACKLOG.md'), 'utf8'), C.renderBacklog(C.loadChart(dir)));
});

test('BACKLOG.md is generated from chart/ (no hand edits)', () => {
  assert.equal(fs.readFileSync(path.join(ROOT, 'BACKLOG.md'), 'utf8'), C.renderBacklog(rec()), 'BACKLOG.md differs from chart/: change the record with node tools/chart.mjs log, never the file');
});

// ------------------------------------------------------------------------------------------------ B-94 lint
test('B-94: lint on the record as imported finds the duplicate B-83, and B-81 waiting on three tasks the backlog never had', () => {
  // The design expected the duplicate alone. B-78, B-79 and B-80 are in the Build plan tab but never reached
  // BACKLOG.md; B-94 added them (with B-74 and B-75) and renumbered the second B-83 to B-98.
  const f = C.lintChart(imported());
  assert.deepEqual(f.map(x => `${x.check} ${x.id}${x.check === 'missing-dependency' ? ' ' + x.detail.match(/B-\d+/)[0] : ''}`), ['duplicate-id B-83', 'missing-dependency B-81 B-78', 'missing-dependency B-81 B-79', 'missing-dependency B-81 B-80']);
});

test('B-94: the record lints green (npm test runs the Chart lint)', () => {
  const f = C.lintChart(rec());
  assert.deepEqual(f.filter(x => x.level === 'error'), [], C.formatLint(f));
  const r = rec();
  assert.equal(r.tasks.find(t => t.id === 'B-98').renumberedFrom, 'B-83');
  assert.equal(r.tasks.filter(t => t.id === 'B-83').length, 1);
});

test('B-94: each check fires on a planted fault', () => {
  const r = sample();
  assert.deepEqual(C.lintChart(r), []);
  r.tasks.push(task('B-02'));                                   // a duplicate id
  r.tasks[2].depends = ['B-77'];                                // a dependency on nothing
  r.tasks[0].commit = null;                                     // done with no commit
  r.rules[0].decision = 'D-001';                                // a rule on a superseded decision
  r.tasks.push({ ...task('B-04', { kind: 'bug', status: 'inbox' }), words: 'the timer sat at 0:00', source: 'build chat', reportedAt: '2026-10-19T22:00:00Z' });
  r.tasks.push(task('B-05', { kind: 'request', status: 'declined', words: 'w', source: 's', reportedAt: 't', triage: {} }));
  const got = C.lintChart(r).map(x => `${x.level} ${x.check} ${x.id}`);
  assert.deepEqual(got.sort(), ['error declined-without-reason B-05', 'error done-without-commit B-01', 'error duplicate-id B-02', 'error missing-dependency B-03', 'error rule-decision R-01', 'warn untriaged B-04'].sort());
});

// ------------------------------------------------------------------------------------------------ B-95 report and triage
const human = (text, at = '2026-10-19T23:40:00.000Z') => JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: text } });
const toolPair = (id, name, input, result) => [JSON.stringify({ message: { content: [{ type: 'tool_use', id, name, input }] } }), JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: result }] }] } })];

test('B-95: report takes Matt\'s words from his message, exactly as written', () => {
  const jsonl = [human('ok next one'), human('bug: the timer sat at 0:00 after I came back\n\nalso, nice work <system-reminder>x</system-reminder>', '2026-10-19T23:41:00.000Z')].join('\n');
  assert.deepEqual(C.wordsFromChat(jsonl), { words: 'the timer sat at 0:00 after I came back', at: '2026-10-19T23:41:00.000Z', said: 'bug' });
  assert.equal(C.wordsFromChat(jsonl, 'nice work').words, 'also, nice work');
  const r = sample();
  const out = C.applyReport(r, { _: ['report', 'bug'], 'from-chat': true }, { jsonl });
  const t = r.tasks.at(-1);
  assert.deepEqual([out.id, t.kind, t.status, t.words, t.source, t.reportedAt], ['B-04', 'bug', 'inbox', 'the timer sat at 0:00 after I came back', 'build chat', '2026-10-19T23:41:00.000Z']);
  assert.deepEqual(C.boardRow(t, r).status, { text: 'New report' });
  assert.match(C.renderBacklog(r), /## Inbox[\s\S]*\| B-04 \| bug \| 2026-10-19T23:41:00.000Z \| the timer sat at 0:00 after I came back \| build chat \| inbox \|/);
  assert.equal(C.lintChart(r).find(f => f.id === 'B-04').level, 'warn');
  assert.throws(() => C.applyReport(sample(), { _: ['report', 'bug'], 'from-chat': true }, { jsonl: human('nothing to see') }), /no message in this session says/);
});

test('B-95: triage comes first, then the entry becomes a task, joins one, or is declined with a reason; nothing is deleted', () => {
  const r = sample();
  C.applyReport(r, { _: ['report', 'bug', 'the', 'timer', 'sat', 'at', '0:00'], source: 'build chat', at: '2026-10-19T23:41:00Z' });
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-02'], status: 'in progress' }), /triage first: B-04 waits in the inbox/);
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-04'], status: 'in progress' }), /in the inbox: triage it first/);
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-04'], triage: 'task', dod: 'x' }), /needs --dod and --milestone/);
  C.applyLog(r, { _: ['log', 'B-04'], triage: 'task', dod: 'the clock resumes from the session\'s start after a return; a harness test', milestone: 'M11' });
  const t = r.tasks.find(x => x.id === 'B-04');
  assert.deepEqual([t.status, t.milestone, t.triage.outcome], ['open', 'M11', 'task']);
  assert.deepEqual(C.boardRow(t, r).status, { option: 'Next' });
  assert.match(C.renderBacklog(r), /\| B-04 \| Bug \(reported Oct 19\): the timer sat at 0:00 Done when: the clock resumes/);
  C.applyLog(r, { _: ['log', 'B-02'], status: 'in progress' });
  // join and decline keep the entry, marked.
  C.applyReport(r, { _: ['report', 'request', 'reorder', 'the', 'briefing'], source: 'build chat' });
  C.applyLog(r, { _: ['log', 'B-05', 'B-02'], triage: 'join' });
  C.applyReport(r, { _: ['report', 'request', 'a', 'dark', 'mode', 'toggle'], source: 'build chat' });
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-06'], triage: 'decline' }), /needs --reason/);
  C.applyLog(r, { _: ['log', 'B-06'], triage: 'decline', reason: 'the page is dark only by design (D-077)' });
  assert.deepEqual(r.tasks.slice(-2).map(x => [x.id, x.status, C.boardRow(x, r).status.text]), [['B-05', 'declined', 'Joined B-02'], ['B-06', 'declined', 'Declined']]);
  assert.match(C.boardRow(r.tasks.at(-1), r).notes, /^the page is dark only by design \(D-077\)/);
  assert.deepEqual(C.lintChart(r).filter(f => f.level === 'error'), []);
});

test('B-95: a Board comment is filed from the comment query and answered with its id', () => {
  const r = sample();
  const q = { object: 'utterance', container: { kind: 'project', id: 'DOC' }, payload: { under: { object: 'node', id: 'BN' } } };
  const rows = { verdict: 'allow', rows: [{ id: 'u-1', verb: 'create', actor: { name: 'Mathew', self: true }, payload: { value: { body: 'the Quiz me button does nothing on my phone', parent: { object: 'node', id: 'BN', anchor: {} } } } }] };
  let jsonl = toolPair('q1', 'mcp__Claude_Docs__query', q, JSON.stringify(rows)).join('\n');
  assert.deepEqual(C.inboxPlan(r, null).query, C.commentQuery(r));
  assert.deepEqual(C.inboxPlan(r, jsonl).comments.map(c => [c.id, c.body]), [['u-1', 'the Quiz me button does nothing on my phone']]);
  const byId = toolPair('q0', 'mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__query', q, JSON.stringify(rows)).join('\n');
  assert.deepEqual(C.inboxPlan(r, byId).comments.map(c => c.id), ['u-1'], 'the Docs connector named by its id is read too');
  const out = C.applyReport(r, { _: ['report', 'bug'], 'from-comment': 'u-1' }, { jsonl });
  assert.equal(r.tasks.at(-1).words, 'the Quiz me button does nothing on my phone');
  assert.equal(r.tasks.at(-1).source, 'Board comment u-1');
  assert.deepEqual(out.reply.args.payload.value.parent, { object: 'utterance', id: 'u-1' });
  assert.match(out.reply.args.payload.value.body, /^Filed as B-04 \(bug\)/);
  assert.deepEqual(C.inboxPlan(r, jsonl).comments, [], 'filed: not listed again');
  assert.throws(() => C.applyReport(r, { _: ['report', 'bug'], 'from-comment': 'u-1' }, { jsonl }), /already filed/);
  assert.match(C.formatInbox(C.inboxPlan(r, jsonl)), /B-04 \(bug, .*from Board comment u-1\): "the Quiz me button does nothing on my phone"/);
});

// ------------------------------------------------------------------------------------------------ B-96 the build's commit
test('B-96: a bookkeeping commit (chart/, BACKLOG.md) never moves the build\'s commit; a code commit does', async () => {
  const dir = copyRepo(), out = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-chart-dist-'));
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' }).trim();
  const first = (await build({ root: dir, out })).manifest;
  assert.equal(first.commit, g('rev-parse', 'HEAD'));
  fs.appendFileSync(path.join(dir, 'BACKLOG.md'), '\n');
  fs.writeFileSync(path.join(dir, 'chart', 'note.json'), '{}');
  assert.equal((await build({ root: dir, out })).manifest.dirty, false, 'an uncommitted bookkeeping change is not dirt');
  g('add', '-A'); g('commit', '-q', '-m', 'B-00: done (chart)');
  const after = (await build({ root: dir, out })).manifest;
  assert.equal(after.commit, first.commit, 'the chart commit leaves the build where it was');
  assert.deepEqual(after.files, first.files);
  fs.appendFileSync(path.join(dir, 'core', 'batches.mjs'), '\n');
  assert.equal((await build({ root: dir, out })).manifest.dirty, true);
  g('commit', '-qam', 'B-00: code');
  assert.equal((await build({ root: dir, out })).manifest.commit, g('rev-parse', 'HEAD'));
});

// ------------------------------------------------------------------------------------------------ B-96 ship and brief
const M = (o = {}) => ({ commit: 'a'.repeat(40), release: 'v4.0.0', tasks: { 'staging.morning': { record: 'staging', name: 'm', promptSha256: 'p1', trigger: 't1' }, 'live.morning': { record: 'live', name: 'm', promptSha256: 'p1', trigger: 't2' } }, pages: { staging: { files: { 'page/staging/app.js': 'h1' }, capabilities: { db: {} } } }, ...o });
const READS = [{ tool: 'mcp__claude-code-remote__list_triggers', have: false }, { tool: 'ArtifactData', args: { doc_id: 'manifest' }, have: true }, { tool: 'Artifact', have: false }];
const VERIFY = { lines: [{ ok: true, what: 'build is clean' }, { ok: false, what: 'system/manifest commit' }, { ok: false, what: 'staging page read' }, { ok: false, what: 'scheduled tasks read' }] };
const DEPLOY = { ok: true, calls: [{ tool: 'ArtifactData' }, { tool: 'Artifact' }, { tool: 'mcp__claude-code-remote__update_trigger' }], skipped: [] };

test('B-96: ship skips the task and page reads (and their calls) when the deployed manifest, green when deployed, has the same', () => {
  const r = sample(); r.deploys.push({ target: 'staging', commit: 'bbbbbbb', verify: 'green', time: 't', tasks: [] });
  const deployed = M({ commit: 'b'.repeat(40) });
  const skip = C.skips({ manifest: M(), target: 'staging', deployed, rec: r });
  assert.deepEqual(skip, { tasks: true, pages: true, from: 'bbbbbbb' });
  assert.equal(C.skips({ manifest: M({ pages: { staging: { files: { 'page/staging/app.js': 'h2' }, capabilities: { db: {} } } } }), target: 'staging', deployed, rec: r }).pages, false, 'a changed page file is read');
  assert.equal(C.skips({ manifest: M(), target: 'staging', deployed, rec: sample() }).tasks, false, 'no green deploy at that commit in the record: read everything');
  const step = C.shipStep({ target: 'staging', manifest: M(), state: { record: { manifest: deployed } }, verifyResult: VERIFY, reads: READS, deploy: DEPLOY, rec: r, refusals: [], skip, stale: null });
  assert.equal(step.kind, 'deploy');
  assert.deepEqual(step.calls.map(c => c.tool), ['ArtifactData'], 'no page publish, no trigger call');
  assert.ok(step.lines.filter(l => /page read|tasks read/.test(l.what)).every(l => l.ok && /not read/.test(l.detail)));
  // Without the deployed manifest read yet: only that read is asked for.
  const first = C.shipStep({ target: 'staging', manifest: M(), state: { record: null }, verifyResult: VERIFY, reads: READS.map(x => ({ ...x, have: false })), deploy: DEPLOY, rec: r, refusals: [], skip: { tasks: false, pages: false }, stale: null });
  assert.deepEqual([first.kind, first.reads.map(x => x.tool)], ['reads', ['ArtifactData']]);
  // After calls that touched neither tasks nor the page, only the system documents are read again.
  const again = C.shipStep({ target: 'staging', manifest: M(), state: { record: { manifest: deployed } }, verifyResult: VERIFY, reads: READS.map(x => ({ ...x, have: true })), deploy: DEPLOY, rec: r, refusals: [], skip: { tasks: false, pages: false }, stale: { tasks: false, pages: false } });
  assert.deepEqual(again.reads.map(x => x.tool), ['ArtifactData']);
  const green = C.shipStep({ target: 'staging', manifest: M(), state: { record: { manifest: deployed } }, verifyResult: { lines: [{ ok: true, what: 'x' }] }, reads: READS.map(x => ({ ...x, have: true })), deploy: DEPLOY, rec: r, refusals: [], skip, stale: null });
  assert.deepEqual([green.kind, green.recorded], ['verified', false]);
  assert.equal(C.shipStep({ target: 'live', manifest: M(), state: {}, verifyResult: VERIFY, reads: [], deploy: DEPLOY, rec: r, refusals: ['R-04 (D-083): no OK'], skip, stale: null }).kind, 'refused');
});

test('B-96: R-01 (D-139) finds what makes a live deploy more than page-only since the live build', () => {
  const dir = copyRepo();
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' }).trim();
  const base = g('rev-parse', 'HEAD');
  fs.appendFileSync(path.join(dir, 'page', 'styles.css'), '\n'); g('commit', '-qam', 'page');
  assert.deepEqual(C.pageOnlyFindings(dir, base), [], 'a page file alone is page-only');
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'spec', 'ev.spec.json'), 'utf8'));
  spec.pipelines._note = 'changed'; fs.writeFileSync(path.join(dir, 'spec', 'ev.spec.json'), JSON.stringify(spec, null, 1));
  fs.appendFileSync(path.join(dir, 'tools', 'prompts.mjs'), '\n'); g('commit', '-qam', 'pipeline and prompt');
  assert.deepEqual(C.pageOnlyFindings(dir, base), ['tools/prompts.mjs changed', 'spec.pipelines changed']);
  assert.deepEqual(C.RULES.map(r => [r.id, r.decision, r.task]), [['R-01', 'D-139', 'B-30'], ['R-02', 'D-049', 'B-35'], ['R-03', 'D-139', 'B-87'], ['R-04', 'D-083', null]]);
});

test('B-96: ship reads the system documents\' versions from this session\'s ArtifactData replies', () => {
  const url = 'https://claude.ai/artifact/X';
  const jsonl = ['manifest', 'spec'].flatMap((id, i) => toolPair('g' + i, 'ArtifactData', { action: 'get', url, collection: 'system', doc_id: id, out_dir: '/tmp' }, `1 document from collection "system" saved as JSON files:\n- "${id}"  15337 bytes  version ${71 + i}  "/tmp/system/${id}.json"`)).join('\n');
  assert.deepEqual(C.versionsFrom(jsonl, url), { manifest: 71, spec: 72 });
  assert.deepEqual(C.versionsFrom(jsonl, 'https://claude.ai/artifact/Y'), {});
});

test('B-96: brief is one page: the inbox, the task, its dependencies, decisions, limits and the next live runs', () => {
  const b = C.brief(rec(), 'B-97');
  for (const h of ['## Inbox first', '## The task: B-97', '## Depends on', '## Decisions it rests on', '## What it may touch', '## The next 24 hours of live runs', '## Record as you go']) assert.ok(b.includes(h), h);
  assert.match(b, /- B-93: done/);
  assert.match(b, /R-01 \(D-139, B-30\)/);
  const runs = C.nextRuns({ morning: { schedule: 'CRON_TZ=America/Chicago 25 4 * * *' }, weekly: { schedule: 'CRON_TZ=America/Chicago 57 17 * * 0' }, worker: { schedule: null } }, new Date('2026-10-19T23:45:00Z'));
  assert.deepEqual(runs.map(r => [r.task, C.ctClock(r.at.toISOString())]), [['morning', '04:25']], 'Monday: no weekly');
});

// ------------------------------------------------------------------------------------------------ B-106 the design hand-off
test('B-106: plan files a design doc\'s Tasks to add and Decisions proposed with the next free ids, once', async () => {
  const r = sample();
  const row = (i, cells) => `<row id='.${i}'>` + cells.map((c, j) => `<cell id='.${i}${j}'><paragraph id='.${i}${j}p'><text id='.${i}${j}t'>${c}</text></paragraph></cell>`).join('') + '</row>';
  const xml = `<doc node='N' rev='4'><paragraph id='z1.1' heading='1'>Captions follow-ups</paragraph><paragraph id='.2'>Lead.</paragraph>` +
    `<paragraph id='.3' heading='2'>Decisions proposed</paragraph><table id='.4'>${row(5, ['P-n', 'Decision', 'Why'])}${row(6, ['P-1', 'Captions keep the last line', 'Matt, Oct 20: it lost his place'])}</table>` +
    `<paragraph id='.7' heading='2'>Tasks to add</paragraph><table id='.8'>${row(9, ['Task', 'Depends', 'Definition of done', 'Milestone'])}` +
    `${row(10, ['Keep the last caption line (P-1)', 'B-02', 'the line stays after a pause; a harness test', 'M11'])}${row(11, ['Caption settings', '—', 'a toggle; npm test green', 'M11'])}</table></doc>`;
  const result = JSON.stringify({ verdict: 'allow', rev: 4, data: { rev: 4, xml, complete: true } });
  const jsonl = toolPair('r1', 'mcp__Claude_Docs__read', { ref: { object: 'node', id: 'N' }, engine: 'prose', container: { kind: 'project', id: 'AbCdEfGhIjKlMnOpQrStUv' } }, result).join('\n');
  const id = C.docIdOf('https://claude.ai/artifact/Captions-AbCdEfGhIjKlMnOpQrStUv');
  assert.equal(id, 'AbCdEfGhIjKlMnOpQrStUv');
  assert.throws(() => C.planFrom(r, C.designRead('', id), id), /no read of/);
  const p = C.planFrom(r, C.designRead(jsonl, id), id);
  assert.deepEqual(p.decisions.map(d => [d.id, d.pid, d.title, d.status]), [['D-003', 'P-1', 'Captions keep the last line', 'accepted']]);
  assert.deepEqual(p.tasks.map(t => [t.id, t.title, t.depends, t.milestone]), [['B-04', 'Keep the last caption line (D-003)', 'B-02', 'M11'], ['B-05', 'Caption settings', '', 'M11']]);
  assert.match(C.formatPlan(p), /node tools\/chart.mjs log decision D-003 --title 'Captions keep the last line'/);
  // --apply runs the printed commands in order through log.
  for (const c of p.commands) C.applyLog(r, (() => { const o = { _: [], trailer: [] }; for (let i = 0; i < c.length; i++) c[i].startsWith('--') ? (o[c[i].slice(2)] = c[++i]) : o._.push(c[i]); return o; })());
  assert.equal(r.decisions[0].id, 'D-003');
  assert.deepEqual(r.tasks.slice(-2).map(t => [t.id, t.status, t.title, t.depends.join(',')]), [['B-04', 'open', 'Keep the last caption line (D-003)', 'B-02'], ['B-05', 'open', 'Caption settings', '']]);
  assert.deepEqual(C.lintChart(r).filter(f => f.level === 'error'), []);
  const again = C.planFrom(r, C.designRead(jsonl, id), id);
  assert.deepEqual([again.commands, again.skipped.length], [[], 3], 'a second run files nothing');
  assert.match(C.formatPlan(again), /nothing to file/);
  assert.equal(C.handoffNoteCall().args.payload.ops[0].source.from.content, C.HANDOFF_NOTE);
});

// ------------------------------------------------------------------------------------------------ B-102 the watchdog windows
test('B-102: R-05 refuses a live deploy from :45 to :05 around each live watchdog run, and says when it opens', () => {
  const sched = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8')).tasks.live.watchdog.schedule;
  const at = iso => C.watchdogWindow(sched, new Date(iso));
  // Oct 20 is CDT (UTC-5): the 4:55 run is 09:55Z.
  assert.equal(at('2026-10-20T09:44:59Z'), null, '4:44:59 is open');
  assert.equal(C.ctClock(at('2026-10-20T09:45:00Z').run.toISOString()), '04:55', '4:45 is in the window');
  assert.equal(C.ctClock(at('2026-10-20T10:04:59Z').opens.toISOString()), '05:05', '5:04:59 is in it; it opens at 5:05');
  assert.equal(at('2026-10-20T10:05:00Z'), null, '5:05 is open');
  assert.equal(at('2026-10-20T08:30:00Z'), null, 'between windows');
  // Across midnight: 22:55 Central is 03:55Z the next day; 23:00 is in, 23:05 is out.
  assert.ok(at('2026-10-21T04:00:00Z'));
  assert.equal(at('2026-10-21T04:05:00Z'), null);
  // In CST (Nov 2, UTC-6) the 1:55 run is 07:55Z.
  assert.equal(C.ctClock(at('2026-11-02T07:50:00Z').run.toISOString()), '01:55');
  assert.equal(at('2026-11-02T06:50:00Z'), null);
  assert.equal(C.watchdogRefusal(sched, new Date('2026-10-20T09:50:00Z')), 'R-05 (D-142): the live watchdog runs at 04:55 CT; live deploys wait until 05:05 CT');
  assert.equal(C.watchdogRefusal(sched, new Date('2026-10-20T10:10:00Z')), null);
  // log rule: the next free id, on a decision in the record; --fn names the check.
  const s = sample();
  assert.throws(() => C.applyLog(s, { _: ['log', 'rule', 'R-07'], rule: 'r', decision: 'D-002', command: 'ship live', fn: 'f' }), /log rule R-02/);
  assert.throws(() => C.applyLog(s, { _: ['log', 'rule', 'R-02'], rule: 'r', decision: 'D-009', command: 'ship live', fn: 'f' }), /D-009 is not in the record/);
  C.applyLog(s, { _: ['log', 'rule', 'R-02'], rule: 'r', decision: 'D-002', command: 'ship live', fn: 'watchdogWindow', task: 'B-02' });
  assert.deepEqual(s.rules.at(-1), { id: 'R-02', rule: 'r', decision: 'D-002', task: 'B-02', command: 'ship live', check: 'watchdogWindow' });
  const r = rec();
  assert.deepEqual(r.rules.filter(x => x.check === 'watchdogWindow').map(x => [x.id, x.command, x.decision]), [['R-05', 'ship live', 'D-142']], 'the rule is in chart/rules.json');
});
