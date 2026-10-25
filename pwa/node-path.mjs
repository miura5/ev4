// B-324: node:path in the app's browser, for the core modules the job runner imports (only join is used there).
const path = { join: (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/') };
export default path;
