// E.V. core (v4): every rule with one right answer, written once.
// The same file runs in node (pipelines, tests) and in the E.V. Home page (published beside it as core.js).
// Pure functions only: no network, no storage, no clock unless a `now` is passed in.
// Source of truth for constants: spec/ev.spec.json (configure(spec) loads them).
//
// v4 changes from v3 (Data architecture): nothing derived is stored, so a weak spot's state is always computed here
// from its facts, its events and the answers; answers live in answers/<setId> (item id -> attempt key -> attempt);
// what the page changes by hand lives in Edit documents replaced whole (dayedits, dateedits, planedits,
// materialedits) and is merged into views here (dayView, liveDates, planView, liveMaterials); appended maps are keyed
// <writer>-<YYYYMMDD-HHMMSSmmm> (eventKey); every document core creates carries the envelope (schema, writer, at,
// source). Reading v2 and v3 shapes is the migration's job (core/migrate.mjs), never core's.

import { makeLibrary } from './library.mjs';
import { makeSessions } from './sessions.mjs';
import { makeConversation } from './conversation.mjs';
import { makeSkills } from './skills.mjs';
import { makePrep } from './prep.mjs';
import { makeInsights } from './insights.mjs';
const EVCore = (() => {
  'use strict';
  const VERSION = '__EV_RELEASE__'; // B-149: the build writes the release in (tools/build.mjs RELEASE_SLOT)
  const TZ = 'America/Chicago';

  // ---------------------------------------------------------------- constants
  const DEFAULTS = {
    review: {
      solidAfterRightDays: 2,
      intervalDays: 3,
      intervalNearExamDays: 1,
      nearExamWithinDays: 5,
      load: { class: 10, off: 10, validation: 10, clinical: 3, clinicalBeforeExam: 5, examDay: 0 },
      flex: { withinDays: 3, max: 15, maxClinical: 8 },
      newChecksPerDay: 3,
      newChecksOn: ['class', 'off'],
      minutesPerQuestion: 1.5,
    },
    dayBudgetMinutes: { off: 300, class: 180, validation: 150, clinical: 60, exam: 120 },
    taskMinutes: {
      reading: 45,
      drill: 25,
      sim: 75,
      review: 20,
      val: 20,
      terminology: 15,
      graded: 45,
      clinical: 0,
      exam: 90,
      other: 20,
    },
    planDay: { sameItem: 0.3 },
    conversation: { idleGapMin: 120 },
    library: {
      chunkChars: 900,
      searchK: 6,
      hitChars: 700,
      readChars: 12000,
      maxChars: 200000,
      ocrMinChars: 80,
      pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs',
      pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs',
    },
  };
  let C = clone(DEFAULTS);
  let SPEC = null;
  function configure(spec) {
    SPEC = spec || null;
    C = clone(DEFAULTS);
    if (spec && spec.constants) deepMerge(C, spec.constants);
    return C;
  }
  const constants = () => C;

  // ---------------------------------------------------------------- courses (B-42, D-099)
  // Every course rule is spec.courses: core names no course. A document with no course belongs to the default one.
  function courseTable() {
    const t = (SPEC && SPEC.courses) || {};
    return Object.keys(t)
      .filter(k => !k.startsWith('_'))
      .map(name => ({ name, ...t[name] }));
  }
  const courses = () => courseTable().map(c => c.name);
  const courseRule = name => courseTable().find(c => c.name === name) || null;
  const isCourse = c => !!c && !!courseRule(c);
  const defaultCourse = () => {
    const t = courseTable();
    return (t.find(c => c.default) || t[0] || {}).name || null;
  };
  const activeCourses = () =>
    courseTable()
      .filter(c => c.status !== 'done')
      .map(c => c.name);
  const courseOf = x => normCourse(x && x.course) || defaultCourse();
  const kindsOf = (course, which) => (courseRule(course) || {})[which] || [];
  /** Whether an exam's kind is one of its course's <which> kinds (reviewKinds, examDayKinds, scoredKinds). */
  const examIs = (e, which) => !!e && kindsOf(courseOf(e), which).includes(e.kind);
  /** Canvas's course ids by course, and the library rules with each course's module rules (scripts/canvas/). */
  const canvasCourses = () =>
    Object.fromEntries(
      courseTable()
        .filter(c => c.canvasId != null)
        .map(c => [c.name, c.canvasId])
    );
  function libraryRules() {
    const shared = (SPEC && SPEC.registry && SPEC.registry.canvas && SPEC.registry.canvas.library) || {};
    return {
      skipSections: shared.skipSections,
      skipTitles: shared.skipTitles,
      modules: courseTable().flatMap(c => (c.library || []).map(r => ({ course: c.name, ...r }))),
    };
  }

  const CJ_STEPS = [
    'recognize-cues',
    'analyze-cues',
    'prioritize-hypotheses',
    'generate-solutions',
    'take-action',
    'evaluate-outcomes',
  ];
  const CJ_LABELS = {
    'recognize-cues': 'Recognize cues',
    'analyze-cues': 'Analyze cues',
    'prioritize-hypotheses': 'Prioritize hypotheses',
    'generate-solutions': 'Generate solutions',
    'take-action': 'Take action',
    'evaluate-outcomes': 'Evaluate outcomes',
  };
  const DAY_LABELS = {
    class: 'Class day',
    off: 'Off day',
    clinical: 'Clinical day',
    validation: 'Validation day',
    exam: 'Exam day',
  };

  // ---------------------------------------------------------------- small helpers
  function clone(x) {
    return x == null ? x : JSON.parse(JSON.stringify(x));
  }
  function deepMerge(t, s) {
    for (const k of Object.keys(s || {})) {
      if (k.startsWith('_')) continue;
      const v = s[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k]))
        deepMerge(t[k], v);
      else t[k] = clone(v);
    }
    return t;
  }
  const norm = s =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const slug = (s, n = 40) => norm(s).replace(/ /g, '-').slice(0, n).replace(/-+$/, '');
  const safeId = s =>
    String(s)
      .replace(/[^A-Za-z0-9_\-.~:@+]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 180);
  const STOP = new Set(
    'a an and are as at be by for from how in is it of on or the to what when which why with vs versus can t not its their this that'.split(
      ' '
    )
  );
  const tokens = s =>
    new Set(
      norm(s)
        .split(' ')
        .filter(w => w && !STOP.has(w))
    );
  function similarity(a, b) {
    const A = tokens(a),
      B = tokens(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const w of A) if (B.has(w)) inter++;
    return inter / (A.size + B.size - inter);
  }
  const toMs = x => {
    if (x == null) return NaN;
    if (typeof x === 'number') return x;
    const s = String(x);
    return Date.parse(s.length === 10 ? s + 'T12:00:00Z' : s);
  };
  const byAt = (a, b) => toMs(a.at) - toMs(b.at);
  const stableStringify = v => JSON.stringify(sortKeys(v));
  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
      return o;
    }
    return v;
  }
  function hash(s) {
    // FNV-1a, for change detection only
    let h = 0x811c9dc5;
    const str = String(s);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
  /** SHA-256 of a string's UTF-8 bytes, as hex. Synchronous and dependency-free, so the page and the pipelines compute
   *  the same derivedHash with the same code. */
  function sha256(str) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
      0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
      0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
      0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
      0xc67178f2,
    ];
    const bytes = new TextEncoder().encode(String(str));
    const len = bytes.length,
      words = new Uint32Array(((len + 9 + 63) >> 6) << 4);
    for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
    words[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
    words[words.length - 1] = len * 8;
    words[words.length - 2] = Math.floor(len / 0x20000000);
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const W = new Uint32Array(64);
    const r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < words.length; o += 16) {
      for (let t = 0; t < 64; t++)
        W[t] =
          t < 16
            ? words[o + t]
            : (r(W[t - 2], 17) ^ r(W[t - 2], 19) ^ (W[t - 2] >>> 10)) +
              W[t - 7] +
              (r(W[t - 15], 7) ^ r(W[t - 15], 18) ^ (W[t - 15] >>> 3)) +
              W[t - 16];
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
      H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0;
      H[7] = (H[7] + h) >>> 0;
    }
    return H.map(x => x.toString(16).padStart(8, '0')).join('');
  }

  // ---------------------------------------------------------------- v4 document helpers
  const isoOf = now => new Date(now == null ? Date.now() : now).toISOString();
  /** UTC compact time for ids and map keys: 2026-10-18T15:00:00.123Z -> 20261018-150000123. */
  function compactTime(iso) {
    const s = isoOf(iso);
    return (
      s.slice(0, 4) +
      s.slice(5, 7) +
      s.slice(8, 10) +
      '-' +
      s.slice(11, 13) +
      s.slice(14, 16) +
      s.slice(17, 19) +
      s.slice(20, 23)
    );
  }
  /** The key of an entry in an append-only map written by several roles: <writer>-<compact time>. */
  const eventKey = (writer, at) => `${writer}-${compactTime(at)}`;
  const KEY_TIME = /-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(\d{3})?(?:-[a-z0-9]+)?$/;
  /** When an appended entry happened: its own `at`, else the time in its key (v4), else the key itself (an ISO key). */
  function entryTime(key, e) {
    if (e && e.at) return e.at;
    const m = KEY_TIME.exec(String(key));
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7] || '000'}Z`;
    return key;
  }
  /** The fields every document carries (Document conventions). Edits add updatedAt; Logs add release. */
  function envelope(writer, source, now, extra = {}) {
    return { schema: 1, writer, at: isoOf(now), source: String(source || writer), ...extra };
  }
  /** A document's data as written: readers carry its id beside the fields; a write never does. */
  const docData = d => {
    if (!d) return d;
    const { id, ...rest } = d;
    return rest;
  };
  /** The start of a replaced-whole Edit: the existing one's fields (envelope kept) or a new envelope, stamped updatedAt. */
  const editBase = (existing, now, source = 'E.V. Home') => ({
    ...(existing ? docData(existing) : envelope('page', source, now)),
    updatedAt: isoOf(now),
  });

  // ---------------------------------------------------------------- dates (Central time)
  const partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  function chicagoParts(x) {
    const d = x instanceof Date ? x : new Date(x);
    if (isNaN(d)) return null;
    const p = {};
    for (const { type, value } of partsFmt.formatToParts(d)) p[type] = value;
    return p;
  }
  /** YYYY-MM-DD in Central time for a Date, ISO string or epoch ms. A bare YYYY-MM-DD passes through. */
  function chicagoDate(x) {
    if (x == null) x = new Date();
    if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
    const p = chicagoParts(x);
    if (!p) return null;
    return `${p.year}-${p.month}-${p.day}`;
  }
  function chicagoClock(x) {
    const p = chicagoParts(x == null ? new Date() : x);
    return p ? `${p.hour === '24' ? '00' : p.hour}:${p.minute}` : null;
  }
  function ymd(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return [y, m, d];
  }
  function addDays(iso, n) {
    const [y, m, d] = ymd(iso);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  function diffDays(a, b) {
    const [y1, m1, d1] = ymd(a),
      [y2, m2, d2] = ymd(b);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
  }
  function weekday(iso) {
    const [y, m, d] = ymd(iso);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function shortDate(iso) {
    if (!iso) return '';
    const day = String(iso).length === 10 ? iso : chicagoDate(iso);
    const [, m, d] = ymd(day);
    return `${WD[weekday(day)]} ${m}/${d}`;
  }

  // ---------------------------------------------------------------- items
  function itemType(q) {
    if (!q) return 'single';
    if (q.type === 'matrix') return 'matrix';
    if (q.type === 'numeric') return 'numeric'; // B-43 (D-100)
    return q.type === 'sata' || (Array.isArray(q.correct) && q.correct.length > 1) ? 'sata' : 'single';
  }
  const SELECT_N = /\bselect\s+(?:two|three|four|five|\d+)\b|\bchoose\s+(?:two|three|\d+)\b/i;
  /** Checks one question. Returns {ok, errors, warnings}. Errors make the item unusable. */
  function validateItem(q, opts = {}) {
    const errors = [],
      warnings = [];
    if (!q || typeof q !== 'object') return { ok: false, errors: ['not an object'], warnings };
    if (!q.id || typeof q.id !== 'string') errors.push('missing id');
    if (!q.stem || typeof q.stem !== 'string' || q.stem.trim().length < 10) errors.push('missing or too-short stem');
    const t = q.type || 'single';
    if (!['single', 'sata', 'matrix', 'numeric'].includes(t)) errors.push('unknown type ' + t);
    if (SELECT_N.test(q.stem || '')) errors.push('uses "select N" wording');
    if (t === 'numeric') {
      // B-43 (D-100): a number with its unit, the rounding the stem states as the tolerance, and the worked steps.
      if (typeof q.answer !== 'number' || !Number.isFinite(q.answer)) errors.push('numeric needs a number answer');
      if (!unitOf(q.unit)) errors.push('numeric needs a unit from spec.items.units, not ' + JSON.stringify(q.unit));
      if (q.tolerance != null && !(typeof q.tolerance === 'number' && q.tolerance >= 0))
        errors.push('tolerance must be a number of 0 or more');
      if (!Array.isArray(q.steps) || !q.steps.length || q.steps.some(x => typeof x !== 'string' || !x.trim()))
        errors.push('numeric needs its worked steps');
      if (q.options || q.correct || q.matrix) errors.push('a numeric item has no options');
    } else if (t === 'matrix') {
      const m = q.matrix;
      if (!m || !Array.isArray(m.columns) || m.columns.length < 2 || m.columns.length > 4)
        errors.push('matrix needs 2-4 columns');
      else if (!Array.isArray(m.rows) || m.rows.length < 3 || m.rows.length > 6) errors.push('matrix needs 3-6 rows');
      else
        m.rows.forEach((r, i) => {
          if (!r || !r.text) errors.push(`matrix row ${i} has no text`);
          if (!Number.isInteger(r.correct) || r.correct < 0 || r.correct >= m.columns.length)
            errors.push(`matrix row ${i} has a bad answer`);
          if (!r.rationale) warnings.push(`matrix row ${i} has no rationale`);
        });
    } else {
      const o = q.options,
        c = q.correct;
      if (!Array.isArray(o) || o.length < 2) errors.push('needs at least 2 options');
      else {
        if (o.length > 6) errors.push('more than 6 options');
        if (o.some(x => typeof x !== 'string' || !x.trim())) errors.push('empty option');
        if (new Set(o.map(norm)).size !== o.length) errors.push('duplicate options');
        if (!Array.isArray(c) || !c.length) errors.push('no correct answer');
        else {
          if (c.some(i => !Number.isInteger(i) || i < 0 || i >= o.length)) errors.push('correct index out of range');
          if (new Set(c).size !== c.length) errors.push('duplicate correct index');
          if (t === 'single' && c.length !== 1) errors.push('single needs exactly one correct');
          if (t === 'sata' && c.length < 2) errors.push('select-all needs two or more correct');
          if (t === 'sata' && c.length === o.length) warnings.push('every option is correct');
        }
        if (!Array.isArray(q.rationales) || q.rationales.length !== o.length)
          (opts.strict ? errors : warnings).push('needs one rationale per option');
      }
    }
    if (!q.objective) warnings.push('no objective');
    if (q.cjStep && !CJ_STEPS.includes(q.cjStep)) errors.push('unknown clinical-judgment step ' + q.cjStep);
    if (!q.cjStep) (opts.strict ? errors : warnings).push('no clinical-judgment step');
    return { ok: errors.length === 0, errors, warnings };
  }
  function validItems(set, opts) {
    return (set && Array.isArray(set.items) ? set.items : []).filter(q => validateItem(q, opts).ok);
  }
  /**
   * B-43 (D-100): dosage material, the only ground a numeric item stands on: a library file whose title or module matches
   * spec.items.dosage.match and not .skip (the syllabus, a calendar, drug cards or a medication table, B-01).
   */
  function isDosageMaterial(m) {
    const d = (SPEC && SPEC.items && SPEC.items.dosage) || {};
    const t = `${(m && m.title) || ''} ${(m && m.module) || ''}`;
    return new RegExp(d.match || 'dosage', 'i').test(t) && !new RegExp(d.skip || '(?!)', 'i').test(t);
  }
  /** B-43: a topic that asks for dosage practice (make_practice, a plan's drill title). */
  const isDosageTopic = t =>
    /\b(dosage|dose calc\w*|drug calc\w*|med(ication)?[ -]?math|drip rates?|iv rates?|infusion rates?)\b/i.test(
      String(t || '')
    );
  /** B-43 (D-100): a unit as spec.items.units names it (mL, mg, gtt/min, ...), matched without case or spaces; null if not one. */
  function unitOf(u) {
    const k = String(u == null ? '' : u)
      .toLowerCase()
      .replace(/\s+/g, '');
    if (!k) return null;
    return (
      ((SPEC && SPEC.items && SPEC.items.units) || []).find(x => x.toLowerCase().replace(/\s+/g, '') === k) || null
    );
  }
  /** A numeric answer as given: a number, a string ("2.5" or "2.5 mL") or {value, unit}; {value, unit} or null. */
  function numericGiven(chosen) {
    if (chosen && typeof chosen === 'object' && !Array.isArray(chosen))
      return typeof chosen.value === 'number' && Number.isFinite(chosen.value)
        ? { value: chosen.value, unit: chosen.unit || null }
        : null;
    if (typeof chosen === 'number') return Number.isFinite(chosen) ? { value: chosen, unit: null } : null;
    const m = String(chosen == null ? '' : chosen)
      .trim()
      .match(/^(-?\d+(?:\.\d+)?|-?\.\d+)\s*(.*)$/);
    return m ? { value: Number(m[1]), unit: m[2] || null } : null;
  }
  /**
   * Scores an answer. chosen: option indexes (single/sata), one column index per row (matrix), or for a numeric item
   * (B-43, D-100) the number given, right when it is within the item's tolerance of its answer and any unit given is its
   * unit.
   */
  function scoreAnswer(q, chosen) {
    const t = itemType(q);
    if (t === 'numeric') {
      const g = numericGiven(chosen);
      const tol = typeof q.tolerance === 'number' && q.tolerance > 0 ? q.tolerance : 0;
      const unitOk = !g || !g.unit || unitOf(g.unit) === unitOf(q.unit);
      const correct = !!g && unitOk && Math.abs(g.value - q.answer) <= tol + 1e-9;
      return { correct, score: correct ? 1 : 0 };
    }
    if (t === 'matrix') {
      const rows = (q.matrix && q.matrix.rows) || [];
      const right = rows.filter((r, i) => Array.isArray(chosen) && chosen[i] === r.correct).length;
      return { correct: rows.length > 0 && right === rows.length, score: rows.length ? right / rows.length : 0 };
    }
    const c = [...(q.correct || [])].sort((a, b) => a - b),
      ch = [...new Set(chosen || [])].sort((a, b) => a - b);
    const correct = c.length === ch.length && c.every((v, i) => v === ch[i]);
    if (t === 'single') return { correct, score: correct ? 1 : 0 };
    const hits = ch.filter(i => c.includes(i)).length,
      falsePos = ch.length - hits; // NGN +/- scoring, floored at 0
    return { correct, score: c.length ? Math.max(0, hits - falsePos) / c.length : 0 };
  }

  // ---------------------------------------------------------------- attempts (answers are the truth)
  /** answers/<setId> documents by set id (a missing set has no answers). */
  const answersIndex = answers => {
    const m = {};
    for (const a of answers || []) if (a) m[a.setId || a.id] = a.answers || {};
    return m;
  };
  /** Every attempt at every item of every set, oldest first, plus an index by weak spot. answers: answers/<setId> docs,
   *  each {setId, answers: {itemId: {attemptKey: {chosen, correct, score, at, weakspotId?, matched?, createdWeakspot?}}}}. */
  function collectAttempts(sets, answers) {
    const all = [];
    const bySet = answersIndex(answers);
    for (const s of sets || []) {
      const items = new Map((s.items || []).map(q => [q.id, q]));
      for (const [qid, attempts] of Object.entries(bySet[s.id] || {})) {
        const q = items.get(qid);
        if (!q) continue;
        for (const [key, a] of Object.entries(attempts || {})) {
          if (!a || !a.at) continue;
          all.push({
            setId: s.id,
            setKind: s.kind || null,
            itemId: qid,
            attempt: key,
            at: a.at,
            date: chicagoDate(a.at),
            correct: !!a.correct,
            score: typeof a.score === 'number' ? a.score : a.correct ? 1 : 0,
            weakspotId: a.weakspotId || q.weakspotId || null,
            matched: !!a.matched,
            created: a.createdWeakspot || null,
            objective: q.objective || null,
            topic: q.topic || null,
            type: itemType(q),
            cjStep: q.cjStep || null,
            kind: q.kind || s.kind || null,
          });
        }
      }
    }
    all.sort((a, b) => byAt(a, b) || String(a.attempt).localeCompare(String(b.attempt)));
    const byWeakspot = {};
    for (const a of all) if (a.weakspotId) (byWeakspot[a.weakspotId] = byWeakspot[a.weakspotId] || []).push(a);
    return { all, byWeakspot };
  }
  /** Items of a set that have at least one attempt. */
  const answeredItems = (set, answers) => {
    const m = answersIndex(answers)[set && set.id] || {};
    return ((set && set.items) || []).filter(q => Object.keys(m[q.id] || {}).length > 0).map(q => q.id);
  };

  // ---------------------------------------------------------------- weak spots
  const examOf = w => (w && (w.exam || String(w.objective || '').split('-')[0])) || null;
  /** Facts of a v4 weak spot document, normalized. Never includes derived state (nothing derived is stored, D-047). */
  function weakspotFacts(doc) {
    const w = doc || {};
    const kind = w.kind || 'concept';
    const addedAt = w.addedAt || w.at || null;
    const f = {
      id: w.id,
      writer: w.writer || null,
      topic: w.topic || '',
      objective: w.objective || '',
      exam: w.exam || examOf(w) || '',
      course: w.course || defaultCourse(),
      kind,
      source: w.source || '',
      addedAt,
      addedBy: w.addedBy || '',
    };
    if (w.origin) f.origin = w.origin;
    if (w.preRead) f.preRead = true;
    if (w.readingDue) f.readingDue = w.readingDue;
    if (w.preReadNote) f.preReadNote = w.preReadNote;
    if (w.note) f.note = w.note;
    if (w.movedTo) f.movedTo = w.movedTo;
    if (w.parkedReason) f.parkedReason = w.parkedReason;
    f.initial = w.initial || {
      streak: 0,
      nextDue: addedAt ? addDays(chicagoDate(addedAt), 1) : null,
      recurrence: 1,
      misses: 0,
    };
    f.events = w.events || {};
    return f;
  }

  /**
   * Rebuilds a weak spot's state from its facts and answers (the v2 spaced-review rules, D-041 pre-read rule).
   * attempts: this weak spot's attempts (any order). opts.examDate: its exam's date (for exam flex).
   */
  function deriveWeakspot(facts, attempts, opts = {}) {
    const R = C.review;
    const f = facts.initial && facts.events ? facts : weakspotFacts(facts);
    const init = f.initial || {};
    const st = {
      status: 'open',
      streak: init.streak || 0,
      nextDue: init.nextDue || null,
      misses: init.misses || 0,
      recurrence: init.recurrence || 1,
      lastReviewed: null,
      lastResult: null,
      solidBy: null,
      solidAt: null,
      preRead: !!f.preRead,
      reopenedAt: null,
      answered: 0,
      right: 0,
      history: [],
    };
    const examDate = opts.examDate || null;
    const concept = f.kind === 'concept';
    const timeline = [
      ...Object.entries(f.events || {}).map(([key, e]) => ({ at: entryTime(key, e), e })),
      ...(attempts || []).filter(a => !a.created || a.created !== f.id).map(a => ({ at: a.at, a })),
    ].sort(byAt);
    for (const t of timeline) {
      const date = chicagoDate(t.at);
      if (t.e) {
        applyEvent(st, t.e, t.at, date);
        continue;
      }
      const a = t.a;
      if (!concept || st.status === 'parked' || st.status === 'moved') continue;
      st.answered++;
      if (a.correct) st.right++;
      st.history.push({ date, correct: !!a.correct });
      if (st.preRead) {
        // D-041: the first check after the reading decides it
        st.preRead = false;
        if (a.correct)
          Object.assign(st, {
            status: 'reviewed',
            streak: R.solidAfterRightDays,
            solidBy: 'first-check-after-reading',
            solidAt: t.at,
            lastReviewed: date,
            lastResult: 'right',
          });
        else
          Object.assign(st, {
            streak: 0,
            nextDue: addDays(date, 1),
            misses: st.misses + 1,
            lastReviewed: date,
            lastResult: 'wrong',
          });
        continue;
      }
      if (a.matched) {
        // a different question on the same topic was missed: seen again
        Object.assign(st, {
          recurrence: st.recurrence + 1,
          streak: 0,
          nextDue: addDays(date, 1),
          lastReviewed: date,
          lastResult: 'wrong',
        });
        if (st.status === 'reviewed') Object.assign(st, { status: 'open', reopenedAt: t.at });
        continue;
      }
      if (a.correct) {
        if (st.status === 'reviewed') {
          st.lastReviewed = date;
          st.lastResult = 'right';
          continue;
        }
        if (st.lastReviewed === date && st.lastResult === 'right') continue; // advances at most once per day
        st.streak += 1;
        st.lastReviewed = date;
        st.lastResult = 'right';
        if (st.streak >= R.solidAfterRightDays) {
          Object.assign(st, { status: 'reviewed', solidBy: 'review', solidAt: t.at });
          continue;
        }
        const toExam = examDate && examDate >= date ? diffDays(date, examDate) : null;
        let next = addDays(
          date,
          toExam != null && toExam <= R.nearExamWithinDays ? R.intervalNearExamDays : R.intervalDays
        );
        if (toExam != null && toExam > 1 && next >= examDate) next = addDays(examDate, -1);
        st.nextDue = next;
      } else {
        Object.assign(st, {
          streak: 0,
          nextDue: addDays(date, 1),
          misses: st.misses + 1,
          lastReviewed: date,
          lastResult: 'wrong',
        });
        if (st.status === 'reviewed')
          Object.assign(st, {
            status: 'open',
            recurrence: st.recurrence + 1,
            reopenedAt: t.at,
            solidBy: null,
            solidAt: null,
          });
      }
    }
    st.history = st.history.slice(-20);
    if (!concept && st.status === 'open') st.nextDue = null;
    return st;
  }
  function applyEvent(st, e, at, date) {
    switch (e.type) {
      case 'park':
        st.status = 'parked';
        st.parkedReason = e.note || '';
        break;
      case 'move':
        st.status = 'moved';
        break;
      case 'activate':
        Object.assign(st, { status: 'open', streak: 0, nextDue: date });
        break;
      case 'solid':
        Object.assign(st, {
          status: 'reviewed',
          solidBy: e.by === 'owner' ? 'owner' : e.by || 'owner',
          solidAt: at,
          preRead: false,
        });
        break;
      case 'done':
        Object.assign(st, { status: 'reviewed', solidBy: 'done', solidAt: at });
        break;
      case 'reopen':
        Object.assign(st, { status: 'open', streak: 0, nextDue: date, reopenedAt: at });
        break;
      case 'seen':
        Object.assign(st, { recurrence: st.recurrence + 1, streak: 0, nextDue: addDays(date, 1) });
        if (st.status === 'reviewed')
          Object.assign(st, { status: 'open', reopenedAt: at, solidBy: null, solidAt: null });
        break;
      default:
        break;
    }
  }
  /** Weak spot model used everywhere: facts + derived, with the exam date resolved. */
  function buildWeakspots({ weakspots, sets, answers, exams }) {
    const { byWeakspot } = collectAttempts(sets, answers);
    const examDate = id => {
      const e = (exams || []).find(x => x.id === id);
      return e && e.date ? e.date : null;
    };
    return (weakspots || []).map(doc => {
      const f = weakspotFacts(doc);
      const derived = deriveWeakspot(f, byWeakspot[f.id] || [], { examDate: examDate(f.exam || examOf(f)) });
      return { ...f, derived };
    });
  }
  const isActive = w => !!w && (w.kind || 'concept') === 'concept' && w.derived && w.derived.status === 'open';
  const isSolid = w => !!w && (w.kind || 'concept') === 'concept' && w.derived && w.derived.status === 'reviewed';
  function isDue(w, date) {
    if (!isActive(w) || !w.derived.nextDue) return false;
    if (w.derived.preRead && w.readingDue && w.readingDue > date) return false;
    return w.derived.nextDue <= date;
  }
  const reviewNeed = w => (w.derived.preRead ? 1 : Math.max(0, C.review.solidAfterRightDays - (w.derived.streak || 0)));
  /** The hash of every weak spot's computed state, sorted by id (Data architecture, "Derivation"). evening-cloud stores it
   *  in state/current; the page computes the same hash on load, and a difference means two copies of the logic disagree. */
  function derivedHash(models) {
    const rows = (models || [])
      .map(w => [String(w.id), w.derived])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return sha256(stableStringify(rows));
  }

  // ---------------------------------------------------------------- answering (the page calls this; tests too)
  /**
   * Decides what one answer does to the record. Pure: returns the writes, the page performs them.
   * ctx: {set, item, chosen, now, weakspots (models), exams, plans (Facts or views), planedits (optional: ticks merged
   *       into plans), answers (answers/<setId> docs) or byWeakspot, answersDoc (this set's answers/<setId>; looked up in
   *       answers when not given; null only when the set has none yet), label}
   * Returns {answer, attemptKey, writes:[{op, collection, id, data}], outcome, correct, score, weakspotId, state}:
   * the attempt goes to answers/<setId>; a new weak spot is written as facts only; `state` is the affected weak spot's
   * state after this answer, computed here and never stored (the page shows it, every reader recomputes it).
   */
  function planAnswer(ctx) {
    const { set, item: q, chosen, now, label } = ctx;
    // The set's answers document: given, or found among ctx.answers, so an earlier attempt is never overwritten by a set.
    const answersDoc =
      ctx.answersDoc || (set && (ctx.answers || []).find(a => a && (a.id === set.id || a.setId === set.id))) || null;
    // Plans as views: with planedits given, ticks reach preReadFor (a ticked reading is no longer ahead).
    const plans = ctx.planedits ? planViews(ctx.plans, ctx.planedits) : ctx.plans || [];
    const at = isoOf(now);
    const date = chicagoDate(at);
    const { correct, score } = scoreAnswer(q, chosen);
    const answer = { chosen, correct, score, at };
    const attemptKey = eventKey('page', at);
    const writes = [];
    const models = ctx.weakspots || [];
    const byWeakspot = ctx.byWeakspot || collectAttempts(ctx.sets || [], ctx.answers || []).byWeakspot;
    const examDateOf = id => {
      const e = (ctx.exams || []).find(x => x.id === id);
      return e && e.date ? e.date : null;
    };
    const recompute = (w, extra) => {
      const atts = [
        ...(byWeakspot[w.id] || []),
        { at, correct, weakspotId: w.id, matched: !!(extra && extra.matched) },
      ];
      return deriveWeakspot(w, atts, { examDate: examDateOf(w.exam || examOf(w)) });
    };
    let outcome,
      state = null,
      weakspotId = null;
    const target = q.weakspotId ? models.find(w => w.id === q.weakspotId) : null;
    if (target && target.kind === 'concept' && !['parked', 'moved'].includes(target.derived.status)) {
      const before = target.derived;
      state = recompute(target);
      weakspotId = target.id;
      outcome = outcomeText(before, state, correct, date);
    } else if (correct) {
      outcome = 'Nice. No new weak spot.';
    } else {
      const topic = q.topic || String(q.stem || '').slice(0, 80);
      const twin = models.find(
        w => isActive(w) && (w.objective || '') === (q.objective || '') && norm(w.topic) === norm(topic)
      );
      if (twin) {
        answer.weakspotId = twin.id;
        answer.matched = true;
        state = recompute(twin, { matched: true });
        weakspotId = twin.id;
        outcome = 'Already a weak spot, so it’s seen again and comes back tomorrow.';
      } else {
        const id = safeId('ws-' + date + '-' + (q.objective || 'x') + '-' + slug(topic));
        const pre = preReadFor(q, plans, date);
        const facts = {
          ...envelope('page', label || 'E.V. · ' + shortDate(date), at),
          topic,
          objective: q.objective || '',
          exam: String(q.objective || '').split('-')[0] || (set && set.exam) || '',
          course: (set && set.course) || defaultCourse(),
          kind: 'concept',
          addedBy: 'page',
          origin: { set: set && set.id, item: q.id, at },
          initial: {
            streak: 0,
            nextDue: pre ? addDays(pre.readingDue, 1) : addDays(date, 1),
            recurrence: 1,
            misses: 0,
          },
          events: {},
        };
        if (pre) Object.assign(facts, { preRead: true, readingDue: pre.readingDue, preReadNote: pre.note });
        state = deriveWeakspot({ id, ...facts }, [], { examDate: examDateOf(facts.exam) });
        weakspotId = id;
        writes.push({ op: 'set', collection: 'weakspots', id, data: facts });
        answer.createdWeakspot = id;
        outcome = pre
          ? `Missed before the reading (${pre.what}), so it’s a preview, not a weak spot yet. One right answer after the reading clears it.`
          : 'Added as a new weak spot. It comes back tomorrow.';
      }
    }
    answer.outcome = outcome;
    const entry = { [q.id]: { [attemptKey]: answer } };
    writes.unshift(
      answersDoc
        ? { op: 'update', collection: 'answers', id: set.id, data: { answers: entry } }
        : {
            op: 'set',
            collection: 'answers',
            id: set.id,
            data: { ...envelope('page', 'E.V. Home', at), setId: set.id, answers: entry },
          }
    );
    return { answer, attemptKey, writes, outcome, correct, score, weakspotId, state };
  }
  function outcomeText(before, after, correct, date) {
    if (before.preRead)
      return correct
        ? 'Right on your first check after reading, so it’s marked solid.'
        : 'Still missed after reading, so it’s now a regular weak spot. It comes back tomorrow.';
    if (correct) {
      if (after.status === 'reviewed' && before.status !== 'reviewed')
        return 'Right on two different days, so it’s marked solid.';
      if (after.status === 'reviewed') return 'Right again. It’s already solid.';
      if (after.streak === before.streak)
        return 'Right again. It already counted today, so its next check stays on ' + shortDate(after.nextDue) + '.';
      return 'Right. One more correct check on ' + shortDate(after.nextDue) + ' makes it solid.';
    }
    return before.status === 'reviewed'
      ? 'This was marked solid, so it’s back on your list. It comes back tomorrow.'
      : 'It comes back tomorrow.';
  }

  // ---------------------------------------------------------------- plans as data
  const TAG_KIND = { graded: 'graded', drill: 'drill', review: 'review', clinical: 'clinical', val: 'val' };
  function inferTaskKind(text, tag) {
    const t = String(text || '');
    if (tag === 'drill') return /^drill \d+/i.test(t) ? 'drill' : /\bsim(ulation)?\b/i.test(t) ? 'sim' : 'drill';
    if (tag && TAG_KIND[tag]) return TAG_KIND[tag];
    if (/terminology drill/i.test(t)) return 'terminology';
    if (/^(read|pre-read)\b|^catch-up reading\b|\bhigh-yield list\b|^(pharm |fund )?ch \d+/i.test(t)) return 'reading';
    if (/^exam \d+$|^exam$/i.test(t.trim())) return 'exam';
    return 'other';
  }
  /** Chapters named in a task: "Read Pharm Ch 27 (macrolides) + Ch 28" -> ["Pharm 27", "Pharm 28"]. Unprefixed chapters are Fundamentals. */
  function parseChapters(text) {
    const out = [];
    const t = String(text || '');
    const re = /(Pharm|Fund)?\s*Ch(?:apters?|s)?\.?\s*((?:\d+\s*(?:[,+–-]|and|&)?\s*)+)/gi;
    let m,
      lastBook = null;
    while ((m = re.exec(t))) {
      const book = m[1]
        ? m[1].toLowerCase().startsWith('ph')
          ? 'Pharm'
          : 'Fund'
        : lastBook && /\+\s*$/.test(t.slice(Math.max(0, m.index - 3), m.index))
          ? lastBook
          : 'Fund';
      lastBook = book;
      const nums = m[2].match(/\d+(\s*[–-]\s*\d+)?/g) || [];
      for (const n of nums) {
        const r = n.split(/[–-]/).map(x => parseInt(x, 10));
        if (r.length === 2 && r[1] > r[0] && r[1] - r[0] < 10) {
          for (let i = r[0]; i <= r[1]; i++) out.push(book + ' ' + i);
        } else out.push(book + ' ' + r[0]);
      }
    }
    return [...new Set(out)];
  }
  /** Builds plans/<exam> from an exam plan page's CARDS array ([title, days:[[label, dayLabel, [[text, tag]...]]]]). */
  function planFromCards(cards, { examId, year, sourceUrl, title, writer = 'worker', now } = {}) {
    const days = [];
    for (const card of cards || [])
      for (const d of card.days || []) {
        const [label, dayLabel, tasks] = d;
        const md = String(label).match(/(\d{1,2})\/(\d{1,2})/) || [];
        if (!md[1]) continue;
        const date = `${year}-${String(md[1]).padStart(2, '0')}-${String(md[2]).padStart(2, '0')}`;
        const seen = {};
        const ts = (tasks || []).map(it => {
          const text = it[0];
          const tag = it[1] || null;
          let id = date + '-' + slug(text, 36);
          seen[id] = (seen[id] || 0) + 1;
          if (seen[id] > 1) id += '-' + seen[id];
          const kind = inferTaskKind(text, tag);
          const task = { id, text, kind };
          if (tag) task.tag = tag;
          const ch = parseChapters(text);
          if (ch.length) task.chapters = ch;
          const dn = String(text).match(/\bDrill (\d+)\b/);
          if (dn && kind === 'drill') task.drill = Number(dn[1]);
          return task;
        });
        days.push({ date, label, dayLabel: dayLabel || '', week: card.title || '', tasks: ts });
      }
    days.sort((a, b) => a.date.localeCompare(b.date));
    return {
      ...envelope(writer, 'Exam plan ' + examId, now),
      exam: examId,
      title: title || 'Exam plan ' + examId,
      sourceUrl: sourceUrl || '',
      days,
    };
  }
  /** A plan as readers see it: the Fact plus the page's ticks from planedits/<exam id> as `done` (taskId -> {at, by}). */
  function planView(plan, planedit) {
    return plan ? { ...plan, done: { ...((planedit && planedit.ticks) || {}) } } : plan;
  }
  // B-45 (D-102): an exam's plans are plans/<examId> and its drafts plans/<examId>-<n>, each a Fact never changed;
  // planedits/<examId>.plan names the one in force (unset: plans/<examId>). Readers see only the plan in force.
  const planExam = p => (p && (p.exam || p.id)) || null;
  /** The id of the plan in force for an exam, among the plans the record holds. */
  function planInForceId(plans, planedit, examId) {
    const mine = (plans || []).filter(p => planExam(p) === examId);
    const want = planedit && planedit.plan;
    return (
      (want && mine.find(p => p.id === want) ? want : null) ||
      (mine.find(p => p.id === examId) || mine[0] || {}).id ||
      null
    );
  }
  /** Every exam's plan in force as a view, ticks merged in from its planedits document; drafts are left out. */
  function planViews(plans, planedits) {
    const by = {};
    for (const e of planedits || []) if (e) by[e.id] = e;
    const inForce = {};
    for (const p of plans || []) {
      const x = planExam(p);
      if (!(x in inForce)) inForce[x] = planInForceId(plans, by[x], x);
    }
    return (plans || []).filter(p => inForce[planExam(p)] === p.id).map(p => planView(p, by[planExam(p)]));
  }
  /** An exam's drafts: its plans other than the one in force, newest first. */
  function planDrafts(plans, planedits, examId) {
    const pe = (planedits || []).find(e => e && e.id === examId);
    const f = planInForceId(plans, pe, examId);
    return (plans || [])
      .filter(p => planExam(p) === examId && p.id !== f)
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  }
  /** Where the worker saves a plan it drafts: plans/<examId> when the exam has none, else the next plans/<examId>-<n>. */
  function nextPlanId(plans, examId) {
    const ids = new Set((plans || []).map(p => p.id));
    if (!ids.has(examId)) return examId;
    let n = 2;
    while (ids.has(examId + '-' + n)) n++;
    return examId + '-' + n;
  }
  /** Matt accepts a draft from its card: planedits/<examId> names it as the plan in force, ticks kept (replaced whole). */
  function planAccept(planedit, examId, planId, { now } = {}) {
    return {
      id: examId,
      data: { ...editBase(planedit, now), schema: 2, ticks: { ...((planedit && planedit.ticks) || {}) }, plan: planId },
    };
  }
  /** The page's tick for a plan task: the whole new planedits/<exam id> document (Edits are replaced whole). */
  function planTick(planedit, examId, taskId, { done = true, now, by = 'Matt' } = {}) {
    const ticks = { ...((planedit && planedit.ticks) || {}) };
    if (done) ticks[taskId] = { at: isoOf(now), by };
    else delete ticks[taskId];
    return { id: examId, data: { ...editBase(planedit, now), schema: 2, ticks } };
  }
  /**
   * B-45 (D-102): the one greeting offer of a plan draft, when the Canvas sync has just brought in a course's
   * exam-content module (spec.courses.<course>.planModule) for an exam ahead that has no plan and no exam-plan job.
   * Returns {examId, title} or null; E.V. never drafts unasked.
   */
  function planOffer({ materials, plans, exams, jobs, since, date }) {
    for (const m of (materials || []).filter(m => !since || String(m.at || m.createdAt || '') > since)) {
      const rule = (courseRule(courseOf(m)) || {}).planModule;
      if (!rule) continue;
      const hit = new RegExp(rule.module, 'i').exec(String(m.module || '').trim());
      if (!hit) continue;
      const examId = String(rule.exam).replace(/\$(\d)/g, (x, i) => hit[Number(i)] || '');
      const exam = (exams || []).find(e => e.id === examId && e.date && e.date >= date && e.status !== 'done');
      if (!exam) continue;
      if ((plans || []).some(p => planExam(p) === examId)) continue;
      if (
        (jobs || []).some(
          j =>
            j.kind === 'exam-plan' &&
            new RegExp(`\\b${examId}\\b`).test(String(j.brief || '') + ' ' + String(j.title || ''))
        )
      )
        continue;
      return { examId, title: exam.title || examId };
    }
    return null;
  }
  function planTasks(plan) {
    return ((plan && plan.days) || []).flatMap(d => d.tasks.map(t => ({ ...t, date: d.date })));
  }
  /** A task is done when it's ticked, when it's a reading whose day has passed, or when its practice set is fully
   *  answered. plan: a planView; answers: answers/<setId> docs. */
  function taskDone(plan, task, date, sets, answers) {
    if (plan && plan.done && plan.done[task.id]) return true;
    if (task.kind === 'reading' && task.date < date) return true;
    if (sets && ['drill', 'sim'].includes(task.kind)) {
      const s = sets.find(x => x.planTaskId === task.id);
      if (s && (s.items || []).length && answeredItems(s, answers).length === s.items.length) return true;
    }
    return false;
  }
  /** Chapters whose reading isn't done yet on `date`, with the date each is scheduled. */
  function unreadChapters(plans, date) {
    const out = {};
    for (const p of plans || [])
      for (const t of planTasks(p)) {
        if (t.kind !== 'reading' || !t.chapters || taskDone(p, t, date)) continue;
        for (const ch of t.chapters)
          if (!out[ch] || t.date < out[ch].date) out[ch] = { date: t.date, task: t.text, plan: p.exam };
      }
    return out;
  }
  /** D-041: a miss on content not read yet is a preview. Returns {readingDue, what, note} or null. */
  function preReadFor(q, plans, date) {
    if (!q || !Array.isArray(q.chapters) || !q.chapters.length) return null;
    const unread = unreadChapters(plans, date);
    const hits = q.chapters.filter(ch => unread[ch]);
    if (!hits.length) return null;
    const due = hits.map(ch => unread[ch].date).sort()[0];
    const what = hits.join(', ');
    return {
      readingDue: due < date ? date : due,
      what,
      note: `Missed before the ${what} reading; one correct check after reading clears it`,
    };
  }

  // ---------------------------------------------------------------- day type, load, ranking
  /** An exam of a kind its course counts as an exam day (spec.courses.<course>.examDayKinds). */
  function isExamDay(e, date) {
    return !!e && e.date === date && examIs(e, 'examDayKinds');
  }
  function dayType({ date, dates, dateedits, exams }) {
    if ((exams || []).some(e => isExamDay(e, date))) return 'exam';
    // A calendar entry sets the day type when its course counts that kind (calendarDayKinds).
    const todays = liveDates(dates, dateedits).filter(d => d.date === date),
      on = k => todays.filter(d => d.kind === k && kindsOf(courseOf(d), 'calendarDayKinds').includes(k));
    if (on('exam').some(d => /\bexam\b/i.test(d.title || '') && !/sim/i.test(d.title || ''))) return 'exam';
    if (on('clinical').length) return 'clinical';
    if (on('validation').length) return 'validation';
    const wd = weekday(date);
    return wd === 0 || wd === 6 ? 'off' : 'class';
  }
  /** The exams ahead that set the review load, nearest first: each active course's reviewKinds (D-099). */
  function nextExams(exams, date) {
    const active = new Set(activeCourses());
    return (exams || [])
      .filter(
        e => e.date && e.date > date && active.has(courseOf(e)) && examIs(e, 'reviewKinds') && e.status !== 'done'
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  /** Today's review load (v2 rule + exam flex). */
  function reviewLoad({ date, dayType: dt, exams, weakspots }) {
    const L = C.review.load,
      F = C.review.flex;
    const next = nextExams(exams, date)[0] || null;
    const daysLeft = next ? diffDays(date, next.date) : null;
    let base =
      dt === 'exam'
        ? L.examDay
        : dt === 'clinical'
          ? daysLeft === 1
            ? L.clinicalBeforeExam
            : L.clinical
          : L[dt] != null
            ? L[dt]
            : L.class;
    let load = base,
      flex = null;
    if (dt !== 'exam' && next && daysLeft >= 1 && daysLeft <= F.withinDays) {
      const active = (weakspots || []).filter(w => isActive(w) && examOf(w) === next.id);
      const need = active.reduce((s, w) => s + reviewNeed(w), 0);
      const perDay = Math.ceil(need / daysLeft);
      const cap = dt === 'clinical' ? F.maxClinical : F.max;
      flex = { exam: next.id, need, daysLeft, perDay, cap };
      load = Math.max(base, Math.min(perDay, cap));
    }
    const reason = flex
      ? `${flex.need} correct reviews still needed for ${flex.exam} over ${flex.daysLeft} day${flex.daysLeft > 1 ? 's' : ''}, so ${load} today (base ${base}, cap ${flex.cap})`
      : `${DAY_LABELS[dt] || dt}: ${load}`;
    return { load, base, flex, reason };
  }
  function examDateMap(exams) {
    const m = {};
    for (const e of exams || []) if (e.date) m[e.id] = e.date;
    return m;
  }
  /** Due weak spots in v2 priority order: overdue, nearest exam, recurrence, oldest. When exams of different courses
   *  fall on the same day, their weak spots take turns in proportion to how many each has due (D-099), so any first n
   *  splits the day's load between them. */
  function rankDue(weakspots, date, exams) {
    const ed = examDateMap(exams),
      courseOfExam = {};
    for (const e of exams || []) courseOfExam[e.id] = courseOf(e);
    const sorted = rankDueSorted(weakspots, date, ed);
    const out = [];
    let i = 0;
    while (i < sorted.length) {
      const key = w => (w.derived.nextDue < date ? 0 : 1) + '|' + (ed[examOf(w)] || '9999'),
        k = key(sorted[i]);
      let j = i;
      while (j < sorted.length && key(sorted[j]) === k) j++;
      const group = sorted.slice(i, j),
        byCourse = {};
      for (const w of group) (byCourse[courseOfExam[examOf(w)] || ''] ||= []).push(w);
      const lanes = Object.values(byCourse);
      if (lanes.length < 2 || !ed[examOf(group[0])]) out.push(...group);
      else {
        const taken = lanes.map(() => 0);
        for (let n = 0; n < group.length; n++) {
          let best = -1;
          lanes.forEach((l, li) => {
            if (taken[li] < l.length && (best < 0 || taken[li] / l.length < taken[best] / lanes[best].length))
              best = li;
          });
          out.push(lanes[best][taken[best]++]);
        }
      }
      i = j;
    }
    return out;
  }
  function rankDueSorted(weakspots, date, ed) {
    return (weakspots || [])
      .filter(w => isDue(w, date))
      .sort(
        (a, b) =>
          (a.derived.nextDue < date ? 0 : 1) - (b.derived.nextDue < date ? 0 : 1) ||
          String(ed[examOf(a)] || '9999').localeCompare(String(ed[examOf(b)] || '9999')) ||
          (b.derived.recurrence || 1) - (a.derived.recurrence || 1) ||
          (b.derived.misses || 0) - (a.derived.misses || 0) ||
          String(a.addedAt || '').localeCompare(String(b.addedAt || ''))
      );
  }
  function targetExam({ exams, objectives, weakspots, date }) {
    return (
      (exams || [])
        .filter(
          e =>
            e.date &&
            e.date >= date &&
            ((objectives || []).some(o => o.exam === e.id) ||
              (weakspots || []).some(w => isActive(w) && examOf(w) === e.id))
        )
        .sort((a, b) => a.date.localeCompare(b.date))[0] || null
    );
  }
  function pickReviews({ date, dayType: dt, weakspots, exams, objectives }) {
    const load = reviewLoad({ date, dayType: dt, exams, weakspots });
    const due = rankDue(weakspots, date, exams);
    const picked = due.slice(0, load.load);
    const deferred = due
      .slice(load.load)
      .map(w => ({ id: w.id, topic: w.topic, reason: `over today's load of ${load.load}` }));
    let checks = [];
    const target = targetExam({ exams, objectives, weakspots, date });
    if (C.review.newChecksOn.includes(dt) && target && load.load > 0) {
      const activeObj = new Set((weakspots || []).filter(isActive).map(w => w.objective));
      checks = (objectives || [])
        .filter(o => o.exam === target.id && !activeObj.has(o.id))
        .map(o => o.id)
        .slice(0, C.review.newChecksPerDay);
    }
    return { load, picked, deferred, checks, target: target && target.id };
  }

  // The exam plan pages' own legend.
  const PLAN_TAG_LABELS = {
    graded: 'GRADED',
    drill: 'PRACTICE',
    review: 'ATI REVIEW',
    clinical: 'CLINICAL PREP',
    val: 'VALIDATION PREP',
  };

  // ---------------------------------------------------------------- day plan (budget in minutes across both courses)
  // Fixed items (D-086): his own time, never E.V.'s study budget.
  const FIXED_KINDS = ['graded', 'clinical', 'exam'];
  function planDay(ctx) {
    const { date, exams = [], weakspots = [], objectives = [], sets = [], answers = [] } = ctx;
    const dates = liveDates(ctx.dates, ctx.dateedits);
    const plans = ctx.planedits ? planViews(ctx.plans, ctx.planedits) : ctx.plans || [];
    const dt = dayType({ date, dates, exams });
    const available = C.dayBudgetMinutes[dt] != null ? C.dayBudgetMinutes[dt] : 180;
    const M = C.taskMinutes,
      perQ = C.review.minutesPerQuestion;
    const blocks = [];
    const add = b => blocks.push(Object.assign({ minutes: 0, required: false, cut: 50 }, b));
    // Exams today, any course: fixed.
    for (const e of exams.filter(e => e.date === date))
      add({
        id: 'exam-' + e.id,
        kind: 'exam',
        title: e.title,
        tag: 'EXAM',
        minutes: M.exam,
        required: true,
        note: 'Scheduled only',
        course: e.course || defaultCourse(),
        ref: 'exams/' + e.id,
      });
    // Dates today: graded work (scheduled only), clinical and validations: fixed.
    for (const d of dates.filter(d => d.date === date)) {
      if (blocks.some(b => b.kind === 'exam' && d.kind === 'exam' && similarity(b.title, d.title) > 0.3)) continue;
      if (d.graded && d.kind !== 'exam')
        add({
          id: 'date-' + d.id,
          kind: 'graded',
          title: d.title,
          tag: 'GRADED',
          minutes: M.graded,
          required: true,
          note: 'Graded',
          course: d.course,
          ref: 'dates/' + d.id,
        });
      else if (d.kind === 'clinical')
        add({
          id: 'date-' + d.id,
          kind: 'clinical',
          title: d.title,
          tag: 'CLINICAL',
          minutes: 0,
          required: true,
          ref: 'dates/' + d.id,
        });
      else if (d.kind === 'validation')
        add({
          id: 'date-' + d.id,
          kind: 'val',
          title: d.title,
          tag: 'VALIDATION',
          minutes: 0,
          required: true,
          ref: 'dates/' + d.id,
          note: d.notes || '',
        });
      else if (d.kind === 'exam' && !blocks.some(b => b.kind === 'exam'))
        add({
          id: 'date-' + d.id,
          kind: 'exam',
          title: d.title,
          tag: 'EXAM',
          minutes: M.exam,
          required: true,
          note: 'Scheduled only',
          ref: 'dates/' + d.id,
        });
    }
    // Graded work due tomorrow: a heads-up, not budgeted.
    for (const d of dates.filter(d => d.date === addDays(date, 1) && d.graded))
      add({
        id: 'soon-' + d.id,
        kind: 'graded-soon',
        title: d.title + ' (due tomorrow)',
        tag: 'GRADED',
        minutes: 0,
        required: true,
        note: 'Graded',
        ref: 'dates/' + d.id,
      });
    // D-086: a plan task that names one of today's records (title similarity 0.3 or better) is that record, shown once
    // under the record's id; graded work, exams, clinicals and validations are fixed and cost no study minutes.
    const records = blocks.filter(b => b.ref && ['exam', 'graded', 'clinical', 'val'].includes(b.kind));
    for (const b of records) b.minutes = 0;
    // Plan tasks for today, in plan order.
    for (const p of plans) {
      const day = (p.days || []).find(x => x.date === date);
      if (!day) continue;
      for (const t of day.tasks) {
        if (['clinical'].includes(t.kind) && blocks.some(b => b.kind === 'clinical')) continue;
        const same = records.find(b => similarity(b.title, t.text) >= C.planDay.sameItem);
        if (same) {
          (same.planTasks = same.planTasks || []).push(t.id);
          continue;
        }
        const done = taskDone(p, { ...t, date }, date, sets, answers);
        const cutRank =
          {
            terminology: 10,
            other: 20,
            review: 35,
            val: 45,
            drill: 50,
            sim: 55,
            reading: 70,
            graded: 99,
            clinical: 99,
            exam: 99,
          }[t.kind] || 20;
        const optional = /^optional\b|^only if\b|^if\b/i.test(t.text);
        const fixed = FIXED_KINDS.includes(t.kind);
        add({
          id: 'plan-' + t.id,
          kind: t.kind,
          title: t.text,
          tag: t.tag ? PLAN_TAG_LABELS[t.tag] || t.tag.toUpperCase() : t.kind === 'reading' ? 'READING' : null,
          minutes: done || fixed ? 0 : M[t.kind] != null ? M[t.kind] : M.other,
          required: ['graded', 'clinical', 'exam'].includes(t.kind),
          cut: optional ? 5 : cutRank,
          done,
          plan: p.exam,
          taskId: t.id,
          drill: t.drill || null,
          chapters: t.chapters || null,
        });
      }
    }
    // Reviews and new checks.
    // B-68 (D-116): the scheduler the caller names (core/study.mjs picker); today's rule when none.
    const pr = (ctx.pickReviews || pickReviews)({ date, dayType: dt, weakspots, exams, objectives });
    const baseN = Math.min(pr.picked.length, pr.load.base);
    const flexN = pr.picked.length - baseN;
    if (baseN)
      add({
        id: 'review-base',
        kind: 'reviews',
        title: `Review · ${baseN} weak spot${baseN > 1 ? 's' : ''}`,
        tag: 'REVIEW',
        minutes: Math.round(baseN * perQ),
        cut: 60,
        count: baseN,
      });
    if (flexN)
      add({
        id: 'review-flex',
        kind: 'reviews',
        title: `Exam flex · ${flexN} more`,
        tag: 'REVIEW',
        minutes: Math.round(flexN * perQ),
        cut: 40,
        count: flexN,
      });
    if (pr.checks.length)
      add({
        id: 'checks',
        kind: 'checks',
        title: `New checks · ${pr.checks.length} objective${pr.checks.length > 1 ? 's' : ''}`,
        tag: 'REVIEW',
        minutes: Math.round(pr.checks.length * perQ),
        cut: 30,
        count: pr.checks.length,
      });
    // Fit the budget: cut the lowest-priority optional work first, and say why.
    const deferred = [];
    const planned = () => blocks.reduce((s, b) => s + (b.minutes || 0), 0);
    const cuttable = blocks.filter(b => !b.required && !b.done && b.minutes > 0).sort((a, b) => a.cut - b.cut);
    for (const b of cuttable) {
      if (planned() <= available) break;
      deferred.push({
        id: b.id,
        title: b.title,
        minutes: b.minutes,
        reason: `over today's ${available}-minute budget`,
      });
      b.deferred = true;
      b.minutes = 0;
    }
    const reviewsKept = blocks.filter(b => b.kind === 'reviews' && !b.deferred).reduce((s, b) => s + b.count, 0);
    return {
      date,
      dayType: dt,
      dayLabel: DAY_LABELS[dt] || dt,
      budget: { available, planned: planned(), over: Math.max(0, planned() - available) },
      blocks,
      deferred: [
        ...deferred,
        ...pr.deferred.map(d => ({ id: d.id, kind: 'weakspot', title: d.topic, reason: d.reason })),
      ],
      reviews: {
        load: pr.load,
        ids: pr.picked.slice(0, reviewsKept).map(w => w.id),
        checks: blocks.some(b => b.id === 'checks' && !b.deferred) ? pr.checks : [],
        target: pr.target,
      },
    };
  }

  // ---------------------------------------------------------------- daily list and push
  function buildDayList(plan, ctx = {}) {
    const items = [];
    const push = it => items.push(it);
    const order = ['graded', 'graded-soon', 'exam', 'clinical', 'val'];
    for (const k of order)
      for (const b of plan.blocks.filter(b => b.kind === k))
        push({ id: b.id, text: b.title, tag: b.tag, note: b.note || '', minutes: b.minutes || 0, ref: b.ref || null });
    const setFor = taskId => (ctx.sets || []).find(s => s.planTaskId === taskId);
    for (const b of plan.blocks.filter(b => b.taskId && !order.includes(b.kind))) {
      const s = setFor(b.taskId);
      push({
        id: b.id,
        text: b.title,
        tag: b.tag,
        minutes: b.minutes,
        done: !!b.done,
        deferred: !!b.deferred,
        ref: 'plans/' + b.plan + '#' + b.taskId,
        set: s ? s.id : null,
      });
    }
    for (const b of plan.blocks.filter(b => ['reviews', 'checks'].includes(b.kind)))
      push({
        id: b.id,
        text: b.title,
        tag: b.tag,
        minutes: b.minutes,
        deferred: !!b.deferred,
        ref: ctx.reviewSetId ? 'sets/' + ctx.reviewSetId : null,
      });
    const listedTasks = new Set(plan.blocks.filter(b => b.taskId).map(b => b.taskId));
    for (const s of (ctx.newSets || []).filter(s => !s.planTaskId || !listedTasks.has(s.planTaskId)))
      push({ id: 'set-' + s.id, text: s.title, tag: 'PRACTICE', minutes: 0, ref: 'sets/' + s.id, set: s.id });
    for (const c of (ctx.canvasFlags || []).slice(0, 3))
      push({ id: 'canvas-' + c.id, text: c.text, tag: 'CANVAS', minutes: 0, ref: c.ref || null });
    for (const n of (ctx.notes || []).slice(0, 2))
      push({ id: 'note-' + n.id, text: n.topic, tag: 'NOTES', minutes: 0, ref: 'weakspots/' + n.id });
    const focus = (ctx.focus || [])
      .slice(0, 3)
      .map(w => w.topic + (w.derived && w.derived.recurrence > 1 ? ` (seen ${w.derived.recurrence}×)` : ''));
    const reviewCount = plan.reviews.ids.length + plan.reviews.checks.length;
    const top =
      items.find(i => !i.done && !i.deferred && i.tag !== 'GRADED' && !/due tomorrow/.test(i.text) && i.minutes > 0) ||
      items.find(i => !i.done) ||
      null;
    const pushLine = `${plan.dayLabel} · ${reviewCount} review${reviewCount === 1 ? '' : 's'} ready · ${top ? top.text.replace(/\s*\(~?\d+ min\)/, '').slice(0, 70) : 'nothing else planned'}`;
    return { items, focus, push: pushLine, budget: plan.budget, deferred: plan.deferred };
  }

  // ---------------------------------------------------------------- list edits (D-078)
  // The planned items stay the morning run's (planDay + buildDayList, stored as days/<date>, Derived). What Matt or E.V.
  // adds, or takes off for the day, lives in the page's own dayedits/<date> (an Edit, replaced whole), so the 4:25am
  // rebuild never touches it:
  //   added: {itemId: {text, tag, kind, minutes, course, at, by}}   skipped: {itemId: {at, by}}   checks: {itemId: {at}}
  const LIST_KINDS = { reading: 'READING', practice: 'PRACTICE', review: 'REVIEW', notes: 'NOTES', todo: null };
  const FIXED_TAGS = new Set(['GRADED', 'EXAM', 'CLINICAL', 'VALIDATION']);
  /** Graded work, exams, clinicals and validations stay on the list; everything else can be taken off for the day. */
  const isFixedItem = it => !!it && (FIXED_TAGS.has(it.tag) || /^(date|exam|soon)-/.test(String(it.id || '')));
  /** The day's list as he sees it: planned items (minus the ones taken off), then the added ones in the order they came. */
  function dayView(day, dayedit) {
    const ed = dayedit || {};
    const base = (day && day.list && day.list.items) || [];
    const skip = ed.skipped || {};
    const checks = ed.checks || {};
    const off = it => !!skip[it.id] && !isFixedItem(it);
    const added = Object.entries(ed.added || {})
      .filter(([, a]) => a && a.text && !isPrepAdded(a)) // prep items live on the prep check
      .sort(([, a], [, b]) => String(a.at || '').localeCompare(String(b.at || '')))
      .map(([id, a]) => ({
        id,
        text: a.text,
        tag: a.tag || null,
        note: a.course || '',
        minutes: Number(a.minutes) || 0,
        added: true,
        by: a.by || 'E.V.',
      }));
    const b = day && day.plan && day.plan.budget;
    const minus = base.filter(off).reduce((s, it) => s + (Number(it.minutes) || 0), 0);
    const plus = added.reduce((s, it) => s + it.minutes, 0);
    const planned = b ? Math.max(0, (b.planned || 0) - minus + plus) : 0;
    const items = [...base.filter(it => !off(it)), ...added].map(it => (checks[it.id] ? { ...it, checked: true } : it));
    return {
      items,
      budget: b ? { ...b, planned, over: Math.max(0, planned - (b.available || 0)) } : null,
      skipped: base.filter(off).map(it => ({ id: it.id, text: it.text })),
    };
  }
  /** A new dayedits/<date> document from the existing one (or none), with the page's envelope and updatedAt. */
  function dayeditBase(dayedit, date, now) {
    const b = editBase(dayedit, now);
    return {
      ...b,
      date: b.date || date,
      checks: { ...(b.checks || {}) },
      added: { ...(b.added || {}) },
      skipped: { ...(b.skipped || {}) },
      checkin: b.checkin === undefined ? null : b.checkin,
    };
  }
  /** One edit to a day's list. add {text, kind?, minutes?, course?} · remove {id} (an added item goes; a planned one is skipped
   *  for the day) · restore {id} (a skipped item comes back) · check {id, done?} (ticked off or not). Returns {id, text,
   *  doc} where doc is the whole new dayedits/<date> (null when nothing changes, with a note); throws a reason he can read. */
  function listEdit(day, dayedit, edit, { now, by = 'E.V.', date } = {}) {
    const action = edit && edit.action;
    const ed = dayedit || {};
    by = by === 'Matt' ? 'Matt' : 'E.V.';
    const added = ed.added || {};
    const skip = ed.skipped || {};
    const planned = (day && day.list && day.list.items) || [];
    const forDate = date || (day && (day.date || day.id)) || ed.date || chicagoDate(now);
    const next = () => dayeditBase(dayedit, forDate, now);
    if (action === 'add') {
      const text = String(edit.text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140);
      if (!text) throw new Error('text is required');
      const same = dayView(day, dayedit).items.find(it => norm(it.text) === norm(text));
      if (same) return { id: same.id, text: same.text, doc: null, note: 'already on the list' };
      const kind = Object.prototype.hasOwnProperty.call(LIST_KINDS, edit.kind) ? edit.kind : 'todo';
      const minutes = Math.max(0, Math.min(240, Math.round(Number(edit.minutes) || 0)));
      const course = isCourse(edit.course) ? edit.course : '';
      const base = 'add-' + (slug(text, 32) || 'item');
      let id = safeId(base);
      for (let n = 2; added[id] || planned.some(it => it.id === id); n++) id = safeId(base + '-' + n);
      const doc = next();
      doc.added[id] = { text, tag: LIST_KINDS[kind], kind, minutes, course, at: isoOf(now), by };
      return { id, text, doc };
    }
    const id = String((edit && edit.id) || '');
    if (action === 'remove') {
      if (added[id] && added[id].text) {
        const doc = next();
        delete doc.added[id];
        delete doc.checks[id];
        return { id, text: added[id].text, doc };
      }
      const it = planned.find(x => x.id === id);
      if (!it) throw new Error('no item ' + id + ' on that day’s list');
      if (isFixedItem(it))
        throw new Error(`“${it.text}” is ${String(it.tag || 'fixed').toLowerCase()}; it stays on the list`);
      if (skip[id]) return { id, text: it.text, doc: null, note: 'already off the list' };
      const doc = next();
      doc.skipped[id] = { at: isoOf(now), by };
      return { id, text: it.text, doc };
    }
    if (action === 'restore') {
      const it = planned.find(x => x.id === id);
      if (!it) throw new Error('no planned item ' + id + ' on that day');
      if (!skip[id]) return { id, text: it.text, doc: null, note: 'already on the list' };
      const doc = next();
      delete doc.skipped[id];
      return { id, text: it.text, doc };
    }
    if (action === 'check') {
      const it = planned.find(x => x.id === id) || (added[id] && { id, text: added[id].text });
      if (!it) throw new Error('no item ' + id + ' on that day’s list');
      if (skip[id] && !added[id] && !isFixedItem(it))
        throw new Error(`“${it.text}” is off the list for the day; bring it back first`);
      const done = edit.done !== false;
      const checks = ed.checks || {};
      if (!!checks[id] === done) return { id, text: it.text, doc: null, note: done ? 'already done' : 'not done yet' };
      const doc = next();
      if (done) doc.checks[id] = { at: isoOf(now), by };
      else delete doc.checks[id];
      return { id, text: it.text, doc };
    }
    throw new Error('action must be add, remove, restore or check');
  }

  // ---------------------------------------------------------------- library: course materials (D-079)
  // B-155: the section lives in core/library.mjs; the names the rest of core uses, bound once, ahead of the prep
  // checks and insights, whose factories read them as they are made.
  const {
    MATERIAL_KINDS,
    citeMaterial,
    guessCourse,
    libStem,
    libTokens,
    libraryCatalog,
    libraryChunks,
    libraryIndex,
    libraryPick,
    liveMaterials,
    materialFromUpload,
    materialKind,
    materialRemove,
    mergeOcr,
    normCourse,
    ocrPrompt,
    officeText,
    parseOcr,
    pdfText,
    readMaterial,
    searchLibrary,
    stripHtml,
  } = makeLibrary({
    get C() {
      return C;
    },
    STOP,
    activeCourses,
    chicagoDate,
    courseTable,
    defaultCourse,
    editBase,
    envelope,
    isCourse,
    isoOf,
    norm,
    safeId,
    slug,
  });

  // ---------------------------------------------------------------- prep checks (D-143, D-144)
  // B-159: the section lives in core/prep.mjs; the names the rest of core uses, bound once.
  const { isPrepAdded, prepBringItems, prepDay, prepEdit, prepKindOf, prepList } = makePrep({
    get C() {
      return C;
    },
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
  });

  // ---------------------------------------------------------------- graded work (B-99)
  // The graded-work limit speaks only when a request crosses it: no standing reminder anywhere, and a real ask to do,
  // edit, check or turn in graded work gets one line back without a model call.
  const GRADED_ACT =
    /\b(write|do|finish|complete|edit|fix|proofread|check|grade|answer|fill (?:in|out)|turn (?:it |this |that )?in|submit|redo|rewrite|draft|word)\b/;
  const GRADED_WORK =
    /\b(graded|for (?:a )?grade|for credit|care plans?|discussion posts?|medication tables?|narrative notes?|clinical judgment maps?|concept maps?|my (?:assignment|quiz|paper|essay|homework))\b/;
  const GRADED_ONE_LINE = 'That’s graded work, so it stays yours. I can block time for it or quiz you on the topic.';
  /** The one-line refusal when text asks E.V. to do, edit, check or turn in graded work (by its words, or by naming a
   *  graded calendar entry), else null. Asking about a topic, a quiz or a schedule is not that. */
  function gradedAsk(text, gradedTitles = []) {
    const t = norm(text);
    if (!t || !GRADED_ACT.test(t)) return null;
    if (
      /\b(quiz me|schedule|block time|remind me|when is|when s)\b/.test(t) &&
      !/\b(write|edit|fix|submit|turn in|fill)\b/.test(t)
    )
      return null;
    const words = new Set(t.split(' '));
    const names = (gradedTitles || []).some(x => {
      const k = [
        ...new Set(
          norm(x)
            .split(' ')
            .filter(w => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w))
        ),
      ];
      return k.length >= 2 && k.filter(w => words.has(w)).length >= Math.min(3, k.length);
    });
    return GRADED_WORK.test(t) || names ? GRADED_ONE_LINE : null;
  }

  // ---------------------------------------------------------------- calendar edits (D-080)
  // His calendar is dates/<id> (Facts: canvas-sync writes Canvas's, the page writes the ones Matt or E.V. add) plus the
  // page's dateedits/<id> beside each (an Edit, replaced whole): removed {at, by}, notes, and field overrides. Taking an
  // entry off writes removed on its edit, so it can come back and the nightly Canvas sync (which updates dates in place)
  // never brings it back by itself. Every reader of dates goes through liveDates, which merges the edits in.
  const DATE_KINDS = ['due', 'exam', 'validation', 'clinical', 'other'];
  const isRemovedDate = d => !!(d && d.removed && d.removed.at);
  /** One date as readers see it: the Fact with its edit's overrides and notes, and removed when it was taken off. */
  function dateView(d, edit) {
    if (!d) return d;
    if (!edit) return d;
    // Canvas keeps its own entries current, so an override never masks them; they take notes and removal only.
    const v = { ...d, ...(fromCanvas(d) ? {} : edit.overrides || {}), edited: true };
    if (edit.notes != null) v.notes = edit.notes;
    v.removed = edit.removed && edit.removed.at ? edit.removed : null;
    return v;
  }
  /** The calendar: every date merged with its dateedits/<id>, minus the ones taken off. Views pass through unchanged. */
  function liveDates(dates, dateedits) {
    const by = {};
    for (const e of dateedits || []) if (e) by[e.id] = e;
    return (dates || []).map(d => dateView(d, d && by[d.id])).filter(d => d && !isRemovedDate(d));
  }
  /** Entries the Canvas sync keeps current: written by it, or hand-entered and since linked by their Canvas id. */
  const fromCanvas = d => !!d && (d.writer === 'canvas-sync' || d.source === 'Canvas' || d.canvasId != null);
  /** Canvas's graded work, exams, clinicals and validations stay on the calendar; Canvas keeps them current. */
  const isFixedDate = d => fromCanvas(d) && (!!d.graded || ['exam', 'clinical', 'validation'].includes(d.kind));
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  /** A new dateedits/<id> document from the existing one (or none). */
  function dateeditBase(edit, now) {
    const b = editBase(edit, now);
    return {
      ...b,
      removed: b.removed || null,
      notes: b.notes === undefined ? null : b.notes,
      overrides: { ...(b.overrides || {}) },
    };
  }
  /** One edit to the calendar. add {date, title, kind?, course?, graded?, notes?} · change {id, date?, title?, kind?,
   *  course?, graded?, notes?} (Canvas entries take notes only) · remove {id} · restore {id}. Returns {id, title, date,
   *  write} where write is {op: 'set', collection: 'dates' | 'dateedits', id, data} (null when nothing changes, with a
   *  note); throws a reason he can read. A new entry is a dates/<id> Fact; every later change is its dateedits/<id>. */
  function dateEdit(dates, dateedits, edit, { now, by = 'E.V.' } = {}) {
    const all = dates || [];
    const action = edit && edit.action;
    const at = isoOf(now);
    const edits = {};
    for (const e of dateedits || []) if (e) edits[e.id] = e;
    const view = d => dateView(d, edits[d.id]);
    const text = (v, n) =>
      String(v == null ? '' : v)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, n);
    const course = (v, dflt) => (isCourse(normCourse(v)) ? normCourse(v) : dflt);
    const editWrite = (id, data) => ({ op: 'set', collection: 'dateedits', id, data });
    if (action === 'add') {
      const date = text(edit.date, 10);
      if (!DATE_RE.test(date)) throw new Error('date must be YYYY-MM-DD');
      const title = text(edit.title, 120);
      if (!title) throw new Error('title is required');
      const same = all.map(view).find(d => d.date === date && norm(d.title) === norm(title));
      if (same && !isRemovedDate(same))
        return { id: same.id, title: same.title, date, write: null, note: 'already on the calendar' };
      if (same) {
        const data = dateeditBase(edits[same.id], now);
        data.removed = null;
        return { id: same.id, title: same.title, date, write: editWrite(same.id, data), note: 'back on the calendar' };
      }
      const kind = DATE_KINDS.includes(edit.kind) ? edit.kind : 'due';
      const base = safeId(date + '-' + (slug(title, 30) || 'date'));
      let id = base;
      for (let n = 2; all.some(d => d.id === id); n++) id = safeId(base + '-' + n);
      const data = {
        ...envelope('page', by === 'Matt' ? 'Added by Matt' : 'Told E.V.', now),
        date,
        title,
        kind,
        graded: !!edit.graded,
        course: course(edit.course, defaultCourse()),
        addedBy: by,
      };
      const notes = text(edit.notes, 200);
      if (notes) data.notes = notes;
      return { id, title, date, write: { op: 'set', collection: 'dates', id, data } };
    }
    const id = text(edit && edit.id, 200);
    const raw = all.find(x => x.id === id);
    if (!raw) throw new Error('no calendar entry ' + id);
    const d = view(raw);
    const out = data => ({ id, title: d.title, date: d.date, write: data ? editWrite(id, data) : null });
    if (action === 'remove') {
      if (isFixedDate(d))
        throw new Error(
          `“${d.title}” is ${d.graded ? 'graded work' : 'a ' + d.kind} from Canvas; it stays on the calendar`
        );
      if (isRemovedDate(d)) return { ...out(null), note: 'already off the calendar' };
      const data = dateeditBase(edits[id], now);
      data.removed = { at, by };
      return out(data);
    }
    if (action === 'restore') {
      if (!isRemovedDate(d)) return { ...out(null), note: 'already on the calendar' };
      const data = dateeditBase(edits[id], now);
      data.removed = null;
      return out(data);
    }
    if (action === 'change') {
      if (isRemovedDate(d)) throw new Error(`“${d.title}” is off the calendar; restore it first`);
      const keys = ['date', 'title', 'kind', 'course', 'graded', 'notes'].filter(
        k => edit[k] !== undefined && edit[k] !== null
      );
      if (!keys.length) throw new Error('give what to change: date, title, kind, course, graded or notes');
      if (fromCanvas(d) && keys.some(k => k !== 'notes'))
        throw new Error(
          `“${d.title}” comes from Canvas, which keeps its date and title current; only notes can change here`
        );
      const ch = {};
      if (keys.includes('date')) {
        const v = text(edit.date, 10);
        if (!DATE_RE.test(v)) throw new Error('date must be YYYY-MM-DD');
        ch.date = v;
      }
      if (keys.includes('title')) {
        const v = text(edit.title, 120);
        if (!v) throw new Error('title can’t be empty');
        ch.title = v;
      }
      if (keys.includes('kind')) {
        if (!DATE_KINDS.includes(edit.kind)) throw new Error('kind must be one of ' + DATE_KINDS.join(', '));
        ch.kind = edit.kind;
      }
      if (keys.includes('course')) ch.course = course(edit.course, d.course || defaultCourse());
      if (keys.includes('graded')) ch.graded = !!edit.graded;
      if (keys.includes('notes')) ch.notes = text(edit.notes, 200);
      const changed = Object.keys(ch).filter(k => (d[k] ?? (k === 'notes' ? '' : null)) !== ch[k]);
      if (!changed.length) return { ...out(null), note: 'no change' };
      const data = dateeditBase(edits[id], now);
      for (const k of changed) {
        if (k === 'notes') data.notes = ch.notes;
        else data.overrides[k] = ch[k];
      }
      return { ...out(data), title: ch.title || d.title, date: ch.date || d.date, changed };
    }
    throw new Error('action must be add, change, remove or restore');
  }

  // ---------------------------------------------------------------- snapshot
  /** The latest runs/<id> per pipeline: {pipeline: {id, status, startedAt, endedAt, detail, release}}. */
  function lastRuns(runDocs) {
    const out = {};
    for (const r of runDocs || []) {
      if (!r || !r.pipeline) continue;
      if (!out[r.pipeline] || toMs(r.startedAt) > toMs(out[r.pipeline].startedAt))
        out[r.pipeline] = {
          id: r.id,
          status: r.status,
          startedAt: r.startedAt,
          endedAt: r.endedAt || null,
          detail: r.detail || '',
          release: r.release || null,
        };
    }
    return out;
  }
  function buildSnapshot(ctx) {
    const {
      date,
      now,
      exams = [],
      weakspots = [],
      sets = [],
      answers = [],
      days = [],
      runs: runDocs = [],
      counts = null,
      versions = {},
      lint: lintResult = null,
      canvas = null,
    } = ctx;
    // B-107 (D-143, D-144): tomorrow's prep check, built as the page builds it, when the caller passes the materials.
    const prepDayNext = ctx.materials ? prepDay(ctx.dates, ctx.dateedits, addDays(date, 1)) : null;
    const prepNext = prepDayNext
      ? prepList({
          day: prepDayNext,
          phase: 'night',
          materials: ctx.materials,
          dates: ctx.dates,
          dateedits: ctx.dateedits,
          dayedits: ctx.dayedits || [],
        })
      : null;
    const dates = liveDates(ctx.dates, ctx.dateedits);
    const plans = ctx.planedits ? planViews(ctx.plans, ctx.planedits) : ctx.plans || [];
    const ws = weakspots;
    const nextExams = (exams || [])
      .filter(e => e.date && e.date >= date && e.status !== 'done')
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 6)
      .map(e => ({
        id: e.id,
        title: e.title,
        date: e.date,
        course: e.course || defaultCourse(),
        kind: e.kind,
        daysLeft: diffDays(date, e.date),
      }));
    const due = rankDue(ws, date, exams);
    const byExam = {};
    for (const w of ws.filter(w => (w.kind || 'concept') === 'concept')) {
      const ex = examOf(w) || '?';
      const b = (byExam[ex] = byExam[ex] || { active: 0, solid: 0, parked: 0, need: 0, preRead: 0 });
      if (isActive(w)) {
        b.active++;
        b.need += reviewNeed(w);
        if (w.derived.preRead) b.preRead++;
      } else if (isSolid(w)) b.solid++;
      else if (w.derived.status === 'parked') b.parked++;
    }
    const today = days.find(d => (d.date || d.id) === date) || null;
    const runs = lastRuns(runDocs);
    const reviewSet = sets.find(s => s.id === 'review-' + date) || null;
    const answered = reviewSet ? answeredItems(reviewSet, answers).length : 0;
    const docs = counts ? Object.values(counts).reduce((s, n) => s + n, 0) : null;
    return {
      date,
      generatedAt: isoOf(now),
      specVersion: versions.spec || null,
      release: versions.release || null,
      derivedHash: derivedHash(ws),
      nextExams,
      due: {
        count: due.length,
        top: due.slice(0, 15).map(w => ({
          id: w.id,
          topic: w.topic,
          objective: w.objective,
          nextDue: w.derived.nextDue,
          recurrence: w.derived.recurrence,
        })),
      },
      weakspots: {
        active: ws.filter(isActive).length,
        solid: ws.filter(isSolid).length,
        notes: ws.filter(w => w.kind === 'note' && w.derived.status === 'open').length,
        byExam,
      },
      today: today
        ? {
            dayType: today.dayType || null,
            push: today.push || null,
            reviewSet: reviewSet ? reviewSet.id : null,
            reviewItems: reviewSet ? (reviewSet.items || []).length : 0,
            answered,
          }
        : { dayType: dayType({ date, dates, exams }), reviewSet: reviewSet ? reviewSet.id : null, answered },
      reading: Object.entries(unreadChapters(plans, date))
        .slice(0, 12)
        .map(([ch, v]) => ({ chapter: ch, date: v.date })),
      canvas: canvas || null,
      health: { runs, capacity: counts ? capacity(counts, ctx.bytes || {}, ctx.budgets || {}) : null, counts },
      lint: lintResult
        ? {
            errors: lintResult.filter(i => i.severity === 'error').length,
            warnings: lintResult.filter(i => i.severity === 'warning').length,
            top: lintResult.slice(0, 8),
          }
        : null,
      ...(ctx.materials
        ? {
            prep: prepNext
              ? {
                  date: prepNext.date,
                  kind: prepNext.kind,
                  title: prepNext.title,
                  items: prepNext.items.map(it => ({
                    text: it.text,
                    cite: it.cite,
                    ...(it.paperwork ? { paperwork: true } : {}),
                    ...(it.usual ? { usual: true } : {}),
                    ...(it.added ? { added: true } : {}),
                  })),
                  empty: prepNext.empty,
                  note: prepNext.note,
                }
              : null,
          }
        : {}),
    };
  }
  /**
   * The record against its budgets (D-093: spec.capacity.collections; v3's 25,000-document cap is gone). counts and
   * bytes per collection in, {docs, level, budgets: [{collection, docs, bytes, warnDocs, failDocs, warnBytes, failBytes,
   * level, relief}]} out, one row per collection that has a budget, worst level first.
   */
  function capacity(counts = {}, bytes = {}, budgets = {}) {
    const rank = { fail: 0, warn: 1, ok: 2 };
    const rows = [];
    for (const [c, b] of Object.entries(budgets || {})) {
      if (!b || [b.warnDocs, b.failDocs, b.warnBytes, b.failBytes].every(x => x == null)) continue;
      const n = counts[c] || 0,
        by = bytes[c] != null ? bytes[c] : null;
      const over = (v, lim) => v != null && lim != null && v >= lim;
      const level =
        over(n, b.failDocs) || over(by, b.failBytes)
          ? 'fail'
          : over(n, b.warnDocs) || over(by, b.warnBytes)
            ? 'warn'
            : 'ok';
      rows.push({
        collection: c,
        docs: n,
        bytes: by,
        warnDocs: b.warnDocs,
        failDocs: b.failDocs,
        warnBytes: b.warnBytes,
        failBytes: b.failBytes,
        level,
        relief: b.relief || null,
      });
    }
    rows.sort((a, z) => rank[a.level] - rank[z.level] || (a.collection < z.collection ? -1 : 1));
    return {
      docs: Object.values(counts || {}).reduce((s, x) => s + x, 0),
      level: rows.length ? rows[0].level : 'ok',
      budgets: rows,
    };
  }

  /** context.json for Study Watch (unchanged v2 shape). */
  function buildContext({ date, now, exams, objectives, weakspots }) {
    const t = targetExam({ exams, objectives, weakspots, date }) || nextExams(exams, date)[0] || null;
    return {
      updatedAt: new Date(now || Date.now()).toISOString(),
      nextExam: t ? { id: t.id, date: t.date, title: t.title } : null,
      objectives: (objectives || [])
        .filter(o => !t || o.exam === t.id)
        .map(o => ({ id: o.id, text: o.text, chapters: o.chapters || '' })),
      activeWeakSpots: (weakspots || [])
        .filter(w => isActive(w) && (!t || examOf(w) === t.id))
        .map(w => ({ objective: w.objective, topic: w.topic })),
    };
  }

  // ---------------------------------------------------------------- insights
  // B-159: the section lives in core/insights.mjs; the names the rest of core uses, bound once.
  const { answerStats, calibrate, examRetro, examViews, predictReadiness, readiness, readinessAudit } = makeInsights({
    addDays,
    citeMaterial,
    collectAttempts,
    diffDays,
    examOf,
    isActive,
    isSolid,
    planTasks,
    reviewNeed,
    searchLibrary,
    taskDone,
  });

  // ---------------------------------------------------------------- lint
  const ID_PATTERNS = [
    {
      re: /\b(?:MRN|medical record (?:no|number)|DOB|date of birth)\b/i,
      why: 'mentions a record number or date of birth',
    },
    { re: /\broom\s*#?\s*\d{1,4}[a-z]?\b/i, why: 'mentions a room number' },
    { re: /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(19[2-9]\d|200\d)\b/, why: 'looks like a birth date' },
    { re: /\b\d{7,10}\b/, why: 'long number that could be a record number' },
  ];
  function scanIdentifiers(text) {
    const out = [];
    for (const p of ID_PATTERNS) if (p.re.test(String(text || ''))) out.push(p.why);
    return out;
  }
  // For whole files (uploads): course documents name these fields ("label with the patient's name, DOB, MRN"), so only
  // a value next to them counts. Messages keep the stricter scan above.
  const ID_VALUE_PATTERNS = [
    {
      re: /\b(?:MRN|medical record (?:no\.?|number)|record\s*#)\s*[:#]?\s*\d{4,}/i,
      why: 'has a medical record number',
    },
    {
      re: /\b(?:DOB|date of birth|born)\s*[:#]?\s*(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4})/i,
      why: 'has a date of birth',
    },
    {
      re: /\b(?:patient|pt|resident|client)\b[^.\n]{0,30}\broom\s*#?\s*\d{1,4}[a-z]?\b|\broom\s*#?\s*\d{1,4}[a-z]?\b[^.\n]{0,30}\b(?:patient|pt|resident|client)\b/i,
      why: "has a patient's room number",
    },
    { re: /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(19[2-9]\d|200\d)\b/, why: 'has what looks like a birth date' },
  ];
  function scanIdentifierValues(text) {
    const out = [];
    for (const p of ID_VALUE_PATTERNS) if (p.re.test(String(text || ''))) out.push(p.why);
    return out;
  }
  function lint(db, { date } = {}) {
    const issues = [];
    const add = (severity, code, ref, msg) => issues.push({ severity, code, ref, msg });
    const ws =
      db.weakspotModels ||
      buildWeakspots({
        weakspots: db.weakspots || [],
        sets: db.sets || [],
        answers: db.answers || [],
        exams: db.exams || [],
      });
    const wsIds = new Set((db.weakspots || []).map(w => w.id));
    const bySet = answersIndex(db.answers);
    const objIds = new Set((db.objectives || []).map(o => o.id));
    for (const s of db.sets || []) {
      for (const q of s.items || []) {
        const v = validateItem(q);
        if (!v.ok) add('error', 'item-invalid', `sets/${s.id}#${q.id}`, v.errors.join('; '));
        if (q.weakspotId && !wsIds.has(q.weakspotId))
          add(
            'warning',
            'orphan-item',
            `sets/${s.id}#${q.id}`,
            'targets a weak spot that does not exist: ' + q.weakspotId
          );
      }
      for (const qid of Object.keys(bySet[s.id] || {}))
        if (!(s.items || []).some(q => q.id === qid))
          add('warning', 'orphan-answer', `answers/${s.id}`, 'answer for a missing item ' + qid);
    }
    const seen = {};
    for (const w of ws.filter(isActive)) {
      const k = (examOf(w) || '') + '|' + (w.objective || '') + '|' + norm(w.topic);
      if (seen[k]) add('warning', 'duplicate', `weakspots/${w.id}`, 'same topic as ' + seen[k]);
      else seen[k] = w.id;
      if (!w.objective) add('warning', 'no-objective', `weakspots/${w.id}`, 'active weak spot without an objective');
      else if (!objIds.has(w.objective))
        add('warning', 'unknown-objective', `weakspots/${w.id}`, 'objective not in the record: ' + w.objective);
    }
    const texts = [
      ...(db.sessions || []).map(s => ['sessions/' + s.id, (s.summary || '') + ' ' + (s.topic || '')]),
      ...(db.journal || []).map(j => ['journal/' + j.id, j.text || '']),
      ...(db.ideas || []).map(i => ['ideas/' + i.id, i.text || '']),
      ...(db.weakspots || []).map(w => ['weakspots/' + w.id, w.topic || '']),
    ];
    for (const [ref, t] of texts)
      for (const why of scanIdentifiers(t)) add('error', 'possible-identifier', ref, why + ' (B-04): check and remove');
    if (date)
      for (const e of examViews(db.exams, db.examedits, db.predictions).sort((a, b) => (a.id < b.id ? -1 : 1)))
        if (e.date && e.date < date && e.status !== 'done' && typeof e.score !== 'number' && examIs(e, 'scoredKinds'))
          add('info', 'exam-passed', 'exams/' + e.id, 'exam date passed; record the score to calibrate');
    const rank = { error: 0, warning: 1, info: 2 };
    return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  }

  // ---------------------------------------------------------------- automatic events
  /** Weak spots whose exam has passed get parked (deterministic rule). Returns event writes. */
  function autoParkEvents({ weakspots, exams, date, now, writer = 'evening-cloud' }) {
    const passed = new Set((exams || []).filter(e => e.date && e.date < date).map(e => e.id));
    const at = isoOf(now);
    return (weakspots || [])
      .filter(w => isActive(w) && passed.has(examOf(w)))
      .map(w => ({
        op: 'update',
        collection: 'weakspots',
        id: w.id,
        data: {
          events: {
            [eventKey(writer, at)]: {
              type: 'park',
              by: 'E.V.',
              note: `${examOf(w)} is done; revisit for ATI and the final`,
              at,
            },
          },
        },
      }));
  }

  // ---------------------------------------------------------------- Markdown mirror (read-only, for Obsidian)
  function toMarkdown(db, { date } = {}) {
    const files = [];
    const ws =
      db.weakspotModels ||
      buildWeakspots({
        weakspots: db.weakspots || [],
        sets: db.sets || [],
        answers: db.answers || [],
        exams: db.exams || [],
      });
    const link = (folder, id, label) => `[[${folder}/${id}|${String(label || id).replace(/[|\]\[]/g, ' ')}]]`;
    const fm = obj =>
      '---\n' +
      Object.entries(obj)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join('\n') +
      '\n---\n\n';
    for (const w of ws)
      files.push({
        path: `weak-spots/${w.id}.md`,
        content:
          fm({
            kind: w.kind,
            status: w.derived.status,
            objective: w.objective,
            exam: examOf(w),
            nextDue: w.derived.nextDue,
            streak: w.derived.streak,
            recurrence: w.derived.recurrence,
          }) +
          `# ${w.topic}\n\n- Objective: ${w.objective ? link('objectives', w.objective, w.objective) : 'none'}\n- Source: ${w.source}\n- Added: ${shortDate(w.addedAt)}\n` +
          (w.derived.history.length
            ? `\n## History\n\n${w.derived.history.map(h => `- ${h.date}: ${h.correct ? 'right' : 'missed'}`).join('\n')}\n`
            : ''),
      });
    for (const o of db.objectives || [])
      files.push({
        path: `objectives/${o.id}.md`,
        content:
          fm({ exam: o.exam }) +
          `# ${o.id}: ${o.text}\n\n${o.chapters || ''}\n\n## Weak spots\n\n${
            ws
              .filter(w => w.objective === o.id)
              .map(w => '- ' + link('weak-spots', w.id, w.topic) + ` (${w.derived.status})`)
              .join('\n') || '- none'
          }\n`,
      });
    for (const e of examViews(db.exams, db.examedits, db.predictions))
      files.push({
        path: `exams/${e.id}.md`,
        content:
          fm({ date: e.date, course: e.course, kind: e.kind, score: e.score }) +
          `# ${e.title}\n\n${(db.objectives || [])
            .filter(o => o.exam === e.id)
            .map(o => '- ' + link('objectives', o.id, o.id + ' ' + o.text))
            .join('\n')}\n`,
      });
    for (const s of db.sessions || [])
      files.push({
        path: `sessions/${s.id}.md`,
        content:
          fm({ date: s.date, minutes: s.minutes, source: s.source }) +
          `# ${s.topic || 'Study session'}\n\n${s.summary || ''}\n`,
      });
    // D-113 (B-62): the mirror holds the journal too, when the run read it.
    for (const j of db.journal || [])
      files.push({
        path: `journal/${j.id}.md`,
        content:
          fm({ kind: j.kind, date: j.createdAt ? chicagoDate(j.createdAt) : null }) +
          `# Journal${j.createdAt ? ': ' + shortDate(chicagoDate(j.createdAt)) : ''}\n\n${j.text || ''}\n`,
      });
    for (const i of db.ideas || [])
      files.push({
        path: `ideas/${i.id}.md`,
        content:
          fm({ status: i.status, objective: i.objective }) +
          `# Idea\n\n${i.text}\n\n${(i.links || []).map(l => `- ${l.type}: [[${l.to}]]`).join('\n')}\n`,
      });
    files.push({
      path: 'index.md',
      content: `# E.V. record mirror\n\nRead-only copy written by the evening pipeline${date ? ' on ' + date : ''}. Edit in E.V. Home, not here.\n\n- Weak spots: ${ws.length}\n- Objectives: ${(db.objectives || []).length}\n- Sessions: ${(db.sessions || []).length}\n- Ideas: ${(db.ideas || []).length}\n`,
    });
    return files;
  }

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
    // The Canvas ingress (Data architecture, "Four ingresses, one scanner"): a text with a patient identifier value is
    // refused here, never stored; the rest of the sync goes on, and the run's own scan of every write stays behind it.
    const refuse = (ref, text) => {
      const why = scanIdentifierValues(text);
      if (!why.length) return false;
      out.refused.push({ ref, why: why[0] });
      out.changes.push({ type: 'refused', ref, text: `Left out ${ref}: it ${why[0]}` });
      return true;
    };
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
      if (refuse('announcements/' + id, (a.title || '') + '\n' + text)) continue;
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
      if (refuse('materials/' + id, (f.title || '') + '\n' + String(f.text || ''))) continue;
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
        text: String(f.text || '').slice(0, C.library.maxChars),
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
  // ---------------------------------------------------------------- Study Watch session intake; study sessions in E.V. Home (D-073)
  // B-156: the sections live in core/sessions.mjs; the names the rest of core uses, bound once.
  const {
    checkPrompt,
    closeSession,
    commentPrompt,
    decideSessionQuestion,
    intakeSession,
    noteDelta,
    noteMark,
    parseCheck,
    parseComment,
    parseWrap,
    sessionContext,
    sessionState,
    wrapPrompt,
  } = makeSessions({
    get C() {
      return C;
    },
    addDays,
    buildContext,
    chicagoDate,
    courses,
    defaultCourse,
    entryTime,
    envelope,
    eventKey,
    hash,
    isActive,
    isoOf,
    norm,
    safeId,
    similarity,
    slug,
    toMs,
  });

  // ---------------------------------------------------------------- skills practice (Features: "Skills practice mode"); workouts (D-108)
  // B-158: the sections live in core/skills.mjs; the names the rest of core uses, bound once.
  const {
    cardsText,
    endSkill,
    endWorkout,
    skillIdle,
    skillResumeChip,
    skillState,
    skillStep,
    skillSteps,
    startSkill,
    startWorkout,
    weakspotCards,
    workoutCheckin,
    workoutMoves,
    workoutRound,
    workoutSequences,
    workoutState,
    workoutSummary,
  } = makeSkills({
    get C() {
      return C;
    },
    get SPEC() {
      return SPEC;
    },
    chicagoDate,
    citeMaterial,
    collectAttempts,
    compactTime,
    defaultCourse,
    entryTime,
    envelope,
    eventKey,
    isActive,
    isoOf,
    safeId,
    scanIdentifiers,
    slug,
    toMs,
  });

  // ---------------------------------------------------------------- shareable practice pages (D-110)
  /**
   * Whether a set can be shared as a page for classmates: a calendar set the exam plan built over a range of chapters or
   * theory content (a drill or sim of a plan task that names chapters). Daily review sets, weak-spot drills, his own
   * extra sets and anything graded, proctored or an exam never qualify. {ok, why, task}.
   */
  function shareableSet(set, plans) {
    if (!set) return { ok: false, why: 'no such set' };
    if (['review', 'more', 'job', 'pool'].includes(set.kind))
      return { ok: false, why: `a ${set.kind} set is built for you, not over a content range` };
    if (!set.planTaskId) return { ok: false, why: 'only a set from the exam plan’s calendar can be shared' };
    let task = null;
    for (const p of plans || []) for (const t of planTasks(p)) if (t.id === set.planTaskId) task = t;
    if (!task) return { ok: false, why: 'its plan task is not in the plan' };
    if (
      ['graded', 'exam', 'val', 'clinical'].includes(task.kind) ||
      /\b(graded|proctored)\b/i.test((task.text || '') + ' ' + (set.title || ''))
    )
      return { ok: false, why: 'graded or proctored work is never shared' };
    if (!['drill', 'sim'].includes(task.kind)) return { ok: false, why: 'only a drill or sim set can be shared' };
    if (/weak spot/i.test(set.title || '') || /weak spot/i.test(task.text || ''))
      return { ok: false, why: 'a weak-spot drill is built from your weak spots' };
    if (!(task.chapters || []).length && !/\b(ch|chapter)s?\.?\s*\d/i.test(task.text || set.title || ''))
      return { ok: false, why: 'it is not built over a chapter or content range' };
    if (!validItems(set).length) return { ok: false, why: 'it has no questions' };
    return { ok: true, why: null, task };
  }
  const esc = s =>
    String(s == null ? '' : s).replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  /**
   * The standalone page (D-110): the set's questions and options, each answer and rationale shown after an attempt.
   * No name, no weak-spot data, no objectives, no record ids: only what a classmate needs to practise. One HTML file.
   */
  function sharePage(set) {
    const items = validItems(set).map(q => ({
      type: itemType(q),
      stem: q.stem,
      options: q.options || [],
      correct: q.correct || [],
      rationales: q.rationales || [],
      matrix: q.matrix || null,
    }));
    const title = String(set.title || 'Practice set')
      .replace(/\s+/g, ' ')
      .trim();
    const qs = items
      .map((q, i) => {
        const n = i + 1;
        const name = 'q' + n;
        let body;
        if (q.type === 'matrix') {
          const cols = q.matrix.columns || [];
          body = `<table class="mx"><thead><tr><th></th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${(q.matrix.rows || []).map((r, ri) => `<tr data-correct="${r.correct}"><th scope="row">${esc(r.text)}</th>${cols.map((c, ci) => `<td><input type="radio" name="${name}-${ri}" value="${ci}" aria-label="${esc(r.text)}: ${esc(c)}"></td>`).join('')}</tr><tr class="why" hidden><td colspan="${cols.length + 1}">${esc(cols[r.correct])}. ${esc(r.rationale || '')}</td></tr>`).join('')}</tbody></table>`;
        } else {
          const kind = q.type === 'sata' ? 'checkbox' : 'radio';
          body = `<ul class="opts">${q.options.map((o, oi) => `<li data-ok="${q.correct.includes(oi) ? 1 : 0}"><label><input type="${kind}" name="${name}" value="${oi}"> <span>${esc(o)}</span></label><p class="why" hidden>${esc(q.rationales[oi] || '')}</p></li>`).join('')}</ul>`;
        }
        return `<section class="q" data-type="${q.type}"><h2><span>${n}.</span> ${esc(q.stem)}</h2>${q.type === 'sata' && !/select all/i.test(q.stem) ? '<p class="hint">Select all that apply.</p>' : ''}${body}<div class="row"><button type="button" class="check">Check</button><span class="res" role="status"></span></div></section>`;
      })
      .join('\n');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>:root{color-scheme:light dark;--bg:#fbfaf7;--ink:#1d2024;--soft:#5b636b;--line:#dcd8d0;--ok:#1c7c5c;--ok-bg:#e3f3ec;--bad:#b4442f;--bad-bg:#f8e6e1;--btn:#1d2024;--btn-ink:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0e1117;--ink:#e6eaee;--soft:#9aa5ae;--line:#2a313a;--ok:#5ad1a6;--ok-bg:#12362b;--bad:#f09a86;--bad-bg:#3a1c16;--btn:#e6eaee;--btn-ink:#0e1117}}
:root[data-theme="dark"]{--bg:#0e1117;--ink:#e6eaee;--soft:#9aa5ae;--line:#2a313a;--ok:#5ad1a6;--ok-bg:#12362b;--bad:#f09a86;--bad-bg:#3a1c16;--btn:#e6eaee;--btn-ink:#0e1117}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 16px 48px}main{max-width:720px;margin:0 auto}
h1{font-size:24px;line-height:1.25;margin:0 0 6px}.lead{color:var(--soft);margin:0 0 24px}.q{border-top:1px solid var(--line);padding:20px 0}.q h2{font-size:17px;font-weight:600;margin:0 0 10px}.q h2 span{color:var(--soft)}
.hint{color:var(--soft);font-size:14px;margin:-4px 0 8px}.opts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.opts li{border:1px solid var(--line);border-radius:10px;padding:8px 12px}.opts label{display:flex;gap:10px;align-items:baseline;cursor:pointer}
.opts li.ok{border-color:var(--ok);background:var(--ok-bg)}.opts li.no{border-color:var(--bad);background:var(--bad-bg)}.why{margin:6px 0 0;font-size:14px;color:var(--soft)}
.mx{border-collapse:collapse;width:100%;font-size:15px}.mx th,.mx td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:center}.mx th[scope=row]{text-align:left;font-weight:500}.mx tr.ok th{color:var(--ok)}.mx tr.no th{color:var(--bad)}.mx .why td{text-align:left;color:var(--soft);font-size:14px}
.row{display:flex;gap:12px;align-items:center;margin-top:12px}button{font:inherit;border:0;border-radius:999px;padding:8px 18px;background:var(--btn);color:var(--btn-ink);cursor:pointer;min-height:40px}.res{font-weight:600}.res.ok{color:var(--ok)}.res.no{color:var(--bad)}
footer{color:var(--soft);font-size:13px;margin-top:28px}</style></head><body><main>
<h1>${esc(title)}</h1><p class="lead">${items.length} practice question${items.length === 1 ? '' : 's'}. Pick your answer, then Check: the right answer and the reasons show after you try.</p>
${qs}
<footer>Practice for study.</footer></main>
<script>document.querySelectorAll('.q').forEach(function(q){q.querySelector('.check').addEventListener('click',function(){var res=q.querySelector('.res'),right=true,any=false;
if(q.dataset.type==='matrix'){q.querySelectorAll('tbody tr[data-correct]').forEach(function(r){var c=r.querySelector('input:checked');if(c)any=true;var ok=c&&c.value===r.dataset.correct;r.classList.toggle('ok',!!ok);r.classList.toggle('no',!ok);if(!ok)right=false;r.nextElementSibling.hidden=false;});}
else{q.querySelectorAll('.opts li').forEach(function(li){var c=li.querySelector('input').checked;if(c)any=true;var want=li.dataset.ok==='1';if(c!==want)right=false;li.classList.toggle('ok',want);li.classList.toggle('no',c&&!want);li.querySelector('.why').hidden=false;});}
if(!any){res.textContent='Pick an answer first.';res.className='res';q.querySelectorAll('.why').forEach(function(w){w.hidden=true});q.querySelectorAll('.ok,.no').forEach(function(e){e.classList.remove('ok','no')});return;}
res.textContent=right?'Right':'Not quite: the right answer is marked';res.className='res '+(right?'ok':'no');});});</script></body></html>`;
  }

  // ---------------------------------------------------------------- backup
  function buildBackup(collections, { now, label, release } = {}) {
    const counts = {};
    for (const [k, v] of Object.entries(collections)) counts[k] = (v || []).length;
    return {
      schema: 1,
      kind: 'E.V. record backup',
      label: label || null,
      at: isoOf(now),
      release: release || null, // B-149: the run's own release, given by its caller
      counts,
      collections,
    };
  }
  function restorePlan(backup) {
    const writes = [];
    for (const [col, docs] of Object.entries(backup.collections || {}))
      for (const d of docs || []) {
        const { id, ...data } = d;
        writes.push({ op: 'set', collection: col, id, data });
      }
    return writes;
  }

  // ---------------------------------------------------------------- conversation (E.V. tab); conversations (B-77, D-128)
  // B-157: the sections live in core/conversation.mjs; the names the rest of core uses, bound once.
  const { conversations, earlierConversation, greeting, noteTitle } = makeConversation({
    get C() {
      return C;
    },
    DAY_LABELS,
    chicagoClock,
    chicagoDate,
    diffDays,
    examIs,
    prepKindOf,
    toMs,
    weekday,
  });

  return {
    VERSION,
    TZ,
    CJ_STEPS,
    CJ_LABELS,
    DAY_LABELS,
    configure,
    constants,
    // helpers
    norm,
    slug,
    safeId,
    similarity,
    hash,
    sha256,
    stableStringify,
    toMs,
    // v4 documents
    compactTime,
    eventKey,
    entryTime,
    envelope,
    docData,
    editBase,
    // dates
    chicagoDate,
    chicagoClock,
    addDays,
    diffDays,
    weekday,
    shortDate,
    // items
    itemType,
    validateItem,
    validItems,
    scoreAnswer,
    unitOf,
    numericGiven,
    isDosageMaterial,
    isDosageTopic,
    // answers and weak spots
    answersIndex,
    answeredItems,
    collectAttempts,
    weakspotFacts,
    deriveWeakspot,
    buildWeakspots,
    isActive,
    isSolid,
    isDue,
    reviewNeed,
    derivedHash,
    examOf,
    planAnswer,
    outcomeText,
    // plans
    planFromCards,
    planView,
    planViews,
    planInForceId,
    planDrafts,
    nextPlanId,
    planAccept,
    planOffer,
    planTick,
    planTasks,
    taskDone,
    unreadChapters,
    preReadFor,
    parseChapters,
    inferTaskKind,
    // planning
    courses,
    courseRule,
    isCourse,
    defaultCourse,
    activeCourses,
    courseOf,
    examIs,
    canvasCourses,
    libraryRules,
    isExamDay,
    dayType,
    reviewLoad,
    rankDue,
    targetExam,
    pickReviews,
    planDay,
    buildDayList,
    nextExams,
    dayView,
    dayeditBase,
    listEdit,
    isFixedItem,
    // prep checks (D-143, D-144)
    prepKindOf,
    prepDay,
    prepBringItems,
    prepList,
    prepEdit,
    gradedAsk,
    DATE_KINDS,
    dateEdit,
    dateView,
    liveDates,
    isRemovedDate,
    isFixedDate,
    fromCanvas,
    // snapshot, context, insights
    buildSnapshot,
    lastRuns,
    capacity,
    weakspotCards,
    examViews,
    buildContext,
    answerStats,
    readiness,
    predictReadiness,
    calibrate,
    examRetro,
    // trust
    lint,
    scanIdentifiers,
    scanIdentifierValues,
    autoParkEvents,
    toMarkdown,
    buildBackup,
    restorePlan,
    // intake
    normalizeCanvas,
    intakeSession,
    // library (course materials)
    MATERIAL_KINDS,
    materialKind,
    liveMaterials,
    materialRemove,
    normCourse,
    citeMaterial,
    libStem,
    libTokens,
    libraryChunks,
    libraryIndex,
    searchLibrary,
    libraryCatalog,
    readMaterial,
    libraryPick,
    officeText,
    pdfText,
    ocrPrompt,
    parseOcr,
    mergeOcr,
    guessCourse,
    materialFromUpload,
    // conversations (Captions)
    conversations,
    noteTitle,
    earlierConversation,
    // study sessions in E.V. Home
    sessionState,
    noteMark,
    noteDelta,
    sessionContext,
    checkPrompt,
    parseCheck,
    commentPrompt,
    parseComment,
    wrapPrompt,
    parseWrap,
    closeSession,
    decideSessionQuestion,
    cardsText,
    // skills practice and the readiness audit
    skillSteps,
    skillState,
    skillStep,
    startSkill,
    endSkill,
    skillIdle,
    skillResumeChip,
    readinessAudit,
    // workouts (D-108)
    shareableSet,
    sharePage,
    workoutSequences,
    workoutMoves,
    startWorkout,
    workoutState,
    workoutRound,
    endWorkout,
    workoutCheckin,
    workoutSummary,
    // conversation
    greeting,
  };
})();

export default EVCore;
