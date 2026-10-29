    // ------------------------------------------------------------ kit
    const $ = id => document.getElementById(id);
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    };
    // B-507 (D-374, D-376): btn(), badge(), chip(), row(), empty() and toast() are one-line calls into Proprietary (DS,
    // page/app/01-ui*.js), so every view not yet moved gets its components with no change; B-515 removes them once no
    // view calls them. Each makes exactly the markup it made before (the pixel diff of every view says so).
    const chip = (text, v = '') => DS.chip({ label: text, tone: v });
    const badge = (text, v = '') => DS.badge({ text, tone: v, cls: 'row-badge' });
    const empty = t => DS.notice({ line: t, tag: 'li', cls: 'row' });
    // B-303 (D-278): every button the kit makes is one of the component set's five kinds: primary, a kind the caller
    // names (btn ...), the old quiet as ghost, the violet act as its coded tint, and neutral when none is named.
    const KIND_OF = { quiet: 'btn ghost sm', tlink: 'btn ghost sm', violet: 'btn tint x-violet' };
    const btnClass = o => {
      if (o.primary) return 'btn primary';
      const c = String(o.cls || '').trim();
      if (/(^|\s)btn(\s|$)/.test(c)) return c;
      const [first, ...rest] = c.split(/\s+/).filter(Boolean);
      return [KIND_OF[first] || 'btn neutral', ...(KIND_OF[first] ? rest : first ? [first, ...rest] : [])].join(' ');
    };
    function btn(label, onClick, o = {}) {
      return DS.button({ label, onClick, disabled: o.disabled, cls: btnClass(o) });
    }
    // B-303 (D-276): a row that names its type or state carries one badge, never two; the first given leads
    function row({ lead, title, detail, chips, action, check, cls }) {
      const b = (chips || []).filter(Boolean)[0];
      return DS.line({ kind: 'stack', lead, title, meta: detail, badge: b && [b[0], b[1]], action, check, cls });
    }
    function stat(value, label) {
      const s = el('div', 'stat');
      s.append(el('b', null, value), el('span', null, label));
      return s;
    }
    function table(head, rows, numFrom = 1) {
      const t = el('table', 'tbl');
      const tr = el('tr');
      head.forEach((h, i) => tr.append(el('th', i >= numFrom ? 'num' : null, h)));
      const th = el('thead');
      th.append(tr);
      t.append(th);
      const tb = el('tbody');
      rows.forEach(r => {
        const x = el('tr');
        r.forEach((c, i) => x.append(el('td', i >= numFrom ? 'num' : null, c)));
        tb.append(x);
      });
      t.append(tb);
      return t;
    }
    function toast(t) {
      return DS.toast({ text: t, root: $('toast') });
    }
    const pct = (r, n) => (n ? Math.round((100 * r) / n) + '%' : '–');
    const store = {
      get(k) {
        try {
          return localStorage.getItem('ev3-' + k);
        } catch {
          return null;
        }
      },
      set(k, v) {
        try {
          localStorage.setItem('ev3-' + k, v);
        } catch {}
      },
    };
    const status = $('status');
    const setStatus = (t, ok, note) => {
      status.textContent = t;
      status.classList.toggle('ok', !!ok);
      status.classList.toggle('note', !!note);
    };
    const now = () => new Date().toISOString();
    const today = E.chicagoDate(new Date());
    // B-352 (D-314): the demo's text formats on every view: days as Tue 20 Oct, times as 8:10 pm, durations as 25 min
    // or 10 h 20 m.
    const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const short = d => {
      if (!d) return '';
      const day = String(d).length === 10 ? String(d) : E.chicagoDate(d);
      if (!day) return '';
      return WD3[E.weekday(day)] + ' ' + Number(day.slice(8, 10)) + ' ' + MON3[Number(day.slice(5, 7)) - 1];
    };
    const durFmt = m => {
      m = Math.round(m || 0);
      return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' m' : '');
    };
    const cjLabel = s => E.CJ_LABELS[s] || s;
    const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

