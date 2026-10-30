// B-502 (D-370): the token audit runs and reports every family. It is a report, never a gate, so no count is pinned.
// B-501 (D-372, D-379): Proprietary's frozen tokens reach the published stylesheet ahead of today's rules.
// B-505 (D-373): the published sheet declares the layer order first and wraps today's rules in legacy; page/theme.js
// generates the washes, lifts, ring, focus and coded tokens per mode and contrast, in the tokens layer.
import { gateHover } from '../tools/hover-gate.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { audit, ALL } from '../tools/token-audit.mjs';
import { buildPages, loadSchemas, LAYER_ORDER, CARRY } from '../tools/build.mjs';
import { carry } from '../tools/carry.mjs';
import { createRequire } from 'node:module';
const theme = createRequire(import.meta.url)('./harness/contrast.cjs').load(); // page/theme.js as the shell runs it

const FAMILIES = [
  'colours',
  'washes',
  'fontSizes',
  'fontWeights',
  'lineHeights',
  'letterSpacing',
  'spacing',
  'radii',
  'durations',
  'easings',
  'shadows',
  'zIndex',
  'mediaQueries',
];

test('B-502, B-515: the audit of the page/ds stylesheets runs and returns every family, as text and as --json', () => {
  const tool = path.join(ROOT, 'tools', 'token-audit.mjs');
  const json = JSON.parse(execFileSync(process.execPath, [tool, '--json'], { encoding: 'utf8' }));
  assert.equal(json.file, ALL);
  assert.deepEqual(Object.keys(json.families), FAMILIES);
  for (const k of FAMILIES) assert.ok(json.families[k].distinct > 0, k);
  assert.equal(typeof json.counts.important, 'number');
  const text = execFileSync(process.execPath, [tool], { encoding: 'utf8' });
  assert.match(text, /font sizes: \d+ distinct, \d+ uses/);
  assert.match(text, /!important: \d+/);
});

test('B-502: the audit counts distinct values per family and ignores comments', () => {
  const a = audit(`/* .x{font-size:99px} */
  .a{font-size:calc(12px * var(--ts));padding:8px 12px;border-radius:8px;transition:color .14s var(--ease);z-index:3;color:rgba(var(--tint),.06)}
  .b{font:600 calc(12px * var(--ts))/1.4 var(--sans);margin:8px;gap:4px;box-shadow:0 0 0 1px var(--line);color:var(--text) !important}
  @media (max-width:599px){.c{padding:2px}}`);
  assert.deepEqual(a.families.fontSizes.values, [{ value: '12px', uses: 2 }]);
  assert.deepEqual(
    a.families.spacing.values.map(v => v.value),
    ['8px', '12px', '4px', '2px']
  );
  assert.equal(a.families.spacing.uses, 5);
  assert.deepEqual(a.families.fontWeights.values, [{ value: '600', uses: 1 }]);
  assert.deepEqual(a.families.lineHeights.values, [{ value: '1.4', uses: 1 }]);
  assert.deepEqual(a.families.durations.values, [{ value: '.14s', uses: 1 }]);
  assert.deepEqual(a.families.easings.values, [{ value: 'var(--ease)', uses: 1 }]);
  assert.deepEqual(a.families.washes.values, [{ value: '.06', uses: 1 }]);
  assert.equal(a.families.mediaQueries.distinct, 1);
  assert.equal(a.counts.important, 1);
});

