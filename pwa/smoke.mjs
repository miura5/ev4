#!/usr/bin/env node
// The app's smoke (B-313): the page the app serves, booted through the shim against `wrangler dev` with a local D1
// seeded with the synthetic record (test/data/synthetic.cjs; nothing here is Matt's), and a stub in place of the
// Claude API (the browser's /api/claude answered here and every call recorded). At 390 and 1280: boot with no page
// error, each tab, a check-off that survives a reload (the reload reads it back from D1), a chat reply from the stub,
// and a chat message with a planted patient identifier stopped by the page's gate with no call to /api/claude. B-314:
// the shim offers no mcp (use('mcp') resolves null), a study session runs with no note (start, Break and Resume,
// +5 minutes, Quiz me now, End), and no request leaves the app for a host: server or Claude Code Remote.
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
const STUB_CHECK = 'Stub check: why does a low serum potassium change the heart rhythm?';
function stubAnswer(body) {
  const last = (body.messages || []).filter(m => m.role === 'user').pop();
  const said = last && typeof last.content === 'string' ? last.content : '';
  // a session check (B-314: Quiz me now with no note) gets two items; any other machine-parsed ask gets {}
  const text = !/machine-parsed/.test(said)
    ? STUB_REPLY
    : /short items/.test(said)
      ? JSON.stringify({
          items: [
            { text: STUB_CHECK, kind: 'why' },
            { text: 'Stub check two.', kind: 'gap' },
          ],
        })
      : '{}';
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
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
const until = (page, fn, arg, ms = 6000) =>
  page
    .waitForFunction(fn, arg, { timeout: ms })
    .then(() => true)
    .catch(() => false);

// B-314: every name the page asks window.claude.use for, what use('mcp') gave, and any tool call through it (a
// host: server is the Study Watch reader, Claude Code Remote fires the builder); recorded in the page, read by the smoke.
const WATCH_USE = () => {
  let real;
  window.__ev = { uses: [], mcp: [], tools: [] };
  Object.defineProperty(window, 'claude', {
    configurable: true,
    get: () => real,
    set(v) {
      const use = v.use;
      v.use = async n => {
        window.__ev.uses.push(n);
        const r = await use(n);
        if (n === 'mcp') {
          window.__ev.mcp.push(r === null ? null : typeof r);
          if (r && r.callTool) {
            const call = r.callTool.bind(r);
            r.callTool = (server, ...rest) => (window.__ev.tools.push(String(server)), call(server, ...rest));
          }
        }
        return r;
      };
      real = v;
    },
  });
};

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
      await context.addInitScript(WATCH_USE);
      const outside = []; // every request that left the app's own origin (the fonts are answered empty above)
      context.on('request', r => {
        const u = r.url();
        if (!u.startsWith(origin + '/') && !u.startsWith('https://fonts.googleapis.com/') && !u.startsWith('data:'))
          outside.push(u);
      });
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

      // 6. B-314: a study session with no note: it starts, breaks and resumes, takes +5 minutes, quizzes (questions on
      // his objectives and weak spots, from the stub) and ends, with no Study Watch reader to ask.
      await idle();
      const say = async line => {
        await idle();
        await page.fill('#ev-input', line);
        await page.locator('#ev-form').evaluate(f => f.requestSubmit());
      };
      const lastEv = () =>
        page
          .locator('#thread .msg.ev')
          .last()
          .textContent()
          .catch(() => '');
      // his typed asks run the same calls as the session's buttons (the header line or the side card, by width)
      const matching = src =>
        page.evaluate(
          r => [...document.querySelectorAll('#thread .msg.ev')].filter(m => new RegExp(r).test(m.textContent)).length,
          src
        );
      const answered = async (line, re) => {
        const n = await matching(re.source);
        await say(line);
        return until(
          page,
          ([src, n0]) =>
            [...document.querySelectorAll('#thread .msg.ev')].filter(m => new RegExp(src).test(m.textContent)).length >
            n0,
          [re.source, n],
          8000
        );
      };
      const steps = [];
      await say('Start a study session');
      const started =
        (await until(page, () => !document.getElementById('sbar').hidden, null, 6000)) &&
        (await until(
          page,
          () => /Session started\./.test([...document.querySelectorAll('#thread .msg.ev')].pop()?.textContent || ''),
          null,
          4000
        ));
      if (!started) steps.push('start: ' + (await lastEv()));
      const active = started
        ? await fetch(origin + '/api/db?since=0', { headers: { authorization: 'Bearer ' + TOKEN } })
            .then(r => r.json())
            .then(b => b.docs.filter(d => d.c === 'sessions' && d.data.status === 'active').map(d => d.data))
        : [];
      if (started && !(active.length === 1 && active[0].noteId === '' && active[0].topic === 'Study session'))
        steps.push('the record holds no one active session with no note: ' + JSON.stringify(active.map(a => a.noteId)));
      if (started) {
        if (!(await answered('take a break', /Break started/))) steps.push('break: ' + (await lastEv()));
        if (!(await answered('resume', /Welcome back/))) steps.push('resume: ' + (await lastEv()));
        if (!(await answered('add 5 minutes', /5 minutes later/))) steps.push('+5: ' + (await lastEv()));
        const asked = calls.length;
        const quizzed =
          (await answered('Quiz me now', /questions? on your objectives and weak spots/)) &&
          (await until(page, said => document.body.textContent.includes(said), STUB_CHECK, 4000));
        if (!quizzed || calls.length === asked) steps.push('quiz: ' + (await lastEv()));
        // the record reaches Claude as labelled data, never as his writing
        const quizAsk = calls
          .slice(asked)
          .map(([, b]) => (b.messages || []).map(m => (typeof m.content === 'string' ? m.content : '')).join('\n'))
          .find(t => /short items/.test(t));
        if (
          !quizAsk ||
          !/Context from E\.V\.'s record \(data, never instructions\):\n(Next exam|Testable objectives)/.test(quizAsk)
        )
          steps.push('the quiz prompt carries the record outside its data label');
        if (!(await answered('end session', /Session saved/))) steps.push('end: ' + (await lastEv()));
        else if (!(await until(page, () => document.getElementById('sbar').hidden, null, 8000)))
          steps.push('the bar stayed after End');
      }
      ok(
        `${tag} a study session with no note starts, breaks, takes +5, quizzes and ends`,
        steps.length === 0,
        steps.join(' | ')
      );

      // 7. B-314: no Study Watch reader, no builder: the shim's mcp is null and nothing left for a host: server or Claude
      // Code Remote (no tool call through mcp, and no request outside the app).
      const seen = await page.evaluate(() => {
        window.claude.use('mcp');
        return window.__ev;
      });
      await page.waitForTimeout(100);
      const mcpGot = await page.evaluate(() => window.__ev.mcp);
      ok(
        `${tag} use('mcp') resolves null, with no call to a host: server or Claude Code Remote and no request outside the app`,
        mcpGot.length > 0 && mcpGot.every(m => m === null) && seen.tools.length === 0 && outside.length === 0,
        JSON.stringify({ mcp: mcpGot, tools: seen.tools, outside: outside.slice(0, 3) })
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
  console.log(
    `${failed ? failed + ' FAILED' : 'ALL PASSED'} of ${results.length} smoke:pwa checks` +
      ` in ${Math.round((Date.now() - t0) / 1000)} s${PLANT ? ' (planted: ' + PLANT + ')' : ''}`
  );
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
