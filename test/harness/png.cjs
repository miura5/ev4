// A small PNG reader for the look pass (B-125): enough for Chromium's screenshots (8-bit RGB or RGBA, not interlaced),
// so two screenshots can be compared pixel by pixel without a dependency.
const zlib = require('zlib');

function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8,
    width = 0,
    height = 0,
    depth = 0,
    type = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at),
      kind = buf.toString('ascii', at + 4, at + 8),
      data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      if (data[12]) throw new Error('interlaced PNG');
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || ![2, 6].includes(type)) throw new Error(`PNG depth ${depth} type ${type} not read here`);
  const bpp = type === 6 ? 4 : 3,
    stride = width * bpp,
    raw = zlib.inflateSync(Buffer.concat(idat)),
    px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)],
      src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0,
        b = y ? px[row - stride + x] : 0,
        c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[row + x] = v & 255;
    }
  }
  return { width, height, bpp, px };
}

/** The share of pixels that differ by more than tol in any channel (1 when the sizes differ). */
function diff(a, b, tol = 8) {
  const A = decode(a),
    B = decode(b);
  if (A.width !== B.width || A.height !== B.height)
    return { share: 1, sizes: `${A.width}x${A.height} vs ${B.width}x${B.height}` };
  let n = 0;
  const total = A.width * A.height;
  for (let i = 0; i < total; i++)
    for (let k = 0; k < 3; k++)
      if (Math.abs(A.px[i * A.bpp + k] - B.px[i * B.bpp + k]) > tol) {
        n++;
        break;
      }
  return { share: n / total, pixels: n, sizes: `${A.width}x${A.height}` };
}

module.exports = { decode, diff };
