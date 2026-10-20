// Schema validation shared by the CLI and the page (Data architecture, "Schema registry"). Pure and dependency-free:
// it runs in node and in the browser, and never reads files; the caller hands it the schemas.
//
// Supports the JSON Schema 2020-12 subset E.V.'s schemas use, and refuses a schema that uses anything else, so a
// schema can never look stricter than it is: type, enum, const, properties, required, additionalProperties,
// patternProperties, propertyNames, items, minItems, maxItems, uniqueItems, minLength, maxLength, pattern, format
// (date-time, date), minimum, maximum, $ref (#/$defs/... within the same file), anyOf, oneOf, allOf, not.
// Annotations ($schema, $id, $comment, title, description, default, examples, $defs, x-ev) are ignored.

const ASSERTIONS = new Set([
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'patternProperties',
  'propertyNames',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  '$ref',
  'anyOf',
  'oneOf',
  'allOf',
  'not',
]);
const ANNOTATIONS = new Set([
  '$schema',
  '$id',
  '$comment',
  'title',
  'description',
  'default',
  'examples',
  '$defs',
  'x-ev',
]);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
function typeMatches(v, t) {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
}
function realDate(s) {
  const d = new Date(s.length === 10 ? s + 'T00:00:00Z' : s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s.slice(0, 10);
}
const ptr = path => (path.length ? '/' + path.join('/') : '(document)');
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Throws if a schema uses a keyword this validator does not enforce, or a $ref it cannot resolve. */
export function checkSchema(schema, root = schema, at = '#') {
  if (typeof schema === 'boolean') return;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    throw new Error(`${at}: a schema must be an object or boolean`);
  for (const k of Object.keys(schema))
    if (!ASSERTIONS.has(k) && !ANNOTATIONS.has(k)) throw new Error(`${at}: unsupported keyword ${k}`);
  if (schema.$ref) {
    if (!/^#\/\$defs\/[\w-]+$/.test(schema.$ref)) throw new Error(`${at}: only #/$defs/<name> refs are supported`);
    if (!root.$defs || !(schema.$ref.slice(8) in root.$defs)) throw new Error(`${at}: unresolved ${schema.$ref}`);
  }
  if (schema.format && !['date-time', 'date'].includes(schema.format))
    throw new Error(`${at}: unsupported format ${schema.format}`);
  for (const k of ['properties', 'patternProperties', '$defs'])
    for (const [n, s] of Object.entries(schema[k] || {})) checkSchema(s, root, `${at}/${k}/${n}`);
  for (const k of ['additionalProperties', 'items', 'propertyNames', 'not'])
    if (k in schema) checkSchema(schema[k], root, `${at}/${k}`);
  for (const k of ['anyOf', 'oneOf', 'allOf'])
    (schema[k] || []).forEach((s, i) => checkSchema(s, root, `${at}/${k}/${i}`));
}

function check(schema, v, path, root, errors) {
  if (schema === true) return;
  if (schema === false) {
    errors.push({ path: ptr(path), message: 'not allowed here' });
    return;
  }
  if (schema.$ref) check(root.$defs[schema.$ref.slice(8)], v, path, root, errors);
  if ('type' in schema) {
    const types = [].concat(schema.type);
    if (!types.some(t => typeMatches(v, t))) {
      errors.push({ path: ptr(path), message: `expected ${types.join(' or ')}, got ${typeOf(v)}` });
      return;
    }
  }
  if ('const' in schema && !deepEqual(v, schema.const))
    errors.push({ path: ptr(path), message: `must be ${JSON.stringify(schema.const)}` });
  if (schema.enum && !schema.enum.some(e => deepEqual(e, v)))
    errors.push({ path: ptr(path), message: `must be one of ${schema.enum.map(e => JSON.stringify(e)).join(', ')}` });
  if (typeof v === 'string') {
    if (schema.minLength !== undefined && v.length < schema.minLength)
      errors.push({ path: ptr(path), message: `shorter than ${schema.minLength}` });
    if (schema.maxLength !== undefined && v.length > schema.maxLength)
      errors.push({ path: ptr(path), message: `longer than ${schema.maxLength}` });
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(v))
      errors.push({ path: ptr(path), message: `does not match ${schema.pattern}` });
    if (schema.format === 'date-time' && !(ISO.test(v) && realDate(v)))
      errors.push({ path: ptr(path), message: 'not an ISO UTC time (YYYY-MM-DDTHH:MM:SSZ)' });
    if (schema.format === 'date' && !(DAY.test(v) && realDate(v)))
      errors.push({ path: ptr(path), message: 'not a date (YYYY-MM-DD)' });
  }
  if (typeof v === 'number') {
    if (schema.minimum !== undefined && v < schema.minimum)
      errors.push({ path: ptr(path), message: `below ${schema.minimum}` });
    if (schema.maximum !== undefined && v > schema.maximum)
      errors.push({ path: ptr(path), message: `above ${schema.maximum}` });
  }
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems)
      errors.push({ path: ptr(path), message: `fewer than ${schema.minItems} items` });
    if (schema.maxItems !== undefined && v.length > schema.maxItems)
      errors.push({ path: ptr(path), message: `more than ${schema.maxItems} items` });
    if (schema.uniqueItems && new Set(v.map(x => JSON.stringify(x))).size !== v.length)
      errors.push({ path: ptr(path), message: 'items are not unique' });
    if (schema.items !== undefined) v.forEach((x, i) => check(schema.items, x, [...path, String(i)], root, errors));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const r of schema.required || []) if (!(r in v)) errors.push({ path: ptr([...path, r]), message: 'required' });
    const props = schema.properties || {};
    const pats = Object.entries(schema.patternProperties || {}).map(([p, s]) => [new RegExp(p, 'u'), s]);
    for (const [k, x] of Object.entries(v)) {
      if (schema.propertyNames) check(schema.propertyNames, k, [...path, k], root, errors);
      let matched = false;
      if (k in props) {
        matched = true;
        check(props[k], x, [...path, k], root, errors);
      }
      for (const [re, s] of pats)
        if (re.test(k)) {
          matched = true;
          check(s, x, [...path, k], root, errors);
        }
      if (!matched && 'additionalProperties' in schema) {
        if (schema.additionalProperties === false) errors.push({ path: ptr([...path, k]), message: 'unknown field' });
        else check(schema.additionalProperties, x, [...path, k], root, errors);
      }
    }
  }
  for (const s of schema.allOf || []) check(s, v, path, root, errors);
  const run = s => {
    const e = [];
    check(s, v, path, root, e);
    return e;
  };
  const passes = s => run(s).length === 0;
  // When no branch passes, report the inner errors of the one branch whose type matched (a nullable object that is an
  // object), so the refusal names the field; otherwise one line for the whole value.
  const explain = (branches, fallback) => {
    const here = ptr(path);
    const typed = branches.map(run).filter(e => !e.some(x => x.path === here && x.message.startsWith('expected ')));
    if (typed.length === 1) errors.push(...typed[0]);
    else errors.push({ path: here, message: fallback });
  };
  if (schema.anyOf && !schema.anyOf.some(passes)) explain(schema.anyOf, 'matches none of the allowed shapes');
  if (schema.oneOf) {
    const n = schema.oneOf.filter(passes).length;
    if (n === 0) explain(schema.oneOf, 'matches none of the allowed shapes');
    else if (n > 1) errors.push({ path: ptr(path), message: 'must match exactly one allowed shape' });
  }
  if (schema.not && passes(schema.not)) errors.push({ path: ptr(path), message: 'matches a forbidden shape' });
}

