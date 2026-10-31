// B-653: pictures in his notes. The bytes live in the environment's R2 bucket (env.EXPORTS, the one the nightly export
// writes, under its own prefix note-images/; the export only lists and writes exports/ and the bucket has no expiry
// rule), never in D1: a note's image block holds only the key, its width and alt text. Both routes sit behind the same
// owner token as every /api call (worker.js checks it first); nothing is served at a public URL. A picture is never
// overwritten or deleted (B-11): removing it from a note leaves the object where it is.
export const IMAGE_PREFIX = 'note-images/';
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
/** A stored picture's key: note-images/<24 letters and digits>.<ext> (notes.schema.json holds the same shape). */
export const IMAGE_KEY = /^note-images\/[A-Za-z0-9]{16,64}\.(png|jpg|webp|gif)$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function randomPart(n = 24) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const v = new Uint32Array(n);
  crypto.getRandomValues(v);
  return Array.from(v, x => A[x % 62]).join('');
}

/** POST /api/images (the body is the file, its content-type the type) and GET /api/images/<key>. null: not this route. */
export async function handleImages(request, env, url) {
  if (url.pathname !== '/api/images' && !url.pathname.startsWith('/api/images/')) return null;
  const bucket = env.EXPORTS;
  if (!bucket) return json({ error: 'no picture storage on this Worker (its R2 bucket is not bound)' }, 503);

  if (url.pathname === '/api/images' && request.method === 'POST') {
    const type = String(request.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const ext = IMAGE_TYPES[type];
    if (!ext) return json({ error: 'a picture is a PNG, JPEG, WebP or GIF' }, 415);
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > IMAGE_MAX_BYTES) return json({ error: 'a picture holds at most 8 MB' }, 413);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return json({ error: 'no picture in the request' }, 400);
    if (bytes.byteLength > IMAGE_MAX_BYTES) return json({ error: 'a picture holds at most 8 MB' }, 413);
    for (let n = 0; n < 5; n++) {
      const key = `${IMAGE_PREFIX}${randomPart()}.${ext}`;
      if (await bucket.head(key)) continue; // never written over
      await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
      return json({ key, bytes: bytes.byteLength, type });
    }
    return json({ error: 'no free key for the picture' }, 500);
  }

  if (request.method === 'GET') {
    const key = decodeURIComponent(url.pathname.slice('/api/images/'.length));
    if (!IMAGE_KEY.test(key)) return json({ error: 'key: a picture key' }, 400);
    const obj = await bucket.get(key);
    if (!obj) return json({ error: 'no such picture' }, 404);
    const type = (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream';
    return new Response(obj.body, {
      status: 200,
      headers: { 'content-type': type, 'cache-control': 'private, max-age=31536000, immutable' },
    });
  }
  return json({ error: 'method' }, 405);
}
