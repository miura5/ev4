// The synthetic record's seed (B-100, first written for the demo copy, B-83, which is gone): a made-up first-semester
// nursing student's study record, dated from the moment it is built (Central time), so it always has today's review,
// an exam two days out and a week of dates. test/data/synthetic.cjs adds the documents the harnesses name; every
// document validates against spec/schemas (test/synthetic.test.mjs). Nothing here is Matt's: no real course file,
// Canvas text, journal, conversation or answer. Clinical content is generic textbook fundamentals, and every client is
// made up.
(function (g) {
  'use strict';
  const TZ = 'America/Chicago';
  const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  // An instant at a Central wall-clock time on a date, right across daylight saving.
  function ct(date, hh, mm = 0) {
    let t = Date.parse(date + 'T00:00:00Z') + (hh + 6) * 36e5 + mm * 6e4;
    const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));
    t -= ((h - hh + 24) % 24) * 36e5; return new Date(t).toISOString();
  }
  const key = (writer, iso) => writer + '-' + iso.replace(/[-:]/g, '').replace('T', '-').replace(/\.\d+Z$/, '').replace('Z', '');
  const env = (writer, source, at) => ({ schema: 1, writer, at, source });

  g.seed = function (nowDate) {
    const now = nowDate || new Date(), today = ymd(now), yday = addDays(today, -1), d = n => addDays(today, n);
    const morning = ct(today, 4, 25), lastNight = ct(yday, 20, 15);
    const db = {};
    const put = (c, id, doc) => { (db[c] = db[c] || {})[id] = doc; };

    // ---- exams and objectives
    put('exams', 'E3', { schema: 2, writer: 'page', at: ct(addDays(today, -40), 9), source: 'Told E.V.', course: 'NUR 112', kind: 'unit', date: d(-12), title: 'Exam 3: Safety and infection control', status: 'done' });
    put('exams', 'E4', { schema: 2, writer: 'page', at: ct(addDays(today, -40), 9), source: 'Told E.V.', course: 'NUR 112', kind: 'unit', date: d(2), title: 'Exam 4: Fluids, electrolytes and perfusion', status: 'upcoming' });
    put('exams', 'E5', { schema: 2, writer: 'page', at: ct(addDays(today, -40), 9), source: 'Told E.V.', course: 'NUR 112', kind: 'unit', date: d(23), title: 'Exam 5: Nutrition and elimination', status: 'upcoming' });
    const OBJ = [
      ['E4-1', 'Explain fluid balance and the signs of fluid volume deficit and excess.', [39]],
      ['E4-2', 'Relate sodium and potassium to their normal ranges and the signs of imbalance.', [39]],
      ['E4-3', 'Describe preload, afterload and what changes cardiac output.', [40]],
      ['E4-4', 'Measure vital signs accurately and recognize abnormal findings.', [29]],
      ['E4-5', 'Choose IV solutions by tonicity and anticipate their effects.', [39]],
    ];
    OBJ.forEach(([id, text, chapters], i) => put('objectives', id, { ...env('worker', 'Exam plan job', ct(addDays(today, -30), 10)), exam: 'E4', num: i + 1, text, chapters }));

    // ---- weak spots (facts: what was missed, and when); their state is rebuilt from answers and events
    const WS = [
      ['ws-demo-fve', 'E4-1', 'Signs of fluid volume excess', 'Review miss', -6],
      ['ws-demo-iv', 'E4-5', 'Isotonic vs hypotonic IV solutions', 'Drill', -5],
      ['ws-demo-k', 'E4-2', 'Normal potassium range and hyperkalemia signs', 'Review miss', -5],
      ['ws-demo-na', 'E4-2', 'Hyponatremia and neuro changes', 'Told E.V.', -4],
      ['ws-demo-preload', 'E4-3', 'Preload vs afterload', 'Study session', -4],
      ['ws-demo-co', 'E4-3', 'What raises cardiac output', 'Review miss', -3],
      ['ws-demo-ortho', 'E4-4', 'Orthostatic blood pressure technique', 'Skills practice', -3],
      ['ws-demo-weight', 'E4-1', 'Daily weight as the best fluid indicator', 'Review miss', -2],
      ['ws-demo-pulse', 'E4-4', 'Apical-radial pulse deficit', 'Drill', -10],
      ['ws-demo-dehydr', 'E4-1', 'Older adults and the thirst response', 'Review miss', -11],
    ];
    for (const [id, objective, topic, source, ago] of WS) {
      const at = ct(d(ago), 19, 30);
      put('weakspots', id, { ...env('page', source, at), addedAt: at, addedBy: 'Matt', topic, objective, exam: 'E4', course: 'NUR 112', kind: 'concept', initial: { streak: 0, nextDue: d(ago + 1), recurrence: 1, misses: 1 }, events: {} });
    }

    // ---- the review sets: yesterday's (answered) and today's (waiting)
    const it = (id, wsId, objective, topic, type, stem, rest) => ({ id, kind: 'review', type, stem, ...rest, objective, topic, weakspotId: wsId, cjStep: 'recognize-cues', sourceRef: 'materials/NUR112-990002' });
    const Q = {
      fve: it('q-fve', 'ws-demo-fve', 'E4-1', 'Signs of fluid volume excess', 'single', 'A client on IV fluids gains 1.5 kg overnight and has crackles in both lung bases. Which finding best supports fluid volume excess?', { options: ['Weight gain with crackles', 'Dry mucous membranes', 'Flat neck veins when lying down', 'Concentrated, dark urine'], correct: [0], rationales: ['Right: rapid weight gain plus crackles means fluid is building up, including in the lungs.', 'Dry mucous membranes point to a deficit, not an excess.', 'Flat neck veins lying down suggest low volume.', 'Concentrated urine suggests the body is holding on to water: a deficit.'] }),
      iv: it('q-iv', 'ws-demo-iv', 'E4-5', 'Isotonic vs hypotonic IV solutions', 'single', 'Which IV solution is isotonic and stays mostly in the vessels?', { options: ['0.9% sodium chloride', '0.45% sodium chloride', '3% sodium chloride', 'Sterile water'], correct: [0], rationales: ['Right: normal saline matches plasma tonicity, so it expands the vascular space.', '0.45% saline is hypotonic and moves water into the cells.', '3% saline is hypertonic and pulls water out of the cells.', 'Sterile water is never given IV on its own: it would lyse red cells.'] }),
      k: it('q-k', 'ws-demo-k', 'E4-2', 'Normal potassium range and hyperkalemia signs', 'single', 'A client’s potassium is 6.1 mEq/L (normal 3.5 to 5.0). Which finding should the nurse watch for first?', { options: ['Peaked T waves on the monitor', 'Hand tremors', 'Intense thirst', 'Facial flushing'], correct: [0], rationales: ['Right: high potassium changes the heart’s conduction first; peaked T waves come before dangerous rhythms.', 'Tremor is not the priority sign of hyperkalemia.', 'Thirst fits a sodium or fluid problem.', 'Flushing is not a sign of hyperkalemia.'] }),
      na: it('q-na', 'ws-demo-na', 'E4-2', 'Hyponatremia and neuro changes', 'sata', 'A client’s sodium is 128 mEq/L. Which findings fit hyponatremia? Select all that apply.', { options: ['New confusion', 'Headache', 'Nausea', 'Intense thirst', 'Muscle weakness'], correct: [0, 1, 2, 4], rationales: ['Fits: water moves into brain cells, so mental status changes first.', 'Fits: cerebral swelling causes headache.', 'Fits: nausea is an early sign.', 'Thirst points to high sodium, not low.', 'Fits: low sodium weakens muscle contraction.'] }),
      preload: it('q-preload', 'ws-demo-preload', 'E4-3', 'Preload vs afterload', 'single', 'Which statement best describes preload?', { options: ['The stretch of the ventricle at the end of filling', 'The pressure the ventricle must push against to eject', 'The number of beats per minute', 'The force of the atria contracting'], correct: [0], rationales: ['Right: preload is the volume, and so the stretch, at the end of diastole.', 'That is afterload.', 'That is heart rate.', 'Atrial kick adds to filling but is not the definition of preload.'] }),
      co: it('q-co', 'ws-demo-co', 'E4-3', 'What raises cardiac output', 'single', 'Cardiac output equals:', { options: ['Heart rate × stroke volume', 'Stroke volume ÷ heart rate', 'Mean arterial pressure × heart rate', 'Preload minus afterload'], correct: [0], rationales: ['Right: CO = HR × SV, about 4 to 8 L a minute at rest.', 'Dividing is the wrong way round.', 'MAP is a result of cardiac output and resistance, not a factor of it.', 'Preload and afterload change stroke volume; they are not subtracted.'] }),
      ortho: it('q-ortho', 'ws-demo-ortho', 'E4-4', 'Orthostatic blood pressure technique', 'single', 'When checking orthostatic vital signs, the nurse takes the first blood pressure with the client:', { options: ['Lying down after resting a few minutes', 'Standing', 'Sitting with the legs dangling', 'Right after walking'], correct: [0], rationales: ['Right: start supine after a rest, then sitting, then standing, a minute or two apart.', 'Standing comes last.', 'Sitting is the middle reading.', 'Activity first would hide the change you are looking for.'] }),
      weight: it('q-weight', 'ws-demo-weight', 'E4-1', 'Daily weight as the best fluid indicator', 'matrix', 'For each made-up finding, choose whether it suggests fluid deficit or fluid excess.', { matrix: { columns: ['Deficit', 'Excess'], rows: [{ text: 'Bounding pulse', correct: 1, rationale: 'Extra volume makes the pulse full and bounding.' }, { text: 'Weight down 1 kg in a day', correct: 0, rationale: 'A kilogram in a day is about a litre of fluid lost.' }, { text: 'Distended neck veins', correct: 1, rationale: 'Neck veins fill when there is too much volume.' }, { text: 'Dark, concentrated urine', correct: 0, rationale: 'The kidneys hold on to water when volume is low.' }] } }),
    };
    // Two weak spots were made solid last week: right on two different days.
    const older = { pulse: it('q-pulse', 'ws-demo-pulse', 'E4-4', 'Apical-radial pulse deficit', 'single', 'A client\u2019s apical pulse is 96 and the radial pulse is 84. What is the pulse deficit?', { options: ['12', '180', '84', '96'], correct: [0], rationales: ['Right: apical minus radial, 96 \u2212 84 = 12.', 'Adding them is not a measure of anything.', 'That is the radial rate.', 'That is the apical rate.'] }),
      dehydr: it('q-dehydr', 'ws-demo-dehydr', 'E4-1', 'Older adults and the thirst response', 'single', 'Why are older adults at higher risk of dehydration?', { options: ['Their thirst response is blunted', 'They need far less water', 'Their kidneys hold on to more water', 'They sweat much more'], correct: [0], rationales: ['Right: they feel thirst later, so intake falls behind.', 'Needs fall a little, not far.', 'Ageing kidneys concentrate urine less well, so they lose more.', 'Older adults sweat less, not more.'] }) };
    for (const ago of [-8, -6]) {
      const day = d(ago), sid = 'review-' + day;
      put('sets', sid, { ...env('morning', 'morning 4:25', ct(day, 4, 31)), schema: 3, kind: 'review', date: day, exam: 'E4', items: [older.pulse, older.dehydr].map(x => ({ ...x, id: x.id + ago })) });
      const a = (n, id) => { const at = ct(day, 18, n); return { [id + ago]: { [key('page', at)]: { chosen: [0], correct: true, score: 1, at, outcome: 'right' } } }; };
      put('answers', sid, { ...env('page', 'E.V. Home', ct(day, 18, 10)), schema: 2, setId: sid, answers: { ...a(1, 'q-pulse'), ...a(2, 'q-dehydr') } });
    }
    put('sets', 'review-' + yday, { ...env('morning', 'morning 4:25', ct(yday, 4, 31)), schema: 3, kind: 'review', date: yday, exam: 'E4', items: [Q.fve, Q.iv, Q.k, Q.preload, Q.co, Q.ortho].map(x => ({ ...x, id: x.id + '-y' })) });
    put('sets', 'review-' + today, { ...env('morning', 'morning 4:25', ct(today, 4, 31)), schema: 3, kind: 'review', date: today, exam: 'E4', items: [Q.fve, Q.iv, Q.k, Q.na, Q.preload, Q.co, Q.ortho, Q.weight] });
    // Yesterday he got the cardiac-output and orthostatic questions right and missed the rest.
    const ans = (n, chosen, right) => { const at = ct(yday, 19, 10 + n); return { [key('page', at)]: { chosen, correct: right, score: right ? 1 : 0, at, outcome: right ? 'right' : 'wrong' } }; };
    put('answers', 'review-' + yday, { ...env('page', 'E.V. Home', ct(yday, 19, 20)), schema: 2, setId: 'review-' + yday, answers: { 'q-fve-y': ans(1, [1], false), 'q-iv-y': ans(2, [1], false), 'q-k-y': ans(3, [0], true), 'q-preload-y': ans(4, [1], false), 'q-co-y': ans(5, [0], true), 'q-ortho-y': ans(6, [0], true) } });

    // ---- today's list and the calendar
    // B-48 (D-105): each morning stamps readiness per upcoming exam; the week before today climbs toward Exam 4.
    const stamp = (e4, e5) => ({ E4: { pctSolid: e4, active: 8, solid: Math.round(e4 / 12), accuracy7: e4 ? 40 + e4 : null, answers7: 6 + e4 / 5 }, E5: { pctSolid: e5, active: 4, solid: 0, accuracy7: null, answers7: 0 } });
    put('days', today, { ...env('morning', 'morning 4:25', ct(today, 4, 32)), schema: 3, shadow: null, readiness: stamp(20, 0), date: today, dayType: 'class',
      plan: { budget: { available: 180, planned: 85, over: 0 }, blocks: [], deferred: [], reviews: { load: { load: 8, base: 10, flex: null, reason: 'Class day, exam in 2 days: 8' }, ids: WS.slice(0, 8).map(w => w[0]), checks: [], target: 'E4' } },
      list: { items: [
        { id: 'read-ch39', text: 'Read Ch 39: Fluid, electrolyte and acid-base balance (~45 min)', tag: 'READING', minutes: 45 },
        { id: 'drill-e4', text: 'Drill: Exam 4 weak spots, 10 questions (~20 min)', tag: 'DRILL', minutes: 20 },
        { id: 'skills-vitals', text: 'Practice the vital signs checklist (~20 min)', tag: 'SKILLS', minutes: 20 },
        { id: 'soon-demo-quiz', text: 'Unit quiz: fluids and electrolytes due 11:59pm (due tomorrow)', tag: 'GRADED', minutes: 0, note: 'Graded', ref: 'dates/demo-quiz' },
        { id: 'exam-E4', text: 'Exam 4: Fluids, electrolytes and perfusion (in 2 days)', tag: 'EXAM', minutes: 0, note: 'Scheduled only', ref: 'exams/E4' },
      ], focus: [], push: 'Class day · 8 reviews ready · Read Ch 39', budget: { available: 180, planned: 85, over: 0 }, deferred: [] },
      push: 'Class day · 8 reviews ready · Read Ch 39' });
    // The six mornings before today, as their runs wrote them (the trend's points).
    [0, 5, 5, 10, 10, 15].forEach((pct, i) => {
      const k = 6 - i;
      put('days', d(-k), { ...db.days[today], ...env('morning', 'morning 4:25', ct(d(-k), 4, 32)), schema: 3, date: d(-k), readiness: stamp(pct, 0) });
    });
    const date = (id, n, title, kind, graded) => put('dates', id, { ...env('page', 'owner', ct(d(-7), 18)), addedAt: ct(d(-7), 18), date: d(n), title, kind, course: 'NUR 112', graded });
    date('demo-quiz', 1, 'Unit quiz: fluids and electrolytes', 'due', true);
    date('demo-clinical', 3, 'Clinical: med-surg unit, 0630–1500', 'clinical', false);
    date('demo-ati', 5, 'Practice module: nutrition basics', 'due', false);
    date('demo-checkoff', 8, 'Skills check-off: vital signs', 'validation', false);
    date('demo-care-plan', 10, 'Care plan draft due', 'due', true);

    // ---- the library: a made-up skills packet and a made-up handout
    const lib = (id, title, kind, fileType, text, pages) => put('materials', id, { ...env('canvas-sync', 'Canvas sync', ct(d(-20), 20, 20)), course: 'NUR 112', kind, title, module: 'Week 9', fileType, fileId: Number(id.split('-')[1]), text, pages, chars: text.length, needsOcr: false });
    lib('NUR112-990001', 'Demo Skills Packet.pdf', 'lab', 'pdf', [
      '[p1] Demo Skills Packet. Contents: Bed bath 2; Vital signs 4',
      '[p2] 2 1 st Attempt: S or U Student Name Date Instructor Name BED BATH VALIDATION CHECKLIST The student may miss NONE of the asterisk (*) areas and only 1 of the non-asterisk areas. * 1. Perform hand hygiene 2. Introduce yourself and explain the procedure * 3. Check the client’s identity with two identifiers 4. Provide privacy * 5. Lower the bed rail on the working side only 6. Wash from cleanest to dirtiest area',
      '[p3] 3 * 7. Raise the bed rail before stepping away 8. Document the bath and skin findings Overall Performance: ______ / 8',
      '[p4] 4 1 st Attempt: S or U Student Name Date Instructor Name VITAL SIGNS VALIDATION CHECKLIST The student may miss NONE of the asterisk (*) areas. * 1. Perform hand hygiene 2. Explain the procedure 3. Count the radial pulse for a full minute 4. Count respirations without telling the client * 5. Choose the right cuff size 6. Measure blood pressure 7. Measure temperature 8. Report abnormal findings to the nurse Overall Performance: ______ / 8',
    ].join('\n'), 4);
    lib('NUR112-990002', 'Fluids and electrolytes handout.pdf', 'handout', 'pdf', [
      '[p1] Fluids and electrolytes, a made-up handout. Daily weight is the most reliable indicator of fluid balance: 1 kg is about 1 L.',
      '[p2] Isotonic solutions (0.9% NaCl, lactated Ringer’s) expand the vascular space. Hypotonic solutions (0.45% NaCl) move water into the cells. Hypertonic solutions (3% NaCl) pull water out of the cells.',
      '[p3] Sodium 135 to 145 mEq/L; low sodium shows first as confusion and headache. Potassium 3.5 to 5.0 mEq/L; high potassium shows first on the heart monitor as peaked T waves.',
      '[p4] Cardiac output = heart rate × stroke volume. Preload is the stretch at the end of filling; afterload is the resistance the ventricle pushes against.',
    ].join('\n'), 4);

    // ---- a filed study session, an idea, yesterday's conversation, the runs and the status page
    const s0 = ct(yday, 18, 30), s1 = ct(yday, 19, 5);
    put('sessions', 'ss-' + yday.replace(/-/g, '') + '-183000-fluids', { ...env('page', 'E.V. Home', s1), schema: 2, comments: 'some', status: 'ended', date: yday, startedAt: s0, endedAt: s1, topic: 'Fluids and electrolytes', events: { [key('page', s0)]: { type: 'start', len: 820, h: 'demo01' } }, minutes: 35, summary: 'Two checks on the new notes; isotonic vs hypotonic came up twice.', cards: [{ term: 'Isotonic solution', definition: 'Same tonicity as plasma; stays in the vessels (0.9% NaCl).' }, { term: 'Daily weight', definition: 'The best single indicator of fluid balance; 1 kg is about 1 L.' }] });
    put('ideas', 'demo-idea-1', { schema: 2, writer: 'page', at: s1, source: 'E.V. Home', text: 'Low sodium and high potassium both show up in places I don’t expect: the brain and the heart.', objective: 'E4-2', status: 'open', links: [{ to: 'weakspots/ws-demo-na', type: 'related' }], kind: 'learning' });
    const m1 = ct(yday, 21, 2), m2 = ct(yday, 21, 3);
    put('talk', yday, { ...env('page', 'E.V. Home', m2), schema: 3, date: yday, messages: {
      [`m-${m1.replace(/[-:]/g, '').replace('T', '-').replace('.', '').replace('Z', '')}-matt`]: { role: 'matt', text: 'Why does 0.45% saline go into the cells?', at: m1 },
      [`m-${m2.replace(/[-:]/g, '').replace('T', '-').replace('.', '').replace('Z', '')}-ev`]: { role: 'ev', text: 'It has fewer particles than the inside of your cells, so water follows the gradient inward. That is why it hydrates cells but does little for blood pressure. Exam hook: hypo goes in, hyper pulls out.', at: m2, tier: 'default' },
    } });
    put('talk', 'memory', { ...env('page', 'E.V. Home', m2), schema: 3, summary: 'Demo student, NUR 112, Exam 4 in two days. Working on fluids and electrolytes.', upTo: '', summarizedAt: m2, lastSeenAt: ct(yday, 21, 5) });
    const run = (pipeline, startedAt, mins) => { const id = pipeline + '-' + startedAt.replace(/[-:]/g, '').replace('T', '-').replace(/\.\d+Z$/, ''); put('runs', id, { ...env(pipeline, pipeline, startedAt), release: 'v4.0.0', pipeline, startedAt, endedAt: new Date(Date.parse(startedAt) + mins * 6e4).toISOString(), status: 'ok' }); return { id, status: 'ok', startedAt, endedAt: new Date(Date.parse(startedAt) + mins * 6e4).toISOString(), release: 'v4.0.0' }; };
    const pipes = { 'evening-cloud': run('evening-cloud', lastNight, 3), 'evening-mac': run('evening-mac', ct(yday, 20, 20), 6), morning: run('morning', morning, 7), watchdog: run('watchdog', ct(today, 1, 55), 2) };
    // The watchdog's last check: 4:57am, or 20 minutes ago once that is later (it checks every three hours, so a
    // 4:57am check reads as stopped by the afternoon).
    const checked = new Date(Math.max(Date.parse(ct(today, 4, 57)), now.getTime() - 20 * 6e4)).toISOString();
    put('health', 'current', { ...env('watchdog', 'watchdog', checked), record: 'demo', pipelines: pipes, missing: [], stalledRuns: [], stalledJobs: [], reported: [], verifyDeploy: null });
    return db;
  };
})(module.exports);
