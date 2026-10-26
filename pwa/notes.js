// B-401 (D-325): the Worker's check of a note, the same one the page's write() and lint ask (core/validate.mjs
// noteProblem): the notes schema, the size cap and the write-once createdAt and earlierOf. A page save (PUT) and a run
// API batch both refuse a note that fails it, so nothing written by any path stores a malformed or oversized note.
import { makeValidator, noteProblem } from '../core/validate.mjs';
import notesSchema from '../spec/schemas/notes.schema.json' with { type: 'json' };

/** spec.capacity.documentBytes (test/notes.test.mjs holds the two equal; the Worker does not bundle the spec). */
export const DOCUMENT_BYTES = 262144;

const validate = makeValidator({ notes: notesSchema });

/** null when a write to collection/id leaving `doc` (prev: as stored, null for a create) is sound, else the reason. */
export function writeProblem(collection, id, doc, prev) {
  if (collection !== 'notes') return null;
  return noteProblem(validate, id, doc, prev || null, DOCUMENT_BYTES);
}
