// The app's made-up record: the synthetic record the page harnesses use (test/data/synthetic.cjs), as SQL for D1.
// Nothing here is Matt's. Usage: node seed.mjs > seed.sql, then wrangler d1 execute <db> --file seed.sql [--remote].
// --append leaves out the opening DELETE, for a database that is empty (the staging D1's first seed, B-311): nothing
// is deleted there.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { syntheticRecord } = require('../test/data/synthetic.cjs');

/** Collections left out, as the smoke tier boots the record. */
export const LEFT_OUT = ['system', 'legacy', 'debug', 'journal'];

/** The record the app is seeded with: { collection: { id: doc } }. */
export function seedRecord() {
  const db = syntheticRecord();
  for (const c of LEFT_OUT) delete db[c];
  return db;
}

/** Documents per collection in the seeded record. */
export function seedCounts() {
  return Object.fromEntries(Object.entries(seedRecord()).map(([c, docs]) => [c, Object.keys(docs).length]));
}

export function seedSql({ append = false, at = Date.now() } = {}) {
  const q = s => "'" + String(s).replace(/'/g, "''") + "'";
  const lines = append ? [] : ['DELETE FROM docs;'];
  for (const [c, docs] of Object.entries(seedRecord()))
    for (const [id, doc] of Object.entries(docs))
      lines.push(`INSERT INTO docs (c, id, data, at) VALUES (${q(c)}, ${q(id)}, ${q(JSON.stringify(doc))}, ${at});`);
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.stdout.write(seedSql({ append: process.argv.includes('--append') }));
