// B-324: the smoke's and the tests' stand-in for Claude on a job (nothing here reaches the Claude API). Given the
// request pwa/jobs.mjs sends, it answers with the answer tool, in the do-job shape, from the brief's own material:
// a practice set's two questions on its first passage, an exam plan's two days, a share-set's refusal, a few lines of
// text for the rest. A job whose title holds a plant answers badly on purpose:
//   PLANT-SHAPE  an answer with no text (the do-job shape requires it)
//   PLANT-PLAN   an exam plan whose day has no date (plans/<id> refuses it)
//   PLANT-LOW    a study plan scoring itself under the bar on the first ask, and well on its fix ask (B-449)
//   PLANT-ASK    a study plan answered with one question instead
// A study plan edit whose request says "look up" reads the section's dates first (D-356).
export const PLANTS = { shape: 'PLANT-SHAPE', plan: 'PLANT-PLAN', low: 'PLANT-LOW', ask: 'PLANT-ASK' };

/** A message's words: its string, or its text blocks joined (a study plan's ask is in blocks, B-449). */
const wordsOf = m =>
  !m
    ? ''
    : typeof m.content === 'string'
      ? m.content
      : (m.content || [])
          .filter(b => b && b.type === 'text')
          .map(b => b.text)
          .join('\n\n');
/** The brief inside a job request (the one JSON block of its prompt), or null when it is not a job request. */
export function briefOf(body) {
  const tool = ((body && body.tools) || []).find(t => t && t.name === 'answer');
  if (!tool) return null;
  const first = (body.messages || []).find(m => m.role === 'user');
  const m = wordsOf(first).match(/```json\n([\s\S]*?)\n```/);
  return m ? JSON.parse(m[1]) : null;
}
/** B-449: a later turn of the same ask (a fix ask or a lookup's answer): its last user message holds tool results. */
const laterTurn = body => {
  const last = [...((body && body.messages) || [])].reverse().find(m => m.role === 'user');
  // a tool's result, or (B-449) any turn after the first: a fix asked in words is a later turn too
  return (
    !!last &&
    ((Array.isArray(last.content) && last.content.some(b => b && b.type === 'tool_result')) ||
      ((body && body.messages) || []).length > 1)
  );
};

export const STUB_TEXT = {
  'study-guide': 'Stub study guide: fluid volume deficit. Key rules: watch intake and output, daily weights.',
  'exam-retro': 'Stub retro: your practice and your score, side by side.',
  'clinical-prep': 'Stub clinical prep: review ambulation (Skills lab guide, p. 8).',
  general: 'Stub general: done.',
};

/** B-449: a study plan, in the plan shape, over the section in the brief: a preview on its first day and, when the
 * section's first day has a dated item of the course, a task that is that item. */
function studyPlanAnswer(brief, later) {
  // D-362: a new plan from the chip carries his line as its brief, so a plant may ride there too
  const title = `${brief.job.title || ''} ${brief.job.brief || ''}`;
  const ctx = brief.context;
  if (title.includes(PLANTS.ask)) return { text: 'One question first.', ask: 'Is the care plan draft graded?' };
  const s = ctx.section;
  const dated = (ctx.dates || []).find(d => d.date === s.from && d.course === s.course);
  const days = title.includes(PLANTS.plan)
    ? [{ label: 'no date', tasks: [] }]
    : [
        {
          date: s.from,
          label: 'Preview',
          tasks: [
            {
              id: 't1',
              text: 'Preview the next chapter: headings, figures, bold terms',
              tag: 'learn',
              kind: 'reading',
              minutes: 30,
              doneWhen: 'every heading skimmed and 5 terms listed',
            },
            ...(dated
              ? [
                  {
                    id: 't2',
                    text: dated.title,
                    tag: 'graded',
                    kind: dated.graded ? 'graded' : 'other',
                    minutes: 45,
                    doneWhen: 'submitted',
                    ref: 'dates/' + dated.id,
                  },
                ]
              : []),
          ],
        },
        {
          date: s.to,
          label: 'Exam',
          tasks: [
            {
              id: 't3',
              text: 'Light review, early night',
              tag: 'review',
              kind: 'review',
              minutes: 20,
              doneWhen: 'in bed by 10',
            },
          ],
        },
      ];
  const low = title.includes(PLANTS.low) && !later;
  return {
    text: 'Stub study plan.',
    plan: {
      exam: s.exam.id,
      title: 'Stub plan for ' + s.exam.id,
      section: { course: s.course, from: s.from, to: s.to },
      scope: [{ topic: 'Stub topic', objectives: (ctx.objectives || []).slice(0, 1).map(o => o.id) }],
      keyDates: (ctx.dates || []).slice(0, 3).map(d => ({ date: d.date, title: d.title, ref: 'dates/' + d.id })),
      days,
    },
    openQuestions: ['Stub: is the review lecture recorded?'],
    score: low ? { criteria: [3, 3, 3, 3, 3, 3, 3, 2], total: 61 } : { criteria: [5, 5, 4, 4, 4, 4, 4, 5], total: 88 },
  };
}
/** D-356: a study plan edit's patch over the draft in the brief: the first task's minutes changed and one task added. */
function planEditAnswer(brief) {
  const draft = brief.context.draft;
  const first = draft.days[0];
  return {
    text: 'Stub edit: changed one task and added one.',
    ops: [
      { op: 'edit', id: first.tasks[0].id, set: { minutes: 20 } },
      {
        op: 'add',
        date: first.date,
        task: {
          id: 'stub-new',
          text: 'Stub: 10 terms',
          tag: 'practice',
          kind: 'terminology',
          minutes: 10,
          doneWhen: '10 cards',
        },
      },
    ],
  };
}

