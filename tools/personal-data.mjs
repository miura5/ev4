// Personal-data scan: finds record exports, backups and Study Watch session files in a file tree, so none is ever
// committed (Build plan, "Repository layout": nothing under fixtures/ or dist/ is committed, and a test greps the tree).
// Pure: scanFiles(root, relPaths) reads only the files it is given and returns findings; listRepoFiles(root) lists what
// git would commit (tracked plus untracked-not-ignored). Used by test/personal-data.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Every record collection, v3 and v4 (Data architecture, collection map). B-01 keeps this list in step with the spec.
export const RECORD_COLLECTIONS = [
  'weakspots', 'sets', 'answers', 'exams', 'objectives', 'plans', 'planedits', 'dates', 'dateedits', 'days', 'dayedits',
  'weeks', 'runs', 'health', 'state', 'sessions', 'ideas', 'journal', 'talk', 'jobs', 'jobresults', 'materials',
  'materialedits', 'libindex', 'announcements', 'concepts', 'system', 'legacy',
];

// A folder that holds made-up records for tests opts out of the layout rule with this marker file at its root.
// Its files are still content-scanned, so a real export copied into it is still found.
export const SYNTHETIC_MARKER = 'SYNTHETIC.md';

const MAX_SCAN_BYTES = 5 * 1024 * 1024;
const COLLECTION_SET = new Set(RECORD_COLLECTIONS);
const SESSION_FILE = /^\d{4}-\d{2}-\d{2}-\d{4}-[A-Za-z0-9-]*\.json$/;

export function listRepoFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean).filter(f => fs.existsSync(path.join(root, f)));
}

function syntheticRoots(relPaths) {
  return relPaths.filter(f => path.posix.basename(f) === SYNTHETIC_MARKER).map(f => path.posix.dirname(f));
}

function underSynthetic(rel, roots) {
  return roots.some(r => r === '.' || rel.startsWith(r + '/'));
}

// Layout rules: what a path alone gives away.
function pathFinding(rel, synth) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  if (/^E\.V\.-backup-.*\.json$/i.test(base)) return 'a v3 record backup by name';
  if (/^mirror\.(tgz|tar\.gz|zip)$/i.test(base)) return 'a record mirror archive';
  if (parts[0] === 'mirror' || parts[0] === 'backup') return `a file under ${parts[0]}/ (the Mac backup layout)`;
  if (base === 'latest.json' && parts[parts.length - 2] === 'live') return 'a Study Watch live note (live/latest.json)';
  if (SESSION_FILE.test(base) && parts.includes('sessions')) return 'a Study Watch session file';
  if (base.endsWith('.json') && parts.length >= 2 && COLLECTION_SET.has(parts[parts.length - 2]) && !underSynthetic(rel, synth)) {
    return `a record export document (${parts[parts.length - 2]}/<id>.json)`;
  }
  return null;
}

// Content rules: what a JSON file's shape gives away.
function contentFinding(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  if (doc._synthetic === true) return null;
  if (doc.kind === 'E.V. record backup') return 'a v3 record backup (kind: E.V. record backup)';
  // An export holds each collection as an array of documents; the spec's collection map holds objects, so it passes.
  if (doc.collections && typeof doc.collections === 'object') {
    const hits = Object.keys(doc.collections).filter(k => COLLECTION_SET.has(k) && Array.isArray(doc.collections[k]));
    if (hits.length >= 2) return `a record export (collections: ${hits.slice(0, 4).join(', ')})`;
  }
  const top = Object.keys(doc).filter(k => COLLECTION_SET.has(k) && Array.isArray(doc[k]));
  if (top.length >= 3) return `a record export (top-level ${top.slice(0, 4).join(', ')})`;
  if (doc.source === 'Study Watch' && ('note' in doc || 'startedAt' in doc)) return 'a Study Watch session file (source: Study Watch)';
  return null;
}

export function scanFiles(root, relPaths) {
  const rels = relPaths.map(f => f.split(path.sep).join('/'));
  const synth = syntheticRoots(rels);
  const findings = [];
  for (const rel of rels) {
    const byPath = pathFinding(rel, synth);
    if (byPath) { findings.push({ file: rel, why: byPath }); continue; }
    if (!rel.endsWith('.json')) continue;
    const abs = path.join(root, rel);
    let stat; try { stat = fs.statSync(abs); } catch { continue; }
    if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) continue;
    const byContent = contentFinding(fs.readFileSync(abs, 'utf8'));
    if (byContent) findings.push({ file: rel, why: byContent });
  }
  return findings;
}
