// B-228: the page's files join into one scope (tools/build.mjs), where a second function of the same name silently wins
// over the first (Oct 23: the list paint's withPainted lost to the answer paint's). No two top-level functions share a
// name across page/app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'page', 'app');

test('B-228: no two top-level functions in page/app share a name', () => {
  const seen = {};
  for (const f of fs
    .readdirSync(DIR)
    .filter(x => x.endsWith('.js'))
    .sort())
    for (const m of fs.readFileSync(path.join(DIR, f), 'utf8').matchAll(/^ {4}(?:async )?function (\w+)\s*\(/gm))
      (seen[m[1]] = seen[m[1]] || []).push(f);
  const twice = Object.entries(seen).filter(([, fs]) => fs.length > 1);
  assert.deepEqual(twice, []);
});
