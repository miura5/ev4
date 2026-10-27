// B-418 (D-339): the Worker's limits on /api/claude, over an in-memory SQLite standing in for D1 (as pwa-save does) and
// a stand-in for the Claude API: the hourly and daily token ceilings, counted from the API's usage numbers and kept in
// D1, refused with a plain sentence and no API call; and read-along's limits, new text only and one read per 75 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../pwa/worker.js';
import { HOUR_TOKENS, DAY_TOKENS, READ_GAP_MS, ceilingsOf, tokensOf, ceilingProblem, readOf } from '../pwa/claude.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));

function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(path.join(ROOT, 'pwa/schema.sql'), 'utf8'));
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async () => sql.prepare(q).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...args).changes) } }),
  });
  return { prepare: q => stmt(q), sql };
}

/** The Worker with a stand-in Claude API answering `usage` tokens per call; `sent` counts the calls that reached it. */
async function withApi(usage, fn, vars = {}) {
  const env = {
    EV_TOKEN: 't',
    ANTHROPIC_API_KEY: 'k',
    DB: fakeD1(),
    ASSETS: { fetch: () => new Response('') },
    ...vars,
  };
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: '{}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: usage - 10, output_tokens: 10 },
      }),
      { status: 200 }
    );
  };
  const ask = async (extra = {}) => {
    const r = await worker.fetch(
      new Request('https://ev.example/api/claude', {
        method: 'POST',
        headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], ...extra }),
      }),
      env
    );
    return { status: r.status, body: await r.json() };
  };
  const usage_ = async () =>
    (
      await worker.fetch(
        new Request('https://ev.example/api/claude/usage', { headers: { authorization: 'Bearer t' } }),
        env
      )
    ).json();
  try {
    await fn({ ask, sent, env, usage: usage_ });
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('B-418: tokens are counted from the API’s usage numbers, kept in D1 and readable at /api/claude/usage', async () => {
  assert.equal(tokensOf({ usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 } }), 125);
  assert.equal(tokensOf({}), 0);
  await withApi(1000, async ({ ask, usage, env }) => {
    assert.equal((await ask()).status, 200);
    assert.equal((await ask()).status, 200);
    const u = await usage();
    assert.equal(u.hour, 2000);
    assert.equal(u.day, 2000);
    assert.deepEqual(u.limits, { hour: HOUR_TOKENS, day: DAY_TOKENS });
    const rows = env.DB.sql.prepare('SELECT tokens, calls FROM claude_usage').all();
    assert.deepEqual(
      rows.map(r => ({ ...r })),
      [{ tokens: 2000, calls: 2 }],
      'one row for the hour, added to'
    );
  });
});

test('B-418: past the hourly ceiling an ask is refused with a plain sentence, and nothing reaches the API', async () => {
  await withApi(
    600,
    async ({ ask, sent }) => {
      assert.equal((await ask()).status, 200);
      assert.equal((await ask()).status, 200); // 1,200 of 1,000: this one went, the next does not
      const r = await ask();
      assert.equal(r.status, 429);
      assert.equal(r.body.code, 'ceiling');
      assert.equal(r.body.scope, 'hour');
      assert.match(r.body.error, /^E\.V\. has used this hour’s Claude allowance, so asking Claude pauses until \d/);
      assert.equal(sent.length, 2, 'the refused ask never reached the API');
    },
    { CLAUDE_HOUR_TOKENS: '1000', CLAUDE_DAY_TOKENS: '5000' }
  );
});

