    // ---- Proprietary 18 Chart (B-515): E.V.'s week chart (.chart), rules in 18-chart.css. A bar's value is a percent,
    // or null for a day with nothing. DS.chart({ label, bars: [{ value: 80, under: ['Mon', '5 q'] }] })
    function dsChart(o = {}) {
      const r = dsRoot('div', 'chart', o, 'chart'),
        bars = o.bars || [],
        gap = (320 - bars.length * 30) / (bars.length + 1),
        esc = t => String(t).replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';'),
        txt = (x, y, t, c = '') => `<text${c} x="${x}" y="${y}" text-anchor="middle">${esc(t)}</text>`;
      const parts = bars.map((b, i) => {
        const x = gap + i * (30 + gap),
          h = Math.max(3, (86 * Math.max(0, Math.min(100, b.value))) / 100),
          y = 104 - h - 4 > 26 ? 104 - h - 4 : 14;
        const bar = `<rect class="bar" x="${x}" y="${104 - h}" width="30" height="${h}" rx="4"/>`;
        const top = b.value == null ? '' : bar + txt(x + 15, y, b.text ?? Math.round(b.value) + '%', ' class="pct"');
        const under = (b.under || []).map((t, k) => txt(x + 15, 117 + 12 * k, t)).join('');
        return `<rect class="base" x="${x}" y="18" width="30" height="86" rx="4"/>` + top + under;
      });
      r.innerHTML = `<svg viewBox="0 0 320 132" role="img" aria-label="${esc(o.label || '')}">${parts.join('')}</svg>`;
      return r;
    }
