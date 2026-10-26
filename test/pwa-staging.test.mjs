// B-311: the app's staging pair. The check the pwa-staging workflow runs against the staging Worker, proved here
// against a stand-in Worker; the workflow's own limits (started by hand, staging only, no secret echoed); the seed's
// append form deletes nothing; and the personal-data scan covers pwa/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, recordDiffs, seededAt, keyOk, keyPattern, ROLES, RUNNING_MAX_MS } from '../tools/pwa-staging.mjs';
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

// A day's edits as the page saves them (spec/schemas/dayedits.schema.json).
const DAYEDIT = {
  schema: 1,
  writer: 'page',
  at: '2026-10-25T18:31:19.275Z',
  source: 'E.V. Home',
  updatedAt: '2026-10-25T18:31:19.275Z',
  date: '2026-10-25',
  checks: {},
  added: {},
  skipped: {},
};

test('B-389: a page save is held to the spec, not only its writer field: a page collection, its id shape, its schema', () => {
  const seed = { a: { 1: {} } };
  const base = [{ c: 'a', id: '1', data: {} }];
  const red = docs => recordDiffs({ docs: [...base, ...docs] }, seed).problems;
  assert.deepEqual(red([{ c: 'dayedits', id: '2026-10-25', data: DAYEDIT }]), []);
  assert.equal(red([{ c: 'dayedits', id: 'not-a-date', data: DAYEDIT }]).length, 1, 'an id off the YYYY-MM-DD shape');
  assert.equal(red([{ c: 'dayedits', id: '2026-10-25', data: { writer: 'page' } }]).length, 1, 'fails its schema');
  assert.equal(red([{ c: 'weeks', id: '2026-10-25', data: { ...DAYEDIT } }]).length, 1, 'not a page collection');
  assert.equal(red([{ c: 'nowhere', id: 'x', data: { writer: 'page' } }]).length, 1, 'not in the spec');
  // the shapes, from spec.collections.<c>.key; and a document the schema names on its own (talk/memory)
  for (const [c, id, ok] of [
    ['weakspots', 'ws-2026-10-25-E4-7-fluids', true],
    ['weakspots', 'ws-fluids', false],
    ['sets', 'review-2026-10-25', true],
    ['sets', 'review-today', false],
    ['exams', 'E4', true],
    ['exams', 'EX', false],
    ['exams', 'ATI-fundamentals', true],
    ['workouts', 'wo-20261025-101010-1', true],
    ['workouts', 'wo-2026-1', false],
    ['jobs', 'job-20261025-101010-study-guide', true],
    ['idchecks', 'abc-matt', true],
    ['talk', 'memory', true],
    ['talk', 'notes', false],
  ])
    assert.equal(keyOk(c, id), ok, `${c}/${id}`);
  assert.equal(keyPattern('job sets'), null);
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
    { c: 'dayedits', id: '2026-10-25', data: DAYEDIT },
  ];
  const ok = recordDiffs({ docs: [...docs, ...extra] }, seed);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.seedDocs, 3);
  assert.deepEqual(ok.added, { suite: SUITE_DOCS_PER_RUN, app: 1, page: { dayedits: 1 }, runs: {} });

  // A seed document gone is red, even when another document makes the count up.
  const swapped = recordDiffs({ docs: [docs[0], { c: 'a', id: '3', data: { source: APP_SOURCE } }, docs[2]] }, seed);
  assert.deepEqual(swapped.problems, ["a: 1 of the seed's 2 documents missing (2)"]);
  // A document from no known writer is red, in a seed collection or a new one.
  assert.deepEqual(
    recordDiffs({ docs: [...docs, { c: 'runs', id: 'x', data: { writer: 'morning' } }] }, seed).problems,
    ['runs: 1 documents not in the seed and from no known writer (x; writer / source: morning / undefined)']
  );
  // The suite's collection holds only the suite's documents, in whole runs.
  assert.deepEqual(recordDiffs({ docs: [...docs, ...suiteRun.slice(1)] }, seed).problems, [
    `${SUITE}: ${SUITE_DOCS_PER_RUN - 1} documents, not a whole number of runs of ${SUITE_DOCS_PER_RUN}`,
  ]);
  assert.deepEqual(recordDiffs({ docs: [...docs, { c: SUITE, id: 'p', data: { writer: 'page' } }] }, seed).problems, [
    `${SUITE}: 1 documents not in the seed and from no known writer (p; writer / source: page / undefined)`,
  ]);
});

