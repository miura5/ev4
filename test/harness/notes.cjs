// The Notes editor (B-402, D-325): on the synthetic record at 1280, New note twice gives two notes in the record, '# '
// makes a heading, Bold and Undo/Redo work from the format bar, a pasted script stays text-free and inert, and the text
// survives a reload. At 390 there is no Notes entry, and #notes does not open it. B-403, the list: course filters with
// counts, notes grouped by course, the picked note's preview (From, Edited, Length, Studied, On this page, Open note,
// Study with E.V.), the empty states for no notes at all and for none in a course, and nothing overflowing, at 1280,
// 1706 and 2560 on synthetic, synthetic with no notes, and synthetic with a long-title note. B-406: New note starts a session
// naming notes/<id> with its controls in the strip; a check reads the open note through sample in the session's
// own chat; a second session ends and logs the first, and Undo puts back the note, the chat, the answer and the timer;
// Study with E.V. and a Today task start one; End in the strip saves it. B-407: a session's miss is proposed and shows
// in Study's button, her Study line and the sidebar after the chat closes, and To review's Accept counts it. B-418: read-along
// is on by default in an open note, session or not; the header's toggle turns it off per note; a quick note asks nothing.
//   node test/harness/notes.cjs [record dir | synthetic] [screenshots dir]
// Run `node tools/build.mjs` first. Exit code 1 when any check fails. EV_CPU_SLOWDOWN=<n> runs every page at 1/n of
// the CPU's speed (B-421: the timing checks must hold on a slow runner).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { openSet } = require('./paint.cjs');
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const dbDir = require('../data/synthetic.cjs').recordDir(args[0] || 'synthetic');
const shots = args[1] || '/tmp/ev4-notes';
fs.mkdirSync(shots, { recursive: true });
const pageDir = path.join(root, 'dist/page/staging');
// B-499: whether the built actions table takes an Accept with no objective (the spot files under its course); the
// B-455 checks below hold the page to whichever rule the build carries
const ACCEPT_BARE = (() => {
  try {
    const spec = JSON.parse(fs.readFileSync(path.join(pageDir, 'spec.json'), 'utf8'));
    return !spec.actions['weakspot-accept'].args.properties.items.items.required.includes('objective');
  } catch {
    return false;
  }
})();
const ORIGIN = 'https://ev.local';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html' };

