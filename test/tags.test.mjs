// B-175 (D-173): every live deploy carries its release tag on origin. ship live records the release on the deploy, and
// tags.yml (tools/tags.mjs) makes on origin each tag a cloud session's refused push left behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, copyRepo } from './helpers.mjs';
import * as C from '../tools/chart.mjs';
import { missingTags, recordedRelease } from '../tools/tags.mjs';

const live = (commit, extra = {}) => ({ target: 'live', commit, okFrom: 'Matt', ...extra });
const staging = commit => ({ target: 'staging', commit });

test('B-175: the live deploys after the last tagged one take their recorded release, else the next patch in order', () => {
  const deploys = [
    live('aaaaaaa'),
    staging('b000000'),
    live('bbbbbbb'),
    staging('c000000'),
    live('ccccccc'),
    live('ddddddd', { release: 'v4.3.4' }),
    live('eeeeeee', { notes: ['release v4.4.0'] }),
    live('fffffff'),
  ];
  const tags = { 'v4.2.0': 'aaaaaaa', 'v4.3.0': 'bbbbbbb', 'not-a-release': 'ccccccc' };
  assert.deepEqual(
    missingTags(deploys, tags).map(t => [t.tag, t.commit]),
    [
      ['v4.3.1', 'ccccccc'],
      ['v4.3.4', 'ddddddd'],
      ['v4.4.0', 'eeeeeee'],
      ['v4.4.1', 'fffffff'],
    ]
  );
  // Tagged up to the newest: nothing to make. No live deploy tagged at all: nothing inferred.
  assert.deepEqual(missingTags(deploys, { ...tags, 'v4.4.1': 'fffffff' }), []);
  assert.deepEqual(missingTags(deploys, {}), []);
  // A deploy tagged in between restarts the count from its tag; full() matches short commits to origin's full ones.
  const full = c => c.padEnd(40, '0');
  assert.deepEqual(
    missingTags(deploys.slice(0, 5), { 'v4.3.0': full('bbbbbbb'), 'v4.3.5': full('ccccccc') }, full).map(t => t.tag),
    []
  );
  assert.deepEqual(
    missingTags([live('a'), live('b')], { 'v4.3.0': full('a') }, full).map(t => [t.tag, t.commit]),
    [['v4.3.1', full('b')]]
  );
  // A release already on origin at another commit is refused, never moved.
  assert.throws(() => missingTags([live('a'), live('b')], { 'v4.3.0': 'a', 'v4.3.1': 'z' }), /v4\.3\.1 is on origin/);
  assert.equal(recordedRelease(live('a', { notes: ['release v4.3.1', 'release v4.3.2 (corrected)'] })), 'v4.3.2');
  assert.equal(recordedRelease(live('a', { release: 'nope' })), null);
});

test('B-175: the Oct 21 case: v4.3.0 at c38c86b on origin, two live deploys after it with refused pushes', () => {
  const deploys = [live('8ec85c4'), staging('c38c86b'), live('c38c86b'), staging('c8f5464'), live('c8f5464')];
  deploys.push(staging('b9c59d5'), live('b9c59d5'));
  assert.deepEqual(
    missingTags(deploys, { 'v4.2.0': '8ec85c4', 'v4.3.0': 'c38c86b' }).map(t => [t.tag, t.commit]),
    [
      ['v4.3.1', 'c8f5464'],
      ['v4.3.2', 'b9c59d5'],
    ]
  );
});

test('B-175: log deploy --release records the release; ship live records the tag it carries', () => {
  const rec = { deploys: [] };
  C.applyLog(rec, { _: ['log', 'deploy'], target: 'live', commit: 'abcdef0', ok: 'Matt', release: 'v4.3.9' });
  assert.equal(rec.deploys[0].release, 'v4.3.9');
  assert.throws(
    () => C.applyLog(rec, { _: ['log', 'deploy'], target: 'live', commit: 'abcdef1', ok: 'Matt', release: '4.3' }),
    /--release takes a tag/
  );
  const dir = copyRepo();
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  const head = g('rev-parse', 'HEAD').trim();
  g('tag', '-a', 'v4.9.1', '-m', 'v4.9.1');
  const lines = [];
  const was = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    C.recordShip(
      dir,
      { trailer: [], root: dir, tasks: '', summary: 'a planted release' },
      {
        target: 'live',
        manifest: { commit: head },
      }
    );
  } finally {
    console.log = was;
  }
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'chart', 'deploys.json'), 'utf8')).at(-1);
  assert.deepEqual([d.target, d.commit, d.release], ['live', head.slice(0, 7), 'v4.9.1']);
  assert.ok(lines.some(l => /v4\.9\.1/.test(l)));
});

test('B-175: tags.yml runs tools/tags.mjs --push on pushes that touch the deploys, with write access to contents', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'tags.yml'), 'utf8');
  assert.match(y, /chart\/deploys\.json/);
  assert.match(y, /workflow_dispatch/);
  assert.match(y, /contents: write/);
  assert.match(y, /fetch-depth: 0/);
  assert.match(y, /node tools\/tags\.mjs --push/);
});
