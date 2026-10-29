#!/usr/bin/env node
// B-324: the staging proof that every job kind runs from the app through the Worker on Haiku. Run by the pwa-staging
// workflow (input jobs: true), after the deploy, against the staging Worker (ev-staging over the staging D1, which
// holds the made-up record only):
//   EV_TOKEN=<the staging token> node tools/pwa-jobs.mjs <worker url> [screenshots dir]
// The app's page is opened in Chromium with the token, as on his phone. For each kind in spec.jobs it makes the two
// writes the page's startJob makes where no mcp is offered (jobs/<id>, then the firing that found none), so the shim
// hands the job to the runner at once; the runner asks real Haiku through the Worker's /api/claude, checks the reply as
// the worker run does and writes what passes. Then jobresults/<id>, and what the job made, are read back from the
// staging D1 through the run API. Every document it writes carries the app's source, which the staging count check
// leaves out of the seed's counts. Prints statuses and counts only: never the token, never a document's text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { APP_SOURCE } from '../pwa/jobs.mjs';

const require = createRequire(import.meta.url);

/** One job of each kind, with a brief the made-up record can answer. */
export const PROOF_JOBS = {
  'study-guide': 'A one-page study guide on fluid volume deficit and excess.',
  'practice-set': '5 questions on fluid volume deficit.',
  'exam-plan': 'A study plan for E4 (Exam 4: Fluids, electrolytes and perfusion).',
  'exam-retro': 'The retro for E3.',
  'clinical-prep': '2026-10-28: the skills to review for this clinical day.',
  'share-set': 'drill-E4-ch39 for my study group.',
  flashcards: '10 flashcards on dosage units and abbreviations.',
  general: 'List the major electrolytes and one sign of each being low.',
};
/** What each kind ends as in the app: a share-set is refused there (its page is published on claude.ai only). The
 * others end done, or failed in the job's own words when Haiku judged the made-up record too thin for it: a real
 * model's judgment, which the proof reports. A call that failed, a reply the checks refused or a job left running
 * is red. */
export const EXPECTED = kind => (kind === 'share-set' ? 'failed' : 'done');
/** Kinds that must end done: the definition names a study guide saved in E.V. */
export const MUST_BE_DONE = ['study-guide'];
const SYSTEM_FAILURE = /couldn’t be reached|didn’t pass E\.V\.’s checks|couldn’t be saved/;

/** The lines for one job's read-back, as [{ok, what}]. */
export function judge(kind, job, res, made) {
  const r = res && res.data;
  const want = EXPECTED(kind);
  const lines = [];
  const final = !!r && (r.status === 'done' || r.status === 'failed');
  const own = final && !(r.status === 'failed' && SYSTEM_FAILURE.test(r.error || ''));
  lines.push({
    ok: own && (want === 'done' || r.status === 'failed') && (!MUST_BE_DONE.includes(kind) || r.status === 'done'),
    what:
      `${kind}: jobresults ${r ? r.status : 'not written'}` +
      (r && r.status === 'failed' ? ' (' + String(r.error || '').slice(0, 160) + ')' : '') +
      (r && r.status !== want ? `; ${want} is usual` : ''),
  });
  if (r && r.status === 'done') {
    const result = r.result || {};
    lines.push({
      ok: !!(result.text || '').trim(),
      what: `${kind}: ${String(result.text || '').length} characters of result`,
    });
    if (kind === 'practice-set')
      lines.push({
        ok: !!made,
        what: made
          ? `practice-set: sets/${made.id} holds ${(made.data.items || []).length} questions`
          : 'practice-set: no set saved',
      });
    if (kind === 'exam-plan')
      lines.push({ ok: !!made, what: made ? `exam-plan: plans/${made.id} written` : 'exam-plan: no plan saved' });
    if (kind === 'flashcards') {
      const n = result.deckId ? result.deckCards || 0 : 0; // B-487: a deck in E.V. (decks/<id>)
      lines.push({ ok: n > 0, what: `flashcards: decks/${result.deckId || '-'} holds ${n} cards` });
    }
  }
  lines.push({ ok: !!(job && job.data.fired && job.data.fired.ok), what: `${kind}: handed to the runner at once` });
  return lines;
}

