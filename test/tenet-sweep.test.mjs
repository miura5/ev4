// B-217: the sweep after D-221, D-222, D-224 and D-225 superseded the four tenets in GONE. No open task, rule or
// test cites a superseded tenet as current (history may name it, marked as such), and the checks hold to the new
// tenets' words: violet retired (its tokens are grey), two clocks (test/interface-motion.test.mjs), a 0.16 s settle,
// and the 680 px reading cap (the look pass measures it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GONE = ['149', '163', '135', '153']; // the superseded ids, by number only (the Chart lint's own check reads text)
const OLD = new RegExp(`\\bD-(${GONE.join('|')})\\b`);
const HISTORY = /superseded|history|retired|\bwas D-|as amended Oct 18 \(superseded/i;

test('B-217: no open task or live rule cites a superseded tenet', () => {
  const tasks = JSON.parse(fs.readFileSync(path.join(ROOT, 'chart/tasks.json'), 'utf8'));
  const list = Array.isArray(tasks) ? tasks : tasks.tasks || Object.values(tasks);
  const open = list.filter(
    t =>
      t &&
      t.id !== 'B-217' &&
      ['open', 'in progress', 'blocked'].includes(t.status) &&
      OLD.test([t.title, t.dod].join(' '))
  );
  assert.deepEqual(
    open.map(t => t.id),
    []
  );
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'chart/rules.json'), 'utf8'));
  const live = (Array.isArray(rules) ? rules : rules.rules || []).filter(r => !r.ended && OLD.test(JSON.stringify(r)));
  assert.deepEqual(
    live.map(r => r.id),
    []
  );
});

test('B-217: a test or harness names a superseded tenet only as history', () => {
  const dirs = ['test', 'test/harness'];
  const bad = [];
  for (const d of dirs)
    for (const f of fs.readdirSync(path.join(ROOT, d))) {
      if (!/\.(mjs|cjs|js|json)$/.test(f) || f === 'tenet-sweep.test.mjs') continue;
      fs.readFileSync(path.join(ROOT, d, f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (OLD.test(line) && !HISTORY.test(line)) bad.push(`${d}/${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
    }
  assert.deepEqual(bad, []);
});

test('B-217 (D-221, D-214): violet is retired; its old tokens resolve to grey', () => {
  const css = fs.readFileSync(path.join(ROOT, 'page/styles.css'), 'utf8');
  for (const t of ['--violet', '--plum']) assert.match(css, new RegExp(`${t}:var\\(--quiet\\)`), t);
});

test("B-217 (D-221, D-222, D-225): spec.ui.tenets' checks cite the new tenets", () => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
  const checks = JSON.stringify((spec.ui && spec.ui.tenets) || {});
  assert.equal(OLD.test(checks.replace(/[^"]*(superseded|history|was D-)[^"]*/gi, '')), false);
});
