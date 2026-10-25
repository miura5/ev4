    // ------------------------------------------------------------ kit
    const $ = id => document.getElementById(id);
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    };
    const chip = (text, v = '') => el('span', 'chip ' + v, text);
    // the component set's badge (B-285); the old chip colours map onto its coded ones (D-269), her accent onto none
    const BADGE_X = {
      ok: 'x-green',
      warn: 'x-yellow',
      bad: 'x-red',
      info: 'x-blue',
      plum: 'x-violet',
      quiet: 'x-quiet',
    };
    const badge = (text, v = '') => el('span', 'badge row-badge' + (BADGE_X[v] ? ' ' + BADGE_X[v] : ''), text);
    const empty = t => {
      const li = el('li', 'row');
      li.append(el('p', 'empty', t));
      return li;
    };
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
      const b = el('button', btnClass(o), label);
      b.type = 'button';
      if (o.disabled) b.disabled = true;
      if (onClick) b.addEventListener('click', onClick);
      return b;
    }
    function row({ lead, title, detail, chips, action, check, cls }) {
      const li = el('li', 'row' + (cls ? ' ' + cls : ''));
      if (check) {
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.className = 'tick';
        c.checked = c.defaultChecked = !!check.checked;
        c.setAttribute('aria-label', check.label || title);
        c.addEventListener('change', () => check.onChange(c.checked, c));
        li.append(c);
      }
      if (lead) li.append(el('span', 'when', lead));
      const g = el('div', 'grow');
      const t = el('div', 'title');
      t.append(document.createTextNode(title || ''));
      // B-303 (D-276): a row that names its type or state carries one badge, never two; the first given leads
      const b = (chips || []).filter(Boolean)[0];
      if (b) t.append(badge(b[0], b[1]));
      g.append(t);
      if (detail) g.append(el('div', 'meta', detail));
      li.append(g);
      if (action) li.append(action);
      return li;
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
    let toastTimer;
    function toast(t) {
      const x = $('toast');
      x.textContent = t;
      x.hidden = false;
      x.dataset.at = String(Date.now());
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (x.hidden = true), 2600);
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

