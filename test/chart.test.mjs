// The Chart (M12): chart/ is the project record; BACKLOG.md, DECISIONS.md and CHANGELOG.md are generated from it by
// tools/chart.mjs. chart/import keeps what the one-time import from v3 read (B-92); its code is gone (B-262).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, copyRepo, chartCopy, directRecordReads, openTasks } from './helpers.mjs';
import { build } from '../tools/build.mjs';
import * as C from '../tools/chart.mjs';

// B-153 (T-5): every read of the record goes to one copy taken as the tests start (helpers.mjs chartCopy).
const RECORD = chartCopy();
const rec = () => C.loadChart(RECORD);

test('chart/ and tools/chart.mjs stay outside the manifest, so a bookkeeping commit ships nothing', async () => {
  const dir = copyRepo(),
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-chart-dist-'));
  const { manifest } = await build({ root: dir, out, now: '2026-10-19T12:00:00Z' });
  assert.deepEqual(
    Object.keys(manifest.files).filter(f => f.startsWith('chart/') || f === 'tools/chart.mjs' || f === 'BACKLOG.md'),
    []
  );
});

// ------------------------------------------------------------------------------------------------ B-93 log
import { execFileSync } from 'node:child_process';

// B-198 follow-up (Oct 22): these tests prove what a hand chat with Matt present can do (a tenet, a trigger printout, the
// live health read), so they run as one whatever session runs them: a builder's own /tmp/ev/builder-run would refuse
// those by design and fail six of them. A test of the builder passes its own marker (EV_BUILDER_MARKER) explicitly.
process.env.EV_BUILDER_MARKER = path.join(os.tmpdir(), `ev-hand-chat-${process.pid}`, 'no-builder-run');
const SAMPLE_VIEWS = { doc: 'DOC', board: { node: 'BN' } };
const task = (id, o = {}) => ({
  id,
  kind: 'task',
  title: `Task ${id}`,
  dod: 'it works',
  milestone: 'M12',
  status: 'open',
  depends: [],
  notes: '',
  commit: null,
  source: 'test',
  ...o,
});
const sample = () => ({
  tasks: [
    task('B-01', { status: 'done', commit: 'abc1234', board: { row: 'v4 B-01: one' } }),
    task('B-02', { board: { row: 'v4 B-02: two' } }),
    task('B-03'),
  ],
  decisions: [
    { id: 'D-002', date: 'Oct 19', title: 'two', why: '', status: 'accepted', supersedes: ['D-001'], amends: [] },
    { id: 'D-001', date: 'Oct 18', title: 'one', why: '', status: 'superseded', supersedes: [], amends: [] },
  ],
  deploys: [
    {
      target: 'live',
      commit: '1111111',
      time: '2026-10-19T16:20:00-05:00',
      okFrom: 'Matt',
      verify: 'green',
      rollback: '0000000',
      tasks: [],
      line: { date: 'Oct 19', change: 'old row', why: 'w', decision: 'D-002' },
      source: 'Changelog tab',
    },
  ],
  rules: [{ id: 'R-01', rule: 'r', decision: 'D-002', task: 'B-01', command: 'ship live', check: 'mattOk' }],
  views: SAMPLE_VIEWS,
});

test('B-93: log changes one task and refuses what it must', () => {
  const r = sample();
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-02'], status: 'done' }), /needs --commit/);
  const out = C.applyLog(r, { _: ['log', 'B-02'], status: 'done', commit: 'def5678abc', note: 'shipped' });
  assert.equal(out.what, 'open -> done, commit def5678, notes');
  assert.equal(r.tasks[1].status, 'done');
  C.applyLog(r, { _: ['log', 'B-03'], status: 'in progress', name: 'three' });
  assert.equal(r.tasks[2].board.row, 'v4 B-03: three');
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-09'], status: 'done' }), /no task B-09/);
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-01'] }), /nothing to log/);
  // A deploy, a decision.
  C.applyLog(r, {
    _: ['log', 'deploy'],
    target: 'staging',
    commit: '2222222',
    verify: 'green',
    tasks: 'B-02',
    summary: 'two',
    time: '2026-10-19T21:05:00-05:00',
  });
  assert.throws(() => C.applyLog(r, { _: ['log', 'deploy'], target: 'live', commit: '2222222' }), /--ok Matt/);
  assert.throws(() => C.applyLog(r, { _: ['log', 'decision', 'D-009'], title: 'x' }), /next free decision id is D-003/);
  C.applyLog(r, {
    _: ['log', 'decision', 'D-003'],
    title: 'three',
    status: 'accepted',
    supersedes: 'D-002',
    now: undefined,
  });
  assert.equal(r.decisions[0].id, 'D-003');
  assert.equal(r.decisions.find(x => x.id === 'D-002').status, 'superseded');
});

test('B-93: log writes the record, regenerates BACKLOG.md and commits both, nothing else', () => {
  const dir = copyRepo();
  const run = (...a) =>
    execFileSync('node', [path.join(dir, 'tools', 'chart.mjs'), ...a, '--root', dir, '--transcript', '/dev/null'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'T',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 'T',
        GIT_COMMITTER_EMAIL: 't@example.com',
      },
    });
  // Any open task: the real record moves on as tasks are taken (B-43 was, Oct 20) and can have none open (D-246).
  const open = { id: openTasks(dir)[0] };
  assert.ok(open.id);
  const before = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const out = run('log', open.id, '--note', 'a note from the test', '--trailer', 'Test-Trailer: yes');
  assert.match(out, new RegExp(`log ${open.id}: notes; committed [0-9a-f]{7}`));
  const show = execFileSync('git', ['-C', dir, 'show', '--stat', '--format=%B', 'HEAD'], { encoding: 'utf8' });
  assert.match(show, new RegExp(`^${open.id}: notes \\(chart\\)\\n\\nTest-Trailer: yes`));
  assert.deepEqual(
    execFileSync('git', ['-C', dir, 'diff', '--name-only', before, 'HEAD'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .sort(),
    ['BACKLOG.md', 'chart/tasks.json']
  );
  assert.equal(fs.readFileSync(path.join(dir, 'BACKLOG.md'), 'utf8'), C.renderBacklog(C.loadChart(dir)));
});

test('B-143 (D-172): DECISIONS.md and CHANGELOG.md are generated from chart/ like BACKLOG.md', () => {
  const r = rec();
  for (const [f, text] of Object.entries(C.generatedFiles(r)))
    assert.equal(
      fs.readFileSync(path.join(RECORD, f), 'utf8'),
      text,
      `${f} differs from chart/: change the record with node tools/chart.mjs, never the file`
    );
  assert.match(C.renderDecisions(r), /\n\| D-172 \| Oct 21 \| The Docs views are retired/);
  assert.equal(
    C.renderDecisions(r)
      .split('\n')
      .filter(l => /^\| D-\d+ \|/.test(l)).length,
    r.decisions.length
  );
  assert.equal(
    C.renderChangelog(r)
      .split('\n')
      .filter(l => /^\| \w{3} \d+ \|/.test(l)).length,
    r.deploys.length
  );
  assert.deepEqual({ by: r.views.retired.by, at: r.views.retired.at }, { by: 'D-172', at: '2026-10-21' });
  assert.ok(r.views.board.node && r.views.decisions.node, 'the doc ids are kept');
});

// ------------------------------------------------------------------------------------------------ B-94 lint
test('B-94: the record lints green (npm test runs the Chart lint)', () => {
  const f = C.lintChart(rec(), { tests: C.testTexts(ROOT) });
  assert.deepEqual(
    f.filter(x => x.level === 'error'),
    [],
    C.formatLint(f)
  );
  const r = rec();
  assert.equal(r.tasks.find(t => t.id === 'B-98').renumberedFrom, 'B-83');
  assert.equal(r.tasks.filter(t => t.id === 'B-83').length, 1);
});

test('B-94: each check fires on a planted fault', () => {
  const r = sample();
  assert.deepEqual(C.lintChart(r), []);
  r.tasks.push(task('B-02')); // a duplicate id
  r.tasks[2].depends = ['B-77']; // a dependency on nothing
  r.tasks[0].commit = null; // done with no commit
  r.rules[0].decision = 'D-001'; // a rule on a superseded decision
  r.tasks.push({
    ...task('B-04', { kind: 'bug', status: 'inbox' }),
    words: 'the timer sat at 0:00',
    source: 'build chat',
    reportedAt: '2026-10-19T22:00:00Z',
  });
  r.tasks.push(
    task('B-05', { kind: 'request', status: 'declined', words: 'w', source: 's', reportedAt: 't', triage: {} })
  );
  const got = C.lintChart(r).map(x => `${x.level} ${x.check} ${x.id}`);
  assert.deepEqual(
    got.sort(),
    [
      'error declined-without-reason B-05',
      'error done-without-commit B-01',
      'error duplicate-id B-02',
      'error missing-dependency B-03',
      'error rule-decision R-01',
      'warn untriaged B-04',
    ].sort()
  );
});

// ------------------------------------------------------------------------------------------------ B-95 report and triage
const human = (text, at = '2026-10-19T23:40:00.000Z') =>
  JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: text } });
const toolPair = (id, name, input, result) => [
  JSON.stringify({ message: { content: [{ type: 'tool_use', id, name, input }] } }),
  JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: result }] }] },
  }),
];

test("B-95: report takes Matt's words from his message, exactly as written", () => {
  const jsonl = [
    human('ok next one'),
    human(
      'bug: the timer sat at 0:00 after I came back\n\nalso, nice work <system-reminder>x</system-reminder>',
      '2026-10-19T23:41:00.000Z'
    ),
  ].join('\n');
  assert.deepEqual(C.wordsFromChat(jsonl), {
    words: 'the timer sat at 0:00 after I came back',
    at: '2026-10-19T23:41:00.000Z',
    said: 'bug',
  });
  assert.equal(C.wordsFromChat(jsonl, 'nice work').words, 'also, nice work');
  // B-187: a fired builder session's text comes inside the routine's envelope; the words never carry its tags.
  const fired = human('<routine-fire-payload>\nidea: a planted probe\n</routine-fire-payload>');
  assert.deepEqual(C.wordsFromChat(fired).words, 'a planted probe');
  // Several reports on consecutive lines: a match files only its own line.
  const many = human(
    'File these:\n\nbug: the panel is centred\nbug: no right panel on Study\nquestion: same panel on all tabs?'
  );
  assert.deepEqual(C.wordsFromChat(many, 'no right panel'), {
    words: 'no right panel on Study',
    at: '2026-10-19T23:40:00.000Z',
    said: 'bug',
  });
  assert.equal(C.wordsFromChat(many, 'all tabs').words, 'question: same panel on all tabs?');
  const r = sample();
  const out = C.applyReport(r, { _: ['report', 'bug'], 'from-chat': true }, { jsonl });
  const t = r.tasks.at(-1);
  assert.deepEqual(
    [out.id, t.kind, t.status, t.words, t.source, t.reportedAt],
    ['B-04', 'bug', 'inbox', 'the timer sat at 0:00 after I came back', 'build chat', '2026-10-19T23:41:00.000Z']
  );
  assert.match(
    C.renderBacklog(r),
    /## Inbox[\s\S]*\| B-04 \| bug \| 2026-10-19T23:41:00.000Z \| the timer sat at 0:00 after I came back \| build chat \| inbox \|/
  );
  assert.equal(C.lintChart(r).find(f => f.id === 'B-04').level, 'warn');
  assert.throws(
    () => C.applyReport(sample(), { _: ['report', 'bug'], 'from-chat': true }, { jsonl: human('nothing to see') }),
    /no message in this session says/
  );
});

