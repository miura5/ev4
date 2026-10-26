// B-320: D-307's lint (tools/d307.mjs). On the spec as it is (live on D1 since the cutover), on the pre-cutover spec
// (rebuilt by preCutoverSpec) and on the cutover of that it finds nothing; planted, it finds a D1 record's run left on ArtifactData, its claude.ai page still writing, and a module
// that names both stores. The one-time copy (tools/pwa-copy.mjs) is exempt by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, preCutoverSpec } from './helpers.mjs';
import { d307Findings, sourcesOf, d1Records, EXEMPT, stripComments } from '../tools/d307.mjs';
import { cutoverSpec } from '../tools/pwa-live.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
const sources = sourcesOf(ROOT);
const pre = preCutoverSpec(spec);
const cut = () => cutoverSpec(pre);

test('D-307 (B-320): the lint holds on the spec as it is and on the cutover spec', () => {
  assert.deepEqual(d307Findings(spec, sources), [], 'the cut-over spec passes its own lint');
  assert.deepEqual(d1Records(spec), ['live'], 'on for live since the cutover set d1');
  assert.deepEqual(d307Findings(pre, sources), []);
  assert.deepEqual(d1Records(pre), [], 'off before the cutover');
  const after = cut();
  assert.deepEqual(d1Records(after), ['live']);
  assert.deepEqual(d307Findings(after, sources), [], 'the cutover commit passes its own lint');
});

test('D-307 (B-320): planted, it names a D1 record left on ArtifactData, a page that writes, and a module with both', () => {
  const s = JSON.parse(JSON.stringify(pre));
  s.registry.records.live.d1 = true;
  const f = d307Findings(s, sources);
  assert.ok(
    f.some(l => /^live\.morning: runs on ArtifactData/.test(l)),
    'the per-record ArtifactData target'
  );
  assert.ok(f.some(l => /^live: its claude\.ai page still writes/.test(l)));
  const after = cut();
  after.registry.records.live.runs.pipelines = after.registry.records.live.runs.pipelines.filter(p => p !== 'watchdog');
  assert.deepEqual(d307Findings(after, sources), [
    "live.watchdog: runs on ArtifactData though live is on D1 (B-315's per-record target; add it to records.live.runs)",
  ]);
  const bridge =
    "import { batch } from '../core/runapi-client.mjs';\nconst call = { tool: 'ArtifactData', args: {} };\n";
  assert.deepEqual(d307Findings(cut(), { 'tools/sync.mjs': bridge }), [
    "tools/sync.mjs: names both ArtifactData and the Worker's run API (D-307), with no exemption in tools/d307.mjs",
  ]);
  assert.deepEqual(d307Findings(cut(), { 'tools/pwa-copy.mjs': bridge }), [], 'the one-time copy is exempt');
  assert.deepEqual(
    d307Findings(cut(), { 'tools/x.mjs': '// ArtifactData\n' + bridge.split('\n')[0] }),
    [],
    'a comment is no call'
  );
  assert.deepEqual(d307Findings(pre, { 'tools/sync.mjs': bridge }), [], 'off while no record is on D1');
  assert.equal(d307Findings(spec, { 'tools/sync.mjs': bridge }).length, 1, 'on for the cut-over spec');
});

test('D-307 (B-320): every exemption is a module that exists and says why; the copy is one', () => {
  assert.ok(EXEMPT['tools/pwa-copy.mjs']);
  for (const [f, why] of Object.entries(EXEMPT)) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    assert.ok(why.length > 20, f);
  }
  assert.equal(stripComments('a // b\n/* c */d "http://x"'), 'a \nd "http://x"');
});
