// E.V. core's conversation (B-157, split from core.test.mjs with its sections): the E.V. tab's greeting and chips, and
// the conversations a day's talk splits into (B-77, D-128). All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';
import { makeConversation } from '../core/conversation.mjs';
import { loadValidator } from '../core/schemas.mjs';
import { describeErrors } from '../core/validate.mjs';

const spec = JSON.parse(fs.readFileSync(new URL('../spec/ev.spec.json', import.meta.url)));
EV.configure(spec);
const validate = loadValidator();

const at = (date, hm = '15:00') => `${date}T${hm}:00Z`; // 15:00Z = 10:00 Central (CDT)
const key = (iso, writer = 'page') => EV.eventKey(writer, iso);
const ev = (iso, e, writer = 'page') => ({ [key(iso, writer)]: { ...e } });
const ws = (id, extra = {}) => ({
  id,
  schema: 1,
  writer: 'page',
  at: at('2026-10-15'),
  source: 'test',
  topic: id.replace(/-/g, ' '),
  objective: 'E4-3',
  exam: 'E4',
  course: 'NUR 112',
  kind: 'concept',
  addedBy: 'test',
  initial: { streak: 0, nextDue: '2026-10-16', recurrence: 1, misses: 0 },
  events: {},
  ...extra,
});
const att = (date, correct, extra = {}) => ({ at: at(date, extra.hm || '15:00'), date, correct, ...extra });
const E4 = { id: 'E4', course: 'NUR 112', kind: 'unit', date: '2026-10-21', title: 'Exam 4' };
/** Validates a planned write: a set as the whole document; an update merged (nested maps) into the document it updates. */
function assertValid(w, existing = null) {
  const merge = (a, b) => {
    const o = { ...a };
    for (const [k, v] of Object.entries(b))
      o[k] =
        v && typeof v === 'object' && !Array.isArray(v) && a && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
    return o;
  };
  const doc = w.op === 'update' ? merge(EV.docData(existing), w.data) : w.data;
  const r = validate(w.collection, doc, { id: w.id });
  assert.ok(r.ok, describeErrors(`${w.collection}/${w.id}`, r));
}

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

test('B-157: the conversation is its own file, one factory, and E.V. core still exports every name callers use', () => {
  const src = fs.readFileSync(new URL('../core/conversation.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'no imports: it runs in the page as written');
  assert.deepEqual(src.match(/^export .*/gm), ['export function makeConversation(core) {']);
  const core = fs.readFileSync(new URL('../core/evcore.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(
    core,
    /function greeting|function conversations|function earlierConversation/,
    'moved, not copied'
  );
  for (const n of ['greeting', 'conversations', 'earlierConversation', 'noteTitle'])
    assert.equal(typeof EV[n], 'function', n);
  assert.equal(typeof makeConversation, 'function');
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
  assert.equal(late.mood, 'sleepy');
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
  assert.equal(g.mood, 'alert');
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

test('greeting chips (D-125 as amended): at most three; Start a study session last unless one runs; then review, finished job, filing, what is due', () => {
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
  assert.deepEqual(EV.greeting({ ...base, reviewLeft: 4, jobs: [job], unfiled: 2, dueSoon: 3 }).chips, [
    'Start review',
    'Open the practice set',
    'Start a study session',
  ]);
  assert.deepEqual(EV.greeting({ ...base, reviewLeft: 0, jobs: [job], unfiled: 1, dueSoon: 3 }).chips, [
    'Open the practice set',
    'File it',
    'Start a study session',
  ]);
  assert.deepEqual(
    EV.greeting({ ...base, reviewLeft: 0, unfiled: 0, dueSoon: 3 }).chips,
    ['What’s due this week?', 'How ready am I?', 'Start a study session'],
    'what is due is the first offer to drop, but fills a free slot'
  );
  assert.deepEqual(
    EV.greeting({ ...base, reviewLeft: 4, jobs: [job], unfiled: 2, dueSoon: 3, sessionActive: true }).chips,
    ['Start review', 'Open the practice set', 'File it'],
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
  assert.equal(one.mood, 'alert');
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
