// B-115: the UI tenets' checks (test/harness/tenets.cjs), held to planted views without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, flatSource } from './helpers.mjs';

const { judge } = createRequire(import.meta.url)('./harness/tenets.cjs');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
// The E.V. tab at load, as the look pass reads it: one line, the briefing folded, one urgent dot.
const ev = () => ({
  tab: 'ev',
  width: 390,
  step: 'idle',
  cards: [],
  primaries: [],
  leads: ['Evening, Matt. ATI Engage is due tonight.'],
  lists: [{ id: 'brief-list', rows: 0 }],
  rows: [],
  urgent: 1,
  chips: ['Start review', 'What’s due this week?', 'Start a study session'],
  monoOrSpacedCaps: 0,
  qchipsShown: true,
});
const failing = s =>
  judge(s, spec.ui.tenets.exceptions)
    .filter(c => !c.ok)
    .map(c => c.tenet);

test('B-115: the look pass checks D-146 to D-151 at 390, 735 and 1280, with E.V. on and the other tabs reporting', () => {
  assert.deepEqual(spec.ui.tenets.checks, ['D-146', 'D-147', 'D-148', 'D-150', 'D-151', 'D-160']);
  assert.deepEqual(spec.ui.tenets.onFor, { 'D-160': ['ev', 'study'] });
  assert.deepEqual(spec.ui.tenets.widths, [390, 735, 1280]);
  assert.deepEqual(
    spec.ui.tenets.on,
    ['ev', 'today', 'study', 'progress-readiness', 'system', 'progress-weak'],
    'B-126: every Study view'
  );
  assert.deepEqual(
    judge(ev())
      .map(c => c.tenet)
      .sort(),
    [...spec.ui.tenets.checks].sort()
  );
  assert.deepEqual(failing(ev()), [], 'the E.V. tab passes them all');
  const look = flatSource('test/harness/look.cjs');
  assert.match(look, /page\.evaluate\(collect\)/);
  assert.match(look, /TENETS\.on\.includes\(view\.tab\) \|\| TENETS\.on\.includes\(view\.id\)/);
});

test('B-115: a planted info-only card fails D-147; a planted empty-state card fails D-151', () => {
  const info = ev();
  info.cards.push({
    id: 'harness-info',
    cls: 'card',
    text: 'Next 7 days Tue 10/20 Fundamentals due',
    controls: 0,
    emptyOnly: false,
  });
  assert.deepEqual(failing(info), ['D-147']);
  const empty = ev();
  empty.cards.push({
    id: 'harness-empty',
    cls: 'card',
    text: 'Background jobs Jobs you ask E.V. for show up here.',
    controls: 0,
    emptyOnly: true,
  });
  assert.deepEqual(failing(empty), ['D-151']);
  // spec.ui.tenets.exceptions excuses a card by id or class.
  assert.deepEqual(
    judge(info, { 'D-147': ['harness-info'] }).filter(c => !c.ok),
    []
  );
  assert.deepEqual(
    judge(empty, { 'D-151': ['card'] }).filter(c => !c.ok),
    []
  );
});

test('B-115: the other checks each fail on what their tenet forbids', () => {
  const two = ev();
  two.primaries = ['Start review', 'Give me 5 more'];
  assert.deepEqual(failing(two), ['D-146']);
  const leads = ev();
  leads.leads.push('8', '2 days');
  assert.deepEqual(failing(leads), ['D-146']);
  const open = ev();
  open.lists.push({ id: 'weak-active', rows: 20 });
  assert.deepEqual(failing(open), ['D-148']);
  const tall = ev();
  tall.rows.push({ text: 'a two-line row', h: 70 });
  assert.deepEqual(failing(tall), ['D-148']);
  const chips = ev();
  chips.chips.push('due', 'graded');
  assert.deepEqual(failing(chips), ['D-150']);
  const mono = ev();
  mono.monoOrSpacedCaps = 2;
  assert.deepEqual(failing(mono), ['D-150']);
  const talk = ev();
  talk.step = 'conversation';
  assert.deepEqual(failing(talk), ['D-151'], 'chips shown in a conversation');
  talk.qchipsShown = false;
  assert.deepEqual(failing(talk), []);
  const hide = ev();
  hide.closers = ['Hide'];
  assert.deepEqual(failing(hide), ['D-160'], 'B-122: a Hide button');
});

test('B-125 (D-271): the motion check fails a planted long move, a view still moving at 450 ms and a fading panel', () => {
  const { judgeMotion } = createRequire(import.meta.url)('./harness/tenets.cjs');
  const still = { tab: 'today', over: [], declared: 12, running: [], opacity: 1 };
  assert.equal(judgeMotion(still, still).ok, true);
  assert.equal(
    judgeMotion({ ...still, over: ['div.card animation rise 550 ms'] }, still).ok,
    false,
    'the old staggered rise'
  );
  assert.equal(
    judgeMotion(still, { ...still, running: ['i animation grow-x'] }).ok,
    false,
    'a bar still growing at 450 ms'
  );
  assert.equal(judgeMotion(still, { ...still, opacity: 0.6 }).ok, false, 'the view still fading in');
  // B-225 (D-271): a planted 0.2 s view fade shows at the tap as a view not yet opaque
  assert.equal(judgeMotion({ ...still, opacity: 0.1 }, still).ok, false, 'a 0.2 s view fade on the switch');
  const m = spec.ui.tenets.motion;
  assert.equal(m.maxMs, 450);
  assert.deepEqual(
    m.exempt,
    ['#hero', '.ev-av', '#top-av', '.reveal', '.cap-echo'],
    'her stage, her core and the header avatar, the reveal, the echo of his line'
  );
  const look = flatSource('test/harness/look.cjs');
  assert.match(look, /page\.evaluate\(motion, M\)/);
  assert.match(look, /reducedMotion: 'reduce'/);
});

test('B-125 (D-271): the stylesheet has no staggered rise and no growth of bars on a tab switch', () => {
  const css = fs.readFileSync(path.join(ROOT, 'page', 'styles.css'), 'utf8');
  assert.doesNotMatch(css, /grow-[xy]/);
  assert.doesNotMatch(css, /\.panel\.enter>:nth-child/);
  assert.doesNotMatch(css, /\.panel\.enter\{animation/, 'B-225 (D-271): a view switch is a cut, no fade');
});

test('B-125 (D-271, Matt Oct 20): the status lights are steady, the header one and the session bar one', () => {
  const css = fs.readFileSync(path.join(ROOT, 'page', 'styles.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]*\.(?:led|s-led)[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 4, 'the light rules are in the stylesheet');
  for (const [, sel, body] of rules) assert.doesNotMatch(body, /animation|transition/, sel.trim());
});
