// Shared fixtures for the study-logic tests (not a test file: npm test runs test/*.test.mjs only). Importing it loads
// the spec into E.V. core, as each of those files did on its own before. All data is made up.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';
import { loadValidator } from '../core/schemas.mjs';
import { describeErrors } from '../core/validate.mjs';

export const spec = JSON.parse(fs.readFileSync(new URL('../spec/ev.spec.json', import.meta.url)));
EV.configure(spec);
const validate = loadValidator();

export const at = (date, hm = '15:00') => `${date}T${hm}:00Z`; // 15:00Z = 10:00 Central (CDT)
export const key = (iso, writer = 'page') => EV.eventKey(writer, iso);
export const ev = (iso, e, writer = 'page') => ({ [key(iso, writer)]: { ...e } });
export const ws = (id, extra = {}) => ({
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
export const att = (date, correct, extra = {}) => ({ at: at(date, extra.hm || '15:00'), date, correct, ...extra });
export const E4 = { id: 'E4', course: 'NUR 112', kind: 'unit', date: '2026-10-21', title: 'Exam 4' };
/** Validates a planned write: a set as the whole document; an update merged (nested maps) into the document it updates. */
export function assertValid(w, existing = null) {
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
