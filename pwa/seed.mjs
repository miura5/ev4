// The app's made-up record: the synthetic record the page harnesses use (test/data/synthetic.cjs), as SQL for D1.
// Nothing here is Matt's. Usage: node seed.mjs > seed.sql, then wrangler d1 execute <db> --file seed.sql [--remote].
// --append leaves out the opening DELETE, for a database that is empty (the staging D1's first seed, B-311): nothing
// is deleted there. --fill <ms> (B-487) adds only the seed documents a seeded D1 lacks, dated as its seed.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { syntheticRecord } = require('../test/data/synthetic.cjs');

/** Collections left out, as the smoke tier boots the record. */
export const LEFT_OUT = ['system', 'legacy', 'debug', 'journal'];

/** The record the app is seeded with: { collection: { id: doc } }. Its dates run from `now` (the synthetic record is
 * date-relative), so the record seeded on a day is seedRecord(that day). */
export function seedRecord(now = new Date()) {
  const db = syntheticRecord(now);
  for (const c of LEFT_OUT) delete db[c];
  return db;
}

/** Documents per collection in the seeded record. */
export function seedCounts() {
  return Object.fromEntries(Object.entries(seedRecord()).map(([c, docs]) => [c, Object.keys(docs).length]));
}

/** fill (B-487): the seed as of `at`, the moment the staging D1 was seeded, each row inserted only where no document
 * has its collection and id (ON CONFLICT DO NOTHING): a seed document added to the made-up record since (a new
 * collection's fixture) joins the record dated as the rest of the seed, and nothing there is overwritten or deleted. */
export function seedSql({ append = false, fill = false, at = Date.now() } = {}) {
  const q = s => "'" + String(s).replace(/'/g, "''") + "'";
  const lines = append || fill ? [] : ['DELETE FROM docs;'];
  const tail = fill ? ' ON CONFLICT (c, id) DO NOTHING;' : ';';
  // B-389: the record is dated from the same instant its rows carry as `at`, which the staging check rebuilds it from
  for (const [c, docs] of Object.entries(seedRecord(new Date(at))))
    for (const [id, doc] of Object.entries(docs))
      lines.push(
        `INSERT INTO docs (c, id, data, at) VALUES (${q(c)}, ${q(id)}, ${q(JSON.stringify(doc))}, ${at})${tail}`
      );
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // --fill <ms>: the seed documents a seeded D1 lacks, as of its seeding moment (the oldest `at` it holds)
  const i = process.argv.indexOf('--fill');
  const at = i > 0 ? Number(process.argv[i + 1]) : NaN;
  if (i > 0 && !(Number.isInteger(at) && at > 0)) {
    console.error('usage: node seed.mjs --fill <the seeded D1’s oldest at, in ms>');
    process.exit(2);
  }
  process.stdout.write(i > 0 ? seedSql({ fill: true, at }) : seedSql({ append: process.argv.includes('--append') }));
}
