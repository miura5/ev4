// B-398: the Worker stores every document in one canonical JSON form (pwa/runapi.js canonicalJson), page saves
// included, so a Mac backup (core/d1backup.mjs dumpD1, which re-serialises what the run API reads) and the R2 export
// (pwa/backup.js exportToR2, which keeps D1's text) hash the same. The real Worker runs in a child process
// (test/pwa-worker-server.mjs) over an in-memory SQLite and a stand-in bucket, since dumpD1 calls curl synchronously.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as D1B from '../core/d1backup.mjs';
import { manifestOf } from '../pwa/backup.js';
import { canonicalJson, finiteJson, checkWrites } from '../pwa/runapi.js';
import { ROOT } from './helpers.mjs';

const TOKEN = 'canonical-suite-token-' + 'Qx7'.repeat(6);
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';

async function serve() {
  const child = spawn(process.execPath, [path.join(ROOT, 'test/pwa-worker-server.mjs'), TOKEN], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise((resolve, reject) => {
    child.stdout.on('data', d => {
      const m = /port (\d+)/.exec(String(d));
      if (m) resolve(Number(m[1]));
    });
    child.on('exit', c => reject(new Error('the Worker server exited ' + c)));
  });
  const url = `http://127.0.0.1:${port}`;
  const call = async (method, route, body) => {
    const r = await fetch(url + route, {
      method,
      headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
      ...(body !== undefined ? { body } : {}),
    });
    return { status: r.status, body: await r.json() };
  };
  return { child, url, call, rows: async () => (await fetch(url + '/_rows')).json() };
}

// What a page (or anything on the page path) might send: the same data in texts that differ from the canonical one.
const PAGE_SAVES = [
  ['notes', 'pretty', '{\n  "title": "Cardiac output",\n  "tags": [ "BIO 201", "exam 2" ],\n  "done": false\n}'],
  ['notes', 'escaped', '{"text":"caf\\u00e9 \\u2014 \\/ok","n":1.0,"big":1e2,"neg":-0.50}'],
  ['notes', 'int keys', '{"b":1,"a":{"10":"x","2":"y","z":null},"1":true}'],
  ['days', '2026-10-26', '{ "schema" : 2 , "items" : [ { "id" : "i1" , "done" : true } ] }\n'],
  ['libindex', 'NUR 112', '\t{"files":[],"at":"2026-10-26T12:00:00Z"}  '],
];

test('B-398: canonicalJson keeps the data and gives the text a read gives back', () => {
  for (const [, , text] of PAGE_SAVES) {
    const { text: canon } = canonicalJson(text);
    assert.deepEqual(JSON.parse(canon), JSON.parse(text), 'the same data');
    assert.equal(JSON.stringify(JSON.parse(canon)), canon, 'a fixpoint: a read and re-serialise gives it back');
    assert.equal(canonicalJson(canon).text, canon, 'canonicalising twice changes nothing');
  }
  assert.equal(canonicalJson('{"a": 1').error, 'the body is not JSON');
  assert.match(canonicalJson('{"a": 1e400}').error, /too large/);
  assert.equal(finiteJson({ a: [1, { b: 2.5 }], c: 'Infinity' }), true);
  assert.equal(finiteJson({ a: [1, { b: Infinity }] }), false);
  const wall = checkWrites([{ op: 'set', collection: 'notes', doc_id: 'x', data: { a: -Infinity } }]);
  assert.equal(wall.status, 400);
  assert.match(wall.error, /too large/);
});

test("B-398: non-canonical page saves leave the Mac backup's manifest equal to exportToR2's", async () => {
  const w = await serve();
  try {
    for (const [c, id, text] of PAGE_SAVES) {
      const r = await w.call('PUT', `/api/db/${encodeURIComponent(c)}/${encodeURIComponent(id)}`, text);
      assert.equal(r.status, 200, `${c}/${id}: ${JSON.stringify(r.body)}`);
    }
    // a later page save of one of them, at the version it read, in yet another spacing
    const again = await w.call(
      'PUT',
      '/api/db/notes/pretty?if_version=1',
      '{ "done" : true,\n "title" : "Cardiac output" }'
    );
    assert.equal(again.status, 200, JSON.stringify(again.body));
    // a run's batch write, beside the page's saves
    const b = await w.call(
      'POST',
      '/api/run/batch',
      JSON.stringify({ writes: [{ op: 'set', collection: 'notes', doc_id: 'run', data: { z: 1, a: [2, 3] } }] })
    );
    assert.equal(b.status, 200, JSON.stringify(b.body));

    // Stored canonical, and the data as sent.
    const rows = await w.rows();
    const want = new Map(PAGE_SAVES.map(([c, id, text]) => [c + '\n' + id, JSON.parse(text)]));
    want.set('notes\npretty', { done: true, title: 'Cardiac output' });
    want.set('notes\nrun', { z: 1, a: [2, 3] });
    assert.equal(rows.length, want.size);
    for (const r of rows) {
      assert.equal(r.data, JSON.stringify(JSON.parse(r.data)), `${r.c}/${r.id} is stored canonical`);
      assert.deepEqual(JSON.parse(r.data), want.get(r.c + '\n' + r.id), `${r.c}/${r.id} keeps its data`);
    }

    // The Mac backup (evening-mac's pull of D1 through the run API) and the R2 export of the same D1.
    const dump = D1B.dumpD1({ url: w.url, token: TOKEN });
    assert.equal(dump.ok, true, dump.error);
    const mac = D1B.backupOf(dump.rows, { at: '2026-10-26T12:00:00Z', label: 'test', release: 'v4' });
    assert.deepEqual(D1B.backupProblems(mac), []);
    const exp = await w.call('POST', '/api/backup/export');
    assert.equal(exp.status, 200, JSON.stringify(exp.body));
    assert.deepEqual(mac.collections, exp.body.collections, "the Mac backup's manifest is exportToR2's");
    assert.deepEqual(Object.keys(exp.body.collections), ['days', 'libindex', 'notes']);

    // The proof can fail: the texts as sent (what D1 held before B-398) hash differently from the Mac backup.
    const asSent = PAGE_SAVES.map(([c, id, data]) => ({ c, id, data }));
    const macOfSent = D1B.manifestSync(asSent.map(r => ({ ...r, data: JSON.stringify(JSON.parse(r.data)) })));
    assert.notDeepEqual(await manifestOf(asSent), macOfSent);
  } finally {
    w.child.kill();
  }
});

test('B-398: a page save holding a number JSON cannot hold is refused, and nothing is written', async () => {
  const w = await serve();
  try {
    const r = await w.call('PUT', '/api/db/notes/huge', '{"n": 1e400}');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /too large/);
    const b = await w.call(
      'POST',
      '/api/run/batch',
      '{"writes":[{"op":"set","collection":"notes","doc_id":"huge","data":{"n":-1e999}}]}'
    );
    assert.equal(b.status, 400);
    assert.deepEqual(await w.rows(), []);
  } finally {
    w.child.kill();
  }
});
