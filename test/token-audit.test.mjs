// B-502 (D-370): the token audit runs and reports every family. It is a report, never a gate, so no count is pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { audit } from '../tools/token-audit.mjs';

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
