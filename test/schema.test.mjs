// Schema registry (B-02): one JSON Schema per collection that agrees with the spec's collection map, every fixture
// document validates, and planted invalid writes are refused with the field named.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchemas, loadValidator, readExport } from '../core/schemas.mjs';
import { checkSchema, validateAgainst, makeValidator, describeErrors } from '../core/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
const schemas = loadSchemas();
const validate = loadValidator();
const SYNTHETIC = path.join(ROOT, 'test/data/record');
const REAL = path.join(ROOT, 'fixtures/v4');
const fixture = (col, id) => JSON.parse(fs.readFileSync(path.join(SYNTHETIC, col, id + '.json'), 'utf8'));
const refused = (r, pathPrefix) => {
  assert.equal(r.ok, false, 'write was accepted');
  assert.ok(
    r.errors.some(e => e.path.startsWith(pathPrefix)),
    `no error at ${pathPrefix}: ${JSON.stringify(r.errors)}`
  );
};

test('one schema file per collection, and no others', () => {
  assert.deepEqual(Object.keys(schemas).sort(), Object.keys(spec.collections).sort());
  for (const [name, c] of Object.entries(spec.collections))
    assert.ok(fs.existsSync(path.join(ROOT, c.schema)), `${c.schema} missing`);
});

test('every schema file is JSON with indent 1 and no trailing newline', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'spec/schemas'))) {
    const raw = fs.readFileSync(path.join(ROOT, 'spec/schemas', f), 'utf8');
    assert.equal(raw, JSON.stringify(JSON.parse(raw), null, 1), f);
  }
});

test("every schema's metadata agrees with the spec's collection map", () => {
  for (const [name, c] of Object.entries(spec.collections)) {
    const s = schemas[name],
      meta = s['x-ev'];
    assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema', name);
    assert.equal(meta.collection, name);
    assert.equal(meta.class, c.class, `${name}: class`);
    assert.deepEqual(meta.writers, c.writers, `${name}: writers`);
    assert.ok(Number.isInteger(meta.schema) && meta.schema >= 1, `${name}: schema number`);
    if (name === 'legacy') continue;
    assert.deepEqual(s.properties.schema, { const: meta.schema }, `${name}: envelope schema number`);
    assert.deepEqual(s.properties.writer.enum, c.writers, `${name}: envelope writer`);
    for (const f of ['schema', 'writer', 'at', 'source']) assert.ok(s.required.includes(f), `${name}: envelope ${f}`);
    if (c.class === 'Edit') assert.ok(s.required.includes('updatedAt'), `${name}: Edits carry updatedAt`);
    if (c.class === 'Log') assert.ok(s.required.includes('release'), `${name}: Logs carry release`);
    if (['Edit', 'Log'].includes(c.class))
      assert.equal(s.additionalProperties, false, `${name}: ${c.class} documents are closed`);
    for (const doc of Object.keys(c.documents || {}))
      assert.ok(meta.documents && meta.documents[doc], `${name}/${doc}: its own shape`);
    if (c.fixedIds && name === 'system')
      assert.deepEqual(Object.keys(meta.documents).sort(), c.fixedIds.slice().sort());
  }
});

test('the validator enforces every keyword the schemas use (unsupported keywords are refused)', () => {
  for (const [name, s] of Object.entries(schemas)) assert.doesNotThrow(() => checkSchema(s), name);
  assert.throws(
    () => checkSchema({ type: 'object', dependentRequired: { a: ['b'] } }),
    /unsupported keyword dependentRequired/
  );
  assert.throws(() => checkSchema({ $ref: '#/$defs/missing' }), /unresolved/);
  assert.throws(() => checkSchema({ type: 'string', format: 'email' }), /unsupported format/);
  assert.throws(() => makeValidator({ x: { minProperties: 1 } }), /x schema: .*minProperties/);
});

test('every synthetic fixture document validates against its collection schema', () => {
  const docs = readExport(SYNTHETIC);
  assert.ok(docs.length >= Object.keys(spec.collections).length);
  for (const col of Object.keys(spec.collections))
    assert.ok(
      docs.some(d => d.collection === col),
      `no fixture for ${col}`
    );
  for (const { collection, id, doc } of docs) {
    const r = validate(collection, doc, { id });
    assert.ok(r.ok, describeErrors(`${collection}/${id}`, r));
  }
});

test(
  'every real fixture document validates (fixtures/v4, local only)',
  { skip: !fs.existsSync(REAL) && 'no fixtures/v4 export in this checkout' },
  () => {
    const bad = [];
    for (const { collection, id, doc } of readExport(REAL)) {
      const r = validate(collection, doc, { id });
      if (!r.ok) bad.push(describeErrors(`${collection}/${id}`, r));
    }
    assert.deepEqual(bad, []);
  }
);

