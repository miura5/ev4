// B-285 (D-274, D-269, C-1, C-15): the component set, rendered on its own sheet from the built stylesheet and
// the theme generator, at 390 and 1280 in light and dark at contrast 60, with a screenshot of each. It checks what the
// set promises every view: a row is 32 px from 600 px and 44 px on the phone; the screen-reader tree names the picked
// option of every segmented switch; coded yellow is D-269's L52 C54 (light) and L72 C48 (dark) at hue 82, read back
// from the page, not from the generator; the words on a badge and a tint button hold 4.5:1 on their own tint. B-357
// (D-315): the five-kinds, one-primary and no-close-button checks are retired with the old UI tenets.
//   node test/harness/components.cjs [record dir | synthetic] [screenshots dir] [target]
// The record argument is accepted so check.mjs can call every harness alike; the sheet reads no record.
// Run `node tools/build.mjs` first. Exit code 1 when any check fails.
const fs = require('fs');
const path = require('path');
const { rgb, ratio } = require('./contrast.cjs');

/** sRGB [r,g,b] to CIE LCh (D50, as the generator's lch2hex runs the other way), so the check does not trust it. */
function lchOf([r, g, b]) {
  const lin = v => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [r, g, b].map(lin);
  // linear sRGB to XYZ D50 (Bradford-adapted)
  const X = 0.4360747 * R + 0.3850649 * G + 0.1430804 * B,
    Y = 0.2225045 * R + 0.7168786 * G + 0.0606169 * B,
    Z = 0.0139322 * R + 0.0971045 * G + 0.7141733 * B;
  const e = 216 / 24389,
    k = 24389 / 27;
  const f = t => (t > e ? Math.cbrt(t) : (k * t + 16) / 116);
  const fx = f(X / 0.96422),
    fy = f(Y),
    fz = f(Z / 0.82521);
  const L = 116 * fy - 16,
    a = 500 * (fx - fy),
    bb = 200 * (fy - fz);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C: Math.hypot(a, bb), H };
}
/** D-269's yellow in one theme, with the rounding an 8-bit hex allows. */
const YELLOW = { light: { L: 52, C: 54, H: 82 }, dark: { L: 72, C: 48, H: 82 } };
function judgeYellow(color, mode) {
  const c = rgb(color),
    want = YELLOW[mode];
  if (!c) return { ok: false, detail: `${mode}: yellow is not a solid colour (${color})` };
  const got = lchOf(c);
  const ok = Math.abs(got.L - want.L) <= 0.6 && Math.abs(got.C - want.C) <= 1 && Math.abs(got.H - want.H) <= 1;
  return {
    ok,
    detail: `${mode}: ${color} reads L${got.L.toFixed(1)} C${got.C.toFixed(1)} H${got.H.toFixed(1)}; D-269 says L${want.L} C${want.C} H${want.H}`,
  };
}

