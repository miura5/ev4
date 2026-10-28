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
// B-435 (D-349): the ceilings are a setting, kept in D1 (claude_settings) and changed with PUT /api/claude/limits
// {hour, day} with no release; a stored value wins over the Worker's vars, which win over the defaults here.

/** The default ceilings, in tokens (input, output and cache together, cache weighted as billed: D-352); D-349 (Matt's option A): 500,000 an hour and
 * 1,500,000 a day, the Console's monthly spend limit being the hard money stop. */
export const HOUR_TOKENS = 500000;
export const DAY_TOKENS = 1500000;
/** A stored ceiling must be a whole number of tokens from 1,000 to this. */
export const MAX_LIMIT = 50000000;
/** A note is read at most once per this long (spec.constants.studyWatch.commentGapSeconds, 75 s). */
export const READ_GAP_MS = 75000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const posInt = (v, d) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
/** The ceilings this Worker keeps: the stored setting (B-435), else its vars CLAUDE_HOUR_TOKENS and
 * CLAUDE_DAY_TOKENS, else the defaults. */
export const ceilingsOf = (env, stored = {}) => ({
  hour: posInt(stored.hour, posInt(env.CLAUDE_HOUR_TOKENS, HOUR_TOKENS)),
  day: posInt(stored.day, posInt(env.CLAUDE_DAY_TOKENS, DAY_TOKENS)),
});
const LIMIT_KEYS = { hour: 'claude.hourTokens', day: 'claude.dayTokens' };
/** The stored ceilings (an empty object when none, or when the table cannot be read: the vars and defaults stand). */
export async function storedLimits(env) {
  try {
    const { results } = await env.DB.prepare('SELECT key, value FROM claude_settings WHERE key IN (?, ?)')
      .bind(LIMIT_KEYS.hour, LIMIT_KEYS.day)
      .all();
    const out = {};
    for (const r of results || [])
      for (const [k, key] of Object.entries(LIMIT_KEYS)) if (r.key === key) out[k] = r.value;
    return out;
  } catch (e) {
    console.log('claude_settings: not read:', String(e));
    return {};
  }
}
export const limitsOf = async env => ceilingsOf(env, await storedLimits(env));
/** {hour?, day?} checked: a whole number from 1,000 to MAX_LIMIT each, at least one given; else the error string. */
export function limitsChange(body) {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};
  for (const k of ['hour', 'day']) {
    if (b[k] == null) continue;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < 1000 || n > MAX_LIMIT)
      return k + ': a whole number of tokens from 1000 to ' + MAX_LIMIT;
    out[k] = n;
  }
  if (!Object.keys(out).length) return 'give hour, day or both';
  const hour = out.hour,
    day = out.day;
  if (hour && day && hour > day) return 'the hourly ceiling cannot be above the daily one';
  return out;
}

const HOUR_MS = 3600e3;
const dayOf = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const clockOf = ms =>
  new Date(ms)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })
    .toLowerCase();

/** D-352: the ceilings count tokens as billed: input and output as they are, a cache write at 1.25 and a cache read
 * at 0.1 of plain input. */
export const TOKEN_WEIGHTS = {
  input_tokens: 1,
  output_tokens: 1,
  cache_creation_input_tokens: 1.25,
  cache_read_input_tokens: 0.1,
};
/** Tokens one Messages API answer used, from its usage numbers, weighted as billed (D-352) and by the model's price
 * against Haiku's (`scale`, B-449: a study plan's Sonnet tokens count 3 each), rounded to a whole number (0 when it has
 * none). */
export function tokensOf(res, scale = 1) {
  const u = (res && res.usage) || {};
  return Math.round(
    Object.entries(TOKEN_WEIGHTS).reduce((a, [k, w]) => a + Math.max(0, Number(u[k]) || 0) * w, 0) * scale
  );
}

