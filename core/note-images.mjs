// B-653: pictures in his notes, as blocks. A picture is { type: 'img', runs: [], key, width?, alt? } (notes.schema.json):
// the key names the file in the env's R2 bucket (pwa/images.js); the bytes never enter a note. These change the
// blocks only; removing a picture from a note leaves its file stored (B-11, nothing deleted).
export function makeNoteImages() {
  'use strict';
  const MIN = 40;
  const MAX = 2000;
  const DEFAULT = 480; // a new picture's width, before he resizes it
  const blank = b => b && b.type === 'p' && !(b.runs || []).some(r => r.text);
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
    if (blank(out[i])) out[i] = img;
    else out.splice(++i, 0, img);
    if (i === out.length - 1) out.push({ type: 'p', runs: [] });
    return { blocks: out, at: i };
  }
  /** blocks with block `from` moved to the gap before block `gap` (0..length). { blocks, at: its new index }. */
  function noteMoveBlock(blocks, from, gap) {
    if (from < 0 || from >= blocks.length) return { blocks, at: from };
    const g = Math.max(0, Math.min(blocks.length, gap));
    if (g === from || g === from + 1) return { blocks, at: from };
    const out = blocks.slice();
    const [b] = out.splice(from, 1);
    const at = g > from ? g - 1 : g;
    out.splice(at, 0, b);
    return { blocks: out, at };
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
    noteResizeImage,
    noteRemoveImage,
  };
}
