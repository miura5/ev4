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
      workOpen: new Set(), // B-227: the work lines opened in place (message ids, job:<id>)
      uploads: new Map(),
      reading: false,
    };
    let talkQ = Promise.resolve();
    // B-394: lines still waiting in talkQ, and the refusals of the current run, said in one toast once the queue is clear
    let talkQueued = 0;
    let refusedRun = null;
    let lastStamp = '';
    // ------------------------------------------------------------ Her: the Dial Arc (B-272; D-265, D-266, D-213, D-216)
    // Ported from the round 15 canvas's Avatar.dc.html (https://claude.ai/artifact/GwFwpuVtVMuyUKF8kJA8Sw), Ember with
    // halftone, gentle tilt, 12 segments, narrow gap, Pointer sessions. A tilted ring of 12 segments (radii 16 and 28 of a
    // 100-unit box, 0.08 rad apart), each flipping on its spoke between a solid front (--av1) and a halftone back (--av2)
    // over an underlay in the ground colour. At rest an arc with a 1.6-segment gap at two o'clock: the gap is her pointer.
    // One SVG per place she shows (her stage, the sidebar, the pane header, the phone's tab), every one the same drawing.
    // Each frame eases toward the state's targets with frame-rate-independent smoothing, k(b) = 1 - (1 - b)^(dt x 30);
    // a still idle or sleepy dial draws nothing. The page talks to her through CORE.setMood, CORE.gesture, CORE.speak,
    // CORE.speechEnd and CORE.setRing (also EVApp.core), as it did to the flower it replaced (D-134).
    let MOOD_NOW = 'idle';
    const CORE = (() => {
      const SVG = 'http://www.w3.org/2000/svg';
      const TAU = Math.PI * 2,
        PI = Math.PI;
      const MOODS = ['idle', 'listening', 'thinking', 'speaking', 'alert', 'happy', 'sleepy'];
      const GD = { send: 1.2, done: 1.6, error: 1.8, glance: 2.2, settle: 2.4 };
      const LIVE = { thinking: 1, speaking: 1, alert: 1, happy: 1 };
      const N = 12,
        R0 = 16,
        R1 = 28,
        GAP = 0.08,
        GW = 1.6,
        TILT = { rx: 0.45, ry: -0.35 };
      // B-224 (D-229): the system's setting or his Reduce motion On, read when she draws
      const reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
      const isReduced = () => reduceMq.matches || document.documentElement.getAttribute('data-motion') === 'reduce';
      const f1 = v => Math.round(v * 100) / 100;
      const cl = x => Math.max(0, Math.min(1, x)),
        ease = x => 0.5 - 0.5 * Math.cos(PI * cl(x));
      const pd = pts => (pts.length < 2 ? '' : 'M' + pts.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L') + 'Z');
      const lerpObj = (cur, tgt, k) => {
        let mv = 0;
        for (const key in tgt) {
          const d = tgt[key] - cur[key];
          cur[key] += d * k;
          mv += Math.abs(d);
        }
        return mv;
      };
      const cam = (rx, ry) => {
        const cx = Math.cos(rx),
          sx = Math.sin(rx),
          cy = Math.cos(ry),
          sy = Math.sin(ry);
        const rot = p => {
          const x1 = p[0] * cy + p[2] * sy,
            z1 = -p[0] * sy + p[2] * cy;
          return [x1, p[1] * cx - z1 * sx, p[1] * sx + z1 * cx];
        };
        return {
          rot,
          proj: p => {
            const r = rot(p),
              s = 150 / (150 - r[2]);
            return [r[0] * s, r[1] * s, r[2]];
          },
        };
      };
      const rodr = (v, u, a) => {
        const c = Math.cos(a),
          s = Math.sin(a),
          d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2],
          cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        return [
          v[0] * c + cr[0] * s + u[0] * d * (1 - c),
          v[1] * c + cr[1] * s + u[1] * d * (1 - c),
          v[2] * c + cr[2] * s + u[2] * d * (1 - c),
        ];
      };
      const near = (tg, cur) => tg + TAU * Math.round((cur - tg) / TAU);
      const cdist = (a, b, n) => {
        const d = (((a - b) % n) + n) % n;
        return Math.min(d, n - d);
      };
      const circ = (from, to, n) => ((((to - from) % n) + n * 1.5) % n) - n / 2;
      const zoneOf = px => (px <= 28 ? 's' : px <= 64 ? 'm' : 'l');

      // ---- shared signals: the page sets them; every dial that follows her reads them
      const sig = {
        mood: 'idle',
        talking: false,
        voice: 0,
        voiceAt: 0,
        words: 0,
        g: null,
        gAt: 0,
        gid: 0,
        glance: 1,
        ring: -1,
      };
      const log = [];
      const note = (kind, name, detail) => {
        log.push({ at: Date.now(), kind, name, ...(detail != null ? { detail } : {}) });
        if (log.length > 200) log.shift();
      };
      // Her voice: each word lifts it and it decays between words over a floor while she talks (the canvas's word()).
      const voiceAt = now =>
        sig.talking ? Math.min(1, sig.voice * Math.exp(((now - sig.voiceAt) / 1000) * -8.84) + 0.12) : 0;
      // Where the speaking nod is, in words: one step per word, eased in (the canvas's wordPos()).
      const wordPos = now => sig.words - 1 + ease(((now - sig.voiceAt) / 1000) * 6.5);

      // ---- one frame's inputs for one dial
      function ctxOf(o, t, now, snap) {
        const rm = isReduced() || o.still;
        const mood = o.follow ? sig.mood : o.mood;
        const g = !rm && o.follow && sig.g && now - sig.gAt < GD[sig.g] * 1000 ? sig.g : '';
        const ge = g ? (now - sig.gAt) / 1000 : 0;
        let gd =
          g === 'glance' && ge < 2.2
            ? (ge < 1.1 ? -ease(ge / 0.35) : ease((ge - 1.1) / 0.35)) * (ge > 1.85 ? 1 - ease((ge - 1.85) / 0.35) : 1)
            : 0;
        gd *= sig.glance || 1;
        const sh = g === 'error' && ge < 1.4 ? 3.5 * Math.exp(-3 * ge) * Math.sin(ge * 46) : 0;
        let sq = 1;
        if (g === 'send' && ge < 0.6) sq = 1 - 0.12 * Math.sin((PI * ge) / 0.6);
        if (g === 'settle' && ge < 2.4) sq = 1 - 0.07 * Math.exp(-2 * ge) * Math.cos(ge * 7);
        const dt = snap ? 0.05 : Math.min(0.1, o.lt == null ? 0 : t - o.lt);
        if (!snap) o.lt = t;
        return {
          t,
          dt,
          now,
          rm,
          mood,
          g,
          ge,
          z: zoneOf(o.size),
          snap,
          gd: Math.abs(gd) > 0.02 ? gd : 0,
          sess: o.follow ? sig.ring : -1,
          amp: mood === 'speaking' && !rm ? voiceAt(now) : 0,
          k: b => (snap ? 1 : 1 - Math.pow(1 - b, dt * 30)),
          ap: p => [p[0] * sq + sh, p[1] * sq],
        };
      }
      const newK = () => ({
        ph: Array(N).fill(0),
        s: Array(N).fill(1),
        o: Array(N).fill(1),
        cam: null,
        dir: N * (2 / 12),
        w: GW,
        fall: Array(N).fill(-9),
        filled: -1,
      });
      // where the gap points (in segment units, 0 = twelve o'clock, clockwise) and how wide it is
      function gapT(c) {
        const { mood, g, ge, amp, gd } = c;
        if (g === 'done' && ge < 1.6) return { dir: null, w: 0 };
        if (gd) return { dir: gd < 0 ? N * 0.75 : N * 0.25, w: GW };
        if (g === 'send' && ge < 1.0) return { dir: N * (1.5 / 12), w: GW + 1.2 * Math.sin(PI * Math.min(1, ge)) };
        switch (mood) {
          case 'listening':
            return { dir: N / 2, w: GW };
          case 'thinking':
            return { dir: 'spin', speed: N / 13, w: GW * 0.85 };
          case 'speaking':
            return { dir: N * (4.5 / 12), w: 1 + amp * 2.8 };
          case 'alert':
            return { dir: null, w: 0 };
          case 'happy':
            return { dir: 'spin', speed: N / 4.5, w: GW };
          case 'sleepy':
            return { dir: N / 2, w: 0.6 };
          default:
            return { dir: N * (2 / 12), w: GW };
        }
      }
      function camT(c) {
        const { t, mood, ge, gd } = c,
          B = TILT;
        if (c.sess >= 0) return { rx: B.rx + 0.04, ry: B.ry + (c.rm ? 0 : 0.05 * Math.sin(t * 0.5)), sp: 1 };
        if (c.g === 'done' && ge < 1.6) return { rx: B.rx * 0.4, ry: 0, sp: 1.03 };
        if (gd) return { rx: B.rx * 0.7, ry: gd * 0.4, sp: 1 };
        const w = c.rm ? 0 : 1;
        switch (mood) {
          case 'thinking':
            return { rx: B.rx, ry: B.ry + w * 0.2 * Math.sin(t * 0.4), sp: 1 };
          case 'speaking':
            return { rx: B.rx * 0.6, ry: B.ry * 0.5, sp: 1 };
          case 'listening':
            return { rx: Math.min(B.rx, 0.1) - 0.12, ry: 0, sp: 1 };
          case 'alert':
            return { rx: 0, ry: 0, sp: 1.07 };
          case 'happy':
            return { rx: B.rx, ry: B.ry + w * 0.15 * Math.sin(t * 2), sp: 1 + w * 0.02 * Math.sin(t * 6) };
          case 'sleepy':
            return { rx: Math.max(B.rx, 1.05), ry: B.ry, sp: 0.95 };
          default:
            return { rx: B.rx, ry: B.ry, sp: 1 };
        }
      }
      function segT(K, c, k, gapMask) {
        const { t, mood, g, ge, amp } = c,
          w = c.rm ? 0 : 1;
        let ph = 0,
          s = 1,
          o = 1;
        const hide = gapMask(k);
        if (g === 'done' && ge < 1.6) {
          const on = ge * 2.4 > (k + 1) / N;
          return { ph: on ? 0 : PI, s: on ? 1.04 : 1, o: 1 };
        }
        switch (mood) {
          case 'thinking': {
            const behind = (((K.dir - (k + 0.5)) % N) + N) % N,
              wk = behind > 0.5 && behind < 3.5 ? 1 - (behind - 0.5) / 3 : 0;
            ph = PI * ease(wk * 1.2);
            break;
          }
          case 'speaking': {
            if (!w) break;
            const head = (wordPos(c.now) * 1.7) % N,
              d = cdist(k, head, N),
              pulse = Math.exp((-d * d) / 1.6);
            ph = pulse * (0.5 + amp * 0.55);
            s = 1 + amp * 0.05 + pulse * 0.05;
            break;
          }
          case 'listening': {
            const ang = -PI / 2 + ((k + 0.5) * TAU) / N,
              low = Math.max(0, Math.sin(ang));
            s = 1 + 0.06 * low;
            break;
          }
          case 'alert': {
            const top = k === 0; // one solid segment at twelve (the States board and the hand-off; D-216's lit one)
            ph = top ? 0 : PI;
            s = top ? 1.15 * (1 + w * 0.05 * Math.abs(Math.sin(t * 4))) : 0.95;
            break;
          }
          case 'happy':
            ph = w * Math.max(0, Math.sin(t * 2.4 - (k / N) * TAU)) * PI * 0.5;
            break;
          case 'sleepy':
            ph = PI;
            s = 0.96;
            break;
        }
        if (g === 'settle' && ge < 2.4) s *= 1 + 0.04 * Math.exp(-2 * ge) * Math.sin(ge * 6 + k * 0.4);
        if (g === 'error' && ge < 1.4 && hide > 0.01) o *= 0.35 + 0.65 * (Math.sin(ge * 40) > 0 ? 1 : 0);
        if (hide > 0) {
          s += 0.14 * hide;
          o *= 1 - hide;
        }
        return { ph, s, o };
      }
      // One step toward the targets; returns how much moved (0 when she is still).
      function step(K, c) {
        let mv = 0;
        const CT = camT(c);
        if (!K.cam || c.snap) K.cam = Object.assign({}, CT);
        else mv += lerpObj(K.cam, CT, c.k(0.08));
        if (c.sess >= 0) return stepSession(K, c) + mv;
        K.filled = -1;
        const G = gapT(c);
        if (G.dir === 'spin') K.dir = (K.dir + c.dt * G.speed) % N;
        else if (G.dir !== null) {
          const d = circ(K.dir, G.dir, N);
          K.dir = (K.dir + d * c.k(0.1) + N) % N;
          mv += Math.abs(d);
        }
        const dw = G.w - K.w;
        K.w += dw * c.k(0.12);
        mv += Math.abs(dw);
        // a gap narrower than 0.6 of a segment fades out with it, so a closed ring (alert, done) shows all 12
        const mask = k => ease(cl((K.w / 2 + 0.5 - cdist(k + 0.5, K.dir, N)) / 0.3)) * cl(K.w / 0.6);
        for (let k = 0; k < N; k++) {
          const T = segT(K, c, k, mask),
            tp = near(T.ph, K.ph[k]),
            kk = c.snap ? 1 : c.k(0.13);
          mv += Math.abs(tp - K.ph[k]) * 2 + Math.abs(T.s - K.s[k]) * 10 + Math.abs(T.o - K.o[k]) * 2;
          K.ph[k] += (tp - K.ph[k]) * kk;
          K.s[k] += (T.s - K.s[k]) * kk;
          K.o[k] += (T.o - K.o[k]) * kk;
        }
        return mv + (!c.rm && (LIVE[c.mood] || c.g) ? 5 : 0);
      }
      // A session in Pointer mode (D-267): filled segments fall in clockwise from twelve, the rest halftone, the gap at
      // the next unfilled slot.
      function stepSession(K, c) {
        const filled = Math.min(N, Math.floor(c.sess * N + 1e-6));
        if (K.filled < 0 || filled < K.filled) {
          K.filled = filled;
          K.fall = Array(N).fill(-99);
        }
        while (K.filled < filled) {
          K.fall[K.filled] = c.rm ? -99 : c.t;
          K.filled++;
        }
        const kk = c.snap ? 1 : c.k(0.12);
        for (let k = 0; k < N; k++) {
          const tp = near(0, K.ph[k]);
          K.ph[k] += (tp - K.ph[k]) * kk;
          K.s[k] += (1 - K.s[k]) * kk;
          K.o[k] += (1 - K.o[k]) * kk;
        }
        return 6;
      }
      // The drawing: each segment's outline through the camera, sorted so the near side draws last.
      function draw(o, c) {
        const K = o.K,
          C = cam(K.cam.rx, K.cam.ry),
          sp = K.cam.sp,
          span = TAU / N,
          items = [],
          cs = Math.floor(c.t / 7) * 7;
        const P = v => c.ap(C.proj([v[0] * sp, v[1] * sp, v[2] * sp]));
        const sess = c.sess >= 0;
        for (let k = 0; k < N; k++) {
          const a0 = -PI / 2 + k * span + GAP / 2,
            a1 = a0 + span - GAP,
            am = (a0 + a1) / 2,
            ax = [Math.cos(am), Math.sin(am), 0];
          let yo = 0,
            op = K.o[k],
            show = true,
            slot = false;
          if (sess) {
            const isNow = k === K.filled && K.filled < N;
            slot = !isNow && K.o[k] >= 0.05;
            if (k >= K.filled) show = false;
            else if (!c.rm) {
              const fe = c.t - K.fall[k];
              if (fe < 1.1) {
                const e = ease(fe / 1.1);
                yo = -40 * (1 - e);
                op *= e;
              } else {
                const re = c.t - (cs + 0.6 + k * 0.16);
                if (re > 0 && re < 0.8) {
                  const e = ease(re / 0.8);
                  yo = -8 * (1 - e);
                  op *= 0.3 + 0.7 * e;
                }
              }
            }
          }
          if (op < 0.02 && !slot) continue;
          const s = K.s[k],
            r0 = R0 * s,
            r1 = R1 * s,
            ph = K.ph[k],
            m = 6;
          const ring = (flip, yy) => {
            const pts = [];
            for (let i = 0; i <= m; i++) {
              const a = a0 + (a1 - a0) * (i / m);
              pts.push([Math.cos(a) * r1, Math.sin(a) * r1, 0]);
            }
            for (let i = m; i >= 0; i--) {
              const a = a0 + (a1 - a0) * (i / m);
              pts.push([Math.cos(a) * r0, Math.sin(a) * r0, 0]);
            }
            return pts.map(p => {
              const v = rodr(p, ax, flip);
              return [v[0], v[1] + yy, v[2]];
            });
          };
          const front = C.rot(rodr([0, 0, 1], ax, ph))[2] > 0,
            cz = C.rot(rodr([Math.cos(am) * 22, Math.sin(am) * 22, 0], ax, ph))[2];
          if (slot) items.push({ z: cz - 60, back: true, d: pd(ring(0, 0).map(P)), o: K.o[k] });
          if (show && op > 0.02) items.push({ z: cz, back: !front, d: pd(ring(ph, yo).map(P)), o: op });
        }
        items.sort((a, b) => a.z - b.z);
        const out = [];
        for (const it of items) {
          const op = f1(it.o);
          if (!it.back) out.push(['c1', '', it.d, op]);
          else if (c.z === 's') out.push(['c2', '', it.d, f1(it.o * 0.6)]);
          else {
            out.push(['under', '', it.d, op]);
            out.push(['tex', 'url(#' + o.id + '-h)', it.d, op]);
          }
        }
        return out;
      }
      // Puts one drawing into the dial's SVG, reusing its paths.
      function paint(o, c) {
        const out = draw(o, c),
          g = o.body;
        while (g.childNodes.length < out.length) g.appendChild(document.createElementNS(SVG, 'path'));
        const kids = g.childNodes;
        for (let i = 0; i < kids.length; i++) {
          const p = kids[i],
            r = out[i];
          if (!r) {
            if (p.getAttribute('d')) p.setAttribute('d', '');
            continue;
          }
          if (p.getAttribute('class') !== r[0]) p.setAttribute('class', r[0]);
          if (r[1]) p.setAttribute('fill', r[1]);
          else p.removeAttribute('fill');
          p.setAttribute('d', r[2]);
          p.setAttribute('opacity', r[3]);
        }
        g.setAttribute('opacity', c.mood === 'sleepy' && c.sess < 0 ? '0.78' : '1');
        if (o.el.dataset.z !== c.z) o.el.dataset.z = c.z;
        o.draws++;
      }
      // One dial's frame; true when it drew.
      function frameCore(o, t, now) {
        const c = ctxOf(o, t, now, false);
        if (!o.K) o.K = newK();
        if (c.rm) {
          // Reduced motion: one still per mood (and per session step), its settled end frame; gestures are not shown.
          const key = c.mood + '|' + (c.sess >= 0 ? Math.floor(c.sess * N + 1e-6) : '-') + '|' + c.z;
          if (key === o.rk) return false;
          o.rk = key;
          o.K = newK();
          const s = ctxOf(o, 0, now, true);
          for (let i = 0; i < 60; i++) step(o.K, s);
          paint(o, Object.assign(s, { t: 0 }));
          return true;
        }
        o.rk = null;
        const mv = step(o.K, c);
        const still = (c.mood === 'idle' || c.mood === 'sleepy') && !c.g && c.sess < 0;
        if (mv > 0.04 || !still || o.dirty) o.q = 0;
        else if ((o.q = (o.q || 0) + 1) >= 4) return false;
        o.dirty = false;
        paint(o, c);
        return true;
      }

      const cores = new Set();
      let raf = 0,
        lastTs = 0,
        uid = 0,
        redraws = 0;
      const t0 = performance.now();
      const frames = [],
        draws = [];
      // B-274 (D-271, D-272): one clock. Her loop runs on requestAnimationFrame at the display's rate (dt smoothing is
      // ctxOf's k) and stops when no dial drew, so a still idle costs no frame at all; anything that could change a
      // drawing (a signal, a size, a dial coming into view, the page shown again, his motion setting) wakes it.
      function wake() {
        if (raf) return;
        lastTs = 0;
        for (const o of cores) o.lt = null;
        raf = requestAnimationFrame(tick);
      }
      const io = window.IntersectionObserver
        ? new IntersectionObserver(
            es =>
              es.forEach(e => {
                const o = e.target.__core;
                if (!o) return;
                const vis = e.intersectionRatio > 0;
                if (vis !== o.vis) {
                  o.vis = vis;
                  if (vis) wake();
                }
              }),
            { threshold: [0, 0.01] }
          )
        : null;
      function tick(ts) {
        raf = 0;
        if (document.hidden) return;
        if (lastTs) {
          frames.push(ts - lastTs);
          if (frames.length > 1200) frames.shift();
        }
        lastTs = ts;
        const now = performance.now(),
          t = (now - t0) / 1000,
          start = now;
        let drew = false;
        for (const o of cores) {
          if (!o.vis || !o.el.isConnected || (o.when && !o.when())) {
            o.lt = null;
            o.dirty = true;
            continue;
          }
          if (frameCore(o, t, now)) {
            drew = true;
            redraws++;
          }
        }
        if (drew) {
          draws.push(performance.now() - start);
          if (draws.length > 1200) draws.shift();
          raf = requestAnimationFrame(tick);
        } else lastTs = 0;
      }
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) wake();
      });
      addEventListener('resize', wake);
      if (reduceMq.addEventListener) reduceMq.addEventListener('change', wake);
      // A dial shown by a class (her folded 24 px form) or his Reduce motion setting changes what she draws.
      if (window.MutationObserver) {
        const mo = new MutationObserver(wake);
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
        if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      }
      function make(size, opt = {}) {
        const id = 'evd' + ++uid;
        const el = document.createElement('span');
        el.className = 'ev-av';
        el.setAttribute('aria-hidden', 'true');
        el.style.setProperty('--s', size + 'px');
        const svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('viewBox', '-50 -50 100 100');
        svg.setAttribute('class', 'fl dial');
        svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML =
          `<defs><pattern id="${id}-h" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">` +
          `<circle cx="1.5" cy="1.5" r="0.95" class="c2"/></pattern></defs><g class="body"></g>`;
        el.append(svg);
        const core = {
          id,
          el,
          svg,
          body: svg.querySelector('g.body'),
          size,
          mood: opt.mood || 'idle',
          follow: !!opt.follow,
          still: !!opt.still,
          when: opt.when || null,
          vis: true,
          K: null,
          lt: null,
          q: 0,
          rk: null,
          dirty: true,
          draws: 0,
        };
        svg.__core = core;
        if (io) io.observe(svg);
        core.resize = px => {
          px = Math.round(px);
          if (px === core.size) return;
          core.size = px;
          el.style.setProperty('--s', px + 'px');
          core.dirty = true;
          core.rk = null;
          wake();
        };
        cores.add(core);
        // The first drawing is made now, settled, so she is never an empty box before the next frame.
        const now = performance.now();
        core.K = newK();
        const s = ctxOf(core, (now - t0) / 1000, now, true);
        for (let i = 0; i < 30; i++) step(core.K, s);
        paint(core, s);
        wake();
        return core;
      }
      // The page API (D-134, unchanged by D-265). A glance takes a direction ('left', 'right') or a target element.
      function gesture(name, detail) {
        if (!GD[name]) throw new Error('unknown gesture ' + name);
        sig.g = name;
        sig.gAt = performance.now();
        sig.gid++;
        wake();
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
        sig.voice = em ? 1 : Math.min(0.9, 0.3 + 0.07 * String(word).length);
        sig.voiceAt = performance.now();
        sig.words++;
        sig.talking = true;
        wake();
        note('speak', String(word).slice(0, 40), em ? 'emphasis' : null);
      }
      function speechEnd() {
        if (sig.talking) {
          note('speechEnd');
          wake();
        }
        sig.talking = false;
      }
      function setMood(m) {
        if (!MOODS.includes(m)) return;
        if (m !== sig.mood) {
          note('mood', m);
          wake();
        }
        sig.mood = m;
      }
      // A session's progress, 0 to 1 (-1 off): her segments fill clockwise from twelve (D-267's Pointer mode).
      function setRing(p) {
        const r = typeof p === 'number' && p >= 0 ? Math.min(1, p) : -1;
        if (r !== sig.ring) wake();
        sig.ring = r;
      }
      const stats = () => ({
        frames: frames.slice(),
        draws: draws.slice(),
        redraws,
        level: 0,
        steps: [],
        gestures: sig.g && performance.now() - sig.gAt < GD[sig.g] * 1000 ? [{ name: sig.g }] : [],
        mood: sig.mood,
        ring: sig.ring,
        reduce: isReduced(),
        running: !!raf,
        renderer: 'svg',
        log: log.slice(),
      });
      const resetStats = () => {
        frames.length = 0;
        draws.length = 0;
        redraws = 0;
      };
      // The last drawing of one dial, as numbers (harness checks): its size, the segments it shows, how many are solid
      // and how many halftone, whether she faces him (the ring flat to the screen), her gap, her colours and a hash.
      function sample(i = 0) {
        const c = [...cores][i];
        if (!c) return null;
        const s = c.svg.innerHTML;
        let h = 0;
        for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0;
        const drawn = [...c.body.childNodes].filter(p => p.getAttribute('d'));
        const solid = drawn.filter(p => p.getAttribute('class') === 'c1').length,
          back = drawn.filter(p => /^(c2|tex)$/.test(p.getAttribute('class'))).length;
        const one = sel => {
          const p = drawn.find(x => x.getAttribute('class') === sel);
          return p ? getComputedStyle(p).fill : null;
        };
        const K = c.K;
        return {
          renderer: 'svg',
          size: c.size,
          z: zoneOf(c.size),
          segments: solid + back,
          solid,
          back,
          facing: !!K && Math.abs(K.cam.rx) < 0.03 && Math.abs(K.cam.ry) < 0.03,
          gap: K ? Math.round(K.dir * 100) / 100 : null,
          gapWidth: K ? Math.round(K.w * 100) / 100 : null,
          filled: K ? K.filled : -1,
          colour: one('c1'),
          back2:
            one('c2') ||
            (drawn.some(p => p.getAttribute('class') === 'tex')
              ? getComputedStyle(c.svg.querySelector('pattern circle')).fill
              : null),
          dim: c.body.getAttribute('opacity'),
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
    // The send is a quiet circle that fills in Ember when he types (D-270).
    $('ev-input').addEventListener('input', () => $('ev-send').classList.toggle('on', !!$('ev-input').value.trim()));
    // B-361: her mark beside her name in the sidebar stays, during a reply too, as in the demo; on the phone the
    // sidebar is the tab bar and the mark does not draw.
    const topOrb = CORE.make(24, { follow: true, when: () => innerWidth >= 600 });
    $('top-av').append(topOrb.el);
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

