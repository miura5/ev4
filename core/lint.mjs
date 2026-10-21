// lint (Data architecture, "A+ acceptance checklist"): the record checked against its own rules, by command.
//   wrong-writer     a document, or an append-map entry, written by a role its collection does not name
//   fact-changed     a Fact whose own fields (not its marks or append maps) differ from the hash state/current kept,
//                    unless a schema bump's legacy copy still matches that hash (an info note, fact-migrated)
//   over-budget      a document over spec.capacity.documentBytes, a material over materialTextChars, a collection
//                    over its budget once B-14 sets one, a system document over spec.capacity.system (B-150)
//   invalid          a document its collection's schema refuses
//   derived-differs  a Derived document that rebuild does not reproduce byte for byte
//   frozen           (info) D-090: a document carrying migratedAt or migratedTo is a frozen original, so is a v2 or v3
//                    leftover (B-34), and a collection in spec.legacyCollections is v3's, kept by rule; each is one note
//                    per collection, never an error
// plus the content checks E.V. core has always run (items, orphans, duplicates, identifiers). The journal is never
// read: it stays the page's (D-059).
import EV from './evcore.mjs';
import {
  classOf,
  writersOf,
  factCheck,
  knownFacts,
  rebuild,
  appendEntries,
  appendDepth,
  keyWriter,
} from './derive.mjs';
import { describeErrors } from './validate.mjs';

/** The legacy copy a schema bump kept of collection/id (legacy/v4-<collection>-<id>-s<n>) that passes ok(copy), if any. */
function migratedCopy(rec, col, id, ok) {
  const pre = `v4-${col}-${id}-s`;
  return (
    (rec.legacy || []).find(
      l => l.id.startsWith(pre) && /^\d+$/.test(l.id.slice(pre.length)) && l.migratedTo === `${col}/${id}` && ok(l)
    ) || null
  );
}

const bytes = d => Buffer.byteLength(JSON.stringify(EV.docData(d)), 'utf8');
/** D-090: an original a migration marked (migratedAt, migratedTo) is frozen: kept as it was, never changed again. */
export const isFrozen = d => !!(d && (d.migratedAt || d.migratedTo));
/**
 * B-34: the pre-v4 leftovers the migration did not mark, settled in code rather than by a hand write to live: a
 * document with no v4 envelope that an earlier migration stamped only source "migrated" (days/2026-10-16, a v2 test
 * day), and a document in a collection with fixed ids under an id v4 does not fix (v3's system/code). Both are kept as
 * they are (nothing is deleted) and lint notes them as frozen, like a marked original.
 */
export const isLeftover = (d, c) =>
  !!(d && ((c && c.fixedIds && !c.fixedIds.includes(d.id)) || (!d.writer && d.source === 'migrated')));

/**
 * db: {collection: [docs with id]}. Returns {issues: [{severity, code, ref, msg}], rebuilt: [rebuild results]}, issues
 * sorted errors first. opts.date: the day content checks run as of (exam-passed notes).
 */
/** B-42 (D-099): what is wrong with spec.courses, as lines (none when it is sound); also that the keys it replaced
 *  are gone. The build refuses a spec with any. */
