// Clicks through the demo or the built page like a person: from each start, every visible control (nav items,
// tabs, buttons, rows, chips), then every control that click revealed, two clicks deep.
// Usage: node tools/fidelity/crawl.cjs demo|built [width] [starts] ; screenshots to
// $FIDELITY_OUT/crawl-<target>-<width>/ with index.json mapping each shot to its start and click path.
// Starts (comma-separated): for the demo, board names in demo/project. The default is AppNotes (the whole app in
// the L-frame, opening on Notes; D-327) and NoteEditor (a note open, so the format bar's style menu and link
// popover, E.V.'s strip, its pop-up chat, history and minimize are one and two clicks in); Main is the old demo's
// whole app. For the built page: app (as it boots), notes (the Notes tab) and note (the first note opened);
// the default is all three, and the Notes starts are skipped, with a line saying so, while the page has no Notes tab.
// Read only: the built page runs on the synthetic record.
const { chromium } = require('playwright');
const fs = require('fs'),
  path = require('path'),
  http = require('http');
const target = process.argv[2] || 'demo';
const width = +(process.argv[3] || 1280);
const starts = (process.argv[4] || (target === 'demo' ? 'AppNotes,NoteEditor' : 'app,notes,note')).split(',');
const vp = { width, height: width < 600 ? 844 : 900 };
const out =
  (process.env.FIDELITY_OUT || '/tmp/fidelity') +
  `/crawl-${target}${process.env.RECORD_DIR && target === 'built' ? '-record' : ''}-${width}`;
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(__dirname, '../..');
const SKIP = /^(delete|remove|sign out|log out|reset|send)$/i;

