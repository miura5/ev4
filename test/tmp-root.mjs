// B-326: every temporary folder a test file makes leaves the temp folder when its test ends, pass or fail.
//
// npm test preloads this file into each test process (node --import, see package.json). There it points TMPDIR at a
// folder of the process's own (ev4-test-*), so every os.tmpdir() folder the file makes, and every one a tool it runs
// makes (children inherit TMPDIR), lands inside it. When a top-level test ends, its hooks remove what appeared in that
// folder while it ran; at exit (or SIGTERM/SIGINT) the folder itself goes. A folder a file keeps across its tests
// (made at load time, in a before hook, or marked with keepForFile) stays until exit. Outside a test process
// (the runner itself, a harness, a tool) importing this does nothing, so nothing outside the folder is ever removed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'node:test';

const KEY = Symbol.for('ev4.tmpRoot');
const state = globalThis[KEY] || (globalThis[KEY] = { root: null, kept: new Set() });

/** The process's own temp folder (null outside a test process). */
export const tmpRoot = () => state.root;

/** Keeps a folder until the test process exits (a cache shared across a file's tests), not just until the test ends. */
export function keepForFile(dir) {
  if (state.root && path.dirname(path.resolve(dir)) === state.root) state.kept.add(path.basename(dir));
  return dir;
}

function removeAll() {
  if (!state.root) return;
  try {
    fs.rmSync(state.root, { recursive: true, force: true });
  } catch {
    /* a child still writing; the next sweep or exit takes the rest */
  }
}

if (process.env.NODE_TEST_CONTEXT && !state.root) {
  state.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-test-')));
  process.env.TMPDIR = state.root;
  process.on('exit', removeAll);
  for (const sig of ['SIGTERM', 'SIGINT'])
    process.once(sig, () => {
      removeAll();
      process.exit(128 + os.constants.signals[sig]);
    });
  let depth = 0;
  let before = new Set();
  beforeEach(() => {
    if (depth++ === 0) before = new Set(fs.readdirSync(state.root));
  });
  afterEach(() => {
    if (--depth > 0) return;
    for (const name of fs.readdirSync(state.root))
      if (!before.has(name) && !state.kept.has(name))
        fs.rmSync(path.join(state.root, name), { recursive: true, force: true });
  });
}
