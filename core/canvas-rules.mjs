// E.V. core's Canvas rules: the code side of the read-only sync (Central dates, graded flags, change detection).
// core/canvas.mjs is the browser side.
// Split from core/evcore.mjs (B-160, D-166) as one factory with no imports, so the same file runs in node (evcore.mjs
// imports it) and in the page (the build writes it into core.js ahead of E.V. core). It takes the core names it uses
// and returns the names core's export map uses.

export function makeCanvasRules(core) {
  'use strict';
  const {
    MATERIAL_KINDS,
    chicagoClock,
    chicagoDate,
    courseOf,
    courses,
    envelope,
    isoOf,
    kindsOf,
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
    // refused stays, empty, for the readers that list it (D-324: nothing is held as a patient identifier).
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
        text: String(f.text || '').slice(0, core.constants().library.maxChars),
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

  // ---------------------------------------------------------------- exams from the calendar (B-465)
  // A calendar entry that names an exam is an exam of its course, whichever course spec.courses names (D-099):
  // exams/<COURSE>.<yyyymmdd>, its kind from the title and the course's examKinds, its title and date the entry's. An
  // entry of kind exam names one when its title says exam, test, final or midterm; any other entry only when its title
  // says exam or midterm (a "TB test" or a "Final care plan" is not one); neither when the title is a review,
  // remediation, prep, practice, pre- or post-test, quiz, care plan, reflection or paper. Only entries with their own
  // course and a day today or later derive: an exam made is permanent (B-11), so a past or courseless one is never
  // guessed. An exam the record already holds for that course and day covers it (matched by course and date, or by the
  // entry it names), so nothing is written twice and no exam is ever overwritten. Matt's own Add exam in Study takes
  // the same shape.
  const EXAM_WORD = /\b(exam|test|final|midterm)s?\b/i;
  const EXAM_TITLE = /\b(exam|midterm)s?\b/i;
  const NOT_EXAM =
    /\b(review|remediation|prep|practice|study guide|sim|simulation|pre[- ]?tests?|post[- ]?tests?|quiz(zes)?|care plans?|reflections?|papers?)\b/i;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const KIND_WORDS = [
    ['lab', /\b(lab|practical)\b/i],
    ['final', /\bfinal\b/i],
    ['dosage', /\b(dosage|dose|calculation|math)\b/i],
    ['ati', /\bati\b/i],
  ];
  /** Whether a calendar entry names an exam: its title says so (widely for an entry of kind exam, only exam or midterm
   *  otherwise), and it is not a review of one. */
  const isExamDate = d =>
    !!d &&
    DAY.test(String(d.date || '')) &&
    (d.kind === 'exam' ? EXAM_WORD : EXAM_TITLE).test(d.title || '') &&
    !NOT_EXAM.test(d.title || '');
  /** The exam kinds a course may have (spec.courses.<course>.examKinds, the course by its aliases too); none for a
   *  name that is not a course. */
  const examKinds = course => kindsOf(courseOf({ course }), 'examKinds');
  /** An exam's kind from its title and its course's examKinds: lab, final, dosage or ati when the title says so and the
   *  course has that kind, else unit (else the course's first kind). */
  function examKindFor(title, course) {
    const kinds = examKinds(course);
    const hit = KIND_WORDS.find(([k, re]) => kinds.includes(k) && re.test(String(title || '')));
    return hit ? hit[0] : kinds.includes('unit') ? 'unit' : kinds[0] || null;
  }
  const examId = (course, date) => String(course).replace(/\s+/g, '') + '.' + String(date).replace(/-/g, '');
  /** One exams/<id> write (schema 2): done once its day has passed, upcoming otherwise. */
  function examWrite({ course, kind, title, date, dateId }, { now, today, writer = 'page', source }) {
    const data = {
      ...envelope(writer, source, now),
      schema: 2,
      course,
      kind,
      date,
      title,
      status: today && date < today ? 'done' : 'upcoming',
    };
    if (dateId) data.dateId = dateId;
    return { op: 'set', collection: 'exams', id: examId(course, date), data };
  }
  /** An exam's course: its own course field; else by its id (spec.collections.exams.key): <COURSE>.<yyyymmdd> names
   *  it, a letters- prefix (BIO-E3) names the one course whose name starts with those letters, and the rest (E1…E6,
   *  ATI-*) are the default course's. */
  function examCourse(e) {
    if (e.course) return courseOf(e);
    const id = String(e.id || '');
    const compact = s => String(s).replace(/\s+/g, '').toLowerCase();
    const dated = id.match(/^(.+)\.\d{8}$/);
    if (dated) return courses().find(c => compact(c) === compact(dated[1])) || null;
    const lead = id.match(/^([A-Za-z]+)-/);
    if (lead) {
      const hit = courses().filter(c => compact(c).startsWith(lead[1].toLowerCase()));
      if (hit.length === 1) return hit[0];
    }
    return courseOf({});
  }
  const coveredBy = (exams, course, d) =>
    (exams || []).some(e => e && ((d.id && e.dateId === d.id) || (e.date === d.date && examCourse(e) === course)));
  /**
   * The exams the calendar names that the record has no exam for yet, as writes (set exams/<id>), one per course and
   * day. dates and dateedits as read (an entry taken off names nothing); exams as read; today the Central date; skip
   * the ids already written this load. The page runs these when the record arrives and when a date or an exam changes.
   */
  function examsFromDates({ dates, dateedits, exams, now, today, writer = 'page', skip } = {}) {
    const out = [];
    if (!today) return out; // only today or later derives, so no today means nothing
    const skipped = new Set(skip || []);
    for (const d of liveDates(dates, dateedits)
      .filter(d => isExamDate(d) && d.date >= today && d.course)
      .sort((a, b) => a.date.localeCompare(b.date))) {
      const course = courseOf(d); // its own course: courseless entries are filtered out above
      if (!examKinds(course).length || coveredBy(exams, course, d) || skipped.has(examId(course, d.date))) continue;
      if (out.some(w => w.data.date === d.date && w.data.course === course)) continue;
      out.push(
        examWrite(
          { course, kind: examKindFor(d.title, course), title: d.title, date: d.date, dateId: d.id },
          { now, today, writer, source: 'From the calendar' }
        )
      );
    }
    return out;
  }
  /** His Add exam in Study: {course, title, date, kind?} as one exams/<id> write, or a reason he can read. Never over
   *  an exam the record has for that course and day. */
  function examAdd(exams, add, { now, today } = {}) {
    const text = (v, n) =>
      String(v == null ? '' : v)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, n);
    const course = courseOf(add || {});
    const kinds = examKinds(course);
    if (!kinds.length) throw new Error('which course?');
    const date = text(add.date, 10);
    if (!DAY.test(date)) throw new Error('date must be YYYY-MM-DD');
    const title = text(add.title, 120);
    if (!title) throw new Error('title is required');
    const same = (exams || []).find(e => e && e.date === date && courseOf(e) === course);
    if (same) throw new Error(`${course} already has an exam on ${shortDate(date)}: ${same.title || same.id}`);
    const kind = kinds.includes(add.kind) ? add.kind : examKindFor(title, course);
    return examWrite({ course, kind, title, date }, { now, today, writer: 'page', source: 'Added by Matt' });
  }

  return { normalizeCanvas, isExamDate, examKinds, examKindFor, examCourse, examsFromDates, examAdd };
}
