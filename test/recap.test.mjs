// B-201: the weekly's build recap, one sentence from the Chart: the tasks a green live deploy carried this week, and the
// tasks that wait on Matt. Read from origin/main in the run's own clone (Matt, Oct 23); kept as weeks/<date>.health.recap.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import EV from '../core/evcore.mjs';
import { buildRecap, chartFromMain } from '../core/recap.mjs';
import { produce, rebuildOne } from '../core/derive.mjs';
import { CODE_STEPS } from '../core/steps.mjs';
import { readExport, loadValidator } from '../core/schemas.mjs';
import { ROOT, copyRepo } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator();
const WEEK = { from: '2026-10-19', to: '2026-10-25' };
const deploy = (target, time, tasks, verify = 'green') => ({ target, commit: 'abc1234', time, verify, tasks });
const chart = {
  deploys: [
    deploy('live', '2026-10-23T11:36:27Z', ['B-1', 'B-2', 'B-3']),
    deploy('live', '2026-10-24T15:00:00Z', ['B-3', 'B-4']), // B-3 again: counted once
    deploy('staging', '2026-10-23T12:00:00Z', ['B-5']), // staging is not live
    deploy('live', '2026-10-19T03:00:00Z', ['B-6']), // Oct 18, 10pm in Chicago: last week
    deploy('live', '2026-10-25T16:00:00Z', ['B-7'], 'red'), // not green
  ],
  tasks: [
    { id: 'B-10', kind: 'task', status: 'blocked', waitingOn: 'Matt' },
    { id: 'B-11', kind: 'bug', status: 'in progress', waitingOn: 'Matt' },
    { id: 'B-12', kind: 'task', status: 'done', waitingOn: 'Matt' },
    { id: 'B-13', kind: 'task', status: 'open' },
  ],
};

test('B-201: a planted Chart and deploy record compose the sentence', () => {
  assert.equal(buildRecap(chart, WEEK), 'This week she shipped 4 tasks to live; 2 wait on you.');
  assert.equal(
    buildRecap({ deploys: [deploy('live', '2026-10-20T15:00:00Z', ['B-1'])], tasks: [chart.tasks[0]] }, WEEK),
    'This week she shipped 1 task to live; 1 waits on you.'
  );
  assert.equal(
    buildRecap({ deploys: [], tasks: [] }, WEEK),
    'Nothing shipped to live this week; nothing waits on you.'
  );
});

test('B-201: the weekly writes the recap into weeks/<date>.health, validates, and rebuilds as written', () => {
  const db = {};
  for (const { collection, id, doc } of readExport(path.join(ROOT, 'test/data/record')))
    if (collection !== 'journal') (db[collection] = db[collection] || []).push({ ...doc, id });
  const ctx = { date: '2026-10-25', now: '2026-10-26T00:30:00Z', source: 'weekly x', chart };
  const r = CODE_STEPS['week-brief'](db, ctx, spec);
  assert.equal(ctx.recap, 'This week she shipped 4 tasks to live; 2 wait on you.');
  assert.ok(r.say.includes(ctx.recap), 'the run says it');
  assert.equal(ctx.week.health.recap, ctx.recap, 'the review sees it in its brief');
  const w = produce(db, spec, 'weeks', { date: ctx.date, now: ctx.now, recap: ctx.recap });
  assert.ok(validate('weeks', w, { id: ctx.date }).ok);
  const stored = { ...w, id: ctx.date };
  assert.equal(rebuildOne({ ...db, weeks: [...db.weeks, stored] }, spec, 'weeks', stored).status, 'same');
  // A clone that cannot give the Chart writes the week without a recap and says why.
  const bad = { ...ctx, chart: { refused: 'no origin/main' } };
  const r2 = CODE_STEPS['week-brief'](db, bad, spec);
  assert.equal(bad.recap, null);
  assert.ok(r2.say.some(l => /No build recap: .*no origin\/main/.test(l)));
});

test("B-201: the Chart is read from origin/main, not the run's checkout", () => {
  const dir = copyRepo({ push: true });
  const c = chartFromMain(dir);
  assert.ok(!c.refused, c.refused);
  assert.ok(c.deploys.length > 0 && c.tasks.length > 0);
  assert.deepEqual(chartFromMain(path.join(dir, 'no-such-dir')).refused !== undefined, true);
});
