// E.V. core's Quizlet cards from weak spots, split from core/evcore.mjs (B-158, D-166) as one factory with no imports,
// so the same file runs in node (evcore.mjs imports it) and in the page (the build writes it into core.js ahead of E.V.
// core). The skills checklists and workouts it once held are retired (D-416). It takes the core names it uses and
// returns the names core's export map uses.

export function makeSkills(core) {
  'use strict';
  const { collectAttempts, isActive } = core;

  /** Flashcards as Quizlet import text: term, a tab, the definition, one card per line (B-479: tabs and line breaks
   *  inside a card become spaces, a card marked verify keeps "[verify]" in its definition, empty cards are left out). */
  function cardsText(cards) {
    const flat = t =>
      String(t == null ? '' : t)
        .replace(/[\t\r\n]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return (cards || [])
      .filter(c => c && flat(c.term) && flat(c.definition))
      .map(c => {
        const d = flat(c.definition);
        return flat(c.term) + '\t' + (c.verify && !/\[verify\]/i.test(d) ? d + ' [verify]' : d);
      })
      .join('\n');
  }
  /**
   * The open weak spots as Quizlet cards (B-41, Matt's pick 5): the topic as the term; the objective's text and the
   * rationale of the last question he missed on it (the right answer's) as the definition. Concept weak spots only,
   * due soonest first. Tabs and line breaks become spaces so each card stays one import line.
   */
  function weakspotCards({ weakspots = [], objectives = [], sets = [], answers = [] } = {}) {
    const flat = t =>
      String(t || '')
        .replace(/[\t\r\n]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    const objText = new Map((objectives || []).map(o => [o.id, o.text]));
    const items = new Map();
    for (const st of sets || []) for (const q of st.items || []) items.set(st.id + '/' + q.id, q);
    const { byWeakspot } = collectAttempts(sets, answers, weakspots); // B-232: a duplicate's answers on its survivor
    const why = q => {
      if (!q) return '';
      if (q.matrix && Array.isArray(q.matrix.rows))
        return q.matrix.rows
          .map(r => r.rationale)
          .filter(Boolean)
          .join(' ');
      const right = (q.correct || [])[0];
      const r = (q.rationales || [])[right];
      return [q.options && q.options[right] != null ? `Answer: ${q.options[right]}.` : '', r || '']
        .filter(Boolean)
        .join(' ');
    };
    return (weakspots || [])
      .filter(w => (w.kind || 'concept') === 'concept' && isActive(w))
      .sort(
        (a, b) =>
          String(a.derived.nextDue || '9').localeCompare(String(b.derived.nextDue || '9')) ||
          String(a.topic).localeCompare(String(b.topic))
      )
      .map(w => {
        const missed = (byWeakspot[w.id] || []).filter(a => !a.correct).pop();
        const parts = [
          objText.get(w.objective) ? `${w.objective}: ${objText.get(w.objective)}` : w.objective || '',
          missed ? why(items.get(missed.setId + '/' + missed.itemId)) : '',
        ];
        return { term: flat(w.topic), definition: flat(parts.filter(Boolean).join(' · ')) || 'Open weak spot' };
      });
  }

  return {
    cardsText,
    weakspotCards,
  };
}
