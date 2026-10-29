// B-487 (D-368): flashcard decks in E.V. core (core/cards.mjs): Anki-style ratings per card (SM-2), the deck writes
// and their schema, multiple-choice distractors, a flashcard ask routed by code, and the flashcards job making a deck.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';
import * as J from '../pwa/jobs.mjs';
import { jobReply } from '../pwa/job-stub.mjs';
import { seedRecord } from '../pwa/seed.mjs';
import { loadSchemas } from '../core/schemas.mjs';
import { makeValidator } from '../core/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = makeValidator(loadSchemas());
const TODAY = '2026-10-29';
const AT = '2026-10-29T15:00:00.000Z'; // 10:00 CT

test('B-487: a new card: Again and Hard come back this session (due tomorrow), Good graduates to 1 day, Easy to 4', () => {
  const c = { term: 'mcg', definition: 'microgram', at: AT };
  assert.deepEqual(EV.cardNextLabels(c), { again: '<1d', hard: '<1d', good: '1d', easy: '4d' });
  const again = EV.rateCard(c, 'again', TODAY);
  assert.equal(again.again, true);
  assert.deepEqual(
    [again.sched.state, again.sched.ivl, again.sched.due, again.sched.ease, again.sched.lapses],
    ['learning', 0, '2026-10-30', 2.5, 0]
  );
  const hard = EV.rateCard(c, 'hard', TODAY);
  assert.deepEqual([hard.again, hard.sched.state, hard.sched.due], [true, 'learning', '2026-10-30']);
  const good = EV.rateCard(c, 'good', TODAY);
  assert.deepEqual([good.again, good.sched.state, good.sched.ivl, good.sched.due], [false, 'review', 1, '2026-10-30']);
  const easy = EV.rateCard(c, 'easy', TODAY);
  assert.deepEqual(
    [easy.sched.state, easy.sched.ivl, easy.sched.due, easy.sched.ease],
    ['review', 4, '2026-11-02', 2.5]
  );
  // a learning card graduates the same way
  assert.equal(EV.rateCard({ ...c, ...again.sched }, 'good', TODAY).sched.ivl, 1);
});

test('B-487: a review card: Hard x1.2 (ease -0.15), Good x ease, Easy x ease x1.3 (ease +0.15), Again lapses', () => {
  const c = { term: 'gtt', definition: 'drops', at: AT, state: 'review', ivl: 10, ease: 2.5, reps: 3, due: TODAY };
  assert.deepEqual(EV.cardNext(c), { again: 0, hard: 12, good: 25, easy: 33 });
  assert.deepEqual(EV.cardNextLabels(c), { again: '<1d', hard: '12d', good: '25d', easy: '33d' });
  const hard = EV.rateCard(c, 'hard', TODAY).sched;
  assert.deepEqual([hard.ivl, hard.ease, hard.due, hard.reps], [12, 2.35, '2026-11-10', 4]);
  const good = EV.rateCard(c, 'good', TODAY).sched;
  assert.deepEqual([good.ivl, good.ease, good.due], [25, 2.5, '2026-11-23']);
  const easy = EV.rateCard(c, 'easy', TODAY).sched;
  assert.deepEqual([easy.ivl, easy.ease], [33, 2.65]);
  const again = EV.rateCard(c, 'again', TODAY);
  assert.equal(again.again, true);
  assert.deepEqual(
    [again.sched.state, again.sched.ivl, again.sched.ease, again.sched.lapses, again.sched.due],
    ['relearning', 0, 2.3, 1, '2026-10-30']
  );
  // relearning: Hard stays relearning; Good graduates back to a day
  assert.equal(EV.rateCard({ ...c, ...again.sched }, 'hard', TODAY).sched.state, 'relearning');
  assert.equal(EV.rateCard({ ...c, ...again.sched }, 'good', TODAY).sched.ivl, 1);
  // Hard, Good and Easy are each at least a day longer than before, and each longer than the one before it
  const one = { ...c, ivl: 1, ease: 1.3 };
  assert.deepEqual(EV.cardNext(one), { again: 0, hard: 2, good: 3, easy: 4 });
});

test('B-487: ease never goes below 1.3', () => {
  let c = { term: 'q6h', definition: 'every 6 hours', at: AT, state: 'review', ivl: 5, ease: 1.4 };
  c = { ...c, ...EV.rateCard(c, 'again', TODAY).sched };
  assert.equal(c.ease, 1.3);
  c = { ...c, state: 'review', ivl: 5 };
  assert.equal(EV.rateCard(c, 'hard', TODAY).sched.ease, 1.3);
  assert.throws(() => EV.rateCard(c, 'skip', TODAY), /again, hard, good or easy/);
});

