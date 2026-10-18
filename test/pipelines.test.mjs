// Pipelines as step lists (B-09): every step the spec names exists, cloud pipelines name no device, and morning,
// evening-cloud and weekly each run through the protocol on the fixture record, with what they compute equal to what
// rebuild reproduces from the record they leave.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EV from '../core/evcore.mjs';
import { readExport, loadValidator } from '../core/schemas.mjs';
import * as RUN from '../core/run.mjs';
import { CODE_STEPS, AGENT_MATERIAL, AGENT_FOLDS } from '../core/steps.mjs';
import { rebuildOne } from '../core/derive.mjs';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator();
const NAMES = Object.keys(spec.pipelines).filter(k => k !== '_rules');

test('every pipeline names its lane, writer and purpose; every step it lists exists', () => {
  for (const n of NAMES) {
    const p = spec.pipelines[n];
    assert.ok(['cloud', 'mac'].includes(p.lane) && spec.roles.includes(p.writer) && p.purpose, n);
    if (p.steps === null) { assert.match(p.pendingIn, /^B-\d\d$/, n); continue; }
    for (const r of p.reads) { assert.ok(spec.collections[r.collection], `${n} reads ${r.collection}`); assert.notEqual(r.collection, 'journal'); }
    for (const s of p.steps) {
      assert.ok(['code', 'agent', 'io'].includes(s.kind), `${n}.${s.id}`);
      if (s.kind === 'code') assert.ok(CODE_STEPS[s.fn || s.id], `${n}: no code step ${s.id}`);
      if (s.kind === 'agent') { assert.ok(s.judgment && AGENT_MATERIAL[s.material] && AGENT_FOLDS[s.fold] && s.output.type === 'object', `${n}.${s.id}`); }
    }
    RUN.pipelineDef(spec, n);
  }
  for (const n of ['morning', 'evening-cloud', 'weekly']) assert.ok(Array.isArray(spec.pipelines[n].steps), n);
});

test('no cloud pipeline names a device, browser or Mac capability (P6)', () => {
  for (const n of NAMES.filter(n => spec.pipelines[n].lane === 'cloud')) {
    assert.doesNotMatch(JSON.stringify(spec.pipelines[n]), /device_|remote-devices|Claude_Browser|javascript_tool|\bMac\b|browser/i, n);
  }
});

