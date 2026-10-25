// B-397: the run API client (core/runapi-client.mjs) tries again only after a refused connection (curl exit 7), when
// nothing was sent. A timeout, a 408, a 429 or a 5xx is never retried, since a batch may have landed before it, and a
// write that ends that way reports its outcome as unknown, never as refused. Proved against a stand-in server in a child
// process that counts the requests it was sent (the client's curl blocks this process while it runs).
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import * as API from '../core/runapi-client.mjs';

process.env.NO_PROXY = process.env.no_proxy = '127.0.0.1';
const TOKEN = 'planted-client-token-' + 'q4Z7'.repeat(6);

// mode: a status to answer with, or "hang" (never answers); listens on `port` after `delayMs`.
const SERVER = `
const http = require('node:http');
const [mode, port, delayMs] = process.argv.slice(1);
let hits = 0;
const s = http.createServer((req, res) => {
  if (req.url === '/_hits') return res.end(String(hits));
  hits++;
  req.resume();
  if (mode === 'hang') return;
  res.writeHead(Number(mode), { 'content-type': 'application/json' });
  res.end(JSON.stringify(Number(mode) === 200 ? { ok: true, results: [] , documents: [] } : { error: 'stand-in ' + mode }));
});
setTimeout(() => s.listen(Number(port), '127.0.0.1', () => console.log('up')), Number(delayMs));
`;

const freePort = () =>
  new Promise(ok => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

async function stand(mode, { delayMs = 0, wait = true } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['-e', SERVER, mode, String(port), String(delayMs)], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (wait) await new Promise(ok => child.stdout.once('data', ok));
  const url = `http://127.0.0.1:${port}`;
  const hits = () => Number(execFileSync('curl', ['-sS', '--noproxy', '*', url + '/_hits'], { encoding: 'utf8' }));
  return { worker: { url, token: TOKEN }, child, hits };
}
const writes = [{ op: 'set', collection: 'talk', doc_id: 'x', data: { a: 1 } }];

for (const status of [500, 502, 503, 408, 429]) {
  test(`a batch answered ${status} is sent once and its outcome is unknown, not refused`, async t => {
    const s = await stand(String(status));
    t.after(() => s.child.kill());
    const r = API.batch(s.worker, writes, { retryDelayMs: 50 });
    assert.equal(s.hits(), 1, 'never retried');
    assert.equal(r.ok, false);
    assert.equal(r.unknown, true);
    assert.equal(r.status, status);
    assert.match(r.error, /^the outcome is unknown: the batch may have been written; re-pull/);
    assert.doesNotMatch(r.error, /refused/);
    assert.ok(!r.error.includes(TOKEN));
  });
}

test('a batch that times out is sent once and its outcome is unknown', async t => {
  const s = await stand('hang');
  t.after(() => s.child.kill());
  const r = API.batch(s.worker, writes, { timeout: 1, retryDelayMs: 50 });
  assert.equal(s.hits(), 1, 'never retried');
  assert.equal(r.unknown, true);
  assert.equal(r.status, 0);
  assert.match(r.error, /outcome is unknown/);
});

test('a refused connection is tried again, and the request then goes through once', async t => {
  const s = await stand('200', { delayMs: 400, wait: false });
  t.after(() => s.child.kill());
  const t0 = Date.now();
  const r = API.batch(s.worker, writes, { retryDelayMs: 800 });
  assert.ok(Date.now() - t0 >= 800, 'the first try was refused and the client waited to try again');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(s.hits(), 1, 'the refused tries sent nothing; the one that connected was sent once');
});

test('a connection refused every time is not unknown: nothing was sent', async () => {
  const port = await freePort();
  const r = API.batch({ url: `http://127.0.0.1:${port}`, token: TOKEN }, writes, { retryDelayMs: 50 });
  assert.equal(r.ok, false);
  assert.equal(r.unknown, undefined);
  assert.equal(r.status, 0);
});

test('a refusal the Worker gives (409) is refused, not unknown; a GET is never unknown or retried', async t => {
  const s = await stand('409');
  t.after(() => s.child.kill());
  const r = API.batch(s.worker, writes, { retryDelayMs: 50 });
  assert.equal(r.unknown, undefined);
  assert.equal(r.status, 409);
  const g = await stand('503');
  t.after(() => g.child.kill());
  const l = API.request(g.worker, { route: 'list', params: { collection: 'talk' }, retryDelayMs: 50 });
  assert.equal(l.status, 503);
  assert.equal(l.unknown, undefined);
  assert.equal(g.hits(), 1);
  assert.equal(API.outcomeUnknown('GET', 0, 28), false);
  assert.equal(API.outcomeUnknown('POST', 0, 28), true);
  assert.equal(API.outcomeUnknown('POST', 0, API.CONNECT_REFUSED), false);
});
