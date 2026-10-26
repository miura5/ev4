#!/usr/bin/env node
// The app's smoke (B-313): the page the app serves, booted through the shim against `wrangler dev` with a local D1
// seeded with the synthetic record (test/data/synthetic.cjs; nothing here is Matt's), and a stub in place of the
// Claude API (the browser's /api/claude answered here and every call recorded). At 390 and 1280: boot with no page
// error, each tab, a check-off that survives a reload (the reload reads it back from D1) and a chat reply from the
// stub. B-314:
// the shim offers no mcp (use('mcp') resolves null), a study session runs with no note (start, Break and Resume,
// +5 minutes, Quiz me now, End), and no request leaves the app for a host: server or Claude Code Remote. B-322: a
// photographed page attached in the conversation reaches /api/claude as an image and its reading lands in D1. B-324:
// one job of each kind in spec.jobs, started from the conversation (the stub calls start_job), runs at once through
// the shim and /api/claude (the stub answers with the job's answer tool) and its result is read back from D1; a planted
// reply that fails the checks writes nothing it made. B-394: a send the record refuses keeps his words in the box, beside what he has started typing, and E.V. never
// answers it. B-404 (D-325, D-326), at 1280 with the service worker on: a note written offline survives a reload with
// no connection (the page from the worker's cache, the record from the shim's copy) and reaches D1 when the connection
// is back; two devices edit one note offline and end with 2 notes in D1 and every word kept; Keep this version swaps
// them and Undo swaps them back; the note then closes.
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
import { briefOf, jobReply, PLANTS, STUB_TEXT } from './job-stub.mjs';

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
  const seed = run('node', ['seed.mjs'], { cwd: PWA });
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
const STUB_PAGE = 'Stub page: Hand hygiene before and after every client contact, for at least 20 seconds.';
const textOf = content =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter(b => b && b.type === 'text')
          .map(b => b.text)
          .join('\n')
      : '';
