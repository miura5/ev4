// B-309: the app (pwa/) on main. build-pwa wraps the page tools/build.mjs writes for the record it is given, byte for
// byte; the app is named "E.V." in its manifest, window title and icon label. The build runs on a throwaway copy of
// this working tree, so dist/ here is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from '../tools/build.mjs';
import { buildPwa, releaseKeyed, HEAD, FOOT, NAME, RECORDS, SHIM, ICON_FILES } from '../tools/build-pwa.mjs';
import { ICONS, coreSource, colours } from '../tools/pwa-icons.mjs';
import { listRepoFiles } from '../tools/personal-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

function builtCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-pwa-'));
  for (const f of listRepoFiles(ROOT)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'copy');
  return dir;
}

test('B-309: the manifest names the app E.V.', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'pwa/manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, NAME);
  assert.equal(m.short_name, NAME);
  assert.equal(NAME, 'E.V.');
});

// A PNG's width, height and colour type from its IHDR (2 = RGB, no alpha; 6 = RGBA).
const pngInfo = f => {
  const b = fs.readFileSync(f);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', f);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: b[25] };
};

test('B-490: the icons are her idle avatar: any, maskable, apple-touch and favicon, each in the shim', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'pwa/manifest.webmanifest'), 'utf8'));
  for (const i of m.icons) {
    assert.ok(SHIM.includes(i.src), i.src + ' is copied into the app');
    const { w, h } = pngInfo(path.join(ROOT, 'pwa', i.src));
    assert.equal(`${w}x${h}`, i.sizes, i.src);
  }
  const by = p => m.icons.filter(i => i.purpose === p).map(i => i.sizes);
  assert.deepEqual(by('any'), ['192x192', '512x512']);
  assert.deepEqual(by('maskable'), ['512x512']);
  assert.equal(m.background_color, colours().bg, 'the splash is her ground');
  // iOS rounds the apple icon itself and a launcher masks the maskable one: both full-bleed, with no transparency
  for (const f of ['apple-touch-icon.png', 'icon-maskable-512.png'])
    assert.equal(pngInfo(path.join(ROOT, 'pwa', f)).type, 2, f);
  assert.deepEqual(pngInfo(path.join(ROOT, 'pwa/apple-touch-icon.png')), { w: 180, h: 180, type: 2 });
  assert.match(HEAD, /<link rel=apple-touch-icon href="apple-touch-icon\.png">/);
  assert.match(HEAD, /<link rel=icon href="favicon\.svg" type="image\/svg\+xml">/);
  for (const f of ICON_FILES) assert.ok(fs.existsSync(path.join(ROOT, 'pwa', f)), f);
  for (const i of ICONS) assert.ok(ICON_FILES.includes(i.file), i.file + ' is shipped');
  // drawn from the page's own Dial Arc, in her solid face
  assert.match(coreSource(), /^const CORE = \(\(\) => \{/);
  assert.match(fs.readFileSync(path.join(ROOT, 'pwa/favicon.svg'), 'utf8'), new RegExp('fill="' + colours().av1 + '"'));
});

