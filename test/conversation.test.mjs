// E.V. core's conversation (B-157, split from core.test.mjs with its sections): the E.V. tab's greeting and chips, and
// the conversations a day's talk splits into (B-77, D-128). All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';
import { key } from './core-fixtures.mjs';

// The session helpers (the greeting reads a running session).
const T0 = '2026-10-18T15:00:00.000Z';
const plus = (min, sec = 0) => new Date(Date.parse(T0) + min * 60e3 + sec * 1e3).toISOString();
const sk = t => key(t);
const session = (events, extra = {}) => ({
  id: 'ss-20261018-150000-ch-42',
  source: 'E.V. Home',
  status: 'active',
  topic: 'Ch 42 Fluids',
  startedAt: T0,
  events: { [sk(T0)]: { type: 'start' }, ...Object.fromEntries(Object.entries(events).map(([t, e]) => [sk(t), e])) },
  ...extra,
});

test('Greeting: morning leads with the review; late night before clinical says sleep', () => {
  const base = {
    date: '2026-10-19',
    dayType: 'class',
    items: [{ id: 't1', text: 'Read Ch 42', tag: 'READING', minutes: 45 }],
    nextExams: [],
    tomorrow: { dates: [] },
  };
  const m = EV.greeting({
    ...base,
    now: '2026-10-19T12:00:00Z',
    reviewLeft: 12,
    push: 'Class day · 12 reviews ready · Read Ch 42',
  });
  assert.equal(m.segment, 'morning');
  assert.match(m.lines[0], /^Morning, Matt\. Class day · 12 reviews ready\./);
  assert.deepEqual(m.cards, [], 'the greeting carries no card (D-125 as amended)');
  assert.equal(m.offers[0].type, 'review');
  assert.equal(m.chips[0], 'Start review', 'the open review is the first chip');
  assert.ok(m.chips.length <= 3, 'at most three chips (rule 5)');
  const late = EV.greeting({
    ...base,
    now: '2026-10-20T04:30:00Z',
    tomorrow: { dates: [{ title: 'Clinical, 0630–1500', kind: 'clinical' }] },
  });
  assert.equal(late.segment, 'late');
  assert.ok(!('mood' in late), 'the greeting sets no mood: she rests at Idle (B-284)');
  assert.ok(late.lines.some(l => /Sleep is on tomorrow/.test(l)));
});

test('Greeting: at most two insights, finished jobs first, exam countdown with readiness', () => {
  const g = EV.greeting({
    now: '2026-10-18T22:00:00Z',
    date: '2026-10-18',
    items: [],
    reviewLeft: 0,
    nextExams: [{ id: 'E4', title: 'Exam 4: Health Promotion', date: '2026-10-21', kind: 'unit' }],
    readiness: { examId: 'E4', pctSolid: 10, need: 30 },
    jobs: [
      {
        id: 'j1',
        kind: 'study-guide',
        title: 'Study guide: potassium',
        status: 'done',
        finishedAt: '2026-10-18T21:00:00Z',
      },
    ],
    lastSeenAt: '2026-10-18T20:00:00Z',
    runs: { evening: { status: 'failed', startedAt: '2026-10-18T01:15:00Z', detail: 'Mac asleep' } },
    tomorrow: { dates: [] },
  });
  const ins = g.lines.filter(l => /Finished in the background|failed|Exam 4 in/.test(l));
  assert.equal(ins.length, 2);
  assert.match(ins[0], /Finished in the background: Study guide: potassium/);
  assert.ok(g.offers.some(c => c.type === 'job' && c.id === 'j1'));
  assert.deepEqual(g.cards, []);
  assert.equal(g.chips[0], 'Open the study guide', 'a finished job is a chip, first when no review is open');
  assert.equal(g.job, 'j1');
});