const deck = () => {
  const w = EV.deckNew({
    title: 'Dosage terms',
    course: 'NUR 112',
    now: AT,
    items: [
      { term: 'mcg', definition: 'microgram' },
      { term: 'gtt', definition: 'drops' },
      { term: 'Drop factor', definition: 'drops per mL of tubing [verify]' },
      { term: 'PRN', definition: 'as needed', verify: true },
      { term: 'BID', definition: 'twice a day' },
      { term: '', definition: 'no term' },
    ],
  });
  return { w, d: { id: w.id, ...w.data } };
};

test('B-487: a new deck is one set write its schema takes; cards keyed c-001 on, verify marks kept, empty ones left out', () => {
  const { w, d } = deck();
  assert.equal(w.op, 'set');
  assert.equal(w.collection, 'decks');
  assert.equal(w.id, 'deck-20261029-150000-dosage-terms');
  assert.ok(validate('decks', w.data, { id: w.id }).ok, JSON.stringify(validate('decks', w.data, { id: w.id })));
  assert.deepEqual(Object.keys(d.cards), ['c-001', 'c-002', 'c-003', 'c-004', 'c-005']);
  assert.deepEqual(d.cards['c-003'], {
    term: 'Drop factor',
    definition: 'drops per mL of tubing',
    verify: true,
    at: AT,
  });
  assert.equal(d.cards['c-004'].verify, true);
  // new cards are due now
  assert.equal(EV.cardsDue([d], TODAY).length, 5);
  assert.ok(
    !validate('decks', { ...w.data, cards: { x1: d.cards['c-001'] } }, { id: w.id }).ok,
    'a card key off c-<n>'
  );
  assert.equal(spec.collections.decks.schema, 'spec/schemas/decks.schema.json');
  assert.deepEqual(spec.collections.decks.writers, ['page', 'worker']);
  assert.ok(spec.ui.page.subscribe.some(s => s.collection === 'decks'));
});

test('B-487: add, edit, retire and review are one card’s update each; nothing is deleted; the deck still fits', () => {
  const { d } = deck();
  const later = '2026-10-29T16:00:00.000Z';
  const add = EV.deckCardAdd(d, { term: 'TID', definition: 'three times a day' }, later);
  assert.deepEqual(add, {
    op: 'update',
    collection: 'decks',
    id: d.id,
    data: { cards: { 'c-20261029160000': { term: 'TID', definition: 'three times a day', at: later } } },
  });
  const edit = EV.deckCardEdit(d, 'c-003', { term: 'Drop factor', definition: 'gtt per mL' }, later);
  assert.deepEqual(Object.keys(edit.data.cards), ['c-003']);
  assert.equal(edit.data.cards['c-003'].verify, false);
  const ret = EV.deckCardRetire(d, 'c-002', true, later);
  assert.equal(ret.data.cards['c-002'].retired, true);
  assert.equal(ret.data.cards['c-002'].term, 'gtt', 'the card is kept, marked');
  const r = EV.deckReview(d, 'c-001', 'good', later);
  assert.deepEqual(
    [r.write.op, r.again, r.write.data.cards['c-001'].due, r.write.data.cards['c-001'].lastAt],
    ['update', false, '2026-10-30', later]
  );
  // each merged into the deck still fits its schema; a retired card leaves study and the due count
  let doc = { ...d };
  for (const w of [add, edit, ret, r.write]) doc = { ...doc, cards: { ...doc.cards, ...w.data.cards } };
  const { id, ...data } = doc;
  assert.ok(validate('decks', data, { id }).ok);
  assert.equal(EV.deckCards(doc).length, 5);
  assert.equal(EV.cardsDue([doc], TODAY).length, 4);
  assert.throws(() => EV.deckCardAdd(d, { term: ' ', definition: 'x' }), /term and a definition/);
});

test('B-487: multiple choice: the right definition and 3 others from the deck, distinct, the same for the same seed', () => {
  const { d } = deck();
  const a = EV.cardChoices(d, 'c-001', 's1');
  assert.equal(a.options.length, 4);
  assert.equal(a.options[a.correct], 'microgram');
  assert.equal(new Set(a.options).size, 4);
  assert.ok(a.options.every(o => EV.deckCards(d).some(c => c.definition === o)));
  assert.deepEqual(EV.cardChoices(d, 'c-001', 's1'), a);
  // a small deck gives what it has; the same words on another card are never a second choice
  const small = {
    id: 'x',
    cards: { 'c-001': d.cards['c-001'], 'c-002': { ...d.cards['c-002'], definition: 'microgram' } },
  };
  assert.deepEqual(EV.cardChoices(small, 'c-001', 's'), { options: ['microgram'], correct: 0 });
});

