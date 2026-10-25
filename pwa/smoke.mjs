#!/usr/bin/env node
// The app's smoke (B-313): the page the app serves, booted through the shim against `wrangler dev` with a local D1
// seeded with the synthetic record (test/data/synthetic.cjs; nothing here is Matt's), and a stub in place of the
// Claude API (the browser's /api/claude answered here and every call recorded). At 390 and 1280: boot with no page
// error, each tab, a check-off that survives a reload (the reload reads it back from D1), a chat reply from the stub,
// and a chat message with a planted patient identifier stopped by the page's gate with no call to /api/claude. The
// study session step runs and is reported, but only counts once B-314 makes it pass (SESSION_REQUIRED).
//   node pwa/smoke.mjs [screenshots dir] [--plant page-error]      (npm run smoke:pwa; needs `npm ci --prefix pwa`)
// Exit code 1 when any counted check fails. --plant page-error makes the served app.js throw once the page is up, to
// prove the smoke turns red (the smoke workflow runs it and expects red).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeIdCheck } from '../core/idcheck.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PWA = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(PWA, '..');
const args = process.argv.slice(2);
const plantAt = args.indexOf('--plant');
const PLANT = plantAt >= 0 ? args.splice(plantAt, 2)[1] : null;
if (PLANT && PLANT !== 'page-error') {
  console.error(`smoke:pwa: no such plant "${PLANT}" (page-error)`);
  process.exit(2);
}
const shots = args[0] || path.join(os.tmpdir(), 'ev4-smoke-pwa');
fs.mkdirSync(shots, { recursive: true });
// B-314 turns the study session green (a session with no Study Watch note); until then it is reported, not counted.
const SESSION_REQUIRED = false;
const TOKEN = 'smoke-token-not-a-secret';
const WRANGLER = path.join(PWA, 'node_modules/.bin/wrangler');
if (!fs.existsSync(WRANGLER)) {
  console.error('smoke:pwa: wrangler is not installed in pwa/: run npm ci --prefix pwa first');
  process.exit(2);
}

// A made-up record number, and the verdict the page already keeps for it: a value judged real before is held by the
// page's gate at once, with no new judgment (B-197), so no call reaches /api/claude.
const ID = makeIdCheck();
const PLANTED_ID = 'MRN 4417203';
const PLANTED_KEY = ID.identifierCandidates('Her ' + PLANTED_ID, { strict: true })[0].key;

