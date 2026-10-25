// E.V. core's library: course materials (D-079). Split from core/evcore.mjs (B-155, D-166) as one factory with no
// imports, so the same file runs in node (evcore.mjs imports it) and in the page (the build writes it into core.js
// ahead of E.V. core). It takes the core names it uses, C through a getter (configure() replaces it), and returns the
// names the rest of core and core's export map use.

export function makeLibrary(core) {
  'use strict';
  const {
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
  } = core;

  // ---------------------------------------------------------------- library: course materials (D-079)
  // materials/<id> holds one file's text with [pN] page or [sN] slide marks. Canvas files arrive with the evening run
  // (picked by each course's library in spec.courses, B-42), uploads from the E.V. conversation. The page and the pipelines chunk and
  // score them the same way, so a citation means the same thing everywhere.
  const MATERIAL_KINDS = ['slides', 'lab', 'clinical', 'course', 'handout', 'upload'];
  // An upload taken out of the library is marked in materialedits/<id> (removed {at, by}); the material is kept.
  const isRemovedMaterial = m => !!(m && m.removed && m.removed.at);
  /** The library as readers see it: each material with its edit's removal merged in, the removed ones left out. */
  function liveMaterials(materials, materialedits) {
    const by = {};
    for (const e of materialedits || []) if (e) by[e.id] = e;
    return (materials || [])
      .map(m => (m && by[m.id] ? { ...m, removed: by[m.id].removed || null } : m))
      .filter(m => m && !isRemovedMaterial(m));
  }
  /** Taking a material out of the library, or putting it back: the whole new materialedits/<id>. */
  function materialRemove(materialedit, { removed = true, now, by = 'Matt' } = {}) {
    return { ...editBase(materialedit, now), removed: removed ? { at: isoOf(now), by } : null };
  }
  function materialKind(m) {
    if (!m) return 'slides';
    if (MATERIAL_KINDS.includes(m.kind)) return m.kind;
    if (m.source === 'upload') return 'upload';
    return /handout|cheat ?sheet|who said what|tic tac toe/i.test(m.title || '') ? 'handout' : 'slides';
  }
  const LIB_SUFFIX = [
    'ations',
    'ation',
    'ated',
    'ates',
    'ate',
    'ments',
    'ment',
    'ings',
    'ing',
    'ies',
    'ied',
    'ness',
    'ally',
    'ly',
    'ed',
    'es',
    's',
    'y',
    'ic',
    'ia',
    'al',
    'e',
  ];
  /** Light stemming for search: one common suffix off (the stem keeps 4+ letters), then the first 7 letters. */
  function libStem(w) {
    if (w.length >= 5 && !/(ss|us|is)$/.test(w))
      for (const s of LIB_SUFFIX)
        if (w.endsWith(s) && w.length - s.length >= 4) {
          w = w.slice(0, -s.length);
          break;
        }
    return w.slice(0, 7);
  }
  const libTokens = s =>
    norm(s)
      .split(' ')
      .filter(w => w.length > 1 && !STOP.has(w))
      .map(libStem);
  const PAGE_MARK = /\[(p|s|Page |Slide )(\d+)\]/; // [p3] [s3], and [Page 3] in files read before D-079
  /** A course name as the record writes it, to its spec.courses name (by its aliases); anything else as it came. */
  function normCourse(c) {
    const t = String(c || '').trim();
    const hit = courseTable().find(r => r.name === t || (r.aliases && new RegExp(r.aliases, 'i').test(t)));
    return hit ? hit.name : c || null;
  }
  /** Every searchable passage: per page or slide, then about chunkChars long, with the page it came from. */
  function libraryChunks(materials, { chunkChars } = {}) {
    const N = chunkChars || core.C.library.chunkChars;
    const out = [];
    for (const m of materials || []) {
      if (!m || !m.text || isRemovedMaterial(m)) continue;
      const kind = materialKind(m);
      for (const part of String(m.text).split(/(?=\[(?:p|s|Page |Slide )\d+\])/)) {
        const mk = /^\[(p|s|Page |Slide )(\d+)\]/.exec(part);
        const page = mk ? Number(mk[2]) : null;
        const unit = mk ? (/^s/i.test(mk[1]) ? 'slide' : 'page') : null;
        const body = part
          .replace(/^\[(?:p|s|Page |Slide )\d+\]\s*/, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!body) continue;
        let buf = '';
        const push = () => {
          if (buf.trim())
            out.push({
              id: m.id,
              title: m.title || m.id,
              course: normCourse(m.course),
              kind,
              page,
              unit,
              text: buf.trim(),
            });
          buf = '';
        };
        for (const s of body.match(/[^.!?•]+[.!?•]*\s*/g) || [body]) {
          if (buf && buf.length + s.length > N) push();
          buf += s;
          if (buf.length > N * 1.6) push();
        }
        push();
      }
    }
    return out;
  }
  /** How E.V. names a passage: "SKILLS PACKET, p. 12" or "Chapter 7 ppt, slide 4". */
  const citeMaterial = h =>
    String(h.title || h.id || '').replace(/\.(pdf|docx|pptx)$/i, '') +
    (h.page ? (h.unit === 'slide' ? ', slide ' : ', p. ') + h.page : '');
  /** B-78 (D-126): a citation as E.V. writes one in a caption, "(SKILLS PACKET, p. 12)" or "(Chapter 7 ppt, slide 4)":
   *  {cite, title, unit, page}, or null for anything else in parentheses. */
  const CITE_RE = /^\s*([^()\n]{2,90}?),\s*(p\.|pp?\.|page|slide)\s*(\d{1,4})\s*$/i;
  function parseCite(s) {
    const x = CITE_RE.exec(String(s || ''));
    if (!x || !/[a-z]/i.test(x[1])) return null;
    return { cite: String(s).trim(), title: x[1].trim(), unit: /slide/i.test(x[2]) ? 'slide' : 'page', page: +x[3] };
  }
  /** The material a citation names: its title (extension dropped) equal to the cited one, else the one it begins. */
  function citeTarget(mats, c) {
    const t = norm(String((c && c.title) || ''));
    if (!t) return null;
    const live = (mats || []).filter(m => m && m.status !== 'removed');
    const nm = m => norm(String(m.title || m.id || '').replace(/\.(pdf|docx|pptx)$/i, ''));
    return live.find(m => nm(m) === t) || live.find(m => nm(m).startsWith(t) || t.startsWith(nm(m))) || null;
  }
  /** A BM25 index over chunks (build once per page open or pipeline run). */
  function libraryIndex(chunks) {
    const docs = (chunks || []).map(c => {
      const t = libTokens(c.title + ' ' + c.text);
      const tf = new Map();
      const pairs = new Set();
      for (let i = 0; i < t.length; i++) {
        tf.set(t[i], (tf.get(t[i]) || 0) + 1);
        if (i) pairs.add(t[i - 1] + ' ' + t[i]);
      }
      return { c, tf, pairs, len: t.length, tt: new Set(libTokens(c.title)) };
    });
    const df = new Map();
    for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
    return { docs, df, n: docs.length, avg: docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length) };
  }
  /** The best passages for a query: BM25, a small title bonus, rewarded for covering more of the query, at most two per file. */
  function searchLibrary(index, query, { course, kind, id, k } = {}) {
    const seq = libTokens(query);
    const q = [...new Set(seq)];
    if (!q.length || !index) return [];
    const bigrams = [...new Set(seq.slice(1).map((w, i) => seq[i] + ' ' + w))]; // words side by side, as in "sterile gloves"
    const idfOf = w => {
      const n = index.df.get(w) || 0;
      return Math.log(1 + (index.n - n + 0.5) / (n + 0.5));
    };
    const K1 = 1.2,
      B = 0.75,
      scored = [];
    // B-42 (D-099): with no course named, a done course's passages stay out; naming it brings them back.
    const active = course || id ? null : new Set(activeCourses());
    for (const d of index.docs) {
      if (
        (course && d.c.course !== course) ||
        (active && active.size && d.c.course && !active.has(d.c.course)) ||
        (kind && d.c.kind !== kind) ||
        (id && d.c.id !== id)
      )
        continue;
      let s = 0,
        hit = 0;
      for (const w of q) {
        const f = d.tf.get(w);
        if (!f) continue;
        hit++;
        const idf = idfOf(w);
        s += (idf * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * d.len) / index.avg)) + (d.tt.has(w) ? idf * 0.5 : 0);
      }
      if (!hit) continue;
      for (const b of bigrams)
        if (d.pairs.has(b)) {
          const [x, y] = b.split(' ');
          s += 0.75 * (idfOf(x) + idfOf(y));
        }
      scored.push({ s: s * (0.4 + (0.6 * hit) / q.length), d });
    }
    scored.sort((a, b) => b.s - a.s);
    const per = new Map(),
      out = [],
      want = k || core.C.library.searchK;
    for (const { s, d } of scored) {
      const n = per.get(d.c.id) || 0;
      if (n >= 2) continue;
      per.set(d.c.id, n + 1);
      out.push({ ...d.c, text: d.c.text.slice(0, core.C.library.hitChars), score: Math.round(s * 100) / 100 });
      if (out.length >= want) break;
    }
    return out;
  }
  /** What is in the library, compact enough for a prompt or a list. */
  function libraryCatalog(materials) {
    return (materials || [])
      .filter(m => m && !isRemovedMaterial(m))
      .map(m => ({
        id: m.id,
        title: m.title || m.id,
        course: normCourse(m.course),
        kind: materialKind(m),
        module: m.module || null,
        exam: m.exam || null,
        pages: m.pages || null,
        chars: String(m.text || '').length,
        needsOcr: !!m.needsOcr && !m.ocr,
        source: m.source || null,
      }))
      .sort(
        (a, b) =>
          String(a.course).localeCompare(String(b.course)) ||
          a.kind.localeCompare(b.kind) ||
          a.title.localeCompare(b.title)
      );
  }
  /** One file's text from a page or slide on, cut at a page mark when it can be, with where to continue. */
  function readMaterial(m, { page, maxChars } = {}) {
    const max = maxChars || core.C.library.readChars;
    const t = String((m && m.text) || '');
    let from = 0;
    if (page) {
      const i = t.search(new RegExp('\\[(?:p|s|Page |Slide )' + Number(page) + '\\]'));
      if (i >= 0) from = i;
    }
    let end = Math.min(t.length, from + max);
    if (end < t.length) {
      const cut = t.slice(from, end);
      let last = -1;
      const re = /\[(?:p|s|Page |Slide )\d+\]/g;
      let x;
      while ((x = re.exec(cut))) last = x.index;
      if (last > max * 0.4) end = from + last;
    }
    const next = end < t.length ? Number((PAGE_MARK.exec(t.slice(end)) || [])[2]) || null : null;
    return {
      id: m.id,
      title: m.title || m.id,
      course: normCourse(m.course),
      kind: materialKind(m),
      pages: m.pages || null,
      text: t.slice(from, end),
      more: end < t.length,
      next,
    };
  }
  /** Which Canvas module files belong in the library (libraryRules: each course's rules in spec.courses with the shared skips). Self-contained: the Canvas fetch
   *  script embeds this exact function. */
  function libraryPick(course, modules, rules) {
    const R = rules || {};
    const out = [];
    const seen = new Set();
    const skipT = R.skipTitles ? new RegExp(R.skipTitles, 'i') : null;
    const skipS = R.skipSections ? new RegExp(R.skipSections, 'i') : null;
    const notText = /\.(mp4|m4v|mov|avi|wmv|webm|mp3|m4a|wav|xlsx?|csv|png|jpe?g|gif|zip|txt|rtf|html?|doc|ppt)$/i;
    for (const m of modules || []) {
      const rule = (R.modules || []).find(
        r => r.course === course && new RegExp(r.module, 'i').test(String(m.name || '').trim())
      );
      if (!rule) continue;
      let section = null;
      for (const it of m.items || []) {
        if (it.type === 'SubHeader') {
          section = String(it.title || '').trim();
          continue;
        }
        if (it.type !== 'File' || seen.has(it.content_id)) continue;
        const title = String(it.title || '').trim();
        if (
          (skipT && skipT.test(title)) ||
          (section && skipS && skipS.test(section)) ||
          (rule.only && !new RegExp(rule.only, 'i').test(title)) ||
          notText.test(title)
        )
          continue;
        seen.add(it.content_id);
        out.push({
          course,
          fileId: it.content_id,
          title,
          module: String(m.name || '').trim(),
          section,
          kind: rule.kind,
        });
      }
    }
    return out;
  }
  /** Text of a .docx or .pptx (a ZIP of XML) with built-ins only (DecompressionStream). `src` is the file's bytes, or
   *  {size, range(start, end)} to read only the parts it needs (a 40 MB slide deck is mostly pictures). Self-contained:
   *  the Canvas fetch script embeds it, the page uses it for uploads, node runs it in tests. Slides get [sN] marks. */
  async function officeText(src, type) {
    const ranged = !!src && typeof src.range === 'function';
    const whole = ranged ? null : src instanceof Uint8Array ? src : new Uint8Array(src);
    const size = ranged ? src.size : whole.length;
    const at = async (a, b) => {
      b = Math.min(b, size);
      return ranged ? await src.range(a, b) : whole.subarray(a, b);
    }; // bytes [a, b)
    const u16 = (u, i) => u[i] | (u[i + 1] << 8);
    const u32 = (u, i) => (u[i] | (u[i + 1] << 8) | (u[i + 2] << 16) | (u[i + 3] << 24)) >>> 0;
    const t0 = Math.max(0, size - 65558);
    const tail = await at(t0, size);
    let e = tail.length - 22;
    while (e >= 0 && u32(tail, e) !== 0x06054b50) e--;
    if (e < 0) throw new Error('not a .docx or .pptx file');
    const n = u16(tail, e + 10),
      cdSize = u32(tail, e + 12),
      cdOff = u32(tail, e + 16);
    const cd = cdOff >= t0 ? tail.subarray(cdOff - t0, cdOff - t0 + cdSize) : await at(cdOff, cdOff + cdSize);
    const dec = new TextDecoder();
    const entries = {};
    for (let i = 0, p = 0; i < n && p + 46 <= cd.length && u32(cd, p) === 0x02014b50; i++) {
      const nlen = u16(cd, p + 28);
      entries[dec.decode(cd.subarray(p + 46, p + 46 + nlen))] = {
        method: u16(cd, p + 10),
        size: u32(cd, p + 20),
        off: u32(cd, p + 42),
        nlen,
      };
      p += 46 + nlen + u16(cd, p + 30) + u16(cd, p + 32);
    }
    const read = async name => {
      const en = entries[name];
      if (!en) return '';
      let head = await at(en.off, en.off + 30 + en.nlen + 512 + en.size);
      const start = 30 + u16(head, 26) + u16(head, 28);
      if (head.length < start + en.size) head = await at(en.off, en.off + start + en.size);
      const data = head.subarray(start, start + en.size);
      if (en.method === 0) return dec.decode(data);
      return dec.decode(
        await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()
      );
    };
    const ent = s =>
      s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
        .replace(/&amp;/g, '&');
    const paras = (xml, para, run) =>
      xml
        .split(para)
        .slice(1)
        .map(seg => ent((seg.match(run) || []).map(x => x.replace(/<[^>]+>/g, '')).join('')).trim())
        .filter(Boolean);
    const kind =
      type ||
      (entries['word/document.xml']
        ? 'docx'
        : Object.keys(entries).some(k => /^ppt\/slides\/slide\d+\.xml$/.test(k))
          ? 'pptx'
          : '');
    if (kind === 'docx')
      return {
        fileType: 'docx',
        pages: null,
        text: paras(await read('word/document.xml'), /<w:p[ >]/, /<w:t(?: [^>]*)?>[^<]*<\/w:t>/g).join('\n'),
      };
    if (kind === 'pptx') {
      const slides = Object.keys(entries)
        .filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k))
        .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
      const xml = [];
      for (let i = 0; i < slides.length; i += 6) xml.push(...(await Promise.all(slides.slice(i, i + 6).map(read))));
      return {
        fileType: 'pptx',
        pages: slides.length,
        text: xml
          .map(
            (x, i) => '[s' + (i + 1) + '] ' + paras(x, /<a:p[ >]/, /<a:t(?: [^>]*)?>[^<]*<\/a:t>/g).join(' / ') + '\n'
          )
          .join(''),
      };
    }
    throw new Error('not a .docx or .pptx file');
  }
  /** Pages of a PDF with pdf.js (the caller loads it from C.library.pdfjs): [pN] text, and which pages had too little
   *  text to be more than a picture (those go to Claude to read). Self-contained apart from the pdfjs module passed in. */
  async function pdfText(pdfjs, data, { maxChars = 200000, minChars = 80 } = {}) {
    const doc = await pdfjs.getDocument({ data }).promise;
    let text = '';
    const imagePages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const t = (await (await doc.getPage(p)).getTextContent()).items
        .map(i => i.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (t.length < minChars) imagePages.push(p);
      text += '[p' + p + '] ' + t + '\n';
      if (text.length > maxChars) break;
    }
    return { fileType: 'pdf', pages: doc.numPages, text: text.slice(0, maxChars), imagePages, doc };
  }
  /** Prompt for Claude to read page images (scanned handouts, photos of a checklist), returned as JSON. */
  function ocrPrompt({ title, pages }) {
    return `These images are page${pages.length > 1 ? 's' : ''} ${pages.join(', ')} of "${title}", a nursing-school course handout or reference sheet. Transcribe all the text on each page exactly, in reading order. Keep headings on their own lines. Write tables as rows with " | " between cells, and checklists as one item per line starting with "- ". Describe a diagram in one short bracketed line only when it carries information, like [Diagram: heart sound auscultation points]. No commentary. If a page shows a real patient's name, room or record number, write [identifier removed] in its place.
Return JSON: {"pages": [{"page": <page number>, "text": "<the page's text>"}]}`;
  }
  /** Claude's page transcriptions → {pageNumber: text}, only for the pages asked for. */
  function parseOcr(out, pages) {
    const want = new Set((pages || []).map(Number));
    const r = {};
    for (const x of out && Array.isArray(out.pages) ? out.pages : []) {
      const n = Number(x && x.page);
      if (want.has(n) && x.text)
        r[n] = String(x.text)
          .replace(/[ \t]+/g, ' ')
          .trim();
    }
    return r;
  }
  /** Puts transcribed pages back into a [pN] text in place of the near-empty ones. */
  function mergeOcr(text, pagesText) {
    let t = String(text || '');
    for (const [n, body] of Object.entries(pagesText || {})) {
      const re = new RegExp('\\[p' + n + '\\][^\\[]*');
      const block = '[p' + n + '] ' + body + '\n';
      t = re.test(t) ? t.replace(re, block) : t + block;
    }
    return t;
  }
  /** The course an attached file belongs to: the first whose guess words it holds, else the default course. */
  const guessCourse = s =>
    (courseTable().find(r => r.guess && new RegExp(r.guess, 'i').test(String(s || ''))) || {}).name || defaultCourse();
  /** A file he attached in the conversation, as a materials document (text already extracted and read on the page). */
  function materialFromUpload(
    { title, text, fileType, pages, ocrPages, course, kind },
    { now, existingIds = [] } = {}
  ) {
    const at = isoOf(now);
    const t = String(text || '').trim();
    if (t.replace(/\[(?:p|s)\d+\]/g, '').trim().length < 20) throw new Error('there is no readable text in that file');
    const name = String(title || 'Upload')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    const base = safeId('up-' + chicagoDate(at) + '-' + (slug(name.replace(/\.[a-z0-9]{2,5}$/i, ''), 40) || 'file'));
    let id = base;
    for (let n = 2; existingIds.includes(id); n++) id = base + '-' + n;
    const max = core.C.library.maxChars;
    return {
      id,
      data: {
        ...envelope('page', 'upload', at),
        course: isCourse(course) ? course : guessCourse(name + ' ' + t.slice(0, 4000)),
        kind: MATERIAL_KINDS.includes(kind) ? kind : 'upload',
        title: name,
        fileType: fileType || null,
        pages: pages || null,
        chars: t.length,
        text: t.slice(0, max),
        truncated: t.length > max,
        needsOcr: false,
        ocr: ocrPages && ocrPages.length ? { by: 'Claude (E.V. Home)', at, pages: ocrPages } : null,
        addedBy: 'Matt',
      },
    };
  }

  function stripHtml(h) {
    return String(h || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;|&rsquo;/g, '’')
      .replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();
  }

  return {
    MATERIAL_KINDS,
    liveMaterials,
    materialRemove,
    materialKind,
    libStem,
    libTokens,
    normCourse,
    libraryChunks,
    citeMaterial,
    parseCite,
    citeTarget,
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
    stripHtml,
  };
}