/** The answer tool's input for one brief. */
export function answerFor(brief, later = false, tail = '') {
  const kind = brief.job.kind;
  const title = brief.job.title || '';
  if (title.includes(PLANTS.shape)) return { links: [] };
  const ctx = brief.context || {};
  if (kind === 'practice-set') {
    const p = (ctx.passages || [])[0];
    const q = n => ({
      type: 'single',
      stem: `Stub question ${n}: which finding fits fluid volume deficit?`,
      options: ['Tachycardia', 'Bradycardia', 'Weight gain', 'Crackles'],
      correct: [0],
      rationales: ['Right: the heart speeds up.', 'No.', 'No: that is excess.', 'No: that is excess.'],
      topic: 'fluid volume deficit',
      cjStep: 'recognize-cues',
      ...(p ? { sourceRef: p.ref } : { verify: true }),
    });
    return { text: 'Stub practice set: two questions.', items: [q(1), q(2)] };
  }
  if (kind === 'exam-plan' && ctx.mode === 'make' && ctx.section) return studyPlanAnswer(brief, later);
  if (kind === 'exam-plan' && ctx.mode === 'edit' && ctx.draft) return planEditAnswer(brief);
  if (kind === 'exam-plan' && ctx.mode && ctx.refused) return { text: 'Stub: nothing to plan.', failed: ctx.refused };
  if (kind === 'exam-plan') {
    const exam = ctx.exam ? ctx.exam.id : 'E4';
    const day = (date, i) => ({
      date,
      label: 'Day ' + i,
      tasks: [{ id: 't' + i, text: 'Read chapter 39', kind: 'reading' }],
    });
    const days = title.includes(PLANTS.plan) ? [{ label: 'no date', tasks: [] }] : [day(brief.today, 1)];
    return { text: 'Stub exam plan.', plan: { exam, title: 'Stub plan for ' + exam, days } };
  }
  if (kind === 'share-set')
    return { text: 'Stub: not shared.', failed: String(ctx.refused || 'not shareable').slice(0, 300) };
  return { text: STUB_TEXT[kind] || STUB_TEXT.general };
}

/** A Messages API reply that calls the answer tool. */
export function jobReply(body) {
  const brief = briefOf(body);
  const later = laterTurn(body);
  // D-356: an edit whose request says "look up" reads the section's dates before it answers
  const tail = wordsOf((body.messages || [])[0]);
  const look =
    !later && brief && brief.context && brief.context.mode === 'edit' && /look up/i.test(tail.split('```').pop());
  return {
    id: 'msg_stub_job',
    type: 'message',
    role: 'assistant',
    model: 'stub',
    content: [
      look
        ? { type: 'tool_use', id: 'toolu_stub_look', name: 'lookup', input: { ref: 'dates' } }
        : { type: 'tool_use', id: 'toolu_stub', name: 'answer', input: answerFor(brief, later, tail) },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

/** B-459: a Messages API reply as the server-sent events a streamed ask answers with (text and tool_use blocks, usage
 * split as the API splits it: input on message_start, output on message_delta). `cut` stops before message_stop. */
export function toSse(reply, { cut = false } = {}) {
  const { content = [], usage = {}, stop_reason = 'end_turn', ...rest } = reply || {};
  const { output_tokens = 0, ...input } = usage;
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', {
    message: {
      id: 'msg_stub',
      role: 'assistant',
      model: 'stub',
      ...rest,
      content: [],
      usage: { ...input, output_tokens: 1 },
    },
  });
  content.forEach((b, index) => {
    if (b.type === 'tool_use') {
      out += ev('content_block_start', {
        index,
        content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} },
      });
      const j = JSON.stringify(b.input);
      for (let i = 0; i < j.length; i += 40)
        out += ev('content_block_delta', {
          index,
          delta: { type: 'input_json_delta', partial_json: j.slice(i, i + 40) },
        });
    } else {
      out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      const t = String(b.text || '');
      for (let i = 0; i < t.length; i += 40)
        out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: t.slice(i, i + 40) } });
    }
    out += ev('content_block_stop', { index });
    if (index === 0) out += ev('ping', {});
  });
  out += ev('message_delta', { delta: { stop_reason, stop_sequence: null }, usage: { output_tokens } });
  if (!cut) out += ev('message_stop', {});
  return out;
}
