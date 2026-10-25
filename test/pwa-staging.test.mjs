// B-311: the app's staging pair. The check the pwa-staging workflow runs against the staging Worker, proved here
// against a stand-in Worker; the workflow's own limits (started by hand, staging only, no secret echoed); the seed's
// append form deletes nothing; and the personal-data scan covers pwa/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, recordDiffs, seededAt } from '../tools/pwa-staging.mjs';
import { APP_SOURCE } from '../pwa/jobs.mjs';
import { SUITE, SUITE_DOCS_PER_RUN } from '../pwa/runapi.js';
import { seedCounts, seedRecord, seedSql, LEFT_OUT } from '../pwa/seed.mjs';
import { scanFiles, listRepoFiles } from '../tools/personal-data.mjs';
import { syntheticRecord } from './data/synthetic.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'test-token-not-a-secret';

// A stand-in for the Worker's /api/db: 401 without the token, else the documents it holds.
async function worker(record, at) {
  const docs = Object.entries(record).flatMap(([c, d]) =>
    Object.entries(d).map(([id, data]) => ({ c, id, data, ...(at ? { at: at + 1 } : {}) }))
  );
  if (at && docs[0]) docs[0].at = at; // one document still holds the seeding moment
  const server = http.createServer((req, res) => {
    const ok = req.headers.authorization === 'Bearer ' + TOKEN;
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { now: 1, docs } : { error: 'wrong token' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('B-311: the seed is the synthetic record, less the collections the app boots without', () => {
  const full = syntheticRecord();
  const want = Object.fromEntries(
    Object.entries(full)
      .filter(([c]) => !LEFT_OUT.includes(c))
      .map(([c, d]) => [c, Object.keys(d).length])
  );
  assert.deepEqual(seedCounts(), want);
  assert.ok(Object.values(want).reduce((a, b) => a + b, 0) > 50);
});

test('B-311: the append seed deletes nothing; the reset seed is the one with a DELETE', () => {
  assert.doesNotMatch(seedSql({ append: true }), /DELETE/i);
  assert.match(seedSql(), /^DELETE FROM docs;\n/);
  const inserts = seedSql({ append: true }).trim().split('\n');
  assert.equal(
    inserts.length,
    Object.values(seedCounts()).reduce((a, b) => a + b, 0)
  );
});

test('B-311: the check is green on a Worker holding the seed, and red on 200 without a token or a missing document', async () => {
  const good = await worker(seedRecord());
  try {
    const lines = await check(good.url, TOKEN);
    assert.deepEqual(
      lines.map(l => l.ok),
      [true, true, true],
      lines.map(l => l.what)
    );
    const reach = await check(good.url, null);
    assert.equal(reach.length, 1);
    assert.ok(reach[0].ok);
  } finally {
    good.close();
  }

  // B-389: the synthetic record is date-relative; a Worker seeded days ago is held to the seed as of that day.
  const then = Date.now() - 3 * 86400000;
  const old = await worker(seedRecord(new Date(then)), then);
  try {
    assert.ok((await check(old.url, TOKEN)).every(l => l.ok));
    assert.equal(seededAt({ docs: [{ at: then + 5 }, { at: then }] }).getTime(), then);
  } finally {
    old.close();
  }
  const stale = await worker(seedRecord(new Date(then)));
  try {
    assert.equal(
      (await check(stale.url, TOKEN)).at(-1).ok,
      false,
      "held to today's seed, it differs: the ids are dated"
    );
  } finally {
    stale.close();
  }

  const short = seedRecord();
  delete short.weakspots[Object.keys(short.weakspots)[0]];
  const bad = await worker(short);
  try {
    const lines = await check(bad.url, TOKEN);
    assert.equal(lines.at(-1).ok, false);
    assert.match(lines.at(-1).what, /weakspots: 1 of the seed's \d+ documents missing/);
  } finally {
    bad.close();
  }

  const open = http.createServer((req, res) => res.end(JSON.stringify({ now: 1, docs: [] })));
  await new Promise(r => open.listen(0, '127.0.0.1', r));
  try {
    const lines = await check(`http://127.0.0.1:${open.address().port}`, TOKEN);
    assert.equal(lines[0].ok, false);
    assert.match(lines[0].what, /answers 200, expected 401/);
  } finally {
    open.close();
  }
});

test('B-389: the record is held to the seed by document; what the seed lacks must come from a known writer', () => {
  const seed = { a: { 1: {}, 2: {} }, b: { 1: {} } };
  const docs = [
    { c: 'a', id: '1', data: {} },
    { c: 'a', id: '2', data: { writer: 'page' } },
    { c: 'b', id: '1', data: {} },
  ];
  const suiteRun = Array.from({ length: SUITE_DOCS_PER_RUN }, (_, i) => ({
    c: SUITE,
    id: 'r1-' + i,
    data: { writer: 'run-api-suite' },
  }));
  const extra = [
    ...suiteRun,
    { c: 'talk', id: 'j', data: { source: APP_SOURCE, writer: 'worker' } },
    { c: 'dayedits', id: '2026-10-25', data: { writer: 'page', source: 'E.V. Home' } },
  ];
  const ok = recordDiffs({ docs: [...docs, ...extra] }, seed);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.seedDocs, 3);
  assert.deepEqual(ok.added, { suite: SUITE_DOCS_PER_RUN, app: 1, page: { dayedits: 1 } });

  // A seed document gone is red, even when another document makes the count up.
  const swapped = recordDiffs({ docs: [docs[0], { c: 'a', id: '3', data: { writer: 'page' } }, docs[2]] }, seed);
  assert.deepEqual(swapped.problems, ["a: 1 of the seed's 2 documents missing (2)"]);
  // A document from no known writer is red, in a seed collection or a new one.
  assert.deepEqual(
    recordDiffs({ docs: [...docs, { c: 'runs', id: 'x', data: { writer: 'morning' } }] }, seed).problems,
    ['runs: 1 documents not in the seed and from no known writer (x)']
  );
  // The suite's collection holds only the suite's documents, in whole runs.
  assert.deepEqual(recordDiffs({ docs: [...docs, ...suiteRun.slice(1)] }, seed).problems, [
    `${SUITE}: ${SUITE_DOCS_PER_RUN - 1} documents, not a whole number of runs of ${SUITE_DOCS_PER_RUN}`,
  ]);
  assert.deepEqual(recordDiffs({ docs: [...docs, { c: SUITE, id: 'p', data: { writer: 'page' } }] }, seed).problems, [
    `${SUITE}: 1 documents not in the seed and from no known writer (p)`,
  ]);
});

test('B-311: the pwa-staging workflow is started by hand, names staging only and never echoes a secret', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pwa-staging.yml'), 'utf8');
  const on = wf.slice(wf.indexOf('\non:'), wf.indexOf('\npermissions:'));
  assert.match(on, /workflow_dispatch/);
  assert.doesNotMatch(on, /push|pull_request|schedule/);
  assert.doesNotMatch(wf.replace(/^#.*$/gm, ''), /\blive\b|ev-demo/i, 'only the staging Worker and D1 are named');
  for (const line of wf.split('\n').filter(l => /\b(echo|printf|cat)\b/.test(l))) {
    // A secret goes to wrangler on stdin only: printf '%s' "$SECRET" | npx wrangler secret put
    if (/\|\s*npx wrangler secret put/.test(line)) continue;
    assert.doesNotMatch(
      line,
      /\$\{?(CLOUDFLARE_API_TOKEN|EV_STAGING_TOKEN|ANTHROPIC_API_KEY_STAGING|EV_TOKEN)\b|secrets\./,
      'prints a secret: ' + line.trim()
    );
  }
  const toml = fs.readFileSync(path.join(ROOT, 'pwa/wrangler.toml'), 'utf8');
  assert.match(toml, /\[env\.staging\]\s+name = "ev-staging"/);
  assert.match(toml, /database_name = "ev-staging"/);
});

test('B-311: the personal-data scan covers pwa/ and finds nothing there', () => {
  const files = listRepoFiles(ROOT).filter(f => f.startsWith('pwa/'));
  assert.ok(files.includes('pwa/seed.mjs') && files.includes('pwa/worker.js'), 'pwa/ is in the scan');
  assert.deepEqual(scanFiles(ROOT, files), []);
});
