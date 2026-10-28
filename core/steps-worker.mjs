// The worker pipeline's steps (spec.pipelines.worker), split from core/steps.mjs, which merges them into its tables:
// the job-brief code step and its material, and the job-result fold. Same contracts as core/steps.mjs.
import fs from 'node:fs';
import path from 'node:path';
import EV from './evcore.mjs';
import { models, ITEM_FIELDS, pick, library, passages } from './steps-shared.mjs';

export const CODE_STEPS = {
  /** The job this run does: the one the firing named, or the oldest with no result; with its guide and material. */
  'job-brief': function jobBrief(db, ctx, spec) {
    const results = new Map((db.jobresults || []).map(r => [r.id, r]));
    const wanted = ctx.input && ctx.input.job;
    // D-194 (B-177): a build, reply, design, plan or ship job is the builder's; the worker never takes one.
    const builders = new Set((spec.jobs && spec.jobs.builderKinds) || []);
    const job = wanted
      ? (db.jobs || []).find(j => j.id === wanted)
      : [...(db.jobs || [])]
          .filter(j => !results.has(j.id) && !builders.has(j.kind))
          .sort((a, b) => EV.toMs(a.at) - EV.toMs(b.at) || (a.id < b.id ? -1 : 1))[0];
    if (!job) {
      ctx.job = null;
      ctx.jobSkip = wanted ? `no job ${wanted} in the record` : 'no job is waiting';
      return { say: [ctx.jobSkip] };
    }
    if (builders.has(job.kind)) {
      ctx.job = null;
      ctx.jobSkip = `job ${job.id} is a ${job.kind} job, the builder's (D-194); the worker leaves it`;
      return { say: [ctx.jobSkip] };
    }
    const done = results.get(job.id);
    if (done && done.status !== 'running') {
      ctx.job = null;
      ctx.jobSkip = `job ${job.id} already has a result (${done.status})`;
      return { say: [ctx.jobSkip] };
    }
    const kinds = (spec.jobs && spec.jobs.kinds) || {};
    const kind = kinds[job.kind] ? job.kind : 'general';
    if (kind === 'exam-plan' && ctx.runId) {
      // B-449: a study plan (a new section plan or an edit) is the app's job only (pwa/jobs.mjs, with its own answer
      // shapes); the claude.ai page this cloud run serves is read-only since the Oct 26 switch (D-337, D-347). Said
      // plainly, as a failed result, with no ask.
      const why = 'study plans are made in the E.V. app now. Ask for this one there.';
      ctx.job = null;
      ctx.jobSkip = `job ${job.id} (exam-plan): ${why}`;
      return {
        say: [ctx.jobSkip],
        writes: [
          {
            op: 'set',
            collection: 'jobresults',
            id: job.id,
            data: {
              ...EV.envelope('worker', ctx.source, ctx.now),
              schema: 2,
              release: ctx.release,
              status: 'failed',
              startedAt: ctx.now,
              finishedAt: ctx.now,
              result: { text: 'I couldn’t make this one: ' + why, links: [] },
              message: null,
              error: why,
            },
          },
        ],
      };
    }
    const ms = models(db);
    const idx = library(db);
    const q = `${job.title} ${job.brief}`;
    const context = {};
    if (kind === 'study-guide') context.passages = passages(idx, q, 6);
    if (kind === 'practice-set') {
      context.weakSpots = EV.rankDue(ms.filter(EV.isActive), '9999-12-31', db.exams || [])
        .map(w => ({ w, s: EV.similarity(q, w.topic + ' ' + w.objective) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 15)
        .map(({ w }) => ({ weakspotId: w.id, topic: w.topic, objective: w.objective }));
      context.passages = passages(idx, q, 6);
    }
    let instructions = null;
    if (kind === 'exam-plan') {
      // B-449 (D-354, D-356): a course's current section, or an edit of a draft; core picks the window and the material
      Object.assign(
        context,
        EV.studyPlanContext(db, { date: ctx.date, job, spec, models: ms, constants: EV.constants() })
      );
      instructions = EV.studyPlanInstructions(
        (db.settings || []).find(d => d.id === 'study-plan'),
        spec
      );
    }
    if (kind === 'clinical-prep') {
      // D-103 (B-46): the clinical the brief names by date, else the next one, and its read set (core.clinicalReadSet).
      const named = (q.match(/\b\d{4}-\d{2}-\d{2}\b/) || [])[0];
      const day = EV.nextClinical(db.dates, db.dateedits, named || ctx.date);
      const set = EV.clinicalReadSet(
        EV.liveMaterials(db.materials, db.materialedits).filter(m => !(m.needsOcr && !m.ocr)),
        day && day.course
      );
      const clinicalIdx = EV.libraryIndex(EV.libraryChunks(set.read));
      context.day = day ? { date: day.date, title: day.title, course: day.course, subject: day.subject || null } : null;
      context.passages = passages(
        clinicalIdx,
        `${(day && (day.subject || day.title)) || ''} skills packet steps checklist clinical lab ${job.brief}`,
        8
      );
      context.skillWeakSpots = ms
        .filter(w => w.kind === 'skill' && w.derived && w.derived.status === 'open')
        .sort((a, b) => String(b.addedAt || b.at || '').localeCompare(String(a.addedAt || a.at || '')))
        .slice(0, 8)
        .map(w => ({ weakspotId: w.id, topic: w.topic }));
      const since = EV.addDays(ctx.date, -21);
      context.instructorNotes = (db.announcements || [])
        .filter(a => String(a.postedAt || a.at || '').slice(0, 10) >= since)
        .filter(a => /\b(clinical|lab|skills?|validation|uniform|bring)\b/i.test(`${a.title || ''} ${a.text || ''}`))
        .sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')))
        .slice(0, 4)
        .map(a => ({ title: a.title, postedAt: a.postedAt || null, text: String(a.text || '').slice(0, 500) }));
    }
    if (kind === 'exam-retro') {
      // D-104: the exam the brief names, else the latest one with a score; core computes every number, the agent only
      // writes the narrative over them.
      const views = EV.examViews(db.exams || [], db.examedits || [], db.predictions || []);
      const exam =
        views.find(e => new RegExp(`\\b${e.id}\\b`).test(q)) ||
        [...views]
          .filter(e => typeof e.score === 'number')
          .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (a.id < b.id ? -1 : 1))[0] ||
        null;
      context.retro = exam
        ? EV.examRetro({
            examId: exam.id,
            exams: db.exams || [],
            examedits: db.examedits || [],
            predictions: db.predictions || [],
            sets: db.sets || [],
            answers: db.answers || [],
            weakspots: ms,
            plans: EV.planViews(db.plans || [], db.planedits || []),
            objectives: db.objectives || [],
          })
        : null;
    }
    let groups = null;
    if (kind === 'share-set') {
      // D-110: the page is built here, in code, from the set the brief names; the agent only publishes it as printed.
      const words = new Set(
        String(q)
          .split(/[^\w.-]+/)
          .map(w => w.replace(/[.]+$/, ''))
      );
      const set = (db.sets || []).find(x => words.has(x.id)) || null;
      const ok = EV.shareableSet(set, EV.planViews(db.plans || [], db.planedits || []));
      context.set = set ? { id: set.id, title: set.title, questions: EV.validItems(set).length } : null;
      if (!ok.ok) context.refused = ok.why;
      else {
        const dir = path.join(ctx.dir, 'share');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, set.id + '.html');
        fs.writeFileSync(file, EV.sharePage(set));
        groups = [
          {
            name: 'publish',
            rule: 'one publish of the page this run built; note the link it returns',
            calls: [
              {
                tool: 'Artifact',
                args: {
                  action: 'publish',
                  file_path: file,
                  title:
                    'Practice: ' +
                    String(set.title || set.id)
                      .replace(/\s+/g, ' ')
                      .trim()
                      .slice(0, 100),
                  icon: 'quiz',
                  description: 'Practice questions for classmates; the answers and rationales show after each try.',
                },
              },
            ],
          },
        ];
      }
    }
    ctx.job = job;
    const edit = kind === 'exam-plan' && context.mode === 'edit';
    ctx.jobBrief = {
      job: {
        id: job.id,
        kind,
        title: job.title,
        brief: job.brief,
        ...(job.course ? { course: job.course } : {}),
        ...(job.revise ? { revise: job.revise } : {}),
      },
      guide: kinds[kind] ? (edit ? kinds[kind].edit.guide : kinds[kind].guide) : '',
      today: ctx.date,
      context,
      ...(instructions ? { instructions } : {}),
      ...(groups ? { groups } : {}),
    };
    return { say: [`Job ${job.id} (${kind}): ${job.title}`] };
  },
};