function load(dir) {
  const db = {};
  for (const c of fs.readdirSync(dir)) {
    const p = path.join(dir, c);
    if (!fs.statSync(p).isDirectory()) continue;
    db[c] = {};
    for (const f of fs.readdirSync(p))
      if (f.endsWith('.json')) db[c][f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8'));
  }
  return db;
}
const seed = load(dbDir);
for (const c of ['system', 'legacy', 'debug', 'journal']) delete seed[c];
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
const skeleton = body =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  body +
  '</body></html>';

// B-421: the page's own Undo window for a switched session, read from the built page rather than restated here
const UNDO_MS = Number((/const UNDO_MS = (\d+);/.exec(fs.readFileSync(path.join(pageDir, 'app.js'), 'utf8')) || [])[1]);
if (!(UNDO_MS > 0)) throw new Error('UNDO_MS not found in the built page');

const results = [];
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
const until = (page, fn, arg, ms = 4000) =>
  page
    .waitForFunction(fn, arg, { timeout: ms })
    .then(() => true)
    .catch(() => false);

// The record lives in sessionStorage across a reload, so a reload reads what the page wrote (as the real record would).
const init =
  'window.__db = JSON.parse(sessionStorage.getItem("__db") || ' + JSON.stringify(JSON.stringify(seed)) + ');' + stub;
async function open(browser, viewport, db = null) {
  const ctx = await browser.newContext({ viewport, colorScheme: 'light' });
  const page = await ctx.newPage();
  const slow = Number(process.env.EV_CPU_SLOWDOWN || 0);
  if (slow > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: slow });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route(ORIGIN + '/**', r => {
    const name = new URL(r.request().url()).pathname.replace(/^\//, '') || 'index.html';
    if (name === 'index.html')
      return r.fulfill({
        body: skeleton(fs.readFileSync(path.join(pageDir, 'index.html'), 'utf8')),
        contentType: 'text/html',
      });
    const f = path.join(pageDir, name);
    return fs.existsSync(f)
      ? r.fulfill({ body: fs.readFileSync(f, 'utf8'), contentType: TYPES[path.extname(name)] || 'text/plain' })
      : r.fulfill({ status: 404, body: 'not published' });
  });
  await page.addInitScript(
    db
      ? 'window.__db = JSON.parse(sessionStorage.getItem("__db") || ' + JSON.stringify(JSON.stringify(db)) + ');' + stub
      : init
  );
  await page.goto(ORIGIN + '/');
  await until(page, () => /^Live$/.test((document.getElementById('status') || {}).textContent || ''), null, 8000);
  return { page, errors };
}
const notesIn = page => page.evaluate(() => Object.keys(window.__db.notes || {}));
const savedDoc = (page, id) => page.evaluate(i => (window.__db.notes || {})[i] || null, id);
const settle = (page, ms = 1300) => page.waitForTimeout(ms); // the autosave's pause (800 ms) and the write
// B-403: a row's name picks the note for the preview; the preview's Open note opens it
async function openFromList(page, id) {
  await page.click(`#notes-rows [data-note="${id}"] .nm`);
  await page.click('#notes-pv-open');
}
// the list as shown: filters, groups, rows, the preview, the empty state, and anything wider than its box
const listState = page =>
  page.evaluate(() => {
    const vis = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const txt = e => (e ? e.innerText.replace(/\s+/g, ' ').trim() : '');
    const pv = document.getElementById('notes-preview');
    const props = {};
    for (const p of pv.querySelectorAll('.prop')) props[p.firstChild.textContent] = p.lastChild.textContent;
    const over = [];
    // the list pane runs edge to edge past the panel's padding, as Record's does: what counts is inside it
    const box = document.getElementById('notes-list');
    for (const e of [box, ...box.querySelectorAll('*')]) {
      if (!vis(e)) continue;
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      if (r.right > innerWidth + 1) over.push((e.className.baseVal ?? e.className) + ' right ' + Math.round(r.right));
      if (e.scrollWidth > e.clientWidth + 1 && !/hidden|auto|scroll|clip/.test(cs.overflowX) && cs.display !== 'inline')
        over.push((e.className.baseVal ?? e.className) + ' spills ' + (e.scrollWidth - e.clientWidth));
    }
    const pvR = pv.getBoundingClientRect();
    return {
      filters: [...document.querySelectorAll('#notes-filters button')].map(
        b =>
          b.firstChild.textContent +
          ':' +
          b.querySelector('.n').textContent +
          (b.getAttribute('aria-pressed') === 'true' ? '*' : '')
      ),
      groups: [...document.querySelectorAll('#notes-rows .n-grp')].map(txt),
      rows: [...document.querySelectorAll('#notes-rows [data-part=row]')].map(r => ({
        id: r.dataset.note,
        name: txt(r.querySelector('.nm')),
        sel: r.classList.contains('sel'),
        kind: txt(r.querySelector('.badge')),
        when: txt(r.querySelector('.t')),
        cut: r.querySelector('.nm').scrollWidth > r.querySelector('.nm').clientWidth,
        h: Math.round(r.getBoundingClientRect().height),
      })),
      empty: txt(document.querySelector('#notes-rows .nempty')),
      pv: {
        badge: txt(pv.querySelector('.badge')),
        title: txt(pv.querySelector('.n-pvt')),
        props,
        outline: [...pv.querySelectorAll('.n-outline .si')].map(txt),
        open: vis(document.getElementById('notes-pv-open')),
        study: vis(document.getElementById('notes-pv-study')),
        none: txt(pv.querySelector('.n-pvnone')),
        right: Math.round(innerWidth - pvR.right),
        w: Math.round(pvR.width),
        fixed: getComputedStyle(pv).position === 'fixed',
      },
      over,
      hscroll: document.documentElement.scrollWidth > innerWidth,
    };
  });
// B-520: the editor names the note it has open; an empty new note is not written, so no write names it
const openNoteId = page =>
  page.evaluate(() => {
    const ed = document.getElementById('notes-editor');
    if (ed && !ed.hidden && ed.dataset.note) return ed.dataset.note;
    const w = (window.__writes || []).filter(x => x[1] === 'notes');
    return w.length ? w[w.length - 1][2] : null;
  });

(async () => {
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  // ---- B-600: the note's own type scale at 1280: title, Heading 1, 2, 3 and body each a step apart, the title as
  // large as Heading 1 was before the polish (30 px). EV_NOTES_ONLY=headings runs this check alone.
  {
    const { page, errors } = await open(browser, { width: 1280, height: 860 });
    const tag = '[1280 headings]';
    await page.click('#tab-notes');
    await page.click('#notes-new');
    await until(page, () => !document.getElementById('notes-editor').hidden);
    await page.click('#note-body');
    for (const [i, t] of [
      '# Fluids lecture',
      '# Heading one',
      '## Heading two',
      '### Heading three',
      'Body words',
    ].entries()) {
      if (i) await page.keyboard.press('Enter');
      await page.keyboard.type(t);
    }
    await settle(page);
    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll('#note-body > .nb')].map(b => [b.tagName, parseFloat(getComputedStyle(b).fontSize)])
    );
    const px = sizes.map(s => s[1]);
    ok(
      `${tag} the title, Heading 1, 2, 3 and the body each read a step smaller than the one before, the title at 30 px`,
      sizes.map(s => s[0]).join() === 'H1,H1,H2,H3,P' &&
        px[0] === 30 &&
        px.every((v, i) => i === 0 || px[i - 1] - v >= 2),
      JSON.stringify(sizes)
    );
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: path.join(shots, `notes-headings-1280-${scheme}.png`) });
    }
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }
  if (process.env.EV_NOTES_ONLY === 'headings') {
    await browser.close();
    for (const [s, n, d] of results) console.log(`${s}  ${n}${d && s === 'FAIL' ? '\n      ' + d : ''}`);
    process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);
  }

  // ---- 1280
  {
    const { page, errors } = await open(browser, { width: 1280, height: 860 });
    const tag = '[1280]';
    ok(`${tag} a Notes tab after Study`, await page.isVisible('#tab-notes'), '');
    const order = await page.evaluate(() => [...document.querySelectorAll('#top .tabs .tab')].map(t => t.dataset.tab));
    ok(
      `${tag} Notes sits after Study, as in the demo`,
      order.indexOf('notes') === order.indexOf('study') + 1,
      order.join(',')
    );
    await page.click('#tab-notes');
    ok(`${tag} the Notes panel opens`, await until(page, () => !document.getElementById('p-notes').hidden), '');
    const before = await notesIn(page);
    await page.screenshot({ path: path.join(shots, 'notes-list-1280.png') });

    // B-403: the list on synthetic: All, NUR 112 and BIO 201 with their counts (the archived note is left out), the
    // notes grouped by course, the newest picked, and its preview
    const L0 = await listState(page);
    ok(
      `${tag} the course filters read All, NUR 112 and BIO 201 with their counts, All on`,
      JSON.stringify(L0.filters) === JSON.stringify(['All:3*', 'NUR 112:2', 'BIO 201:1']),
      JSON.stringify(L0.filters)
    );
    ok(
      `${tag} the notes are grouped by day with counts, one-line rows with the course and time, the first picked`,
      L0.groups.length >= 1 &&
        L0.groups.every(g => /^(Today · |Yesterday · )?\w{3} \d{1,2} \w{3} \d+$/.test(g)) &&
        L0.groups.reduce((t, g) => t + Number(g.split(' ').pop()), 0) === 3 &&
        L0.rows.length === 3 &&
        L0.rows.every(r => r.h >= 32 && r.h <= 40 && r.kind && /\d:\d\d [ap]m$/.test(r.when)) &&
        L0.rows[0].sel &&
        L0.rows.filter(r => r.sel).length === 1,
      JSON.stringify({ g: L0.groups, rows: L0.rows })
    );
    ok(
      `${tag} the preview has the course, title, From, Edited, Length, Studied, On this page and both buttons, as the right panel`,
      L0.pv.badge === 'NUR 112' &&
        L0.pv.title === L0.rows[0].name &&
        Object.keys(L0.pv.props).join() === 'From,Edited,Length,Studied' &&
        /^\d[\d,]* words?$/.test(L0.pv.props.Length) &&
        /, \d{1,2}:\d\d [ap]m$/.test(L0.pv.props.Edited) &&
        L0.pv.props.Studied === 'Not yet' &&
        L0.pv.outline.length >= 1 &&
        L0.pv.open &&
        L0.pv.study &&
        L0.pv.fixed &&
        L0.pv.w === 320,
      JSON.stringify(L0.pv)
    );
    ok(`${tag} nothing in the list overflows`, !L0.over.length && !L0.hscroll, L0.over.slice(0, 4).join(' | '));
    // a name picks the note for the preview and does not open it
    const renal = L0.rows.find(r => /Renal/.test(r.name));
    await page.click(`#notes-rows [data-note="${renal.id}"] .nm`);
    const L1 = await listState(page);
    ok(
      `${tag} clicking a name previews it without opening it`,
      L1.pv.title === renal.name &&
        L1.pv.badge === 'BIO 201' &&
        L1.rows.find(r => r.id === renal.id).sel &&
        (await page.evaluate(() => document.getElementById('notes-editor').hidden)),
      JSON.stringify(L1.pv)
    );
    // BIO 201 shows only its notes; back to NUR 112 the preview moves to the first note shown
    await page.click('#notes-filters [data-filter="BIO 201"]');
    const L2 = await listState(page);
    await page.click('#notes-filters [data-filter="NUR 112"]');
    const L3 = await listState(page);
    ok(
      `${tag} a course filter shows only that course; a filter that hides the picked note moves the preview to the first shown`,
      L2.rows.length === 1 &&
        L2.rows[0].id === renal.id &&
        L2.groups.length === 1 &&
        / 1$/.test(L2.groups[0]) &&
        L2.filters[2] === 'BIO 201:1*' &&
        L3.rows.length === 2 &&
        L3.rows.every(r => r.id !== renal.id) &&
        L3.pv.title === L3.rows[0].name &&
        L3.rows[0].sel,
      JSON.stringify({ L2: L2.rows.map(r => r.name), L3: L3.rows.map(r => r.name), pv: L3.pv.title })
    );
    await page.click('#notes-filters [data-filter="all"]');
    // Open shows on hover, and opens the note; Back returns to the list as it was
    await page.hover(`#notes-rows [data-note="${renal.id}"]`);
    const hovOpen = await page.isVisible(`#notes-rows [data-note="${renal.id}"] .n-open`);
    await page.click(`#notes-rows [data-note="${renal.id}"] .n-open`);
    const opened = await until(page, () => !document.getElementById('notes-editor').hidden);
    const openedTitle = await page.evaluate(() => document.querySelector('#note-body h1')?.textContent || '');
    const noPaneInEditor = await page.evaluate(
      () => document.getElementById('notes-preview').getClientRects().length === 0
    );
    await page.click('button[aria-label="Back to Notes"]');
    await until(page, () => !document.getElementById('notes-list').hidden);
    ok(
      `${tag} a row's Open shows on hover and opens the note; the preview is gone in the editor; Back returns to the list`,
      hovOpen && opened && /Renal/.test(openedTitle) && noPaneInEditor && (await page.isVisible('#notes-preview')),
      JSON.stringify({ hovOpen, opened, openedTitle, noPaneInEditor })
    );
    // Study with E.V. opens the note and asks for a session on it (B-406 starts the session)
    await page.evaluate(() => {
      window.__studyAsked = [];
      document.addEventListener('ev:note-study', e => window.__studyAsked.push(e.detail.id));
    });
    await page.click(`#notes-rows [data-note="${L0.rows[0].id}"] .nm`);
    await page.click('#notes-pv-study');
    await until(page, () => !document.getElementById('notes-editor').hidden);
    const asked = await page.evaluate(() => window.__studyAsked);
    ok(
      `${tag} Study with E.V. opens the note and asks for a session on it`,
      JSON.stringify(asked) === JSON.stringify([L0.rows[0].id]),
      JSON.stringify(asked)
    );
    await page.click('button[aria-label="Back to Notes"]');
    await until(page, () => !document.getElementById('notes-list').hidden);

    // New note twice: two new notes, two ids. B-520 (F-46): an empty one is never written, so leaving it leaves no
    // empty Untitled behind; its first words write it
    await page.click('#notes-new');
    await until(page, () => !document.getElementById('notes-editor').hidden);
    await settle(page);
    const id1 = await openNoteId(page);
    await page.click('button[aria-label="Back to Notes"]');
    await page.click('#notes-new');
    await settle(page);
    const id2 = await openNoteId(page);
    const after = await notesIn(page);
    const fresh = after.filter(x => !before.includes(x));
    ok(
      `${tag} New note twice opens two notes, each with its own id, and neither is written while it is empty (B-520)`,
      fresh.length === 0 &&
        id1 &&
        id2 &&
        id1 !== id2 &&
        [id1, id2].every(x => /^n-\d{8}-\d{6}-[A-Za-z0-9]{12,}$/.test(x)),
      JSON.stringify({ fresh, id1, id2 })
    );

    // '# ' makes a heading
    await page.click('#note-body');
    await page.keyboard.type('# Fluids lecture');
    await settle(page);
    const wrote = (await notesIn(page)).filter(x => !before.includes(x));
    ok(
      `${tag} its first words write the new note, under the id it opened with (B-520)`,
      wrote.length === 1 && wrote[0] === id2,
      JSON.stringify({ wrote, id2 })
    );
    const h1 = await page.evaluate(() => {
      const b = document.querySelector('#note-body').firstElementChild;
      return b && b.tagName + '|' + b.textContent;
    });
    ok(`${tag} typing '# ' makes a heading`, h1 === 'H1|Fluids lecture', h1);
    await page.keyboard.press('Enter');
    await page.keyboard.type('- first point');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second point');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // an empty item ends the list
    await page.keyboard.type('[] check this');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('1. numbered');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Bold words');
    const types = await page.evaluate(() =>
      [...document.querySelectorAll('#note-body > *')].map(b => b.dataset.t + ':' + b.textContent)
    );
    ok(
      `${tag} '- ', '[] ' and '1. ' make a list, a checklist and a numbered list; Enter on an empty item ends it`,
      JSON.stringify(types) ===
        JSON.stringify([
          'h1:Fluids lecture',
          'ul:first point',
          'ul:second point',
          'todo:check this',
          'ol:numbered',
          'p:Bold words',
        ]),
      JSON.stringify(types)
    );

    // Bold from the format bar, then Undo and Redo from the bar
    for (let i = 0; i < 'words'.length; i++) await page.keyboard.press('Shift+ArrowLeft');
    await page.click('#notes-editor button[aria-label="Bold"]');
    const boldNow = () =>
      page.evaluate(() => {
        const s = [...document.querySelectorAll('#note-body > p strong')].map(x => x.textContent);
        return s.join('|');
      });
    const pressed = () => page.getAttribute('#notes-editor button[aria-label="Bold"]', 'aria-pressed');
    const b1 = await boldNow(),
      p1 = await pressed();
    await page.click('#notes-editor button[aria-label="Undo"]');
    const b2 = await boldNow();
    await page.click('#notes-editor button[aria-label="Redo"]');
    const b3 = await boldNow();
    ok(
      `${tag} Bold marks the selection and shows pressed; Undo takes it off; Redo puts it back`,
      b1 === 'words' && p1 === 'true' && b2 === '' && b3 === 'words',
      JSON.stringify({ b1, p1, b2, b3 })
    );
    await page.keyboard.press('End');
    await page.keyboard.press(`${mod}+z`);
    const b4 = await boldNow();
    await page.keyboard.press(`${mod}+Shift+z`);
    const b5 = await boldNow();
    ok(`${tag} the keyboard's Undo and Redo do the same`, b4 === '' && b5 === 'words', JSON.stringify({ b4, b5 }));

    // the style menu: seven styles, each with its shortcut; picking Heading 2 restyles the line
    await page.click('#notes-editor .n-stb');
    const menu = await page.evaluate(() =>
      [...document.querySelectorAll('#notes-editor .n-stm .mi')].map(
        b => b.querySelector('.lb').textContent + '=' + b.querySelector('.ks').textContent
      )
    );
    ok(
      `${tag} the style menu lists Paragraph, H1 to H3, bulleted, numbered and checklist, each with its shortcut`,
      menu.length === 7 && menu.every(x => /=.+/.test(x)) && /^Paragraph=/.test(menu[0]) && /^Checklist=/.test(menu[6]),
      menu.join(', ')
    );
    await page.screenshot({ path: path.join(shots, 'notes-style-menu-1280.png') });
    await page.click('#notes-editor .n-stm .mi[data-style="h2"]');
    const last = await page.evaluate(() => {
      const b = document.querySelector('#note-body').lastElementChild;
      return b.tagName + '|' + b.textContent;
    });
    ok(`${tag} picking Heading 2 makes the line a heading 2`, last === 'H2|Bold words', last);
    await page.click('#notes-editor button[aria-label="Undo"]');

    // paste: HTML with a script and an event handler goes in as text and marks only
    await page.keyboard.press('End');
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData(
        'text/html',
        '<p>&nbsp;pasted <b>strong</b><script>window.__pwned=1</script><img src=x onerror="window.__pwned=2"></p>'
      );
      dt.setData('text/plain', ' pasted strong');
      document
        .getElementById('note-body')
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(200);
    const pasted = await page.evaluate(() => ({
      pwned: window.__pwned || 0,
      text: document.getElementById('note-body').lastElementChild.textContent,
      bad: document.querySelectorAll('#note-body script, #note-body img, #note-body [onerror]').length,
    }));
    ok(
      `${tag} a paste is read as text and marks: no script, image or handler gets in, and nothing runs`,
      pasted.pwned === 0 && pasted.bad === 0 && pasted.text === 'Bold words pasted strong',
      JSON.stringify(pasted)
    );
    await page.screenshot({ path: path.join(shots, 'notes-editor-1280.png') });

    // autosave and reload: the text survives
    await settle(page, 1600);
    const saved = await savedDoc(page, id2);
    ok(
      `${tag} the note autosaves through write() with its blocks and title`,
      !!saved && saved.title === 'Fluids lecture' && saved.blocks.length === 6 && saved.writer === 'page',
      JSON.stringify(saved && { title: saved.title, n: saved.blocks.length })
    );
    await page.evaluate(() => sessionStorage.setItem('__db', JSON.stringify(window.__db)));
    await page.reload();
    await until(page, () => /^Live$/.test((document.getElementById('status') || {}).textContent || ''), null, 8000);
    await page.click('#tab-notes');
    await openFromList(page, id2);
    const back = await page.evaluate(() =>
      [...document.querySelectorAll('#note-body > *')].map(b => b.dataset.t + ':' + b.textContent).join('/')
    );
    const boldBack = await boldNow();
    ok(
      `${tag} after a reload the note opens with its text, its heading and its bold`,
      /^h1:Fluids lecture\/ul:first point\/.*p:Bold words pasted strong$/.test(back) && /words/.test(boldBack),
      back + ' | bold: ' + boldBack
    );

    // a refused save keeps the text, says Not saved, and the note stays open until a save lands
    await page.keyboard.press(`${mod}+End`);
    await page.evaluate(() => (window.__writeFail = 'permission_denied'));
    await page.keyboard.type(' kept');
    await settle(page);
    const failed = await page.evaluate(() => ({
      sync: (document.querySelector('.mh .n-sync') || {}).textContent || '',
      text: document.getElementById('note-body').lastElementChild.textContent,
    }));
    await page.click('button[aria-label="Back to Notes"]');
    await page.waitForTimeout(400);
    const stayed = await page.evaluate(() => !document.getElementById('notes-editor').hidden);
    await page.evaluate(() => (window.__writeFail = null));
    await page.click('button[aria-label="Back to Notes"]');
    await until(page, () => !document.getElementById('notes-list').hidden);
    const landed = await savedDoc(page, id2);
    ok(
      `${tag} a refused save keeps the text and says Not saved; Back keeps the note open until it saves, then it lands`,
      /Not saved/.test(failed.sync) &&
        /kept$/.test(failed.text) &&
        stayed &&
        !!landed &&
        JSON.stringify(landed.blocks).includes(' kept'),
      JSON.stringify({ failed, stayed, landed: !!landed })
    );
    // B-402 review: a paste past a limit is refused whole with a line saying why, and the note stays as it was
    await openFromList(page, id2);
    await until(page, () => !document.getElementById('notes-editor').hidden);
    await page.keyboard.press(`${mod}+End`);
    const bodyNow = () =>
      page.evaluate(() => [...document.querySelectorAll('#note-body > *')].map(b => b.dataset.t + ':' + b.textContent));
    const noteWrites = () =>
      page.evaluate(i => (window.__writes || []).filter(w => w[1] === 'notes' && w[2] === i).length, id2);
    const paste = (html, text) =>
      page.evaluate(
        ([h, t]) => {
          document.getElementById('toast').hidden = true;
          const dt = new DataTransfer();
          if (h) dt.setData('text/html', h);
          dt.setData('text/plain', t);
          document
            .getElementById('note-body')
            .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        },
        [html, text]
      );
    const toastText = () =>
      page.evaluate(() => {
        const x = document.getElementById('toast');
        return x && !x.hidden ? x.textContent : '';
      });
    const was = await bodyNow();
    const savedWas = JSON.stringify((await savedDoc(page, id2)).blocks);
    const w0 = await noteWrites();
    await paste('', Array.from({ length: 5000 }, (_, i) => 'pasted line ' + i).join('\n'));
    await page.waitForTimeout(200);
    const t5000 = await toastText();
    const after5000 = await bodyNow();
    await settle(page);
    ok(
      `${tag} a 5,000-line paste is refused with a line saying why; the note is unchanged and nothing is saved`,
      /4,000 lines/.test(t5000) &&
        JSON.stringify(after5000) === JSON.stringify(was) &&
        (await noteWrites()) === w0 &&
        JSON.stringify((await savedDoc(page, id2)).blocks) === savedWas,
      JSON.stringify({ t5000, n: after5000.length, was: was.length, writes: (await noteWrites()) - w0 })
    );
    await paste('', Array.from({ length: 3000 }, (_, i) => String(i).padEnd(100, 'x')).join('\n'));
    await page.waitForTimeout(200);
    const tBig = await toastText();
    const afterBig = await bodyNow();
    await settle(page);
    ok(
      `${tag} a paste past the size cap is refused before any save; the note is unchanged`,
      /too long to save/.test(tBig) &&
        JSON.stringify(afterBig) === JSON.stringify(was) &&
        (await noteWrites()) === w0 &&
        JSON.stringify((await savedDoc(page, id2)).blocks) === savedWas,
      JSON.stringify({ tBig, n: afterBig.length, writes: (await noteWrites()) - w0 })
    );
    const words = Array.from({ length: 450 }, (_, i) => 'w' + i);
    await page.keyboard.press('Enter');
    await paste(
      '<p>' + words.map((w, i) => (i % 2 ? '<b>' + w + ' </b>' : '<i>' + w + ' </i>')).join('') + '</p>',
      words.join(' ')
    );
    await page.waitForTimeout(200);
    const wide = await page.evaluate(() => document.getElementById('note-body').textContent);
    ok(
      `${tag} a paragraph of 450 formatted spans keeps all its text`,
      words.every(w => wide.includes(w + ' ') || wide.endsWith(w)) && wide.includes(words.join(' ')),
      wide.slice(-80)
    );
    await page.click('#notes-editor button[aria-label="Undo"]');
    await page.click('#notes-editor button[aria-label="Undo"]');
    await settle(page);

    // B-404 (D-326): a stale save (409) is never written over the other device's version: his words become a second
    // note '<title> (earlier)' at once, the newer version stays the note, the picker shows; Keep this version swaps
    // them, Undo swaps them back, and the note closes normally.
    const before409 = await notesIn(page);
    const other = await page.evaluate(i => {
      const d = JSON.parse(JSON.stringify(window.__db.notes[i]));
      d.blocks = [
        { type: 'h1', runs: [{ text: 'Fluids lecture' }] },
        { type: 'p', runs: [{ text: 'Written on the other device' }] },
      ];
      d.at = d.editedAt = '2026-10-26T09:00:00.000Z';
      window.__db.notes[i] = d; // the record moved on; this page has not seen it
      // the next write is refused as stale, once: stub.js reads the flag three times for one refused write (the
      // check, the message, the code)
      let reads = 0;
      Object.defineProperty(window, '__writeFail', {
        configurable: true,
        get: () => (reads++ < 3 ? 'conflict' : null),
        set: () => {},
      });
      return JSON.stringify(d);
    }, id2);
    await page.keyboard.press(`${mod}+End`);
    await page.keyboard.type(' stale words');
    await settle(page, 1800);
    await page.evaluate(() => {
      delete window.__writeFail;
      window.__writeFail = null;
    });
    const kept = await page.evaluate(
      ([i, was]) => {
        const notes = window.__db.notes;
        const eid = Object.keys(notes).find(k => !was.includes(k) && notes[k].earlierOf === i);
        const txt = d => (d ? d.blocks.map(b => b.runs.map(r => r.text).join('')).join('\n') : '');
        return {
          eid,
          title: eid ? notes[eid].title : '',
          earlier: txt(notes[eid]),
          sync: (document.querySelector('.mh .n-sync') || {}).textContent || '',
          body: document.getElementById('note-body').innerText,
          vers: document.querySelectorAll('.n-pick .ver').length,
        };
      },
      [id2, before409]
    );
    const orig409 = JSON.stringify(await savedDoc(page, id2));
    ok(
      `${tag} a stale save keeps his words at once as '<title> (earlier)' and the newer version stays the note, untouched`,
      !!kept.eid &&
        kept.title === 'Fluids lecture (earlier)' &&
        / stale words/.test(kept.earlier) &&
        orig409 === other &&
        /Written on the other device/.test(kept.body) &&
        !/stale words/.test(kept.body),
      JSON.stringify({ ...kept, same: orig409 === other })
    );
    ok(
      `${tag} the header says Two versions · pick one and the picker shows both versions`,
      /Two versions · pick one/.test(kept.sync) && kept.vers === 2,
      JSON.stringify({ sync: kept.sync, vers: kept.vers })
    );
    await page.screenshot({ path: path.join(shots, 'notes-two-versions-1280.png') });
    const txtOf = (page, i) =>
      page.evaluate(i => {
        const d = window.__db.notes[i];
        return d ? d.blocks.map(b => b.runs.map(r => r.text).join('')).join('\n') : '';
      }, i);
    // the plain swap and Undo: Keep this version (this device's) swaps the two notes; Undo swaps them back
    await page.click('.n-pick .ver:first-child button');
    await settle(page, 1600);
    const sw = { note: await txtOf(page, id2), earlier: await txtOf(page, kept.eid) };
    const undoLine = await page.evaluate(() => (document.querySelector('.n-pick .endline') || {}).textContent || '');
    await page.click('.n-pick .endline button'); // Undo
    await settle(page, 1600);
    const un = { note: await txtOf(page, id2), earlier: await txtOf(page, kept.eid) };
    const again = await page.evaluate(() => document.querySelectorAll('.n-pick .ver').length);
    ok(
      `${tag} Keep this version swaps the two notes; Undo swaps them back and the picker shows again`,
      / stale words/.test(sw.note) &&
        /Written on the other device/.test(sw.earlier) &&
        /Kept this device’s version/.test(undoLine) &&
        /Written on the other device/.test(un.note) &&
        !/stale words/.test(un.note) &&
        / stale words/.test(un.earlier) &&
        again === 2,
      JSON.stringify({ sw, undoLine, un, again })
    );
    // B-404 review: words typed into the shown version go with it when he keeps his: nothing is dropped
    await page.click('#note-body');
    await page.keyboard.press(`${mod}+End`);
    await page.keyboard.type(' typed into the shown version');
    await settle(page, 1600);
    await page.click('.n-pick .ver:first-child button');
    await settle(page, 1600);
    const typed = { note: await txtOf(page, id2), earlier: await txtOf(page, kept.eid) };
    ok(
      `${tag} words typed into the shown version, then Keep this version: his is the note, and the typed words are kept`,
      / stale words/.test(typed.note) &&
        /Written on the other device/.test(typed.earlier) &&
        /typed into the shown version/.test(typed.earlier),
      JSON.stringify(typed)
    );
    // B-404 review: the second note changes on another device while Undo is offered; Undo then never writes over it
    const remote = (i, line) =>
      page.evaluate(
        async ([i, line]) => {
          const d = JSON.parse(JSON.stringify(window.__db.notes[i]));
          d.blocks = [...d.blocks, { type: 'p', runs: [{ text: line }] }];
          d.at = d.editedAt = new Date(Date.parse(d.at) + 60000).toISOString();
          const db = await window.claude.use('db');
          await db.collection('notes').doc(i).set(d); // as another device's save arrives: the page is told
        },
        [i, line]
      );
    const before2 = await notesIn(page);
    await remote(kept.eid, 'Remote edit on the second note');
    await page.waitForTimeout(300);
    await page.click('.n-pick .endline button'); // Undo
    await settle(page, 1600);
    const after2 = await page.evaluate(
      ([i, eid, was]) => {
        const txt = d => d.blocks.map(b => b.runs.map(r => r.text).join('')).join('\n');
        const n = window.__db.notes;
        const fresh = Object.keys(n).filter(k => !was.includes(k));
        return { note: txt(n[i]), earlier: txt(n[eid]), fresh: fresh.map(k => [n[k].earlierOf, txt(n[k])]) };
      },
      [id2, kept.eid, before2]
    );
    ok(
      `${tag} a remote edit to the second note, then Undo: it keeps its edit, his words go into a new second note`,
      /Remote edit on the second note/.test(after2.earlier) &&
        /typed into the shown version/.test(after2.earlier) &&
        after2.fresh.length === 1 &&
        after2.fresh[0][0] === id2 &&
        / stale words/.test(after2.fresh[0][1]) &&
        /Remote edit on the second note/.test(after2.note),
      JSON.stringify(after2)
    );
    // a remote edit to the note itself, while the pick is open: the new version shows, and the pick ends
    await page.click('.n-pick .ver:first-child button'); // keep again, so Undo is offered
    await settle(page, 1600);
    const undoBefore = await page.evaluate(() => !!document.querySelector('.n-pick .endline'));
    await remote(id2, 'Remote line on the note');
    await page.waitForTimeout(500);
    const after3 = await page.evaluate(
      i => ({
        pick: !!document.querySelector('.n-pick .endline') || document.querySelectorAll('.n-pick .ver').length > 0,
        body: document.getElementById('note-body').innerText,
        all: Object.values(window.__db.notes)
          .filter(n => n.earlierOf === i || n.createdAt)
          .map(d => d.blocks.map(b => b.runs.map(r => r.text).join('')).join('\n'))
          .join('\n'),
      }),
      id2
    );
    ok(
      `${tag} a remote edit to the note ends the pick and its Undo, and every word is still kept`,
      undoBefore &&
        !after3.pick &&
        /Remote line on the note/.test(after3.body) &&
        [
          ' stale words',
          'Written on the other device',
          'typed into the shown version',
          'Remote edit on the second note',
          'Remote line on the note',
        ].every(w => after3.all.includes(w)),
      JSON.stringify({ undoBefore, pick: after3.pick, body: after3.body.slice(-120) })
    );
    await page.click('button[aria-label="Back to Notes"]');
    const closed409 = await until(page, () => document.getElementById('notes-editor').hidden, null, 3000);
    const listed = await until(
      page,
      eid => {
        const r = document.querySelector(`#notes-rows [data-note="${eid}"] .nm`);
        return !!r && r.textContent === 'Fluids lecture (earlier)';
      },
      kept.eid,
      3000
    );
    ok(`${tag} the note then closes normally, and the '(earlier)' note is in the list`, closed409 && listed, '');

    // B-410: a note the record refused (the app's shim says so through ev-sync) reads Not saved in the list and in its
    // header, and the mark goes when the refusal does
    const tell = refused =>
      page.evaluate(
        r =>
          window.dispatchEvent(
            new CustomEvent('ev-sync', { detail: { online: true, pending: 0, syncing: false, refused: r } })
          ),
        refused
      );
    await tell([{ c: 'notes', id: kept.eid, why: '400 too large' }]);
    const row410 = await page.evaluate(
      id => (document.querySelector(`#notes-rows [data-note="${id}"] .n-unsaved`) || {}).textContent || '',
      kept.eid
    );
    await openFromList(page, kept.eid);
    await until(page, () => !document.getElementById('notes-editor').hidden);
    const head410 = await page.evaluate(() => document.querySelector('.mh .n-sync').textContent);
    await page.click('button[aria-label="Back to Notes"]');
    await until(page, () => document.getElementById('notes-editor').hidden, null, 3000);
    await tell([]);
    const gone410 = await page.evaluate(
      id => !document.querySelector(`#notes-rows [data-note="${id}"] .n-unsaved`),
      kept.eid
    );
    ok(
      `${tag} a refused note reads Not saved in the list and in its header, until the refusal clears`,
      /Not saved/.test(head410) && row410 === 'Not saved' && gone410,
      JSON.stringify({ head410, row410, gone410 })
    );

    // B-404, D-332: an edit that shrinks a note already past the size cap is allowed (only growth past it is refused)
    const bigId = 'n-20261026-100000-BigNoteBigNote01';
    await page.evaluate(id => {
      const at = '2026-10-26T10:00:00.000Z';
      const line = n => ({ type: 'p', runs: [{ text: String(n).padEnd(15000, 'x') }] });
      window.__db.notes[id] = {
        schema: 1,
        writer: 'page',
        at,
        source: 'E.V. Home',
        createdAt: at,
        title: 'Big note',
        course: null,
        blocks: [{ type: 'h1', runs: [{ text: 'Big note' }] }, ...Array.from({ length: 20 }, (_, i) => line(i))],
        editedAt: at,
      };
      sessionStorage.setItem('__db', JSON.stringify(window.__db));
    }, bigId);
    await page.reload();
    await until(page, () => /^Live$/.test((document.getElementById('status') || {}).textContent || ''), null, 8000);
    await page.click('#tab-notes');
    await openFromList(page, bigId);
    await until(page, () => !document.getElementById('notes-editor').hidden);
    const linesBefore = await page.evaluate(() => document.getElementById('note-body').children.length);
    await page.click('#note-body');
    // the last line selected whole (a 15,000-character line wraps, so Shift+Home would take only its last row)
    await page.evaluate(() => {
      const last = document.getElementById('note-body').lastElementChild;
      const r = document.createRange();
      r.selectNodeContents(last);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.waitForTimeout(100);
    await page.keyboard.press('Backspace'); // its text goes
    await page.keyboard.press('Backspace'); // and the empty line joins the one above
    await page.waitForTimeout(300);
    const shrunk = await page.evaluate(() => {
      const t = document.getElementById('toast');
      const body = document.getElementById('note-body');
      return {
        lines: body.children.length,
        len: body.innerText.length,
        toast: t && !t.hidden ? t.textContent : '',
      };
    });
    ok(
      `${tag} D-332: an edit that shrinks a note already past the size cap is allowed`,
      shrunk.lines === linesBefore - 1 && !/too long/.test(shrunk.toast),
      JSON.stringify({ linesBefore, ...shrunk })
    );
    await paste('', 'y'.repeat(20000)); // a change through apply() that leaves it past the cap and larger
    await page.waitForTimeout(300);
    const grown = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && !t.hidden ? t.textContent : '';
    });
    // B-410: the line names the real limit (the cap less the room a second note needs), never 'of 256' at 256
    ok(
      `${tag} while growing it past the cap is still refused, with the limit it is past`,
      /too long to save: \d+\.\d KB, and a note holds up to 255\.7 KB/.test(grown),
      grown
    );

    ok(
      `${tag} no page error`,
      errors.filter(e => !/permission_denied|conflict/.test(e)).length === 0,
      errors.slice(0, 3).join(' | ')
    );
    await page.context().close();
  }

  // ---- B-403: the list on three records (synthetic, no notes, a long-title note) at 1280, 1706 and 2560
  {
    const noNotes = JSON.parse(JSON.stringify(seed));
    noNotes.notes = {};
    const long = JSON.parse(JSON.stringify(seed));
    const LONG_ID = 'n-20261020-120000-longtitlenote01';
    const longTitle =
      'Fluid and electrolyte imbalances: hyponatremia, hypernatremia, hypokalemia and hyperkalemia, their causes, signs, ECG changes and nursing care in full';
    const longLabel = 'Lecture 9 and the skills lab review session';
    const anyNote = Object.values(long.notes)[0];
    long.notes[LONG_ID] = {
      ...anyNote,
      title: longTitle,
      label: longLabel,
      course: 'NUR 112',
      editedAt: new Date().toISOString(),
      at: new Date().toISOString(),
      blocks: [
        { type: 'h1', runs: [{ text: longTitle }] },
        {
          type: 'h2',
          runs: [
            { text: 'Sodium: hyponatremia and hypernatremia, causes, signs and what the nurse watches for first' },
          ],
        },
        { type: 'p', runs: [{ text: 'Supercalifragilisticexpialidocious'.repeat(8) }] },
        { type: 'h2', runs: [{ text: 'Potassium' }] },
        // B-409: nine sections in all, so the preview shows six and "3 more"
        ...['Calcium', 'Magnesium', 'Phosphate', 'Chloride', 'Bicarbonate', 'Review'].map(t => ({
          type: 'h2',
          runs: [{ text: t }],
        })),
        { type: 'h2', runs: [{ text: 'Practice' }] },
      ],
    };
    delete long.notes[LONG_ID].archivedAt;
    delete long.notes[LONG_ID].earlierOf;
    // no BIO 201 notes here, so BIO 201's filter shows its empty state
    for (const [k, n] of Object.entries(long.notes)) if (n.course === 'BIO 201') delete long.notes[k];
    const todayCT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const anySession = Object.values(long.sessions || {})[0];
    long.sessions = long.sessions || {};
    long.sessions['ss-20261020-130000-longnote'] = {
      ...anySession,
      status: 'ended',
      date: todayCT,
      minutes: 25,
      note: 'notes/' + LONG_ID,
      noteId: LONG_ID,
    };
    for (const width of [1280, 1706, 2560]) {
      const vp = { width, height: width === 1280 ? 860 : 1240 };
      // synthetic
      {
        const { page, errors } = await open(browser, vp);
        const tag = `[${width} synthetic]`;
        await page.click('#tab-notes');
        await until(page, () => !document.getElementById('p-notes').hidden);
        const L = await listState(page);
        ok(
          `${tag} filters, groups and the preview show; nothing overflows`,
          L.filters.length === 3 && L.groups.length >= 1 && L.pv.title && L.pv.fixed && !L.over.length && !L.hscroll,
          JSON.stringify({ f: L.filters, g: L.groups, over: L.over.slice(0, 3) })
        );
        // B-409: the "(earlier)" copy (edited last) sits directly below the note it copies, and is never the default pick
        const ci = L.rows.findIndex(r => / \(earlier\)$/.test(r.name));
        const pi = L.rows.findIndex(r => r.name === L.rows[ci].name.replace(/ \(earlier\)$/, ''));
        ok(
          `${tag} the "(earlier)" note sits directly below the note it copies and isn't picked for the preview`,
          ci > 0 && pi === ci - 1 && !/\(earlier\)/.test(L.pv.title) && !L.rows[ci].sel,
          JSON.stringify({ rows: L.rows.map(r => r.name), pv: L.pv.title })
        );
        await page.screenshot({ path: path.join(shots, `notes-list-${width}.png`) });
        ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
        await page.context().close();
      }
      // no notes at all
      {
        const { page, errors } = await open(browser, vp, noNotes);
        const tag = `[${width} no notes]`;
        await page.click('#tab-notes');
        await until(page, () => !document.getElementById('p-notes').hidden);
        const L = await listState(page);
        ok(
          `${tag} No notes yet, with the preview's line; All reads 0 and New note is there`,
          /^No notes yet A new note is where you study/.test(L.empty) &&
            !L.rows.length &&
            /^Your notes show here/.test(L.pv.none) &&
            L.filters[0] === 'All:0*' &&
            (await page.isVisible('#notes-new')) &&
            !L.over.length &&
            !L.hscroll,
          JSON.stringify({ empty: L.empty, pv: L.pv.none, f: L.filters, over: L.over.slice(0, 3) })
        );
        await page.screenshot({ path: path.join(shots, `notes-list-empty-${width}.png`) });
        ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
        await page.context().close();
      }
      // a long-title note, studied today, and no BIO 201 notes
      {
        const { page, errors } = await open(browser, vp, long);
        const tag = `[${width} long title]`;
        await page.click('#tab-notes');
        await until(page, () => !document.getElementById('p-notes').hidden);
        const L = await listState(page);
        const row = L.rows.find(r => r.id === LONG_ID);
        ok(
          `${tag} the long title is cut with an ellipsis in its row; course and time keep their place; nothing overflows`,
          !!row && (row.cut || width > 2000) && row.h === 36 && row.when && row.kind && !L.over.length && !L.hscroll,
          JSON.stringify({ row, over: L.over.slice(0, 4) })
        );
        ok(
          `${tag} the preview shows the whole title wrapped, its sections, and Studied from the session that named it`,
          L.pv.title === longTitle &&
            L.pv.props.Studied === '25 min, today' &&
            L.pv.props.From === longLabel &&
            L.pv.outline.length === 7 &&
            L.pv.outline[5] === 'Chloride' &&
            L.pv.outline[6] === '3 more' &&
            L.pv.w === 320,
          JSON.stringify(L.pv)
        );
        await page.screenshot({ path: path.join(shots, `notes-list-long-${width}.png`) });
        await page.click('#notes-filters [data-filter="BIO 201"]');
        const E = await listState(page);
        ok(
          `${tag} a course with no notes says so, with Show all notes; the preview says there is nothing to preview`,
          /^No BIO 201 notes yet Notes for this course show here, newest first\./.test(E.empty) &&
            !E.rows.length &&
            E.pv.none === 'Nothing to preview in this course.' &&
            E.filters.includes('BIO 201:0*') &&
            !E.over.length,
          JSON.stringify({ empty: E.empty, pv: E.pv.none, f: E.filters })
        );
        await page.screenshot({ path: path.join(shots, `notes-list-course-empty-${width}.png`) });
        await page.click('#notes-rows .nempty button');
        const A = await listState(page);
        ok(
          `${tag} Show all notes goes back to All`,
          A.filters[0].endsWith('*') && A.rows.length >= 2,
          JSON.stringify(A.filters)
        );
        ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
        await page.context().close();
      }
    }
  }

  // ---- B-406 (D-325): study sessions move into Notes, at 1280
  {
    const { page, errors } = await open(browser, { width: 1280, height: 860 });
    const tag = '[1280 sessions]';
    const sessions = () =>
      page.evaluate(() => Object.entries(window.__db.sessions || {}).map(([id, d]) => ({ id, ...d })));
    const sess = id => page.evaluate(i => (window.__db.sessions || {})[i] || null, id);
    const slot = () =>
      page.evaluate(() => {
        const s = document.getElementById('ev-sslot');
        const q = c => (s.querySelector(c) || {}).textContent || '';
        return {
          shown: !!s && s.getBoundingClientRect().width > 0,
          left: q('.s-left'),
          name: q('.tn'),
          brk: q('.s-brk'),
          end: q('.s-end'),
          ended: q('.s-ended'),
          undo: !!s.querySelector('.s-undo'),
          header: !document.getElementById('sbar').hidden,
        };
      });
    // the strip's clock in seconds: a Today task's time left, or a note's writing time (B-438)
    const secsLeft = t => {
      const m = /(\d+):(\d\d)/.exec(t);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const active = async () => (await sessions()).filter(x => x.status === 'active');
    await page.click('#tab-notes');
    await until(page, () => !document.getElementById('p-notes').hidden);
    const before = (await sessions()).map(x => x.id);

    // New note starts a session naming notes/<id> whose clock counts writing (B-438); its controls are in the strip
    await page.click('#notes-new');
    await until(page, () => !document.getElementById('notes-editor').hidden);
    await settle(page);
    const noteA = await openNoteId(page);
    await until(page, () => /writing/.test((document.querySelector('#ev-sslot .s-left') || {}).textContent || ''));
    const a = (await sessions()).filter(x => !before.includes(x.id));
    const sa = a[0] || {};
    const st1 = await slot();
    ok(
      `${tag} New note starts one session naming notes/<id> whose clock counts writing (no planned end), its first line in its own chat`,
      a.length === 1 &&
        sa.status === 'active' &&
        sa.note === 'notes/' + noteA &&
        sa.clock === 'writing' &&
        sa.planned === undefined &&
        sa.kind === 'note' &&
        (await page.evaluate(
          th =>
            Object.values(window.__db.talk || {}).some(d =>
              Object.values(d.messages || {}).some(
                m => m.thread === th && /Started a session on your new note\. The clock counts/.test(m.text)
              )
            ),
          'th-' + sa.id
        )),
      JSON.stringify({ n: a.length, note: sa.note, noteA, clock: sa.clock, planned: sa.planned, status: sa.status })
    );
    ok(
      `${tag} the strip shows the writing time counting up, the note, Break and End; the header's session line stays hidden`,
      st1.shown &&
        /^\d+:\d\d writing$/.test(st1.left) &&
        secsLeft(st1.left) < 60 &&
        st1.name === 'your new note' &&
        st1.brk === 'Break' &&
        st1.end === 'End' &&
        !st1.header,
      JSON.stringify(st1)
    );
    await page.click('#note-body');
    await page.keyboard.type('# Potassium');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Hyperkalemia peaks the T waves and can stop the heart.');
    await settle(page);
    const named = await slot();
    ok(`${tag} the strip names the note by its title as he writes`, named.name === 'Potassium', named.name);
    await page.screenshot({ path: path.join(shots, 'notes-session-strip-1280.png') });

    // B-88, kept by B-408 from the retired Conversation session: she reads along (every readSeconds; a tab coming back
    // reads at once) and a complete new line that earns it gets one short comment in the session's chat; the session
    // keeps a mark, never his words or her quote
    await page.evaluate(() => {
      window.__jsonCalls = [];
      window.__sampleFn = p =>
        /reading over his shoulder/.test(JSON.stringify(p))
          ? {
              say: 'Good link: insulin moves potassium into the cells.',
              quote: 'Insulin with glucose shifts potassium into the cells.',
              kind: 'connection',
            }
          : {};
    });
    const readNow = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await readNow();
    await page.waitForTimeout(1600); // the first read takes what is written as read
    await page.click('#note-body');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Insulin with glucose shifts potassium into the cells.');
    await page.keyboard.press('Enter');
    await settle(page);
    await readNow();
    const said = await until(
      page,
      th =>
        Object.values(window.__db.talk || {}).some(d =>
          Object.values(d.messages || {}).some(m => m.thread === th && /insulin moves potassium/.test(m.text))
        ),
      'th-' + sa.id,
      6000
    );
    const rd = await page.evaluate(i => {
      const c = (window.__jsonCalls || [])
        .filter(x => /reading over his shoulder/.test(JSON.stringify(x.prompt)))
        .pop();
      return {
        prompt: c ? String(c.prompt) : '',
        tier: c && c.tier,
        doc: JSON.stringify(window.__db.sessions[i] || {}),
      };
    }, sa.id);
    const ce = Object.values((await sess(sa.id)).events || {}).find(e => e.type === 'check' && e.comment);
    ok(
      `${tag} she reads along: a new line goes to Claude on the quick tier, her comment lands in the session's chat, and the session keeps a mark only`,
      said &&
        /Insulin with glucose shifts potassium into the cells\./.test(rd.prompt) &&
        rd.tier === 'quick' &&
        !!ce &&
        ce.len > 0 &&
        !/Insulin with glucose|insulin moves potassium/.test(rd.doc),
      JSON.stringify({ said, tier: rd.tier, ce, prompt: rd.prompt.slice(0, 200) })
    );
    // her quote of his line stays in this page's memory: no talk message holds it (the pop-up's chat shows no quote line,
    // as B-406 built it, so nothing is asserted there)
    const talkJson = await page.evaluate(() => JSON.stringify(window.__db.talk || {}));
    ok(
      `${tag} her quote of his line is never stored in the chat's record`,
      !/Insulin with glucose shifts potassium/.test(talkJson),
      talkJson.slice(0, 200)
    );
    // a read with nothing worth a word stays silent: Claude is asked, and the chat and the session are unchanged (the
    // page's clock runs 80 s ahead here, past the gap between two asks, commentGapSeconds)
    const quiet = () =>
      page.evaluate(
        ([i, th]) => ({
          lines: Object.values(window.__db.talk || {}).reduce(
            (n, d) => n + Object.values(d.messages || {}).filter(m => m.thread === th).length,
            0
          ),
          events: Object.keys((window.__db.sessions[i] || {}).events || {}).length,
        }),
        [sa.id, 'th-' + sa.id]
      );
    await page.evaluate(() => {
      window.__jsonCalls = [];
      window.__sampleFn = p =>
        /reading over his shoulder/.test(JSON.stringify(p)) ? { say: null, quote: null, kind: null } : {};
      const real = Date.now.bind(Date);
      window.__realNow = real;
      Date.now = () => real() + 80e3;
    });
    const q0 = await quiet();
    await page.click('#note-body');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('Hypokalemia flattens the T waves and brings U waves.');
    await page.keyboard.press('Enter');
    await settle(page);
    await readNow();
    const asked = await until(
      page,
      () => (window.__jsonCalls || []).some(x => /reading over his shoulder/.test(JSON.stringify(x.prompt))),
      null,
      6000
    );
    await page.waitForTimeout(1200);
    const q1 = await quiet();
    await page.evaluate(() => {
      Date.now = window.__realNow;
    });
    ok(
      `${tag} a read with nothing worth a word stays silent: no line in the session's chat, no session event`,
      asked && q1.lines === q0.lines && q1.events === q0.events,
      JSON.stringify({ asked, q0, q1 })
    );

    // a check reads the open note through sample, never the Study Watch reader; it lands in the session's chat
    await page.evaluate(() => {
      window.__mcpCalls = [];
      window.__chatScript = [{ tool: 'study_session', input: { action: 'quiz' } }];
      window.__chatReply = 'Posted.';
      window.__sampleFn = p => {
        const t = JSON.stringify(p);
        if (/short items|items/.test(t))
          return {
            items: [{ text: 'What does hyperkalemia do to the T waves?', kind: 'recall', answer: 'Peaks them' }],
          };
        return {};
      };
    });
    await page.click('#ev-btn');
    await until(page, () => !document.getElementById('evchat').hidden);
    const popHead = await page.evaluate(() => document.querySelector('#evchat .cph .tt').textContent);
    await page.fill('#evc-input', 'Quiz me on this note');
    await page.press('#evc-input', 'Enter');
    const carded = await until(page, () => !!document.querySelector('#evchat .msgs .check'), null, 6000);
    const check = await page.evaluate(() => ({
      prompt: JSON.stringify(window.__lastPrompt || ''),
      reader: window.__mcpCalls.filter(c => String(c[0]).startsWith('host:')).length,
      card: (document.querySelector('#evchat .msgs .check') || {}).textContent || '',
    }));
    const sa2 = await sess(sa.id);
    const ev2 = Object.values(sa2.events || {});
    ok(
      `${tag} a check sends the open note's text through sample, asks no reader, and shows in the session's chat`,
      carded &&
        /Hyperkalemia peaks the T waves/.test(check.prompt) &&
        check.reader === 0 &&
        /What does hyperkalemia do/.test(check.card) &&
        ev2.some(e => e.type === 'check' && e.n === 1) &&
        !JSON.stringify(sa2).includes('Hyperkalemia peaks'),
      JSON.stringify({ carded, reader: check.reader, card: check.card.slice(0, 80), popHead })
    );
    ok(`${tag} the pop-up is the session's chat, as the demo names it`, /Studying with E\.V\./.test(popHead), popHead);
    // B-638: every check in the session's chat is answered in its card (a text box and Check answer); a line typed
    // in the chat while a check is open gets one reminder to answer in the card, and does not answer the check
    await page.evaluate(() => (window.__chatScript = []));
    const card1 = await page.evaluate(() => {
      const c = document.querySelector('#evchat .msgs .check');
      return {
        box: !!c.querySelector('textarea[data-ui=check-answer]'),
        submit: !!c.querySelector('[data-ui=check-submit]'),
        answerBtn: [...c.querySelectorAll('button')].some(b => b.textContent.trim() === 'Answer'),
      };
    });
    ok(
      `${tag} B-638 a check in the Notes chat is the text-box card (text box and Check answer, no Answer button)`,
      card1.box && card1.submit && !card1.answerBtn,
      JSON.stringify(card1)
    );
    const nudgeSel = () =>
      [...document.querySelectorAll('#evchat .msgs .mev')].filter(m => /answer in the check card/.test(m.textContent))
        .length;
    await page.fill('#evc-input', 'They peak');
    await page.press('#evc-input', 'Enter');
    const nudged = await until(page, nudgeSel, null, 4000);
    const typedAnswered = await page.evaluate(
      i => Object.values((window.__db.sessions[i] || {}).events || {}).some(e => e.type === 'answer'),
      sa.id
    );
    ok(
      `${tag} B-638 an answer typed in the chat during an open check gets a one-line reminder to answer in the card`,
      nudged && !typedAnswered && (await page.evaluate(nudgeSel)) === 1,
      JSON.stringify({ nudged, typedAnswered })
    );
    await until(page, () => !document.querySelector('#evchat .msgs .dots'), null, 4000);
    await page.fill('#evchat .msgs .check textarea[data-ui=check-answer]', 'They peak');
    await page.click('#evchat .msgs .check [data-ui=check-submit]');
    const answered = await until(
      page,
      i =>
        Object.values((window.__db.sessions[i] || {}).events || {}).some(e => e.type === 'answer' && e.n === 1) &&
        /answered/.test((document.querySelector('#evchat .msgs .check .check-fold') || {}).textContent || ''),
      sa.id,
      6000
    );
    ok(`${tag} B-638 Check answer in the card answers its check, and the card shows it answered`, answered, '');
    await page.screenshot({ path: path.join(shots, 'notes-session-check-1280.png') });

    // B-638: an open check (its own set) returns its result on Check answer alone, with no chat line after it
    await page.evaluate(() => {
      window.__chatScript = [{ tool: 'study_session', input: { action: 'quiz' } }];
      window.__sampleFn = p => {
        const t = JSON.stringify(p);
        if (/explain one idea/.test(t))
          return {
            item: {
              stem: 'Why does hyperkalemia peak the T waves?',
              keyPoints: [
                { text: 'Hyperkalemia peaks T waves', keywords: [['hyperkalemia'], ['peaks']] },
                { text: 'Hypokalemia flattens T waves', keywords: [['hypokalemia'], ['flattens']] },
              ],
              modelAnswer: 'High potassium peaks the T waves; low potassium flattens them.',
              sourceLine: 'Hypokalemia flattens the T waves and brings U waves.',
            },
          };
        if (/one boolean per key point/.test(t)) return { hits: [true, false] };
        if (/short items|items/.test(t)) return { items: [{ text: 'What does a U wave mean?', kind: 'why' }] };
        return {};
      };
    });
    const nMsgs = () => page.evaluate(() => document.querySelectorAll('#evchat .msgs > *').length);
    await page.fill('#evc-input', 'Quiz me on this note');
    await page.press('#evc-input', 'Enter');
    const open2 = await until(
      page,
      () => !!document.querySelector('#evchat .msgs .check .check-open textarea'),
      null,
      8000
    );
    await until(page, () => !document.querySelector('#evchat .msgs .dots'), null, 4000);
    await page.evaluate(() => (window.__chatScript = []));
    const before2 = await nMsgs();
    let graded = false;
    if (open2) {
      await page.fill('#evchat .msgs .check .check-open textarea', 'High potassium peaks them');
      const sub = page.locator('#evchat .msgs .check .check-open button', { hasText: 'Check answer' });
      await sub.click();
      graded = await until(
        page,
        () => {
          const c = [...document.querySelectorAll('#evchat .msgs .check .check-open')].pop();
          return !!c && !/Checking/.test(c.textContent) && !!c.querySelector('.verdict, .q-expl');
        },
        null,
        8000
      );
    }
    const after2 = await nMsgs();
    ok(
      `${tag} B-638 an open check's Check answer shows its result in the card on its own (no chat line needed)`,
      open2 && graded && after2 === before2,
      JSON.stringify({ open2, graded, before2, after2 })
    );
    await page.screenshot({ path: path.join(shots, 'b638-open-check-1280.png') });

    // a second New note ends and logs the running session first, and offers Undo
    const leftBefore = secsLeft((await slot()).left);
    await page.click('button[aria-label="Back to Notes"]');
    await until(page, () => !document.getElementById('notes-list').hidden);
    await page.click('#notes-new');
    await until(page, () => !!document.querySelector('#ev-sslot .s-undo'), null, 4000);
    const noteB = await openNoteId(page);
    const sw = await slot();
    const ended = await sess(sa.id);
    const b = (await sessions()).find(x => x.note === 'notes/' + noteB);
    ok(
      `${tag} starting a second session ends and logs the running one first, then offers Undo in the strip`,
      ended.status === 'ended' &&
        Object.values(ended.events).some(e => e.type === 'end' && e.why === 'switched') &&
        !!b &&
        b.status === 'active' &&
        (await active()).length === 1 &&
        sw.undo &&
        /Ended “Potassium”: .*logged to Record/.test(sw.ended),
      JSON.stringify({ ended: ended.status, b: b && b.status, sw })
    );
    await page.screenshot({ path: path.join(shots, 'notes-session-undo-1280.png') });
    await page.click('#ev-sslot .s-undo');
    await until(page, i => (window.__db.sessions[i] || {}).status === 'active', sa.id, 4000);
    await page.waitForTimeout(400);
    const back = await sess(sa.id);
    const gone = await sess(b.id);
    const sw2 = await slot();
    const restored = await page.evaluate(() => ({
      body: document.getElementById('note-body').textContent,
      editor: !document.getElementById('notes-editor').hidden,
      pop: !document.getElementById('evchat').hidden,
      title: (document.querySelector('#evchat .cph .tt') || {}).textContent || '',
      card: (document.querySelector('#evchat .msgs .check') || {}).textContent || '',
    }));
    const evs = Object.values(back.events);
    ok(
      `${tag} Undo marks the new session discarded and the ended one active again; nothing is deleted`,
      gone.status === 'discarded' &&
        back.status === 'active' &&
        back.endedAt === null &&
        evs.some(e => e.type === 'reopen') &&
        evs.some(e => e.type === 'end' && e.why === 'switched') &&
        !(await savedDoc(page, noteB)), // B-520: the new note was left empty, so it was never written
      JSON.stringify({ gone: gone.status, back: back.status, endedAt: back.endedAt })
    );
    ok(
      `${tag} Undo puts back the open note, the chat, the check answer and the timer`,
      restored.editor &&
        /Hyperkalemia peaks/.test(restored.body) &&
        restored.pop &&
        /Potassium/.test(restored.title) &&
        /What does hyperkalemia do/.test(restored.card) &&
        evs.some(e => e.type === 'answer' && e.n === 1) &&
        sw2.name === 'Potassium' &&
        !sw2.undo &&
        Math.abs(secsLeft(sw2.left) - leftBefore) <= 4,
      JSON.stringify({ restored: { ...restored, body: restored.body.slice(0, 40) }, sw2, leftBefore })
    );
    await page.screenshot({ path: path.join(shots, 'notes-session-undone-1280.png') });

    // Study with E.V. in the list's preview starts one on that note; with no Undo
    // the ended session is filed once Undo is no longer offered
    await page.keyboard.press('Escape'); // the chat floats over the preview; close it first
    await page.click('button[aria-label="Back to Notes"]');
    await until(page, () => !document.getElementById('notes-list').hidden);
    // B-520: the empty new note was never written, so the session goes on another of his notes
    const noteC = await page.evaluate(
      a =>
        [...document.querySelectorAll('#notes-rows [data-part=row]')].map(r => r.dataset.note).find(i => i && i !== a),
      noteA
    );
    await page.click(`#notes-rows [data-note="${noteC}"] .nm`);
    // B-421: the page logs, by its own clock, each time the strip's Undo button comes or goes, from before the switch
    await page.evaluate(() => {
      const has = () => !!document.querySelector('#ev-sslot .s-undo');
      const log = (window.__undoLog = [{ at: Date.now(), shown: has() }]);
      new MutationObserver(() => {
        const shown = has();
        if (shown !== log[log.length - 1].shown) log.push({ at: Date.now(), shown });
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.click('#notes-pv-study');
    await until(
      page,
      i => Object.values(window.__db.sessions).some(x => x.note === 'notes/' + i && x.status === 'active'),
      noteC,
      4000
    );
    const c = (await sessions()).find(x => x.note === 'notes/' + noteC && x.status === 'active');
    // B-411: the end event names the view that switched; the Undo button lasts as long as the record's Undo
    const swEnd = await page.evaluate(i => {
      const evs = Object.values((window.__db.sessions[i] || {}).events || {});
      return evs.filter(e => e.type === 'end' && e.why === 'switched').pop() || null;
    }, sa.id);
    // B-421: judged by events and the page's own clock, not the runner's speed: the button shows after the switch, and
    // its last going (a record update can redraw the strip without it for a moment) is no earlier than the record's
    // Undo end (the end event's time + the page's UNDO_MS), and it stays gone. The wait is only a cap on a stuck button.
    const undoEnd = swEnd ? Date.parse(swEnd.at) + UNDO_MS : 0;
    const undoOver = await until(
      page,
      e => {
        const l = window.__undoLog;
        return Date.now() >= e && !l[l.length - 1].shown;
      },
      undoEnd,
      UNDO_MS * 4
    );
    const filed = await until(page, i => !!(window.__db.sessions[i] || {}).filedAt, sa.id, 30000);
    const fa = await sess(sa.id);
    const undoLog = await page.evaluate(() => window.__undoLog);
    const lastGone = undoLog.filter(x => !x.shown).pop();
    ok(
      `${tag} the switch's end event names its view; its Undo button shows, then goes on its own when the record's Undo ends (${UNDO_MS / 1000} s) and stays gone`,
      !!swEnd &&
        typeof swEnd.view === 'string' &&
        swEnd.view.length > 0 &&
        undoOver &&
        undoLog.some(x => x.shown) &&
        !undoLog[undoLog.length - 1].shown &&
        !!lastGone &&
        lastGone.at >= undoEnd &&
        lastGone.at <= undoEnd + UNDO_MS / 4,
      JSON.stringify({ swEnd, undoEnd, undoLog })
    );
    const dupes = await page.evaluate(i => {
      const by = (c, f) => Object.values(window.__db[c] || {}).filter(f).length;
      return {
        ideas: by('ideas', x => x.sessionId === i),
        weak: by('weakspots', x => x.origin && x.origin.session === i),
      };
    }, sa.id);
    ok(
      `${tag} filing starts with its mark (time and summary), then files from it`,
      !!fa.filing && fa.filedAt === fa.filing.at && typeof fa.filing.wrap === 'object',
      JSON.stringify({ filing: fa.filing, filedAt: fa.filedAt, dupes })
    );
    ok(
      `${tag} Study with E.V. starts a writing session on that note; the one it ended is filed when Undo runs out`,
      !!c &&
        c.clock === 'writing' &&
        filed &&
        fa.status === 'ended' &&
        fa.minutes >= 0 &&
        typeof fa.summary === 'string' &&
        !(await slot()).undo,
      JSON.stringify({ c: c && c.id, filed, minutes: fa.minutes })
    );

    // a Today task still starts one: a timed session of its own, its estimate long
    await page.click('#tab-today');
    const started = await page.evaluate(async () => {
      for (const r of document.querySelectorAll('#today-list .li .nm')) {
        r.click();
        await new Promise(x => setTimeout(x, 150));
        const b = document.querySelector('.tp-start');
        if (b && /Start study session/.test(b.textContent)) {
          b.click();
          return r.textContent;
        }
      }
      return null;
    });
    await page.waitForTimeout(800);
    const t = (await active())[0] || {};
    const sw3 = await slot();
    ok(
      `${tag} a Today task's Start still starts a session, timed by its estimate, with the controls in the strip`,
      !!started && !!t.planned && t.id !== c.id && sw3.shown && /left/.test(sw3.left) && sw3.end === 'End',
      JSON.stringify({ started, planned: t.planned, topic: t.topic, sw3 })
    );
    await page.screenshot({ path: path.join(shots, 'notes-session-task-1280.png') });
    // B-411: an Undo pressed after the record's Undo has ended is refused with one line, and changes nothing
    const refused = await page.evaluate(async () => {
      const b = document.querySelector('#ev-sslot .s-undo');
      if (!b) return { shown: false };
      const real = Date.now;
      Date.now = () => real() + 13000;
      document.getElementById('toast').hidden = true;
      b.click();
      await new Promise(r => setTimeout(r, 300));
      Date.now = real;
      const x = document.getElementById('toast');
      return { shown: true, line: x && !x.hidden ? x.textContent : '' };
    });
    const cNow = await sess(c.id);
    ok(
      `${tag} an Undo past the record's Undo says so in one line and reopens nothing`,
      refused.shown && /^Too late to undo: “.+” is saved\.$/.test(refused.line) && cNow.status === 'ended',
      JSON.stringify({ refused, c: cNow.status })
    );
    // End from the strip saves it and the strip empties
    await page.click('#ev-sslot .s-end');
    const endedT = await until(page, i => (window.__db.sessions[i] || {}).status === 'ended', t.id, 6000);
    await page.waitForTimeout(300);
    ok(
      `${tag} End in the strip saves the session and empties the strip`,
      endedT && !(await slot()).left,
      JSON.stringify(await slot())
    );
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-407 (D-237, D-334): a missed check in a Notes session proposes a weak spot to Study's To review, visibly.
  // With the morning's review row on today (as it writes it), a session's miss is filed proposed at End; after the
  // chat closes (and after a reload) Study's button reads "Weak spots · N · 1 to review", her Study line names it, and
  // the sidebar's review row carries "· 1 to review" whole, not cut off; Accept then counts it and To review empties.
  {
    const db = JSON.parse(JSON.stringify(seed));
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
    db.days[day].list.items.push({
      id: 'review-base',
      tag: 'REVIEW',
      kind: 'reviews',
      text: 'Review · 3 weak spots (~10 min)',
      minutes: 10,
    });
    // a two-question practice set under two objectives in the record, both to be missed (made-up items)
    const QSET = 'more-' + day + '-b407';
    db.sets[QSET] = {
      schema: 2,
      writer: 'page',
      at: new Date(Date.now() - 864e5).toISOString(),
      source: 'More practice',
      kind: 'more',
      date: day,
      exam: 'E4',
      title: 'Harness misses',
      createdAt: new Date(Date.now() - 864e5).toISOString(),
      items: [1, 2].map(n => ({
        id: 'm' + n,
        kind: 'check',
        objective: n === 1 ? 'E4-2' : 'E4-5',
        topic: 'Harness miss ' + n,
        type: 'single',
        cjStep: 'recognize-cues',
        stem: `Harness question ${n}: which is right?`,
        options: ['Right ' + n, 'Not it ' + n, 'Other ' + n, 'Last ' + n],
        correct: [0],
        rationales: ['Right.', 'No.', 'No.', 'No.'],
      })),
    };
    const { page, errors } = await open(browser, { width: 1280, height: 860 }, db);
    const tag = '[1280 B-407]';
    const TOPIC = 'Frank-Starling curve';
    const spots = () =>
      page.evaluate(() => Object.entries(window.__db.weakspots || {}).map(([id, d]) => ({ id, ...d })));
    const before = (await spots()).map(w => w.id);
    await page.click('#tab-notes');
    await until(page, () => !document.getElementById('p-notes').hidden);
    await page.click('#notes-new');
    await until(page, () => !document.getElementById('notes-editor').hidden);
    await settle(page);
    await until(page, () => /writing/.test((document.querySelector('#ev-sslot .s-left') || {}).textContent || ''));
    await page.click('#note-body');
    await page.keyboard.type('# Cardiac output');
    await page.keyboard.press('Enter');
    await page.keyboard.type(
      'Preload is the stretch before contraction; afterload is the pressure the heart pumps against.'
    );
    await settle(page);
    // one check through the session's chat, answered wrong; Claude's wrap-up at End names the miss under E4-3
    await page.evaluate(topic => {
      window.__chatScript = [{ tool: 'study_session', input: { action: 'quiz' } }];
      window.__chatReply = 'Posted.';
      window.__sampleFn = p => {
        const t = JSON.stringify(p);
        if (/weakSpots/.test(t))
          return {
            summary: 'Worked through preload and afterload.',
            weakSpots: [{ objective: 'E4-3', topic }],
            connections: [],
            noteTodos: [],
            cards: [],
          };
        if (/items/.test(t)) return { items: [{ text: 'Which one does vasoconstriction raise?', kind: 'why' }] };
        return {};
      };
    }, TOPIC);
    await page.click('#ev-btn');
    await until(page, () => !document.getElementById('evchat').hidden);
    // B-409: with a note open, the pop-up and the strip speak of this note, as the demo's
    const words = () =>
      page.evaluate(() => ({
        ph: document.getElementById('evc-input').placeholder,
        ctx: document.querySelector('#evchat .ctx').textContent,
        chips: [...document.querySelectorAll('#evchat .pchips .qchip')].map(b => b.textContent),
        sug: document.getElementById('ev-sug').textContent,
        sugOff: document.getElementById('ev-sug').disabled,
      }));
    const w1 = await words();
    ok(
      `${tag} with a note open in a session: "Ask E.V. about this note", "Sees this note", its two asks, and the strip's ask`,
      w1.ph === 'Ask E.V. about this note' &&
        w1.ctx === 'Sees this note' &&
        JSON.stringify(w1.chips) === '["Quiz me on this note","What else links to this note?"]' &&
        w1.sug === 'Ask E.V. about this note' &&
        !w1.sugOff,
      JSON.stringify(w1)
    );
    await page.click('#ev-sslot .s-brk');
    await until(page, () => /^On a break/.test(document.getElementById('ev-sug').textContent), null, 3000);
    const w2 = await words();
    ok(
      `${tag} on a break the strip reads "On a break. Resume when you’re back." and is not a button to press`,
      w2.sug === 'On a break. Resume when you’re back.' && w2.sugOff,
      JSON.stringify(w2)
    );
    await page.click('#ev-sslot .s-brk');
    await until(page, () => document.getElementById('ev-sug').textContent === 'Ask E.V. about this note', null, 3000);
    await page.fill('#evc-input', 'Quiz me on this note');
    await page.press('#evc-input', 'Enter');
    await until(page, () => !!document.querySelector('#evchat .msgs .check'), null, 6000);
    await page.evaluate(() => {
      window.__chatScript = [];
      window.__chatReply = 'Not quite: vasoconstriction raises afterload.';
    });
    await page.fill('#evc-input', 'Preload');
    await page.press('#evc-input', 'Enter');
    await page.waitForTimeout(800);
    await page.click('#ev-sslot .s-end');
    const filed = await until(
      page,
      ([b, topic]) =>
        Object.entries(window.__db.weakspots || {}).some(([id, w]) => !b.includes(id) && w.topic === topic),
      [before, TOPIC],
      8000
    );
    const made = (await spots()).filter(w => !before.includes(w.id));
    const sp = made[0] || {};
    ok(
      `${tag} the session's miss is filed as one proposed weak spot under its objective, from the session`,
      filed &&
        made.length === 1 &&
        sp.proposed === true &&
        sp.objective === 'E4-3' &&
        !!(sp.origin && sp.origin.session),
      JSON.stringify(made.map(w => [w.id, w.proposed, w.objective]))
    );
    const said = await until(
      page,
      () => /waits in Study’s To review/.test(document.getElementById('evchat').textContent),
      null,
      4000
    );
    ok(`${tag} her line in the session's chat says it waits in Study's To review`, said, '');
    // B-409: her band under the note's header names the session's minutes (no Undo: End files it at once), then the
    // strip reads "Studied N min on this note · open in Record"
    const band = await page.evaluate(() => {
      const l = document.getElementById('evline');
      return { text: l && !l.hidden ? l.textContent : '', btns: l ? l.querySelectorAll('button').length : -1 };
    });
    ok(
      `${tag} after End her band reads "Ended the session on “Cardiac output”: N minutes, logged to Record."`,
      /^Ended the session on “Cardiac output”: (\d+ minutes?|under a minute), logged to Record\.$/.test(band.text) &&
        band.btns === 0,
      JSON.stringify(band)
    );
    await page.screenshot({ path: path.join(shots, 'b409-session-ended-1280.png') });
    const studied = await page.evaluate(() => document.getElementById('ev-sug').textContent);
    ok(
      `${tag} afterwards the strip reads "Studied N min on this note · open in Record"`,
      /^Studied (\d+ min|under a minute) on this note · open in Record$/.test(studied),
      studied
    );
    await page.screenshot({ path: path.join(shots, 'b407-session-filed-1280.png') });
    await page.click('#evchat [aria-label="Close"]');
    await page.waitForTimeout(400);
    const places = () =>
      page.evaluate(() => {
        const side = [...document.querySelectorAll('#side-today .si')].find(b => /to review/.test(b.textContent));
        const t = side && side.querySelector('.t');
        const tr = side && side.querySelector('.t .tr');
        const box = side && side.getBoundingClientRect();
        // each part whole: no ellipsis, nothing wider than its box, nothing past the row's right edge
        const cut = x => !x || x.scrollWidth > x.clientWidth + 0.5 || x.getBoundingClientRect().right > box.right + 0.5;
        const line = document.getElementById('evline');
        return {
          chat: !document.getElementById('evchat').hidden,
          button: (document.getElementById('study-qweak') || {}).textContent || '',
          buttonShown: !!document.getElementById('study-qweak') && !document.getElementById('study-qweak').hidden,
          line: line && !line.hidden ? line.textContent : '',
          side: t ? [t.firstChild.textContent, tr ? tr.textContent : ''] : [],
          clipped: t ? cut(t) || cut(tr) : null,
          sideW: t ? [t.scrollWidth, t.clientWidth, tr && tr.scrollWidth, tr && tr.clientWidth] : null,
        };
      });
    const check = async when => {
      await page.click('#tab-study');
      await until(page, () => !document.getElementById('p-study').hidden);
      await page.waitForTimeout(300);
      const p = await places();
      ok(
        `${tag} ${when}: Study's button reads "Weak spots · N · 1 to review"`,
        !p.chat && p.buttonShown && /^Weak spots · \d+ · 1 to review$/.test(p.button),
        p.button
      );
      ok(
        `${tag} ${when}: her Study line names it, with Review`,
        /1 weak spot from your note session to review\./.test(p.line) && /Review/.test(p.line),
        p.line
      );
      ok(
        `${tag} ${when}: the sidebar's review row reads "Review · 3 weak spots", then "1 to review", neither cut off`,
        JSON.stringify(p.side) === '["Review · 3 weak spots","1 to review"]' && p.clipped === false,
        JSON.stringify({ side: p.side, w: p.sideW })
      );
      return p;
    };
    await check('after the chat closes');
    await page.screenshot({ path: path.join(shots, 'b407-study-1280.png') });
    await page.evaluate(() => sessionStorage.setItem('__db', JSON.stringify(window.__db))); // the record, as written
    await page.reload();
    await until(page, () => !!document.getElementById('tab-study'));
    await page.waitForTimeout(800);
    await check('after a reload');
    // To review on Weak spots: the row, its four taps, and Accept counts it under its objective
    await page.click('#study-qweak');
    await until(page, () => !document.getElementById('weak-list').closest('[hidden]'));
    await page.waitForTimeout(300);
    const wk = await page.evaluate(id => {
      const heads = [...document.querySelectorAll('#weak-list .dayh')].map(x => x.textContent);
      const row = document.querySelector(`#weak-list .trow[data-id="${id}"]`);
      return {
        heads,
        row: row ? row.textContent : '',
        btns: row ? [...row.querySelectorAll('button')].map(b => [b.textContent, b.disabled]) : [],
        side: (document.getElementById('study-side') || document.body).textContent.includes('How triage works'),
      };
    }, sp.id);
    ok(
      `${tag} Weak spots leads with "To review · 1": its topic, its objective and Accept, Join, Not now, Decline`,
      wk.heads[0] === 'To review · 1' &&
        wk.row.includes(TOPIC) &&
        /Under “Describe preload/.test(wk.row) &&
        JSON.stringify(wk.btns.map(b => b[0])) === '["Accept","Join","Not now","Decline"]' &&
        wk.btns[0][1] === false,
      JSON.stringify(wk)
    );
    // B-407 review: Join is off when no spot nearly repeats it, though open spots unrelated to it share its objective
    const unrelated = await page.evaluate(
      id =>
        Object.values(window.__db.weakspots).filter(
          w => w.objective === 'E4-3' && w.kind === 'concept' && !w.proposed && w.topic && !/Frank/.test(w.topic)
        ).length,
      sp.id
    );
    ok(
      `${tag} Join is off for a spot nothing nearly repeats, though ${unrelated} unrelated spots share its objective`,
      unrelated > 0 && wk.btns[1][1] === true,
      JSON.stringify(wk.btns)
    );
    await page.screenshot({ path: path.join(shots, 'b407-to-review-1280.png') });
    const openBefore = await page.evaluate(() => document.getElementById('study-qweak').textContent);
    const accBtn = `#weak-list .trow[data-id="${sp.id}"] button:has-text("Accept")`;
    if (sp.id && (await page.locator(accBtn).count())) await page.click(accBtn);
    const accepted = await until(
      page,
      id =>
        Object.values((window.__db.weakspots[id] || {}).events || {}).some(
          e => e.type === 'accept' && e.objective === 'E4-3' && e.by === 'owner'
        ),
      sp.id,
      4000
    );
    await page.waitForTimeout(300);
    const after = await page.evaluate(
      id => ({
        heads: [...document.querySelectorAll('#weak-list .dayh')].map(x => x.textContent),
        open: !!document.querySelector(`#weak-list .wl[data-id="${id}"]`),
      }),
      sp.id
    );
    const accToast = await page.evaluate(() => {
      const x = document.getElementById('toast');
      return x && !x.hidden ? x.textContent : '';
    });
    ok(
      `${tag} Accept says what it did: "Accepted under “<objective>”."`,
      /^Accepted under “.+”\.$/.test(accToast),
      accToast
    );
    ok(
      `${tag} Accept writes his accept event with its objective; To review is gone and the spot is open`,
      accepted && !after.heads.some(h => /To review/.test(h)) && after.open,
      JSON.stringify({ accepted, after, openBefore })
    );
    // B-407 review: a quiz that ends with two misses names both as proposed, and Accept all makes both open and in
    // tomorrow's picks
    await openSet(page, QSET);
    await page.waitForTimeout(300);
    for (const n of [1, 2]) {
      await page.locator('#pr-body label.opt', { hasText: 'Not it ' + n }).click();
      await page.waitForTimeout(200);
      const next = page.locator('#pr-body button', { hasText: n === 1 ? 'Next question' : 'See results' }).first();
      if (await next.isVisible().catch(() => false)) await next.click();
      await page.waitForTimeout(200);
    }
    const qMade = await page.evaluate(() =>
      Object.entries(window.__db.weakspots)
        .filter(([, w]) => /^Harness miss /.test(w.topic || ''))
        .map(([id, w]) => ({ id, proposed: !!w.proposed }))
    );
    const endLine = await page.evaluate(() => (document.querySelector('#pr-body .endline') || {}).textContent || '');
    ok(
      `${tag} a quiz ending with two misses proposes both and its results say so, with Accept all and Review`,
      qMade.length === 2 &&
        qMade.every(w => w.proposed) &&
        /^2 misses are proposed as weak spots\.Accept allReview$/.test(endLine),
      JSON.stringify({ qMade, endLine })
    );
    await page.screenshot({ path: path.join(shots, 'b407-quiz-results-1280.png') });
    await page.locator('#pr-body .endline button', { hasText: 'Accept all' }).click();
    await until(
      page,
      ids =>
        ids.every(id =>
          Object.values(window.__db.weakspots[id].events || {}).some(e => e.type === 'accept' && e.by === 'owner')
        ),
      qMade.map(w => w.id),
      4000
    );
    const picks = await page.evaluate(
      ids => {
        const C = window.EVCore,
          L = c => Object.entries(window.__db[c] || {}).map(([id, d]) => ({ id, ...d }));
        const tomorrow = C.addDays(C.chicagoDate(new Date()), 1);
        const exams = L('exams');
        const models = C.buildWeakspots({ weakspots: L('weakspots'), sets: L('sets'), answers: L('answers'), exams });
        const pick = ws =>
          C.pickReviews({ date: tomorrow, dayType: 'off', exams, weakspots: ws, objectives: L('objectives') });
        // the record's own pick (its older due spots fill the day's load first, so the new ones may wait as deferred),
        // and the same pick with only these two open: both picked
        const r = pick(models),
          own = pick(models.filter(w => ids.includes(w.id) || !C.isActive(w)));
        const has = (xs, id) => xs.some(w => (w.id || w) === id);
        return ids.map(id => ({
          id,
          status: models.find(w => w.id === id).derived.status,
          ranked: has(r.picked, id) || has(r.deferred, id),
          picked: has(own.picked, id),
        }));
      },
      qMade.map(w => w.id)
    );
    ok(
      `${tag} Accept all makes both open and in tomorrow's picks (ranked in the record's, picked when the load allows)`,
      picks.length === 2 && picks.every(x => x.status === 'open' && x.ranked && x.picked),
      JSON.stringify(picks)
    );
    // B-407 review: a proposal that nearly repeats an open spot has Join on, and its row names the target before the tap
    await page.evaluate(async () => {
      const db = await window.claude.use('db');
      const at = new Date().toISOString();
      await db
        .collection('weakspots')
        .doc('ws-harness-near')
        .set({
          schema: 2,
          writer: 'page',
          at,
          source: 'E.V. · harness',
          addedAt: at,
          addedBy: 'page',
          proposed: true,
          topic: 'Fluid volume excess signs',
          objective: 'E4-3',
          exam: 'E4',
          course: 'NUR 112',
          kind: 'concept',
          initial: { streak: 0, nextDue: null, recurrence: 1, misses: 0 },
          events: {},
        });
    });
    await page.click('#tab-study');
    await page.waitForTimeout(200);
    if (await page.isVisible('#study-qweak')) await page.click('#study-qweak');
    await until(page, () => !!document.querySelector('#weak-list .trow[data-id="ws-harness-near"]'), null, 4000);
    const near = await page.evaluate(() => {
      const row = document.querySelector('#weak-list .trow[data-id="ws-harness-near"]');
      const j = row && [...row.querySelectorAll('button')].find(b => b.textContent === 'Join');
      return {
        mini: row ? (row.querySelector('.mini') || {}).textContent : '',
        on: !!j && !j.disabled,
        title: j ? j.title : '',
      };
    });
    ok(
      `${tag} Join is on for a near-repeat and its row names the target: Repeats “Fluid volume excess”?`,
      near.on && /Repeats “Fluid volume excess”\?$/.test(near.mini) && /Fluid volume excess/.test(near.title),
      JSON.stringify(near)
    );
    await page.screenshot({ path: path.join(shots, 'b407-join-target-1280.png') });
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-411 review: one filer per switch, and a session left wrapping up is filed again, on planted sessions
  {
    const t = ms => new Date(Date.now() - ms).toISOString();
    const k = iso => 'page-' + iso.replace(/\D/g, '').slice(0, 8) + '-' + iso.replace(/\D/g, '').slice(8, 17);
    const planted = (id, { status, endAgo, why = 'switched', view, mark }) => {
      const start = t(endAgo + 10 * 60e3),
        end = t(endAgo);
      return {
        schema: 2,
        writer: 'page',
        at: start,
        source: 'E.V. Home',
        kind: 'note',
        status,
        date: start.slice(0, 10),
        startedAt: start,
        planned: 25,
        topic: 'Planted ' + id,
        noteId: '',
        folder: '',
        ...(status === 'ended' ? { endedAt: end } : {}),
        ...(mark ? { filing: mark } : {}),
        events: {
          [k(start)]: { type: 'start' },
          [k(end)]: { type: 'end', why, at: end, ...(view ? { view } : {}) },
        },
      };
    };
    const TAKE = 2 * 60e3;
    const db = JSON.parse(JSON.stringify(seed));
    db.sessions = {
      ...db.sessions,
      'ss-p-other': planted('other', { status: 'ended', endAgo: 20e3, view: 'another-view' }),
      'ss-p-noview': planted('noview', { status: 'ended', endAgo: 20e3 }),
      'ss-p-late': planted('late', { status: 'ended', endAgo: 20e3 + TAKE + 5e3 }),
      'ss-p-ending': planted('ending', { status: 'ending', endAgo: TAKE + 10e3, why: 'ended' }),
      'ss-p-marked': planted('marked', {
        status: 'ending',
        endAgo: 90e3,
        why: 'ended',
        mark: { at: t(60e3), wrap: { summary: 'Filed from the mark.' } },
      }),
    };
    const { page, errors } = await open(browser, { width: 1280, height: 860 }, db);
    const tag = '[1280 filing]';
    const filedAt = id => page.evaluate(i => (window.__db.sessions[i] || {}).filedAt || null, id);
    await until(page, () => !!window.__db.sessions['ss-p-late'].filedAt, null, 12000);
    await until(
      page,
      () => !!window.__db.sessions['ss-p-ending'].filedAt && !!window.__db.sessions['ss-p-marked'].filedAt,
      null,
      12000
    );
    await page.waitForTimeout(2000);
    const got = {};
    for (const id of ['ss-p-other', 'ss-p-noview', 'ss-p-late', 'ss-p-ending', 'ss-p-marked'])
      got[id] = await filedAt(id);
    ok(
      `${tag} at the deadline a switch is not filed by a view that didn't make it, nor one whose end names no view`,
      !got['ss-p-other'] && !got['ss-p-noview'],
      JSON.stringify(got)
    );
    ok(
      `${tag} after the takeover delay any view files a switch whose end names no view`,
      !!got['ss-p-late'],
      JSON.stringify(got)
    );
    const marked = await page.evaluate(() => window.__db.sessions['ss-p-marked']);
    const ending = await page.evaluate(() => window.__db.sessions['ss-p-ending']);
    ok(
      `${tag} a session left wrapping up is filed again: from its mark (its time and summary), or after the takeover delay`,
      ending.status === 'ended' &&
        !!ending.filing &&
        marked.status === 'ended' &&
        marked.filedAt === marked.filing.at &&
        marked.summary === 'Filed from the mark.',
      JSON.stringify({
        ending: [ending.status, !!ending.filing],
        marked: [marked.status, marked.filedAt, marked.summary],
      })
    );
    const order = await page.evaluate(() =>
      window.__writes.filter(w => w[1] === 'sessions' && w[2] === 'ss-p-ending').map(w => Object.keys(w[3]).join(','))
    );
    ok(
      `${tag} the mark lands first and the session's own update (filedAt) last`,
      order.length >= 2 && /^filing$/.test(order[0]) && /filedAt/.test(order[order.length - 1]),
      JSON.stringify(order)
    );
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-409: with the chat open, Escape in Notes' link box closes only the link box
  {
    const { page, errors } = await open(browser, { width: 1280, height: 860 });
    const tag = '[1280 escape]';
    await page.click('#tab-notes');
    await page.click('#notes-new');
    await until(page, () => !document.getElementById('notes-editor').hidden);
    await page.click('#ev-btn');
    await until(page, () => !document.getElementById('evchat').hidden);
    await page.click('#note-body');
    await page.keyboard.type('a link here');
    await page.keyboard.press('Shift+Home');
    await page.click('#notes-editor button[aria-label="Link"]');
    const vis = () =>
      page.evaluate(() => {
        const l = document.querySelector('#notes-editor .n-lkp');
        return {
          link: !!l && l.matches(':popover-open'),
          chat: !document.getElementById('evchat').hidden,
        };
      });
    // B-467: wait on each state, not a fixed 150 ms (the nightly runner was slower than that)
    const settle = fn => page.waitForFunction(fn, null, { timeout: 3000 }).catch(() => {});
    const linkOpen = () => {
      const l = document.querySelector('#notes-editor .n-lkp');
      return !!l && l.matches(':popover-open');
    };
    await settle(linkOpen);
    const before = await vis();
    await page.keyboard.press('Escape');
    await settle(`!(${linkOpen})()`);
    await page.waitForTimeout(100);
    const after = await vis();
    await page.keyboard.press('Escape');
    await settle(() => document.getElementById('evchat').hidden);
    const last = await vis();
    ok(
      `${tag} Escape in the link box closes only the link box; the next Escape closes the chat`,
      before.link && before.chat && !after.link && after.chat && !last.chat,
      JSON.stringify({ before, after, last })
    );
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-409: a Notes session's minutes go to its note's course, in Progress and in Record's course filter
  {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
    const at = new Date(Date.now() - 3 * 3600e3).toISOString();
    const key = iso => 'page-' + iso.replace(/\D/g, '').slice(0, 8) + '-' + iso.replace(/\D/g, '').slice(8, 17);
    const NID = 'n-20261026-090000-coursebio01';
    const SID = 'ss-p-bio-note';
    const planted = JSON.parse(JSON.stringify(seed));
    planted.notes = {
      ...(planted.notes || {}),
      [NID]: {
        schema: 1,
        writer: 'page',
        at,
        source: 'E.V. Home',
        createdAt: at,
        editedAt: at,
        title: 'Membrane transport',
        course: 'BIO 201',
        blocks: [{ type: 'h1', runs: [{ text: 'Membrane transport' }] }],
      },
    };
    planted.sessions = {
      ...planted.sessions,
      [SID]: {
        schema: 2,
        writer: 'page',
        at,
        source: 'E.V. Home',
        kind: 'note',
        status: 'ended',
        date: today,
        startedAt: at,
        endedAt: at,
        filedAt: at,
        planned: 25,
        minutes: 40,
        topic: 'New note',
        noteId: NID,
        note: 'notes/' + NID,
        folder: '',
        events: { [key(at)]: { type: 'start' } },
      },
    };
    const toMin = t => {
      const m = /^(?:(\d+) h)?\s*(?:(\d+) (?:m|min))?$/.exec(String(t || '').trim()) || [];
      return 60 * Number(m[1] || 0) + Number(m[2] || 0);
    };
    const bioWeek = async db => {
      const { page, errors } = await open(browser, { width: 1280, height: 860 }, db);
      await page.click('#tab-progress');
      await page.click('#prog-period [data-p="week"]');
      await page.waitForTimeout(200);
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll('#prog-course > div > :first-child')].map(r => [
          r.firstChild.textContent,
          r.querySelector('.meta').textContent,
        ])
      );
      return { page, errors, bio: toMin((rows.find(r => r[0] === 'BIO 201') || [])[1]), rows };
    };
    const without = await bioWeek(seed);
    await without.page.context().close();
    const { page, errors, bio, rows } = await bioWeek(planted);
    const tag = '[1280 course]';
    ok(
      `${tag} a Notes session's minutes land in its note's course bar in Progress`,
      bio - without.bio === 40,
      JSON.stringify({ with: rows, without: without.bio })
    );
    await page.click('#tab-record');
    await page.waitForTimeout(200);
    await page.click('#rec-types [data-v="all"]'); // B-570: Record opens on Notes; this checks a session row
    await page.waitForTimeout(60);
    const shown = async () =>
      page.evaluate(i => !!document.querySelector(`#rec-list [data-part=row][data-key="${i}"]`), SID);
    const pick = async v => {
      await page.click('#rec-filter-btn');
      await page.click(`#rec-filter [aria-label="Course"] [data-v="${v}"]`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    };
    await pick('BIO 201');
    const inBio = await shown();
    await pick('NUR 112');
    const inNur = await shown();
    await pick('any');
    const name = await page.evaluate(
      i => (document.querySelector(`#rec-list [data-part=row][data-key="${i}"] .nm`) || {}).textContent || '',
      SID
    );
    ok(
      `${tag} Record's course filter finds it under its note's course, named by the note`,
      inBio && !inNur && /Membrane transport/.test(name),
      JSON.stringify({ inBio, inNur, name })
    );
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-409, B-455: a To review row with no objective in the record has Pick an objective in place of the greyed
  // Accept (its course's objectives); a pick accepts it under that one, an open spot due tomorrow. Decline says what it
  // did; the triage pane says nothing proposed counts until he decides. At 390 and 1280.
  for (const width of [390, 1280]) {
    const db = JSON.parse(JSON.stringify(seed));
    const at = new Date(Date.now() - 36e5).toISOString();
    const spot = (topic, extra = {}) => ({
      schema: 2,
      writer: 'page',
      at,
      source: 'More practice',
      topic,
      objective: '',
      exam: '',
      course: 'NUR 112',
      kind: 'concept',
      addedBy: 'page',
      proposed: true,
      initial: { streak: 0, nextDue: null, recurrence: 1, misses: 1 },
      events: {},
      ...extra,
    });
    db.weakspots['ws-harness-noobj'] = spot('Harness spot with no objective');
    db.weakspots['ws-harness-noobj2'] = spot('Harness spot tagged to an objective not in the record', {
      objective: 'Z9-9',
    });
    // B-455 review: a More set whose one question carries no objective, to be missed (a made-up item)
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
    const MSET = 'more-' + day + '-b455';
    db.sets[MSET] = {
      schema: 3,
      writer: 'page',
      at,
      source: 'More practice',
      kind: 'more',
      date: day,
      exam: 'E4',
      title: 'Harness untagged miss',
      createdAt: at,
      items: [
        {
          id: 'm1',
          kind: 'check',
          topic: 'Harness untagged miss',
          type: 'single',
          cjStep: 'recognize-cues',
          stem: 'Harness untagged question: which is right?',
          options: ['Right one', 'Not it one', 'Other one', 'Last one'],
          correct: [0],
          rationales: ['Right.', 'No.', 'No.', 'No.'],
        },
      ],
    };
    const { page, errors } = await open(browser, { width, height: width < 600 ? 844 : 860 }, db);
    const tag = `[${width} B-455 pick an objective]`;
    await page.click('#tab-study');
    await until(page, () => !document.getElementById('p-study').hidden);
    await page.click('#study-qweak');
    await until(page, () => !!document.querySelector('#weak-list .trow[data-id="ws-harness-noobj"]'));
    const want = await page.evaluate(() =>
      Object.entries(window.__db.objectives || {})
        .filter(([, o]) => {
          const e = (window.__db.exams || {})[o.exam];
          return e && String(e.course || '').replace(/\s+/g, '') === 'NUR112';
        })
        .map(([id]) => id)
        .sort()
    );
    const r = await page.evaluate(() => {
      const row = id => document.querySelector(`#weak-list .trow[data-id="${id}"]`);
      const btns = id => (row(id) ? [...row(id).querySelectorAll('.acts > button, .acts > .pick-wrap > button')] : []);
      return {
        row: row('ws-harness-noobj') ? row('ws-harness-noobj').innerText : '',
        btns: btns('ws-harness-noobj').map(b => [b.textContent, b.disabled]),
        btns2: btns('ws-harness-noobj2').map(b => [b.textContent, b.disabled]),
        side: document.body.innerText,
      };
    });
    if (ACCEPT_BARE)
      ok(
        `${tag} B-499: a proposed spot with no objective in the record has Accept (under its course) and Pick an objective`,
        /Under NUR 112/.test(r.row) &&
          JSON.stringify(r.btns) ===
            '[["Accept",false],["Pick an objective",false],["Join",true],["Not now",false],["Decline",false]]' &&
          r.btns2[1] &&
          r.btns2[1][0] === 'Pick an objective',
        JSON.stringify(r)
      );
    else
      ok(
        `${tag} a proposed spot with no objective in the record has Pick an objective in place of the greyed Accept`,
        /Pick an objective first/.test(r.row) &&
          JSON.stringify(r.btns) ===
            '[["Pick an objective",false],["Join",true],["Not now",false],["Decline",false]]' &&
          r.btns2[0] &&
          r.btns2[0][0] === 'Pick an objective',
        JSON.stringify(r)
      );
    ok(
      `${tag} How triage works says "Nothing proposed counts until you decide." and keeps "Not now: back tomorrow"`,
      /Nothing proposed counts until you decide\./.test(r.side) && /Not now: back tomorrow/.test(r.side),
      ''
    );
    const pickSel = '#weak-list .trow[data-id="ws-harness-noobj"] .pick-btn';
    await page.click(pickSel);
    // B-467: wait for the menu to be open and focused, not a fixed 150 ms (red on the slower nightly runner)
    await page
      .waitForFunction(
        () => {
          const m = document.querySelector('#weak-list .trow[data-id="ws-harness-noobj"] .pick-menu');
          return !!m && m.matches(':popover-open') && m.contains(document.activeElement);
        },
        null,
        { timeout: 3000 }
      )
      .catch(() => {});
    const menu = await page.evaluate(() => {
      const m = document.querySelector('#weak-list .trow[data-id="ws-harness-noobj"] .pick-menu');
      const b = document.querySelector('#weak-list .trow[data-id="ws-harness-noobj"] .pick-btn');
      if (!m || !m.matches(':popover-open')) return null;
      const r = m.getBoundingClientRect();
      const items = [...m.querySelectorAll('[role="menuitem"]')];
      return {
        objs: items.map(x => x.dataset.obj).sort(),
        expanded: b.getAttribute('aria-expanded'),
        focused: items.includes(document.activeElement),
        inView: r.left >= 0 && r.right <= innerWidth + 0.5,
        tall: items.every(x => x.getBoundingClientRect().height >= (innerWidth < 600 ? 44 : 28)),
      };
    });
    ok(
      `${tag} the menu lists the course's objectives, opens focused, inside the screen, its rows tall enough to tap`,
      !!menu &&
        want.length > 0 &&
        JSON.stringify(menu.objs) === JSON.stringify(want) &&
        menu.expanded === 'true' &&
        menu.focused &&
        menu.inView &&
        menu.tall,
      JSON.stringify({ menu, want })
    );
    await page.screenshot({ path: path.join(shots, `b455-pick-objective-${width}.png`) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const closed = await page.evaluate(
      () => !document.querySelector('#weak-list .trow[data-id="ws-harness-noobj"] .pick-menu').matches(':popover-open')
    );
    ok(`${tag} Escape closes the menu`, closed, '');
    // a tap outside (a pointer, no focus change needed) closes it too
    await page.click(pickSel);
    await page.waitForTimeout(100);
    const reopened = await page.evaluate(() =>
      document.querySelector('#weak-list .trow[data-id="ws-harness-noobj"] .pick-menu').matches(':popover-open')
    );
    await page.click('#weak-list .dayh');
    await page.waitForTimeout(100);
    const tapped = await page.evaluate(() => {
      const row = document.querySelector('#weak-list .trow[data-id="ws-harness-noobj"]');
      return [
        !row.querySelector('.pick-menu').matches(':popover-open'),
        row.querySelector('.pick-btn').getAttribute('aria-expanded'),
      ];
    });
    ok(
      `${tag} a tap outside closes the menu`,
      reopened && tapped[0] === true && tapped[1] === 'false',
      JSON.stringify({ reopened, tapped })
    );
    const pickId = want[0];
    // a record update landing now redraws the list and closes the menu (talk/memory, written 2 s behind a reply): open
    // it again until the pick lands
    const isAccepted = () =>
      until(
        page,
        id =>
          Object.values((window.__db.weakspots['ws-harness-noobj'] || {}).events || {}).some(
            e => e.type === 'accept' && e.objective === id && e.by === 'owner'
          ),
        pickId,
        1500
      );
    let accepted = false;
    for (let i = 0; i < 4 && !accepted; i++) {
      if (!(await page.locator(pickSel).count())) break;
      await page.click(pickSel);
      await page.waitForTimeout(150);
      const item = page.locator(`#weak-list .trow[data-id="ws-harness-noobj"] .pick-menu [data-obj="${pickId}"]`);
      if (await item.isVisible()) await item.click({ timeout: 2000 }).catch(() => {});
      accepted = await isAccepted();
    }
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => {
      const C = window.EVCore,
        L = c => Object.entries(window.__db[c] || {}).map(([id, d]) => ({ id, ...d }));
      const m = C.buildWeakspots({
        weakspots: L('weakspots'),
        sets: L('sets'),
        answers: L('answers'),
        exams: L('exams'),
      }).find(w => w.id === 'ws-harness-noobj');
      return {
        status: m && m.derived.status,
        nextDue: m && m.derived.nextDue,
        objective: m && m.objective,
        tomorrow: C.addDays(C.chicagoDate(new Date()), 1),
        listed: !!document.querySelector('#weak-list .wl[data-id="ws-harness-noobj"]'),
        stillToReview: !!document.querySelector('#weak-list .trow[data-id="ws-harness-noobj"]'),
      };
    });
    ok(
      `${tag} a pick accepts it under that objective: an open spot due tomorrow, in the Open list`,
      accepted &&
        st.status === 'open' &&
        st.nextDue === st.tomorrow &&
        st.objective === pickId &&
        st.listed &&
        !st.stillToReview,
      JSON.stringify({ accepted, st, pickId })
    );
    await page.screenshot({ path: path.join(shots, `b455-picked-${width}.png`) });
    await page.click('#weak-list .trow[data-id="ws-harness-noobj2"] button:has-text("Decline")');
    const declined = await until(page, () => {
      const x = document.getElementById('toast');
      return x && !x.hidden && x.textContent === 'Declined. Nothing is counted.';
    });
    ok(`${tag} Decline says "Declined. Nothing is counted."`, declined, '');
    // B-455 (c): a More set's untagged question missed: the end card says it needs an objective picked, with no Accept
    // all (nothing to accept there) and Review the primary; Review opens Weak spots on that row's Pick an objective
    await openSet(page, MSET);
    await page.waitForTimeout(300);
    await page.locator('#pr-body label.opt', { hasText: 'Not it one' }).click();
    await page.waitForTimeout(200);
    const res = page.locator('#pr-body button', { hasText: 'See results' }).first();
    if (await res.isVisible().catch(() => false)) await res.click();
    await until(page, () => !!document.querySelector('#pr-body .endline'), null, 4000);
    const made = await page.evaluate(() =>
      Object.entries(window.__db.weakspots)
        .filter(([, w]) => w.topic === 'Harness untagged miss')
        .map(([id, w]) => ({ id, objective: w.objective, proposed: !!w.proposed }))
    );
    const end = await page.evaluate(() => {
      const l = document.querySelector('#pr-body .endline');
      return {
        text: l.querySelector('.sp').textContent,
        btns: [...l.querySelectorAll('button')].map(b => [b.textContent, b.classList.contains('primary')]),
      };
    });
    if (ACCEPT_BARE) {
      ok(
        `${tag} B-499: the end card's Accept all takes the miss with no objective, under its course`,
        made.length === 1 &&
          made[0].proposed &&
          !made[0].objective &&
          end.text === '1 miss is proposed as a weak spot.' &&
          JSON.stringify(end.btns) === '[["Accept all",true],["Review",false]]',
        JSON.stringify({ made, end })
      );
      await page.screenshot({ path: path.join(shots, `b455-end-card-${width}.png`) });
      await page.locator('#pr-body .endline button', { hasText: 'Accept all' }).click();
      const took = await until(
        page,
        id =>
          Object.values((window.__db.weakspots[id] || {}).events || {}).some(
            e => e.type === 'accept' && !('objective' in e) && e.by === 'owner'
          ),
        made[0] && made[0].id,
        4000
      );
      await page.click('#study-qweak'); // the end line goes once nothing waits for his triage
      const later = await until(
        page,
        id => !!document.querySelector(`#weak-list .wl[data-id="${id}"] .pick-btn`),
        made[0] && made[0].id,
        4000
      );
      ok(`${tag} B-499: accepted, it is open in the Open list with Pick an objective for later`, took && later, '');
      ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
      await page.context().close();
      continue;
    }
    ok(
      `${tag} the end card says the miss needs an objective picked, hides Accept all and makes Review the primary`,
      made.length === 1 &&
        made[0].proposed &&
        !made[0].objective &&
        end.text === '1 miss is proposed as a weak spot. It needs an objective picked.' &&
        JSON.stringify(end.btns) === '[["Review",true]]',
      JSON.stringify({ made, end })
    );
    await page.screenshot({ path: path.join(shots, `b455-end-card-${width}.png`) });
    await page.locator('#pr-body .endline button', { hasText: 'Review' }).click();
    const focused = await until(
      page,
      id => {
        const a = document.activeElement;
        return !!a && a.classList.contains('pick-btn') && !!a.closest(`#weak-list .trow[data-id="${id}"]`);
      },
      made[0] && made[0].id,
      4000
    );
    ok(`${tag} Review opens Weak spots with that row's Pick an objective focused`, focused, '');
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }
  // B-455: with no objectives in the record for its course, Accept stays greyed and says why (390)
  {
    const db = JSON.parse(JSON.stringify(seed));
    db.objectives = {};
    db.weakspots['ws-harness-none'] = {
      schema: 2,
      writer: 'page',
      at: new Date(Date.now() - 36e5).toISOString(),
      source: 'More practice',
      topic: 'Harness spot in a course with no objectives',
      objective: '',
      exam: '',
      course: 'NUR 112',
      kind: 'concept',
      addedBy: 'page',
      proposed: true,
      initial: { streak: 0, nextDue: null, recurrence: 1, misses: 1 },
      events: {},
    };
    const { page, errors } = await open(browser, { width: 390, height: 844 }, db);
    const tag = '[390 B-455 no objectives]';
    await page.click('#tab-study');
    await until(page, () => !document.getElementById('p-study').hidden);
    await page.click('#study-qweak');
    await until(page, () => !!document.querySelector('#weak-list .trow[data-id="ws-harness-none"]'));
    const r = await page.evaluate(() => {
      const row = document.querySelector('#weak-list .trow[data-id="ws-harness-none"]');
      const b = row.querySelector('.acts > button');
      return { acc: [b.textContent, b.disabled, b.title], pick: !!row.querySelector('.pick-btn') };
    });
    if (ACCEPT_BARE) {
      // B-499: Accept files it under its course with no objective; it opens from tomorrow in the Open list
      await page.click('#weak-list .trow[data-id="ws-harness-none"] .acts > button');
      const took = await until(
        page,
        () =>
          Object.values((window.__db.weakspots['ws-harness-none'] || {}).events || {}).some(
            e => e.type === 'accept' && !('objective' in e)
          ),
        null,
        4000
      );
      const listed = await until(page, () => !!document.querySelector('#weak-list .wl[data-id="ws-harness-none"]'));
      ok(
        `${tag} B-499: Accept works with no objectives in the record: the spot is open under its course`,
        r.acc[0] === 'Accept' && r.acc[1] === false && !r.pick && took && listed,
        JSON.stringify(r)
      );
    } else
      ok(
        `${tag} Accept is greyed with "No objectives in the record for its course yet", and no menu`,
        r.acc[0] === 'Accept' &&
          r.acc[1] === true &&
          r.acc[2] === 'No objectives in the record for its course yet' &&
          !r.pick,
        JSON.stringify(r)
      );
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-418 (D-339): read-along is on by default in the note he is writing, session or not; the toggle in the note's
  // header turns it off for that note (remembered across a reload, and only for that note); a quick note with no new
  // text asks Claude nothing
  {
    const { page, errors } = await open(browser, { width: 1280, height: 860 });
    const tag = '[1280 read-along]';
    const reads = () =>
      page.evaluate(
        () => (window.__jsonCalls || []).filter(x => /reading over his shoulder/.test(JSON.stringify(x.prompt))).length
      );
    const readNow = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const toggle = () =>
      page.evaluate(() => {
        const b = document.getElementById('notes-read');
        return b && b.getClientRects().length ? { text: b.textContent, pressed: b.getAttribute('aria-pressed') } : null;
      });
    const noteThread = id => 'th-' + ('note-' + id).replace(/[^A-Za-z0-9-]/g, '-').slice(0, 77);
    const linesIn = th =>
      page.evaluate(
        t =>
          Object.values(window.__db.talk || {}).flatMap(d =>
            Object.values(d.messages || {})
              .filter(m => m.thread === t)
              .map(m => m.text)
          ),
        th
      );
    await page.evaluate(() => {
      window.__jsonCalls = [];
      window.__sampleFn = p =>
        /reading over his shoulder/.test(JSON.stringify(p))
          ? { say: 'Right: low potassium flattens the T wave.', quote: null, kind: 'exam' }
          : {};
    });
    await page.click('#tab-notes');
    await until(page, () => !document.getElementById('p-notes').hidden);
    const [n1, n2] = await page.evaluate(() =>
      [...document.querySelectorAll('#notes-rows [data-part=row]')].map(r => r.dataset.note)
    );
    const sessionsBefore = await page.evaluate(() => Object.keys(window.__db.sessions || {}).length);

    // a note he has, opened with no session: the toggle reads Reading along, and a new line gets her word in the note's
    // own chat
    await openFromList(page, n1);
    await until(page, () => !document.getElementById('notes-editor').hidden);
    const t1 = await toggle();
    ok(
      `${tag} the note's header shows the toggle on by default`,
      !!t1 && t1.text === 'Reading along' && t1.pressed === 'true',
      JSON.stringify(t1)
    );
    await readNow();
    await page.waitForTimeout(1600); // the first read takes what is written as read: no ask
    const r0 = await reads();
    await page.click('#note-body');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Hypokalemia flattens the T wave and brings out a U wave.');
    await page.keyboard.press('Enter');
    await settle(page);
    await readNow();
    const said = await until(
      page,
      th =>
        Object.values(window.__db.talk || {}).some(d =>
          Object.values(d.messages || {}).some(m => m.thread === th && /flattens the T wave/.test(m.text))
        ),
      noteThread(n1),
      6000
    );
    const prompt = await page.evaluate(() => {
      const c = (window.__jsonCalls || [])
        .filter(x => /reading over his shoulder/.test(JSON.stringify(x.prompt)))
        .pop();
      return c ? String(c.prompt) : '';
    });
    ok(
      `${tag} with no session, opening a note asks nothing, and a new line is read and answered in the note's chat`,
      r0 === 0 &&
        said &&
        /brings out a U wave/.test(prompt) &&
        (await page.evaluate(() => Object.keys(window.__db.sessions || {}).length)) === sessionsBefore,
      JSON.stringify({ r0, said, prompt: prompt.slice(-160) })
    );
    const lines = await linesIn(noteThread(n1));
    ok(`${tag} her line on the note is one line in that note's chat`, lines.length === 1, JSON.stringify(lines));
    // the same text again is never read twice
    const r1 = await reads();
    await page.evaluate(() => {
      const real = Date.now.bind(Date);
      Date.now = () => real() + 80e3; // past the 75 s gap
    });
    await readNow();
    await page.waitForTimeout(1600);
    ok(`${tag} unchanged text is not read again`, (await reads()) === r1, String((await reads()) - r1));

    // off: the toggle says so, and a new line is not read
    await page.click('#notes-read');
    const t2 = await toggle();
    await page.click('#note-body');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('Peaked T waves mean hyperkalemia: check the potassium now.');
    await page.keyboard.press('Enter');
    await settle(page);
    await readNow();
    await page.waitForTimeout(1600);
    ok(
      `${tag} the toggle turns read-along off, and then a new line goes to no one`,
      !!t2 && t2.text === 'Not reading' && t2.pressed === 'false' && (await reads()) === r1,
      JSON.stringify({ t2, reads: (await reads()) - r1 })
    );
    await page.screenshot({ path: path.join(shots, 'b418-read-along-off-1280.png') });

    // remembered per note: off again after a reload, and another note still reads along
    await page.reload();
    await until(page, () => /^Live$/.test((document.getElementById('status') || {}).textContent || ''), null, 8000);
    await page.click('#tab-notes');
    await until(page, () => !document.getElementById('p-notes').hidden);
    await openFromList(page, n1);
    await until(page, () => !document.getElementById('notes-editor').hidden);
    const t3 = await toggle();
    await page.click('.mh button[aria-label="Back to Notes"]');
    await until(page, () => !document.getElementById('notes-list').hidden);
    await openFromList(page, n2);
    await until(page, () => !document.getElementById('notes-editor').hidden);
    const t4 = await toggle();
    ok(
      `${tag} the toggle is remembered for its note across a reload, and only for that note`,
      !!t3 && t3.pressed === 'false' && !!t4 && t4.pressed === 'true',
      JSON.stringify({ t3, t4 })
    );

    // B-430: a ceiling refusal is said once, and read-along asks nothing more until the ceiling resets
    await page.evaluate(() => {
      window.__jsonCalls = [];
      window.__toasts = [];
      // every toast() call stamps data-at: each stamp with the ceiling's words is one showing, however alike (review)
      new MutationObserver(ms => {
        const t = document.getElementById('toast');
        for (const m of ms)
          if (m.attributeName === 'data-at' && /allowance/.test(t.textContent)) window.__toasts.push(t.textContent);
      }).observe(document.getElementById('toast'), { attributes: true, attributeFilter: ['data-at'] });
      const until = Date.now() + 30 * 60e3;
      window.__sampleFn = p => {
        if (/reading over his shoulder/.test(JSON.stringify(p)))
          throw Object.assign(
            new Error('E.V. has used this hour’s Claude allowance, so asking Claude pauses until 5:00 pm.'),
            {
              code: 'ceiling',
              scope: 'hour',
              until,
            }
          );
        return {};
      };
    });
    for (const line of ['Hyperkalemia peaks the T wave first.', 'Then the QRS widens as potassium climbs.']) {
      await page.evaluate(() => {
        const real = Date.now;
        Date.now = () => real() + 80e3; // past the 75 s gap each time
      });
      await page.click('#note-body');
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type(line);
      await page.keyboard.press('Enter');
      await settle(page);
      await readNow();
      await page.waitForTimeout(1600);
    }
    const ceil = await page.evaluate(() => ({ toasts: window.__toasts.length }));
    const ceilReads = await reads();
    ok(
      `${tag} at a Claude ceiling read-along says so once and asks nothing more until it resets`,
      ceilReads === 1 && ceil.toasts === 1,
      JSON.stringify({ reads: ceilReads, ...ceil })
    );

    // a quick note: New note, nothing written, asks Claude nothing
    await page.evaluate(() => {
      window.__jsonCalls = [];
    });
    await page.click('.mh button[aria-label="Back to Notes"]');
    await until(page, () => !document.getElementById('notes-list').hidden);
    await page.click('#notes-new');
    await until(page, () => !document.getElementById('notes-editor').hidden);
    await settle(page);
    for (let i = 0; i < 3; i++) {
      await readNow();
      await page.waitForTimeout(1200);
    }
    const t5 = await toggle();
    ok(
      `${tag} a new note reads along by default, and with no new text it asks Claude nothing`,
      !!t5 && t5.pressed === 'true' && (await reads()) === 0,
      JSON.stringify({ t5, reads: await reads() })
    );
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-438: in a note the session's clock counts only the time he writes. Nothing typed for 2 minutes pauses it
  // (from his last keystroke) and his next keystroke starts it again, read-along on or off; End files the writing
  // minutes to the session and Record. Her chat opens from the note at any time, to ask or for questions again.
  {
    const { page, errors } = await open(browser, { width: 1280, height: 860 });
    const tag = '[1280 writing clock]';
    const clock = () =>
      page.evaluate(() => {
        const s = document.getElementById('ev-sslot');
        return {
          text: (s.querySelector('.s-left') || {}).textContent || '',
          paused: s.classList.contains('paused'),
        };
      });
    const secs = t => {
      const m = /(\d+):(\d\d)/.exec(t);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const sessNow = () =>
      page.evaluate(() =>
        Object.entries(window.__db.sessions || {})
          .map(([id, d]) => ({ id, ...d }))
          .find(x => x.status === 'active')
      );
    const evsOf = (s, type) => Object.values((s && s.events) || {}).filter(e => e.type === type);
    const typeMore = async t => {
      await page.click('#note-body');
      await page.keyboard.press('Control+End');
      await page.keyboard.type(t);
      await settle(page);
    };
    // past the idle gap by the page's clock (Date.now runs 125 s ahead), until the pause lands, then back
    const idle = async () => {
      await page.evaluate(() => {
        const real = Date.now.bind(Date);
        window.__realNow = real;
        Date.now = () => real() + 125e3;
      });
      const done = await until(page, () => /^Paused · /.test(document.querySelector('#ev-sslot .s-left').textContent));
      await page.evaluate(() => {
        Date.now = window.__realNow;
      });
      return done;
    };
    await page.click('#tab-notes');
    await until(page, () => !document.getElementById('p-notes').hidden);
    await page.click('#notes-new');
    await until(page, () => /writing/.test((document.querySelector('#ev-sslot .s-left') || {}).textContent || ''));
    await page.click('#notes-read'); // read-along off for this note
    const ra = await page.evaluate(() => document.getElementById('notes-read').getAttribute('aria-pressed'));
    await page.click('#note-body');
    await page.keyboard.type('# Acid-base');
    await page.keyboard.press('Enter');
    await page.keyboard.type('A low pH with a high CO2 is respiratory acidosis.');
    await settle(page);
    const c1 = await clock();
    await page.waitForTimeout(2100);
    const c2 = await clock();
    ok(
      `${tag} with read-along off, the strip's clock counts up the writing time`,
      ra === 'false' && /^\d+:\d\d writing$/.test(c1.text) && secs(c2.text) > secs(c1.text) && !c2.paused,
      JSON.stringify({ ra, c1, c2 })
    );
    const s0 = await sessNow();
    const typedBy = Date.now();
    const paused = await idle();
    const s1 = await sessNow();
    const p1 = evsOf(s1, 'pause')[0] || {};
    const c3 = await clock();
    await page.waitForTimeout(2100);
    const c4 = await clock();
    ok(
      `${tag} nothing typed for 2 minutes pauses it from his last keystroke, and the paused clock stands still`,
      paused &&
        !!p1.from &&
        Date.parse(p1.from) >= Date.parse(s0.startedAt) &&
        Date.parse(p1.from) <= typedBy &&
        c3.paused &&
        secs(c4.text) === secs(c3.text),
      JSON.stringify({ paused, p1, c3, c4 })
    );
    await page.screenshot({ path: path.join(shots, 'notes-writing-paused-1280.png') });
    await typeMore(' Kidneys compensate by keeping bicarbonate.');
    const s2 = await sessNow();
    await page.waitForTimeout(1100);
    const c5 = await clock();
    ok(
      `${tag} his next keystroke starts it again (a write event), counting on from where it stood`,
      evsOf(s2, 'write').length === 1 &&
        /^\d+:\d\d writing$/.test(c5.text) &&
        !c5.paused &&
        secs(c5.text) >= secs(c4.text) &&
        secs(c5.text) <= secs(c4.text) + 4,
      JSON.stringify({ writes: evsOf(s2, 'write').length, c4, c5 })
    );
    // the same with read-along on
    await page.click('#notes-read');
    const ra2 = await page.evaluate(() => document.getElementById('notes-read').getAttribute('aria-pressed'));
    const pausedOn = await idle();
    await typeMore(' A high pH with low CO2 is respiratory alkalosis.');
    const s3 = await sessNow();
    ok(
      `${tag} with read-along on, it pauses and starts again the same way`,
      ra2 === 'true' && pausedOn && evsOf(s3, 'pause').length === 2 && evsOf(s3, 'write').length === 2,
      JSON.stringify({ ra2, pausedOn, pauses: evsOf(s3, 'pause').length, writes: evsOf(s3, 'write').length })
    );

    // her chat opens from the note at any time: the strip's E.V. button, in a session, on a break, and with no session;
    // Quiz me on this note stays offered after he has asked it
    const chatOpens = async () => {
      if (await page.evaluate(() => !document.getElementById('evchat').hidden)) {
        await page.keyboard.press('Escape');
        await until(page, () => document.getElementById('evchat').hidden);
      }
      await page.click('#ev-btn');
      return until(page, () => !document.getElementById('evchat').hidden, null, 2000);
    };
    const chips = () =>
      page.evaluate(() => [...document.querySelectorAll('#evchat .pchips .qchip')].map(b => b.textContent));
    const inSession = await chatOpens();
    // B-623: the chip is answered in code (the session's check), never left to her words
    const n0 = await page.evaluate(() => document.querySelectorAll('#evchat .msgs .mev').length);
    await page.click('#evchat .pchips .qchip');
    await until(page, n => document.querySelectorAll('#evchat .msgs .mev').length > n, n0, 6000);
    const again = await chips();
    await page.keyboard.press('Escape');
    await page.click('#ev-sslot .s-brk');
    await until(page, () => /^Break/.test(document.querySelector('#ev-sslot .s-left').textContent), null, 3000);
    const onBreak = await chatOpens();
    await page.keyboard.press('Escape');
    await page.click('#ev-sslot .s-brk'); // Resume
    await page.waitForTimeout(400);
    ok(
      `${tag} her chat opens from the note in a session and on a break, and "Quiz me on this note" is offered again after he asked it`,
      inSession && onBreak && again.includes('Quiz me on this note'),
      JSON.stringify({ inSession, onBreak, again })
    );
    // End files the writing minutes, as the record's clock counts them, to the session and Record
    const sEnd = await sessNow();
    await page.click('#ev-sslot .s-end');
    const filed = await until(page, i => !!(window.__db.sessions[i] || {}).filedAt, sEnd.id, 30000);
    const fd = await page.evaluate(i => window.__db.sessions[i], sEnd.id);
    ok(
      `${tag} End files the session with its writing minutes and no planned end`,
      filed && fd.status === 'ended' && Number.isInteger(fd.minutes) && fd.clock === 'writing' && !fd.planned,
      JSON.stringify({ filed, status: fd && fd.status, minutes: fd && fd.minutes })
    );
    const noSession = await chatOpens();
    const sug = await page.evaluate(() => document.getElementById('ev-sug').textContent);
    ok(
      `${tag} with no session running, her chat still opens from the note`,
      noSession && !!sug,
      JSON.stringify({ noSession, sug })
    );
    // B-623: with no session, the chip is answered in code in this chat (no model turn); and her words promising
    // questions with nothing started that turn are followed by the quiz itself, started then (B-623 review: never replaced)
    const QUIZ_LINE = /right here|so I’m writing five|Already writing a batch|needs permission/;
    const evLines = () =>
      page.evaluate(() => [...document.querySelectorAll('#evchat .msgs .mev')].map(e => e.textContent));
    await page.evaluate(() => {
      window.__chatScript = [];
      window.__chatReply = 'MODEL-SAID-THIS';
    });
    const q0n = (await evLines()).length;
    await page.fill('#evc-input', 'Quiz me on this note');
    await page.press('#evc-input', 'Enter');
    await until(page, n => document.querySelectorAll('#evchat .msgs .mev').length > n, q0n, 6000);
    const chipLine = (await evLines()).slice(q0n).join(' ');
    ok(
      `${tag} "Quiz me on this note" with no session starts the quiz in code, in this chat, with no model reply`,
      QUIZ_LINE.test(chipLine) && !/MODEL-SAID-THIS/.test(chipLine),
      chipLine.slice(0, 160)
    );
    await page.evaluate(() => {
      window.__chatReply = 'Five Chapter 9 questions are being written and will appear here in about a minute.';
    });
    const q1n = (await evLines()).length;
    await page.fill('#evc-input', 'Can you test me?');
    await page.press('#evc-input', 'Enter');
    await until(
      page,
      n => document.querySelectorAll('#evchat .msgs .mev').length > n && !document.querySelector('#evchat .dots'),
      q1n,
      6000
    );
    const promised = (await evLines()).slice(q1n).join(' ');
    ok(
      `${tag} a reply promising questions with nothing started keeps her words and the quiz, started that turn, follows`,
      QUIZ_LINE.test(promised) &&
        /being written/.test(promised) &&
        promised.search(/being written/) < promised.search(QUIZ_LINE),
      promised.slice(0, 160)
    );
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-438: the minutes filed are the writing minutes only. A planted session started 40 minutes ago, paused from
  // 30 to 20 minutes ago and its note last saved 10 minutes ago, pauses on open from that save (no keystroke since),
  // and End files 20 minutes, which Record shows; with read-along off
  {
    // one base time for the whole fixture, so its times never straddle a millisecond (a 19:59 read)
    const base = Date.now();
    const iso = ago => new Date(base - ago * 60e3).toISOString();
    const k = s => 'page-' + s.replace(/\D/g, '').slice(0, 8) + '-' + s.replace(/\D/g, '').slice(8, 17);
    const NID = 'n-20261028-090000-writingclock';
    const SID = 'ss-p-writing-clock';
    const db = JSON.parse(JSON.stringify(seed));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
    db.notes = {
      ...(db.notes || {}),
      [NID]: {
        schema: 1,
        writer: 'page',
        at: iso(40),
        source: 'E.V. Home',
        createdAt: iso(40),
        editedAt: iso(10),
        title: 'Respiratory compensation',
        course: 'NUR 112',
        blocks: [
          { type: 'h1', runs: [{ text: 'Respiratory compensation' }] },
          { type: 'p', runs: [{ text: 'The kidneys hold bicarbonate.' }] },
        ],
      },
    };
    db.sessions = {
      ...db.sessions,
      [SID]: {
        schema: 2,
        writer: 'page',
        at: iso(40),
        source: 'E.V. Home',
        kind: 'note',
        status: 'active',
        comments: 'some',
        date: today,
        startedAt: iso(40),
        clock: 'writing',
        topic: 'Respiratory compensation',
        noteId: NID,
        note: 'notes/' + NID,
        folder: '',
        driver: { view: '', at: iso(40) },
        events: {
          [k(iso(40))]: { type: 'start' },
          [k(iso(28))]: { type: 'pause', from: iso(30), at: iso(28) },
          [k(iso(20))]: { type: 'write', at: iso(20) },
        },
      },
    };
    const { page, errors } = await open(browser, { width: 1280, height: 860 }, db);
    const tag = '[1280 writing minutes]';
    await page.click('#tab-notes');
    await openFromList(page, NID);
    await page.click('#notes-read'); // read-along off
    const ra = await page.evaluate(() => document.getElementById('notes-read').getAttribute('aria-pressed'));
    const paused = await until(
      page,
      () => /^Paused · 20:0\d$/.test((document.querySelector('#ev-sslot .s-left') || {}).textContent || ''),
      null,
      6000
    );
    const pz = await page.evaluate(
      i => Object.values(window.__db.sessions[i].events).filter(e => e.type === 'pause'),
      SID
    );
    const left = await page.evaluate(() => document.querySelector('#ev-sslot .s-left').textContent);
    ok(
      `${tag} opened 10 minutes after his last writing, it shows Paused at 20 minutes written, paused from then`,
      ra === 'false' &&
        paused &&
        pz.length === 2 &&
        pz.some(e => Math.abs(Date.parse(e.from) - Date.parse(iso(10))) < 5e3),
      JSON.stringify({ ra, paused, left, pz })
    );
    await page.click('#ev-sslot .s-end');
    const filed = await until(page, i => !!(window.__db.sessions[i] || {}).filedAt, SID, 30000);
    const mins = await page.evaluate(i => window.__db.sessions[i].minutes, SID);
    await page.click('#tab-record');
    await page.click('#rec-types [data-v="all"]'); // B-570: Record opens on Notes; this reads a session row
    await page.waitForTimeout(300);
    const row = await page.evaluate(
      i => (document.querySelector(`#rec-list [data-part=row][data-key="${i}"] .r`) || {}).textContent || '',
      SID
    );
    ok(
      `${tag} End files 20 writing minutes of the 40 since it started, and Record shows them`,
      filed && mins === 20 && /^20 min\b/.test(row),
      JSON.stringify({ filed, mins, row })
    );
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-454: a saved note he opens and writes in starts its writing session too, once a few seconds of real edits
  // are in (writingStartSeconds), as a new note's does; opening, reading or scrolling it starts nothing. Reopening the
  // note after End and writing in it again starts another.
  {
    const iso = ago => new Date(Date.now() - ago * 60e3).toISOString();
    const NID = 'n-20261027-080000-oldnote';
    const NID2 = 'n-20261027-070000-othernote';
    const db = JSON.parse(JSON.stringify(seed));
    db.notes = {
      ...(db.notes || {}),
      [NID]: {
        schema: 1,
        writer: 'page',
        at: iso(24 * 60),
        source: 'E.V. Home',
        createdAt: iso(24 * 60),
        editedAt: iso(24 * 60),
        title: 'Heart failure',
        course: 'NUR 112',
        blocks: [
          { type: 'h1', runs: [{ text: 'Heart failure' }] },
          ...Array.from({ length: 40 }, (_, i) => ({
            type: 'p',
            runs: [{ text: `Line ${i + 1} on preload and afterload.` }],
          })),
        ],
      },
      [NID2]: {
        schema: 1,
        writer: 'page',
        at: iso(24 * 60),
        source: 'E.V. Home',
        createdAt: iso(24 * 60),
        editedAt: iso(24 * 60),
        title: 'Shock',
        course: 'NUR 112',
        blocks: [
          { type: 'h1', runs: [{ text: 'Shock' }] },
          { type: 'p', runs: [{ text: 'Low perfusion to the tissues.' }] },
        ],
      },
    };
    const { page, errors } = await open(browser, { width: 1280, height: 860 }, db);
    const tag = '[1280 old note writing]';
    const onNote = () =>
      page.evaluate(
        id =>
          Object.entries(window.__db.sessions || {})
            .map(([sid, d]) => ({ id: sid, ...d }))
            .filter(x => x.note === 'notes/' + id),
        NID
      );
    const active = async () => (await onNote()).filter(x => x.status === 'active');
    // a few seconds of real edits: one key every 150 ms for about 5 s
    const write = async t => {
      await page.click('#note-body');
      await page.keyboard.press('Control+End');
      await page.keyboard.type(t, { delay: 150 });
    };
    await page.click('#tab-notes');
    await openFromList(page, NID);
    // opened, read and scrolled, with nothing typed: no session
    await page.evaluate(() => {
      const s = document.querySelector('#p-notes .n-scroll');
      s.scrollTop = 400;
    });
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(6000);
    const read = await onNote();
    ok(
      `${tag} opening, reading and scrolling an old note starts no session`,
      read.length === 0 && !(await page.isVisible('#ev-sslot .s-end')),
      JSON.stringify(read.map(x => x.id))
    );
    await write(' The left side backs up into the lungs.');
    const started = await until(
      page,
      id => Object.values(window.__db.sessions || {}).some(x => x.status === 'active' && x.note === 'notes/' + id),
      NID,
      6000
    );
    const s1 = (await active())[0] || {};
    const left1 = await page.evaluate(() => (document.querySelector('#ev-sslot .s-left') || {}).textContent || '');
    ok(
      `${tag} a few seconds of writing in it starts a writing session on that note, its clock in the strip`,
      started &&
        (await active()).length === 1 &&
        s1.clock === 'writing' &&
        s1.noteId === NID &&
        !s1.planned &&
        /writing$/.test(left1),
      JSON.stringify({ started, active: (await active()).map(x => x.id), clock: s1.clock, left1 })
    );
    await page.screenshot({ path: path.join(shots, 'notes-old-note-writing-1280.png') });
    // End it, leave for the list, and reopen the note: reading starts nothing, writing starts a new session
    if (s1.id) await page.click('#ev-sslot .s-end');
    const filed = !!s1.id && (await until(page, i => !!(window.__db.sessions[i] || {}).filedAt, s1.id, 30000));
    await page.click('button[aria-label="Back to Notes"]');
    await until(page, () => document.getElementById('notes-editor').hidden);
    await page.click('#tab-today');
    await page.waitForTimeout(300);
    await page.click('#tab-notes');
    await openFromList(page, NID);
    await page.waitForTimeout(6000);
    const reread = await active();
    await write(' The right side backs up into the body.');
    const again = await until(
      page,
      ([id, was]) =>
        Object.entries(window.__db.sessions || {}).some(
          ([sid, x]) => sid !== was && x.status === 'active' && x.note === 'notes/' + id
        ),
      [NID, s1.id],
      6000
    );
    await page.waitForTimeout(1500);
    const act2 = await active();
    const s2 = act2[0] || {};
    const s1after = (await onNote()).find(x => x.id === s1.id) || {};
    ok(
      `${tag} reopened after End, reading starts nothing and writing starts exactly one new writing session; the ended one stays filed`,
      filed &&
        reread.length === 0 &&
        again &&
        act2.length === 1 &&
        s2.id !== s1.id &&
        s2.clock === 'writing' &&
        s1after.status === 'ended' &&
        !!s1after.filedAt,
      JSON.stringify({ filed, reread: reread.length, again, act2: act2.map(x => x.id), s1: s1after.status })
    );
    const endIt = async sid => {
      await page.click('#ev-sslot .s-end');
      return until(page, i => !!(window.__db.sessions[i] || {}).filedAt, sid, 30000);
    };
    const allActive = () =>
      page.evaluate(() =>
        Object.entries(window.__db.sessions || {})
          .filter(([, x]) => x.status === 'active')
          .map(([id, x]) => ({ id, note: x.note }))
      );
    const e2 = !!s2.id && (await endIt(s2.id));
    // B-454 review: on a slow link (each write held 6 s) writing on through the start makes one session, not two
    await page.evaluate(() => {
      window.__writeDelayMs = 6000;
    });
    await page.click('#note-body');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Fluid backs up behind the failing side, so the lungs fill.', { delay: 150 });
    await until(
      page,
      id => Object.values(window.__db.sessions || {}).some(x => x.status === 'active' && x.note === 'notes/' + id),
      NID,
      15000
    );
    await page.keyboard.type(' More words.', { delay: 150 });
    await page.waitForTimeout(7000);
    const slow = await allActive();
    const e3 = slow.length === 1 && (await endIt(slow[0].id));
    // a new note on the slow link: its own start is on its way while he writes on, so no second start
    await page.click('button[aria-label="Back to Notes"]');
    await until(page, () => document.getElementById('notes-editor').hidden);
    const before = await notesIn(page);
    await page.click('#notes-new');
    await until(page, () => !document.getElementById('notes-editor').hidden);
    await page.click('#note-body');
    await page.keyboard.type('Slow link note. Writing on while it starts.', { delay: 150 });
    await page.waitForTimeout(9000);
    const fresh = await allActive();
    const newId = (await notesIn(page)).find(i => !before.includes(i));
    ok(
      `${tag} on a slow link, writing on while a start is on its way makes exactly one session (an old note, and a new note)`,
      e2 &&
        slow.length === 1 &&
        slow[0].note === 'notes/' + NID &&
        e3 &&
        fresh.length === 1 &&
        fresh[0].note === 'notes/' + newId,
      JSON.stringify({ e2, slow, e3, fresh, newId })
    );
    if (fresh.length) await endIt(fresh[0].id);
    await page.evaluate(() => {
      window.__writeDelayMs = 0;
    });
    // offline: writing in a saved note starts nothing and says nothing
    await page.evaluate(() => {
      window.__toasts = [];
      new MutationObserver(() => {
        const t = document.getElementById('toast');
        if (!t.hidden && t.textContent) window.__toasts.push(t.textContent);
      }).observe(document.getElementById('toast'), {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
      });
      window.dispatchEvent(
        new CustomEvent('ev-sync', { detail: { online: false, pending: 0, syncing: false, refused: [] } })
      );
    });
    await page.click('button[aria-label="Back to Notes"]');
    await until(page, () => document.getElementById('notes-editor').hidden);
    await openFromList(page, NID);
    await write(' Offline words, kept on this device.');
    await page.waitForTimeout(1500);
    const off = { active: (await allActive()).length, toasts: await page.evaluate(() => window.__toasts.slice()) };
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('ev-sync', { detail: { online: true, pending: 0, syncing: false, refused: [] } })
      )
    );
    ok(
      `${tag} offline, writing starts nothing and no toast`,
      off.active === 0 && !off.toasts.length,
      JSON.stringify(off)
    );
    // D-361: a start refused offline (the shim's offline flag) holds auto-starts until the connection comes back
    await page.evaluate(() => {
      window.__writeFail = 'unavailable';
      window.__writeFailOffline = true;
    });
    await write(' A start refused while the link drops.');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__writeFail = '';
      window.__writeFailOffline = false;
    });
    await write(' Held until the connection is back.');
    await page.waitForTimeout(1500);
    const offHeld = { active: (await allActive()).length, toasts: await page.evaluate(() => window.__toasts.slice()) };
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await write(' Back online, writing starts it again.');
    const offBack = await until(
      page,
      () => Object.values(window.__db.sessions || {}).some(x => x.status === 'active'),
      null,
      6000
    );
    await page.waitForTimeout(1500);
    const offRec = await allActive();
    ok(
      `${tag} a start refused offline is quiet and holds until the online event, then writing starts exactly one session`,
      offHeld.active === 0 && !offHeld.toasts.length && offBack && offRec.length === 1,
      JSON.stringify({ offHeld, offBack, offRec })
    );
    if (offRec.length) await endIt(offRec[0].id);
    // D-361: refused online (no offline flag, no online event): quiet, held for its backoff, then one more try works
    const shift = ms =>
      page.evaluate(ms => {
        if (!window.__realNow) window.__realNow = Date.now.bind(Date);
        const real = window.__realNow;
        Date.now = () => real() + ms;
      }, ms);
    await page.evaluate(() => {
      window.__writeFail = 'unavailable';
    });
    await write(' A start the record refuses.');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__writeFail = '';
    });
    await write(' Held while it backs off, still writing.');
    await page.waitForTimeout(1500);
    const held = { active: (await allActive()).length, toasts: await page.evaluate(() => window.__toasts.slice()) };
    await shift(61e3);
    await write(' After the backoff, writing starts it.');
    const recovered = await until(
      page,
      () => Object.values(window.__db.sessions || {}).some(x => x.status === 'active'),
      null,
      6000
    );
    await page.waitForTimeout(1500);
    const rec = await allActive();
    ok(
      `${tag} refused online, it is quiet and held for its backoff, then writing starts exactly one session with no online event`,
      held.active === 0 && !held.toasts.length && recovered && rec.length === 1 && rec[0].note === 'notes/' + NID,
      JSON.stringify({ held, recovered, rec })
    );
    if (rec.length) await endIt(rec[0].id);
    // refused again and left uncounted past 2 minutes: one quiet line in the strip, no toast
    await page.evaluate(() => {
      window.__writeFail = 'unavailable';
    });
    await write(' Refused again, and he keeps on writing.');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__writeFail = '';
    });
    await shift(61e3 + 125e3);
    await page.keyboard.type(' ok'); // still writing in it (a burst too short to start anything)
    const quiet = await until(
      page,
      () => {
        const u = document.getElementById('ev-uncounted'),
          g = document.getElementById('ev-sug');
        return (
          !!u && !u.hidden && /isn’t being counted right now/.test(u.textContent) && !g.disabled && !!g.textContent
        );
      },
      null,
      4000
    );
    const qToasts = await page.evaluate(() => window.__toasts.slice());
    await page.screenshot({ path: path.join(shots, 'notes-uncounted-1280.png') });
    // the line is that note's only: another note keeps its Study control and shows no line
    await page.click('button[aria-label="Back to Notes"]');
    await until(page, () => document.getElementById('notes-editor').hidden);
    await openFromList(page, NID2);
    await page.waitForTimeout(1200);
    const other = await page.evaluate(() => ({
      line: !document.getElementById('ev-uncounted').hidden,
      sug: document.getElementById('ev-sug').textContent,
      off: document.getElementById('ev-sug').disabled,
    }));
    ok(
      `${tag} the quiet line stays on the refused note: another note shows none and keeps Study this note with E.V.`,
      !other.line && other.sug === 'Study this note with E.V.' && !other.off,
      JSON.stringify(other)
    );
    await page.evaluate(() => {
      Date.now = window.__realNow;
      window.__realNow = null;
    });
    // a start through New note lands: the quiet line goes, and the backoff with it
    await page.click('button[aria-label="Back to Notes"]');
    await until(page, () => document.getElementById('notes-editor').hidden);
    await page.click('#notes-new');
    const viaNew = await until(
      page,
      () => /writing$/.test((document.querySelector('#ev-sslot .s-left') || {}).textContent || ''),
      null,
      8000
    );
    const nw = await allActive();
    if (nw.length) await endIt(nw[0].id);
    await page.click('button[aria-label="Back to Notes"]');
    await until(page, () => document.getElementById('notes-editor').hidden);
    await openFromList(page, NID);
    const sugAfter = await page.evaluate(() =>
      document.getElementById('ev-uncounted').hidden ? '' : document.getElementById('ev-uncounted').textContent
    );
    await write(' Counted again at once, with no wait at all.');
    const cleared = await until(
      page,
      id => Object.values(window.__db.sessions || {}).some(x => x.status === 'active' && x.note === 'notes/' + id),
      NID,
      6000
    );
    await page.waitForTimeout(1500);
    ok(
      `${tag} uncounted past 2 minutes shows one quiet line and no toast; a New note start clears it and the backoff`,
      quiet &&
        !qToasts.length &&
        viaNew &&
        !/isn’t being counted/.test(sugAfter) &&
        cleared &&
        (await allActive()).length === 1,
      JSON.stringify({ quiet, qToasts, viaNew, sugAfter, cleared })
    );
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-437: Enter with the caret before a heading's trailing space makes a line he can see (a block holding only
  // spaces was drawn with no height: the caret seemed to jump to the next heading and no line appeared)
  {
    const { page, errors } = await open(browser, { width: 1280, height: 860 });
    const tag = '[1280 enter]';
    await page.click('#tab-notes');
    await until(page, () => !document.getElementById('p-notes').hidden);
    await page.click('#notes-new');
    await until(page, () => !document.getElementById('notes-editor').hidden);
    await page.click('#note-body');
    await page.keyboard.type('IM and Subcutaneous ');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Fluid Balance');
    // both lines as headings 2, then the caret back to the first line, before its trailing space
    for (const k of ['Home', 'ArrowUp']) await page.keyboard.press(k);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+Alt+Digit2');
    await page.keyboard.press('ArrowUp');
    // End (as a click at the line's end) puts the caret after the last word, before the space a browser doesn't show
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await settle(page);
    const lines = await page.evaluate(() =>
      [...document.querySelectorAll('#note-body > .nb')].map(n => ({
        t: n.getAttribute('data-t'),
        text: n.textContent,
        h: Math.round(n.getBoundingClientRect().height),
      }))
    );
    const made = lines[1];
    ok(
      `${tag} Enter before a heading's trailing space makes a new line with height, between the two headings`,
      lines.length === 3 && !!made && made.t === 'p' && made.h >= 18 && lines[2].text === 'Fluid Balance',
      JSON.stringify(lines)
    );
    await page.screenshot({ path: path.join(shots, 'b437-enter-space-1280.png') });
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-441: back from a long note scrolled down, the list shows from its top (it was left at the note's scroll
  // place, below the short list, and read as a blank page); B-440: a new note opens on a grey "Untitled" heading 1, and
  // its hint leaves as soon as he types
  {
    const { page, errors } = await open(browser, { width: 1280, height: 860 });
    const tag = '[1280 list back]';
    await page.click('#tab-notes');
    await until(page, () => !document.getElementById('p-notes').hidden);
    const first = await page.evaluate(() => document.querySelector('#notes-rows [data-part=row]').dataset.note);
    await openFromList(page, first);
    await until(page, () => !document.getElementById('notes-editor').hidden);
    await page.click('#note-body');
    await page.keyboard.press('Control+End');
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press('Enter');
      await page.keyboard.insertText('Line ' + i + ' of a long note about pediatric dosing by weight.');
    }
    await settle(page);
    await page.evaluate(() => {
      window.scrollTo(0, 1e6);
      for (const e of document.querySelectorAll('#p-notes *'))
        if (e.scrollHeight > e.clientHeight + 4) e.scrollTop = 1e6;
    });
    for (let round = 0; round < 2; round++) {
      await page.click('.mh button[aria-label="Back to Notes"]');
      await until(page, () => !document.getElementById('notes-list').hidden);
      await page.waitForTimeout(300);
      const seen = await page.evaluate(() => {
        const r = document.querySelector('#notes-rows [data-part=row]');
        const b = r && r.getBoundingClientRect();
        return { y: b ? Math.round(b.top) : null, h: innerHeight, sy: Math.round(scrollY) };
      });
      ok(
        `${tag} back from a long note scrolled to its end, the list's first row is on screen (round ${round + 1})`,
        seen.y != null && seen.y >= 0 && seen.y < seen.h,
        JSON.stringify(seen)
      );
      await openFromList(page, first);
      await until(page, () => !document.getElementById('notes-editor').hidden);
      await page.evaluate(() => window.scrollTo(0, 1e6));
    }
    await page.click('.mh button[aria-label="Back to Notes"]');
    await until(page, () => !document.getElementById('notes-list').hidden);
    await page.click('#notes-new');
    await until(page, () => !document.getElementById('notes-editor').hidden);
    await settle(page);
    const fresh = await page.evaluate(() => {
      const b = document.getElementById('note-body');
      const f = b.firstElementChild;
      return {
        t: f && f.getAttribute('data-t'),
        untitled: getComputedStyle(f, '::before').content,
        empty: b.classList.contains('empty'),
      };
    });
    await page.keyboard.type('W');
    const typed = await page.evaluate(() => {
      const b = document.getElementById('note-body');
      return { empty: b.classList.contains('empty'), untitled: b.classList.contains('untitled') };
    });
    ok(
      `${tag} a new note opens on a grey "Untitled" heading 1 with the hint, and both leave at the first letter`,
      fresh.t === 'h1' && /Untitled/.test(fresh.untitled) && fresh.empty && !typed.empty && !typed.untitled,
      JSON.stringify({ fresh, typed })
    );
    await page.screenshot({ path: path.join(shots, 'b440-untitled-1280.png') });
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-442: words selected in a note offer Ask E.V., which quotes them into the chat; an ask from the note sends it
  // whole once, and the next ask the same copy with only what changed since (her lookup of it is not read again)
  {
    const { page, errors } = await open(browser, { width: 1280, height: 860 });
    const tag = '[1280 B-442]';
    await page.click('#tab-notes');
    await until(page, () => !document.getElementById('p-notes').hidden);
    const id = await page.evaluate(() => document.querySelector('#notes-rows [data-part=row]').dataset.note);
    await openFromList(page, id);
    await until(page, () => !document.getElementById('notes-editor').hidden);
    const chipOff = await page.evaluate(() => document.getElementById('note-ask').hidden);
    const quote = await page.evaluate(() => {
      const b = document.getElementById('note-body');
      const blk = [...b.children].find(x => x.textContent.trim().length > 12);
      b.focus();
      const r = document.createRange();
      r.selectNodeContents(blk);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      return String(getSelection()).replace(/\s+/g, ' ').trim();
    });
    await until(page, () => !document.getElementById('note-ask').hidden, null, 2000);
    const chip = await page.evaluate(() => {
      const r = document.getElementById('note-ask').getBoundingClientRect();
      return {
        text: document.getElementById('note-ask').textContent,
        x: r.left,
        y: r.top,
        w: innerWidth,
        h: innerHeight,
      };
    });
    ok(
      `${tag} no chip until words are selected; then "Ask E.V." shows on screen by the selection`,
      chipOff && chip.text === 'Ask E.V.' && chip.x >= 0 && chip.x < chip.w && chip.y >= 0 && chip.y < chip.h,
      JSON.stringify(chip)
    );
    // review: the chip never stays over another view (the selection survives a tab click)
    await page.click('#tab-today');
    await until(page, () => !document.getElementById('p-today').hidden, null, 2000);
    await page.waitForTimeout(200);
    const away = await page.evaluate(() => ({
      chip: document.getElementById('note-ask').hidden,
      sel: String(getSelection()).length,
    }));
    ok(`${tag} on Today the Ask E.V. chip is gone`, away.chip, JSON.stringify(away));
    await page.click('#tab-notes');
    await until(page, () => !document.getElementById('notes-editor').hidden, null, 2000);
    await page.evaluate(() => {
      const b = document.getElementById('note-body');
      const blk = [...b.children].find(x => x.textContent.trim().length > 12);
      b.focus();
      const r = document.createRange();
      r.selectNodeContents(blk);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await until(page, () => !document.getElementById('note-ask').hidden, null, 2000);
    await page.click('#note-ask');
    await until(page, () => !document.getElementById('evchat').hidden, null, 2000);
    const box = await page.evaluate(() => document.getElementById('evc-input').value);
    ok(
      `${tag} Ask E.V. opens the chat with the selected words quoted in its box`,
      box === '“' + quote.slice(0, 600) + '” ',
      JSON.stringify(box)
    );
    await page.evaluate(i => {
      window.__chatCalls = [];
      window.__toolResults = [];
      window.__chatScript = [{ tool: 'lookup', input: { what: 'notes', id: i } }];
      window.__chatReply = 'It ties to your preload line.';
    }, id);
    await page.click('#evc-input');
    await page.keyboard.press('End');
    await page.keyboard.type('what does this mean?');
    await page.keyboard.press('Enter');
    await until(page, () => window.__chatCalls.length === 1 && !document.querySelector('#evchat .dots'), null, 4000);
    await page.waitForTimeout(300);
    // he writes a line, then asks again
    await page.click('#note-body');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Afterload rises with vasoconstriction.');
    await page.fill('#evc-input', 'And this new line?');
    await page.press('#evc-input', 'Enter');
    await until(page, () => window.__chatCalls.length === 2, null, 4000);
    const asks = await page.evaluate(() =>
      window.__chatCalls.map(c => ({ first: c.input[0].content, last: c.input[c.input.length - 1].content }))
    );
    const results = await page.evaluate(() => window.__toolResults.map(String));
    const head = s => String(s).split('--- end of his note ---')[0];
    ok(
      `${tag} the first ask sends the note whole at the top, with its id`,
      asks[0] && /whole, as E\.V\. last read it/.test(asks[0].first) && asks[0].first.includes('notes id ' + id),
      asks[0] && asks[0].first.slice(0, 200)
    );
    ok(
      `${tag} the second sends the same copy byte for byte, and only the new line as a change with his question`,
      asks[1] &&
        head(asks[1].first) === head(asks[0].first) &&
        !head(asks[1].first).includes('Afterload rises') &&
        /\+ Afterload rises with vasoconstriction\.\n\nHe asks: And this new line\?$/.test(asks[1].last),
      asks[1] && asks[1].last.slice(-300)
    );
    ok(
      `${tag} her lookup of the note she was sent whole does not read it again`,
      results.length >= 1 && /already whole at the top/.test(results[0]) && results.every(r => r.length < 400),
      results.map(r => r.slice(0, 120)).join(' | ')
    );
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-474: a selection across a bulleted, numbered and checklist list highlights only the item text: each list
  // line is its own selection root (Safari fills a selection's left gap from the editor's edge, under the markers)
  for (const scheme of ['light', 'dark']) {
    const { page, errors } = await open(browser, { width: 1280, height: 860 });
    await page.emulateMedia({ colorScheme: scheme });
    const tag = `[1280 ${scheme} B-474]`;
    await page.click('#tab-notes');
    await until(page, () => !document.getElementById('p-notes').hidden);
    await page.click('#notes-new');
    await until(page, () => !document.getElementById('notes-editor').hidden);
    await page.keyboard.type('Lists');
    await page.keyboard.press('Enter');
    for (const [pre, items] of [
      ['- ', ['Preload rises with volume', 'Afterload rises with resistance']],
      ['1. ', ['Assess', 'Diagnose', 'Plan']],
      ['[] ', ['Read chapter 12', 'Practice set']],
    ]) {
      await page.keyboard.type(pre);
      for (const t of items) {
        await page.keyboard.type(t);
        await page.keyboard.press('Enter');
      }
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type('After the lists.');
    await settle(page);
    const at = await page.evaluate(() => {
      const k = [...document.getElementById('note-body').children];
      const a = k[1].getBoundingClientRect();
      const z = k[k.length - 1].getBoundingClientRect();
      return { ax: a.left + 60, ay: a.top + a.height / 2, zx: z.left + 30, zy: z.top + z.height / 2 };
    });
    await page.mouse.move(at.ax, at.ay);
    await page.mouse.down();
    await page.mouse.move(at.zx, at.zy, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const seen = await page.evaluate(() => {
      const lists = [
        ...document.querySelectorAll('#note-body .nb[data-t=ul],#note-body .nb[data-t=ol],#note-body .nb[data-t=todo]'),
      ];
      const sel = getSelection();
      return {
        n: lists.length,
        roots: lists.every(e => getComputedStyle(e).transform !== 'none'),
        inSel: lists.filter(e => sel.containsNode(e, true)).length,
        chk: [...document.querySelectorAll('#note-body .n-chk')].every(c => getComputedStyle(c).userSelect === 'none'),
      };
    });
    ok(
      `${tag} a selection across the three kinds of list covers them, each line its own selection root, checkboxes unselectable`,
      seen.n === 7 && seen.roots && seen.inSel === 7 && seen.chk,
      JSON.stringify(seen)
    );
    await page.screenshot({ path: path.join(shots, `b474-list-selection-${scheme}-1280.png`) });
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- B-520 (F-45, F-46): New note takes the course Notes is filtered to, an empty one is never written, and a note
  // task's Write opens its note in its course (a new one titled as the task, then the same one again), at 1280 and 390
  const planNoteTask = page =>
    page.evaluate(async () => {
      const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
      const db = await window.claude.use('db');
      const ref = db.collection('dayedits').doc(t);
      const got = await ref.get();
      const doc = got && got.exists ? got.data() : { schema: 1, writer: 'page', source: 'E.V. Home', date: t };
      const at = new Date().toISOString();
      doc.added = {
        ...(doc.added || {}),
        'add-harness-note': {
          text: 'Finish the made-up bone remodeling line',
          tag: 'NOTES',
          kind: 'notes',
          minutes: 10,
          course: 'BIO 201',
          at,
          by: 'E.V.',
        },
      };
      doc.at = doc.updatedAt = at;
      await ref.set(doc);
    });
  const openNoteTask = async page => {
    await page.click('#tab-today');
    await page.waitForTimeout(250);
    await page
      .locator('#today-list .li', { hasText: 'Finish the made-up bone remodeling line' })
      .locator('.nm')
      .click();
    await until(page, () => !!document.querySelector('#today-task .tp-write'), null, 2000);
  };
  {
    const { page, errors } = await open(browser, { width: 1280, height: 900 });
    const tag = '[B-520 1280]';
    await page.click('#tab-notes');
    await until(page, () => !document.getElementById('p-notes').hidden);
    const n0 = await notesIn(page);
    await page.click('#notes-filters [data-filter="BIO 201"]');
    await page.click('#notes-new');
    await until(page, () => !document.getElementById('notes-editor').hidden);
    const course = (await page.textContent('#notes-editor .n-course')).trim();
    await settle(page);
    await page.click('button[aria-label="Back to Notes"]');
    await settle(page, 400);
    const n1 = await notesIn(page);
    ok(
      `${tag} New note under the BIO 201 filter is a BIO 201 note, and left empty it is never written`,
      course === 'BIO 201' && n1.length === n0.length,
      JSON.stringify({ course, n0: n0.length, n1: n1.length })
    );
    await planNoteTask(page);
    await openNoteTask(page);
    const wr = await page.evaluate(() => {
      const b = document.querySelector('#today-task .tp-write');
      return { text: b ? b.textContent.trim() : '', primary: !!b && b.classList.contains('primary') };
    });
    await page.click('#today-task .tp-write');
    await until(page, () => !document.getElementById('notes-editor').hidden, null, 3000);
    await settle(page);
    const w1 = await page.evaluate(() => ({
      view: document.body.dataset.view,
      h1: (document.querySelector('#note-body > [data-t="h1"]') || {}).textContent || '',
      course: document.querySelector('#notes-editor .n-course').textContent.trim(),
    }));
    const made = (await notesIn(page)).filter(x => !n0.includes(x));
    const doc = made.length === 1 ? await savedDoc(page, made[0]) : null;
    await page.screenshot({ path: path.join(shots, 'b520-write-1280.png') });
    ok(
      `${tag} a note task's Write is its one primary; it opens Notes on a new note titled as the task, in the task's course, written at once`,
      wr.text === 'Write' &&
        wr.primary &&
        w1.view === 'notes' &&
        w1.h1 === 'Finish the made-up bone remodeling line' &&
        w1.course === 'BIO 201' &&
        !!doc &&
        doc.course === 'BIO 201' &&
        doc.title === 'Finish the made-up bone remodeling line',
      JSON.stringify({ wr, w1, made, doc: doc && { title: doc.title, course: doc.course } })
    );
    await page.click('button[aria-label="Back to Notes"]');
    await settle(page, 400);
    await openNoteTask(page);
    await page.click('#today-task .tp-write');
    await until(page, () => !document.getElementById('notes-editor').hidden, null, 3000);
    await settle(page, 600);
    const open2 = await page.evaluate(
      () => (document.querySelector('#note-body > [data-t="h1"]') || {}).textContent || ''
    );
    const made2 = (await notesIn(page)).filter(x => !n0.includes(x));
    ok(
      `${tag} Write again opens that same note: no second note`,
      made2.length === 1 && open2 === 'Finish the made-up bone remodeling line',
      JSON.stringify({ made2, open2 })
    );
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }
  {
    const { page, errors } = await open(browser, { width: 390, height: 844 });
    const tag = '[B-520 390]';
    await planNoteTask(page);
    await openNoteTask(page);
    await page.click('#today-task .tp-write');
    await page.waitForTimeout(300);
    const sheet = await page.evaluate(() => ({
      open: document.getElementById('new-dlg').open,
      head: document.getElementById('new-head').textContent,
      title: document.getElementById('new-title').value,
      course: (document.querySelector('#new-course [aria-pressed="true"]') || {}).textContent || '',
    }));
    await page.screenshot({ path: path.join(shots, 'b520-write-390.png') });
    ok(
      `${tag} on the phone a note task's Write opens New note titled as the task, in its course`,
      sheet.open &&
        sheet.head === 'New note' &&
        sheet.title === 'Finish the made-up bone remodeling line' &&
        sheet.course === 'BIO 201',
      JSON.stringify(sheet)
    );
    await page.keyboard.press('Escape');
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ---- 390: no Notes
  {
    const { page, errors } = await open(browser, { width: 390, height: 844 });
    const tag = '[390]';
    ok(`${tag} no Notes entry on the phone`, !(await page.isVisible('#tab-notes')), '');
    await page.evaluate(() => (location.hash = 'notes'));
    await page.waitForTimeout(300);
    const shown = await page.evaluate(() => {
      const p = document.getElementById('p-notes');
      return !!p && !p.hidden && p.getBoundingClientRect().height > 0;
    });
    ok(`${tag} #notes does not open Notes on the phone`, !shown, '');
    // B-409: the phone's session reads no note, and E.V.'s instructions never say it does
    await page.click('#tab-ev');
    const send = async t => {
      await page.fill('#ev-input', t);
      await page.locator('#ev-form').evaluate(f => f.requestSubmit());
    };
    await send('Start a study session');
    await until(page, () => Object.values(window.__db.sessions || {}).some(x => x.status === 'active'), null, 6000);
    await page.waitForTimeout(500);
    const n0 = await page.evaluate(() => window.__chatCalls.length);
    await send('How is my session going?');
    await until(page, n => window.__chatCalls.length > n, n0, 6000);
    const sys = await page.evaluate(() => {
      const c = window.__chatCalls[window.__chatCalls.length - 1];
      return JSON.stringify(c && c.input);
    });
    const line = (/Study session running on [^"]*?(?=\\n|")/.exec(sys) || [''])[0];
    ok(
      `${tag} a session with no note: E.V.'s instructions name his objectives and weak spots and never say she reads a note`,
      /his objectives and weak spots/.test(line) && !/reads his note|from his note|his newest writing/i.test(line),
      line.slice(0, 240)
    );
    ok(`${tag} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  await browser.close();
  for (const [s, n, d] of results) console.log(`${s}  ${n}${d && s === 'FAIL' ? '\n      ' + d : ''}`);
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\nnotes: ${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
