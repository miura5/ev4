// E.V. core's Canvas rules: the code side of the read-only sync (B-160, split from core.test.mjs with its section). All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';
import { assertValid } from './core-fixtures.mjs';

test('Canvas: Central dates, graded flags, change detection; documents carry the canvas-sync envelope', () => {
  const raw = {
    courses: { 'NUR 112': 199214 },
    planner: [
      {
        plannable_id: 1,
        plannable_type: 'assignment',
        course_id: 199214,
        plannable: { title: 'Older Adult', due_at: '2026-11-17T05:59:59Z', points_possible: 10 },
      },
    ],
    announcements: [
      {
        id: 9,
        title: 'Week of 10/19',
        message: '<p>Monday lab: <b>Head-to-Toe</b></p>',
        context_code: 'course_199214',
        posted_at: '2026-10-15T14:00:00Z',
      },
    ],
  };
  let r = EV.normalizeCanvas(raw, {}, { now: '2026-10-17T20:15:00Z' });
  assert.equal(r.dates[0].data.date, '2026-11-16');
  assert.equal(r.dates[0].data.graded, true);
  assert.equal(r.dates[0].data.writer, 'canvas-sync');
  assert.equal(r.announcements[0].data.text, 'Monday lab: Head-to-Toe');
  assertValid({ op: 'set', collection: 'dates', id: r.dates[0].id, data: r.dates[0].data });
  assertValid({ op: 'set', collection: 'announcements', id: r.announcements[0].id, data: r.announcements[0].data });
  r = EV.normalizeCanvas(raw, { dates: [{ id: 'canvas-1', ...r.dates[0].data }], announcements: [{ id: 'canvas-9' }] });
  assert.equal(r.dates.length + r.announcements.length, 0, 'unchanged items are skipped');
  // A hand-entered date that already carries the Canvas id is updated in place, never duplicated.
  const hand = {
    id: 'nur-2026-11-16-older-adult',
    canvasId: 1,
    date: '2026-11-15',
    dueAt: '2026-11-16T05:59:59Z',
    title: 'Older Adult (ATI)',
    kind: 'due',
  };
  r = EV.normalizeCanvas(raw, { dates: [hand] });
  assert.equal(r.dates.length, 1);
  assert.equal(r.dates[0].id, 'nur-2026-11-16-older-adult');
  assert.equal(r.dates[0].op, 'update');
  assert.equal(r.dates[0].data.date, '2026-11-16');
  assert.ok(!('title' in r.dates[0].data), 'the hand-written title is kept');
});

test('D-324: the Canvas door passes every text on; nothing is held as a patient identifier', () => {
  const raw = {
    courses: { 'NUR 112': 199214 },
    planner: [],
    announcements: [
      {
        id: 21,
        title: 'Clinical reminder',
        message: '<p>Bring your stethoscope. Your client in room 12 (MRN: 4482913) needs a made-up care plan.</p>',
        context_code: 'course_199214',
        posted_at: '2026-10-15T14:00:00Z',
      },
      {
        id: 22,
        title: 'Lab moved',
        message: '<p>Skills lab moves to room 214 on Tuesday.</p>',
        context_code: 'course_199214',
        posted_at: '2026-10-15T15:00:00Z',
      },
    ],
    files: [
      {
        course: 'NUR 112',
        courseId: 199214,
        fileId: 501,
        title: 'Made-up case study',
        module: 'Exam 4 Content',
        updatedAt: '2026-10-15T00:00:00Z',
        text: '[p1] Case: patient born 03/14/1951, DOB 03/14/1951. ' + 'Made-up teaching text. '.repeat(20),
      },
      {
        course: 'NUR 112',
        courseId: 199214,
        fileId: 502,
        title: 'Made-up slides',
        module: 'Exam 4 Content',
        updatedAt: '2026-10-15T00:00:00Z',
        text: "[s1] Label the specimen with the patient's name, DOB and MRN. " + 'Made-up teaching text. '.repeat(20),
      },
    ],
  };
  const r = EV.normalizeCanvas(raw, {}, { now: '2026-10-17T20:15:00Z' });
  assert.deepEqual(r.announcements.map(a => a.id).sort(), ['canvas-21', 'canvas-22'], 'nothing is refused at the door');
  assert.deepEqual(r.materials.map(m => m.id).sort(), ['NUR112-501', 'NUR112-502']);
  assert.deepEqual(r.refused, []);
  assert.match(r.announcements.find(a => a.id === 'canvas-21').data.text, /MRN: 4482913/, 'kept as written');
});
