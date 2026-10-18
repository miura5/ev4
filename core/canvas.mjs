// The Mac lane's read-only Canvas sync (Operational architecture, "The Mac lane"; B-12 in spec.boundaries). The fetch
// scripts are files in scripts/canvas/; this module fills in their parameters, so the browser runs text that came from
// the verified checkout. Each part starts in the Canvas tab, is collected by the poll script, and comes back as a
// tool result the browser tool saves to a file; `unwrap` turns that file into <run dir>/in/canvas-<part>.json.
// canvasRaw gathers those files for EVCore.normalizeCanvas. Pure apart from reading the files it is given.
import fs from 'node:fs';
import path from 'node:path';
import EV from './evcore.mjs';

export const PARTS = ['dates', 'files', 'texts', 'poll'];
/** Files per texts batch: one slide deck's text can reach maxChars, and the device bridge cuts results near 250 KB. */
export const TEXTS_PER_BATCH = 3;
const FN = /\/\*@FN:(\w+)\*\/null/g;

/** One part's script: the template with its parameters and the E.V. core functions it names filled in. */
export function canvasScript(root, part, params) {
  if (!PARTS.includes(part)) throw new Error(`no Canvas script ${part} (${PARTS.join(', ')})`);
  const src = fs.readFileSync(path.join(root, 'scripts', 'canvas', part + '.js'), 'utf8');
  if (!src.includes('/*@PARAMS*/null')) throw new Error(`scripts/canvas/${part}.js has no /*@PARAMS*/ slot`);
  return src.replace('/*@PARAMS*/null', () => JSON.stringify({ part, ...params })).replace(FN, (m, name) => {
    if (typeof EV[name] !== 'function') throw new Error(`scripts/canvas/${part}.js asks for EVCore.${name}, which is not a function`);
    return '(' + EV[name].toString() + ')';
  });
}

/** The parameters each part takes, from the spec and the run's pulled record. */
export function scriptParams(part, { spec, db, batch, files, of }) {
  const canvas = spec.registry.canvas;
  if (!canvas || !canvas.courses) throw new Error('spec.registry.canvas has no courses');
  if (part === 'poll') return { part: of };
  if (part === 'dates') return { courses: canvas.courses, knownAnnouncements: (db.announcements || []).map(a => String(a.id).replace(/^canvas-/, '')) };
  if (part === 'files') return { courses: canvas.courses, rules: canvas.library || { modules: [] } };
  if (part === 'texts') { const L = spec.constants.library; return { batch, files, lib: { pdfjs: L.pdfjs, pdfjsWorker: L.pdfjsWorker, maxChars: L.maxChars, ocrMinChars: L.ocrMinChars } }; }
  throw new Error('no part ' + part);
}

/** The listed files that are new or changed since the record's materials (fileId and Canvas's updated_at). */
export function changedFiles(listing, materials) {
  const known = {}; for (const m of materials || []) if (m.fileId != null) known[String(m.fileId)] = m.fileUpdatedAt || '';
  return ((listing && listing.files) || []).filter(f => known[String(f.fileId)] === undefined || known[String(f.fileId)] !== (f.updatedAt || ''));
}
/** The changed files in batches of TEXTS_PER_BATCH, or just the files named by ids (a batch cut by the bridge, again). */
export function textBatches(changed, ids) {
  if (ids && ids.length) return [changed.filter(f => ids.includes(String(f.fileId)))];
  const out = []; for (let i = 0; i < changed.length; i += TEXTS_PER_BATCH) out.push(changed.slice(i, i + TEXTS_PER_BATCH));
  return out;
}

/**
 * A browser tool result saved to a file → the value the script returned. The tool saves [{type, text}] (or the text
 * itself); poll pads its JSON so the tool saves it. A result the bridge cut no longer parses: that is said, never guessed.
 */
export function unwrap(raw) {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* the text itself */ } }
  let text = Array.isArray(v) ? v.map(x => (x && x.text) || '').join('') : typeof v === 'string' ? v : JSON.stringify(v);
  text = text.split('\n\n(captured at origin')[0].trim();
  let out;
  try { out = JSON.parse(text); while (typeof out === 'string') out = JSON.parse(out); }
  catch { throw new Error(/still running|not started/.test(text) ? `that is not a finished result: ${text.slice(0, 120)}` : `the saved result does not parse (${text.length} characters): it was probably cut by the device bridge; collect that texts batch one file at a time with --ids`); }
  if (out && typeof out === 'object' && '_pad' in out && 'result' in out) out = out.result;
  if (!out || typeof out !== 'object' || !out.part && !out.failed) throw new Error('the saved result is not a Canvas part');
  return out;
}

/** Everything the run collected in <dir>/in, as normalizeCanvas takes it. */
export function canvasRaw(inDir, spec) {
  const read = f => JSON.parse(fs.readFileSync(path.join(inDir, f), 'utf8'));
  const has = f => fs.existsSync(path.join(inDir, f));
  const dates = has('canvas-dates.json') ? read('canvas-dates.json') : null;
  const listing = has('canvas-files.json') ? read('canvas-files.json') : null;
  const texts = (fs.existsSync(inDir) ? fs.readdirSync(inDir) : []).filter(f => /^canvas-texts-[\w,-]+\.json$/.test(f)).sort().map(read);
  const failed = [dates, listing, ...texts].filter(x => x && x.failed).map(x => x.failed);
  const files = texts.flatMap(t => t.files || []);
  return {
    host: spec.registry.canvas.host || null,
    courses: (dates && dates.courses) || spec.registry.canvas.courses,
    planner: (dates && dates.planner) || [],
    announcements: (dates && dates.announcements) || [],
    files: files.filter(f => !f.error),
    errors: [...failed, ...[dates, listing, ...texts].flatMap(x => (x && x.errors) || [])].filter((e, i, a) => a.indexOf(e) === i),
    collected: { dates: !!(dates && !dates.failed), files: !!(listing && !listing.failed), texts: texts.length, signedOut: failed.includes('signed-out') },
  };
}

export default { PARTS, TEXTS_PER_BATCH, canvasScript, scriptParams, changedFiles, textBatches, unwrap, canvasRaw };
