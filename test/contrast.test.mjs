// B-271 (D-268, D-269, D-273): every colour comes from the LCH generator; at contrast 60 it gives the hand-off's tables
// to the hex, and every contrast in both modes holds D-273's floors. B-204's system-following toggle stays (D-211).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, flatSource } from './helpers.mjs';

const C = createRequire(import.meta.url)('./harness/contrast.cjs');
const T = C.load();
const css = fs.readFileSync(path.join(ROOT, 'page', 'styles.css'), 'utf8');

test("B-271: at contrast 60 the generator gives hand-off 1's token and colour tables to the hex", () => {
  const want = {
    light: {
      bg: '#fef9f4',
      chrome: '#f3eee9',
      surface: '#fffefc',
      hover: '#f0ebe6',
      line: '#e2ded9',
      line2: '#cfcbc6',
      text: '#26211b',
      quiet: '#514b45',
      faint: '#706963',
      accent: '#b6541d',
      accent2: '#bc4741',
      onAccent: '#ffffff',
    },
    dark: {
      bg: '#1f1c18',
      chrome: '#1a1713',
      surface: '#282521',
      hover: '#2c2824',
      line: '#34302c',
      line2: '#433f3b',
      text: '#f1ede9',
      quiet: '#bdbab6',
      faint: '#918d8a',
      accent: '#f4905b',
      accent2: '#f48478',
      onAccent: '#1c1915',
    },
  };
  const coded = {
    light: { green: '#208e43', yellow: '#997613', red: '#ca5554', blue: '#0382d9', violet: '#916ac9' },
    dark: { green: '#6bc37b', yellow: '#cfab57', red: '#ff908a', blue: '#72b6ff', violet: '#c7a0f9' },
  };
  for (const mode of ['light', 'dark']) {
    const t = T.genTheme(mode, 60);
    for (const [k, v] of Object.entries(want[mode])) assert.equal(t[k], v, `${mode} ${k}`);
    assert.deepEqual({ ...t.sem }, coded[mode], `${mode} coded colours`);
  }
});

test('B-271: every contrast in both modes holds D-273 (text 4.5, faint 4.6, her ink 4.5, coded 3:1 on surface)', () => {
  for (const c of T.CONTRASTS)
    for (const mode of ['light', 'dark']) {
      const v = T.vars(T.genTheme(mode, c));
      assert.deepEqual(C.judge(v, `${mode} ${c}`), []);
      for (const k of C.TOKENS) assert.ok(C.rgb(v[k]), `${mode} ${c} ${k} is a solid colour`);
    }
  // contrast steps the neutrals apart and nothing else
  const lo = T.genTheme('light', 30),
    hi = T.genTheme('light', 100);
  assert.notEqual(lo.line2, hi.line2);
  assert.equal(lo.accent, hi.accent);
  assert.equal(T.contrastOf('100'), 100);
  assert.equal(T.contrastOf('45'), 60, 'anything else is the default');
  assert.equal(T.contrastOf(null), 60);
});

test('B-271: the check fails below the line (planted)', () => {
  const light = T.vars(T.genTheme('light', 60)),
    dark = T.vars(T.genTheme('dark', 60));
  const bad = C.judge({ ...light, '--faint': '#8a837c' }, 'light');
  assert.ok(bad.length && bad.every(l => /--faint/.test(l)), bad.join('; '));
  assert.ok(C.judge({ ...dark, '--on-her': '#ffffff' }, 'dark').some(l => /ink --on-her/.test(l)));
  assert.ok(C.judge({ ...light, '--sem-yellow': '#d9c27a' }, 'light').some(l => /coded --sem-yellow/.test(l)));
  assert.ok(C.judge({ ...dark, '--quiet': 'rgba(179,172,162,.6)' }, 'dark').some(l => /not a solid colour/.test(l)));
});

test('B-271: both modes set the same tokens; the system scheme rules unless the stored toggle says otherwise', () => {
  const out = T.css(60);
  const block = sel => {
    const at = out.indexOf(sel + '{');
    assert.ok(at >= 0, `the theme has no rule ${sel}`);
    const body = out.slice(at + sel.length + 1, out.indexOf('}', at));
    return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):([^;]+)/g)].map(m => [m[1], m[2]]));
  };
  const dark = block(':root,:root[data-theme="dark"]'),
    media = block('@media (prefers-color-scheme:light){:root:not([data-theme="dark"])'),
    light = block(':root[data-theme="light"]');
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort());
  assert.deepEqual(media, light, 'the media block and the stored light theme are the same values');
  assert.equal(dark['--bg'], '#1f1c18');
  assert.equal(light['--bg'], '#fef9f4');
  const shell = flatSource('page/index.src.html');
  assert.match(shell, /localStorage\.getItem\('ev\.theme'\)/, 'the shell reads the stored toggle before first paint');
  assert.match(shell, /<script>\{\{THEME\}\}<\/script>/, 'the shell runs the generator in its head');
  assert.match(shell, /<meta name="color-scheme" content="light dark">/);
  // B-303: System's Preferences card builds its switches in script (the shell's budget); the sidebar's are in the shell
  assert.match(
    flatSource('page/app/50-system.js'),
    /\['contrast', 'Contrast', 'c', \[\['30'\], \['60'\], \['100'\]\]\]/,
    'Preferences has Contrast'
  );
  assert.match(
    shell,
    /id="side-contrast-seg"[\s\S]*data-c="30"[\s\S]*data-c="60"[\s\S]*data-c="100"/,
    'the sidebar has Contrast'
  );
  assert.match(fs.readFileSync(path.join(ROOT, 'page', 'theme.js'), 'utf8'), /localStorage\.getItem\('ev\.contrast'\)/);
});

test('B-271 (lint): no hex colour in page CSS or the shell outside the generator', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  // Masks and shadows are drawn in black: they carry no colour of their own.
  const hits = src =>
    [...strip(src).matchAll(/#[0-9a-f]{3,8}\b|rgba?\((?!var\()[^)]*\)/gi)]
      .map(m => m[0])
      .filter(x => !/^#000\b|^rgba?\(0,\s*0,\s*0[,)]/i.test(x));
  assert.deepEqual(hits(css), [], 'styles.css');
  assert.deepEqual(hits(fs.readFileSync(path.join(ROOT, 'page', 'index.src.html'), 'utf8')), [], 'the shell');
});
