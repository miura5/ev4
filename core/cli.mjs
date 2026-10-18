#!/usr/bin/env node
// E.V. v4 command line. Build-chat commands so far:
//   verify-deploy <live|staging>   diff the saved live state against dist/manifest.json; prints the reads to save
//   deploy <live|staging>          print the exact calls that deploy this build (refuses dirty, unpushed, live w/o OK)
//   migrate v3 --from <export>     the v4 writes for a v3 record export, as document files and chunked batches
//   verify-migration --from <export>   recompute every weak spot from the migrated Facts; zero mismatches passes
//   seed-staging --from <export>   the batches that make the staging record a copy of an export, stamped system/seed
//   lint --from <record>           the record against its rules: writers, unchanged Facts, budgets, schemas, every
//                                  Derived document rebuilt byte for byte, and the content checks (--date, --json)
//   rebuild <collection|all> --from <record>   regenerate Derived documents as of their time; --out <dir> writes them
//   steps [pipeline]               every pipeline's reads and steps, as the spec lists them
//   run <pipeline> <start|pull|pulled|compute|apply|replan|end|audit>   the run protocol's moves; each prints the
//                                  exact calls to make. --dir (default /tmp/ev/run), --record <live|staging>,
//                                  --at, --transcript <jsonl> (default this session's), --failed <n>, --batch <n>,
//                                  --status <ok|partial|failed>, --detail, --job <id> (worker), --probe <text> (diagnostic)
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
import { seedStaging } from './seed.mjs';
import { migrateV3, verifyMigration, applyWrites } from './migrate.mjs';
import { chunkWrites } from './batches.mjs';
import { readExport, loadValidator } from './schemas.mjs';
import { describeErrors } from './validate.mjs';
import { lintRecord, formatLint } from './lint.mjs';
import { rebuild } from './derive.mjs';
import * as RUN from './run.mjs';
import { newestTranscript } from './transcript.mjs';
import EV from './evcore.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const maybeJson = p => (fs.existsSync(p) ? readJson(p) : undefined);

