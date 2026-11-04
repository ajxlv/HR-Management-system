// Reads the GPS position and the capture time from a JPEG's EXIF block. No dependencies.
// Works in the browser and in Node (the tests use it). Returns {} when the photo has no EXIF.
//   { lat, lng }            only when the photo itself carries a location
//   { takenAt }             milliseconds; EXIF stores local time without a zone, and WRS works in India, so it is read as IST
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

export function readExif(input) {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0) !== 0xffd8) return {};
    let pos = 2;
    while (pos + 4 < view.byteLength) {
      const marker = view.getUint16(pos), len = view.getUint16(pos + 2);
      if (marker === 0xffe1 && view.getUint32(pos + 4) === 0x45786966) return parseTiff(view, pos + 10);   // "Exif"
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;                                          // not a segment, or image data starts
      pos += 2 + len;
    }
  } catch { /* damaged EXIF: treat as none */ }
  return {};
}

function parseTiff(view, base) {
  const little = view.getUint16(base) === 0x4949;
  const u16 = (o) => view.getUint16(base + o, little), u32 = (o) => view.getUint32(base + o, little);
  if (u16(2) !== 42) return {};

  // Reads the entries of one IFD into { tag: { type, count, at } } where `at` is where the value bytes start.
  const ifd = (offset) => {
    const out = {}, n = u16(offset);
    for (let i = 0; i < n; i++) {
      const e = offset + 2 + i * 12, type = u16(e + 2), count = u32(e + 4), size = (TYPE_SIZE[type] || 1) * count;
      out[u16(e)] = { type, count, at: size <= 4 ? e + 8 : u32(e + 8) };
    }
    return out;
  };
  const ascii = (f) => { let s = ''; for (let i = 0; i < f.count; i++) { const c = view.getUint8(base + f.at + i); if (!c) break; s += String.fromCharCode(c); } return s; };
  const rationals = (f) => Array.from({ length: f.count }, (_, i) => { const d = u32(f.at + i * 8 + 4); return d ? u32(f.at + i * 8) / d : 0; });

  const root = ifd(u32(4)), result = {};
  const exif = root[0x8769] ? ifd(u32(root[0x8769].at)) : {};
  const stamp = exif[0x9003] || exif[0x9004] || root[0x0132];
  const m = stamp && ascii(stamp).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (m) { const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:30`); if (!Number.isNaN(t)) result.takenAt = t; }

  const gps = root[0x8825] ? ifd(u32(root[0x8825].at)) : null;
  if (gps && gps[2] && gps[4]) {
    const deg = (f) => { const [d, mi, s] = rationals(f); return d + mi / 60 + s / 3600; };
    let lat = deg(gps[2]), lng = deg(gps[4]);
    if (gps[1] && ascii(gps[1]).startsWith('S')) lat = -lat;
    if (gps[3] && ascii(gps[3]).startsWith('W')) lng = -lng;
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) { result.lat = lat; result.lng = lng; }
  }
  return result;
}