test('B-487 (B-485): a flashcard ask is routed by code to the flashcards job, with its count, topic and course', () => {
  const a = EV.flashcardAsk('Make me 15 flashcards on cardiac meds for NUR 112');
  assert.deepEqual(
    [a.kind, a.count, a.title, a.course],
    ['flashcards', 15, 'Flashcards: cardiac meds for NUR 112', 'NUR 112']
  );
  assert.match(a.brief, /^15 flashcards on cardiac meds/);
  assert.equal(EV.flashcardAsk('flash cards please').count, 20);
  assert.equal(EV.flashcardAsk('cards on the cranial nerves for bio 201').course, 'BIO 201');
  assert.equal(EV.flashcardAsk('199 flashcards on electrolytes').count, 150); // B-496: up to 150, in batches
  for (const no of [
    'what is due this week',
    'weak spots to Quizlet',
    'my care plan cards',
    'Start a study session',
    'Take the flashcards off today',
    'are my flashcards any good',
  ])
    assert.equal(EV.flashcardAsk(no), null, no);
  // the composer routes it before the chat model, as B-461 did for Ask for changes
  const comp = fs.readFileSync(path.join(ROOT, 'page/app/74-ev-render-and-composer.js'), 'utf8');
  const send = comp.slice(comp.indexOf('async function sendTextNow'));
  assert.ok(
    send.indexOf('E.flashcardAsk(text') > 0 && send.indexOf('E.flashcardAsk(text') < send.indexOf('await chat(')
  );
});

