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

  // A study session in the demo (Matt, Oct 19; B-103). Study Watch saves the school note he is writing and E.V. reads
  // along at the page's own pace (spec.constants.studyWatch, as published: the demo changes no timing). Here the reader
  // serves a made-up note that grows one part per read, and Claude's side is scripted: each part's comment, check
  // questions and flashcard are the demo's made-up data. Which prompt is which, and the new lines in it, come from
  // core (EVCore.sessionPrompt); the wrap-up holds the parts actually written.
  let readMs = 30000;
  window.fetch('spec.json', { cache: 'no-cache' }).then(r => r.json()).then(spec => { readMs = ((spec.constants.studyWatch || {}).readSeconds || 30) * 1e3; }).catch(() => {});
  const NOTE = { id: 'demo-note-ch39', name: 'Ch 39 Fluids and electrolytes', folder: 'NUR 112' };
  const OPENING = 'Thesis: fluid balance is about where the water is (in the cells, between them, in the vessels) and which electrolytes pull it there.';
  const PARTS = [
    { text: 'Fluid volume deficit: low volume in the vessels. Signs are a fast weak pulse, low blood pressure, dry mucous membranes, dark concentrated urine. Daily weight is the best measure: 1 kg is about 1 liter.', ask: 'Why is daily weight a better measure of fluid loss than intake and output?', say: null },
    { text: 'Sodium 135 to 145. Sodium pulls water with it. Low sodium means water shifts into the cells, so brain cells swell: confusion, headache, seizures if severe.', ask: 'Your note says low sodium swells brain cells. Which way does water move in high sodium, and what would you see first?', say: 'Good: you tied sodium to where the water goes. That’s the idea the whole chapter hangs on.', quote: 'Sodium pulls water with it.' },
    { text: 'Potassium 3.5 to 5.0. It lives inside the cells and runs the heart\'s electrical signal. High potassium: peaked T waves, then dangerous rhythms. Never give potassium IV push.', ask: 'Why does high potassium show on the heart monitor before anywhere else?', say: 'That’s the exam’s favorite potassium fact: the monitor first, before any other sign.', quote: 'High potassium: peaked T waves, then dangerous rhythms.' },
    { text: 'IV fluids by tonicity: isotonic 0.9% saline and lactated Ringer\'s stay in the vessels; hypotonic 0.45% saline moves water into the cells; hypertonic 3% saline pulls water out of them.', ask: 'Connect this to sodium: which IV fluid would worsen the brain swelling from low sodium, and why?', say: null },
    { text: 'Fluid volume excess: too much volume. Crackles in the lungs, distended neck veins, edema, bounding pulse, weight gain. Fix: fluid and sodium restriction, diuretics, watch potassium on loop diuretics.', ask: 'Your note links loop diuretics to potassium. Which way does potassium go on furosemide, and which T wave change would you expect?', say: 'Nice link back to potassium: loop diuretics pull it down, so the T waves flatten.', quote: 'watch potassium on loop diuretics.' },
    { text: 'Third spacing: fluid leaves the vessels for the space between cells (burns, low albumin). The body can be overloaded and still short of volume in the vessels.', ask: 'Gap check: how can a patient be swollen and still have low blood pressure?', say: 'That’s the third-spacing paradox, and you’ve got it: swollen tissue, empty vessels.', quote: 'The body can be overloaded and still short of volume in the vessels.' },
  ];
  let notedAt = null;
  const demoSession = () => Object.values(db.sessions || {}).find(x => x.source === 'E.V. Home' && x.kind !== 'skill' && (x.status === 'active' || x.status === 'ending'));
  function latestNote() {
    if (!demoSession() || notedAt == null) notedAt = Date.now(); // a new session starts the note over
    const k = Math.min(PARTS.length, 1 + Math.floor((Date.now() - notedAt) / readMs));
    return { found: true, graded: false, refused: false, note: { ...NOTE, modifiedAt: new Date().toISOString(), text: [OPENING, ...PARTS.slice(0, k).map(p => p.text)].join('\n\n') + '\n' } };
  }
  const added = prompt => window.EVCore.sessionPrompt(prompt).added;
  function commentFor(prompt) { // the newest part in his new lines speaks; parts with no comment stay silent
    const hit = PARTS.filter(p => added(prompt).includes(p.text.slice(0, 40))).pop();
    return hit && hit.say ? { say: hit.say, quote: hit.quote, kind: /exam/.test(hit.say) ? 'exam' : 'connection' } : { say: null, quote: null, kind: null };
  }
  function checkItems(prompt) {
    const hits = PARTS.filter(p => added(prompt).includes(p.text.slice(0, 40)));
    return { items: (hits.length ? hits : PARTS.slice(0, 1)).slice(0, 3).map(p => ({ text: p.ask, kind: /Connect|links/.test(p.ask) ? 'link' : /Gap/.test(p.ask) ? 'gap' : 'why' })) };
  }
  // The made-up flashcards and topics for each part of the note, in order; the wrap-up holds the parts he wrote.
  const PART_DATA = [
    { topic: 'fluid volume deficit', cards: [{ term: 'Best measure of fluid loss', definition: 'Daily weight: 1 kg is about 1 liter' }] },
    { topic: 'sodium', cards: [{ term: 'Normal sodium', definition: '135 to 145 mEq/L' }] },
    { topic: 'potassium', cards: [{ term: 'Normal potassium', definition: '3.5 to 5.0 mEq/L' }, { term: 'First sign of high potassium', definition: 'Peaked T waves on the monitor' }], weakSpot: { objective: 'E4-2', topic: 'Why high potassium shows on the monitor first' } },
    { topic: 'IV fluids by tonicity', cards: [{ term: 'Hypotonic IV fluid', definition: '0.45% saline: moves water into the cells' }] },
    { topic: 'fluid volume excess', cards: [{ term: 'Signs of fluid volume excess', definition: 'Crackles, distended neck veins, edema, bounding pulse' }] },
    { topic: 'third spacing', cards: [{ term: 'Third spacing', definition: 'Fluid leaves the vessels for the tissues: swollen, yet short of volume in the vessels' }] },
  ];
  function wrapUp() {
    const n = notedAt == null ? 1 : Math.min(PARTS.length, 1 + Math.floor((Date.now() - notedAt) / readMs)), done = PART_DATA.slice(0, n);
    const topics = done.map(d => d.topic), list = topics.length > 1 ? topics.slice(0, -1).join(', ') + ' and ' + topics[topics.length - 1] : topics[0];
    return {
      summary: `A pass through ${list}.` + (done.some(d => d.weakSpot) ? ' The link from potassium to the heart monitor is the one to firm up.' : ''),
      weakSpots: done.filter(d => d.weakSpot).map(d => d.weakSpot),
      connections: ['Low sodium and hypotonic IV fluid push water the same way: into the cells.'],
      noteTodos: ['Add the signs of high sodium next to the low sodium ones'],
      cards: done.flatMap(d => d.cards),
    };
  }

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
    [/coming up|calendar|due|deadline|schedule/i, () => ({ script: [{ tool: 'show_card', input: { type: 'dates', days: 14 } }], reply: 'Here are the next two weeks. Two of them are graded.' })],
    [/ready|readiness|exam/i, () => ({ script: [{ tool: 'show_card', input: { type: 'readiness' } }, { tool: 'show_card', input: { type: 'audit' } }], reply: 'Here’s where Exam 4 stands, and per objective what to reread.' })],
    [/quiz|review|practice|question/i, () => ({ script: [{ tool: 'show_card', input: { type: 'review' } }], reply: 'Today’s review is right here; answer in the card and your weak spots update as you go.' })],
    [/list|today|plan/i, () => ({ script: [{ tool: 'show_card', input: { type: 'today', filter: 'all' } }], reply: 'Here’s today’s list.' })],
    [/study guide|summar|make me|write me/i, () => ({ reply: 'On the real page that starts a background job: a separate Claude session writes it from the course files and posts it back here. Jobs are off in the demo, but the review, the skills runner and the cards all work.' })],
    [/^(hi|hey|hello|yo)\b/i, () => ({ reply: 'Hi! This is the demo copy of E.V., with made-up data and scripted replies. Try “explain preload”, “practice bed bath”, “what are my weak spots” or “quiz me”.' })],
  ];
  const SESSION_REPLY = { reply: 'Good, that’s the heart of it. I’ll fold it into the wrap-up. Keep writing; the next check follows what you add to the note.' };
  const FALLBACK = { reply: 'This is the demo copy, so my replies are scripted. On the real page Claude answers with the course files and these same tools. Try “explain preload”, “practice bed bath”, “what are my weak spots”, “what’s coming up” or “quiz me”.' };
  const lastText = input => { const m = Array.isArray(input) ? input[input.length - 1] : input; const c = m && typeof m === 'object' ? m.content : m; return typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join(' ') : ''; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const chat = async (input, opts = {}) => {
    const text = lastText(input); await wait(500);
    if (!opts.tools) return { text: 'Demo student working on Exam 4: fluids and electrolytes.', truncated: false }; // the running summary
    const rule = RULES.find(([re]) => re.test(text)); const r = rule ? rule[1](text) : demoSession() ? SESSION_REPLY : FALLBACK;
    for (const step of r.script || []) { const t = opts.tools.find(x => x.name === step.tool); if (t) { try { await t.execute(step.input || {}, { signal: new AbortController().signal }); } catch (e) { console.warn('demo tool', step.tool, e.message); } } }
    if (opts.onText) opts.onText({ text: r.reply, delta: r.reply });
    return { text: r.reply, truncated: false, modelTierApplied: opts.modelTier || 'default' };
  };
  const sample = Object.assign(chat, {
    json: async p => { await wait(800); const t = String(p);
      if (/Write exactly 5 questions/.test(t)) return { items: window.EVDemoMore.map(q => ({ cjStep: 'analyze-cues', verify: false, ...q })) };
      const kind = window.EVCore.sessionPrompt(t).kind;
      if (kind === 'comment') return commentFor(t);
      if (kind === 'check') return checkItems(t);
      if (kind === 'wrap') return wrapUp();
      return { items: [] }; },
    limits: async () => ({ maxInputBytes: 262144, tools: { maxCount: 16 } }),
  });
  // No real connectors in the demo. The Study Watch reader serves the made-up note above and no saved sessions (so
  // nothing waits to be filed); background jobs answer as not connected.
  const mcp = { callTool: async (server, tool) => {
    if (String(server).startsWith('host:')) {
      const r = tool === 'status' ? { reader: 'demo', folderFound: true, context: { found: false }, latestNote: { found: true } } : tool === 'list_sessions' ? { sessions: [] } : tool === 'latest_note' ? latestNote() : { found: false };
      return { content: [], payload: r };
    }
    const e = new Error('not in the demo'); e.code = 'server_not_connected'; throw e;
  } };
  window.EVDemo = { use: async n => n === 'db' ? DB : n === 'user' ? { isOwner: async () => true } : n === 'sample' ? sample : n === 'mcp' ? mcp : null };

  // Say on the page what this is.
  document.addEventListener('DOMContentLoaded', () => {
    // The note lives in System (B-85 took the caption under the input away); a visitor also sees it once, as a toast.
    const NOTE = 'Demo copy: made-up data, scripted replies. Nothing here is saved; reload to start over.';
    const f = document.getElementById('sys-note'); if (f) f.textContent = NOTE;
    setTimeout(() => { const t = document.getElementById('toast'); if (!t) return; t.textContent = NOTE; t.hidden = false; setTimeout(() => { if (t.textContent === NOTE) t.hidden = true; }, 7000); }, 2500);
    const st = document.getElementById('status'); // the header's status line names the record: here it is the demo
    if (st) new MutationObserver(() => { if (/^Live\b/.test(st.textContent)) st.textContent = st.textContent.replace(/^Live\b/, 'Demo'); }).observe(st, { childList: true, characterData: true, subtree: true });
  });
})();
