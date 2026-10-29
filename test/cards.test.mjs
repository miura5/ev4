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
  assert.equal(EV.flashcardAsk('99 flashcards on electrolytes').count, 40);
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
    send.indexOf('E.flashcardAsk(text)') > 0 && send.indexOf('E.flashcardAsk(text)') < send.indexOf('await chat(')
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
