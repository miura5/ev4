// B-223 (D-294, D-327): the right-panel judge, held to planted failures (the shell harness runs it on the real page).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { judge } = createRequire(import.meta.url)('./harness/panel.cjs');

const GROUND = 'rgb(247, 242, 232)';
const card = (id, bg = GROUND, shadow = 'rgba(34, 30, 26, 0.09) 0px 0px 0px 1px') => ({ id, bg, shadow, text: id });
const good = (o = {}) => ({
  width: 1706,
  view: 'ev',
  ground: GROUND,
  detail: true,
  panel: { id: 'ev-side', cards: [card('ev-dates')], titles: ['Exam 4: Fluids, electrolytes and perfusion'] },
  pane: ['Start review'],
  sidebar: ['Read Ch 39: Fluid, electrolyte and acid-base balance'],
  sideToday: true,
  sideTodayItems: 3,
  greet: { align: 'left', leftGap: 0 },
  ...o,
});
const failed = s =>
  judge(s)
    .filter(j => !j.ok)
    .map(j => j.rule);

test('B-223: a good Conversation at 1706 passes every rule', () => {
  assert.deepEqual(failed(good()), []);
});

test('B-223 (D-294): a planted repeat across the sidebar and the panel fails', () => {
  const s = good({ panel: { ...good().panel, titles: ['Read Ch 39: Fluid, electrolyte and acid-base balance'] } });
  assert.deepEqual(failed(s), ['D-294 once']);
});

test('B-357 (D-327): the sidebar Today mirrors the Today pane, as the demo; the pane and the panel still never repeat', () => {
  const t = 'Read Ch 39: Fluid, electrolyte and acid-base balance';
  assert.deepEqual(failed(good({ view: 'today', pane: [t], greet: null })), []);
  assert.deepEqual(failed(good({ pane: ['Exam 4: Fluids, electrolytes and perfusion'] })), ['D-294 once']);
});

test('B-223 (D-327): a planted empty panel fails, and so do a missing one and one below 1200 px', () => {
  assert.deepEqual(failed(good({ panel: { id: 'ev-side', cards: [], titles: [] } })), ['D-327 not empty']);
  assert.deepEqual(failed(good({ panel: null })), ['D-327 panel']);
  assert.deepEqual(failed(good({ detail: false })), ['D-327 panel']);
  assert.deepEqual(failed(good({ width: 1100 })), ['D-327 panel']);
});

test("B-223 (D-294): the sidebar's Today stays on Study", () => {
  assert.deepEqual(failed(good({ view: 'study', sideToday: false, greet: null })), [
    'D-294 Today in the sidebar elsewhere',
  ]);
});

test('B-223 (Matt, Oct 23): her greeting centred on Conversation fails from 600 px', () => {
  assert.deepEqual(failed(good({ greet: { align: 'center', leftGap: 140 } })), ['left-aligned (Matt, Oct 23)']);
});
