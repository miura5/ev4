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
    const cards = /\b(flash[\s-]*)?cards?\b/i;
    if (!cards.test(line)) return null;
    if (/\bquizlet\b/i.test(line) && /\bweak[\s-]*spots?\b/i.test(line)) return null; // the weak spots' Quizlet ask
    // an ask to make some, not a line about a flashcards item on his list ("take the flashcards off today")
    if (/\b(take|remove|delete|skip|move|tick|check off|off today|done with|finished)\b/i.test(line)) return null;
    // B-495: only an ask to make cards starts a job: make / create / give me … cards, a line that leads with its cards
    // ("15 flashcards on …", "flashcards on …"), or "I want/need 20 cards"; studying cards he has never does
    const make = new RegExp(
      '\\b(make|create|generate|build|write|draft|produce|whip up|put together|give me|get me|send me|' +
        "(?:i'd like|i want|i need|can i have|could i have)\\s+(?:\\d{1,2}|some|a (?:set|deck) of|a few))\\b" +
        '[^.?!]{0,40}?\\b(?:flash[\\s-]*)?cards?\\b',
      'i'
    );
    const lead =
      /^(please\s+)?(\d{1,2}\s+)?(flash[\s-]*cards?\b(\s+(on|about|for|covering)\b|\s*(please)?\s*$)|cards?\s+(on|about|covering)\s)/i;
    if (cardsStudyAsk(line) && !/\b(make|create|generate|build|write)\b/i.test(line)) return null;
    if (!make.test(line) && !lead.test(line)) return null;
    const m = /\b(\d{1,2})\s+(?:flash[\s-]*)?cards?\b/i.exec(line);
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
  /** B-495: a line about studying the cards he has ("study my cards", "review flashcards"): it opens his due cards. */
  function cardsStudyAsk(text) {
    const line = clean(text, 400);
    return /\b(study|review|go over|practi[cs]e|drill|run through|quiz me on)\b[^.?!]{0,30}?\b(flash[\s-]*cards?|cards?|decks?)\b/i.test(
      line
    );
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
  function cardsFrom(items, at, max = MAX_CARDS) {
    const out = {};
    let n = 0;
    for (const it of items || []) {
      const t0 = clean(it && it.term, 300),
        d0 = clean(it && it.definition, 1000);
      const term = t0.replace(VERIFY_TAIL, ''),
        def = d0.replace(VERIFY_TAIL, '');
      if (!term || !def || n >= max) continue;
      const verify = !!(it.verify === true || it.verify === 'true' || term !== t0 || def !== d0);
      out['c-' + String(++n).padStart(3, '0')] = { term, definition: def, ...(verify ? { verify: true } : {}), at };
    }
    return out;
  }
  /** The set write of a new deck (the page's + New deck, or a flashcards job's fold). */
  function deckNew({ title, course, items = [], writer = 'page', source, now, job, id, max }) {
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
        cards: cardsFrom(items, at, max),
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

  // ---------------------------------------------------------------- B-488: Written and Learn
  /** An answer as the check compares it: lower case, accents, punctuation and extra spaces gone. */
  const norm = t =>
    String(t == null ? '' : t)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  function lev(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  /** The typos a term of this length allows: none up to 3 letters (mg is not mcg), 1 up to 9, 2 from 10. */
  const typoAllowance = n => (n <= 3 ? 0 : n <= 9 ? 1 : 2);
  /**
   * B-488: Written's check of what he typed against the term: exact (case, spaces and punctuation aside), near (a
   * small typo, shown with the right spelling) or wrong. { verdict, expected }.
   */
  function answerMatch(expected, typed) {
    const e = norm(expected),
      t = norm(typed);
    if (!t) return { verdict: 'wrong', expected };
    if (t === e || t.replace(/ /g, '') === e.replace(/ /g, '')) return { verdict: 'exact', expected };
    const d = lev(t, e);
    return { verdict: d <= typoAllowance(e.length) ? 'near' : 'wrong', expected };
  }
  /**
   * B-488: a Learn session over cards ([{ deck, id }]): rounds of `size` cards; each climbs from Multiple choice to
   * Written and is learned when answered right in Written; a miss drops it back to Multiple choice and it comes back
   * later in the round. A round ends when each of its cards is learned; the next takes the next cards. Plain JSON, so
   * an "I was right" can put the state back as it was before the answer.
   */
  function learnStart(cards, size = 7) {
    const keys = [...new Set((cards || []).map(c => c.deck + '/' + c.id))];
    const st = { size, total: keys.length, pool: keys, round: [], queue: [], stage: {}, learned: [], missed: {} };
    Object.assign(st, { rated: {}, roundNo: 0, last: null });
    learnNextRound(st);
    return st;
  }
  /** The next round's cards from the pool. */
  function learnNextRound(st) {
    st.round = st.pool.splice(0, st.size);
    st.queue = st.round.slice();
    for (const k of st.round) st.stage[k] = 'mc';
    if (st.round.length) st.roundNo++;
    return st;
  }
  const keyOf = k => ({ deck: k.slice(0, k.indexOf('/')), id: k.slice(k.indexOf('/') + 1) });
  /** What is asked now: { deck, id, stage } ('mc' or 'written'), { roundDone: true } between rounds, or null at the end. */
  function learnCur(st) {
    if (st.queue.length) return { ...keyOf(st.queue[0]), stage: st.stage[st.queue[0]] };
    return st.pool.length ? { roundDone: true } : null;
  }
  /**
   * The answer to what is asked now: right climbs (Multiple choice to Written, Written to learned), a miss drops back
   * to Multiple choice two cards on. { first }: true only for the card's first answer in the session, the one answer
   * whose rating is written (Again on a miss; Hard, Good or Easy he picks on a right one).
   */
  function learnAnswer(st, right) {
    const k = st.queue[0];
    if (!k) return { first: false, learned: false };
    st.last = JSON.stringify({ ...st, last: null });
    st.queue.shift();
    const first = !st.rated[k];
    st.rated[k] = true;
    let learned = false;
    if (right && st.stage[k] === 'written') {
      st.learned.push(k);
      learned = true;
    } else if (right) {
      st.stage[k] = 'written';
      st.queue.push(k);
    } else {
      st.missed[k] = (st.missed[k] || 0) + 1;
      st.stage[k] = 'mc';
      st.queue.splice(Math.min(st.queue.length, 2), 0, k);
    }
    return { first, learned };
  }
  /** "I was right" on a missed Written answer: the state as before it, then the answer counted right. */
  function learnOverride(st) {
    if (!st.last) return { first: false, learned: false };
    const before = JSON.parse(st.last);
    for (const k of Object.keys(st)) delete st[k];
    Object.assign(st, before);
    return learnAnswer(st, true);
  }
  /** The end: what was learned cleanly and what is still shaky (missed at least once, or answered but not learned). */
  function learnSummary(st) {
    const learned = st.learned.filter(k => !st.missed[k]).map(keyOf);
    const shaky = Object.keys(st.rated)
      .filter(k => st.missed[k] || !st.learned.includes(k))
      .map(k => ({ ...keyOf(k), missed: st.missed[k] || 0, learned: st.learned.includes(k) }));
    return { learned, shaky, total: st.total, done: st.learned.length };
  }

  // ---------------------------------------------------------------- B-489: a Quizlet paste
  const IMPORT_MAX = 300; // a deck stays well under a document's 256 KiB with its schedules
  /**
   * B-489: Quizlet's export text (Export, then copy): one card per line (or per ";" when the text has no line breaks),
   * term and definition split at the first tab, comma or the separator he names. sep: 'tab', 'comma', any other
   * text, or null to guess (tab when the text has one, else comma). { items, skipped, sep }: lines with no term or no
   * definition are skipped, never guessed at. Nothing is fetched from Quizlet.
   */
  function quizletParse(text, sep = null) {
    const raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const s = sep || (raw.includes('\t') ? 'tab' : 'comma');
    const cut = s === 'tab' ? '\t' : s === 'comma' ? ',' : String(s);
    const lines = (!raw.trim().includes('\n') && raw.includes(';') && cut !== ';' ? raw.split(';') : raw.split('\n'))
      .map(l => l.trim())
      .filter(Boolean);
    const items = [];
    let skipped = 0;
    for (const l of lines) {
      const i = cut ? l.indexOf(cut) : -1;
      const term = i < 0 ? '' : clean(l.slice(0, i), 300),
        definition = i < 0 ? '' : clean(l.slice(i + cut.length), 1000);
      if (term && definition) items.push({ term, definition });
      else skipped++;
    }
    return { items, skipped, sep: s };
  }
  const termKey = t => clean(t, 300).toLowerCase();
  /**
   * B-489: cards added to a deck he has: one update with only the new entries (c-<UTC time><nnn>, new, due now), so no
   * card already there changes; a term the deck already has (not retired) is left out. { write, added, dupes }.
   */
  function deckCardsAdd(deck, items, now, max = IMPORT_MAX) {
    const at = new Date(now || Date.now()).toISOString();
    const have = new Set(live(deck).map(([, c]) => termKey(c.term)));
    const fresh = {};
    let dupes = 0,
      n = 0,
      seq = 0;
    for (const it of items || []) {
      const t = clean(it && it.term, 300),
        d = clean(it && it.definition, 1000);
      if (!t || !d) continue;
      if (have.has(termKey(t))) {
        dupes++;
        continue;
      }
      if (n >= max) break;
      have.add(termKey(t));
      n++;
      let id;
      do id = 'c-' + compact(at) + String(++seq).padStart(3, '0');
      while ((deck.cards || {})[id]);
      fresh[id] = { term: t, definition: d, at };
    }
    return { write: { op: 'update', collection: 'decks', id: deck.id, data: { cards: fresh } }, added: n, dupes };
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
    cardsStudyAsk,
    deckNew,
    deckCardAdd,
    deckCardEdit,
    deckCardRetire,
    deckReview,
    deckFromJob,
    answerMatch,
    learnStart,
    learnNextRound,
    learnCur,
    learnAnswer,
    learnOverride,
    learnSummary,
    IMPORT_MAX,
    quizletParse,
    deckCardsAdd,
  };
}
