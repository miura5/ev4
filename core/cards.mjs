// E.V. core's flashcard decks (B-487, D-368): a deck per course holds its cards in decks/<id>.cards, each card with its
// own schedule, rated Again / Hard / Good / Easy the way Anki's SM-2 does it (Matt, Oct 29). One factory with no
// imports, as core's other sections: the same file runs in node (evcore.mjs imports it) and in the page (the build
// writes it into core.js ahead of E.V. core). Nothing is deleted: a card is retired by a mark.
//
// A card: { term, definition, verify?, retired?, at, editedAt?, state?, due?, ivl?, ease?, reps?, lapses?, last?,
// lastAt? }. No state means new (due now). learning and relearning cards come back in the same session and are due
// tomorrow in the record; a review card's due is today plus its interval, in Central dates.

export function makeCards(core) {
  'use strict';
  const { chicagoDate, addDays, guessCourse, defaultCourse } = core;
  const RATINGS = ['again', 'hard', 'good', 'easy'];
  const EASE0 = 2.5,
    EASE_MIN = 1.3,
    MAX_CARDS = 40;
  const r2 = x => Math.round(x * 100) / 100;
  const clean = (t, n) =>
    String(t == null ? '' : t)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, n);
  const compact = iso => String(new Date(iso).toISOString()).replace(/\D/g, '').slice(0, 14);

  /** A card's schedule, with the defaults a new card has. */
  function cardSched(c) {
    const s = c || {};
    return {
      state: s.state || 'new',
      ivl: Number.isInteger(s.ivl) ? s.ivl : 0,
      ease: typeof s.ease === 'number' ? s.ease : EASE0,
      reps: s.reps || 0,
      lapses: s.lapses || 0,
      due: s.due || null,
    };
  }
  /** The next interval in days each rating gives a card (0: again this session). */
  function cardNext(c) {
    const s = cardSched(c);
    if (s.state !== 'review') return { again: 0, hard: 0, good: 1, easy: 4 };
    const i = Math.max(1, s.ivl);
    const hard = Math.max(Math.round(i * 1.2), i + 1);
    const good = Math.max(Math.round(i * s.ease), hard + 1);
    const easy = Math.max(Math.round(i * s.ease * 1.3), good + 1);
    return { again: 0, hard, good, easy };
  }
  /** What each button says under it, as Anki's: "<1d" for this session, else the days. */
  function cardNextLabels(c) {
    const n = cardNext(c);
    return Object.fromEntries(RATINGS.map(r => [r, n[r] ? n[r] + 'd' : '<1d']));
  }
  /**
   * B-487: a card rated on `today` (a Central date): its new schedule and whether it comes back this session.
   * New or learning: Again and Hard come back this session (due tomorrow), Good graduates to 1 day, Easy to 4.
   * Review: Again is a lapse (ease -0.2, relearning); Hard x1.2 (ease -0.15); Good x ease; Easy x ease x1.3 (+0.15).
   * Ease never goes below 1.3; Hard, Good and Easy on a review card are at least a day longer than before.
   */
  function rateCard(c, rating, today, at) {
    if (!RATINGS.includes(rating)) throw new Error('a rating is again, hard, good or easy');
    const s = cardSched(c);
    const n = cardNext(c);
    let { state, ease, lapses } = s;
    if (s.state === 'review') {
      if (rating === 'again') {
        state = 'relearning';
        ease -= 0.2;
        lapses += 1;
      } else if (rating === 'hard') ease -= 0.15;
      else if (rating === 'easy') ease += 0.15;
    } else if (rating === 'good' || rating === 'easy') state = 'review';
    else state = s.state === 'relearning' ? 'relearning' : 'learning';
    const ivl = state === 'review' ? n[rating] : 0;
    return {
      sched: {
        state,
        ivl,
        ease: r2(Math.max(EASE_MIN, ease)),
        reps: s.reps + 1,
        lapses,
        due: addDays(today, ivl || 1),
        last: rating,
        ...(at ? { lastAt: at } : {}),
      },
      again: !ivl,
    };
  }
  const live = d => Object.entries((d && d.cards) || {}).filter(([, c]) => c && !c.retired && c.term && c.definition);
  const isDue = (c, today) => !c.due || c.due <= today;
  /** A deck's cards he studies (not retired), in the order they were made, as [{ id, ...card }]. */
  const deckCards = d =>
    live(d)
      .map(([id, c]) => ({ id, ...c }))
      .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')) || a.id.localeCompare(b.id));
  /** The cards due on `today` (new ones are due now), from one deck or several, each with its deck's id. */
  function cardsDue(decks, today) {
    const out = [];
    for (const d of [].concat(decks || []))
      if (d && !d.retired) for (const c of deckCards(d)) if (isDue(c, today)) out.push({ ...c, deck: d.id });
    return out;
  }
  /**
   * Multiple choice for one card: its definition and up to 3 others from the deck's other cards (distinct, never the
   * same words), placed by `seed` so a card's choices stay put while it is on screen. { options, correct }.
   */
  function cardChoices(deck, cardId, seed = '') {
    const cards = deckCards(deck);
    const me = cards.find(c => c.id === cardId);
    if (!me) return { options: [], correct: -1 };
    const k = t => clean(t, 400).toLowerCase();
    let h = 2166136261;
    for (const ch of String(seed) + cardId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), (h % 1e6) / 1e6);
    const seen = new Set([k(me.definition)]);
    const pool = cards.filter(c => c.id !== cardId && !seen.has(k(c.definition)) && seen.add(k(c.definition)));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const options = [me.definition, ...pool.slice(0, 3).map(c => c.definition)];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return { options, correct: options.indexOf(me.definition) };
  }
  /**
   * B-487 (closes B-485): a line asking for flashcards, routed by code to the flashcards job (never the chat model's
   * choice): "flashcards on …", "flash cards", "make 15 cards on …". { kind, title, brief, course, count } or null.
   */
  function flashcardAsk(text) {
    const line = clean(text, 1500);
    const flash = /\bflash[\s-]*cards?\b/i.test(line);
    const on = /\b(\d{1,2}\s+)?cards?\s+(on|about|for|covering)\s+\S/i.test(line);
    if (!flash && !on) return null;
    if (/\bquizlet\b/i.test(line) && /\bweak[\s-]*spots?\b/i.test(line)) return null; // the weak spots' Quizlet ask
    // an ask to make some, not a line about a flashcards item on his list ("take the flashcards off today")
    if (/\b(take|remove|delete|skip|move|tick|check off|off today|done with|finished)\b/i.test(line)) return null;
    const m = /\b(\d{1,2})\s+(?:flash[\s-]*)?cards?\b/i.exec(line);
    const lead = /^(please\s+)?(\d{1,2}\s+)?(flash[\s-]*)?cards?\b/i.test(line);
    const verb = /\b(make|create|give|generate|build|write|want|need|get|send|please|can i have|could i have)\b/i;
    if (!m && !lead && !verb.test(line)) return null;
    const count = Math.min(MAX_CARDS, Math.max(1, m ? Number(m[1]) : 20));
    const t = /\b(?:on|about|for|covering)\s+(.+)$/i.exec(line);
    const topic = clean((t ? t[1] : line).replace(/[?.!]+$/, ''), 70) || 'your course';
    const course = (guessCourse && guessCourse(line)) || (defaultCourse && defaultCourse()) || null;
    return {
      kind: 'flashcards',
      title: 'Flashcards: ' + topic,
      brief: `${count} flashcards on ${topic}. His words: ${line}`.slice(0, 1500),
      course,
      count,
    };
  }
  /** A new deck's id: deck-<UTC time>-<slug>; a job's deck has its job's id (deck-<the job id's rest>). */
  const slugOf = t =>
    String(t || '')
      .toLowerCase()
      .replace(/^flashcards:\s*/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
      .replace(/-+$/, '') || 'deck';
  const deckId = (title, at) => {
    const t = compact(at);
    return `deck-${t.slice(0, 8)}-${t.slice(8)}-${slugOf(title)}`;
  };
  // B-493: a verify marker a model wrote into the words ("…; verify: true", "(verify)", "[verify]") at their end
  const VERIFY_TAIL =
    /(?:\s*[;,|]\s*verify(?:\s*:\s*(?:true|yes))?|\s*[([]\s*verify(?:\s*:\s*(?:true|yes))?\s*[)\]]|\s+verify\s*:\s*(?:true|yes))[\s.;]*$/i;
  /** Cards from a list ({ term, definition, verify }): cleaned, empty ones left out, at most 40, keyed c-001 on. A
   * verify marker in the words is taken off them and kept as the flag alone (B-493). */
  function cardsFrom(items, at) {
    const out = {};
    let n = 0;
    for (const it of items || []) {
      const t0 = clean(it && it.term, 300),
        d0 = clean(it && it.definition, 1000);
      const term = t0.replace(VERIFY_TAIL, ''),
        def = d0.replace(VERIFY_TAIL, '');
      if (!term || !def || n >= MAX_CARDS) continue;
      const verify = !!(it.verify === true || it.verify === 'true' || term !== t0 || def !== d0);
      out['c-' + String(++n).padStart(3, '0')] = { term, definition: def, ...(verify ? { verify: true } : {}), at };
    }
    return out;
  }
  /** The set write of a new deck (the page's + New deck, or a flashcards job's fold). */
  function deckNew({ title, course, items = [], writer = 'page', source, now, job, id }) {
    const at = new Date(now || Date.now()).toISOString();
    return {
      op: 'set',
      collection: 'decks',
      id: id || deckId(title, at),
      data: {
        schema: 1,
        writer,
        at,
        source: String(source || (writer === 'page' ? 'E.V. Home' : writer)),
        course: course || (defaultCourse && defaultCourse()) || 'Course',
        title: clean(title, 120) || 'Flashcards',
        createdAt: at,
        ...(job ? { job } : {}),
        cards: cardsFrom(items, at),
      },
    };
  }
  /** One card's update: only that card's entry is sent, so the save merges into the deck as it is now. */
  const cardWrite = (deck, id, card) => ({
    op: 'update',
    collection: 'decks',
    id: deck.id,
    data: { cards: { [id]: card } },
  });
  const cardOf = (deck, id) => {
    const c = ((deck && deck.cards) || {})[id];
    if (!c) throw new Error('no card ' + id + ' in ' + (deck && deck.id));
    return c;
  };
  /** + New card: a new entry c-<UTC time>, new (due now). */
  function deckCardAdd(deck, { term, definition }, now) {
    const at = new Date(now || Date.now()).toISOString();
    const t = clean(term, 300),
      d = clean(definition, 1000);
    if (!t || !d) throw new Error('a card needs a term and a definition');
    let id = 'c-' + compact(at);
    while ((deck.cards || {})[id]) id = 'c-' + String(Number(id.slice(2)) + 1);
    return cardWrite(deck, id, { term: t, definition: d, at });
  }
  /** Edit a card's words; its schedule stays. An edit by hand clears the verify mark. */
  function deckCardEdit(deck, id, { term, definition }, now) {
    const c = cardOf(deck, id);
    const t = clean(term, 300),
      d = clean(definition, 1000);
    if (!t || !d) throw new Error('a card needs a term and a definition');
    return cardWrite(deck, id, {
      ...c,
      term: t,
      definition: d,
      verify: false,
      editedAt: new Date(now || Date.now()).toISOString(),
    });
  }
  /** Retire a card (or bring it back): a mark, never a delete. */
  function deckCardRetire(deck, id, retired, now) {
    const c = cardOf(deck, id);
    return cardWrite(deck, id, { ...c, retired: !!retired, editedAt: new Date(now || Date.now()).toISOString() });
  }
  /** A rating's write: the card with its new schedule. { write, again } (again: show it later this session). */
  function deckReview(deck, id, rating, now) {
    const c = cardOf(deck, id);
    const at = new Date(now || Date.now()).toISOString();
    const r = rateCard(c, rating, chicagoDate(at), at);
    return { write: cardWrite(deck, id, { ...c, ...r.sched }), again: r.again, card: { ...c, ...r.sched } };
  }
  /** B-487: the deck a flashcards job's answer makes: its course is the job's, else the one its words name. */
  function deckFromJob({ job, items, now, source, writer = 'worker' }) {
    const course = job.course || (guessCourse ? guessCourse(job.title + ' ' + job.brief) : null);
    const id = 'deck-' + String(job.id).replace(/^job-/, '');
    const title = clean(String(job.title || '').replace(/^flashcards:\s*/i, ''), 120) || 'Flashcards';
    return deckNew({ title, course, items, writer, source, now, job: job.id, id });
  }

  return {
    CARD_RATINGS: RATINGS,
    cardSched,
    cardNext,
    cardNextLabels,
    rateCard,
    deckCards,
    cardsDue,
    cardChoices,
    flashcardAsk,
    deckNew,
    deckCardAdd,
    deckCardEdit,
    deckCardRetire,
    deckReview,
    deckFromJob,
  };
}
