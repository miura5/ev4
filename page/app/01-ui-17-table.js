    // ---- Proprietary 17 Table (B-515): the matrix grid. DS.table({ columns, rows: [{ cells: [text or node], tone }] })
    function dsTable(o = {}) {
      const r = dsRoot('div', 'table', o, 'scroll'),
        t = el('table', 'mx'),
        th = el('thead'),
        tb = el('tbody'),
        hr = el('tr');
      hr.append(...['', ...(o.columns || [])].map(c => el('th', null, c)));
      th.append(hr);
      for (const row of o.rows || []) {
        const tr = el('tr', row.tone || null);
        for (const c of row.cells || []) tr.append(el('td', null, c instanceof Node ? '' : String(c ?? '')));
        (row.cells || []).forEach((c, i) => c instanceof Node && tr.children[i].append(c));
        tb.append(tr);
      }
      t.append(th, tb);
      r.append(t);
      return r;
    }
