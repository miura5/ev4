// B-473 (D-367): the system documents a scheduled run bootstraps from, put on the target's Worker by its deploy
// workflow (pwa-staging.yml, pwa-live.yml) instead of written to the claude.ai record by ship.
//
//   node tools/pwa-system.mjs put staging|live <worker url>   in the workflow, after the deploy: PUT each document of
//                                                             the build (dist/system: manifest, spec, environments; and
//                                                             the Chart's Your turn) to /api/run/system/<name>, read
//                                                             each back, then the ::notice ship's read finds
//
// The token comes from the environment (EV_TOKEN, the workflow's secret) and goes only into a request header. Prints
// names, sizes, hashes and the manifest's commit: never a token, never a document.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SYSTEM_NAMES } from '../pwa/system.js';
import { loadChart } from './chart/record.mjs';
import { yourTurnDoc } from './chart/render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha16 = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/** The documents the deploy puts, by name, as the canonical text the Worker stores (pwa/runapi.js canonicalText). */
export function systemDocs({ root = ROOT, dist = path.join(root, 'dist'), target, now = new Date() }) {
  const out = {};
  for (const name of SYSTEM_NAMES) {
    if (name === 'yourturn') continue;
    out[name] = JSON.parse(fs.readFileSync(path.join(dist, 'system', name + '.json'), 'utf8'));
  }
  out.yourturn = yourTurnDoc(loadChart(root), {
    at: now.toISOString(),
    commit: String(out.manifest.commit || '').slice(0, 7),
    source: `deploy ${target}`,
  });
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, JSON.stringify(v)]));
}

/** The notice the workflow leaves and ship's read parses (tools/pwa-app.mjs readRun). */
export const systemMessage = ({ commit, hashes }) =>
  `system ev ${commit} ` + SYSTEM_NAMES.map(n => `${n} ${hashes[n] || 'none'}`).join(' ');
export function parseSystemMessage(s) {
  const m = /\bsystem ev ([0-9a-f]{7,40})((?: [a-z]+ [0-9a-f]{16})+)/.exec(String(s || ''));
  if (!m) return null;
  const parts = m[2].trim().split(' ');
  const hashes = {};
  for (let i = 0; i < parts.length; i += 2) hashes[parts[i]] = parts[i + 1];
  return { commit: m[1], hashes };
}

/** PUT every document, then GET each back and compare. {lines: [{ok, what}], message}. */
export async function putSystem({ base, token, docs, fetchFn = fetch }) {
  const lines = [];
  const hashes = {};
  const url = name => base.replace(/\/+$/, '') + '/api/run/system/' + name;
  const auth = { authorization: 'Bearer ' + token };
  for (const [name, text] of Object.entries(docs)) {
    const put = await fetchFn(url(name), {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: text,
    });
    if (put.status !== 200) {
      lines.push({ ok: false, what: `system/${name}: the put answered ${put.status}` });
      continue;
    }
    const got = await fetchFn(url(name), { headers: auth });
    const back = got.status === 200 ? await got.text() : null;
    const ok = back === text;
    if (ok) hashes[name] = sha16(text);
    lines.push({
      ok,
      what: ok
        ? `system/${name}: ${text.length} bytes, read back equal (${hashes[name]})`
        : `system/${name}: read back ${back == null ? 'status ' + got.status : 'different'}`,
    });
  }
  const commit = String(JSON.parse(docs.manifest).commit || '');
  return { lines, message: systemMessage({ commit, hashes }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, target, base] = process.argv.slice(2);
  if (cmd !== 'put' || !['staging', 'live'].includes(target) || !/^https:\/\//.test(base || '')) {
    console.error(
      'usage: node tools/pwa-system.mjs put staging|live https://<the Worker>  (EV_TOKEN in the environment)'
    );
    process.exit(2);
  }
  const token = process.env.EV_TOKEN;
  if (!token) {
    console.error('EV_TOKEN is not set');
    process.exit(2);
  }
  const { lines, message } = await putSystem({ base, token, docs: systemDocs({ target }) }).catch(e => ({
    lines: [{ ok: false, what: `the put failed: ${String(e.message).split('\n')[0].slice(0, 200)}` }],
    message: '',
  }));
  for (const l of lines) console.log(`${l.ok ? 'ok ' : 'NO '} ${l.what}`);
  for (const l of lines) if (!l.ok) console.log(`::error title=system ${target}::${l.what}`);
  const green = lines.length === SYSTEM_NAMES.length && lines.every(l => l.ok);
  if (green) console.log(`::notice title=system ${target}::${message}`);
  console.log(`system ${target}: ${green ? 'GREEN' : 'RED'}`);
  process.exit(green ? 0 : 1);
}
