// In-memory stand-in for claude.use('db' | 'user' | 'sample' | 'mcp') so the page can be driven by Playwright.
// Ported from v3 (ev-core test/harness/stub.js); v4 adds window.__queries (every collection query the page subscribes
// with its filters) and the reader's v2 tools.
// sample(): runs window.__chatScript ([{tool, input}]) through the page's own tools, then replies window.__chatReply.
// mcp.callTool(): records the call in window.__mcpCalls; window.__mcpFail = '<code>' makes it reject with that code.
// update() merges nested objects like the real store; set() replaces; where() filters in memory.
(function () {
  const db = window.__db || {};
  window.__writes = [];
  const subs = [];
  const clone = v => JSON.parse(JSON.stringify(v));
  function merge(t, s) {
    for (const k of Object.keys(s)) {
      const v = s[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k]))
        merge(t[k], v);
      else t[k] = clone(v);
    }
    return t;
  }
  const ops = {
    '==': (a, b) => a === b,
    '>=': (a, b) => a >= b,
    '<=': (a, b) => a <= b,
    '>': (a, b) => a > b,
    '<': (a, b) => a < b,
  };
  function emit(c) {
    subs.filter(s => s.c === c).forEach(s => s.fire());
  }
  function query(c, filters) {
    return {
      where: (f, op, v) => query(c, [...filters, [f, op, v]]),
      async get() {
        window.__gets = (window.__gets || 0) + 1;
        const rows = Object.entries(db[c] || {}).filter(([, d]) => filters.every(([f, op, v]) => ops[op](d[f], v)));
        return { docs: rows.map(([id, d]) => ({ id, exists: true, data: () => clone(d) })) };
      },
      onSnapshot(cb, err) {
        (window.__queries = window.__queries || []).push([c, filters.map(f => f.slice())]);
        const s = {
          c,
          fire: () => {
            const rows = Object.entries(db[c] || {}).filter(([, d]) => filters.every(([f, op, v]) => ops[op](d[f], v)));
            cb({ docs: rows.map(([id, d]) => ({ id, exists: true, data: () => clone(d) })) });
          },
        };
        subs.push(s);
        setTimeout(s.fire, 0);
        return () => {};
      },
      doc: id => ({
        async set(data) {
          (db[c] = db[c] || {})[id] = clone(data);
          window.__writes.push(['set', c, id, clone(data)]);
          emit(c);
        },
        async update(data) {
          const col = (db[c] = db[c] || {});
          if (!col[id]) {
            const e = new Error('not found');
            e.code = 'invalid_argument';
            throw e;
          }
          merge(col[id], data);
          window.__writes.push(['update', c, id, clone(data)]);
          emit(c);
        },
        async get() {
          const d = (db[c] || {})[id];
          return { id, exists: !!d, data: () => d && clone(d) };
        },
        onSnapshot(cb) {
          const s = {
            c,
            fire: () => {
              const d = (db[c] || {})[id];
              cb({ id, exists: !!d, data: () => d && clone(d) });
            },
          };
          subs.push(s);
          setTimeout(s.fire, 0);
          return () => {};
        },
      }),
      async add(data) {
        const id = 'x' + Math.random().toString(36).slice(2, 10);
        (db[c] = db[c] || {})[id] = clone(data);
        window.__writes.push(['add', c, id, clone(data)]);
        emit(c);
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
  window.__sampleCalls = 0;
  window.__chatCalls = [];
  window.__toolResults = [];
  window.__mcpCalls = [];
  const chatFn = async (input, opts = {}) => {
    window.__chatCalls.push({ input, tier: opts.modelTier, tools: (opts.tools || []).map(t => t.name) });
    if (window.__chatFail) {
      const e = new Error('stub');
      e.code = window.__chatFail;
      throw e;
    }
    // window.__chatPre: text written in the first round, before the tools run. Like the platform, every round's text
    // comes back joined by a blank line, both on onText and in the result.
    const pre = window.__chatPre || '';
    if (pre && opts.onText) opts.onText({ text: pre, delta: pre });
    for (const step of opts.tools ? window.__chatScript || [] : []) {
      // a call without tools (the running summary) runs no script
      const t = (opts.tools || []).find(x => x.name === step.tool);
      try {
        window.__toolResults.push(
          t
            ? await t.execute(step.input || {}, { signal: new AbortController().signal })
            : 'Error: no tool ' + step.tool
        );
      } catch (e) {
        window.__toolResults.push('Error: ' + e.message);
      }
    }
    const reply = window.__chatReply || 'Logged.';
    const text = pre ? pre + '\n\n' + reply : reply;
    if (opts.onText) opts.onText({ text, delta: text.slice(pre.length) });
    return { text, truncated: false, modelTierApplied: opts.modelTier || 'default' };
  };
  const sample = Object.assign(chatFn, {
    json: async (p, o) => {
      window.__sampleCalls++;
      window.__lastPrompt = p;
      window.__jsonCalls = (window.__jsonCalls || []).concat([
        { prompt: p, tier: o && o.modelTier, images: o && o.images ? [].concat(o.images).length : 0 },
      ]);
      if (window.__sampleFn) return window.__sampleFn(p);
      return window.__sampleReply || { items: [] };
    },
    limits: async () => ({
      maxInputBytes: 262144,
      ...(window.__noTools ? {} : { tools: { maxCount: 16 } }),
      ...(window.__noImages
        ? {}
        : {
            images: {
              maxCount: 4,
              maxInputBytes: 5e6,
              mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
            },
          }),
    }),
  });
  // host:* servers stand in for local connectors on Matt's Mac (the Study Watch reader): window.__readerNote is what
  // latest_note returns; window.__readerFail = '<code>' makes every reader call reject with that code.
  const mcp = {
    callTool: async (server, tool, input) => {
      window.__mcpCalls.push([server, tool, input]);
      if (String(server).startsWith('host:')) {
        if (window.__readerFail) {
          const e = new Error('stub');
          e.code = window.__readerFail;
          throw e;
        }
        const r =
          tool === 'status'
            ? {
                reader: '0.2.0',
                folderFound: true,
                context: { found: true },
                latestNote: { found: !!window.__readerNote },
              }
            : tool === 'list_sessions'
              ? window.__readerSessions || { sessions: [] }
              : tool === 'read_session'
                ? (window.__readerSession || {})[input && input.id] || { found: false }
                : window.__readerNote || { found: false };
        return { content: [], payload: clone(r) };
      }
      if (window.__mcpFail) {
        const e = new Error('stub');
        e.code = window.__mcpFail;
        throw e;
      }
      return { content: [], payload: { ok: true } };
    },
  };
  window.claude = {
    use: async n =>
      n === 'db'
        ? DB
        : n === 'user'
          ? { isOwner: async () => !window.__notOwner }
          : n === 'sample'
            ? window.__noSample
              ? null
              : sample
            : n === 'mcp'
              ? window.__noMcp
                ? null
                : mcp
              : null,
  };
})();
