// B-64 (O-3): the formatter at 120 columns covers the code, and the page logic is split by tab. page/app/*.js are
// sections of one closure, so the formatter cannot read a part alone: this test holds their join (what the build
// publishes as app.js) to the formatter, and the join to what the parts were cut from.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { appSource } from '../tools/build.mjs';

// B-154 (C-2): a checkout without node_modules (a cloud session that has not run npm ci) skips the formatter check
// and says why; CI installs prettier and always runs it, so the skip never hides a miss there.
export const PRETTIER = path.join(ROOT, 'node_modules', '.bin', 'prettier');
export const formatSkip = ({ root = ROOT, env = process.env } = {}) =>
  fs.existsSync(path.join(root, 'node_modules', '.bin', 'prettier')) || env.CI
    ? false
    : 'prettier is not installed (node_modules/.bin/prettier is missing): run npm ci to check the format; CI always checks it';

test('B-64: the joined app.js is as the formatter writes it', { skip: formatSkip() }, async () => {
  const prettier = await import('prettier');
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.prettierrc.json'), 'utf8'));
  assert.ok(
    await prettier.check(appSource(ROOT), { ...config, parser: 'babel' }),
    'the joined app.js is as the formatter writes it'
  );
});

test('B-154: without prettier the format check skips with its reason, except in CI', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-bare-'));
  assert.match(formatSkip({ root: bare, env: {} }), /^prettier is not installed .*CI always checks it$/);
  assert.equal(formatSkip({ root: bare, env: { CI: 'true' } }), false, 'CI runs it, and fails without prettier');
  assert.equal(formatSkip({ root: ROOT, env: {} }), !fs.existsSync(PRETTIER) && formatSkip({ root: bare, env: {} }));
});

test('B-64: page/app/*.js join to app.js, opening the closure and closing it, each part one section', () => {
  const app = appSource(ROOT);
  const parts = fs
    .readdirSync(path.join(ROOT, 'page', 'app'))
    .filter(f => f.endsWith('.js'))
    .sort();
  assert.ok(parts.length >= 20, `${parts.length} parts`);
  assert.match(app, /^\/\/ E\.V\. Home page logic/);
  assert.match(app, /window\.EVApp = \{ VERSION, boot \};\n\}\)\(\);\n$/);
  for (const f of parts.slice(1))
    assert.match(
      fs.readFileSync(path.join(ROOT, 'page', 'app', f), 'utf8'),
      /^\s*\/\/ -{4,}/,
      `${f} starts at its section line`
    );
  assert.ok(!fs.existsSync(path.join(ROOT, 'page', 'app.js')), 'no second copy of the page logic');
});

test('B-64: the formatter and CI are set up: printWidth 120, prettier pinned beside Playwright, npm test on every push', () => {
  const rc = JSON.parse(fs.readFileSync(path.join(ROOT, '.prettierrc.json'), 'utf8'));
  assert.equal(rc.printWidth, 120);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.devDependencies.prettier, /^\d+\.\d+\.\d+$/, 'an exact version');
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8');
  assert.match(wf, /on:\s*\n\s*push:/);
  assert.match(wf, /run: npm ci/);
  assert.match(wf, /run: npm test/);
  assert.match(wf, /prettier --check/);
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /prettier/i);
  assert.match(claude, /page\/app\//);
  assert.match(claude, /GitHub Actions/);
});
