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
    const T = {
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
      uploads: new Map(),
      reading: false,
    };
    let talkQ = Promise.resolve();
    let lastStamp = '';
    // E.V.'s core v2 (B-76; D-134, D-135): the Silk body, five translucent bands round the hot core and its short inner
    // filaments; the nucleus leads and the body follows on a soft spring; rubato idle drift with glances every 5 to 11 s
    // and a lean toward the pointer; faint wisps on curl noise, the send ripple, the particle progress ring; teal and
    // violet, coral only on an error. Every parameter is spec.ui.look.core; the springs, the speech envelope, the gesture
    // blend and the step-down are core/motion.mjs (window.EVMotion). One shared loop draws every core on the page: cores
    // that follow E.V.'s state move, others hold one still frame; off-screen cores and hidden tabs are skipped, cores
    // under 128 px run at 30 fps, and reduced motion shows a still frame per mood (a gesture is a short brightness change).
    // The page talks to her through CORE.setMood, CORE.gesture, CORE.speak and CORE.speechEnd (also EVApp.core).
    let MOOD_NOW = 'idle';
    const CORE = (() => {
      const L = (EV_SPEC.ui && EV_SPEC.ui.look && EV_SPEC.ui.look.core) || null,
        MO = window.EVMotion;
      if (!L || !MO) throw new Error('core v2 needs spec.ui.look.core and core.js with EVMotion');
      const PAL = L.palette,
        MOOD = L.moods,
        B = L.body;
      const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const hash = (i, j) => {
        let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
      };
      const n2 = (x, y) => {
        const xi = Math.floor(x),
          yi = Math.floor(y),
          xf = x - xi,
          yf = y - yi,
          u = xf * xf * (3 - 2 * xf),
          v = yf * yf * (3 - 2 * yf);
        const a = hash(xi, yi),
          b = hash(xi + 1, yi),
          c = hash(xi, yi + 1),
          d = hash(xi + 1, yi + 1);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
      };
      const curl = (x, y, out) => {
        const e = 0.07;
        out[0] = (n2(x, y + e) - n2(x, y - e)) / (2 * e);
        out[1] = -(n2(x + e, y) - n2(x - e, y)) / (2 * e);
        return out;
      };
      // Shared signals: one mood, one speech envelope and one list of gestures, applied by every core that follows her.
      const sig = {
        mood: 'idle',
        talking: false,
        word: null,
        env: MO.envelopeStart(),
        gestures: [],
        gid: 0,
        vid: 0,
        ring: -1,
        flashUntil: 0,
      };
      const log = [];
      const note = (kind, name, detail) => {
        log.push({ at: Date.now(), kind, name, ...(detail != null ? { detail } : {}) });
        if (log.length > 200) log.shift();
      };
      let down = MO.stepDownStart();
      const frames = [];
      const draws = [];

      // How her points reach the screen. She is additive light: every point adds its colour times its coverage, each
      // channel and the alpha clamping at 1 (the canvas's 'lighter'), so the order points are drawn in never matters.
      // WebGL draws them on the GPU (blendFunc ONE, ONE is that clamp, and each point is an exact box-coverage square in
      // the fragment shader); the page's own thread only fills one vertex buffer a frame. Where WebGL is missing or
      // lost, the same sums are made in a buffer here, touching only the pixels points land on, and handed to a 2D canvas
      // in one putImageData. Thousands of separate antialiased 2D fills were most of her cost (D-135's frame budget).
      // A renderer: resize(W, dpr), begin(), put(rgb, alpha, x, y, size) in CSS px, glow(x, y, r, stops), end(), read().
      function glRenderer(canvas, onLost) {
        let gl = null;
        try {
          gl = canvas.getContext('webgl', {
            alpha: true,
            premultipliedAlpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: true,
          });
        } catch {}
        if (!gl) return null;
        canvas.__gl = true;
        const hp = gl.getShaderPrecisionFormat && gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
        const prec = hp && hp.precision > 0 ? 'highp' : 'mediump';
        const sh = (type, src) => {
          const s = gl.createShader(type);
          gl.shaderSource(s, src);
          gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
          return s;
        };
        const prog = (vs, fs) => {
          const p = gl.createProgram();
          gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
          gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
          gl.linkProgram(p);
          if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
          return p;
        };
        let P,
          G,
          buf,
          gbuf,
          maxPt = 64,
          n = 0,
          data = new Float32Array(7 * 4096),
          H = 1,
          Wd = 1,
          lost = false,
          glowArgs = null;
        const init = () => {
          P = prog(
            `attribute vec2 aPos; attribute float aSize; attribute vec4 aCol; uniform vec2 uRes; varying vec4 vCol; varying vec2 vC; varying float vS;
          void main() { gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0); gl_PointSize = ceil(aSize) + 1.0; vCol = aCol; vC = aPos; vS = aSize; }`,
            `precision ${prec} float; varying vec4 vCol; varying vec2 vC; varying float vS; uniform vec2 uRes;
          void main() { vec2 q = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y); vec2 c = max(min(q + 0.5, vC + 0.5 * vS) - max(q - 0.5, vC - 0.5 * vS), 0.0); gl_FragColor = vCol * (c.x * c.y); }`
          );
          G = prog(
            `attribute vec2 aPos; uniform vec2 uRes; varying vec2 vP; void main() { vP = aPos; gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0); }`,
            `precision ${prec} float; varying vec2 vP; uniform vec2 uC; uniform float uR; uniform vec4 uC0; uniform vec4 uC1; uniform vec4 uC2; uniform vec4 uC3; uniform vec3 uT;
          void main() { float r = length(vP - uC) / uR; vec4 c; if (r < uT.x) c = mix(uC0, uC1, r / uT.x); else if (r < uT.y) c = mix(uC1, uC2, (r - uT.x) / (uT.y - uT.x)); else if (r < uT.z) c = mix(uC2, uC3, (r - uT.y) / (uT.z - uT.y)); else c = vec4(0.0);
            gl_FragColor = vec4(c.rgb * c.a, c.a); }`
          );
          buf = gl.createBuffer();
          gbuf = gl.createBuffer();
          const r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
          maxPt = r ? r[1] : 64;
          gl.disable(gl.DEPTH_TEST);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
        };
        try {
          init();
        } catch (e) {
          console.warn('E.V. core: WebGL unavailable, drawing on 2D (' + e.message + ')');
          return null;
        }
        // A lost context hands her to the 2D path for good (D-134): the engine swaps in a fresh canvas.
        canvas.addEventListener('webglcontextlost', e => {
          e.preventDefault();
          if (lost) return;
          lost = true;
          if (onLost) onLost();
        });
        let dpr = 1;
        return {
          kind: 'webgl',
          resize(W, d) {
            Wd = H = W;
            dpr = d;
            gl.viewport(0, 0, W, W);
          },
          begin() {
            n = 0;
            glowArgs = null;
          },
          put(col, a, x, y, z) {
            if (a > 1) a = 1;
            let s = z * dpr;
            if (s + 1 > maxPt) s = maxPt - 1;
            if (n + 7 > data.length) {
              const nd = new Float32Array(data.length * 2);
              nd.set(data);
              data = nd;
            }
            data[n] = x * dpr;
            data[n + 1] = y * dpr;
            data[n + 2] = s;
            data[n + 3] = (col[0] / 255) * a;
            data[n + 4] = (col[1] / 255) * a;
            data[n + 5] = (col[2] / 255) * a;
            data[n + 6] = a;
            n += 7;
          },
          glow(x, y, r, stops) {
            glowArgs = [x * dpr, y * dpr, r * dpr, stops];
          },
          end() {
            if (lost) return;
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            if (n) {
              gl.useProgram(P);
              gl.uniform2f(gl.getUniformLocation(P, 'uRes'), Wd, H);
              gl.bindBuffer(gl.ARRAY_BUFFER, buf);
              gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n), gl.STREAM_DRAW);
              const at = k => gl.getAttribLocation(P, k),
                F = 4;
              const lp = at('aPos'),
                ls = at('aSize'),
                lc = at('aCol');
              gl.enableVertexAttribArray(lp);
              gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 7 * F, 0);
              gl.enableVertexAttribArray(ls);
              gl.vertexAttribPointer(ls, 1, gl.FLOAT, false, 7 * F, 2 * F);
              gl.enableVertexAttribArray(lc);
              gl.vertexAttribPointer(lc, 4, gl.FLOAT, false, 7 * F, 3 * F);
              gl.drawArrays(gl.POINTS, 0, n / 7);
              gl.disableVertexAttribArray(ls);
              gl.disableVertexAttribArray(lc);
            }
            if (glowArgs) {
              const [x, y, r, st] = glowArgs;
              gl.useProgram(G);
              const u = k => gl.getUniformLocation(G, k);
              gl.uniform2f(u('uRes'), Wd, H);
              gl.uniform2f(u('uC'), x, y);
              gl.uniform1f(u('uR'), r);
              st.slice(0, 4).forEach(([, c, a], i) => gl.uniform4f(u('uC' + i), c[0] / 255, c[1] / 255, c[2] / 255, a));
              gl.uniform3f(u('uT'), st[1][0], st[2][0], st[3][0]);
              gl.bindBuffer(gl.ARRAY_BUFFER, gbuf);
              gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([x - r, y - r, x + r, y - r, x - r, y + r, x + r, y + r]),
                gl.STREAM_DRAW
              );
              const lp = gl.getAttribLocation(G, 'aPos');
              gl.enableVertexAttribArray(lp);
              gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
          },
          read() {
            const px = new Uint8Array(Wd * H * 4);
            gl.readPixels(0, 0, Wd, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
            return px;
          },
        };
      }
      function splatRenderer(canvas) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const px = {
          W: 0,
          img: null,
          u32: null,
          acc: null,
          mark: null,
          hit: new Int32Array(1 << 16),
          n: 0,
          bx0: 0,
          by0: 0,
          bx1: 0,
          by1: 0,
          dpr: 1,
        };
        const CX = new Float32Array(8);
        let glowArgs = null;
        return {
          kind: '2d',
          resize(W, d) {
            px.W = W;
            px.dpr = d;
            px.img = ctx.createImageData(W, W);
            px.u32 = new Uint32Array(px.img.data.buffer);
            px.acc = new Float32Array(W * W * 4);
            px.mark = new Uint8Array(W * W);
            px.n = 0;
            px.bx0 = px.by0 = W;
            px.bx1 = px.by1 = -1;
          },
          begin() {
            glowArgs = null;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            ctx.clearRect(0, 0, px.W, px.W);
          },
          put(col, a, x, y, z) {
            if (a > 1) a = 1;
            const d = px.dpr,
              W = px.W,
              h = z * d * 0.5,
              X = x * d,
              Y = y * d;
            const x0 = X - h,
              x1 = X + h,
              y0 = Y - h,
              y1 = Y + h;
            let i0 = Math.floor(x0),
              i1 = Math.ceil(x1) - 1,
              j0 = Math.floor(y0),
              j1 = Math.ceil(y1) - 1;
            if (i0 < 0) i0 = 0;
            if (j0 < 0) j0 = 0;
            if (i1 >= W) i1 = W - 1;
            if (j1 >= W) j1 = W - 1;
            if (i1 < i0 || j1 < j0 || i1 - i0 > 7) return;
            if (i0 < px.bx0) px.bx0 = i0;
            if (i1 > px.bx1) px.bx1 = i1;
            if (j0 < px.by0) px.by0 = j0;
            if (j1 > px.by1) px.by1 = j1;
            const ni = i1 - i0 + 1;
            for (let u = 0; u < ni; u++) {
              const i = i0 + u;
              CX[u] = ((x1 < i + 1 ? x1 : i + 1) - (x0 > i ? x0 : i)) * a;
            }
            if (px.n + 64 > px.hit.length) {
              const nh = new Int32Array(px.hit.length * 2);
              nh.set(px.hit);
              px.hit = nh;
            }
            const acc = px.acc,
              mark = px.mark,
              hit = px.hit,
              r = col[0] / 255,
              g = col[1] / 255,
              b = col[2] / 255;
            for (let j = j0; j <= j1; j++) {
              const cy = (y1 < j + 1 ? y1 : j + 1) - (y0 > j ? y0 : j);
              let k = j * W + i0;
              for (let u = 0; u < ni; u++, k++) {
                const cov = CX[u] * cy,
                  o = k << 2;
                if (mark[k] === 0) {
                  mark[k] = 1;
                  hit[px.n++] = k;
                }
                acc[o] += r * cov;
                acc[o + 1] += g * cov;
                acc[o + 2] += b * cov;
                acc[o + 3] += cov;
              }
            }
          },
          glow(x, y, r, stops) {
            glowArgs = [x, y, r, stops];
          },
          end() {
            if (px.bx1 >= px.bx0) {
              const u32 = px.u32,
                acc = px.acc,
                mark = px.mark,
                hit = px.hit,
                n = px.n;
              // One 32-bit store a pixel (ImageData is RGBA in memory: little-endian, so alpha is the high byte).
              for (let q = 0; q < n; q++) {
                const k = hit[q],
                  o = k * 4;
                let A = acc[o + 3];
                if (A > 1) A = 1;
                const f = 255 / A,
                  r = acc[o] > 1 ? 255 : acc[o] * f,
                  g = acc[o + 1] > 1 ? 255 : acc[o + 1] * f,
                  b = acc[o + 2] > 1 ? 255 : acc[o + 2] * f;
                u32[k] =
                  (((A * 255 + 0.5) << 24) |
                    ((b > 255 ? 255 : b + 0.5) << 16) |
                    ((g > 255 ? 255 : g + 0.5) << 8) |
                    (r > 255 ? 255 : r + 0.5)) >>>
                  0;
                acc[o] = acc[o + 1] = acc[o + 2] = acc[o + 3] = 0;
                mark[k] = 0;
              }
              ctx.putImageData(px.img, 0, 0, px.bx0, px.by0, px.bx1 - px.bx0 + 1, px.by1 - px.by0 + 1);
              for (let q = 0; q < n; q++) u32[hit[q]] = 0;
              px.n = 0;
              px.bx0 = px.by0 = px.W;
              px.bx1 = px.by1 = -1;
            }
            if (glowArgs) {
              const [x, y, r, st] = glowArgs,
                d = px.dpr;
              ctx.setTransform(d, 0, 0, d, 0, 0);
              ctx.globalCompositeOperation = 'lighter';
              const g = ctx.createRadialGradient(x, y, 0, x, y, r);
              for (const [at, c, a] of st) g.addColorStop(at, 'rgba(' + c.join(',') + ',' + a + ')');
              ctx.fillStyle = g;
              ctx.fillRect(x - r, y - r, r * 2, r * 2);
              ctx.globalCompositeOperation = 'source-over';
            }
          },
          // Rows top to bottom (the WebGL read is bottom up; read()'s users only count and hash).
          read() {
            return ctx.getImageData(0, 0, px.W, px.W).data;
          },
        };
      }

      function engine(canvas, onSwap) {
        let seed = 11;
        const rnd = () => {
          seed |= 0;
          seed = (seed + 0x6d2b79f5) | 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const C = [0, 0],
          C2 = [0, 0];
        // spec.ui.look.core.renderer: webgl, falling back to the 2D buffer when WebGL is missing or its context is lost
        // (D-134); or 2d. A canvas that held a WebGL context cannot give a 2D one, so the fallback takes a fresh canvas.
        let rd = null,
          sized = false;
        const toTwoD = why => {
          const old = canvas,
            c2 = canvas.cloneNode();
          if (canvas.parentNode) canvas.replaceWith(c2);
          canvas = c2;
          rd = splatRenderer(canvas);
          sized = false;
          note('renderer', '2d', why);
          if (onSwap) onSwap(canvas, old);
        };
        if (L.renderer !== '2d') rd = glRenderer(canvas, () => toTwoD('webgl context lost'));
        if (!rd) {
          if (canvas.__gl) toTwoD('webgl unavailable');
          else rd = splatRenderer(canvas);
        }
        const st = {
          size: 0,
          p: { ...MOOD.idle },
          t: rnd() * 100,
          rot: 0,
          ptr: null,
          lx: 0,
          ly: 0,
          n: { x: 0, y: 0 },
          s: { x: 0, y: 0, vx: 0, vy: 0 },
          wt: rnd() * 50,
          lookT: 4,
          look: null,
          wisps: [],
          ripples: [],
          wAcc: 0,
          alertT: 0,
          ringShown: 0,
          gid: sig.gid,
          vid: sig.vid,
          fired: new Set(),
        };
        const build = size => {
          seed = 11;
          st.size = size;
          st.wisps = [];
          st.ripples = [];
          const sc = Math.max(B.scaleMin, Math.min(B.scaleMax, size / B.refSizePx));
          st.minis = [];
          for (let i = 0; i < B.filaments; i++)
            st.minis.push({
              ang: (i / B.filaments) * 6.283 + (rnd() - 0.5) * 0.5,
              len: 0.24 + rnd() * 0.18,
              w1: 0.3 + rnd() * 0.6,
              p1: rnd() * 6.28,
              p2: rnd() * 6.28,
              w3: 0.6 + rnd(),
              p3: rnd() * 6.28,
              dir: rnd() < 0.5 ? -1 : 1,
              col: rnd(),
            });
          st.miniP = Math.max(B.filamentPointsMin, Math.round(B.filamentPoints * sc));
          st.ribbons = [];
          for (let b = 0; b < B.bands; b++)
            st.ribbons.push({
              ax: 1.1 + (rnd() - 0.5) * 1.4,
              az: (b / B.bands) * Math.PI + (rnd() - 0.5) * 0.4,
              speed: (0.25 + rnd() * 0.35) * (rnd() < 0.5 ? -1 : 1),
              width: 0.7 + rnd() * 0.6,
              phase: rnd() * 6.28,
              col: b / Math.max(1, B.bands - 1),
            });
          st.silkM = Math.max(B.pointsPerBandMin, Math.round(B.pointsPerBand * sc));
        };
        const spawnW = (x, y, vx, vy, life, kind) => {
          if (st.wisps.length > L.wisps.max) return;
          st.wisps.push({ x, y, vx, vy, age: 0, life, sz: 0.7 + rnd() * 1.1, c: kind, tr: [] });
        };
        function frame(dt, o) {
          const size = o.size,
            still = !!o.still,
            dpr = Math.min(B.canvasDprMax, window.devicePixelRatio || 1);
          if (st.size !== size || canvas.width !== Math.round(size * dpr)) {
            canvas.width = Math.round(size * dpr);
            canvas.height = Math.round(size * dpr);
            build(size);
            sized = false;
          }
          if (!sized) {
            rd.resize(canvas.width, canvas.width / size);
            sized = true;
          }
          const R = size * L.radiusOfSize,
            cx0 = size / 2,
            cy0 = size / 2,
            dot = Math.max(1, size / 190),
            turbK = L.turbulence,
            follow = !!o.follow;
          const lvl = follow ? down.level : 0,
            noWisps = L.stepDown.order.slice(0, lvl).includes('wisps') || !L.wisps.on,
            half = L.stepDown.order.slice(0, lvl).includes('halfPoints');
          // A word just spoken may shed a wisp; a send ripples; a done bursts once, at its contraction.
          if (follow && sig.vid !== st.vid) {
            st.vid = sig.vid;
            if (!noWisps && !still && rnd() < L.speech.wispChance) {
              const a = rnd() * 6.283,
                v = R * (0.5 + rnd() * 0.4);
              spawnW(
                cx0 + st.n.x + Math.cos(a) * R * 0.15,
                cy0 + st.n.y + Math.sin(a) * R * 0.15,
                Math.cos(a) * v,
                Math.sin(a) * v,
                0.9 + rnd() * 0.6,
                rnd() < 0.5 ? 1 : 0
              );
            }
          }
          const gs = follow ? sig.gestures : [];
          for (const g of gs) {
            if (g.id > st.gid) {
              st.gid = Math.max(st.gid, g.id);
              if (g.name === 'send' && !still)
                st.ripples.push({ el: 0, seed: rnd() * 20, c: 'ring', x: cx0 + st.n.x, y: cy0 + st.n.y });
            }
            if (g.name === 'done' && g.el >= 0.42 && !st.fired.has(g.id) && !still) {
              st.fired.add(g.id);
              if (!noWisps)
                for (let i = 0; i < 14; i++) {
                  const a = rnd() * 6.283,
                    v = R * (0.8 + rnd() * 0.7);
                  spawnW(
                    cx0 + st.s.x + Math.cos(a) * R * 0.3,
                    cy0 + st.s.y + Math.sin(a) * R * 0.3,
                    Math.cos(a) * v,
                    Math.sin(a) * v,
                    1 + rnd() * 0.7,
                    rnd() < 0.5 ? 1 : 0
                  );
                }
            }
          }
          const target = MOOD[follow ? sig.mood : o.mood || 'idle'] || MOOD.idle,
            p = st.p,
            k = still ? 1 : 1 - Math.exp(-dt * L.moodEase);
          for (const key in target) p[key] += (target[key] - p[key]) * k;
          // Gestures: the blend for this core (a glance at a target is measured from this core's centre).
          const angOf = g => {
            if (g.name !== 'glance') return 0;
            if (g.target && g.target.isConnected) {
              const a = canvas.getBoundingClientRect(),
                b = g.target.getBoundingClientRect();
              return MO.glanceAngle(
                { x: b.left + b.width / 2, y: b.top + b.height / 2 },
                { x: a.left + a.width / 2, y: a.top + a.height / 2 }
              );
            }
            return g.angle || 0;
          };
          const gb = still
            ? MO.blendAll([], L)
            : MO.blendAll(
                gs.map(g => ({ name: g.name, el: g.el, angle: angOf(g) })),
                L
              );
          let gBright = gb.bright + (still && Date.now() < sig.flashUntil ? 0.25 : 0);
          let tx = gb.dx * R,
            ty = gb.dy * R;
          if (L.rubato.on && !still && follow) {
            st.wt += dt * (0.45 + 0.9 * n2(st.t * 0.07, 3.3));
            const amp = R * L.rubato.amp * p.roam;
            tx += (n2(st.wt * 0.35, 1.7) - 0.5) * 2 * amp;
            ty += (n2(5.1, st.wt * 0.31) - 0.5) * 1.6 * amp;
            st.lookT -= dt;
            if (st.lookT <= 0 && !gs.length) {
              const [lo, hi] = L.rubato.glanceEverySec;
              st.lookT = lo + rnd() * (hi - lo);
              st.look = { a: rnd() * 6.283, el: 0 };
            }
            if (st.look) {
              const Lk = st.look,
                e = (Lk.el += dt),
                env = Math.min(1, e / 0.5) * (e > 1.2 ? Math.max(0, 1 - (e - 1.2) / 0.9) : 1);
              tx += Math.cos(Lk.a) * R * L.rubato.glanceReach * env * p.roam;
              ty += Math.sin(Lk.a) * R * L.rubato.glanceReach * env * p.roam;
              if (e > L.rubato.glanceSec) st.look = null;
            }
          }
          if (st.ptr != null && L.pointer.on) {
            tx += Math.cos(st.ptr) * R * L.pointer.reach;
            ty += Math.sin(st.ptr) * R * L.pointer.reach;
          }
          if (still) {
            st.n = { x: tx, y: ty };
            st.s = { x: tx, y: ty, vx: 0, vy: 0 };
          } else {
            const r = MO.nucleusStep(st.n, st.s, { x: tx, y: ty }, L.nucleus, dt);
            st.n = r.n;
            st.s = r.s;
          }
          const NX = cx0 + st.n.x,
            NY = cy0 + st.n.y,
            SX = cx0 + st.s.x,
            SY = cy0 + st.s.y;
          const ox = f => NX + (SX - NX) * f,
            oy = f => NY + (SY - NY) * f;
          st.t += dt * gb.flow;
          st.rot += dt * (0.05 + p.spin + gb.spin);
          const vAmp = follow ? (still ? (sig.mood === 'speaking' ? L.speech.floor : 0) : sig.env.env) : 0;
          const t = st.t,
            breath = 1 + 0.05 * Math.sin(t * 1.1 * (0.5 + p.pulse)),
            bright = Math.max(0.08, p.bright + gBright);
          const hasPtr = st.ptr != null,
            glanceOn = gb.lean > 0.001,
            kl = still ? 1 : 1 - Math.exp(-dt * 3.5);
          const tA = glanceOn ? gb.leanAngle : hasPtr ? st.ptr : Math.PI / 2,
            tS = glanceOn ? Math.max(gb.lean, p.lean) : hasPtr ? Math.max(L.pointer.leanMin, p.lean) : p.lean;
          st.lx += (Math.cos(tA) * tS - st.lx) * kl;
          st.ly += (Math.sin(tA) * tS - st.ly) * kl;
          const lx = st.lx,
            ly = st.ly,
            hueExp = Math.pow(2, (0.5 - p.hue) * 2.4),
            open = p.len * gb.len * breath * (1 + vAmp * L.speech.swell),
            tint = gb.tint;
          const mixRGB = m => {
            m = Math.pow(Math.max(0, Math.min(1, m)), hueExp);
            const c = [0, 1, 2].map(i => PAL.a[i] + (PAL.b[i] - PAL.a[i]) * m);
            return tint > 0.01 ? c.map((v, i) => v + (PAL.coral[i] - v) * tint * 0.45) : c;
          };
          const css = c => 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
          rd.begin();
          // The Silk body: five bands of points, each a slowly turning ring that widens when she speaks. Each band's tilt is
          // a fixed rotation, so a point's place is linear in its offset across the band: the rotation is worked out once
          // per band position and stepped for its six points (the same picture, a third of the arithmetic).
          {
            const M = half ? Math.max(8, Math.round(st.silkM / 2)) : st.silkM,
              Wn = B.widthPoints,
              gy = st.rot * 0.4,
              cgy = Math.cos(gy),
              sgy = Math.sin(gy),
              flowK = 0.4 + 0.6 * Math.abs(p.flow),
              curlD = R * 0.03 * turbK;
            const dxN = SX - NX,
              dyN = SY - NY,
              lxR = lx * R * 0.2,
              lyR = ly * R * 0.2,
              iR8 = 1 / (R * 0.8),
              rad = R * B.radius * open,
              wid = R * B.bandWidth * (0.8 + 0.4 * p.width) * (1 + vAmp * B.bandWidthSwell),
              zcK = R * 0.035 * p.curl,
              aK = bright * 0.5;
            const VS = [],
              VA = [];
            for (let q = 0; q < Wn; q++) {
              const v = (q / (Wn - 1)) * 2 - 1;
              VS.push(v);
              VA.push(0.3 + 0.7 * Math.abs(v));
            }
            for (const b of st.ribbons) {
              const ci = mixRGB(b.col);
              const cax = Math.cos(b.ax),
                sax = Math.sin(b.ax),
                caz = Math.cos(b.az),
                saz = Math.sin(b.az);
              // d/dZ of (X3, Y2, Z3) for this band
              const dX2 = sax * saz,
                dY2 = -sax * caz,
                dX3 = dX2 * cgy + cax * sgy,
                dZ3 = -dX2 * sgy + cax * cgy;
              const bw = wid * b.width,
                sp = t * b.speed * flowK + b.phase;
              for (let i = 0; i < M; i++) {
                const ph = (i / M) * 6.2832 + sp;
                const rr = rad * (1 + 0.05 * Math.sin(3 * ph + t * 1.1 + b.phase));
                const w = bw * (0.5 + 0.5 * Math.sin(2 * ph + t * 1.3 + b.phase));
                const flowB = 0.6 + 0.4 * Math.sin(ph * 2 - t * p.flow * 3 + b.phase),
                  zc = Math.sin(ph * 4 + t * 2 + b.phase) * zcK;
                const X = Math.cos(ph) * rr,
                  Y = Math.sin(ph) * rr;
                const Y1 = Y * cax - zc * sax,
                  Z1 = Y * sax + zc * cax,
                  X2 = X * caz - Y1 * saz,
                  Y2c = X * saz + Y1 * caz,
                  X3c = X2 * cgy + Z1 * sgy,
                  Z3c = -X2 * sgy + Z1 * cgy;
                // One curl sample per band position: the six points across the band move together.
                let cxo = 0,
                  cyo = 0;
                if (turbK > 0.01) {
                  curl(((NX + dxN * 0.9 + X3c) / R) * 1.5 + 5.3, ((NY + dyN * 0.9 + Y2c) / R) * 1.5 - t * 0.2, C);
                  cxo = C[0] * curlD;
                  cyo = C[1] * curlD;
                }
                const aB = aK * flowB;
                for (let q = 0; q < Wn; q++) {
                  const zo = VS[q] * w,
                    Z3 = Z3c + zo * dZ3,
                    depth = (Z3 * iR8 + 1) / 2;
                  const a = aB * (0.15 + 0.85 * depth) * VA[q];
                  if (a < 0.02) continue;
                  const f = 0.8 + 0.2 * depth;
                  rd.put(
                    ci,
                    a,
                    NX + dxN * f + X3c + zo * dX3 + lxR * depth + cxo,
                    NY + dyN * f + Y2c + zo * dY2 + lyR * depth + cyo,
                    dot * (0.7 + 0.6 * depth)
                  );
                }
              }
            }
          }
          // The progress ring follows her body and dims with her.
          const rp = follow ? sig.ring : -1;
          st.ringShown += ((rp >= 0 ? 1 : 0) - st.ringShown) * (still ? 1 : 1 - Math.exp(-dt * 2.5));
          if (st.ringShown > 0.02) {
            const prog = Math.max(0, Math.min(1, rp < 0 ? 0 : rp)),
              Rr = R * L.ring.radius,
              n = Math.max(L.ring.pointsMin, Math.round(size * L.ring.pointsPerPx)),
              head = prog * n,
              dim = st.ringShown * Math.min(1, bright / 0.85);
            const ci = PAL.ring;
            for (let q = 0; q < n; q++) {
              const th = -Math.PI / 2 + (q / n) * 6.2832,
                cs = Math.cos(th),
                sn = Math.sin(th);
              const r = Rr * (1 + 0.014 * (n2(cs * 1.6 + t * 0.3, sn * 1.6 - t * 0.25) - 0.5) * 2 * (0.4 + turbK));
              const on = q < head,
                wave = 0.45 + 0.55 * n2(cs * 2.4 - t * 0.5, sn * 2.4 + t * 0.4),
                near = on ? Math.exp(-(head - q) / (n * 0.05)) : 0;
              const a = dim * (on ? 0.2 + 0.3 * wave + 0.55 * near : 0.05);
              if (a < 0.015) continue;
              rd.put(ci, a, SX + cs * r, SY + sn * r, dot * (on ? 1.1 + 0.9 * near : 0.9));
            }
            if (!noWisps && !still && prog > 0 && rnd() < dt * 5 * dim) {
              const th = -Math.PI / 2 + prog * 6.2832;
              spawnW(
                SX + Math.cos(th) * Rr,
                SY + Math.sin(th) * Rr,
                -Math.sin(th) * R * 0.25,
                Math.cos(th) * R * 0.25,
                0.8 + rnd() * 0.6,
                4
              );
            }
          }
          // Wisps: about three a second at 40%, carried off by two-octave curl noise with short trails.
          if (!still && !noWisps) {
            st.wAcc += dt * L.wisps.perSecond * p.spark * (1 + vAmp * 1.2);
            const [l0, l1] = L.wisps.lifeSec;
            while (st.wAcc >= 1) {
              st.wAcc -= 1;
              const a = rnd() * 6.283,
                r0 = R * (0.25 + 0.5 * rnd()),
                v = R * 0.15;
              spawnW(
                SX + Math.cos(a) * r0,
                SY + Math.sin(a) * r0,
                Math.cos(a) * v,
                Math.sin(a) * v,
                l0 + rnd() * (l1 - l0),
                rnd() < 0.6 ? 0 : rnd() < 0.5 ? 1 : 2
              );
            }
          }
          if (!still && st.wisps.length) {
            const wcol = [PAL.spark, mixRGB(0.1), mixRGB(0.9), PAL.ring, PAL.ring];
            const ta = R * (0.2 + 0.75 * turbK) * (0.6 + 0.4 * Math.min(1.5, Math.abs(p.flow) + 0.3)),
              kv = Math.min(1, dt * 2.4),
              op = L.wisps.opacity,
              tp = L.wisps.trailPoints * 2;
            for (let i = st.wisps.length - 1; i >= 0; i--) {
              const w = st.wisps[i];
              w.age += dt;
              if (w.age > w.life || (noWisps && w.c !== 3)) {
                st.wisps.splice(i, 1);
                continue;
              }
              const dx = w.x - SX,
                dy = w.y - SY,
                d = Math.hypot(dx, dy) || 1;
              curl((w.x / R) * 1.25 + 7.7, (w.y / R) * 1.25 - t * 0.3, C);
              curl((w.x / R) * 2.7 - 3.3, (w.y / R) * 2.7 + t * 0.5, C2);
              const out = R * 0.16 * (0.5 + 0.5 * Math.abs(p.flow));
              w.vx += ((dx / d) * out + (C[0] + 0.5 * C2[0]) * ta - w.vx) * kv;
              w.vy += ((dy / d) * out + (C[1] + 0.5 * C2[1]) * ta - w.vy) * kv;
              w.x += w.vx * dt;
              w.y += w.vy * dt;
              w.tr.push(w.x, w.y);
              if (w.tr.length > tp) w.tr.splice(0, 2);
              const strength =
                w.c === 3 ? 0.85 : w.c === 4 ? 0.35 * Math.min(1, bright / 0.85) : op * Math.min(1, p.spark + 0.25);
              const life = Math.pow(Math.sin((Math.PI * w.age) / w.life), 0.8) * strength;
              const ci = wcol[w.c],
                nn = w.tr.length / 2;
              for (let q = 0; q < nn; q++) {
                const fq = (q + 1) / nn,
                  a = life * fq * fq;
                if (a < 0.015) continue;
                rd.put(ci, a, w.tr[q * 2], w.tr[q * 2 + 1], dot * w.sz * (0.5 + 0.8 * fq) * 1.15);
              }
            }
          }
          // The ripple: a wobbling ring pushed by the same field, breaking into strands (a send, or alert's pulse).
          if (!still) {
            st.alertT += dt;
            if (p.ring > 0.4 && st.alertT > L.ripple.alertEverySec) {
              st.alertT = 0;
              st.ripples.push({ el: 0, seed: rnd() * 20, c: 'alert', x: NX, y: NY });
            }
            for (let i = st.ripples.length - 1; i >= 0; i--) {
              const rg = st.ripples[i];
              rg.el += dt;
              const dur = L.ripple.durationSec;
              if (rg.el > dur) {
                st.ripples.splice(i, 1);
                continue;
              }
              const e = rg.el / dur,
                rr = R * (0.3 + e * 1.15),
                A = Math.pow(1 - e, 1.3) * 0.9,
                n = Math.max(80, Math.round(size * 0.75));
              const ci = rg.c === 'alert' ? mixRGB(0.95) : PAL.ring;
              for (let q = 0; q < n; q++) {
                const th = (q / n) * 6.2832,
                  cs = Math.cos(th),
                  sn = Math.sin(th);
                const seg = n2(cs * 2.6 + rg.seed * 3, sn * 2.6 + rg.el * 2.5),
                  a = A * Math.pow(seg, 1.8) * 1.7;
                if (a < 0.02) continue;
                const wob = (n2(cs * 1.4 + rg.seed, sn * 1.4 + rg.el * 1.6) - 0.5) * 2,
                  r = rr * (1 + 0.1 * wob * (0.35 + e) * (0.4 + turbK));
                let x = rg.x + cs * r,
                  y = rg.y + sn * r;
                curl((x / R) * 1.6 + rg.seed, (y / R) * 1.6 + rg.el * 0.8, C);
                const dk = R * 0.08 * e * (0.3 + turbK);
                x += C[0] * dk;
                y += C[1] * dk;
                const z = dot * 1.25;
                rd.put(ci, a, x, y, z);
                if (seg > 0.62) rd.put(ci, a * 0.4, x - cs * dot * 2.2, y - sn * dot * 2.2, z);
              }
              if (!noWisps && rnd() < dt * 26 * (1 - e)) {
                const th = rnd() * 6.283,
                  x = rg.x + Math.cos(th) * rr,
                  y = rg.y + Math.sin(th) * rr,
                  v = R * 0.35;
                spawnW(
                  x,
                  y,
                  Math.cos(th) * v - Math.sin(th) * v * 0.5,
                  Math.sin(th) * v + Math.cos(th) * v * 0.5,
                  0.8 + rnd() * 0.7,
                  3
                );
              }
            }
          }
          // v3's short inner filaments, then the hot core on top.
          {
            const P = half ? Math.max(6, Math.round(st.miniP / 2)) : st.miniP;
            for (const f of st.minis) {
              const ci = mixRGB(f.col);
              const a0 = f.ang + st.rot * 1.2 * f.dir,
                Lf = R * f.len * (0.85 + 0.15 * open) * (1 + vAmp * 0.1),
                bend = Math.sin(t * f.w1 + f.p1) * p.curl * 0.7;
              for (let j = 0; j < P; j++) {
                const s = (j + 1) / P,
                  ang = a0 + bend * s * s + Math.sin(s * 5 + t * f.w3 + f.p3) * 0.15 * s;
                const a =
                  Math.pow(1 - s, 0.8) *
                  bright *
                  (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s * 13 - t * p.flow * 4.2 + f.p2))) *
                  0.95;
                if (a < 0.02) continue;
                const r = s * Lf,
                  ff = s * 0.35,
                  x = ox(ff) + Math.cos(ang) * r + lx * R * 0.12 * s,
                  y = oy(ff) + Math.sin(ang) * r + ly * R * 0.12 * s;
                rd.put(ci, a, x, y, dot);
              }
            }
          }
          // The hot core on top: a radial glow, white at the centre into the glow blue.
          const cr = R * B.coreRadius * gb.len * (1 + 0.12 * Math.sin(t * 2.2 * p.pulse) + vAmp * B.coreSwell);
          rd.glow(NX, NY, cr, [
            [0, PAL.core, 0.95 * Math.min(1, bright + 0.1)],
            [0.16, PAL.core, Math.min(1, 0.6 * bright)],
            [0.42, PAL.glow, Math.min(1, 0.26 * bright)],
            [1, PAL.glow, 0],
          ]);
          rd.end();
        }
        // A still frame (reduced motion, held cores) is drawn from the same start every time, so one mood is one picture.
        const t0 = st.t,
          wt0 = st.wt;
        const reset = () => {
          Object.assign(st, {
            p: { ...MOOD.idle },
            t: t0,
            rot: 0,
            lx: 0,
            ly: 0,
            n: { x: 0, y: 0 },
            s: { x: 0, y: 0, vx: 0, vy: 0 },
            wt: wt0,
            lookT: 4,
            look: null,
            wAcc: 0,
            alertT: 0,
            ringShown: 0,
          });
          if (st.size) build(st.size);
        };
        return {
          frame,
          reset,
          get canvas() {
            return canvas;
          },
          get renderer() {
            return rd.kind;
          },
          read: () => rd.read(),
          setPointer: a => {
            st.ptr = a;
          },
          state: () => ({
            n: { ...st.n },
            s: { ...st.s },
            wisps: st.wisps.length,
            ripples: st.ripples.length,
            points: st.silkM,
            mood: { ...st.p },
          }),
        };
      }

      const cores = new Set();
      let raf = 0,
        last = 0;
      // A core counts as on screen only when some of it shows: one tucked to zero width (the top bar's while her stage is up) is skipped.
      const io = window.IntersectionObserver
        ? new IntersectionObserver(
            es =>
              es.forEach(e => {
                if (e.target.__core) e.target.__core.vis = e.intersectionRatio > 0;
              }),
            { threshold: [0, 0.01, 0.5, 1] }
          )
        : null;
      function tick(ts) {
        raf = requestAnimationFrame(tick);
        const dt = last ? Math.min(0.05, Math.max(0, (ts - last) / 1000)) : 0,
          frameMs = last ? ts - last : null;
        last = ts;
        if (document.hidden) return;
        // Shared signals advance once a frame: the speech envelope, then each gesture (gone once it has settled).
        sig.env = MO.envelopeStep(sig.env, { talking: sig.talking, word: sig.word }, dt, L);
        sig.word = null;
        for (const g of sig.gestures) g.el += dt;
        sig.gestures = sig.gestures.filter(g => g.el < L.gestures[g.name].durationSec);
        const t0 = performance.now();
        let drew = false;
        for (const o of cores) {
          if (!o.vis || !o.el.isConnected || (o.when && !o.when())) continue;
          const mood = o.follow ? sig.mood : o.mood;
          if (o.still || reduce) {
            const k =
              o.size +
              mood +
              (o.follow && Date.now() < sig.flashUntil ? '!' : '') +
              (o.follow ? Math.round(sig.ring * 50) : '');
            if (o.k !== k) {
              o.k = k;
              o.eng.reset();
              for (let i = 0; i < 45; i++) o.eng.frame(1 / 30, { size: o.size, mood, still: true, follow: o.follow });
              drew = true;
            }
            continue;
          }
          o.k = '';
          o.acc += dt;
          if (o.size < 128 && o.acc < 1 / 31) continue;
          o.eng.frame(o.acc, { size: o.size, mood, follow: o.follow });
          o.acc = 0;
          drew = true;
        }
        const drawMs = performance.now() - t0;
        if (frameMs != null) {
          frames.push(frameMs);
          if (frames.length > 1200) frames.shift();
          if (drew) {
            draws.push(drawMs);
            if (draws.length > 1200) draws.shift();
          }
          const lvl = down.level;
          down = MO.stepDownStep(down, frameMs, ts, L);
          if (down.level !== lvl) note('stepDown', L.stepDown.order[down.level - 1]);
        }
      }
      function make(size, opt = {}) {
        const el = document.createElement('span');
        el.className = 'ev-av';
        el.setAttribute('aria-hidden', 'true');
        el.style.setProperty('--s', size + 'px');
        const cv0 = document.createElement('canvas');
        el.append(cv0);
        // What a canvas carries: its core (for the observer) and, on her stage, the pointer lean. A 2D fallback after a
        // lost WebGL context brings a fresh canvas, which gets the same.
        const attach = cv => {
          cv.__core = core;
          if (io) io.observe(cv);
          if (opt.pointer) {
            cv.addEventListener('pointermove', e => {
              const r = cv.getBoundingClientRect();
              core.eng.setPointer(Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2));
            });
            cv.addEventListener('pointerleave', () => core.eng.setPointer(null));
          }
        };
        const core = {
          el,
          size,
          mood: opt.mood || 'idle',
          follow: !!opt.follow,
          still: !!opt.still,
          when: opt.when || null,
          acc: 0,
          k: '',
          vis: true,
          eng: null,
        };
        core.eng = engine(cv0, (cv, old) => {
          if (!core.eng) return;
          if (io) io.unobserve(old);
          attach(cv);
          core.k = '';
        });
        core.resize = px => {
          px = Math.round(px);
          if (px === core.size) return;
          core.size = px;
          el.style.setProperty('--s', px + 'px');
          core.k = '';
        };
        attach(core.eng.canvas);
        cores.add(core);
        if (!raf) raf = requestAnimationFrame(tick);
        return core;
      }
      // The page API (D-134). A glance takes a direction ('left', 'right', 'up', 'down', an angle) or a target element.
      function gesture(name, detail) {
        if (!L.gestures[name]) throw new Error('unknown gesture ' + name);
        const g = { id: ++sig.gid, name, el: 0 };
        if (name === 'glance') {
          if (detail && detail.nodeType === 1) g.target = detail;
          else g.angle = MO.glanceAngle(detail);
        }
        sig.gestures.push(g);
        if (reduce) sig.flashUntil = Date.now() + 400;
        note(
          'gesture',
          name,
          name === 'glance' ? (g.target ? g.target.id || g.target.className || 'element' : detail) : null
        );
      }
      // speak(word, {emphasis}) or speak(word, true): the Build plan names the second argument as emphasis either way.
      function speak(word, o = {}) {
        const em = o === true || !!(o && o.emphasis);
        sig.talking = true;
        sig.vid++;
        sig.word = Math.max(sig.word || 0, MO.wordVoice(word, em, L.speech));
        note('speak', String(word).slice(0, 40), em ? 'emphasis' : null);
      }
      function speechEnd() {
        if (sig.talking) note('speechEnd');
        sig.talking = false;
      }
      function setMood(m) {
        if (!MOOD[m]) return;
        if (m !== sig.mood) note('mood', m);
        sig.mood = m;
      }
      function setRing(p) {
        sig.ring = typeof p === 'number' && p >= 0 ? Math.min(1, p) : -1;
      }
      const stats = () => ({
        frames: frames.slice(),
        draws: frames.length ? draws.slice() : [],
        level: down.level,
        steps: L.stepDown.order.slice(0, down.level),
        envelope: { ...sig.env },
        gestures: sig.gestures.map(g => ({ name: g.name, el: g.el })),
        mood: sig.mood,
        ring: sig.ring,
        reduce,
        log: log.slice(),
      });
      const resetStats = () => {
        frames.length = 0;
        draws.length = 0;
      };
      // The last frame a core drew, as numbers: lit pixels, the mean colour of what is lit, a hash (harness checks).
      function sample(i = 0) {
        const c = [...cores][i];
        if (!c) return null;
        const d = c.eng.read();
        let lit = 0,
          r = 0,
          g = 0,
          b = 0,
          h = 0;
        for (let k = 0; k < d.length; k += 4) {
          if (d[k + 3] > 20) {
            lit++;
            r += (d[k] * 255) / d[k + 3];
            g += (d[k + 1] * 255) / d[k + 3];
            b += (d[k + 2] * 255) / d[k + 3];
          }
          h = (h * 31 + d[k] + d[k + 1] * 7 + d[k + 2] * 13 + d[k + 3]) >>> 0;
        }
        return {
          lit,
          r: lit ? r / lit : 0,
          g: lit ? g / lit : 0,
          b: lit ? b / lit : 0,
          hash: h,
          renderer: c.eng.renderer,
        };
      }
      return { make, gesture, speak, speechEnd, setMood, setRing, stats, resetStats, sample, cores: () => [...cores] };
    })();
    window.EVApp.core = CORE;
    const coreStage = () => MO_SIZE(innerWidth, 'idle');
    function MO_SIZE(w, state) {
      return window.EVMotion.coreSize(w, state, EV_SPEC.ui.look.core.sizes);
    }
    const heroOrb = CORE.make(coreStage().px, { follow: true, pointer: true });
    $('hero').append(heroOrb.el);
    // The top bar's core is tucked away (styles.css) while her stage core is up or a session runs; then it does not draw.
    const topOrb = CORE.make(40, {
      follow: true,
      when: () => !document.body.matches('.on-ev.captions, .on-ev.opening, .on-ev.in-session, .on-ev.core-big'),
    });
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

