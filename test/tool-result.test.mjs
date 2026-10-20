// tools/tool-result.mjs: a tool's result is copied out of the session transcript exactly, never retyped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { toolResults, resultBody, newestTranscript } from '../tools/tool-result.mjs';
import { ROOT } from './helpers.mjs';

const line = o => JSON.stringify(o);
const use = (id, name, input) =>
  line({ message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, texts, extra = {}) =>
  line({
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: id, content: texts.map(text => ({ type: 'text', text })), ...extra },
      ],
    },
  });
const page1 = { data: [{ id: 'trig_a', name: 'one' }], has_more: true, next_cursor: 'c1' };
const page2 = { data: [{ id: 'trig_b', name: 'two' }], has_more: false };
const JSONL = [
  use('u1', 'mcp__claude-code-remote__list_triggers', { limit: 100 }),
  result('u1', [JSON.stringify(page1), 'note: more entries']),
  'not json at all',
  use('u2', 'Artifact', { action: 'read' }),
  result('u2', ['[Artifact x, owned by you]\n<!doctype html><html><body>hi</body></html>\n']),
  use('u3', 'mcp__claude-code-remote__list_triggers', { limit: 100, cursor: 'c1' }),
  result('u3', [JSON.stringify(page2)]),
  use('u4', 'mcp__claude-code-remote__list_triggers', { limit: 100 }),
  result('u4', ['boom'], { is_error: true }),
].join('\n');

test('finds results by tool suffix, oldest first, keeping inputs and errors', () => {
  const all = toolResults(JSONL, 'list_triggers');
  assert.equal(all.length, 3);
  assert.deepEqual(all[1].input, { limit: 100, cursor: 'c1' });
  assert.equal(all[2].isError, true);
  assert.equal(toolResults(JSONL, 'Artifact').length, 1);
});

test('the body is the first JSON block exactly, or the page from its doctype', () => {
  const [r1] = toolResults(JSONL, 'list_triggers');
  assert.deepEqual(JSON.parse(resultBody(r1)), page1);
  const [a] = toolResults(JSONL, 'Artifact');
  assert.equal(resultBody(a, { html: true }), '<!doctype html><html><body>hi</body></html>');
  assert.throws(() => resultBody(r1, { html: true }), /no <!doctype html>/);
});

test('cli saves the chosen result and refuses a failed call', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-tr-'));
  const t = path.join(dir, 's.jsonl');
  fs.writeFileSync(t, JSONL);
  const run = (...a) =>
    execFileSync('node', [path.join(ROOT, 'tools/tool-result.mjs'), ...a, '--transcript', t], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  assert.throws(() => run('list_triggers', path.join(dir, 'x.json')), /failed; not saved/);
  run('list_triggers', path.join(dir, 'p2.json'), '--back', '1');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'p2.json'), 'utf8')), page2);
  run('list_triggers', path.join(dir, 'p1.json'), '--back', '2');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'p1.json'), 'utf8')), page1);
});

test('newestTranscript picks the most recently written session file', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-home-'));
  const d = path.join(home, '.claude', 'projects', 'p');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'old.jsonl'), '');
  fs.utimesSync(path.join(d, 'old.jsonl'), new Date(1e12), new Date(1e12));
  fs.writeFileSync(path.join(d, 'new.jsonl'), '');
  assert.equal(newestTranscript(home), path.join(d, 'new.jsonl'));
  assert.equal(newestTranscript(path.join(home, 'none')), null);
});
