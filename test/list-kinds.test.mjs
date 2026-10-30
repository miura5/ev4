// B-609 (release review 7475963..21b1ce6): every core list kind saves through the dayedits schema, and the job
// runner configures core so a nursing course keeps its NCLEX framing.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';
import { loadSchemas } from '../core/schemas.mjs';
import { makeValidator } from '../core/validate.mjs';
import * as J from '../pwa/jobs.mjs';
import { jobsSpec } from '../tools/build-pwa.mjs';

const schemas = loadSchemas();
const validate = makeValidator(schemas);
const NOW = new Date('2026-10-16T15:00:00Z');
const ok = doc => {
  const r = validate('dayedits', doc);
  assert.ok(
    r === true || (r && (r.ok === true || (Array.isArray(r) && !r.length) || r.valid === true)),
    JSON.stringify(r)
  );
};

test('the dayedits kind enum is core LIST_KINDS, in step', () => {
  const kind = schemas.dayedits.properties.added.additionalProperties.properties.kind;
  assert.deepEqual([...kind.enum].sort(), Object.keys(EV.LIST_KINDS).sort());
});

test('New task saves each of the nine kinds', () => {
  assert.equal(Object.keys(EV.LIST_KINDS).length, 9);
  for (const kind of Object.keys(EV.LIST_KINDS)) {
    const r = EV.listEdit(
      null,
      null,
      { action: 'add', text: 'A ' + kind + ' task', kind, minutes: 20 },
      { now: NOW, by: 'Matt', date: '2026-10-16' }
    );
    assert.equal(r.doc.added[r.id].kind, kind);
    ok(r.doc);
  }
});

test("Snooze moves a Learn row to tomorrow's list as a Learn", () => {
  const today = EV.listEdit(
    null,
    null,
    { action: 'add', text: 'Learn fluids', kind: 'learn', minutes: 25 },
    { now: NOW, by: 'Matt', date: '2026-10-16' }
  );
  const it = today.doc.added[today.id];
  const kindOf = Object.fromEntries(
    Object.entries(EV.LIST_KINDS)
      .filter(([, t]) => t)
      .map(([k, t]) => [t, k])
  );
  const tomorrow = EV.listEdit(
    null,
    null,
    { action: 'add', text: it.text, kind: kindOf[it.tag], minutes: it.minutes },
    { now: NOW, by: 'Matt', date: '2026-10-17' }
  );
  assert.equal(tomorrow.doc.added[tomorrow.id].kind, 'learn');
  ok(tomorrow.doc);
  const off = EV.listEdit(
    null,
    today.doc,
    { action: 'remove', id: today.id },
    { now: NOW, by: 'Matt', date: '2026-10-16' }
  );
  ok(off.doc);
});

test('the job runner configures core: NUR 112 keeps NCLEX, BIO 201 does not get it', () => {
  const { spec } = jobsSpec();
  EV.configure(null);
  try {
    J.prepare({ db: { get: () => null, list: () => [] }, spec, jobId: 'none', now: NOW, release: 'v4' });
  } catch {
    // no such job: prepare configures core before it reads the record
  }
  const line = 'Realistic NCLEX-style client scenarios';
  assert.equal(EV.frameText(line, 'NUR 112'), line);
  assert.doesNotMatch(EV.frameText(line, 'BIO 201'), /NCLEX/);
});
