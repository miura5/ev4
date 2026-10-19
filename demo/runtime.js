// The demo copy's stand-in for claude.use (B-83), adapted from test/harness/stub.js: an in-memory record seeded by
// EVDemoSeed, a scripted Claude, and connectors that are not there. It never reaches the real claude.use, so the demo
// can't touch a record, fire a scheduled task, read a Mac or spend a Claude call. Everything lives in this tab.
(function () {
  'use strict';
  const db = window.EVDemoSeed(new Date());
  const subs = [];
  const clone = v => JSON.parse(JSON.stringify(v));
  function merge(t, s) { for (const k of Object.keys(s)) { const v = s[k]; if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) merge(t[k], v); else t[k] = clone(v); } return t; }
  const ops = { '==': (a, b) => a === b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b };
  const emit = c => subs.filter(s => s.c === c).forEach(s => s.fire());
  const rowsOf = (c, filters) => Object.entries(db[c] || {}).filter(([, d]) => filters.every(([f, op, v]) => ops[op](d[f], v))).map(([id, d]) => ({ id, exists: true, data: () => clone(d) }));
  function query(c, filters) {
    return {
      where: (f, op, v) => query(c, [...filters, [f, op, v]]),
      async get() { return { docs: rowsOf(c, filters) }; },
      onSnapshot(cb) { const s = { c, fire: () => cb({ docs: rowsOf(c, filters) }) }; subs.push(s); setTimeout(s.fire, 0); return () => {}; },
      doc: id => ({
        async set(data) { (db[c] = db[c] || {})[id] = clone(data); emit(c); },
        async update(data) { const col = db[c] = db[c] || {}; if (!col[id]) { const e = new Error('not found'); e.code = 'invalid_argument'; throw e; } merge(col[id], data); emit(c); },
        async get() { const d = (db[c] || {})[id]; return { id, exists: !!d, data: () => d && clone(d) }; },
        onSnapshot(cb) { const s = { c, fire: () => { const d = (db[c] || {})[id]; cb({ id, exists: !!d, data: () => d && clone(d) }); } }; subs.push(s); setTimeout(s.fire, 0); return () => {}; },
      }),
      async add(data) { const id = 'x' + Math.random().toString(36).slice(2, 10); (db[c] = db[c] || {})[id] = clone(data); emit(c); return { id }; },
    };
  }
  const DB = { collection: c => query(c, []) };

  // Scripted replies: the first rule whose pattern matches what was typed. A rule may run the page's own tools first
  // (a card, a skills run), exactly as Claude would.
  const RULES = [
    [/skill|checklist|bed ?bath|head.?to.?toe|vital signs? check/i, t => /vital/i.test(t)
      ? { script: [{ tool: 'practice_skill', input: { action: 'start', skill: 'vital signs', page: 4 } }], reply: 'Here’s the vital signs checklist from the demo skills packet. Mark each step as you go; a miss becomes a skill to practice, and Hide or Stop are on the panel.' }
      : { script: [{ tool: 'practice_skill', input: { action: 'start', skill: 'bed bath', page: 2 } }], reply: 'Here’s the bed bath checklist from the demo skills packet. Mark each step as you go; a miss becomes a skill to practice, and Hide or Stop are on the panel.' }],
    [/preload|afterload|cardiac output/i, () => ({ reply: 'Preload is the **stretch** of the ventricle at the end of filling: more volume in, more stretch, a stronger squeeze. Afterload is the **pressure** it pushes against to get blood out, so high blood pressure raises it. Cardiac output is heart rate times stroke volume. Exam hook: preload is the filling, afterload is the fight.' })],
    [/potassium|hyperkal|\bk\+?\b/i, () => ({ reply: 'Normal potassium is **3.5 to 5.0** mEq/L. High potassium shows up first on the heart monitor as **peaked T waves**, before dangerous rhythms, so the monitor comes before anything else. Low potassium flattens the T wave and weakens muscles. Exam hook: potassium talks to the heart.' })],
    [/sodium|hyponat/i, () => ({ reply: 'Normal sodium is **135 to 145** mEq/L. When it drops, water moves into brain cells, so the first signs are **confusion and headache**, then nausea and weakness. Exam hook: sodium talks to the brain.' })],
    [/\biv\b|isotonic|hypotonic|hypertonic|saline/i, () => ({ reply: '**Isotonic** (0.9% saline, lactated Ringer’s) stays in the vessels and raises volume. **Hypotonic** (0.45% saline) moves water into the cells. **Hypertonic** (3% saline) pulls water out of them. Exam hook: hypo goes in, hyper pulls out.' })],
    [/weak ?spots?|struggl|missing|worst/i, () => ({ script: [{ tool: 'show_card', input: { type: 'weakspots' } }], reply: 'These are the ones due soonest. Each comes back until you get it right on two different days.' })],
    [/coming up|calendar|due|deadline|schedule/i, () => ({ script: [{ tool: 'show_card', input: { type: 'dates', days: 14 } }], reply: 'Here are the next two weeks. The graded ones are yours alone: I only schedule them.' })],
    [/ready|readiness|exam/i, () => ({ script: [{ tool: 'show_card', input: { type: 'readiness' } }, { tool: 'show_card', input: { type: 'audit' } }], reply: 'Here’s where Exam 4 stands, and per objective what to reread.' })],
    [/quiz|review|practice|question/i, () => ({ script: [{ tool: 'show_card', input: { type: 'review' } }], reply: 'Today’s review is right here; answer in the card and your weak spots update as you go.' })],
    [/list|today|plan/i, () => ({ script: [{ tool: 'show_card', input: { type: 'today', filter: 'all' } }], reply: 'Here’s today’s list.' })],
    [/study guide|summar|make me|write me/i, () => ({ reply: 'On the real page that starts a background job: a separate Claude session writes it from the course files and posts it back here. Jobs are off in the demo, but the review, the skills runner and the cards all work.' })],
    [/^(hi|hey|hello|yo)\b/i, () => ({ reply: 'Hi! This is the demo copy of E.V., with made-up data and scripted replies. Try “explain preload”, “practice bed bath”, “what are my weak spots” or “quiz me”.' })],
  ];
  const FALLBACK = { reply: 'This is the demo copy, so my replies are scripted. On the real page Claude answers with the course files and these same tools. Try “explain preload”, “practice bed bath”, “what are my weak spots”, “what’s coming up” or “quiz me”.' };
  const lastText = input => { const m = Array.isArray(input) ? input[input.length - 1] : input; const c = m && typeof m === 'object' ? m.content : m; return typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join(' ') : ''; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const chat = async (input, opts = {}) => {
    const text = lastText(input); await wait(500);
    if (!opts.tools) return { text: 'Demo student working on Exam 4: fluids and electrolytes.', truncated: false }; // the running summary
    const rule = RULES.find(([re]) => re.test(text)); const r = rule ? rule[1](text) : FALLBACK;
    for (const step of r.script || []) { const t = opts.tools.find(x => x.name === step.tool); if (t) { try { await t.execute(step.input || {}, { signal: new AbortController().signal }); } catch (e) { console.warn('demo tool', step.tool, e.message); } } }
    if (opts.onText) opts.onText({ text: r.reply, delta: r.reply });
    return { text: r.reply, truncated: false, modelTierApplied: opts.modelTier || 'default' };
  };
  const sample = Object.assign(chat, {
    json: async p => { await wait(800); return /Write exactly 5 questions/.test(String(p)) ? { items: window.EVDemoMore.map(q => ({ cjStep: 'analyze-cues', verify: false, ...q })) } : { items: [] }; },
    limits: async () => ({ maxInputBytes: 262144, tools: { maxCount: 16 } }),
  });
  // No connectors in the demo. The Study Watch reader answers with no notes and no sessions (so nothing waits to be
  // filed); background jobs answer as not connected.
  const mcp = { callTool: async (server, tool) => {
    if (String(server).startsWith('host:')) {
      const r = tool === 'status' ? { reader: 'demo', folderFound: true, context: { found: false }, latestNote: { found: false } } : tool === 'list_sessions' ? { sessions: [] } : { found: false };
      return { content: [], payload: r };
    }
    const e = new Error('not in the demo'); e.code = 'server_not_connected'; throw e;
  } };
  window.EVDemo = { use: async n => n === 'db' ? DB : n === 'user' ? { isOwner: async () => true } : n === 'sample' ? sample : n === 'mcp' ? mcp : null };

  // Say on the page what this is.
  document.addEventListener('DOMContentLoaded', () => {
    const f = document.getElementById('sys-note'); if (f) f.textContent = 'Demo copy: made-up data, scripted replies. Nothing here is saved; reload to start over.';
    const st = document.getElementById('status'); // the header's status line names the record: here it is the demo
    if (st) new MutationObserver(() => { if (/^Live\b/.test(st.textContent)) st.textContent = st.textContent.replace(/^Live\b/, 'Demo'); }).observe(st, { childList: true, characterData: true, subtree: true });
  });
})();
