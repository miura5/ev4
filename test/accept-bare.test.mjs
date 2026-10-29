// B-499: a proposed weak spot can be accepted with no objective: it opens under its course from tomorrow, and an
// objective picked later only names it, its schedule kept. The composer takes an Accept with or without one; the
// actions table decides which the page may send (spec.actions weakspot-accept, a guarded path a build chat changes),
// so this file checks the composer and the derivation both ways. Made-up records.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';
import { makeActions } from '../core/actions.mjs';
import { validateAgainst } from '../core/validate.mjs';
import { spec, at, key, ws, assertValid } from './core-fixtures.mjs';

const A = makeActions(validateAgainst, EV);
const clone = v => JSON.parse(JSON.stringify(v));
// the actions table as it reads once an Accept's objective is optional
const bareSpec = clone(spec);
bareSpec.actions['weakspot-accept'].args.properties.items.items.required = ['id'];
const NOW = at('2026-10-29');
const proposed = ws('ws-2026-10-29-x-osteoclasts', {
  objective: '',
  exam: 'BX3',
  course: 'BIO 201',
  proposed: true,
  initial: { streak: 0, nextDue: '2026-10-30', recurrence: 1, misses: 0 },
});
const BX3 = { id: 'BX3', course: 'BIO 201', kind: 'unit', date: '2026-11-02', title: 'Lecture Exam 3' };
const models = docs => EV.buildWeakspots({ weakspots: docs, sets: [], answers: [], exams: [BX3] });
const merge = (doc, w) => ({ ...doc, events: { ...doc.events, ...w.data.events } });

test('B-499: an Accept with no objective is an accept event with none; the spot opens from tomorrow under its course', () => {
  const r = A.actor(bareSpec, 'tap')(
    'weakspot-accept',
    { items: [{ id: proposed.id }] },
    { now: NOW, weakspots: models([proposed]) }
  );
  assert.equal(r.ok, true, r.refused);
  const [w] = r.writes;
  const e = Object.values(w.data.events)[0];
  assert.deepEqual([e.type, e.by, 'objective' in e], ['accept', 'owner', false]);
  assertValid(w, proposed);
  const [m] = models([merge(proposed, w)]);
  assert.equal(m.derived.status, 'open');
  assert.equal(m.derived.nextDue, '2026-10-30');
  assert.equal(EV.spotCourse(m, { exams: [BX3] }), 'BIO 201');
  assert.ok(EV.isActive(m));
});

test('B-499: an objective picked later names it and keeps its schedule; a pick on a proposed spot accepts it', () => {
  const accepted = { ...proposed, events: { [key(NOW)]: { type: 'accept', by: 'owner', at: NOW } } };
  const later = at('2026-11-01');
  const ans = { at: at('2026-10-30'), correct: true, weakspotId: proposed.id };
  const before = EV.deriveWeakspot(accepted, [ans]);
  const picked = {
    ...accepted,
    events: { ...accepted.events, [key(later)]: { type: 'accept', by: 'owner', at: later, objective: 'BX3-2' } },
  };
  const after = EV.deriveWeakspot(picked, [ans]);
  assert.equal(after.objective, 'BX3-2');
  assert.deepEqual([after.status, after.streak, after.nextDue], [before.status, before.streak, before.nextDue]);
  // the actions table allows a bare Accept (Matt's OK, Oct 29): a pick names its objective, and a bare Accept is sent
  const tap = A.actor(spec, 'tap');
  const ctx = { now: NOW, weakspots: models([proposed]) };
  assert.equal(tap('weakspot-accept', { items: [{ id: proposed.id, objective: 'BX3-2' }] }, ctx).ok, true);
  assert.equal(tap('weakspot-accept', { items: [{ id: proposed.id }] }, ctx).ok, true);
});