test('B-95: triage comes first, then the entry becomes a task, joins one, or is declined with a reason; nothing is deleted', () => {
  const r = sample();
  C.applyReport(r, {
    _: ['report', 'bug', 'the', 'timer', 'sat', 'at', '0:00'],
    source: 'build chat',
    at: '2026-10-19T23:41:00Z',
  });
  assert.throws(
    () => C.applyLog(r, { _: ['log', 'B-02'], status: 'in progress' }),
    /triage first: B-04 waits in the inbox/
  );
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-04'], status: 'in progress' }), /in the inbox: triage it first/);
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-04'], triage: 'task', dod: 'x' }), /needs --dod and --milestone/);
  C.applyLog(r, {
    _: ['log', 'B-04'],
    triage: 'task',
    dod: "the clock resumes from the session's start after a return; a harness test",
    milestone: 'M11',
  });
  const t = r.tasks.find(x => x.id === 'B-04');
  assert.deepEqual([t.status, t.milestone, t.triage.outcome], ['open', 'M11', 'task']);
  assert.match(
    C.renderBacklog(r),
    /\| B-04 \| Bug \(reported Oct 19\): the timer sat at 0:00 Done when: the clock resumes/
  );
  C.applyLog(r, { _: ['log', 'B-02'], status: 'in progress' });
  // A claim is the lock: a second claim on a task in progress is refused; a note alone still lands.
  assert.throws(
    () => C.applyLog(r, { _: ['log', 'B-02'], status: 'in progress', note: 'a second run' }),
    /already in progress: another session holds it/
  );
  C.applyLog(r, { _: ['log', 'B-02'], note: 'a milestone' });
  // join and decline keep the entry, marked.
  C.applyReport(r, { _: ['report', 'request', 'reorder', 'the', 'briefing'], source: 'build chat' });
  C.applyLog(r, { _: ['log', 'B-05', 'B-02'], triage: 'join' });
  C.applyReport(r, { _: ['report', 'request', 'a', 'dark', 'mode', 'toggle'], source: 'build chat' });
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-06'], triage: 'decline' }), /needs --reason/);
  C.applyLog(r, { _: ['log', 'B-06'], triage: 'decline', reason: 'the page is dark only by design (D-077)' });
  assert.deepEqual(
    r.tasks.slice(-2).map(x => [x.id, x.status, x.triage.outcome, x.triage.into]),
    [
      ['B-05', 'declined', 'joined', 'B-02'],
      ['B-06', 'declined', 'declined', undefined],
    ]
  );
  assert.equal(r.tasks.at(-1).triage.reason, 'the page is dark only by design (D-077)');
  assert.deepEqual(
    C.lintChart(r).filter(f => f.level === 'error'),
    []
  );
  // Matt may decline a task after it left the inbox (B-67, Oct 20): open or blocked only, with his reason.
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-02'], triage: 'decline', reason: 'x' }), /in progress, not in/);
  assert.throws(
    () => C.applyLog(r, { _: ['log', 'B-04'], triage: 'task', dod: 'x', milestone: 'M1' }),
    /not in the inbox/
  );
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-04'], triage: 'decline' }), /needs --reason/);
  C.applyLog(r, { _: ['log', 'B-04'], triage: 'decline', reason: 'Matt: not worth a session' });
  const d = r.tasks.find(x => x.id === 'B-04');
  assert.deepEqual([d.status, d.triage.outcome], ['declined', 'declined']);
  assert.deepEqual(
    C.lintChart(r).filter(f => f.level === 'error'),
    []
  );
});

test('B-95: a Board comment is filed from the comment query and answered with its id', () => {
  const r = sample();
  const q = {
    object: 'utterance',
    container: { kind: 'project', id: 'DOC' },
    payload: { under: { object: 'node', id: 'BN' } },
  };
  const rows = {
    verdict: 'allow',
    rows: [
      {
        id: 'u-1',
        verb: 'create',
        actor: { name: 'Mathew', self: true },
        payload: {
          value: {
            body: 'the Quiz me button does nothing on my phone',
            parent: { object: 'node', id: 'BN', anchor: {} },
          },
        },
      },
    ],
  };
  let jsonl = toolPair('q1', 'mcp__Claude_Docs__query', q, JSON.stringify(rows)).join('\n');
  assert.deepEqual(C.inboxPlan(r, null).query, C.commentQuery(r));
  assert.deepEqual(
    C.inboxPlan(r, jsonl).comments.map(c => [c.id, c.body]),
    [['u-1', 'the Quiz me button does nothing on my phone']]
  );
  const byId = toolPair('q0', 'mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__query', q, JSON.stringify(rows)).join('\n');
  assert.deepEqual(
    C.inboxPlan(r, byId).comments.map(c => c.id),
    ['u-1'],
    'the Docs connector named by its id is read too'
  );
  const out = C.applyReport(r, { _: ['report', 'bug'], 'from-comment': 'u-1' }, { jsonl });
  assert.equal(r.tasks.at(-1).words, 'the Quiz me button does nothing on my phone');
  assert.equal(r.tasks.at(-1).source, 'Board comment u-1');
  assert.deepEqual(out.reply.args.payload.value.parent, { object: 'utterance', id: 'u-1' });
  assert.match(out.reply.args.payload.value.body, /^Filed as B-04 \(bug\)/);
  assert.deepEqual(C.inboxPlan(r, jsonl).comments, [], 'filed: not listed again');
  assert.throws(() => C.applyReport(r, { _: ['report', 'bug'], 'from-comment': 'u-1' }, { jsonl }), /already filed/);
  assert.match(
    C.formatInbox(C.inboxPlan(r, jsonl)),
    /B-04 \(bug, .*from Board comment u-1\): "the Quiz me button does nothing on my phone"/
  );
});

// ------------------------------------------------------------------------------------------------ B-96 the build's commit
test("B-96: a bookkeeping commit (chart/, BACKLOG.md) never moves the build's commit; a code commit does", async () => {
  const dir = copyRepo(),
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-chart-dist-'));
  const g = (...a) =>
    execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], {
      encoding: 'utf8',
    }).trim();
  const first = (await build({ root: dir, out })).manifest;
  assert.equal(first.commit, g('rev-parse', 'HEAD'));
  fs.appendFileSync(path.join(dir, 'BACKLOG.md'), '\n');
  fs.writeFileSync(path.join(dir, 'chart', 'note.json'), '{}');
  assert.equal(
    (await build({ root: dir, out })).manifest.dirty,
    false,
    'an uncommitted bookkeeping change is not dirt'
  );
  g('add', '-A');
  g('commit', '-q', '-m', 'B-00: done (chart)');
  const after = (await build({ root: dir, out })).manifest;
  assert.equal(after.commit, first.commit, 'the chart commit leaves the build where it was');
  assert.deepEqual(after.files, first.files);
  fs.appendFileSync(path.join(dir, 'core', 'batches.mjs'), '\n');
  assert.equal((await build({ root: dir, out })).manifest.dirty, true);
  g('commit', '-qam', 'B-00: code');
  assert.equal((await build({ root: dir, out })).manifest.commit, g('rev-parse', 'HEAD'));
});

// ------------------------------------------------------------------------------------------------ B-96 ship and brief
const M = (o = {}) => ({
  commit: 'a'.repeat(40),
  release: 'v4.0.0',
  tasks: {
    'staging.morning': { record: 'staging', name: 'm', promptSha256: 'p1', trigger: 't1' },
    'live.morning': { record: 'live', name: 'm', promptSha256: 'p1', trigger: 't2' },
  },
  pages: { staging: { files: { 'page/staging/app.js': 'h1' }, capabilities: { db: {} } } },
  ...o,
});
const READS = [
  { tool: 'mcp__claude-code-remote__list_triggers', have: false },
  { tool: 'ArtifactData', args: { doc_id: 'manifest' }, have: true },
  { tool: 'Artifact', have: false },
];
const VERIFY = {
  lines: [
    { ok: true, what: 'build is clean' },
    { ok: false, what: 'system/manifest commit' },
    { ok: false, what: 'staging page read' },
    { ok: false, what: 'scheduled tasks read' },
  ],
};
const DEPLOY = {
  ok: true,
  calls: [{ tool: 'ArtifactData' }, { tool: 'Artifact' }, { tool: 'mcp__claude-code-remote__update_trigger' }],
  skipped: [],
};

test('B-96: ship skips the task and page reads (and their calls) when the deployed manifest, green when deployed, has the same', () => {
  const r = sample();
  r.deploys.push({ target: 'staging', commit: 'bbbbbbb', verify: 'green', time: 't', tasks: [] });
  const deployed = M({ commit: 'b'.repeat(40) });
  const skip = C.skips({ manifest: M(), target: 'staging', deployed, rec: r });
  assert.deepEqual(skip, { tasks: true, pages: true, from: 'bbbbbbb' });
  assert.equal(
    C.skips({
      manifest: M({ pages: { staging: { files: { 'page/staging/app.js': 'h2' }, capabilities: { db: {} } } } }),
      target: 'staging',
      deployed,
      rec: r,
    }).pages,
    false,
    'a changed page file is read'
  );
  assert.equal(
    C.skips({ manifest: M(), target: 'staging', deployed, rec: sample() }).tasks,
    false,
    'no green deploy at that commit in the record: read everything'
  );
  const step = C.shipStep({
    target: 'staging',
    manifest: M(),
    state: { record: { manifest: deployed } },
    verifyResult: VERIFY,
    reads: READS,
    deploy: DEPLOY,
    rec: r,
    refusals: [],
    skip,
    stale: null,
  });
  assert.equal(step.kind, 'deploy');
  assert.deepEqual(
    step.calls.map(c => c.tool),
    ['ArtifactData'],
    'no page publish, no trigger call'
  );
  assert.ok(step.lines.filter(l => /page read|tasks read/.test(l.what)).every(l => l.ok && /not read/.test(l.detail)));
  // Without the deployed manifest read yet: only that read is asked for.
  const first = C.shipStep({
    target: 'staging',
    manifest: M(),
    state: { record: null },
    verifyResult: VERIFY,
    reads: READS.map(x => ({ ...x, have: false })),
    deploy: DEPLOY,
    rec: r,
    refusals: [],
    skip: { tasks: false, pages: false },
    stale: null,
  });
  assert.deepEqual([first.kind, first.reads.map(x => x.tool)], ['reads', ['ArtifactData']]);
  // After calls that touched neither tasks nor the page, only the system documents are read again.
  const again = C.shipStep({
    target: 'staging',
    manifest: M(),
    state: { record: { manifest: deployed } },
    verifyResult: VERIFY,
    reads: READS.map(x => ({ ...x, have: true })),
    deploy: DEPLOY,
    rec: r,
    refusals: [],
    skip: { tasks: false, pages: false },
    stale: { tasks: false, pages: false },
  });
  assert.deepEqual(
    again.reads.map(x => x.tool),
    ['ArtifactData']
  );
  const green = C.shipStep({
    target: 'staging',
    manifest: M(),
    state: { record: { manifest: deployed } },
    verifyResult: { lines: [{ ok: true, what: 'x' }] },
    reads: READS.map(x => ({ ...x, have: true })),
    deploy: DEPLOY,
    rec: r,
    refusals: [],
    skip,
    stale: null,
  });
  assert.deepEqual([green.kind, green.recorded], ['verified', false]);
  assert.equal(
    C.shipStep({
      target: 'live',
      manifest: M(),
      state: {},
      verifyResult: VERIFY,
      reads: [],
      deploy: DEPLOY,
      rec: r,
      refusals: ['R-04 (D-083): no OK'],
      skip,
      stale: null,
    }).kind,
    'refused'
  );
});

