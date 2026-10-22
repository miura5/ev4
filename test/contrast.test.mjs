// B-204 (D-211, D-221): two warm themes from one token set; every text and shape pair passes on every ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, flatSource } from './helpers.mjs';

const C = createRequire(import.meta.url)('./harness/contrast.cjs');
const css = fs.readFileSync(path.join(ROOT, 'page', 'styles.css'), 'utf8');

/** The custom properties of the first rule whose selector is exactly sel. */
function block(sel) {
  const at = css.indexOf(sel + '{');
  assert.ok(at >= 0, `styles.css has no rule ${sel}`);
  const body = css.slice(at + sel.length + 1, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
const dark = block(':root,:root[data-theme="dark"]'),
  light = block(':root[data-theme="light"]');

test('B-204: D-211 values, one token set per theme', () => {
  const want = {
    dark: {
      bg: '#19161C',
      sunken: '#141217',
      surface: '#221E26',
      raised: '#2A2530',
      text: '#ECE8E1',
      quiet: '#B3ACA2',
      faint: '#958E85',
    },
    light: {
      bg: '#F7F2E8',
      sunken: '#EFE9DD',
      surface: '#FFFDF8',
      raised: '#FFFFFF',
      text: '#221E1A',
      quiet: '#5F5850',
      faint: '#6B6359',
    },
  };
  for (const [name, t] of [
    ['dark', dark],
    ['light', light],
  ])
    for (const [k, v] of Object.entries(want[name])) assert.equal(t['--' + k], v, `${name} --${k}`);
  // Her blue (D-214) and the three meanings, in each theme.
  assert.equal(dark['--her'], '#7AA7FF');
  assert.equal(light['--her'], '#2B5BD0');
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort(), 'both themes set the same tokens');
});

test('B-204: the system theme follows prefers-color-scheme unless the stored toggle says otherwise', () => {
  assert.match(css, /@media \(prefers-color-scheme:light\)\{:root:not\(\[data-theme="dark"\]\)\{/);
  const media = css.slice(css.indexOf('@media (prefers-color-scheme:light){'));
  const inner = media.slice(media.indexOf('{', media.indexOf(':root:not')) + 1, media.indexOf('}'));
  const t = Object.fromEntries([...inner.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  assert.deepEqual(t, light, 'the media block and the stored light theme are the same values');
  const shell = flatSource('page/index.src.html');
  assert.match(shell, /localStorage\.getItem\('ev\.theme'\)/, 'the shell reads the stored toggle before first paint');
  assert.match(shell, /<meta name="color-scheme" content="light dark">/);
});

test('B-204: every text pair passes 4.5:1 and every shape 3:1 on every ground, in both themes', () => {
  assert.deepEqual(C.judge(dark, 'dark'), []);
  assert.deepEqual(C.judge(light, 'light'), []);
  for (const k of C.TOKENS) {
    assert.ok(C.rgb(dark[k]), `dark ${k} is a solid colour`);
    assert.ok(C.rgb(light[k]), `light ${k} is a solid colour`);
  }
});

test('B-204: the check fails below the line (planted)', () => {
  const faint = { ...light, '--faint': '#9A938A' };
  const bad = C.judge(faint, 'light');
  assert.ok(bad.length && bad.every(l => /--faint/.test(l)), bad.join('; '));
  assert.ok(C.judge({ ...dark, '--her': '#3A4F80' }, 'dark').some(l => /shape --her/.test(l)));
  assert.ok(C.judge({ ...dark, '--do-ink': '#2A8F7E' }, 'dark').some(l => /ink --do-ink/.test(l)));
  assert.ok(C.judge({ ...dark, '--quiet': 'rgba(179,172,162,.6)' }, 'dark').some(l => /not a solid colour/.test(l)));
});

test('B-204: no colour is written into the stylesheet outside the theme blocks', () => {
  const themes = [
    ':root,:root[data-theme="dark"]{',
    '@media (prefers-color-scheme:light){',
    ':root[data-theme="light"]{',
  ];
  let rest = css;
  for (const t of themes) {
    const a = rest.indexOf(t);
    rest = rest.slice(0, a) + rest.slice(rest.indexOf('}', a + t.length) + 1);
  }
  rest = rest.replace(/\/\*[\s\S]*?\*\//g, '');
  // Masks and shadows are drawn in black: they carry no colour of their own.
  const hits = [...rest.matchAll(/#[0-9a-f]{3,8}\b|rgba?\((?!var\()[^)]*\)/gi)]
    .map(m => m[0])
    .filter(x => !/^#000\b|^rgba?\(0,\s*0,\s*0[,)]/i.test(x));
  assert.deepEqual(hits, []);
});
