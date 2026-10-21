// B-152 (D-176): the timing checks in quarantine.json are advisory. advisory() runs a measure, judges it, and prints
// its numbers; on a miss it runs the measure once more in place (reset() first, when the check needs one) and records a
// failure only when the second run misses too. A check not in quarantine.json is blocking: one run, its verdict.
// EV_PLANT_MISS=<id>[,<id>] makes the first judgement of those checks a miss, to prove the re-run.
const fs = require('fs');
const path = require('path');

const LIST = JSON.parse(fs.readFileSync(path.join(__dirname, 'quarantine.json'), 'utf8'));

async function advisory(
  results,
  id,
  name,
  measure,
  judge,
  { reset = null, list = LIST, env = process.env, log = console.log } = {}
) {
  const planted = String(env.EV_PLANT_MISS || '')
    .split(',')
    .includes(id);
  const first = await measure();
  const v1 = judge(first);
  if (!(list.checks || {})[id]) {
    results.push([v1.ok ? 'PASS' : 'FAIL', name, v1.numbers]);
    return first;
  }
  if (v1.ok && !planted) {
    results.push(['PASS', `${name} (advisory)`, v1.numbers]);
    log(`ADVISORY  ok    ${name}: ${v1.numbers}`);
    return first;
  }
  log(`ADVISORY  miss  ${name}${planted ? ' (planted)' : ''}: ${v1.numbers}; once more, in place`);
  if (reset) await reset();
  const second = await measure();
  const v2 = judge(second);
  results.push([
    v2.ok ? 'PASS' : 'FAIL',
    `${name} (advisory: ${v2.ok ? 'missed once, passed on the re-run' : 'missed twice in a row'})`,
    `${v1.numbers} | ${v2.numbers}`,
  ]);
  log(`ADVISORY  ${v2.ok ? 'ok   ' : 'FAIL '} ${name}, the re-run: ${v2.numbers}`);
  return second;
}

/** Sub-checks a measure collects: [[PASS|FAIL, name, detail]] judged as one; the misses named with their details. */
const allPass = sub => ({
  ok: sub.every(x => x[0] === 'PASS'),
  numbers: sub.every(x => x[0] === 'PASS')
    ? `${sub.length} of ${sub.length}`
    : sub
        .filter(x => x[0] !== 'PASS')
        .map(x => `${x[1]}: ${x[2]}`)
        .join('; '),
});

module.exports = { advisory, allPass, LIST };
