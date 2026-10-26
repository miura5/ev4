// Typed links (B-231, D-241): referential integrity across the record. spec.links.rows holds one row per id field that
// points at another collection or a spec map: {collection, field, to, link}. link is required, optional or external
// (pointing outside the record, so nothing here checks it). to is a collection, a spec map (spec.courses), "named"
// (the value itself is "<collection>/<id>", the ideas link shape) or "plans.tasks" (a task id inside any plan).
// field is a path in the collection's documents: a.b for a nested field, a[] for each entry of a list, a.* for each
// value of a map.
// Node only: lint and the build read it; the page does not (it reads spec.links nowhere yet).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from './evcore.mjs';
import { PAGE_ONLY } from './schemas.mjs';

const KINDS = ['required', 'optional', 'external'];
let SPEC0 = null;
const repoSpec = () =>
  SPEC0 ||
  (SPEC0 = JSON.parse(
    fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'spec', 'ev.spec.json'), 'utf8')
  ));

export const linkRows = (spec = repoSpec()) => ((spec && spec.links && spec.links.rows) || []).filter(Boolean);

/** a.b[].c.* as tokens: names, '[]' and '*'. */
function tokens(field) {
  const out = [];
  for (const part of String(field).split('.')) {
    const m = part.match(/^([^[\]]*)((?:\[\])*)$/);
    if (!m) return null;
    if (m[1]) out.push(m[1]);
    for (let i = 0; i < m[2].length / 2; i++) out.push('[]');
  }
  return out;
}

/** The values a document holds at field: every non-empty string reached (none when the field is absent). */
export function valuesAt(doc, field) {
  let cur = [doc];
  for (const t of tokens(field) || []) {
    const next = [];
    for (const v of cur) {
      if (v == null || typeof v !== 'object') continue;
      if (t === '[]') {
        if (Array.isArray(v)) next.push(...v);
      } else if (t === '*') {
        if (!Array.isArray(v)) next.push(...Object.values(v));
      } else if (!Array.isArray(v) && t in v) next.push(v[t]);
    }
    cur = next;
  }
  return cur.filter(v => typeof v === 'string' && v !== '');
}

// ---------------------------------------------------------------- the build's half: rows against the schemas
function deref(root, s) {
  for (let n = 0; s && s.$ref && n < 20; n++)
    s = s.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((o, k) => (o == null ? o : o[k]), root);
  return s;
}
function alternatives(root, s) {
  s = deref(root, s);
  if (!s || typeof s !== 'object') return [];
  const out = [s];
  for (const k of ['oneOf', 'anyOf', 'allOf']) for (const x of s[k] || []) out.push(...alternatives(root, x));
  for (const k of ['then', 'else']) if (s[k]) out.push(...alternatives(root, s[k]));
  return out;
}
/** Whether the schema has the field path (through $ref, oneOf, anyOf, allOf, items and map values). */
export function schemaHas(schema, field) {
  const ts = tokens(field);
  if (!schema || !ts || !ts.length) return false;
  let cur = [schema];
  for (const t of ts) {
    const next = [];
    for (const s of cur.flatMap(x => alternatives(schema, x))) {
      if (t === '[]') {
        if (s.items && typeof s.items === 'object') next.push(s.items);
      } else if (t === '*') {
        if (s.additionalProperties && typeof s.additionalProperties === 'object') next.push(s.additionalProperties);
        next.push(...Object.values(s.patternProperties || {}));
      } else if (s.properties && s.properties[t]) next.push(s.properties[t]);
    }
    if (!next.length) return false;
    cur = next;
  }
  return true;
}

