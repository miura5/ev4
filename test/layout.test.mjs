// Repository layout (Build plan, "Repository layout for the initial commit"): the architecture made visible.
// Executes: core/, scripts/, page/ (and the build tools in tools/). Describes: spec/. Proves: test/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = [
  'spec',
  'spec/schemas',
  'core',
  'scripts/canvas',
  'page',
  'studywatch/reader',
  'studywatch/app',
  'tools',
  'test',
  'test/harness',
  'test/data',
];

test('every layout directory exists', () => {
  for (const d of DIRS) assert.ok(fs.statSync(path.join(ROOT, d)).isDirectory(), `${d}/ missing`);
});

test('the orientation files exist', () => {
  for (const f of ['CLAUDE.md', 'README.md', 'BACKLOG.md', 'package.json', '.gitignore'])
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} missing`);
});

test('package.json runs node:test and depends on playwright and the formatter only', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.match(pkg.scripts.test, /^node --test /);
  assert.deepEqual(Object.keys(pkg.dependencies || {}), []);
  assert.deepEqual(
    Object.keys(pkg.devDependencies || {}),
    ['playwright', 'prettier'],
    'B-64: the formatter beside Playwright; the runtime stays dependency-free'
  );
});
