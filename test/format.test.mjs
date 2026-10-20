// B-64 (O-3): the formatter at 120 columns covers the code, and the page logic is split by tab. page/app/*.js are
// sections of one closure, so the formatter cannot read a part alone: this test holds their join (what the build
// publishes as app.js) to the formatter, and the join to what the parts were cut from.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { appSource } from '../tools/build.mjs';

test('B-64: page/app/*.js join to a formatted app.js, opening the closure and closing it, each part one section', async () => {
  const prettier = await import('prettier');
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.prettierrc.json'), 'utf8'));
  const app = appSource(ROOT);
  assert.ok(
    await prettier.check(app, { ...config, parser: 'babel' }),
    'the joined app.js is as the formatter writes it'
  );
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
