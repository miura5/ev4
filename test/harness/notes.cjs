// The Notes editor (B-402, D-325): on the synthetic record at 1280, New note twice gives two notes in the record, '# '
// makes a heading, Bold and Undo/Redo work from the format bar, a pasted script stays text-free and inert, and the text
// survives a reload. At 390 there is no Notes entry, and #notes does not open it.
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
async function open(browser, viewport) {
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
  await page.addInitScript(init);
  await page.goto(ORIGIN + '/');
  await until(page, () => /^Live$/.test((document.getElementById('status') || {}).textContent || ''), null, 8000);
  return { page, errors };
}
const notesIn = page => page.evaluate(() => Object.keys(window.__db.notes || {}));
const savedDoc = (page, id) => page.evaluate(i => (window.__db.notes || {})[i] || null, id);
const settle = (page, ms = 1300) => page.waitForTimeout(ms); // the autosave's pause (800 ms) and the write
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
    await page.click(`#notes-rows [data-note="${id2}"]`);
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
    await page.click(`#notes-rows [data-note="${id2}"]`);
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

    // B-402 review, D-326: a stale save (409) is not tried again, so the other device's version is never overwritten
    const w1 = await noteWrites();
    await page.keyboard.press(`${mod}+End`);
    await page.evaluate(() => (window.__writeFail = 'conflict'));
    await page.keyboard.type(' stale');
    await settle(page);
    const other = await page.evaluate(i => {
      window.__writeFail = null;
      const d = JSON.parse(JSON.stringify(window.__db.notes[i]));
      d.blocks = [{ type: 'h1', runs: [{ text: 'Written on the other device' }] }];
      d.title = 'Written on the other device';
      window.__db.notes[i] = d;
      return JSON.stringify(d);
    }, id2);
    await page.keyboard.type(' more');
    await settle(page, 1600);
    await page.click('.n-back');
    await page.waitForTimeout(400);
    const stale = await page.evaluate(() => ({
      sync: (document.querySelector('.mh .n-sync') || {}).textContent || '',
      text: document.getElementById('note-body').lastElementChild.textContent,
      open: !document.getElementById('notes-editor').hidden,
    }));
    const now409 = JSON.stringify(await savedDoc(page, id2));
    ok(
      `${tag} a 409 says Not saved: changed on another device, keeps his text, is not retried and overwrites nothing`,
      /Not saved: changed on another device/.test(stale.sync) &&
        / stale more$/.test(stale.text) &&
        stale.open &&
        (await noteWrites()) === w1 &&
        now409 === other,
      JSON.stringify({ stale, writes: (await noteWrites()) - w1, same: now409 === other })
    );

    ok(
      `${tag} no page error`,
      errors.filter(e => !/permission_denied|conflict/.test(e)).length === 0,
      errors.slice(0, 3).join(' | ')
    );
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
