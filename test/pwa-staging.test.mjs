// B-311: the app's staging pair. The check the pwa-staging workflow runs against the staging Worker, proved here
// against a stand-in Worker; the workflow's own limits (started by hand, staging only, no secret echoed); the seed's
// append form deletes nothing; and the personal-data scan covers pwa/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, countsOf, countDiffs } from '../tools/pwa-staging.mjs';
import { seedCounts, seedRecord, seedSql, LEFT_OUT } from '../pwa/seed.mjs';
import { scanFiles, listRepoFiles } from '../tools/personal-data.mjs';
import { syntheticRecord } from './data/synthetic.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'test-token-not-a-secret';

// A stand-in for the Worker's /api/db: 401 without the token, else the documents it holds.
async function worker(record) {
  const docs = Object.entries(record).flatMap(([c, d]) => Object.entries(d).map(([id, data]) => ({ c, id, data })));
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

  const short = seedRecord();
  delete short.weakspots[Object.keys(short.weakspots)[0]];
  const bad = await worker(short);
  try {
    const lines = await check(bad.url, TOKEN);
    assert.equal(lines.at(-1).ok, false);
    assert.match(lines.at(-1).what, /weakspots: \d+ in the Worker, \d+ in the seed/);
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

test('B-311: counts and their differences', () => {
  assert.deepEqual(
    countsOf({
      docs: [
        { c: 'a', id: '1' },
        { c: 'a', id: '2' },
        { c: 'b', id: '1' },
      ],
    }),
    { a: 2, b: 1 }
  );
  assert.deepEqual(countDiffs({ a: 2, b: 1 }, { a: 2, b: 1 }), []);
  assert.deepEqual(countDiffs({ a: 2, x: 1 }, { a: 3 }), [
    'a: 2 in the Worker, 3 in the seed',
    'x: 1 in the Worker, 0 in the seed',
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
