// B-515 D2c: the legacy layer is gone, and what was left of page/styles.css is page/ds/views/legacy-carry.css, the
// first file of the views layer. In legacy its rules beat every other layer's normal declarations and lost to every
// other layer's !important ones, whatever the specificity. carry() keeps exactly that inside views, at build time, so
// nothing on screen moves and the source stays as written: each rule's normal declarations get a selector raised by
// CARRY_IDS ids (:not(#\#) matches every element and adds one id), more than any other stylesheet's selector holds
// (the build test checks the margin), and its !important declarations keep the plain selector, ahead of every other
// views file, so a views !important still wins. Consolidation moves rules out of the carry and retires this.
export const CARRY_IDS = 4;
const BOOST = ':not(#\\#)'.repeat(CARRY_IDS);

/** Index just past a comment, string or bracketed group starting at i, or i itself. */
function skip(s, i) {
  if (s[i] === '/' && s[i + 1] === '*') {
    const e = s.indexOf('*/', i + 2);
    return e < 0 ? s.length : e + 2;
  }
  if (s[i] === '"' || s[i] === "'") {
    let j = i + 1;
    while (j < s.length && s[j] !== s[i]) j += s[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  return i;
}
/** Splits s at top-level occurrences of ch (outside comments, strings, (), []). */
function split(s, ch) {
  const out = [];
  let depth = 0,
    from = 0;
  for (let i = 0; i < s.length;) {
    const j = skip(s, i);
    if (j !== i) {
      i = j;
      continue;
    }
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ch && !depth) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
    i++;
  }
  out.push(s.slice(from));
  return out;
}
/** One complex selector raised: the ids go before a pseudo-element, else at the end. */
function raise(sel) {
  const t = sel.trim();
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (!depth && c === ':' && t[i + 1] === ':') return t.slice(0, i) + BOOST + t.slice(i);
  }
  return t + BOOST;
}
export const raiseList = sel => split(sel, ',').map(raise).join(',');

/** The index just past the block opened by the brace at i - 1. */
function close(s, i) {
  let depth = 1;
  while (i < s.length && depth) {
    const j = skip(s, i);
    if (j !== i) {
      i = j;
      continue;
    }
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    i++;
  }
  return i;
}
/** The carry's text with legacy's precedence kept in the views layer (above). */
export function carry(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    // copy whitespace and comments
    const j = skip(css, i);
    if (j !== i) {
      out += css.slice(i, j);
      i = j;
      continue;
    }
    if (/\s/.test(css[i])) {
      out += css[i++];
      continue;
    }
    if (css[i] === '}') {
      out += css[i++];
      continue;
    }
    let o = i;
    while (o < css.length && css[o] !== '{') o = skip(css, o) === o ? o + 1 : skip(css, o);
    if (o >= css.length) {
      out += css.slice(i);
      break;
    }
    const head = css.slice(i, o).trim();
    const end = close(css, o + 1);
    const body = css.slice(o + 1, end - 1);
    if (/^@(media|supports|container)\b/.test(head)) out += head + '{' + carry(body) + '}';
    else if (head.startsWith('@')) out += css.slice(i, end);
    else {
      const decls = split(body.replace(/\/\*[\s\S]*?\*\//g, ''), ';').filter(d => d.trim());
      const imp = decls.filter(d => /!\s*important\s*$/i.test(d));
      const norm = decls.filter(d => !/!\s*important\s*$/i.test(d));
      if (norm.length) out += raiseList(head) + '{' + norm.join(';') + '}';
      if (imp.length) out += head + '{' + imp.join(';') + '}';
    }
    i = end;
  }
  return out;
}
