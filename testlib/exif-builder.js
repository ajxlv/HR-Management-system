// Builds a tiny JPEG whose EXIF block holds a capture time and (optionally) a GPS position.
export function jpegWithExif({ date = '2026:11:02 13:30:00', lat, lng, latRef = 'N', lngRef = 'E', little = false } = {}) {
  const tiff = new Uint8Array(200), v = new DataView(tiff.buffer), le = little;
  const w16 = (o, x) => v.setUint16(o, x, le), w32 = (o, x) => v.setUint32(o, x, le);
  tiff.set(little ? [0x49, 0x49] : [0x4d, 0x4d], 0); w16(2, 42); w32(4, 8);
  const hasGps = lat !== undefined;
  // IFD0 @8: ExifIFD pointer (+ GPS pointer)
  w16(8, hasGps ? 2 : 1);
  w16(10, 0x8769); w16(12, 4); w32(14, 1); w32(18, 38);
  if (hasGps) { w16(22, 0x8825); w16(24, 4); w32(26, 1); w32(30, 76); }
  w32(hasGps ? 34 : 22, 0);
  // ExifIFD @38: DateTimeOriginal -> string at 56
  w16(38, 1); w16(40, 0x9003); w16(42, 2); w32(44, 20); w32(48, 56); w32(52, 0);
  for (let i = 0; i < date.length; i++) tiff[56 + i] = date.charCodeAt(i);
  if (hasGps) {
    // GPS IFD @76: LatRef, Lat, LngRef, Lng
    w16(76, 4);
    const ref = (o, tag, ch) => { w16(o, tag); w16(o + 2, 2); w32(o + 4, 2); tiff[o + 8] = ch.charCodeAt(0); };
    const rat = (o, tag, at) => { w16(o, tag); w16(o + 2, 5); w32(o + 4, 3); w32(o + 8, at); };
    ref(78, 1, latRef); rat(90, 2, 130); ref(102, 3, lngRef); rat(114, 4, 154); w32(126, 0);
    const put = (at, x) => { const d = Math.floor(x), m = Math.floor((x - d) * 60), s = ((x - d) * 60 - m) * 60; [[d, 1], [m, 1], [Math.round(s * 100), 100]].forEach(([n, den], i) => { w32(at + i * 8, n); w32(at + i * 8 + 4, den); }); };
    put(130, Math.abs(lat)); put(154, Math.abs(lng));
  }
  const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  const len = 2 + 6 + tiff.length; head[4] = len >> 8; head[5] = len & 255;
  return Uint8Array.from([...head, ...tiff, 0xff, 0xd9]);
}

