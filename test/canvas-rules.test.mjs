// E.V. core's Canvas rules: the code side of the read-only sync (B-160, split from core.test.mjs with its section). All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';
import { makeCanvasRules } from '../core/canvas-rules.mjs';
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

test('B-160: core/canvas-rules.mjs is one factory with no imports, moved out of E.V. core, and E.V. core still exports its names', () => {
  const src = fs.readFileSync(new URL('../core/canvas-rules.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'no imports: it runs in the page as written');
  assert.deepEqual(src.match(/^export .*/gm), ['export function makeCanvasRules(core) {']);
  const core = fs.readFileSync(new URL('../core/evcore.mjs', import.meta.url), 'utf8');
  for (const n of ['normalizeCanvas']) {
    assert.doesNotMatch(core, new RegExp('function ' + n + '\\('), n + ' moved, not copied');
    assert.equal(typeof EV[n], 'function', n);
  }
  assert.equal(typeof makeCanvasRules, 'function');
});

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

test('B-32: the Canvas ingress refuses a text with a patient identifier value and keeps the rest (positive and negative)', () => {
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
  assert.deepEqual(
    r.announcements.map(a => a.id),
    ['canvas-22'],
    'the clean announcement stays (a lab room is no identifier)'
  );
  assert.deepEqual(
    r.materials.map(m => m.id),
    ['NUR112-502'],
    'the field names alone are no identifier'
  );
  assert.deepEqual(r.refused.map(x => x.ref).sort(), ['announcements/canvas-21', 'materials/NUR112-501']);
  assert.ok(r.changes.some(c => c.type === 'refused' && /has a medical record number/.test(c.text)));
});
