// E.V. read-only Canvas fetch: files. Which module files belong in the library (each course's library in spec.courses, through
// E.V. core's own libraryPick, filled in below) and each one's metadata: name, type, size, last update. Nothing is
// downloaded here. GET requests only. Printed by `node core/cli.mjs canvas-script files --dir <run dir>`.
(() => {
  const P = /*@PARAMS*/null;
  const libraryPick = /*@FN:libraryPick*/null;
  window.__evCanvas = window.__evCanvas || {};
  const job = window.__evCanvas[P.part] = { status: 'running', startedAt: Date.now() };
  const get = async p => {
    const r = await fetch(p, { headers: { Accept: 'application/json' }, credentials: 'same-origin', redirect: 'manual' });
    if (r.type === 'opaqueredirect' || r.status === 401) throw new Error('signed-out');
    if (!r.ok) return { error: r.status };
    return JSON.parse((await r.text()).replace(/^while\(1\);/, ''));
  };
  const run = async () => {
    const out = { part: 'files', files: [], notText: 0, errors: [] };
    for (const [course, cid] of Object.entries(P.courses)) {
      const mods = await get('/api/v1/courses/' + cid + '/modules?include[]=items&per_page=100');
      if (!Array.isArray(mods)) { out.errors.push('modules ' + course + ' ' + JSON.stringify(mods)); continue; }
      for (const f of libraryPick(course, mods, P.rules)) {
        job.at = f.title;
        const meta = await get('/api/v1/courses/' + cid + '/files/' + f.fileId);
        if (!meta || meta.error) { out.errors.push('file ' + f.fileId + ' ' + JSON.stringify(meta)); continue; }
        const name = meta.display_name || f.title; const ct = meta['content-type'] || '';
        const fileType = /pdf/i.test(ct) || /\.pdf$/i.test(name) ? 'pdf' : /wordprocessingml/i.test(ct) || /\.docx$/i.test(name) ? 'docx' : /presentationml/i.test(ct) || /\.pptx$/i.test(name) ? 'pptx' : null;
        if (!fileType) { out.notText++; continue; }
        out.files.push({ ...f, courseId: cid, title: name, fileType, size: meta.size || null, updatedAt: meta.updated_at || '' });
      }
    }
    return out;
  };
  run().then(out => { window.__evCanvas[P.part] = { status: 'done', out }; }, e => { window.__evCanvas[P.part] = { status: 'failed', error: String((e && e.message) || e) }; });
  return 'started ' + P.part;
})()
