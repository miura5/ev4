// B-450: a row of buttons that may wrap (the phone's Study toolbar: Quiz me, Weak spots, Start session). The buttons
// are grouped into rows by their top edge; within a row none overlaps and each is at least `gap` px from the one before;
// rows do not overlap each other; nothing is clipped; every button is shown and inside the viewport. Wrapping onto a
// second row is allowed (CI's fonts put Start session on its own row), overlap and clipping never are.
// Each button: { id, l, r, top, bottom, clip, shown }. Returns the problems found, [] when the layout is good.
function rowProblems(bar, { gap = 4, width = 390, tol = 2 } = {}) {
  const out = [];
  for (const x of bar) {
    if (!x.shown) out.push(`${x.id} not shown`);
    if (x.clip) out.push(`${x.id} clipped`);
    if (!(x.r > x.l) || !(x.bottom > x.top)) out.push(`${x.id} has no size`);
    if (x.l < 0 || x.r > width) out.push(`${x.id} outside the ${width} px viewport (${x.l}..${x.r})`);
  }
  const rows = [];
  for (const x of [...bar].sort((a, b) => a.top - b.top || a.l - b.l)) {
    const row = rows.find(r => Math.abs(r[0].top - x.top) <= tol);
    row ? row.push(x) : rows.push([x]);
  }
  rows.forEach(r => r.sort((a, b) => a.l - b.l));
  for (const r of rows)
    for (let i = 1; i < r.length; i++)
      if (r[i].l < r[i - 1].r + gap) out.push(`${r[i - 1].id} and ${r[i].id} less than ${gap} px apart on one row`);
  for (let i = 1; i < rows.length; i++) {
    const above = Math.max(...rows[i - 1].map(x => x.bottom));
    if (rows[i][0].top < above) out.push(`row ${i + 1} overlaps the row above`);
  }
  return out;
}

module.exports = { rowProblems };
