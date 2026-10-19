// The Chart (M12): chart/ is the project record; BACKLOG.md, the Board, the Changelog and the overview's status line
// are generated from it by tools/chart.mjs. B-92: the one-time import keeps today's backlog row for row.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, copyRepo } from './helpers.mjs';
import { build } from '../tools/build.mjs';
import * as C from '../tools/chart.mjs';

const IMPORT = path.join(ROOT, 'chart', 'import');
const read = f => fs.readFileSync(path.join(IMPORT, f), 'utf8');
const rec = () => C.loadChart(ROOT);
// The import as it ran, with each done task's commit taken from the record (so the test needs no git history).
function imported() {
  const now = rec(), commits = {};
  for (const t of now.tasks) (commits[t.id] = commits[t.id] || []).push(t.commit);
  const seen = {};
  return C.importChart({
    backlog: read('BACKLOG.md'), decisionsMd: read('Decisions.md'),
    boardXml: C.readBody([read('board-read.json')]).xml, changelogXml: C.readBody([read('changelog-read.json')]).xml,
    commitOf: id => { const n = seen[id] = (seen[id] || 0) + 1; return (commits[id] || [])[n - 1] || null; },
    views: JSON.parse(read('views.json')),
  });
}
const rows = s => s.split('\n').filter(l => l.startsWith('| B-'));

test('B-92: the import regenerates BACKLOG.md row for row', () => {
  const before = read('BACKLOG.md'), gen = C.renderBacklog(imported());
  const a = rows(before), b = rows(gen);
  assert.equal(b.length, a.length);
  a.forEach((l, i) => assert.deepEqual(C.parseBacklogRow(b[i]), C.parseBacklogRow(l), `row ${i + 1} (${l.slice(0, 8)}) differs`));
  // Text differs only where a | inside a field is now escaped (it split the cell: B-26's notes, B-42's ||).
  assert.deepEqual(a.filter((l, i) => l !== b[i]).map(l => l.slice(2, 6)), ['B-26', 'B-42']);
  assert.equal(gen.split('\n| Id |')[0], before.split('\n| Id |')[0], 'the header is today\'s');
});

test('B-92: the import holds every decision, the v4 deploys and the Board rows', () => {
  const r = imported();
  assert.equal(r.decisions.length, 96);
  assert.equal(r.decisions[0].id, 'D-139');
  assert.equal(C.nextDecisionId(r), 'D-140');
  assert.deepEqual(r.decisions.find(d => d.id === 'D-106').supersedes, ['D-059']);
  assert.deepEqual(r.decisions.find(d => d.id === 'D-139').amends, ['D-136']);
  assert.equal(r.decisions.find(d => d.id === 'D-059').status, 'superseded');
  const live = r.deploys.filter(d => d.target === 'live');
  assert.equal(live.at(-1).commit, 'c049f48');
  assert.equal(live.at(-1).rollback, '314bb5f');
  assert.equal(live.at(-1).time, '2026-10-19T16:20:00-05:00');
  assert.equal(r.deploys[0].commit, '3fa5d2a', 'the first v4 deploy (staging, Oct 18)');
  for (const d of r.deploys) assert.ok(d.line && d.line.change.includes(d.commit), `${d.target} ${d.commit} keeps its Changelog row`);
  const b83 = r.tasks.filter(t => t.id === 'B-83');
  assert.deepEqual(b83.map(t => t.board && t.board.row), ['v4 B-83: a demo copy and an overview doc', 'v4 B-83: the Mac evening run starts without its code']);
  assert.equal(b83[1].waitingOn, 'Matt');
  for (const t of r.tasks.filter(t => t.status === 'done')) assert.ok(t.commit, `${t.id} done with a commit`);
});

test('chart/ and tools/chart.mjs stay outside the manifest, so a bookkeeping commit ships nothing', async () => {
  const dir = copyRepo(), out = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-chart-dist-'));
  const { manifest } = await build({ root: dir, out, now: '2026-10-19T12:00:00Z' });
  assert.deepEqual(Object.keys(manifest.files).filter(f => f.startsWith('chart/') || f === 'tools/chart.mjs' || f === 'BACKLOG.md'), []);
});
