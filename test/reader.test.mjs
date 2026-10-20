// Study Watch reader v2 (studywatch/reader, B-20): a read-only MCP server over stdio. All fixtures here are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const SRC = new URL('../studywatch/reader/server/index.mjs', import.meta.url);

/** Copies the server to a path with spaces (like the Claude Extensions folder) and talks to it over stdio. */
function startReader(folder) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ev reader '));
  const dir = path.join(home, 'Claude Extensions', 'ev-study-watch-reader', 'server');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(SRC, path.join(dir, 'index.mjs'));
  const proc = spawn(process.execPath, [path.join(dir, 'index.mjs')], {
    env: { ...process.env, EV_STUDY_WATCH_DIR: folder },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const waiting = new Map();
  let next = 1;
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', c => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      const w = waiting.get(m.id);
      if (w) {
        waiting.delete(m.id);
        w(m);
      }
    }
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = next++;
      const t = setTimeout(() => reject(new Error('timeout ' + method)), 5000);
      waiting.set(id, m => {
        clearTimeout(t);
        resolve(m);
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const call = async (name, args) => {
    const m = await rpc('tools/call', { name, arguments: args || {} });
    return m.result;
  };
  return { rpc, call, stop: () => proc.kill() };
}
function makeFolder() {
  const f = fs.mkdtempSync(path.join(os.tmpdir(), 'E.V. Study Watch '));
  fs.mkdirSync(path.join(f, 'live'));
  return f;
}
const writeLatest = (f, note, extra = {}) =>
  fs.writeFileSync(
    path.join(f, 'live', 'latest.json'),
    JSON.stringify({ schema: 1, appVersion: '0.4', writtenAt: '2026-10-17T20:00:00Z', note, ...extra })
  );
const sample = {
  id: 'x-coredata://note/p1',
  name: 'Fluids and electrolytes',
  folder: '2026/2026 Fall/NUR 112/Week 9',
  modifiedAt: '2026-10-17T19:58:00Z',
  text: 'Isotonic: 0.9% NaCl. Hypotonic shifts water into cells.',
};

test('reader: handshake, four read-only tools, no write tools', async () => {
  const r = startReader(makeFolder());
  try {
    const init = await r.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'ev-study-watch-reader');
    const old = await r.rpc('initialize', { protocolVersion: '1999-01-01' });
    assert.equal(old.result.protocolVersion, '2025-06-18');
    const list = await r.rpc('tools/list', {});
    assert.deepEqual(
      list.result.tools.map(t => t.name),
      ['status', 'latest_note', 'list_sessions', 'read_session']
    );
    assert.equal(init.result.serverInfo.version, '0.2.0');
    for (const t of list.result.tools) {
      assert.equal(t.annotations.readOnlyHint, true);
      assert.equal(t.annotations.destructiveHint, false);
    }
    assert.equal((await r.rpc('ping')).result && true, true);
    assert.equal((await r.rpc('resources/list')).error.code, -32601);
  } finally {
    r.stop();
  }
});

test('reader: status reports context.json and the latest note without its text', async () => {
  const f = makeFolder();
  fs.writeFileSync(
    path.join(f, 'context.json'),
    JSON.stringify({ updatedAt: '2026-10-17T06:22:50Z', nextExam: { id: 'E4' }, objectives: [], activeWeakSpots: [] })
  );
  writeLatest(f, sample);
  const r = startReader(f);
  try {
    const s = (await r.call('status')).structuredContent;
    assert.equal(s.folderFound, true);
    assert.deepEqual(s.context, { found: true, updatedAt: '2026-10-17T06:22:50Z', nextExam: 'E4' });
    assert.equal(s.latestNote.name, 'Fluids and electrolytes');
    assert.ok(!JSON.stringify(s).includes('Isotonic'));
  } finally {
    r.stop();
  }
});

test('reader: latest_note returns text, then unchanged, and refuses graded or private folders', async () => {
  const f = makeFolder();
  const r = startReader(f);
  try {
    assert.equal((await r.call('latest_note')).structuredContent.found, false);
    writeLatest(f, sample);
    const one = (await r.call('latest_note')).structuredContent;
    assert.equal(one.note.text, sample.text);
    assert.equal(one.note.truncated, false);
    const same = (await r.call('latest_note', { sinceModifiedAt: '2026-10-17T19:58:00Z' })).structuredContent;
    assert.equal(same.unchanged, true);
    assert.equal(same.note.text, undefined);
    writeLatest(f, { ...sample, text: 'Care plan #graded draft' });
    const g = (await r.call('latest_note')).structuredContent;
    assert.equal(g.graded, true);
    assert.equal(g.note.text, undefined);
    for (const folder of ['2026/Journal/NUR 112', '2026/2026 Fall/personal', '2026/2026 Fall/E.V.', '2026/Fitness']) {
      writeLatest(f, { ...sample, folder });
      const x = (await r.call('latest_note')).structuredContent;
      assert.equal(x.found, false, folder);
      assert.equal(x.refused, true, folder);
      assert.equal((await r.call('status')).structuredContent.latestNote.name, null, folder);
    }
  } finally {
    r.stop();
  }
});

test('reader: reads nothing outside the two files and refuses symlinks', async () => {
  const f = makeFolder();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
  fs.writeFileSync(path.join(outside, 'latest.json'), JSON.stringify({ note: sample }));
  fs.symlinkSync(path.join(outside, 'latest.json'), path.join(f, 'live', 'latest.json'));
  const r = startReader(f);
  try {
    assert.equal((await r.call('latest_note')).structuredContent.found, false);
    const bad = await r.call('read_file', { path: '/etc/passwd' });
    assert.equal(bad.isError, true);
    const missing = startReader(path.join(f, 'nope'));
    try {
      assert.equal((await missing.call('latest_note')).isError, true);
      assert.equal((await missing.call('status')).structuredContent.folderFound, false);
    } finally {
      missing.stop();
    }
  } finally {
    r.stop();
  }
});

// ---------------------------------------------------------------- v2: session files (B-20)
const sessionFile = (extra = {}) => ({
  id: '2026-10-17-1930-Fluids-and-electrolytes',
  date: '2026-10-17',
  startedAt: '2026-10-18T00:30:00Z',
  endedAt: '2026-10-18T01:05:00Z',
  note: 'Fluids and electrolytes',
  minutes: 32,
  checks: 4,
  questions: 9,
  endedBy: 'ended',
  summary: 'Worked through isotonic and hypotonic fluids.',
  weakSpots: [{ objective: 'E9-3', topic: 'Hypotonic shifts' }, 'Third spacing'],
  connections: ['Sodium follows water'],
  noteTodos: ['Fill in the hypertonic row'],
  cards: [
    { term: 'Isotonic', definition: '0.9% NaCl' },
    { term: 'Hypotonic', definition: '0.45% NaCl' },
  ],
  cardsFile: '/Users/someone/Documents/E.V. Study Watch/cards/x.tsv',
  source: 'Study Watch',
  appVersion: '0.4',
  ...extra,
});
function writeSession(f, id, data, mtime) {
  fs.mkdirSync(path.join(f, 'sessions'), { recursive: true });
  const p = path.join(f, 'sessions', id + '.json');
  fs.writeFileSync(p, JSON.stringify(data));
  if (mtime) fs.utimesSync(p, new Date(mtime), new Date(mtime));
  return p;
}

test('reader v2: list_sessions lists session files with size and hash, newest first, and filters by time', async () => {
  const f = makeFolder();
  const r = startReader(f);
  try {
    assert.deepEqual(
      (await r.call('list_sessions')).structuredContent,
      { sessions: [], count: 0, more: false },
      'no sessions folder yet'
    );
    const a = writeSession(
      f,
      '2026-10-16-2000-Bones',
      sessionFile({ id: '2026-10-16-2000-Bones', note: 'Bones' }),
      '2026-10-17T02:00:00Z'
    );
    writeSession(f, '2026-10-17-1930-Fluids-and-electrolytes', sessionFile(), '2026-10-18T01:06:00Z');
    fs.writeFileSync(path.join(f, 'sessions', 'notes.txt'), 'not a session');
    fs.writeFileSync(path.join(f, 'sessions', 'draft.json'), '{}');
    const list = (await r.call('list_sessions')).structuredContent;
    assert.deepEqual(
      list.sessions.map(s => s.id),
      ['2026-10-17-1930-Fluids-and-electrolytes', '2026-10-16-2000-Bones']
    );
    assert.equal(list.count, 2);
    const bones = list.sessions[1];
    assert.equal(bones.bytes, fs.statSync(a).size);
    assert.equal(bones.sha256, crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex'));
    assert.equal(bones.modifiedAt, '2026-10-17T02:00:00.000Z');
    assert.deepEqual(Object.keys(bones).sort(), ['bytes', 'id', 'modifiedAt', 'sha256'], 'no contents, no paths');
    const since = (await r.call('list_sessions', { sinceModifiedAt: '2026-10-17T12:00:00Z' })).structuredContent;
    assert.deepEqual(
      since.sessions.map(s => s.id),
      ['2026-10-17-1930-Fluids-and-electrolytes']
    );
    assert.equal((await r.call('list_sessions', { sinceModifiedAt: 'yesterday' })).isError, true);
    assert.deepEqual((await r.call('status')).structuredContent.sessions, {
      count: 2,
      latestModifiedAt: '2026-10-18T01:06:00.000Z',
    });
  } finally {
    r.stop();
  }
});

test('reader v2: read_session returns the findings E.V. files, never the cards, paths or anything else in the file', async () => {
  const f = makeFolder();
  writeSession(
    f,
    '2026-10-17-1930-Fluids-and-electrolytes',
    sessionFile({ noteText: 'the whole note text', secret: 'x' })
  );
  const r = startReader(f);
  try {
    const s = (await r.call('read_session', { id: '2026-10-17-1930-Fluids-and-electrolytes' })).structuredContent;
    assert.equal(s.found, true);
    assert.deepEqual(
      Object.keys(s).sort(),
      [
        'appVersion',
        'bytes',
        'cardCount',
        'checks',
        'connections',
        'date',
        'endedAt',
        'endedBy',
        'found',
        'id',
        'minutes',
        'modifiedAt',
        'note',
        'noteTodos',
        'questions',
        'sha256',
        'source',
        'startedAt',
        'summary',
        'weakSpots',
      ].sort()
    );
    assert.deepEqual(s.weakSpots, [
      { objective: 'E9-3', topic: 'Hypotonic shifts' },
      { objective: '', topic: 'Third spacing' },
    ]);
    assert.equal(s.cardCount, 2);
    const raw = JSON.stringify(s);
    for (const leak of ['the whole note text', '0.9% NaCl', '/Users/', 'secret']) assert.ok(!raw.includes(leak), leak);
    assert.deepEqual((await r.call('read_session', { id: '2026-10-17-0000-Missing' })).structuredContent, {
      found: false,
      id: '2026-10-17-0000-Missing',
    });
  } finally {
    r.stop();
  }
});

test('reader v2: graded sessions come back empty; bad ids, traversal and symlinked files are refused', async () => {
  const f = makeFolder();
  writeSession(
    f,
    '2026-10-17-1000-Care-plan',
    sessionFile({ id: '2026-10-17-1000-Care-plan', note: 'Care plan #graded', summary: 'Worked on the care plan' })
  );
  writeSession(f, '2026-10-17-1100-Flagged', sessionFile({ graded: true }));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
  fs.writeFileSync(path.join(outside, 'x.json'), JSON.stringify(sessionFile()));
  fs.symlinkSync(path.join(outside, 'x.json'), path.join(f, 'sessions', '2026-10-17-1200-Linked.json'));
  const r = startReader(f);
  try {
    for (const id of ['2026-10-17-1000-Care-plan', '2026-10-17-1100-Flagged']) {
      const g = (await r.call('read_session', { id })).structuredContent;
      assert.equal(g.graded, true, id);
      assert.equal(g.summary, undefined, id);
      assert.equal(g.weakSpots, undefined, id);
    }
    assert.ok(
      !(await r.call('list_sessions')).structuredContent.sessions.some(s => s.id.includes('Linked')),
      'a symlink is not listed'
    );
    assert.equal((await r.call('read_session', { id: '2026-10-17-1200-Linked' })).structuredContent.found, false);
    for (const id of [
      '../context',
      '2026-10-17-1000-Care-plan/../../x',
      'context',
      '',
      '2026-10-17-1000-' + 'x'.repeat(41),
    ])
      assert.equal((await r.call('read_session', { id })).isError, true, id);
    // a symlinked sessions folder is not read at all
    const f2 = makeFolder();
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'real-sessions-'));
    fs.writeFileSync(path.join(real, '2026-10-17-1930-Fluids-and-electrolytes.json'), JSON.stringify(sessionFile()));
    fs.symlinkSync(real, path.join(f2, 'sessions'));
    const r2 = startReader(f2);
    try {
      assert.equal((await r2.call('list_sessions')).structuredContent.count, 0);
    } finally {
      r2.stop();
    }
  } finally {
    r.stop();
  }
});

test('reader v2: the manifest names all four tools at the same version as the server', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../studywatch/reader/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    m.tools.map(t => t.name),
    ['status', 'latest_note', 'list_sessions', 'read_session']
  );
  assert.match(fs.readFileSync(SRC, 'utf8'), new RegExp(`const VERSION = '${m.version.replace(/\./g, '\\.')}'`));
});