test('greeting names open items as short phrases, cut at a word', () => {
  const g = EV.greeting({
    now: '2026-10-17T19:00:00Z',
    date: '2026-10-17',
    dayType: 'off',
    reviewLeft: 0,
    items: [
      {
        id: 'a',
        text: 'Drill 6: Ch 42, 45 + Pharm Ch 14, 50 (nutrition, fluids, electrolytes, lab values, antidiabetics) (~40 min)',
        done: false,
      },
      { id: 'b', text: 'Pharm Ch 14, p. 167–171 (nutritional support)', done: false },
    ],
  });
  const line = g.lines.find(l => l.startsWith('0 of 2 done'));
  assert.ok(line, g.lines.join(' | '));
  assert.ok(!/\(/.test(line), 'no parentheticals: ' + line);
  assert.ok(/Drill 6: Ch 42, 45 \+ Pharm Ch 14, 50/.test(line) && /Pharm Ch 14, p\. 167–171/.test(line), line);
});

test('greeting offers a study session unless one is running', () => {
  const base = {
    now: '2026-10-18T20:00:00Z',
    date: '2026-10-18',
    items: [],
    reviewLeft: 0,
    nextExams: [],
    tomorrow: { dates: [] },
  };
  assert.ok(EV.greeting(base).chips.includes('Start a study session'));
  assert.ok(!EV.greeting({ ...base, sessionActive: true }).chips.includes('Start a study session'));
});

test('greeting chips (D-125 as amended): at most three; Start a study session last unless one runs; then review, finished job, what is due', () => {
  const base = {
    now: '2026-10-18T20:00:00Z',
    date: '2026-10-18',
    items: [],
    nextExams: [],
    tomorrow: { dates: [] },
    lastSeenAt: '2026-10-18T18:00:00Z',
  };
  const job = {
    id: 'j',
    kind: 'practice-set',
    title: 'Practice set: fluids',
    status: 'done',
    finishedAt: '2026-10-18T19:00:00Z',
  };
  assert.deepEqual(EV.greeting({ ...base, reviewLeft: 4, jobs: [job], dueSoon: 3 }).chips, [
    'Start review',
    'Open the practice set',
    'Start a study session',
  ]);
  assert.deepEqual(EV.greeting({ ...base, reviewLeft: 0, jobs: [job], dueSoon: 3 }).chips, [
    'Open the practice set',
    'What’s due this week?',
    'Start a study session',
  ]);
  assert.deepEqual(
    EV.greeting({ ...base, reviewLeft: 0, dueSoon: 3 }).chips,
    ['What’s due this week?', 'How ready am I?', 'Start a study session'],
    'what is due is the first offer to drop, but fills a free slot'
  );
  assert.deepEqual(
    EV.greeting({ ...base, reviewLeft: 4, jobs: [job], dueSoon: 3, sessionActive: true }).chips,
    ['Start review', 'Open the practice set', 'What’s due this week?'],
    'during a session the slot goes back to the priority list'
  );
  assert.deepEqual(EV.greeting({ ...base, reviewLeft: 0, dueSoon: 0 }).chips, [
    'How ready am I?',
    'Give me 5 more',
    'Start a study session',
  ]);
  assert.equal(
    EV.greeting({
      ...base,
      reviewLeft: 0,
      jobs: [{ ...job, finishedAt: '2026-10-18T17:00:00Z' }],
      dueSoon: 0,
    }).chips.includes('Open the practice set'),
    false,
    'a job he has already seen is not offered'
  );
  assert.equal(EV.greeting({ ...base, jobs: [{ ...job, kind: 'mystery' }], dueSoon: 0 }).chips[0], 'Open the result');
});

test('B-90 greeting: one strict line; urgent only for what cannot wait; a folded briefing ranked urgent, new, the rest', () => {
  const base = {
    date: '2026-10-19',
    dayType: 'class',
    reviewLeft: 0,
    nextExams: [],
    tomorrow: { dates: [] },
    items: [],
    jobs: [],
    lastSeenAt: '2026-10-19T15:00:00Z',
  };
  const calm = EV.greeting({
    ...base,
    now: '2026-10-19T19:00:00Z',
    reviewLeft: 12,
    items: [
      { id: 'a', text: 'Read Ch 42', done: false },
      { id: 'b', text: 'Pharm Ch 14', done: true },
    ],
  });
  assert.equal(calm.headline, 'Afternoon, Matt. How can I help?');
  assert.deepEqual(
    calm.brief.map(b => [b.level, b.title]),
    [
      ['normal', '12 reviews waiting'],
      ['normal', '1 of 2 done on today’s list'],
    ]
  );
  assert.deepEqual(calm.brief[0].action, { label: 'Start', chip: 'Start review' });
  assert.equal(EV.greeting({ ...base, now: '2026-10-19T12:00:00Z' }).headline, 'Morning, Matt. How can I help today?');
  const one = EV.greeting({
    ...base,
    now: '2026-10-19T19:00:00Z',
    items: [
      {
        id: 'g',
        text: 'ATI Engage Fundamentals: Nutrition + Fluid, Electrolyte and Acid-Base Regulation due 11:59pm',
        tag: 'GRADED',
        done: false,
      },
    ],
  });
  assert.equal(one.headline, 'Afternoon, Matt. ATI Engage Fundamentals is due tonight.');
  assert.deepEqual([one.brief[0].level, one.brief[0].when], ['urgent', 'tonight']);
  const two = EV.greeting({
    ...base,
    now: '2026-10-19T19:00:00Z',
    items: one.brief.length ? [{ id: 'g', text: 'ATI Engage due 11:59pm', tag: 'GRADED' }] : [],
    nextExams: [{ id: 'E4', title: 'Exam 4: Health Promotion', date: '2026-10-20', kind: 'unit' }],
  });
  assert.equal(two.headline, 'Afternoon, Matt. Exam 4 is tomorrow, and ATI Engage is due tonight.');
  const three = EV.greeting({
    ...base,
    now: '2026-10-19T19:00:00Z',
    items: [{ id: 'g', text: 'ATI Engage due 11:59pm', tag: 'GRADED' }],
    todayDates: [
      { title: 'Dosage calc quiz', graded: true, kind: 'due' },
      { title: 'ATI Engage due 11:59pm', graded: true, kind: 'due' },
    ],
    nextExams: [{ id: 'E4', title: 'Exam 4', date: '2026-10-20', kind: 'unit' }],
  });
  assert.equal(three.headline, 'Afternoon, Matt. Exam 4 is tomorrow, plus 2 more that can’t wait.');
  assert.equal(
    three.brief.filter(b => b.level === 'urgent').length,
    3,
    'the same graded item from the list and the dates counts once'
  );
  const done = EV.greeting({
    ...base,
    now: '2026-10-19T19:00:00Z',
    items: [{ id: 'g', text: 'ATI Engage due 11:59pm', tag: 'GRADED', done: true }],
    todayDates: [{ title: 'ATI Engage due 11:59pm', graded: true, kind: 'due' }],
  });
  assert.equal(done.headline, 'Afternoon, Matt. How can I help?', 'graded work he ticked off is not urgent');
  const fresh = EV.greeting({
    ...base,
    now: '2026-10-19T19:00:00Z',
    reviewLeft: 3,
    jobs: [
      {
        id: 'j1',
        kind: 'study-guide',
        title: 'Study guide: potassium',
        status: 'done',
        finishedAt: '2026-10-19T18:00:00Z',
      },
      { id: 'j0', kind: 'study-guide', title: 'Old guide', status: 'done', finishedAt: '2026-10-19T14:00:00Z' },
    ],
  });
  assert.deepEqual(
    fresh.brief.map(b => b.level + ':' + b.title),
    ['new:Study guide: potassium', 'normal:3 reviews waiting']
  );
  assert.deepEqual(fresh.brief[0].action, { label: 'Open', chip: 'Open the study guide' });
  assert.ok(fresh.lines.length >= 1, 'the full lines stay for the chat context');
});

test('B-90 greeting names a short graded item whole, a long one by the part before its colon', () => {
  const base = {
    date: '2026-10-19',
    now: '2026-10-19T19:00:00Z',
    reviewLeft: 0,
    nextExams: [],
    tomorrow: { dates: [] },
    jobs: [],
  };
  assert.equal(
    EV.greeting({
      ...base,
      items: [{ id: 'q', text: 'Unit quiz: fluids and electrolytes (yours alone)', tag: 'GRADED' }],
    }).headline,
    'Afternoon, Matt. Unit quiz: fluids and electrolytes is due today.'
  );
  assert.equal(
    EV.greeting({
      ...base,
      items: [
        {
          id: 'g',
          text: 'ATI Engage Fundamentals: Nutrition + Fluid, Electrolyte and Acid-Base Regulation due 11:59pm',
          tag: 'GRADED',
        },
      ],
    }).headline,
    'Afternoon, Matt. ATI Engage Fundamentals is due tonight.'
  );
});

// B-129 (D-167): the greeting's situation, the headline's prompt and its shape check. All data is made up.
const sitBase = {
  dayType: 'class',
  items: [{ id: 't1', text: 'Read Ch 42', tag: 'READING', minutes: 45 }],
  tomorrow: { dates: [] },
  nextExams: [{ id: 'E4', title: 'NUR 112 Exam 4: Fluids', date: '2026-10-27', course: 'NUR 112', kind: 'unit' }],
};
test('B-129: situation(ctx) is the greeting facts as tags and enums across planted days', () => {
  // Exam tomorrow, in the morning, back after a night away, answering well.
  const ans = (date, n, right) => Array.from({ length: n }, (_, i) => ({ date, correct: i < right }));
  const exam = EV.situation({
    ...sitBase,
    date: '2026-10-26',
    now: '2026-10-26T12:30:00Z',
    lastSeenAt: '2026-10-26T02:00:00Z',
    reviewLeft: 8,
    recent: { answers: [...ans('2026-10-25', 8, 7), ...ans('2026-10-26', 4, 3)], sessions: [] },
  });
  assert.equal(exam.segment, 'morning');
  assert.equal(exam.sinceLastVisit, 'overnight');
  assert.equal(exam.momentum, 'building');
  assert.deepEqual(exam.exam, { name: 'NUR 112 Exam 4', distance: 'tomorrow' });
  assert.deepEqual(exam.urgent, [{ kind: 'exam', name: 'NUR 112 Exam 4', when: 'tomorrow' }]);
  assert.equal(exam.reviewsWaiting, 8);
  // A clear evening: nothing urgent, the list done, the exam days off.
  const clear = EV.situation({
    ...sitBase,
    items: [{ id: 't1', text: 'Read Ch 42', tag: 'READING', minutes: 45, done: true }],
    date: '2026-10-21',
    now: '2026-10-22T00:30:00Z',
    lastSeenAt: '2026-10-21T23:50:00Z',
    reviewLeft: 0,
    recent: { answers: ans('2026-10-21', 3, 3), sessions: [] },
  });
  assert.deepEqual(
    [clear.segment, clear.sinceLastVisit, clear.urgent, clear.exam.distance, clear.listLeft, clear.momentum],
    ['evening', 'minutes', [], 'this-week', 0, 'steady']
  );
  // Back after three days, nothing done in a week: quiet.
  const back = EV.situation({
    ...sitBase,
    date: '2026-10-21',
    now: '2026-10-21T20:00:00Z',
    lastSeenAt: '2026-10-18T18:00:00Z',
    recent: { answers: [], sessions: [] },
  });
  assert.deepEqual([back.sinceLastVisit, back.awayDays, back.momentum], ['days', 3, 'quiet']);
  // Late, before a clinical day: the prep phase is tonight's, the clinical never urgent (D-143).
  const prepDay = { date: '2026-10-22', kind: 'clinical', title: 'Clinical: Med-surg', subject: 'Med-surg' };
  const late = EV.situation({
    ...sitBase,
    date: '2026-10-21',
    now: '2026-10-22T04:30:00Z',
    lastSeenAt: '2026-10-21T22:00:00Z',
    tomorrow: { dates: [{ title: 'Clinical: Med-surg', kind: 'clinical' }] },
    prep: { today: null, tomorrow: prepDay },
    recent: { answers: ans('2026-10-17', 12, 4), sessions: [] },
  });
  assert.equal(late.segment, 'late');
  assert.deepEqual(late.prep, { phase: 'night', kind: 'clinical', name: 'Clinical: Med-surg' });
  assert.deepEqual(late.urgent, []);
  assert.equal(late.momentum, 'slipping', 'a busy day earlier, nothing in the last three');
  // situation is the greeting's own: the same facts the headline in code stands on.
  assert.deepEqual(
    EV.greeting({ ...sitBase, date: '2026-10-21', now: '2026-10-21T20:00:00Z' }).situation,
    EV.situation({ ...sitBase, date: '2026-10-21', now: '2026-10-21T20:00:00Z' })
  );
});

test('B-129: the headline check holds a model line to the situation; a failing line falls back to code', () => {
  const sit = {
    segment: 'morning',
    dayType: 'class',
    sinceLastVisit: 'hours',
    momentum: 'building',
    exam: { name: 'NUR 112 Exam 4', distance: 'tomorrow' },
    urgent: [{ kind: 'exam', name: 'NUR 112 Exam 4', when: 'tomorrow' }],
    new: [],
    prep: null,
    reviewsWaiting: 8,
    listLeft: 1,
  };
  const ok = t => EV.checkHeadline({ headline: t }, sit);
  assert.equal(ok('Morning, Matt. NUR 112 Exam 4 is tomorrow, and your 8 reviews are a good warm-up.').ok, true);
  const no = {
    'misses the urgent exam': 'Morning, Matt. Good momentum lately, keep it going.',
    'a number not in the facts': 'Morning, Matt. NUR 112 Exam 4 is tomorrow; 12 reviews wait.',
    'a day not in the facts': 'Morning, Matt. NUR 112 Exam 4 is tomorrow, Thursday after that is free.',
    'a name not in the facts': 'Morning, Matt. NUR 112 Exam 4 is tomorrow, and Sarah says hi.',
    'a question while urgent': 'Morning, Matt. NUR 112 Exam 4 is tomorrow. Ready to warm up?',
    'over 22 words': 'Morning, Matt. NUR 112 Exam 4 is tomorrow ' + 'and that is fine '.repeat(5) + 'really.',
    'two lines': 'Morning, Matt.\nNUR 112 Exam 4 is tomorrow.',
  };
  for (const [why, t] of Object.entries(no)) assert.equal(ok(t).ok, false, why);
  assert.equal(EV.checkHeadline(null, sit).ok, false, 'no reply');
  assert.equal(EV.checkHeadline({ text: 'x' }, sit).ok, false, 'the wrong shape');
  // With nothing urgent, a question is fine.
  assert.equal(
    EV.checkHeadline({ headline: 'Evening, Matt. Quiet list tonight. Want a few questions?' }, { ...sit, urgent: [] })
      .ok,
    true
  );
  // The prompt carries the facts and his last headlines.
  const p = EV.headlinePrompt(sit, [{ text: 'Morning, Matt. How can I help today?' }]);
  assert.match(p, /"urgent":\[\{"kind":"exam","name":"NUR 112 Exam 4"/);
  assert.match(p, /- Morning, Matt\. How can I help today\?/);
  assert.match(p, /at most 22 words/);
});

// ------------------------------------------------------------------------------------------------ B-181 the build line
const buildJob = (status, result, finishedAt = '2026-10-18T21:00:00Z') => ({
  id: 'job-20261018-200000-build-the-timer',
  kind: 'build',
  title: 'bug: the timer resets when I switch tabs',
  brief: 'bug: the timer resets when I switch tabs',
  status,
  finishedAt,
  result,
});
const buildCtx = (jobs, extra = {}) => ({
  now: '2026-10-19T13:00:00Z',
  date: '2026-10-19',
  items: [],
  reviewLeft: 0,
  nextExams: [],
  jobs,
  lastSeenAt: '2026-10-18T20:00:00Z',
  runs: {},
  tomorrow: { dates: [] },
  ...extra,
});
const buildLines = g => g.lines.filter(l => /your “the timer resets/i.test(l));

test('B-181: the morning after a build, one line: the task, his words shortened, green at the commit and what waits', () => {
  const g = EV.greeting(
    buildCtx([buildJob('done', { task: 'B-201', commit: 'abc1234def', text: 'Say ship it when you want it live.' })])
  );
  assert.deepEqual(buildLines(g), [
    'B-201 (your “the timer resets when I switch tabs”) is green on staging at abc1234. Say ship it when you want it live.',
  ]);
  const b = g.brief.find(x => x.kind === 'build');
  assert.equal(b.title, buildLines(g)[0].replace(/\.$/, ''));
  assert.equal(b.when, 'built');
  assert.ok(g.offers.some(c => c.type === 'job' && c.id === 'job-20261018-200000-build-the-timer'));
  // A build is never the plain "Finished in the background" line or its Open chip.
  assert.ok(!g.lines.some(l => /Finished in the background/.test(l)));
  assert.ok(!g.chips.some(c => /^Open the/.test(c)));
  // Filed but not built: no commit.
  const f = EV.greeting(buildCtx([buildJob('done', { task: 'B-201', text: 'It waits on your answer: which tab?' })]));
  assert.deepEqual(buildLines(f), [
    'B-201 (your “the timer resets when I switch tabs”) is filed. It waits on your answer: which tab?',
  ]);
});

test('B-181: a failed build says where it stopped; no build, or one older than his last look, adds nothing', () => {
  const g = EV.greeting(
    buildCtx([buildJob('failed', { task: 'B-202', failed: 'npm test failed on the new harness check' })])
  );
  assert.deepEqual(buildLines(g), [
    'B-202 (your “the timer resets when I switch tabs”) stopped: npm test failed on the new harness check.',
  ]);
  assert.equal(g.brief.find(x => x.kind === 'build').when, 'stopped');
  for (const jobs of [[], [buildJob('done', { task: 'B-201', commit: 'abc1234' }, '2026-10-18T19:00:00Z')]]) {
    const n = EV.greeting(buildCtx(jobs));
    assert.deepEqual(buildLines(n), []);
    assert.ok(!n.brief.some(x => x.kind === 'build'));
  }
});

test('B-181: the build line ranks after a failed run and inside the two-insight cap', () => {
  const run = { evening: { status: 'failed', startedAt: '2026-10-19T01:15:00Z', detail: 'Mac asleep' } };
  const g = EV.greeting(
    buildCtx([buildJob('done', { task: 'B-201', commit: 'abc1234', text: 'Say ship it.' })], {
      runs: run,
      checkin: { energy: 1 },
    })
  );
  const ins = g.lines.filter(l => /run failed|your “the timer|low energy/.test(l));
  assert.equal(ins.length, 2, JSON.stringify(g.lines));
  assert.match(ins[0], /The evening run failed/);
  assert.match(ins[1], /^B-201 \(your “the timer/);
  const kinds = g.brief.map(x => x.kind);
  assert.ok(kinds.indexOf('system') < kinds.indexOf('build'), kinds.join(','));
});

test('B-182: Your turn is one chip with its count, inside the three-chip rule, only when something waits', () => {
  const ctx = n => ({ ...buildCtx([]), yourTurn: n, reviewLeft: 3 });
  assert.ok(!EV.greeting(ctx(0)).chips.some(c => /^Your turn/.test(c)));
  const g = EV.greeting(ctx(2));
  assert.deepEqual(g.chips, ['Start review', 'Your turn (2)', 'Start a study session']);
  assert.ok(EV.greeting({ ...ctx(1), sessionActive: true }).chips.length <= 3);
});

// ------------------------------------------------------------------------------------------------ B-190 resume on reopen
test('B-190: a reopen within the window and the same part of the day resumes; otherwise she greets', () => {
  const r = o => EV.resumes({ withinMinutes: 90, ...o });
  const now = '2026-10-21T23:30:00Z'; // 6:30pm Central: evening
  // Back 20 minutes after an evening greeting: resume where he left it.
  assert.equal(r({ now, lastSeenAt: '2026-10-21T23:10:00Z', lastGreetingAt: '2026-10-21T22:40:00Z' }), true);
  // Past the window: a new greeting.
  assert.equal(r({ now, lastSeenAt: '2026-10-21T21:50:00Z', lastGreetingAt: '2026-10-21T22:05:00Z' }), false);
  // Inside the window but a new part of the day (his last greeting was the afternoon's): a new greeting.
  assert.equal(r({ now, lastSeenAt: '2026-10-21T22:50:00Z', lastGreetingAt: '2026-10-21T21:30:00Z' }), false);
  // A new Central day, even a few minutes later: a new greeting.
  assert.equal(
    r({ now: '2026-10-22T05:05:00Z', lastSeenAt: '2026-10-22T04:55:00Z', lastGreetingAt: '2026-10-22T04:30:00Z' }),
    false
  );
  // First open ever, or no greeting kept yet: a greeting.
  assert.equal(r({ now }), false);
  assert.equal(r({ now, lastSeenAt: '2026-10-21T23:10:00Z' }), false);
  assert.deepEqual(
    ['2026-10-21T12:00:00Z', '2026-10-21T18:00:00Z', '2026-10-21T23:00:00Z', '2026-10-22T04:00:00Z'].map(EV.partOfDay),
    ['morning', 'midday', 'evening', 'late']
  );
});

// B-623: a reply that promises questions is caught; other replies are not
test('claimsQuestions: a promise of questions in words is caught, other words are not', () => {
  for (const t of [
    'Five Chapter 9 questions are being written from your BIO 201 record and will appear here in about a minute.',
    'I’ve just requested the five BIO 201 questions now.',
    'Writing five questions now; they post here shortly.',
  ])
    assert.equal(EV.claimsQuestions(t), true, t);
  for (const t of ['Your note covers glycolysis well.', 'Two questions to think about: why ATP? why NADH?', ''])
    assert.equal(EV.claimsQuestions(t), false, t);
});
