// B-113: the look pass covers every view of every tab at Matt's sizes, and a view without a screenshot fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, flatSource } from './helpers.mjs';

const V = createRequire(import.meta.url)('./harness/views.cjs');
const html = fs.readFileSync(path.join(ROOT, 'page', 'index.src.html'), 'utf8');

test('B-113, B-203: the look pass shoots every view of every tab at the twelve sizes, the phone, 735, 1706 and 2560 first', () => {
  assert.deepEqual(
    V.SIZES.map(s => s.tag),
    [
      '375x667',
      '390x844',
      '430x932',
      '390x450',
      '560x830',
      '735x830',
      '960x1000',
      '1280x800',
      '1470x830',
      '1920x1080',
      '1706x1240',
      '2560x1240',
    ]
  );
  assert.deepEqual(V.FIRST, ['390x844', '735x830', '1706x1240', '2560x1240']);
  assert.deepEqual(
    V.viewsOf(html).map(v => v.id),
    [
      'ev',
      'today',
      'study-review',
      'study-practice',
      'study-plan',
      'progress-readiness',
      'progress-weak',
      'record-sessions',
      'record-dates',
      'record-journal',
      'record-news',
      'record-library',
      'system',
    ]
  );
  const all = V.viewsOf(html).flatMap(v => V.SIZES.map(s => V.shotName(v, s)));
  assert.equal(all.length, 156);
  assert.deepEqual(V.missingShots(all, html), []);
  assert.match(
    flatSource('test/harness/look.cjs'),
    /viewsOf\(fs\.readFileSync\(path\.join\(pageDir, 'index\.html'\)/,
    'the look pass takes its views from the built page'
  );
  assert.match(flatSource('tools/check.mjs'), /missingShots\(files,/, 'check holds the look pass to them');
});

test('B-113: a view added to the page without a screenshot fails', () => {
  const shots = V.viewsOf(html).flatMap(v => V.SIZES.map(s => V.shotName(v, s)));
  const planted = html.replace(
    '<button type="button" data-v="plan" aria-pressed="false">Plan</button>',
    '<button type="button" data-v="plan" aria-pressed="false">Plan</button><button type="button" data-v="cards" aria-pressed="false">Cards</button>'
  );
  assert.notEqual(planted, html);
  const missing = V.missingShots(shots, planted);
  assert.equal(missing.length, 12);
  assert.ok(
    missing.every(f => f.startsWith('look-study-cards-')),
    missing.join(', ')
  );
  const tab = html.replace('data-tab="system"', 'data-tab="system"><span data-tab="labs"></span');
  assert.deepEqual(V.missingShots(shots, tab).slice(0, 1), ['look-labs-375x667.png']);
});