export function courseProblems(spec) {
  const t = spec && spec.courses,
    out = [];
  if (!t || typeof t !== 'object') return ['spec.courses is missing'];
  const names = Object.keys(t).filter(k => !k.startsWith('_'));
  if (!names.length) out.push('spec.courses names no course');
  for (const n of names) {
    const c = t[n] || {};
    if (!['active', 'done'].includes(c.status)) out.push(`${n}: status is ${c.status}, not active or done`);
    if (!Number.isInteger(c.canvasId)) out.push(`${n}: canvasId is not a Canvas course id`);
    if (!Array.isArray(c.examKinds) || !c.examKinds.length) out.push(`${n}: examKinds is not a list of exam kinds`);
    for (const k of ['reviewKinds', 'examDayKinds', 'scoredKinds'])
      if (!Array.isArray(c[k]) || c[k].some(x => !(c.examKinds || []).includes(x)))
        out.push(`${n}: ${k} is not a list of its examKinds`);
    if (!Array.isArray(c.calendarDayKinds)) out.push(`${n}: calendarDayKinds is not a list`);
    if (c.dayBudget !== 'shared')
      out.push(`${n}: dayBudget is ${c.dayBudget}; only shared is built (one review set inside the day's budget)`);
    for (const r of ['aliases', 'guess'])
      if (c[r] != null) {
        try {
          new RegExp(c[r], 'i');
        } catch {
          out.push(`${n}: ${r} is not a pattern`);
        }
      }
    if (!Array.isArray(c.library) || c.library.some(r => !r || !r.module || !r.kind))
      out.push(`${n}: library is not a list of module rules with module and kind`);
    else
      for (const r of c.library) {
        try {
          new RegExp(r.module, 'i');
          if (r.only) new RegExp(r.only, 'i');
        } catch {
          out.push(`${n}: library rule ${r.module} is not a pattern`);
        }
      }
  }
  if (names.filter(n => t[n] && t[n].default).length !== 1) out.push('spec.courses needs exactly one default course');
  const at = (o, ks) => ks.reduce((v, k) => (v == null ? v : v[k]), o);
  for (const ks of [
    ['registry', 'canvas', 'courses'],
    ['registry', 'canvas', 'library', 'modules'],
    ['constants', 'nurUnitExamKinds'],
  ])
    if (at(spec, ks) !== undefined) out.push(`${ks.join('.')} moved to spec.courses (B-42) and must be gone`);
  return out;
}
/** exams and materials whose course is not one spec.courses names (written the way the record writes it). */
export function unknownCourses(db) {
  EV.courses();
  const out = [];
  for (const col of ['exams', 'materials'])
    for (const d of (db && db[col]) || [])
      if (d.course != null && d.course !== '' && !EV.isCourse(EV.normCourse(d.course)))
        out.push({ ref: `${col}/${d.id}`, course: d.course });
  return out;
}

