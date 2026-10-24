/* B-271 (D-268, D-269, D-273): every colour on the page, generated in LCH from a warm-grey base, her Ember accent and a
   contrast setting (30, 60 or 100; default 60). Ported as written from the Ember LCH theme canvas's Shipped.dc.html
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
          return Math.round(v + (y[i] - v) * t)
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

  /** Every token of one theme: mode 'light' or 'dark', contrast 30 to 100. */
  var genTheme = function (mode, contrast) {
    var V = EMBER,
      k = Math.max(0.3, Math.min(1, (contrast || 60) / 100)),
      B = V.base,
      dark = mode === 'dark';
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
    T.sem = {};
    for (var s in SEM) T.sem[s] = lch2hex(T.semL, T.semC, SEM[s]);
    T.tint = function (hex) {
      return mixHex(T.surface, hex, T.tintMix);
    };
    T.tintLine = function (hex) {
      return mixHex(T.line2, hex, 0.35);
    };
    return T;
  };

  var rgb = function (hex) {
    return chan(hex).join(',');
  };
  /** The page's custom properties for one theme. The generator's names, then the names styles.css already uses, each
   *  one of them (her accent is --her until B-275 sweeps the old --accent; the meanings follow D-269's hues). */
  var vars = function (T) {
    var g = T.sem,
      ink = cratio(T.onAccent, g.green) >= cratio(T.text, g.green) ? T.onAccent : T.text;
    return {
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
  /** The stylesheet for one contrast: dark by default, light when the system says so unless the toggle says dark, and
   *  the toggle's light (D-211's three blocks, now generated). The ground under html and body has no specificity. */
  var css = function (contrast) {
    var c = contrastOf(contrast),
      d = decl(vars(genTheme('dark', c))),
      l = decl(vars(genTheme('light', c)));
    return (
      ':root,:root[data-theme="dark"]{' +
      d +
      '}@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){' +
      l +
      '}}:root[data-theme="light"]{' +
      l +
      '}:where(html,body){background:var(--bg);color:var(--text)}'
    );
  };
  /** Paints the theme for a contrast now: one style element, placed after the stylesheet link the first time. */
  var apply = function (doc, contrast, after) {
    var el = doc.getElementById('ev-theme');
    if (!el) {
      el = doc.createElement('style');
      el.id = 'ev-theme';
      if (after && after.parentNode) after.parentNode.insertBefore(el, after.nextSibling);
      else (doc.head || doc.documentElement).appendChild(el);
    }
    el.textContent = css(contrast);
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
