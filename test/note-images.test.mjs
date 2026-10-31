// B-653: pictures in notes. The Worker's /api/images route (owner token, type and size checked, stored in the env's
// R2 bucket under note-images/, never overwritten) and the image block (insert, resize, move, remove keeps the file),
// with a note holding a picture checked against notes.schema.json as the Worker checks a save. The test picture is a
// tiny PNG made here; no photo is in the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../pwa/worker.js';
import { writeProblem } from '../pwa/notes.js';
import { IMAGE_KEY, IMAGE_MAX_BYTES } from '../pwa/images.js';
import EV from '../core/evcore.mjs';

const TOKEN = 'images-suite-token-not-a-secret';
// a 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// A stand-in R2 bucket: head, put, get; every put kept, and it has no delete.
function bucket() {
  const objects = new Map();
  return {
    objects,
    async head(k) {
      return objects.has(k) ? { key: k } : null;
    },
    async put(k, body, opts) {
      objects.set(k, { body: Buffer.from(body), type: opts.httpMetadata.contentType });
    },
    async get(k) {
      const o = objects.get(k);
      return o ? { body: o.body, httpMetadata: { contentType: o.type } } : null;
    },
  };
}
const envOf = () => ({ EV_TOKEN: TOKEN, EXPORTS: bucket(), ASSETS: { fetch: () => new Response('') } });
const call = (env, method, path, body, type, token = TOKEN) =>
  worker.fetch(
    new Request('https://ev.test' + path, {
      method,
      headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(type ? { 'content-type': type } : {}) },
      body,
    }),
    env
  );

test('B-653: a picture is stored under note-images/ and read back by the owner only', async () => {
  const env = envOf();
  const r = await call(env, 'POST', '/api/images', PNG, 'image/png');
  assert.equal(r.status, 200);
  const { key } = await r.json();
  assert.match(key, IMAGE_KEY);
  assert.ok(key.startsWith('note-images/'));
  const g = await call(env, 'GET', '/api/images/' + key);
  assert.equal(g.status, 200);
  assert.equal(g.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await g.arrayBuffer()), PNG);
  // no token, or a wrong one: refused both ways
  assert.equal((await call(env, 'GET', '/api/images/' + key, undefined, '', '')).status, 401);
  assert.equal((await call(env, 'POST', '/api/images', PNG, 'image/png', 'wrong')).status, 401);
  // a second upload gets its own key: nothing is written over
  const k2 = (await (await call(env, 'POST', '/api/images', PNG, 'image/png')).json()).key;
  assert.notEqual(k2, key);
  assert.equal(env.EXPORTS.objects.size, 2);
});

test('B-653: only PNG, JPEG, WebP and GIF, up to 8 MB; a bad key and a missing bucket are refused', async () => {
  const env = envOf();
  assert.equal((await call(env, 'POST', '/api/images', PNG, 'image/svg+xml')).status, 415);
  assert.equal((await call(env, 'POST', '/api/images', PNG, 'text/html')).status, 415);
  assert.equal((await call(env, 'POST', '/api/images', Buffer.alloc(IMAGE_MAX_BYTES + 1), 'image/jpeg')).status, 413);
  assert.equal((await call(env, 'GET', '/api/images/exports%2F2026-10-25%2Fx.json')).status, 400);
  assert.equal((await call(env, 'GET', '/api/images/note-images/AAAAAAAAAAAAAAAAAAAAAAAA.png')).status, 404);
  assert.equal(env.EXPORTS.objects.size, 0);
  const none = { ...envOf(), EXPORTS: undefined };
  assert.equal((await call(none, 'POST', '/api/images', PNG, 'image/png')).status, 503);
});

const KEY = 'note-images/AbCdEfGhIjKlMnOpQrStUvWx.png';
const p = text => ({ type: 'p', runs: text ? [{ text }] : [] });
const note = blocks => ({
  schema: 1,
  writer: 'page',
  at: '2026-10-31T15:00:00.000Z',
  source: 'E.V. app',
  createdAt: '2026-10-31T15:00:00.000Z',
  title: 'Heart',
  blocks,
});

test('B-653: a picture block goes in, resizes, moves and comes out; the note stays valid and the file is kept', () => {
  const start = [{ type: 'h1', runs: [{ text: 'Heart' }] }, p('Four chambers.'), p('Valves.')];
  const img = EV.noteImageBlock(KEY, { alt: 'heart diagram', max: 640 });
  assert.deepEqual(img, { type: 'img', runs: [], key: KEY, width: 480, alt: 'heart diagram' });
  // insert after the caret's block
  let r = EV.noteInsertImage(start, 1, img);
  assert.equal(r.at, 2);
  assert.deepEqual(
    r.blocks.map(b => b.type),
    ['h1', 'p', 'img', 'p']
  );
  assert.equal(writeProblem('notes', 'n-20261031-150000-abcdefghijkl', note(r.blocks), null), null);
  // an empty line takes it; a picture put last gets a line after it to type in
  assert.deepEqual(
    EV.noteInsertImage([p('')], 0, img).blocks.map(b => b.type),
    ['img', 'p']
  );
  // resize: kept between 40 and the note's width
  assert.equal(EV.noteResizeImage(r.blocks, 2, 300, 640).blocks[2].width, 300);
  assert.equal(EV.noteResizeImage(r.blocks, 2, 5000, 640).blocks[2].width, 640);
  assert.equal(EV.noteResizeImage(r.blocks, 2, 3, 640).blocks[2].width, 40);
  // move it up between the heading and the first paragraph (gap 1), and to the end
  let m = EV.noteMoveBlock(r.blocks, 2, 1);
  assert.equal(m.at, 1);
  assert.deepEqual(
    m.blocks.map(b => b.type),
    ['h1', 'img', 'p', 'p']
  );
  m = EV.noteMoveBlock(r.blocks, 2, 4);
  assert.equal(m.at, 3);
  assert.equal(m.blocks[3].type, 'img');
  // removing it from the note changes the blocks only: nothing here can reach the stored file
  const before = EV.noteBlocks(r.blocks);
  const out = EV.noteRemoveImage(r.blocks, 2);
  assert.deepEqual(
    out.blocks.map(b => b.type),
    ['h1', 'p', 'p']
  );
  assert.deepEqual(r.blocks, before, 'the earlier blocks are not changed in place');
  // the stored shape survives a save's normalising, and old notes without pictures still validate
  assert.deepEqual(EV.noteBlocks([img])[0], img);
  assert.equal(writeProblem('notes', 'n-20261031-150000-abcdefghijkl', note(start), null), null);
  // a picture whose key is not a stored picture's is refused by the schema
  const bad = note([{ type: 'img', runs: [], key: 'https://example.com/x.png' }]);
  assert.match(writeProblem('notes', 'n-20261031-150000-abcdefghijkl', bad, null), /does not fit its shape/);
});