const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { cwd: ROOT, stdio: 'pipe', ...opts }).toString();
const freePort = () =>
  new Promise((ok, no) => {
    const s = net.createServer();
    s.unref();
    s.on('error', no);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

// 1. The app's page, and a fresh local D1 holding the synthetic record (outside the repository).
function prepare() {
  run('node', ['tools/build.mjs']);
  run('node', ['tools/build-pwa.mjs', '--record', 'staging']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-smoke-pwa-d1-'));
  const q = s => "'" + String(s).replace(/'/g, "''") + "'";
  const verdict = {
    schema: 1,
    writer: 'page',
    at: new Date().toISOString(),
    source: 'E.V. Home',
    key: PLANTED_KEY,
    verdict: 'real',
    reason: 'reads as a real patient',
    kind: 'has a medical record number',
    ref: 'smoke',
    by: 'judgment',
  };
  const seed =
    run('node', ['seed.mjs'], { cwd: PWA }) +
    `INSERT INTO docs (c, id, data, at) VALUES ('idchecks', ${q(PLANTED_KEY)}, ${q(JSON.stringify(verdict))}, ${Date.now()});\n`;
  fs.writeFileSync(path.join(dir, 'seed.sql'), seed);
  for (const file of [path.join(PWA, 'schema.sql'), path.join(dir, 'seed.sql')])
    run(WRANGLER, ['d1', 'execute', 'ev-demo', '--local', '--persist-to', dir, '--file', file], { cwd: PWA });
  return dir;
}

// 2. wrangler dev over that D1, with the smoke's own token; ready once /api/db answers 401 without it.
async function serve(dir) {
  const port = await freePort();
  const log = [];
  const proc = spawn(
    WRANGLER,
    ['dev', '--local', '--persist-to', dir, '--ip', '127.0.0.1', '--port', String(port), '--var', 'EV_TOKEN:' + TOKEN],
    { cwd: PWA, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } }
  );
  proc.stdout.on('data', d => log.push(String(d)));
  proc.stderr.on('data', d => log.push(String(d)));
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (proc.exitCode != null) break;
    const s = await fetch(origin + '/api/db').then(
      r => r.status,
      () => 0
    );
    if (s === 401) return { origin, proc };
    await new Promise(r => setTimeout(r, 500));
  }
  proc.kill();
  throw new Error('wrangler dev did not come up:\n' + log.join('').slice(-2000));
}

// The stub in place of the Claude API: one reply in the Messages API's shape. A machine-parsed ask gets {}.
const STUB_REPLY = 'Stub reply: an adult resting heart rate runs 60 to 100 beats a minute.';
function stubAnswer(body) {
  const last = (body.messages || []).filter(m => m.role === 'user').pop();
  const said = last && typeof last.content === 'string' ? last.content : '';
  const text = /machine-parsed/.test(said) ? '{}' : STUB_REPLY;
  return {
    id: 'msg_stub',
    type: 'message',
    role: 'assistant',
    model: 'stub',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

const results = [];
const ok = (name, cond, detail = '', counted = true) =>
  results.push([cond ? 'PASS' : counted ? 'FAIL' : 'PENDING', name, detail]);
const until = (page, fn, arg, ms = 6000) =>
  page
    .waitForFunction(fn, arg, { timeout: ms })
    .then(() => true)
    .catch(() => false);

async function open(context, origin) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(origin + '/');
  return { page, errors };
}
const booted = page =>
  until(page, () => /^Live$/.test((document.getElementById('status') || {}).textContent || ''), null, 15000);

async function main() {
  const t0 = Date.now();
  const dir = prepare();
  const { origin, proc } = await serve(dir);
  const calls = []; // every request that reached the stub: [viewport, body]
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  try {
    for (const [scheme, viewport] of [
      ['390', { width: 390, height: 844 }],
      ['1280', { width: 1280, height: 860 }],
    ]) {
      const tag = `[${scheme}]`;
      // The service worker is kept out so every request passes the routes below (it never caches /api anyway).
      const context = await browser.newContext({ viewport, colorScheme: 'dark', serviceWorkers: 'block' });
      await context.addInitScript(t => localStorage.setItem('ev.token', t), TOKEN);
      await context.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
      await context.route(origin + '/api/claude', r => {
        const body = JSON.parse(r.request().postData() || '{}');
        calls.push([scheme, body]);
        return r.fulfill({ body: JSON.stringify(stubAnswer(body)), contentType: 'application/json' });
      });
      if (PLANT === 'page-error')
        await context.route(origin + '/app.js', async r => {
          const res = await r.fetch();
          const body =
            (await res.text()) +
            "\n;setTimeout(() => { throw new Error('planted page error (smoke:pwa --plant page-error)'); }, 300);\n";
          return r.fulfill({ response: res, body });
        });
      let { page, errors } = await open(context, origin);

      // 1. Boots: the shim hands the page its record from D1 and the page connects.
      const up = await booted(page);
      ok(
        `${tag} the app boots through the shim and connects to the record`,
        up && (await page.evaluate(() => !!(window.EVCore && window.EVApp && window.claude))),
        await page.evaluate(() => (document.getElementById('status') || {}).textContent || '')
      );

      // 2. Each tab opens its own panel.
      const missing = [];
      for (const t of ['today', 'study', 'progress', 'record', 'system', 'ev']) {
        await page.click('#tab-' + t);
        const shown = await until(
          page,
          id => {
            const p = document.getElementById('p-' + id);
            return !!p && !p.hidden && getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 0;
          },
          t,
          2000
        );
        if (!shown) missing.push(t);
      }
      ok(
        `${tag} each tab opens its panel`,
        missing.length === 0,
        missing.length ? 'did not open: ' + missing.join(', ') : ''
      );

      // 3. A Today check-off, then a reload: the tick comes back from D1.
      await page.click('#tab-today');
      const row = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#today-list .li')];
        const i = rows.findIndex(r => r.querySelector('input.tick:not(:checked)'));
        return i < 0 ? null : { i, id: rows[i].dataset.id, text: rows[i].querySelector('.ti-t').textContent };
      });
      if (row) {
        await page.locator('#today-list .li').nth(row.i).locator('input.tick').click();
        const saved = await until(
          page,
          i => {
            const c = document.querySelectorAll('#today-list .li')[i];
            const t = c && c.querySelector('input.tick');
            return !!t && t.checked && !t.disabled;
          },
          row.i
        );
        await page.waitForTimeout(500);
        await page.reload();
        await booted(page);
        await page.click('#tab-today');
        const kept = await until(
          page,
          id =>
            [...document.querySelectorAll('#today-list .li')].some(
              r => r.dataset.id === id && r.querySelector('input.tick:checked')
            ),
          row.id
        );
        ok(`${tag} a Today check-off survives a reload (read back from D1)`, saved && kept, row.text);
      } else ok(`${tag} a Today check-off survives a reload (read back from D1)`, false, 'no item to tick');

      // 4. A chat reply: his line goes to the stub through /api/claude and E.V.'s answer lands in the thread.
      await page.click('#tab-ev');
      // a send while E.V. is still answering (the greeting, say) would stop that answer instead
      const idle = () =>
        until(page, () => document.getElementById('ev-send').getAttribute('aria-label') === 'Send', null, 10000);
      await idle();
      const before = calls.length;
      // the record is shared, so the other width's reply may already be in the thread: wait for one more
      const had = await page.evaluate(
        said => [...document.querySelectorAll('#thread .msg.ev')].filter(m => m.textContent.includes(said)).length,
        STUB_REPLY.slice(0, 30)
      );
      await page.fill('#ev-input', `What is a normal adult resting heart rate? (${scheme})`);
      await page.locator('#ev-form').evaluate(f => f.requestSubmit());
      const replied = await until(
        page,
        ([said, n]) =>
          [...document.querySelectorAll('#thread .msg.ev')].filter(m => m.textContent.includes(said)).length > n,
        [STUB_REPLY.slice(0, 30), had],
        10000
      );
      ok(
        `${tag} a chat reply comes back from the stub`,
        replied && calls.length > before,
        `${calls.length - before} call(s)` +
          (replied
            ? ''
            : ' · ' +
              (await page
                .locator('#thread .msg')
                .last()
                .textContent()
                .catch(() => '')))
      );

      // 5. A planted patient identifier: the page's gate holds the message, and nothing goes to /api/claude.
      await idle();
      const sent = calls.length;
      await page.fill('#ev-input', `My patient today, ${PLANTED_ID}, had a heart rate of 112. Is that high?`);
      await page.locator('#ev-form').evaluate(f => f.requestSubmit());
      const held = await until(
        page,
        () => {
          const g = document.getElementById('ev-guard');
          return !!g && !g.hidden && /\S/.test(g.textContent) && !/Checking one detail/.test(g.textContent);
        },
        null,
        5000
      );
      await page.waitForTimeout(800);
      const leaked = await page.evaluate(
        v => [...document.querySelectorAll('#thread .msg')].some(m => m.textContent.includes(v)),
        PLANTED_ID
      );
      ok(
        `${tag} a planted patient identifier is held by the page's gate, with no call to /api/claude`,
        held && !leaked && calls.length === sent,
        JSON.stringify({
          guard: await page.evaluate(() => (document.getElementById('ev-guard') || {}).textContent || ''),
          calls: calls.length - sent,
          inThread: leaked,
        })
      );
      await page.fill('#ev-input', '');

      // 6. A study session started and ended (B-314 makes this pass with no Study Watch note).
      await page.fill('#ev-input', 'Start a study session');
      await page.locator('#ev-form').evaluate(f => f.requestSubmit());
      const started = await until(page, () => !document.getElementById('sbar').hidden, null, 6000);
      let ended = false;
      if (started) {
        const end = page.locator('#sbar button', { hasText: /^(End|Finish)$/ });
        if (await end.count()) {
          await end.first().click();
          ended = await until(page, () => document.getElementById('sbar').hidden, null, 6000);
        }
      }
      ok(
        `${tag} a study session starts and ends`,
        started && ended,
        started
          ? ''
          : await page
              .locator('#thread .msg.ev')
              .last()
              .textContent()
              .catch(() => ''),
        SESSION_REQUIRED
      );

      await page.screenshot({ path: `${shots}/smoke-pwa-${scheme}.png` });
      ok(`${tag} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
      await context.close();
    }
  } finally {
    await browser.close();
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const r of results) console.log(r[0], r[1], r[2] ? '· ' + r[2] : '');
  const failed = results.filter(r => r[0] === 'FAIL').length;
  const pending = results.filter(r => r[0] === 'PENDING').length;
  console.log(
    `${failed ? failed + ' FAILED' : 'ALL PASSED'} of ${results.length - pending} smoke:pwa checks` +
      (pending ? ` (${pending} pending B-314)` : '') +
      ` in ${Math.round((Date.now() - t0) / 1000)} s${PLANT ? ' (planted: ' + PLANT + ')' : ''}`
  );
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