export function lintRecord(db, spec, validate, { date, commit = null } = {}) {
  const issues = [];
  const add = (severity, code, ref, msg) => issues.push({ severity, code, ref, msg });
  const rec = Object.fromEntries(Object.entries(db || {}).filter(([c]) => c !== 'journal'));
  const cap = spec.capacity || {};
  const state = (rec.state || []).find(d => d.id === 'current') || null;
  const kf = knownFacts(rec.state);
  const known = kf.hashes;
  const knownFields = kf.fields;

  for (const u of unknownCourses(rec))
    add('error', 'unknown-course', u.ref, `course ${u.course} is not in spec.courses (B-42)`);
  const legacyCols = spec.legacyCollections || [];
  for (const [col, docs] of Object.entries(rec)) {
    const c = spec.collections[col];
    if (!c && legacyCols.includes(col)) {
      if ((docs || []).length)
        add(
          'info',
          'frozen',
          col,
          `${docs.length} document(s) in a v3 collection kept by rule (spec.legacyCollections): frozen, read by no pipeline`
        );
      continue;
    }
    if (!c) {
      add('warning', 'unknown-collection', col, 'not in spec.collections');
      continue;
    }
    let total = 0;
    let frozen = 0;
    for (const d of docs || []) {
      const ref = `${col}/${d.id}`;
      const cls = classOf(spec, col, d.id);
      const size = bytes(d);
      total += size;
      // A frozen original outside legacy keeps the shape it had when it was migrated: no schema, writer or fact check
      // applies to it now. legacy's own schema describes its copies, so those are still validated.
      if (isFrozen(d) || isLeftover(d, c)) {
        frozen++;
        if (col !== 'legacy') {
          if (cap.documentBytes && size > cap.documentBytes)
            add('error', 'over-budget', ref, `${size} bytes; the budget is ${cap.documentBytes}`);
          continue;
        }
      }
      // B-150 (D-183): a system document against its own per-document budget.
      if (col === 'system' && cap.system) {
        const b = cap.system;
        if (b.failBytes != null && size >= b.failBytes)
          add(
            'error',
            'over-budget',
            ref,
            `${size} bytes; a system document fails at ${b.failBytes} (spec.capacity.system)`
          );
        else if (b.warnBytes != null && size >= b.warnBytes)
          add(
            'warning',
            'over-budget',
            ref,
            `${size} bytes; a system document warns at ${b.warnBytes} (spec.capacity.system)`
          );
      }
      const r = validate(col, EV.docData(d), { id: d.id });
      if (!r.ok) add('error', 'invalid', ref, describeErrors(ref, r).split('\n').slice(0, 3).join(' · '));
      const writers = writersOf(spec, col, d.id);
      // A legacy copy keeps its original's writer as it was (rollback writes it back whole); legacy itself is written by
      // migrations, not by a role.
      if (d.writer && !writers.includes(d.writer) && !(col === 'legacy' && d.migratedTo))
        add(
          'error',
          'wrong-writer',
          ref,
          `written by ${d.writer}; ${col} is written by ${writers.join(', ') || 'no one'}`
        );
      for (const [field, allowed] of Object.entries(c.appends || {})) {
        for (const [p, k] of appendEntries(d[field], appendDepth(col, field))) {
          const w = keyWriter(col, field, k);
          if (w && !allowed.includes(w))
            add(
              'error',
              'wrong-writer',
              `${ref}#${field}.${p}`,
              `appended by ${w}; ${field} is appended by ${allowed.join(', ')}`
            );
        }
      }
      if (cls === 'Fact' && known[ref]) {
        // B-32 (D-089): marks and append maps may change; a field first set since the hash is a first write.
        const f = factCheck(spec, col, d, known[ref], knownFields[col]);
        const bumped =
          f.ok === false &&
          migratedCopy(rec, col, d.id, c => factCheck(spec, col, c, known[ref], knownFields[col]).ok === true);
        if (bumped)
          add(
            'info',
            'fact-migrated',
            ref,
            `changed by a schema bump (${bumped.id}) since state/current hashed it; the next state rebuild hashes the new form`
          );
        else if (f.ok === false)
          add(
            'error',
            'fact-changed',
            ref,
            `${f.why} since state/current hashed it; a Fact's own fields are write-once (marks: ${Object.keys(c.marks || {}).join(', ') || 'none'}; events go in its maps)`
          );
      }
      if (cap.documentBytes && size > cap.documentBytes)
        add('error', 'over-budget', ref, `${size} bytes; the budget is ${cap.documentBytes}`);
      if (col === 'materials' && cap.materialTextChars && String(d.text || '').length > cap.materialTextChars)
        add(
          'error',
          'over-budget',
          ref,
          `${String(d.text).length} characters of text; the cap is ${cap.materialTextChars} (chunk as ${cap.materialChunkId || '<id>-p<n>'})`
        );
    }
    if (frozen)
      add(
        'info',
        'frozen',
        col,
        `${frozen} frozen original(s) (migratedAt or migratedTo, or a v2 or v3 leftover): kept as they were, never changed`
      );
    if (c.retired && (docs || []).length)
      add(
        'info',
        'retired',
        col,
        `${(docs || []).length} document(s) kept in a retired collection: ${String(c.retired).split(':')[0]}`
      );
    const b = (cap.collections || {})[col] || {};
    const n = (docs || []).length;
    if (b.failDocs != null && n >= b.failDocs)
      add(
        'error',
        'over-budget',
        col,
        `${n} documents; fails at ${b.failDocs}` + (b.relief ? ` (relief: ${b.relief})` : '')
      );
    else if (b.warnDocs != null && n >= b.warnDocs)
      add(
        'warning',
        'over-budget',
        col,
        `${n} documents; warns at ${b.warnDocs}` + (b.relief ? ` (relief: ${b.relief})` : '')
      );
    if (b.failBytes != null && total >= b.failBytes)
      add('error', 'over-budget', col, `${total} bytes; fails at ${b.failBytes}`);
    else if (b.warnBytes != null && total >= b.warnBytes)
      add('warning', 'over-budget', col, `${total} bytes; warns at ${b.warnBytes}`);
  }

  // A frozen original or a pre-v4 leftover is no build of today's code: rebuild never judges it.
  const kept = new Set();
  for (const [col, docs] of Object.entries(rec))
    for (const d of docs || []) if (isFrozen(d) || isLeftover(d, spec.collections[col])) kept.add(`${col}/${d.id}`);
  const rebuilt = rebuild(rec, spec).filter(r => !kept.has(r.ref));
  for (const r of rebuilt) {
    if (r.status === 'differs') {
      // Built by an earlier build, it may differ for that reason alone; its next run rebuilds it with today's code.
      const [col, ...rest] = r.ref.split('/');
      const stored = (rec[col] || []).find(d => d.id === rest.join('/'));
      const runId = String((stored && stored.source) || '')
        .split(' ')
        .pop();
      const run = (rec.runs || []).find(x => x.id === runId);
      const built = run && run.commit;
      if (commit && built === commit)
        add('error', 'derived-differs', r.ref, 'rebuild does not reproduce it byte for byte');
      else if (commit)
        add(
          'warning',
          'derived-stale',
          r.ref,
          `built by ${built ? 'build ' + built.slice(0, 12) : 'an earlier build'}; differs from this build's rebuild until its next run`
        );
      else add('error', 'derived-differs', r.ref, 'rebuild does not reproduce it byte for byte');
    } else if (r.status === 'inexact-differs')
      add('info', 'derived-inexact', r.ref, `differs, but ${r.inexact.join(', ')} changed since it was built`);
    else if (r.status === 'skipped') add('info', 'not-rebuilt', r.ref, r.reason);
  }

  for (const i of EV.lint(rec, { date })) add(i.severity, i.code, i.ref, i.msg);
  const rank = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  return { issues, rebuilt };
}

