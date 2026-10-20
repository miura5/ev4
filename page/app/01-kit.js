    // ------------------------------------------------------------ kit
    const $ = id => document.getElementById(id);
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    };
    const chip = (text, v = '') => el('span', 'chip ' + v, text);
    const empty = t => {
      const li = el('li', 'row');
      li.append(el('p', 'empty', t));
      return li;
    };
    function btn(label, onClick, o = {}) {
      const b = el('button', o.primary ? 'primary' : o.cls || null, label);
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
      if (chips && chips.length) {
        const cs = el('span', 'chips');
        cs.style.marginLeft = '6px';
        chips.filter(Boolean).forEach(c => cs.append(chip(c[0], c[1])));
        t.append(cs);
      }
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
    const short = d => E.shortDate(d);
    const cjLabel = s => E.CJ_LABELS[s] || s;
    const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

