// The state verify() reads, from the files verifyReads() says to save (a build chat's dist/state/<target>, or a weekly
// run's own folder, B-29). Node only: the page never verifies.
import fs from 'node:fs';
import path from 'node:path';
import { SYSTEM_IDS } from './deploy.mjs';

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const maybeJson = p => (fs.existsSync(p) ? readJson(p) : undefined);

/** Reads the state a chat saved with verifyReads(): triggers-<n>.json pages and record/system/*.json (B-472, D-367:
 * the page is no longer read). */
export function readState(dir) {
  if (!fs.existsSync(dir)) return { triggers: null, record: null, running: null };
  const pages = fs
    .readdirSync(dir)
    .filter(f => /^triggers-\d+\.json$/.test(f))
    .sort((a, b) => parseInt(a.slice(9)) - parseInt(b.slice(9)));
  const triggers = pages.length
    ? pages.flatMap(f => {
        const r = readJson(path.join(dir, f));
        return Array.isArray(r) ? r : r.data || [];
      })
    : null;
  const sys = path.join(dir, 'record', 'system');
  const record = fs.existsSync(sys)
    ? Object.fromEntries([...SYSTEM_IDS, 'seed'].map(id => [id, maybeJson(path.join(sys, id + '.json'))]))
    : null;
  // B-87: the record's running study sessions as deploy read them (running.txt is the query's own answer, saved by
  // tools/tool-result.mjs, and dates the read; running/sessions/*.json are the documents its out_dir saved).
  const rt = path.join(dir, 'running.txt'),
    rd = path.join(dir, 'running', 'sessions');
  const running = fs.existsSync(rt)
    ? {
        readAt: fs.statSync(rt).mtimeMs,
        text: fs.readFileSync(rt, 'utf8'),
        sessions: fs.existsSync(rd)
          ? fs
              .readdirSync(rd)
              .filter(f => f.endsWith('.json'))
              .map(f => ({ id: f.slice(0, -5), ...(maybeJson(path.join(rd, f)) || {}) }))
          : [],
      }
    : null;
  return { triggers, record, running };
}
