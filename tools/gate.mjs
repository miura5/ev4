// The run gate (B-132, D-170): the one piece of code a task prompt carries, kept here as a readable function and
// rendered by tools/prompts.mjs into the single line step 3 runs with node -e (so it reaches the run inside the prompt,
// never fetched). It finds the session's checkout, reads the deployed system/manifest step 2 saved, and checks every
// file the manifest hashes. When the deployed commit is in the checkout it checks that commit out first (B-110); when
// it is not (the clone is 50 commits deep and record commits push a build out of it, Oct 19 and Oct 20), it stays on
// the clone's head and goes on only if every hashed file is the same there: the same content is the same build (D-114's
// rule, D-170). Any file that differs fails the run, named.
//
// The function body must stay renderable: no comments inside it, no double quotes inside its strings, and nothing a
// shell's single quotes would end (the render turns its single quotes into double ones and refuses a leftover).

export function gate(fs, cp, cr, manifestPath, roots) {
  const S = roots.find(d => fs.existsSync(d + '/core/cli.mjs') && fs.existsSync(d + '/.git'));
  if (!S) throw new Error('the E.V. repository is not checked out in this session');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!/^[0-9a-f]{40}$/.test(m.commit || '') || m.dirty) throw new Error('system/manifest is not a deployable build');
  const g = a => String(cp.execFileSync('git', ['-C', S, ...a], { stdio: 'pipe' })).trim();
  let head = null;
  try {
    g(['cat-file', '-e', m.commit + '^{commit}']);
  } catch (e) {
    head = g(['rev-parse', 'HEAD']);
  }
  if (!head) g(['checkout', '-q', m.commit]);
  for (const [f, h] of Object.entries(m.files)) {
    let d = null;
    try {
      d = cr
        .createHash('sha256')
        .update(fs.readFileSync(S + '/' + f))
        .digest('hex');
    } catch (e) {
      d = null;
    }
    if (d !== h)
      throw new Error(
        f +
          ' differs from the deployed build' +
          (head
            ? ' (the deployed commit ' +
              m.commit.slice(0, 12) +
              ' is not in this checkout; its head ' +
              head.slice(0, 12) +
              ' was checked instead)'
            : '')
      );
  }
  console.log(
    'E.V.',
    m.release,
    m.commit.slice(0, 12),
    head ? 'not in this checkout; same content at ' + head.slice(0, 12) + ', verified in' : 'verified in',
    S
  );
}

export const MANIFEST_PATH = '/tmp/ev/system/manifest.json';
const ROOTS = '[process.cwd(),"/home/claude/ev4"]';

/** The gate as one line of JavaScript for node -e '...': the function's own source, its whitespace folded. */
export function renderGate(fn = gate) {
  const body = fn
    .toString()
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .reduce((a, l) => (!a ? l : /[([{]$/.test(a) || /^[.)\]}]/.test(l) ? a + l : a + ' ' + l), '')
    .replace(/'/g, '"');
  if (/'/.test(body) || /\/\/|\/\*/.test(body.replace(/"[^"]*"/g, '""')))
    throw new Error('the gate does not render to one shell-safe line');
  return `(${body})(require("fs"),require("child_process"),require("crypto"),"${MANIFEST_PATH}",${ROOTS})`;
}