test('B-487: a flashcards job makes a deck for its course in E.V. (the stub’s cards), and the job card names it', async () => {
  const NOW = new Date('2026-10-25T15:00:00Z');
  const db = J.asRunDb(seedRecord(NOW));
  const id = 'job-20261025-150000-flashcards-dosage';
  db.jobs = [
    ...(db.jobs || []),
    {
      id,
      schema: 2,
      writer: 'page',
      at: NOW.toISOString(),
      source: 'E.V. Home',
      kind: 'flashcards',
      title: 'Flashcards: dosage terms',
      brief: '3 flashcards on dosage terms',
      course: 'NUR 112',
    },
  ];
  const writes = [];
  await J.runJob({
    db,
    spec,
    schemas: loadSchemas(),
    jobId: id,
    now: NOW,
    release: 'v4.5.5+1',
    ask: async body => jobReply(body),
    write: async w => writes.push(w),
  });
  const all = writes.flat();
  const dk = all.find(w => w.collection === 'decks');
  assert.ok(dk, 'a deck is written');
  assert.equal(dk.id, 'deck-20261025-150000-flashcards-dosage');
  assert.deepEqual(
    [dk.data.course, dk.data.title, dk.data.job, dk.data.writer],
    ['NUR 112', 'dosage terms', id, 'worker']
  );
  assert.equal(Object.keys(dk.data.cards).length, 3);
  assert.equal(dk.data.cards['c-003'].verify, true);
  assert.ok(validate('decks', dk.data, { id: dk.id }).ok);
  const done = all.find(w => w.collection === 'jobresults' && w.data.status === 'done');
  assert.deepEqual([done.data.result.deckId, done.data.result.deckCards], [dk.id, 3]);
  assert.match(done.data.result.text, /^Deck ready: 3 cards on dosage terms/);
  assert.equal(done.data.result.quizlet, undefined, 'no Quizlet block');
  const cards = fs.readFileSync(path.join(ROOT, 'page/app/67-ev-cards.js'), 'utf8');
  assert.match(cards, /btn\('Open deck', \(\) => openDeck\(r\.deckId\)/);
});

test('B-493: a verify marker the job wrote into a card’s words is taken off them; the flag alone drives the badge', () => {
  const job = { id: 'job-20261029-150000-flashcards-beta', title: 'Flashcards: beta blockers', course: 'NUR 112' };
  const items = [
    { term: 'Metoprolol', definition: 'A cardioselective beta blocker; verify: true', verify: true },
    { term: 'Propranolol', definition: 'A nonselective beta blocker; verify: true' },
    { term: 'Atenolol', definition: 'Renally cleared beta blocker (verify)' },
    { term: 'Hold parameters', definition: 'HR under 60: hold and the nurse must verify' },
    { term: 'Carvedilol', definition: 'Alpha and beta blocker' },
  ];
  const dk = EV.deckFromJob({ job, items, now: AT }).write;
  const cards = Object.values(dk.data.cards);
  for (const c of cards) assert.doesNotMatch(c.term + ' ' + c.definition, /verify\s*:|\(verify\)|\[verify\]/i);
  assert.deepEqual(
    cards.map(c => [c.definition, !!c.verify]),
    [
      ['A cardioselective beta blocker', true],
      ['A nonselective beta blocker', true],
      ['Renally cleared beta blocker', true],
      ['HR under 60: hold and the nurse must verify', false],
      ['Alpha and beta blocker', false],
    ]
  );
  assert.ok(validate('decks', dk.data, { id: dk.id }).ok);
});

test('B-488: Written’s check: exact past case, spaces and punctuation; a small typo is near; else wrong', () => {
  const m = (e, t) => EV.answerMatch(e, t).verdict;
  assert.equal(m('Metoprolol', 'metoprolol'), 'exact');
  assert.equal(m('Beta-blocker', '  beta blocker. '), 'exact');
  assert.equal(m('ACE inhibitor', 'aceinhibitor'), 'exact');
  assert.equal(m('Metoprolol', 'metoprolo'), 'near'); // 1 typo in a 10-letter term
  assert.equal(m('Metoprolol', 'metoprlo'), 'near'); // 2
  assert.equal(m('Metoprolol', 'metprlo'), 'wrong'); // 3
  assert.equal(m('Heparin', 'hepairn'), 'wrong'); // 2 in a 7-letter term
  assert.equal(m('Heparin', 'heparn'), 'near'); // 1
  assert.equal(m('mcg', 'mg'), 'wrong', 'a short term takes no typo');
  assert.equal(m('Warfarin', 'Heparin'), 'wrong');
  assert.equal(m('Warfarin', '   '), 'wrong');
  assert.equal(EV.answerMatch('Warfarin', 'warfarn').expected, 'Warfarin');
});

test('B-488: Written’s I was right: the Again is replaced by Good from the card as it was', () => {
  const deck = EV.deckNew({
    title: 'Meds',
    course: 'NUR 112',
    items: [{ term: 'PRN', definition: 'as needed' }],
    now: AT,
  });
  deck.cards = deck.data.cards;
  const again = EV.deckReview(deck, 'c-001', 'again', AT);
  assert.equal(again.again, true);
  const prev = deck.cards['c-001'];
  const over = EV.deckReview({ ...deck, cards: { 'c-001': prev } }, 'c-001', 'good', AT);
  const good = EV.deckReview(deck, 'c-001', 'good', AT);
  assert.deepEqual(over.write, good.write, 'as if he had been right');
  assert.deepEqual([over.card.state, over.card.reps, over.card.lapses, over.card.last], ['review', 1, 0, 'good']);
});

test('B-488: Learn: rounds of 7; Multiple choice, then Written; a miss drops back; one rating per card a session', () => {
  const cards = Array.from({ length: 9 }, (_, i) => ({ deck: 'deck-x', id: 'c-' + String(i + 1).padStart(3, '0') }));
  const st = EV.learnStart(cards);
  assert.deepEqual([st.total, st.round.length, st.pool.length, st.roundNo], [9, 7, 2, 1]);
  let cur = EV.learnCur(st);
  assert.deepEqual(cur, { deck: 'deck-x', id: 'c-001', stage: 'mc' });
  // c-001 right in Multiple choice: its first answer (rated), and it comes back in Written at the round's end
  assert.deepEqual(EV.learnAnswer(st, true), { first: true, learned: false });
  assert.equal(st.queue.at(-1), 'deck-x/c-001');
  assert.equal(st.stage['deck-x/c-001'], 'written');
  // c-002 missed: Again is its rating; it comes back two cards on, in Multiple choice
  assert.equal(EV.learnCur(st).id, 'c-002');
  assert.deepEqual(EV.learnAnswer(st, false), { first: true, learned: false });
  assert.equal(st.queue[2], 'deck-x/c-002');
  // the rest of the first pass right; then each card's later answers write nothing
  const firsts = {};
  let guard = 0;
  while ((cur = EV.learnCur(st)) && !cur.roundDone && guard++ < 100) {
    const k = cur.deck + '/' + cur.id;
    const missWritten = k === 'deck-x/c-001' && cur.stage === 'written' && !firsts.missed;
    if (missWritten) firsts.missed = true;
    const r = EV.learnAnswer(st, !missWritten);
    if (r.first) firsts[k] = (firsts[k] || 0) + 1;
  }
  assert.ok(EV.learnCur(st).roundDone, 'a round ends when each of its cards is learned');
  assert.equal(st.learned.length, 7);
  assert.ok(
    Object.keys(firsts)
      .filter(k => k !== 'missed')
      .every(k => firsts[k] === 1)
  );
  assert.ok(
    !firsts['deck-x/c-001'] && !firsts['deck-x/c-002'],
    'c-001 and c-002 were rated on their first answer only'
  );
  assert.equal(st.missed['deck-x/c-001'], 1, 'a miss in Written drops it back to Multiple choice');
  // round 2: the last 2 cards
  EV.learnNextRound(st);
  assert.deepEqual([st.roundNo, st.round.length, EV.learnCur(st).id], [2, 2, 'c-008']);
  for (let i = 0; i < 4; i++) EV.learnAnswer(st, true);
  assert.equal(EV.learnCur(st), null, 'every card learned: the session ends');
  const sum = EV.learnSummary(st);
  assert.deepEqual([sum.done, sum.total, sum.learned.length], [9, 9, 7]);
  assert.deepEqual(
    sum.shaky.map(k => [k.id, k.missed]),
    [
      ['c-001', 1],
      ['c-002', 1],
    ]
  );
});

test('B-488: Learn’s I was right puts the session back as before the miss and counts it right', () => {
  const st = EV.learnStart([
    { deck: 'd', id: 'a' },
    { deck: 'd', id: 'b' },
  ]);
  EV.learnAnswer(st, true); // a: Multiple choice right
  EV.learnAnswer(st, true); // b: Multiple choice right
  assert.deepEqual(EV.learnCur(st), { deck: 'd', id: 'a', stage: 'written' });
  assert.deepEqual(EV.learnAnswer(st, false), { first: false, learned: false });
  assert.equal(st.missed['d/a'], 1);
  assert.deepEqual(EV.learnOverride(st), { first: false, learned: true });
  assert.deepEqual([st.missed['d/a'], st.learned, st.queue], [undefined, ['d/a'], ['d/b']]);
});

test('B-489: a Quizlet paste: tab or comma (guessed), a custom separator, ";" rows, bad lines skipped', () => {
  const tab = EV.quizletParse('mcg\tmicrogram, 1/1000 of a mg\r\ngtt\tdrops\n\nno separator here\nPRN\t\n');
  assert.equal(tab.sep, 'tab');
  assert.deepEqual(tab.items, [
    { term: 'mcg', definition: 'microgram, 1/1000 of a mg' },
    { term: 'gtt', definition: 'drops' },
  ]);
  assert.equal(tab.skipped, 2);
  const comma = EV.quizletParse('BID, twice a day\nTID, three times a day, with meals');
  assert.equal(comma.sep, 'comma');
  assert.deepEqual(comma.items[1], { term: 'TID', definition: 'three times a day, with meals' }, 'split at the first');
  const custom = EV.quizletParse('qid - four times a day\nhs - at bedtime', ' - ');
  assert.deepEqual(
    custom.items.map(i => i.term),
    ['qid', 'hs']
  );
  const semi = EV.quizletParse('a\tone;b\ttwo;c\tthree');
  assert.equal(semi.items.length, 3);
  assert.deepEqual(EV.quizletParse('').items, []);
});

test('B-489: an import makes a new deck (past 40 cards) or adds only new terms to one; no card there changes', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `term ${i + 1}\tdefinition ${i + 1}`).join('\n');
  const p = EV.quizletParse(lines);
  const w = EV.deckNew({
    title: 'Imported',
    course: 'NUR 112',
    items: p.items,
    source: 'Quizlet paste',
    now: AT,
    max: EV.IMPORT_MAX,
  });
  assert.equal(Object.keys(w.data.cards).length, 60);
  assert.ok(validate('decks', w.data, { id: w.id }).ok);
  const deck = { id: w.id, ...w.data };
  deck.cards['c-001'] = { ...deck.cards['c-001'], state: 'review', ivl: 3, due: '2026-11-01' };
  const add = EV.deckCardsAdd(
    deck,
    [
      { term: 'TERM 1', definition: 'again' },
      { term: 'New one', definition: 'fresh' },
      { term: 'new one', definition: 'twice in the paste' },
    ],
    '2026-10-29T16:00:00Z'
  );
  assert.deepEqual([add.added, add.dupes], [1, 2]);
  assert.equal(add.write.op, 'update');
  const ids = Object.keys(add.write.data.cards);
  assert.equal(ids.length, 1);
  assert.match(ids[0], /^c-\d{17}$/);
  assert.ok(!(ids[0] in deck.cards), 'only new entries are sent');
  const merged = { ...deck, cards: { ...deck.cards, ...add.write.data.cards } };
  const { id: _id, ...doc } = merged;
  assert.ok(validate('decks', doc, { id: w.id }).ok);
  assert.equal(merged.cards['c-001'].ivl, 3, 'the cards already there keep their schedules');
});