test('B-418: past the daily ceiling an ask is refused, whatever the hour', async () => {
  await withApi(
    600,
    async ({ ask, sent, env }) => {
      // earlier today's hours: rows of the same Central day, other clock hours
      const now = Date.now();
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(now));
      env.DB.sql
        .prepare('INSERT INTO claude_usage (hour, day, tokens, calls) VALUES (?, ?, ?, 3)')
        .run(Math.floor(now / 3600e3) - 1000, day, 5000);
      const r = await ask();
      assert.equal(r.status, 429);
      assert.equal(r.body.scope, 'day');
      assert.equal(r.body.error, 'E.V. has used today’s Claude allowance, so asking Claude pauses until midnight.');
      assert.equal(sent.length, 0);
    },
    { CLAUDE_HOUR_TOKENS: '1000', CLAUDE_DAY_TOKENS: '5000' }
  );
  // the ceilings: about twice a heavy hour and four times a heavy day, and only a whole number overrides them
  assert.deepEqual(ceilingsOf({}), { hour: HOUR_TOKENS, day: DAY_TOKENS });
  assert.deepEqual(ceilingsOf({ CLAUDE_HOUR_TOKENS: 'x', CLAUDE_DAY_TOKENS: '-1' }), {
    hour: HOUR_TOKENS,
    day: DAY_TOKENS,
  });
  assert.equal(ceilingProblem({ hour: 0, day: 0 }, { hour: 1, day: 1 }), null);
});

test('B-418: a read-along read goes only on new text, at most once per 75 s per note', async () => {
  assert.equal(READ_GAP_MS, spec.constants.studyWatch.commentGapSeconds * 1e3, 'the Worker holds the spec’s gap');
  assert.equal(readOf({ note: 'n-1', h: '12-abcdef01' }).note, 'n-1');
  assert.equal(typeof readOf({ note: 'a/b', h: 'x' }), 'string');
  await withApi(100, async ({ ask, sent, env }) => {
    const read = h => ({ read: { note: 'n-20261027-a', h } });
    assert.equal((await ask(read('10-aaaaaaaa'))).status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].read, undefined, 'the read mark stays on the Worker');
    // the same text again: refused, whenever it comes
    env.DB.sql.prepare('UPDATE claude_reads SET at = at - ?').run(READ_GAP_MS * 10);
    const same = await ask(read('10-aaaaaaaa'));
    assert.equal(same.status, 409);
    assert.equal(same.body.code, 'unchanged');
    // new text within 75 s of the last read: refused
    env.DB.sql.prepare('UPDATE claude_reads SET at = ?').run(Date.now() - 1000);
    const soon = await ask(read('20-bbbbbbbb'));
    assert.equal(soon.status, 429);
    assert.equal(soon.body.code, 'too_soon');
    assert.ok(soon.body.retry_after_ms > 0 && soon.body.retry_after_ms <= READ_GAP_MS);
    assert.equal(sent.length, 1, 'neither refused read reached the API');
    // new text after 75 s: it goes, and the mark moves
    env.DB.sql.prepare('UPDATE claude_reads SET at = ?').run(Date.now() - READ_GAP_MS);
    assert.equal((await ask(read('20-bbbbbbbb'))).status, 200);
    assert.equal(sent.length, 2);
    assert.equal(env.DB.sql.prepare('SELECT h FROM claude_reads').get().h, '20-bbbbbbbb');
    // another note keeps its own mark; an ask with no read mark (a chat, a check) is held only by the ceilings
    assert.equal((await ask({ read: { note: 'n-other', h: '20-bbbbbbbb' } })).status, 200);
    assert.equal((await ask()).status, 200);
    assert.equal((await ask({ read: { note: '../x', h: '1' } })).status, 400);
    assert.equal(sent.length, 4);
  });
});

test('B-418 review: a failed API call gives the read back, so the same text is read on the next try; a throw is a 502', async () => {
  await withApi(100, async ({ ask }) => {
    const stub = globalThis.fetch;
    const read = { read: { note: 'n-20261027-b', h: '40-cccccccc' } };
    // an overloaded answer: passed through, and the mark is put back
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { type: 'overloaded_error' } }), { status: 529 });
    assert.equal((await ask(read)).status, 529);
    // fetch itself throws: a JSON 502, and the mark is put back again
    globalThis.fetch = async () => {
      throw new Error('network down');
    };
    const thrown = await ask(read);
    assert.equal(thrown.status, 502);
    assert.match(thrown.body.error, /could not be reached/);
    // the same text, straight after: not "unchanged", not "too soon": read now
    globalThis.fetch = stub;
    assert.equal((await ask(read)).status, 200);
    // and once read, the same text is unchanged
    assert.equal((await ask(read)).status, 409);
  });
});