test("B-96: ship reads the system documents' versions from this session's ArtifactData replies", () => {
  const url = 'https://claude.ai/artifact/X';
  const jsonl = ['manifest', 'spec']
    .flatMap((id, i) =>
      toolPair(
        'g' + i,
        'ArtifactData',
        { action: 'get', url, collection: 'system', doc_id: id, out_dir: '/tmp' },
        `1 document from collection "system" saved as JSON files:\n- "${id}"  15337 bytes  version ${71 + i}  "/tmp/system/${id}.json"`
      )
    )
    .join('\n');
  assert.deepEqual(C.versionsFrom(jsonl, url), { manifest: 71, spec: 72 });
  assert.deepEqual(C.versionsFrom(jsonl, 'https://claude.ai/artifact/Y'), {});
});

test('B-96: brief is one page: the inbox, the task, its dependencies, decisions, limits and the next live runs', () => {
  const b = C.brief(rec(), 'B-97');
  for (const h of [
    '## Inbox first',
    '## The task: B-97',
    '## Depends on',
    '## Decisions it rests on',
    '## What it may touch',
    '## The next 24 hours of live runs',
    '## Record as you go',
  ])
    assert.ok(b.includes(h), h);
  assert.match(b, /- B-93: done/);
  assert.match(b, /R-01: ended \(D-145: /, 'R-01 is kept and shown ended (B-141)');
  const runs = C.nextRuns(
    {
      morning: { schedule: 'CRON_TZ=America/Chicago 25 4 * * *' },
      weekly: { schedule: 'CRON_TZ=America/Chicago 57 17 * * 0' },
      worker: { schedule: null },
    },
    new Date('2026-10-19T23:45:00Z')
  );
  assert.deepEqual(
    runs.map(r => [r.task, C.ctClock(r.at.toISOString())]),
    [['morning', '04:25']],
    'Monday: no weekly'
  );
});

// ------------------------------------------------------------------------------------------------ B-106 the design hand-off
test("B-106: plan files a design doc's Tasks to add and Decisions proposed with the next free ids, once", async () => {
  const r = sample();
  const row = (i, cells) =>
    `<row id='.${i}'>` +
    cells
      .map(
        (c, j) => `<cell id='.${i}${j}'><paragraph id='.${i}${j}p'><text id='.${i}${j}t'>${c}</text></paragraph></cell>`
      )
      .join('') +
    '</row>';
  const xml =
    `<doc node='N' rev='4'><paragraph id='z1.1' heading='1'>Captions follow-ups</paragraph><paragraph id='.2'>Lead.</paragraph>` +
    `<paragraph id='.3' heading='2'>Decisions proposed</paragraph><table id='.4'>${row(5, ['P-n', 'Decision', 'Why'])}${row(6, ['P-1', 'Captions keep the last line', 'Matt, Oct 20: it lost his place'])}</table>` +
    `<paragraph id='.7' heading='2'>Tasks to add</paragraph><table id='.8'>${row(9, ['Task', 'Depends', 'Definition of done', 'Milestone'])}` +
    `${row(10, ['Keep the last caption line (P-1)', 'B-02', 'the line stays after a pause; a harness test', 'M11'])}${row(11, ['Caption settings', '—', 'a toggle; npm test green', 'M11'])}</table></doc>`;
  const result = JSON.stringify({ verdict: 'allow', rev: 4, data: { rev: 4, xml, complete: true } });
  const jsonl = toolPair(
    'r1',
    'mcp__Claude_Docs__read',
    { ref: { object: 'node', id: 'N' }, engine: 'prose', container: { kind: 'project', id: 'AbCdEfGhIjKlMnOpQrStUv' } },
    result
  ).join('\n');
  const id = C.docIdOf('https://claude.ai/artifact/Captions-AbCdEfGhIjKlMnOpQrStUv');
  assert.equal(id, 'AbCdEfGhIjKlMnOpQrStUv');
  assert.throws(() => C.planFrom(r, C.designRead('', id), id), /no read of/);
  const p = C.planFrom(r, C.designRead(jsonl, id), id);
  assert.deepEqual(
    p.decisions.map(d => [d.id, d.pid, d.title, d.status]),
    [['D-003', 'P-1', 'Captions keep the last line', 'accepted']]
  );
  assert.deepEqual(
    p.tasks.map(t => [t.id, t.title, t.depends, t.milestone]),
    [
      ['B-04', 'Keep the last caption line (D-003)', 'B-02', 'M11'],
      ['B-05', 'Caption settings', '', 'M11'],
    ]
  );
  assert.match(C.formatPlan(p), /node tools\/chart.mjs log decision D-003 --title 'Captions keep the last line'/);
  // --apply runs the printed commands in order through log.
  for (const c of p.commands)
    C.applyLog(
      r,
      (() => {
        const o = { _: [], trailer: [] };
        for (let i = 0; i < c.length; i++) c[i].startsWith('--') ? (o[c[i].slice(2)] = c[++i]) : o._.push(c[i]);
        return o;
      })()
    );
  assert.equal(r.decisions[0].id, 'D-003');
  assert.deepEqual(
    r.tasks.slice(-2).map(t => [t.id, t.status, t.title, t.depends.join(',')]),
    [
      ['B-04', 'open', 'Keep the last caption line (D-003)', 'B-02'],
      ['B-05', 'open', 'Caption settings', ''],
    ]
  );
  assert.deepEqual(
    C.lintChart(r).filter(f => f.level === 'error'),
    []
  );
  const again = C.planFrom(r, C.designRead(jsonl, id), id);
  assert.deepEqual([again.commands, again.skipped.length], [[], 3], 'a second run files nothing');
  assert.match(C.formatPlan(again), /nothing to file/);
});

// ------------------------------------------------------------------------------------------------ B-109 tenets
const logArgs = c => {
  const o = { _: [], trailer: [] };
  for (let i = 0; i < c.length; i++) c[i].startsWith('--') ? (o[c[i].slice(2)] = c[++i]) : o._.push(c[i]);
  return o;
};
test('B-109: a tenet carries scope and check; brief lists it for tasks in its scope; superseding it makes lint name what still cites it', () => {
  const r = sample();
  r.tasks.push(
    task('B-04', { title: 'Greeting card spacing in page/app.js', milestone: 'M11' }),
    task('B-05', { title: 'Watchdog retries in core/steps.mjs', milestone: 'M9' })
  );
  assert.throws(
    () => C.applyLog(r, logArgs(['log', 'decision', 'D-003', '--title', 'x', '--kind', 'tenet'])),
    /needs --scope/
  );
  assert.throws(
    () =>
      C.applyLog(
        r,
        logArgs([
          'log',
          'decision',
          'D-003',
          '--title',
          'x',
          '--kind',
          'tenet',
          '--scope',
          'ui',
          '--checked-by',
          'vibes',
        ])
      ),
    /needs --checked-by/
  );
  const did = C.applyLog(
    r,
    logArgs([
      'log',
      'decision',
      'D-003',
      '--title',
      'One primary action per screen',
      '--status',
      'accepted',
      '--kind',
      'tenet',
      '--scope',
      'ui',
      '--checked-by',
      'harness',
    ])
  );
  assert.match(did.what, /^tenet D-003 \(accepted, ui, harness\)/);
  assert.deepEqual([r.decisions[0].kind, r.decisions[0].scope, r.decisions[0].check], ['tenet', ['ui'], 'harness']);
  assert.deepEqual(C.lintChart(r), []);
  // The page task's brief lists it; the pipeline task's does not; --scope overrides.
  assert.deepEqual([C.taskScope(r.tasks[3]), C.taskScope(r.tasks[4])], [['ui'], ['pipelines']]);
  const page = C.brief(r, 'B-04', { root: ROOT }),
    pipe = C.brief(r, 'B-05', { root: ROOT });
  assert.match(page, /## Tenets in scope \(ui\)\n- D-003 \(ui; checked by harness\): One primary action per screen/);
  assert.doesNotMatch(pipe, /D-003/);
  assert.match(pipe, /## Tenets in scope \(pipelines\)\n- None accepted in this scope/);
  assert.match(C.brief(r, 'B-05', { root: ROOT, scope: 'ui' }), /- D-003 /);
  assert.equal(C.taskScope(task('B-09', { title: 'x', milestone: 'M14 UI' }))[0], 'ui', 'from the milestone');
  assert.equal(
    C.taskScope(task('B-09', { title: 'retime spec.pipelines.morning', milestone: 'M9' }))[0],
    'pipelines',
    'from a spec key'
  );
  // An open task, a rule and a test that cite it; then a tenet supersedes it.
  r.tasks[3].dod = 'follows D-003; a harness check';
  r.rules.push({ id: 'R-02', rule: 'r2', decision: 'D-003', task: 'B-04', command: 'ship live', check: 'x' });
  C.applyLog(
    r,
    logArgs([
      'log',
      'decision',
      'D-004',
      '--title',
      'Two actions at most',
      '--status',
      'accepted',
      '--kind',
      'tenet',
      '--scope',
      'ui',
      '--checked-by',
      'review',
      '--supersedes',
      'D-003',
    ])
  );
  assert.equal(r.decisions.find(d => d.id === 'D-003').status, 'superseded');
  const tests = { 'test/harness/look.cjs': "check('one primary action (D-003)')", 'test/other.test.mjs': 'nothing' };
  const got = C.lintChart(r, { tests }).map(f => `${f.check} ${f.id}`);
  assert.deepEqual(got.sort(), [
    'rule-decision R-02',
    'superseded-tenet B-04',
    'superseded-tenet test/harness/look.cjs',
  ]);
  assert.match(C.lintChart(r).find(f => f.id === 'B-04').detail, /cites D-003 \(superseded by D-004\)/);
  // The sweep task names both, so it is not flagged; a done task is history.
  r.tasks.push(task('B-06', { title: 'Sweep: what still follows D-003 moves to D-004', milestone: 'M11' }));
  r.tasks[3].status = 'done';
  r.tasks[3].commit = 'abc1234';
  assert.deepEqual(
    C.lintChart(r).filter(f => f.check === 'superseded-tenet'),
    []
  );
  // The brief now lists the new one only.
  assert.match(C.brief(r, 'B-06', { root: ROOT, scope: 'ui' }), /- D-004 \(ui; checked by review\)/);
  assert.doesNotMatch(
    C.brief(r, 'B-06', { root: ROOT, scope: 'ui' }).split('## Where to look')[0].split('## Tenets in scope')[1],
    /D-003 \(/
  );
  // A planted bad kind and scope lint red.
  r.decisions.push({
    id: 'D-005',
    date: 'Oct 20',
    title: 't',
    why: '',
    status: 'accepted',
    supersedes: [],
    amends: [],
    kind: 'tenet',
    scope: ['look'],
    check: 'harness',
  });
  assert.deepEqual(
    C.lintChart(r)
      .filter(f => f.id === 'D-005')
      .map(f => f.check),
    ['tenet-scope']
  );
});

test('B-109: plan files a Tenets proposed table with scope and check, numbered with the decisions; the Decisions tab shows the kind', () => {
  const r = sample();
  const row = (i, cells) =>
    `<row id='.${i}'>` +
    cells
      .map(
        (c, j) => `<cell id='.${i}${j}'><paragraph id='.${i}${j}p'><text id='.${i}${j}t'>${c}</text></paragraph></cell>`
      )
      .join('') +
    '</row>';
  const xml =
    `<doc node='N' rev='4'><paragraph id='z1.1' heading='1'>UI tenets</paragraph>` +
    `<paragraph id='.3' heading='2'>Decisions proposed</paragraph><table id='.4'>${row(5, ['P-n', 'Decision', 'Why'])}${row(6, ['P-1', 'The greeting moves up', 'Matt'])}</table>` +
    `<paragraph id='.20' heading='2'>Tenets proposed</paragraph><table id='.21'>${row(22, ['P-n', 'Tenet', 'Scope', 'Check', 'Why'])}${row(23, ['P-2', 'One primary action per screen', 'UI', 'harness', 'it lost his place'])}${row(24, ['P-3', 'Words before icons', 'ui, data', 'Review', 'P-1 needs it'])}</table>` +
    `<paragraph id='.7' heading='2'>Tasks to add</paragraph><table id='.8'>${row(9, ['Task', 'Depends', 'Definition of done', 'Milestone'])}${row(10, ['Apply P-2 to the greeting', '—', 'a harness check', 'M14 UI'])}</table></doc>`;
  const result = JSON.stringify({ verdict: 'allow', rev: 4, data: { rev: 4, xml, complete: true } });
  const id = 'AbCdEfGhIjKlMnOpQrStUv';
  const jsonl = toolPair(
    'r1',
    'mcp__Claude_Docs__read',
    { ref: { object: 'node', id: 'N' }, engine: 'prose', container: { kind: 'project', id } },
    result
  ).join('\n');
  const p = C.planFrom(r, C.designRead(jsonl, id), id);
  assert.deepEqual(
    p.decisions.map(d => [d.id, d.pid, d.kind, d.scope, d.check]),
    [
      ['D-003', 'P-1', 'decision', undefined, undefined],
      ['D-004', 'P-2', 'tenet', ['ui'], 'harness'],
      ['D-005', 'P-3', 'tenet', ['ui', 'data'], 'review'],
    ]
  );
  assert.equal(p.decisions[2].why, 'D-003 needs it');
  assert.equal(p.tasks[0].title, 'Apply D-004 to the greeting');
  assert.match(C.formatPlan(p), /1 decision, 2 tenets and 1 task to file/);
  assert.match(
    C.formatPlan(p),
    /log decision D-004 --title 'One primary action per screen' --why 'it lost his place' --status accepted --kind tenet --scope ui --checked-by harness/
  );
  for (const c of p.commands) C.applyLog(r, logArgs(c));
  assert.deepEqual(
    r.decisions.slice(0, 3).map(d => [d.id, C.kindOf(d), (d.scope || []).join(','), d.check || '']),
    [
      ['D-005', 'tenet', 'ui,data', 'review'],
      ['D-004', 'tenet', 'ui', 'harness'],
      ['D-003', 'decision', '', ''],
    ]
  );
  assert.deepEqual(
    C.lintChart(r).filter(f => f.level === 'error'),
    []
  );
  assert.deepEqual(C.planFrom(r, C.designRead(jsonl, id), id).commands, [], 'a second run files nothing');
  // A Check cell that says how: its first check word is the kind, the whole cell is kept as how.
  assert.deepEqual(
    [
      'harness: at load each tab shows one primary button',
      'lint (B-89): no monospace; harness: at most 2',
      'look pass at 375x667 and 1280x800',
      'Review',
    ].map(C.checkOf),
    ['harness', 'lint', 'harness', 'review']
  );
  const how = C.planFrom(
    sample(),
    C.designRead(jsonl.replace('>harness<', '>harness: at most one primary button at 390<'), id),
    id
  );
  assert.deepEqual(
    [how.decisions[1].check, how.decisions[1].how],
    ['harness', 'harness: at most one primary button at 390']
  );
  assert.ok(how.commands[1].includes('--how'));
  // plan --apply on a copy files the whole hand-off in one commit (runs clone main only so deep, B-110).
  const dir = copyRepo(),
    tr = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(tr, jsonl.replace('>harness<', '>harness: at most one primary button at 390<'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: 't@example.com',
  };
  const before = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const out = execFileSync(
    'node',
    [
      path.join(dir, 'tools', 'chart.mjs'),
      'plan',
      '--from',
      `https://claude.ai/code/artifact/${id}`,
      '--apply',
      '--root',
      dir,
      '--transcript',
      tr,
      '--trailer',
      'X-Test: 1',
    ],
    { encoding: 'utf8', env }
  );
  const real = C.loadChart(dir),
    d0 = real.decisions.find(d => d.how);
  assert.match(out, /plan: filed D-\d{3}, D-\d{3}, D-\d{3}, B-\d+; committed/);
  assert.equal(
    execFileSync('git', ['-C', dir, 'rev-list', '--count', `${before}..HEAD`], { encoding: 'utf8' }).trim(),
    '1'
  );
  assert.match(
    execFileSync('git', ['-C', dir, 'log', '-1', '--format=%B'], { encoding: 'utf8' }),
    /^D-\d{3} to D-\d{3}, B-\d+: plan AbCdEfGhIjKlMnOpQrStUv: 1 decisions, 2 tenets, 1 tasks \(chart\)\n\nX-Test: 1/
  );
  assert.deepEqual([d0.kind, d0.check, d0.how], ['tenet', 'harness', 'harness: at most one primary button at 390']);
  assert.match(
    C.brief(real, real.tasks.at(-1).id, { root: dir }),
    /checked by harness\): One primary action per screen\n  Check: harness: at most one primary button at 390/
  );
  // A read too large for the transcript is followed to the file it was saved to, as an array of texts or plain.
  for (const body of [JSON.stringify([{ type: 'text', text: result }]), result]) {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-saved-')), 'mcp-Claude_Docs-read-1.txt');
    fs.writeFileSync(f, body);
    const big = toolPair(
      'r2',
      'mcp__Claude_Docs__read',
      { ref: { object: 'node', id: 'N' }, engine: 'prose', container: { kind: 'project', id } },
      `Error: result (73,401 characters across 1 line) exceeds maximum allowed tokens. Output has been saved to ${f}.\nFormat: Plain text`
    ).join('\n');
    assert.equal(C.planFrom(sample(), C.designRead(big, id), id).decisions.length, 3);
  }
  // A row with no scope or a check outside the list is refused, filing nothing.
  const bad = xml.replace('>harness<', '>vibes<');
  assert.throws(
    () =>
      C.planFrom(
        sample(),
        C.designRead(jsonl.replace(JSON.stringify(xml).slice(1, -1), JSON.stringify(bad).slice(1, -1)), id),
        id
      ),
    /P-2 needs a check/
  );
});

test('B-109: the review skill checks the diff against the tenets in scope; CLAUDE.md says how a tenet changes', () => {
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'review', 'SKILL.md'), 'utf8');
  assert.match(skill, /Tenets in scope/);
  assert.match(skill, /Check the diff against each tenet in scope/);
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(
    claude,
    /A tenet is changed only by a superseding tenet plus a sweep task for what still follows the old one/
  );
});

// ------------------------------------------------------------------------------------------------ B-60 the rollback
test("B-60: rollback live dry-runs going back to the previous live build at main's head, and --apply makes the restore commit", () => {
  const dir = copyRepo();
  const g = (...a) =>
    execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], {
      encoding: 'utf8',
    }).trim();
  const A = g('rev-parse', 'HEAD');
  fs.appendFileSync(path.join(dir, 'core', 'watch.mjs'), '\n// a change after A\n');
  fs.writeFileSync(path.join(dir, 'core', 'extra.mjs'), 'export const x = 1;\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'B-01: after A');
  const B = g('rev-parse', 'HEAD');
  const deploys = JSON.parse(fs.readFileSync(path.join(dir, 'chart', 'deploys.json'), 'utf8'));
  deploys.push(
    {
      target: 'live',
      commit: A.slice(0, 7),
      time: '2026-10-20T01:00:00Z',
      okFrom: 'Matt',
      verify: 'green',
      rollback: null,
      tasks: [],
      source: 'log',
    },
    {
      target: 'live',
      commit: B.slice(0, 7),
      time: '2026-10-20T02:00:00Z',
      okFrom: 'Matt',
      verify: 'green',
      rollback: A.slice(0, 7),
      tasks: [],
      source: 'log',
    }
  );
  fs.writeFileSync(path.join(dir, 'chart', 'deploys.json'), JSON.stringify(deploys, null, 1));
  g('add', '-A');
  g('commit', '-q', '-m', 'B-01: live deploys (chart)');
  const head = g('rev-parse', 'HEAD');
  const run = (...a) => {
    try {
      return {
        code: 0,
        out: execFileSync(
          'node',
          [path.join(dir, 'tools', 'chart.mjs'), 'rollback', 'live', ...a, '--root', dir, '--transcript', '/dev/null'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        ),
      };
    } catch (e) {
      return { code: e.status, out: String(e.stdout) + String(e.stderr) };
    }
  };
  const dry = run('--no-test');
  assert.equal(dry.code, 0, dry.out);
  assert.match(
    dry.out,
    new RegExp(
      `^rollback live: from ${B.slice(0, 7)} .* to ${A.slice(0, 7)} .*chart/deploys.json\\): DRY RUN, nothing is written or deployed`
    )
  );
  assert.match(
    dry.out,
    /It does not undo: .*an applied schema bump or migration stays applied and its legacy copies are kept/
  );
  assert.match(dry.out, /Schema: none crossed/);
  assert.match(dry.out, /Live tasks' prompts: the same in both builds: no task call/);
  assert.match(
    dry.out,
    new RegExp(
      `1 file back to ${A.slice(0, 7)}: core/watch.mjs; 1 added since, removed from the tree \\(kept in history\\): core/extra.mjs`
    )
  );
  assert.match(dry.out, new RegExp(`the restore build equals ${A.slice(0, 7)}'s build`));
  assert.match(
    dry.out,
    /1\. system documents: ArtifactData[\s\S]*"doc_id": "manifest"[\s\S]*2\. page[^\n]*: Artifact[\s\S]*"capabilities"/
  );
  assert.match(dry.out, /rollback live --matt-ok --apply[\s\S]*ship staging[\s\S]*ship live --matt-ok/);
  // A dry run writes nothing: same head, clean tree, no worktree left, no live gate file.
  assert.deepEqual(
    [
      g('rev-parse', 'HEAD'),
      g('status', '--porcelain'),
      g('worktree', 'list').split('\n').length,
      fs.existsSync(path.join(dir, 'dist', 'live-ok')),
    ],
    [head, '', 1, false]
  );
  assert.match(run('--to', 'abcdef1', '--no-test').out, /not an earlier live build/);
  assert.match(run('--apply', '--no-test').out, /needs Matt's explicit OK/);
  assert.equal(g('rev-parse', 'HEAD'), head, 'refused: no commit');
  const applied = run('--matt-ok', '--apply', '--no-test', '--trailer', 'X-Test: 1');
  assert.equal(applied.code, 0, applied.out);
  assert.equal(g('rev-list', '--count', `${head}..HEAD`), '1');
  assert.match(
    g('log', '-1', '--format=%B'),
    new RegExp(`^B-60: roll live back to ${A.slice(0, 7)}'s content, from ${B.slice(0, 7)}`)
  );
  assert.equal(
    g('diff', '--name-only', A, 'HEAD', '--', 'core', 'page', 'spec', 'tools', 'test'),
    '',
    "the code is A's again"
  );
  assert.ok(!fs.existsSync(path.join(dir, 'core', 'extra.mjs')));
  assert.equal(g('diff', '--name-only', head, 'HEAD', '--', 'chart'), '', 'the record is kept');
  assert.equal(g('status', '--porcelain'), '');
});

test("B-111: a deploy credits each commit's own task, not every id a subject mentions", () => {
  assert.deepEqual(
    C.commitTasks(
      [
        'B-111: ideas rows (chart)',
        'D-161 to D-165, B-111 to B-126: plan fab: 10 decisions (chart)',
        'B-60: the rollback',
        'B-109: tenets; see B-106',
      ].join('\n')
    ),
    // B-144 (W-2): the record commit "B-111: ideas rows (chart)" ships nothing, so it credits nothing.
    ['B-109', 'B-60']
  );
});

test('B-60: the rollback names the schemas it crosses and the live prompts that differ; the skill names its steps', () => {
  assert.deepEqual(C.schemaCrossings({ weeks: 2, ideas: 2, notes: 1 }, { weeks: 1, ideas: 2 }), [
    { collection: 'weeks', now: 2, then: 1 },
    { collection: 'notes', now: 1, then: null },
  ]);
  assert.deepEqual(C.schemaCrossings({ weeks: 2 }, { weeks: 2 }), []);
  const m = p => ({
    tasks: {
      'live.morning': { record: 'live', promptSha256: p },
      'live.evening-mac': { record: 'live', promptSha256: 'm', macBound: true },
      'staging.morning': { record: 'staging', promptSha256: 'x' },
    },
  });
  assert.deepEqual(C.promptChanges(m('a'), m('b')), [{ task: 'live.morning', macBound: false }]);
  assert.deepEqual(C.promptChanges(m('a'), m('a')), []);
  const r = sample();
  r.deploys.push({
    target: 'live',
    commit: '2222222',
    time: 't',
    okFrom: 'Matt',
    verify: 'green',
    rollback: '1111111',
    tasks: [],
  });
  assert.deepEqual([C.rollbackTarget(r).from.commit, C.rollbackTarget(r).to.commit], ['2222222', '1111111']);
  r.deploys.push({
    target: 'live',
    commit: '3333333',
    time: 't',
    okFrom: 'Matt',
    verify: 'green',
    rollback: '2222222',
    tasks: [],
  });
  assert.equal(C.rollbackTarget(r).to.commit, '2222222');
  assert.equal(C.rollbackTarget(r, '1111111').to.commit, '1111111');
  assert.ok(
    C.ROLLBACK_KEEP.some(re => re.test('chart/deploys.json')) &&
      !C.ROLLBACK_KEEP.some(re => re.test('core/evcore.mjs')) &&
      !C.ROLLBACK_KEEP.some(re => re.test('tools/chart.mjs'))
  );
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'rollback', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: rollback\n/);
  for (const w of [
    'chart/deploys.json',
    'rollback live',
    '--matt-ok --apply',
    'ship staging',
    'ship live --matt-ok',
    'live tasks',
    'schema',
    'legacy copies',
    'Mac',
  ])
    assert.ok(skill.includes(w), w);
  assert.match(
    fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').replace(/\s+/g, ' '),
    /\.claude\/skills\/rollback\/SKILL\.md/
  );
});

// ------------------------------------------------------------------------------------------------ log rule
test('log rule takes the next free id, on a decision in the record; --fn names the check', () => {
  const s = sample();
  assert.throws(
    () => C.applyLog(s, { _: ['log', 'rule', 'R-07'], rule: 'r', decision: 'D-002', command: 'ship live', fn: 'f' }),
    /log rule R-02/
  );
  assert.throws(
    () => C.applyLog(s, { _: ['log', 'rule', 'R-02'], rule: 'r', decision: 'D-009', command: 'ship live', fn: 'f' }),
    /D-009 is not in the record/
  );
  C.applyLog(s, {
    _: ['log', 'rule', 'R-02'],
    rule: 'r',
    decision: 'D-002',
    command: 'ship live',
    fn: 'fullCheck',
    task: 'B-02',
  });
  assert.deepEqual(s.rules.at(-1), {
    id: 'R-02',
    rule: 'r',
    decision: 'D-002',
    task: 'B-02',
    command: 'ship live',
    check: 'fullCheck',
  });
});

test('log sets depends on a filed task, and an open task joins another (the v4.1 review, Oct 21)', () => {
  const r = sample();
  const out = C.applyLog(r, { _: ['log', 'B-03'], depends: 'B-01, B-02' });
  assert.equal(out.what, 'depends');
  assert.deepEqual(r.tasks[2].depends, ['B-01', 'B-02']);
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-03'], depends: 'B-99' }), /--depends B-99: no such task/);
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-03'], depends: 'B-03' }), /cannot depend on itself/);
  assert.match(C.renderBacklog(r), /\| B-03 \| [^\n]*\| B-01, B-02 \|/);
  const open = r.tasks.find(x => x.status === 'open' && x.id !== 'B-03') || r.tasks[2];
  const into = r.tasks.find(x => x.id !== open.id).id;
  C.applyLog(r, { _: ['log', open.id, into], triage: 'join' });
  assert.deepEqual([open.status, open.triage.outcome, open.triage.into], ['declined', 'joined', into]);
  assert.deepEqual(
    C.lintChart(r).filter(f => f.level === 'error'),
    []
  );
});

test("log rewrites a task's definition of done or title outside triage", () => {
  const r = sample();
  const out = C.applyLog(r, { _: ['log', 'B-03'], dod: 'a new definition', title: 'a new title' });
  assert.equal(out.what, 'definition of done, title');
  assert.deepEqual([r.tasks[2].dod, r.tasks[2].title], ['a new definition', 'a new title']);
});

test('a decision restated after it was filed is marked with the date (Oct 20)', () => {
  const r = sample();
  C.applyLog(
    r,
    { _: ['log', 'decision', 'D-002'], title: 'two, folding', why: 'restated', status: 'accepted' },
    { now: '2026-10-21T03:00:00Z' }
  );
  assert.equal(r.decisions.find(d => d.id === 'D-002').restated, 'Oct 20');
  C.applyLog(r, { _: ['log', 'decision', 'D-001'], title: 'one', status: 'superseded' });
  assert.ok(!r.decisions.find(d => d.id === 'D-001').restated, 'the same words restate nothing');
});

test('B-138 (D-180): brief leads with the live health/current age from a saved read, stale past staleHours, or the read to make', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-health-'));
  fs.mkdirSync(path.join(root, 'spec'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), path.join(root, 'spec', 'ev.spec.json'));
  const now = Date.parse('2026-10-21T06:00:00Z');
  let h = C.healthLines(root, now, null);
  assert.equal(h.stale, null);
  assert.match(
    h.lines[0],
    /^- Not read in this session: ArtifactData \{"action":"get",.*"collection":"health","doc_id":"current"/
  );
  const dir = path.join(root, 'dist', 'state', 'live', 'record', 'health');
  fs.mkdirSync(dir, { recursive: true });
  const plant = hoursAgo =>
    fs.writeFileSync(
      path.join(dir, 'current.json'),
      JSON.stringify({ id: 'current', at: new Date(now - hoursAgo * 36e5).toISOString() })
    );
  plant(32.5);
  h = C.healthLines(root, now, null);
  assert.equal(h.stale, true);
  assert.match(h.lines[0], /^- health\/current is 32 h old \(written 2026-10-19T21:30:00\.000Z; stale past 4 h\)\./);
  assert.match(h.lines[1], /^- STALE: take this first \(D-180\)/);
  plant(1.5);
  h = C.healthLines(root, now, null);
  assert.equal(h.stale, false);
  assert.deepEqual(h.lines, [
    '- health/current is 1 h old (written 2026-10-21T04:30:00.000Z; stale past 4 h).',
    '- Fresh: go on.',
  ]);
  // B-179: a builder run reads no live record; its health read is the live watchdog's last_run.
  h = C.healthLines(root, now, { at: new Date(now).toISOString(), head: null });
  assert.equal(h.stale, null);
  assert.match(h.lines[0], /^- A builder run reads no live record: .*list_triggers \(trig_01GrcEzEwb4L3oXX7dsTdpwD\)/);
  // brief puts it first, before the inbox.
  const r = sample();
  const page = C.brief(r, 'B-02', { root, now });
  assert.ok(page.indexOf('## Health first (D-180)') < page.indexOf('## Inbox first'));
  assert.match(page, /health\/current is 1 h old/);
});

test('B-141: a rule is marked ended with the decision that ended it, kept, left out of brief and of ship (R-01, D-145)', () => {
  const r = sample();
  r.rules = [
    {
      id: 'R-01',
      rule: 'page-only live',
      decision: 'D-002',
      task: 'B-03',
      command: 'ship live',
      check: 'pageOnlyLive',
    },
  ];
  assert.throws(() => C.applyLog(r, { _: ['log', 'rule', 'R-01'], ended: 'because' }), /starts with the decision/);
  const out = C.applyLog(r, { _: ['log', 'rule', 'R-01'], ended: 'D-002: the window closed' });
  assert.match(out.what, /rule R-01 \(pageOnlyLive, ended\)/);
  assert.equal(r.rules.length, 1, 'kept');
  assert.equal(r.rules[0].ended, 'D-002: the window closed');
  const real = C.loadChart(RECORD).rules;
  assert.match(real.find(x => x.id === 'R-01').ended, /^D-145/, 'the record marks R-01 ended');
});

test('B-141: CLAUDE.md and the skills say what is true: the staging record id, the Foundation doc tab count, ship staging, no exam-week freeze', () => {
  const md = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
  assert.ok(md.includes(spec.registry.records.staging.artifact), 'the staging record by its id');
  assert.ok(md.includes(spec.registry.records.live.artifact), 'the live record by its id');
  // The Foundation v4 doc's tabs as read on Oct 21: a tab added there is added here and in CLAUDE.md together.
  const TABS = [
    'main',
    'v3 audit',
    'Data architecture',
    'Operational architecture',
    'Features',
    'Build plan',
    'UI and UX',
  ];
  const line = md.replace(/\n/g, ' ').match(/\((\w+) tabs: ([^)]+)\)/);
  assert.ok(line, 'CLAUDE.md lists the tabs');
  assert.equal(line[1], ['', '', '', '', '', '', 'seven'][TABS.length - 1] || String(TABS.length));
  assert.deepEqual(
    line[2].split(' · ').map(t => t.trim().replace(/\s+/g, ' ')),
    TABS
  );
  for (const f of ['CLAUDE.md', '.claude/skills/review/SKILL.md', '.claude/skills/rollback/SKILL.md']) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(t, /`deploy staging`|`deploy live`(?! --matt-ok)/, `${f}: the step is ship, not deploy`);
    assert.doesNotMatch(t, /6pm Tuesday|exam week unless/, `${f}: no exam-week freeze (D-178)`);
    assert.doesNotMatch(t, /created in B-12|until cutover/, `${f}: no pre-cutover wording`);
  }
});

test('B-142 (W-7): lint warns on stale flags (waiting on someone when finished, a rule whose condition is done, a retired reason on a superseded decision); done and declined clear waitingOn', () => {
  const r = sample();
  r.decisions.push({ id: 'D-003', title: 'three', why: '', status: 'accepted', supersedes: ['D-002'], amends: [] });
  r.decisions.find(d => d.id === 'D-002').status = 'superseded';
  r.tasks[1].waitingOn = 'Matt';
  r.tasks[2].waitingOn = 'Matt';
  r.tasks[2].status = 'done';
  r.tasks[2].commit = 'abc1234';
  r.rules = [
    {
      id: 'R-01',
      rule: 'page-only while B-01 is not done',
      decision: 'D-003',
      task: 'B-01',
      command: 'ship live',
      check: 'pageOnlyLive',
    },
    {
      id: 'R-02',
      rule: 'staging green first',
      decision: 'D-003',
      task: 'B-01',
      command: 'ship live',
      check: 'stagingGate',
    },
  ];
  const spec = {
    tasks: {
      retired: [
        { trigger: 'trig_a', reason: 'D-002: kept for the rollback' },
        { trigger: 'trig_b', reason: 'D-003 closed the window (D-002); kept' },
      ],
    },
  };
  const got = C.lintChart(r, { spec })
    .filter(f => f.level === 'warn')
    .map(f => `${f.check} ${f.id}`);
  assert.deepEqual(got.sort(), ['stale-retired trig_a', 'stale-rule R-01', 'stale-waiting B-03'].sort());
  // log clears waitingOn when a task is done, and when it is declined.
  C.applyLog(r, { _: ['log', 'B-02'], status: 'done', commit: 'def5678' });
  assert.equal(r.tasks[1].waitingOn, undefined);
  r.tasks.push({ ...r.tasks[2], id: 'B-04', status: 'open', waitingOn: 'Matt', commit: null });
  C.applyLog(r, { _: ['log', 'B-04'], triage: 'decline', reason: 'Matt: no' });
  assert.equal(r.tasks.at(-1).waitingOn, undefined);
  // The real record carries none of these after B-142's corrections.
  const real = C.lintChart(rec(), {
    spec: JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8')),
  });
  assert.deepEqual(
    real.filter(f => /^stale-/.test(f.check)),
    []
  );
});

test('B-144 (W-2): a deploy credits product commits only: a record commit ("(chart)") or one that touched only bookkeeping ships nothing', () => {
  assert.deepEqual(
    C.commitTasks([
      { subject: 'B-80: open -> in progress, notes (chart)', files: ['chart/tasks.json', 'BACKLOG.md'] },
      { subject: 'B-79: the record by hand', files: ['chart/tasks.json', 'DECISIONS.md', 'CHANGELOG.md'] },
      { subject: 'B-43: dosage practice', files: ['core/evcore.mjs', 'chart/tasks.json'] },
      { subject: 'B-93: log and the views', files: ['tools/chart.mjs', 'test/chart.test.mjs'] },
      { subject: 'B-74: talk fields', files: ['spec/ev.spec.json'] },
    ]),
    ['B-74', 'B-43']
  );
  assert.deepEqual(C.commitTasks('B-78: open -> in progress (chart)\nB-60: the rollback'), ['B-60']);
  // On a planted mixed log in a throwaway repository: the commits and the files each touched.
  const dir = copyRepo();
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  const base = g('rev-parse', 'HEAD').trim();
  const commit = (subject, file, text) => {
    fs.writeFileSync(path.join(dir, file), text);
    g('add', file);
    g('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', subject);
  };
  commit('B-81: in progress (chart)', 'BACKLOG.md', 'x');
  commit('B-75: the thing', 'core/new.mjs', 'export const x = 1;\n');
  commit('B-78: notes', 'CHANGELOG.md', 'y');
  assert.deepEqual(C.commitTasks(C.commitsIn(dir, `${base}..HEAD`)), ['B-75']);
});

test('B-144: a recorded deploy is corrected by a note, kept as it was; the Changelog carries the note', () => {
  const r = sample();
  r.deploys = [
    { target: 'live', commit: 'f547c21', time: '2026-10-21T04:29:44Z', okFrom: 'Matt', tasks: ['B-01', 'B-02'] },
  ];
  assert.throws(
    () => C.applyLog(r, { _: ['log', 'deploy'], target: 'live', commit: 'f547c21', correct: true }),
    /needs --note/
  );
  C.applyLog(r, { _: ['log', 'deploy'], target: 'live', commit: 'f547c21', correct: true, note: 'shipped B-02 only' });
  assert.deepEqual(r.deploys[0].tasks, ['B-01', 'B-02'], 'nothing rewritten');
  assert.match(C.changelogLine(r.deploys[0]).change, / Note: shipped B-02 only$/);
  const real = rec().deploys.find(d => d.target === 'live' && d.commit === 'f547c21');
  assert.match(real.notes[0], /^B-144 \(W-2\): .* shipped B-125, B-128, B-74 and B-43/);
});

test('B-145 (D-177): two chats log from two clones of one remote; each takes origin first and pushes after, and both entries land in order', () => {
  const a = copyRepo({ push: true });
  const [one, two] = openTasks(a, 2);
  const origin = execFileSync('git', ['-C', a, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-second-chat-'));
  execFileSync('git', ['clone', '-q', '-b', 'main', origin, b]);
  const log = (dir, id, note) =>
    execFileSync('node', [path.join(dir, 'tools', 'chart.mjs'), 'log', id, '--note', note, '--root', dir], {
      encoding: 'utf8',
    });
  // Chat A records first and pushes; chat B, behind it, takes A's commit before its own and pushes on top.
  assert.match(log(a, one, 'from chat A'), /committed \w{7} and pushed/);
  assert.match(log(b, two, 'from chat B'), /committed \w{7} and pushed/);
  const subjects = execFileSync('git', ['--git-dir', origin, 'log', '--format=%s', '-2', 'main'], { encoding: 'utf8' })
    .trim()
    .split('\n');
  assert.deepEqual(subjects, [`${two}: notes (chart)`, `${one}: notes (chart)`]);
  const tasks = JSON.parse(
    execFileSync('git', ['--git-dir', origin, 'show', 'main:chart/tasks.json'], { encoding: 'utf8' })
  );
  assert.equal(tasks.find(t => t.id === one).notes, 'from chat A');
  assert.equal(tasks.find(t => t.id === two).notes, 'from chat B');
  // A push the remote refuses is printed with the next step, and the commit stays.
  execFileSync('git', [
    '-C',
    a,
    'remote',
    'set-url',
    '--push',
    'origin',
    path.join(os.tmpdir(), 'no-such-remote-' + Date.now()),
  ]);
  const out = log(a, one, 'again from chat A');
  assert.match(
    out,
    /committed \w{7}; the push was refused \(.+\)\. Next: git pull --rebase origin main, then git push origin main/
  );
});

test('B-147 (W-6): ship staging --done B-nn --commit <sha> records the task done and the deploy in one command, and CHANGELOG.md carries it', () => {
  const dir = copyRepo();
  const task = openTasks(dir)[0];
  const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'chart', 'tasks.json'), 'utf8'));
  const nDeploys = JSON.parse(fs.readFileSync(path.join(dir, 'chart', 'deploys.json'), 'utf8')).length;
  const log = [];
  const was = console.log;
  console.log = (...a) => log.push(a.join(' '));
  try {
    C.recordShip(
      dir,
      { done: task, commit: head.slice(0, 7), trailer: [], root: dir, tasks: task, summary: 'a planted change' },
      { target: 'staging', manifest: { commit: head } }
    );
  } finally {
    console.log = was;
  }
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'chart', 'tasks.json'), 'utf8'));
  const deploys = JSON.parse(fs.readFileSync(path.join(dir, 'chart', 'deploys.json'), 'utf8'));
  assert.deepEqual(
    [after.find(t => t.id === task).status, after.find(t => t.id === task).commit],
    ['done', head.slice(0, 7)]
  );
  assert.equal(deploys.length, nDeploys + 1);
  assert.deepEqual(
    [deploys.at(-1).target, deploys.at(-1).commit, deploys.at(-1).verify],
    ['staging', head.slice(0, 7), 'green']
  );
  assert.match(
    fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'),
    new RegExp(`v4 staging deployed at ${head.slice(0, 7)} .*a planted change \\(${task}\\)`)
  );
  const subjects = execFileSync('git', ['-C', dir, 'log', '--format=%s', '-2'], { encoding: 'utf8' })
    .trim()
    .split('\n');
  assert.deepEqual(subjects, [
    `${task}: staging deploy at ${head.slice(0, 7)} (chart)`,
    `${task}: open -> done, commit ${head.slice(0, 7)}, notes (chart)`,
  ]);
  assert.ok(log.some(l => /is in the record|committed/.test(l)));
});

