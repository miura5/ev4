// E.V. core's identifier check, two stages (B-197, Matt Oct 21: "make it so it collects a potential violation, then some
// actual judgment is used"). One factory with no imports, like the other splits of core/evcore.mjs (B-160, D-166).
//
export function makeIdCheck() {
  'use strict';
  // For whole files (uploads): course documents name these fields ("label with the patient's name, DOB, MRN"), so only
  // a value next to them counts. Messages keep the stricter scan above.
  const ID_VALUE_PATTERNS = [
    {
      re: /\b(?:MRN|medical record (?:no\.?|number)|record\s*#)\s*[:#]?\s*\d{4,}/i,
      why: 'has a medical record number',
    },
    {
      re: /\b(?:DOB|date of birth|born)\s*[:#]?\s*(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4})/i,
      why: 'has a date of birth',
    },
    {
      re: /\b(?:patient|pt|resident|client)\b[^.\n]{0,30}\broom\s*#?\s*\d{1,4}[a-z]?\b|\broom\s*#?\s*\d{1,4}[a-z]?\b[^.\n]{0,30}\b(?:patient|pt|resident|client)\b/i,
      why: "has a patient's room number",
    },
    { re: /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(19[2-9]\d|200\d)\b/, why: 'has what looks like a birth date' },
  ];
  function scanIdentifierValues(text) {
    const out = [];
    for (const p of ID_VALUE_PATTERNS) if (p.re.test(String(text || ''))) out.push(p.why);
    return out;
  }
  // B-04 stands as written: no real patient's identifiers, ever. The patterns above only nominate a candidate, a value
  // that might be one; a judgment with the words around it decides whether it is a real person's or a practice scenario's
  // client's (a skills checklist, a sim, E.V.'s role-play). Practice passes; real or unsure holds back only that value
  // and asks Matt in plain words. A verdict is kept in idchecks under a fingerprint of the value (the value itself is
  // never kept), so nothing judged once is judged again: not on the next write, not on a restore.
  const ID_LONG_NUMBER = { re: /\b\d{7,10}\b/, why: 'has a long number that could be a record number' };
  function identifierCandidates(text, { strict = false } = {}) {
    const s = String(text || '');
    const found = [];
    for (const p of strict ? [...ID_VALUE_PATTERNS, ID_LONG_NUMBER] : ID_VALUE_PATTERNS) {
      const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g');
      for (const m of s.matchAll(re)) if (m[0].trim()) found.push({ why: p.why, value: m[0], index: m.index });
    }
    // One candidate per value: a match inside a longer one ("03/14/1958" inside "DOB: 03/14/1958") is the same value.
    found.sort((a, b) => a.index - b.index || b.value.length - a.value.length);
    const out = [];
    const seen = new Set();
    let end = -1;
    for (const f of found) {
      if (f.index + f.value.length <= end) continue;
      end = Math.max(end, f.index + f.value.length);
      const value = f.value.trim();
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({ why: f.why, value, index: f.index, key: idKey(value) });
    }
    return out;
  }
  // A fingerprint of the value (cyrb53, case and spacing folded): what a verdict is kept under, so the record never
  // holds the value a second time.
  function idKey(value) {
    const s = String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    let h1 = 0xdeadbeef,
      h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 'id-' + (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  const ID_HELD = '[left out]';
  /** The text with each value replaced by [left out]: the one change a real or unsure verdict makes. */
  function holdBack(text, values) {
    let s = String(text == null ? '' : text);
    for (const v of values || []) if (v) s = s.split(v).join(ID_HELD);
    return s;
  }
  /** The words around a candidate (about 160 characters each side), so the judgment sees what it was part of. */
  function idContext(text, c, span = 160) {
    const s = String(text || '');
    const i = c && c.index != null ? c.index : s.indexOf((c && c.value) || '');
    return s.slice(Math.max(0, i - span), Math.max(0, i) + ((c && c.value) || '').length + span);
  }
  const ID_VERDICTS = ['practice', 'real', 'unsure'];
  const ID_JUDGMENT =
    "Each candidate below is a value a pattern matched in Matt's study record: something that might be a real " +
    "patient's identifier (a date of birth, a record number, a room number). Read the words around it and decide: " +
    "practice when it belongs to a practice scenario's client (a skills checklist or validation run-through, a sim, a case study, " +
    "a textbook or practice question, E.V. playing a client), real when it reads as a real person's detail (a patient " +
    'from clinical, a family member, anyone who exists), unsure when the words around it do not say. Asking for or ' +
    "giving the details of a practice scenario's client is practice. Give a one-line reason in neutral words that does not repeat the value.";
  const ID_ANSWER_SHAPE = {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', pattern: '^id-[0-9a-f]{16}$' },
            verdict: { enum: ID_VERDICTS },
            reason: { type: 'string', minLength: 1, maxLength: 200 },
          },
          required: ['key', 'verdict', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['verdicts'],
    additionalProperties: false,
  };
  /** The page's judgment prompt: the candidates with their words around them, the answer as JSON in ID_ANSWER_SHAPE. */
  function idJudgmentPrompt(candidates, { context = '' } = {}) {
    const rows = (candidates || []).map(c => ({ key: c.key, kind: c.why, around: c.around || c.value }));
    return (
      ID_JUDGMENT +
      (context ? '\n\nThe conversation just before (oldest first):\n' + String(context).slice(-2400) : '') +
      '\n\nCandidates (JSON): ' +
      JSON.stringify(rows) +
      '\n\nAnswer with JSON only: {"verdicts":[{"key":"<the key>","verdict":"practice|real|unsure","reason":"<one line>"}]}'
    );
  }
  /**
   * The kept verdicts by the value's fingerprint, from idchecks documents: a judged one under <key>, Matt's own under
   * <key>-matt, which overrides it. A practice verdict passes; real and unsure hold.
   */
  function keptVerdicts(idchecks) {
    const out = {};
    const docs = (idchecks || []).filter(d => d && d.key && ID_VERDICTS.includes(d.verdict));
    for (const d of docs) if (d.by !== 'matt') out[d.key] = d;
    for (const d of docs) if (d.by === 'matt') out[d.key] = d;
    return out;
  }
  // B-163 (Matt, Oct 22: "Ask me on the page"): a scheduled run never passes a value on its own judgment. It holds a
  // fresh candidate and keeps it as held (by: held, unsure) until Matt answers on the page: It's made up or Keep it out,
  // kept as <key>-matt, which every later run reads first.
  const ID_HELD_REASON = 'held for Matt: a run never passes a value on its own';
  /** What runs held that Matt has not answered yet: where and what kind, never the value. Oldest first. */
  function heldForMatt(idchecks) {
    const docs = (idchecks || []).filter(d => d && d.key);
    const answered = new Set(docs.filter(d => d.by === 'matt').map(d => d.key));
    const seen = new Set();
    return docs
      .filter(d => d.by === 'held' && !answered.has(d.key) && !seen.has(d.key) && seen.add(d.key))
      .map(d => ({ key: d.key, kind: d.kind, ref: d.ref, at: d.at, source: d.source }))
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  /**
   * B-163 (Matt, Oct 22): course files carry many fictional case-study clients, so Your turn asks once per place a run
   * held from, not once per value: { ref, source, at, items: [{ key, kind }], kinds }, oldest first. His one tap still
   * keeps an answer per key, so a re-imported file asks only about values he has not answered.
   */
  function heldByPlace(idchecks) {
    const by = new Map();
    for (const h of heldForMatt(idchecks)) {
      const ref = h.ref || 'a run';
      if (!by.has(ref)) by.set(ref, { ref, source: h.source, at: h.at, items: [], kinds: [] });
      const g = by.get(ref);
      g.items.push({ key: h.key, kind: h.kind });
      const kind = String(h.kind || 'has a detail').replace(/^has /, '');
      if (!g.kinds.includes(kind)) g.kinds.push(kind);
    }
    return [...by.values()];
  }
  /**
   * Answers to the judgment in a usable form: one verdict per candidate key; a candidate the answer leaves out, or an
   * answer that is not one of the three, is unsure (held, never passed).
   */
  function readVerdicts(candidates, answer) {
    const got = {};
    for (const v of (answer && answer.verdicts) || [])
      if (v && v.key && ID_VERDICTS.includes(v.verdict)) got[v.key] = v;
    return (candidates || []).map(c => ({
      ...c,
      verdict: got[c.key] ? got[c.key].verdict : 'unsure',
      reason: got[c.key] ? String(got[c.key].reason || '').slice(0, 200) : 'no verdict came back for it',
    }));
  }
  /**
   * What the page says when a value is held: neutral, never an accusation; he decides. (B-197: the wording lint keeps
   * every identifier message here and on the page free of words that accuse.)
   */
  function idHeldLine(n) {
    return n === 1
      ? 'One detail here looks like it could be a real patient’s, so I’d leave it out. If it’s from a practice scenario, tap It’s made up.'
      : `${n} details here look like they could be a real patient’s, so I’d leave them out. If they’re from a practice scenario, tap It’s made up.`;
  }
  return {
    scanIdentifierValues,
    identifierCandidates,
    idKey,
    holdBack,
    idContext,
    ID_HELD,
    ID_VERDICTS,
    ID_JUDGMENT,
    ID_ANSWER_SHAPE,
    idJudgmentPrompt,
    keptVerdicts,
    ID_HELD_REASON,
    heldForMatt,
    heldByPlace,
    readVerdicts,
    idHeldLine,
  };
}
