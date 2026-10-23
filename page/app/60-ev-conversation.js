    // ------------------------------------------------------------ E.V. (the conversation)
    // The thread is talk/<date> docs (append-only message maps). The greeting is computed by E.V. core
    // on each open and never stored. Replies come from `sample` with page tools; anything bigger than a
    // reply becomes a jobs/<id> doc and fires the worker task through the Claude Code Remote connector.
    const P = EV_SPEC.persona || {};
    const KINDS = (EV_SPEC.jobs && EV_SPEC.jobs.kinds) || {};
    const TASKS = {
      worker: (EV_SPEC.worker && EV_SPEC.worker.trigger) || null, // B-161: the one task the page fires, by id
      builder: (EV_SPEC.builder && EV_SPEC.builder.trigger) || null, // B-180 (D-194): a build ask's task, by id
      jobText: 'Job {id}',
    };
    const STAGING = EV_SPEC.target === 'staging';
    // B-182: the builder's asks (a build ask, a Your turn reply) only where the builder can read the job's record.
    const BUILDER_HERE = STAGING || !!(EV_SPEC.jobs && EV_SPEC.jobs.builderOnLive);
    const T = {
      ytArmed: null, // the Your turn reply waiting on Send
      replied: new Map(), // B-182: task id -> what he sent from Your turn, until system/yourturn is rewritten
      greet: null,
      local: new Map(),
      els: new Map(),
      expanded: false,
      busy: false,
      ctl: null,
      created: new Set(),
      sampleOff: null,
      noTools: false,
      scrollTo: null,
      firstScroll: false,
      retry: new Map(),
      summarizing: false,
      posted: new Set(),
      seps: new Map(),
      earlier: null,
      waking: null,
      ticked: new Set(),
      retrying: new Set(), // B-200: jobs whose Try again was tapped and whose write has not landed yet
      uploads: new Map(),
      reading: false,
    };
    let talkQ = Promise.resolve();
    let lastStamp = '';
    // ------------------------------------------------------------ Her: the 2D forget-me-not (B-206; D-212, D-215, D-223)
    // One flat SVG per place she shows (her stage, the top bar, a message), every one the same drawing (D-223). Each pose
    // is a flat drawing: to tip her away the plane squashes, her eye lifts, the near petals shorten and the far ones
    // shade. She moves on one held clock, spec.ui.look.flower.clock.heldFps drawings a second (D-222): a drawing is made
    // only on a new held frame and only when its pose differs from the last, so a still idle draws nothing but the
    // falling petal (D-224). Every value is spec.ui.look.flower; the page talks to her through CORE.setMood, CORE.gesture,
    // CORE.speak, CORE.speechEnd and CORE.setRing (also EVApp.core), as it did to the Silk core it replaced (D-134).
    let MOOD_NOW = 'idle';
    const CORE = (() => {
      const F = (EV_SPEC.ui && EV_SPEC.ui.look && EV_SPEC.ui.look.flower) || null;
      if (!F) throw new Error('her renderer needs spec.ui.look.flower');
      const SVG = 'http://www.w3.org/2000/svg';
      const FPS = F.clock.heldFps;
      const MOODS = Object.keys(F.moods);
      const FACE = new Set(F.view.facing);
      const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const cl = x => Math.max(0, Math.min(1, x));
      const eIO = x => 0.5 - 0.5 * Math.cos(Math.PI * cl(x));
      const eOut = (x, p) => 1 - Math.pow(1 - cl(x), p);
      const backOut = (x, c) => {
        const y = cl(x) - 1;
        return 1 + (c + 1) * y * y * y + c * y * y;
      };
      const trk = (keys, t) => {
        if (t <= keys[0][0]) return keys[0][1];
        for (let i = 1; i < keys.length; i++) {
          const [t1, v1] = keys[i],
            [t0, v0] = keys[i - 1];
          if (t <= t1) return v0 + (v1 - v0) * eIO((t - t0) / (t1 - t0));
        }
        return keys[keys.length - 1][1];
      };
      const hash1 = n => {
        const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
      };
      const r3 = v => Math.round(v * 1000) / 1000;
      const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
      const RNG = seed => () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };

      // ---- the drawing: five petals, their streaks and the eye, made once from the seed (the hand's wobble included)
      const S = F.shape,
        H = F.hand;
      const PROF = {
        disc: t => Math.pow(Math.max(0, 1 - Math.pow((t - 0.55) / 0.55, 2)), 0.5),
      };
      function curve(P) {
        let d = `M${f1(P[0][0])} ${f1(P[0][1])}`;
        for (let i = 0; i < P.length - 1; i++) {
          const p0 = P[i - 1] || P[i],
            p1 = P[i],
            p2 = P[i + 1],
            p3 = P[i + 2] || p2;
          d += ` C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
        }
        return d + 'Z';
      }
      function petalBase(rnd, h) {
        const off = [];
        for (let k = 0; k < 40; k++) off.push([(rnd() - 0.5) * H.offsetPx * h, (rnd() - 0.5) * H.offsetPx * h]);
        return {
          off,
          wm: 1 + (rnd() - 0.5) * H.widthJitter * h,
          lm: 1 + (rnd() - 0.5) * H.lengthJitter * h,
          ts: (rnd() - 0.5) * H.tipLeanDeg * h,
          rr: [(rnd() - 0.5) * 3 * h, (rnd() - 0.5) * 3 * h],
        };
      }
      function petalPath(b, rnd, amp) {
        const N = H.curvePoints,
          W = S.widthPx * b.wm,
          len = S.lengthPx * b.lm,
          top = 100 - len,
          ts = b.ts;
        const j = k => [b.off[k][0] + (rnd() - 0.5) * 2 * amp, b.off[k][1] + (rnd() - 0.5) * 2 * amp];
        const left = [],
          right = [];
        for (let k = 1; k < N; k++) {
          const t = k / N,
            w = W * PROF[S.profile](t),
            y = 100 - len * t,
            lean = ts * t * t,
            jl = j(k),
            jr = j(N + k);
          left.push([30 - w + lean + jl[0], y + jl[1]]);
          right.push([30 + w + lean + jr[0], y + jr[1]]);
        }
        const jt = j(2 * N);
        return curve([[30, 100], ...left, [30 + ts + jt[0] * 0.4, top - 1.5], ...right.reverse(), [30, 100]]);
      }
      const circ = (cx, cy, r) =>
        `M${f1(cx - r)} ${f1(cy)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`;
      function eyeOf(rnd, h) {
        const J = () => (rnd() - 0.5) * 0.8 * h,
          E = S.eyeRing,
          P = [];
        for (let i = 0; i < 40; i++) {
          const a = (i / 40) * Math.PI * 2 - Math.PI / 2,
            r = E.radius * (1 + E.bumpAmp * Math.cos(E.bumps * (a + Math.PI / 2))) + J() * 0.4;
          P.push([20 + Math.cos(a) * r, 20 + Math.sin(a) * r]);
        }
        return {
          ring: 'M' + P.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L') + 'Z' + circ(20, 20, E.hole),
          core: circ(20 + J() * 0.3, 20 + J() * 0.3, E.core),
        };
      }
      function streaks(b, rnd, h) {
        const T = S.streaks;
        const one = (dx, ang, len, w) => {
          const x0 = 30 + dx,
            y0 = T.fromY,
            a = ang + (rnd() - 0.5) * 0.16 * h,
            L = len * (1 + (rnd() - 0.5) * 0.24 * h);
          const tx = x0 + Math.sin(a) * L + b.ts * 0.25,
            ty = y0 - Math.cos(a) * L,
            mx = (x0 + tx) / 2,
            my = (y0 + ty) / 2;
          return `M${f1(x0 - w)} ${f1(y0)} Q${f1(mx - w * 0.55)} ${f1(my)} ${f1(tx)} ${f1(ty)} Q${f1(mx + w * 0.55)} ${f1(my)} ${f1(x0 + w)} ${f1(y0)}Z`;
        };
        return (
          one(0, 0, T.mainLen, T.mainWidth) +
          one(-T.sideOffset, -T.sideAngleRad, T.sideLen, T.sideWidth) +
          one(T.sideOffset, T.sideAngleRad, T.sideLen, T.sideWidth)
        );
      }
      function build(small) {
        const h = H.amount,
          rnd = RNG(H.seed),
          petals = [],
          hh = small ? h * H.smallHandScale : h;
        for (let i = 0; i < S.petals; i++) {
          const b = petalBase(rnd, hh),
            amp = small ? 0 : H.boilAmpBase + h * H.boilAmpPerHand;
          petals.push({
            r: i * S.spreadDeg + (i ? (rnd() - 0.5) * S.pinwheelJitterDeg * hh : 0),
            s: 1 + (rnd() - 0.5) * S.sizeJitter * hh,
            d: [petalPath(b, rnd, 0), petalPath(b, rnd, amp), petalPath(b, rnd, amp)],
            vein: streaks(b, rnd, hh),
          });
        }
        return { petals, eye: eyeOf(rnd, hh), fall: petalPath(petalBase(rnd, hh), rnd, 0) };
      }
      const SHAPES = { l: build(false), s: build(true) };

      // ---- the clock and the pose: shared signals, then each flower's own view (she turns on her own time per place)
      const sig = { mood: 'idle', talking: false, voice: 0, voiceAt: 0, g: null, gAt: 0, gid: 0, ring: -1 };
      const log = [];
      const note = (kind, name, detail) => {
        log.push({ at: Date.now(), kind, name, ...(detail != null ? { detail } : {}) });
        if (log.length > 200) log.shift();
      };
      const newGroup = () => ({
        mood: 'idle',
        g: null,
        gT0: 0,
        mT0: 0,
        vw: { from: 1, to: 1, t0: -9 },
        lastFace: null,
        sp: { lv: 1, t: -9 },
      });
      const viewTarget = (G, tq, hold) => {
        if (FACE.has(G.mood) || (G.g === 'error' && F.view.faceOnError)) return 0;
        if (G.mood !== 'sleepy' && G.lastFace != null && tq - G.lastFace < hold) return 0;
        return G.mood === 'sleepy' ? F.view.sleepyView : F.view.awayView;
      };
      // A turn to face him holds the first frame a hair the wrong way, then eases round past and back; a turn away holds
      // the first frame, then eases out (the listening -> idle technique of the canvas).
      function vAt(vw, tq) {
        const toward = vw.to < vw.from,
          C = toward ? F.view.toward : F.view.away,
          n = Math.max(C.minFrames, Math.round(C.framesPerSec * FPS)),
          i = Math.round((tq - vw.t0) * FPS);
        if (i < 0) return vw.from;
        if (i >= n) return vw.to;
        const c = i === 0 ? C.firstFrame : toward ? backOut(i / (n - 1), C.overshoot) : eOut(i / (n - 1), C.power);
        return vw.from + (vw.to - vw.from) * c;
      }
      const GD = name => F.gestures[name].durationSec;
      function step(G, tq, mood, g, amp) {
        if (mood !== G.mood) {
          G.mood = mood;
          G.mT0 = tq;
        }
        if (g !== G.g) {
          G.g = g;
          G.gT0 = tq;
        }
        if (FACE.has(mood) || g === 'error') G.lastFace = tq;
        const tgt = viewTarget(G, tq, F.view.holdSec);
        if (tgt !== G.vw.to) G.vw = { from: vAt(G.vw, tq), to: tgt, t0: tq };
        const [lo, hi] = F.speech.thresholds;
        const lv = mood === 'speaking' ? (amp < lo ? 0 : amp < hi ? 1 : 2) : 1;
        if (lv !== G.sp.lv && tq - G.sp.t >= F.speech.minHoldFrames / FPS - 1e-6) {
          G.sp = { lv, t: tq };
          (G.spLog || (G.spLog = [])).push([Math.round(tq * FPS), lv]);
          if (G.spLog.length > 200) G.spLog.shift();
        }
      }
      const POSES = [F.speech.poses.closed, F.speech.poses.open, F.speech.poses.wide];
      function pose(G, tq, rm, gl) {
        const el = tq - G.mT0,
          ge = tq - G.gT0,
          m = G.mood,
          g = rm ? (G.g === 'error' ? 'error' : null) : G.g,
          M = F.moods;
        const o = {
          // Reduced motion: the end state of the turn, no hold: facing him when she attends, else tipped away.
          v: rm
            ? FACE.has(m) || g === 'error'
              ? 0
              : m === 'sleepy'
                ? F.view.sleepyView
                : F.view.awayView
            : vAt(G.vw, tq),
          h: 0,
          rot: 0,
          rs: 1,
          sx: 1,
          sy: 1,
          bob: 0,
          es: 1,
          eyeOp: 1,
          err: false,
          len: [1, 1, 1, 1, 1],
          wid: [1, 1, 1, 1, 1],
          hi: -1,
          fall: -1,
          sleepy: m === 'sleepy',
        };
        const each = f => {
          for (let i = 0; i < 5; i++) f(i);
        };
        if (m === 'alert' && M.alert.topPetal) o.hi = 0;
        if (m === 'sleepy') {
          each(i => {
            o.len[i] *= M.sleepy.len;
            o.wid[i] *= M.sleepy.wid;
          });
          o.bob = M.sleepy.bob;
          o.eyeOp = M.sleepy.eye;
        }
        if (!rm) {
          if (m === 'thinking') {
            const T = M.thinking,
              b = Math.floor(el / T.beatSec),
              x = el / T.beatSec - b;
            o.rot = T.stepDeg * (b + (x < T.holdShare ? 0 : eIO((x - T.holdShare) / (1 - T.holdShare))));
            o.v += T.sway * Math.sin((el * Math.PI * 2) / T.swaySec);
          }
          if (m === 'listening') {
            const T = M.listening;
            o.rs = T.scale;
            each(i => (o.len[i] *= 1 + T.breathe * Math.sin((el * Math.PI * 2) / T.breatheSec - i * T.phasePerPetal)));
          }
          if (m === 'happy') {
            const T = M.happy,
              c = el % T.cycleSec,
              n = Math.floor(el / T.cycleSec),
              hop = u => trk(T.hopKeys, u);
            o.rot = 144 * n + (c < T.hopSec ? hop(c) : c < 2 * T.hopSec ? 72 + hop(c - T.hopSec) : 144);
            if (c < 2 * T.hopSec) {
              const u = c % T.hopSec;
              o.sx = trk(T.squashKeys, u);
              o.sy = trk(T.stretchKeys, u);
            }
          }
          if (m === 'alert') {
            const T = M.alert,
              c = el % T.cycleSec,
              K = T.flickKeys;
            o.len[0] *= 1 - T.flick * trk([...K, [T.cycleSec, 0]], c);
            o.eyeOp = (c > K[1][0] && c < K[2][0]) || (c > K[3][0] && c < K[4][0]) ? T.eyeDim : 1;
          }
          if (m === 'sleepy') o.rs = 1 - M.sleepy.breathe * (Math.floor(el / M.sleepy.breatheSec) % 2);
          if (m === 'speaking') {
            const s = POSES[G.sp.lv] || {};
            o.rs *= s.scale ?? 1;
            o.es *= s.eye ?? 1;
            o.bob += s.bob ?? 0;
            each(i => {
              o.len[i] *= s.len ?? 1;
              o.wid[i] *= s.wid ?? 1;
            });
          }
          if (m === 'idle' && !g && M.idle.fallingPetal) {
            const P = M.idle.fallingPetal,
              u = el - P.afterSec;
            if (u >= 0 && u % P.everySec < P.forSec) o.fall = u % P.everySec;
          }
        }
        if (g && ge < GD(g)) {
          const X = F.gestures[g];
          if (g === 'send') {
            o.v -= X.viewDip * trk(X.viewKeys, ge);
            each(i => (o.len[i] *= 1 + X.petalSwell * trk(X.swellKeys, ge - (i * X.staggerFrames) / FPS)));
          }
          if (g === 'done') {
            o.rot += trk(X.turnKeys, ge);
            o.rs *= trk(X.scaleKeys, ge);
          }
          if (g === 'error') {
            o.err = true;
            if (!rm) {
              const d = trk(X.depthKeys, ge);
              o.v -= X.viewDip * d;
              o.bob += X.bow * d;
              o.rot += trk(X.shakeKeys, ge);
              each(i => (o.len[i] *= 1 - X.shrink * d));
            }
          }
          if (g === 'glance') o.h = trk(X.keys, ge) * (gl || 1);
          if (g === 'settle') {
            const d = trk(X.keys, ge);
            o.v += X.viewAway * d;
            o.rs *= 1 - X.shrink * d;
          }
        }
        return o;
      }

      // ---- one flower in the page: its SVG, made once; a drawing sets transforms, classes and paths on it
      const zoneOf = px => (px <= 32 ? 's' : px <= 64 ? 'm' : 'l');
      let uid = 0;
      function makeSvg(id) {
        const svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('viewBox', '-100 -100 200 200');
        svg.setAttribute('class', 'fl');
        svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML =
          `<defs><linearGradient id="${id}-g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" class="s0"/><stop offset="0.36" class="s0"/><stop offset="0.6" class="s1"/><stop offset="1" class="s1"/></linearGradient>` +
          `<clipPath id="${id}-c" clipPathUnits="userSpaceOnUse"><rect x="-100" y="-100" width="130" height="300"/></clipPath></defs>` +
          `<g class="fall"><path class="fpet"/></g><g class="root">` +
          [0, 1, 2, 3, 4, 5]
            .map(
              k =>
                `<g class="p"${k === 5 ? ` clip-path="url(#${id}-c)"` : ''}><path class="pet" fill="url(#${id}-g)"/><path class="shade"/><path class="vein"/><path class="edge"/></g>`
            )
            .join('') +
          `<g class="eye"><path class="ering" fill-rule="evenodd"/><path class="ecore"/></g></g>`;
        return svg;
      }
      function draw(o, z, fl, fi, lean, moving, boil, svg, ringOn, ringP) {
        const D = F.depth,
          tilt = z === 's' ? D.tiltCornerDeg : z === 'm' ? (D.tiltStageDeg + D.tiltCornerDeg) / 2 : D.tiltStageDeg;
        const kMin = Math.cos((tilt * Math.PI) / 180),
          dep = D.amount,
          av = Math.abs(o.v),
          dir = o.v < 0 ? -1 : 1;
        let k = Math.max(D.minSquash, 1 - av * (1 - kMin)),
          kx = 1 - D.glanceSquashX * Math.abs(o.h);
        const T = 1 - k,
          facing = av < 0.02 && !o.h;
        const jr = moving ? (hash1(fi) - 0.5) * F.clock.jitterDeg : 0,
          jk = moving ? (hash1(fi + 7) - 0.5) * F.clock.jitterSquash : 0;
        const LN = F.lean,
          ln = facing ? lean : [0, 0];
        kx *= 1 - (LN.squashPct / 100) * Math.abs(ln[0]) * LN.weight;
        k *= 1 - (LN.squashPct / 100) * Math.abs(ln[1]) * LN.weight;
        const eyeY = -dir * T * D.eyeLift * dep,
          cy = -eyeY * D.coreShift;
        const ex = 10 * o.h + ln[0] * LN.eyePx[0] * LN.weight,
          ey = eyeY + ln[1] * LN.eyePx[1] * LN.weight;
        const gs = svg.querySelectorAll('g.p');
        const order = [0, 1, 2, 3, 4, 0];
        for (let n = 0; n < 6; n++) {
          const i = order[n],
            p = fl.petals[i],
            g = gs[n],
            [pet, shade, vein, edge] = g.children;
          const a = p.r + o.rot + jr,
            d = Math.cos((a * Math.PI) / 180) * dir;
          const persp = 1 - D.nearShorten * T * dep * Math.max(0, d),
            cup = 1 + D.farCup * T * dep * d;
          const L = S.petalScale * p.s * o.len[i] * persp * cup,
            W = S.petalScale * p.s * o.wid[i] * persp;
          g.setAttribute(
            'transform',
            `scale(${r3(kx + jk)} ${r3(k - jk)}) rotate(${r3(a)}) scale(${r3(W)} ${r3(L)}) translate(-30 -100)`
          );
          const path = boil && z !== 's' ? p.d[fi % H.boilDrawings] : p.d[0];
          pet.setAttribute('d', path);
          shade.setAttribute('d', path);
          edge.setAttribute('d', path);
          vein.setAttribute('d', p.vein);
          shade.setAttribute(
            'opacity',
            r3(Math.min(D.shadeMax, D.shadeGain * T * dep * Math.max(0, d)) + (o.sleepy ? D.sleepyShade : 0))
          );
          pet.setAttribute(
            'class',
            'pet' + (ringOn && i / 5 >= ringP - 1e-6 ? ' dim' : '') + (o.hi === i ? ' hi' : '')
          );
        }
        const fall = svg.querySelector('g.fall'),
          fp = fall.firstChild;
        if (z === 'l' && o.fall >= 0) {
          const P = F.moods.idle.fallingPetal,
            c = o.fall,
            x = 58 - 34 * eIO(c / P.forSec) + 12 * Math.sin((c * Math.PI * 2) / 1.5),
            y = -34 + 128 * eIO(c / P.forSec),
            rk = 30 * Math.sin((c * Math.PI * 2) / 1.5);
          fall.setAttribute(
            'transform',
            `translate(${r3(x)} ${r3(y)}) rotate(${r3(rk)}) scale(${P.scale} ${r3(P.scale * k * 0.7)}) translate(-30 -100)`
          );
          fall.setAttribute('opacity', r3(c > 3 ? 1 - (c - 3) / 0.6 : 1));
          fp.setAttribute('d', fl.fall);
        } else {
          fall.setAttribute('transform', 'scale(0)');
          fall.setAttribute('opacity', '0');
        }
        svg
          .querySelector('g.root')
          .setAttribute(
            'transform',
            `translate(${r3(jr * 0.3)} ${r3(o.bob + cy)}) scale(${r3(o.rs * o.sx)} ${r3(o.rs * o.sy)})`
          );
        const eye = svg.querySelector('g.eye'),
          [ring, core] = eye.children;
        eye.setAttribute(
          'transform',
          `translate(${r3(ex)} ${r3(ey)}) scale(${r3(S.eyeScale * o.es * kx)} ${r3(S.eyeScale * o.es * k)}) translate(-20 -20)`
        );
        ring.setAttribute('d', fl.eye.ring);
        core.setAttribute('d', fl.eye.core);
        core.setAttribute('opacity', o.eyeOp);
      }

      const cores = new Set();
      let raf = 0,
        t0 = performance.now(),
        lastFi = -1,
        lastTs = 0;
      const frames = [],
        draws = [];
      let redraws = 0;
      const io = window.IntersectionObserver
        ? new IntersectionObserver(
            es =>
              es.forEach(e => {
                if (e.target.__core) e.target.__core.vis = e.intersectionRatio > 0;
              }),
            { threshold: [0, 0.01] }
          )
        : null;
      // Her voice: each word lifts it, it decays between words, and a floor holds while she talks (the canvas's word()).
      const voiceAt = now => {
        if (!sig.talking) return 0;
        const W = F.speech.word,
          dt = (now - sig.voiceAt) / 1000;
        return Math.min(1, sig.voice * Math.exp(-dt * W.decay) + W.floor);
      };
      function drawCore(o, fi, tq, now) {
        const mood = o.follow ? sig.mood : o.mood;
        const g = o.follow && sig.g && now - sig.gAt < GD(sig.g) * 1000 ? sig.g : null;
        const gl = o.follow && g === 'glance' ? sig.glance || 1 : 1;
        step(o.G, tq, mood, g, mood === 'speaking' ? voiceAt(now) : 0);
        const rm = reduce || o.still;
        const p = pose(o.G, tq, rm, gl);
        const ringOn = o.follow && sig.ring >= 0;
        const z = zoneOf(o.size);
        if (o.el.dataset.z !== z) o.el.dataset.z = z;
        const moving = !rm && o.sig !== undefined && JSON.stringify(p) !== o.lastPose;
        const active = !rm && ((mood !== 'idle' && mood !== 'sleepy') || !!g || moving);
        const boil = active && H.boil !== 'off';
        const key =
          JSON.stringify(p) +
          (boil ? fi % H.boilDrawings : '') +
          (moving ? fi : '') +
          JSON.stringify(o.lean) +
          (ringOn ? Math.round(sig.ring * 5) : '') +
          z;
        o.lastPose = JSON.stringify(p);
        if (key === o.sig) return false;
        o.sig = key;
        o.pose = p;
        o.el.classList.toggle('err', p.err);
        draw(p, z, SHAPES[z === 's' ? 's' : 'l'], fi, o.lean, moving, boil, o.svg, ringOn, sig.ring);
        o.draws++;
        return true;
      }
      function tick(ts) {
        raf = requestAnimationFrame(tick);
        if (lastTs) {
          frames.push(ts - lastTs);
          if (frames.length > 1200) frames.shift();
        }
        lastTs = ts;
        if (document.hidden) return;
        const now = performance.now(),
          fi = Math.floor(((now - t0) / 1000) * FPS);
        if (fi === lastFi) return;
        lastFi = fi;
        const tq = fi / FPS,
          start = performance.now();
        let drew = false;
        for (const o of cores) {
          if (!o.vis || !o.el.isConnected || (o.when && !o.when())) continue;
          if (drawCore(o, fi, tq, now)) {
            drew = true;
            redraws++;
          }
        }
        if (drew) {
          draws.push(performance.now() - start);
          if (draws.length > 1200) draws.shift();
        }
      }
      function make(size, opt = {}) {
        const id = 'evf' + ++uid;
        const el = document.createElement('span');
        el.className = 'ev-av';
        el.setAttribute('aria-hidden', 'true');
        el.style.setProperty('--s', size + 'px');
        const svg = makeSvg(id);
        el.append(svg);
        const core = {
          el,
          svg,
          size,
          mood: opt.mood || 'idle',
          follow: !!opt.follow,
          still: !!opt.still,
          when: opt.when || null,
          vis: true,
          G: newGroup(),
          lean: [0, 0],
          sig: undefined,
          draws: 0,
        };
        svg.__core = core;
        if (io) io.observe(svg);
        // Facing him, her eye follows a mouse pointer on the page (D-223's attention), in steps of a quarter.
        if (opt.pointer && F.lean.mouseOnly !== undefined)
          addEventListener('pointermove', e => {
            if (F.lean.mouseOnly && e.pointerType && e.pointerType !== 'mouse') return;
            const r = svg.getBoundingClientRect(),
              q = v => Math.round(Math.max(-1, Math.min(1, v)) / F.lean.step) * F.lean.step;
            core.lean = [
              q((e.clientX - r.left - r.width / 2) / F.lean.reachPx),
              q((e.clientY - r.top - r.height / 2) / F.lean.reachPx),
            ];
          });
        core.resize = px => {
          px = Math.round(px);
          if (px === core.size) return;
          core.size = px;
          el.style.setProperty('--s', px + 'px');
          core.sig = undefined;
        };
        cores.add(core);
        // The first drawing is made now, so she is never an empty box before the clock's next frame.
        drawCore(core, Math.max(0, lastFi), Math.max(0, lastFi) / FPS, performance.now());
        if (!raf) raf = requestAnimationFrame(tick);
        return core;
      }
      // The page API (D-134, unchanged by D-212). A glance takes a direction ('left', 'right') or a target element.
      function gesture(name, detail) {
        if (!F.gestures[name]) throw new Error('unknown gesture ' + name);
        sig.g = name;
        sig.gAt = performance.now();
        sig.gid++;
        if (name === 'glance') {
          let dx = -1;
          if (detail && detail.nodeType === 1) {
            const hero = [...cores].find(c => c.follow && c.vis && c.el.isConnected);
            const a = detail.getBoundingClientRect(),
              b = hero ? hero.svg.getBoundingClientRect() : { left: innerWidth / 2, width: 0 };
            dx = a.left + a.width / 2 < b.left + b.width / 2 ? 1 : -1;
          } else if (detail === 'right') dx = -1;
          else if (detail === 'left') dx = 1;
          sig.glance = dx;
        }
        note(
          'gesture',
          name,
          name === 'glance' && detail
            ? detail.nodeType === 1
              ? detail.id || detail.className || 'element'
              : detail
            : null
        );
      }
      // speak(word, {emphasis}) or speak(word, true): each word lifts her voice; emphasis lifts it to the top.
      function speak(word, o = {}) {
        const em = o === true || !!(o && o.emphasis);
        const now = performance.now();
        sig.voice = em ? 1 : Math.min(0.9, 0.3 + 0.07 * String(word).length);
        sig.voiceAt = now;
        sig.talking = true;
        note('speak', String(word).slice(0, 40), em ? 'emphasis' : null);
      }
      function speechEnd() {
        if (sig.talking) note('speechEnd');
        sig.talking = false;
      }
      function setMood(m) {
        if (!F.moods[m]) return;
        if (m !== sig.mood) note('mood', m);
        sig.mood = m;
      }
      // A session's progress (D-217: one petal per answer): the petals past it are drawn quiet.
      function setRing(p) {
        sig.ring = typeof p === 'number' && p >= 0 ? Math.min(1, p) : -1;
      }
      const stats = () => ({
        frames: frames.slice(),
        draws: draws.slice(),
        redraws,
        heldFps: FPS,
        level: 0,
        steps: [],
        gestures: sig.g && performance.now() - sig.gAt < GD(sig.g) * 1000 ? [{ name: sig.g }] : [],
        mood: sig.mood,
        ring: sig.ring,
        reduce,
        renderer: 'svg',
        log: log.slice(),
      });
      const resetStats = () => {
        frames.length = 0;
        draws.length = 0;
        redraws = 0;
      };
      // The last drawing of one flower, as numbers (harness checks): its size, how many petals it shows, whether she
      // faces him, its colour, and a hash of the drawing.
      function sample(i = 0) {
        const c = [...cores][i];
        if (!c) return null;
        const s = c.svg.innerHTML;
        let h = 0;
        for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0;
        const pet = c.svg.querySelector('.pet');
        return {
          renderer: 'svg',
          size: c.size,
          petals: c.svg.querySelectorAll('g.p').length - 1,
          facing: !!c.pose && Math.abs(c.pose.v) < 0.02,
          turned: c.G.vw.to === 0,
          view: c.pose ? c.pose.v : null,
          colour: pet ? getComputedStyle(pet).fill : null,
          lit: c.size * c.size,
          draws: c.draws,
          hash: h,
        };
      }
      return { make, gesture, speak, speechEnd, setMood, setRing, stats, resetStats, sample, cores: () => [...cores] };
    })();
    window.EVApp.core = CORE;
    // B-209 (D-213): her stage size follows the layout and what is on screen, from spec.ui.look.flower.sizes: 104 px on
    // the phone, 112 or 128 px beside the sidebar (under or from 900 px wide), 140 or 168 px with the details panel
    // (from 1000 px tall), 70% of that in a session. The step names the state (idle, conversation, list or surface,
    // session, skills) as the Captions layout reads it.
    const FZ = EV_SPEC.ui.look.flower.sizes;
    function stagePx(state) {
      const w = innerWidth,
        h = innerHeight;
      let px =
        w < 600
          ? FZ.phone
          : w < 1200
            ? w < FZ.sidebarNarrowBelowPx
              ? FZ.sidebarNarrow
              : FZ.sidebar
            : h > FZ.wideTallFromPx
              ? FZ.wideTall
              : FZ.wide;
      if (state === 'session') px = Math.round(px * FZ.sessionShare);
      return px;
    }
    function MO_SIZE(w, state) {
      return { ...window.EVMotion.coreSize(w, state, EV_SPEC.ui.look.core.sizes), px: stagePx(state), pct: 100 };
    }
    const coreStage = () => MO_SIZE(innerWidth, 'idle');
    const heroOrb = CORE.make(coreStage().px, { follow: true, pointer: true });
    $('hero').append(heroOrb.el);
    // While he reads back, or on a screen under 560 px tall, her stage folds and she is the 24 px flower in the pane's
    // header (D-213); tapping her there is tapping her.
    if ($('mh-her')) {
      $('mh-her').append(
        CORE.make(24, { follow: true, when: () => document.body.classList.contains('her-folded') }).el
      );
      $('mh-her').addEventListener('click', () => (ui.tab === 'ev' ? backToNow() : showTab('ev')));
    }
    // The send is a quiet circle that fills when he types (D-214).
    $('ev-input').addEventListener('input', () => $('ev-send').classList.toggle('on', !!$('ev-input').value.trim()));
    // The top bar's core is tucked away (styles.css) while her stage core is up or a session runs; then it does not draw.
    const topOrb = CORE.make(24, {
      follow: true,
      when: () => !document.body.matches('.on-ev.captions, .on-ev.opening, .on-ev.in-session, .on-ev.core-big'),
    });
    $('top-av').append(topOrb.el);
    // B-208 (D-210, D-223): on the phone her flower is the E.V. tab, the same drawing at 24 px.
    if ($('tab-her')) $('tab-her').append(CORE.make(24, { follow: true, when: () => innerWidth < 600 }).el);
    // A resize keeps the newest line in view when he was reading it (the layout steps at 1024 px move everything).
    addEventListener('resize', () => {
      heroOrb.resize(coreStage().px);
      renderStage();
      if (CAP.stick)
        requestAnimationFrame(() => {
          pinNow();
          capBox.dispatchEvent(new Event('scroll'));
        });
    });

