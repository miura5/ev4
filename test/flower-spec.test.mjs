// B-205 (D-212, D-213, D-215, D-223, D-224): her values live once in spec.ui.look.flower; the Silk core is retired in
// place, kept as history until B-206 removes its renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
const F = spec.ui.look.flower;
const MOODS = ['idle', 'listening', 'thinking', 'speaking', 'alert', 'happy', 'sleepy'];
const GESTURES = ['send', 'done', 'error', 'glance', 'settle'];

/** A small schema for the flower: every key present, each of its type and range. */
function problems(f) {
  const out = [];
  const num = (v, at, lo = -Infinity, hi = Infinity) =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? null : out.push(`${at}: ${JSON.stringify(v)}`);
  const keys = (v, at) =>
    Array.isArray(v) && v.every(k => Array.isArray(k) && k.length === 2 && k.every(Number.isFinite))
      ? v.every((k, i) => !i || k[0] >= v[i - 1][0]) || out.push(`${at}: keys out of order`)
      : out.push(`${at}: not [time, value] keys`);
  if (!f) return ['spec.ui.look.flower is missing'];
  if (f.renderer !== 'svg') out.push('renderer: svg (D-212)');
  num(f.shape.petals, 'shape.petals', 5, 5);
  num(f.shape.widthPx, 'shape.widthPx', 1);
  num(f.shape.lengthPx, 'shape.lengthPx', 1, 100);
  num(f.shape.streaks.perPetal, 'shape.streaks.perPetal', 3, 3);
  num(f.hand.seed, 'hand.seed', 0);
  num(f.edges.amount, 'edges.amount', 0, 2.5);
  num(f.depth.tiltStageDeg, 'depth.tiltStageDeg', 15, 60);
  num(f.depth.tiltCornerDeg, 'depth.tiltCornerDeg', 20, 70);
  num(f.clock.heldFps, 'clock.heldFps', 6, 12);
  num(f.view.holdSec, 'view.holdSec', 0, 2);
  num(f.view.toward.firstFrame, 'view.toward.firstFrame', -1, 0);
  num(f.lean.weight, 'lean.weight', 0, 1);
  num(f.speech.minHoldFrames, 'speech.minHoldFrames', 2);
  if (!(f.speech.thresholds.length === 2 && f.speech.thresholds[0] < f.speech.thresholds[1]))
    out.push('speech.thresholds: two, rising');
  for (const p of ['closed', 'open', 'wide']) if (!f.speech.poses[p]) out.push(`speech.poses.${p}`);
  for (const m of MOODS) if (!f.moods[m]) out.push(`moods.${m}`);
  for (const g of GESTURES) {
    if (!f.gestures[g]) {
      out.push(`gestures.${g}`);
      continue;
    }
    num(f.gestures[g].durationSec, `gestures.${g}.durationSec`, 0.2, 3);
    for (const [k, v] of Object.entries(f.gestures[g])) if (/Keys$|^keys$/.test(k)) keys(v, `gestures.${g}.${k}`);
  }
  for (const [k, v] of Object.entries(f.moods))
    for (const [kk, vv] of Object.entries(v)) if (/Keys$/.test(kk)) keys(vv, `moods.${k}.${kk}`);
  for (const t of ['dark', 'light']) if (!/^#[0-9A-F]{6}$/i.test(f.inks.her[t])) out.push(`inks.her.${t}`);
  for (const k of ['phone', 'sidebarNarrow', 'sidebar', 'wide', 'wideTall', 'corner'])
    num(f.sizes[k], `sizes.${k}`, 24, 240);
  num(f.sizes.sessionShare, 'sizes.sessionShare', 0.1, 1);
  num(f.budget.maxSlowSharePct, 'budget.maxSlowSharePct', 0, 100);
  return out;
}

test('B-205: spec.ui.look.flower holds every value her renderer needs, of the right shape', () => {
  assert.deepEqual(problems(F), []);
});

test('B-205: the values the decisions name', () => {
  assert.equal(F.depth.tiltStageDeg, 34);
  assert.equal(F.depth.tiltCornerDeg, 52);
  assert.equal(F.clock.heldFps, 8, 'eight drawings a second (D-212, D-230)');
  assert.equal(F.view.holdSec, 1, 'she holds his eye 1 s (D-223)');
  assert.deepEqual(F.view.facing, ['listening', 'speaking', 'alert', 'happy']);
  assert.equal(F.speech.minHoldFrames, 2, 'each speech pose held two frames at least (D-215)');
  assert.deepEqual(F.inks.her, { dark: '#7AA7FF', light: '#2B5BD0' }, 'her blue (D-214)');
  const z = F.sizes;
  assert.deepEqual(
    [z.phone, z.sidebarNarrow, z.sidebar, z.wide, z.wideTall, z.sessionShare, z.corner, z.foldBelowHeightPx],
    [104, 112, 128, 140, 168, 0.7, 24, 560],
    'D-213'
  );
  assert.deepEqual(
    [F.budget.speechSec, F.budget.dpr, F.budget.cpuThrottle, F.budget.slowFrameMs, F.budget.maxSlowSharePct],
    [10, 3, 4, 25, 5],
    'D-224'
  );
});

test('B-205: a planted bad value fails the schema', () => {
  const bad = JSON.parse(JSON.stringify(F));
  bad.clock.heldFps = 60;
  delete bad.moods.sleepy;
  bad.gestures.done.turnKeys = [
    [1, 0],
    [0, 1],
  ];
  const p = problems(bad);
  assert.ok(
    p.some(x => /heldFps/.test(x)) && p.some(x => /moods\.sleepy/.test(x)) && p.some(x => /out of order/.test(x)),
    p.join('; ')
  );
});

test('B-205: the Silk core is retired in place and kept as history', () => {
  assert.match(spec.ui.look.core.retired, /B-205 \(D-212\)/);
  assert.equal(spec.ui.look.core.renderer, 'webgl', 'its values are kept');
});
