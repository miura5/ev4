// E.V. core v2's motion as pure functions (B-76; D-134, D-135). The page's core engine draws; these decide how she
// moves: the springs her body follows, the speech envelope streamed words drive, the gesture blend, the size steps of
// D-122 and the run-time step-down. No imports, no DOM, no clock and no randomness: every function returns its next
// state from its inputs, so core tests can drive them frame by frame. Every parameter comes from spec.ui.look.core
// (passed in as P); nothing here is a tuning constant of its own. The build appends this file to the page's core.js
// as window.EVMotion, the way it appends core/validate.mjs.

/** Exponential approach: x moves toward target at `rate` per second; frame-rate independent. */
export function smooth(x, target, rate, dt) { return x + (target - x) * (1 - Math.exp(-rate * dt)); }

/** One step of a critically damped spring of angular frequency w, solved exactly (no overshoot, stable at any dt). */
export function critSpring(x, v, target, w, dt) {
  const c1 = x - target, c2 = v + w * c1, e = Math.exp(-w * dt);
  return { x: target + (c1 + c2 * dt) * e, v: (c2 - w * (c1 + c2 * dt)) * e };
}

/**
 * The nucleus leads and the body follows on a soft spring (spec nucleus: follow, stiffness, damping). n is the
 * nucleus offset {x, y}, s the body offset {x, y, vx, vy}, target where the nucleus is headed. Steps above 1/60 s are
 * split so the semi-implicit integration stays stable on a slow frame.
 */
export function nucleusStep(n, s, target, N, dt) {
  const nx = smooth(n.x, target.x, N.follow, dt), ny = smooth(n.y, target.y, N.follow, dt);
  let { x, y, vx, vy } = s; const steps = Math.max(1, Math.ceil(dt * 60)), h = dt / steps;
  for (let i = 0; i < steps; i++) {
    vx += ((nx - x) * N.stiffness - vx * N.damping) * h; vy += ((ny - y) * N.stiffness - vy * N.damping) * h;
    x += vx * h; y += vy * h;
  }
  return { n: { x: nx, y: ny }, s: { x, y, vx, vy } };
}

/** How hard one streamed word nudges the swell (spec speech.wordVoice). */
export function wordVoice(word, emphasis, S) {
  const W = S.wordVoice; if (emphasis) return W.emphasis;
  return Math.min(W.max, W.base + String(word || '').replace(/[^\p{L}\p{N}]/gu, '').length * W.perChar);
}

/** The radius fraction the body's outline moves for an envelope value (the bands open by speech.swell). */
export function envelopeRadius(env, P) { return env * P.speech.swell * P.body.radius; }

export function envelopeStart() { return { t: 0, talk: 0, vT: 0, env: 0, envV: 0 }; }

/**
 * One frame of the speech envelope (D-134): each streamed word nudges a target over a low floor that holds while she
 * talks; the swell follows on a critically damped spring and never moves the outline more than
 * speech.maxStepPctOfRadius of her radius in a 60 fps frame (scaled by dt on slower frames). input: {talking, word}
 * where word is a wordVoice value or null. Returns the next state; envelopeRadius(state.env, P) is the outline offset.
 */
export function envelopeStep(st, input, dt, P) {
  const S = P.speech, t = st.t + dt;
  const talk = smooth(st.talk, input.talking ? 1 : 0, S.talkRate, dt);
  let vT = st.vT * Math.exp(-S.decay * dt);
  if (input.word != null) vT = Math.max(vT, input.word * S.wordGain);
  vT = Math.max(vT, S.floor * talk * (1 + S.floorWave * Math.sin(t * S.floorWaveRate)));
  const sp = critSpring(st.env, st.envV, vT, S.spring, dt);
  const cap = (S.maxStepPctOfRadius / 100) / (S.swell * P.body.radius) * dt * 60;
  let env = sp.x, envV = sp.v;
  if (Math.abs(env - st.env) > cap) { env = st.env + Math.sign(env - st.env) * cap; envV = dt > 0 ? (env - st.env) / dt : 0; }
  if (env < 0) { env = 0; envV = Math.max(0, envV); }
  if (env > S.max) { env = S.max; envV = Math.min(0, envV); }
  if (!input.talking && talk < 1e-4 && vT < 1e-4 && env < 1e-4) { env = 0; envV = 0; }
  return { t, talk, vT, env, envV };
}

const IDENTITY = Object.freeze({ len: 1, bright: 0, spin: 0, flow: 1, tint: 0, lean: 0, dx: 0, dy: 0 });
export const GESTURES = ['send', 'done', 'error', 'glance', 'settle'];
const smoothstep = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

/**
 * The gesture blend: what one gesture does to her `el` seconds after it was raised. len scales the body, bright and
 * spin add, flow scales the bands' drift, tint mixes toward coral (error only), lean leans her toward `angle`, and dx,
 * dy move the nucleus in units of her radius (the body follows on its spring). A window closes every deviation over
 * the last fifth of the gesture's duration (spec gestures.<name>.durationSec), so at its end she is exactly at rest:
 * done is true and the values are IDENTITY.
 */
