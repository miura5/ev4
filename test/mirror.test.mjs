// E.V. core's Markdown mirror and backup (B-160, split from core.test.mjs with its section). All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';
import { makeMirror } from '../core/mirror.mjs';
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

test('B-160: core/mirror.mjs is one factory with no imports, moved out of E.V. core, and E.V. core still exports its names', () => {
  const src = fs.readFileSync(new URL('../core/mirror.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'no imports: it runs in the page as written');
  assert.deepEqual(src.match(/^export .*/gm), ['export function makeMirror(core) {']);
  const core = fs.readFileSync(new URL('../core/evcore.mjs', import.meta.url), 'utf8');
  for (const n of ['toMarkdown', 'buildBackup', 'restorePlan']) {
    assert.doesNotMatch(core, new RegExp('function ' + n + '\\('), n + ' moved, not copied');
    assert.equal(typeof EV[n], 'function', n);
  }
  assert.equal(typeof makeMirror, 'function');
});

test('backup round-trips into a restore plan', () => {
  const b = EV.buildBackup({ weakspots: [ws('a')], exams: [E4] }, { now: '2026-10-18T01:00:00Z' });
  assert.equal(b.counts.weakspots, 1);
  assert.equal(b.release, null, 'B-149: no release unless the run gives its own');
  assert.equal(EV.buildBackup({}, { now: '2026-10-18T01:00:00Z', release: 'v4.2.0' }).release, 'v4.2.0');
  const plan = EV.restorePlan(b);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].op, 'set');
  assert.ok(!('id' in plan[0].data));
});
