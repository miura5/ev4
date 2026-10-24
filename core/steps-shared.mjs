// Helpers the steps of more than one pipeline share (core/steps.mjs and its pipeline files): the weak-spot models,
// the fields a set item may carry, and the library's passages.
import EV from './evcore.mjs';

export const models = db =>
  EV.buildWeakspots({
    weakspots: db.weakspots || [],
    sets: db.sets || [],
    answers: db.answers || [],
    exams: db.exams || [],
  });
/** Fields a set item may carry (spec/schemas/sets.schema.json); anything else an agent adds is dropped. */
export const ITEM_FIELDS = [
  'type',
  'stem',
  'options',
  'correct',
  'rationales',
  'matrix',
  'answer',
  'unit',
  'tolerance',
  'steps',
  'weakspotId',
  'objective',
  'topic',
  'cjStep',
  'verify',
  'sourceRef',
  'chapters',
];
export const pick = (q, keys) => Object.fromEntries(keys.filter(k => q[k] !== undefined).map(k => [k, q[k]]));
/** The library's passages, as the page searches them (D-079): materials Matt can read, minus pictures not yet read. */
export function library(db) {
  const mats = EV.liveMaterials(db.materials, db.materialedits).filter(m => !(m.needsOcr && !m.ocr));
  return EV.libraryIndex(EV.libraryChunks(mats));
}
export const passages = (idx, q, n = 2) =>
  EV.searchLibrary(idx, q, { k: n }).map(h => ({
    ref: 'materials/' + h.id,
    page: h.page || null,
    title: h.title,
    text: h.text.slice(0, 600),
  }));
