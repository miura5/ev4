// core/motion.mjs (B-76): history since D-134 and D-135 were superseded (the Dial Arc draws her, D-265; her budget is
// D-272's, spec.ui.look.dialArc.budget). These pin the retired Silk core v2's speech envelope, gesture blend, springs, size steps and step-down,
// driven frame by frame with the spec's own parameters (spec.ui.look.core), and spec.ui.look.core validated.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as MO from '../core/motion.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
const P = spec.ui.look.core;
const FPS = 60,
  DT = 1 / FPS;

// A planted word stream: the canvas's reply pacing (60 ms plus 15 ms a letter, 210 ms after a comma, 400 ms after a
// full stop), with one emphasised word, then speechEnd.
const REPLY =
  'Preload is the *stretch* before the squeeze. More filling, more stretch, a stronger contraction, up to a point. Done. Three preload questions are first in tonight’s review.';
function wordStream() {
  const out = [];
  let at = 0.4;
  for (const raw of REPLY.split(' ')) {
    const emphasis = /^\*.*\*[.,]?$/.test(raw),
      w = raw.replace(/\*/g, '');
    out.push({ at, w, emphasis });
    at += (60 + w.length * 15 + (/[,;:]$/.test(w) ? 210 : 0) + (/[.?!]$/.test(w) ? 400 : 0)) / 1000;
  }
  return { words: out, end: at };
}
function play(seconds, { fps = FPS } = {}) {
  const { words, end } = wordStream();
  const dt = 1 / fps;
  let st = MO.envelopeStart();
  let i = 0;
  const frames = [];
  for (let f = 0; f * dt < seconds; f++) {
    const t = (f + 1) * dt;
    let word = null;
    while (i < words.length && words[i].at <= t) {
      word = Math.max(word || 0, MO.wordVoice(words[i].w, words[i].emphasis, P.speech));
      i++;
    }
    const prev = st;
    st = MO.envelopeStep(st, { talking: t < end, word }, dt, P);
    frames.push({
      t,
      talking: t < end,
      env: st.env,
      talk: st.talk,
      d: Math.abs(MO.envelopeRadius(st.env, P) - MO.envelopeRadius(prev.env, P)),
    });
  }
  return { frames, end, words };
}

test('the envelope moves the outline at most 0.35% of her radius a frame on a planted word stream', () => {
  const { frames } = play(14);
  const worst = Math.max(...frames.map(f => f.d));
  assert.ok(worst <= P.speech.maxStepPctOfRadius / 100 + 1e-12, `worst frame ${(worst * 100).toFixed(4)}% of R`);
  assert.ok(worst > (P.speech.maxStepPctOfRadius / 100) * 0.2, 'the stream actually moves her');
  // At 30 fps a frame is twice as long, and the cap scales with it: never more than 0.35% per 1/60 s.
  const slow = play(14, { fps: 30 }).frames;
  assert.ok(Math.max(...slow.map(f => f.d)) <= (2 * P.speech.maxStepPctOfRadius) / 100 + 1e-12);
});

test('the envelope holds its floor between words and comes to rest after speechEnd', () => {
  const { frames, end } = play(14);
  const S = P.speech,
    mid = frames.filter(f => f.t > 1.5 && f.t < end);
  assert.ok(mid.length > 200);
  for (const f of mid)
    assert.ok(
      f.env >= 0.9 * S.floor * (1 - S.floorWave) * f.talk,
      `env ${f.env.toFixed(3)} under the floor at ${f.t.toFixed(2)} s`
    );
  const after = frames.filter(f => f.t > end + 4);
  assert.ok(after.length > 60);
  for (const f of after) assert.equal(f.env, 0, `still moving at ${f.t.toFixed(2)} s`);
  // At rest she does not creep: once zero it stays zero.
  const firstZero = frames.findIndex(f => f.t > end && f.env === 0);
  assert.ok(firstZero > 0);
  assert.ok(frames.slice(firstZero).every(f => f.env === 0));
});

