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

/** One request to the Worker. {status, body}: the reply parsed as JSON (or {error: text} when it is not). */
export function request(worker, { method = 'GET', route, params = {}, body = null, timeout = 90 }) {
  const u = new URL(worker.url + '/api/run/' + route);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
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
    const out = execFileSync(
      'curl',
      ['-sS', '--max-time', String(timeout), '-K', '-', '-o', path.join(tmp, 'reply'), '-w', '%{http_code}'],
      { input: conf.join('\n') + '\n', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const status = Number(String(out).trim());
    const text = fs.existsSync(path.join(tmp, 'reply')) ? fs.readFileSync(path.join(tmp, 'reply'), 'utf8') : '';
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: text.slice(0, 300) || 'no reply' };
    }
    return { status, body: parsed };
  } catch (e) {
    // curl's own error (no route, a timeout): its stderr names the host, never the token (that went on stdin).
    const said = String((e.stderr && String(e.stderr)) || e.message)
      .trim()
      .split('\n')[0];
    return { status: 0, body: { error: said.replace(worker.token, '<token>') } };
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

/** One all-or-nothing batch. {ok, results} or {ok: false, status, error, entry?, current_version?}. */
export function batch(worker, writes) {
  const r = request(worker, { method: 'POST', route: 'batch', body: { writes: resolveWrites(writes) } });
  if (r.status === 200 && r.body.ok) return { ok: true, results: r.body.results };
  const { error, entry, current_version } = r.body || {};
  return { ok: false, status: r.status, error: error || 'refused', entry, current_version };
}
