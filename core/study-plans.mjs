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
  /** B-469: a plan he put away (planedits/<exam id>.retired names it) is never in force, a draft or an edit's target. */
  const planRetired = (planedits, p) =>
    !!p && !!(((planedits || []).find(e => e && e.id === (p.exam || p.id)) || {}).retired || {})[p.id];
  /** D-357: a study plan task's one tag, from this set (the answer shapes and plans.schema hold it); planDay shows each on
   * Today upper-cased with its dash a space (GRADED ... CLINICAL PREP, SKILLS PREP). */
  const TAGS = ['graded', 'learn', 'practice', 'review', 'clinical-prep', 'skills-prep'];

  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  // B-463: a plan day's name as the page writes it ("Wed 28 Oct"), from the calendar date (a Central day), so an edit's
  // reply never works a weekday out itself
  const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function planDayName(day) {
    if (!DAY.test(String(day || ''))) return '';
    const [y, m, d] = day.split('-').map(Number);
    return `${WD3[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MON3[m - 1]}`;
  }
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
    maxTokens: 48000, // D-365
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
    // B-450: an exam marked done is behind him, even on its own day: never the section's exam (still its last one)
    const ahead = mine.filter(e => e.date >= date && e.status !== 'done');
    const exam = examId ? ahead.find(e => e.id === examId) : ahead[0];
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
    days: (p.days || []).map(d => ({
      date: d.date,
      ...(planDayName(d.date) ? { day: planDayName(d.date) } : {}), // B-463
      ...(d.label ? { label: d.label } : {}),
      tasks: d.tasks || [],
    })),
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
      // B-469: a plan he put away is never what an edit changes
      const draft = plans.find(p => p.id === job.revise && !planRetired(db.planedits, p)) || null;
      if (!draft) return { mode: 'edit', refused: `there's no plan ${job.revise} in your record to change` };
      return {
        mode: 'edit',
        section: draft.section || null,
        draft: planBrief(draft),
        changes: String(job.brief || ''),
        // B-463: each date he may name or a task may move to, with its weekday, from a few days back to the exam
        calendar: Array.from({ length: 36 }, (_, i) => addDays(date, i - 3)).map(d => d + ' ' + planDayName(d)),
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
   * D-362: what a study plan ask in chat does. `said` is his own line; `brief` is the chat model's. offer: the Make a
   * new <course> plan chip (a newplan card whose brief is his line, never the model's) when he typed a line and has no
   * plan yet or his line plainly asks for a whole new one; null when there is no line of his (a retry, a read-along),
   * whatever the brief. edit: the Haiku change of the plan he has ({course, revise, said}: his line rides on the job,
   * so the edit's own chip offer carries his words) when no chip is offered; null when the chip is offered (it is the
   * answer) or he has no plan (chat never starts a new plan).
   */
  function studyPlanChatAsk({ said = '', brief = '', title = '', exams, plansRaw, planedits, date, revise = null }) {
    const his = chipBrief(said);
    // B-450: Ask for changes on a plan's card names that plan: the edit is of it, whatever exam is next
    const shown = revise ? (plansRaw || []).find(p => p.id === revise && !planRetired(planedits, p)) : null;
    if (shown) {
      const c = (shown.section && shown.section.course) || studyPlanCourse({ title, brief: `${his} ${brief}` }, exams);
      const offer = c && his && studyPlanLooksNew(his) ? { type: 'newplan', course: c, brief: his } : null;
      // as below: when the chip is offered it is the answer, with no edit beside it
      return {
        course: c,
        edit: offer ? null : { ...(c ? { course: c } : {}), revise: shown.id, ...(his ? { said: his } : {}) },
        offer,
      };
    }
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
      // D-362 (B-456): when the chip is offered it is the answer: no Haiku edit for that line, so one line never
      // leads to two chips (the edit's own) and two new plans
      edit: cur && !offer ? { course: sec.course, revise: cur.id, ...(his ? { said: his } : {}) } : null,
      offer,
    };
  }
  /**
   * B-461: a line he sends after Ask for changes on a plan's card. `ask` is that card's target ({ id, prefix }: the
   * plan or draft's id and the words the button put in the box). When his line still starts with those words and adds
   * his change, it is the plan edit of that exact plan with no chat model routing it: { job } (the exam-plan edit, his
   * line as its brief and said) or { offer } (his words plainly ask for a whole new plan: the Make a new plan chip, as
   * in chat). Null when there is no target, the words were cleared or changed, nothing was added, or that plan is gone.
   */
  function studyPlanTargetSend({ text, ask, exams, plansRaw, planedits, date }) {
    const line = String(text || '').trim();
    const pre = String((ask && ask.prefix) || '').trim();
    if (!ask || !ask.id || !pre || !line.startsWith(pre) || !line.slice(pre.length).trim()) return null;
    if (!(plansRaw || []).some(p => p.id === ask.id && !planRetired(planedits, p))) return null;
    const go = studyPlanChatAsk({ said: line, brief: line, exams, plansRaw, planedits, date, revise: ask.id });
    if (go.offer) return { offer: go.offer };
    if (!go.edit || go.edit.revise !== ask.id) return null;
    return { job: { kind: 'exam-plan', title: 'Plan changes', brief: chipBrief(line), ...go.edit } };
  }
  /**
   * B-477: E.V.'s line when an edit of a plan can't be made (the edit's failed, or its newPlan with no ops), never a
   * bare reason like "Not applicable". A plan is for one exam, so when his line names another exam, or the edit says
   * it needs a new plan, the line says so and `offer` is the Make a new plan chip (his line as its brief, the named
   * exam's course); else the line asks him to put the change another way. { text, offer }.
   */
  function studyPlanEditFailed({ failed = '', newPlan = '', said = '', draft = null, exams = [] }) {
    const why = String(failed || newPlan || '')
      .trim()
      .replace(/[.!\s]+$/, '');
    const bare = !why || why.split(/\s+/).length < 4 || /^(not applicable|n\/?a|none|no|unknown|error)$/i.test(why);
    const his = chipBrief(said);
    // another exam his line names (not this plan's own, which Ask for changes' words name): the longest title wins,
    // so "Dosage Exam 1" is never read as "Exam 1"
    const elsewhere =
      (draft &&
        (exams || [])
          .filter(e => e.id !== draft.exam && namedExam(his, [e]))
          .sort((a, b) => String(b.title || '').length - String(a.title || '').length)[0]) ||
      null;
    const course = (elsewhere && elsewhere.course) || (draft && draft.section && draft.section.course) || null;
    const offer = his && course && (elsewhere || newPlan) ? { type: 'newplan', course, brief: his } : null;
    const lead =
      'I couldn’t make that change to this plan' +
      (bare ? '' : ': ' + (/^[A-Z]{2}|^E\.V\./.test(why) ? why : why.charAt(0).toLowerCase() + why.slice(1)));
    const next = elsewhere
      ? ` A plan covers one exam, so ${elsewhere.title || elsewhere.id} gets its own: tap Make a new ${course} plan for it.`
      : offer
        ? ` It needs a new plan rather than changes: tap Make a new ${course} plan.`
        : ' Try asking another way, naming the task or day to change. Your plan is as it was.';
    return { text: lead + '.' + next, offer };
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
  const NEW_JOB_MS = 24 * 3600 * 1000; // as the Worker's: a new-plan job older than a day is no longer running
  /**
   * D-362 (B-456): the one guard on new plans, shared by the chip, Make a plan and Remake: the course's new-plan job
   * (exam-plan, no revise) that is queued or running in the record, else null. `jobs` are job views (status from
   * jobresults/<id>; 'queued' when there is none); a job whose firing failed, or over a day old, does not hold it.
   */
  function studyPlanNewJobRunning(jobs, course, nowMs = Date.now()) {
    return (
      (jobs || [])
        .filter(
          j =>
            j.kind === 'exam-plan' &&
            !j.revise &&
            sameCourse(j.course, course) &&
            ['queued', 'running'].includes(j.status || 'queued') &&
            !(j.fired && j.fired.ok === false) &&
            !studyPlanJobStalled(j, nowMs) &&
            nowMs - Date.parse(j.createdAt || j.at || 0) < NEW_JOB_MS
        )
        .sort((a, b) => String(b.createdAt || b.at || '').localeCompare(String(a.createdAt || a.at || '')))[0] || null
    );
  }
  // B-456, B-459: a new plan runs in the Worker (pwa/planjob.js), which writes jobresults/<id> running within seconds
  // of the page's start, so a job with no result START_MS after its `at` never started. The Worker fails a run still
  // going at its deadline (14 minutes, under its 15-minute wall limit) with its own reason; RUN_MS waits past both, so the
  // guard is never freed while the Worker could still be running the job, and a run still marked running then was lost
  // by the Worker itself (the app also marks it failed at boot, pwa/jobs.mjs staleRuns). Either no longer holds the course's guard, with no record change.
  const NEW_JOB_START_MS = 2 * 60000;
  const NEW_JOB_RUN_MS = 20 * 60000;
  /** B-456: why a new-plan job (exam-plan, no revise) that is queued or running has stalled, in plain words, else null.
   *  `j` is a job view (status from jobresults/<id>, 'queued' when there is none; startedAt from it). */
  function studyPlanJobStalled(j, nowMs = Date.now()) {
    if (!j || j.kind !== 'exam-plan' || j.revise || (j.fired && j.fired.ok === false)) return null;
    const status = j.status || 'queued';
    const since = iso => nowMs - Date.parse(iso || 0);
    if (status === 'queued' && since(j.createdAt || j.at) > NEW_JOB_START_MS)
      return 'It didn’t start: nothing came back within 2 minutes. Tap Make a plan to try again.';
    if (status === 'running' && since(j.startedAt || j.createdAt || j.at) > NEW_JOB_RUN_MS)
      return 'It stopped before it finished. Tap Make a plan to try again.';
    return null;
  }
  /** B-459: why a new-plan job didn't finish, in plain words for the Study card, else null: a failed result's own
   *  reason (its "Try again" left to the card's button), or a stall's. */
  function studyPlanJobFailed(j, nowMs = Date.now()) {
    if (!j || j.kind !== 'exam-plan' || j.revise) return null;
    // D-365: the reason follows "Your last plan didn’t finish:", so it starts lowercase, but for a name (Claude, E.V.)
    const mid = t => (/^(Claude|E\.V\.|Sonnet|Haiku|Matt)\b/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
    const plain = t =>
      String(t || '')
        .replace(/\s*(Tap Make a plan to try again|Try again)\.?\s*$/i, '')
        .trim();
    if (j.status === 'failed') {
      const why = plain((j.result && (j.result.failed || j.result.text)) || '').replace(
        /^I couldn’t finish this one:\s*/,
        ''
      );
      const s = why || 'it stopped before it finished';
      return mid(s).replace(/([^.!?])$/, '$1.');
    }
    const stalled = studyPlanJobStalled(j, nowMs);
    return stalled ? mid(plain(stalled)) : null;
  }
  /** D-362 (B-456): a new-plan job's id, the same in every tab for the course's next new plan of the day, so two tabs
   * that both start one write one document (the second create is refused or merges into the first, never a second
   * job). */
  function studyPlanNewJobId(jobs, course, date) {
    const base = `job-${String(date).replace(/-/g, '')}-newplan-${courseKey(course) || 'course'}`;
    const ids = new Set((jobs || []).map(j => j.id));
    let n = 1;
    while (ids.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }
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
  function studyPlanJob({ course, changes, revise, exams, date, examId = null } = {}) {
    if (revise) {
      const words = String(changes || '').trim();
      if (!words) throw new Error('say what to change');
      return { kind: 'exam-plan', title: 'Plan changes', brief: words.slice(0, 1500), revise: String(revise) };
    }
    if (!course) throw new Error('name the course to plan');
    // B-450: the card's exam when the page names it (its id in the brief is what the Worker plans toward)
    const s = studyPlanSection({ exams, course, date, examId }) || studyPlanSection({ exams, course, date });
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
  /**
   * B-469: Put away, from an exam's plan card: planedits/<examId>.retired marks the exam's plans (the one in force and
   * its drafts) as put away, so Study shows Make a plan again and nothing reads them as the plan. Plans are Facts and
   * stay in the record untouched; the Edit keeps its ticks and every other field (replaced whole).
   */
  function studyPlanPutAwaySet(plans, planedits, examId, { now } = {}) {
    const pe = (planedits || []).find(e => e && e.id === examId) || null;
    const base = editBase(pe, now);
    const retired = { ...((pe && pe.retired) || {}) };
    const mark = { at: base.updatedAt, by: 'page', why: 'put away' };
    for (const p of plans || []) if ((p.exam || p.id) === examId && !retired[p.id]) retired[p.id] = mark;
    if (!Object.keys(retired).length) throw new Error('no plan for ' + examId + ' to put away');
    const data = { ...base, schema: 2, ticks: { ...((pe && pe.ticks) || {}) }, retired };
    return { op: 'set', collection: 'planedits', id: examId, data };
  }
  /** The draft a plan card shows for an exam: its newest draft, else the plan in force (planViews). */
  function latestPlanDraft(plans, planedits, examId) {
    return (planDrafts(plans, planedits, examId) || [])[0] || null;
  }

  /**
   * B-483: one task, one tick. A plan task is one item wherever it shows, ticked in its plan's planedits.
   * planCopyKey: an add's words as listEdit stores them, for matching an added item to a plan task's words.
   * planCopyRef: the plan task (plans/<exam>#<task>) dated `date` whose words an added item carries, or null.
   * planCopyIds: the items added to a task's day (dayedit) with the task's words: copies Plan the rest made.
   * dayWithPlanTasks: a day's saved list with the plan items it lacks appended (planned: buildDayList's plan items for
   *   the day, filtered by the caller), their minutes added to the day's planned budget.
   * joinPlanCopies: a dayView whose added items carrying a plan task's words become that task: one row with the plan's
   *   ref, or none when the plan's own row is on the list (its minutes leave the budget).
   */
  // as listEdit stores an add's words, then EVCore's norm (lower case, words only)
  const planCopyKey = t =>
    String(t || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const planTasks = p => ((p && p.days) || []).flatMap(d => (d.tasks || []).map(t => ({ ...t, date: d.date })));
  function planCopyRef(plans, date, text) {
    const k = planCopyKey(text);
    if (!k) return null;
    for (const p of plans || [])
      for (const t of planTasks(p))
        if (t.date === date && planCopyKey(t.text) === k) return 'plans/' + (p.exam || p.id) + '#' + t.id;
    return null;
  }
  function planCopyIds(dayedit, task) {
    const k = planCopyKey(task && task.text);
    const added = (dayedit && dayedit.added) || {};
    return k ? Object.keys(added).filter(id => planCopyKey((added[id] || {}).text) === k) : [];
  }
  /**
   * B-483: the day ticks that count for one plan's task: its copies (planCopyIds), and plan-<task id> ticked on the day
   * before a graded plan task carried its ref, only when that id was this plan's: the day's saved item of that id names
   * this plan and task (or carries its words), or, with no saved item, no other plan has a task of that id that day.
   */
  function planDayTickIds(dayedit, day, plans, plan, task) {
    const ids = planCopyIds(dayedit, task);
    if (!task || !task.id) return ids;
    const id = 'plan-' + task.id;
    const item = ((day && day.list && day.list.items) || []).find(it => it.id === id);
    const mine = /^plans\/([^#]+)#(.+)$/.exec((item && item.ref) || '');
    const own = item
      ? mine
        ? mine[2] === task.id && [plan.id, plan.exam].includes(mine[1])
        : planCopyKey(item.text) === planCopyKey(task.text)
      : !(plans || []).some(p => p.id !== plan.id && planTasks(p).some(t => t.id === task.id && t.date === task.date));
    return own ? [...ids, id] : ids;
  }
  function dayWithPlanTasks(day, planned) {
    const d = day || {};
    const base = (d.list && d.list.items) || [];
    const ids = new Set(base.map(it => it.id));
    const refs = new Set(base.map(it => it.ref).filter(Boolean));
    const add = (planned || []).filter(it => /^plans\//.test(it.ref || '') && !ids.has(it.id) && !refs.has(it.ref));
    if (!add.length) return d;
    const b = d.plan && d.plan.budget;
    const mins = add.reduce((n, it) => n + (it.deferred ? 0 : Number(it.minutes) || 0), 0);
    return {
      ...d,
      list: { ...(d.list || {}), items: [...base, ...add] },
      ...(b ? { plan: { ...d.plan, budget: { ...b, planned: (b.planned || 0) + mins } } } : {}),
    };
  }
  function joinPlanCopies(view, plans, date) {
    const refs = new Set(view.items.filter(it => !it.added && it.ref).map(it => it.ref));
    let less = 0;
    const items = [];
    for (const it of view.items) {
      const ref = it.added && planCopyRef(plans, date, it.text);
      if (!ref) items.push(it);
      else if (refs.has(ref)) less += Number(it.minutes) || 0;
      else {
        refs.add(ref);
        items.push({ ...it, ref });
      }
    }
    const b = view.budget;
    const budget =
      b && less
        ? { ...b, planned: Math.max(0, b.planned - less), over: Math.max(0, b.planned - less - (b.available || 0)) }
        : b;
    return { ...view, items, budget };
  }
  return {
    dayWithPlanTasks,
    planDayTickIds,
    joinPlanCopies,
    planCopyIds,
    planCopyRef,
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
    studyPlanTargetSend,
    studyPlanEditFailed,
    studyPlanChipJob,
    studyPlanChipStarted,
    studyPlanNewJobRunning,
    studyPlanJobStalled,
    studyPlanJobFailed,
    studyPlanNewJobId,
    studyPlanScoreOk,
    studyPlanDoc,
    applyPlanPatch,
    studyPlanJob,
    latestPlanDraft,
    studyPlanSettingsSet,
    studyPlanApproveSet,
    studyPlanPutAwaySet,
  };
}
