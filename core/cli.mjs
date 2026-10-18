#!/usr/bin/env node
// E.V. v4 command line. Build-chat commands so far:
//   verify-deploy <live|staging>   diff the saved live state against dist/manifest.json; prints the reads to save
//   deploy <live|staging>          print the exact calls that deploy this build (refuses dirty, unpushed, live w/o OK)
// Options: --root <repo> (default: this checkout), --dist <dir> (default <root>/dist), --state <dir> (default
// <dist>/state/<target>), --version <manifest|spec|environments>=<n> (deploy: the version a get printed),
// --matt-ok (deploy live), --json. Exit code 0 green or printed, 1 red or refused, 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verify, verifyReads, formatVerify, deployCalls, formatDeploy, SYSTEM_IDS } from './deploy.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const maybeJson = p => (fs.existsSync(p) ? readJson(p) : undefined);

function args(argv) {
  const o = { _: [], version: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--matt-ok' || a === '--json') o[a.slice(2).replace('-ok', 'Ok')] = true;
    else if (a === '--version') { const [k, v] = (argv[++i] || '').split('='); o.version[k] = Number(v); }
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
    else o._.push(a);
  }
  return o;
}

export function isPushed(root, commit) {
  try { execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', commit, 'origin/main'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Reads the state a chat saved with verifyReads(): triggers-<n>.json pages, record/system/*.json, page.html. */
export function readState(dir) {
  if (!fs.existsSync(dir)) return { triggers: null, record: null, pageHtml: null, pageFiles: null };
  const pages = fs.readdirSync(dir).filter(f => /^triggers-\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(9)) - parseInt(b.slice(9)));
  const triggers = pages.length ? pages.flatMap(f => { const r = readJson(path.join(dir, f)); return Array.isArray(r) ? r : r.data || []; }) : null;
  const sys = path.join(dir, 'record', 'system');
  const record = fs.existsSync(sys) ? Object.fromEntries(SYSTEM_IDS.map(id => [id, maybeJson(path.join(sys, id + '.json'))])) : null;
  const pageHtml = fs.existsSync(path.join(dir, 'page.html')) ? fs.readFileSync(path.join(dir, 'page.html'), 'utf8') : null;
  const filesDir = path.join(dir, 'page-files');
  let pageFiles = null;
  if (fs.existsSync(filesDir)) {
    pageFiles = {};
    const walk = (d, rel) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p, rel + f + '/'); else pageFiles['page/' + rel + f] = sha256(fs.readFileSync(p)); } };
    walk(filesDir, '');
  }
  return { triggers, record, pageHtml, pageFiles };
}

function load(o, target) {
  const root = o.root ? path.resolve(o.root) : HERE;
  const dist = o.dist ? path.resolve(o.dist) : path.join(root, 'dist');
  const mp = path.join(dist, 'manifest.json');
  if (!fs.existsSync(mp)) throw new Error(`no ${path.relative(process.cwd(), mp) || mp}: run node tools/build.mjs first`);
  const manifest = readJson(mp);
  if (!manifest.records[target]) throw new Error(`unknown target ${target} (live or staging)`);
  const distDocs = Object.fromEntries(['spec', 'environments'].map(id => [id, readJson(path.join(dist, 'system', id + '.json'))]));
  const stateDir = o.state ? path.resolve(o.state) : path.join(dist, 'state', target);
  return { root, dist, manifest, distDocs, stateDir, build: { pushed: isPushed(root, manifest.commit) } };
}

const commands = {
  'verify-deploy'(o) {
    const target = o._[1];
    const { dist, manifest, distDocs, stateDir, build } = load(o, target);
    const state = readState(stateDir);
    const result = verify({ manifest, target, state, build, dist: distDocs, sha256 });
    const reads = verifyReads({ manifest, target, stateDir });
    fs.writeFileSync(path.join(dist, `verify-${target}.json`), JSON.stringify({ target, release: manifest.release, commit: manifest.commit, green: result.green, lines: result.lines }, null, 1));
    console.log(o.json ? JSON.stringify({ ...result, reads }, null, 1) : formatVerify(target, result, reads));
    return result.green ? 0 : 1;
  },
  deploy(o) {
    const target = o._[1];
    const { dist, manifest, stateDir, build } = load(o, target);
    const result = deployCalls({ manifest, target, distDir: dist, build, versions: o.version, mattOk: Boolean(o.mattOk), state: readState(stateDir), sha256 });
    if (result.ok) fs.writeFileSync(path.join(dist, `deploy-${target}.json`), JSON.stringify(result, null, 1));
    console.log(o.json ? JSON.stringify(result, null, 1) : formatDeploy(target, result));
    return result.ok ? 0 : 1;
  },
};

export function main(argv) {
  const o = args(argv);
  const cmd = commands[o._[0]];
  if (!cmd || !['live', 'staging'].includes(o._[1])) {
    console.error(`Commands: ${Object.keys(commands).map(c => c + ' <live|staging>').join(', ')}`);
    return 2;
  }
  try { return cmd(o); } catch (e) { console.error(`${o._[0]} failed: ${e.message}`); return 1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
