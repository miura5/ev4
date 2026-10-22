    // ---------------------------------------------------------------- library: course materials (D-079)
    // Canvas files (the evening run) and his uploads, loaded on first use because the texts are large, searched with
    // EVCore's library functions. The attach button reads a file on this page and saves its text as materials/up-….
    const LIBC = E.constants().library;
    const LIB = { mats: null, idx: null, loading: null };
    const MAT_KIND = {
      slides: 'slides',
      lab: 'lab',
      clinical: 'clinical',
      course: 'course info',
      handout: 'handout',
      upload: 'your upload',
    };
    // LIB.raw: every materials/<id> as stored; LIB.mats: the library as he sees it, removals from materialedits merged in.
    function libraryLoaded(raw) {
      LIB.raw = raw;
      LIB.mats = E.liveMaterials(raw, S.materialedits).map(m => ({
        ...m,
        source:
          /^up-/.test(m.id) || m.kind === 'upload'
            ? 'upload'
            : m.writer === 'canvas-sync' || /^[A-Z]+\d*-\d+$/.test(m.id)
              ? 'Canvas'
              : m.source,
      }));
      LIB.idx = E.libraryIndex(E.libraryChunks(LIB.mats));
      LIB.edits = S.materialedits;
      return LIB;
    }
    function library() {
      if (LIB.mats) {
        if (LIB.edits !== S.materialedits) libraryLoaded(LIB.raw);
        return Promise.resolve(LIB);
      }
      if (!LIB.loading)
        LIB.loading = db
          .collection('materials')
          .get()
          .then(
            snap => {
              const l = libraryLoaded(docs(snap));
              render();
              return l;
            },
            e => {
              LIB.loading = null;
              throw e;
            }
          );
      return LIB.loading;
    }
    function libraryPut(m) {
      T.uploads.set(m.id, m);
      if (LIB.raw) {
        const raw = LIB.raw.filter(x => x.id !== m.id);
        raw.push(m);
        libraryLoaded(raw);
      }
      render();
    }
    const matById = id => T.uploads.get(id) || (LIB.mats || []).find(m => m.id === id) || null;
    const unitWord = (m, n) =>
      plural(
        n,
        m.fileType === 'pptx' || (E.materialKind(m) === 'slides' && /\.pptx$/i.test(m.title || '')) ? 'slide' : 'page'
      );
    const matMeta = m =>
      [
        E.normCourse(m.course),
        MAT_KIND[E.materialKind(m)],
        m.pages ? unitWord(m, m.pages) : '',
        m.source === 'upload' ? 'added by you' : m.source === 'Canvas' ? 'Canvas' : '',
        m.needsOcr && !m.ocr ? 'image-only, not read yet' : m.ocr ? 'read from images' : '',
      ]
        .filter(Boolean)
        .join(' · ');
    async function removeUpload(m) {
      // materials are Facts: taking one out of the library is its materialedits/<id> (kept, so it can come back)
      const ed = S.materialedits.find(x => x.id === m.id) || null;
      await write({
        op: 'set',
        collection: 'materialedits',
        id: m.id,
        data: E.materialRemove(ed, { now: now(), by: 'Matt' }),
      });
      T.uploads.delete(m.id);
    }
    let PDFJS = null;
    async function pdfLib() {
      if (!PDFJS) {
        PDFJS = await import(LIBC.pdfjs);
        PDFJS.GlobalWorkerOptions.workerSrc = LIBC.pdfjsWorker;
      }
      return PDFJS;
    }
    async function pdfPageImage(doc, n) {
      // one PDF page as a JPEG for Claude to read
      const page = await doc.getPage(n);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(2.2, 1600 / Math.max(v1.width, v1.height)) });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: vp }).promise;
      return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
    }
    async function readImages(title, pages, imageOf, caps) {
      // Claude reads page images (scanned handouts, photos): {page: text}
      const per = Math.max(1, Math.min(4, (caps.images && caps.images.maxCount) || 1));
      const got = {};
      for (let i = 0; i < pages.length; i += per) {
        const batch = pages.slice(i, i + per);
        const images = [];
        for (const n of batch) images.push(await imageOf(n));
        Object.assign(
          got,
          E.parseOcr(
            await sample.json(E.ocrPrompt({ title, pages: batch }), { images, modelTier: 'default', cache: false }),
            batch
          )
        );
      }
      return got;
    }
    function fileKind(f) {
      const name = String(f.name || '');
      const ext = ((name.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
      if (ext === 'pdf' || f.type === 'application/pdf') return 'pdf';
      if (ext === 'docx' || ext === 'pptx') return ext;
      if (['txt', 'md'].includes(ext) || /^text\//.test(f.type || '')) return 'text';
      if (/^image\//.test(f.type || '') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(ext)) return 'image';
      return null;
    }
    async function attachFile(f) {
      if (!f) return;
      if (T.busy || T.reading) {
        toast('One thing at a time: wait for E.V. to finish, then attach it.');
        return;
      }
      const name = String(f.name || 'file')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      const type = fileKind(f);
      if (!type) {
        await evSay(
          `I can read PDF, Word (.docx), PowerPoint (.pptx), text files and photos. **${name}** isn't one of those.`,
          []
        );
        return;
      }
      if (f.size > 60e6) {
        await evSay(
          `**${name}** is ${Math.round(f.size / 1e6)} MB, more than I can read here (60 MB is the limit).`,
          []
        );
        return;
      }
      T.bigCore = false;
      await mattSay(`Attached **${name}**`);
      const id = msgId('e');
      T.local.set(id, {
        id,
        role: 'ev',
        text: `Reading **${name}**…`,
        cards: [],
        at: now(),
        pending: true,
        day: today,
      });
      T.scrollTo = id;
      T.reading = true;
      render();
      const finish = (text, cards = []) => {
        T.reading = false;
        return postMsg({ id, role: 'ev', text, cards, at: now(), tier: 'local' });
      };
      try {
        const caps = sample && !T.sampleOff ? await sample.limits().catch(() => null) : null;
        const canSee = !!(caps && caps.images);
        const bytes = new Uint8Array(await f.arrayBuffer());
        let r = { text: '', pages: null };
        let ocrPages = [];
        let unread = [];
        if (type === 'pdf') {
          r = await E.pdfText(await pdfLib(), bytes, { maxChars: LIBC.maxChars, minChars: LIBC.ocrMinChars });
          const want = r.imagePages.slice(0, 20);
          unread = r.imagePages.slice(20);
          if (want.length && canSee) {
            const got = await readImages(name, want, n => pdfPageImage(r.doc, n), caps);
            r.text = E.mergeOcr(r.text, got);
            ocrPages = Object.keys(got).map(Number);
            unread = unread.concat(want.filter(n => !got[n]));
          } else if (want.length) unread = r.imagePages;
          try {
            r.doc.destroy();
          } catch (e) {}
        } else if (type === 'docx' || type === 'pptx') r = await E.officeText(bytes, type);
        else if (type === 'text') r = { text: new TextDecoder().decode(bytes), pages: null };
        else {
          if (!canSee)
            return finish(
              `I can't read photos in this view, so I didn't save **${name}**. A PDF or Word file works anywhere.`
            );
          const got = await readImages(name, [1], async () => f, caps);
          r = { text: got[1] ? '[p1] ' + got[1] + '\n' : '', pages: 1 };
          ocrPages = got[1] ? [1] : [];
        }
        // B-197: a value that could be an identifier is looked at with the words around it (a case study's client is
        // practice and stays); one that could be a real patient's is left out of what is saved, and the rest is kept.
        const g = await idGate(r.text, {
          ref: 'materials/upload',
          strict: false,
          context: 'A course file Matt attached: ' + name,
        });
        const leftOut = g.ok ? 0 : g.held.length;
        if (leftOut) r = { ...r, text: g.left };
        const existingIds = [...(LIB.mats || []).map(m => m.id), ...T.uploads.keys()];
        const u = E.materialFromUpload(
          { title: name, text: r.text, fileType: type === 'text' ? 'text' : type, pages: r.pages, ocrPages },
          { now: now(), existingIds }
        );
        await write({ op: 'set', collection: 'materials', id: u.id, data: u.data });
        libraryPut({ id: u.id, ...u.data, source: 'upload' });
        const bits = [
          u.data.course,
          r.pages ? unitWord(u.data, r.pages) : '',
          ocrPages.length ? plural(ocrPages.length, 'page') + ' read from images' : '',
        ]
          .filter(Boolean)
          .join(' · ');
        const gaps = unread.length
          ? ` I couldn't read ${plural(unread.length, 'page')} that ${unread.length > 1 ? 'are' : 'is'} only a picture${canSee ? '' : ' (reading pictures isn’t available in this view)'}.`
          : '';
        const held = leftOut
          ? ` I left out ${leftOut === 1 ? 'one detail' : leftOut + ' details'} that could be a real patient’s.`
          : '';
        return finish(
          `Saved **${name}** to your library (${bits}).${gaps}${held} Ask me anything about it, or say "quiz me on it".`,
          [{ type: 'material', id: u.id }]
        );
      } catch (e) {
        return finish(`I couldn't read **${name}**: ${(e && (e.message || e.code)) || 'error'}. Nothing was saved.`);
      }
    }
    $('ev-attach').addEventListener('click', () => $('ev-file').click());
    $('ev-file').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      attachFile(f);
    });
    {
      const pane = $('p-ev');
      let depth = 0;
      pane.addEventListener('dragenter', e => {
        if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
          depth++;
          pane.classList.add('drop');
        }
      });
      pane.addEventListener('dragleave', () => {
        depth = Math.max(0, depth - 1);
        if (!depth) pane.classList.remove('drop');
      });
      pane.addEventListener('dragover', e => {
        if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault();
      });
      pane.addEventListener('drop', e => {
        if (!e.dataTransfer || !e.dataTransfer.files.length) return;
        e.preventDefault();
        depth = 0;
        pane.classList.remove('drop');
        attachFile(e.dataTransfer.files[0]);
      });
    }
    function renderLibrary() {
      const box = $('library');
      if (!box) return;
      if (!LIB.mats) {
        $('lib-count').textContent = '';
        box.replaceChildren(empty(LIB.loading ? 'Loading your library…' : 'Opening your library…'));
        if (ui.record === 'library' && !LIB.loading)
          library().catch(e => {
            box.replaceChildren(empty('Couldn’t load the library: ' + ((e && (e.code || e.message)) || 'error')));
          });
        return;
      }
      const cat = E.libraryCatalog(LIB.mats);
      $('lib-count').textContent = plural(cat.length, 'file');
      const order = E.courses();
      const rows = [];
      for (const c of [...order, ...new Set(cat.map(x => x.course).filter(x => !order.includes(x)))]) {
        const mine = cat.filter(x => x.course === c);
        if (!mine.length) continue;
        rows.push(el('li', 'row daysep-row', c));
        for (const x of mine) {
          const m = matById(x.id) || x;
          rows.push(
            row({
              title: x.title.replace(/\.(pdf|docx|pptx)$/i, ''),
              detail: matMeta(m),
              chips: [[MAT_KIND[x.kind] || x.kind, x.kind === 'lab' ? 'ok' : x.kind === 'upload' ? 'plum' : '']],
              action:
                m.source === 'upload'
                  ? btn('Remove', ev => guard(ev.target, () => removeUpload(m), 'Removed from your library'))
                  : null,
            })
          );
        }
      }
      box.replaceChildren(
        ...(rows.length
          ? rows
          : [empty('Nothing yet. The evening run brings your Canvas files; attach your own in the conversation.')])
      );
    }

