// B-115: the UI tenets' checks (test/harness/tenets.cjs), held to planted views without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './helpers.mjs';

const { judge } = createRequire(import.meta.url)('./harness/tenets.cjs');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
// The E.V. tab at load, as the look pass reads it: one line, the briefing folded, one urgent dot.
const ev = () => ({ tab: 'ev', width: 390, step: 'idle', cards: [], primaries: [], leads: ['Evening, Matt. ATI Engage is due tonight.'], lists: [{ id: 'brief-list', rows: 0 }], rows: [], coral: ['br-dot urgent'], urgent: 1, chips: ['Start review', 'What’s due this week?', 'Start a study session'], monoOrSpacedCaps: 0, qchipsShown: true });
const failing = s => judge(s, spec.ui.tenets.exceptions).filter(c => !c.ok).map(c => c.tenet);

test('B-115: the look pass checks D-146 to D-151 at 390, 735 and 1280, with E.V. on and the other tabs reporting', () => {
  assert.deepEqual(spec.ui.tenets.checks, ['D-146', 'D-147', 'D-148', 'D-149', 'D-150', 'D-151']);
  assert.deepEqual(spec.ui.tenets.widths, [390, 735, 1280]);
  assert.deepEqual(spec.ui.tenets.on, ['ev']);
  assert.deepEqual(judge(ev()).map(c => c.tenet), spec.ui.tenets.checks);
  assert.deepEqual(failing(ev()), [], 'the E.V. tab passes them all');
  const look = fs.readFileSync(path.join(ROOT, 'test', 'harness', 'look.cjs'), 'utf8');
  assert.match(look, /page\.evaluate\(collect\)/); assert.match(look, /TENETS\.on\.includes\(view\.tab\)/);
});

test('B-115: a planted info-only card fails D-147; a planted empty-state card fails D-151', () => {
  const info = ev(); info.cards.push({ id: 'harness-info', cls: 'card', text: 'Next 7 days Tue 10/20 Fundamentals due', controls: 0, emptyOnly: false });
  assert.deepEqual(failing(info), ['D-147']);
  const empty = ev(); empty.cards.push({ id: 'harness-empty', cls: 'card', text: 'Background jobs Jobs you ask E.V. for show up here.', controls: 0, emptyOnly: true });
  assert.deepEqual(failing(empty), ['D-151']);
  // spec.ui.tenets.exceptions excuses a card by id or class.
  assert.deepEqual(judge(info, { 'D-147': ['harness-info'] }).filter(c => !c.ok), []);
  assert.deepEqual(judge(empty, { 'D-151': ['card'] }).filter(c => !c.ok), []);
});

test('B-115: the other checks each fail on what their tenet forbids', () => {
  const two = ev(); two.primaries = ['Start review', 'Give me 5 more']; assert.deepEqual(failing(two), ['D-146']);
  const leads = ev(); leads.leads.push('8', '2 days'); assert.deepEqual(failing(leads), ['D-146']);
  const open = ev(); open.lists.push({ id: 'weak-active', rows: 20 }); assert.deepEqual(failing(open), ['D-148']);
  const tall = ev(); tall.rows.push({ text: 'a two-line row', h: 70 }); assert.deepEqual(failing(tall), ['D-148']);
  const coral = ev(); coral.coral.push('graded', 'graded'); assert.deepEqual(failing(coral), ['D-149']);
  const none = ev(); none.coral = []; assert.deepEqual(failing(none), ['D-149'], 'an urgent item with nothing coral');
  const chips = ev(); chips.chips.push('due', 'graded'); assert.deepEqual(failing(chips), ['D-150']);
  const mono = ev(); mono.monoOrSpacedCaps = 2; assert.deepEqual(failing(mono), ['D-150']);
  const talk = ev(); talk.step = 'conversation'; assert.deepEqual(failing(talk), ['D-151'], 'chips shown in a conversation');
  talk.qchipsShown = false; assert.deepEqual(failing(talk), []);
});
