// B-409, release fix wave 1: a closed chat never replaces the day it lands on, and an ArtifactData restore plans no
// write to a page-only collection. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { makeActions } from '../core/actions.mjs';
import { validateAgainst } from '../core/validate.mjs';
import EVCore from '../core/evcore.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
const A = makeActions(validateAgainst, EVCore);
const tap = A.actor(spec, 'tap');

/** A store as the platform keeps it: set replaces, an update of a missing document is refused (nothing written). */
function store(initial = {}) {
  const db = JSON.parse(JSON.stringify(initial));
  const merge = (t, p) => {
    for (const [k, v] of Object.entries(p))
      t[k] = v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' ? merge(t[k], v) : v;
    return t;
  };
  return {
    db,
    run: async writes => {
      for (const w of writes) {
        if (w.op === 'set') db[w.id] = JSON.parse(JSON.stringify(w.data));
        else if (!db[w.id]) throw Object.assign(new Error('not found'), { code: 'invalid_argument' });
        else merge(db[w.id], w.data);
      }
    },
  };
}
const DAY = '2026-10-26',
  AT = '2026-10-26T20:00:00.000Z';
const HERS = { role: 'ev', text: 'A made-up reply', at: '2026-10-26T19:59:00.000Z' };
const close = (s, { before } = {}) =>
  A.closeChat({
    send: async exists => {
      const a = tap('chat-close', { thread: 'th-x', date: DAY, at: AT, exists });
      assert.ok(a.ok, a.refused);
      if (before) await before(exists);
      await s.run(a.writes);
    },
    exists: async () => !!s.db[DAY],
  });

test('B-409: closing a chat on a day already there only adds the mark', async () => {
  const s = store({ [DAY]: { schema: 4, date: DAY, messages: { m1: HERS } } });
  await close(s);
  assert.deepEqual(s.db[DAY].messages, { m1: HERS });
  assert.equal(s.db[DAY].closed['th-x'], AT);
});

test('B-409: a day with no talk is made with the mark', async () => {
  const s = store();
  await close(s);
  assert.deepEqual(s.db[DAY].messages, {});
  assert.equal(s.db[DAY].closed['th-x'], AT);
});

test('B-409: a talk day made between the look and the write keeps its messages', async () => {
  const s = store();
  // her reply makes the day just before the mark's first write lands: the update is now the right write
  let once = false;
  await close(s, {
    before: async () => {
      if (once) return;
      once = true;
      s.db[DAY] = { schema: 4, date: DAY, messages: { m1: HERS } };
    },
  });
  assert.deepEqual(s.db[DAY].messages, { m1: HERS }, 'her reply is kept');
  assert.equal(s.db[DAY].closed['th-x'], AT);
  // and when the day appears after the refused update, the mark goes on it, never a set over it
  const s2 = store();
  let refused = false;
  await A.closeChat({
    send: async exists => {
      const a = tap('chat-close', { thread: 'th-x', date: DAY, at: AT, exists });
      if (exists && !refused) {
        refused = true;
        try {
          await s2.run(a.writes);
        } finally {
          s2.db[DAY] = { schema: 4, date: DAY, messages: { m1: HERS } }; // made by another tab right after
        }
        return;
      }
      await s2.run(a.writes);
    },
    exists: async () => !!s2.db[DAY],
  });
  assert.deepEqual(s2.db[DAY].messages, { m1: HERS });
  assert.equal(s2.db[DAY].closed['th-x'], AT);
});
