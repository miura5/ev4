// B-229 (D-233): his words are his. The fields only Matt writes, by collection, from spec.collections[c].his. Node side
// only (the build and the tests): the page never reads spec.collections, and the build refuses an actions row with a
// tool, worker or builder caller that writes one (core/actions.mjs rowProblem with this map).
export function hisFields(spec) {
  const out = {};
  for (const [c, def] of Object.entries((spec && spec.collections) || {}))
    if (def && Array.isArray(def.his) && def.his.length) out[c] = def.his.slice();
  return out;
}
