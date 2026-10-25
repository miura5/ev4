// B-389: the Worker's two guards, kept apart from worker.js so its only export is the handler.
//   tokenOk:     the Authorization header against the token, in constant time.
//   ifVersionOf: a page save's if_version, as the run API's.
// Tested with no Worker in test/pwa-save.test.mjs.

/** B-389: two byte arrays of one length compared in constant time: the platform's compare where the runtime has one
 * (Cloudflare's crypto.subtle.timingSafeEqual), else an XOR over every byte that never stops early. */
export function sameBytes(a, b, subtle = globalThis.crypto && globalThis.crypto.subtle) {
  if (a.byteLength !== b.byteLength) return false;
  if (subtle && typeof subtle.timingSafeEqual === 'function') return subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** B-389: the Authorization header against the token, in constant time. Both sides are hashed first (SHA-256), so the
 * compare always runs over 32 bytes and neither the token's length nor where a guess goes wrong shows in the time. */
export async function tokenOk(header, token, subtle) {
  if (!token || typeof header !== 'string') return false;
  const enc = new TextEncoder();
  const digest = s => crypto.subtle.digest('SHA-256', enc.encode(s)).then(d => new Uint8Array(d));
  const [got, want] = await Promise.all([digest(header), digest('Bearer ' + token)]);
  return sameBytes(got, want, subtle);
}

/** B-389: a page save's if_version (?if_version=<n>): null when absent (a create), the number, or undefined when bad. */
export function ifVersionOf(url) {
  const raw = url.searchParams.get('if_version');
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && String(n) === raw ? n : undefined;
}
