// Chunked plans (Data architecture, "Document conventions"): a run's writes cut by code into batches of at most
// spec.capacity.batch.maxWrites writes and maxBytes bytes, each independently applicable. Pure.

/** Bytes a write adds to a batch body (its JSON, as ArtifactData would receive it). */
export const writeBytes = w => new TextEncoder().encode(JSON.stringify(w)).length;

/**
 * Splits writes into batches in order, none over the limits; a document is addressed at most once per batch (the
 * platform's rule), so a second write to the same document starts a new batch. A single write over maxBytes is an
 * error: it can never be applied and must be split at its source.
 */
export function chunkWrites(writes, { maxWrites = 50, maxBytes = 1048576 } = {}) {
  const batches = []; let cur = [], bytes = 0, ids = new Set();
  const flush = () => { if (cur.length) batches.push(cur); cur = []; bytes = 0; ids = new Set(); };
  for (const w of writes) {
    const b = writeBytes(w); const key = `${w.collection}/${w.id || w.doc_id}`;
    if (b > maxBytes) throw new Error(`${key} is ${b} bytes, over the ${maxBytes}-byte batch limit`);
    if (cur.length >= maxWrites || bytes + b > maxBytes || ids.has(key)) flush();
    cur.push(w); bytes += b; ids.add(key);
  }
  flush();
  return batches;
}