async function main() {
  const [base, shotsArg] = process.argv.slice(2);
  const token = process.env.EV_TOKEN;
  if (!/^https?:\/\//.test(base || '') || !token) {
    console.error('usage: EV_TOKEN=<token> node tools/pwa-jobs.mjs https://<the staging Worker> [screenshots dir]');
    process.exit(2);
  }
  const origin = base.replace(/\/+$/, '');
  const shots = shotsArg || path.join(os.tmpdir(), 'ev4-pwa-jobs');
  fs.mkdirSync(shots, { recursive: true });
  const get = async (c, id) => {
    const r = await fetch(
      `${origin}/api/run/get?collection=${encodeURIComponent(c)}&doc_id=${encodeURIComponent(id)}`,
      {
        headers: { authorization: 'Bearer ' + token },
      }
    );
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`run/get ${c} answered ${r.status}`);
    return r.json();
  };
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const lines = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.addInitScript(t => localStorage.setItem('ev.token', t), token);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const stopped = []; // the shim's own line when a job stops on an error (no token, no document in it)
    page.on('console', m => /^E\.V\. app: job /.test(m.text()) && stopped.push(m.text().slice(0, 300)));
    await page.goto(origin + '/');
    const live = await page
      // connected: the status has moved on from connecting (on staging it may name the made-up record's old health)
      .waitForFunction(
        () =>
          !document.body.classList.contains('boot-stopped') &&
          !!window.EVApp &&
          !/^(Connecting|$)/.test(((document.getElementById('status') || {}).textContent || '').trim()),
        null,
        {
          timeout: 60000,
        }
      )
      .then(
        () => true,
        () => false
      );
    if (!live) {
      await page.screenshot({ path: path.join(shots, 'pwa-jobs-boot.png') }).catch(() => {});
      const said = await page
        .evaluate(() => (document.getElementById('status') || {}).textContent || '')
        .catch(() => '');
      throw new Error(
        `the app did not connect in 60 s: status "${said}"; page errors: ${errors.slice(0, 3).join(' | ') || 'none'}`
      );
    }
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const ids = {};
    for (const [kind, brief] of Object.entries(PROOF_JOBS)) {
      const id = `job-proof-${stamp}-${kind}`;
      ids[kind] = id;
      // the page's startJob where no mcp is offered: the job, then the firing that found none
      await page.evaluate(
        async ({ id, kind, brief, source }) => {
          const db = await window.claude.use('db');
          const at = new Date().toISOString();
          await db
            .collection('jobs')
            .doc(id)
            .set({ schema: 2, writer: 'page', at, source, kind, title: 'Staging proof: ' + kind, brief });
          await db
            .collection('jobs')
            .doc(id)
            .update({ fired: { at, ok: false, error: 'mcp_unavailable' } });
        },
        { id, kind, brief, source: APP_SOURCE }
      );
    }
    // Haiku answers each in well under a minute; the jobs run side by side
    const deadline = Date.now() + 4 * 60 * 1000;
    const final = {};
    while (Date.now() < deadline && Object.keys(final).length < Object.keys(ids).length) {
      await new Promise(r => setTimeout(r, 3000));
      for (const [kind, id] of Object.entries(ids)) {
        if (final[kind]) continue;
        const res = await get('jobresults', id);
        if (res && res.data.status !== 'running') final[kind] = res;
      }
    }
    for (const [kind, id] of Object.entries(ids)) {
      const res = final[kind] || (await get('jobresults', id));
      const job = await get('jobs', id);
      const r = (res && res.data && res.data.result) || {};
      const made =
        kind === 'practice-set' && r.setId
          ? await get('sets', r.setId)
          : kind === 'exam-plan'
            ? await (async () => {
                for (let n = 1; n < 20; n++) {
                  const p = await get('plans', n === 1 ? 'E4' : `E4-${n}`);
                  if (p && p.data.source === APP_SOURCE && p.data.at >= res.data.startedAt) return p;
                  if (!p && n > 1) break;
                }
                return null;
              })()
            : null;
      lines.push(...judge(kind, job, res, made));
    }
    await page.screenshot({ path: path.join(shots, 'pwa-jobs-390.png') });
    for (const line of stopped) lines.push({ ok: false, what: line });
    lines.push({
      ok: errors.length === 0,
      what: `no page errors${errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''}`,
    });
  } finally {
    await browser.close();
  }
  for (const l of lines) console.log(`${l.ok ? 'ok ' : 'NO '} ${l.what}`);
  const green = lines.every(l => l.ok);
  console.log(`pwa-jobs: ${green ? 'GREEN' : 'RED'}`);
  process.exit(green ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(e => {
    console.error(String((e && e.message) || e));
    process.exit(1);
  });
