// seed-staging (Operational architecture, "Staging seeded from live"): makes the staging record a copy of the live
// record as of an export, and stamps system/seed with that export's time, document counts and per-collection
// hashes, so verify-deploy staging can say how old staging is. Pure. A v3 export is migrated first (staging holds v4
// documents); a v4 export or a backup is copied as it is. The journal is never part of a seed.
import EV from './evcore.mjs';
import { migrateV3, bumpWrite } from './migrate.mjs';

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
  if (exp.journal && exp.journal.length) throw new Error('the journal is never seeded: it stays in the live record only (D-059)');
  const isV3 = Object.entries(exp).some(([col, docs]) => col !== 'legacy' && (docs || []).some(d => d && !isV4(d)));
  let docs = [];
  if (isV3) docs = migrateV3(exp, { at: exportedAt }).writes.map(w => ({ collection: w.collection, id: w.id, data: w.data }));
  // A v4 export lands at today's schema versions: each document goes through its collection's bumps (none: unchanged).
  else for (const [col, list] of Object.entries(exp)) for (const d of list || []) for (const w of bumpWrite({ op: 'set', collection: col, id: d.id, data: EV.docData(d) }, exportedAt)) docs.push({ collection: w.collection, id: w.id, data: w.data });
  // system/* is Config: deploy writes it per target, so a seed never carries the source record's spec or manifest.
  docs = docs.filter(d => d.collection !== 'system');
  const by = {}; for (const d of docs) (by[d.collection] = by[d.collection] || []).push({ id: d.id, ...d.data });
  const counts = {}, hashes = {};
  for (const col of Object.keys(by).sort()) { counts[col] = by[col].length; hashes[col] = collectionHash(by[col]); }
  const seed = { ...EV.envelope('deploy', 'seed-staging', at), from, exportedAt: new Date(exportedAt).toISOString(), migration: isV3 ? 'v3-to-v4' : null, counts, hashes, command };
  const writes = [...docs.map(d => ({ op: 'set', collection: d.collection, id: d.id, data: d.data })), { op: 'set', collection: 'system', id: 'seed', data: seed }];
  return { writes, seed, migrated: isV3 };
}

/** How old a seed is, in whole days, as of `now`. */
export const seedAgeDays = (seed, now) => Math.max(0, Math.floor((EV.toMs(now) - EV.toMs(seed.exportedAt)) / 864e5));
