// B-506 (D-371, D-383), D-388: the Gallery is staging's only. Its parts (page/app/89-gallery.js, each component's
// page/app/89-gallery-NN-<name>.js, page/ds/gallery.css) are in staging's app.js and styles.css, the stylesheet last in
// the views layer, and in none of live's; it reads no record.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { buildPages, loadSchemas, stagingOnly, appSource, styleParts } from '../tools/build.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
const pages = buildPages({ root: ROOT, spec, schemas: loadSchemas(ROOT), release: 'v' + spec.specVersion });
// every Gallery part (89-gallery.js and each component's 89-gallery-NN-<name>.js), joined in build order
const part = fs
  .readdirSync(path.join(ROOT, 'page/app'))
  .filter(f => /^89-gallery[\w-]*\.js$/.test(f))
  .sort()
  .map(f => fs.readFileSync(path.join(ROOT, 'page/app', f), 'utf8'))
  .join('');
const css = fs.readFileSync(path.join(ROOT, 'page/ds/gallery.css'), 'utf8');

test('B-506: the Gallery is in staging’s app.js and styles.css and in none of live’s', () => {
  // D-388: a rule, so a component's Gallery file is staging-only the moment it exists
  for (const p of ['page/app/89-gallery.js', 'page/app/89-gallery-01-button.js', 'page/app/89-gallery-16-message.js'])
    assert.ok(stagingOnly(p), p);
  assert.ok(stagingOnly('page/ds/gallery.css'));
  for (const p of [
    'page/app/01-ui.js',
    'page/app/01-ui-01-button.js',
    'page/app/90-render.js',
    'page/ds/components/01-button.css',
    'page/ds/views/today.css',
    'page/ds/views/legacy-carry.css',
  ])
    assert.ok(!stagingOnly(p), p);
  assert.ok(pages.staging['app.js'].includes('const GALLERY = '), 'staging carries the Gallery');
  assert.ok(pages.staging['styles.css'].includes('@layer views{\n/* ---- page/ds/gallery.css */\n' + css));
  for (const marker of ['GALLERY', 'galOpen', 'data-gal-sec', 'galleryAsked'])
    assert.ok(!pages.live['app.js'].includes(marker), 'live app.js: ' + marker);
  assert.ok(!pages.live['styles.css'].includes('.gal{') && !/\bgal-/.test(pages.live['styles.css']), 'live styles.css');
  // live is the staging bundle less every Gallery part, nothing else
  const galParts = fs
    .readdirSync(path.join(ROOT, 'page/app'))
    .filter(f => /^89-gallery[\w-]*\.js$/.test(f))
    .sort();
  assert.ok(appSource(ROOT, 'staging').includes(part), 'staging carries every Gallery part, in order');
  assert.equal(galParts.length, 19, 'the Gallery and one file per component (D-388)');
  assert.equal(
    appSource(ROOT, 'live'),
    galParts.reduce(
      (src, f) => src.replace(fs.readFileSync(path.join(ROOT, 'page/app', f), 'utf8'), ''),
      appSource(ROOT, 'staging')
    )
  );
  for (const f of galParts)
    assert.ok(!pages.live['app.js'].includes(fs.readFileSync(path.join(ROOT, 'page/app', f), 'utf8')), f);
  // gallery.css is the last of the views layer on staging, and live has no part of it
  const views = styleParts(ROOT, 'staging').filter(([l]) => l === 'views');
  assert.deepEqual(views.at(-1), ['views', 'page/ds/gallery.css']);
  assert.ok(!styleParts(ROOT, 'live').some(([, f]) => f === 'page/ds/gallery.css'));
});

test('B-506: the Gallery reads and writes no record, and opens only on staging', () => {
  // the page's state, writes, runs, the record and the runtime: none of them is named
  for (const re of [/(^|[^\w.])S\./m, /\bwrite\(/, /\brun\(/, /\bdb\./, /\buse\(/, /\bACT\./, /subscribe/])
    assert.doesNotMatch(part, re);
  assert.match(part, /EV_SPEC\.target === 'staging'/);
  // a section caption for each of the seven, in plain words, and a slot for each of the 18 components (B-515 lane 1 added Table and Chart)
  for (const sec of ['tuner', 'colour', 'type', 'space', 'motion', 'components', 'patterns'])
    assert.match(part, new RegExp(`galSec\\(\\s*'${sec}'`), sec);
  const names = [...part.matchAll(/\[\s*'([a-z]+)',\s*'([A-Z][a-z]+)',\s*'B-5(?:0[78]|15)'/g)].map(m => m[2]);
  assert.deepEqual(names, [
    'Button',
    'Badge',
    'Chip',
    'Segmented',
    'Line',
    'Fold',
    'Card',
    'Notice',
    'Toast',
    'Sheet',
    'Popover',
    'Field',
    'Choice',
    'Meter',
    'Presence',
    'Message',
    'Table',
    'Chart',
  ]);
});
