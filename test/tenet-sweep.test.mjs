// B-217: the sweep after four Oct 22 tenets (the layout tenet and three since superseded themselves: the two motion
// tenets by D-271 and the frame-budget tenet (now D-412), swept by B-276 below; the grey interface, itself since retired by D-327) superseded the
// four tenets in GONE. No open task,
// rule or test cites a superseded tenet as current (history may name it, marked as such), and the checks hold to the
// new tenets' words: violet retired, one clock (test/interface-motion.test.mjs), and a 0.16 s settle (the 680 px
// reading cap is retired with D-327).
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

// B-275: the sweep for the grey-interface tenet (since retired by D-327), which took the place of the Oct 22 grey-interface tenet (and of the forget-me-not
// blue and flower decisions; D-266 and D-265). No open task but the
// sweep's own and no test names them except as history, and no old teal, amber, coral or forget-me-not blue hex is
// left in page/ or test/. #F08A78 was dark coral and is now her own dark halftone (D-266), so it is not on the list.
const SWEPT = /\bD-(221|214|212)\b/;
const OLD_HEX = /#(7AA7FF|2B5BD0|3FE0C5|0B2A24|F2B45A|0F766E|9A5800|B83A26)\b/i;
const sources = dirs =>
  dirs.flatMap(d =>
    fs
      .readdirSync(path.join(ROOT, d), { withFileTypes: true })
      .filter(f => f.isFile() && /\.(mjs|cjs|js|json|css|html)$/.test(f.name))
      .map(f => [`${d}/${f.name}`, fs.readFileSync(path.join(ROOT, d, f.name), 'utf8')])
  );

test('B-275: no open task but the sweep, and no test, cites the three superseded colour and avatar ids except as history', () => {
  const tasks = JSON.parse(fs.readFileSync(path.join(ROOT, 'chart/tasks.json'), 'utf8'));
  const list = Array.isArray(tasks) ? tasks : tasks.tasks || Object.values(tasks);
  const open = list.filter(
    t =>
      t &&
      t.id !== 'B-275' &&
      ['open', 'in progress', 'blocked'].includes(t.status) &&
      SWEPT.test([t.title, t.dod].join(' '))
  );
  assert.deepEqual(
    open.map(t => t.id),
    []
  );
  const bad = [];
  for (const [f, text] of sources(['test', 'test/harness']))
    if (f !== 'test/tenet-sweep.test.mjs')
      text.split('\n').forEach((line, i) => {
        if (SWEPT.test(line) && !HISTORY.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
  assert.deepEqual(bad, []);
});

test('B-275: page/ and test/ hold none of the old teal, amber, coral or forget-me-not blue values', () => {
  const bad = sources(['page', 'page/app', 'test', 'test/harness'])
    .filter(([f]) => f !== 'test/tenet-sweep.test.mjs')
    .flatMap(([f, text]) => (text.match(new RegExp(OLD_HEX, 'gi')) || []).map(h => `${f}: ${h}`));
  assert.deepEqual(bad, []);
});

test("B-217 (the tenets since superseded): spec.ui.tenets' checks cite the new tenets", () => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
  const checks = JSON.stringify((spec.ui && spec.ui.tenets) || {});
  assert.equal(OLD.test(checks.replace(/[^"]*(superseded|history|was D-)[^"]*/gi, '')), false);
});

// B-276: the sweep for D-271 and the frame-budget tenet (now D-412), which took the place of the two Oct 22 motion tenets (two clocks, her own a
// stepped one, and a cap on how often she draws). Their ids are written here by number only, so this file cites neither:
// the Chart lint's superseded-tenet check fails any test or open task that names one, once the supersessions are
// recorded. Here: spec.ui.tenets does not name them, and page/ and test/ keep no word of the old stepped clock or its cap.
const MOTION_GONE = new RegExp(`\\bD-(${['230', '224'].join('|')})\\b`);
const HELD = new RegExp(
  [
    'he' + 'ld[- ]?frames?',
    'he' + 'ldFps',
    'minHo' + 'ldFrames',
    'maxRedr' + 'awsPerSec',
    '\\b8 ?fps\\b',
    'eight (drawings|times) a second',
  ].join('|'),
  'i'
);

test("B-276: spec.ui.tenets' checks cite neither superseded motion tenet (the Chart lint covers tests and open tasks)", () => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
  assert.equal(MOTION_GONE.test(JSON.stringify(spec.ui.tenets || {})), false);
});

test('B-276: page/ and test/ keep no word of her old stepped clock or its cap', () => {
  const bad = sources(['page', 'page/app', 'test', 'test/harness']).flatMap(([f, text]) =>
    text
      .split('\n')
      .map((line, i) => (HELD.test(line) ? `${f}:${i + 1}: ${line.trim().slice(0, 120)}` : null))
      .filter(Boolean)
  );
  assert.deepEqual(bad, []);
});
