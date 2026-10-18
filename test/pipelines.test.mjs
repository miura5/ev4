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
  assert.deepEqual(r.plan.steps.map(s => [s.id, s.status]), [['practice-brief', 'ok'], ['write-practice', 'skipped'], ['prediction', 'ok'], ['day', 'ok']]);
});

test('evening-cloud: auto-park and the snapshot, with no judgment; state/current rebuilds byte for byte', () => {
  const at = '2026-10-18T01:15:00Z';
  const db = recordDb();
  db.exams.push({ id: 'E4', schema: 2, writer: 'canvas-sync', at: '2026-09-01T00:00:00Z', source: 'test', course: 'NUR 112', kind: 'unit', title: 'Exam 4', date: '2026-10-10', status: 'upcoming' });
  db.weakspots.push({ id: 'ws-old', schema: 1, writer: 'page', at: '2026-09-02T00:00:00Z', source: 'test', topic: 'A made-up old topic', objective: 'E4-1', exam: 'E4', course: 'NUR 112', kind: 'concept', addedBy: 'test', initial: { streak: 0, nextDue: '2026-09-03', recurrence: 1, misses: 0 }, events: {} });
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

test('weekly: the roll-ups, the verify reads, the review as written, weeks/<Sunday>; it rebuilds byte for byte with the text kept', () => {
  const at = '2026-10-18T22:57:00Z';
  const { dir, db } = session('weekly', at);
  // B-29: the verify step first lists the exact reads verify-deploy needs for this record, built from this checkout.
  const v = RUN.compute({ spec, dir, validate, at });
  assert.equal(v.status, 'waiting'); assert.equal(v.step, 'verify');
  const calls = v.question.material.groups[0].calls;
  assert.deepEqual(calls.map(c => [c.tool, c.args.action || null, c.args.doc_id || null]), [
    ['mcp__claude-code-remote__list_triggers', null, null], ['ArtifactData', 'get', 'manifest'], ['ArtifactData', 'get', 'spec'], ['ArtifactData', 'get', 'environments'], ['ArtifactData', 'get', 'seed'], ['Artifact', 'read', null], ['Artifact', 'read', null]]);
  assert.ok(v.question.material.saves.every(x => x.save.startsWith(path.join(dir, 'verify', 'staging'))), 'saved in the run folder, named for the target');
  // Made, and the next list_triggers page by its cursor: matched; any other call is not.
  const tool = (id, name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }) + '\n' + JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  const t = calls.map((c, i) => tool('v' + i, c.tool, c.args)).concat([tool('vc', calls[0].tool, { ...calls[0].args, cursor: 'next' })]).join('\n');
  assert.equal(RUN.audit({ dir, transcript: t }).extra.length, 0, JSON.stringify(RUN.audit({ dir, transcript: t }).extra));
  assert.equal(RUN.audit({ dir, transcript: t + '\n' + tool('vx', calls[0].tool, { limit: 5, cursor: 'next' }) }).extra.length, 1);
  // Nothing saved: verify says what it could not read, red; the week records it.
  answer(dir, 'verify', { saved: true });
  const w = RUN.compute({ spec, dir, validate, at });
  assert.equal(w.status, 'waiting'); assert.equal(w.step, 'week-review'); assert.equal(w.question.material.to, '2026-10-18');
  answer(dir, 'week-review', { review: 'A made-up week: steady practice.', reflection: 'What felt easier this week?', push: 'Weekly review ready · steady week' });
  const r = RUN.compute({ spec, dir, validate, at });
  assert.equal(r.status, 'planned', JSON.stringify(r.problems));
  assert.equal(r.plan.push, 'Weekly review ready · steady week');
  const { out } = applied(db, dir);
  const week = out.weeks.find(d => d.id === '2026-10-18');
  assert.equal(week.review, 'A made-up week: steady practice.');
  assert.equal(week.schema, 2); assert.equal(typeof week.health.summary, 'string');
  const vr = week.health.verify;
  assert.deepEqual([vr.target, vr.green, vr.at], ['staging', false, new Date(at).toISOString()]);
  assert.ok(vr.differences.some(d => d.what === 'scheduled tasks read') && vr.differences.some(d => d.what === 'staging page read'), JSON.stringify(vr.differences));
  assert.equal(rebuildOne(out, spec, 'weeks', week).status, 'same');
  // A refused read: recorded as not run, with the refusal.
  answer(dir, 'verify', { saved: false, refused: 'Artifact read: "A made-up refusal"' });
  const rr = RUN.compute({ spec, dir, validate, at });
  const wk2 = JSON.parse(fs.readFileSync(rr.plan.batches.flat().find(x => x.collection === 'weeks' || (x.writes || []).some(y => y.collection === 'weeks')).file_path || '{}', 'utf8'));
  assert.equal((wk2.health || {}).verify ? wk2.health.verify.refused : undefined, 'Artifact read: "A made-up refusal"');
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

test('B-47 (D-104): an exam-retro job gets examRetro\'s numbers as material and keeps them in its result beside the narrative', () => {
  const at = '2026-10-17T19:34:00Z';
  const db = recordDb();
  db.examedits.push({ id: 'E8', schema: 1, writer: 'page', at: '2026-10-17T19:30:00Z', source: 'E.V. Home', updatedAt: '2026-10-17T19:30:00Z', score: 90, scoreAt: '2026-10-17T19:30:00Z', status: 'done' });
  const jobId = 'job-20261017-193000-retro-e8';
  db.jobs.push({ id: jobId, schema: 1, writer: 'page', at: '2026-10-17T19:30:00Z', source: 'E.V. Home', kind: 'exam-retro', title: 'Retro: Sample Exam 8', brief: 'E8: the retro after the score he entered', fired: { at: '2026-10-17T19:30:01Z', ok: true } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-retro-'));
  RUN.start({ spec, pipeline: 'worker', record: 'staging', at, dir, release: 'v4.0.0', input: { job: jobId } });
  const lines = [];
  for (const c of RUN.pull({ spec, dir, at })) {
    const a = c.args; const docs = (db[a.collection] || []).filter(d => !a.query.where || EV.toMs(d.at) >= EV.toMs(a.query.where[0][2]));
    for (const d of docs) { const f = path.join(a.out_dir, a.collection, d.id + '.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(EV.docData(d))); }
    const id = 'r' + (++seq);
    lines.push(line({ message: { content: [{ type: 'tool_use', id, name: 'ArtifactData', input: a }] } }));
    lines.push(line({ message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: docs.length ? `${docs.length} documents from collection "${a.collection}" saved:\n` + docs.map(d => `- "${d.id}"  1 bytes  version 2  "x"`).join('\n') : '0 documents' }] }] } }));
  }
  RUN.pulled({ spec, dir, transcript: lines.join('\n') });
  const w = RUN.compute({ spec, dir, validate, at });
  assert.equal(w.status, 'waiting');
  const m = w.question.material;
  assert.equal(m.job.kind, 'exam-retro'); assert.match(m.guide, /never mention, guess at or ask about the exam/);
  assert.deepEqual([m.context.retro.examId, m.context.retro.score], ['E8', 90]);
  assert.deepEqual(m.context.retro.calibration, { score: 90, predictedRange: [80, 88], inRange: false, error: 6 });
  answer(dir, 'do-job', { text: 'You scored 90, two points above the top of my range. I underrated you; next time I’ll weigh your practice more.' });
  const r = RUN.compute({ spec, dir, validate, at });
  assert.equal(r.status, 'planned', JSON.stringify(r.problems));
  const { out } = applied(db, dir);
  const res = out.jobresults.find(x => x.id === jobId);
  assert.equal(res.status, 'done'); assert.deepEqual(res.result.retro, m.context.retro);
  assert.ok(validate('jobresults', EV.docData(res), { id: jobId }).ok);
  const msg = out.talk.find(x => x.id === '2026-10-17').messages[res.message];
  assert.deepEqual([msg.jobId, msg.cards.map(c => c.type)], [jobId, ['job']]);
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

test('diagnostic: the probe from the firing text, the findings in the ledger entry and debug/<run id>', () => {
  const at = '2026-10-18T06:30:00Z';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-diag-'));
  RUN.start({ spec, pipeline: 'diagnostic', record: 'staging', at, dir, release: 'v4.0.0', input: { probe: 'Is this session\'s transcript readable?' } });
  assert.deepEqual(RUN.pull({ spec, dir, at }), [], 'a diagnostic reads nothing');
  const w = RUN.compute({ spec, dir, validate, at });
  assert.equal(w.status, 'waiting'); assert.equal(w.question.material.probe, 'Is this session\'s transcript readable?');
  assert.ok(w.question.material.surfaces.includes('cloud-run'));
  answer(dir, 'probe', { findings: 'The transcript is at ~/.claude/projects and readable.', proven: ['cloud-run reads its own transcript'], limits: [] });
  const r = RUN.compute({ spec, dir, validate, at });
  assert.equal(r.status, 'planned'); assert.equal(r.plan.writes, 1);
  assert.deepEqual(r.plan.batches[0].map(w => [w.collection, w.doc_id]), [['debug', 'diagnostic-20261018-063000000']]);
  const dbg = JSON.parse(fs.readFileSync(r.plan.batches[0][0].file_path, 'utf8'));
  assert.deepEqual(dbg.proven, ['cloud-run reads its own transcript']); assert.equal(dbg.writer, 'diagnostic');
  const [call] = RUN.end({ dir, at: '2026-10-18T06:31:00Z', transcript: null });
  const end = JSON.parse(fs.readFileSync(call.args.file_path, 'utf8'));
  assert.equal(end.detail, 'The transcript is at ~/.claude/projects and readable. | proven: cloud-run reads its own transcript');
  assert.match(end.push, /^Diagnostic: The transcript/);
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-diag-'));
  RUN.start({ spec, pipeline: 'diagnostic', record: 'staging', at, dir: plain, release: 'v4.0.0' });
  assert.equal(RUN.compute({ spec, dir: plain, validate, at }).plan.steps[0].status, 'skipped', 'no probe, nothing to do');
});

test('diagnostic: a named probe prints its exact calls, the audit holds the agent to them, numbers reach the ledger', () => {
  const at = '2026-10-18T06:40:00Z';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-diag-'));
  RUN.start({ spec, pipeline: 'diagnostic', record: 'staging', at, dir, release: 'v4.0.0', input: { probe: 'ceilings' } });
  const w = RUN.compute({ spec, dir, validate, at });
  assert.equal(w.status, 'waiting');
  const groups = w.question.material.groups;
  assert.deepEqual(groups.map(g => [g.name, g.calls.length]), [['document', 4], ['batch-writes', 1], ['batch-bytes', 4]]);
  const first = groups[0].calls[0].args;
  assert.deepEqual([first.action, first.collection, first.doc_id], ['set', 'debug', 'diagnostic-20261018-064000000-doc-0255k']);
  const doc = JSON.parse(fs.readFileSync(first.file_path, 'utf8'));
  assert.ok(Math.abs(Buffer.byteLength(JSON.stringify(doc)) - 255 * 1024) <= 2, 'the probe document is the size it says');
  assert.ok(validate('debug', doc).ok, 'a probe document fits debug.schema.json');
  assert.equal(groups[1].calls[0].args.writes.length, 50);
  assert.equal(new Set(groups.flatMap(g => g.calls.flatMap(c => c.args.writes ? c.args.writes.map(x => x.doc_id) : [c.args.doc_id]))).size, 4 + 50 + 20, 'no document is written twice');
  RUN.compute({ spec, dir, validate, at });
  const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  assert.equal(run.calls.filter(c => c.move === 'agent:probe').length, 9, 'registered once, however often compute runs');
  // The transcript: the gate read, the start, two document sets (the second refused), then an unlisted write.
  const tool = (id, name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }) + '\n' + JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  const g0 = groups[0].calls;
  const transcript = [tool('a', 'ArtifactData', g0[0].args), tool('b', 'ArtifactData', g0[1].args)].join('\n');
  const a = RUN.audit({ dir, transcript });
  assert.equal(a.ok, true, JSON.stringify(a.extra));
  const extra = RUN.audit({ dir, transcript: transcript + '\n' + tool('c', 'ArtifactData', { action: 'set', url: g0[0].args.url, collection: 'debug', doc_id: 'other', data: {} }) });
  assert.equal(extra.ok, false);
  answer(dir, 'probe', { findings: 'set accepted 1000 KiB and refused 1536 KiB; a batch holds 50 writes and refused 1200 KiB.', proven: ['ArtifactData set of a 1000 KiB document'], limits: ['a 1536 KiB document is refused'], numbers: { documentKiBAccepted: 1000, documentKiBRefused: 1536 } });
  const r = RUN.compute({ spec, dir, validate, at });
  assert.equal(r.status, 'planned', JSON.stringify(r.problems));
  const dbg = JSON.parse(fs.readFileSync(r.plan.batches[0][0].file_path, 'utf8'));
  assert.deepEqual(dbg.numbers, { documentKiBAccepted: 1000, documentKiBRefused: 1536 });
  assert.match(r.plan.detail, /documentKiBAccepted=1000/);
});
test('B-40: the evening push carries the day: review left, weak spots solid or reopened, tomorrow, the Canvas note; never the journal', async () => {
  const { eveningPush } = await import('../core/steps.mjs');
  const db = recordDb();
  db.journal = [{ id: 'j-planted', schema: 1, writer: 'page', at: '2026-10-16T20:00:00Z', source: 'E.V. Home', text: 'PLANTED-JOURNAL-LINE', kind: 'free' }];
  const ctx = { date: '2026-10-16', now: '2026-10-17T01:15:00.000Z', source: 'evening-cloud evening-cloud-test', writer: 'evening-cloud' };
  db.health = db.health.map(h => h.id === 'current' ? { ...h, at: '2026-10-17T00:55:00.000Z' } : h); // a fresh check (B-55 covers a stale one)
  // The state step's snapshot first, as the pipeline runs it; then last night's evening-mac note.
  for (const w of CODE_STEPS.state(db, ctx, spec).writes) db.state = [...(db.state || []).filter(d => d.id !== w.id), { ...w.data, id: w.id }];
  db.runs.push({ id: 'evening-mac-20261016-012000000', schema: 1, writer: 'evening-mac', at: '2026-10-16T01:20:00Z', source: 't', pipeline: 'evening-mac', release: 'v4.0.0', startedAt: '2026-10-16T01:20:00Z', endedAt: '2026-10-16T01:24:00Z', status: 'ok', push: 'Canvas: BIO 201 Lab Practical moved to Thursday 10/22, check with your instructor' });
  const line = eveningPush(db, ctx, spec);
  assert.ok(line.length <= spec.constants.push.maxChars, `${line.length}: ${line}`);
  assert.match(line, /^Review 1\/2, 1 left · /, line);
  assert.match(line, /Sat: off/, line);
  assert.match(line, / · Canvas: BIO 201 Lab/, line);
  assert.ok(!/PLANTED-JOURNAL-LINE/.test(line));
  // The step itself, in the pipeline's order, sets the plan's push.
  assert.deepEqual(spec.pipelines['evening-cloud'].steps.map(s => s.id), ['auto-park', 'state', 'push']);
  assert.equal(CODE_STEPS.push(db, ctx, spec).push, line);
  // A failed evening-mac: said plainly; an old one (over 36 hours): left out.
  db.runs[db.runs.length - 1].status = 'failed';
  assert.match(eveningPush(db, ctx, spec), /Canvas: last night's sync failed$/);
  db.runs[db.runs.length - 1].startedAt = '2026-10-14T01:20:00Z';
  assert.ok(!/Canvas/.test(eveningPush(db, ctx, spec)));
  // Too long: tomorrow's first item and the Canvas note are cut with an ellipsis before anything is dropped.
  const tight = { ...spec, constants: { ...spec.constants, push: { maxChars: 60 } } };
  db.runs[db.runs.length - 1].startedAt = '2026-10-16T01:20:00Z'; db.runs[db.runs.length - 1].status = 'ok';
  const short = eveningPush(db, ctx, tight);
  assert.ok(short.length <= 60, short); assert.match(short, /^Review 1\/2, 1 left/);
});

test('B-40: a failed run ends with a push naming the failed step', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-push-'));
  RUN.start({ spec, pipeline: 'evening-cloud', record: 'staging', at: '2026-10-17T01:15:00Z', dir, release: 'v4.0.0' });
  const [call] = RUN.end({ dir, at: '2026-10-17T01:16:00Z', status: 'failed', detail: 'pull: "the tool timed out"', transcript: null });
  const doc = JSON.parse(fs.readFileSync(call.args.file_path, 'utf8'));
  assert.equal(doc.push, 'E.V. evening-cloud failed at pull');
});


test('B-55 (D-111): a 5-hour-old health/current is named first by the evening and the morning push lines; a fresh one is not', () => {
  const db = recordDb();
  const ctx = { date: '2026-10-16', now: '2026-10-17T01:15:00.000Z', source: 'evening-cloud evening-cloud-test', writer: 'evening-cloud' };
  const at = h => { db.health = db.health.map(d => d.id === 'current' ? { ...d, at: h } : d); };
  at('2026-10-16T20:15:00.000Z'); // 5 hours before ctx.now
  for (const w of CODE_STEPS.state(db, ctx, spec).writes) db.state = [...(db.state || []).filter(d => d.id !== w.id), { ...w.data, id: w.id }];
  const evening = CODE_STEPS.push(db, ctx, spec).push;
  assert.match(evening, /^Health check 5 h old · /, evening); assert.ok(evening.length <= spec.constants.push.maxChars, evening);
  const mctx = { date: '2026-10-17', now: '2026-10-17T01:15:00.000Z', source: 'morning morning-test', writer: 'morning' };
  const morning = CODE_STEPS.day(db, mctx, spec);
  assert.match(morning.push, /^Health check 5 h old · /, morning.push); assert.ok(morning.push.length <= spec.constants.push.maxChars, morning.push);
  assert.ok(!/Health check/.test(morning.writes[0].data.push), 'the days document keeps its own push');
  // Fresh (under spec.constants.health.staleHours): nothing added. None at all: said so.
  at('2026-10-16T23:55:00.000Z');
  assert.ok(!/Health check/.test(CODE_STEPS.push(db, ctx, spec).push)); assert.ok(!/Health check/.test(CODE_STEPS.day(db, mctx, spec).push));
  db.health = db.health.filter(d => d.id !== 'current');
  assert.match(CODE_STEPS.push(db, ctx, spec).push, /^No health check yet · /);
  // The morning pulls health/current for this, and no Derived document it writes reads it.
  assert.deepEqual(spec.pipelines.morning.reads.find(r => r.collection === 'health'), { collection: 'health', derived: false, why: spec.pipelines.morning.reads.find(r => r.collection === 'health').why });
});

test('B-29: the cloud-reads probe prints a read of its own record\'s page and one list_triggers; the audit accepts those and nothing else', () => {
  const at = '2026-10-18T18:00:00Z';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-diag-'));
  RUN.start({ spec, pipeline: 'diagnostic', record: 'staging', at, dir, release: 'v4.0.0', input: { probe: 'cloud-reads' } });
  const w = RUN.compute({ spec, dir, validate, at });
  const groups = w.question.material.groups;
  assert.deepEqual(groups.map(g => [g.name, g.calls.map(c => c.tool)]), [['artifact-read', ['Artifact']], ['list-triggers', ['mcp__claude-code-remote__list_triggers']]]);
  const read = groups[0].calls[0].args;
  assert.deepEqual(read, { action: 'read', url: 'https://claude.ai/artifact/' + spec.registry.records.staging.artifact });
  const tool = (id, name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }) + '\n' + JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  const transcript = [tool('a', 'Artifact', read), tool('b', 'mcp__claude-code-remote__list_triggers', { limit: 100, enabled: true })].join('\n');
  assert.equal(RUN.audit({ dir, transcript }).ok, true);
  // A read of another artifact, or a publish of this one, is not one of the printed calls.
  assert.equal(RUN.audit({ dir, transcript: transcript + '\n' + tool('c', 'Artifact', { action: 'read', url: 'https://claude.ai/artifact/another' }) }).ok, false);
  assert.equal(RUN.audit({ dir, transcript: transcript + '\n' + tool('d', 'Artifact', { action: 'publish', url: read.url, file_path: '/tmp/x.html' }) }).ok, false);
  // list_triggers is audited too: made as printed it is matched, an unprinted one is extra.
  assert.deepEqual(RUN.audit({ dir, transcript }).missing.filter(k => /list_triggers/.test(k)), []);
  assert.equal(RUN.audit({ dir, transcript: transcript + '\n' + tool('e', 'mcp__claude-code-remote__list_triggers', { limit: 5 }) }).ok, false);
});
