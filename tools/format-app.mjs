#!/usr/bin/env node
// B-64: formats the page logic. page/app/*.js are sections of one closure, so the formatter reads them joined (the
// app.js the build publishes), and the result is cut back into the same parts at each part's first line.
//   node tools/format-app.mjs [--check]     (npm run format runs it after prettier --write .)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function formatApp({ root = ROOT, check = false } = {}) {
  const dir = path.join(root, 'page', 'app');
  const names = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .sort();
  const parts = names.map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
  const joined = parts.join('');
  const config = JSON.parse(fs.readFileSync(path.join(root, '.prettierrc.json'), 'utf8'));
  const out = await prettier.format(joined, { ...config, parser: 'babel' });
  if (out === joined) return { changed: [] };
  if (check) return { changed: names };
  // Each part after the first starts at its section line; find those lines, in order, in the formatted text.
  const firstLine = t =>
    t
      .split('\n')
      .find(l => l.trim())
      .trim();
  const lines = out.split('\n');
  const starts = [0];
  let at = 1;
  for (const p of parts.slice(1)) {
    const want = firstLine(p);
    while (at < lines.length && lines[at].trim() !== want) at++;
    if (at >= lines.length)
      throw new Error(`format-app: no line "${want.slice(0, 60)}" after formatting; split by hand`);
    starts.push(at++);
  }
  const changed = [];
  names.forEach((f, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    const text = lines.slice(starts[i], end).join('\n') + (i + 1 < starts.length ? '\n' : '');
    if (text !== parts[i]) {
      fs.writeFileSync(path.join(dir, f), text);
      changed.push(f);
    }
  });
  const again = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .sort()
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('');
  if (again !== out) throw new Error('format-app: the parts do not join to the formatted file');
  return { changed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  formatApp({ check }).then(
    r => {
      console.log(
        r.changed.length ? `${check ? 'unformatted' : 'formatted'}: ${r.changed.join(', ')}` : 'page/app is formatted'
      );
      process.exitCode = check && r.changed.length ? 1 : 0;
    },
    e => {
      console.error(e.message);
      process.exitCode = 1;
    }
  );
}
