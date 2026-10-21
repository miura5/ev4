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
    for (const i of db.ideas || [])
      files.push({
        path: `ideas/${i.id}.md`,
        content:
          fm({ status: i.status, objective: i.objective }) +
          `# Idea\n\n${i.text}\n\n${(i.links || []).map(l => `- ${l.type}: [[${l.to}]]`).join('\n')}\n`,
      });
    files.push({
      path: 'index.md',
      content: `# E.V. record mirror\n\nRead-only copy written by the evening pipeline${date ? ' on ' + date : ''}. Edit in E.V. Home, not here.\n\n- Weak spots: ${ws.length}\n- Objectives: ${(db.objectives || []).length}\n- Sessions: ${(db.sessions || []).length}\n- Ideas: ${(db.ideas || []).length}\n`,
    });
    return files;
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

  return { toMarkdown, buildBackup, restorePlan };
}