test('B-148 (D-4, M-1): BACKLOG.md lists open work first, then Your turn by place, then Done; brief --matt prints the same list', () => {
  const r = sample();
  C.applyLog(r, { _: ['log', 'B-02'], status: 'blocked', 'waiting-on': 'Matt', where: 'mac' });
  C.applyLog(r, { _: ['log', 'B-03'], status: 'blocked', 'waiting-on': 'Matt', where: 'github' });
  assert.throws(
    () => C.applyLog(r, { _: ['log', 'B-03'], where: 'garden' }),
    /--where garden: one of mac, staging, github, decision/
  );
  const md = C.renderBacklog(r);
  const at = s => md.indexOf(s);
  assert.ok(
    at('| B-02 |') < at('## Your turn') && at('## Your turn') < at('## Done') && at('## Done') < at('| B-01 |')
  );
  const turn = md.slice(at('## Your turn'), at('## Done'));
  assert.match(turn, /### At the Mac\n\n- B-02 \(blocked\): two/);
  assert.match(turn, /### On GitHub\n\n- B-03 \(blocked\): /);
  assert.doesNotMatch(turn, /B-01/);
  assert.deepEqual(
    C.yourTurn(r).map(g => [g.place, g.tasks.map(t => t.id)]),
    [
      ['mac', ['B-02']],
      ['github', ['B-03']],
    ]
  );
  // Done clears the place with the wait.
  C.applyLog(r, { _: ['log', 'B-02'], status: 'done', commit: 'abc1234' });
  assert.deepEqual([r.tasks[1].waitingOn, r.tasks[1].waitingWhere], [undefined, undefined]);
  // brief --matt prints the record's own list.
  const out = execFileSync('node', [path.join(ROOT, 'tools', 'chart.mjs'), 'brief', '--matt'], { encoding: 'utf8' });
  assert.equal(out.trimEnd(), ['# Your turn', '', ...C.yourTurnLines(rec())].join('\n'));
  assert.match(out, /### At the Mac\n\n- B-27 /);
});

test("B-149 (D-173): ship live tags the next release (a patch on the minor's newest tag, or the minor with --minor) and pushes the tag", () => {
  const dir = copyRepo({ push: true });
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  assert.throws(() => C.nextTag(dir, { specVersion: '4.2' }), /no v4\.2 tag yet: this live deploy is the minor/);
  assert.equal(C.nextTag(dir, { specVersion: '4.2', minor: true }), 'v4.2.0');
  g('tag', '-a', 'v4.1.0', '-m', 'v4.1.0');
  g('tag', '-a', 'v4.2.0', '-m', 'v4.2.0');
  assert.equal(C.tagAt(dir, 'HEAD'), 'v4.2.0');
  assert.throws(() => C.nextTag(dir, { specVersion: '4.2', minor: true }), /v4\.2 is tagged already/);
  g('tag', '-a', 'v4.2.1', '-m', 'v4.2.1');
  assert.equal(C.nextTag(dir, { specVersion: '4.2' }), 'v4.2.2');
  assert.equal(C.nextTag(dir, { specVersion: '4.3', minor: true }), 'v4.3.0');
  // The push lands the tag on origin; a refused push is made there by tags.yml from the recorded release (B-175).
  const pushed = C.pushTag(dir, 'v4.2.1');
  assert.deepEqual([pushed.pushed, pushed.line], [true, 'tag v4.2.1 pushed to origin']);
  const origin = g('remote', 'get-url', 'origin').trim();
  assert.match(execFileSync('git', ['--git-dir', origin, 'tag', '--list'], { encoding: 'utf8' }), /v4\.2\.1/);
  g('remote', 'set-url', '--push', 'origin', path.join(os.tmpdir(), 'no-remote-' + Date.now()));
  assert.match(
    C.pushTag(dir, 'v4.2.2').line,
    /^the tag push was refused \(.+\): tags\.yml makes v4\.2\.2 on origin from this deploy's release$/
  );
});

test("B-149 (D-173): the spec's specVersion is the newest tag's major.minor or the next minor being prepared", () => {
  let tags = [];
  try {
    tags = execFileSync('git', ['-C', ROOT, 'tag', '--list', 'v4.*'], { encoding: 'utf8' })
      .split('\n')
      .map(t => /^v4\.(\d+)\.\d+$/.exec(t.trim()))
      .filter(Boolean)
      .map(m => Number(m[1]));
  } catch {
    /* no git */
  }
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
  const [M, m] = spec.specVersion.split('.').map(Number);
  assert.equal(M, 4);
  if (!tags.length) return; // a clone without tags (CI's shallow checkout): nothing to compare with
  const newest = Math.max(...tags);
  assert.ok(m === newest || m === newest + 1, `specVersion ${spec.specVersion} against the newest tag v4.${newest}`);
});

// ------------------------------------------------------------------------------------------------ B-151 nightly check
test('B-151 (T-1): the nightly workflow runs npm run check with Chromium, keeps the shots, and the inbox reads it', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/nightly.yml'), 'utf8');
  assert.match(wf, /^ {2}schedule:\n(?: {4}#.*\n)* {4}- cron: '\d+ \d+ \* \* \*'/m, 'on a schedule');
  assert.match(wf, /^ {2}workflow_dispatch:/m, 'and on demand');
  assert.match(wf, /npx playwright install --with-deps chromium/);
  assert.match(wf, /run: npm run check -- --shots shots/);
  assert.match(wf, /uses: actions\/upload-artifact@v4[\s\S]*if: always\(\)[\s\S]*path: shots\//);
  assert.match(wf, /permissions:\n {2}contents: read/, 'read-only, like test.yml');
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(
    claude,
    /A red last nightly check \(`\.github\/workflows\/nightly\.yml`, B-151; `inbox` prints the read\) is an inbox entry/
  );
  const out = C.formatInbox({ query: null, comments: [], triage: [] });
  assert.match(out, /^inbox: empty/);
  assert.match(out, /Nightly: gh run list --workflow nightly\.yml --limit 1/);
  assert.match(out, /--source "nightly <id>"/);
});

// ------------------------------------------------------------------------------------------------ B-153 a copy
test('B-153 (T-5): no test reads the real record; a planted direct read is caught', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'test')).filter(f => f.endsWith('.test.mjs')))
    assert.deepEqual(
      directRecordReads(fs.readFileSync(path.join(ROOT, 'test', f), 'utf8')),
      [],
      `${f} reads the record directly`
    );
  // Spelled in pieces, so this file holds no direct read itself.
  const R = 'RO' + 'OT';
  for (const planted of [
    `fs.readFileSync(path.join(${R}, 'chart', 'tasks.json'), 'utf8')`,
    `fs.readFileSync(path.join(${R}, 'BACKLOG.md'), 'utf8')`,
    `C.loadChart(${R})`,
    "readJson('" + "chart/deploys.json')",
  ])
    assert.equal(directRecordReads(planted).length, 1, planted);
  assert.deepEqual(directRecordReads("path.join(dir, 'chart', 'tasks.json')"), [], 'a throwaway copy is fine');
});

// B-174: the copy starts from whatever state the shared record is in. A commit that reports a bug leaves it in the
// inbox until the triage commit after it, and log refuses to take a task while one waits, so the copy settles every
// inbox entry first (as a task) and the check holds on every commit, not only on triaged ones.
function plantTwoChats(dir, { inbox = false } = {}) {
  const r = C.loadChart(dir);
  if (inbox) C.applyReport(r, { _: ['report', 'bug', 'left in the inbox by a report commit'], source: 'test' });
  for (const w of r.tasks.filter(t => t.status === 'inbox'))
    C.applyLog(r, { _: ['log', w.id], triage: 'task', dod: 'settled by the test', milestone: 'v4.2 tests' });
  // Chat one: a task taken and a decision logged; chat two: a bug reported from the chat and triaged into a task.
  const open =
    r.tasks.find(t => t.status === 'open' && !(t.depends || []).length) || r.tasks.find(t => t.status === 'open');
  if (open) C.applyLog(r, { _: ['log', open.id], status: 'in progress', note: 'chat one' });
  const d = 'D-' + String(Math.max(...r.decisions.map(x => Number(x.id.slice(2)))) + 1).padStart(3, '0');
  C.applyLog(r, { _: ['log', 'decision', d], title: 'Planted by chat one', why: 'a test', status: 'proposed' });
  C.applyReport(r, { _: ['report', 'bug', 'the planted bug from chat two'], source: 'chat two' });
  const b = r.tasks.at(-1);
  C.applyLog(r, { _: ['log', b.id], triage: 'task', dod: 'planted', milestone: 'v4.2 tests' });
  C.saveChart(dir, r);
  for (const [f, text] of Object.entries(C.generatedFiles(r))) fs.writeFileSync(path.join(dir, f), text);
  const again = C.loadChart(dir);
  assert.deepEqual(
    C.lintChart(again).filter(x => x.level === 'error'),
    [],
    'lints green'
  );
  for (const [f, text] of Object.entries(C.generatedFiles(again)))
    assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), text, `${f} matches its record`);
  assert.ok(again.tasks.some(t => t.words === 'the planted bug from chat two'));
  assert.ok(
    !C.loadChart(RECORD).tasks.some(t => t.words === 'the planted bug from chat two'),
    'the shared copy is untouched'
  );
}