async function openDemo(page, board) {
  await page.goto(`http://localhost:8713/project/${board}.dc.html`);
  await page.waitForTimeout(1500);
}
let srv;
function demoServer() {
  const dr = path.join(__dirname, 'demo');
  srv = http
    .createServer((q, r) => {
      const p = path.join(dr, decodeURIComponent(q.url.split('?')[0]));
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return (r.writeHead(404), r.end());
      r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' });
      fs.createReadStream(p).pipe(r);
    })
    .listen(8713);
}
// The built page, booted exactly as built.cjs does it.
function builtSetup() {
  const dbDir = process.env.RECORD_DIR || require(root + '/test/data/synthetic.cjs').recordDir('synthetic'); // RECORD_DIR: a snapshot outside the repo
  const pageDir = path.join(root, 'dist/page/staging');
  const load = dir => {
    const db = {};
    for (const c of fs.readdirSync(dir)) {
      const p = path.join(dir, c);
      if (!fs.statSync(p).isDirectory()) continue;
      db[c] = {};
      for (const f of fs.readdirSync(p))
        if (f.endsWith('.json')) db[c][f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8'));
    }
    return db;
  };
  const seed = load(dbDir);
  for (const c of ['legacy', 'debug', 'journal']) delete seed[c];
  const stub = fs.readFileSync(path.join(root, 'test/harness/stub.js'), 'utf8');
  const T = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html' };
  const skel = b =>
    '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>' +
    b +
    '</body></html>';
  return async (page, start) => {
    await page.route('https://ev.local/**', r => {
      const name = new URL(r.request().url()).pathname.replace(/^\//, '') || 'index.html';
      if (name === 'index.html')
        return r.fulfill({
          body: skel(fs.readFileSync(path.join(pageDir, 'index.html'), 'utf8')),
          contentType: 'text/html',
        });
      const f = path.join(pageDir, name);
      return fs.existsSync(f)
        ? r.fulfill({ body: fs.readFileSync(f), contentType: T[path.extname(name)] || 'application/octet-stream' })
        : r.fulfill({ status: 404, body: '' });
    });
    await page.addInitScript('window.__db=' + JSON.stringify(seed) + ';' + stub);
    await page.goto('https://ev.local/');
    await page.waitForTimeout(1800);
    if (start === 'app') return true;
    // The Notes starts: the Notes tab, then (for note) the first clickable thing in its panel, a note.
    const tab = await page.$('#tab-notes');
    if (!tab || !(await tab.isVisible())) return false;
    await tab.click();
    await page.waitForTimeout(700);
    if (start === 'notes') return true;
    const row = await page.$('#p-notes button, #p-notes [role=button], #p-notes a[href]');
    if (!row) return false;
    await row.click();
    await page.waitForTimeout(700);
    return true;
  };
}

// Visible clickable things, each with a stable key (its label and rough place) and a selector path to find it again.
async function controls(page) {
  return page.evaluate(() => {
    const vis = e => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return (
        r.width > 4 &&
        r.height > 4 &&
        s.visibility !== 'hidden' &&
        s.display !== 'none' &&
        r.bottom > 0 &&
        r.top < innerHeight &&
        r.right > 0 &&
        r.left < innerWidth
      );
    };
    const all = [];
    const walk = (rootNode, prefix) => {
      for (const e of rootNode.querySelectorAll('*')) {
        if (e.shadowRoot) walk(e.shadowRoot, prefix);
        const s = getComputedStyle(e);
        const clicky =
          e.matches(
            'button,a[href],[role=tab],[role=button],[role=option],[role=checkbox],summary,input[type=checkbox],input[type=radio],select'
          ) ||
          (s.cursor === 'pointer' && !(e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer'));
        if (!clicky || !vis(e) || e.disabled) continue;
        const label = (e.getAttribute('aria-label') || e.innerText || e.title || e.value || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 60);
        const r = e.getBoundingClientRect();
        all.push({ label, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
      }
    };
    walk(document, '');
    const seen = new Set();
    return all.filter(c => {
      const k = c.label + '@' + c.x + ',' + c.y;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });
}

(async () => {
  if (target === 'demo') {
    demoServer();
    for (const st of starts)
      if (!fs.existsSync(path.join(__dirname, 'demo/project', st + '.dc.html')))
        throw new Error('no demo board ' + st + '.dc.html');
  }
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  const bootBuilt = target === 'built' ? builtSetup() : null;
  const fresh = async start => {
    const page = await browser.newPage({ viewport: vp, colorScheme: 'light' });
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    if (target === 'demo') await openDemo(page, start);
    else if (!(await bootBuilt(page, start))) return (await page.close(), null);
    return page;
  };
  // Replays a click path (by label, nearest to the recorded spot) on a fresh page from the same start.
  const replay = async (start, steps) => {
    const page = await fresh(start);
    for (const st of steps) {
      const cs = await controls(page);
      const m = cs
        .filter(c => c.label === st.label)
        .sort((a, b) => Math.hypot(a.x - st.x, a.y - st.y) - Math.hypot(b.x - st.x, b.y - st.y))[0];
      if (!m) return { page, ok: false };
      await page.mouse.click(m.x, m.y);
      await page.waitForTimeout(450);
    }
    return { page, ok: true };
  };
  const index = [];
  let n = 0;
  const shot = async (page, start, steps) => {
    const name =
      String(n++).padStart(3, '0') +
      '-' +
      [start]
        .concat(steps.map(s => s.label || '(icon)'))
        .join(' > ')
        .replace(/[^\w .>·-]+/g, '_')
        .slice(0, 80) +
      '.png';
    await page.screenshot({ path: path.join(out, name) });
    index.push({ file: name, start, path: steps.map(s => s.label) });
  };
  const MAX = +(process.env.MAX || 400) * starts.length;
  const skipped = [];
  // For each start. Level 0: the start. Level 1: every control. Level 2: every control that level 1 revealed.
  for (const start of starts) {
    const p0 = await fresh(start);
    if (!p0) {
      skipped.push(start);
      console.log(`built page has no ${start === 'app' ? 'page' : 'Notes view'} to start from: ${start} skipped`);
      continue;
    }
    await shot(p0, start, []);
    const c0 = (await controls(p0)).filter(c => !SKIP.test(c.label));
    await p0.close();
    const k0 = new Set(c0.map(c => c.label));
    for (const a of c0) {
      if (n >= MAX) break;
      const { page, ok } = await replay(start, [a]);
      if (!ok) {
        await page.close();
        continue;
      }
      await shot(page, start, [a]);
      const c1 = (await controls(page)).filter(c => !SKIP.test(c.label) && !k0.has(c.label));
      await page.close();
      for (const b of c1) {
        if (n >= MAX) break;
        const r = await replay(start, [a, b]);
        if (r.ok) await shot(r.page, start, [a, b]);
        await r.page.close();
      }
    }
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1));
  console.log(
    target,
    width,
    starts.join(','),
    index.length,
    'states ->',
    out,
    skipped.length ? 'skipped: ' + skipped : ''
  );
  await browser.close();
  if (srv) srv.close();
})();
