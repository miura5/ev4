// E.V. core's conversation: the E.V. tab's greeting and chips, and the conversations a day's talk splits into (B-77,
// D-128). Split from core/evcore.mjs (B-157, D-166) as one factory with no imports, so the same file runs in node
// (evcore.mjs imports it) and in the page (the build writes it into core.js ahead of E.V. core). It takes the core names
// it uses, C through a getter (configure() replaces it), and returns the names core's export map uses.

export function makeConversation(core) {
  'use strict';
  const { DAY_LABELS, chicagoClock, chicagoDate, diffDays, examIs, prepKindOf, toMs, weekday } = core;

  // ---------------------------------------------------------------- conversation (E.V. tab)
  /**
   * What E.V. says when the page opens. Pure and free: no model call. It reads the time of day and the record
   * the page already has, and picks at most two insights (B-14). Returns {segment, mood, lines, cards, chips}.
   * ctx: {now, date, dayType, items:[{id,text,tag,done,deferred,minutes,set}], reviewLeft, reviewTotal, push,
   *       nextExams:[{id,title,date,course,kind}], readiness:{examId,pctSolid,need}|null, dueCount,
   *       jobs:[{id,title,status,finishedAt}], lastSeenAt, runs:{<pipeline>:{status,startedAt,detail}},
   *       tomorrow:{dates:[{title,kind,graded}]}, quizlet:{refresh}|null, checkin:{energy}|null, sessionActive, skillRun (a Resume chip, B-82),
   *       prep:{today: prepDay|null, tomorrow: prepDay|null} (D-143), clinicalOffer:{date,title}|null (D-103)}
   */
  const JOB_NOUN = {
    'study-guide': 'study guide',
    'practice-set': 'practice set',
    'exam-plan': 'exam plan',
    'exam-retro': 'exam retro',
    'share-set': 'practice page',
    'clinical-prep': 'clinical brief',
  };
  function greeting(ctx) {
    const c = ctx || {};
    const date = c.date;
    const clock = chicagoClock(c.now || new Date()) || '12:00';
    const hour = Number(clock.slice(0, 2));
    const segment =
      hour >= 4 && hour < 11
        ? 'morning'
        : hour >= 11 && hour < 17
          ? 'midday'
          : hour >= 17 && hour < 22
            ? 'evening'
            : 'late';
    const items = (c.items || []).filter(i => !i.deferred);
    const open = items.filter(i => !i.done && !/^review|^checks$/.test(i.id || ''));
    const doneN = items.filter(i => i.done).length;
    const lines = [];
    const cards = [];
    const insights = [];
    let mood = 'idle';
    const short = (t, n = 48) => {
      // a list item as a phrase: no minutes, no trailing parenthetical, cut at a word
      const s = String(t || '')
        .replace(/\s*\(~?\d+ min\)/, '')
        .replace(/\s+due 11:59pm$/i, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();
      if (s.length <= n) return s;
      const cut = s.slice(0, n);
      return cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(n / 2))).replace(/[\s,:;+–-]+$/, '') + '…';
    };
    const listOf = arr =>
      arr.length <= 1 ? arr[0] || '' : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
    const exams = (c.nextExams || []).filter(e => e.date >= date).sort((a, b) => a.date.localeCompare(b.date));
    const tomorrowExam = exams.find(e => diffDays(date, e.date) === 1);
    const todayExam = exams.find(e => e.date === date);
    const tmr = (c.tomorrow && c.tomorrow.dates) || [];
    const tmrGraded = tmr.filter(d => d.graded && d.kind !== 'exam');
    const tmrClinical = tmr.find(d => d.kind === 'clinical');
    const rl = c.reviewLeft || 0;

    if (segment === 'morning') {
      lines.push(
        'Morning, Matt. ' +
          (c.push ? c.push.split(' · ').slice(0, 2).join(' · ') + '.' : (DAY_LABELS[c.dayType] || 'Today') + ' loaded.')
      );
      if (rl) {
        lines.push(`${rl} review${rl === 1 ? '' : 's'} queued. Start there while your coffee is still optimistic.`);
        cards.push({ type: 'review' });
      }
      if (open.length) cards.push({ type: 'today', filter: 'open' });
    } else if (segment === 'midday') {
      lines.push('Afternoon check-in.');
      if (items.length)
        lines.push(
          open.length
            ? `${doneN} of ${items.length} done. Still open: ${listOf(open.slice(0, 3).map(i => short(i.text)))}.`
            : `All ${items.length} items done. Efficiency noted for the record.`
        );
      if (rl) {
        lines.push(`${rl} review${rl === 1 ? '' : 's'} still waiting.`);
        cards.push({ type: 'review' });
      } else if (open.length) cards.push({ type: 'today', filter: 'open' });
      if (!open.length && !rl && items.length) mood = 'happy';
    } else if (segment === 'evening') {
      lines.push('Evening, Matt.');
      if (rl) {
        lines.push(
          `${rl} review${rl === 1 ? '' : 's'} still open, about ${rl} min. Worth closing out before tonight’s run at 8:15.`
        );
        cards.push({ type: 'review' });
      } else if (open.length) {
        lines.push(`Still open today: ${listOf(open.slice(0, 3).map(i => short(i.text)))}.`);
        cards.push({ type: 'today', filter: 'open' });
      } else if (items.length) {
        lines.push('Today’s list is clear.');
        mood = 'happy';
      }
    } else {
      lines.push('Still up? Logging this as dedication, not insomnia.');
    }
    // Tomorrow, from the afternoon on.
    if (segment !== 'morning') {
      const bits = [];
      if (tomorrowExam) bits.push(tomorrowExam.title.replace(/:.*$/, ''));
      tmrGraded.slice(0, 2).forEach(d => bits.push(short(d.title)));
      if (tmrClinical) bits.push(short(tmrClinical.title));
      if (bits.length) {
        lines.push('Tomorrow: ' + listOf(bits) + '.');
        cards.push({ type: 'dates', days: 1 });
      }
      if (segment === 'late' && (tmrClinical || tomorrowExam)) {
        lines.push(
          'Sleep is on tomorrow’s plan too. Strongly recommended by me, your circadian rhythm and the nursing literature.'
        );
        mood = 'sleepy';
      } else if (segment === 'late') mood = 'sleepy';
    }
    if (todayExam) {
      lines.push(`${todayExam.title.replace(/:.*$/, '')} is today. No new reviews; trust the reps.`);
      mood = 'alert';
    }

    // Insights, at most two, most useful first.
    const seen = c.lastSeenAt ? toMs(c.lastSeenAt) : 0;
    for (const j of (c.jobs || []).filter(j => j.status === 'done' && toMs(j.finishedAt) > seen).slice(0, 1))
      insights.push({ line: `Finished in the background: ${j.title}.`, card: { type: 'job', id: j.id } });
    for (const j of (c.jobs || []).filter(j => j.status === 'failed' && toMs(j.finishedAt) > seen).slice(0, 1))
      insights.push({
        line: `A job hit a wall: ${j.title}. Details on the card.`,
        card: { type: 'job', id: j.id },
        alert: true,
      });
    const failed = Object.entries(c.runs || {}).filter(
      ([, r]) => r && r.status === 'failed' && date && diffDays(chicagoDate(r.startedAt), date) <= 1
    );
    if (failed.length)
      insights.push({
        line: `The ${failed[0][0]} run failed${failed[0][1].detail ? ': ' + String(failed[0][1].detail).slice(0, 80) : ''}. I’m flagging it, not ignoring it.`,
        alert: true,
      });
    // B-45 (D-102): a new exam-content module from the Canvas sync offers a plan draft, once, as one line.
    if (c.planOffer)
      insights.push({
        line: `${String(c.planOffer.title).replace(/:.*$/, '')} content is on Canvas. Want me to draft its plan?`,
      });
    const soon = exams.find(
      e =>
        examIs(e, 'scoredKinds') &&
        ['unit', 'final'].includes(e.kind) &&
        diffDays(date, e.date) >= 1 &&
        diffDays(date, e.date) <= 3
    );
    if (soon && c.readiness && c.readiness.examId === soon.id)
      insights.push({
        line: `${soon.title.replace(/:.*$/, '')} in ${diffDays(date, soon.date)} day${diffDays(date, soon.date) === 1 ? '' : 's'}: ${c.readiness.pctSolid ?? 0}% of its weak spots solid, about ${c.readiness.need} correct reviews to go.`,
        card: { type: 'readiness' },
      });
    if (c.checkin && c.checkin.energy != null && c.checkin.energy <= 2)
      insights.push({
        line: 'You logged low energy today. I trimmed nothing on my own, but say the word and I’ll lighten the list.',
      });
    if (c.quizlet && c.quizlet.refresh && [5, 6, 0].includes(weekday(date)))
      insights.push({ line: `Quizlet pick for this week: ${c.quizlet.refresh}.` });
    for (const ins of insights.slice(0, 2)) {
      lines.push(ins.line);
      if (ins.card && !cards.some(x => x.type === ins.card.type && x.id === ins.card.id)) cards.push(ins.card);
      if (ins.alert) mood = 'alert';
    }

    // The greeting is her first line, with no card (D-125 as amended Oct 18): what its cards offered becomes the chips,
    // at most three (UI rule 5). While no session runs, Start a study session keeps the last chip and the other two go
    // by priority: the open review, a finished job (Open the study guide), sessions waiting to be filed, what's due
    // (the first to drop: the Today tab covers it). During a session all three go by priority. Usual asks fill gaps.
    const chips = [],
      finished = (c.jobs || []).find(j => j.status === 'done' && toMs(j.finishedAt) > seen);
    const room = c.sessionActive ? 3 : 2,
      add = x => {
        if (x && chips.length < room && !chips.includes(x)) chips.push(x);
      };
    if (c.skillRun) add(c.skillRun); // a skills run waiting for him (B-82): its Resume chip comes first
    if (rl) add('Start review');
    if (finished) add('Open the ' + (JOB_NOUN[finished.kind] || 'result'));
    if (c.unfiled > 0) add('File it');
    if (c.dueSoon == null || c.dueSoon > 0) add('What’s due this week?');
    add('How ready am I?');
    if (segment !== 'late') add('Give me 5 more');
    if (!c.sessionActive) chips.push('Start a study session');

    // B-90 (Matt, Oct 19): a strict one-line headline over a briefing that starts folded. Urgent is only what can't
    // wait: an exam today or tomorrow, graded work due today. New is what arrived since his last visit. The headline
    // names the urgent ones (one, two, or the first and a count); with nothing urgent it greets and asks how to help.
    const hello = {
      morning: 'Morning, Matt.',
      midday: 'Afternoon, Matt.',
      evening: 'Evening, Matt.',
      late: 'Still up, Matt?',
    }[segment];
    const brief = [];
    const put = (level, kind, title, x = {}) => brief.push({ id: kind + '-' + brief.length, level, kind, title, ...x });
    const exName = e => e.title.replace(/:.*$/, '');
    const shortDay = iso => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(iso)];
    if (todayExam)
      put('urgent', 'exam', `${exName(todayExam)} is today`, {
        when: 'today',
        detail: todayExam.title,
        say: `${exName(todayExam)} is today`,
        tab: 'progress',
      });
    if (tomorrowExam)
      put('urgent', 'exam', `${exName(tomorrowExam)} is tomorrow`, {
        when: 'tomorrow',
        detail: tomorrowExam.title,
        say: `${exName(tomorrowExam)} is tomorrow`,
        tab: 'progress',
      });
    const key24 = t =>
      String(t || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .slice(0, 24);
    const doneKeys = new Set(items.filter(i => i.done).map(i => key24(i.text)));
    // D-143: a clinical, lab, validation or class day is never urgent, graded or not; it gets the Prep marker below.
    const gradedToday = [
      ...items.filter(i => i.tag === 'GRADED' && !i.done).map(i => ({ title: i.text })),
      ...(c.todayDates || [])
        .filter(d => d.graded && d.kind !== 'exam' && !prepKindOf(d))
        .map(d => ({ title: d.title })),
    ].filter((g, i, a) => !doneKeys.has(key24(g.title)) && a.findIndex(x => key24(x.title) === key24(g.title)) === i);
    const named = t => {
      const s = String(t || '')
        .replace(/\s+due\b.*$/i, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();
      if (s.length <= 40) return s;
      const head = s.split(':')[0].trim();
      return short(head.length >= 8 ? head : s, 34);
    };
    for (const g of gradedToday) {
      const tonight = /11:59|pm\b|tonight/i.test(g.title);
      put('urgent', 'due', String(g.title).replace(/\s*\(~?\d+ min\)/, ''), {
        when: tonight ? 'tonight' : 'today',
        detail: 'Graded.',
        say: `${named(g.title)} is due ${tonight ? 'tonight' : 'today'}`,
        tab: 'today',
      });
    }
    for (const j of (c.jobs || []).filter(j => j.status === 'done' && toMs(j.finishedAt) > seen).slice(0, 2))
      put('new', 'job', j.title, {
        when: 'done',
        detail: 'Finished in the background.',
        ...(finished && j.id === finished.id
          ? { action: { label: 'Open', chip: 'Open the ' + (JOB_NOUN[j.kind] || 'result') } }
          : { tab: 'system' }),
      });
    for (const j of (c.jobs || []).filter(j => j.status === 'failed' && toMs(j.finishedAt) > seen).slice(0, 1))
      put('new', 'job', `${j.title} hit a wall`, {
        when: 'failed',
        detail: 'The background job stopped. System has the details and a Try again.',
        tab: 'system',
      });
    // B-45 (D-102): new on Canvas, an exam's content with no plan: one line offering the draft; drafted only on his tap.
    if (c.planOffer)
      put('new', 'plan', `${exName(c.planOffer)} content is on Canvas`, {
        when: 'new',
        detail: 'No plan yet. E.V. can draft one from it, your calendar and the objectives.',
        action: { label: 'Draft its plan', chip: 'Draft its plan' },
        exam: c.planOffer.examId,
      });
    if (rl)
      put('normal', 'review', `${rl} review${rl === 1 ? '' : 's'} waiting`, {
        when: `~${rl} min`,
        action: { label: 'Start', chip: 'Start review' },
      });
    if (items.length)
      put(
        'normal',
        'today',
        open.length ? `${doneN} of ${items.length} done on today’s list` : 'Today’s list is done',
        { detail: open.length ? 'Still open: ' + open.map(i => short(i.text)).join('; ') + '.' : '', tab: 'today' }
      );
    for (const d of tmrGraded.filter(d => !prepKindOf(d)).slice(0, 3))
      put('normal', 'due', d.title, { when: 'tomorrow', detail: 'Graded.', tab: 'record' }); // a prep day has its marker
    // The Prep marker (D-143): calm, its own level, never counted with urgent. The bag check is for today in the morning
    // and through the day; from the evening on the pack check is for tomorrow.
    const prepDayNow = c.prep && (segment === 'evening' || segment === 'late' ? c.prep.tomorrow : c.prep.today);
    const prepPhase = segment === 'evening' || segment === 'late' ? 'night' : 'morning';
    if (prepDayNow)
      put('prep', 'prep', 'Prep: ' + prepDayNow.title, {
        when: prepPhase === 'night' ? 'tomorrow' : 'today',
        detail:
          prepPhase === 'night'
            ? 'Tonight’s pack check is under my greeting.'
            : 'This morning’s bag check is under my greeting.',
      });
    // B-46 (D-103): the day before a clinical day, one line offers the prep brief; written only on his tap.
    if (c.clinicalOffer)
      put('prep', 'clinical-prep', 'Prep brief for ' + short(c.clinicalOffer.title, 40), {
        when: 'tomorrow',
        detail:
          'The skills to review with their packet pages, your skill weak spots and any instructor note. Never your graded paperwork.',
        action: { label: 'Brief me', chip: 'Brief me for clinical' },
        date: c.clinicalOffer.date,
      });
    if (tmrClinical && !(prepDayNow && prepPhase === 'night' && prepDayNow.kind === 'clinical'))
      put('normal', 'clinical', tmrClinical.title, { when: 'tomorrow', tab: 'record' });
    if (soon && c.readiness && c.readiness.examId === soon.id)
      put(
        'normal',
        'exam',
        `${exName(soon)} in ${diffDays(date, soon.date)} day${diffDays(date, soon.date) === 1 ? '' : 's'}: ${c.readiness.pctSolid ?? 0}% solid`,
        { when: shortDay(soon.date), detail: `About ${c.readiness.need} correct reviews to go.`, tab: 'progress' }
      );
    if (failed.length)
      put('normal', 'system', `The ${failed[0][0]} run failed`, {
        detail: failed[0][1].detail ? String(failed[0][1].detail).slice(0, 200) : '',
        tab: 'system',
      });
    if (c.checkin && c.checkin.energy != null && c.checkin.energy <= 2)
      put('normal', 'checkin', 'You logged low energy today', { detail: 'Say the word and I’ll lighten the list.' });
    if (c.quizlet && c.quizlet.refresh && [5, 6, 0].includes(weekday(date)))
      put('normal', 'quizlet', `Quizlet pick: ${c.quizlet.refresh}`);
    const rank = { urgent: 0, new: 1, prep: 2, normal: 3 };
    brief.sort((a, b) => rank[a.level] - rank[b.level]);
    const urg = brief.filter(b => b.level === 'urgent');
    const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
    const headline = urg.length
      ? `${hello} ${cap(urg[0].say)}${urg.length === 2 ? ', and ' + urg[1].say : urg.length > 2 ? `, plus ${urg.length - 1} more that can’t wait` : ''}.`
      : `${hello} How can I help${segment === 'morning' ? ' today' : ''}?`;
    if (urg.length) mood = 'alert';
    const prep = prepDayNow
      ? { phase: prepPhase, date: prepDayNow.date, kind: prepDayNow.kind, title: prepDayNow.title }
      : null;
    return {
      segment,
      mood,
      lines,
      cards: [],
      offers: cards.slice(0, 3),
      chips,
      job: finished ? finished.id : null,
      headline,
      brief: brief.map(({ say, ...b }) => b),
      prep,
    };
  }

  // ---------------------------------------------------------------- conversations (B-77, D-128)
  /**
   * The current conversation is derived, not stored (D-128): talk splits into conversations at a gap of
   * constants.conversation.idleGapMin minutes or more between one message and the next, and where the session changes
   * between Matt's or E.V.'s messages (B-74): a message written during a session carries session: ss-<id>, and Matt's
   * line within constants.conversation.sessionLeadMin minutes before a session's first message (the line that started
   * it) opens that session's conversation. A worker message (jobId) has no session of its own: it joins the
   * conversation it lands in. Midnight is not a boundary. msgs: [{id, at, role, session?, jobId?, ...}] in any order;
   * returns [{start, end, session, messages}] oldest first (session null outside one), messages in time order.
   */
  function conversations(msgs, o = {}) {
    const cc = core.C.conversation || {};
    const gap = (o.idleGapMin != null ? o.idleGapMin : cc.idleGapMin) * 60000;
    const lead =
      (o.sessionLeadMin != null ? o.sessionLeadMin : cc.sessionLeadMin != null ? cc.sessionLeadMin : 2) * 60000;
    const xs = [...(msgs || [])]
      .filter(m => m && m.at && Number.isFinite(toMs(m.at)))
      .sort((a, b) => toMs(a.at) - toMs(b.at) || String(a.id || '').localeCompare(String(b.id || '')));
    const first = new Map(); // session -> the time of its first message
    for (const m of xs) if (m.session && !first.has(m.session)) first.set(m.session, toMs(m.at));
    const sessionOf = m => {
      if (m.session) return m.session;
      if (m.role !== 'matt') return null;
      const t = toMs(m.at);
      let best = null;
      for (const [s, f] of first) if (f >= t && f - t <= lead && (!best || f < best[1])) best = [s, f];
      return best ? best[0] : null;
    };
    const out = [];
    for (const m of xs) {
      const last = out[out.length - 1];
      const worker = !!m.jobId;
      const s = worker ? undefined : sessionOf(m);
      const near = last && toMs(m.at) - toMs(last.end) < gap;
      // A conversation holding only worker messages so far has no session yet: the next message of Matt's or hers sets it.
      const same = near && (worker || last.session === undefined || last.session === s);
      if (same) {
        last.messages.push(m);
        last.end = m.at;
        if (!worker && last.session === undefined) last.session = s;
      } else out.push({ start: m.at, end: m.at, session: s, messages: [m] });
    }
    return out.map(c => ({ ...c, session: c.session || null }));
  }
  /** D-131: the name the notes bar and a comment's quote give the note: the reader's title, else Your notes. */
  const noteTitle = n => (n && typeof n.title === 'string' && n.title.trim()) || 'Your notes';
  /**
   * What a pull to load can bring back (D-128 as amended Oct 18): the conversation before the ones on screen, or the
   * edge a pull has reached. First the pulls stop at the start of today ({edge: 'today'}: "That's the start of today");
   * with o.pastToday a further pull continues into earlier days, one conversation at a time, until the talk read window
   * runs out ({edge: 'window'}: "That's everything from the last 7 days"): no conversation is left, or the next one
   * ended before o.windowStart. shown is how many conversations are on screen, counted from the newest; today and
   * windowStart are Central dates. A conversation is {index, count, conversation}, count its length.
   */
  function earlierConversation(convs, shown, today, o = {}) {
    const i = convs.length - 1 - shown,
      c = i >= 0 ? convs[i] : null,
      end = c ? chicagoDate(c.end) : null;
    if (!o.pastToday) {
      if (!c || end < today) return { edge: 'today' };
    } else if (!c || (o.windowStart && end < o.windowStart)) return { edge: 'window' };
    return { index: i, count: c.messages.length, conversation: c };
  }

  return { greeting, conversations, noteTitle, earlierConversation };
}
