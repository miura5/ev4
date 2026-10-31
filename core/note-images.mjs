// B-653: pictures in his notes, as blocks. A picture is { type: 'img', runs: [], key, width?, alt? } (notes.schema.json):
// the key names the file in the env's R2 bucket (pwa/images.js); the bytes never enter a note. These change the
// blocks only; removing a picture from a note leaves its file stored (B-11, nothing deleted).
// B-654: a two-column row is blocks marked {row, col} (core/notes.mjs keeps the row together, column 0 first): a picture
// dragged sideways onto a block makes a row of the two, and text types on in the column beside it.
export function makeNoteImages() {
  'use strict';
  const MIN = 40;
  const MAX = 2000;
  const DEFAULT = 480; // a new picture's width, before he resizes it
  const blank = b => b && b.type === 'p' && !(b.runs || []).some(r => r.text);
  const unplace = b => {
    const c = { ...b };
    delete c.row;
    delete c.col;
    return c;
  };
  /** A row id not yet used in these blocks: r1, r2, ... */
  function newRowId(blocks) {
    const used = new Set(blocks.map(b => b.row).filter(Boolean));
    let n = 1;
    while (used.has('r' + n)) n++;
    return 'r' + n;
  }
  const clampW = (w, max) => Math.max(MIN, Math.min(Math.min(MAX, max || MAX), Math.round(Number(w) || DEFAULT)));

  /** A picture block for a stored key, at the default width (or the note's width when that is smaller). */
  function noteImageBlock(key, { width, alt, max } = {}) {
    const b = { type: 'img', runs: [], key: String(key), width: clampW(width || DEFAULT, max) };
    if (alt) b.alt = String(alt).slice(0, 300);
    return b;
  }
  /**
   * blocks with the picture put in at block `at`: an empty paragraph there takes it, else it goes after that block.
   * A paragraph follows it when it would be last, so he can type under it. { blocks, at: the picture's index }.
   */
  function noteInsertImage(blocks, at, img) {
    const out = blocks.slice();
    let i = Math.max(0, Math.min(out.length - 1, Number(at) || 0));
    const place = out[i] && out[i].row ? { row: out[i].row, col: out[i].col } : {};
    if (blank(out[i])) out[i] = { ...img, ...place };
    else out.splice(++i, 0, { ...img, ...place });
    if (i === out.length - 1) out.push({ type: 'p', runs: [] });
    return { blocks: out, at: i };
  }
  /** blocks with block `from` moved to the gap before block `gap` (0..length). { blocks, at: its new index }. */
  function noteMoveBlock(blocks, from, gap) {
    if (from < 0 || from >= blocks.length) return { blocks, at: from };
    const g = Math.max(0, Math.min(blocks.length, gap));
    if (g === from || g === from + 1) return { blocks, at: from };
    const out = blocks.slice();
    const [b0] = out.splice(from, 1);
    const at = g > from ? g - 1 : g;
    // B-654: dropped between two lines of one column it joins that column; anywhere else it is full width again
    const before = out[at - 1],
      after = out[at];
    const inCol = before && after && before.row && before.row === after.row && before.col === after.col;
    const b = inCol ? { ...b0, row: before.row, col: before.col } : unplace(b0);
    out.splice(at, 0, b);
    const done = tidy(out);
    return { blocks: done, at: done.indexOf(b) };
  }
  // the row rules core/notes.mjs keeps (a row together, column 0 first, a one-column row made full width)
  function tidy(blocks) {
    const seen = new Map();
    const out = [];
    for (const b of blocks) {
      if (!b.row) {
        out.push(b);
        continue;
      }
      let g = seen.get(b.row);
      if (!g) (seen.set(b.row, (g = { cols: [[], []] })), out.push(g));
      g.cols[b.col].push(b);
    }
    return out.flatMap(x =>
      !x.cols
        ? [x]
        : x.cols[0].length && x.cols[1].length
          ? [...x.cols[0], ...x.cols[1]]
          : [...x.cols[0], ...x.cols[1]].map(unplace)
    );
  }
  /**
   * B-654: block `from` (a picture) dragged sideways onto block `onto`: the two make a two-column row, the picture in
   * column `side` (0 left, 1 right) and the other block in the other column. When `onto` is already in a row the
   * picture goes to the top of that row's `side` column. { blocks, at: the picture's index, text: the block beside it }.
   */
  function noteMakeRow(blocks, from, onto, side) {
    const pic = blocks[from],
      tgt = blocks[onto];
    if (!pic || !tgt || from === onto) return { blocks, at: from, text: onto };
    const col = side ? 1 : 0;
    let row, mate;
    if (tgt.row) {
      row = tgt.row;
      mate = tgt;
    } else {
      row = newRowId(blocks);
      mate = { ...tgt, row, col: 1 - col };
    }
    const moved = { ...unplace(pic), row, col };
    const out = blocks.map((b, i) => (i === onto ? mate : b));
    out.splice(from, 1);
    // the picture goes in at the top of its column (or beside the block when it starts the row)
    let at = out.indexOf(mate);
    if (tgt.row) {
      const first = out.findIndex(b => b.row === row && b.col === col);
      at = first >= 0 ? first : col ? out.map(b => b.row).lastIndexOf(row) + 1 : out.findIndex(b => b.row === row);
    } else if (col) at += 1;
    out.splice(at, 0, moved);
    const res = tidy(out);
    const pi = res.indexOf(moved);
    return { blocks: res, at: pi, text: res.indexOf(mate) };
  }
  /** blocks with picture `i` at `width` px, kept between 40 and the note's width (max). */
  function noteResizeImage(blocks, i, width, max) {
    if (!blocks[i] || blocks[i].type !== 'img') return { blocks, at: i };
    const out = blocks.slice();
    out[i] = { ...out[i], width: clampW(width, max) };
    return { blocks: out, at: i };
  }
  /** blocks without picture `i` (an empty paragraph takes its place when it was the only block). Its file is kept. */
  function noteRemoveImage(blocks, i) {
    if (!blocks[i] || blocks[i].type !== 'img') return { blocks, at: i };
    const out = blocks.slice();
    out.splice(i, 1);
    if (!out.length) out.push({ type: 'p', runs: [] });
    return { blocks: out, at: Math.min(i, out.length - 1) };
  }
  return {
    NOTE_IMG_DEFAULT: DEFAULT,
    noteImageBlock,
    noteInsertImage,
    noteMoveBlock,
    noteMakeRow,
    noteResizeImage,
    noteRemoveImage,
  };
}