function args(argv) {
  const o = { _: [], version: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--matt-ok' || a === '--json' || a === '--no-audit') o[a.slice(2).replace('-ok', 'Ok')] = true;
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
  if (!fs.existsSync(dir)) return { triggers: null, record: null, pageHtml: null, pageFiles: null };
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
/** This checkout's commit when it is clean (the code a rebuild runs), else null. */
function gitHead(root) {
  const dirty = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  return dirty ? null : execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}
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
  'seed-staging'(o) {
    const root = o.root ? path.resolve(o.root) : HERE;
    const spec = readJson(path.join(root, 'spec', 'ev.spec.json'));
    EV.configure(spec);
    const rec = spec.registry.records.staging;
    if (!rec || !rec.artifact) throw new Error('no staging record in spec.registry.records');
    const exp = loadExport(o.from);
    const stampFile = path.join(path.resolve(o.from), 'EXPORTED.txt');
    const exportedAt = o['exported-at'] || (fs.existsSync(stampFile) ? (fs.readFileSync(stampFile, 'utf8').match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/) || [])[0] : null);
    if (!exportedAt) throw new Error('give --exported-at <ISO>: when the export was taken (or an EXPORTED.txt beside it)');
    const at = o.at || new Date().toISOString();
    const { writes, seed, migrated } = seedStaging(exp, { at, exportedAt, from: o.kind === 'backup' ? 'backup' : 'live export', command: `seed-staging --from ${path.basename(path.resolve(o.from))}` });
    const validate = loadValidator(path.join(root, 'spec', 'schemas'));
    const invalid = writes.map(w => ({ w, r: validate(w.collection, w.data, { id: w.id }) })).filter(x => !x.r.ok);
    if (invalid.length) { console.log(`seed-staging: REFUSED, ${invalid.length} write(s) do not validate`); for (const { w, r } of invalid.slice(0, 20)) console.log('  ' + describeErrors(`${w.collection}/${w.id}`, r).split('\n')[0]); return 1; }
    const out = o.out ? path.resolve(o.out) : path.join(root, 'dist', 'seed');
    fs.rmSync(out, { recursive: true, force: true });
    const files = writes.map(w => { const f = path.join(out, 'docs', w.collection, w.id + '.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(w.data)); return { op: 'set', collection: w.collection, doc_id: w.id, file_path: f, data: w.data }; });
    // The seed stamp goes last, alone: it is written only once every document is in.
    const batches = [...chunkWrites(files.slice(0, -1), spec.capacity.batch), [files[files.length - 1]]].map(b => b.map(({ data, ...w }) => w));
    const plan = { record: artifactUrl(rec.artifact), target: 'staging', at, exportedAt: seed.exportedAt, migrated, counts: seed.counts, batches };
    fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan, null, 1));
    console.log(`seed-staging: ${writes.length} writes in ${batches.length} batches to the staging record (${rec.artifact}), export taken ${seed.exportedAt}${migrated ? ', migrated from v3' : ''} -> ${path.relative(process.cwd(), out) || out}/plan.json`);
    console.log('Apply each batch in order with ArtifactData batch (url: the plan\'s record); a set on a document that already exists needs its if_version from a get.');
    return 0;
  },
  lint(o) {
    const root = o.root ? path.resolve(o.root) : HERE;
    const spec = readJson(path.join(root, 'spec', 'ev.spec.json')); EV.configure(spec);
    const db = loadExport(o.from);
    const commit = o.commit || (() => { try { const g = gitHead(root); return g; } catch { return null; } })();
    const result = lintRecord(db, spec, loadValidator(path.join(root, 'spec', 'schemas')), { date: o.date || EV.chicagoDate(new Date().toISOString()), commit });
    if (o.json) fs.writeFileSync(path.resolve(o.json === true ? 'lint.json' : o.json), JSON.stringify(result.issues, null, 1));
    console.log(formatLint(result));
    return result.issues.some(i => i.severity === 'error') ? 1 : 0;
  },
  rebuild(o) {
    const root = o.root ? path.resolve(o.root) : HERE;
    const spec = readJson(path.join(root, 'spec', 'ev.spec.json')); EV.configure(spec);
    const want = o._.slice(1).filter(c => c !== 'all');
    for (const c of want) if (!spec.collections[c]) throw new Error('no collection ' + c);
    const results = rebuild(loadExport(o.from), spec, want);
    for (const r of results) console.log(`  ${r.status.padEnd(15)} ${r.ref}${r.reason ? ': ' + r.reason : ''}${r.inexact ? ' (changed since: ' + r.inexact.join(', ') + ')' : ''}`);
    if (o.out) for (const r of results.filter(r => r.data)) { const [col, ...rest] = r.ref.split('/'); const f = path.join(path.resolve(o.out), col, rest.join('/') + '.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(r.data, null, 1)); }
    const bad = results.filter(r => r.status === 'differs').length;
    console.log(`rebuild: ${results.filter(r => r.status === 'same' || r.status === 'inexact-same').length} reproduced, ${bad} differ, ${results.filter(r => r.status === 'inexact-differs').length} differ after a later edit, ${results.filter(r => r.status === 'skipped').length} skipped`);
    return bad ? 1 : 0;
  },
  steps(o) {
    const root = o.root ? path.resolve(o.root) : HERE;
    const spec = readJson(path.join(root, 'spec', 'ev.spec.json'));
    const names = o._[1] ? [o._[1]] : Object.keys(spec.pipelines).filter(k => k !== '_rules');
    for (const n of names) {
      const p = spec.pipelines[n]; if (!p) throw new Error('no pipeline ' + n);
      console.log(`${n} (${p.lane}, writes as ${p.writer}): ${p.purpose}`);
      if (!Array.isArray(p.steps)) { console.log(`  steps arrive with ${p.pendingIn}\n`); continue; }
      console.log(`  reads: ${(p.reads || []).map(r => r.collection + (r.windowDays ? ` (${r.windowDays} days)` : '')).join(', ')}`);
      p.steps.forEach((s, i) => console.log(`  ${i + 1}. [${s.kind}] ${s.id}: ${s.kind === 'agent' ? s.judgment : s.does || ''}`));
      console.log('');
    }
    return 0;
  },
  run(o) {
    const root = o.root ? path.resolve(o.root) : HERE;
    const spec = readJson(path.join(root, 'spec', 'ev.spec.json')); EV.configure(spec);
    const [, pipeline, move] = o._;
    const dir = path.resolve(o.dir || '/tmp/ev/run'); const at = o.at || new Date().toISOString();
    const transcript = () => { const f = o.transcript || newestTranscript(); if (!f) throw new Error('no session transcript found'); return fs.readFileSync(f, 'utf8'); };
    const show = (calls, then) => { console.log(`${pipeline} ${move}: ${calls.length} call${calls.length === 1 ? '' : 's'}, in order. Make each exactly as printed.\n`); console.log(RUN.formatCalls(calls)); if (then) console.log('\nThen: ' + then); return 0; };
    const cli = `node ${path.relative(process.cwd(), path.join(root, 'core', 'cli.mjs')) || 'core/cli.mjs'} run ${pipeline}`;
    const d = ` --dir ${dir}`;
    switch (move) {
      case 'start': {
        const manifest = maybeJson(path.resolve(o.manifest || '/tmp/ev/system/manifest.json')) || maybeJson(path.join(root, 'dist', 'manifest.json'));
        return show(RUN.start({ spec, pipeline, record: o.record || 'staging', at, dir, release: o.release || (manifest && manifest.release) || EV.VERSION, commit: (manifest && manifest.commit) || null, input: { ...(o.job ? { job: o.job } : {}), ...(o.probe ? { probe: o.probe } : {}) } }), `${cli} pull${d}`);
      }
      case 'pull': return show(RUN.pull({ spec, dir, at }), `${cli} pulled${d}`);
      case 'pulled': {
        const r = RUN.pulled({ spec, dir, transcript: transcript() });
        if (!r.done) return show(r.calls, `${cli} pulled${d}`);
        console.log(`${pipeline} pulled: versions for ${Object.values(r.versions).reduce((n, v) => n + Object.keys(v).length, 0)} documents in ${Object.keys(r.versions).length} collections.\nThen: ${cli} compute${d}`); return 0;
      }
      case 'compute': {
        const r = RUN.compute({ spec, dir, validate: loadValidator(path.join(root, 'spec', 'schemas')), at });
        if (r.status === 'waiting') { const m = r.question.material || {}; const groups = m.groups || []; const shown = groups.length ? { ...m, groups: groups.map(g => ({ name: g.name, rule: g.rule, calls: g.calls.length })) } : m; console.log(`${pipeline} compute: waiting on step ${r.step}.\nJudgment: ${r.question.judgment}\nMaterial: ${JSON.stringify(shown)}${groups.map(g => `\n\nGroup ${g.name} (${g.rule}):\n${RUN.formatCalls(g.calls)}`).join('')}\nAnswer shape (JSON Schema): ${JSON.stringify(r.question.output)}\nWrite the answer as JSON to ${r.question.answerPath}, then: ${cli} compute${d}`); return 3; }
        if (r.status === 'refused') { console.log(`${pipeline} compute: REFUSED, nothing planned`); for (const p of r.problems) console.log('  ' + p); return 1; }
        console.log(`${pipeline} compute: ${r.plan.writes} writes in ${r.plan.batches.length} batches, plan ${r.plan.hash.slice(0, 12)}${r.plan.push ? '\nPush: ' + r.plan.push : ''}\nThen: ${cli} apply${d}`); return 0;
      }
      case 'apply':
        if (o.failed) return show(RUN.applyFailed({ dir, batch: Number(o.failed) }), `${cli} replan --batch ${o.failed}${d}`);
        return show(RUN.apply({ dir }), `if a batch is refused on a version pin: ${cli} apply --failed <n>${d}; after the last batch: ${cli} end${d}`);
      case 'replan': return show(RUN.replan({ spec, dir, batch: Number(o.batch), transcript: transcript() }), `continue with the batches after it, then ${cli} end${d}`);
      case 'end': {
        show(RUN.end({ dir, at, status: o.status, detail: o.detail, transcript: o['no-audit'] ? null : transcript() }));
        const plan = maybeJson(path.join(dir, 'plan.json'));
        console.log(`\nPush: ${(plan && plan.push) || `E.V. ${pipeline} ${o.status && o.status !== 'ok' ? o.status : 'done'}`}`); return 0;
      }
      case 'audit': {
        const a = RUN.audit({ dir, transcript: transcript() });
        console.log(`${pipeline} audit: ${a.ok ? 'GREEN' : 'RED'} · ${a.matched} calls matched${a.extra.length ? ', ' + a.extra.length + ' not printed' : ''}${a.missing.length ? ', ' + a.missing.length + ' printed but not made' : ''}`);
        for (const c of a.extra) console.log(`  NO  ${c.tool} ${c.summary}`);
        for (const m of a.missing) console.log(`  missing ${m}`);
        return a.ok ? 0 : 1;
      }
      default: throw new Error('run <pipeline> <start|pull|pulled|compute|apply|replan|end|audit>');
    }
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
    const state = withShell(readState(stateDir), manifest, target, dist);
    const result = verify({ manifest, target, state, build, dist: distDocs, sha256 });
    const reads = verifyReads({ manifest, target, stateDir });
    fs.writeFileSync(path.join(dist, `verify-${target}.json`), JSON.stringify({ target, release: manifest.release, commit: manifest.commit, green: result.green, lines: result.lines }, null, 1));
    console.log(o.json ? JSON.stringify({ ...result, reads }, null, 1) : formatVerify(target, result, reads));
    return result.green ? 0 : 1;
  },
  deploy(o) {
    const target = o._[1];
    const { dist, manifest, stateDir, build } = load(o, target);
    const result = deployCalls({ manifest, target, distDir: dist, build, versions: o.version, mattOk: Boolean(o.mattOk), state: withShell(readState(stateDir), manifest, target, dist), sha256 });
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
    console.error('Commands: verify-deploy <live|staging>, deploy <live|staging>, migrate v3 --from <dir>, verify-migration --from <dir>, seed-staging --from <dir>, lint --from <dir>, rebuild <collection|all> --from <dir>, run <pipeline> <move>, steps [pipeline]');
    return 2;
  }
  try { return cmd(o); } catch (e) { console.error(`${o._[0]} failed: ${e.message}`); return 1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