test("B-153 (T-5): the record checks hold with two chats' worth of planted state in the copy", () => {
  plantTwoChats(chartCopy(RECORD));
});

test('B-174: the same checks hold on a copy taken while a report waits in the inbox', () => {
  plantTwoChats(chartCopy(RECORD), { inbox: true });
});

// ------------------------------------------------------------------------------------------------ B-179 the builder's steps
const STAGING = 'https://claude.ai/artifact/Pb6jQ6CvEbtxi6Rcshu9uC';
/** A planted ArtifactData get of jobs/<id>: the document saved to a file, the result naming it as the tool does. */
function jobGet(id, doc, n = 'g1') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-job-'));
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(doc));
  return toolPair(
    n,
    'ArtifactData',
    { action: 'get', url: STAGING, collection: 'jobs', doc_id: id },
    `1 document from collection "jobs" saved as JSON files under "${dir}":\n- "${id}"  120 bytes  version 1  "${file}"`
  );
}
const JOB = 'job-20261022-010000-the-timer-resets';
const jobDoc = (kind, brief) => ({
  schema: 2,
  writer: 'page',
  at: '2026-10-22T01:00:00.000Z',
  source: 'E.V. Home',
  kind,
  title: brief.slice(0, 40),
  brief,
});

test('B-179: report --job files the job in its own words, with the job id on the task', () => {
  const jsonl = [
    human('<routine-fire-payload>\nJob ' + JOB + '\nthe timer resets when I switch tabs\n</routine-fire-payload>'),
    ...jobGet(JOB, jobDoc('build', 'the timer resets when I switch tabs')),
  ].join('\n');
  assert.deepEqual(C.firedJobWords(jsonl, JOB).words, 'the timer resets when I switch tabs');
  const r = sample();
  const out = C.applyReport(r, { _: ['report', 'bug'], 'from-chat': true, job: JOB }, { jsonl });
  const t = r.tasks.at(-1);
  assert.deepEqual(
    [out.id, t.kind, t.status, t.words, t.source, t.job],
    ['B-04', 'bug', 'inbox', 'the timer resets when I switch tabs', `E.V. page, job ${JOB}`, JOB]
  );
  // The brief carries the words when the fired message has none past its first line.
  const bare = [human('Job ' + JOB), ...jobGet(JOB, jobDoc('build', 'a quieter end screen'))].join('\n');
  const r2 = sample();
  C.applyReport(r2, { _: ['report', 'request'], 'from-chat': true, job: JOB }, { jsonl: bare });
  assert.equal(r2.tasks.at(-1).words, 'a quieter end screen');
  // B-180: the page sends his message as typed; the marker that made it a build ask is not his words.
  const typed = [human('Job ' + JOB + '\nbuild: a quieter end screen'), ...jobGet(JOB, jobDoc('build', 'x'))].join(
    '\n'
  );
  const r3 = sample();
  C.applyReport(r3, { _: ['report', 'request'], 'from-chat': true, job: JOB }, { jsonl: typed });
  assert.equal(r3.tasks.at(-1).words, 'a quieter end screen');
  // Refused: no get of the job, words retyped beside it, the same job twice.
  assert.throws(
    () => C.applyReport(sample(), { _: ['report', 'bug'], job: JOB }, { jsonl: human('Job ' + JOB) }),
    /no read of job .* make ArtifactData/
  );
  assert.throws(
    () => C.applyReport(sample(), { _: ['report', 'bug', 'my', 'retelling'], job: JOB }, { jsonl }),
    /never retyped/
  );
  assert.throws(() => C.applyReport(r, { _: ['report', 'bug'], job: JOB }, { jsonl }), /already filed/);
});

