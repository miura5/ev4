// B-178 (D-195, D-196, D-203): the builder's trace. trace --job prints exactly three calls (its job's result, one talk
// line as E.V. with the job card, system/yourturn), composed and checked by core/actions.mjs act with the builder's
// actor, and names them in dist/trace-ok for the live-guard (test/hooks.test.mjs). ship writes system/yourturn too.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { copyRepo } from './helpers.mjs';
import * as C from '../tools/chart.mjs';
import { loadValidator } from '../core/schemas.mjs';

const validate = loadValidator();
const NOW = '2026-10-22T01:30:00.000Z'; // 8:30pm Central, Oct 21
const JOB = 'job-20261021-233000-the-timer';
const opts = (extra = {}) => ({
  job: JOB,
  record: 'live',
  status: 'done',
  note: 'B-190 (your "the timer sat at 0:00") is built and green on staging at abc1234; say ship it when you want it live.',
  task: 'B-190',
  commit: 'abc1234',
  release: 'v4.4.0+3',
  ...extra,
});

test('B-178: trace prints exactly three calls, each a trace-row write, and names them in dist/trace-ok', () => {
  const dir = copyRepo();
  const t = C.traceCalls(dir, opts({ version: 'talk=7,yourturn=2' }), { now: NOW });
  assert.deepEqual(
    t.calls.map(c => [c.action, c.collection, c.doc_id, c.if_version || null]),
    [
      ['set', 'jobresults', JOB, null],
      ['update', 'talk', '2026-10-21', 7],
      ['set', 'system', 'yourturn', 2],
    ]
  );
  const read = c => JSON.parse(fs.readFileSync(c.file_path, 'utf8'));
  const [result, talk, yourturn] = t.calls.map(read);
  // The result: the builder's, at schema 2, with the task and the staging commit; its message key is the talk line's.
  assert.deepEqual(
    [result.schema, result.writer, result.status, result.release, result.result.task, result.result.commit],
    [2, 'builder', 'done', 'v4.4.0+3', 'B-190', 'abc1234']
  );
  assert.ok(
    validate('jobresults', result, { id: JOB }).ok,
    JSON.stringify(validate('jobresults', result, { id: JOB }))
  );
  const [key] = Object.keys(talk.messages);
  assert.equal(result.message, key);
  assert.deepEqual(talk.messages[key].cards, [{ type: 'job', id: JOB }]);
  assert.equal(talk.messages[key].role, 'ev');
  assert.match(key, /^m-20261022-013000000-job$/);
  // system/yourturn: the Chart's Your turn by place, valid as its own document.
  assert.ok(
    validate('system', yourturn, { id: 'yourturn' }).ok,
    JSON.stringify(validate('system', yourturn, { id: 'yourturn' }).errors)
  );
  assert.equal(yourturn.writer, 'deploy');
  // dist/trace-ok names exactly the three, for the live record.
  const ok = JSON.parse(fs.readFileSync(path.join(dir, 'dist', 'trace-ok'), 'utf8'));
  assert.deepEqual(
    [ok.record, ok.at, ok.calls],
    ['live', Date.parse(NOW), t.calls.map(c => ({ action: c.action, collection: c.collection, doc_id: c.doc_id }))]
  );
  // The first message of the day creates talk/<date> as the builder's document, at schema 3.
  const fresh = C.traceCalls(dir, opts({ version: 'talk=0,yourturn=0' }), { now: NOW });
  const day = JSON.parse(fs.readFileSync(fresh.calls[1].file_path, 'utf8'));
  assert.deepEqual(
    [fresh.calls[1].action, fresh.calls[1].if_version, day.schema, day.writer],
    ['set', undefined, 3, 'builder']
  );
  assert.ok(
    validate('talk', day, { id: '2026-10-21' }).ok,
    JSON.stringify(validate('talk', day, { id: '2026-10-21' }))
  );
  assert.equal(fresh.calls[2].if_version, undefined, 'a yourturn that does not exist yet is created');
});