const imagesOf = content => (Array.isArray(content) ? content.filter(b => b && b.type === 'image') : []);
// B-324: the jobs the conversation starts, by name: "Smoke job <name>" makes the stub call start_job with this one.
const SMOKE_JOBS = {
  'study-guide': { kind: 'study-guide', brief: 'A one-page guide on fluid volume deficit.' },
  'practice-set': { kind: 'practice-set', brief: '5 questions on fluid volume deficit.' },
  'exam-plan': { kind: 'exam-plan', brief: 'A study plan for E4.' },
  'exam-retro': { kind: 'exam-retro', brief: 'The retro for E3.' },
  'clinical-prep': { kind: 'clinical-prep', brief: '2026-10-28: the skills to review.' },
  'share-set': { kind: 'share-set', brief: 'drill-E4-ch39 for my study group.' },
  general: { kind: 'general', brief: 'List the major electrolytes and their normal ranges.' },
  'plant-shape': { kind: 'general', title: PLANTS.shape, brief: 'Anything.' },
  'plant-plan': { kind: 'exam-plan', title: PLANTS.plan, brief: 'A study plan for E4.' },
};
const SMOKE_ASK = /^Smoke job (\S+) \((\d+)\)$/;
const titleOf = (name, scheme) => `${SMOKE_JOBS[name].title || 'Smoke ' + name} ${scheme}`;
function stubAnswer(body) {
  // B-324: a job's ask (the answer tool) gets the job's answer; the conversation's start_job round gets a line back
  if (briefOf(body)) return jobReply(body);
  const lastTurn = (body.messages || []).filter(m => m.role === 'user').pop();
  const toolTurn = lastTurn && Array.isArray(lastTurn.content) && lastTurn.content.some(b => b.type === 'tool_result');
  const asked = !toolTurn && lastTurn && SMOKE_ASK.exec(textOf(lastTurn.content).trim().split('\n').pop());
  if (toolTurn || (asked && (body.tools || []).some(t => t.name === 'start_job')))
    return {
      id: 'msg_stub',
      type: 'message',
      role: 'assistant',
      model: 'stub',
      content: toolTurn
        ? [{ type: 'text', text: 'Stub: the job is on its way.' }]
        : [
            {
              type: 'tool_use',
              id: 'toolu_start',
              name: 'start_job',
              input: {
                kind: SMOKE_JOBS[asked[1]].kind,
                title: titleOf(asked[1], asked[2]),
                brief: SMOKE_JOBS[asked[1]].brief,
              },
            },
          ],
      stop_reason: toolTurn ? 'end_turn' : 'tool_use',
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  const last = lastTurn;
  const said = last ? textOf(last.content) : '';
  // B-322: a page reading (an image with the library's transcribe ask) gets that page's text back
  const text =
    imagesOf(last && last.content).length && /Transcribe all the text/.test(said)
      ? JSON.stringify({ pages: [{ page: 1, text: STUB_PAGE }] })
      : // a session check (B-314: Quiz me now with no note) gets two items; any other machine-parsed ask gets {}
        !/machine-parsed/.test(said)
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

// B-322: the "photographed page", a made-up handout drawn in the browser and taken as a JPEG (nothing here is Matt's).
let PHOTO = null;
// a 2x2 24-bit BMP, built here
const BMP = (() => {
  const row = Buffer.from([0, 0, 255, 255, 255, 255, 0, 0]); // two pixels (BGR) and two bytes of padding
  const px = Buffer.concat([row, row]);
  const h = Buffer.alloc(54);
  h.write('BM', 0);
  h.writeUInt32LE(54 + px.length, 2);
  h.writeUInt32LE(54, 10);
  h.writeUInt32LE(40, 14);
  h.writeInt32LE(2, 18);
  h.writeInt32LE(2, 22);
  h.writeUInt16LE(1, 26);
  h.writeUInt16LE(24, 28);
  h.writeUInt32LE(px.length, 34);
  return Buffer.concat([h, px]);
})();
async function photo(browser) {
  const p = await browser.newPage({ viewport: { width: 600, height: 400 } });
  try {
    await p.setContent(
      '<body style="margin:0;padding:32px;background:#f4efe6;font:22px Georgia,serif;color:#222">' +
        '<h1 style="font-size:30px">Skills lab: hand hygiene</h1><p>Before and after every client contact.</p>' +
        '<p>At least 20 seconds.</p></body>'
    );
    return await p.screenshot({ type: 'jpeg', quality: 80 });
  } finally {
    await p.close();
  }
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

// B-404: Notes offline, on two "devices" (two browser contexts, each with its own service worker and IndexedDB).
async function notesOffline(browser, origin) {
  const tag = '[notes offline]';
  const notesInD1 = () =>
    fetch(origin + '/api/db?since=0', { headers: { authorization: 'Bearer ' + TOKEN } })
      .then(r => r.json())
      .then(b => b.docs.filter(d => d.c === 'notes'));
  const textOf = d => (d.data.blocks || []).map(b => b.runs.map(r => r.text).join('')).join('\n');
  const inD1 = async (test, ms = 15000) => {
    for (let t = Date.now(); Date.now() - t < ms; await new Promise(r => setTimeout(r, 250))) {
      const docs = await notesInD1();
      if (test(docs)) return docs;
    }
    return null;
  };
  const device = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
    await context.addInitScript(t => localStorage.setItem('ev.token', t), TOKEN);
    await context.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await context.route(origin + '/api/claude', r =>
      r.fulfill({
        body: JSON.stringify(stubAnswer(JSON.parse(r.request().postData() || '{}'))),
        contentType: 'application/json',
      })
    );
    const { page, errors } = await open(context, origin);
    page.on(
      'response',
      r => r.status() >= 400 && errors.push('HTTP ' + r.status() + ' ' + r.request().method() + ' ' + r.url())
    );
    const up = await booted(page);
    const sw = await until(page, () => !!(navigator.serviceWorker && navigator.serviceWorker.controller), null, 15000);
    return { context, page, errors, up, sw };
  };
  const syncLine = page => page.evaluate(() => (document.querySelector('.mh .n-sync') || {}).textContent || '');
  const bodyOf = page => page.evaluate(() => document.getElementById('note-body').innerText);
  const typeAtEnd = async (page, text) => {
    await page.click('#note-body');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(text);
  };
  const openIn = async (page, id) => {
    await page.click('#tab-notes');
    // B-403: a row shows the note in the preview; Open note opens it
    await page.click(`#notes-rows [data-note="${id}"] .nm`);
    await page.click('#notes-pv-open');
    return until(page, () => !document.getElementById('notes-editor').hidden, null, 4000);
  };
  const A = await device();
  ok(`${tag} the app boots with its service worker in control`, A.up && A.sw, JSON.stringify({ up: A.up, sw: A.sw }));
  await A.page.click('#tab-notes');
  await A.page.click('#notes-new');
  await until(A.page, () => !document.getElementById('notes-editor').hidden);
  await A.page.click('#note-body');
  await A.page.keyboard.type('# Offline smoke note');
  await A.page.keyboard.press('Enter');
  await A.page.keyboard.type('Written online.');
  const first = await inD1(docs =>
    docs.some(d => d.data.title === 'Offline smoke note' && /Written online\./.test(textOf(d)))
  );
  const id = first && first.find(d => d.data.title === 'Offline smoke note').id;

  // offline: the note keeps saving on this device, and the header says so; nothing reaches D1
  await A.context.setOffline(true);
  await typeAtEnd(A.page, ' Typed offline.');
  const offLine = await until(
    A.page,
    () => /Offline · saved on this device/.test(document.querySelector('.mh .n-sync').textContent),
    null,
    6000
  );
  const heldBack = !textOf((await notesInD1()).find(d => d.id === id)).includes('Typed offline');
  // a reload with no connection: the page from the worker's cache, the record and the note from the shim's copy
  await A.page.reload();
  const reBoot = await booted(A.page);
  const reOpen = reBoot && (await openIn(A.page, id));
  const afterReload = reOpen ? await bodyOf(A.page) : '';
  ok(
    `${tag} offline, a note saves on this device, says so, and survives a reload with no connection`,
    !!id && offLine && heldBack && reBoot && /Written online\. Typed offline\./.test(afterReload),
    JSON.stringify({ id, offLine, heldBack, reBoot, afterReload: afterReload.slice(0, 120) })
  );
  await A.context.setOffline(false);
  const synced = await inD1(docs => docs.some(d => d.id === id && /Typed offline\./.test(textOf(d))));
  const saidSaved = await until(
    A.page,
    () => /^Saved$/.test(document.querySelector('.mh .n-sync').textContent),
    null,
    8000
  );
  ok(
    `${tag} back online, the offline words are read back from D1 and the header says Saved`,
    !!synced && saidSaved,
    await syncLine(A.page)
  );

  // two devices edit the note while both are offline: never merged, both kept
  const B = await device();
  const bOpen = await openIn(B.page, id);
  await A.context.setOffline(true);
  await B.context.setOffline(true);
  await typeAtEnd(A.page, ' Laptop words.');
  await typeAtEnd(B.page, ' Phone words.');
  await until(A.page, () => /Offline/.test(document.querySelector('.mh .n-sync').textContent), null, 6000);
  await until(B.page, () => /Offline/.test(document.querySelector('.mh .n-sync').textContent), null, 6000);
  await B.context.setOffline(false);
  await inD1(docs => docs.some(d => d.id === id && /Phone words/.test(textOf(d))));
  await A.context.setOffline(false);
  const both = await inD1(docs => docs.some(d => d.data.earlierOf === id && /Laptop words/.test(textOf(d))));
  const picker = await until(
    A.page,
    () =>
      /Two versions · pick one/.test(document.querySelector('.mh .n-sync').textContent) &&
      document.querySelectorAll('.n-pick .ver').length === 2,
    null,
    8000
  );
  const pair = both ? both.filter(d => d.id === id || d.data.earlierOf === id) : [];
  const orig = pair.find(d => d.id === id);
  const earlier = pair.find(d => d.id !== id);
  const all = pair.map(textOf).join('\n');
  ok(
    `${tag} two devices edit one note offline: 2 notes in D1, the newer stays the note, his is '<title> (earlier)', every word kept`,
    bOpen &&
      pair.length === 2 &&
      /Phone words/.test(textOf(orig)) &&
      !/Laptop words/.test(textOf(orig)) &&
      /Laptop words/.test(textOf(earlier)) &&
      earlier.data.title === 'Offline smoke note (earlier)' &&
      ['Written online.', 'Typed offline.', 'Laptop words.', 'Phone words.'].every(w => all.includes(w)) &&
      picker &&
      /Phone words/.test(await bodyOf(A.page)),
    JSON.stringify({
      bOpen,
      n: pair.length,
      titles: pair.map(d => d.data.title),
      picker,
      body: (await bodyOf(A.page)).slice(0, 120),
    })
  );
  await A.page.screenshot({ path: `${shots}/smoke-pwa-notes-two-versions.png` });

  // Keep this version on this device's: the two notes swap; Undo swaps them back and the picker shows again
  await A.page.click('.n-pick .ver:first-child button');
  const swapped = await inD1(docs => {
    const o = docs.find(d => d.id === id);
    const e = docs.find(d => d.id === earlier.id);
    return o && e && /Laptop words/.test(textOf(o)) && /Phone words/.test(textOf(e)) && !/Phone words/.test(textOf(o));
  });
  const undoShown = await until(
    A.page,
    () => /Undo/.test((document.querySelector('.n-pick .endline') || {}).textContent || ''),
    null,
    4000
  );
  await A.page.click('.n-pick .endline button');
  const back = await inD1(docs => {
    const o = docs.find(d => d.id === id);
    const e = docs.find(d => d.id === earlier.id);
    return o && e && /Phone words/.test(textOf(o)) && /Laptop words/.test(textOf(e)) && !/Laptop words/.test(textOf(o));
  });
  const pickAgain = await until(A.page, () => document.querySelectorAll('.n-pick .ver').length === 2, null, 4000);
  ok(
    `${tag} Keep this version swaps the two notes in D1, and Undo swaps them back`,
    !!swapped && undoShown && !!back && pickAgain,
    JSON.stringify({ swapped: !!swapped, undoShown, back: !!back, pickAgain })
  );
  await A.page.click('.n-back');
  const closed = await until(A.page, () => document.getElementById('notes-editor').hidden, null, 4000);
  ok(`${tag} the note then closes normally`, closed, '');
  // the second note is a real note: it is in the list, by its '(earlier)' title
  const listed = await until(
    A.page,
    eid => {
      const r = document.querySelector(`#notes-rows [data-note="${eid}"] .nm`);
      return !!r && r.textContent === 'Offline smoke note (earlier)';
    },
    earlier.id,
    4000
  );
  ok(`${tag} the '(earlier)' note shows in the Notes list`, listed, earlier.id);
  // expected: requests the dropped connection refused, and the one stale save of this note (the 409 D-326 answers)
  const offlineNoise = /Failed to fetch|ERR_INTERNET_DISCONNECTED|net::ERR/i;
  const stale409 = new RegExp('^HTTP 409 PUT ' + origin.replace(/[.]/g, '\\.') + '/api/db/notes/' + id + '\\?');
  const errs = [...A.errors, ...B.errors].filter(
    e => !offlineNoise.test(e) && !stale409.test(e) && !/status of 409 \(Conflict\)/.test(e)
  );
  ok(`${tag} the stale replay was answered 409 once`, A.errors.filter(e => stale409.test(e)).length === 1, '');
  ok(`${tag} no page errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await A.context.close();
  await B.context.close();
}

async function main() {
  const t0 = Date.now();
  const dir = prepare();
  const { origin, proc } = await serve(dir);
  const calls = []; // every request that reached the stub: [viewport, body]
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  try {
    PHOTO = await photo(browser);
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
        // B-389: System has no tab since B-390; the page opens it from its address, #system, as the status line does
        if (t === 'system') await page.evaluate(() => (location.hash = 'system'));
        else await page.click('#tab-' + t);
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
        // The row is found again by its id: a ticked item moves within the list, so its old place holds another row.
        const saved = await until(
          page,
          id => {
            const c = [...document.querySelectorAll('#today-list .li')].find(r => r.dataset.id === id);
            const t = c && c.querySelector('input.tick');
            return !!t && t.checked && !t.disabled;
          },
          row.id
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

      // 5. B-394, B-395: a send the record refuses (every save of the conversation answered 409, so the shim's one
      // retry is refused too), held until he has started typing a new line: his refused words come back into the box
      // after what he is typing, which stays exactly as he typed it; nothing of it stays in the thread, and nothing goes
      // to /api/claude, so E.V. never answers it. Two lines sent back to back are both refused: they come back in the
      // order he sent them, in one toast.
      await idle();
      const refusedLine = `Refused line, kept for him (${scheme})`;
      const refusedNext = `His second refused line (${scheme})`;
      const typingNow = 'and his next thought';
      let release;
      const gate = new Promise(r => (release = r));
      const refuse = async r => {
        if (r.request().method() !== 'PUT') return r.fallback();
        await gate;
        return r.fulfill({ status: 409, body: JSON.stringify({ error: 'conflict', current_version: 999 }) });
      };
      await context.route(origin + '/api/db/talk/**', refuse);
      const callsAt = calls.length;
      const errAt = errors.length;
      const evAt = await page.evaluate(() => document.querySelectorAll('#thread .msg.ev').length);
      // every toast shown from here on is counted (the one #toast element is stamped each time)
      await page.evaluate(() => {
        window.__toasts = 0;
        new MutationObserver(() => window.__toasts++).observe(document.getElementById('toast'), {
          attributes: true,
          attributeFilter: ['data-at'],
        });
      });
      // two lines sent back to back while the first is held: both refused, both back in the order he sent them
      for (const line of [refusedLine, refusedNext]) {
        await page.fill('#ev-input', line);
        await page.locator('#ev-form').evaluate(f => f.requestSubmit());
        await until(
          page,
          v => [...document.querySelectorAll('#thread .msg')].some(m => m.textContent.includes(v)),
          line
        );
      }
      await page.fill('#ev-input', typingNow);
      release();
      const kept = await until(
        page,
        ([a, b]) => {
          const v = document.getElementById('ev-input').value;
          return v.includes(a) && v.includes(b);
        },
        [refusedNext, typingNow],
        8000
      );
      await page.waitForTimeout(1500); // room for a model call, were one made
      await context.unroute(origin + '/api/db/talk/**', refuse);
      // the 409s planted here are the browser's own resource lines, not page errors; anything else still counts
      const planted = errors.splice(errAt).filter(m => !/status of 409 \(Conflict\)/.test(m));
      errors.push(...planted);
      const after = await page.evaluate(
        v => ({
          box: document.getElementById('ev-input').value,
          inThread: [...document.querySelectorAll('#thread .msg')].some(m => v.some(x => m.textContent.includes(x))),
          ev: document.querySelectorAll('#thread .msg.ev').length,
          toasts: window.__toasts,
          toast: document.getElementById('toast').textContent,
        }),
        [refusedLine, refusedNext]
      );
      const inOrder = after.box === `${typingNow}\n\n${refusedLine}\n\n${refusedNext}`; // B-395: appended, his kept
      ok(
        `${tag} two sends refused back to back come back in the box in the order he sent them, after what he is typing, in one toast, with no E.V. reply and no call to /api/claude`,
        kept && inOrder && after.toasts === 1 && !after.inThread && after.ev === evAt && calls.length === callsAt,
        JSON.stringify({
          box: after.box,
          toasts: after.toasts,
          toast: after.toast,
          inThread: after.inThread,
          evLines: after.ev - evAt,
          calls: calls.length - callsAt,
        })
      );
      await page.fill('#ev-input', '');

      // 6. B-314: a study session with no note: it starts, breaks and resumes, takes +5 minutes, quizzes (questions on
      // his objectives and weak spots, from the stub) and ends. B-408 (D-325): that is the phone's session (under 1024 px,
      // no Notes); from 1024 px the same ask starts a note's session in Notes (6b).
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
      if (scheme === '390') await say('Start a study session');
      const started =
        scheme === '390' &&
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
      if (scheme === '390')
        ok(
          `${tag} a study session with no note starts, breaks, takes +5, quizzes and ends`,
          steps.length === 0,
          steps.join(' | ')
        );

      // 6b. B-406 (D-325): at 1280 a new note starts a 25-minute session naming notes/<id> in D1, its controls in the
      // strip; End there saves it. B-408: Start a study session asked in the Conversation is that new note.
      if (scheme === '1280') {
        await idle();
        const docs = () =>
          fetch(origin + '/api/db?since=0', { headers: { authorization: 'Bearer ' + TOKEN } })
            .then(r => r.json())
            .then(b => b.docs);
        const nsteps = [];
        const notesBefore = new Set((await docs()).filter(d => d.c === 'notes').map(d => d.id));
        await say('Start a study session');
        if (!(await until(page, () => !document.getElementById('p-notes').hidden, null, 6000)))
          nsteps.push('Start a study session did not open Notes');
        const strip = await until(
          page,
          () => /\d+:\d\d left/.test((document.querySelector('#ev-sslot .s-left') || {}).textContent || ''),
          null,
          8000
        );
        if (!strip) nsteps.push('no session in the strip');
        await page.click('#note-body');
        await page.keyboard.type('# Smoke note');
        await page.waitForTimeout(1500);
        let all = await docs();
        const note = all.find(d => d.c === 'notes' && !notesBefore.has(d.id));
        const ses = note && all.find(d => d.c === 'sessions' && d.data.note === 'notes/' + note.id);
        if (!note) nsteps.push('the new note is not in D1');
        else if (!ses || ses.data.status !== 'active' || ses.data.planned !== 25)
          nsteps.push('no active 25-minute session naming notes/' + note.id + ' in D1');
        if (ses) {
          await page.click('#ev-sslot .s-end');
          let ended = null;
          for (let i = 0; i < 20 && !ended; i++) {
            await page.waitForTimeout(400);
            all = await docs();
            ended = all.find(d => d.c === 'sessions' && d.id === ses.id && d.data.status === 'ended' && d.data.filedAt);
          }
          if (!ended) nsteps.push('End in the strip did not save the session to D1');
        }
        await page.screenshot({ path: path.join(shots, `notes-session-${scheme}.png`) });
        ok(
          `${tag} a new note starts a 25-minute session naming notes/<id> in D1; End in the strip saves it`,
          nsteps.length === 0,
          nsteps.join(' | ')
        );
        await page.click('#tab-ev');
      }

      // 7. B-322: a photographed page attached in the conversation goes to Claude as an image through /api/claude,
      // and its reading is saved to the library in D1 (the stub transcribes it).
      await idle();
      const photoName = `handout-photo-${scheme}.jpg`;
      const sentBefore = calls.length;
      await page.locator('#ev-file').setInputFiles({ name: photoName, mimeType: 'image/jpeg', buffer: PHOTO });
      const read = await until(
        page,
        name =>
          [...document.querySelectorAll('#thread .msg.ev')].some(
            m => m.textContent.includes('Saved ' + name) && /1 page read from images/.test(m.textContent)
          ),
        photoName,
        10000
      );
      const ocrCalls = calls.slice(sentBefore).filter(([, b]) => {
        const last = (b.messages || []).filter(m => m.role === 'user').pop();
        return last && /Transcribe all the text/.test(textOf(last.content));
      });
      const img = ocrCalls.length ? imagesOf(ocrCalls[0][1].messages.filter(m => m.role === 'user').pop().content) : [];
      const sentPhoto =
        img.length === 1 &&
        img[0].source &&
        img[0].source.type === 'base64' &&
        img[0].source.media_type === 'image/jpeg' &&
        img[0].source.data === PHOTO.toString('base64');
      const saved = read
        ? await fetch(origin + '/api/db?since=0', { headers: { authorization: 'Bearer ' + TOKEN } })
            .then(r => r.json())
            .then(b =>
              b.docs.filter(
                d =>
                  d.c === 'materials' &&
                  d.data.title === photoName &&
                  String(d.data.text || '').includes(STUB_PAGE) &&
                  ((d.data.ocr && d.data.ocr.pages) || []).includes(1)
              )
            )
        : [];
      ok(
        `${tag} a photographed page goes to Claude as an image and its reading is saved to the library in D1`,
        read && ocrCalls.length === 1 && sentPhoto && saved.length === 1,
        JSON.stringify({
          replied: read,
          calls: ocrCalls.length,
          image: img.map(i => (i.source || {}).media_type),
          sameBytes: sentPhoto,
          inD1: saved.length,
        }) + (read ? '' : ' · ' + (await lastEv()))
      );

      // B-322: a picture in a type the API does not take (a BMP here, as an iPhone's HEIC would be) is redrawn as a
      // JPEG by the shim before it is sent.
      const redrawFrom = calls.length;
      const redraw = await page.evaluate(async bmp => {
        const s = await window.claude.use('sample');
        const blob = new Blob([Uint8Array.from(atob(bmp), c => c.charCodeAt(0))], { type: 'image/bmp' });
        return s.json('Transcribe all the text on this test picture.', { images: [blob] }).then(
          () => 'answered',
          e => 'refused: ' + (e.code || e.message)
        );
      }, BMP.toString('base64'));
      const redrawn = calls
        .slice(redrawFrom)
        .flatMap(([, b]) => imagesOf((b.messages || []).filter(m => m.role === 'user').pop().content));
      ok(
        `${tag} a picture the API does not take is redrawn as a JPEG before it is sent`,
        redraw === 'answered' && redrawn.length === 1 && redrawn[0].source.media_type === 'image/jpeg',
        JSON.stringify({ redraw, sent: redrawn.map(i => i.source.media_type) })
      );

      // 8. B-314: no Study Watch reader, no builder: the shim's mcp is null and nothing left for a host: server or Claude
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

      // 9. B-324: one job of each kind, started from the conversation, run at once through the shim and /api/claude, its
      // result read back from D1 (once, at the first width: the record is shared). A planted bad reply writes nothing it
      // made.
      if (scheme === '390') {
        const got = async () =>
          fetch(origin + '/api/db?since=0', { headers: { authorization: 'Bearer ' + TOKEN } })
            .then(r => r.json())
            .then(b => b.docs);
        const answerCalls = title =>
          calls.filter(([, b]) => {
            const br = briefOf(b);
            return br && br.job.title === title;
          }).length;
        const ran = {};
        for (const name of Object.keys(SMOKE_JOBS)) {
          await idle();
          await say(`Smoke job ${name} (${scheme})`);
          const title = titleOf(name, scheme);
          let job = null,
            res = null;
          for (let i = 0; i < 40 && !(res && res.data.status !== 'running'); i++) {
            await page.waitForTimeout(250);
            const docs = await got();
            job = docs.find(d => d.c === 'jobs' && d.data.title === title) || null;
            res = job ? docs.find(d => d.c === 'jobresults' && d.id === job.id) || null : null;
          }
          ran[name] = { job, res, asked: answerCalls(title) };
        }
        const docs = await got();
        const talkOf = id =>
          docs
            .filter(d => d.c === 'talk')
            .flatMap(d => Object.entries(d.data.messages || {}))
            .filter(([k, m]) => m.jobId === id && /-job$/.test(k)); // the job's own message (the chat's reply names it too)
        const kinds = Object.keys(SMOKE_JOBS).filter(n => !/^plant-/.test(n));
        const bad = [];
        for (const name of kinds) {
          const { job, res, asked } = ran[name];
          if (!job) {
            bad.push(name + ': no job in D1');
            continue;
          }
          const r = res && res.data;
          const want = name === 'share-set' ? 'failed' : 'done';
          if (!r || r.status !== want) bad.push(`${name}: jobresults ${r ? r.status : 'missing'}, expected ${want}`);
          if (!(job.data.fired && job.data.fired.ok === true))
            bad.push(name + ': the hand-off is not recorded as made');
          if (asked !== 1) bad.push(`${name}: ${asked} asks to Claude, expected 1`);
          if (talkOf(job.id).length !== 1) bad.push(`${name}: ${talkOf(job.id).length} messages in talk, expected 1`);
          const result = (r && r.result) || {};
          if (name === 'study-guide' && (!String(result.text).includes(STUB_TEXT['study-guide']) || result.docUrl))
            bad.push('study-guide: the guide is not saved in E.V.');
          if (name === 'practice-set') {
            const set = docs.find(d => d.c === 'sets' && d.id === result.setId);
            if (!set || (set.data.items || []).length !== 2) bad.push('practice-set: no set of 2 questions in D1');
          }
          if (
            name === 'exam-plan' &&
            !docs.some(
              d => d.c === 'plans' && d.data.writer === 'worker' && d.data.exam === 'E4' && d.data.source === 'E.V. app'
            )
          )
            bad.push('exam-plan: no plan in D1');
        }
        ok(
          `${tag} one job of each kind runs through the API and its result is read back from D1`,
          bad.length === 0,
          bad.join(' | ') || kinds.join(', ')
        );
        const held = [];
        for (const name of ['plant-shape', 'plant-plan']) {
          const { job, res, asked } = ran[name];
          const r = res && res.data;
          if (!job || !r || r.status !== 'failed' || !/didn’t pass E\.V\.’s checks/.test(r.error || ''))
            held.push(`${name}: ${r ? r.status + ' ' + r.error : 'no result'}`);
          if (job && talkOf(job.id).length) held.push(name + ': a message was written');
          if (asked !== 1) held.push(`${name}: ${asked} asks`);
        }
        if (
          docs.some(
            d => d.c === 'plans' && d.data.title === 'Stub plan for E4' && !(d.data.days || []).every(x => x.date)
          )
        )
          held.push('plant-plan: its plan was written');
        ok(`${tag} a planted reply that fails the checks writes nothing it made`, held.length === 0, held.join(' | '));
      }

      await page.screenshot({ path: `${shots}/smoke-pwa-${scheme}.png` });
      ok(`${tag} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
      await context.close();
    }
    if (!PLANT) await notesOffline(browser, origin);
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
