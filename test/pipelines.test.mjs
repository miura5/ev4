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

test('worker: the named job done end to end, its practice set saved and its message posted; the audit allows its one Doc', () => {
  const at = '2026-10-17T19:34:00Z';
  const db = recordDb();
  db.jobs.push({ id: 'job-20261017-193300-made-up-set', schema: 1, writer: 'page', at: '2026-10-17T19:33:00Z', source: 'E.V. Home', kind: 'practice-set', title: 'Five made-up questions', brief: 'Five questions on the sample topic.', fired: { at: '2026-10-17T19:33:01Z', ok: true } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-worker-'));
  assert.throws(() => RUN.start({ spec, pipeline: 'morning', at, dir, release: 'v4.0.0', input: { job: 'x' } }), /morning takes no --job/);
  RUN.start({ spec, pipeline: 'worker', record: 'staging', at, dir, release: 'v4.0.0', input: { job: 'job-20261017-193300-made-up-set' } });
  const lines = [];
  for (const c of RUN.pull({ spec, dir, at })) {
    const a = c.args; const docs = (db[a.collection] || []).filter(d => !a.query.where || EV.toMs(d.at) >= EV.toMs(a.query.where[0][2]));
    for (const d of docs) { const f = path.join(a.out_dir, a.collection, d.id + '.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(EV.docData(d))); }
    const id = 'w' + (++seq);
    lines.push(line({ message: { content: [{ type: 'tool_use', id, name: 'ArtifactData', input: a }] } }));
    lines.push(line({ message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: docs.length ? `${docs.length} documents from collection "${a.collection}" saved:\n` + docs.map(d => `- "${d.id}"  1 bytes  version 2  "x"`).join('\n') : '0 documents' }] }] } }));
  }
  RUN.pulled({ spec, dir, transcript: lines.join('\n') });
  const w = RUN.compute({ spec, dir, validate, at });
  assert.equal(w.status, 'waiting'); assert.equal(w.question.material.job.kind, 'practice-set');
  assert.match(w.question.material.guide, /aimed at his active weak spots/);
  const q = n => ({ type: 'single', stem: `Made-up question number ${n} about the sample topic?`, options: ['a', 'b', 'c', 'd'], correct: [0], rationales: ['y', 'n', 'n', 'n'], objective: 'E9-1', topic: 'Sample topic', cjStep: 'recognize-cues', verify: true });
  answer(dir, 'do-job', { text: 'Here are five questions on the sample topic. Try them when you have ten minutes.', items: [q(1), q(2), q(3), q(4), { ...q(5), options: ['only one'] }] });
  const r = RUN.compute({ spec, dir, validate, at });
  assert.equal(r.status, 'planned', JSON.stringify(r.problems));
  assert.equal(r.plan.push, 'Here are five questions on the sample topic.');
  const { out } = applied(db, dir);
  const res = out.jobresults.find(x => x.id === 'job-20261017-193300-made-up-set');
  assert.deepEqual([res.status, res.result.setId, res.writer], ['done', 'job-20261017-193300-made-up-set', 'worker']);
  const set = out.sets.find(x => x.id === res.result.setId);
  assert.equal(set.items.length, 4, 'the invalid question is dropped');
  const talk = out.talk.find(x => x.id === '2026-10-17');
  const msg = talk.messages[res.message];
  assert.deepEqual([msg.role, msg.jobId, msg.cards.map(c => c.type)], ['ev', 'job-20261017-193300-made-up-set', ['job', 'set']]);
  assert.ok(validate('talk', EV.docData(talk), { id: talk.id }).ok);
  // The run's transcript: its printed calls plus the one Claude Doc a study-guide may create; anything else is extra.
  const calls = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')).calls;
  const t = calls.map((c, i) => line({ message: { content: [{ type: 'tool_use', id: 'k' + i, name: c.tool, input: c.args }] } }));
  t.push(line({ message: { content: [{ type: 'tool_use', id: 'doc', name: 'mcp__Claude_Docs__batch', input: { container: { kind: 'project' } } }] } }));
  for (const c of RUN.apply({ dir })) t.push(line({ message: { content: [{ type: 'tool_use', id: 'a' + seq++, name: c.tool, input: c.args }] } }));
  const toResults = arr => arr.flatMap(l => { const u = JSON.parse(l).message.content[0]; return [l, line({ message: { content: [{ type: 'tool_result', tool_use_id: u.id, content: [{ type: 'text', text: 'ok' }] }] } })]; });
  const a = RUN.audit({ dir, transcript: toResults(t).join('\n') });
  assert.equal(a.ok, true, JSON.stringify(a.extra)); assert.equal(a.allowed, 1);
});

test('worker without a job id takes the oldest job with no result, and ends quietly when there is none', () => {
  const at = '2026-10-17T19:34:00Z';
  const db = recordDb(); // its one job already has a result
  const { dir } = session('worker', at, db);
  const r = RUN.compute({ spec, dir, validate, at });
  assert.equal(r.status, 'planned');
  assert.deepEqual(r.plan.steps.map(s => [s.id, s.status]), [['job-brief', 'ok'], ['do-job', 'skipped']]);
  assert.match(r.plan.steps[1].detail, /no job is waiting/);
  assert.equal(r.plan.writes, 0);
});

test('diagnostic: the probe from the firing text, the findings in the ledger entry, no record writes', () => {
  const at = '2026-10-18T06:30:00Z';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-diag-'));
  RUN.start({ spec, pipeline: 'diagnostic', record: 'staging', at, dir, release: 'v4.0.0', input: { probe: 'Is this session\'s transcript readable?' } });
  assert.deepEqual(RUN.pull({ spec, dir, at }), [], 'a diagnostic reads nothing');
  const w = RUN.compute({ spec, dir, validate, at });
  assert.equal(w.status, 'waiting'); assert.equal(w.question.material.probe, 'Is this session\'s transcript readable?');
  assert.ok(w.question.material.surfaces.includes('cloud-run'));
  answer(dir, 'probe', { findings: 'The transcript is at ~/.claude/projects and readable.', proven: ['cloud-run reads its own transcript'], limits: [] });
  const r = RUN.compute({ spec, dir, validate, at });
  assert.equal(r.status, 'planned'); assert.equal(r.plan.writes, 0);
  const [call] = RUN.end({ dir, at: '2026-10-18T06:31:00Z', transcript: null });
  const end = JSON.parse(fs.readFileSync(call.args.file_path, 'utf8'));
  assert.equal(end.detail, 'The transcript is at ~/.claude/projects and readable. | proven: cloud-run reads its own transcript');
  assert.match(end.push, /^Diagnostic: The transcript/);
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-diag-'));
  RUN.start({ spec, pipeline: 'diagnostic', record: 'staging', at, dir: plain, release: 'v4.0.0' });
  assert.equal(RUN.compute({ spec, dir: plain, validate, at }).plan.steps[0].status, 'skipped', 'no probe, nothing to do');
});
