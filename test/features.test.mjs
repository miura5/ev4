// B-18's new features in E.V. core: skills practice (a checklist run step by step, misses filed as weak spots of kind
// skill) and the readiness audit (per objective, with the passages to reread). Made-up checklist text throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';
import { makeValidator } from '../core/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemas = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'spec/schemas')).map(f => [f.replace('.schema.json', ''), JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/schemas', f), 'utf8'))]));
const validate = makeValidator(schemas);
EV.configure(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8')));
const NOW = '2026-10-18T19:00:00Z';

// A made-up packet in the shape the real one has: page marks, the attempt header, numbered steps, asterisks.
const PACKET = { id: 'NUR112-900', title: 'Practice Skills Packet.pdf', course: 'NUR 112', kind: 'lab', text: [
  '[p1] Practice Skills Packet. Table of contents: Bed bath 4; Glove removal 6',
  '[p4] 4 1 st Attempt: S or U __________ 2 nd Attempt: S or U __________ ____ P or F _______ Student Name Date Instructor Name BED BATH VALIDATION CHECKLIST The student may miss NONE of the asterisk (*) areas and only 1 of the non-asterisk areas. 1 st Attempt 2 nd Attempt S U S U * 1. Perform hand hygiene 2. Explain the procedure to the client SAFETY CHECKS * 3. Lower the bed rail on the working side 4. Wash from cleanest to dirtiest area',
  '[p5] 5 * 5. Raise the bed rail before stepping away 6. Document the bath and skin findings Overall Performance: ______ / 6',
  '[p6] 6 1 st Attempt: S or U __________ Student Name Date Instructor Name GLOVE REMOVAL The grading criteria will be satisfactory/unsatisfactory. 1. Pinch the first glove at the wrist 2. Peel it off inside out',
].join('\n') };

test('skillSteps reads one checklist from its page: title, numbered steps, critical marks, the pass rule', () => {
  const sk = EV.skillSteps(PACKET, { page: 4 });
  assert.equal(sk.title, 'BED BATH VALIDATION CHECKLIST');
  assert.deepEqual(sk.steps.map(s => [s.n, s.critical]), [[1, true], [2, false], [3, true], [4, false], [5, true], [6, false]]);
  assert.equal(sk.steps[1].text, 'Explain the procedure to the client', 'a section heading in capitals is not part of the step');
  assert.equal(sk.steps[4].text, 'Raise the bed rail before stepping away', 'the page mark between steps is dropped');
  assert.equal(sk.steps[5].text, 'Document the bath and skin findings', 'the scoring footer is dropped');
  assert.deepEqual(sk.rule, { missNonCritical: 1 });
  assert.equal(sk.cite, 'Practice Skills Packet, p. 4');
  assert.equal(EV.skillSteps(PACKET, { page: 6 }).steps.length, 2, 'the next checklist starts over at 1');
});

test('a skills session: start, a miss files a skill weak spot at once, a later pass marks it done, the end sums up', () => {
  const sk = EV.skillSteps(PACKET, { page: 4 });
  const start = EV.startSkill(sk, { now: NOW });
  assert.match(start.id, /^ss-skill-20261018-190000-bed-bath/);
  assert.ok(validate('sessions', start.data, { id: start.id }).ok, JSON.stringify(validate('sessions', start.data).errors));
  let s = { id: start.id, ...start.data };
  const apply = writes => { for (const w of writes) if (w.collection === 'sessions') s = { ...s, ...w.data, events: { ...s.events, ...(w.data.events || {}) } }; return writes; };
  apply(EV.skillStep(s, 1, 'pass', { now: '2026-10-18T19:01:00Z' }));
  const miss = apply(EV.skillStep(s, 2, 'miss', { now: '2026-10-18T19:02:00Z' }));
  const ws = miss.find(w => w.collection === 'weakspots');
  assert.equal(ws.op, 'set'); assert.equal(ws.data.kind, 'skill'); assert.match(ws.data.topic, /^BED BATH VALIDATION CHECKLIST: step 2, Explain the procedure/);
  assert.ok(validate('weakspots', ws.data, { id: ws.id }).ok, JSON.stringify(validate('weakspots', ws.data).errors));
  let st = EV.skillState(s);
  assert.deepEqual([st.done, st.next.n, st.missed, st.complete], [2, 3, [2], false]);
  // The weak spot is open (a skill is practiced, not quizzed): the next miss sees it again, a pass marks it done.
  const model = EV.buildWeakspots({ weakspots: [{ id: ws.id, ...ws.data }], sets: [], answers: [], exams: [] });
  assert.equal(model[0].derived.status, 'open');
  const again = EV.skillStep(s, 2, 'miss', { weakspots: model, now: '2026-10-18T19:03:00Z' }).find(w => w.collection === 'weakspots');
  assert.equal(again.op, 'update'); assert.equal(Object.values(again.data.events)[0].type, 'seen');
  const fixed = EV.skillStep(s, 2, 'pass', { weakspots: model, now: '2026-10-18T19:04:00Z' }).find(w => w.collection === 'weakspots');
  assert.equal(Object.values(fixed.data.events)[0].type, 'done');
  for (const n of [3, 4, 5, 6]) apply(EV.skillStep(s, n, n === 5 ? 'miss' : 'pass', { now: `2026-10-18T19:0${n + 2}:00Z` }));
  st = EV.skillState(s);
  assert.deepEqual([st.complete, st.criticalMissed, st.satisfactory], [true, 1, false], 'a missed asterisk step fails the run');
  const end = EV.endSkill(s, { now: '2026-10-18T19:15:00Z' });
  assert.equal(end.data.status, 'ended'); assert.equal(end.data.minutes, 15);
  assert.equal(end.data.summary, '4 of 6 steps done right, missed steps 2, 5. That run would not meet the checklist’s bar yet.');
  assert.ok(validate('sessions', { ...s, ...end.data, events: { ...s.events, ...end.data.events } }).ok);
  assert.throws(() => EV.skillStep(s, 9, 'pass', { now: NOW }), /no step 9/);
  assert.throws(() => EV.startSkill({ title: 'x', steps: [] }, { now: NOW }), /no numbered steps/);
});

test('B-82: a skills run left alone for the conversation idle gap ends itself; its Resume chip leads the greeting', () => {
  const sk = EV.skillSteps(PACKET, { page: 4 });
  const start = EV.startSkill(sk, { now: NOW }); let s = { id: start.id, ...start.data };
  const apply = writes => { for (const w of writes) if (w.collection === 'sessions') s = { ...s, ...w.data, events: { ...s.events, ...(w.data.events || {}) } }; };
  const gap = EV.constants().conversation.idleGapMin; assert.equal(gap, 120);
  assert.equal(Date.parse(EV.skillState(s).lastAt), Date.parse(NOW), 'a fresh run last moved at its start');
  assert.equal(EV.skillIdle(s, '2026-10-18T20:59:00Z'), false, '119 minutes: still waiting');
  assert.equal(EV.skillIdle(s, '2026-10-18T21:00:00Z'), true, '120 minutes: it ends');
  apply(EV.skillStep(s, 1, 'pass', { now: '2026-10-18T19:30:00Z' }));
  assert.equal(Date.parse(EV.skillState(s).lastAt), Date.parse('2026-10-18T19:30:00Z'), 'a marked step moves it');
  assert.equal(EV.skillIdle(s, '2026-10-18T21:00:00Z'), false, 'counted from the last step, not the start');
  assert.equal(EV.skillIdle(s, '2026-10-18T21:30:00Z'), true);
  assert.equal(EV.skillResumeChip(s), 'Resume Bed bath · 2 of 6');
  const end = EV.endSkill(s, { now: '2026-10-18T21:30:00Z', endedBy: 'idle' });
  assert.equal(end.data.endedBy, 'idle'); assert.equal(end.data.minutes, 30, 'minutes to the last step, not to the close');
  assert.match(end.data.summary, /^1 of 6 steps done right\. Left unfinished; nothing was logged for the steps not reached\.$/);
  assert.equal(end.collection, 'sessions'); assert.ok(validate('sessions', { ...s, ...end.data, events: { ...s.events, ...end.data.events } }).ok);
  const ended = { ...s, ...end.data };
  assert.equal(EV.skillIdle(ended, '2026-10-19T09:00:00Z'), false, 'an ended run is never ended again');
  // The greeting: the Resume chip first, Start a study session still last, three at most.
  const g = EV.greeting({ now: '2026-10-18T23:00:00Z', date: '2026-10-18', items: [], reviewLeft: 4, tomorrow: { dates: [] }, skillRun: EV.skillResumeChip(s) });
  assert.deepEqual(g.chips, ['Resume Bed bath · 2 of 6', 'Start review', 'Start a study session']);
});

test('readinessAudit: per objective, not-yet first, with the passages to reread cited by file and page', () => {
  const day = '2026-10-18';
  const w = (id, objective, topic, streak, status = 'open') => ({ id, topic, objective, exam: 'E4', kind: 'concept', derived: { status, streak, preRead: false } });
  const weakspots = [w('a', 'E4-3', 'Hypokalemia findings', 0), w('b', 'E4-3', 'Fluid volume excess signs', 1), w('c', 'E4-7', 'Metformin teaching', 0), w('d', 'E4-7', 'Hypoglycemia signs', 0), w('e', 'E4-1', 'Mixing insulins', 2, 'reviewed'), w('f', 'E3-1', 'Heart sounds', 0)];
  const objectives = [{ id: 'E4-1', exam: 'E4', text: 'Insulin administration' }, { id: 'E4-3', exam: 'E4', text: 'Fluids and electrolytes' }, { id: 'E4-7', exam: 'E4', text: 'Diabetes care' }, { id: 'E4-9', exam: 'E4', text: 'Nothing logged here' }];
  const mats = [{ id: 'NUR112-1', title: 'Ch 42 Fluids.pptx', course: 'NUR 112', kind: 'slides', text: '[s3] Hypokalemia findings: muscle weakness, flat T waves, cramps.\n[s4] Fluid volume excess signs: edema, crackles, bounding pulse.' }, { id: 'NUR112-2', title: 'Ch 50 Diabetes.pdf', course: 'NUR 112', kind: 'slides', text: '[p7] Hypoglycemia signs: shaky, sweaty, confused. Metformin teaching: take with meals.' }];
  const index = EV.libraryIndex(EV.libraryChunks(mats));
  const rows = EV.readinessAudit({ examId: 'E4', objectives, weakspots, index, date: day });
  assert.deepEqual(rows.map(r => [r.id, r.solid, r.rightOnce, r.notYet]), [['E4-7', 0, 0, 2], ['E4-3', 0, 1, 1], ['E4-1', 1, 0, 0]]);
  assert.deepEqual(rows[0].topics, ['Metformin teaching', 'Hypoglycemia signs']);
  assert.equal(rows[0].passages[0].cite, 'Ch 50 Diabetes, p. 7');
  assert.equal(rows[1].passages[0].cite, 'Ch 42 Fluids, slide 3');
  assert.deepEqual(rows[2].passages, [], 'a solid objective needs no rereading');
  assert.deepEqual(EV.readinessAudit({ examId: 'E4', objectives, weakspots }).map(r => r.passages.length), [0, 0, 0], 'no index, no passages');
});
