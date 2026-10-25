// B-316: the restore check for the staging R2 exports (pwa/backup.js), run by the pwa-staging workflow with backup on:
//   node tools/pwa-backup.mjs restore-sql <export.json> <table>   SQL that restores the export into a new table of the
//                                                                 scratch D1 (CREATE TABLE, then one INSERT a document);
//                                                                 refuses an export whose documents miss its manifest
//   node tools/pwa-backup.mjs verify <export.json> <rows.json>    rows.json: `wrangler d1 execute --json` of
//                                                                 SELECT c, id, data FROM <table>; GREEN when counts and
//                                                                 SHA-256 hashes per collection equal the export's
// Each restore goes into a table new to it (restore_<run>), so nothing in the scratch D1 is replaced or deleted. It
// prints counts and hashes only, never a document.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { manifestOf, manifestDiffs, EXPORT_KIND } from '../pwa/backup.js';

const q = s => "'" + String(s).replace(/'/g, "''") + "'";

/** Reads an export and checks it is one, with its documents matching its own manifest. */
export async function readExport(text) {
  const exp = JSON.parse(text);
  if (exp.kind !== EXPORT_KIND || exp.schema !== 1 || !Array.isArray(exp.docs))
    throw new Error('not an E.V. D1 export');
  const diffs = manifestDiffs(await manifestOf(exp.docs), exp.collections || {});
  if (diffs.length) throw new Error('the export misses its own manifest: ' + diffs.join('; '));
  return exp;
}

/** The SQL that restores an export into the new table `table`. */
export function restoreSql(exp, table) {
  if (!/^restore_[a-z0-9_]+$/.test(table)) throw new Error('the table must be named restore_<run>');
  const lines = [
    `CREATE TABLE ${table} (c TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL, v INTEGER NOT NULL, PRIMARY KEY (c, id));`,
  ];
  for (const d of exp.docs)
    lines.push(
      `INSERT INTO ${table} (c, id, data, at, v) VALUES (${q(d.c)}, ${q(d.id)}, ${q(d.data)}, ${Number(d.at)}, ${Number(d.v) || 1});`
    );
  return lines.join('\n') + '\n';
}

/** The rows of a `wrangler d1 execute --json` answer. */
export function rowsOf(answer) {
  const a = Array.isArray(answer) ? answer : [answer];
  return a.flatMap(x => (x && x.results) || []);
}

/** The check, as [{ ok, what }]: one line per collection, then the totals. */
export async function verify(exp, rows) {
  const got = await manifestOf(rows);
  const want = exp.collections;
  const diffs = manifestDiffs(got, want);
  const lines = Object.keys(want)
    .sort()
    .map(c => ({
      ok: !diffs.some(d => d.startsWith(c + ':')),
      what: `${c}: ${(got[c] || { count: 0 }).count} of ${want[c].count}, sha256 ${want[c].sha256.slice(0, 12)}`,
    }));
  for (const d of diffs) if (!want[d.split(':')[0]]) lines.push({ ok: false, what: d });
  const total = Object.values(want).reduce((a, b) => a + b.count, 0);
  lines.push({
    ok: diffs.length === 0,
    what: diffs.length
      ? `restore differs: ${diffs.join('; ')}`
      : `restored ${rows.length} documents in ${Object.keys(want).length} collections, counts and hashes equal (${total} exported)`,
  });
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, file, arg] = process.argv.slice(2);
  try {
    const exp = await readExport(fs.readFileSync(file, 'utf8'));
    if (cmd === 'restore-sql' && arg) process.stdout.write(restoreSql(exp, arg));
    else if (cmd === 'verify' && arg) {
      const lines = await verify(exp, rowsOf(JSON.parse(fs.readFileSync(arg, 'utf8'))));
      for (const l of lines) console.log(`${l.ok ? 'ok ' : 'NO '} ${l.what}`);
      const green = lines.every(l => l.ok);
      console.log(`pwa-backup verify (${exp.at}): ${green ? 'GREEN' : 'RED'}`);
      process.exit(green ? 0 : 1);
    } else {
      console.error(
        'usage: node tools/pwa-backup.mjs restore-sql <export.json> <table> | verify <export.json> <rows.json>'
      );
      process.exit(2);
    }
  } catch (e) {
    console.error('pwa-backup: ' + e.message);
    process.exit(1);
  }
}
