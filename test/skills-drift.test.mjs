// B-613 (D-410): the workflow lives in skills and CLAUDE.md, and this keeps them from drifting silently. It fails when
// one names a repository path, chart command, npm script or workflow file that does not exist; when a skill cites a
// decision the Chart lacks or has superseded; and when a pinned rule is stated anywhere but its one home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const SKILLS = path.join(ROOT, '.claude', 'skills');
const VENDORED = new Set(['claude-api']); // Anthropic's skill, vendored unchanged
const walk = d =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const f = path.join(d, e.name);
    return e.isDirectory() ? walk(f) : e.name.endsWith('.md') ? [f] : [];
  });
const skillFiles = fs
  .readdirSync(SKILLS)
  .filter(n => !VENDORED.has(n))
  .flatMap(n => walk(path.join(SKILLS, n)));
const docs = [path.join(ROOT, 'CLAUDE.md'), ...skillFiles].map(f => ({
  rel: path.relative(ROOT, f).split(path.sep).join('/'),
  dir: path.dirname(f),
  text: fs.readFileSync(f, 'utf8'),
}));
const exists = p => fs.existsSync(p);
const TOP = /^(\.claude|\.github|chart|core|docs|page|pwa|spec|test|tools)\//;

test('B-613: every repository path, chart command, npm script and workflow file a skill or CLAUDE.md names exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const chartSrc = fs.readFileSync(path.join(ROOT, 'tools', 'chart.mjs'), 'utf8');
  const commands = new Set([...chartSrc.matchAll(/^\/\/ {3}([a-z]+) /gm)].map(m => m[1]));
  const workflows = new Set(fs.readdirSync(path.join(ROOT, '.github', 'workflows')));
  const bad = [];
  for (const d of docs) {
    for (const m of d.text.matchAll(
      /(?<![\w./-])((?:\.claude|\.github|chart|core|docs|page|pwa|spec|test|tools)\/[\w./*<>-]*[\w*>])/g
    )) {
      const p = m[1];
      if (/[<>*]/.test(p) || !TOP.test(p)) continue; // a pattern or placeholder, not one path
      if (!exists(path.join(ROOT, p))) bad.push(`${d.rel}: ${p}`);
    }
    for (const m of d.text.matchAll(/`(references\/[\w.-]+)`/g))
      if (!exists(path.join(d.dir, m[1])) && !exists(path.join(d.dir, '..', m[1]))) bad.push(`${d.rel}: ${m[1]}`);
    for (const m of d.text.matchAll(/node tools\/chart\.mjs ([a-z]+)/g))
      if (!commands.has(m[1])) bad.push(`${d.rel}: chart command ${m[1]}`);
    for (const m of d.text.matchAll(/npm run ([\w:-]+)/g))
      if (!pkg.scripts[m[1]]) bad.push(`${d.rel}: npm script ${m[1]}`);
    for (const m of d.text.matchAll(/\b([\w-]+\.yml)\b/g))
      if (!workflows.has(m[1])) bad.push(`${d.rel}: workflow ${m[1]}`);
    for (const m of d.text.matchAll(/node (tools\/[\w-]+\.(?:mjs|cjs))/g))
      if (!exists(path.join(ROOT, m[1]))) bad.push(`${d.rel}: ${m[1]}`);
  }
  assert.deepEqual([...new Set(bad)], []);
});

test('B-613: every decision a skill cites is in the Chart and not superseded', () => {
  const status = Object.fromEntries(
    JSON.parse(fs.readFileSync(path.join(ROOT, 'chart', 'decisions.json'), 'utf8')).map(x => [x.id, x.status])
  );
  const bad = [];
  for (const d of docs.filter(d => d.rel.startsWith('.claude/')))
    for (const [id] of d.text.matchAll(/\bD-\d+\b/g))
      if (!status[id] || status[id] === 'superseded') bad.push(`${d.rel}: ${id} ${status[id] || 'missing'}`);
  assert.deepEqual([...new Set(bad)], []);
});

// A rule's value is stated in exactly one home; elsewhere it is pointed to, never restated with its own value.
const PINNED = [
  // B-611 (D-408): moved here from smoke.test.mjs with the text it pinned
  {
    key: 'full suite per batch',
    re: /full suite on GitHub once per batch, before ship staging/,
    home: '.claude/skills/ev-build-manager/SKILL.md',
  },
  {
    key: 'agents at a time',
    re: /\d+\s+to\s+\d+\s+agents at a time|at most \d+ agents/i,
    home: '.claude/skills/ev-build-manager/SKILL.md',
  },
  { key: 'budget per release', re: /\*\*Budget per release:?\*\*/, home: '.claude/skills/ev-build-manager/SKILL.md' },
  { key: 'proof tiers', re: /^## Proofs by kind/m, home: '.claude/skills/ev-builder/SKILL.md' },
  {
    key: 'the rubric',
    re: /\| Linear-level polish \| \d+/,
    home: '.claude/skills/ev-build-manager/references/release-card.md',
  },
  {
    key: 'click-through cap',
    re: /for at most \d+ minutes|capped at \d+ minutes/,
    home: '.claude/skills/ev-build-manager/references/agents.md',
  },
  {
    key: 'liveness quiet minutes',
    re: /quiet for \d+ minutes/,
    home: '.claude/skills/ev-build-manager/references/agents.md',
  },
];

test('B-613: each pinned rule is stated in its one home and nowhere else among the skills and CLAUDE.md', () => {
  const homes = [],
    strays = [];
  for (const r of PINNED) {
    const where = docs.filter(d => r.re.test(d.text)).map(d => d.rel);
    if (!where.includes(r.home)) homes.push(`${r.key}: not in ${r.home}`);
    for (const w of where) if (w !== r.home) strays.push(`${r.key}: restated in ${w}`);
  }
  assert.deepEqual([...homes, ...strays], []);
});

const HANDOVER = ['## Running', '## Waiting on Matt', '## Next', '## Last release'];
// The handover itself is not read here: no test reads docs/ (B-425), so the skill's stated shape is what is pinned.
test('B-613: the build manager skill states the handover in its fixed shape, four headings in order', () => {
  const skill = fs.readFileSync(path.join(SKILLS, 'ev-build-manager', 'SKILL.md'), 'utf8');
  const stated = [...skill.matchAll(/^- `(## [^`]+)`/gm)].map(m => m[1]);
  assert.deepEqual(stated, HANDOVER);
});
