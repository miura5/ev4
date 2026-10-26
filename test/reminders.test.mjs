// B-99 (Matt, Oct 19): no standing reminder about graded work and no "made-up" patient or client wording in what E.V.
// says or writes (spec.persona, the item guide, page copy, core's lines and prompts, the synthetic record). D-324: Matt
// overrode the graded-work and identifier limits (B-01, B-04), so nothing refuses a graded-work ask or holds a detail as
// an identifier any more. The scheduled tasks' own prompts (tools/prompts.mjs) keep their other hard limits word for word.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';
import { appSource } from '../tools/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const spec = JSON.parse(read('spec/ev.spec.json'));
EV.configure(spec);
const STANDING =
  /yours alone|made[- ]up (?:client|patient)s?|invented (?:client|patient)|fictional (?:client|patient)/i;

test('no standing graded-work or made-up client wording in what E.V. says or writes', () => {
  for (const [name, text] of [
    ['spec.persona', JSON.stringify(spec.persona)],
    ['spec.items', JSON.stringify(spec.items)],
    ['spec.workingAgreements', JSON.stringify(spec.workingAgreements)],
    ['spec.ui', JSON.stringify(spec.ui)],
    // The run prompts' own limits live in spec.boundaries since D-175 and keep B-99's exemption there.
    ['spec.boundaries', JSON.stringify(spec.boundaries.rules.map(({ prompt, ...r }) => r))],
    ['spec.pipelines', JSON.stringify(spec.pipelines)],
    ['spec.jobs', JSON.stringify(spec.jobs)],
    ['page/app', appSource(ROOT)],
    ['page/index.src.html', read('page/index.src.html')],
    ['core/evcore.mjs', read('core/evcore.mjs')],
    ['core/steps.mjs', read('core/steps.mjs')],
    ['core/steps-worker.mjs', read('core/steps-worker.mjs')],
    ['core/steps-shared.mjs', read('core/steps-shared.mjs')],
    ['core/steps-diagnostic.mjs', read('core/steps-diagnostic.mjs')],
    ['test/data/seed.cjs', read('test/data/seed.cjs')],
  ]) {
    const m = text.match(new RegExp('.{0,40}(' + STANDING.source + ').{0,40}', 'i'));
    assert.equal(m, null, `${name}: ${m && m[0]}`);
  }
});

test('the greeting names graded work without a reminder', () => {
  const g = EV.greeting({
    date: '2026-10-20',
    now: '2026-10-20T19:00:00Z',
    items: [],
    reviewLeft: 0,
    nextExams: [],
    jobs: [],
    runs: {},
    todayDates: [{ title: 'Care plan 3 due 11:59pm', graded: true, kind: 'due' }],
    tomorrow: { dates: [{ title: 'Unit quiz', graded: true, kind: 'due' }] },
  });
  for (const b of g.brief) assert.doesNotMatch(JSON.stringify(b), STANDING);
  assert.doesNotMatch(g.lines.join(' '), STANDING);
});

test('D-324: nothing refuses a graded-work ask or holds a detail as an identifier, on the page, in core or the app', () => {
  const GATES =
    /gradedAsk|identifierCandidates|scanIdentifiers|keptVerdicts|heldByPlace|idGate|idUnpassed|It’s made up|graded work, so it stays yours|[Nn]ever for graded work|never graded work/;
  for (const [name, src] of [
    ['page/app', appSource(ROOT)],
    ['page/index.src.html', read('page/index.src.html')],
    ...fs
      .readdirSync(path.join(ROOT, 'core'))
      .filter(f => f.endsWith('.mjs'))
      .map(f => ['core/' + f, read('core/' + f)]),
    ['pwa/jobs.mjs', read('pwa/jobs.mjs')],
  ]) {
    const m = src.match(new RegExp('.{0,40}(' + GATES.source + ').{0,40}'));
    assert.equal(m, null, `${name}: ${m && m[0]}`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'core/idcheck.mjs')), 'the identifier check is gone');
});

// B-197 (Matt, Oct 21: "I shouldn't get falsely flagged just for participating in a fictional scenario"): every message
// about a possible identifier is a plain question, never an accusation. A string in the page, core or the spec that is
// about patients, identifiers or a held detail may not say flag, violation, accuse or suspicious.
const ACCUSING = /\b(?:flag(?:s|ged|ging)?|violat(?:e|es|ed|ion|ions)|accus\w*|suspicious)\b/i;
const ABOUT_IDS =
  /\b(?:patient|identifier|detail|DOB|date of birth|record number|room number|made up|practice scenario)/i;
function accusingStrings(src) {
  const out = [];
  for (const m of src.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)) {
    const words = m[0].replace(/\$\{[^}]*\}/g, ' '); // a template's code is not its words
    if (ACCUSING.test(words) && ABOUT_IDS.test(words)) out.push(m[0].slice(0, 120));
  }
  return out;
}
test('B-197: no identifier message says flag, violation or accuse, in the page, core or the spec', () => {
  const files = [
    ['page/app', appSource(ROOT)],
    ...fs
      .readdirSync(path.join(ROOT, 'core'))
      .filter(f => f.endsWith('.mjs'))
      .map(f => ['core/' + f, read('core/' + f)]),
    ['spec/ev.spec.json', read('spec/ev.spec.json')],
  ];
  for (const [name, src] of files) assert.deepEqual(accusingStrings(src), [], name);
  // Planted: the lint catches the old kind of line, and passes the new one.
  assert.equal(accusingStrings("toast('This was flagged as a patient identifier violation');").length, 1);
  assert.equal(accusingStrings("toast('Is this from a practice scenario?');").length, 0);
});