test('B-495: only an ask to make cards starts a job; a line about studying his cards opens the due ones', () => {
  for (const yes of [
    'Make me 15 flashcards on cardiac meds',
    'create flashcards for the cranial nerves',
    'give me 10 cards on electrolytes',
    'Can you generate some flash cards about insulin types',
    'I want 20 flashcards on fluids',
    '12 flashcards on dosage abbreviations',
    'flashcards on the renal system',
  ])
    assert.ok(EV.flashcardAsk(yes), yes);
  for (const no of [
    'I need to study my cards for the exam tonight',
    'review flashcards',
    'study my cards',
    'let me go over my flashcards before class',
    'I need to study for the exam tonight',
    'what do my cards say about heparin',
  ])
    assert.equal(EV.flashcardAsk(no), null, no);
  for (const s of ['I need to study my cards for the exam tonight', 'review flashcards', 'Quiz me on my deck'])
    assert.ok(EV.cardsStudyAsk(s), s);
  for (const s of ['Start a study session', 'review the chapter 8 lecture', 'what is due this week'])
    assert.equal(EV.cardsStudyAsk(s), false, s);
  const comp = fs.readFileSync(path.join(ROOT, 'page/app/74-ev-render-and-composer.js'), 'utf8');
  const send = comp.slice(comp.indexOf('async function sendTextNow'));
  assert.ok(send.indexOf('E.cardsStudyAsk(text)') > send.indexOf('E.flashcardAsk(text'));
  assert.ok(send.indexOf('E.cardsStudyAsk(text)') < send.indexOf('await chat('), 'routed before the chat model');
});

