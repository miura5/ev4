// B-205 (D-213): her stage sizes live once in spec.ui.look.flower, with her frame budget (D-272). The forget-me-not's
// drawing values are history: B-275 (D-270) took out its inks, and B-276 (D-271, D-272) the rest with its clock, since the
// Dial Arc draws her (D-265). The Silk core is retired in place, kept as history.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
const F = spec.ui.look.flower;

/** A small schema for what is still read: her stage sizes and her budget, each of its type and range. */
function problems(f) {
  const out = [];
  const num = (v, at, lo = -Infinity, hi = Infinity) =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? null : out.push(`${at}: ${JSON.stringify(v)}`);
  if (!f) return ['spec.ui.look.flower is missing'];
  for (const k of ['phone', 'sidebarNarrow', 'sidebar', 'wide', 'wideTall', 'corner'])
    num(f.sizes[k], `sizes.${k}`, 24, 240);
  num(f.sizes.sessionShare, 'sizes.sessionShare', 0.1, 1);
  num(f.sizes.foldBelowHeightPx, 'sizes.foldBelowHeightPx', 0);
  num(f.budget.maxSlowSharePct, 'budget.maxSlowSharePct', 0, 100);
  num(f.budget.slowFrameMs, 'budget.slowFrameMs', 1);
  num(f.budget.idleRedraws, 'budget.idleRedraws', 0, 0);
  return out;
}

test('B-205: spec.ui.look.flower holds her stage sizes and budget, of the right shape', () => {
  assert.deepEqual(problems(F), []);
  assert.deepEqual(Object.keys(F).sort(), ['_', 'budget', 'sizes'], 'B-276: only what the page and the harness read');
});

test('B-205: the values the decisions name', () => {
  const z = F.sizes;
  assert.deepEqual(
    [z.phone, z.sidebarNarrow, z.sidebar, z.wide, z.wideTall, z.sessionShare, z.corner, z.foldBelowHeightPx],
    [104, 112, 128, 140, 168, 0.7, 24, 560],
    'D-213'
  );
  assert.deepEqual(
    [F.budget.speechSec, F.budget.dpr, F.budget.cpuThrottle, F.budget.slowFrameMs, F.budget.maxSlowSharePct],
    [10, 3, 4, 25, 5],
    'D-272'
  );
  assert.equal(F.budget.idleRedraws, 0, 'D-272: an idle Dial Arc draws no frame');
  assert.deepEqual(
    Object.keys(F.budget).sort(),
    ['_', 'cpuThrottle', 'dpr', 'idleRedraws', 'idleSec', 'maxSlowSharePct', 'slowFrameMs', 'speechSec', 'viewport'],
    'D-272: the measure stays, and nothing else'
  );
});

test('B-205: a planted bad value fails the schema', () => {
  const bad = JSON.parse(JSON.stringify(F));
  bad.sizes.phone = 10;
  bad.budget.idleRedraws = 3;
  const p = problems(bad);
  assert.ok(p.some(x => /sizes\.phone/.test(x)) && p.some(x => /idleRedraws/.test(x)), p.join('; '));
});

test('B-205: the Silk core is retired in place and kept as history', () => {
  assert.match(spec.ui.look.core.retired, /B-205 \(D-212\)/);
  assert.equal(spec.ui.look.core.renderer, 'webgl', 'its values are kept');
});
