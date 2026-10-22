// E.V. core's Canvas rules: the code side of the read-only sync (Central dates, graded flags, change detection, the
// identifier refusal at the door). core/canvas.mjs is the browser side.
// Split from core/evcore.mjs (B-160, D-166) as one factory with no imports, so the same file runs in node (evcore.mjs
// imports it) and in the page (the build writes it into core.js ahead of E.V. core). It takes the core names it uses
// and returns the names core's export map uses.

export function makeCanvasRules(core) {
  'use strict';
  const {
    MATERIAL_KINDS,
    chicagoClock,
    chicagoDate,
    envelope,
    isoOf,
    liveDates,
    materialKind,
    shortDate,
    similarity,
    stripHtml,
  } = core;

  // ---------------------------------------------------------------- Canvas (code side of the read-only sync)
  function canvasKind(p) {
    const type = p.plannable_type || p.type || '';
    const title = (p.plannable && p.plannable.title) || p.title || '';
    if (/\bexam\b/i.test(title) || (type === 'quiz' && /\btest\b/i.test(title))) return 'exam';
    if (type === 'calendar_event') return 'other';
    return 'due';
  }
  /** Turns raw Canvas JSON (from the browser fetch script) into record documents, with change detection. */
  function normalizeCanvas(raw, existing = {}, { now } = {}) {
    const at = isoOf(now);
    const env = () => envelope('canvas-sync', 'Canvas sync', at);
    const out = { dates: [], announcements: [], materials: [], changes: [], candidates: [], refused: [] };
    // The Canvas ingress (Data architecture, "Four ingresses, one scanner"), B-197: the door no longer refuses a text
    // with what looks like an identifier value. A case study or a sim's client in a course file is practice; the run's
    // identifier stage (core/run.mjs) sees every write this sync plans, judges each candidate with the words around it
    // and holds back only a value that could be a real patient's. refused stays, empty, for the readers that list it.
    const courseName = id => {
      for (const [n, cid] of Object.entries(raw.courses || {})) if (Number(cid) === Number(id)) return n;
      return null;
    };
    const prev = (col, id) => (existing[col] || []).find(d => d.id === id) || null;
    for (const p of raw.planner || []) {
      if (!p || p.plannable_type === 'announcement') continue;
      const course = courseName(p.course_id);
      if (!course) continue;
      const title = String((p.plannable && p.plannable.title) || p.title || 'Untitled').trim();
      const dueAt = (p.plannable && (p.plannable.due_at || p.plannable.todo_date)) || p.plannable_date || null;
      if (!dueAt) continue;
      // A date already in the record for this Canvas item (hand-entered or synced) is updated in place, never duplicated.
      const old =
        (existing.dates || []).find(d => String(d.canvasId) === String(p.plannable_id)) ||
        prev('dates', 'canvas-' + p.plannable_id);
      const id = old ? old.id : 'canvas-' + p.plannable_id;
      const points = p.plannable && p.plannable.points_possible;
      const date = chicagoDate(dueAt);
      const graded =
        ['assignment', 'quiz', 'discussion_topic'].includes(p.plannable_type) ||
        (typeof points === 'number' && points > 0);
      const dueWords = `Due ${chicagoClock(dueAt) === '23:59' ? '11:59pm' : chicagoClock(dueAt)}`;
      if (old) {
        if (old.dueAt === dueAt && old.date === date) continue;
        out.dates.push({ id, op: 'update', data: { date, dueAt, canvasId: p.plannable_id, syncedAt: at } });
        out.changes.push({
          type: 'changed-date',
          ref: 'dates/' + id,
          text: `Changed on Canvas: ${old.title || title} now ${shortDate(date)}${old.date && old.date !== date ? ' (was ' + shortDate(old.date) + ')' : ''}`,
        });
        continue;
      }
      const doc = {
        ...env(),
        date,
        dueAt,
        title,
        course,
        kind: canvasKind(p),
        graded,
        canvasType: p.plannable_type,
        canvasId: p.plannable_id,
        syncedAt: at,
      };
      if (graded) doc.notes = `${dueWords}. Graded.`;
      out.dates.push({ id, op: 'set', data: doc });
      out.changes.push({ type: 'new-date', ref: 'dates/' + id, text: `New on Canvas: ${title} (${shortDate(date)})` });
      for (const d of liveDates(existing.dates, existing.dateedits))
        if (d.date === date && d.id !== id && !d.canvasId && d.kind === doc.kind && similarity(d.title, title) < 0.3)
          out.candidates.push({
            a: 'dates/' + d.id,
            b: 'dates/' + id,
            why: `two ${doc.kind} items on ${shortDate(date)} with different titles`,
          });
    }
    for (const a of raw.announcements || []) {
      const id = 'canvas-' + a.id;
      if (prev('announcements', id)) continue;
      const course = courseName(String(a.context_code || '').replace('course_', '')) || a.course || null;
      const text = a.message != null ? stripHtml(a.message) : String(a.text || '');
      out.announcements.push({
        id,
        data: {
          ...env(),
          course,
          title: a.title || '',
          postedAt: a.posted_at || a.postedAt || null,
          text: text.slice(0, 6000),
          url: a.html_url || a.url || null,
          syncedAt: at,
        },
      });
      out.changes.push({
        type: 'new-announcement',
        ref: 'announcements/' + id,
        text: `${course || 'Canvas'} announcement: ${a.title}`,
      });
    }
    for (const f of raw.files || []) {
      const course = f.course || courseName(f.courseId);
      const key = String(course || 'X').replace(/\s+/g, '');
      const id = key + '-' + f.fileId;
      const old = prev('materials', id);
      if (old && old.fileUpdatedAt === f.updatedAt) continue;
      const exam =
        f.exam ||
        ((String(f.module || '').match(/\bExam\s+(\d+)/i) || [])[1]
          ? 'E' + String(f.module).match(/\bExam\s+(\d+)/i)[1]
          : null);
      const kind = MATERIAL_KINDS.includes(f.kind) ? f.kind : materialKind({ title: f.title });
      const needsOcr =
        !!f.needsOcr ||
        String(f.text || '')
          .replace(/\[(?:p|s)\d+\]/g, '')
          .trim().length < 200;
      const data = {
        ...env(),
        course,
        kind,
        exam,
        unit: (String(f.module || '').match(/\bUnit\s+\d+/i) || [])[0] || null,
        module: f.module || null,
        section: f.section || null,
        title: f.title || '',
        fileType: f.fileType || 'pdf',
        fileId: f.fileId,
        fileUpdatedAt: f.updatedAt || null,
        url: raw.host && f.courseId ? `${raw.host}/courses/${f.courseId}/files/${f.fileId}` : null,
        pages: f.pages || null,
        chars: (f.text || '').length,
        text: String(f.text || '').slice(0, core.C.library.maxChars),
        needsOcr,
        fetchedAt: at,
      };
      // A file read earlier from page images keeps that reading until the new version is read again.
      if (needsOcr && old && old.ocr && old.text) {
        data.text = old.text;
        data.ocr = { ...old.ocr, stale: true };
      }
      out.materials.push({ id, data });
      out.changes.push({
        type: old ? 'changed-file' : 'new-file',
        ref: 'materials/' + id,
        text: `${old ? 'Updated' : 'New'} ${kind === 'slides' ? 'slides' : kind + ' file'}: ${f.title}${needsOcr && !data.ocr ? ' (image-only: attach it in the conversation and E.V. will read it)' : ''}`,
      });
    }
    return out;
  }

  return { normalizeCanvas };
}