test('B-389: a scheduled run on staging is a known writer only where the spec lets it write and traced to its run', () => {
  const seed = { a: { 1: {} } };
  const base = [{ c: 'a', id: '1', data: {} }];
  const run = (w, id) => ({ c: 'runs', id, data: { writer: w, source: w + ' run' } });
  const by = (c, id, w, runId) => ({ c, id, data: { writer: w, source: `${w} ${runId}` } });
  const traced = [
    run('morning', 'morning-1'),
    by('days', '2026-10-25', 'morning', 'morning-1'),
    run('worker', 'worker-2'),
    by('jobresults', 'job-x', 'worker', 'worker-2'),
  ];
  const ok = recordDiffs({ docs: [...base, ...traced] }, seed);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.added.runs, { morning: 2, worker: 2 });
  const red = docs => recordDiffs({ docs: [...base, ...docs] }, seed).problems;
  // its source names a run the record does not hold, or a run of another pipeline
  assert.equal(red([by('days', 'd', 'morning', 'morning-9')]).length, 1);
  assert.equal(red([run('worker', 'worker-2'), by('days', 'd', 'morning', 'worker-2')]).length, 1);
  // a writer the spec does not allow in that collection: weekly in days, the page in days
  assert.equal(red([run('weekly', 'weekly-3'), by('days', 'd', 'weekly', 'weekly-3')]).length, 1);
  assert.equal(red([{ c: 'days', id: 'd', data: { writer: 'page' } }]).length, 1);
  // a run document whose id is not its pipeline's, or a pipeline that does not run against staging
  assert.equal(red([run('morning', 'worker-4')]).length, 1);
  assert.equal(red([run('diagnostic', 'diagnostic-5')]).length, 1); // B-317: evening-mac runs on the staging Worker now
});

// A staging evening-mac run as its runs/<id> document holds it once ended (core/run.mjs start and end), and the
// documents its Canvas step writes as canvas-sync (core/canvas-rules.mjs: source "Canvas sync", `at` the run's now).
const EVENING = 'evening-mac-20261025-223200-a1b2';
const eveningRun = (over = {}) => ({
  c: 'runs',
  id: EVENING,
  data: {
    schema: 1,
    writer: 'evening-mac',
    at: '2026-10-25T22:32:00.000Z',
    source: 'evening-mac run',
    release: 'v4.0.0',
    pipeline: 'evening-mac',
    startedAt: '2026-10-25T22:32:00.000Z',
    endedAt: '2026-10-25T22:57:00.000Z',
    status: 'ok',
    steps: [
      { id: 'canvas', status: 'ok', detail: 'Canvas: 13 new and 0 changed dates' },
      { id: 'note', status: 'ok' },
      { id: 'mac-files', status: 'skipped' },
    ],
    ...over,
  },
});
const canvas = (c, id, over = {}) => ({
  c,
  id,
  data: { schema: 1, writer: 'canvas-sync', at: '2026-10-25T22:40:11.000Z', source: 'Canvas sync', ...over },
});

test('B-389: a staging pipeline writing as one of its roles (evening-mac as canvas-sync) is traced to its run', () => {
  assert.deepEqual(ROLES['canvas-sync'], [{ pipeline: 'evening-mac', step: 'canvas' }], 'from spec.pipelines roles');
  const seed = { a: { 1: {} } };
  const base = [{ c: 'a', id: '1', data: {} }];
  const synced = [
    canvas('announcements', 'canvas-101'),
    canvas('dates', 'canvas-202'),
    canvas('materials', 'NUR112-303'),
    canvas('dates', 'canvas-204', { source: 'evening-mac ' + EVENING, at: 'not a time' }),
  ];
  const ok = recordDiffs({ docs: [...base, eveningRun(), ...synced] }, seed);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.added.runs, { 'evening-mac': 1, 'canvas-sync': 4 });
  // a run still going: from its start
  const going = eveningRun({ endedAt: null, status: 'running', steps: undefined });
  assert.deepEqual(recordDiffs({ docs: [...base, going, ...synced] }, seed).problems, []);

  const red = docs => recordDiffs({ docs: [...base, ...docs] }, seed).problems;
  // no run of evening-mac in the record, or one of another pipeline
  assert.equal(red([canvas('dates', 'canvas-202')]).length, 1);
  assert.match(red([canvas('dates', 'canvas-202')])[0], /writer \/ source: canvas-sync \/ Canvas sync/);
  const morning = {
    c: 'runs',
    id: 'morning-1',
    data: { ...eveningRun().data, writer: 'morning', pipeline: 'morning' },
  };
  assert.equal(red([morning, canvas('dates', 'canvas-202')]).length, 1);
  // written outside the run's window, or by a run whose Canvas step did not end ok
  assert.equal(red([eveningRun(), canvas('dates', 'canvas-202', { at: '2026-10-25T23:30:00.000Z' })]).length, 1);
  assert.equal(red([eveningRun(), canvas('dates', 'canvas-202', { at: '2026-10-25T22:00:00.000Z' })]).length, 1);
  const skipped = eveningRun({ steps: [{ id: 'canvas', status: 'skipped' }] });
  assert.equal(red([skipped, canvas('dates', 'canvas-202')]).length, 1);
  assert.equal(red([eveningRun({ status: 'failed', steps: [] }), canvas('dates', 'canvas-202')]).length, 1);
  // a run whose Canvas step failed
  assert.equal(
    red([eveningRun({ steps: [{ id: 'canvas', status: 'failed' }] }), canvas('dates', 'canvas-202')]).length,
    1
  );
  // a run that never ended opens a window of RUNNING_MAX_MS from its start, no longer
  const stale = eveningRun({ endedAt: null, status: 'running', steps: undefined });
  const late = new Date(Date.parse('2026-10-25T22:32:00.000Z') + RUNNING_MAX_MS + 60000).toISOString();
  assert.equal(red([stale, canvas('dates', 'canvas-202', { at: late })]).length, 1);
  // the Worker's row time must fall in the window too, not only the document's own `at`
  const rowLate = { ...canvas('dates', 'canvas-202'), at: Date.parse('2026-10-28T10:00:00.000Z') };
  assert.equal(red([eveningRun(), rowLate]).length, 1);
  const rowIn = { ...canvas('dates', 'canvas-202'), at: Date.parse('2026-10-25T22:41:00.000Z') };
  assert.deepEqual(red([eveningRun(), rowIn]), []);
  // a source naming a run the record does not hold
  assert.equal(red([canvas('dates', 'canvas-9', { source: 'evening-mac evening-mac-x', at: 'no' })]).length, 1);
  // the spec's allowlist: canvas-sync never writes days or sets; a role no staging pipeline has is no writer
  assert.equal(red([eveningRun(), canvas('days', '2026-10-25')]).length, 1);
  assert.equal(red([eveningRun(), canvas('sets', 'review-2026-10-25')]).length, 1);
  assert.equal(red([eveningRun(), canvas('sessions', 'ss-1', { writer: 'filing' })]).length, 1);
  assert.equal(red([eveningRun(), canvas('dates', 'canvas-202', { writer: 'deploy' })]).length, 1);
});