test('the per-frame cap, and the clamps at 0 and at speech.max, hold when the spring would pass them', () => {
  const S = { ...P.speech, spring: 400 },
    Q = { ...P, speech: S },
    cap = S.maxStepPctOfRadius / 100 / (S.swell * P.body.radius);
  // A stiff spring and a full word: the raw step is far past the cap, so the step is exactly the cap.
  const a = MO.envelopeStep(MO.envelopeStart(), { talking: true, word: 1 }, DT, Q);
  assert.ok(Math.abs(a.env - cap) < 1e-12, `stepped ${a.env}, cap ${cap}`);
  assert.ok(Math.abs(a.envV - cap * FPS) < 1e-9);
  // Falling the same way: never below 0, and at rest it stays 0.
  const down = MO.envelopeStep({ t: 0, talk: 0, vT: 0, env: 0.001, envV: -50 }, { talking: false, word: null }, DT, Q);
  assert.equal(down.env, 0);
  assert.ok(down.envV >= 0);
  // Above speech.max it is held at the max.
  const up = MO.envelopeStep({ t: 0, talk: 1, vT: 5, env: S.max - 1e-6, envV: 50 }, { talking: true, word: null }, DT, {
    ...Q,
    speech: { ...S, maxStepPctOfRadius: 100 },
  });
  assert.equal(up.env, S.max);
  assert.ok(up.envV <= 0);
});

test('each word nudges the swell; an emphasised word nudges it most', () => {
  const S = P.speech;
  assert.equal(MO.wordVoice('stretch', true, S), S.wordVoice.emphasis);
  assert.ok(MO.wordVoice('a', false, S) < MO.wordVoice('contraction', false, S));
  assert.equal(MO.wordVoice('extraordinarily-long-word', false, S), S.wordVoice.max);
  assert.equal(MO.wordVoice('point.', false, S), MO.wordVoice('point', false, S), 'punctuation does not count');
});

test('each gesture settles within its duration: exactly at rest at its end, continuous on the way', () => {
  for (const name of MO.GESTURES) {
    const D = P.gestures[name].durationSec;
    let prev = null,
      moved = 0;
    for (let el = 0; el < D + 0.5; el += DT) {
      const b = MO.gestureBlend(name, el, P, Math.PI);
      if (el >= D) {
        assert.equal(b.done, true, name);
        assert.deepEqual(
          { ...b, done: undefined },
          { len: 1, bright: 0, spin: 0, flow: 1, tint: 0, lean: 0, dx: 0, dy: 0, done: undefined },
          name
        );
      }
      if (prev) {
        for (const k of ['len', 'bright', 'spin', 'flow', 'tint', 'lean', 'dx', 'dy']) {
          const j = Math.abs(b[k] - prev[k]);
          assert.ok(j < 0.12, `${name}.${k} jumps ${j.toFixed(3)} at ${el.toFixed(2)} s`);
          moved = Math.max(moved, Math.abs(b[k] - (k === 'len' || k === 'flow' ? 1 : 0)));
        }
      }
      prev = b;
    }
    assert.ok(moved > 0.02, `${name} does something`);
  }
  // The retired core v2 (history): its coral tint is the error gesture's alone.
  for (const name of MO.GESTURES.filter(n => n !== 'error'))
    for (let el = 0; el < 3; el += 0.05) assert.equal(MO.gestureBlend(name, el, P).tint, 0, name);
  assert.ok(MO.gestureBlend('error', 0.1, P).tint > 0.5);
  assert.throws(() => MO.gestureBlend('wave', 0, P), /unknown gesture/);
});

test('gestures raised together blend and all come to rest', () => {
  const act = [
    { name: 'glance', el: 0.4, angle: 0 },
    { name: 'done', el: 0.5 },
  ];
  const b = MO.blendAll(act, P);
  assert.ok(b.lean > 0 && b.dx > 0);
  assert.equal(b.leanAngle, 0);
  assert.deepEqual(
    MO.blendAll(
      act.map(g => ({ ...g, el: 9 })),
      P
    ),
    { len: 1, bright: 0, spin: 0, flow: 1, tint: 0, lean: 0, dx: 0, dy: 0 }
  );
});

test('a glance takes a direction, an angle or a target point', () => {
  assert.equal(MO.glanceAngle('left'), Math.PI);
  assert.equal(MO.glanceAngle({ direction: 'down' }), Math.PI / 2);
  assert.equal(MO.glanceAngle(1.2), 1.2);
  assert.equal(MO.glanceAngle({ x: 10, y: 0 }, { x: 0, y: 0 }), 0);
  assert.ok(Math.abs(MO.glanceAngle({ x: 0, y: -5 }, { x: 0, y: 0 }) + Math.PI / 2) < 1e-12);
  assert.equal(MO.glanceAngle({ direction: 1.2 }), 1.2);
  assert.equal(MO.glanceAngle({ target: 'up' }), -Math.PI / 2);
  assert.throws(() => MO.glanceAngle('sideways'), /direction/);
});

