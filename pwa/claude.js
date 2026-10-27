// B-418 (D-339): /api/claude, one Claude API request on Haiku with the key the Worker holds (D-299), and the limits
// that keep its cost bounded, enforced here rather than on the page:
//   - an hourly and a daily token ceiling (the day is Central's), counted from the API's own usage numbers and kept in
//     D1 (claude_usage, one row per clock hour, added to and never deleted). Past either, the ask is refused with 429
//     and a plain sentence the page shows as it is; nothing is sent to the API.
//   - a read-along ask (the page sends read: {note, h}, h the note text's length and hash) goes only on new text and at
//     most once per READ_GAP_MS for a note (claude_reads, one row per note): the same text again is refused with 409,
//     a second read too soon with 429. The check and the mark are one statement, so two views cannot both pass it.
// The 10 idle minutes after which read-along stops are the page's (core sessions readAlongAsk): an idle page sends
// nothing new, and anything it did send would meet the rules above.
// GET /api/claude/usage answers this hour's and today's tokens and the ceilings, read-only.

/** The ceilings, in tokens (input, output and cache together): about twice a heavy hour and four times a heavy day. */
export const HOUR_TOKENS = 500000;
export const DAY_TOKENS = 2000000;
/** A note is read at most once per this long (spec.constants.studyWatch.commentGapSeconds, 75 s). */
export const READ_GAP_MS = 75000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const posInt = (v, d) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
/** The ceilings this Worker keeps: its vars CLAUDE_HOUR_TOKENS and CLAUDE_DAY_TOKENS, else the defaults. */
export const ceilingsOf = env => ({
  hour: posInt(env.CLAUDE_HOUR_TOKENS, HOUR_TOKENS),
  day: posInt(env.CLAUDE_DAY_TOKENS, DAY_TOKENS),
});

const HOUR_MS = 3600e3;
const dayOf = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const clockOf = ms =>
  new Date(ms)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })
    .toLowerCase();

/** Tokens one Messages API answer used, from its usage numbers (0 when it has none). */
export function tokensOf(res) {
  const u = (res && res.usage) || {};
  return ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
    .map(k => Number(u[k]) || 0)
    .reduce((a, b) => a + Math.max(0, b), 0);
}

/** This hour's and today's tokens. */
export async function usageNow(env, ms = Date.now()) {
  const hour = Math.floor(ms / HOUR_MS);
  const h = await env.DB.prepare('SELECT tokens FROM claude_usage WHERE hour = ?').bind(hour).first();
  const d = await env.DB.prepare('SELECT COALESCE(SUM(tokens), 0) AS t FROM claude_usage WHERE day = ?')
    .bind(dayOf(ms))
    .first();
  return { hour: h ? Number(h.tokens) : 0, day: d ? Number(d.t) : 0 };
}

/** null while under both ceilings, else the refusal: which one, and the sentence the page shows. */
export function ceilingProblem(used, limits, ms = Date.now()) {
  if (used.day >= limits.day)
    return {
      code: 'ceiling',
      scope: 'day',
      used: used.day,
      limit: limits.day,
      error: 'E.V. has used today’s Claude allowance, so asking Claude pauses until midnight.',
    };
  if (used.hour >= limits.hour)
    return {
      code: 'ceiling',
      scope: 'hour',
      used: used.hour,
      limit: limits.hour,
      error: `E.V. has used this hour’s Claude allowance, so asking Claude pauses until ${clockOf((Math.floor(ms / HOUR_MS) + 1) * HOUR_MS)}.`,
    };
  return null;
}

async function addUsage(env, tokens, ms = Date.now()) {
  await env.DB.prepare(
    'INSERT INTO claude_usage (hour, day, tokens, calls) VALUES (?, ?, ?, 1) ' +
      'ON CONFLICT (hour) DO UPDATE SET tokens = tokens + excluded.tokens, calls = calls + 1'
  )
    .bind(Math.floor(ms / HOUR_MS), dayOf(ms), tokens)
    .run();
}

const READ_NOTE = /^[A-Za-z0-9._-]{1,120}$/;
const READ_HASH = /^[A-Za-z0-9-]{1,64}$/;
/** A read-along ask's mark, or an error string. */
export function readOf(read) {
  if (read == null) return null;
  if (typeof read !== 'object' || !READ_NOTE.test(String(read.note)) || !READ_HASH.test(String(read.h)))
    return 'read: {note, h}';
  return { note: String(read.note), h: String(read.h) };
}

/** Marks a read of `read.note` at text `read.h`, or answers why not (unchanged text, or too soon after the last). */
export async function claimRead(env, read, ms = Date.now()) {
  const row = await env.DB.prepare(
    'INSERT INTO claude_reads (note, h, at) VALUES (?, ?, ?) ON CONFLICT (note) DO UPDATE SET h = excluded.h, ' +
      'at = excluded.at WHERE claude_reads.h <> excluded.h AND excluded.at - claude_reads.at >= ? RETURNING at'
  )
    .bind(read.note, read.h, ms, READ_GAP_MS)
    .first();
  if (row) return null;
  const was = await env.DB.prepare('SELECT h, at FROM claude_reads WHERE note = ?').bind(read.note).first();
  if (was && was.h === read.h)
    return { status: 409, code: 'unchanged', error: 'E.V. has already read this text of the note.' };
  return {
    status: 429,
    code: 'too_soon',
    error: 'E.V. reads a note at most once every 75 seconds.',
    retry_after_ms: was ? Math.max(0, Number(was.at) + READ_GAP_MS - ms) : READ_GAP_MS,
  };
}

/** POST /api/claude with {messages, tools?, tool_choice?, read?}, and GET /api/claude/usage. */
export async function handleClaude(request, env, url) {
  if (url.pathname === '/api/claude/usage' && request.method === 'GET')
    return json({ ...(await usageNow(env)), limits: ceilingsOf(env) });
  if (url.pathname !== '/api/claude' || request.method !== 'POST') return json({ error: 'no such route' }, 404);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'no ANTHROPIC_API_KEY secret on the Worker' }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'the body is not JSON' }, 400);
  }
  const { messages, tools, tool_choice } = body || {};
  const read = readOf(body && body.read);
  if (typeof read === 'string') return json({ error: read }, 400);
  const over = ceilingProblem(await usageNow(env), ceilingsOf(env));
  if (over) return json(over, 429);
  if (read) {
    const no = await claimRead(env, read);
    if (no) {
      const { status, ...rest } = no;
      return json(rest, status);
    }
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || 'claude-haiku-5-5',
      max_tokens: 8192, // B-324: a job's answer (a practice set of 15 questions) runs past 4,096
      messages,
      ...(tools && tools.length ? { tools, ...(tool_choice ? { tool_choice } : {}) } : {}),
    }),
  });
  const text = await r.text();
  let used = 0;
  try {
    used = tokensOf(JSON.parse(text));
  } catch {}
  if (used) await addUsage(env, used);
  return new Response(text, { status: r.status, headers: { 'content-type': 'application/json' } });
}
