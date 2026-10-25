const { chromium } = require('playwright');
const http = require('http'),
  fs = require('fs'),
  path = require('path');
const root = require('path').join(__dirname, 'demo'),
  out = (process.env.FIDELITY_OUT || '/tmp/fidelity') + '/demoshots-wide';
fs.mkdirSync(out, { recursive: true });
const srv = http
  .createServer((q, r) => {
    const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      r.writeHead(404);
      return r.end();
    }
    const ext = path.extname(p);
    r.writeHead(200, { 'content-type': ext === '.html' ? 'text/html' : 'text/javascript' });
    fs.createReadStream(p).pipe(r);
  })
  .listen(8713);
const boards = ['Main', 'TodayList', 'StudyOverview', 'Progress', 'Record'];
(async () => {
  const b = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  const rep = {};
  for (const vp of [
    { width: 1706, height: 1240 },
    { width: 2560, height: 1240 },
  ])
    for (const bd of boards) {
      const pg = await b.newPage({ viewport: vp, colorScheme: 'light' });
      await pg.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
      await pg.goto(`http://localhost:8713/project/${bd}.dc.html`);
      await pg.waitForTimeout(2500);
      const tag = `${bd}-${vp.width}`;
      await pg.screenshot({ path: `${out}/${tag}.png` });
      rep[tag] = await pg.evaluate(() => {
        const vis = el =>
          el &&
          el.getClientRects().length &&
          getComputedStyle(el).visibility !== 'hidden' &&
          getComputedStyle(el).display !== 'none';
        const R = el => {
          const r = el.getBoundingClientRect();
          return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
        };
        // big blocks: elements wider than 150 and taller than 300
        const blocks = [...document.querySelectorAll('body *')]
          .filter(
            e =>
              vis(e) &&
              e.getBoundingClientRect().height > 400 &&
              e.getBoundingClientRect().width > 150 &&
              e.getBoundingClientRect().width < innerWidth - 50
          )
          .map(e => ({
            c: (e.className && e.className.baseVal === undefined ? String(e.className) : '').slice(0, 40),
            r: R(e),
          }));
        const mw = [...document.querySelectorAll('body *')]
          .filter(vis)
          .map(e => [e, getComputedStyle(e).maxWidth])
          .filter(([e, m]) => m !== 'none' && !m.endsWith('%') && e.getBoundingClientRect().width > 200)
          .map(([e, m]) => ({ c: String(e.className).slice(0, 30), m, w: Math.round(e.getBoundingClientRect().width) }))
          .slice(0, 8);
        return {
          blocks: blocks.slice(0, 12),
          mw,
          text: document.body.innerText.slice(0, 2500),
          sideways: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      await pg.close();
    }
  fs.writeFileSync(out + '/report.json', JSON.stringify(rep, null, 1));
  await b.close();
  srv.close();
})();