test('the nucleus leads and the body follows on a soft spring, then both rest on the target', () => {
  let n = { x: 0, y: 0 },
    s = { x: 0, y: 0, vx: 0, vy: 0 };
  const target = { x: 10, y: -4 };
  const r1 = MO.nucleusStep(n, s, target, P.nucleus, DT);
  assert.ok(r1.n.x > r1.s.x, 'the nucleus moves first');
  let over = 0;
  for (let f = 0; f < 600; f++) {
    ({ n, s } = MO.nucleusStep(n, s, target, P.nucleus, DT));
    over = Math.max(over, s.x - 10);
  }
  assert.ok(Math.abs(s.x - 10) < 1e-3 && Math.abs(s.y + 4) < 1e-3 && Math.abs(n.x - 10) < 1e-6);
  assert.ok(over > 0 && over < 2, 'the body overshoots slightly, as a spring does');
  // A long frame (a stall) does not blow the spring up.
  const big = MO.nucleusStep({ x: 0, y: 0 }, { x: 0, y: 0, vx: 0, vy: 0 }, target, P.nucleus, 0.05);
  assert.ok(Number.isFinite(big.s.x) && Math.abs(big.s.x) < 10);
});

test('the critically damped spring never overshoots', () => {
  let x = 0,
    v = 0;
  for (let f = 0; f < 300; f++) {
    ({ x, v } = MO.critSpring(x, v, 1, P.speech.spring, DT));
    assert.ok(x <= 1 + 1e-12);
  }
  assert.ok(Math.abs(x - 1) < 1e-4);
});

test('her size steps (D-122): phone 260 px, desktop 340 px from 1024 px wide (D-159)', () => {
  const Z = P.sizes,
    px = (w, s) => MO.coreSize(w, s, Z).px;
  assert.deepEqual(
    ['idle', 'conversation', 'session', 'list', 'skills'].map(s => px(390, s)),
    [260, 208, 172, 135, 114]
  );
  assert.deepEqual(
    ['idle', 'conversation', 'surface'].map(s => px(1280, s)),
    [340, 272, 238]
  );
  assert.equal(px(1280, 'session'), 238);
  assert.equal(px(390, 'surface'), 135);
  assert.equal(px(390, 'somewhere-else'), 260, 'a state no layout names falls back to idle');
  assert.equal(MO.coreSize(1023, 'idle', Z).layout, 'phone');
  assert.equal(MO.coreSize(1024, 'idle', Z).layout, 'desktop');
});

