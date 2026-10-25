// E.V. core's prep checks (D-143, D-144): clinical, lab, validation and class days, each with a tickable check built
// from that day's own materials. Split from core/evcore.mjs (B-159, D-166) as one factory with no imports, so the same file
// runs in node (evcore.mjs imports it) and in the page (the build writes it into core.js ahead of E.V. core). It takes
// the core names it uses and returns the names the rest of core and core's export map use.

export function makePrep(core) {
  'use strict';
  const {
    chicagoClock,
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
  // B-189: date arithmetic on YYYY-MM-DD (UTC noon, so no clock change moves a day), kept here so the factory stays
  // free of imports.
  const utc = iso => Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z');
  const addDays = (iso, n) => new Date(utc(iso) + n * 864e5).toISOString().slice(0, 10);
  const weekday = iso => new Date(utc(iso)).getUTCDay();
  const shortDate = x => {
    const d = String(x).length === 10 ? x : chicagoDate(x);
    return (
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(d)] +
      ' ' +
      Number(d.slice(5, 7)) +
      '/' +
      Number(d.slice(8, 10))
    );
  };

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
  /** What kind of prep day a calendar entry makes, or null: validations and clinicals by kind, labs and classes by name.
   *  B-189: an exam is sat in a lab or a classroom, so it makes a lab day when its title names a lab or a practical and
   *  a class day otherwise; it keeps its own exam marker as well (the Prep marker is its own calm level, D-143). Graded
   *  work due is never a prep day. */
  function prepKindOf(d) {
    if (!d) return null;
    const t = String(d.title || '');
    if (d.kind === 'validation') return 'validation';
    if (d.kind === 'clinical') return 'clinical';
    if (d.kind === 'exam') return /\blabs?\b|\bpracticals?\b/i.test(t) ? 'lab' : 'class';
    if (d.kind !== 'other') return null; // graded work due keeps its own marker
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
    const subject = prepSubject(title);
    return {
      date,
      kind,
      title,
      subject: subject && subject !== title ? subject : kind === 'validation' || kind === 'lab' ? subject : '',
      dateId: d.id || null,
      course: normCourse(d.course) || defaultCourse(),
      // B-189: every prep entry that day (a lab exam and a class exam on one day both count), in rank order.
      entries: on.map(x => ({
        id: x.d.id || null,
        kind: x.kind,
        title: String(x.d.title || '').trim(),
        course: normCourse(x.d.course) || defaultCourse(),
        text: [x.d.title, x.d.notes, x.d.canvasNote].filter(Boolean).join('. '),
      })),
    };
  }
  /** What an entry's title is about, past a course code and its "Lab:", "Validation:" or "Lab Exam:" lead. */
  function prepSubject(title) {
    return String(title || '')
      .replace(/^\s*[A-Z]{2,5}\s?\d{3}[A-Z]?\s+(?=\S)/, '')
      .replace(/^\s*(skills?\s+)?(validation|clinical|lab|class|lecture)s?(\s+(exam|practical|quiz))?\s*[:\-–]\s*/i, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim();
  }
  const PREP_LABEL = { clinical: 'Clinical day', validation: 'Validation day', lab: 'Lab day', class: 'Class day' };
  /** B-189: the prep day on a date from the calendar, or, when the calendar has none and he said what the day is ("I
   *  have lab today"), that kind of day from his words. Kinds he named, in rank order; null when neither says. */
  function prepDaySaid(dates, dateedits, date, said = []) {
    const day = prepDay(dates, dateedits, date);
    if (day) return day;
    const kinds = PREP_KINDS.filter(k => (said || []).includes(k));
    if (!kinds.length) return null;
    const title = PREP_LABEL[kinds[0]] + ' (from what you said)';
    return {
      date,
      kind: kinds[0],
      title,
      subject: '',
      dateId: null,
      course: defaultCourse(),
      said: true,
      entries: kinds.map(k => ({ id: null, kind: k, title: PREP_LABEL[k], course: defaultCourse(), text: '' })),
    };
  }
  /** Patterns for a date written out in a calendar or an announcement: 10/21, 10/21/26, Oct 21, October 21st. */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June?', 'July?', 'Aug', 'Sept?', 'Oct', 'Nov', 'Dec'];
  const MONTH_LONG = ['uary', 'ruary', 'ch', 'il', '', '', '', 'ust', 'ember', 'ober', 'ember', 'ember'];
  function dateRe(date) {
    const [y, m, d] = String(date).split('-').map(Number);
    const yy = String(y).slice(2);
    const num = `(?<![\\d/.])0?${m}[/.]0?${d}(?:[/.](?:${y}|${yy}))?(?![\\d/])`;
    const name = `\\b${MONTHS[m - 1]}(?:${MONTH_LONG[m - 1]})?\\.?\\s+0?${d}(?:st|nd|rd|th)?\\b`;
    return new RegExp(`${num}|${name}`, 'i');
  }
  const ANY_DATE =
    /(?<![\d/.])\d{1,2}[/.]\d{1,2}(?![\d])|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/gi;
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  /** The stretches of a text about one date: from each mention of the date to the next date it names (at most 240
   *  characters), so a calendar row or an announcement sentence about another day is not this day's. */
  function dateStretches(text, re) {
    const s = String(text || '');
    const out = [];
    const g = new RegExp(re.source, 'gi');
    let m;
    while ((m = g.exec(s)) && out.length < 6) {
      const start = m.index;
      ANY_DATE.lastIndex = start + m[0].length;
      const next = ANY_DATE.exec(s);
      const end = Math.min(next ? next.index : s.length, start + 240);
      out.push(s.slice(start, end).trim());
      g.lastIndex = Math.max(g.lastIndex, end);
    }
    return out;
  }
  /** The sentences of an announcement that are about a date: they name it, or (an announcement from that week) its
   *  weekday. */
  function announcementLines(a, date) {
    const text = [a.title, a.text].filter(Boolean).join('. ');
    const re = dateRe(date);
    const posted = a.postedAt ? chicagoDate(a.postedAt) : null;
    if (posted && posted > date) return [];
    const sameWeek = posted && posted >= addDays(date, -6);
    const wd = new RegExp('\\b' + WEEKDAYS[weekday(date)] + '\\b', 'i');
    const out = [];
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
      const t = sentence.trim();
      if (!t) continue;
      if (re.test(t)) out.push(...dateStretches(t, re));
      else if (sameWeek && wd.test(t)) out.push(t.slice(0, 240));
    }
    return out;
  }
  /** B-189: in a stretch already about the day ("10/21 Lab Exam: bring a pencil and your lab manual"), "bring" opens a
   *  list without a colon too. */
  function looseBring(text) {
    const out = [];
    const re = /\bbring\s+(?!up\b|back\b|down\b|over\b|it\b|them\b)([^.;:!?]{3,90})/gi;
    let m;
    while ((m = re.exec(String(text || ''))))
      for (const raw of m[1].split(/,|\s+and\s+|\s+&\s+|\s+or\s+/)) {
        const t = raw
          .replace(/^\s*(?:a|an|the|your|my|one|two|1|2)\s+/i, '')
          .replace(/\s+(?:to|for|with|on|at|in)\b.*$/i, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (t.length >= 3 && t.split(' ').length <= 5 && !/\d/.test(t))
          out.push(t.charAt(0).toUpperCase() + t.slice(1));
      }
    return out;
  }
  /** B-189: the materials a stretch of text names for the day (the textbook and its chapters, a lab guide, a handbook),
   *  by spec.constants.prep.named; "{1}" in an item is the pattern's first group. */
  function namedMaterials(text) {
    const out = [];
    for (const r of (core.C.prep || {}).named || []) {
      const g = new RegExp(r.match, 'gi');
      let m;
      while ((m = g.exec(String(text || '')))) {
        const raw = r.take ? m[0] : String(r.item || '').replace('{1}', (m[1] || '').replace(/\s+/g, ' ').trim());
        const t = raw
          .replace(/\s+/g, ' ')
          .replace(/^(?:your|the|a|an|my|our)\s+/i, '')
          .trim();
        if (t) out.push(t.charAt(0).toUpperCase() + t.slice(1));
        if (!m[0]) g.lastIndex++;
      }
    }
    return out;
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
    // B-189: a day known only from his words has no subject to tell one lab's passages from another's.
    for (const h of day.said ? [] : ranked) {
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
    // B-189: every kind the day is (a lab exam and a class exam on one day), each kind's look-fors and kit.
    const kinds = [...new Set([day.kind, ...(day.entries || []).map(e => e.kind)])].filter(Boolean);
    const looks = kinds.flatMap(k =>
      ((P.lookFor || {})[k] || []).map(l => ({ item: l.item, re: new RegExp(l.match, 'i') }))
    );
    // B-189: what the record says about the day itself comes first, each with the place that names it: the calendar
    // entry (its title and notes), the Canvas announcements that name the day, and the course calendar's row for it.
    const fromText = (text, cite, source) => {
      for (const t of [...prepBringItems(text), ...looseBring(text)]) {
        const seed = looks.find(l => l.re.test(t));
        add(seed ? seed.item : t, null, { cite, source });
      }
      for (const l of looks) if (l.re.test(text)) add(l.item, null, { cite, source });
      for (const t of namedMaterials(text)) add(t, null, { cite, source });
    };
    for (const e of day.entries || [])
      if (e.text) fromText(e.text, 'Your calendar: ' + e.title, { type: 'date', id: e.id, title: e.title });
    for (const a of o.announcements || []) {
      for (const line of announcementLines(a, day.date))
        fromText(
          line,
          'Canvas announcement: ' + (a.title || 'untitled') + (a.postedAt ? ', ' + shortDate(a.postedAt) : ''),
          {
            type: 'announcement',
            id: a.id || null,
            title: a.title || '',
          }
        );
    }
    const dre = dateRe(day.date);
    let rows = 0;
    for (const d of (index && index.docs) || []) {
      if (rows >= 8 || !dre.test(d.c.text)) continue;
      for (const s of dateStretches(d.c.text, dre)) {
        rows++;
        fromText(s, citeMaterial(d.c), {
          id: d.c.id,
          title: d.c.title,
          page: d.c.page,
          unit: d.c.unit,
          type: 'calendar',
        });
      }
    }
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
    // B-189 (D-144 as amended): the kit for each kind the day is, his to edit in spec.constants.prep.kit, completes what
    // the record names; an item the record already names keeps the record's source.
    const kitKinds = [];
    for (const k of kinds) {
      const kit = ((o.kit || P.kit || {})[k] || []).filter(t => typeof t === 'string' && t.trim());
      if (kit.length) kitKinds.push(k);
      for (const t of kit) {
        const key = norm(t);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: 'kit-' + (slug(t, 32) || 'item'),
          text: t.trim(),
          cite: 'your ' + k + ' kit',
          source: { type: 'kit', kind: k },
          paperwork: PAPERWORK.test(t),
          kit: true,
        });
      }
    }
    const checks = (edits[day.date] && edits[day.date].checks) || {};
    for (const it of items) it.checked = !!checks[prepCheckId(phase, it.id)];
    const what =
      day.subject && day.kind !== 'clinical'
        ? `${day.kind === 'validation' ? 'the ' + day.subject + ' validation' : day.kind === 'lab' ? 'the ' + day.subject + ' lab' : day.title}`
        : day.title;
    const kitLine = kitKinds.length ? `Your ${kitKinds.join(' and ')} kit is below. ` : '';
    const note = fromMaterials
      ? null
      : `Nothing in your materials says what to bring for ${what}. ${kitLine}Add what you know and I’ll keep it for next time.`;
    return {
      date: day.date,
      kind: day.kind,
      kinds,
      title: day.title,
      subject: day.subject,
      phase,
      items,
      fromRecord: fromMaterials,
      kitKinds,
      empty: !fromMaterials,
      note,
      done: items.length > 0 && items.every(it => it.checked),
    };
  }
  /** B-189: what E.V. says when he asks what to bring: which day, how many items the record names (each card row
   *  names its place) and what the kit fills in; plain when the day is not a class, lab, clinical or validation day. */
  function prepReply(list, date, today) {
    const when = date === today ? 'today' : date === addDays(today, 1) ? 'tomorrow' : shortDate(date);
    if (!list)
      return `Nothing on your calendar makes ${when} a class, lab, clinical or validation day, so I have no list for it. Tell me which it is ("what do I bring to lab ${when}") or add it under Record, Dates, and I’ll build the list from your materials.`;
    const rec = list.fromRecord;
    const kit = list.items.filter(i => i.kit).length;
    const own = list.items.length - rec - kit;
    const parts = [];
    if (rec) parts.push(`${rec} named in your record (each line says where)`);
    if (own) parts.push(`${own} you added before`);
    if (kit) parts.push(`${kit} from your ${(list.kitKinds || [list.kind]).join(' and ')} kit`);
    const head = `For ${list.title} ${when}: `;
    if (!list.items.length)
      return (
        head +
        'nothing in your record says what to bring, and your kit for that kind of day is empty. Add what you know on the check and I’ll keep it.'
      );
    return (
      head +
      parts.join(', ') +
      '.' +
      (rec
        ? ''
        : ' Your materials don’t name anything for this day, so the list is your kit; add what you know on the check.')
    );
  }
  /** B-189: an ask for what to bring ("what do I bring to lab today", "make a prep list of items to bring"): the date
   *  it is for (today, tomorrow, a weekday or 10/22; with no day named, tomorrow from 5pm on) and the kinds of day he
   *  named. Null when the text is not that ask. */
  function prepAsk(text, now) {
    const t = String(text || '');
    const ask =
      /\b(what|which|items?|things?|stuff|list|anything)\b[^.?!]{0,50}\b(bring|pack|take with)\b(?!\s+(?:up|back|down|over)\b)/i.test(
        t
      ) ||
      /\b(prep|pack(?:ing)?|bag)\s+(list|check)\b/i.test(t) ||
      /\bwhat\b[^.?!]{0,30}\bneed\b[^.?!]{0,20}\bfor (?:lab|class|clinical|validation)\b/i.test(t);
    if (!ask) return null;
    const today = chicagoDate(now);
    let date = null;
    const md = /\b(\d{1,2})\/(\d{1,2})\b/.exec(t);
    if (/\btomorrow\b/i.test(t)) date = addDays(today, 1);
    else if (/\b(today|this morning|tonight)\b/i.test(t)) date = today;
    else if (md) date = `${today.slice(0, 4)}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
    else {
      const w = WEEKDAYS.findIndex(d => new RegExp('\\b' + d + '\\b', 'i').test(t));
      if (w >= 0) date = addDays(today, (w - weekday(today) + 7) % 7);
    }
    if (!date) date = Number(String(chicagoClock(now)).slice(0, 2)) >= 17 ? addDays(today, 1) : today;
    const said = [];
    if (/\bclinicals?\b/i.test(t)) said.push('clinical');
    if (/\bvalidat/i.test(t)) said.push('validation');
    if (/\blabs?\b/i.test(t)) said.push('lab');
    if (/\b(class|lecture)\b/i.test(t)) said.push('class');
    return { date, said };
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
  // open skill weak spots and any instructor note. The read set is decided here (D-324: nothing is left out as graded).
  const CLINICAL_TEXT = /\b(clinical|skills?|lab|validation|packet|checklist|procedure)s?\b/i;
  /**
   * The clinical-prep job's read set: the course's clinical and lab materials (by kind, or a section or title that
   * names clinical, skills, lab, a packet or a checklist). Returns {read}.
   */
  function clinicalReadSet(materials, course) {
    const want = course ? normCourse(course) : null;
    const read = [];
    for (const m of materials || []) {
      if (!m) continue;
      if (want && normCourse(m.course) && normCourse(m.course) !== want) continue;
      const clinical =
        ['clinical', 'lab'].includes(m.kind) ||
        CLINICAL_TEXT.test(`${m.section || ''} ${m.title || ''} ${m.module || ''}`);
      if (clinical) read.push(m);
    }
    return { read };
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
    prepDaySaid,
    prepAsk,
    prepReply,
    prepBringItems,
    prepList,
    prepEdit,
    clinicalReadSet,
    nextClinical,
    clinicalPrepOffer,
  };
}
