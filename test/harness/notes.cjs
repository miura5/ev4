// The Notes editor (B-402, D-325): on the synthetic record at 1280, New note twice gives two notes in the record, '# '
// makes a heading, Bold and Undo/Redo work from the format bar, a pasted script stays text-free and inert, and the text
// survives a reload. At 390 there is no Notes entry, and #notes does not open it. B-403, the list: course filters with
// counts, notes grouped by course, the picked note's preview (From, Edited, Length, Studied, On this page, Open note,
// Study with E.V.), the empty states for no notes at all and for none in a course, and nothing overflowing, at 1280,
// 1706 and 2560 on synthetic, synthetic with no notes, and synthetic with a long-title note.
//   node test/harness/notes.cjs [record dir | synthetic] [screenshots dir]
// Run `node tools/build.mjs` first. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const dbDir = require('../data/synthetic.cjs').recordDir(args[0] || 'synthetic');
const shots = args[1] || '/tmp/ev4-notes';
fs.mkdirSync(shots, { recursive: true });
const pageDir = path.join(root, 'dist/page/staging');
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
      rows: [...document.querySelectorAll('#notes-rows .n-row')].map(r => ({
        id: r.dataset.note,
        name: txt(r.querySelector('.nm')),
        sel: r.classList.contains('sel'),
        kind: txt(r.querySelector('.nk')),
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
const openNoteId = page =>
  page.evaluate(() => {
    const w = (window.__writes || []).filter(x => x[1] === 'notes');
    return w.length ? w[w.length - 1][2] : null;
  });

(async () => {
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

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
      `${tag} the notes are grouped by course with counts, 44 px rows with label and day, the first picked`,
      JSON.stringify(L0.groups) === JSON.stringify(['NUR 112 2', 'BIO 201 1']) &&
        L0.rows.length === 3 &&
        L0.rows.every(r => r.h >= 44 && r.kind && r.when) &&
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
        JSON.stringify(L2.groups) === JSON.stringify(['BIO 201 1']) &&
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
    await page.click('.n-back');
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
    await page.click('.n-back');
    await until(page, () => !document.getElementById('notes-list').hidden);

    // New note twice: two new notes, two ids
    await page.click('#notes-new');
    await until(page, () => !document.getElementById('notes-editor').hidden);
    await settle(page);
    const id1 = await openNoteId(page);
    await page.click('.n-back');
    await page.click('#notes-new');
    await settle(page);
    const id2 = await openNoteId(page);
    const after = await notesIn(page);
    const fresh = after.filter(x => !before.includes(x));
    ok(
      `${tag} New note twice writes two notes, each with its own id`,
      fresh.length === 2 && id1 && id2 && id1 !== id2 && fresh.every(x => /^n-\d{8}-\d{6}-[A-Za-z0-9]{12,}$/.test(x)),
      JSON.stringify({ fresh, id1, id2 })
    );

    // '# ' makes a heading
    await page.click('#note-body');
    await page.keyboard.type('# Fluids lecture');
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
    await page.click('.n-back');
    await page.waitForTimeout(400);
    const stayed = await page.evaluate(() => !document.getElementById('notes-editor').hidden);
    await page.evaluate(() => (window.__writeFail = null));
    await page.click('.n-back');
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
    await page.click('.n-pick .ver:first-child button'); // Keep this version: this device's
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
    await page.click('.n-back');
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

    // B-404: an edit that shrinks a note already past the size cap is allowed (only growth past it is refused)
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
      `${tag} an edit that shrinks a note already past the size cap is allowed`,
      shrunk.lines === linesBefore - 1 && !/too long/.test(shrunk.toast),
      JSON.stringify({ linesBefore, ...shrunk })
    );
    await paste('', 'y'.repeat(20000)); // a change through apply() that leaves it past the cap and larger
    await page.waitForTimeout(300);
    const grown = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && !t.hidden ? t.textContent : '';
    });
    ok(`${tag} while growing it past the cap is still refused`, /too long to save/.test(grown), grown);

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
          L.filters.length === 3 && L.groups.length === 2 && L.pv.title && L.pv.fixed && !L.over.length && !L.hscroll,
          JSON.stringify({ f: L.filters, g: L.groups, over: L.over.slice(0, 3) })
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
          `${tag} the long title is cut with an ellipsis in its row; label and day keep their place; nothing overflows`,
          !!row && (row.cut || width > 2000) && row.h === 44 && row.when && row.kind && !L.over.length && !L.hscroll,
          JSON.stringify({ row, over: L.over.slice(0, 4) })
        );
        ok(
          `${tag} the preview shows the whole title wrapped, its sections, and Studied from the session that named it`,
          L.pv.title === longTitle &&
            L.pv.props.Studied === '25 min, today' &&
            L.pv.props.From === longLabel &&
            L.pv.outline.length === 2 &&
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
