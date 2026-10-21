// B-184 (D-200): the hard line. Under the builder marker a guarded path never reaches main from a builder run: log, plan
// and ship refuse the push, this file's last test fails npm test, log decision refuses a tenet, and deploy prints no
// trigger call (test/cli.test.mjs). Without the marker, a hand chat with Matt present keeps its powers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, copyRepo } from './helpers.mjs';
import * as C from '../tools/chart.mjs';
import { builderRun, guardedChanges, pushRefusal, sectionOf, tenetChanges, BUILDER_MARKER } from '../tools/guard.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-guard-'));
const marker = (at = new Date().toISOString(), extra = {}) => {
  const f = path.join(tmp(), 'builder-run');
  fs.writeFileSync(f, JSON.stringify({ at, ...extra }));
  return f;
};

test('B-184: a builder run is known by a fresh marker; none, stale, future or unreadable is a hand chat', () => {
  const now = Date.parse('2026-10-22T03:00:00Z');
  assert.deepEqual(builderRun({ file: marker('2026-10-22T02:00:00Z', { head: 'abc1234' }), now }), {
    at: '2026-10-22T02:00:00Z',
    head: 'abc1234',
  });
  assert.equal(builderRun({ file: marker('2026-10-22T02:00:00Z', { head: 'not a sha' }), now }).head, null);
  assert.equal(builderRun({ file: marker('2026-10-21T14:00:00Z'), now }), null, 'older than 12 h');
  assert.equal(builderRun({ file: marker('2026-10-22T04:00:00Z'), now }), null, 'from the future');
  assert.equal(builderRun({ file: path.join(tmp(), 'none'), now }), null);
  const bad = path.join(tmp(), 'bad');
  fs.writeFileSync(bad, 'not json');
  assert.equal(builderRun({ file: bad, now }), null);
  assert.equal(BUILDER_MARKER, '/tmp/ev/builder-run');
});

test('B-184: the guarded list is in spec.boundaries, and CLAUDE.md has the section it names', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
  const g = spec.boundaries.guarded;
  assert.deepEqual(g.files, ['chart/rules.json', 'tools/hooks.mjs', '.claude/settings.json', 'tools/gate.mjs']);
  assert.deepEqual(g.spec, ['boundaries', 'actions']); // B-186 (D-203): the actions table is guarded too
  assert.equal(g.decisions, 'tenet');
  for (const f of g.files) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  for (const s of g.sections)
    assert.ok(sectionOf(fs.readFileSync(path.join(ROOT, s.file), 'utf8'), s.heading), `${s.file} ${s.heading}`);
  const md = '# A\n\n## Hard limits\none\n### sub\ntwo\n## Next\nthree';
  assert.equal(sectionOf(md, '## Hard limits'), '## Hard limits\none\n### sub\ntwo');
  assert.equal(sectionOf(md, '## None'), null);
});

test('B-184: tenetChanges names a changed, new or superseded tenet, and nothing for other decisions', () => {
  const t = { id: 'D-001', kind: 'tenet', title: 'a', status: 'accepted', supersedes: [], amends: [] };
  const d = { id: 'D-002', title: 'b', status: 'accepted', supersedes: [], amends: [] };
  const a = JSON.stringify([t, d]);
  assert.deepEqual(tenetChanges(a, JSON.stringify([t, { ...d, title: 'c' }])), []);
  assert.deepEqual(tenetChanges(a, JSON.stringify([{ ...t, title: 'z' }, d])), ['D-001']);
  assert.deepEqual(tenetChanges(a, JSON.stringify([t, d, { ...t, id: 'D-003' }])), ['D-003']);
  assert.deepEqual(tenetChanges(a, JSON.stringify([t, d, { ...d, id: 'D-004', amends: ['D-001'] }])), ['D-004']);
});

