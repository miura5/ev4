// Clicks through the demo or the built page like a person: every nav item, then every visible control in
// that view (tabs, buttons, rows, chips), then every control that click revealed, two clicks deep.
// Usage: node tools/fidelity/crawl.cjs demo|built [width] ; screenshots to $FIDELITY_OUT/crawl-<target>-<width>/
// with index.json mapping each shot to its click path. Read only: the built page runs on the synthetic record.
const { chromium } = require('playwright');
const fs = require('fs'),
  path = require('path'),
  http = require('http');
const target = process.argv[2] || 'demo';
const width = +(process.argv[3] || 1280);
const vp = { width, height: width < 600 ? 844 : 900 };
const out =
  (process.env.FIDELITY_OUT || '/tmp/fidelity') +
  `/crawl-${target}${process.env.RECORD_DIR && target === 'built' ? '-record' : ''}-${width}`;
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(__dirname, '../..');
const SKIP = /^(delete|remove|sign out|log out|reset|send)$/i;

async function openDemo(page) {
  await page.goto('http://localhost:8713/project/Main.dc.html');
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
  return async page => {
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
  if (target === 'demo') demoServer();
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  const bootBuilt = target === 'built' ? builtSetup() : null;
  const fresh = async () => {
    const page = await browser.newPage({ viewport: vp, colorScheme: 'light' });
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    if (target === 'demo') await openDemo(page);
    else await bootBuilt(page);
    return page;
  };
  // Replays a click path (by label, nearest to the recorded spot) on a fresh page.
  const replay = async steps => {
    const page = await fresh();
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
  const shot = async (page, steps) => {
    const name =
      String(n++).padStart(3, '0') +
      '-' +
      steps
        .map(s => s.label || '(icon)')
        .join(' > ')
        .replace(/[^\w .>·-]+/g, '_')
        .slice(0, 80) +
      '.png';
    await page.screenshot({ path: path.join(out, name) });
    index.push({ file: name, path: steps.map(s => s.label) });
  };
  const MAX = +(process.env.MAX || 400);
  // Level 0: the start. Level 1: every control. Level 2: every control that level 1 revealed.
  const p0 = await fresh();
  await shot(p0, []);
  const c0 = (await controls(p0)).filter(c => !SKIP.test(c.label));
  await p0.close();
  const k0 = new Set(c0.map(c => c.label));
  for (const a of c0) {
    if (n >= MAX) break;
    const { page, ok } = await replay([a]);
    if (!ok) {
      await page.close();
      continue;
    }
    await shot(page, [a]);
    const c1 = (await controls(page)).filter(c => !SKIP.test(c.label) && !k0.has(c.label));
    await page.close();
    for (const b of c1) {
      if (n >= MAX) break;
      const r = await replay([a, b]);
      if (r.ok) await shot(r.page, [a, b]);
      await r.page.close();
    }
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1));
  console.log(target, width, index.length, 'states ->', out);
  await browser.close();
  if (srv) srv.close();
})();