test('planted invalid writes are refused, with the field named', () => {
  const ws = fixture('weakspots', 'ws-2026-10-16-E9-1-sample-topic');
  const { writer, ...noWriter } = ws;
  refused(validate('weakspots', noWriter), '/writer');
  refused(validate('weakspots', { ...ws, writer: 'weekly' }), '/writer');
  refused(validate('weakspots', { ...ws, at: '2026-10-16 14:00' }), '/at');
  refused(validate('weakspots', { ...ws, schema: 2 }), '/schema');
  refused(validate('weakspots', { ...ws, derived: { status: 'active' } }), '(document)');
  refused(validate('weakspots', { ...ws, events: { 'Oct 16': { type: 'seen' } } }), '/events/Oct 16');
  refused(
    validate('weakspots', { ...ws, events: { 'page-20261016-140500': { type: 'explode' } } }),
    '/events/page-20261016-140500/type'
  );

  const set = fixture('sets', 'review-2026-10-16');
  refused(validate('sets', { ...set, answers: {} }), '(document)');
  refused(
    validate('sets', {
      ...set,
      items: [{ ...set.items[1], matrix: { ...set.items[1].matrix, rows: set.items[1].matrix.rows.slice(0, 2) } }],
    }),
    '/items/0/matrix/rows'
  );
  refused(validate('sets', { ...set, items: [{ ...set.items[0], stem: 'short' }] }), '/items/0/stem');
  refused(validate('sets', { ...set, items: [] }), '/items');

  const edit = fixture('dayedits', '2026-10-16');
  refused(validate('dayedits', { ...edit, plan: {} }), '/plan');
  refused(validate('dayedits', { ...edit, checkin: { energy: 9, at: edit.at } }), '/checkin/energy');
  const { updatedAt, ...noUpdated } = edit;
  refused(validate('dayedits', noUpdated), '/updatedAt');

  const run = fixture('runs', 'morning-20261016-092500-ab12');
  const { release, ...noRelease } = run;
  refused(validate('runs', noRelease), '/release');
  refused(validate('runs', { ...run, pipeline: 'evening' }), '/pipeline');

  const talk = fixture('talk', '2026-10-16');
  const key = Object.keys(talk.messages)[0];
  refused(
    validate('talk', { ...talk, messages: { [key]: { ...talk.messages[key], text: 'x'.repeat(4001) } } }),
    `/messages/${key}/text`
  );
  refused(validate('talk', fixture('talk', 'memory'), { id: '2026-10-17' }), '/date');
  refused(validate('talk', { ...fixture('talk', 'memory'), summary: 'x'.repeat(1201) }, { id: 'memory' }), '/summary');

  refused(
    validate('sessions', { ...fixture('sessions', 'ss-20261016-200000-sample-note'), text: 'the note itself' }),
    '(document)'
  );
  refused(validate('jobs', { ...fixture('jobs', 'job-20261016-140000-sample-guide'), status: 'done' }), '(document)');
  refused(validate('materials', { ...fixture('materials', 'NUR112-900002'), text: 'x'.repeat(200001) }), '/text');
  refused(validate('system', { ...fixture('system', 'manifest'), dirty: true }, { id: 'manifest' }), '/dirty');
  refused(validate('nonsense', {}), '(collection)');
});

test('validator basics: refs, anyOf, oneOf, not, patternProperties and real dates', () => {
  const s = {
    $defs: { n: { type: 'integer', minimum: 0 } },
    type: 'object',
    properties: {
      a: { $ref: '#/$defs/n' },
      b: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
      d: { type: 'string', format: 'date' },
    },
    patternProperties: { '^x-': { type: 'boolean' } },
    additionalProperties: false,
    not: { required: ['z'] },
  };
  assert.ok(validateAgainst(s, { a: 1, b: 'q', 'x-y': true, d: '2026-02-28' }).ok);
  refused(validateAgainst(s, { a: -1 }), '/a');
  refused(validateAgainst(s, { 'x-y': 1 }), '/x-y');
  refused(validateAgainst(s, { q: 1 }), '/q');
  refused(validateAgainst(s, { d: '2026-02-30' }), '/d');
  refused(validateAgainst({ type: 'object', not: { required: ['z'] } }, { z: 1 }), '(document)');
  refused(validateAgainst({ oneOf: [{ type: 'number' }, { type: 'integer' }] }, 3), '(document)');
  assert.ok(validateAgainst({ type: 'number' }, 3).ok);
});

test('B-169: run, job result and debug documents take the release system/manifest carries, a tag or its +n form', async () => {
  const { loadValidator } = await import('../core/schemas.mjs');
  const v = loadValidator();
  const base = { schema: 1, writer: 'worker', at: '2026-10-21T12:00:00Z', source: 'worker run' };
  const result = release => ({
    ...base,
    release,
    status: 'done',
    startedAt: '2026-10-21T12:00:00Z',
    finishedAt: '2026-10-21T12:01:00Z',
    result: { text: 'Done.', links: [] },
    message: 'm-20261021-120100000-job',
    error: null,
  });
  for (const r of ['v4.2.0', 'v4.2.0+30', 'v4.3'])
    assert.ok(v('jobresults', result(r), { id: 'job-x' }).ok, r + ': ' + JSON.stringify(v('jobresults', result(r), { id: 'job-x' }).errors));
  for (const r of ['4.2.0', 'v4.2.0+', 'v4.2.0-rc1', 'v4.2.0+30 '])
    assert.ok(!v('jobresults', result(r), { id: 'job-x' }).ok, r + ' is refused');
  const run = release => ({ ...base, writer: 'worker', release, pipeline: 'worker', startedAt: base.at, status: 'ok' });
  assert.ok(v('runs', run('v4.2.0+30'), { id: 'worker-x' }).ok);
});