// B-449 (D-355, D-356): the Worker chooses the model; the page never names one (a model field it sends is ignored). An
// ask may name a purpose, checked here: only making a study plan ('exam-plan') goes to Sonnet, with a longer answer
// allowed; a plan edit ('plan-edit'), any other ask or none stays on Haiku with the usual answer length. An unknown
// purpose is refused.
export const ASK_TOKENS = 8192; // B-324: a job's answer (a practice set of 15 questions) runs past 4,096
export const PURPOSES = {
  // B-449 (D-355): making a study plan
  'exam-plan': {
    model: env => env.CLAUDE_PLAN_MODEL || 'claude-sonnet-5-5',
    maxTokens: 24000,
    scale: 3, // Sonnet's input and output cost about 3 times Haiku's, so its tokens count 3 each against the ceilings
  },
  // D-356: a change to a plan draft is a patch, on Haiku with the usual length
  'plan-edit': { model: env => env.CLAUDE_MODEL || 'claude-haiku-5-5', maxTokens: ASK_TOKENS, scale: 1 },
};
/** {model, maxTokens, scale} for an ask's purpose and max_tokens, or an error string. */
export function purposeOf(body, env = {}) {
  const purpose = body && body.purpose;
  const asked = body && body.max_tokens;
  // an ask with no purpose keeps the usual model and length, whatever model or max_tokens it sent
  if (purpose == null)
    return { model: env.CLAUDE_MODEL || 'claude-haiku-5-5', maxTokens: ASK_TOKENS, scale: 1, purpose: null };
  const p = Object.prototype.hasOwnProperty.call(PURPOSES, purpose) ? PURPOSES[purpose] : null;
  if (!p) return 'purpose: no such purpose';
  let maxTokens = ASK_TOKENS;
  if (asked != null) {
    if (!Number.isInteger(asked) || asked < 1 || asked > p.maxTokens)
      return 'max_tokens: a whole number from 1 to ' + p.maxTokens;
    maxTokens = asked;
  }
  return { model: p.model(env), maxTokens, scale: p.scale, purpose };
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

/** The next Central midnight after `ms`, in ms (the daily ceiling's reset). */
export function nextMidnight(ms) {
  let t = (Math.floor(ms / HOUR_MS) + 1) * HOUR_MS;
  const hourOf = x =>
    Number(new Date(x).toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Chicago' }));
  while (hourOf(t) !== 0) t += HOUR_MS;
  return t;
}

/** null while under both ceilings, else the refusal: which one, until when (B-430: `until`, ms), and the sentence. */
export function ceilingProblem(used, limits, ms = Date.now()) {
  if (used.day >= limits.day)
    return {
      code: 'ceiling',
      scope: 'day',
      until: nextMidnight(ms),
      used: used.day,
      limit: limits.day,
      error: 'E.V. has used today’s Claude allowance, so asking Claude pauses until midnight.',
    };
  if (used.hour >= limits.hour)
    return {
      code: 'ceiling',
      scope: 'hour',
      until: (Math.floor(ms / HOUR_MS) + 1) * HOUR_MS,
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

// B-442: prompt caching. The page never sends cache_control itself: any it sent is dropped, and it may instead name at
// most CACHE_MARKS content blocks ({m: message index, b: block index}) for the Worker to mark as cache breakpoints
// (cache_control {type: 'ephemeral'}: the prefix up to that block is cached for about 5 minutes, read at about a tenth).
export const CACHE_MARKS = 2;
const CACHEABLE = new Set(['text', 'image', 'document', 'tool_result']);
/** A copy of `x` with every cache_control key dropped, at any depth. */
export function withoutCacheControl(x) {
  if (Array.isArray(x)) return x.map(withoutCacheControl);
  if (!x || typeof x !== 'object') return x;
  const out = {};
  for (const [k, v] of Object.entries(x)) if (k !== 'cache_control') out[k] = withoutCacheControl(v);
  return out;
}
/** The cache hint checked against the messages: null when none, the marks [{m, b}], or an error string. */
export function cacheOf(hint, messages) {
  if (hint == null) return null;
  const bad = 'cache: up to ' + CACHE_MARKS + ' marks {m, b}, each naming a text, image, document or tool_result block';
  if (!Array.isArray(hint) || !hint.length || hint.length > CACHE_MARKS) return bad;
  const marks = [];
  for (const h of hint) {
    if (!h || typeof h !== 'object' || !Number.isInteger(h.m) || !Number.isInteger(h.b)) return bad;
    const msg = Array.isArray(messages) ? messages[h.m] : null;
    const blk = msg && Array.isArray(msg.content) ? msg.content[h.b] : null;
    if (!blk || typeof blk !== 'object' || !CACHEABLE.has(blk.type)) return bad;
    marks.push({ m: h.m, b: h.b });
  }
  return marks;
}
/** The messages as sent to the API: the page's cache_control dropped, then the checked marks set. */
export function markedMessages(messages, marks) {
  const out = withoutCacheControl(messages);
  for (const { m, b } of marks || []) out[m].content[b].cache_control = { type: 'ephemeral' };
  return out;
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

/** POST /api/claude with {messages, tools?, tool_choice?, read?, cache?, purpose?, max_tokens?}, and GET
 * /api/claude/usage. */
export async function handleClaude(request, env, url) {
  if (url.pathname === '/api/claude/usage' && request.method === 'GET')
    return json({ ...(await usageNow(env)), limits: await limitsOf(env) });
  // B-435: the ceilings are changed here, with no release; each change is a row's new value (nothing is deleted)
  if (url.pathname === '/api/claude/limits' && request.method === 'GET') return json({ limits: await limitsOf(env) });
  if (url.pathname === '/api/claude/limits' && request.method === 'PUT') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'the body is not JSON' }, 400);
    }
    const change = limitsChange(body);
    if (typeof change === 'string') return json({ error: change }, 400);
    // a change of one ceiling is checked against the other as it stands (review: hour never above day)
    const next = { ...(await limitsOf(env)), ...change };
    if (next.hour > next.day) return json({ error: 'the hourly ceiling cannot be above the daily one' }, 400);
    const now = Date.now();
    for (const [k, v] of Object.entries(change))
      await env.DB.prepare(
        'INSERT INTO claude_settings (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at'
      )
        .bind(LIMIT_KEYS[k], v, now)
        .run();
    return json({ limits: await limitsOf(env) });
  }
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
  const marks = cacheOf(body && body.cache, messages);
  if (typeof marks === 'string') return json({ error: marks }, 400);
  const use = purposeOf(body, env);
  if (typeof use === 'string') return json({ error: use }, 400);
  if (use.purpose && read) return json({ error: 'purpose: a read-along ask has none' }, 400);
  const over = ceilingProblem(await usageNow(env), await limitsOf(env));
  if (over) return json(over, 429);
  // the mark before the claim, so a failed call gives the text back (B-418 review): the same text may be read again
  const before = read
    ? await env.DB.prepare('SELECT h, at FROM claude_reads WHERE note = ?').bind(read.note).first()
    : null;
  if (read) {
    const no = await claimRead(env, read);
    if (no) {
      const { status, ...rest } = no;
      return json(rest, status);
    }
  }
  const unclaim = async () => {
    if (!read) return;
    try {
      await env.DB.prepare('UPDATE claude_reads SET h = ?, at = ? WHERE note = ? AND h = ?')
        .bind(before ? before.h : '', before ? before.at : 0, read.note, read.h)
        .run();
    } catch (e) {
      console.log('claude_reads: the mark was not given back:', String(e));
    }
  };
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: use.model, // B-449 (D-355): the Worker's choice, by purpose; never the page's
        max_tokens: use.maxTokens,
        messages: markedMessages(messages, marks), // B-442: only the Worker's own cache marks reach the API
        ...(tools && tools.length
          ? { tools: withoutCacheControl(tools), ...(tool_choice ? { tool_choice } : {}) }
          : {}),
      }),
    });
  } catch (e) {
    await unclaim();
    return json({ error: 'the Claude API could not be reached: ' + String((e && e.message) || e).slice(0, 200) }, 502);
  }
  // the answer's body can still fail after the headers came (a dropped connection): the mark goes back, as above
  let text;
  try {
    text = await r.text();
  } catch (e) {
    await unclaim();
    return json({ error: 'the Claude API could not be reached: ' + String((e && e.message) || e).slice(0, 200) }, 502);
  }
  if (!r.ok) await unclaim();
  let used = 0;
  try {
    used = tokensOf(JSON.parse(text), use.scale);
  } catch {}
  // an answer already made is returned even when its count can't be written (logged; the next write adds on)
  if (used)
    try {
      await addUsage(env, used);
    } catch (e) {
      console.log('claude_usage: not counted:', used, String(e));
    }
  return new Response(text, { status: r.status, headers: { 'content-type': 'application/json' } });
}
