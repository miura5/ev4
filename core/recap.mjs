// B-201: the weekly's build recap, one sentence from the Chart ("This week she shipped n to live; m wait on you"),
// kept as weeks/<date>.health.recap and shown on the Sunday card. The Chart is the build's record, so the weekly reads
// it from origin/main in its own clone (Matt, Oct 23): the deployed commit it runs is older than the record's head.
import { execFileSync } from 'node:child_process';
import EV from './evcore.mjs';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The sentence for the week from..to (Central dates, inclusive): the distinct tasks a green live deploy carried in the
 * week, and the tasks not done that wait on Matt. chart: {deploys: [...], tasks: [...]} as chart/*.json hold them.
 */
export function buildRecap(chart, { from, to }) {
  const deploys = (chart && chart.deploys) || [];
  const tasks = (chart && chart.tasks) || [];
  const shipped = new Set();
  for (const d of deploys) {
    if (d.target !== 'live' || d.verify !== 'green' || !d.time) continue;
    const day = EV.chicagoDate(d.time);
    if (day < from || day > to) continue;
    for (const t of d.tasks || []) shipped.add(t);
  }
  const waiting = tasks.filter(
    t => t.kind !== 'decision' && t.status !== 'done' && String(t.waitingOn || '').toLowerCase() === 'matt'
  ).length;
  const first = shipped.size
    ? `This week she shipped ${plural(shipped.size, 'task', 'tasks')} to live`
    : 'Nothing shipped to live this week';
  const second = waiting ? `${waiting} ${waiting === 1 ? 'waits' : 'wait'} on you` : 'nothing waits on you';
  return `${first}; ${second}.`;
}

/**
 * The Chart as origin/main holds it, read from the clone at root (git show, fetching main once when the ref is
 * missing). {deploys, tasks}, or {refused} when git cannot give it.
 */
export function chartFromMain(root) {
  const show = f =>
    JSON.parse(
      execFileSync('git', ['-C', root, 'show', `origin/main:chart/${f}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
        timeout: 60000,
      })
    );
  const read = () => {
    const d = show('deploys.json'),
      t = show('tasks.json');
    return { deploys: Array.isArray(d) ? d : d.deploys || [], tasks: Array.isArray(t) ? t : t.tasks || [] };
  };
  try {
    return read();
  } catch {
    try {
      execFileSync('git', ['-C', root, 'fetch', '-q', '--depth', '1', 'origin', 'main:refs/remotes/origin/main'], {
        stdio: 'pipe',
        timeout: 120000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      return read();
    } catch (e) {
      return {
        refused: String((e && e.message) || e)
          .split('\n')[0]
          .slice(0, 200),
      };
    }
  }
}
