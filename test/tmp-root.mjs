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

// Retries cover a writer that is just finishing (a git command's last object write); rm never fails a test.
const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };
function remove(target) {
  try {
    fs.rmSync(target, RM);
    return true;
  } catch {
    return false;
  }
}
function removeAll() {
  if (state.root) remove(state.root);
}

if (process.env.NODE_TEST_CONTEXT && !state.root) {
  state.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-test-')));
  process.env.TMPDIR = state.root;
  // No git housekeeping in the background (auto gc, auto maintenance): it wrote into a test's copied repository
  // after the test ended, while the sweep removed it (CI, ENOTEMPTY on .git/objects). Throwaway repositories need none.
  if (!process.env.GIT_CONFIG_COUNT) {
    const config = { 'gc.auto': '0', 'gc.autoDetach': 'false', 'maintenance.auto': 'false' };
    Object.entries(config).forEach(([k, v], i) => {
      process.env[`GIT_CONFIG_KEY_${i}`] = k;
      process.env[`GIT_CONFIG_VALUE_${i}`] = v;
    });
    process.env.GIT_CONFIG_COUNT = String(Object.keys(config).length);
  }
  process.on('exit', removeAll);
  for (const sig of ['SIGTERM', 'SIGINT'])
    process.once(sig, () => {
      removeAll();
      process.exit(128 + os.constants.signals[sig]);
    });
  let depth = 0;
  let before = new Set();
  const pending = new Set(); // a folder a sweep could not remove yet: tried again at each sweep and at exit
  beforeEach(() => {
    if (depth++ === 0) before = new Set(fs.readdirSync(state.root));
  });
  afterEach(() => {
    if (--depth > 0) return;
    for (const name of fs.readdirSync(state.root))
      if ((pending.has(name) || !before.has(name)) && !state.kept.has(name)) {
        if (remove(path.join(state.root, name))) pending.delete(name);
        else pending.add(name);
      }
  });
}