// The rows `node pwa/seed.mjs --append` writes, read back as GET /api/db answers them.
function seededRows(at) {
  return seedSql({ append: true, at })
    .trim()
    .split('\n')
    .map(l => {
      const [, c, id, data, t] = l.match(
        /^INSERT INTO docs \(c, id, data, at\) VALUES \('(.*?)', '(.*?)', '(.*)', (\d+)\);$/
      );
      const un = x => x.replace(/''/g, "'");
      return { c: un(c), id: un(id), data: JSON.parse(un(data)), at: Number(t), v: 1 };
    });
}
async function stand(docs) {
  const server = http.createServer((req, res) => {
    const ok = req.headers.authorization === 'Bearer ' + TOKEN;
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { now: 1, docs } : { error: 'wrong token' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
// The clock moved to `now` for fn: Date.now() and new Date() with no argument.
async function at(now, fn) {
  const Real = Date;
  class Fake extends Real {
    constructor(...a) {
      super(...(a.length ? a : [now]));
    }
    static now() {
      return now;
    }
  }
  globalThis.Date = Fake;
  try {
    return await fn();
  } finally {
    globalThis.Date = Real;
  }
}

test('B-389: the date-relative seed is matched by the instant its rows carry, whatever the date is now', async () => {
  // Seeded at 04:30Z on Oct 25, still Oct 24 in Central; checked days later, on either side of midnight in both zones.
  const T = Date.parse('2026-10-25T04:30:00.000Z');
  const rows = seededRows(T);
  assert.ok(rows.every(r => r.at === T));
  assert.deepEqual(
    rows.filter(r => r.c === 'runs').map(r => r.id),
    Object.keys(seedRecord(new Date(T)).runs),
    'the seed rows are the record of their own instant'
  );
  const later = [
    eveningRun(),
    // the Worker stamps their rows inside the run's window (22:32 to 22:57Z), as it does for a real run's writes
    { ...canvas('announcements', 'canvas-101'), at: Date.parse('2026-10-25T22:40:11.000Z') },
    { ...canvas('materials', 'NUR112-303'), at: Date.parse('2026-10-25T22:40:12.000Z') },
  ];
  const w = await stand([...rows.map(r => (r.c === 'dates' ? { ...r, at: T + 864e5 } : r)), ...later]);
  try {
    for (const now of [
      '2026-10-25T04:30:01Z',
      '2026-10-26T00:10:00Z',
      '2026-10-26T05:10:00Z',
      '2026-11-03T12:00:00Z',
    ]) {
      const lines = await at(Date.parse(now), () => check(w.url, TOKEN));
      assert.ok(
        lines.every(l => l.ok),
        `checked at ${now}: ` + lines.map(l => l.what).join(' | ')
      );
      assert.match(lines.at(-1).what, /the seed as of 2026-10-25T04:30:00\.000Z/);
    }
  } finally {
    w.close();
  }
  // Held to the seed of another day it is red, both ways: a dated seed document missing, and one not in that seed.
  const other = recordDiffs({ docs: [...rows, ...later] }, seedRecord(new Date(T + 864e5))).problems;
  assert.ok(other.some(p => /documents missing/.test(p)) && other.some(p => /from no known writer/.test(p)), other);
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