export function gestureBlend(name, el, P, angle = 0) {
  const G = (P.gestures || {})[name]; if (!G) throw new Error('unknown gesture ' + name);
  const D = G.durationSec; if (el >= D) return { ...IDENTITY, done: true };
  const x = Math.max(0, el), w = 1 - smoothstep(D * .8, D, x);
  const o = { ...IDENTITY };
  if (name === 'send') { o.len = 1 + .1 * Math.exp(-x * 5); o.bright = .22 * Math.exp(-x * 4); o.dy = .05 * Math.sin(Math.min(1, x / .6) * Math.PI); }
  else if (name === 'done') {
    o.len = x < .42 ? 1 - .2 * Math.sin(Math.PI * x / .42) : x < 1.1 ? 1 + .08 * Math.sin(Math.PI * (x - .42) / .68) : 1;
    o.bright = x >= .42 ? .3 * Math.exp(-(x - .42) * 2.5) * Math.min(1, (x - .42) / .06) : 0; o.dy = .07 * Math.sin(x * Math.PI * 3) * Math.exp(-x * 2);
  } else if (name === 'error') {
    const a = x < .08 ? x / .08 : 1;
    o.len = 1 - .26 * Math.exp(-x * 3) * a; o.spin = .8 * Math.exp(-x * 3); o.tint = Math.exp(-x * 1.5); o.bright = -.2 * Math.exp(-x * 2);
    o.dy = -.07 * Math.exp(-x * 4) * a; o.dx = .03 * Math.sin(x * 40) * Math.exp(-x * 5);
  } else if (name === 'glance') {
    o.lean = .85 * Math.min(1, x / .25) * (x > 1.1 ? Math.max(0, 1 - (x - 1.1) / .5) : 1);
    const env = Math.min(1, x / .35) * (x > 1.6 ? Math.max(0, 1 - (x - 1.6) / .6) : 1);
    o.dx = Math.cos(angle) * .14 * env; o.dy = Math.sin(angle) * .14 * env;
  } else if (name === 'settle') {
    const u = Math.min(1, x / .7), v = Math.min(1, Math.max(0, x - .7) / 1.5);
    o.len = 1 + .06 * Math.sin(Math.PI * u) - .06 * Math.sin(Math.PI * v); o.bright = .15 * Math.sin(Math.PI * u);
    o.flow = 1 - .5 * Math.sin(Math.PI * v); o.dy = .04 * Math.sin(Math.min(1, x / 2.2) * Math.PI);
  }
  for (const k of ['len', 'flow']) o[k] = 1 + (o[k] - 1) * w;
  for (const k of ['bright', 'spin', 'tint', 'lean', 'dx', 'dy']) o[k] *= w;
  return { ...o, done: false };
}

/** Several gestures at once (a done raised while a glance runs): lengths and flows multiply, the rest add. */
export function blendAll(active, P) {
  const o = { ...IDENTITY };
  for (const g of active) {
    const b = gestureBlend(g.name, g.el, P, g.angle || 0);
    o.len *= b.len; o.flow *= b.flow; o.bright += b.bright; o.spin += b.spin; o.tint = Math.max(o.tint, b.tint);
    o.lean = Math.max(o.lean, b.lean); o.dx += b.dx; o.dy += b.dy; if (b.lean > 0) o.leanAngle = g.angle || 0;
  }
  return o;
}

/** A glance's direction in radians: 'left', 'right', 'up', 'down', an angle, or a target point seen from `from`. */
export function glanceAngle(detail, from) {
  if (typeof detail === 'number' && Number.isFinite(detail)) return detail;
  const d = detail && typeof detail === 'object' && !('x' in detail) ? (detail.direction ?? detail.target) : detail;
  if (typeof d === 'number' && Number.isFinite(d)) return d;
  const named = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
  if (typeof d === 'string' && d in named) return named[d];
  if (d && typeof d === 'object' && Number.isFinite(d.x) && Number.isFinite(d.y) && from) return Math.atan2(d.y - from.y, d.x - from.x);
  throw new Error('a glance needs a direction (left, right, up, down or an angle) or a target point');
}

/**
 * Her size for the stage (D-122): phone steps below sizes.desktop.minWidthPx, desktop steps from it. state is idle,
 * conversation, session, list (a list surface open), skills (the skills runner) or surface; a step a layout does not
 * name falls back to the nearest it does (desktop: any surface, session, list or skills is the surface step; phone: a
 * surface is the list step). Returns {px, pct, layout}.
 */
export function coreSize(width, state, Z) {
  const desk = width >= Z.desktop.minWidthPx, L = desk ? Z.desktop : Z.phone;
  const map = desk ? { session: 'surface', list: 'surface', skills: 'surface' } : { surface: 'list' };
  const key = L.steps[state] != null ? state : map[state] && L.steps[map[state]] != null ? map[state] : 'idle';
  const pct = L.steps[key]; return { px: Math.round(L.basePx * pct / 100), pct, layout: desk ? 'desktop' : 'phone', step: key };
}

/** The p-th percentile (0 to 100) of a list of numbers, nearest rank; null for an empty list. */
export function percentile(xs, p) {
  if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p / 100 * s.length) - 1))];
}

export function stepDownStart() { return { level: 0, samples: [], lastStepAt: null }; }

/**
 * The run-time step-down (D-135): frame times over a rolling stepDown.windowSec; when a full window's p95 passes
 * stepDown.p95Ms the level rises by one (stepDown.order: wisps off, then half the points; the Silk outline is never
 * dropped), then waits a window before it can rise again. A frame longer than stepDown.ignoreAboveMs (a hidden tab,
 * a page stall) is not a sample. level names the steps taken: stepDown.order.slice(0, level).
 */
export function stepDownStep(st, frameMs, nowMs, P) {
  const D = P.stepDown, win = D.windowSec * 1000;
  if (!(frameMs >= 0) || frameMs > D.ignoreAboveMs) return st;
  const samples = [...st.samples, [nowMs, frameMs]].filter(([t]) => nowMs - t <= win);
  const full = samples.length > 1 && nowMs - samples[0][0] >= win * .9;
  const ready = st.lastStepAt == null || nowMs - st.lastStepAt >= win;
  if (full && ready && st.level < D.order.length && percentile(samples.map(s => s[1]), 95) > D.p95Ms) return { level: st.level + 1, samples: [], lastStepAt: nowMs };
  return { ...st, samples };
}
