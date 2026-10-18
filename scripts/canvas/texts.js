// E.V. read-only Canvas fetch: texts. The text of the library files the files part found new or changed, read in the
// page: PDFs with pdf.js, Word and PowerPoint with E.V. core's officeText (byte ranges: the zip directory and the text
// parts, not the pictures). GET requests only. Printed by `node core/cli.mjs canvas-script texts --dir <run dir>
// --batch <n>` with the batch's files filled in.
(() => {
  const P = /*@PARAMS*/null;
  const officeText = /*@FN:officeText*/null;
  const pdfText = /*@FN:pdfText*/null;
  window.__evCanvas = window.__evCanvas || {};
  const job = window.__evCanvas[P.part] = { status: 'running', startedAt: Date.now() };
  const get = async p => {
    const r = await fetch(p, { headers: { Accept: 'application/json' }, credentials: 'same-origin', redirect: 'manual' });
    if (r.type === 'opaqueredirect' || r.status === 401) throw new Error('signed-out');
    if (!r.ok) return { error: r.status };
    return JSON.parse((await r.text()).replace(/^while\(1\);/, ''));
  };
  const run = async () => {
    const out = { part: 'texts', batch: P.batch, files: [], errors: [] };
    let pdfjs = null;
    for (const f of P.files) {
      job.at = f.title;
      try {
        const meta = await get('/api/v1/courses/' + f.courseId + '/files/' + f.fileId);
        if (!meta || meta.error || !meta.url) { out.errors.push(f.title + ': file metadata ' + JSON.stringify(meta && meta.error)); continue; }
        let r;
        if (f.fileType === 'pdf') {
          const buf = new Uint8Array(await (await fetch(meta.url, { credentials: 'same-origin' })).arrayBuffer());
          if (!pdfjs) { pdfjs = await import(P.lib.pdfjs); pdfjs.GlobalWorkerOptions.workerSrc = P.lib.pdfjsWorker; }
          r = await pdfText(pdfjs, buf, { maxChars: P.lib.maxChars, minChars: P.lib.ocrMinChars });
          try { r.doc.destroy(); } catch (e) { /* already closed */ }
          delete r.doc;
        } else {
          const size = Number(meta.size) || 0; const t0 = Math.max(0, size - 65558);
          const first = await fetch(meta.url, { credentials: 'same-origin', headers: size ? { Range: 'bytes=' + t0 + '-' + (size - 1) } : {} });
          if (first.status === 206) {
            // Each range goes through Canvas's own download link again (its redirect target is signed for one use).
            const tail = new Uint8Array(await first.arrayBuffer());
            r = await officeText({ size, range: async (a, b) => (a >= t0 ? tail.subarray(a - t0, b - t0) : new Uint8Array(await (await fetch(meta.url, { credentials: 'same-origin', headers: { Range: 'bytes=' + a + '-' + (b - 1) } })).arrayBuffer())) }, f.fileType);
          } else r = await officeText(new Uint8Array(await first.arrayBuffer()), f.fileType);
        }
        const words = r.text.replace(/\[(?:p|s)\d+\]/g, '').trim().length;
        out.files.push({ ...f, pages: r.pages, text: r.text, imagePages: r.imagePages || [], needsOcr: words < 200 });
      } catch (e) { if (String(e && e.message) === 'signed-out') throw e; out.errors.push(f.title + ': ' + ((e && e.message) || e)); }
    }
    return out;
  };
  run().then(out => { window.__evCanvas[P.part] = { status: 'done', out }; }, e => { window.__evCanvas[P.part] = { status: 'failed', error: String((e && e.message) || e) }; });
  return 'started ' + P.part;
})()
