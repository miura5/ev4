// B-285 (D-274, D-269, C-1, C-15), B-506 (D-383): the Gallery's harness. It opens the Gallery (/gallery on staging,
// page/app/89-gallery.js) over the built page with the record stubbed (stub.js, the synthetic record) at 390 and 1280 in
// light and dark, takes one screenshot per section, and asserts what Proprietary promises every view: every control is
// a 44 px target on the phone; every text holds 4.5:1 on the ground it is painted on (disabled controls aside); the
// component set's rows are 32 px from 600 px and 44 px on the phone; a control reached by Tab shows a visible focus
// ring; nothing scrolls sideways; reduced motion zeroes every duration. It keeps B-285's checks: the screen-reader tree
// names the picked option of every switch; coded yellow is D-269's L52 C54 (light) and L72 C48 (dark) at hue 82, read
// back from the page; the words on a badge and a button hold 4.5:1 on their own tint. And the Gallery is absent on live:
// live's /gallery opens the app with no Gallery, and live's app.js and styles.css carry none of it.
//   node test/harness/components.cjs [record dir | synthetic] [screenshots dir] [target]
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

module.exports = { lchOf, judgeYellow };

// The page as the look pass serves it (look.cjs): the host's skeleton around the built shell, files from dist.
const skeleton = body =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  body +
  '</body></html>';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html' };
const SECTIONS = ['tuner', 'colour', 'type', 'space', 'motion', 'components', 'patterns'];