test('B-184: guardedChanges finds each guarded path a range touches, and passes everything else', () => {
  const dir = copyRepo();
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  const base = g('rev-parse', 'HEAD');
  const edit = (f, fn) => fs.writeFileSync(path.join(dir, f), fn(fs.readFileSync(path.join(dir, f), 'utf8')));
  const commit = m => {
    g('add', '-A');
    g('commit', '-q', '-m', m);
  };
  // Not guarded: another CLAUDE.md section, another spec key, a non-tenet decision.
  edit('CLAUDE.md', s => s.replace('## Where things live', '## Where things live\n\nA planted line.'));
  edit('spec/ev.spec.json', s => {
    const j = JSON.parse(s);
    j.constants.planted = 1;
    return JSON.stringify(j, null, 1);
  });
  edit('chart/decisions.json', s => {
    const j = JSON.parse(s);
    const d = j.find(x => x.kind !== 'tenet' && !(x.amends || []).length && !(x.supersedes || []).length);
    d.title += ' (planted)';
    return JSON.stringify(j, null, 1);
  });
  commit('not guarded');
  assert.deepEqual(guardedChanges(dir, base, 'HEAD'), []);
  // Each guarded path.
  edit('chart/rules.json', s => s + '\n');
  edit('CLAUDE.md', s => s.replace('No passwords, nothing posted as Matt.', 'No passwords.'));
  edit('spec/ev.spec.json', s => {
    const j = JSON.parse(s);
    j.boundaries.guarded.files = [];
    return JSON.stringify(j, null, 1);
  });
  edit('chart/decisions.json', s => {
    const j = JSON.parse(s);
    j.find(x => x.kind === 'tenet').title += ' (planted)';
    return JSON.stringify(j, null, 1);
  });
  commit('guarded');
  const found = guardedChanges(dir, base, 'HEAD');
  assert.ok(found.includes('chart/rules.json changed'), found.join('; '));
  assert.ok(found.includes('spec.boundaries changed'), found.join('; '));
  assert.ok(found.includes('CLAUDE.md "Hard limits (unchanged from v3)" changed'), found.join('; '));
  assert.ok(
    found.some(f => /^tenets changed: D-\d{3}$/.test(f)),
    found.join('; ')
  );
});

test("B-184: under the marker log's push of a commit touching a guarded path is refused; without it, it goes", () => {
  const dir = copyRepo({ push: true });
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  const head = g('rev-parse', 'HEAD');
  fs.appendFileSync(path.join(dir, 'tools', 'gate.mjs'), '\n// planted\n');
  g('commit', '-qam', 'planted guarded change');
  const run = { at: new Date().toISOString(), head };
  const refused = C.pushRecord(dir, run);
  assert.equal(refused.pushed, false);
  assert.match(refused.why, /a builder run never changes a guarded path \(D-200\): tools\/gate\.mjs changed/);
  assert.equal(pushRefusal(dir, null), null, 'a hand chat');
  assert.equal(C.pushRecord(dir, null).pushed, true);
});

test('B-184: under the marker log decision refuses a tenet, a change to one, and superseding or amending one', () => {
  const rec = {
    decisions: [
      { id: 'D-002', kind: 'tenet', title: 't', status: 'accepted', scope: ['ui'], check: 'review' },
      { id: 'D-001', title: 'd', status: 'accepted', supersedes: [], amends: [] },
    ],
    tasks: [],
  };
  const copy = () => JSON.parse(JSON.stringify(rec));
  const builder = { at: new Date().toISOString(), head: null };
  const log = (o, b = builder) => C.applyLog(copy(), { _: ['log', 'decision', o.id], ...o }, { builder: b });
  const tenet = { id: 'D-003', title: 'x', kind: 'tenet', scope: 'ops', 'checked-by': 'review' };
  assert.throws(() => log(tenet), /a builder run never files or changes a tenet \(D-200\): D-003/);
  assert.throws(() => log({ id: 'D-002', title: 'changed' }), /D-002/);
  assert.throws(() => log({ id: 'D-003', title: 'x', supersedes: 'D-002' }), /D-002/);
  assert.throws(() => log({ id: 'D-003', title: 'x', amends: 'D-001,D-002' }), /: D-002;/);
  // A decision that touches no tenet is filed; without the marker the tenet is too.
  assert.equal(log({ id: 'D-003', title: 'x', amends: 'D-001' }).rec.decisions[0].id, 'D-003');
  assert.equal(log(tenet, null).rec.decisions[0].kind, 'tenet');
});

test("B-184: the review skill reports a guarded path's diff and a builder run's trigger calls", () => {
  const skill = fs
    .readFileSync(path.join(ROOT, '.claude', 'skills', 'review', 'SKILL.md'), 'utf8')
    .replace(/\s+/g, ' ');
  assert.match(skill, /the hard line \(D-200, B-184\): any diff to a guarded path/);
  assert.match(skill, /any create_trigger or update_trigger call in a builder run's transcript/);
});

test('B-184 (D-200 lint): under the builder marker, no commit of this run touches a guarded path', () => {
  const run = builderRun();
  if (!run) return; // a hand chat or CI: nothing to hold
  assert.equal(pushRefusal(ROOT, run), null);
});
