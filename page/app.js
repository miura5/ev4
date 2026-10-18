// E.V. Home page logic (published beside the shell as app.js). The shell loads it after core.js and spec.json, checks
// the owner and hands it the record as it arrives; this file owns everything the page shows and does.
// B-15: the frame only (tabs, status, the opening greeting, the System versions). The conversation, the tabs' cards
// and the tools arrive with B-16 and B-17, ported from v3's page onto this interface.
//   EVApp.boot({spec, db, use, record, say}) -> {changed(key, value), lost(key, error)}
//   key: a collection name (value: its rows in the window) or '<collection>/<doc>' (value: that document or null).
(function () {
  'use strict';
  const VERSION = 'v4.0.0';
  const E = window.EVCore;

  function boot({ spec, db, use, record, say }) {
    E.configure(spec);
    const $ = id => document.getElementById(id);
    const expected = new Set(spec.ui.page.subscribe.map(s => s.doc ? s.collection + '/' + s.doc : s.collection));
    const loaded = new Set();
    let tab = null; let queued = false; let broken = null;

    // ---------------------------------------------------------------- tabs (the conversation is the front door)
    function showTab(t) {
      if (!$('p-' + t)) t = 'ev';
      tab = t;
      for (const p of document.querySelectorAll('section.panel')) p.hidden = p.id !== 'p-' + t;
      for (const b of document.querySelectorAll('.dock .tab')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
      const sys = $('tab-system'); if (sys) sys.setAttribute('aria-current', String(t === 'system'));
      render();
    }
    for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));
    const brand = $('brand'); if (brand) brand.addEventListener('click', () => showTab('ev'));
    showTab((location.hash || '').slice(1) || 'ev');

    // ---------------------------------------------------------------- record
    function changed(key, value) {
      if (key.includes('/')) { const [c, id] = key.split('/'); (record.docs = record.docs || {})[c + '/' + id] = value; }
      else record[key] = value;
      loaded.add(key); render();
    }
    function lost(key, e) { broken = (e && (e.code || e.message)) || 'error'; say('Lost the connection to your record (' + broken + '). Reload to retry.'); }

    // ---------------------------------------------------------------- render: only the open tab
    function render() {
      if (queued) return; queued = true;
      requestAnimationFrame(() => { queued = false; try { draw(); } catch (e) { say('Something on this page broke: ' + e.message); console.error(e); } });
    }
    const ready = () => [...expected].every(k => loaded.has(k));
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    function draw() {
      if (broken) return;
      const readout = $('readout');
      if (!ready()) { say('Reading your record…'); return; }
      const docs = Object.keys(record).filter(k => k !== 'docs').reduce((n, k) => n + (record[k] || []).length, 0);
      say('');
      if (readout) readout.innerHTML = '<span class="led"></span>EV-04 · ' + (spec.target === 'staging' ? 'staging' : 'online');
      if (tab === 'ev') drawEv();
      if (tab === 'system') drawSystem(docs);
    }
    let greeted = false;
    function drawEv() {
      if (greeted) return; greeted = true; // the greeting is computed on each open, never stored
      const thread = $('thread'); thread.textContent = '';
      const now = new Date(); const g = E.greeting({ now, date: E.chicagoDate(now) });
      const msg = el('div', 'msg ev'); for (const line of g.lines) msg.appendChild(el('p', null, line));
      thread.appendChild(msg);
    }
    function drawSystem(docs) {
      const v = $('versions'); if (!v) return;
      v.textContent = '';
      for (const [k, val] of [['Release', spec.release], ['Record', spec.target], ['Spec', spec.specVersion], ['Documents in view', String(docs)]]) {
        const row = el('div'); row.appendChild(el('strong', null, k + ' ')); row.appendChild(el('span', null, val)); v.appendChild(row);
      }
    }
    return { changed, lost, showTab };
  }

  window.EVApp = { VERSION, boot };
})();
