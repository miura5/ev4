// lint (Data architecture, "A+ acceptance checklist"): the record checked against its own rules, by command.
//   wrong-writer     a document, or an append-map entry, written by a role its collection does not name
//   fact-changed     a Fact whose own fields differ from the hash state/current kept for it
//   over-budget      a document over spec.capacity.documentBytes, a material over materialTextChars, a collection
//                    over its budget once B-14 sets one
//   invalid          a document its collection's schema refuses
//   derived-differs  a Derived document that rebuild does not reproduce byte for byte
// plus the content checks E.V. core has always run (items, orphans, duplicates, identifiers). The journal is never
// read: it stays the page's (D-059).
import EV from './evcore.mjs';
import { classOf, writersOf, factHash, rebuild, appendEntries, appendDepth, keyWriter } from './derive.mjs';
import { describeErrors } from './validate.mjs';

const bytes = d => Buffer.byteLength(JSON.stringify(EV.docData(d)), 'utf8');

/**
 * db: {collection: [docs with id]}. Returns {issues: [{severity, code, ref, msg}], rebuilt: [rebuild results]}, issues
 * sorted errors first. opts.date: the day content checks run as of (exam-passed notes).
 */
export function lintRecord(db, spec, validate, { date, commit = null } = {}) {
  const issues = [];
  const add = (severity, code, ref, msg) => issues.push({ severity, code, ref, msg });
  const rec = Object.fromEntries(Object.entries(db || {}).filter(([c]) => c !== 'journal'));
  const cap = spec.capacity || {};
  const state = ((rec.state || []).find(d => d.id === 'current')) || null;
  const known = (state && state.factHashes) || {};

  for (const [col, docs] of Object.entries(rec)) {
    const c = spec.collections[col];
    if (!c) { add('warning', 'unknown-collection', col, 'not in spec.collections'); continue; }
    let total = 0;
    for (const d of docs || []) {
      const ref = `${col}/${d.id}`; const cls = classOf(spec, col, d.id); const size = bytes(d); total += size;
      const r = validate(col, EV.docData(d), { id: d.id });
      if (!r.ok) add('error', 'invalid', ref, describeErrors(ref, r).split('\n').slice(0, 3).join(' · '));
      const writers = writersOf(spec, col, d.id);
      if (d.writer && !writers.includes(d.writer)) add('error', 'wrong-writer', ref, `written by ${d.writer}; ${col} is written by ${writers.join(', ') || 'no one'}`);
      for (const [field, allowed] of Object.entries(c.appends || {})) {
        for (const [p, k] of appendEntries(d[field], appendDepth(col, field))) {
          const w = keyWriter(col, field, k);
          if (w && !allowed.includes(w)) add('error', 'wrong-writer', `${ref}#${field}.${p}`, `appended by ${w}; ${field} is appended by ${allowed.join(', ')}`);
        }
      }
      if (cls === 'Fact' && known[ref] && known[ref] !== factHash(spec, col, d)) add('error', 'fact-changed', ref, 'its own fields changed since state/current hashed them; a Fact is written once (events go in its maps)');
      if (cap.documentBytes && size > cap.documentBytes) add('error', 'over-budget', ref, `${size} bytes; the budget is ${cap.documentBytes}`);
      if (col === 'materials' && cap.materialTextChars && String(d.text || '').length > cap.materialTextChars) add('error', 'over-budget', ref, `${String(d.text).length} characters of text; the cap is ${cap.materialTextChars} (chunk as ${cap.materialChunkId || '<id>-p<n>'})`);
    }
    const b = (cap.collections || {})[col] || {}; const n = (docs || []).length;
    if (b.failDocs != null && n >= b.failDocs) add('error', 'over-budget', col, `${n} documents; fails at ${b.failDocs}` + (b.relief ? ` (relief: ${b.relief})` : ''));
    else if (b.warnDocs != null && n >= b.warnDocs) add('warning', 'over-budget', col, `${n} documents; warns at ${b.warnDocs}` + (b.relief ? ` (relief: ${b.relief})` : ''));
    if (b.failBytes != null && total >= b.failBytes) add('error', 'over-budget', col, `${total} bytes; fails at ${b.failBytes}`);
    else if (b.warnBytes != null && total >= b.warnBytes) add('warning', 'over-budget', col, `${total} bytes; warns at ${b.warnBytes}`);
  }

  const rebuilt = rebuild(rec, spec);
  for (const r of rebuilt) {
    if (r.status === 'differs') {
      // Built by an earlier build, it may differ for that reason alone; its next run rebuilds it with today's code.
      const [col, ...rest] = r.ref.split('/'); const stored = (rec[col] || []).find(d => d.id === rest.join('/'));
      const runId = String((stored && stored.source) || '').split(' ').pop();
      const run = (rec.runs || []).find(x => x.id === runId);
      const built = run && run.commit;
      if (commit && built === commit) add('error', 'derived-differs', r.ref, 'rebuild does not reproduce it byte for byte');
      else if (commit) add('warning', 'derived-stale', r.ref, `built by ${built ? 'build ' + built.slice(0, 12) : 'an earlier build'}; differs from this build's rebuild until its next run`);
      else add('error', 'derived-differs', r.ref, 'rebuild does not reproduce it byte for byte');
    }
    else if (r.status === 'inexact-differs') add('info', 'derived-inexact', r.ref, `differs, but ${r.inexact.join(', ')} changed since it was built`);
    else if (r.status === 'skipped') add('info', 'not-rebuilt', r.ref, r.reason);
  }

  for (const i of EV.lint(rec, { date })) add(i.severity, i.code, i.ref, i.msg);
  const rank = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  return { issues, rebuilt };
}

export function formatLint({ issues, rebuilt }) {
  const n = s => issues.filter(i => i.severity === s).length;
  const same = rebuilt.filter(r => r.status === 'same' || r.status === 'inexact-same').length;
  const lines = [`lint: ${n('error') ? 'RED' : 'GREEN'} · ${n('error')} errors, ${n('warning')} warnings, ${n('info')} notes · rebuild reproduced ${same} of ${rebuilt.filter(r => r.status !== 'skipped').length} Derived documents`];
  for (const i of issues) lines.push(`  ${i.severity === 'error' ? 'NO ' : i.severity === 'warning' ? 'warn' : 'note'} ${i.code} ${i.ref}: ${i.msg}`);
  return lines.join('\n');
}
