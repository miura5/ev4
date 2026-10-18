// No personal data in the repository (CLAUDE.md, Hard limits): the tree git would commit holds no record export,
// backup or Study Watch session file. The planted cases prove the scan finds each kind; all their data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFiles, listRepoFiles, SYNTHETIC_MARKER } from '../tools/personal-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function plant(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-pd-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return { root, rels: Object.keys(files) };
}

test('the repository tree holds no record export, backup or session file', () => {
  const findings = scanFiles(ROOT, listRepoFiles(ROOT));
  assert.deepEqual(findings, [], 'personal data found:\n' + findings.map(f => `  ${f.file}: ${f.why}`).join('\n'));
});

test('fixtures/ and dist/ are ignored by git', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').map(s => s.trim());
  for (const dir of ['fixtures/', 'dist/']) assert.ok(ignore.includes(dir), `${dir} missing from .gitignore`);
});

test('a planted v3 backup, export folder and session file are each found', () => {
  const { root, rels } = plant({
    'notes/E.V.-backup-friday.json': { schema: 1 },
    'scratch/dump.json': { schema: 1, kind: 'E.V. record backup', counts: { weakspots: 1 }, collections: { weakspots: [{ id: 'ws-1' }] } },
    'scratch/export.json': { collections: { weakspots: [], sets: [] } },
    'scratch/flat.json': { weakspots: [], sets: [], days: [] },
    'old/db/weakspots/ws-2026-10-01-E4-3-fluids.json': { topic: 'made up' },
    'old/sessions/2026-10-17-1930-NUR-112-Week-8.json': { id: 'x' },
    'misc/note.json': { source: 'Study Watch', note: 'made up', startedAt: '2026-10-17T00:30:00Z' },
    'live/latest.json': { id: 'x' },
    'mirror.tgz': 'x',
  });
  const found = scanFiles(root, rels).map(f => f.file).sort();
  assert.deepEqual(found, rels.slice().sort());
});

test('ordinary repository files are not flagged', () => {
  const { root, rels } = plant({
    'spec/ev.spec.json': { collections: { weakspots: { class: 'Fact' }, sets: { class: 'Fact' }, days: { class: 'Derived' } }, tasks: {}, days: {}, sets: {} },
    'spec/schemas/weakspots.schema.json': { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
    'package.json': { name: 'ev4' },
    'test/data/sample.json': { items: [1, 2] },
    'core/sessions.mjs': 'export {};',
  });
  assert.deepEqual(scanFiles(root, rels), []);
});

test('a folder marked synthetic may hold made-up export documents, but a real backup inside it is still found', () => {
  const { root, rels } = plant({
    [`test/harness/data/${SYNTHETIC_MARKER}`]: 'Made-up records for the harness.',
    'test/harness/data/weakspots/ws-1.json': { topic: 'made up' },
    'test/harness/data/real.json': { kind: 'E.V. record backup', collections: {} },
  });
  assert.deepEqual(scanFiles(root, rels).map(f => f.file), ['test/harness/data/real.json']);
});
