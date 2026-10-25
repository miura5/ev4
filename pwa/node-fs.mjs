// B-324: node:fs in the app's browser, for the core modules the job runner imports. Only the worker's share-set brief
// writes a file (the page it would publish on claude.ai), and the app makes no such page: these write nothing.
const fs = {
  existsSync: () => false,
  mkdirSync: () => undefined,
  writeFileSync: () => undefined,
};
export default fs;
