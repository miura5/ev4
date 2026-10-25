// B-326: a node --test reporter that prints each failed test as a GitHub Actions ::error line, so a red CI run names
// its test in the check run's annotations (readable with gh api .../check-runs/<job>/annotations when logs are not).
// The test workflow runs it beside the spec reporter; it adds nothing to a local run.
import path from 'node:path';

const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const prop = s => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export default async function* annotate(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const d = event.data;
    const err = d.details && d.details.error;
    // A parent that failed only because a subtest did adds nothing: the subtest has its own line.
    if (err && err.failureType === 'subtestsFailed') continue;
    const cause = (err && (err.cause || err)) || {};
    const message = [
      cause.message || String(cause),
      cause.stack
        ? cause.stack
            .split('\n')
            .filter(l => /^\s+at /.test(l))
            .slice(0, 5)
            .join('\n')
        : '',
    ]
      .join('\n')
      .slice(0, 3000);
    const file = d.file ? path.relative(process.cwd(), d.file) : '';
    yield `::error ${file ? `file=${prop(file)},line=${d.line || 1},` : ''}title=${prop(d.name)}::${esc(message)}\n`;
  }
}
