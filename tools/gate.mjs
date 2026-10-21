// The run gate (B-132, D-170): the one piece of code a task prompt carries, kept here as a readable function and
// rendered by tools/prompts.mjs into the single line step 3 runs with node -e (so it reaches the run inside the prompt,
// never fetched). It finds the session's checkout, reads the deployed system/manifest step 2 saved, and checks every
// file the manifest hashes. When the deployed commit is in the checkout it checks that commit out first (B-110). When
// it is not (the clone is 50 commits deep and record commits push a build out of it: Oct 19, Oct 20, and every live
// run on Oct 21), it fetches that one commit from origin, depth 1, and checks it out (B-168). Only when the fetch
// fails or is refused does it stay on the clone's head and go on if every hashed file is the same there, quoting the
// refusal: the same content is the same build (D-114's rule, D-170). Any file that differs fails the run, named.
// GIT_TERMINAL_PROMPT=0 and the timeouts keep a fetch that would ask for credentials or hang from stalling the run.
//
// The function body must stay renderable: no comments inside it, no double quotes inside its strings, and nothing a
// shell's single quotes would end (the render turns its single quotes into double ones and refuses a leftover).

export function gate(fs, cp, cr, manifestPath, roots) {
  const S = roots.find(d => fs.existsSync(d + '/core/cli.mjs') && fs.existsSync(d + '/.git'));
  if (!S) throw new Error('the E.V. repository is not checked out in this session');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!/^[0-9a-f]{40}$/.test(m.commit || '') || m.dirty) throw new Error('system/manifest is not a deployable build');
  const g = (a, t) =>
    String(
      cp.execFileSync('git', ['-C', S, ...a], {
        stdio: 'pipe',
        timeout: t || 60000,
        env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }),
      })
    ).trim();
  const has = () => {
    try {
      g(['cat-file', '-e', m.commit + '^{commit}']);
      return true;
    } catch (e) {
      return false;
    }
  };
  let head = null,
    fetched = false,
    refused = null;
  if (!has()) {
    try {
      g(['fetch', '-q', '--depth', '1', 'origin', m.commit], 120000);
      fetched = has();
      if (!fetched) refused = 'the fetch ended without the commit';
    } catch (e) {
      const said = String((e.stderr && String(e.stderr)) || e.message || e)
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
      refused = said.find(l => /^(fatal|error)/.test(l)) || said[0] || 'the fetch failed';
    }
    if (!fetched) head = g(['rev-parse', 'HEAD']);
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
              ' is not in this checkout and fetching it failed: ' +
              refused +
              '; its head ' +
              head.slice(0, 12) +
              ' was checked instead)'
            : fetched
              ? ' (fetched ' + m.commit.slice(0, 12) + ')'
              : '')
      );
  }
  console.log(
    'E.V.',
    m.release,
    m.commit.slice(0, 12),
    head
      ? 'not in this checkout; fetching it failed: ' +
          refused +
          '; same content at ' +
          head.slice(0, 12) +
          ', verified in'
      : fetched
        ? 'fetched, checked out and verified in'
        : 'verified in',
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
