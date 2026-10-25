// B-324: the smoke's and the tests' stand-in for Claude on a job (nothing here reaches the Claude API). Given the
// request pwa/jobs.mjs sends, it answers with the answer tool, in the do-job shape, from the brief's own material:
// a practice set's two questions on its first passage, an exam plan's two days, a share-set's refusal, a few lines of
// text for the rest. A job whose title holds a plant answers badly on purpose:
//   PLANT-SHAPE  an answer with no text (the do-job shape requires it)
//   PLANT-PLAN   an exam plan whose day has no date (plans/<id> refuses it)
export const PLANTS = { shape: 'PLANT-SHAPE', plan: 'PLANT-PLAN' };

/** The brief inside a job request (the one JSON block of its prompt), or null when it is not a job request. */
export function briefOf(body) {
  const tool = ((body && body.tools) || []).find(t => t && t.name === 'answer');
  if (!tool) return null;
  const last = [...(body.messages || [])].reverse().find(m => m.role === 'user');
  const text = typeof (last && last.content) === 'string' ? last.content : '';
  const m = text.match(/```json\n([\s\S]*?)\n```/);
  return m ? JSON.parse(m[1]) : null;
}

export const STUB_TEXT = {
  'study-guide': 'Stub study guide: fluid volume deficit. Key rules: watch intake and output, daily weights.',
  'exam-retro': 'Stub retro: your practice and your score, side by side.',
  'clinical-prep': 'Stub clinical prep: review ambulation (Skills lab guide, p. 8).',
  general: 'Stub general: done.',
};

/** The answer tool's input for one brief. */
export function answerFor(brief) {
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
  return {
    id: 'msg_stub_job',
    type: 'message',
    role: 'assistant',
    model: 'stub',
    content: [{ type: 'tool_use', id: 'toolu_stub', name: 'answer', input: answerFor(brief) }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}
