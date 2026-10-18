#!/usr/bin/env node
// E.V. v4 command line. Build-chat commands so far:
//   verify-deploy <live|staging>   diff the saved live state against dist/manifest.json; prints the reads to save
//   deploy <live|staging>          print the exact calls that deploy this build (refuses dirty, unpushed, live w/o OK)
//   migrate v3 --from <export>     the v4 writes for a v3 record export, as document files and chunked batches
//   verify-migration --from <export>   recompute every weak spot from the migrated Facts; zero mismatches passes
// Options: --root <repo> (default: this checkout), --dist <dir> (default <root>/dist), --state <dir> (default
// <dist>/state/<target>), --version <manifest|spec|environments>=<n> (deploy: the version a get printed),
// --matt-ok (deploy live), --json; migrate: --from <export dir>, --at <ISO stamp> (default now), --out <dir>
// (default <dist>/migration), --record <live|staging> (the batch target). Exit 0 green, 1 red or refused, 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verify, verifyReads, formatVerify, deployCalls, formatDeploy, SYSTEM_IDS, artifactUrl } from './deploy.mjs';
import { migrateV3, verifyMigration, applyWrites } from './migrate.mjs';
import { chunkWrites } from './batches.mjs';
import { readExport, loadValidator } from './schemas.mjs';
import { describeErrors } from './validate.mjs';
import EV from './evcore.mjs';

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

/** A record export folder as {collection: [docs with id]}. */
function loadExport(dir) {
  if (!dir || !fs.existsSync(dir)) throw new Error(`no export at ${dir || '(give --from <dir>)'}`);
  const db = {};
  for (const { collection, id, doc } of readExport(path.resolve(dir))) (db[collection] = db[collection] || []).push({ ...doc, id });
  return db;
}
function migration(o) {
  const root = o.root ? path.resolve(o.root) : HERE;
  EV.configure(readJson(path.join(root, 'spec', 'ev.spec.json')));
  const v3 = loadExport(o.from);
  const at = o.at || new Date().toISOString();
  return { root, v3, at, result: migrateV3(v3, { at }) };
}

const commands = {
  migrate(o) {
    if (o._[1] !== 'v3') throw new Error('usage: migrate v3 --from <export dir>');
    const { root, at, result } = migration(o);
    const spec = readJson(path.join(root, 'spec', 'ev.spec.json'));
    const validate = loadValidator(path.join(root, 'spec', 'schemas'));
    const invalid = result.writes.map(w => ({ w, r: validate(w.collection, w.data, { id: w.id }) })).filter(x => !x.r.ok);
    if (invalid.length) { console.log(`migrate v3: REFUSED, ${invalid.length} write(s) do not validate`); for (const { w, r } of invalid.slice(0, 20)) console.log('  ' + describeErrors(`${w.collection}/${w.id}`, r).split('\n')[0]); return 1; }
    const out = o.out ? path.resolve(o.out) : path.join(root, 'dist', 'migration');
    fs.rmSync(out, { recursive: true, force: true });
    const files = result.writes.map(w => { const f = path.join(out, 'docs', w.collection, w.id + '.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(w.data)); return { op: 'set', collection: w.collection, doc_id: w.id, file_path: f, data: w.data }; });
    const batches = chunkWrites(files, spec.capacity.batch).map(b => b.map(({ data, ...w }) => w));
    const rec = o.record && spec.registry.records[o.record];
    const plan = { migration: 'v3-to-v4', at, record: rec ? artifactUrl(rec.artifact) : null, counts: result.counts, skipped: result.skipped, batches };
    fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan, null, 1));
    console.log(`migrate v3: ${result.writes.length} writes in ${batches.length} batches (at ${at}) -> ${path.relative(process.cwd(), out) || out}/plan.json`);
    console.log('  ' + Object.entries(result.counts).map(([k, v]) => `${k} ${v}`).join(', '));
    if (result.skipped.length) console.log(`  kept in legacy only or skipped: ${result.skipped.length} (listed in plan.json)`);
    return 0;
  },
  'verify-migration'(o) {
    const { v3, at, result } = migration(o);
    const vm = verifyMigration(v3, result.writes);
    const repeat = migrateV3(v3, { at });
    const second = migrateV3(applyWrites(v3, result.writes), { at });
    const deterministic = JSON.stringify(repeat.writes) === JSON.stringify(result.writes);
    const green = vm.mismatches.length === 0 && second.writes.length === 0 && deterministic;
    const out = { green, weakspots: vm.compared, mismatches: vm.mismatches, secondRunWrites: second.writes.length, deterministic };
    if (o.json) console.log(JSON.stringify(out, null, 1));
    else {
      console.log(`verify-migration: ${green ? 'GREEN' : 'RED'}: ${vm.compared} weak spots recomputed from the migrated Facts, ${vm.mismatches.length} mismatches; a second run writes ${second.writes.length}; ${deterministic ? 'deterministic' : 'NOT deterministic'}`);
      for (const m of vm.mismatches.slice(0, 30)) console.log(`  ${m.id} ${m.field}: v3 ${JSON.stringify(m.v3)}, v4 ${JSON.stringify(m.v4)}`);
    }
    return green ? 0 : 1;
  },
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

const TARGETED = ['verify-deploy', 'deploy'];
export function main(argv) {
  const o = args(argv);
  const cmd = commands[o._[0]];
  if (!cmd || (TARGETED.includes(o._[0]) && !['live', 'staging'].includes(o._[1]))) {
    console.error('Commands: verify-deploy <live|staging>, deploy <live|staging>, migrate v3 --from <dir>, verify-migration --from <dir>');
    return 2;
  }
  try { return cmd(o); } catch (e) { console.error(`${o._[0]} failed: ${e.message}`); return 1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