/** What is wrong with spec.links against the schema registry, as lines; the build refuses a spec with any. */
export function linkProblems(spec, schemas) {
  const out = [];
  const t = spec && spec.links;
  if (!t || !Array.isArray(t.rows)) return ['spec.links.rows is missing'];
  const seen = new Set();
  const isTarget = to =>
    to === 'named' ||
    to === 'plans.tasks' ||
    (/^spec\./.test(to) ? spec[to.slice(5)] != null && typeof spec[to.slice(5)] === 'object' : !!schemas[to]);
  for (const r of t.rows) {
    const name = `${r && r.collection}.${r && r.field}`;
    if (!r || typeof r !== 'object') {
      out.push('a row that is not an object');
      continue;
    }
    if (seen.has(name)) out.push(`${name}: listed twice`);
    seen.add(name);
    if (!KINDS.includes(r.link)) out.push(`${name}: link is ${r.link}, not ${KINDS.join(', ')}`);
    if (!schemas[r.collection] || !(spec.collections || {})[r.collection])
      out.push(`${name}: no collection ${r.collection} in the schemas`);
    else if (!schemaHas(schemas[r.collection], r.field))
      out.push(`${name}: the ${r.collection} schema has no field ${r.field}`);
    if (r.link !== 'external' && !isTarget(r.to))
      out.push(`${name}: points at ${r.to}, which is no collection in the schemas and no spec map`);
  }
  return out;
}

// ---------------------------------------------------------------- the record's half
const OUTSIDE = { outside: true };
function targetHas(db, to, value, spec) {
  if (to === 'named') {
    const i = value.indexOf('/');
    if (i < 1) return null;
    const col = value.slice(0, i);
    if (!(spec.collections || {})[col]) return OUTSIDE; // note/<id>#line: his note, not the record
    // B-401 (D-325): a page-only collection a run did not read (notes/<id> on a session) is not judged by that run
    if (PAGE_ONLY.includes(col) && !(db && db[col])) return OUTSIDE;
    return ((db && db[col]) || []).find(d => d.id === value.slice(i + 1)) || null;
  }
  if (to === 'plans.tasks') {
    for (const p of (db && db.plans) || []) {
      const t = EV.planTasks(p).find(x => x.id === value);
      if (t) return t;
    }
    return null;
  }
  if (to === 'spec.courses') {
    const n = EV.normCourse(value);
    return EV.isCourse(n) ? { id: n, ...spec.courses[n] } : null;
  }
  if (/^spec\./.test(to)) {
    const m = spec[to.slice(5)] || {};
    return Object.prototype.hasOwnProperty.call(m, value) ? m[value] : null;
  }
  if (PAGE_ONLY.includes(to) && !(db && db[to])) return OUTSIDE;
  return ((db && db[to]) || []).find(d => d.id === value) || null;
}

/**
 * B-231: the documents a link field points at. field is "<collection>.<path>", as spec.links names it
 * (weakspots.objective, sets.items[].weakspotId). Returns {link, to, found: [{value, doc}], missing: [value]}, or null
 * when spec.links has no such row. An external link is never resolved: found and missing are empty.
 */
export function linked(db, doc, field, spec = repoSpec()) {
  EV.configure(spec); // spec.courses' aliases
  return resolve(db, doc, field, spec);
}
function resolve(db, doc, field, spec) {
  const dot = String(field).indexOf('.');
  const collection = String(field).slice(0, dot),
    rest = String(field).slice(dot + 1);
  const row = linkRows(spec).find(r => r.collection === collection && r.field === rest);
  if (!row) return null;
  const out = { link: row.link, to: row.to, found: [], missing: [] };
  if (row.link === 'external') return out;
  for (const value of valuesAt(doc, rest)) {
    const hit = targetHas(db, row.to, value, spec);
    if (hit === OUTSIDE) continue;
    if (hit) out.found.push({ value, doc: hit });
    else out.missing.push(value);
  }
  return out;
}

/**
 * Lint's half: every dangling link in db as {severity, code, ref, msg}: a required one is an error, an optional one
 * a note. skip(col, doc) leaves out what lint keeps as it was (frozen originals, leftovers).
 */
export function linkIssues(db, spec, { skip = () => false } = {}) {
  const issues = [];
  EV.configure(spec);
  for (const r of linkRows(spec)) {
    if (r.link === 'external') continue;
    for (const d of (db && db[r.collection]) || []) {
      if (skip(r.collection, d)) continue;
      const res = resolve(db, d, `${r.collection}.${r.field}`, spec);
      for (const v of new Set((res && res.missing) || []))
        issues.push({
          severity: r.link === 'required' ? 'error' : 'info',
          code: 'dangling-link',
          ref: `${r.collection}/${d.id}`,
          msg: `${r.field} names ${v}, which is not in ${r.to} (${r.link === 'optional' ? 'an' : 'a'} ${r.link} link, spec.links)`,
        });
    }
  }
  return issues;
}