/** Validates one value against one schema. Returns {ok, errors: [{path, message}]}. */
export function validateAgainst(schema, value) {
  const errors = [];
  check(schema, value, [], schema, errors);
  return { ok: errors.length === 0, errors };
}

/**
 * Builds the registry's validator from {collection: schema}. validate(collection, doc, {id}) picks the document's own
 * shape when the schema lists one for that id (x-ev.documents: {id: "#/$defs/<name>"}), so talk/memory and system/spec
 * are checked as themselves. An unknown collection is an error, never a pass.
 */
export function makeValidator(schemas) {
  for (const [name, s] of Object.entries(schemas)) {
    try {
      checkSchema(s);
    } catch (e) {
      throw new Error(`${name} schema: ${e.message}`);
    }
  }
  return function validate(collection, doc, { id } = {}) {
    const schema = schemas[collection];
    if (!schema) return { ok: false, errors: [{ path: '(collection)', message: `no schema for ${collection}` }] };
    const ref = id !== undefined && schema['x-ev'] && schema['x-ev'].documents && schema['x-ev'].documents[id];
    return validateAgainst(ref ? { $ref: ref, $defs: schema.$defs } : schema, doc);
  };
}

/** One line for a refusal: "answers/review-2026-10-17: /schema: required". */
export function describeErrors(label, result) {
  return result.errors.map(e => `${label}: ${e.path}: ${e.message}`).join('\n');
}
