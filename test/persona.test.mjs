// B-602 (D-405): her persona is grounded, plain and evidence-bound; the app's layout and her look are built from the
// spec, never typed into her instructions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spec } from './core-fixtures.mjs';

const talk = fs.readFileSync(new URL('../page/app/72-ev-talking-with-claude.js', import.meta.url), 'utf8');
const ctx = talk.slice(talk.indexOf('function pageFacts'), talk.indexOf("L.push('--- HIS RECORD"));
const persona = JSON.stringify(spec.persona);
const STALE = /top bar|small core|Silk|E\.V\. Home is dark|teal and violet/i;
const TICS = /Logged\.|Noted for the record|Systems nominal|EV-04|three pipelines|Homemade study unit|corporate-AI/i;

test('the chat context and the persona carry no stale layout or look words', () => {
  assert.doesNotMatch(ctx, STALE);
  assert.doesNotMatch(persona, STALE);
});

test('the corporate tics and the unit line are gone', () => {
  assert.doesNotMatch(ctx, TICS);
  assert.doesNotMatch(persona, TICS);
  assert.equal(spec.persona.unit, undefined);
  assert.equal(spec.persona.tagline, undefined);
});

test('the persona holds the evidence and restraint rules', () => {
  const v = spec.persona.voice.join(' ');
  assert.match(v, /only from evidence in his record/);
  assert.match(v, /at most once per reply/);
  assert.match(v, /never states a guess about/);
  assert.match(v, /says it once with the reason, then respects his call/);
  assert.match(v, /never about Matt/);
  assert.match(v, /Answer first/);
  assert.match(v, /Tone, for example/);
  const n = spec.persona.never.join(' ');
  assert.match(n, /Diagnose/);
  assert.match(n, /post as Matt/);
  assert.match(n, /Pretend to remember/);
});

test('the page facts come from the spec: sidebar views and the Dial Arc in ember', () => {
  assert.match(talk, /function pageFacts\(\)/);
  assert.match(ctx, /ui\.tabs/);
  assert.match(ctx, /dialArc/);
  assert.ok(spec.ui.look.dialArc.colours.includes('ember'));
  assert.ok(spec.ui.look.dialArc.reach);
});

test('B-651 (D-416): she makes no flashcards, points to Quizlet and offers a practice set; show_card lists no checkin', () => {
  assert.match(spec.persona.never.join(' '), /flashcards.*Quizlet.*practice set/);
  assert.match(talk, /Never a job for flashcards or decks \(D-416\)/);
  assert.match(spec.jobs.kinds.general.guide, /no flashcards.*Quizlet.*practice set/);
  assert.doesNotMatch(talk, /checkin: energy check/);
});
