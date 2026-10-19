// The state verify() reads, from the files verifyReads() says to save (a build chat's dist/state/<target>, or a weekly
// run's own folder, B-29). Node only: the page never verifies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SYSTEM_IDS } from './deploy.mjs';

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const maybeJson = p => (fs.existsSync(p) ? readJson(p) : undefined);

/** Reads the state a chat saved with verifyReads(): triggers-<n>.json pages, record/system/*.json, page.html. */
/**
 * The published shell is wrapped by the platform's skeleton, so it is held by containment: when the saved page holds
 * the built shell verbatim, the shell counts as published with the build's hash (Operational architecture, "Page
 * delivery": most changes never touch the shell).
 */
export function withShell(state, manifest, target, distDir) {
  const files = (manifest.pages[target] || {}).files || {}; const key = Object.keys(files)[0];
  if (!key || state.pageHtml == null) return state;
  const built = path.join(distDir, key);
  const held = fs.existsSync(built) && state.pageHtml.includes(fs.readFileSync(built, 'utf8'));
  return { ...state, pageFiles: { ...(state.pageFiles || {}), [key]: held ? files[key] : 'not-the-built-shell' } };
}

export function readState(dir) {
  if (!fs.existsSync(dir)) return { triggers: null, record: null, pageHtml: null, pageFiles: null, pageDeclaration: null, running: null };
  const pages = fs.readdirSync(dir).filter(f => /^triggers-\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(9)) - parseInt(b.slice(9)));
  const triggers = pages.length ? pages.flatMap(f => { const r = readJson(path.join(dir, f)); return Array.isArray(r) ? r : r.data || []; }) : null;
  const sys = path.join(dir, 'record', 'system');
  const record = fs.existsSync(sys) ? Object.fromEntries([...SYSTEM_IDS, 'seed'].map(id => [id, maybeJson(path.join(sys, id + '.json'))])) : null;
  const pageHtml = fs.existsSync(path.join(dir, 'page.html')) ? fs.readFileSync(path.join(dir, 'page.html'), 'utf8') : null;
  const filesDir = path.join(dir, 'page-files');
  let pageFiles = null;
  if (fs.existsSync(filesDir)) {
    pageFiles = {};
    const walk = (d, rel) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p, rel + f + '/'); else pageFiles['page/' + path.basename(dir) + '/' + rel + f] = sha256(fs.readFileSync(p)); } };
    walk(filesDir, '');
  }
  const pageDeclaration = maybeJson(path.join(dir, 'page-declaration.json'));
  // B-87: the record's running study sessions as deploy read them (running.txt is the query's own answer, saved by
  // tools/tool-result.mjs, and dates the read; running/sessions/*.json are the documents its out_dir saved).
  const rt = path.join(dir, 'running.txt'), rd = path.join(dir, 'running', 'sessions');
  const running = fs.existsSync(rt) ? { readAt: fs.statSync(rt).mtimeMs, text: fs.readFileSync(rt, 'utf8'), sessions: fs.existsSync(rd) ? fs.readdirSync(rd).filter(f => f.endsWith('.json')).map(f => ({ id: f.slice(0, -5), ...(maybeJson(path.join(rd, f)) || {}) })) : [] } : null;
  return { triggers, record, pageHtml, pageFiles, pageDeclaration, running };
}

