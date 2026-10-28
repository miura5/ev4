// B-447: a past date's panel in Today's week view said "in -1 days". Every "in N days" on the page now comes from
// E.relDay, where a past day reads as past.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const today = '2026-10-28';

test('B-447: relDay names past, today, tomorrow and future days', () => {
  assert.equal(EV.relDay('2026-10-21', today), '7 days ago');
  assert.equal(EV.relDay('2026-10-26', today), '2 days ago');
  assert.equal(EV.relDay('2026-10-27', today), 'yesterday');
  assert.equal(EV.relDay(today, today), 'today');
  assert.equal(EV.relDay('2026-10-29', today), 'tomorrow');
  assert.equal(EV.relDay('2026-10-30', today), 'in 2 days');
  assert.equal(EV.relDay('2026-11-04', today), 'in 7 days'); // across the month and the clocks' change (Nov 1)
  assert.equal(EV.relDay('2026-12-31', '2027-01-01'), 'yesterday'); // across the year
  for (const n of [-30, -2, -1, 0, 1, 2, 30]) assert.doesNotMatch(EV.relDay(EV.addDays(today, n), today), /-|in 0/);
});

test('B-447: no page file builds "in N days" itself', () => {
  const dir = path.join(ROOT, 'page/app');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /'in ' \+ \w+ \+ ' days'/, f);
  }
});