/**
 * The nightly lint as state/current.lint keeps it (D-090): the counts, every error and warning (up to `max`), and the
 * notes by code. Small enough for state's budget: notes are counted, not listed.
 */
export function lintSummary({ issues, rebuilt }, { at, commit = null, max = 20 } = {}) {
  const n = s => issues.filter(i => i.severity === s).length;
  const notes = {};
  for (const i of issues) if (i.severity === 'info') notes[i.code] = (notes[i.code] || 0) + 1;
  const counted = rebuilt.filter(r => r.status !== 'skipped');
  return {
    at,
    commit,
    errors: n('error'),
    warnings: n('warning'),
    notes: n('info'),
    notesByCode: Object.fromEntries(Object.entries(notes).sort(([a], [b]) => (a < b ? -1 : 1))),
    rebuilt: {
      same: counted.filter(r => r.status === 'same' || r.status === 'inexact-same').length,
      of: counted.length,
    },
    top: issues
      .filter(i => i.severity !== 'info')
      .slice(0, max)
      .map(({ severity, code, ref, msg }) => ({ severity, code, ref, msg: String(msg).slice(0, 300) })),
  };
}

export function formatLint({ issues, rebuilt }) {
  const n = s => issues.filter(i => i.severity === s).length;
  const same = rebuilt.filter(r => r.status === 'same' || r.status === 'inexact-same').length;
  const lines = [
    `lint: ${n('error') ? 'RED' : 'GREEN'} · ${n('error')} errors, ${n('warning')} warnings, ${n('info')} notes · rebuild reproduced ${same} of ${rebuilt.filter(r => r.status !== 'skipped').length} Derived documents`,
  ];
  for (const i of issues)
    lines.push(
      `  ${i.severity === 'error' ? 'NO ' : i.severity === 'warning' ? 'warn' : 'note'} ${i.code} ${i.ref}: ${i.msg}`
    );
  return lines.join('\n');
}
