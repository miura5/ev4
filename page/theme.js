/* B-271 (D-268, D-269, D-273): every colour on the page, generated in LCH from a base, her Ember accent and a
   contrast setting (30, 60 or 100; default 60). B-539 (D-392): the default is round 4's neutral theme, r4.css's values
   word for word at contrast 60 (R4 below); a tuner's other recipe runs the generator. Ported as written from the Ember LCH theme canvas's Shipped.dc.html
   (lch2hex, genTheme, mixHex, the Ember variant and SEM); no hex token is stored anywhere else. The build inlines this
   file into the shell's head (index.src.html, THEME), so the page paints its theme before styles.css arrives; System's
   Contrast control runs apply() again. Light and dark stay CSS: the system's scheme, or the stored toggle (D-211). */
(function (root) {
  'use strict';
  // LCH (D50) to sRGB hex.
  var lch2hex = function (L, C, H) {
    var h = (H * Math.PI) / 180,
      a = C * Math.cos(h),
      b = C * Math.sin(h),
      e = 216 / 24389,
      k = 24389 / 27;
    var fy = (L + 16) / 116,
      fx = fy + a / 500,
      fz = fy - b / 200;
    var xr = Math.pow(fx, 3) > e ? Math.pow(fx, 3) : (116 * fx - 16) / k,
      yr = L > k * e ? Math.pow(fy, 3) : L / k,
      zr = Math.pow(fz, 3) > e ? Math.pow(fz, 3) : (116 * fz - 16) / k;
    var X = xr * 0.96422,
      Y = yr,
      Z = zr * 0.82521;
    var lin = [
      3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z,
      -0.9787684 * X + 1.9161415 * Y + 0.033454 * Z,
      0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z,
    ];
    return (
      '#' +
      lin
        .map(function (v) {
          v = Math.max(0, Math.min(1, v));
          v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
          return Math.round(v * 255)
            .toString(16)
            .padStart(2, '0');
        })
        .join('')
    );
  };
  var chan = function (hex) {
    return [1, 3, 5].map(function (i) {
      return parseInt(hex.slice(i, i + 2), 16);
    });
  };
  var lum = function (hex) {
    var c = chan(hex).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  var cratio = function (a, b) {
    var x = lum(a),
      y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  var mixHex = function (a, b, t) {
    var x = chan(a),
      y = chan(b);
    return (
      '#' +
      x
        .map(function (v, i) {
          return Math.max(0, Math.min(255, Math.round(v + (y[i] - v) * t)))
            .toString(16)
            .padStart(2, '0');
        })
        .join('')
    );
  };
  // The Ember variant (Matt's pick, D-268) and the coded hues at one lightness and chroma (D-269).
  var EMBER = { base: { h: 70, c: 3.2 }, accL: 48, acc: { h: 52, c: 62 }, acc2: { h: 32, c: 56 } };
  var SEM = { green: 145, yellow: 82, red: 28, blue: 265, violet: 305 };
  var CONTRASTS = [30, 60, 100];
  // B-505 (D-372): the text-colour washes (D-370's four steps), the coded washes' strength (today's --warn-bg and
  // --bad-bg), and each mode's lift: [y, blur, alpha] for --shadow-1 (a small float), -2 (popover, menu) and -3 (sheet,
  // dialog), at today's values in both modes until polish makes the light lift its own (black at a lower alpha).
  var WASH = [0.03, 0.06, 0.1, 0.18];
  var CODED_WASH = 0.13;
  var LIFT = {
    light: [
      [6, 18, 0.14],
      [12, 32, 0.14],
      [24, 60, 0.22],
    ],
    dark: [
      [6, 18, 0.14],
      [12, 32, 0.14],
      [24, 60, 0.22],
    ],
  };
  // Her two faces (D-266): the Dial Arc's solid front and halftone back, per theme, at every contrast (r4.css --av1, --av2).
  var HER = { light: ['#b5530f', '#a8402f'], dark: ['#e0743a', '#cf5a45'] };
  // B-539, B-540 (D-392, D-395): round 4's neutral themes, word for word from docs/design/ui-polish/r4.css, made with
  // the recipe base {h:270, c:0.6}. They are contrast 60; 30 and 100 step the surfaces and the quiet text from these.
  // --faint is the one value the floors move: r4's #8b8b92 (light) and #7d7d86 (dark) read under D-273's 4.6:1, so it
  // darkens (lightens in dark) from r4's value only as far as the floor needs. Coded colours: r4's --ok, --warn, --bad,
  // --info, --violet, --teal and --slate; the kind palette (tokens.css --kind-*) is drawn from them.
  var R4KEYS =
    'chrome bg surface raise hover sel line line2 text quiet faint her onHer ok warn bad info violet teal slate'.split(
      ' '
    );
  var r4 = function (hexes, wash, pop) {
    var o = { wash: wash, pop: pop };
    hexes.split(' ').forEach(function (x, i) {
      o[R4KEYS[i]] = '#' + x;
    });
    return o;
  };
  var R4 = {
    light: r4(
      'f3f3f4 fbfbfb ffffff f4f4f5 efeff0 e9e9eb ececee dedee1 1c1c1f 5f5f66 8b8b92 b6541d ffffff 2c9a5a a87a0c cc4b45 2f6fde 7c5cdb 1f8f8a 5a6b86',
      '12%',
      '0 4px 16px rgba(0,0,0,.08),0 0 0 1px rgba(0,0,0,.04)'
    ),
    dark: r4(
      '101012 151517 1b1b1e 202024 242428 2a2a2f 232327 303036 ececef a3a3ab 7d7d86 e0743a 1a0d05 4cc27e d6a53c ec6a62 6b9cf5 a189f2 45bdb6 93a3be',
      '18%',
      '0 6px 24px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.05)'
    ),
  };
  var NEUTRAL = { h: 270, c: 0.6 };
  var CODED = { ok: 'green', warn: 'yellow', bad: 'red', info: 'blue', violet: 'violet', teal: 'teal', slate: 'slate' };

  // B-506: the tuner's recipe, the inputs besides mode and contrast: the base's hue and chroma and her accent's.
  // Ember's own (D-268) when none is given; her second face follows her accent by the same turn and strength.
  // B-539: the base is round 4's neutral (D-392); a tuner's other base or accent still runs the LCH generator.
  var RECIPE = { base: { h: NEUTRAL.h, c: NEUTRAL.c }, accent: { h: EMBER.acc.h, c: EMBER.acc.c } };
  var num = function (v, lo, hi, d) {
    v = Number(v);
    return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
  };
  var recipeOf = function (r) {
    r = r || {};
    var b = r.base || {},
      a = r.accent || {};
    return {
      base: { h: num(b.h, 0, 360, RECIPE.base.h), c: num(b.c, 0, 20, RECIPE.base.c) },
      accent: { h: num(a.h, 0, 360, RECIPE.accent.h), c: num(a.c, 0, 100, RECIPE.accent.c) },
    };
  };
  var tints = function (T) {
    T.tint = function (hex) {
      return mixHex(T.surface, hex, T.tintMix);
    };
    T.tintLine = function (hex) {
      return mixHex(T.line2, hex, 0.35);
    };
    return T;
  };
  var isR4 = function (R) {
    return R.base.h === NEUTRAL.h && R.base.c === NEUTRAL.c && R.accent.h === EMBER.acc.h && R.accent.c === EMBER.acc.c;
  };
  // Move a text colour toward the text until it holds the floor on every ground.
  var hold = function (x, text, grounds, floor) {
    while (
      grounds.some(function (g) {
        return cratio(x, g) < floor;
      })
    )
      x = mixHex(x, text, 0.05);
    return x;
  };
  /** Round 4's theme (B-539): r4.css at contrast 60, the neutral steps spread or drawn in by contrast. */
  var r4Theme = function (mode, k, accent2) {
    var A = R4[mode],
      q = Math.min(1, 1.4 - (2 * k) / 3),
      T = Object.assign({}, A, { mode: mode, k: k, accent: A.her, accent2: accent2, onAccent: A.onHer, sem: {} });
    ['chrome', 'raise', 'hover', 'sel', 'line', 'line2'].forEach(function (n) {
      T[n] = mixHex(A.bg, A[n], k / 0.6);
    });
    var G = [T.bg, T.chrome, T.surface, T.hover, T.raise, T.sel];
    T.quiet = hold(mixHex(A.text, A.quiet, q), A.text, G, 4.5);
    T.faint = hold(hold(mixHex(A.text, A.faint, q), A.text, [T.chrome, T.surface], 4.6), A.text, G, 4.5);
    for (var c in CODED) T.sem[CODED[c]] = A[c];
    T.tintMix = mode === 'dark' ? 0.16 : 0.11;
    return tints(T);
  };

  /** Every token of one theme: mode 'light' or 'dark', contrast 30 to 100, and the tuner's recipe (round 4 when none). */
  var genTheme = function (mode, contrast, recipe) {
    var R = recipeOf(recipe),
      V = {
        base: R.base,
        accL: EMBER.accL,
        acc: R.accent,
        acc2: { h: EMBER.acc2.h + (R.accent.h - EMBER.acc.h), c: (EMBER.acc2.c * R.accent.c) / EMBER.acc.c },
      },
      k = Math.max(0.3, Math.min(1, (contrast || 60) / 100)),
      B = V.base,
      dark = mode === 'dark';
    if (isR4(R))
      return r4Theme(
        dark ? 'dark' : 'light',
        k,
        dark ? lch2hex(68, V.acc2.c * 0.9, V.acc2.h) : lch2hex(47, V.acc2.c, V.acc2.h)
      );
    var n = function (L, cm) {
        return lch2hex(L, B.c * (cm == null ? 1 : cm), B.h);
      },
      T = { mode: dark ? 'dark' : 'light', k: k },
      fl;
    if (!dark) {
      T.bg = n(98.2);
      T.chrome = n(98.2 - (2.2 + 2.6 * k));
      T.surface = n(99.6, 0.4);
      T.hover = n(98.2 - (3 + 3 * k));
      T.line = n(98.2 - (6 + 6 * k));
      T.line2 = n(98.2 - (11 + 9 * k));
      T.text = n(13, 1.5);
      T.quiet = n(36 - 6 * k, 1.5);
      fl = 52;
      while (cratio(n(fl, 1.5), T.chrome) < 4.6 && fl > 20) fl -= 1;
      T.faint = n(fl, 1.5);
      T.accent = lch2hex(V.accL, V.acc.c, V.acc.h);
      T.accent2 = lch2hex(47, V.acc2.c, V.acc2.h);
      T.onAccent = '#ffffff';
      T.semL = 52;
      T.semC = 54;
      T.tintMix = 0.11;
    } else {
      T.bg = n(10.5);
      T.chrome = n(10.5 - (1.5 + 2 * k));
      T.surface = n(13 + 3 * k);
      T.hover = n(14 + 4 * k);
      T.line = n(10.5 + (6 + 6 * k));
      T.line2 = n(10.5 + (11 + 9 * k));
      T.text = n(94, 0.8);
      T.quiet = n(72 + 6 * k, 0.8);
      fl = 56;
      while (cratio(n(fl, 0.8), T.surface) < 4.6 && fl < 90) fl += 1;
      T.faint = n(fl, 0.8);
      T.accent = lch2hex(70, V.acc.c * 0.92, V.acc.h);
      T.accent2 = lch2hex(68, V.acc2.c * 0.9, V.acc2.h);
      T.onAccent = n(9);
      T.semL = 72;
      T.semC = 48;
      T.tintMix = 0.16;
    }
    T.raise = mixHex(T.bg, T.hover, 0.7);
    T.sel = mixHex(T.hover, T.line, 0.6);
    T.wash = R4[T.mode].wash;
    T.pop = R4[T.mode].pop;
    T.sem = {};
    for (var s in SEM) T.sem[s] = lch2hex(T.semL, T.semC, SEM[s]);
    T.sem.teal = lch2hex(T.semL, T.semC * 0.8, 195);
    T.sem.slate = lch2hex(T.semL, T.semC * 0.35, 265);
    return tints(T);
  };

  var rgb = function (hex) {
    return chan(hex).join(',');
  };
  var rgba = function (hex, a) {
    return 'rgba(' + rgb(hex) + ',' + a + ')';
  };
  // B-505: Proprietary's names for the coded colours (D-269), from the generator's hues.
  /** The page's custom properties for one theme. The generator's names, then the names styles.css already uses, each
   *  one of them (her accent is --her until B-275 sweeps the old --accent; the meanings follow D-269's hues). */
  var vars = function (T) {
    // Ink on a green fill (a ticked box, a pressed chip): her ink when it reaches 4.5:1 on green, else the base's
    // neutral, darkened until it does (light green is mid-tone: white gives 4.2:1).
    var g = T.sem,
      ink = T.onAccent,
      L = 13;
    while (cratio(ink, g.green) < 4.5 && L >= 0) ink = lch2hex(L--, NEUTRAL.c * 1.5, NEUTRAL.h);
    // B-505 (D-372): Proprietary's generated tokens, per mode and contrast: --focus (the text colour, as every focus
    // ring draws today), the four washes of the text colour, the 1 px --ring on --line2, the three lifts, and the
    // coded colours under their Proprietary names with a wash each. Legacy's --warn, --bad, --info and --violet (a grey
    // alias) still win over these until cleanup sweeps them (D-373: the theme sits in the tokens layer).
    var ds = {
      '--focus': T.text,
      '--ring': '0 0 0 1px ' + T.line2,
      '--raise': T.raise,
      '--sel': T.sel,
      '--wash': T.wash,
      '--shadow-pop': T.pop,
    };
    WASH.forEach(function (a, i) {
      ds['--wash-' + (i + 1)] = rgba(T.text, a);
    });
    LIFT[T.mode].forEach(function (z, i) {
      ds['--shadow-' + (i + 1)] = '0 ' + z[0] + 'px ' + z[1] + 'px rgba(0,0,0,' + z[2] + ')';
    });
    for (var c in CODED) {
      ds['--' + c] = g[CODED[c]];
      ds['--' + c + '-wash'] = rgba(g[CODED[c]], CODED_WASH);
    }
    var out = {
      '--bg': T.bg,
      '--chrome': T.chrome,
      '--surface': T.surface,
      '--hover': T.hover,
      '--line': T.line,
      '--line2': T.line2,
      '--text': T.text,
      '--quiet': T.quiet,
      '--faint': T.faint,
      '--her': T.accent,
      '--her2': T.accent2,
      '--on-her': T.onAccent,
      '--av1': HER[T.mode][0],
      '--av2': HER[T.mode][1],
      '--sem-green': g.green,
      '--sem-yellow': g.yellow,
      '--sem-red': g.red,
      '--sem-blue': g.blue,
      '--sem-violet': g.violet,
      '--sunken': T.chrome,
      '--raised': T.surface,
      '--do': g.green,
      '--do-ink': ink,
      '--att': g.yellow,
      '--urg': g.red,
      '--tint': rgb(T.text),
      '--ground': rgb(T.bg),
      '--her-rgb': rgb(T.accent),
      '--do-rgb': rgb(g.green),
      '--att-rgb': rgb(g.yellow),
      '--urg-rgb': rgb(g.red),
    };
    for (var k in ds) out[k] = ds[k];
    return out;
  };
  var decl = function (o) {
    return Object.keys(o)
      .map(function (k) {
        return k + ':' + o[k];
      })
      .join(';');
  };
  var contrastOf = function (v) {
    var c = Number(v);
    return CONTRASTS.indexOf(c) >= 0 ? c : 60;
  };
  // B-505 (D-373): the cascade's layer order, as the published styles.css declares it first; said again here so the
  // order holds whichever sheet a page reads first.
  var LAYERS = '@layer reset,tokens,base,components,patterns,views,legacy;';
  /** The three blocks of one theme's declarations: dark by default, light when the system says so unless the toggle
   *  says dark, and the toggle's light (D-211's three blocks, now generated). */
  var modes = function (d, l) {
    return (
      ':root,:root[data-theme="dark"]{' +
      d +
      '}@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){' +
      l +
      '}}:root[data-theme="light"]{' +
      l +
      '}'
    );
  };
  /** The stylesheet for one contrast. B-505 (D-373): the tokens sit in the tokens layer and the ground under html and
   *  body in base, so legacy's own rules win over both as they did before layers. The colour scheme stays unlayered:
   *  the host document's :root{color-scheme:light} is unlayered, and a layered scheme would lose to it in dark. */
  var css = function (contrast, recipe) {
    var c = contrastOf(contrast);
    return (
      LAYERS +
      '@layer tokens{' +
      modes(decl(vars(genTheme('dark', c, recipe))), decl(vars(genTheme('light', c, recipe)))) +
      '}' +
      modes('color-scheme:dark', 'color-scheme:light') +
      '@layer base{:where(html,body){background:var(--bg);color:var(--text)}}'
    );
  };
  /** B-558: the window's title-bar colour is the sidebar's ground (--sunken) in each mode: one theme-color meta for the
   *  system's light and one for its dark, or both the chosen mode's when the toggle picked one. theme.js keeps them in
   *  step when data-theme changes. The wrapper's single static meta gives way to these. */
  var metaState = { contrast: null, recipe: null };
  var metas = function (doc, contrast, recipe) {
    if (!doc || !doc.head) return;
    metaState.contrast = contrast;
    metaState.recipe = recipe;
    var c = contrastOf(contrast),
      pick = doc.documentElement.getAttribute('data-theme'),
      col = { light: genTheme('light', c, recipe).chrome, dark: genTheme('dark', c, recipe).chrome };
    var old = doc.head.querySelectorAll('meta[name="theme-color"]:not([data-ev])');
    for (var i = 0; i < old.length; i++)
      (old[i].setAttribute('content', col.light), old[i].setAttribute('media', 'not all'));
    ['light', 'dark'].forEach(function (m) {
      var el = doc.head.querySelector('meta[data-ev="' + m + '"]');
      if (!el) {
        el = doc.createElement('meta');
        el.setAttribute('name', 'theme-color');
        el.setAttribute('data-ev', m);
        el.setAttribute('media', '(prefers-color-scheme: ' + m + ')');
        doc.head.appendChild(el);
      }
      el.setAttribute('content', col[pick === 'light' || pick === 'dark' ? pick : m]);
    });
    if (!doc.__evMetaWatch && typeof MutationObserver === 'function') {
      doc.__evMetaWatch = new MutationObserver(function () {
        metas(doc, metaState.contrast, metaState.recipe);
      });
      doc.__evMetaWatch.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  };
  /** Paints the theme for a contrast (and a tuner's recipe, B-506) now: one style element, placed after the stylesheet
   *  link the first time. */
  var apply = function (doc, contrast, after, recipe) {
    var el = doc.getElementById('ev-theme');
    if (!el) {
      el = doc.createElement('style');
      el.id = 'ev-theme';
      if (after && after.parentNode) after.parentNode.insertBefore(el, after.nextSibling);
      else (doc.head || doc.documentElement).appendChild(el);
    }
    el.textContent = css(contrast, recipe);
    metas(doc, contrast, recipe);
    if (contrastOf(contrast) === 60) doc.documentElement.removeAttribute('data-contrast');
    else doc.documentElement.setAttribute('data-contrast', String(contrastOf(contrast)));
    return el;
  };
  var api = {
    lch2hex: lch2hex,
    cratio: cratio,
    mixHex: mixHex,
    genTheme: genTheme,
    vars: vars,
    css: css,
    apply: apply,
    contrastOf: contrastOf,
    CONTRASTS: CONTRASTS,
    SEM: SEM,
    CODED: CODED,
    RECIPE: RECIPE,
    R4: R4,
    recipeOf: recipeOf,
    LAYERS: LAYERS,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.EVTheme = api;
    var stored = null;
    try {
      stored = root.localStorage.getItem('ev.contrast');
    } catch (e) {}
    apply(root.document, stored, root.document.currentScript);
  }
})(this);
