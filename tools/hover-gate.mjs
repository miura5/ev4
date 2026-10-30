// B-552: hover only where there is a pointer that hovers. Every style rule whose selector names :hover is wrapped, at
// build time, in @media (hover:hover), so a tap on the phone never leaves a control painted as hovered. A selector list
// that mixes hover and non-hover parts is split: the other parts keep applying everywhere. Sources stay as written.
const skip = (css, i) => {
  // past a comment or a string starting at i, or i itself
  if (css[i] === '/' && css[i + 1] === '*') {
    const e = css.indexOf('*/', i + 2);
    return e < 0 ? css.length : e + 2;
  }
  if (css[i] === '"' || css[i] === "'") {
    let j = i + 1;
    while (j < css.length && css[j] !== css[i]) j += css[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  return i;
};
function close(css, i) {
  // the index just past the brace that closes the block opened at i - 1
  let depth = 1;
  while (i < css.length && depth) {
    const j = skip(css, i);
    if (j !== i) {
      i = j;
      continue;
    }
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  return i;
}
function splitList(sel) {
  const out = [];
  let d = 0,
    from = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '(' || c === '[') d++;
    else if (c === ')' || c === ']') d--;
    else if (c === ',' && !d) {
      out.push(sel.slice(from, i));
      from = i + 1;
    }
  }
  out.push(sel.slice(from));
  return out;
}
export function gateHover(css) {
  let out = '',
    i = 0,
    start = 0,
    pre = 0;
  while (i < css.length) {
    const j = skip(css, i);
    if (j !== i) {
      i = j;
      continue;
    }
    const c = css[i];
    if (c === ';' || c === '}') {
      pre = ++i;
      continue;
    }
    if (c !== '{') {
      i++;
      continue;
    }
    // the prelude runs from the last ; or block end before it (comments kept in the copy, not in the test)
    const preludeAt = Math.max(pre, start);
    const end = close(css, i + 1);
    const prelude = css.slice(preludeAt, i);
    const sel = prelude.replace(/\/\*[\s\S]*?\*\//g, '');
    if (sel.trim().startsWith('@')) {
      out += css.slice(start, i + 1) + gateHover(css.slice(i + 1, end - 1)) + '}';
    } else if (/:hover\b/.test(sel)) {
      const lead = prelude.match(/^(?:\s|\/\*[\s\S]*?\*\/)*/)[0];
      const body = css.slice(i, end);
      const parts = splitList(sel).map(s => s.trim());
      const hov = parts.filter(s => /:hover\b/.test(s)),
        rest = parts.filter(s => !/:hover\b/.test(s));
      out += css.slice(start, preludeAt) + lead + (rest.length ? rest.join(',') + body : '');
      out += '@media (hover:hover){' + hov.join(',') + body + '}';
    } else out += css.slice(start, end);
    start = i = pre = end;
  }
  return out + css.slice(start);
}