// B-496: large asks in batches of at most 40, each told the terms made so far; "add N cards to <deck>" adds to a deck
const flashJob = (id, brief, extra = {}) => ({
  id,
  schema: 2,
  writer: 'page',
  at: '2026-10-25T15:00:00.000Z',
  source: 'E.V. Home',
  kind: 'flashcards',
  title: 'Flashcards: cardiac meds',
  brief,
  course: 'NUR 112',
  ...extra,
});
/** A model stand-in: each batch writes the count its line asks for, the first card of each repeating one already made. */
const batchAsk = asks => async body => {
  const text = body.messages[0].content;
  asks.push(text);
  const m = /write exactly (\d+) cards/.exec(text);
  const n = m ? Number(m[1]) : 20;
  const k = asks.length;
  const items = Array.from({ length: n }, (_, i) => ({
    term: `Term ${k}-${i + 1}`,
    definition: `Meaning ${k}-${i + 1}`,
  }));
  if (k > 1) items[0] = { term: 'Term 1-1', definition: 'a repeat' };
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', name: 'answer', input: { text: 'Cards.', items } }],
  };
};

test('B-496: an ask counts up to 150 cards, in batches of at most 40; "add N cards to <deck>" names the deck', () => {
  assert.deepEqual(EV.cardBatches(20), [20]);
  assert.deepEqual(EV.cardBatches(40), [40]);
  assert.deepEqual(EV.cardBatches(100), [34, 33, 33]);
  assert.deepEqual(EV.cardBatches(150), [38, 38, 37, 37]);
  assert.equal(EV.flashcardAsk('make 100 flashcards on cardiac meds').count, 100);
  assert.equal(EV.jobCardCount({ brief: '100 flashcards on cardiac meds. His words: …' }), 100);
  assert.equal(EV.jobCardCount({ brief: '15 more flashcards for the deck Meds.' }), 15);
  const decks = [
    { id: 'deck-20261025-150000-dosage', title: 'Dosage abbreviations', course: 'NUR 112', cards: {} },
    { id: 'deck-20261025-150000-old', title: 'Old deck', course: 'NUR 112', retired: true, cards: {} },
  ];
  const a = EV.flashcardAsk('add 15 cards to Dosage abbreviations', decks);
  assert.deepEqual([a.kind, a.count, a.deck, a.course], ['flashcards', 15, decks[0].id, 'NUR 112']);
  assert.match(a.brief, /^15 more flashcards for the deck Dosage abbreviations/);
  assert.equal(EV.flashcardAsk('add 10 more flashcards to my dosage abbreviations deck', decks).deck, decks[0].id);
  assert.equal(EV.flashcardAsk('add 10 cards to Old deck', decks), null, 'a retired deck is not named');
  assert.equal(EV.flashcardAsk('add 10 cards to my nonexistent deck', decks), null);
});