/** The sheet: every part, in three small views (a list view, a form view, a composer view), each with one primary. */
function sheet() {
  const ico = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
  const colours = ['green', 'yellow', 'red', 'blue', 'violet'];
  const seg = (id, label, opts, picked) =>
    `<div class="seg" id="${id}" role="group" aria-label="${label}">${opts.map(o => `<button type="button" aria-pressed="${o === picked}">${o}</button>`).join('')}</div>`;
  const row = (nm, badge, t) =>
    `<div class="li"><span class="nm">${nm}</span>${badge}<span class="t">${t}</span><button type="button" class="btn ghost sm hov">Open</button></div>`;
  return `
<main class="cs">
<section class="cs-view" data-view="list" aria-label="A list view">
  <div class="toolbar">${seg('seg-a', 'Views', ['Objectives', 'Plan', 'Weak spots'], 'Objectives')}<span class="sp"></span><button type="button" class="btn neutral">Course</button><button type="button" class="btn primary">Start session</button></div>
  <div class="cs-list">
    ${row('Fluid and electrolyte balance', '<span class="badge x-green">Solid</span>', '9:00')}
    ${row('IV rates and drop factors', '<span class="badge x-yellow">Almost</span>', '9:30')}
    ${row('Fundamentals exam', '<span class="badge x-red">Due tomorrow</span>', '10:00')}
    ${row('Sodium and potassium review', '<span class="badge proposed">Proposed</span>', '10:45')}
    ${row('ATI Engage: Nutrition', '<span class="badge">Graded</span>', '11:30')}
    ${row('A long name that has to give way to its badge and its time on a narrow phone', '<span class="badge x-blue">Info</span>', '12:15')}
    ${row('Pathophysiology reading', '<span class="badge x-violet">Study</span>', '1:00')}
  </div>
</section>
<section class="cs-view" data-view="parts" aria-label="Buttons, cards and bars">
  <div class="toolbar">${seg('seg-b', 'Period', ['Week', 'Month'], 'Month')}<span class="sp"></span><button type="button" class="btn primary sm">Accept all</button></div>
  <div class="cs-grid">
    <div class="ui-card"><h3>Buttons</h3><div class="cs-row">
      <button type="button" class="btn neutral">Neutral</button><button type="button" class="btn ghost">Ghost</button>
      <button type="button" class="btn icon" aria-label="Done">${ico}</button><button type="button" class="btn neutral icon" aria-label="Done, outlined">${ico}</button>
      <button type="button" class="btn neutral sm">Small</button><button type="button" class="btn ghost sm">Small ghost</button><button type="button" class="btn icon sm" aria-label="Done, small">${ico}</button>
      <button type="button" class="btn neutral" disabled>Disabled</button>
    </div><div class="cs-row">${colours.map(c => `<button type="button" class="btn tint x-${c}">${ico}${c[0].toUpperCase() + c.slice(1)}</button>`).join('')}</div></div>
    <div class="ui-card"><h3>Progress</h3>
      <div class="pbar" role="progressbar" aria-label="Done" aria-valuenow="60"><i style="width:60%"></i></div>
      <div class="pbar x-yellow" role="progressbar" aria-label="Almost" aria-valuenow="35"><i style="width:35%"></i></div>
      ${seg('seg-c', 'Contrast', ['30', '60', '100'], '60')}
    </div>
  </div>
</section>
<section class="cs-view" data-view="composer" aria-label="The composer">
  <form class="field" onsubmit="return false"><input type="text" aria-label="Message E.V." placeholder="Ask E.V., or tell it something to log"><button type="submit" class="btn primary icon send" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg></button></form>
</section>
</main>`;
}
const SHEET_CSS =
  '.cs{display:flex;flex-direction:column;gap:20px;max-width:900px;margin:0 auto;padding:20px 0}' +
  '.cs-view{border-radius:12px;background:var(--bg);box-shadow:0 0 0 1px var(--line);overflow:hidden}' +
  '.cs-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;padding:12px}' +
  '.cs-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.cs-view[data-view=composer]{padding:12px}';

module.exports = { lchOf, judgeYellow, sheet };

