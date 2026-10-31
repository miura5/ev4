import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { copyRepo, git } from './helpers.mjs';
import * as C from '../tools/chart.mjs';
import { recordPastLive, runRefusals } from '../tools/record-past.mjs';
import { missingTags } from '../tools/tags.mjs';

// B-641: a live deploy that went out but was never recorded is recorded from its pwa-live run, deploying nothing.
const runOf = (commit, extra = {}) => ({
  id: 41191526407,
  path: '.github/workflows/pwa-live.yml',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  display_title: `pwa-live ${commit}`,
  updated_at: '2026-10-31T10:14:00Z',
  ...extra,
});

test('B-641: runRefusals takes only a successful pwa-live run of that commit from main', () => {
  const c = 'a'.repeat(40);
  assert.deepEqual(runRefusals(runOf(c), c), []);
  assert.equal(runRefusals(runOf(c, { conclusion: 'failure' }), c).length, 1);
  assert.equal(runRefusals(runOf(c, { path: '.github/workflows/pwa-staging.yml' }), c).length, 1);
  assert.equal(runRefusals(runOf('b'.repeat(40)), c).length, 1);
  assert.equal(runRefusals(runOf(c, { head_branch: 'x' }), c).length, 1);
});

test('B-641: ship live --record-past writes the live entry ship live would, with the release named', () => {
  const dir = copyRepo();
  const head = git(dir, 'rev-parse', 'HEAD').trim();
  const file = path.join(dir, 'chart', 'deploys.json');
  const deploys = JSON.parse(fs.readFileSync(file, 'utf8'));
  const prevLive = deploys.filter(d => d.target === 'live').at(-1);
  const deps = run => ({
    git: a => git(dir, ...a),
    fetchRun: () => run,
    loadChart: () => C.loadChart(dir),
    tagAt: c => C.tagAt(dir, c),
    recordShip: (o, opts) => C.recordShip(dir, o, opts),
  });
  const o = {
    commit: head.slice(0, 7),
    run: '41191526407',
    release: 'v4.9.24',
    'no-commit': true,
    root: dir,
    trailer: [],
  };
  // No green staging deploy at the commit yet: refused, nothing written.
  assert.throws(() => recordPastLive(o, deps(runOf(head))), /R-02/);
  deploys.push({
    target: 'staging',
    commit: head.slice(0, 7),
    time: '2026-10-31T10:00:00Z',
    verify: 'green',
    okFrom: null,
    rollback: null,
    from: null,
    tasks: [],
    summary: null,
    why: null,
    decisions: [],
    source: 'log',
  });
  fs.writeFileSync(file, JSON.stringify(deploys, null, 1));
  assert.throws(() => recordPastLive(o, deps(runOf(head, { conclusion: 'failure' }))), /not completed\/success/);
  assert.throws(() => recordPastLive({ ...o, release: undefined }, deps(runOf(head))), /--release/);
  const log = console.log;
  console.log = () => {};
  try {
    recordPastLive(o, deps(runOf(head)));
  } finally {
    console.log = log;
  }
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  const d = after.at(-1);
  assert.deepEqual(
    [d.target, d.commit, d.release, d.okFrom, d.verify, d.rollback, d.from, d.time],
    ['live', head.slice(0, 7), 'v4.9.24', 'Matt', 'green', prevLive.commit, prevLive.commit, '2026-10-31T10:14:00Z']
  );
  // tags.yml would make the named release, not the next patch.
  const tags = { 'v4.9.23': 'f'.repeat(40) };
  const fake = [{ target: 'live', commit: 'f'.repeat(40) }, d];
  assert.deepEqual(
    missingTags(fake, tags).map(t => t.tag),
    ['v4.9.24']
  );
  // A second run is refused: the entry is in the record.
  assert.throws(() => recordPastLive(o, deps(runOf(head))), /already recorded/);
});
