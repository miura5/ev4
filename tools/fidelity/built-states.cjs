const { chromium } = require('playwright');
const fs = require('fs'),
  path = require('path');
const root = require('path').resolve(__dirname, '../..');
const dbDir = require(root + '/test/data/synthetic.cjs').recordDir('synthetic');
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
const stub = fs.readFileSync(path.join(root, 'test/harness/stub.js'), 'utf8');
const skeleton = body =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  body +
  '</body></html>';
const out = (process.env.FIDELITY_OUT || '/tmp/fidelity') + '/built-states';
fs.mkdirSync(out, { recursive: true });
const info = {};
(async () => {
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  for (const vp of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport: vp, colorScheme: 'light' });
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
        ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' })
        : r.fulfill({ status: 404, body: '' });
    });
    await page.addInitScript('window.__db=' + JSON.stringify(seed) + ';' + stub);
    await page.goto(ORIGIN + '/');
    await page.waitForTimeout(2500);
    const W = vp.width;
    const shot = async n => page.screenshot({ path: `${out}/${n}-${W}.png` });
    const step = async (n, fn) => {
      try {
        await fn();
        await page.waitForTimeout(700);
        await shot(n);
      } catch (e) {
        info[n + '-' + W] = 'ERR ' + e.message.slice(0, 120);
      }
    };
    await step('ev-scrolled', async () => {
      await page.click('#tab-ev');
    });
    info['ev-' + W] = await page.evaluate(() => ({
      checkin: !!document.querySelector('[class*=checkin]:not([hidden])'),
      checkinText: [...document.querySelectorAll('[class*=checkin]')]
        .map(e => e.offsetHeight + ':' + e.textContent.slice(0, 80))
        .slice(0, 3),
      chips: [...document.querySelectorAll('#qchips button')].map(b => b.textContent.trim()),
    }));
    await step('today-week', async () => {
      await page.click('#tab-today');
      await page.locator('[data-v="week"]:visible').first().click();
    });
    await step('today-task', async () => {
      await page.click('#tab-today');
      await page
        .locator('[data-v="list"]:visible')
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(300);
      await page
        .locator('#today-list li.li')
        .nth(1)
        .click({ position: { x: 120, y: 10 } });
    });
    info['today-' + W] = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('#today-list .li')].map(r => Math.round(r.getBoundingClientRect().height)),
      badges: [...document.querySelectorAll('#today-list .li')].map(r => r.querySelectorAll('.badge').length),
      side: document.body.innerText.includes('Where it came from'),
    }));
    await step('today-plan', async () => {
      await page.click('#tab-today');
      await page
        .locator('[data-v="list"]:visible')
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(300);
      await page.locator('.ti-rest:visible').first().click();
    });
    await step('study-weak', async () => {
      await page.click('#tab-study');
      await page.locator('[data-v="weak"]:visible').first().click();
    });
    await step('study-plan', async () => {
      await page.click('#tab-study');
      await page.click('#study-planset'); // B-450: the plan is in the overview; its settings open here
    });
    await step('study-row', async () => {
      await page.click('#tab-study');
      await page
        .locator('[data-v="objectives"]:visible')
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(300);
      await page.locator('#study-objectives .ov-rows > *').first().hover();
      await page.waitForTimeout(300);
      await shot('study-hover');
      await page
        .locator('#study-objectives .ov-rows > *')
        .first()
        .click({ position: { x: 150, y: 10 } });
    });
    info['study-' + W] = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('#study-objectives .ov-rows > *')]
        .slice(0, 3)
        .map(r => Math.round(r.getBoundingClientRect().height)),
      quizme: [...document.querySelectorAll('#p-study button')]
        .filter(b => /Quiz me/.test(b.textContent))
        .map(b => getComputedStyle(b).visibility + '/' + getComputedStyle(b).opacity + '/' + b.offsetWidth),
    }));
    await step('progress-bar', async () => {
      await page.click('#tab-progress');
      await page.locator('#p-progress button:has-text("Fri"), #p-progress [class*=bar]').first().click();
    });
    await step('record-filter', async () => {
      await page.click('#tab-record');
      await page.click('#p-record button:has-text("Filter")');
    });
    await step('prefs', async () => {
      await page.keyboard.press('Escape');
      await page.click('#side-prefs-btn');
    });
    await page.close();
  }
  fs.writeFileSync(out + '/info.json', JSON.stringify(info, null, 1));
  await browser.close();
})();
