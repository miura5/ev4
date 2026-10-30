// B-271 (D-268, D-269, D-273): the contrast floors every theme holds, at every contrast in both modes: text and quiet
// 4.5:1 on each ground they sit on, faint 4.6:1 on chrome and surface, her accent's ink 4.5:1 on it, and each coded
// colour 3:1 on surface (marks, never body text in light). The look pass reads the tokens the built page computes and
// judges them with judge(); the unit test judges the generator's own output. load() runs page/theme.js as the shell does.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TEXT_GROUNDS = ['--bg', '--chrome', '--surface', '--hover', '--raise', '--sel'];
const TEXT = ['--text', '--quiet'];
const FAINT_GROUNDS = ['--chrome', '--surface'];
const CODED = ['--sem-green', '--sem-yellow', '--sem-red', '--sem-blue', '--sem-violet'];
// Ink on a solid fill: her accent's ink on her (the primary button and send, D-273), and the ink on a green fill (a
// ticked box, a pressed chip), which is text too.
const INK = [
  ['--on-her', '--her'],
  ['--do-ink', '--do'],
];
const MIN = { text: 4.5, faint: 4.6, ink: 4.5, coded: 3 };

function rgb(c) {
  const s = String(c || '').trim();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map(x => x + x).join('') : m[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\s*\)$/i);
  if (m && (m[4] == null || Number(m[4]) >= 0.999)) return [1, 2, 3].map(i => Number(m[i]));
  return null;
}
function luminance([r, g, b]) {
  const f = v => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** tokens: { '--bg': '#1f1c18', ... } as one theme computes them. Returns the failing pairs, each one line. */
function judge(tokens, theme) {
  const out = [],
    get = k => rgb(tokens[k]);
  const pair = (fg, bg, min, kind) => {
    const a = get(fg),
      b = get(bg);
    if (!a || !b) return out.push(`${theme}: ${fg} on ${bg}: not a solid colour (${tokens[fg]} on ${tokens[bg]})`);
    const r = ratio(a, b);
    if (r < min)
      out.push(`${theme}: ${kind} ${fg} ${tokens[fg]} on ${bg} ${tokens[bg]} is ${r.toFixed(2)}:1, under ${min}:1`);
  };
  for (const g of TEXT_GROUNDS) for (const t of TEXT) pair(t, g, MIN.text, 'text');
  for (const g of FAINT_GROUNDS) pair('--faint', g, MIN.faint, 'faint');
  for (const [fg, bg] of INK) pair(fg, bg, MIN.ink, 'ink');
  for (const c of CODED) pair(c, '--surface', MIN.coded, 'coded');
  return out;
}
const TOKENS = [...new Set([...TEXT_GROUNDS, ...TEXT, '--faint', ...FAINT_GROUNDS, ...INK.flat(), ...CODED])];
/** page/theme.js as the shell runs it, without a browser: { genTheme, vars, css, ... }. */
function load() {
  const m = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'page', 'theme.js'), 'utf8'), { module: m });
  return m.exports;
}
module.exports = { TEXT_GROUNDS, TEXT, FAINT_GROUNDS, CODED, INK, MIN, TOKENS, rgb, ratio, judge, load };
