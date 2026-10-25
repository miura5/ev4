// B-324: node:url in the app's browser: core/schemas.mjs turns its own URL into a path when loaded (never read here).
export const fileURLToPath = u => String(u).replace(/^[a-z]+:\/\/[^/]*/, '');
