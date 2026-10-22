// B-204 (D-211, D-221): every text and shape colour the page paints, held to WCAG contrast on every ground of both
// themes: text 4.5:1, shapes 3:1. The pairs are named here once; the look pass reads the tokens the built page
// computes in each theme (light and dark, by prefers-color-scheme and by the stored toggle) and judges them with judge().
const GROUNDS = ['--bg', '--sunken', '--surface', '--raised'];
// Words: his text, the quieter two, and the three meanings plus her blue, which each also colour words (D-150).
const TEXT = ['--text', '--quiet', '--faint', '--do', '--att', '--urg', '--her'];
// Shapes: ticks, bars, dots, her flower: the meanings and her blue, at 3:1.
const SHAPES = ['--do', '--att', '--urg', '--her'];
// Ink on a solid fill: the primary button's text on its ground, a done fill's ink on teal.
const INK = [
  ['--bg', '--text'],
  ['--do-ink', '--do'],
];
const MIN = { text: 4.5, shape: 3 };

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
/** tokens: { '--bg': '#19161C', ... } as one theme computes them. Returns the failing pairs, each one line. */
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
  for (const g of GROUNDS) {
    for (const t of TEXT) pair(t, g, MIN.text, 'text');
    for (const s of SHAPES) pair(s, g, MIN.shape, 'shape');
  }
  for (const [fg, bg] of INK) pair(fg, bg, MIN.text, 'ink');
  return out;
}
const TOKENS = [...new Set([...GROUNDS, ...TEXT, ...SHAPES, ...INK.flat()])];
module.exports = { GROUNDS, TEXT, SHAPES, INK, MIN, TOKENS, rgb, ratio, judge };
