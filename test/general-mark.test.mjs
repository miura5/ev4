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