test('the step-down: more than 10% of frames over 25 ms in a rolling 2 s turns wisps off, then halves the points, and stops there', () => {
  let st = MO.stepDownStart(),
    t = 0;
  const D = P.stepDown;
  assert.deepEqual(
    { w: D.windowSec, ms: D.slowFrameMs, share: D.maxSlowShare },
    { w: 2, ms: 25, share: 0.1 },
    'the retired core v2 step-down (history; D-272 is the budget now)'
  );
  const run = (ms, secs) => {
    for (const end = t + secs * 1000; t < end; t += ms) st = MO.stepDownStep(st, ms, t, P);
  };
  run(14, 5);
  assert.equal(st.level, 0, 'a 14 ms frame never steps down');
  run(16.8, 5);
  assert.equal(st.level, 0, 'the harness vsync floor (16.8 ms) never steps down');
  run(25, 3);
  assert.equal(st.level, 0, 'a frame of exactly 25 ms is not over 25 ms');
  run(300, 3);
  assert.equal(st.level, 0, 'stalls (a hidden tab) are not samples');
  run(30, 2.2);
  assert.equal(st.level, 1);
  assert.deepEqual(D.order.slice(0, st.level), ['wisps']);
  run(30, 1);
  assert.equal(st.level, 1, 'one window between steps');
  run(30, 1.5);
  assert.equal(st.level, 2);
  assert.deepEqual(D.order.slice(0, st.level), ['wisps', 'halfPoints']);
  run(40, 6);
  assert.equal(st.level, 2, 'nothing past half the points: the Silk outline stays');
  // The share decides, not the size of the slow frames: 1 in 12 slow (8%) holds, 1 in 8 (12.5%) steps.
  const mixed = every => {
    let s = MO.stepDownStart(),
      u = 0;
    for (let i = 0; i < 150; i++) {
      u += 16;
      s = MO.stepDownStep(s, i % every === 0 ? 80 : 15, u, P);
    }
    return s.level;
  };
  assert.equal(mixed(12), 0);
  assert.equal(mixed(8), 1);
  assert.equal(MO.slowShare([10, 30, 26, 25], 25), 0.5);
  assert.equal(MO.slowShare([], 25), 0);
  assert.equal(MO.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(MO.percentile([], 95), null);
});

test('spec.ui.look.core (history since D-212): every core v2 parameter, the seven moods, five gestures, its sizes and its budgets', () => {
  const num = (v, where) => assert.ok(typeof v === 'number' && Number.isFinite(v), where + ' is a number');
  const moods = spec.persona.avatar.moods;
  assert.deepEqual(Object.keys(P.moods), moods, 'the seven moods of computeMood, in order');
  const mk = Object.keys(P.moods.idle).sort();
  for (const m of moods) {
    assert.deepEqual(Object.keys(P.moods[m]).sort(), mk, m);
    for (const k of mk) num(P.moods[m][k], `moods.${m}.${k}`);
  }
  for (const [k, c] of Object.entries(P.palette)) {
    assert.equal(c.length, 3, k);
    for (const x of c) assert.ok(Number.isInteger(x) && x >= 0 && x <= 255, k);
  }
  assert.deepEqual(Object.keys(P.palette).sort(), ['a', 'b', 'coral', 'core', 'glow', 'ring', 'spark']);
  assert.equal(P.preset, 'silk');
  assert.equal(P.body.bands, 5, 'five translucent bands');
  assert.ok(
    ['webgl', '2d'].includes(P.renderer),
    'renderer is webgl (2d where WebGL is missing or lost) or 2d (D-134)'
  );
  assert.equal(P.body.renderer, undefined, 'the renderer lives at spec.ui.look.core.renderer');
  assert.ok(P.body.canvasDprMax >= 1 && P.body.canvasDprMax <= 3, 'body.canvasDprMax');
  for (const sec of ['body', 'nucleus', 'speech', 'wisps', 'ripple', 'ring'])
    for (const [k, v] of Object.entries(P[sec]))
      if (typeof v !== 'boolean' && !Array.isArray(v) && typeof v !== 'object') num(v, `${sec}.${k}`);
  for (const k of ['base', 'perChar', 'max', 'emphasis']) num(P.speech.wordVoice[k], 'speech.wordVoice.' + k);
  assert.equal(P.speech.maxStepPctOfRadius, 0.35, 'D-134: at most 0.35% of her radius a frame');
  assert.ok(
    P.wisps.perSecond >= 2.5 && P.wisps.perSecond <= 3.5 && P.wisps.opacity === 0.4,
    'wisps: about 3 a second at 40%'
  );
  assert.deepEqual(P.rubato.glanceEverySec, [5, 11], 'glances every 5 to 11 s');
  assert.deepEqual(Object.keys(P.gestures).sort(), [...MO.GESTURES].sort());
  for (const g of MO.GESTURES) assert.ok(P.gestures[g].durationSec > 0 && P.gestures[g].durationSec <= 3, g);
  assert.deepEqual(P.sizes, {
    phone: { basePx: 260, steps: { idle: 100, conversation: 80, session: 66, list: 52, skills: 44 } },
    desktop: { basePx: 340, minWidthPx: 1024, steps: { idle: 100, conversation: 80, surface: 70 } },
  });
  assert.deepEqual(
    { w: P.stepDown.windowSec, ms: P.stepDown.slowFrameMs, share: P.stepDown.maxSlowShare, o: P.stepDown.order },
    { w: 2, ms: 25, share: 0.1, o: ['wisps', 'halfPoints'] }
  );
  assert.deepEqual(
    { ms: P.frameBudget.slowFrameMs, share: P.frameBudget.maxSlowShare, d: P.frameBudget.p95CoreDrawMs },
    { ms: 25, share: 0.05, d: 8 },
    'the retired core v2 budget (history; D-272 holds her to her own)'
  );
  // The retired core v2's palette (history, not the page's colours): teal and violet, coral for the error.
  assert.deepEqual(P.palette.a, [36, 214, 186]);
  assert.deepEqual(P.palette.b, [150, 96, 255]);
});

test('the page gets EVMotion in core.js, the way it gets EVValidate', async () => {
  const { buildPages } = await import('../tools/build.mjs');
  const { loadSchemas } = await import('../tools/build.mjs');
  const pages = buildPages({ root: ROOT, spec, schemas: loadSchemas(ROOT), release: 'v' + spec.specVersion });
  const core = pages.staging['core.js'];
  assert.match(core, /window\.EVMotion = \{ [^}]*envelopeStep[^}]*gestureBlend[^}]*\}/);
  const g = {};
  new Function('window', core.slice(core.indexOf('// ---- core/motion.mjs')))(g);
  assert.equal(typeof g.EVMotion.coreSize, 'function');
  assert.equal(g.EVMotion.coreSize(390, 'idle', P.sizes).px, 260);
});
