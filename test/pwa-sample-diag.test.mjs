// B-624: Today's question asks failed on live with only "Couldn't write questions right now", the cause hidden. The
// shim's sample now keeps the HTTP status on a failed ask and the stop reason on a reply that did not parse, so the
// page can show the short code ("upstream_error 524") and log the rest under "[EV practice]".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function sampleOver(reply) {
  const src = fs.readFileSync(path.join(ROOT, 'pwa/bridge.js'), 'utf8');
  const window = {};
  const fetch = async url =>
    /\/api\/claude/.test(url)
      ? reply()
      : new Response('{"docs":[]}', { headers: { 'content-type': 'application/json' } });
  const document = {
    body: null,
    visibilityState: 'visible',
    addEventListener: () => {},
    querySelector: () => null,
    createElement: () => ({}),
  };
  new Function('window', 'document', 'localStorage', 'navigator', 'fetch', 'setInterval', 'addEventListener', src)(
    window,
    document,
    { getItem: () => 'token', setItem: () => {} },
    {},
    fetch,
    () => 0,
    () => {}
  );
  return window.claude.use('sample');
}
const msg = (text, stop) =>
  new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: stop }), {
    headers: { 'content-type': 'application/json' },
  });

test('B-624: a failed ask keeps its code and HTTP status', async () => {
  const sample = await sampleOver(() => new Response('error code: 524', { status: 524 }));
  await assert.rejects(
    sample.json('q'),
    e => e.code === 'upstream_error' && e.status === 524 && /^524 /.test(e.message)
  );
});

test('B-624: a reply cut short or unparsed keeps its stop reason and text', async () => {
  let sample = await sampleOver(() => msg('{"items":[{"stem":"a', 'max_tokens'));
  await assert.rejects(sample.json('q'), e => e.code === 'invalid_json' && e.stopReason === 'max_tokens' && !!e.text);
  sample = await sampleOver(() => msg('no json here', 'end_turn'));
  await assert.rejects(sample.json('q'), e => e.code === 'invalid_json' && e.stopReason === 'end_turn');
});

test('B-624: the page names the cause on its line and in the "[EV practice]" console line', () => {
  const src = fs.readFileSync(path.join(ROOT, 'page/app/20-study.js'), 'utf8');
  assert.match(src, /Couldn’t write questions right now \(' \+ practiceFailed\(e\) \+ '\)/);
  assert.match(src, /'\[EV practice\] ask failed'/);
  assert.match(src, /'\[EV practice\] malformed: nothing usable in '/);
  assert.match(src, /came back malformed \(' \+ tag \+ '\)/);
});

test('B-624: a practice ask streams: the shim forwards stream: true and the page asks for it', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'pwa/bridge.js'), 'utf8');
  const window = {};
  const bodies = [];
  const fetch = async (url, init) => {
    if (!/\/api\/claude/.test(url))
      return new Response('{"docs":[]}', { headers: { 'content-type': 'application/json' } });
    bodies.push(JSON.parse(init.body));
    return msg('{"items":[]}', 'end_turn');
  };
  const document = {
    body: null,
    visibilityState: 'visible',
    addEventListener: () => {},
    querySelector: () => null,
    createElement: () => ({}),
  };
  new Function('window', 'document', 'localStorage', 'navigator', 'fetch', 'setInterval', 'addEventListener', src)(
    window,
    document,
    { getItem: () => 'token', setItem: () => {} },
    {},
    fetch,
    () => 0,
    () => {}
  );
  const sample = await window.claude.use('sample');
  await sample.json('q', { stream: true });
  assert.equal(bodies[0].stream, true);
  await sample.json('q');
  assert.equal(bodies[1].stream, undefined);
  const page = fs.readFileSync(path.join(ROOT, 'page/app/20-study.js'), 'utf8');
  assert.match(page, /sample\.json\(prompt, \{ modelTier: 'default', cache: false, stream: true \}\)/);
});
