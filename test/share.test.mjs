// E.V. core's shareable practice pages (D-110) (B-160, split from core.test.mjs with its section). All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';
import './core-fixtures.mjs'; // loads the spec into E.V. core
import { makeShare } from '../core/share.mjs';

test('B-160: core/share.mjs is one factory with no imports, moved out of E.V. core, and E.V. core still exports its names', () => {
  const src = fs.readFileSync(new URL('../core/share.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'no imports: it runs in the page as written');
  assert.deepEqual(src.match(/^export .*/gm), ['export function makeShare(core) {']);
  const core = fs.readFileSync(new URL('../core/evcore.mjs', import.meta.url), 'utf8');
  for (const n of ['shareableSet', 'sharePage']) {
    assert.doesNotMatch(core, new RegExp('function ' + n + '\\('), n + ' moved, not copied');
    assert.equal(typeof EV[n], 'function', n);
  }
  assert.equal(typeof makeShare, 'function');
});

test('B-54 (D-110): only a calendar set over a chapter range is shared; the page holds questions and reasons, nothing of his', () => {
  const item = (id, extra = {}) => ({
    id,
    type: 'single',
    stem: 'A made-up client asks a sample question here.',
    options: ['First', 'Second'],
    correct: [1],
    rationales: ['Not this one.', 'This one, because.'],
    objective: 'E4-3',
    topic: 'Sample topic',
    cjStep: 'take-action',
    ...extra,
  });
  const plans = EV.planViews(
    [
      {
        id: 'E4',
        exam: 'E4',
        days: [
          {
            date: '2026-10-17',
            tasks: [
              { id: 'd6', text: 'Drill 6: Ch 42, 45', kind: 'drill', chapters: [42, 45] },
              { id: 'd7', text: 'Drill 7: the group’s weak spots from the sim', kind: 'drill' },
              { id: 'g1', text: 'ATI proctored practice', kind: 'drill', chapters: [3] },
              { id: 'q1', text: 'Graded quiz 4', kind: 'graded' },
            ],
          },
        ],
      },
    ],
    []
  );
  const drill = {
    id: 'E4-drill-6',
    kind: 'drill',
    planTaskId: 'd6',
    title: 'Drill 6: Ch 42, 45',
    items: [item('d1', { weakspotId: 'ws-made-up' }), item('d2')],
  };
  assert.deepEqual([EV.shareableSet(drill, plans).ok, EV.shareableSet(drill, plans).task.id], [true, 'd6']);
  const no = s => EV.shareableSet(s, plans);
  assert.match(
    no({ ...drill, id: 'review-2026-10-18', kind: 'review', planTaskId: undefined }).why,
    /review set is built for you/
  );
  assert.match(
    no({ ...drill, id: 'E4-drill-7', planTaskId: 'd7', title: 'Drill 7: the group’s weak spots from the sim' }).why,
    /weak-spot drill/
  );
  assert.match(no({ ...drill, planTaskId: 'g1', title: 'ATI proctored practice' }).why, /graded or proctored/);
  assert.match(no({ ...drill, planTaskId: 'q1' }).why, /graded or proctored/);
  assert.match(no({ ...drill, kind: 'job', planTaskId: undefined }).why, /job set/);
  assert.match(no({ ...drill, planTaskId: undefined }).why, /exam plan’s calendar/);
  assert.equal(no(null).why, 'no such set');
  const html = EV.sharePage(drill);
  assert.match(html, /<title>Drill 6: Ch 42, 45<\/title>/);
  assert.match(html, /2 practice questions/);
  assert.match(html, /This one, because\./);
  assert.match(html, /class="why" hidden/, 'reasons start hidden');
  assert.doesNotMatch(html, /ws-made-up|weakspot|E4-3|Sample topic|Matt|E4-drill-6/);
  assert.equal(
    EV.sharePage({ ...drill, title: '<b>x</b>' }).includes('<title>&lt;b&gt;x&lt;/b&gt;</title>'),
    true,
    'text is escaped'
  );
});