if (require.main === module) {
  const { chromium } = require('playwright');
  const root = path.resolve(__dirname, '../..');
  const shots = process.argv[3] || '/tmp/ev4-components';
  fs.mkdirSync(shots, { recursive: true });
  const target = process.argv[4] || 'staging';
  const styles = fs.readFileSync(path.join(root, 'dist/page', target, 'styles.css'), 'utf8');
  const theme = fs.readFileSync(path.join(root, 'page/theme.js'), 'utf8');
  const results = [];
  const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
  const html = mode =>
    `<!doctype html><html data-theme="${mode}"><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><style>${styles}</style><style>${SHEET_CSS}</style><script>${theme}</script></head><body>${sheet()}</body></html>`;
  (async () => {
    const browser = await chromium
      .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
      .catch(() => chromium.launch());
    for (const mode of ['light', 'dark'])
      for (const [w, h] of [
        [390, 844],
        [1280, 900],
      ]) {
        const tag = `[${w} ${mode}]`;
        const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: mode });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.setContent(html(mode));
        await page.screenshot({ path: path.join(shots, `components-${w}-${mode}.png`), fullPage: true });
        ok(`${tag} the sheet renders with no page error`, !errors.length, errors.join('; '));
        const got = await page.evaluate(() => ({
          contrast: document.documentElement.getAttribute('data-contrast'),
          rows: [...document.querySelectorAll('.li')].map(r => Math.round(r.getBoundingClientRect().height * 10) / 10),
          yellow: getComputedStyle(document.documentElement).getPropertyValue('--sem-yellow').trim(),
          yellowDot: getComputedStyle(document.querySelector('.badge.x-yellow'), '::before').backgroundColor,
          words: [...document.querySelectorAll('.badge, button.btn.tint, button.btn.neutral, button.btn.primary')]
            .filter(e => !e.disabled)
            .map(e => {
              // computed colours may come back as color(srgb ...) from color-mix: read them as the canvas paints them
              const cx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d');
              const solid = c => {
                cx.clearRect(0, 0, 1, 1);
                cx.fillStyle = c;
                cx.fillRect(0, 0, 1, 1);
                const [r, g, b] = cx.getImageData(0, 0, 1, 1).data;
                return `rgb(${r}, ${g}, ${b})`;
              };
              const s = getComputedStyle(e);
              return {
                label: e.textContent.trim() || e.getAttribute('aria-label'),
                fg: solid(s.color),
                bg: solid(s.backgroundColor),
              };
            }),
          tall: [...document.querySelectorAll('button.btn, .seg button')]
            .filter(b => b.getBoundingClientRect().height < 44)
            .map(b => b.textContent.trim() || b.getAttribute('aria-label')),
        }));
        ok(`${tag} the generator runs at contrast 60`, got.contrast === null, `data-contrast ${got.contrast}`);
        const want = w < 600 ? 44 : 32;
        ok(
          `${tag} C-1: every row measures ${want} px`,
          got.rows.length === 7 && got.rows.every(x => x === want),
          got.rows.join(', ')
        );
        if (w < 600)
          ok(
            `${tag} every button and switch segment is a 44 px target on the phone`,
            !got.tall.length,
            got.tall.join(', ')
          );
        const y = judgeYellow(got.yellow, mode);
        ok(`${tag} D-285: yellow is D-269's`, y.ok, y.detail);
        ok(
          `${tag} the yellow badge's dot is that yellow`,
          JSON.stringify(rgb(got.yellowDot)) === JSON.stringify(rgb(got.yellow)),
          `${got.yellowDot} vs ${got.yellow}`
        );
        const low = got.words
          .map(x => ({ ...x, r: rgb(x.fg) && rgb(x.bg) ? ratio(rgb(x.fg), rgb(x.bg)) : 0 }))
          .filter(x => x.r < 4.5);
        ok(
          `${tag} the words on every badge and button hold 4.5:1 on their own ground`,
          !low.length,
          low.map(x => `${x.label} ${x.r.toFixed(2)}:1`).join('; ')
        );
        // C-15: the accessibility tree, as a screen reader gets it: each switch names exactly its picked option.
        for (const id of await page.$$eval('.seg', s => s.map(x => x.id))) {
          const tree = await page.locator('#' + id).ariaSnapshot();
          const picked = await page.$eval(
            '#' + id,
            s => (s.querySelector('[aria-pressed="true"],[aria-checked="true"]') || {}).textContent
          );
          const named = [...tree.matchAll(/button "([^"]+)" \[(?:pressed|checked)\]/g)].map(m => m[1]);
          ok(
            `${tag} C-15: the screen-reader tree names ${id}'s picked option`,
            named.length === 1 && named[0] === picked,
            `picked ${picked}; tree: ${tree.replace(/\n/g, ' | ')}`
          );
        }
        await page.close();
      }
    await browser.close();
    for (const [s, n, d] of results) console.log(`${s}  ${n}${s === 'FAIL' && d ? ' :: ' + d : ''}`);
    const failed = results.filter(r => r[0] === 'FAIL').length;
    console.log(`\n${results.length - failed}/${results.length} passed; screenshots in ${shots}`);
    process.exit(failed ? 1 : 0);
  })().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
