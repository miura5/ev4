// B-442: the chat from a note. The open note goes once whole as the cached first block, later asks send the same copy
// and only what changed since, a full resend after the cache window or a large change, and older turns condensed. The
// last test measures the tokens of 10 follow-ups on a 3,000-token note, before and after. All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';

const tok = s => Math.ceil(String(s).length / 4); // about four characters a token
const NOTE_LINES = Array.from(
  { length: 120 },
  (_, i) => `Line ${i + 1}: fluid volume deficit shows as tachycardia, low urine output and poor skin turgor; ${i}.`
);
const noteOf = lines => ({ id: 'note-20261028-a1', title: 'Fluids and electrolytes', text: lines.join('\n') });

test('B-442: noteLineChanges names the lines removed and added, and where; nothing for the same text', () => {
  assert.equal(EV.noteLineChanges('a\nb\nc', 'a\nb\nc'), '');
  assert.equal(EV.noteLineChanges('a\nb\nc', 'a\nb\nc\nd'), '@ after: c\n+ d');
  assert.equal(EV.noteLineChanges('a\nb\nc', 'a\nB\nc'), '@ after: a\n+ B\n- b');
  assert.equal(EV.noteLineChanges('a\nb\nc', 'b\nc'), '@ at the start\n- a');
  // a changed stretch past 250,000 line pairs (600 x 600 here) is read as all of it removed and added, in place
  const olds = Array.from({ length: 600 }, (_, i) => 'old ' + i),
    news = Array.from({ length: 600 }, (_, i) => 'new ' + i);
  const wide = EV.noteLineChanges(['top', ...olds, 'end'].join('\n'), ['top', ...news, 'end'].join('\n')).split('\n');
  assert.equal(wide[0], '@ after: top');
  assert.equal(wide.length, 1 + 1200);
  assert.deepEqual(
    wide.slice(1, 601),
    olds.map(x => '- ' + x)
  );
  assert.deepEqual(
    wide.slice(601),
    news.map(x => '+ ' + x)
  );
  const two = EV.noteLineChanges('a\nb\nc\nd\ne', 'a\nx\nc\nd\ne\nf');
  assert.match(two, /^@ after: a\n\+ x\n- b\n@ after: e\n\+ f$/);
});

test('B-442: the first ask sends the note whole; later ones the same copy and the changes; whole again after the window or a large change', () => {
  const t0 = 1_800_000_000_000;
  const first = EV.noteChatPlan(null, noteOf(NOTE_LINES), t0);
  assert.equal(first.full, true);
  assert.equal(first.delta, '');
  assert.ok(first.prefix.includes(NOTE_LINES[119]) && first.prefix.includes('notes id note-20261028-a1'));

  // a minute later, one line added: the same copy byte for byte, and only that line
  const more = [...NOTE_LINES, 'Hypokalemia: watch for U waves.'];
  const second = EV.noteChatPlan(first.seen, noteOf(more), t0 + 60e3);
  assert.equal(second.full, false);
  assert.equal(second.prefix, first.prefix);
  assert.match(second.delta, /\+ Hypokalemia: watch for U waves\.$/);
  assert.ok(second.delta.length < 300);
  assert.equal(second.seen.at, t0 + 60e3); // each ask refreshes the cache, so the window runs from the last one

  // the changes are counted from the copy, so a later ask still carries them; nothing changed from it: no delta at all
  assert.equal(EV.noteChatPlan(second.seen, noteOf(more), t0 + 90e3).delta, second.delta);
  assert.equal(EV.noteChatPlan(second.seen, noteOf(NOTE_LINES), t0 + 90e3).delta, '');

  // past the cache window: whole again, as the new copy
  const late = EV.noteChatPlan(second.seen, noteOf(more), t0 + 60e3 + 5 * 60e3);
  assert.equal(late.full, true);
  assert.ok(late.prefix.includes('Hypokalemia'));

  // a large change (most of the note rewritten): whole again
  const big = EV.noteChatPlan(second.seen, noteOf(NOTE_LINES.map(l => l.toUpperCase())), t0 + 120e3);
  assert.equal(big.full, true);

  // another note, or no copy yet: whole
  assert.equal(EV.noteChatPlan(first.seen, { ...noteOf(more), id: 'note-other' }, t0 + 30e3).full, true);
});