test('B-309: build-pwa wraps each record’s built page byte for byte, titled E.V.', async () => {
  const dir = builtCopy();
  await build({ root: dir, now: '2026-10-25T12:00:00Z' });
  for (const record of RECORDS) {
    const out = path.join(dir, 'out-' + record);
    buildPwa({ record, root: dir, out });
    const page = fs.readFileSync(path.join(dir, 'dist/page', record, 'index.html'));
    const html = fs.readFileSync(path.join(out, 'index.html'));
    assert.ok(html.subarray(0, HEAD.length).equals(Buffer.from(HEAD)), record + ': the head comes first');
    // byte for byte but for B-434's three file addresses keyed to the release (styles.css, core.js, app.js ?v=<release>)
    assert.equal(
      html.subarray(HEAD.length, html.length - FOOT.length).toString(),
      releaseKeyed(page.toString()),
      record + ': the page is wrapped byte for byte, its files keyed to the release'
    );
    assert.equal(html.subarray(html.length - FOOT.length).toString(), FOOT);
    const text = html.toString();
    // The first <title> is the window title; the page's own follows it, unchanged.
    assert.equal(text.match(/<title>([^<]*)<\/title>/)[1], 'E.V.', record + ': window title');
    assert.match(text, /<meta name=apple-mobile-web-app-title content="E\.V\.">/, record + ': icon label');
    assert.ok(text.indexOf('<script src="bridge.js">') < text.indexOf(page.toString().slice(0, 40)));
    for (const f of fs.readdirSync(path.join(dir, 'dist/page', record)))
      if (f !== 'index.html')
        assert.ok(
          fs.readFileSync(path.join(out, f)).equals(fs.readFileSync(path.join(dir, 'dist/page', record, f))),
          record + ': ' + f + ' copied as built'
        );
    for (const f of SHIM) assert.ok(fs.existsSync(path.join(out, f)), record + ': ' + f);
  }
  // The two records' pages differ (each stamps its own target), so each wrap is its own record's.
  const a = fs.readFileSync(path.join(dir, 'out-staging/index.html'), 'utf8');
  const b = fs.readFileSync(path.join(dir, 'out-live/index.html'), 'utf8');
  assert.match(a, /<meta name="ev-target" content="staging">/);
  assert.match(b, /<meta name="ev-target" content="live">/);
  // B-506: the Gallery's address, /gallery, is the staging app itself; live has none
  assert.equal(fs.readFileSync(path.join(dir, 'out-staging/gallery.html'), 'utf8'), a);
  assert.equal(fs.existsSync(path.join(dir, 'out-live/gallery.html')), false);
  // D-392 to D-395: the UI polish reference at /reference, staging only
  for (const f of ['index.html', 'r4.css', 'ds/tokens.css', 'after/prototype.html', 'after/today-1280-light.png'])
    assert.ok(fs.existsSync(path.join(dir, 'out-staging/reference', f)), 'staging reference: ' + f);
  assert.equal(fs.existsSync(path.join(dir, 'out-staging/reference/README.md')), false);
  assert.equal(fs.existsSync(path.join(dir, 'out-live/reference')), false, 'live has no reference');
});

test('B-309: build-pwa refuses a record it does not know, or a page not built', () => {
  assert.throws(() => buildPwa({ record: 'prod', root: ROOT }), /--record must be one of staging, live/);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-pwa-empty-'));
  assert.throws(
    () => buildPwa({ record: 'staging', root: empty, out: path.join(empty, 'o') }),
    /run node tools\/build/
  );
});

test('B-322: the Worker passes an image block to the Claude API as the page sent it, with its own key and model', async () => {
  const { default: worker } = await import('../pwa/worker.js');
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/AAAA' } };
  const messages = [{ role: 'user', content: [image, { type: 'text', text: 'Transcribe all the text.' }] }];
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init });
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' }), {
      status: 200,
    });
  };
  try {
    // B-418: the token ceilings keep their count in D1, so the Worker has one here (an in-memory SQLite)
    const { DatabaseSync } = await import('node:sqlite');
    const sql = new DatabaseSync(':memory:');
    sql.exec(fs.readFileSync(path.join(ROOT, 'pwa/schema.sql'), 'utf8'));
    const stmt = (q, args = []) => ({
      bind: (...a) => stmt(q, a),
      first: async () => sql.prepare(q).get(...args) ?? null,
      run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...args).changes) } }),
    });
    const DB = { prepare: q => stmt(q) };
    const env = { EV_TOKEN: 't', ANTHROPIC_API_KEY: 'k-test', DB, ASSETS: { fetch: () => new Response('') } };
    const ask = token =>
      worker.fetch(
        new Request('https://ev.example/api/claude', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({ messages, model: 'claude-opus-anything', max_tokens: 99999 }),
        }),
        env
      );
    assert.equal((await ask('wrong')).status, 401, 'no token, no call');
    assert.equal(sent.length, 0);
    assert.equal((await ask('t')).status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(sent[0].init.headers['x-api-key'], 'k-test');
    const body = JSON.parse(sent[0].init.body);
    assert.deepEqual(body.messages, messages, 'the image block reaches the API unchanged');
    assert.equal(body.model, 'claude-haiku-5-5', 'the page cannot pick the model');
    assert.equal(body.max_tokens, 8192, 'nor the length cap'); // B-324: 8,192, for a job's answer
  } finally {
    globalThis.fetch = realFetch;
  }
});
