// B-311: the check on the staging Worker (ev-staging, over the staging D1). Run by the pwa-staging workflow after each
// deploy, and by a cloud session with no token to show it reaches the Worker:
//   node tools/pwa-staging.mjs check <worker url>      EV_TOKEN in the environment: the full check
//   node tools/pwa-staging.mjs reach <worker url>      no token: only that /api/db answers 401 without one
// The full check: /api/db answers 401 with no token and with a wrong one; with the token, the documents per
// collection equal the made-up record the app is seeded with (pwa/seed.mjs, from test/data/synthetic.cjs). It prints
// counts and statuses only: never the token, never a document.
import { fileURLToPath } from 'node:url';
import { seedCounts } from '../pwa/seed.mjs';

/** Documents per collection in a GET /api/db answer. */
export function countsOf(body) {
  const out = {};
  for (const d of (body && body.docs) || []) out[d.c] = (out[d.c] || 0) + 1;
  return out;
}

/** One line per collection whose count differs; empty when they match. */
export function countDiffs(got, want) {
  return [...new Set([...Object.keys(want), ...Object.keys(got)])]
    .sort()
    .filter(c => (got[c] || 0) !== (want[c] || 0))
    .map(c => `${c}: ${got[c] || 0} in the Worker, ${want[c] || 0} in the seed`);
}

const status = async (url, token) =>
  (await fetch(url, token == null ? {} : { headers: { authorization: 'Bearer ' + token } })).status;

/** The checks, as [{ ok, what }]. */
export async function check(base, token, { want = seedCounts() } = {}) {
  const url = base.replace(/\/+$/, '') + '/api/db';
  const lines = [];
  const add = (ok, what) => lines.push({ ok, what });
  const none = await status(url);
  add(none === 401, `no token: /api/db answers ${none}${none === 401 ? '' : ', expected 401'}`);
  if (token == null) return lines;
  const wrong = await status(url, token + '-wrong');
  add(wrong === 401, `a wrong token: /api/db answers ${wrong}${wrong === 401 ? '' : ', expected 401'}`);
  const r = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
  if (r.status !== 200) {
    add(false, `the token: /api/db answers ${r.status}, expected 200`);
    return lines;
  }
  const got = countsOf(await r.json());
  const diffs = countDiffs(got, want);
  const total = Object.values(got).reduce((a, b) => a + b, 0);
  add(
    diffs.length === 0,
    diffs.length
      ? `counts per collection differ: ${diffs.join('; ')}`
      : `the token: ${total} documents in ${Object.keys(got).length} collections, each count equal to the seed's`
  );
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, base] = process.argv.slice(2);
  if (!['check', 'reach'].includes(cmd) || !/^https:\/\//.test(base || '')) {
    console.error('usage: node tools/pwa-staging.mjs check|reach https://<the staging Worker>');
    process.exit(2);
  }
  const token = cmd === 'check' ? process.env.EV_TOKEN : null;
  if (cmd === 'check' && !token) {
    console.error('pwa-staging check: EV_TOKEN is not set');
    process.exit(2);
  }
  const lines = await check(base, token);
  for (const l of lines) console.log(`${l.ok ? 'ok ' : 'NO '} ${l.what}`);
  const green = lines.every(l => l.ok);
  console.log(`pwa-staging ${cmd}: ${green ? 'GREEN' : 'RED'}`);
  process.exit(green ? 0 : 1);
}
