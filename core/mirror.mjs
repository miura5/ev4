// E.V. core's copies of the record: the read-only Markdown mirror (for Obsidian) and the backup with its restore plan.
// Split from core/evcore.mjs (B-160, D-166) as one factory with no imports, so the same file runs in node (evcore.mjs
// imports it) and in the page (the build writes it into core.js ahead of E.V. core). It takes the core names it uses
// and returns the names core's export map uses.

export function makeMirror(core) {
  'use strict';
  const { buildWeakspots, chicagoDate, examOf, examViews, shortDate, isoOf } = core;

  // ---------------------------------------------------------------- Markdown mirror (read-only, for Obsidian)
  function toMarkdown(db, { date } = {}) {
    const files = [];
    const ws =
      db.weakspotModels ||
      buildWeakspots({
        weakspots: db.weakspots || [],
        sets: db.sets || [],
        answers: db.answers || [],
        exams: db.exams || [],
      });
    const link = (folder, id, label) => `[[${folder}/${id}|${String(label || id).replace(/[|\]\[]/g, ' ')}]]`;
    const fm = obj =>
      '---\n' +
      Object.entries(obj)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join('\n') +
      '\n---\n\n';
    for (const w of ws)
      files.push({
        path: `weak-spots/${w.id}.md`,
        content:
          fm({
            kind: w.kind,
            status: w.derived.status,
            objective: w.objective,
            exam: examOf(w),
            nextDue: w.derived.nextDue,
            streak: w.derived.streak,
            recurrence: w.derived.recurrence,
          }) +
          `# ${w.topic}\n\n- Objective: ${w.objective ? link('objectives', w.objective, w.objective) : 'none'}\n- Source: ${w.source}\n- Added: ${shortDate(w.addedAt)}\n` +
          (w.derived.history.length
            ? `\n## History\n\n${w.derived.history.map(h => `- ${h.date}: ${h.correct ? 'right' : 'missed'}`).join('\n')}\n`
            : ''),
      });
    for (const o of db.objectives || [])
      files.push({
        path: `objectives/${o.id}.md`,
        content:
          fm({ exam: o.exam }) +
          `# ${o.id}: ${o.text}\n\n${o.chapters || ''}\n\n## Weak spots\n\n${
            ws
              .filter(w => w.objective === o.id)
              .map(w => '- ' + link('weak-spots', w.id, w.topic) + ` (${w.derived.status})`)
              .join('\n') || '- none'
          }\n`,
      });
    for (const e of examViews(db.exams, db.examedits, db.predictions))
      files.push({
        path: `exams/${e.id}.md`,
        content:
          fm({ date: e.date, course: e.course, kind: e.kind, score: e.score }) +
          `# ${e.title}\n\n${(db.objectives || [])
            .filter(o => o.exam === e.id)
            .map(o => '- ' + link('objectives', o.id, o.id + ' ' + o.text))
            .join('\n')}\n`,
      });
    for (const s of db.sessions || [])
      files.push({
        path: `sessions/${s.id}.md`,
        content:
          fm({ date: s.date, minutes: s.minutes, source: s.source }) +
          `# ${s.topic || 'Study session'}\n\n${s.summary || ''}\n`,
      });
    // D-113 (B-62): the mirror holds the journal too, when the run read it.
    for (const j of db.journal || [])
      files.push({
        path: `journal/${j.id}.md`,
        content:
          fm({ kind: j.kind, date: j.createdAt ? chicagoDate(j.createdAt) : null }) +
          `# Journal${j.createdAt ? ': ' + shortDate(chicagoDate(j.createdAt)) : ''}\n\n${j.text || ''}\n`,
      });
    // B-401 (D-325): his notes, each as Markdown made from its blocks. Stored text is escaped so it is never markup or
    // HTML here; archived and discarded notes are kept and marked in their front matter (nothing is deleted).
    for (const n of db.notes || [])
      files.push({
        path: `notes/${n.id}.md`,
        content:
          fm({
            course: n.course,
            label: n.label,
            created: n.createdAt,
            edited: n.editedAt,
            earlierOf: n.earlierOf,
            archived: n.archivedAt,
            discarded: n.discardedAt,
          }) + noteMarkdown(n),
      });
    for (const i of db.ideas || [])
      files.push({
        path: `ideas/${i.id}.md`,
        content:
          fm({ status: i.status, objective: i.objective }) +
          `# Idea\n\n${i.text}\n\n${(i.links || []).map(l => `- ${l.type}: [[${l.to}]]`).join('\n')}\n`,
      });
    files.push({
      path: 'index.md',
      content: `# E.V. record mirror\n\nRead-only copy written by the evening pipeline${date ? ' on ' + date : ''}. Edit in E.V. Home, not here.\n\n- Weak spots: ${ws.length}\n- Objectives: ${(db.objectives || []).length}\n- Sessions: ${(db.sessions || []).length}\n- Ideas: ${(db.ideas || []).length}\n${db.notes ? `- Notes: ${db.notes.length}\n` : ''}`,
    });
    return files;
  }

  // ---------------------------------------------------------------- notes as Markdown (B-401, D-325)
  // Text is escaped: a character Markdown or HTML would read as markup is written with a backslash, so a note never
  // becomes markup it did not ask for. Underline has no Markdown form and is written as plain text.
  const mdEscape = s => String(s == null ? '' : s).replace(/([\\`*_~[\]<>#|])/g, '\\$1');
  function runsMarkdown(runs) {
    return (runs || [])
      .map(r => {
        const raw = String((r && r.text) || '').replace(/\s*\n\s*/g, ' ');
        if (!raw) return '';
        // marks wrap the text inside its spaces, so ** never sits next to a space
        const [, lead, core, trail] = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
        if (!core) return raw;
        let s = mdEscape(core);
        if (r.s) s = `~~${s}~~`;
        if (r.i) s = `*${s}*`;
        if (r.b) s = `**${s}**`;
        if (r.href && /^https?:\/\/[^\s<>"()]+$/.test(r.href)) s = `[${s}](${r.href})`;
        return lead + s + trail;
      })
      .join('');
  }
  function noteMarkdown(n) {
    const out = [];
    // his title heads the file unless the body opens with its own first heading
    const title = String(n.title || '').trim();
    if (title && !(n.blocks || []).some(b => b.type === 'h1')) out.push(`# ${mdEscape(title)}`, '');
    let num = 0;
    let prev = null;
    for (const b of n.blocks || []) {
      const text = runsMarkdown(b.runs);
      const pad = '  '.repeat(Math.max(0, Math.min(6, b.indent || 0)));
      const list = b.type === 'ul' || b.type === 'ol' || b.type === 'todo';
      // a blank line between blocks, but not between items of one list
      if (out.length && out[out.length - 1] !== '' && !(list && b.type === prev)) out.push('');
      num = b.type === 'ol' ? (prev === 'ol' ? num + 1 : 1) : 0;
      if (b.type === 'h1') out.push(`# ${text}`);
      else if (b.type === 'h2') out.push(`## ${text}`);
      else if (b.type === 'h3') out.push(`### ${text}`);
      else if (b.type === 'ul') out.push(`${pad}- ${text}`);
      else if (b.type === 'ol') out.push(`${pad}${num}. ${text}`);
      else if (b.type === 'todo') out.push(`${pad}- [${b.checked ? 'x' : ' '}] ${text}`);
      else out.push(text);
      prev = b.type;
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n') + '\n';
  }

  // ---------------------------------------------------------------- backup
  function buildBackup(collections, { now, label, release } = {}) {
    const counts = {};
    for (const [k, v] of Object.entries(collections)) counts[k] = (v || []).length;
    return {
      schema: 1,
      kind: 'E.V. record backup',
      label: label || null,
      at: isoOf(now),
      release: release || null, // B-149: the run's own release, given by its caller
      counts,
      collections,
    };
  }
  function restorePlan(backup) {
    const writes = [];
    for (const [col, docs] of Object.entries(backup.collections || {}))
      for (const d of docs || []) {
        const { id, ...data } = d;
        writes.push({ op: 'set', collection: col, id, data });
      }
    return writes;
  }

  return { toMarkdown, noteMarkdown, buildBackup, restorePlan };
}
