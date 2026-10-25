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
import { buildPwa, HEAD, FOOT, NAME, RECORDS, SHIM } from '../tools/build-pwa.mjs';
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

test('B-309: build-pwa wraps each record’s built page byte for byte, titled E.V.', async () => {
  const dir = builtCopy();
  await build({ root: dir, now: '2026-10-25T12:00:00Z' });
  for (const record of RECORDS) {
    const out = path.join(dir, 'out-' + record);
    buildPwa({ record, root: dir, out });
    const page = fs.readFileSync(path.join(dir, 'dist/page', record, 'index.html'));
    const html = fs.readFileSync(path.join(out, 'index.html'));
    assert.ok(html.subarray(0, HEAD.length).equals(Buffer.from(HEAD)), record + ': the head comes first');
    assert.ok(
      html.subarray(HEAD.length, html.length - FOOT.length).equals(page),
      record + ': the page is wrapped byte for byte'
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
});

test('B-309: build-pwa refuses a record it does not know, or a page not built', () => {
  assert.throws(() => buildPwa({ record: 'prod', root: ROOT }), /--record must be one of staging, live/);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-pwa-empty-'));
  assert.throws(
    () => buildPwa({ record: 'staging', root: empty, out: path.join(empty, 'o') }),
    /run node tools\/build/
  );
});