test("B-179: log --from-job carries Matt's reply from a planted get into the task's notes; a retyped text is refused", () => {
  const RJOB = 'job-20261022-011500-reply-b-02';
  const jsonl = jobGet(RJOB, jobDoc('reply', 'use the blue one, and keep it short')).join('\n');
  const r = sample();
  const t = r.tasks.find(x => x.id === 'B-02');
  Object.assign(t, { status: 'blocked', notes: 'Which colour?', waitingOn: 'Matt', waitingWhere: 'decision' });
  C.applyLog(r, { _: ['log', 'B-02'], note: true, 'from-job': RJOB, 'waiting-on': 'none' }, { jsonl });
  assert.equal(t.notes, "Which colour?\nMatt's reply (job " + RJOB + ', Oct 21): use the blue one, and keep it short');
  assert.deepEqual([t.waitingOn, t.waitingWhere, t.jobs], [undefined, undefined, [RJOB]]);
  // The same words given as text pass; any other text is a retelling and is refused.
  C.applyLog(r, { _: ['log', 'B-02'], note: 'use the blue one, and keep it short', 'from-job': RJOB }, { jsonl });
  assert.throws(
    () => C.applyLog(r, { _: ['log', 'B-02'], note: 'use blue, keep it short', 'from-job': RJOB }, { jsonl }),
    /never retyped/
  );
  assert.throws(
    () => C.applyLog(sample(), { _: ['log', 'B-02'], note: true, 'from-job': RJOB }, { jsonl: '' }),
    /no read of job/
  );
});

