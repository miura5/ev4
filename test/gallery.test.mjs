// B-506 (D-371, D-383): the Gallery is staging's only. Its parts (page/app/89-gallery.js, page/ds/gallery.css) are in
// staging's app.js and styles.css, the stylesheet in the views layer, and in none of live's; it reads no record.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { buildPages, loadSchemas, STAGING_ONLY, appSource } from '../tools/build.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
const pages = buildPages({ root: ROOT, spec, schemas: loadSchemas(ROOT), release: 'v' + spec.specVersion });
const part = fs.readFileSync(path.join(ROOT, 'page/app/89-gallery.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'page/ds/gallery.css'), 'utf8');

test('B-506: the Gallery is in staging’s app.js and styles.css and in none of live’s', () => {
  assert.deepEqual(STAGING_ONLY, ['page/app/89-gallery.js', 'page/ds/gallery.css']);
  assert.ok(pages.staging['app.js'].includes('const GALLERY = '), 'staging carries the Gallery');
  assert.ok(pages.staging['styles.css'].includes('@layer views{\n/* ---- page/ds/gallery.css */\n' + css));
  for (const marker of ['GALLERY', 'galOpen', 'data-gal-sec', 'galleryAsked'])
    assert.ok(!pages.live['app.js'].includes(marker), 'live app.js: ' + marker);
  assert.ok(!pages.live['styles.css'].includes('.gal{') && !/\bgal-/.test(pages.live['styles.css']), 'live styles.css');
  // live is the staging bundle less the Gallery's parts, nothing else
  assert.equal(appSource(ROOT, 'live'), appSource(ROOT, 'staging').replace(part, ''));
});

test('B-506: the Gallery reads and writes no record, and opens only on staging', () => {
  // the page's state, writes, runs, the record and the runtime: none of them is named
  for (const re of [/(^|[^\w.])S\./m, /\bwrite\(/, /\brun\(/, /\bdb\./, /\buse\(/, /\bACT\./, /subscribe/])
    assert.doesNotMatch(part, re);
  assert.match(part, /EV_SPEC\.target === 'staging'/);
  // a section caption for each of the seven, in plain words, and a slot for each of the 16 components
  for (const sec of ['tuner', 'colour', 'type', 'space', 'motion', 'components', 'patterns'])
    assert.match(part, new RegExp(`galSec\\(\\s*'${sec}'`), sec);
  const names = [...part.matchAll(/\[\s*'([a-z]+)',\s*'([A-Z][a-z]+)',\s*'B-50[78]'/g)].map(m => m[2]);
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
  ]);
});