test('B-496: a 100-card job is asked in 3 batches, each told the terms made, then one top-up; one deck, no term twice', async () => {
  const NOW = new Date('2026-10-25T15:00:00Z');
  const db = J.asRunDb(seedRecord(NOW));
  const id = 'job-20261025-150000-flashcards-cardiac';
  db.jobs = [...(db.jobs || []), flashJob(id, '100 flashcards on cardiac meds. His words: make 100 flashcards')];
  const writes = [],
    asks = [];
  const r = await J.runJob({
    db,
    spec,
    schemas: loadSchemas(),
    jobId: id,
    now: NOW,
    release: 'v4.5.5+1',
    ask: batchAsk(asks),
    write: async w => writes.push(w),
  });
  assert.equal(r.status, 'done', JSON.stringify(r));
  // B-496 (Oct 29): two repeats left 98 new terms of 100, so one top-up asks for the 2 missing, and only once
  assert.equal(asks.length, 4);
  assert.match(asks[0], /batch 1 of 3: write exactly 34 cards\. No two of your cards/);
  assert.match(asks[1], /batch 2 of 3: write exactly 33 cards\. He already has cards on these terms\..*"Term 1-34"/);
  assert.match(asks[1], /never a reworded, abbreviated or reordered form of one/);
  assert.match(asks[3], /batch 4 of 4: write exactly 2 cards\./);
  const dk = writes.flat().find(w => w.collection === 'decks');
  const terms = Object.values(dk.data.cards).map(c => c.term);
  assert.equal(terms.length, 99, 'the three repeats are left out');
  assert.equal(new Set(terms.map(t => t.toLowerCase())).size, terms.length);
  assert.ok(validate('decks', dk.data, { id: dk.id }).ok);
  const done = writes.flat().find(w => w.collection === 'jobresults' && w.data.status === 'done');
  assert.equal(done.data.result.deckCards, 99);
  assert.match(done.data.result.text, /^Deck ready: 99 cards on .* Made 99 of the 100 asked; ask again to add more\.$/);
});

test('B-496: a job that names a deck adds only new terms to it; the cards it has keep their schedules', async () => {
  const NOW = new Date('2026-10-25T15:00:00Z');
  const db = J.asRunDb(seedRecord(NOW));
  const deckId = 'deck-20261024-150000-cardiac';
  const deck = EV.deckNew({
    title: 'Cardiac meds',
    course: 'NUR 112',
    items: [
      { term: 'Term 1-1', definition: 'had' },
      { term: 'Digoxin', definition: 'a cardiac glycoside' },
    ],
    now: '2026-10-24T15:00:00Z',
    id: deckId,
  });
  deck.data.cards['c-002'] = {
    ...deck.data.cards['c-002'],
    state: 'review',
    ivl: 6,
    ease: 2.3,
    reps: 3,
    due: '2026-10-30',
  };
  db.decks = [...(db.decks || []), { id: deckId, ...deck.data }];
  const id = 'job-20261025-150000-flashcards-more';
  db.jobs = [...(db.jobs || []), flashJob(id, '5 more flashcards for the deck Cardiac meds.', { deck: deckId })];
  assert.ok(validate('jobs', flashJob(id, 'x', { deck: deckId }), { id }).ok, 'the jobs schema takes deck');
  const writes = [],
    asks = [];
  const r = await J.runJob({
    db,
    spec,
    schemas: loadSchemas(),
    jobId: id,
    now: NOW,
    release: 'v4.5.5+1',
    ask: batchAsk(asks),
    write: async w => writes.push(w),
  });
  assert.equal(r.status, 'done', JSON.stringify(r));
  // B-496 (Oct 29): one repeat left 4 new of 5, so one top-up asks for the last one
  assert.equal(asks.length, 2);
  assert.match(asks[0], /write exactly 5 cards\. He already has cards on these terms\..*"Digoxin"/);
  // the deck's terms are named only as terms to avoid, never in the job's material
  const material = asks[0].slice(asks[0].indexOf('```json'));
  assert.doesNotMatch(material, /Digoxin/);
  assert.match(material, /"deck":\{"title":"Cardiac meds","cards":2\}/);
  const up = writes.flat().find(w => w.collection === 'decks');
  assert.equal(up.op, 'update');
  assert.equal(up.id, deckId);
  const added = Object.values(up.data.cards);
  assert.equal(added.length, 4, 'Term 1-1, already in the deck, is left out');
  assert.ok(
    Object.keys(up.data.cards).every(k => !deck.data.cards[k]),
    'only new entries'
  );
  assert.ok(
    added.every(c => !c.state && !c.due),
    'new cards are new'
  );
  const done = writes.flat().find(w => w.collection === 'jobresults' && w.data.status === 'done');
  assert.match(
    done.data.result.text,
    /^Added 4 cards to Cardiac meds.* Made 4 of the 5 asked; ask again to add more\.$/
  );
});