/** In the page: what every check reads, from the open Gallery. */
function measure() {
  const g = document.getElementById('gallery');
  const cx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d');
  // a computed colour (rgb, rgba or color(srgb ...) from color-mix) as [r, g, b, a], read as the canvas paints it
  const rgba = c => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#000';
    cx.fillStyle = c;
    const a = cx.fillStyle; // normalised
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255, a];
  };
  const over = (top, under) => [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  // the ground an element is painted on: its own and its ancestors' backgrounds, composed down to the page's
  const ground = e => {
    const layers = [];
    for (let x = e; x; x = x.parentElement) {
      const c = rgba(getComputedStyle(x).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let base = rgba(getComputedStyle(document.documentElement).backgroundColor);
    if (base[3] < 1) base = [255, 255, 255, 1];
    return layers.reverse().reduce((u, t) => over(t, u), layers.length && layers[0][3] >= 1 ? [0, 0, 0, 1] : base);
  };
  const lum = c => {
    const f = v => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const shown = e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  };
  const name = e =>
    (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 48);
  // text: every element with its own words
  const low = [];
  let texts = 0;
  const lowToday = [];
  for (const e of g.querySelectorAll('*')) {
    if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    if (!shown(e) || e.closest(':disabled,[aria-disabled="true"]')) continue;
    texts++;
    const bg = ground(e);
    const fg = over(rgba(getComputedStyle(e).color), bg);
    const r = ratio(fg, bg);
    if (r < 4.5) (e.closest('[data-state="today"]') ? lowToday : low).push(name(e) + ' ' + r.toFixed(2) + ':1');
  }
  // tap targets: every control a finger can reach
  const controls = [
    ...g.querySelectorAll('button,input,select,textarea,a[href],[role=button],[tabindex]:not([tabindex="-1"])'),
  ]
    .filter(e => shown(e) && !e.closest('[aria-hidden="true"]'))
    .map(e => {
      const r = e.getBoundingClientRect();
      return {
        name: name(e),
        w: Math.round(r.width),
        h: Math.round(r.height),
        today: !!e.closest('[data-state="today"]'),
      };
    });
  const lines = [...g.querySelectorAll('[data-slot="line"] .gal-set > [data-ui="line"]')].map(
    r => Math.round(r.getBoundingClientRect().height * 10) / 10
  );
  const yb = g.querySelector('[data-slot="badge"] [data-ui="badge"][data-tone="warn"]');
  const words = [
    ...g.querySelectorAll('[data-slot="badge"] [data-ui="badge"], [data-slot="button"] [data-ui="button"]'),
  ]
    .filter(e => !e.disabled)
    .map(e => {
      const s = getComputedStyle(e);
      const bg = over(rgba(s.backgroundColor), ground(e.parentElement));
      return { label: name(e), r: ratio(over(rgba(s.color), bg), bg) };
    })
    .filter(x => x.r < 4.5)
    .map(x => x.label + ' ' + x.r.toFixed(2) + ':1');
  const root = getComputedStyle(document.documentElement);
  return {
    sections: [...g.querySelectorAll('[data-gal-sec]')].map(s => s.dataset.galSec),
    slots: [...g.querySelectorAll('[data-slot]')].map(s => s.dataset.slot + ':' + s.dataset.state),
    texts,
    low,
    lowToday,
    controls,
    lines,
    yellow: root.getPropertyValue('--sem-yellow').trim(),
    yellowDot: yb ? getComputedStyle(yb, '::before').backgroundColor : '',
    words,
    sideways: g.scrollWidth > g.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
    durs: ['--dur-1', '--dur-2', '--dur-3', '--dur-4', '--dur-5'].map(d => root.getPropertyValue(d).trim()),
  };
}
/** In the page: whether the control Tab just reached shows a ring: an outline of 1 px or more, or a shadow on it or on
 *  the box around it (the composer's field draws its ring on :focus-within) that it lacks unfocused. It puts the focus
 *  back where Tab left it, so the next Tab goes on from there. */
function ringOf() {
  const e = document.activeElement;
  if (!e || !e.closest('#gallery')) return null;
  const look = () =>
    [e, e.parentElement].map(x => {
      const s = getComputedStyle(x);
      return [s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1 ? s.outlineWidth : '', s.boxShadow];
    });
  const on = look();
  e.blur();
  const off = look();
  e.focus(); // after a key, a focus by script is focus-visible too
  const label = (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 40);
  const ring = !!on[0][0] || on.some((x, i) => x[1] !== off[i][1]);
  return { label, ring };
}

if (require.main === module) {
  const { chromium } = require('playwright');
  const root = path.resolve(__dirname, '../..');
  const dbDir = require('../data/synthetic.cjs').recordDir(process.argv[2]);
  const shots = process.argv[3] || '/tmp/ev4-components';
  fs.mkdirSync(shots, { recursive: true });
  const target = process.argv[4] || 'staging';
  const ORIGIN = 'https://ev.local';
  const seed = {};
  for (const c of fs.readdirSync(dbDir)) {
    const p = path.join(dbDir, c);
    if (!fs.statSync(p).isDirectory() || ['system', 'legacy', 'debug', 'journal'].includes(c)) continue;
    seed[c] = {};
    for (const f of fs.readdirSync(p))
      if (f.endsWith('.json')) seed[c][f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8'));
  }
  const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
  const results = [];
  const notes = [];
  const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
  async function open(browser, dir, w, h, mode, extra = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: mode, ...extra });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.route(ORIGIN + '/**', r => {
      const name = new URL(r.request().url()).pathname.replace(/^\//, '') || 'index.html';
      if (name === 'index.html' || name === 'gallery')
        return r.fulfill({
          body: skeleton(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')),
          contentType: 'text/html',
        });
      const f = path.join(dir, name);
      return fs.existsSync(f)
        ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' })
        : r.fulfill({ status: 404, body: 'not published' });
    });
    await page.addInitScript('window.__db=' + JSON.stringify(seed) + ';' + stub);
    await page.goto(ORIGIN + '/gallery');
    await page
      .waitForFunction(() => document.querySelector('#thread .msg.ev'), null, { timeout: 5000 })
      .catch(() => {});
    await page.waitForSelector('#gallery .gal-main', { timeout: 3000 }).catch(() => {});
    return { ctx, page, errors };
  }
  (async () => {
    const browser = await chromium
      .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
      .catch(() => chromium.launch());
    const dir = path.join(root, 'dist/page', target);
    for (const mode of ['light', 'dark'])
      for (const [w, h] of [
        [390, 844],
        [1280, 900],
      ]) {
        const tag = `[${w} ${mode}]`;
        const { ctx, page, errors } = await open(browser, dir, w, h, mode);
        const got = await page.evaluate(measure).catch(e => ({ error: e.message }));
        ok(
          `${tag} the Gallery opens at /gallery with no page error`,
          !errors.length && !got.error && got.sections,
          errors.concat(got.error || []).join('; ')
        );
        if (!got.sections) {
          await ctx.close();
          continue;
        }
        ok(
          `${tag} it holds its seven sections`,
          JSON.stringify(got.sections) === JSON.stringify(SECTIONS),
          got.sections.join(', ')
        );
        ok(`${tag} D-383: a slot for each of the 16 components`, got.slots.length === 16, got.slots.join(', '));
        ok(`${tag} nothing scrolls sideways`, !got.sideways);
        ok(
          `${tag} D-273: every text holds 4.5:1 on its ground (${got.texts} read)`,
          got.texts > 200 && !got.low.length,
          got.low.join('; ')
        );
        if (got.lowToday.length)
          notes.push(
            `${tag} today's versions under 4.5:1, for B-507 and B-508 to fix: ` + [...new Set(got.lowToday)].join('; ')
          );
        if (w < 600) {
          const small = got.controls.filter(c => c.h < 44 || c.w < 44);
          const held = small.filter(c => !c.today);
          ok(
            `${tag} D-383: every control is a 44 px target on the phone (${got.controls.length} measured)`,
            got.controls.length > 30 && !held.length,
            held.map(c => `${c.name} ${c.w}x${c.h}`).join('; ')
          );
          const today = small.filter(c => c.today);
          if (today.length)
            notes.push(
              `${tag} today's versions under 44 px, for B-507 and B-508 to fix: ` +
                [...new Set(today.map(c => `${c.name} ${c.w}x${c.h}`))].join('; ')
            );
        }
        const want = w < 600 ? 44 : 32;
        ok(
          `${tag} C-1: every row of the set measures ${want} px`,
          got.lines.length === 7 && got.lines.every(x => x === want),
          got.lines.join(', ')
        );
        const y = judgeYellow(got.yellow, mode);
        ok(`${tag} D-285: yellow is D-269's`, y.ok, y.detail);
        ok(
          `${tag} the yellow badge's dot is that yellow`,
          JSON.stringify(rgb(got.yellowDot)) === JSON.stringify(rgb(got.yellow)),
          `${got.yellowDot} vs ${got.yellow}`
        );
        ok(
          `${tag} the words on every badge and button hold 4.5:1 on their own ground`,
          !got.words.length,
          got.words.join('; ')
        );
        // C-15: each switch names exactly its picked option, as a screen reader gets it
        const segs = page.locator('#gallery .seg');
        const nSeg = await segs.count();
        let named = 0;
        for (let i = 0; i < nSeg; i++) {
          const s = segs.nth(i);
          if (!(await s.isVisible())) continue;
          const tree = await s.ariaSnapshot();
          const picked = await s.evaluate(x => (x.querySelector('[aria-pressed="true"]') || {}).textContent);
          const names = [...tree.matchAll(/button "([^"]+)" \[pressed\]/g)].map(m => m[1]);
          if (names.length === 1 && names[0] === picked) named++;
          else
            ok(
              `${tag} C-15: a switch names its picked option`,
              false,
              `picked ${picked}; tree: ${tree.replace(/\n/g, ' | ')}`
            );
        }
        ok(`${tag} C-15: every switch's tree names its picked option (${named})`, named >= 5);
        // a visible focus ring on every control Tab reaches
        await page.evaluate(() => document.querySelector('#gallery .gal-top button').focus());
        const rings = [];
        for (let i = 0; i < 40; i++) {
          await page.keyboard.press('Tab');
          const r = await page.evaluate(ringOf);
          if (!r) continue;
          rings.push(r);
        }
        const bare = rings.filter(r => !r.ring);
        ok(
          `${tag} D-383: a control reached by Tab shows its focus ring (${rings.length} reached)`,
          rings.length >= 20 && !bare.length,
          bare.map(r => r.label).join('; ')
        );
        // one screenshot per section: the window as tall as the page, so each section is whole
        const tall = await page.evaluate(() => document.getElementById('gallery').scrollHeight);
        await page.setViewportSize({ width: w, height: Math.min(tall + 40, 16000) });
        for (const sec of SECTIONS)
          await page
            .locator(`[data-gal-sec="${sec}"]`)
            .screenshot({ path: path.join(shots, `gallery-${sec}-${w}-${mode}.png`) });
        await ctx.close();
      }
    {
      // reduced motion: every duration is 0.01 ms
      const { ctx, page } = await open(browser, dir, 390, 844, 'light', { reducedMotion: 'reduce' });
      const got = await page.evaluate(measure).catch(() => ({ durs: [] }));
      ok(
        '[390] reduced motion makes every duration 0.01 ms',
        got.durs.length === 5 && got.durs.every(d => d === '0.01ms'),
        got.durs.join(', ')
      );
      await ctx.close();
    }
    if (target === 'staging') {
      // absent on live: live's /gallery is the app with no Gallery, and live's files carry none of it
      const live = path.join(root, 'dist/page/live');
      const { ctx, page } = await open(browser, live, 1280, 900, 'dark');
      const there = await page.evaluate(() => !!document.getElementById('gallery') || typeof window.EVApp !== 'object');
      ok('[live] /gallery opens the app with no Gallery', !there);
      const files = ['app.js', 'styles.css'].map(f => fs.readFileSync(path.join(live, f), 'utf8'));
      ok(
        "[live] live's app.js and styles.css carry no Gallery",
        files.every(t => !/\bgal-|data-gal-sec|89-gallery/.test(t))
      );
      await ctx.close();
    }
    // B-508 (D-375): the Sheet, live. Its Gallery button opens it modal; Esc closes it and so does a tap on the backdrop,
    // focus back on that button each time; under 600 px it is a bottom sheet, its foot padded by the safe area (34 px
    // emulated when the browser can) and inside the screen; from 600 px it centres.
    for (const [w, h] of [
      [390, 844],
      [1280, 900],
    ]) {
      const tag = `[${w} sheet]`;
      const { ctx, page } = await open(browser, dir, w, h, 'light');
      const inset = w < 600 ? 34 : 0;
      if (inset)
        await ctx
          .newCDPSession(page)
          .then(s => s.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: inset } }))
          .catch(() => notes.push(`${tag} no safe-area emulation in this browser; the foot read at 0`));
      const opener = page.locator('#gallery [data-slot="sheet"] button', { hasText: 'Open sheet' });
      if (!(await opener.count())) {
        ok(`${tag} the Gallery's Sheet has its Open sheet button`, false);
        await ctx.close();
        continue;
      }
      const state = () =>
        page.evaluate(() => {
          const d = [...document.querySelectorAll('dialog.sheet')].find(x => x.matches(':modal'));
          const a = document.activeElement;
          if (!d) return { open: false, focus: a ? a.textContent.trim() : '' };
          const r = d.getBoundingClientRect(),
            f = d.querySelector('.sheet-f');
          return {
            open: true,
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            pad: f ? parseFloat(getComputedStyle(f).paddingBottom) : -1,
            footIn: f ? f.getBoundingClientRect().bottom <= innerHeight + 0.5 : false,
          };
        });
      await opener.click();
      await page.waitForTimeout(400);
      const s1 = await state();
      ok(`${tag} Open sheet opens it modal`, s1.open);
      if (w < 600) {
        ok(
          `${tag} under 600 px it is a bottom sheet`,
          s1.open && Math.abs(s1.bottom - h) < 1 && s1.left < 1 && s1.right > w - 1,
          JSON.stringify(s1)
        );
        ok(
          `${tag} its foot clears the safe area (${inset} px) and stays on screen`,
          s1.pad >= 12 + inset - 0.5 && s1.footIn,
          `padding-bottom ${s1.pad}`
        );
      } else
        ok(
          `${tag} from 600 px it centres, 110 px from the top`,
          s1.open && Math.abs(s1.top - 110) < 1 && Math.abs(s1.left + s1.right - w) < 2,
          JSON.stringify(s1)
        );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const s2 = await state();
      ok(
        `${tag} Esc closes it and focus returns to Open sheet`,
        !s2.open && s2.focus === 'Open sheet',
        JSON.stringify(s2)
      );
      await opener.click();
      await page.waitForTimeout(400);
      await page.mouse.click(w - 4, 4); // the backdrop, above the sheet at either width
      await page.waitForTimeout(400);
      const s3 = await state();
      ok(
        `${tag} a tap on the backdrop closes it and focus returns`,
        !s3.open && s3.focus === 'Open sheet',
        JSON.stringify(s3)
      );
      await ctx.close();
    }
    await browser.close();
    for (const [s, n, d] of results) console.log(`${s}  ${n}${s === 'FAIL' && d ? ' :: ' + d : ''}`);
    for (const n of notes) console.log('NOTE  ' + n);
    const failed = results.filter(r => r[0] === 'FAIL').length;
    console.log(`\n${results.length - failed}/${results.length} passed; screenshots in ${shots}`);
    process.exit(failed ? 1 : 0);
  })().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