// ---------------------------------------------------------------- the protocol on the fixture record
const recordDb = () => { const db = {}; for (const { collection, id, doc } of readExport(path.join(ROOT, 'test/data/record'))) if (collection !== 'journal') (db[collection] = db[collection] || []).push({ ...doc, id }); return db; };
let seq = 0;
const line = o => JSON.stringify(o);
function session(pipeline, at, db = recordDb()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ev4-${pipeline}-`));
  RUN.start({ spec, pipeline, record: 'staging', at, dir, release: 'v4.0.0' });
  const lines = [];
  for (const c of RUN.pull({ spec, dir, at })) {
    const a = c.args; const docs = (db[a.collection] || []).filter(d => !a.query.where || EV.toMs(d.at) >= EV.toMs(a.query.where[0][2]));
    for (const d of docs) { const f = path.join(a.out_dir, a.collection, d.id + '.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(EV.docData(d))); }
    const id = 'u' + (++seq);
    lines.push(line({ message: { content: [{ type: 'tool_use', id, name: 'ArtifactData', input: a }] } }));
    lines.push(line({ message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: docs.length ? `${docs.length} documents from collection "${a.collection}" saved as JSON files under "x":\n` + docs.map(d => `- "${d.id}"  10 bytes  version 1  "x"`).join('\n') : '0 documents' }] }] } }));
  }
  assert.equal(RUN.pulled({ spec, dir, transcript: lines.join('\n') }).done, true);
  return { dir, db };
}
const answer = (dir, step, v) => { fs.mkdirSync(path.join(dir, 'answers'), { recursive: true }); fs.writeFileSync(path.join(dir, 'answers', step + '.json'), JSON.stringify(v)); };
/** The record after the plan is applied (sets replace, updates merge), as the next reader sees it. */
function applied(db, dir) {
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
  const out = JSON.parse(JSON.stringify(db));
  const merge = (a, b) => { const o = { ...(a || {}) }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' ? merge(o[k], v) : v; return o; };
  for (const w of plan.batches.flat()) {
    const data = JSON.parse(fs.readFileSync(w.file_path, 'utf8')); const list = out[w.collection] = out[w.collection] || [];
    const i = list.findIndex(d => d.id === w.doc_id); const doc = w.op === 'update' ? { ...merge(list[i], data), id: w.doc_id } : { ...data, id: w.doc_id };
    if (i >= 0) list[i] = doc; else list.push(doc);
  }
  return { out, plan };
}

test('morning: the brief, the agent\'s items kept only when valid, the review set and the day; the day rebuilds byte for byte', () => {
  const at = '2026-10-17T09:25:00Z';
  const { dir, db } = session('morning', at);
  const w = RUN.compute({ spec, dir, validate, at });
  assert.equal(w.status, 'waiting', JSON.stringify(w)); assert.equal(w.step, 'write-practice');
  const brief = w.question.material;
  assert.equal(brief.date, '2026-10-17');
  const targets = brief.review.targets; const checks = brief.review.checks;
  assert.ok(targets.length + checks.length > 0, 'the fixture has something to review');
  const good = t => ({ type: 'single', stem: 'Which finding fits this made-up scenario best?', options: ['One', 'Two', 'Three', 'Four'], correct: [1], rationales: ['No', 'Yes', 'No', 'No'], objective: t.objective, topic: t.topic || t.text || 'check', cjStep: 'analyze-cues', verify: true, ...(t.weakspotId ? { weakspotId: t.weakspotId } : {}), extra: 'dropped' });
  answer(dir, 'write-practice', { review: [...targets.map(good), ...checks.map(good), { ...good(targets[0] || checks[0]), stem: 'short' }], drills: {} });
  const r = RUN.compute({ spec, dir, validate, at });
  assert.equal(r.status, 'planned', JSON.stringify(r.problems));
  const writes = r.plan.batches.flat();
  const set = writes.find(x => x.collection === 'sets');
  const data = JSON.parse(fs.readFileSync(set.file_path, 'utf8'));
  assert.equal(set.doc_id, 'review-2026-10-17'); assert.equal(data.writer, 'morning');
  assert.equal(data.items.length, targets.length + checks.length, 'the invalid and duplicate items are dropped');
  assert.ok(data.items.every(q => !('extra' in q)));
  assert.match(r.plan.steps.find(s => s.id === 'write-practice').detail, /Dropped/);
  assert.ok(writes.some(x => x.collection === 'days' && x.doc_id === '2026-10-17'));
  assert.match(r.plan.push, /review/);
  const { out } = applied(db, dir);
  const day = out.days.find(d => d.id === '2026-10-17');
  assert.equal(rebuildOne(out, spec, 'days', day).status, 'same', 'what the run computed is what rebuild reproduces');
});

test('morning with the review set already written and no drill due: the agent step is skipped', () => {
  const at = '2026-10-17T09:25:00Z';
  const db = recordDb();
  db.sets.push({ id: 'review-2026-10-17', schema: 1, writer: 'morning', at: '2026-10-17T09:00:00Z', source: 'earlier', kind: 'review', items: [{ id: 'q1', stem: 'An earlier made-up question here?', type: 'single', options: ['a', 'b'], correct: [0] }] });
  const { dir } = session('morning', at, db);
  const r = RUN.compute({ spec, dir, validate, at });
  assert.equal(r.status, 'planned', JSON.stringify(r));
  assert.deepEqual(r.plan.steps.map(s => [s.id, s.status]), [['practice-brief', 'ok'], ['write-practice', 'skipped'], ['day', 'ok']]);
});

test('evening-cloud: auto-park and the snapshot, with no judgment; state/current rebuilds byte for byte', () => {
  const at = '2026-10-18T01:15:00Z';
  const db = recordDb();
  db.exams.push({ id: 'E8', schema: 1, writer: 'canvas-sync', at: '2026-09-01T00:00:00Z', source: 'test', course: 'NUR 112', kind: 'unit', title: 'Exam 8', date: '2026-10-10', status: 'upcoming' });
  db.weakspots.push({ id: 'ws-old', schema: 1, writer: 'page', at: '2026-09-02T00:00:00Z', source: 'test', topic: 'A made-up old topic', objective: 'E8-1', exam: 'E8', course: 'NUR 112', kind: 'concept', addedBy: 'test', initial: { streak: 0, nextDue: '2026-09-03', recurrence: 1, misses: 0 }, events: {} });
  const { dir } = session('evening-cloud', at, db);
  const r = RUN.compute({ spec, dir, validate, at });
  assert.equal(r.status, 'planned', JSON.stringify(r.problems));
  const writes = r.plan.batches.flat();
  const park = writes.find(x => x.doc_id === 'ws-old');
  assert.deepEqual([park.op, park.if_version], ['update', 1]);
  assert.ok(Object.keys(JSON.parse(fs.readFileSync(park.file_path, 'utf8')).events)[0].startsWith('evening-cloud-'));
  const { out } = applied(db, dir);
  const state = out.state.find(d => d.id === 'current');
  assert.equal(rebuildOne(out, spec, 'state', state).status, 'same');
});

test('weekly: the roll-ups, the review as written, weeks/<Sunday>; it rebuilds byte for byte with the text kept', () => {
  const at = '2026-10-18T22:57:00Z';
  const { dir, db } = session('weekly', at);
  const w = RUN.compute({ spec, dir, validate, at });
  assert.equal(w.status, 'waiting'); assert.equal(w.question.material.to, '2026-10-18');
  answer(dir, 'week-review', { review: 'A made-up week: steady practice.', reflection: 'What felt easier this week?', push: 'Weekly review ready · steady week' });
  const r = RUN.compute({ spec, dir, validate, at });
  assert.equal(r.status, 'planned', JSON.stringify(r.problems));
  assert.equal(r.plan.push, 'Weekly review ready · steady week');
  const { out } = applied(db, dir);
  const week = out.weeks.find(d => d.id === '2026-10-18');
  assert.equal(week.review, 'A made-up week: steady practice.');
  assert.equal(rebuildOne(out, spec, 'weeks', week).status, 'same');
});