export const AGENT_MATERIAL = {
  'job-brief'(db, ctx) {
    return ctx.job ? ctx.jobBrief : { skip: ctx.jobSkip || 'no job' };
  },
};

export const AGENT_FOLDS = {
  /** {text, links?, items?, plan?, failed?}: jobresults/<id>, what the job made, and E.V.'s message in talk/<date>. */
  'job-result'(answer, db, ctx, spec) {
    const job = ctx.job;
    const writes = [];
    const say = [];
    const failed = answer.failed ? String(answer.failed) : null;
    let draftCard = null;
    const result = {
      text: failed ? 'I couldn’t finish this one: ' + failed : answer.text,
      links: (answer.links || []).map(l => ({
        ...(l.title ? { title: String(l.title).slice(0, 120) } : {}),
        url: l.url,
      })),
    };
    const doc = result.links.find(l => /^https:\/\/claude\.ai\//.test(l.url));
    if (doc && job.kind === 'study-guide') result.docUrl = doc.url;
    // D-104: the numbers the retro narrative was written over travel with it, so its card shows the same ones.
    if (!failed && job.kind === 'exam-retro' && ctx.jobBrief && ctx.jobBrief.context.retro)
      result.retro = ctx.jobBrief.context.retro;
    // D-110: the page's link, when the publish returned one; a refused share is a failed job.
    if (!failed && job.kind === 'share-set') {
      const page = result.links.find(l => /^https:\/\/claude\.ai\//.test(l.url));
      if (page) result.pageUrl = page.url;
    }
    if (!failed && job.kind === 'practice-set') {
      const raw = answer.items || [];
      const items = [];
      const target = EV.targetExam({
        exams: db.exams || [],
        objectives: db.objectives || [],
        weakspots: models(db),
        date: ctx.date,
      });
      for (const r of raw) {
        const q = {
          id: 'p' + (items.length + 1),
          kind: r && r.weakspotId ? 'review' : 'check',
          ...pick(r || {}, ITEM_FIELDS),
        };
        if (q.weakspotId && !(db.weakspots || []).some(w => w.id === q.weakspotId)) delete q.weakspotId;
        const cross = EV.crossCourse(q, {
          materials: db.materials,
          exams: db.exams,
          objectives: db.objectives,
          set: { exam: target ? target.id : null },
        }); // B-193
        if (EV.validateItem(q, { strict: true }).ok && !cross.errors.length) items.push(cross.item);
      }
      if (items.length) {
        const setId = 'job-' + job.id.replace(/^job-/, '');
        writes.push({
          op: 'set',
          collection: 'sets',
          id: setId,
          data: {
            ...EV.envelope('worker', ctx.source, ctx.now),
            schema: 3, // B-43, B-75
            kind: 'job',
            date: ctx.date,
            ...(target ? { exam: target.id } : {}),
            title: job.title,
            items,
            createdAt: ctx.now,
          },
        });
        result.setId = setId;
        say.push(`Practice set ${setId}: ${items.length} of ${raw.length} questions kept.`);
      } else result.text += ' (The questions didn’t pass my checks, so nothing was saved.)';
    }
    const planCtx = job.kind === 'exam-plan' && ctx.jobBrief ? ctx.jobBrief.context || {} : {};
    const saved = (planId, data, days) => {
      writes.push({
        op: 'set',
        collection: 'plans',
        id: planId,
        data: { ...EV.envelope('worker', ctx.source, ctx.now), ...data },
      });
      result.planId = planId;
      draftCard = { type: 'plan', id: planId }; // the card names it
      say.push(`Plan ${planId}: ${days} days.`);
    };
    if (job.kind === 'exam-plan' && ctx.planUsage) result.usage = ctx.planUsage;
    if (!failed && job.kind === 'exam-plan' && answer.ask && !answer.plan && !(answer.ops || []).length) {
      // B-449: one question for Matt instead of a plan: only E.V.'s question is written, as her message
      result.text = String(answer.ask);
      result.asked = true;
    } else if (!failed && job.kind === 'exam-plan' && planCtx.mode === 'edit' && planCtx.draft) {
      // D-356: an edit's patch applied to the draft makes the next draft; every task it does not name stays as it was
      const draft = (db.plans || []).find(x => x.id === planCtx.draft.id);
      const r = EV.applyPlanPatch(draft, answer, { dates: EV.liveDates(db.dates || [], db.dateedits || []) });
      const planId = EV.nextPlanId(db.plans || [], draft.exam || draft.id);
      if (r.skipped) result.text += ` (${r.skipped} of the changes named no task in the plan, so I left them out.)`;
      saved(planId, r.plan, r.plan.days.length);
    } else if (
      !failed &&
      job.kind === 'exam-plan' &&
      planCtx.mode === 'make' &&
      planCtx.section &&
      answer.plan &&
      Array.isArray(answer.plan.days)
    ) {
      // B-449: a study plan for the section: a draft until Matt accepts it from its card (planedits names it)
      const r = EV.studyPlanDoc(answer.plan, {
        section: planCtx.section,
        dates: planCtx.dates,
        spec,
        openQuestions: answer.openQuestions,
        score: answer.score,
        instructions: ctx.jobBrief.instructions && ctx.jobBrief.instructions.from,
      });
      if (r.plan.days.length) {
        if (r.dropped) say.push(`${r.dropped} tasks outside the section were left out.`);
        const inForce = EV.planViews(db.plans || [], db.planedits || []).some(x => x.exam === r.plan.exam);
        saved(EV.nextPlanId(db.plans || [], r.plan.exam), r.plan, r.plan.days.length);
        result.text += inForce
          ? ` Your current ${r.plan.exam} plan stays in force; this draft waits on its card until you use it.`
          : ' It waits on its card as a draft until you use it.';
      } else result.text += ' (The plan had no days inside the section, so nothing was saved.)';
    } else if (
      !failed &&
      job.kind === 'exam-plan' &&
      answer.plan &&
      answer.plan.exam &&
      Array.isArray(answer.plan.days) &&
      answer.plan.days.length
    ) {
      // B-45 (D-102): an exam plan in the older shape: the exam's first plan is plans/<exam>; any later one is a draft
      // plans/<exam>-<n>, a Fact never changed, that Matt makes the plan in force from its card. Nothing is replaced.
      const p = answer.plan;
      const exists = (db.plans || []).some(x => (x.exam || x.id) === p.exam);
      saved(EV.nextPlanId(db.plans || [], p.exam), pick(p, ['exam', 'title', 'days']), p.days.length);
      result.text += exists
        ? ` Your current ${p.exam} plan stays in force; this draft waits on its card until you use it.`
        : '';
    }
    const key = `m-${EV.compactTime(ctx.now)}-job`;
    const message = {
      role: 'ev',
      text: result.text.slice(0, 4000),
      cards: [
        { type: 'job', id: job.id },
        ...(result.setId ? [{ type: 'set', id: result.setId }] : []),
        ...(draftCard ? [draftCard] : []),
      ],
      at: ctx.now,
      jobId: job.id,
    };
    const day = (db.talk || []).find(t => t.id === ctx.date);
    writes.push(
      day
        ? { op: 'update', collection: 'talk', id: ctx.date, data: { messages: { [key]: message } } }
        : {
            op: 'set',
            collection: 'talk',
            id: ctx.date,
            data: {
              ...EV.envelope('worker', ctx.source, ctx.now),
              schema: 4, // B-178: talk schema 3; B-227: 4
              date: ctx.date,
              messages: { [key]: message },
            },
          }
    );
    writes.unshift({
      op: 'set',
      collection: 'jobresults',
      id: job.id,
      data: {
        ...EV.envelope('worker', ctx.source, ctx.now),
        schema: 2, // B-178: jobresults schema 2
        release: ctx.release,
        status: failed ? 'failed' : 'done',
        startedAt: ctx.startedAt,
        finishedAt: ctx.now,
        result,
        message: key,
        error: failed,
      },
    });
    say.push(`Job ${job.id} ${failed ? 'failed' : 'done'}; message posted to talk/${ctx.date}.`);
    return { writes, say, push: result.text.split(/(?<=[.!?])\s/)[0].slice(0, 120) };
  },
};