test('B-442: older turns are condensed past the last six; the last six stay whole', () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: 'x'.repeat(900),
  }));
  const out = EV.condenseTurns(turns);
  assert.equal(out.length, 10);
  for (const t of out.slice(0, 4)) assert.ok(t.content.length < 340 && t.content.endsWith('(older turn, cut)'));
  for (const t of out.slice(4)) assert.equal(t.content.length, 900);
  assert.deepEqual(EV.condenseTurns([{ role: 'user', content: 'short' }]), [{ role: 'user', content: 'short' }]);
});

// The measurement. Every ask carries the tools and E.V.'s context about the record (fixed sizes here, about what the
// page sends), the chat's earlier turns and his question. Before B-442 she read the note with the lookup tool on each
// follow-up: a second round re-sending everything plus the note, nothing cached. After it, one round: the tools and the
// note are the cached prefix (written at 1.25, read at 0.1, for 5 minutes from the last read), the rest at full price.
test('B-442: 10 follow-ups on a 3,000-token note cost under half the tokens they did', t => {
  const TOOLS = 3500,
    CONTEXT = 2500,
    OUT = 100,
    WINDOW = 5 * 60e3;
  const ANSWER = 'E.V. answers in a few short sentences about the note and his question. '.repeat(6);
  let lines = NOTE_LINES.slice();
  assert.ok(Math.abs(tok(lines.join('\n')) - 3000) < 300, 'the note is about 3,000 tokens: ' + tok(lines.join('\n')));
  const asks = [];
  let ms = 1_800_000_000_000;
  for (let k = 0; k < 10; k++) {
    // between asks he keeps writing: a line added and a line reworded; one gap of six minutes (the cache runs out)
    if (k) {
      lines.push(`New line ${k}: potassium normal range 3.5 to 5.0 mEq/L; recheck after the bolus.`);
      lines[k * 7] = lines[k * 7] + ' (reviewed)';
      ms += k === 5 ? 6 * 60e3 : 60e3;
    }
    asks.push({ ms, lines: lines.slice(), q: `Question ${k + 1}: how does this line connect to what I wrote above?` });
  }
  const turns = [];
  let before = { input: 0, out: 0, billed: 0 },
    after = { input: 0, out: 0, billed: 0, writes: 0, reads: 0 };
  let seen = null,
    cache = null;
  for (const a of asks) {
    const hist = turns.slice(-14);
    // before: round 1, then round 2 with the lookup's whole note
    const r1 = TOOLS + CONTEXT + hist.reduce((n, x) => n + tok(x.content), 0) + tok(a.q);
    const r2 = r1 + 40 + tok(JSON.stringify([{ id: 'note-20261028-a1', text: a.lines.join('\n') }]));
    before.input += r1 + r2;
    before.billed += r1 + r2 + OUT * 2;
    before.out += OUT * 2;
    // after: one round, the prefix cached
    const plan = EV.noteChatPlan(seen, noteOf(a.lines), a.ms);
    const pre = TOOLS + tok(plan.prefix);
    const rest =
      CONTEXT +
      EV.condenseTurns(hist).reduce((n, x) => n + tok(x.content), 0) +
      tok((plan.delta ? plan.delta + '\n\nHe asks: ' : '') + a.q);
    const hit = cache && cache.prefix === plan.prefix && a.ms - cache.at < WINDOW;
    after.billed += (hit ? 0.1 : 1.25) * pre + rest + OUT;
    after[hit ? 'reads' : 'writes']++;
    after.input += pre + rest;
    after.out += OUT;
    cache = { prefix: plan.prefix, at: a.ms };
    seen = plan.seen;
    turns.push({ role: 'user', content: a.q }, { role: 'assistant', content: ANSWER });
  }
  const share = after.billed / before.billed;
  t.diagnostic(
    `before: ${before.input} input tokens, ${Math.round(before.billed)} billed; after: ${after.input} input tokens, ` +
      `${Math.round(after.billed)} billed (${after.writes} cache writes, ${after.reads} reads); ${Math.round(share * 100)}%`
  );
  assert.equal(after.writes, 2); // the first ask and the one after the six-minute gap
  assert.ok(share <= 0.5, `after is ${Math.round(share * 100)}% of before`);
  assert.ok(after.input < before.input); // fewer tokens sent at all, cached or not
});

test('B-470: a reply that echoes the history’s card mark never shows it', () => {
  assert.equal(
    EV.withoutCardMarks('The draft shows the new version when the job posts back. [cards: job]'),
    'The draft shows the new version when the job posts back.'
  );
  assert.equal(EV.withoutCardMarks('Two [cards: job, copy] marks [cards: check] here.'), 'Two marks here.');
  assert.equal(EV.withoutCardMarks('No mark, [a bracket] kept.'), 'No mark, [a bracket] kept.');
});
