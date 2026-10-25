// B-324: node:path in the app's browser, for the core modules the job runner imports: join (the share-set brief's
// file), and resolve and dirname (core/schemas.mjs names its folder when loaded; the app passes its schemas in).
const join = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
const path = { join, resolve: join, dirname: p => String(p).replace(/\/[^/]*$/, '') || '/' };
export default path;
