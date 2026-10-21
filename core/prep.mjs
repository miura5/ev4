// E.V. core's prep checks (D-143, D-144): clinical, lab, validation and class days, each with a tickable check built
// from that day's own materials. Split from core/evcore.mjs (B-159, D-166) as one factory with no imports, so the same file
// runs in node (evcore.mjs imports it) and in the page (the build writes it into core.js ahead of E.V. core). It takes
// the core names it uses and returns the names the rest of core and core's export map use.

export function makePrep(core) {
  'use strict';
  const {
    chicagoDate,
    citeMaterial,
    dayeditBase,
    defaultCourse,
    isoOf,
    libStem,
    libTokens,
    libraryChunks,
    libraryIndex,
    liveDates,
    norm,
    normCourse,
    safeId,
    searchLibrary,
    slug,
  } = core;

  // ---------------------------------------------------------------- prep checks (D-143, D-144)
  // Clinical, lab, validation and class days are never urgent: they get a calm Prep marker and a tickable check, the
  // night-before pack check in the evening and the morning-of bag check in the morning. Each list is built for that day
  // from that day's own materials (no approve-once kit): the calendar entry says what the day is, the library search
  // finds what it requires, and each item names its file and page. What Matt adds by hand lives in that day's
  // dayedits/<date>.added with the tag PREP (kept off the day's list); his ticks are its checks, keyed
  // prep-<night|morning>-<item>. A hand-added item comes back on later days of the same kind as "you usually bring".
  // Paperwork is listed to bring, never filled in (graded clinical work stays his).
  const PREP_KINDS = ['validation', 'clinical', 'lab', 'class'];
  const PREP_TAG = 'PREP';
  const isPrepAdded = a => !!a && a.tag === PREP_TAG;
  /** What kind of prep day a calendar entry makes, or null: validations and clinicals by kind, labs and classes by name. */
  function prepKindOf(d) {
    if (!d) return null;
    const t = String(d.title || '');
    if (d.kind === 'validation') return 'validation';
    if (d.kind === 'clinical') return 'clinical';
    if (d.kind !== 'other') return null; // graded work and exams keep their own markers
    if (/\bvalidat/i.test(t)) return 'validation';
    if (/\bclinical\b/i.test(t)) return 'clinical';
    if (/\blabs?\b/i.test(t)) return 'lab';
    if (/\b(class|lecture)\b/i.test(t)) return 'class';
    return null;
  }
  /** The prep day on a date: its kind (validation first, then clinical, lab, class), the entry's title and what it is
   *  about (the title past its "Validation:" or "Lab:" lead), or null when that day needs no prep. */
  function prepDay(dates, dateedits, date) {
    const on = liveDates(dates, dateedits)
      .filter(d => d.date === date)
      .map(d => ({ d, kind: prepKindOf(d) }))
      .filter(x => x.kind);
    if (!on.length) return null;
    on.sort(
      (a, b) => PREP_KINDS.indexOf(a.kind) - PREP_KINDS.indexOf(b.kind) || String(a.d.id).localeCompare(String(b.d.id))
    );
    const { d, kind } = on[0];
    const title = String(d.title || '').trim();
    const subject = title
      .replace(/^\s*(skills?\s+)?(validation|clinical|lab|class|lecture)s?\s*[:\-–]\s*/i, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim();
    return {
      date,
      kind,
      title,
      subject: subject && subject !== title ? subject : kind === 'validation' || kind === 'lab' ? subject : '',
      dateId: d.id || null,
      course: normCourse(d.course) || defaultCourse(),
    };
  }
  const PAPERWORK = /paperwork|\bforms?\b|worksheet|care plan|concept map/i;
  /** The bring-list entries in one passage: what follows "bring:", "you will need", "supplies needed" and the like. */
  function prepBringItems(text) {
    const P = core.C.prep || {};
    const out = [];
    // A list opens at a colon only (a dash is a page range in a table of contents), and a table of contents is no list.
    if (/table of contents/i.test(String(text || ''))) return out;
    const re = new RegExp('\\b' + (P.bring || 'bring') + '\\b[^:.;\\n]{0,40}?:\\s*([^.\\n]+)', 'gi');
    let m;
    while ((m = re.exec(String(text || ''))))
      for (const raw of m[1].split(/[,;•]|\s+and\s+|\s+\+\s+/)) {
        const t = raw
          .replace(/^\s*(?:a|an|the|your|one|two|1|2)\s+/i, '')
          .replace(/^[\s\-–*]+|[\s\-–*]+$/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const looksLikeItem =
          t.length >= 3 &&
          t.length <= 60 &&
          t.split(' ').length <= 7 &&
          (t.match(/\d+/g) || []).length <= 1 &&
          !/\d\s*[-–]\s*\d/.test(t);
        if (looksLikeItem && !/^(the following|following|these|this)$/i.test(t))
          out.push(t.charAt(0).toUpperCase() + t.slice(1));
      }
    return out;
  }
  /**
   * The prep check for one day. o: {day (prepDay), phase ('night' | 'morning'), materials (live) or index (libraryIndex
   * of their chunks), dates, dateedits, dayedits}. Returns {date, kind, title, subject, phase, items, empty, note, done}:
   * items [{id, text, cite, source: {id, title, page, unit}, paperwork, added, usual, checked}] from the materials first
   * (each with its file and page), then his own for this day, then the ones he usually brings on a day of this kind.
   */
  function prepList(o = {}) {
    const day = o.day;
    if (!day) return null;
    const P = core.C.prep || {};
    const phase = o.phase === 'morning' ? 'morning' : 'night';
    const index = o.index || libraryIndex(libraryChunks(o.materials || []));
    const subjectTokens = new Set(libTokens(day.subject || ''));
    const kindToken = libStem(day.kind === 'validation' ? 'validation' : day.kind);
    const query = [day.subject || day.title, (P.queryWords || {})[day.kind] || day.kind].join(' ');
    const ranked = searchLibrary(index, query, { k: P.searchK || 12 });
    // A passage belongs to the day when it names at least half of what the day is about. A clinical day also takes
    // what any passage says about clinical days (its baseline, from the syllabus or the clinical objectives); a day with
    // no subject takes its kind's passages.
    const full = new Map();
    for (const d of (index && index.docs) || []) {
      const key = d.c.id + '#' + d.c.page;
      if (!full.has(key)) full.set(key, []);
      full.get(key).push(d);
    }
    const passages = [];
    for (const h of ranked) {
      for (const d of full.get(h.id + '#' + h.page) || []) {
        if (passages.includes(d)) continue;
        const has = w => d.tf.has(w);
        const named = [...subjectTokens].filter(has).length;
        if (
          (subjectTokens.size && named * 2 >= subjectTokens.size) ||
          ((!subjectTokens.size || day.kind === 'clinical') && has(kindToken))
        )
          passages.push(d);
      }
    }
    const items = [];
    const seen = new Set();
    const add = (text, d, x = {}) => {
      const key = norm(text);
      if (!key || seen.has(key)) return;
      seen.add(key);
      items.push({
        id: slug(text, 32) || 'item',
        text,
        cite: d ? citeMaterial(d.c) : null,
        source: d ? { id: d.c.id, title: d.c.title, page: d.c.page, unit: d.c.unit } : null,
        paperwork: PAPERWORK.test(text),
        ...x,
      });
    };
    const looks = ((P.lookFor || {})[day.kind] || []).map(l => ({ item: l.item, re: new RegExp(l.match, 'i') }));
    for (const d of passages) {
      for (const t of prepBringItems(d.c.text)) {
        const seed = looks.find(l => l.re.test(t));
        add(seed ? seed.item : t, d);
      }
      if (!/table of contents/i.test(d.c.text)) for (const l of looks) if (l.re.test(d.c.text)) add(l.item, d);
    }
    const fromMaterials = items.length;
    const edits = {};
    for (const e of o.dayedits || []) if (e) edits[e.id || e.date] = e;
    const own = (edits[day.date] && edits[day.date].added) || {};
    for (const [id, a] of Object.entries(own)
      .filter(([, a]) => isPrepAdded(a))
      .sort(([, a], [, b]) => String(a.at || '').localeCompare(String(b.at || '')))) {
      const key = norm(a.text);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id,
        text: a.text,
        cite: null,
        source: null,
        paperwork: PAPERWORK.test(a.text),
        added: true,
        by: a.by || 'Matt',
      });
    }
    // Earlier days of the same kind, newest first: what he added there comes back as "you usually bring".
    const before = Object.values(edits)
      .filter(e => (e.id || e.date) < day.date && Object.values(e.added || {}).some(isPrepAdded))
      .sort((a, b) => String(b.id || b.date).localeCompare(String(a.id || a.date)));
    for (const e of before) {
      const other = prepDay(o.dates, o.dateedits, e.id || e.date);
      if (!other || other.kind !== day.kind) continue;
      for (const a of Object.values(e.added).filter(isPrepAdded)) {
        const key = norm(a.text);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: 'usual-' + (slug(a.text, 32) || 'item'),
          text: a.text,
          cite: null,
          source: null,
          paperwork: PAPERWORK.test(a.text),
          usual: true,
        });
      }
    }
    const checks = (edits[day.date] && edits[day.date].checks) || {};
    for (const it of items) it.checked = !!checks[prepCheckId(phase, it.id)];
    const what =
      day.subject && day.kind !== 'clinical'
        ? `${day.kind === 'validation' ? 'the ' + day.subject + ' validation' : day.kind === 'lab' ? 'the ' + day.subject + ' lab' : day.title}`
        : day.title;
    const note = fromMaterials
      ? null
      : `Nothing in your materials says what to bring for ${what}. Add what you know and I’ll keep it for next time.`;
    return {
      date: day.date,
      kind: day.kind,
      title: day.title,
      subject: day.subject,
      phase,
      items,
      empty: !fromMaterials,
      note,
      done: items.length > 0 && items.every(it => it.checked),
    };
  }
  const prepCheckId = (phase, id) => 'prep-' + (phase === 'morning' ? 'morning' : 'night') + '-' + id;
  /** One edit to a day's prep check, on that day's dayedits/<date>. add {text} · remove {id} (his own item) · check {id,
   *  phase, done?}. Returns {id, text, doc} with the whole new document (null when nothing changes, with a note). */
  function prepEdit(dayedit, edit, { now, by = 'Matt', date } = {}) {
    const action = edit && edit.action;
    const ed = dayedit || {};
    const forDate = date || ed.date || chicagoDate(now);
    by = by === 'E.V.' ? 'E.V.' : 'Matt';
    const next = () => dayeditBase(dayedit, forDate, now);
    const added = ed.added || {};
    if (action === 'add') {
      const text = String(edit.text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
      if (!text) throw new Error('text is required');
      const same = Object.entries(added).find(([, a]) => isPrepAdded(a) && norm(a.text) === norm(text));
      if (same) return { id: same[0], text: same[1].text, doc: null, note: 'already on the check' };
      const base = 'prep-' + (slug(text, 32) || 'item');
      let id = safeId(base);
      for (let n = 2; added[id]; n++) id = safeId(base + '-' + n);
      const doc = next();
      doc.added[id] = { text, tag: PREP_TAG, kind: 'todo', minutes: 0, course: '', at: isoOf(now), by };
      return { id, text, doc };
    }
    const id = String((edit && edit.id) || '');
    if (action === 'remove') {
      if (!isPrepAdded(added[id])) throw new Error('only an item you added can come off the check');
      const doc = next();
      delete doc.added[id];
      for (const p of ['night', 'morning']) delete doc.checks[prepCheckId(p, id)];
      return { id, text: added[id].text, doc };
    }
    if (action === 'check') {
      if (!id) throw new Error('id is required');
      const key = prepCheckId(edit.phase, id);
      const done = edit.done !== false;
      const checks = ed.checks || {};
      if (!!checks[key] === done) return { id, text: id, doc: null, note: done ? 'already ticked' : 'not ticked yet' };
      const doc = next();
      if (done) doc.checks[key] = { at: isoOf(now), by };
      else delete doc.checks[key];
      return { id, text: id, doc };
    }
    throw new Error('action must be add, remove or check');
  }

  // ---------------------------------------------------------------- clinical-prep brief (D-103, B-46)
  // A worker job of kind clinical-prep reads the next clinical's calendar entry, the clinical and lab materials, his
  // open skill weak spots and any instructor note; never the graded clinical paperwork. The read set is decided here,
  // by each file's section and title, so the worker is never handed a graded form to read or draft.
  const GRADED_CLINICAL = [
    ['data prep sheet', /\bdata\s*(collection|prep(aration)?)\b|\bprep(aration)?\s*sheet/i],
    ['judgment map', /\bjudg(e)?ment\s*map/i],
    ['drug cards', /\bdrug\s*cards?\b/i],
    ['medication table', /\bmed(ication)?s?\s*(table|sheet|list|administration\s*record)\b/i],
    ['medication table', /\bMAR\b/],
    ['care plan', /\bcare\s*plan|\bconcept\s*map/i],
    ['clinical paperwork', /\bpaperwork\b|\bclinical\s*(forms?|packet\s*(to\s*)?submit|submission)/i],
  ];
  /** Why a material is graded clinical paperwork (by its section, then its title), or null. */
  function gradedClinicalPaperwork(m) {
    for (const where of ['section', 'title']) {
      const t = String((m && m[where]) || '');
      for (const [why, re] of GRADED_CLINICAL) if (re.test(t)) return `${why} (${where})`;
    }
    return null;
  }
  const CLINICAL_TEXT = /\b(clinical|skills?|lab|validation|packet|checklist|procedure)s?\b/i;
  /**
   * The clinical-prep job's read set: the course's clinical and lab materials (by kind, or a section or title that
   * names clinical, skills, lab, a packet or a checklist), less the graded clinical paperwork. Returns {read, left},
   * left as [{id, title, why}] so the brief can say what it did not open.
   */
  function clinicalReadSet(materials, course) {
    const want = course ? normCourse(course) : null;
    const read = [],
      left = [];
    for (const m of materials || []) {
      if (!m) continue;
      if (want && normCourse(m.course) && normCourse(m.course) !== want) continue;
      const clinical =
        ['clinical', 'lab'].includes(m.kind) ||
        CLINICAL_TEXT.test(`${m.section || ''} ${m.title || ''} ${m.module || ''}`);
      if (!clinical) continue;
      const why = gradedClinicalPaperwork(m);
      if (why) left.push({ id: m.id, title: m.title, why });
      else read.push(m);
    }
    return { read, left };
  }
  /** The next clinical day on or after `date` (a prepDay of kind clinical), or null. */
  function nextClinical(dates, dateedits, date) {
    const days = [...new Set(liveDates(dates, dateedits).map(d => d.date))].filter(d => d >= date).sort();
    for (const d of days) {
      const p = prepDay(dates, dateedits, d);
      if (p && p.kind === 'clinical') return p;
    }
    return null;
  }
  /**
   * The greeting's one offer (D-103): tomorrow is a clinical day and no clinical-prep job names that date. Returns
   * {date, title} or null; the brief is written only on his tap.
   */
  function clinicalPrepOffer({ dates, dateedits, jobs, date }) {
    const tomorrow = new Date(Date.parse(date + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
    const day = prepDay(dates, dateedits, tomorrow);
    if (!day || day.kind !== 'clinical') return null;
    if ((jobs || []).some(j => j.kind === 'clinical-prep' && String(j.brief || '').includes(tomorrow))) return null;
    return { date: tomorrow, title: day.title };
  }

  return {
    isPrepAdded,
    prepKindOf,
    prepDay,
    prepBringItems,
    prepList,
    prepEdit,
    gradedClinicalPaperwork,
    clinicalReadSet,
    nextClinical,
    clinicalPrepOffer,
  };
}