test('B-182: log --ask sets the one line Your turn asks, --choices a decision’s named chips; yourturn carries both', () => {
  const r = sample();
  const t = r.tasks.find(x => x.id === 'B-02');
  Object.assign(t, { status: 'blocked', notes: 'Long notes. The last sentence.', waitingOn: 'Matt' });
  assert.equal(C.askOf(t), 'The last sentence.');
  assert.equal(
    C.askOf({ id: 'B-9', title: 'Request (reported Oct 21): a quieter chime; and later', notes: '' }),
    'a quieter chime'
  );
  C.applyLog(r, { _: ['log', 'B-02'], ask: 'Blue or red for the timer?', choices: 'Blue|Red' });
  assert.deepEqual(
    [t.ask, t.choices, C.askOf(t)],
    ['Blue or red for the timer?', ['Blue', 'Red'], 'Blue or red for the timer?']
  );
  const doc = C.yourTurnDoc(r, { at: '2026-10-22T02:00:00.000Z', commit: 'abc1234', source: 'test' });
  assert.deepEqual(doc.groups, [
    {
      place: 'decision',
      label: C.PLACES.decision,
      tasks: [{ id: 'B-02', ask: 'Blue or red for the timer?', status: 'blocked', choices: ['Blue', 'Red'] }],
    },
  ]);
  // A place other than a decision carries no choices (its chips are Done, Fine, What's off).
  C.applyLog(r, { _: ['log', 'B-02'], where: 'staging' });
  assert.ok(!('choices' in C.yourTurnDoc(r, { at: 'x', commit: 'abc1234', source: 't' }).groups[0].tasks[0]));
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-02'], choices: 'One' }), /2 to 4 choices/);
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-02'], choices: 'A|B|C|D|E' }), /2 to 4 choices/);
  assert.throws(() => C.applyLog(sample(), { _: ['log', 'B-03'], choices: 'A|B' }), /goes with an --ask/);
  assert.throws(() => C.applyLog(r, { _: ['log', 'B-02'], ask: 'x'.repeat(301) }), /at most 300/);
  C.applyLog(r, { _: ['log', 'B-02'], ask: '' });
  assert.deepEqual([t.ask, t.choices], [undefined, undefined]);
});

