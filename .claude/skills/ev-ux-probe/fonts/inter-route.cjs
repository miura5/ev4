// E.V. UX probe (D-369): serve the app's real font in a sandbox that blocks Google Fonts. Without it the app renders in
// a fallback font, and every judgement of type, spacing and truncation is off. It answers the page's Google Fonts
// requests with Inter 400/500/600/700 from @fontsource/inter@5.1.0.
//
// Usage, before opening the page:
//   await require('/abs/path/to/inter-route.cjs')(context);   // a Playwright BrowserContext
//
// Where the font files come from, first match wins:
//   1. EV_INTER_DIR, a folder holding inter-latin-<weight>-normal.woff2;
//   2. @fontsource/inter next to this file (node_modules/@fontsource/inter/files);
//   3. <os temp>/ev-inter-font, installed there on first use with npm (needs the npm registry).
// If the install cannot run, it throws with the one command to run by hand.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PKG = '@fontsource/inter@5.1.0';
const WEIGHTS = [400, 500, 600, 700];
const has = dir => dir && WEIGHTS.every(w => fs.existsSync(path.join(dir, `inter-latin-${w}-normal.woff2`)));

function fontDir() {
  if (has(process.env.EV_INTER_DIR)) return process.env.EV_INTER_DIR;
  const local = path.join(__dirname, 'node_modules', '@fontsource', 'inter', 'files');
  if (has(local)) return local;
  const root = path.join(os.tmpdir(), 'ev-inter-font');
  const files = path.join(root, 'node_modules', '@fontsource', 'inter', 'files');
  if (has(files)) return files;
  fs.mkdirSync(root, { recursive: true });
  if (!fs.existsSync(path.join(root, 'package.json')))
    fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  try {
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--no-save', '--prefix', root, PKG], { stdio: 'pipe' });
  } catch (e) {
    throw new Error(
      `inter-route: could not install ${PKG} (${String(e.stderr || e.message)
        .trim()
        .split('\n')
        .pop()}). ` + `Run: npm install --prefix ${root} ${PKG}   or set EV_INTER_DIR to a folder with the woff2 files.`
    );
  }
  if (!has(files)) throw new Error(`inter-route: ${PKG} installed but ${files} lacks the woff2 files`);
  return files;
}

module.exports = async ctx => {
  const dir = fontDir();
  const css = WEIGHTS.map(
    w =>
      `@font-face{font-family:'Inter';font-style:normal;font-weight:${w};font-display:swap;src:url(https://fonts.gstatic.com/local/inter-${w}.woff2) format('woff2');}`
  ).join('\n');
  await ctx.route('**://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: css }));
  await ctx.route('**://fonts.gstatic.com/**', r => {
    const w =
      (r
        .request()
        .url()
        .match(/inter-(\d00)/) || [])[1] || '400';
    r.fulfill({
      status: 200,
      contentType: 'font/woff2',
      headers: { 'access-control-allow-origin': '*' },
      body: fs.readFileSync(path.join(dir, `inter-latin-${w}-normal.woff2`)),
    });
  });
};
