// B-83: the demo copy's made-up record validates against the real schemas on any day, and the demo build swaps only
// the shell's door to claude.use: every app, core and spec byte is the live build's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';
import { makeValidator } from '../core/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemas = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'spec/schemas')).map(f => [f.replace('.schema.json', ''), JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/schemas', f), 'utf8'))]));
const validate = makeValidator(schemas);
EV.configure(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8')));
const load = () => { const ctx = {}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'demo/seed.js'), 'utf8'), ctx); return ctx; };

for (const when of ['2026-10-19T19:00:00Z', '2026-11-02T11:00:00Z', '2027-03-14T15:30:00Z']) {
  test(`the demo record validates against every schema (opened ${when})`, () => {
    const db = load().EVDemoSeed(new Date(when));
    let n = 0;
    for (const [c, docs] of Object.entries(db)) for (const [id, doc] of Object.entries(docs)) {
      assert.ok(schemas[c], 'no schema for ' + c);
      const r = validate(c, doc, { id }); assert.ok(r.ok, `${c}/${id}: ${JSON.stringify(r.errors)}`); n++;
    }
    assert.ok(n >= 35, n + ' documents');
    assert.ok(!db.journal, 'no journal in the demo');
  });
}

test('the demo record is dated from the moment it opens: today’s review, Exam 4 in two days, due weak spots', () => {
  const now = new Date('2026-10-19T19:00:00Z'), db = load().EVDemoSeed(now), today = EV.chicagoDate(now);
  assert.ok(db.sets['review-' + today], 'today’s review set');
  assert.equal(db.days[today].date, today);
  assert.equal(EV.diffDays(today, db.exams.E4.date), 2);
  const rows = c => Object.entries(db[c]).map(([id, d]) => ({ id, ...d }));
  const models = EV.buildWeakspots({ weakspots: rows('weakspots'), sets: rows('sets'), answers: rows('answers'), exams: rows('exams') });
  assert.equal(models.length, 10);
  assert.ok(models.filter(m => m.derived.status === 'open').length >= 6, 'most are open');
  assert.ok(EV.rankDue(models, today, rows('exams')).length >= 4, 'several are due today');
  for (const it of load().EVDemoMore) assert.ok(validate('sets', { schema: 1, writer: 'page', at: now.toISOString(), source: 'demo', kind: 'more', items: [it] }).ok, it.id);
});

test('the demo build: the live build with only the shell’s door and the demo script added', async () => {
  const { demoPage } = await import('../tools/demo.mjs');
  const live = { 'index.html': fs.readFileSync(path.join(ROOT, 'page/index.src.html'), 'utf8'), 'app.js': 'APP', 'core.js': 'CORE', 'spec.json': '{}', 'styles.css': 'CSS' };
  const out = demoPage(live, { seed: 'SEED', runtime: 'RUNTIME' });
  for (const f of ['app.js', 'core.js', 'spec.json', 'styles.css']) assert.equal(out[f], live[f], f + ' is the live file');
  assert.equal(out['demo.js'], 'SEED\nRUNTIME');
  assert.ok(out['index.html'].includes('<script src="demo.js"></script>'));
  assert.ok(out['index.html'].includes('window.EVDemo.use(n)'));
  assert.ok(!/window\.claude/.test(out['index.html']), 'the demo shell never reaches claude.use');
});

test('B-103: the demo scripts only made-up data: no session timing, no prompt wording core owns', () => {
  const runtime = fs.readFileSync(path.join(ROOT, 'demo/runtime.js'), 'utf8');
  // Timing comes from the published spec: the demo sets none of the study-session constants.
  for (const k of Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8')).constants.studyWatch || {})) assert.doesNotMatch(runtime, new RegExp('\\b' + k + '\\s*:'), `the demo sets studyWatch.${k}`);
  // Prompts are core's: the demo reads them through EVCore.sessionPrompt, never by their words.
  const prompts = [EV.checkPrompt({ noteName: 'N', text: 'T', added: 'A', n: 1 }), EV.commentPrompt({ noteName: 'N', opening: 'O', added: 'A' }), EV.wrapPrompt({ noteName: 'N', transcript: [] })];
  const lines = [...new Set(prompts.flatMap(p => p.split('\n')).map(l => l.replace(/"N"|\bN\b|\bT\b|\bO\b|\bA\b/g, '').trim()).filter(l => l.length >= 18))];
  const pieces = lines.flatMap(l => l.split(/[.:,;()"]/).map(x => x.trim()).filter(x => x.length >= 18));
  for (const w of pieces) assert.ok(!runtime.includes(w), `demo/runtime.js copies core's prompt wording: "${w}"`);
  assert.match(runtime, /EVCore\.sessionPrompt\(/);
  assert.deepEqual(['check', 'comment', 'wrap'], prompts.map(p => EV.sessionPrompt(p).kind));
  assert.equal(EV.sessionPrompt(EV.commentPrompt({ noteName: 'N', opening: 'O', added: 'new line one\nnew line two' })).added, 'new line one\nnew line two');
});
