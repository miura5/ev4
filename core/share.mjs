// E.V. core's shareable practice pages (D-110): which sets may be shared, and the page that holds them.
// Split from core/evcore.mjs (B-160, D-166) as one factory with no imports, so the same file runs in node (evcore.mjs
// imports it) and in the page (the build writes it into core.js ahead of E.V. core). It takes the core names it uses
// and returns the names core's export map uses.

export function makeShare(core) {
  'use strict';
  const { itemType, planTasks, validItems } = core;

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
      /\bproctored\b/i.test((task.text || '') + ' ' + (set.title || ''))
    )
      return { ok: false, why: 'an exam, validation, clinical or proctored item is never shared' };
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

  return { shareableSet, sharePage };
}