test('B-501, B-505, B-515: the published styles.css is the layer order, page/ds/tokens.css in tokens, the carry opening views; the tokens declare every scale', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
  const pages = buildPages({ root: ROOT, spec, schemas: loadSchemas(ROOT), release: 'v' + spec.specVersion });
  // B-552: each file as written, its :hover rules gated by (hover:hover) (tools/hover-gate.mjs)
  const tokens = gateHover(fs.readFileSync(path.join(ROOT, 'page', 'ds', 'tokens.css'), 'utf8'));
  const styles = gateHover(carry(fs.readFileSync(path.join(ROOT, CARRY), 'utf8')));
  assert.equal(LAYER_ORDER, '@layer reset, tokens, base, components, patterns, views;');
  for (const target of ['live', 'staging']) {
    const out = pages[target]['styles.css'];
    // nothing but a comment ahead of the order, and no rule outside a layer
    assert.equal(
      out
        .replace(/\/\*[\s\S]*?\*\//, '')
        .trimStart()
        .indexOf(LAYER_ORDER),
      0,
      target + ': the order first'
    );
    const t = out.indexOf(tokens),
      l = out.indexOf(styles);
    assert.ok(t > 0 && l > t, target + ': tokens, then the carry');
    assert.match(out.slice(0, t), /@layer tokens\{\n\/\* ---- page\/ds\/tokens\.css \*\/\n$/);
    assert.match(out.slice(0, l), /\n\}\n@layer views\{\n\/\* ---- page\/ds\/views\/legacy-carry\.css \*\/\n$/);
    assert.ok(!/@layer legacy\b/.test(out.replace(/\/\*[\s\S]*?\*\//g, '')), target + ': no legacy layer');
  }
  for (const name of ['--fs-1', '--fs-7', '--sp-3', '--r-md', '--elev-3', '--z-overlay', '--line-h', '--pad-card'])
    assert.match(tokens, new RegExp(name + ':'), name);
  // D-379: five durations, three easings
  const durs = [...tokens.matchAll(/--dur-\d:(\d+)ms/g)].map(m => Number(m[1]));
  assert.deepEqual(durs, [80, 140, 160, 280, 420]);
  for (const e of ['--ease-out', '--ease-in', '--ease-std']) assert.match(tokens, new RegExp(e + ':cubic-bezier'), e);
  // every type size scales with Matt's text size
  for (const m of tokens.matchAll(/--fs-\d:([^;]+);/g)) assert.match(m[1], /var\(--ts\)/);
});

test('B-505: theme.js generates the washes, lifts, ring, focus and coded tokens in every mode and contrast', () => {
  for (const mode of ['light', 'dark'])
    for (const c of theme.CONTRASTS) {
      const T = theme.genTheme(mode, c),
        v = theme.vars(T),
        tag = mode + ' ' + c;
      assert.equal(v['--focus'], v['--text'], tag + ': focus draws as the text colour, as today');
      assert.equal(v['--ring'], '0 0 0 1px ' + v['--line2'], tag);
      const tint = v['--tint'];
      assert.deepEqual(
        [1, 2, 3, 4].map(i => v['--wash-' + i]),
        ['.03', '.06', '.1', '.18'].map(a => `rgba(${tint},0${a})`),
        tag + ': four washes of the text colour'
      );
      assert.equal(v['--shadow-2'], '0 12px 32px rgba(0,0,0,0.14)', tag + ': popover lift at today’s value');
      for (const [name, hue] of Object.entries(theme.CODED)) {
        assert.equal(v['--' + name], T.sem[hue], tag + ' --' + name);
        assert.match(v['--' + name + '-wash'], /^rgba\(\d+,\d+,\d+,0\.13\)$/, tag + ' --' + name + '-wash');
      }
    }
  const css = theme.css(60);
  assert.ok(
    css.startsWith('@layer reset,tokens,base,components,patterns,views,legacy;@layer tokens{:root,'),
    css.slice(0, 90)
  );
  // the scheme stays unlayered (the host document's own :root{color-scheme:light} is), the ground sits in base
  const outside = css.replace(/@layer tokens\{[\s\S]*?\}\}:root\[data-theme="light"\]\{[^}]*\}\}/, '');
  assert.match(outside, /^@layer [^{]+;:root,:root\[data-theme="dark"\]\{color-scheme:dark\}/);
  assert.match(css, /@layer base\{:where\(html,body\)\{background:var\(--bg\);color:var\(--text\)\}\}$/);
});

test('B-552: hover rules are gated by (hover:hover); a mixed selector list keeps its other parts everywhere', () => {
  const out = gateHover(
    '.a:hover,.b:focus{color:red}@media (min-width:1px){.c:hover{x:y}.d{x:y}}.e{content:"{:hover}"}'
  );
  assert.equal(
    out,
    '.b:focus{color:red}@media (hover:hover){.a:hover{color:red}}@media (min-width:1px){@media (hover:hover){.c:hover{x:y}}.d{x:y}}.e{content:"{:hover}"}'
  );
});