test('B-178: trace asks for the reads it needs, and refuses what the trace row refuses', () => {
  const dir = copyRepo();
  // No version known for talk/<date> or system/yourturn: it prints the two reads and nothing else.
  const r = C.traceCalls(dir, opts(), { now: NOW, jsonl: '' });
  assert.deepEqual(
    r.reads.map(x => [x.action, x.collection, x.doc_id]),
    [
      ['get', 'talk', '2026-10-21'],
      ['get', 'system', 'yourturn'],
    ]
  );
  assert.ok(!fs.existsSync(path.join(dir, 'dist', 'trace-ok')), 'no allowance before the calls exist');
  // A version read in the session is used; a read that found no document is 0.
  const url = r.reads[0].url;
  const got = (i, input, text) =>
    [
      JSON.stringify({ message: { content: [{ type: 'tool_use', id: 'g' + i, name: 'ArtifactData', input }] } }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'g' + i, content: [{ type: 'text', text }] }] },
      }),
    ].join('\n');
  const jsonl = [
    got(1, r.reads[0], '1 document from collection "talk" saved: - "2026-10-21"  900 bytes  version 4'),
    got(2, r.reads[1], 'No document "yourturn" in collection "system".'),
  ].join('\n');
  assert.equal(C.docVersionFrom(jsonl, url, 'talk', '2026-10-21'), 4);
  assert.equal(C.docVersionFrom(jsonl, url, 'system', 'yourturn'), 0);
  const t = C.traceCalls(dir, opts(), { now: NOW, jsonl });
  assert.deepEqual(
    t.calls.map(c => c.if_version || null),
    [null, 4, null]
  );
  // What the row refuses, trace refuses: a text over 1,500 characters, a job id that is not one, a bad status.
  assert.throws(
    () => C.traceCalls(dir, opts({ version: 'talk=0,yourturn=0', job: 'not a job' }), { now: NOW }),
    /do not fit/
  );
  assert.throws(() => C.traceCalls(dir, opts({ status: 'maybe' }), { now: NOW }), /--status done\|failed/);
  assert.throws(() => C.traceCalls(dir, opts({ record: 'prod' }), { now: NOW }), /--record staging\|live/);
  const long = C.traceCalls(dir, opts({ version: 'talk=0,yourturn=0', note: 'x'.repeat(2000) }), { now: NOW });
  assert.equal(JSON.parse(fs.readFileSync(long.calls[0].file_path, 'utf8')).result.text.length, 1500);
});

test('B-178 (D-196): system/yourturn is the Chart’s Your turn: each waiting task by place with its ask', () => {
  const rec = {
    tasks: [
      {
        id: 'B-1',
        title: 'Mac thing',
        status: 'blocked',
        waitingOn: 'Matt',
        waitingWhere: 'mac',
        notes: 'Built. Approve its folder access in the desktop app.',
      },
      { id: 'B-2', title: 'A choice: one or two', status: 'open', waitingOn: 'Matt', notes: '' },
      { id: 'B-3', title: 'Not waiting', status: 'open', notes: 'x.' },
      { id: 'B-4', title: 'Done', status: 'done', waitingOn: 'Matt', notes: 'x.' },
    ],
  };
  const d = C.yourTurnDoc(rec, { at: NOW, commit: 'abc1234', source: 'test' });
  assert.deepEqual(d.groups, [
    {
      place: 'mac',
      label: 'At the Mac',
      tasks: [{ id: 'B-1', ask: 'Approve its folder access in the desktop app.', status: 'blocked' }],
    },
    {
      place: 'decision',
      label: 'A decision (a reply in a build chat)',
      tasks: [{ id: 'B-2', ask: 'A choice', status: 'open' }],
    },
  ]);
  assert.ok(
    validate('system', d, { id: 'yourturn' }).ok,
    JSON.stringify(validate('system', d, { id: 'yourturn' }).errors)
  );
});

test('B-178 (D-196): ship writes system/yourturn in its system batch, and asks for its version first', async () => {
  const { build } = await import('../tools/build.mjs');
  const { deployCalls } = await import('../core/deploy.mjs');
  const crypto = await import('node:crypto');
  const dir = copyRepo({ push: true });
  await build({ root: dir, now: NOW });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'dist', 'manifest.json'), 'utf8'));
  const yourturn = {
    op: 'set',
    collection: 'system',
    doc_id: 'yourturn',
    file_path: '/x/yourturn.json',
    if_version: 5,
  };
  const r = deployCalls({
    manifest,
    target: 'staging',
    distDir: path.join(dir, 'dist'),
    build: { pushed: true },
    versions: { manifest: 1, spec: 1, environments: 1 },
    sha256: s => crypto.createHash('sha256').update(s).digest('hex'),
    extraWrites: [yourturn],
  });
  const batch = r.calls.find(c => c.step === 'system documents').args.writes;
  assert.deepEqual(
    batch.map(w => w.doc_id),
    ['manifest', 'spec', 'environments', 'yourturn']
  );
  assert.deepEqual(batch.at(-1), yourturn);
  // ship itself: with no read of system/yourturn in the session, it prints the read and stops before any call.
  const { execFileSync } = await import('node:child_process');
  let out = '';
  try {
    out = execFileSync(
      'node',
      [path.join(dir, 'tools', 'chart.mjs'), 'ship', 'staging', '--root', dir, '--transcript', '/dev/null'],
      {
        encoding: 'utf8',
      }
    );
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
  }
  assert.match(out, /read system\/yourturn first|reads to make|versions of/, out.slice(0, 400));
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'dist', 'system', 'yourturn.json'), 'utf8'));
  assert.ok(
    validate('system', doc, { id: 'yourturn' }).ok,
    JSON.stringify(validate('system', doc, { id: 'yourturn' }))
  );
});
