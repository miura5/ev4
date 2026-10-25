// The shim (ev-bridge): gives the page the same window.claude.use('db' | 'user' | 'sample' | 'mcp') it has on
// claude.ai, backed by this Worker's /api/db instead. Adapted from test/harness/stub.js.
//   db:     the whole record is loaded once, kept in memory, and checked for changes every 10 s and on focus.
//           A write goes to the Worker first; only when it is saved does the page's copy change.
//   user:   whoever holds the token is the owner (one person).
//   sample: Claude on Haiku through the Worker's /api/claude (D-299); the key stays on the Worker.
//   mcp:    none (the scheduled runs and the Study Watch reader live on claude.ai and the Mac).
//   jobs:   B-324 (D-308): a job runs here at once, through the Worker, instead of waiting on the scheduled worker. The
//           page saves jobs/<id>, then asks to fire the worker; with no mcp that ask comes back mcp_unavailable, and the
//           page records it on the job. For a worker kind the shim records the hand-off as made instead and runs the
//           job (jobs.mjs, the worker's own brief, fold and checks), writing what passes through the run API.
(function () {
  const KEY = 'ev.token';
  const read = () => {
    try {
      return localStorage.getItem(KEY) || '';
    } catch (e) {
      return '';
    }
  };
  let token = read();
  const clone = v => JSON.parse(JSON.stringify(v));
  const api = (path, init = {}) =>
    fetch('/api/' + path, { ...init, headers: { ...(init.headers || {}), authorization: 'Bearer ' + token } });

  // The token form: shown on first open, or when the Worker refuses the token.
  const askToken = msg =>
    new Promise(resolve => {
      const f = document.createElement('form');
      f.id = 'ev-token';
      f.style.cssText =
        'position:fixed;inset:0;z-index:99;display:grid;place-content:center;gap:10px;padding:24px;background:var(--bg,#111);color:var(--text,#eee);font:16px system-ui';
      f.innerHTML =
        '<b>E.V.</b><label>' +
        msg +
        '<br><input type=password autocomplete=current-password style="font:16px system-ui;padding:8px;margin-top:6px;width:16em"></label><button style="font:16px system-ui;padding:8px">Open</button>';
      f.onsubmit = e => {
        e.preventDefault();
        token = f.querySelector('input').value.trim();
        try {
          localStorage.setItem(KEY, token);
        } catch (e) {}
        f.remove();
        resolve();
      };
      const show = () => {
        document.body.appendChild(f);
        f.querySelector('input').focus();
      };
      if (document.body) show();
      else addEventListener('DOMContentLoaded', show);
    });

  const db = {};
  let since = 0;
  const subs = [];
  const emit = c => subs.filter(s => s.c === c).forEach(s => s.fire());
  const take = docs => {
    const changed = new Set();
    for (const d of docs) {
      (db[d.c] = db[d.c] || {})[d.id] = d.data;
      changed.add(d.c);
    }
    return changed;
  };
  async function pull() {
    const r = await api('db?since=' + since);
    if (r.status === 401) return 401;
    if (!r.ok) throw new Error('record unavailable (' + r.status + ')');
    const body = await r.json();
    since = body.now;
    return take(body.docs);
  }
  const ready = (async () => {
    if (!token) await askToken('Your E.V. token');
    for (;;) {
      const got = await pull();
      if (got !== 401) break;
      await askToken('That token was refused. Try again');
    }
    const refresh = () =>
      pull()
        .then(ch => ch instanceof Set && ch.forEach(emit))
        .catch(() => {});
    setInterval(refresh, 10000);
    addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
  })();

  function merge(t, s) {
    for (const k of Object.keys(s)) {
      const v = s[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k]))
        merge(t[k], v);
      else t[k] = clone(v);
    }
    return t;
  }
  async function save(c, id, doc) {
    const job = await jobHandOff(c, doc);
    if (job) doc = job;
    const r = await api('db/' + encodeURIComponent(c) + '/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (!r.ok) {
      const e = new Error('not saved (' + r.status + ')');
      e.code = r.status === 401 ? 'permission_denied' : 'unavailable';
      throw e;
    }
    (db[c] = db[c] || {})[id] = doc;
    emit(c);
    if (job) runAppJob(id);
  }

  // ---- B-324: jobs through the API. jobs-spec.json is what the runner reads of the spec, with the schemas.
  let jobsSpec = null;
  const loadJobsSpec = () =>
    (jobsSpec =
      jobsSpec ||
      fetch('jobs-spec.json').then(r => {
        if (!r.ok) throw new Error('jobs-spec.json answered ' + r.status);
        return r.json();
      }));
  /** The job with its hand-off recorded as made, when the page records that firing the worker found no mcp. */
  async function jobHandOff(c, doc) {
    const f = doc && doc.fired;
    if (c !== 'jobs' || !f || f.ok !== false || f.error !== 'mcp_unavailable') return null;
    const { spec } = await loadJobsSpec().catch(() => ({ spec: null }));
    if (!spec || !(spec.jobs.kinds || {})[doc.kind]) return null; // a builder kind stays as the page wrote it
    return { ...doc, fired: { at: f.at, ok: true } };
  }
  const running = new Set();
  const getJson = async path => {
    const r = await api(path);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(path.split('?')[0] + ' answered ' + r.status);
    return r.json();
  };
  // A document the shim's copy does not hold is written unpinned: if it appeared meanwhile, the batch is refused (409)
  // and the job folds again over the record as it is now.
  const versionOf = async (c, id) => {
    if (!(db[c] && db[c][id])) return null;
    const d = await getJson('run/get?collection=' + encodeURIComponent(c) + '&doc_id=' + encodeURIComponent(id));
    return d ? d.version : null;
  };
  async function runAppJob(id) {
    if (running.has(id)) return;
    running.add(id);
    try {
      const [{ spec, schemas }, J] = await Promise.all([loadJobsSpec(), import('./jobs.mjs')]);
      const fresh = async () => {
        const ch = await pull();
        if (ch instanceof Set) ch.forEach(emit);
        return J.asRunDb(db);
      };
      const meta = document.querySelector('meta[name="ev-release"]');
      await J.runJob({
        db: await fresh(),
        spec,
        schemas,
        jobId: id,
        release: meta ? meta.content : 'v4',
        reload: fresh,
        ask: async body => {
          const r = await api('claude', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!r.ok) throw new Error('the Worker answered ' + r.status);
          return r.json();
        },
        // one job's batch at a time, each pinned just before it is sent, so jobs run side by side but never write
        // over each other's versions
        write: (writes, seen) => (writeLock = writeLock.catch(() => {}).then(() => batch(writes, seen))),
      });
    } catch (e) {
      console.warn('E.V. app: job ' + id + ' stopped: ' + (e && e.message));
    } finally {
      running.delete(id);
    }
  }
  let writeLock = Promise.resolve();
  async function batch(writes, seen) {
    const J = await import('./jobs.mjs');
    const body = JSON.stringify({ writes: await J.pinned(writes, versionOf, seen) });
    const r = await api('run/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (r.status === 409) throw Object.assign(new Error('a document changed'), { conflict: true });
    if (!r.ok) throw new Error('not saved (' + r.status + ')');
    const ch = await pull();
    if (ch instanceof Set) ch.forEach(emit);
  }

  const ops = {
    '==': (a, b) => a === b,
    '>=': (a, b) => a >= b,
    '<=': (a, b) => a <= b,
    '>': (a, b) => a > b,
    '<': (a, b) => a < b,
  };
  function query(c, filters) {
    const rows = () =>
      Object.entries(db[c] || {})
        .filter(([, d]) => filters.every(([f, op, v]) => ops[op](d[f], v)))
        .map(([id, d]) => ({ id, exists: true, data: () => clone(d) }));
    return {
      where: (f, op, v) => query(c, [...filters, [f, op, v]]),
      async get() {
        await ready;
        return { docs: rows() };
      },
      onSnapshot(cb) {
        const s = { c, fire: () => cb({ docs: rows() }) };
        subs.push(s);
        ready.then(s.fire);
        return () => subs.splice(subs.indexOf(s), 1);
      },
      doc: id => {
        const snap = () => {
          const d = (db[c] || {})[id];
          return { id, exists: !!d, data: () => d && clone(d) };
        };
        return {
          set: data => save(c, id, clone(data)),
          async update(data) {
            const cur = (db[c] || {})[id];
            if (!cur) {
              const e = new Error('not found');
              e.code = 'invalid_argument';
              throw e;
            }
            return save(c, id, merge(clone(cur), data));
          },
          async get() {
            await ready;
            return snap();
          },
          onSnapshot(cb) {
            const s = { c, fire: () => cb(snap()) };
            subs.push(s);
            ready.then(s.fire);
            return () => subs.splice(subs.indexOf(s), 1);
          },
        };
      },
      async add(data) {
        const id = 'x' + Math.random().toString(36).slice(2, 10);
        await save(c, id, clone(data));
        return { id };
      },
    };
  }
  const DB = {
    collection: c => query(c, []),
    doc: p => {
      const [c, id] = p.split('/');
      return query(c, []).doc(id);
    },
  };

  // sample: the claude.ai call shape (sample(input, opts), sample.json, sample.limits), answered by Haiku through
  // /api/claude. Every tier is Haiku. Page tools run here, in rounds, as on claude.ai. Images (B-322: the library's
  // page reading) go with the last user turn as base64 image blocks, as limits() says.
  const fail = (code, message, text) => Object.assign({ code, message }, text ? { text } : {});
  const ROUNDS = 6;
  // The Messages API's image limits: these four types, and well under 5 MB each once base64 (a long edge over 1568
  // px is scaled down by the API anyway). Anything else (a phone's HEIC photo, a large scan) is redrawn as a JPEG.
  const IMAGES = {
    maxCount: 4,
    maxInputBytes: 5e6,
    mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  };
  const EDGE = 1568;
  const RAW_MAX = 3.5e6; // bytes before base64 (which adds a third)
  const base64 = async blob => {
    const b = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };
  async function asJpeg(blob) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, EDGE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return await new Promise((ok, no) =>
      c.toBlob(b => (b ? ok(b) : no(new Error('the picture could not be redrawn'))), 'image/jpeg', 0.85)
    );
  }
  async function imageBlock(img) {
    if (!(img instanceof Blob)) throw fail('invalid_request', 'an image must be a Blob or File');
    let b = img;
    if (!IMAGES.mediaTypes.includes(b.type) || b.size > RAW_MAX) {
      try {
        b = await asJpeg(b);
      } catch (e) {
        throw fail('invalid_request', 'that picture could not be read (' + (b.type || 'unknown type') + ')');
      }
      if (b.size > RAW_MAX) throw fail('invalid_request', 'that picture is too large to send');
    }
    return { type: 'image', source: { type: 'base64', media_type: b.type, data: await base64(b) } };
  }
  async function ask(input, opts = {}, wantJson = false) {
    let turns = typeof input === 'string' ? [{ role: 'user', content: input }] : (input || []).map(t => ({ ...t }));
    if (!turns.length || turns[turns.length - 1].role !== 'user')
      throw fail('invalid_request', 'input must end on a user turn');
    const images = opts.images ? [].concat(opts.images) : [];
    if (images.length > IMAGES.maxCount)
      throw fail('invalid_request', 'at most ' + IMAGES.maxCount + ' images in one ask');
    const blocks = await Promise.all(images.map(imageBlock));
    // consecutive turns of one role read as one, as on claude.ai
    turns = turns.reduce((a, t) => {
      const last = a[a.length - 1];
      if (last && last.role === t.role) last.content += '\n\n' + t.content;
      else a.push({ role: t.role, content: String(t.content) });
      return a;
    }, []);
    if (wantJson)
      turns[turns.length - 1].content +=
        '\n\nYour reply is machine-parsed: reply with only the JSON value, no other text and no code fence.';
    // the images go before the words that ask about them, in the last user turn
    if (blocks.length) {
      const last = turns[turns.length - 1];
      last.content = [...blocks, { type: 'text', text: last.content }];
    }
    const tools = (opts.tools || []).map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema || { type: 'object', properties: {} },
    }));
    const messages = turns;
    let text = '';
    let truncated = false;
    for (let round = 0; round < ROUNDS; round++) {
      let r;
      try {
        r = await api('claude', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            messages,
            tools,
            ...(tools.length && round === ROUNDS - 1 ? { tool_choice: { type: 'none' } } : {}),
          }),
          signal: opts.signal,
        });
      } catch (e) {
        throw opts.signal && opts.signal.aborted
          ? fail('cancelled', 'stopped', text)
          : fail('upstream_error', e.message, text);
      }
      if (!r.ok) {
        const why = await r.text().catch(() => '');
        throw fail(
          r.status === 429 ? 'rate_limited' : r.status === 401 ? 'not_granted' : 'upstream_error',
          r.status + ' ' + why.slice(0, 300),
          text
        );
      }
      const res = await r.json();
      if (res.stop_reason === 'refusal') throw fail('refused', 'Claude declined');
      const said = res.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      if (said.trim()) {
        const before = text;
        text = text ? text + '\n\n' + said : said;
        if (opts.onText) opts.onText({ text, delta: text.slice(before.length) });
      }
      truncated = res.stop_reason === 'max_tokens';
      const uses = res.content.filter(b => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length) break;
      messages.push({ role: 'assistant', content: res.content });
      const results = await Promise.all(
        uses.map(async u => {
          const t = opts.tools.find(x => x.name === u.name);
          try {
            if (!t) throw new Error('no tool ' + u.name);
            const out = await t.execute(u.input || {}, { signal: opts.signal || new AbortController().signal });
            return {
              type: 'tool_result',
              tool_use_id: u.id,
              content: typeof out === 'string' ? out : JSON.stringify(out ?? null),
            };
          } catch (e) {
            return { type: 'tool_result', tool_use_id: u.id, content: 'Error: ' + e.message, is_error: true };
          }
        })
      );
      messages.push({ role: 'user', content: results });
    }
    if (!text.trim()) throw fail('empty_completion', 'Claude wrote nothing');
    return { text, truncated, modelTierApplied: opts.modelTier || 'default' };
  }
  const parseJson = raw => {
    const tries = [raw, (raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1]];
    const a = raw.search(/[[{]/),
      b = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
    if (a >= 0 && b > a) tries.push(raw.slice(a, b + 1));
    for (const t of tries)
      if (t != null)
        try {
          return JSON.parse(t);
        } catch (e) {}
    throw fail('invalid_json', 'no JSON in the reply', raw);
  };
  const sample = Object.assign((input, opts) => ask(input, opts), {
    json: async (input, opts = {}) => {
      // on tool calls only the final round's text is parsed, as on claude.ai
      let last = '';
      const res = await ask(input, { ...opts, onText: u => ((last = u.delta), opts.onText && opts.onText(u)) }, true);
      if (res.truncated) throw fail('invalid_json', 'cut short', res.text);
      return parseJson((opts.tools ? last : res.text).trim());
    },
    limits: async () => ({
      maxPromptBytes: 262144,
      maxInputBytes: 262144,
      tools: { maxCount: 16 },
      images: { ...IMAGES, mediaTypes: [...IMAGES.mediaTypes] },
    }),
  });

  window.claude = {
    use: async n => {
      if (n === 'db') return ready.then(() => DB);
      if (n === 'user') return { isOwner: async () => true };
      if (n === 'sample') return sample;
      return null;
    },
  };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
