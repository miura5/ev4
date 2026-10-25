// B-315: a run's calls to the Worker's run API (pwa/runapi.js), in place of ArtifactData's, for a record whose runs
// target the Worker (spec.registry.records.<record>.runs). The Worker's address and token come from the file the
// run's one ArtifactData get of system/worker saved (D-320); the token goes to curl on stdin, inside its config, so it
// is never in a command line, a printed line, a reply file or a log. curl, not fetch: it follows the session's proxy.
// What a command prints is counts, ids, versions and the Worker's own error words, never a document or the token.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 1));
};

/** {url, token} from the saved system/worker document; an error names what is wrong, never the value. */
export function readWorker(file) {
  let w;
  try {
    w = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`no Worker file at ${file}: get system/worker with out_dir first (${e.code || 'not JSON'})`);
  }
  if (!w || !/^https?:\/\/[^\s"\\]+$/.test(w.url || '')) throw new Error(`${file}: no Worker url`);
  if (typeof w.token !== 'string' || !/^[\x21-\x7e]{16,}$/.test(w.token) || /["\\]/.test(w.token))
    throw new Error(`${file}: no usable token`);
  return { url: w.url.replace(/\/+$/, ''), token: w.token };
}

const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/** The same account's other Worker (B-317: the drill's scratch D1): the url's first host label replaced. */
export function onHost(worker, host) {
  if (!host) return worker;
  if (!/^[a-z0-9-]{1,63}$/.test(host)) throw new Error('--host: one host label');
  const u = new URL(worker.url);
  u.hostname = [host, ...u.hostname.split('.').slice(1)].join('.');
  return { ...worker, url: u.origin };
}

/** B-397: curl's exit for a refused connection: nothing was sent, so it is the one failure tried again. */
export const CONNECT_REFUSED = 7;
export const RETRIES = 2;
const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** B-397: whether a write's reply leaves its outcome unknown: no reply after the request may have been sent (a timeout,
 *  a dropped connection), or 408, 429 or a 5xx, after which the Worker may have written it. A GET is never a write. */
export const outcomeUnknown = (method, status, curlExit = null) =>
  method !== 'GET' &&
  ((status === 0 && curlExit !== CONNECT_REFUSED) || status === 408 || status === 429 || status >= 500);

/** One request to the Worker. {status, body, unknown?, curlExit?}: the reply parsed as JSON (or {error: text} when it is
 *  not). route is under /api/run/, or a full /api/... path. B-397: a refused connection (curl exit 7) sent nothing and
 *  is tried again, RETRIES times, retryDelayMs apart; nothing else is ever retried (a timeout or a 5xx may follow a
 *  write that landed), and for a write that ends that way `unknown` is true. */
export function request(
  worker,
  { method = 'GET', route, params = {}, body = null, timeout = 90, retryDelayMs = 1000 }
) {
  // B-319: each value encoded with encodeURIComponent (an id may hold a space or any letter); the Worker decodes it.
  const query = Object.entries(params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
    .join('&');
  const u = new URL(
    worker.url + (route.startsWith('/api/') ? route : '/api/run/' + route) + (query ? '?' + query : '')
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-runapi-'));
  try {
    const conf = [
      `url = ${q(u.href)}`,
      `request = ${method}`,
      `header = ${q('authorization: Bearer ' + worker.token)}`,
    ];
    if (body != null) {
      const f = path.join(tmp, 'body.json');
      fs.writeFileSync(f, JSON.stringify(body));
      conf.push(`header = "content-type: application/json"`, `data-binary = ${q('@' + f)}`);
    }
    const reply = path.join(tmp, 'reply');
    for (let attempt = 0; ; attempt++) {
      try {
        const out = execFileSync(
          'curl',
          ['-sS', '--max-time', String(timeout), '-K', '-', '-o', reply, '-w', '%{http_code}'],
          {
            input: conf.join('\n') + '\n',
            stdio: ['pipe', 'pipe', 'pipe'],
          }
        );
        const status = Number(String(out).trim());
        const text = fs.existsSync(reply) ? fs.readFileSync(reply, 'utf8') : '';
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { error: text.slice(0, 300) || 'no reply' };
        }
        return { status, body: parsed, ...(outcomeUnknown(method, status) ? { unknown: true } : {}) };
      } catch (e) {
        if (e.status === CONNECT_REFUSED && attempt < RETRIES) {
          sleepSync(retryDelayMs);
          continue;
        }
        // curl's own error (no route, a timeout): its stderr names the host, never the token (that went on stdin).
        const said = String((e.stderr && String(e.stderr)) || e.message)
          .trim()
          .split('\n')[0];
        const curlExit = Number.isInteger(e.status) ? e.status : null;
        return {
          status: 0,
          curlExit,
          body: { error: said.replace(worker.token, '<token>') },
          ...(outcomeUnknown(method, 0, curlExit) ? { unknown: true } : {}),
        };
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Every document of a collection, page by page, saved as ArtifactData's out_dir saves them (<outDir>/<collection>/<id>.json,
 * the data alone) and their versions to `versions` ({id: version}). With `since`, only documents whose `at` is at or
 * after it are saved (ArtifactData's query of a window); every version is kept, so a write to an older one is pinned.
 */
export function list(worker, { collection, outDir, versions, since = null }) {
  const v = {};
  let saved = 0,
    cursor = null,
    pages = 0;
  do {
    const r = request(worker, { route: 'list', params: { collection, limit: 1000, cursor } });
    if (r.status !== 200) return { ok: false, status: r.status, error: r.body.error || 'refused' };
    for (const d of r.body.documents || []) {
      v[d.id] = d.version;
      if (since && !(typeof (d.data || {}).at === 'string' && d.data.at >= since)) continue;
      writeJson(path.join(outDir, collection, d.id + '.json'), d.data);
      saved++;
    }
    cursor = r.body.next_cursor || null;
    pages++;
  } while (cursor && pages < 100);
  writeJson(versions, v);
  return { ok: true, saved, versions: Object.keys(v).length };
}

/** A batch file's writes as the Worker takes them: an entry's file_path read into data at send time, as ArtifactData does. */
export function resolveWrites(writes) {
  return writes.map(({ file_path, ...w }) => ({
    ...w,
    ...(file_path ? { data: JSON.parse(fs.readFileSync(file_path, 'utf8')) } : {}),
  }));
}

/** B-397: what a batch whose outcome is unknown says: it may have landed, so the run reads again before writing. */
export const UNKNOWN_OUTCOME =
  'the outcome is unknown: the batch may have been written; re-pull the documents it names before writing again';

/** One all-or-nothing batch. {ok, results}, or {ok: false, status, error, entry?, current_version?} when the Worker
 *  refused it (nothing written), or {ok: false, unknown: true, status, error} when no answer says either way (B-397). */
export function batch(worker, writes, opts = {}) {
  const r = request(worker, { method: 'POST', route: 'batch', body: { writes: resolveWrites(writes) }, ...opts });
  if (r.status === 200 && r.body.ok) return { ok: true, results: r.body.results };
  const { error, entry, current_version } = r.body || {};
  if (r.unknown)
    return { ok: false, unknown: true, status: r.status, error: `${UNKNOWN_OUTCOME} (${error || 'no reply'})` };
  return { ok: false, status: r.status, error: error || 'refused', entry, current_version };
}

/** B-317: every document under a drill's prefix in the scratch D1, as rows [{c, id, data}] (data JSON.stringify of
 *  what the Worker returns, as D1 holds it), for the collections in `want`. {ok, rows} or {ok: false, ...}. */
export function readBack(worker, prefix, collections) {
  const rows = [];
  for (const c of collections) {
    let cursor = null;
    do {
      const r = request(worker, { route: 'list', params: { collection: `${prefix}/${c}`, limit: 1000, cursor } });
      if (r.status !== 200) return { ok: false, status: r.status, error: r.body.error || 'refused', collection: c };
      for (const d of r.body.documents || []) rows.push({ c, id: d.id, data: JSON.stringify(d.data) });
      cursor = r.body.next_cursor || null;
    } while (cursor);
  }
  return { ok: true, rows };
}

/** B-317: the newest R2 export (B-316), its body saved to `out`. {ok, key} or {ok: false, status, error}. */
export function newestExport(worker, out) {
  const n = request(worker, { route: '/api/backup/newest' });
  if (n.status !== 200 || !n.body.key) return { ok: false, status: n.status, error: n.body.error || 'no export yet' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-export-'));
  try {
    const u = new URL(worker.url + '/api/backup/get');
    u.searchParams.set('key', n.body.key);
    const conf = [`url = ${q(u.href)}`, `header = ${q('authorization: Bearer ' + worker.token)}`];
    const code = String(
      execFileSync('curl', ['-sS', '--max-time', '120', '-K', '-', '-o', path.join(tmp, 'x'), '-w', '%{http_code}'], {
        input: conf.join('\n') + '\n',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    ).trim();
    if (code !== '200') return { ok: false, status: Number(code), error: 'the export could not be read' };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(path.join(tmp, 'x'), out);
    return { ok: true, key: n.body.key };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
