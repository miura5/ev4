// Loads the schema registry from spec/schemas/ (node only; the page gets the same schemas as a published file) and
// returns the validator from validate.mjs. One file per collection: <collection>.schema.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeValidator } from './validate.mjs';

export const SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'spec', 'schemas');

export function loadSchemas(dir = SCHEMA_DIR) {
  const schemas = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.schema.json')).sort()) {
    schemas[f.slice(0, -'.schema.json'.length)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  return schemas;
}

export function loadValidator(dir = SCHEMA_DIR) {
  return makeValidator(loadSchemas(dir));
}

/** Reads a record export folder (one folder per collection, one JSON file per document) as [{collection, id, doc}]. */
export function readExport(dir) {
  const out = [];
  for (const col of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, col);
    if (!fs.statSync(p).isDirectory()) continue;
    for (const f of fs.readdirSync(p).filter(f => f.endsWith('.json')).sort()) {
      out.push({ collection: col, id: f.slice(0, -5), doc: JSON.parse(fs.readFileSync(path.join(p, f), 'utf8')) });
    }
  }
  return out;
}
