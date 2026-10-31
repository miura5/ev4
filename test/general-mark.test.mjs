// B-626 (D-415): chat replies no longer say "check your materials"; a reply from general knowledge ends with a mark
// the page strips and shows as one quiet tag. Grounded answers keep citing file and page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const OLD = /check your materials|materials don[’']t give this/i;

test('B-626: no chat prompt asks for "check your materials"; the mark and "cite" stay', () => {
  const talk = fs.readFileSync(path.join(ROOT, 'page/app/72-ev-talking-with-claude.js'), 'utf8');
  assert.doesNotMatch(talk, OLD);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'core/sessions.mjs'), 'utf8'), OLD);
  assert.doesNotMatch(spec.persona.voice.join(' '), OLD);
  assert.match(talk, /end the reply with the mark \$\{E\.GENERAL_MARK\}/);
  assert.match(talk, /name the file and page you used/);
  assert.equal(EV.GENERAL_MARK, '[general]');
});

test('B-626: the mark is stripped and read as a flag, also half written while streaming', () => {
  assert.deepEqual(EV.generalMark('Preload drops. [general]'), { text: 'Preload drops.', general: true });
  assert.deepEqual(EV.generalMark('Preload drops (Ch 42, slide 3).'), {
    text: 'Preload drops (Ch 42, slide 3).',
    general: false,
  });
  assert.deepEqual(EV.generalMark('Preload drops. [gene'), { text: 'Preload drops.', general: false });
  assert.equal(EV.generalMark('A [bracket] kept.').text, 'A [bracket] kept.');
});

// B-626 (staging, Oct 31): the side chat said "Your course slides don't give this conversion" with no tag
const GAP = /don[’']t give this|slides don[’']t|materials don[’']t/i;
test('B-626: no chat prompt or persona line announces a materials gap; the prompt forbids it', () => {
  const talk = fs.readFileSync(path.join(ROOT, 'page/app/72-ev-talking-with-claude.js'), 'utf8');
  const sess = fs.readFileSync(path.join(ROOT, 'core/sessions.mjs'), 'utf8');
  for (const [name, src] of [
    ['72-ev-talking-with-claude.js', talk],
    ['core/sessions.mjs', sess],
    ['persona', JSON.stringify(spec.persona)],
  ])
    assert.doesNotMatch(src, GAP, name);
  assert.match(talk, /never announce that you are answering from general knowledge/);
  assert.match(sess, /never say whether his materials, slides or notes cover it/);
});

test('B-626: the side chat (pop-up) renders the general-knowledge tag, as the conversation does', () => {
  const pop = fs.readFileSync(path.join(ROOT, 'page/app/90-render.js'), 'utf8');
  assert.match(
    pop,
    /m\.general && !m\.pending\)\s*node\.append\(DS\.badge\(\{ text: 'general knowledge'[^)]*cls: 'gen-tag'/
  );
});
