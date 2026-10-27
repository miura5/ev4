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

test('B-429: the read mark comes back when the answer body fails, an earlier mark is restored exactly, a newer one is kept', async () => {
  await withApi(100, async ({ ask, env }) => {
    const ok = globalThis.fetch;
    const note = 'n-20261027-c';
    const row = () => env.DB.sql.prepare('SELECT h, at FROM claude_reads WHERE note = ?').get(note);
    // the headers came, then the body failed: a JSON 502 and the mark given back (no row, as before)
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => Promise.reject(new Error('reset')) });
    const dropped = await ask({ read: { note, h: '10-aaaa' } });
    assert.equal(dropped.status, 502);
    assert.match(dropped.body.error, /could not be reached/);
    // read text A, then let the 75 s gap pass (the mark backdated); a failed read of B restores A's mark exactly
    globalThis.fetch = ok;
    assert.equal((await ask({ read: { note, h: '10-aaaa' } })).status, 200);
    env.DB.sql.prepare('UPDATE claude_reads SET at = at - 80000 WHERE note = ?').run(note);
    const before = row();
    globalThis.fetch = async () => new Response('{"error":{}}', { status: 500 });
    assert.equal((await ask({ read: { note, h: '11-bbbb' } })).status, 500);
    assert.deepEqual(row(), before);
    // a newer mark written while the call was out is not overwritten by the give-back
    globalThis.fetch = async () => {
      env.DB.sql.prepare('UPDATE claude_reads SET h = ?, at = ? WHERE note = ?').run('12-zzzz', Date.now(), note);
      return new Response('{"error":{}}', { status: 500 });
    };
    assert.equal((await ask({ read: { note, h: '13-cccc' } })).status, 500);
    assert.equal(row().h, '12-zzzz');
  });
});

test('B-429: a 2xx with a body that is not JSON still counts as read; a failed usage write still answers', async () => {
  await withApi(100, async ({ ask, env }) => {
    const note = 'n-20261027-d';
    // the Worker passes the body on as it came, so the helper's own JSON read of it fails: that is the 2xx answered
    globalThis.fetch = async () => new Response('not json', { status: 200 });
    await assert.rejects(() => ask({ read: { note, h: '10-dddd' } }), SyntaxError);
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    assert.equal((await ask({ read: { note, h: '10-dddd' } })).status, 409);
  });
  await withApi(100, async ({ ask, env, sent }) => {
    const prepare = env.DB.prepare;
    env.DB.prepare = q => {
      if (/INSERT INTO claude_usage/.test(q)) throw new Error('D1 down');
      return prepare(q);
    };
    const r = await ask();
    assert.equal(r.status, 200);
    assert.equal(sent.length, 1);
  });
});

test('B-435: the ceilings are a setting in D1: PUT /api/claude/limits changes them with no release, checked and kept', async () => {
  await withApi(100, async ({ ask, env, usage }) => {
    const call = async (method, body) => {
      const r = await worker.fetch(
        new Request('https://ev.example/api/claude/limits', {
          method,
          headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
        }),
        env
      );
      return { status: r.status, body: await r.json() };
    };
    assert.deepEqual((await call('GET')).body.limits, { hour: HOUR_TOKENS, day: DAY_TOKENS });
    assert.equal(HOUR_TOKENS, 500000);
    assert.equal(DAY_TOKENS, 1500000);
    // refused: nothing given, not a number, out of range, the hour above the day, not JSON
    for (const bad of [{}, { hour: 'lots' }, { hour: 10 }, { day: 1e9 }, { hour: 900000, day: 800000 }, 'x'])
      assert.equal((await call('PUT', bad)).status, 400, JSON.stringify(bad));
    // a stored value wins over the Worker's var and the default, and the usage read shows it
    env.CLAUDE_HOUR_TOKENS = '200000';
    const set = await call('PUT', { hour: 1000 });
    assert.equal(set.status, 200);
    assert.deepEqual(set.body.limits, { hour: 1000, day: DAY_TOKENS });
    assert.deepEqual((await usage()).limits, { hour: 1000, day: DAY_TOKENS });
    // and the asks meet it: 100 tokens a call, so the 11th is past 1,000 and refused with its reset time
    for (let i = 0; i < 10; i++) assert.equal((await ask()).status, 200);
    const over = await ask();
    assert.equal(over.status, 429);
    assert.equal(over.body.code, 'ceiling');
    assert.equal(over.body.scope, 'hour');
    assert.ok(over.body.until > Date.now() && over.body.until <= Date.now() + 3600e3, String(over.body.until));
    // raised again: asking goes on
    assert.equal((await call('PUT', { hour: 400000, day: 1200000 })).status, 200);
    assert.equal((await ask()).status, 200);
  });
});

test('B-430: a daily refusal says until Central midnight', async () => {
  const { nextMidnight } = await import('../pwa/claude.js');
  // 2026-10-27 15:30 Central (20:30 UTC) -> 2026-10-28 00:00 Central (05:00 UTC)
  assert.equal(new Date(nextMidnight(Date.parse('2026-10-27T20:30:00Z'))).toISOString(), '2026-10-28T05:00:00.000Z');
  // across the November clock change: 2026-11-01 00:00 CDT -> the next midnight is 2026-11-02 00:00 CST (06:00 UTC)
  assert.equal(new Date(nextMidnight(Date.parse('2026-11-01T06:00:00Z'))).toISOString(), '2026-11-02T06:00:00.000Z');
  const p = ceilingProblem({ hour: 0, day: 2e6 }, { hour: 5e5, day: 1.5e6 }, Date.parse('2026-10-27T20:30:00Z'));
  assert.equal(p.scope, 'day');
  assert.equal(p.until, Date.parse('2026-10-28T05:00:00Z'));
});
