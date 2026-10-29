// B-502 (D-370): the token audit runs and reports every family. It is a report, never a gate, so no count is pinned.
// B-501 (D-372, D-379): Proprietary's frozen tokens reach the published stylesheet ahead of today's rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { audit } from '../tools/token-audit.mjs';
import { buildPages, loadSchemas } from '../tools/build.mjs';

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

test('B-502: the audit of page/styles.css runs and returns every family, as text and as --json', () => {
  const tool = path.join(ROOT, 'tools', 'token-audit.mjs');
  const json = JSON.parse(execFileSync(process.execPath, [tool, '--json'], { encoding: 'utf8' }));
  assert.equal(json.file, 'page/styles.css');
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

test('B-501: the published styles.css is page/ds/tokens.css then page/styles.css, and the tokens declare every scale', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
  const pages = buildPages({ root: ROOT, spec, schemas: loadSchemas(ROOT), release: 'v' + spec.specVersion });
  const tokens = fs.readFileSync(path.join(ROOT, 'page', 'ds', 'tokens.css'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT, 'page', 'styles.css'), 'utf8');
  for (const target of ['live', 'staging']) assert.equal(pages[target]['styles.css'], tokens + '\n' + styles, target);
  for (const name of ['--fs-1', '--fs-7', '--sp-3', '--r-md', '--wash-1', '--shadow-2', '--elev-3', '--z-overlay'])
    assert.match(tokens, new RegExp(name + ':'), name);
  // D-379: five durations, three easings
  const durs = [...tokens.matchAll(/--dur-\d:(\d+)ms/g)].map(m => Number(m[1]));
  assert.deepEqual(durs, [80, 140, 160, 280, 420]);
  for (const e of ['--ease-out', '--ease-in', '--ease-std']) assert.match(tokens, new RegExp(e + ':cubic-bezier'), e);
  // every type size scales with Matt's text size
  for (const m of tokens.matchAll(/--fs-\d:([^;]+);/g)) assert.match(m[1], /var\(--ts\)/);
});