/** B-496: a job adding to a deck that has these terms, run with `ask`. Returns { r, writes, asks, done }. */
async function addRun(ask, { brief = '10 more flashcards for the deck Cardiac meds.', timeLeft = null } = {}) {
  const NOW = new Date('2026-10-25T15:00:00Z');
  const db = J.asRunDb(seedRecord(NOW));
  const deckId = 'deck-20261024-150000-cardiac';
  const deck = EV.deckNew({
    title: 'Cardiac meds',
    course: 'NUR 112',
    items: [
      { term: 'Digoxin', definition: 'a cardiac glycoside' },
      { term: 'Atropine', definition: 'raises the heart rate' },
    ],
    now: '2026-10-24T15:00:00Z',
    id: deckId,
  });
  db.decks = [...(db.decks || []), { id: deckId, ...deck.data }];
  const id = 'job-20261025-150000-flashcards-add';
  db.jobs = [...(db.jobs || []), flashJob(id, brief, { deck: deckId })];
  const writes = [];
  const r = await J.runJob({
    db,
    spec,
    schemas: loadSchemas(),
    jobId: id,
    now: NOW,
    release: 'v4.5.5+1',
    ask,
    write: async w => writes.push(w),
    ...(timeLeft ? { timeLeft } : {}),
  });
  const done = writes.flat().find(w => w.collection === 'jobresults' && w.data.status !== 'running');
  return { r, writes: writes.flat(), done };
}
const answering =
  (asks, items, text = 'Here are 10 more cards on cardiac meds.') =>
  async body => {
    asks.push(body.messages[0].content);
    return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'answer', input: { text, items } }] };
  };

test('B-496 (Oct 29): an add whose cards all repeat the deck adds none and says so; it never claims cards it did not add', async () => {
  const asks = [];
  const repeats = [
    { term: 'Digoxin', definition: 'again' },
    { term: 'atropine ', definition: 'again' },
  ];
  const { r, writes, done } = await addRun(answering(asks, repeats));
  assert.equal(r.status, 'done', JSON.stringify(r));
  assert.equal(asks.length, 2, 'the batch, then one top-up, never more');
  assert.equal(writes.filter(w => w.collection === 'decks').length, 0, 'nothing written to the deck');
  assert.equal(
    done.data.result.text,
    'No cards were added to Cardiac meds: every card that came back was one it already has. Ask again, naming other points to cover.'
  );
  assert.doesNotMatch(done.data.result.text, /Here are/);
});

test('B-496 (Oct 29): the top-up is bounded: one ask at most, and none when the run has no time left', async () => {
  const short = [{ term: 'Amiodarone', definition: 'an antiarrhythmic' }];
  const asks = [];
  const one = await addRun(answering(asks, short));
  assert.equal(asks.length, 2);
  assert.match(asks[1], /batch 2 of 2: write exactly 9 cards\./);
  assert.match(
    one.done.data.result.text,
    /^Added 1 card to Cardiac meds.* Made 1 of the 10 asked; ask again to add more\.$/
  );
  const late = [];
  const none = await addRun(answering(late, short), { timeLeft: () => 60000 });
  assert.equal(late.length, 1, 'no top-up with under one ask’s time left');
  assert.match(none.done.data.result.text, /Made 1 of the 10 asked/);
});

test('B-496 (Oct 29): a job always ends: a first ask that never answers fails the job; a later one keeps the cards made', async () => {
  const stuck = async () => {
    throw new Error('Claude didn’t answer within 3 minutes, so E.V. stopped asking');
  };
  const failed = await addRun(stuck);
  assert.equal(failed.r.status, 'failed');
  assert.equal(failed.done.data.status, 'failed');
  assert.match(failed.done.data.error || failed.done.data.result.text, /didn’t answer within 3 minutes/);
  // a 60-card add: the first batch answers, the second never does: the run ends done with the cards made, said honestly
  const asks = [];
  const later = await addRun(
    async body => {
      asks.push(1);
      if (asks.length > 1) throw new Error('no answer');
      const items = Array.from({ length: 30 }, (_, i) => ({ term: 'New ' + i, definition: 'd' + i }));
      return {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: 'answer', input: { text: 'Cards.', items } }],
      };
    },
    { brief: '60 more flashcards for the deck Cardiac meds.' }
  );
  assert.equal(later.r.status, 'done');
  assert.ok(asks.length <= 3, 'two batches and at most one top-up');
  assert.match(later.done.data.result.text, /^Added 30 cards to Cardiac meds.* Made 30 of the 60 asked/);
  // the page's ask is stopped after askTimeoutMs: about 3 minutes for a job's 8,192-token answer
  assert.equal(Math.round(J.askTimeoutMs({ max_tokens: 8192 }) / 60000), 3);
  assert.ok(
    J.PAGE_RUN_MS + J.askTimeoutMs({ max_tokens: 8192 }) < J.STALE_MS,
    'a page run ends before it is called stale'
  );
  const bridge = fs.readFileSync(path.join(ROOT, 'pwa/bridge.js'), 'utf8');
  assert.match(bridge, /const timer = setTimeout\(\(\) => stop\.abort\(\), ms\);/);
  assert.match(bridge, /signal: stop\.signal,/);
  assert.match(bridge, /timeLeft: \(\) => J\.PAGE_RUN_MS - \(Date\.now\(\) - began\),/);
});
