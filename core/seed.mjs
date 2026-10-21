// seed-staging (Operational architecture, "Staging seeded from live"): makes the staging record a copy of the live
// record as of an export, and stamps system/seed with that export's time, document counts and per-collection
// hashes, so verify-deploy staging can say how old staging is. Pure. A v3 export is migrated first (staging holds v4
// documents); a v4 export or a backup is copied as it is. The journal is never part of a seed.
import EV from './evcore.mjs';
import { migrateV3, bumpWrite, BUMPS } from './migrate.mjs';

const isV4 = d => !!d && Number.isInteger(d.schema) && d.schema >= 1 && typeof d.writer === 'string';

/** sha256 of a collection's documents in id order (canonical JSON), the fingerprint a restore drill checks. */
export function collectionHash(docs) {
  const rows = (docs || []).map(d => [d.id, EV.docData(d)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return EV.sha256(EV.stableStringify(rows));
}

/**
 * export: {collection: [docs with id]}. opts: {at (the seeding time), exportedAt (when the export was taken),
 * from: 'live export' | 'backup', command}. Returns {writes, seed, migrated}.
 */
export function seedStaging(exp, { at, exportedAt, from = 'live export', command = 'seed-staging' } = {}) {
  if (!at || !exportedAt) throw new Error('seedStaging needs opts.at and opts.exportedAt');
  if (exp.journal && exp.journal.length)
    throw new Error('the journal is never seeded: it stays in the live record only (D-059)');
  const isV3 = Object.entries(exp).some(([col, docs]) => col !== 'legacy' && (docs || []).some(d => d && !isV4(d)));
  let docs = [];
  if (isV3)
    docs = migrateV3(exp, { at: exportedAt }).writes.map(w => ({ collection: w.collection, id: w.id, data: w.data }));
  // A v4 export lands at today's schema versions: each document goes through its collection's bumps (none: unchanged).
  else
    for (const [col, list] of Object.entries(exp))
      for (const d of list || [])
        for (const w of bumpWrite({ op: 'set', collection: col, id: d.id, data: EV.docData(d) }, exportedAt))
          docs.push({ collection: w.collection, id: w.id, data: w.data });
  // system/* is Config: deploy writes it per target, so a seed never carries the source record's spec or manifest.
  docs = docs.filter(d => d.collection !== 'system');
  const by = {};
  for (const d of docs) (by[d.collection] = by[d.collection] || []).push({ id: d.id, ...d.data });
  const counts = {},
    hashes = {};
  for (const col of Object.keys(by).sort()) {
    counts[col] = by[col].length;
    hashes[col] = collectionHash(by[col]);
  }
  const seed = {
    ...EV.envelope('deploy', 'seed-staging', at),
    from,
    exportedAt: new Date(exportedAt).toISOString(),
    migration: isV3 ? 'v3-to-v4' : null,
    counts,
    hashes,
    command,
  };
  const writes = [
    ...docs.map(d => ({ op: 'set', collection: d.collection, id: d.id, data: d.data })),
    { op: 'set', collection: 'system', id: 'seed', data: seed },
  ];
  return { writes, seed, migrated: isV3 };
}

/** How old a seed is, in whole days, as of `now`. */
export const seedAgeDays = (seed, now) => Math.max(0, Math.floor((EV.toMs(now) - EV.toMs(seed.exportedAt)) / 864e5));

/**
 * D-186 (B-163): a backup's documents carried to the checkout's schemas, as a restore drill needs them. `collections` is
 * the backup as written (its manifest already checked); `versions` is {collection: the version this build's schema
 * registry is at, or null for a collection of copies kept as written}. Each document below its collection's version goes through the bumps (core/migrate.mjs) one by one;
 * documents a bump implies (an exam's score becoming examedits/<id>) are added unless the backup has that document. It
 * refuses, with the reason, a document newer than this build's schema (a backup taken by a later build) and a version
 * with no migration to the next. Returns {collections, schemas: {collection: {from: [versions], to, docs}}, problems}.
 */
export function migrateBackup(collections, versions, { at } = {}) {
  if (!at) throw new Error('migrateBackup needs opts.at');
  const out = {};
  const schemas = {};
  const problems = [];
  const implied = [];
  for (const [c, docs] of Object.entries(collections)) {
    if (versions[c] === null) {
      out[c] = [...docs]; // a collection of copies (legacy): kept as written, whatever version each copy carries
      continue;
    }
    const to = versions[c] || 1;
    const steps = BUMPS[c] || {};
    out[c] = [];
    for (const d of docs) {
      const from = d.schema || 1;
      if (from > to) {
        problems.push(
          `${c}/${d.id} is at schema ${from}, newer than this build's ${to}: the backup was taken by a later build; restore it with a build at or past that one`
        );
        continue;
      }
      if (from === to) {
        out[c].push(d);
        continue;
      }
      const missing = [];
      for (let v = from; v < to; v++) if (!steps[v]) missing.push(v);
      if (missing.length) {
        problems.push(
          `${c}/${d.id} is at schema ${from} and this build's is ${to}, but there is no migration from schema ${missing[0]} to ${missing[0] + 1}`
        );
        continue;
      }
      const [main, ...also] = bumpWrite({ op: 'set', collection: c, id: d.id, data: EV.docData(d) }, at);
      out[c].push({ id: d.id, ...main.data });
      implied.push(...also);
      const s = (schemas[c] = schemas[c] || { from: [], to, docs: 0 });
      if (!s.from.includes(from)) s.from.push(from);
      s.docs++;
    }
  }
  for (const a of implied) {
    const list = (out[a.collection] = out[a.collection] || []);
    if (list.some(d => d.id === a.id)) continue;
    list.push({ id: a.id, ...a.data });
    const s = (schemas[a.collection] = schemas[a.collection] || { from: [], to: versions[a.collection] || 1, docs: 0 });
    s.implied = (s.implied || 0) + 1;
  }
  for (const c of Object.keys(out)) out[c].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const s of Object.values(schemas)) s.from.sort((a, b) => a - b);
  return { collections: out, schemas, problems };
}

/** The per-collection line a restore names: "days schema 1 to 2 (12)", one per migrated collection, in name order. */
export const migratedLine = schemas =>
  Object.entries(schemas)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([c, s]) =>
        `${c} ${s.docs ? `schema ${s.from.join(' and ')} to ${s.to} (${s.docs})` : `at ${s.to}`}${s.implied ? `, ${s.implied} added by the migration` : ''}`
    )
    .join('; ');
