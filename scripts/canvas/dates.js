// E.V. read-only Canvas fetch: dates. Planner items in the coming 70 days and announcements from the last 21 days, for
// the courses spec.courses names (their canvasId). GET requests to Canvas's own data endpoints only; nothing is clicked, opened,
// started, submitted or changed. Printed by `node core/cli.mjs canvas-script dates --dir <run dir>` with P filled in,
// run with javascript_tool in the signed-in Canvas tab. It starts in the background and returns at once; the poll
// script collects it (the browser tool stops waiting after 45 s).
(() => {
  const P = /*@PARAMS*/null;
  window.__evCanvas = window.__evCanvas || {};
  window.__evCanvas[P.part] = { status: 'running', startedAt: Date.now() };
  const get = async p => {
    const r = await fetch(p, { headers: { Accept: 'application/json' }, credentials: 'same-origin', redirect: 'manual' });
    if (r.type === 'opaqueredirect' || r.status === 401) throw new Error('signed-out');
    if (!r.ok) return { error: r.status };
    return JSON.parse((await r.text()).replace(/^while\(1\);/, ''));
  };
  const day = d => d.toISOString().slice(0, 10);
  const text = h => new DOMParser().parseFromString(String(h || ''), 'text/html').body.textContent.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const run = async () => {
    const now = new Date(); const ids = Object.values(P.courses);
    const out = { part: 'dates', fetchedAt: now.toISOString(), courses: P.courses, planner: [], announcements: [], knownAnnouncements: 0, errors: [] };
    const known = new Set(P.knownAnnouncements);
    const pl = await get('/api/v1/planner/items?start_date=' + day(new Date(now - 864e5)) + '&end_date=' + day(new Date(+now + 70 * 864e5)) + '&per_page=100');
    if (Array.isArray(pl)) for (const p of pl.filter(p => ids.includes(p.course_id))) out.planner.push({ plannable_id: p.plannable_id, plannable_type: p.plannable_type, course_id: p.course_id, plannable_date: p.plannable_date, plannable: p.plannable ? { title: p.plannable.title, due_at: p.plannable.due_at, todo_date: p.plannable.todo_date, points_possible: p.plannable.points_possible } : null });
    else out.errors.push('planner ' + JSON.stringify(pl));
    const an = await get('/api/v1/announcements?' + ids.map(id => 'context_codes[]=course_' + id).join('&') + '&start_date=' + day(new Date(now - 21 * 864e5)) + '&per_page=50');
    if (Array.isArray(an)) for (const a of an) { if (known.has(String(a.id))) { out.knownAnnouncements++; continue; } out.announcements.push({ id: a.id, title: a.title, text: text(a.message).slice(0, 4000), posted_at: a.posted_at, context_code: a.context_code, html_url: a.html_url }); }
    else out.errors.push('announcements ' + JSON.stringify(an));
    return out;
  };
  run().then(out => { window.__evCanvas[P.part] = { status: 'done', out }; }, e => { window.__evCanvas[P.part] = { status: 'failed', error: String((e && e.message) || e) }; });
  return 'started ' + P.part;
})()
