// E.V. core's study plans (B-449, D-354, D-356): a course's current section, the material a plan ask gets, Matt's
// instructions (settings/study-plan, else the default the spec carries), the checks on a plan the model made, and the
// patch an edit ask returns. One factory with no imports, as core's other sections: the same file runs in node
// (evcore.mjs imports it) and in the page (the build writes it into core.js ahead of E.V. core).
// The plan itself is the model's: code picks the window and the material, reads the model's own rubric score, keeps
// what the record can check (dates, refs, ids, the window) and never judges the plan's content.

export function makeStudyPlans(core) {
  'use strict';
  const {
    addDays,
    liveDates,
    liveMaterials,
    libraryChunks,
    libraryIndex,
    searchLibrary,
    isActive,
    examViews,
    planDrafts,
    planViews,
    taskDone,
    editBase,
  } = core;
  /** D-357: a study plan task's one tag, from this set (the answer shapes and plans.schema hold it); planDay shows each on
   * Today upper-cased with its dash a space (GRADED ... CLINICAL PREP, SKILLS PREP). */
  const TAGS = ['graded', 'learn', 'practice', 'review', 'clinical-prep', 'skills-prep'];

  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  /** A course name as compared: letters and digits only, any case, so spacing and dashes never split a course. */
  const courseKey = s =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  const sameCourse = (a, b) => !!courseKey(a) && courseKey(a) === courseKey(b);
  const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id));
  /** spec.jobs.kinds['exam-plan']: its plan rules, instructions and answer shapes. */
  const kindOf = spec => (spec && spec.jobs && spec.jobs.kinds && spec.jobs.kinds['exam-plan']) || {};
  const rulesOf = spec => ({
    purpose: 'exam-plan',
    maxTokens: 24000,
    pass: 85,
    floor: 3,
    pastDays: 3,
    passages: 8,
    notes: 6,
    noteChars: 400,
    materials: 60,
    lookups: 3,
    ...(kindOf(spec).plan || {}),
  });

  // ---------------------------------------------------------------- his instructions (settings/study-plan)
  /** The instructions a plan follows: his (settings/study-plan) when he wrote some, else the spec's default. */
  function studyPlanInstructions(settings, spec) {
    const own = settings && typeof settings.instructions === 'string' ? settings.instructions.trim() : '';
    const missing = settings && settings.missing === 'note' ? 'note' : 'ask';
    return own
      ? { text: own, from: 'settings', missing }
      : { text: String(kindOf(spec).instructions || ''), from: 'default', missing };
  }
  /**
   * The page's write of settings/study-plan (an Edit, replaced whole): `change` is his instructions (a string; blank
   * or null goes back to the default) or {instructions?, missing?, approved?}; what it leaves out stays as it was.
   * missing: when something is missing, 'ask' him one question or 'note' it as an open question and go on;
   * approved: an approved plan's tasks go to 'today' or stay in the 'plan' (B-450's options).
   */
  function studyPlanSettingsWrite(existing, change, { now } = {}) {
    const c = change !== null && typeof change === 'object' ? change : { instructions: change };
    const data = { ...editBase(existing, now), schema: 1 };
    if ('instructions' in c || !existing) {
      const text = c.instructions == null ? '' : String(c.instructions).replace(/\r\n?/g, '\n').trim();
      if (text.length > 40000) throw new Error('the instructions are over 40,000 characters');
      data.instructions = text || null;
    }
    if (c.missing !== undefined) {
      if (!['ask', 'note'].includes(c.missing)) throw new Error('missing: ask or note');
      data.missing = c.missing;
    }
    if (c.approved !== undefined) {
      if (!['today', 'plan'].includes(c.approved)) throw new Error('approved: today or plan');
      data.approved = c.approved;
    }
    return { id: 'study-plan', data };
  }
  /** The rubric's hard rules in a set of instructions (its "Hard rules" section), else the default's (D-356). */
  function studyPlanHardRules(text, spec) {
    const cut = t => {
      const m = /^##[^\n]*hard rules[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/im.exec(String(t || ''));
      return m ? m[1].trim() : '';
    };
    return cut(text) || cut(kindOf(spec).instructions) || '';
  }
  /** A "## <name>" section of a set of instructions, its body trimmed; '' when there's none. */
  const sectionOf = (t, name) => {
    const m = new RegExp(`^##[^\\n]*${name}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'im').exec(String(t || ''));
    return m ? m[1].trim() : '';
  };
  /**
   * B-449 (D-356): what an edit ask gets of his instructions, in its cached prefix: the hard rules; how a skills ladder
   * and the day's load are laid (the lines of the approach and of how a section is built that name a ladder or the
   * load); and the re-planning triggers. Each part from his instructions, else the default's. An added revalidation
   * ladder then runs first look, guided, solo and checked mocks, backward from its date, inside the load.
   */
  function studyPlanEditRules(text, spec) {
    const def = kindOf(spec).instructions;
    const lines = t =>
      ['approach', 'builds a section']
        .flatMap(n => sectionOf(t, n).split('\n'))
        .filter(l => /\b(skills? ladder|ladder|load|catch-up)\b/i.test(l))
        .map(l => l.trim())
        .join('\n');
    const parts = [
      ['The hard rules', studyPlanHardRules(text, spec)],
      ['How a skills ladder and the load are laid', lines(text) || lines(def)],
      ['When to re-plan', sectionOf(text, 're-planning') || sectionOf(def, 're-planning')],
    ];
    return parts
      .filter(([, body]) => body)
      .map(([h, body]) => `${h}:\n${body}`)
      .join('\n\n');
  }

  // ---------------------------------------------------------------- the section
  /** The exam a job's words name: its id as a word, or its title. */
  function namedExam(q, exams) {
    const low = String(q || '').toLowerCase();
    return (
      (exams || []).find(
        e =>
          new RegExp(`\\b${String(e.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q) ||
          (e.title && low.includes(String(e.title).toLowerCase()))
      ) || null
    );
  }
  /** The course an exam-plan job is for: its course field, else the course of the exam its words name, else a course
   * its words name; null when none. */
  function studyPlanCourse(job, exams) {
    const list = exams || [];
    const courses = [...new Set(list.map(e => e.course).filter(Boolean))];
    if (job && job.course) return courses.find(c => sameCourse(c, job.course)) || String(job.course);
    const q = `${(job && job.title) || ''} ${(job && job.brief) || ''}`;
    const ex = namedExam(q, list);
    if (ex && ex.course) return ex.course;
    const k = courseKey(q);
    return courses.find(c => k.includes(courseKey(c))) || null;
  }
  /**
   * B-449: a course's current section, with its exams as landmarks: from the later of today and the day after the
   * course's last exam before the section's exam, through that exam (the one named, else the next on or after today).
   * {course, from, to, exam: {id, title, date}, lastExam} or null when no exam of the course is ahead.
   */
  function studyPlanSection({ exams, course, date, examId = null }) {
    const mine = (exams || []).filter(e => e && DAY.test(String(e.date || '')) && sameCourse(e.course, course));
    mine.sort(byDate);
    const exam = examId ? mine.find(e => e.id === examId && e.date >= date) : mine.find(e => e.date >= date);
    if (!exam) return null;
    const last = mine.filter(e => e.date < exam.date).pop() || null;
    const after = last ? addDays(last.date, 1) : date;
    return {
      course: exam.course,
      from: after > date ? after : date,
      to: exam.date,
      exam: { id: exam.id, title: exam.title || exam.id, date: exam.date },
      lastExam: last ? { id: last.id, title: last.title || last.id, date: last.date } : null,
    };
  }

  // ---------------------------------------------------------------- the material
  const noteWords = n =>
    ((n && n.blocks) || [])
      .map(b => ((b && b.runs) || []).map(r => (r && r.text) || '').join(''))
      .filter(Boolean)
      .join('\n');
  const datesRow = d => ({
    id: d.id,
    date: d.date,
    course: d.course || null,
    kind: d.kind,
    title: d.title,
    graded: !!d.graded,
    ...(d.dueAt ? { dueAt: d.dueAt } : {}),
    ...(d.notes ? { notes: String(d.notes).slice(0, 400) } : {}),
  });
  /** A plan as the asks see it: its section, key dates, open questions and days of tasks, nothing of the envelope. */
  const planBrief = p => ({
    id: p.id,
    exam: p.exam,
    title: p.title || '',
    ...(p.section ? { section: p.section } : {}),
    ...(p.keyDates ? { keyDates: p.keyDates } : {}),
    ...(p.openQuestions ? { openQuestions: p.openQuestions } : {}),
    days: (p.days || []).map(d => ({ date: d.date, ...(d.label ? { label: d.label } : {}), tasks: d.tasks || [] })),
  });

  /**
   * The context of one exam-plan job (B-449, D-356) over the record (the run's db, arrays of documents):
   *   make: the section, the window's dated items of both courses with ids (and pastDays past the exam), the exams in
   *         it, the exam's objectives, the course's materials index and passages, short note excerpts, active weak
   *         spots, past scores and the day budget;
   *   edit (job.revise names a plan): the draft, the section and his request only; materials and dates are read by id
   *         through the lookup when the request needs one.
   * {mode, refused?} when the job can't be planned.
   */
  function studyPlanContext(db, { date, job, spec, models = [], constants = {} }) {
    const R = rulesOf(spec);
    const plans = db.plans || [];
    if (job && job.revise) {
      const draft = plans.find(p => p.id === job.revise) || null;
      if (!draft) return { mode: 'edit', refused: `there's no plan ${job.revise} in your record to change` };
      return {
        mode: 'edit',
        section: draft.section || null,
        draft: planBrief(draft),
        changes: String(job.brief || ''),
      };
    }
    const course = studyPlanCourse(job, db.exams);
    if (!course) return { mode: 'make', refused: 'which course to plan isn’t clear: name the course in the ask' };
    const q = `${(job && job.title) || ''} ${(job && job.brief) || ''}`;
    const named = namedExam(q, db.exams);
    const section = studyPlanSection({
      exams: db.exams,
      course,
      date,
      examId: named && sameCourse(named.course, course) ? named.id : null,
    });
    if (!section)
      return { mode: 'make', course, refused: `there’s no ${course} exam ahead on your calendar to plan toward` };
    const end = addDays(section.to, R.pastDays);
    const inWindow = d => d >= section.from && d <= end;
    const dates = liveDates(db.dates, db.dateedits)
      .filter(d => DAY.test(String(d.date || '')) && inWindow(d.date))
      .sort(byDate)
      .map(datesRow);
    const exams = (db.exams || [])
      .filter(e => DAY.test(String(e.date || '')) && inWindow(e.date))
      .sort(byDate)
      .map(e => ({ id: e.id, course: e.course || null, title: e.title || e.id, date: e.date, kind: e.kind || null }));
    const objectives = (db.objectives || [])
      .filter(o => o.exam === section.exam.id)
      .map(o => ({ id: o.id, text: o.text, ...(o.chapters ? { chapters: o.chapters } : {}) }));
    const mats = liveMaterials(db.materials, db.materialedits).filter(
      m => sameCourse(m.course, course) && !(m.needsOcr && !m.ocr)
    );
    const materials = [...mats]
      .sort(
        (a, b) =>
          (b.exam === section.exam.id) - (a.exam === section.exam.id) || String(a.title).localeCompare(String(b.title))
      )
      .slice(0, R.materials)
      .map(m => ({
        ref: 'materials/' + m.id,
        title: m.title,
        ...(m.kind ? { kind: m.kind } : {}),
        ...(m.module ? { module: m.module } : {}),
        ...(m.exam ? { exam: m.exam } : {}),
        ...(m.unit ? { unit: m.unit } : {}),
        ...(m.pages ? { pages: m.pages } : {}),
      }));
    const idx = libraryIndex(libraryChunks(mats));
    const query = [section.exam.title, ...objectives.map(o => o.text)].join(' ');
    const passages = searchLibrary(idx, query, { k: R.passages }).map(h => ({
      ref: 'materials/' + h.id,
      page: h.page || null,
      title: h.title,
      text: String(h.text || '').slice(0, 600),
    }));
    const notes = (db.notes || [])
      .filter(n => sameCourse(n.course, course) && !n.archivedAt && !n.discardedAt && !n.earlierOf) // not a kept earlier version
      .sort((a, b) => String(b.editedAt || b.at || '').localeCompare(String(a.editedAt || a.at || '')))
      .slice(0, R.notes)
      .map(n => ({
        ref: 'notes/' + n.id,
        title: n.title || '',
        ...(n.label ? { label: n.label } : {}),
        excerpt: noteWords(n).slice(0, R.noteChars),
      }));
    const weakSpots = (models || [])
      .filter(w => isActive(w) && (sameCourse(w.course, course) || w.exam === section.exam.id))
      .slice(0, 25)
      .map(w => ({ id: w.id, topic: w.topic, objective: w.objective || null }));
    const scores = examViews(db.exams || [], db.examedits || [], db.predictions || [])
      .filter(e => sameCourse(e.course, course) && typeof e.score === 'number')
      .sort(byDate)
      .map(e => ({ id: e.id, title: e.title || e.id, date: e.date, score: e.score }));
    const progress = studyPlanProgress(db, { date, examId: section.exam.id, models });
    return {
      mode: 'make',
      section,
      ...(progress ? { progress } : {}),
      dates,
      exams,
      objectives,
      materials,
      passages,
      notes,
      weakSpots,
      scores,
      budget: {
        dayMinutes: constants.dayBudgetMinutes || null,
        taskMinutes: constants.taskMinutes || null,
      },
    };
  }

  /**
   * B-449: a new plan when the exam already has one starts from today and carries that plan's progress: its tasks
   * done, the past ones missed, how many are left, and the weak spots opened since it was made. null when the exam
   * has no plan. The plan in force, else its newest draft.
   */
  function studyPlanProgress(db, { date, examId, models = [] }) {
    const plans = db.plans || [];
    const plan =
      planViews(plans, db.planedits || []).find(p => (p.exam || p.id) === examId) ||
      (planDrafts(plans, db.planedits || [], examId) || [])[0] ||
      null;
    if (!plan) return null;
    const row = t => ({ id: t.id, date: t.date, text: t.text });
    const tasks = (plan.days || []).flatMap(d => (d.tasks || []).map(t => ({ ...t, date: d.date })));
    const isDone = t => taskDone(plan, t, date, db.sets || [], db.answers || []);
    const since = String(plan.at || '');
    return {
      plan: plan.id,
      done: tasks.filter(isDone).slice(0, 60).map(row),
      missed: tasks
        .filter(t => t.date < date && !isDone(t))
        .slice(0, 60)
        .map(row),
      left: tasks.filter(t => t.date >= date && !isDone(t)).length,
      newWeakSpots: (models || [])
        .filter(w => isActive(w) && since && String(w.addedAt || w.at || '') > since)
        .slice(0, 20)
        .map(w => ({ id: w.id, topic: w.topic })),
    };
  }

  // D-362 (B-449, B-456): chat words never start a new (Sonnet) plan: every plan ask in chat is a Haiku edit of the
  // plan he has. This check only decides whether E.V. offers the "Make a new <course> plan" chip beside her reply,
  // and it is conservative: a plain whole-plan ask with nothing that points at one task, day or time, and no "not".
  /** His words folded: one case, curly quotes straight, quotes, "please" and chat shorthand gone, spaces single. */
  const fold = t =>
    ` ${String(t || '')} `
      .toLowerCase()
      .replace(/[‘’`´]/g, "'")
      .replace(/["“”]/g, ' ')
      .replace(/\b(please|pls|plz|thanks|thx|asap)\b/g, ' ')
      .replace(/\bu\b/g, 'you')
      .replace(/\s+/g, ' ')
      .trim();
  const WHOLE_PLAN = new RegExp(
    '\\b(' +
      [
        're-?plan(ning)?( (it|everything|the (whole )?plan|my (whole )?plan))?( (for|around|because|since)\\b.*)?$',
        'start(ing)? (over|again|fresh)',
        'from scratch',
        '(make|need|want|build|give) (me )?(a )?(new|fresh|whole new) (study )?plan',
        'cram(ming)? (plan|schedule|mode)',
        'cram(ming)? for (the|my|this) ([\\w-]+ )?(exam|test|final|midterm|assessment)',
        "(re-?make|re-?do|re-?write|re-?work|re-?build|scrap) (everything|the whole thing|((the|my|this|that) )?([\\w-]+ ){0,2}(plan|schedule))(?![\\w'])",
      ].join('|') +
      ')',
    'i'
  );
  /** Words that point at one task, a day or a time, or say not: then no chip is offered. */
  const ONE_TASK =
    /\b(not (the |a |my )?(whole|entire|all|everything|plan)|just|only|drills?|quiz|quizzes|blocks?|mocks?|readings?|preview|session|task|lecture|sim|module|flashcards?|cards|terms|terminology|slot|labs?|runs?|checklist|chapter|ch|catch-up|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tonight|tomorrow|morning|afternoon|evening|week|weekend|\d+ ?(min|mins|minutes|hours?|hrs?))\b|plan's|\d+\/\d+/;
  /** D-362: whether his words plainly ask for a whole new plan (E.V. then offers the chip; it never starts one). */
  function studyPlanLooksNew(words) {
    const w = fold(words);
    return WHOLE_PLAN.test(w) && !ONE_TASK.test(w);
  }
  /**
   * D-362: what a study plan ask in chat does. `said` is his own line; `brief` is the chat model's. edit: the Haiku
   * change of the plan he has ({course, revise, said}: his line rides on the job, so the edit's own chip offer carries
   * his words), or null when he has none (chat never starts a new plan). offer: the Make a new <course> plan chip (a
   * newplan card whose brief is his line, never the model's) when he typed a line and has no plan yet or his line
   * plainly asks for a whole new one; null when there is no line of his (a retry, a read-along), whatever the brief.
   */
  function studyPlanChatAsk({ said = '', brief = '', title = '', exams, plansRaw, planedits, date }) {
    const his = chipBrief(said);
    const course = studyPlanCourse({ title, brief: `${his} ${brief}` }, exams);
    const sec = course && studyPlanSection({ exams, course, date });
    const cur =
      (sec &&
        (latestPlanDraft(plansRaw, planedits, sec.exam.id) ||
          planViews(plansRaw || [], planedits || []).find(p => (p.exam || p.id) === sec.exam.id))) ||
      null;
    const offer =
      sec && his && (!cur || studyPlanLooksNew(his)) ? { type: 'newplan', course: sec.course, brief: his } : null;
    return {
      course: sec ? sec.course : course,
      edit: cur ? { course: sec.course, revise: cur.id, ...(his ? { said: his } : {}) } : null,
      offer,
    };
  }
  const chipBrief = b =>
    String(b || '')
      .trim()
      .slice(0, 1500);
  /** D-362: the job his tap on a chip starts: one new plan (exam-plan, no revise) with the chip's brief, naming the
   * chip (its message card key) so the chip, and only that chip, then shows this job. */
  const studyPlanChipJob = (c, key) => ({
    kind: 'exam-plan',
    title: `Study plan: ${c.course}`,
    brief: chipBrief(c.brief),
    course: c.course,
    chip: String(key || '').slice(0, 200),
  });
  /** D-362: the job this chip (by its key) started, else null: an older job with the same words is another chip's. */
  const studyPlanChipStarted = (c, jobs, key) =>
    (key && (jobs || []).find(j => j.kind === 'exam-plan' && !j.revise && j.chip === String(key).slice(0, 200))) ||
    null;

  /**
   * The lookup an edit ask may make (D-356): one date, material, objective or note of his record by id, small; or
   * "dates" (the section's dated items with ids) or "materials" with a query (the best passages of the course's).
   */
  function studyPlanLookup(db, ref, query, section = null) {
    if (ref === 'dates') {
      if (!section) return { error: 'the draft names no section: read a date by its id' };
      return liveDates(db.dates, db.dateedits)
        .filter(d => DAY.test(String(d.date || '')) && d.date >= section.from && d.date <= addDays(section.to, 3))
        .sort(byDate)
        .map(datesRow);
    }
    if (ref === 'materials') {
      if (!query) return { error: 'materials: give a query' };
      const mats = liveMaterials(db.materials, db.materialedits).filter(
        x => (!section || sameCourse(x.course, section.course)) && !(x.needsOcr && !x.ocr)
      );
      return searchLibrary(libraryIndex(libraryChunks(mats)), String(query), { k: 4 }).map(h => ({
        ref: 'materials/' + h.id,
        page: h.page || null,
        title: h.title,
        text: String(h.text || '').slice(0, 700),
      }));
    }
    const m = /^(dates|materials|objectives|notes)\/(.+)$/.exec(String(ref || ''));
    if (!m)
      return {
        error: 'ref: dates, dates/<id>, materials (with a query), materials/<id>, objectives/<id> or notes/<id>',
      };
    const [, c, id] = m;
    if (c === 'dates') {
      const d = liveDates(db.dates, db.dateedits).find(x => x.id === id);
      return d ? datesRow(d) : { error: 'no ' + ref };
    }
    if (c === 'objectives') {
      const o = (db.objectives || []).find(x => x.id === id);
      return o ? { id: o.id, exam: o.exam, text: o.text, chapters: o.chapters || '' } : { error: 'no ' + ref };
    }
    if (c === 'notes') {
      const n = (db.notes || []).find(x => x.id === id);
      return n ? { ref, title: n.title || '', text: noteWords(n).slice(0, 3000) } : { error: 'no ' + ref };
    }
    const mat = liveMaterials(db.materials, db.materialedits).find(x => x.id === id);
    if (!mat) return { error: 'no ' + ref };
    const hits = query
      ? searchLibrary(libraryIndex(libraryChunks([mat])), String(query), { k: 3 }).map(h => ({
          page: h.page || null,
          text: String(h.text || '').slice(0, 900),
        }))
      : [];
    return {
      ref,
      title: mat.title,
      ...(hits.length ? { passages: hits } : { text: String(mat.text || mat.ocr || '').slice(0, 3000) }),
    };
  }

  // ---------------------------------------------------------------- the model's answer
  /** The model's own rubric score read, never recomputed: {ok, why} against the pass mark and the floor. */
  function studyPlanScoreOk(score, spec) {
    const R = rulesOf(spec);
    if (!score || !Array.isArray(score.criteria) || typeof score.total !== 'number')
      return { ok: false, why: 'the plan carries no rubric score' };
    const low = score.criteria.map((s, i) => [i + 1, s]).filter(([, s]) => s < R.floor);
    if (score.total < R.pass || low.length)
      return {
        ok: false,
        why:
          (score.total < R.pass ? `the total is ${score.total}, under ${R.pass}` : `the total is ${score.total}`) +
          (low.length ? `; criteria under ${R.floor}: ${low.map(([i, s]) => `#${i} (${s})`).join(', ')}` : ''),
      };
    return { ok: true, why: null };
  }
  /** Task ids made unique in a plan (a repeat gets -2, -3, ...). */
  function uniqueIds(days) {
    const seen = new Set();
    for (const d of days)
      for (const t of d.tasks) {
        let id = t.id,
          n = 2;
        while (seen.has(id)) id = `${t.id}-${n++}`;
        t.id = id;
        seen.add(id);
      }
    return days;
  }
  /** Days sorted, one per date, empty ones left out. */
  function tidyDays(days) {
    const by = new Map();
    for (const d of days) {
      if (!by.has(d.date)) by.set(d.date, { ...d, tasks: [] });
      by.get(d.date).tasks.push(...(d.tasks || []));
    }
    return [...by.values()].filter(d => d.tasks.length).sort((a, b) => a.date.localeCompare(b.date));
  }
  /**
   * D-357: the tags code settles after the model answers, in place: a task whose ref is a dated graded item is graded,
   * whatever the model said; a reading task (a preview or a full read) tagged practice is learn. `dates` are the dated
   * items the refs name ({id, graded}). The number of tasks changed.
   */
  function settlePlanTags(days, dates) {
    const graded = new Set((dates || []).filter(d => d && d.graded === true).map(d => 'dates/' + d.id));
    let changed = 0;
    for (const d of days || [])
      for (const t of d.tasks || []) {
        const want =
          t.ref && graded.has(t.ref) ? 'graded' : t.kind === 'reading' && t.tag === 'practice' ? 'learn' : null;
        if (want && t.tag !== want) {
          t.tag = want;
          changed++;
        }
      }
    return changed;
  }
  /**
   * The plans/<id> fields from a plan the model made (B-449): the section and exam are code's, days outside the window
   * and refs to dated items the record lacks are left out, task ids made unique, the tags settled (D-357).
   * {plan, dropped, retagged}.
   */
  function studyPlanDoc(plan, { section, dates, spec, openQuestions, score, instructions }) {
    const R = rulesOf(spec);
    const end = addDays(section.to, R.pastDays);
    const known = new Set((dates || []).map(d => 'dates/' + d.id));
    let dropped = 0;
    const days = [];
    for (const d of (plan && plan.days) || []) {
      if (!(d.date >= section.from && d.date <= end)) {
        dropped += (d.tasks || []).length;
        continue;
      }
      days.push({
        date: d.date,
        ...(d.label ? { label: d.label } : {}),
        tasks: (d.tasks || []).map(t => {
          const { ref, ...rest } = t;
          return ref && known.has(ref) ? { ...rest, ref } : rest;
        }),
      });
    }
    const retagged = settlePlanTags(days, dates);
    const keyDates = ((plan && plan.keyDates) || []).map(k => {
      const { ref, ...rest } = k;
      return ref && (known.has(ref) || /^exams\//.test(ref)) ? { ...rest, ref } : rest;
    });
    return {
      plan: {
        exam: section.exam.id,
        title: (plan && plan.title) || `${section.exam.title} plan`,
        section: { course: section.course, from: section.from, to: section.to },
        ...(plan && plan.scope ? { scope: plan.scope } : {}),
        keyDates,
        days: uniqueIds(tidyDays(days)),
        openQuestions: openQuestions || [],
        ...(score ? { score } : {}),
        ...(instructions ? { instructions } : {}),
      },
      dropped,
      retagged,
    };
  }

  /**
   * D-356: an edit ask's patch applied to the draft, making the next draft's fields: each op in turn (add {date,
   * task}, edit {id, set}, move {id, date}, remove {id}); keyDates and openQuestions replaced when the patch gives them.
   * Every task the patch does not name stays exactly as it was. The baseline score is kept, marked edited since
   * scoring. An op naming no task of the draft is left out and counted. The tags are settled over `dates` (D-357).
   * {plan, applied, skipped, retagged}.
   */
  function applyPlanPatch(draft, patch, { dates = [] } = {}) {
    const clone = v => JSON.parse(JSON.stringify(v));
    const days = clone(draft.days || []).map(d => ({ ...d, tasks: d.tasks || [] }));
    const find = id => {
      for (const d of days) {
        const i = d.tasks.findIndex(t => t.id === id);
        if (i >= 0) return { d, i };
      }
      return null;
    };
    const dayOf = date => {
      let d = days.find(x => x.date === date);
      if (!d) days.push((d = { date, tasks: [] }));
      return d;
    };
    let applied = 0,
      skipped = 0;
    for (const op of (patch && patch.ops) || []) {
      if (op.op === 'add' && op.task && DAY.test(String(op.date || ''))) {
        dayOf(op.date).tasks.push(clone(op.task));
        applied++;
        continue;
      }
      const at = op.id ? find(op.id) : null;
      if (!at) {
        skipped++;
        continue;
      }
      if (op.op === 'remove') at.d.tasks.splice(at.i, 1);
      else if (op.op === 'move' && DAY.test(String(op.date || ''))) {
        const [t] = at.d.tasks.splice(at.i, 1);
        dayOf(op.date).tasks.push(t);
      } else if (op.op === 'edit' && op.set) {
        const t = at.d.tasks[at.i];
        for (const [k, v] of Object.entries(op.set)) if (k !== 'id') t[k] = v;
      } else {
        skipped++;
        continue;
      }
      applied++;
    }
    const retagged = settlePlanTags(days, dates);
    const { id, writer, at, source, schema, revises, ...keep } = clone(draft);
    return {
      plan: {
        ...keep,
        ...(patch && patch.keyDates ? { keyDates: clone(patch.keyDates) } : {}),
        ...(patch && patch.openQuestions ? { openQuestions: clone(patch.openQuestions) } : {}),
        days: uniqueIds(tidyDays(days)),
        ...(draft.score ? { editedSinceScore: true } : {}),
        revises: draft.id,
      },
      applied,
      skipped,
      retagged,
    };
  }

  // ---------------------------------------------------------------- the page's hooks (B-450 builds on these)
  /**
   * The jobs/<id> fields that ask for a plan: make for a course (remake is the same ask), or edit a draft with his
   * request (D-356). The page adds the envelope and fires it as any job.
   */
  function studyPlanJob({ course, changes, revise, exams, date } = {}) {
    if (revise) {
      const words = String(changes || '').trim();
      if (!words) throw new Error('say what to change');
      return { kind: 'exam-plan', title: 'Plan changes', brief: words.slice(0, 1500), revise: String(revise) };
    }
    if (!course) throw new Error('name the course to plan');
    const s = studyPlanSection({ exams, course, date });
    return {
      kind: 'exam-plan',
      title: `Study plan: ${course}`,
      brief: s ? `A study plan for ${course} through ${s.exam.title} (${s.exam.id})` : `A study plan for ${course}`,
      course,
    };
  }
  /** B-450: the page's write of his plan settings (studyPlanSettingsWrite), as a record write. */
  function studyPlanSettingsSet(existing, change, opts) {
    const r = studyPlanSettingsWrite(existing, change, opts);
    return { op: 'set', collection: 'settings', id: r.id, data: r.data };
  }
  /**
   * B-450: Approve on a draft's card, as a record write: planedits/<its exam> names the draft as the plan in force, its
   * ticks kept (as planAccept writes it). Refuses a plan that is not a draft of a study plan.
   */
  function studyPlanApproveSet(planedits, draft, { now } = {}) {
    if (!draft || !draft.id || !draft.section) throw new Error('only a study plan draft is approved here');
    const examId = draft.exam || draft.id;
    const pe = (planedits || []).find(e => e && e.id === examId) || null;
    const data = { ...editBase(pe, now), schema: 2, ticks: { ...((pe && pe.ticks) || {}) }, plan: draft.id };
    return { op: 'set', collection: 'planedits', id: examId, data };
  }
  /** The draft a plan card shows for an exam: its newest draft, else the plan in force (planViews). */
  function latestPlanDraft(plans, planedits, examId) {
    return (planDrafts(plans, planedits, examId) || [])[0] || null;
  }

  return {
    STUDY_PLAN_TAGS: TAGS,
    settlePlanTags,
    studyPlanRules: rulesOf,
    studyPlanInstructions,
    studyPlanSettingsWrite,
    studyPlanHardRules,
    studyPlanEditRules,
    studyPlanCourse,
    studyPlanSection,
    studyPlanContext,
    studyPlanLookup,
    studyPlanProgress,
    studyPlanLooksNew,
    studyPlanChatAsk,
    studyPlanChipJob,
    studyPlanChipStarted,
    studyPlanScoreOk,
    studyPlanDoc,
    applyPlanPatch,
    studyPlanJob,
    latestPlanDraft,
    studyPlanSettingsSet,
    studyPlanApproveSet,
  };
}
