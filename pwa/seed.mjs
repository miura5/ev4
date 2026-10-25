// The demo's record: the made-up synthetic record the page harnesses use (test/data/synthetic.cjs), as SQL for D1.
// Nothing here is Matt's. Usage: node seed.mjs > seed.sql, then wrangler d1 execute ev-demo --file seed.sql [--remote]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { syntheticRecord } = require('../test/data/synthetic.cjs');

const db = syntheticRecord();
for (const c of ['system', 'legacy', 'debug', 'journal']) delete db[c]; // as the smoke tier boots it
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const at = Date.now();
console.log('DELETE FROM docs;');
for (const [c, docs] of Object.entries(db))
  for (const [id, doc] of Object.entries(docs))
    console.log(`INSERT INTO docs (c, id, data, at) VALUES (${q(c)}, ${q(id)}, ${q(JSON.stringify(doc))}, ${at});`);
