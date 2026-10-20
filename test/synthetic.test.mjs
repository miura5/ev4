// B-100: the synthetic record the page harnesses load by default validates against the real schemas on any day, holds
// the documents the harnesses' checks name, and is made up (no journal, no legacy; only its generator is committed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeValidator } from '../core/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const S = require('./data/synthetic.cjs');
const schemas = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'spec/schemas')).map(f => [f.replace('.schema.json', ''), JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/schemas', f), 'utf8'))]));
const validate = makeValidator(schemas);

for (const when of ['2026-10-19T19:00:00Z', '2026-11-02T11:00:00Z', '2027-03-14T15:30:00Z']) {
  test(`B-100: the synthetic record validates against every schema (built ${when})`, () => {
    const db = S.syntheticRecord(new Date(when));
    for (const [c, docs] of Object.entries(db)) for (const [id, doc] of Object.entries(docs)) {
      assert.ok(schemas[c], 'no schema for ' + c);
      const r = validate(c, doc, { id }); assert.ok(r.ok, `${c}/${id}: ${JSON.stringify(r.errors)}`);
    }
    assert.ok(!db.journal && !db.legacy, 'no journal, no legacy');
    for (const id of ['e4-preschooler', 'e4-aging-expected', 'ws-2026-10-17-E4-3-hypokalemia-findings', 'ws-2026-10-17-E4-3-fluid-volume-excess']) assert.ok(db.weakspots[id], id);
    assert.ok(db.plans.E4 && db.sets['drill-E4-ch39'] && db.sessions['2026-10-17-0035-Pharmacology-Chapter-50']);
  });
}

test('B-100: a harness with no record dir gets a fresh synthetic one; a named dir is used as given', () => {
  assert.equal(S.recordDir('/some/export'), '/some/export');
  const dir = S.recordDir();
  assert.ok(fs.existsSync(path.join(dir, 'SYNTHETIC')) && fs.existsSync(path.join(dir, 'weakspots', 'e4-preschooler.json')));
  fs.rmSync(dir, { recursive: true });
});