// ------------------------------------------------------------------------------------------------ B-183 kickoff
test('B-183: the kickoff is built from planted reads (the north star tab, a weeks fetch) and the Chart, under 4,000 characters', () => {
  const nsId = C.docIdOf(C.NORTH_STAR);
  const cell = (t, j) => `<cell id='.c${j}'><paragraph id='.c${j}p'><text id='.c${j}t'>${t}</text></paragraph></cell>`;
  const row = (i, cells) => `<row id='.r${i}'>${cells.map((c, j) => cell(c, `${i}${j}`)).join('')}</row>`;
  const xml =
    `<doc node='4cdfbcea-659b' rev='6'><paragraph id='a' heading='1'><text id='a1'>E.V. north star</text></paragraph>` +
    `<paragraph id='b' heading='2'><text id='b1'>The six workflows</text></paragraph><table id='t'>` +
    row(0, ['#', 'Workflow', 'What she does', 'Where it stands']) +
    row(1, ['1', 'The brief before the day', 'One paragraph before he wakes', 'Planted: prep checks exist']) +
    row(2, ['4', 'The night-before model', 'A calibrated prediction', 'Planted: insights are next']) +
    `</table><paragraph id='c'><text id='c1'><bold>When v5 may start.</bold></text><text id='c2'> Planted: thirty days of green health.</text></paragraph></doc>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-kickoff-'));
  const wf = path.join(dir, 'weeks', '2026-10-18.json');
  fs.mkdirSync(path.dirname(wf), { recursive: true });
  fs.writeFileSync(
    wf,
    JSON.stringify({ insights: { lines: ['Planted line one.', 'Planted line two.'], weakestObjective: null } })
  );
  const jsonl = [
    ...toolPair(
      'n1',
      'mcp__Claude_Docs__read',
      { ref: { object: 'node', id: '4cdfbcea-659b' }, container: { kind: 'project', id: nsId } },
      JSON.stringify({ verdict: 'allow', rev: 6, data: { rev: 6, xml, complete: true } })
    ),
    ...toolPair(
      'w1',
      'ArtifactData',
      { action: 'list', url: 'https://claude.ai/artifact/x', collection: 'weeks', out_dir: dir },
      `1 document from collection "weeks" saved as JSON files:\n- "2026-10-18"  10 bytes  version 3  "${wf}"`
    ),
  ].join('\n');
  const k = C.kickoffFrom(RECORD, jsonl, { theme: 'voice in', now: '2026-10-22T05:00:00Z' });
  assert.deepEqual(k.missing, []);
  assert.ok(k.length <= C.KICKOFF_MAX && k.text.length === k.length, `${k.length} characters`);
  const r = rec();
  for (const want of [
    /^You are a design chat for E\.V\. v4/,
    new RegExp(
      `Live is ${r.deploys
        .filter(d => d.target === 'live')
        .at(-1)
        .release.replace(/\./g, '\\.')} at`
    ),
    new RegExp(`north star ${C.NORTH_STAR}`),
    /The goal: design "voice in"/,
    /\d+ tasks done, \d+ in progress, \d+ open, \d+ blocked\./,
    /1\. The brief before the day: Planted: prep checks exist\n4\. The night-before model: Planted: insights are next/,
    /When v5 may start\. Planted: thirty days of green health\./,
    /The latest insights \(weeks\/2026-10-18\)\nPlanted line one\.\nPlanted line two\./,
    /Waiting on Matt\n/,
    /Decisions since the last design hand-off\n/,
    /Tasks to add: Task \| Depends \| Definition of done \| Milestone/,
    /Decisions proposed: P-n \| Decision \| Why/,
    /Tenets proposed: P-n \| Tenet \| Scope \| Check \| Why/,
    /"file: <the doc link>"/,
  ])
    assert.match(k.text, want);
  assert.ok(!/\{\{\w+\}\}|<!--/.test(k.text), 'every slot filled, the template note left out');
  // Without the reads, each slot says so and the command names what to read, never a guess.
  const bare = C.kickoffFrom(RECORD, '', {});
  assert.equal(bare.missing.length, 2);
  assert.match(bare.text, /\(the north star was not read in this session\)/);
  assert.match(bare.text, /The goal: pick the next theme with Matt/);
  // A long record still fits: the lists shorten, the frame stays.
  const big = C.loadChart(RECORD);
  for (let i = 0; i < 80; i++)
    big.tasks.push({
      ...big.tasks.find(t => t.status === 'done'),
      id: `B-${900 + i}`,
      status: 'open',
      title: 'A planted open task with a long enough title to fill the kickoff'.repeat(2),
    });
  const t = C.kickoffText(big, { template: fs.readFileSync(path.join(ROOT, 'tools/kickoff.md'), 'utf8') });
  assert.ok(t.length <= C.KICKOFF_MAX && /Tenets proposed/.test(t.text), `${t.length}`);
});

test("B-183: a plan job's trace line names what was filed from the doc, in ids, from the record", () => {
  const r = rec();
  const docId = 'TbfWAoQEeQixyNKZnEZKvv';
  const f = C.filedFrom(r, docId);
  assert.ok(f.decisions.length && f.tasks.length, 'the v4.4 plan filed both');
  const line = C.planTraceText(f, docId);
  const d = f.decisions.filter(x => x.kind !== 'tenet');
  assert.match(
    line,
    new RegExp(`^Filed from the design doc ${docId}: ${d.length} decisions \\(${d[0].id} to ${d.at(-1).id}\\)`)
  );
  assert.match(line, new RegExp(`${f.tasks.length} tasks \\(${f.tasks[0].id} to ${f.tasks.at(-1).id}\\)\\.$`));
  assert.equal(
    C.planTraceText({ decisions: [], tasks: [], skipped: [{}, {}] }, 'X'),
    'Nothing new to file from the design doc X: all 2 rows were filed before.'
  );
  assert.equal(
    C.planTraceText({ decisions: [{ id: 'D-9', kind: 'tenet' }], tasks: [{ id: 'B-1' }], skipped: [] }, 'X'),
    'Filed from the design doc X: 1 tenet (D-9), 1 task (B-1).'
  );
});

// ------------------------------------------------------------------------------------------------ B-185 ship it
test('B-185: ship live --from-job holds the fetched job to R-04 in its second form: each refusal, and the pass', () => {
  const COMMIT = 'abc1234def5678abc1234def5678abc1234def5';
  const NOW = Date.parse('2026-10-22T18:00:00Z');
  const job = (x = {}) => ({
    schema: 2,
    writer: 'page',
    at: '2026-10-22T17:00:00Z',
    source: 'E.V. Home',
    kind: 'ship',
    title: 'Ship abc1234',
    brief: 'ship it',
    commit: 'abc1234',
    tasks: ['B-201'],
    ...x,
  });
  const check = (j, result = 'none', commit = COMMIT) =>
    C.shipJobRefusals({ id: 'job-x', job: j, result, commit, now: NOW });
  assert.deepEqual(check(job()), [], 'the pass: his tap, this commit, one shot, an hour old');
  assert.match(check(job({ commit: 'fff0000' })).join(), /names fff0000, not this build's abc1234/);
  assert.match(check(job(), 'exists').join(), /has a result already: one tap is one deploy/);
  assert.match(check(job({ at: '2026-10-21T17:00:00Z' })).join(), /is 25 hours old; a ship job holds 24 hours/);
  assert.match(check(job({ kind: 'build' })).join(), /is a build job, not a ship job/);
  assert.match(check(job({ writer: 'builder' })).join(), /was written by builder, not his page/);
  assert.match(check(null).join(), /no fetch of jobs\/job-x in this session/);
  assert.match(check(job(), null).join(), /no jobresults read in this session/);
  // The fetch and the result read, as the transcript holds them.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-ship-'));
  const f = path.join(dir, 'job-x.json');
  fs.writeFileSync(f, JSON.stringify(job()));
  const get = (id, col, text, isError) => [
    JSON.stringify({
      message: {
        content: [
          {
            type: 'tool_use',
            id,
            name: 'ArtifactData',
            input: { action: 'get', collection: col, doc_id: 'job-x', url: 'u' },
          },
        ],
      },
    }),
    JSON.stringify({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: id, is_error: !!isError, content: [{ type: 'text', text }] }],
      },
    }),
  ];
  const jl = [
    ...get('a', 'jobs', `saved "${f}"`),
    ...get('b', 'jobresults', 'Document "jobresults"/"job-x" not found.'),
  ].join('\n');
  assert.equal(C.shipJobFrom(jl, 'job-x').commit, 'abc1234');
  assert.equal(C.jobResultSeen(jl, 'job-x'), 'none');
  assert.equal(C.jobResultSeen(get('c', 'jobresults', `saved "${f}"`).join('\n'), 'job-x'), 'exists');
  assert.equal(C.jobResultSeen('', 'job-x'), null);
});

test('D-263: report --reworded files his point in neutral words, still proven by his message', () => {
  const jsonl = human('bug: ugh the timer sat at 0:00 after i came back, so annoying', '2026-10-23T23:41:00.000Z');
  const r = sample();
  C.applyReport(
    r,
    { _: ['report', 'bug'], 'from-chat': true, reworded: 'The session timer stayed at 0:00 after he came back to it.' },
    { jsonl }
  );
  const t = r.tasks.at(-1);
  assert.equal(t.words, 'The session timer stayed at 0:00 after he came back to it.');
  assert.equal(t.reworded, true);
  assert.equal(t.reportedAt, '2026-10-23T23:41:00.000Z');
  assert.ok(!JSON.stringify(r.tasks).includes('so annoying'), 'his own words are not stored');
  // Rewording needs a real message to reword.
  assert.throws(
    () =>
      C.applyReport(sample(), { _: ['report', 'bug'], 'from-chat': true, reworded: 'x' }, { jsonl: human('nothing') }),
    /no message in this session/
  );
});
