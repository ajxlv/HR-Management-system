import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readExif } from '../public/exif.js';
import { jpegWithExif } from '../testlib/exif-builder.js';

test('EXIF: location and capture time are read from the photo', () => {
  for (const little of [false, true]) {
    const r = readExif(jpegWithExif({ lat: 19.9975, lng: 73.7898, little }));
    assert.ok(Math.abs(r.lat - 19.9975) < 1e-4 && Math.abs(r.lng - 73.7898) < 1e-4, `position (little-endian ${little})`);
    assert.equal(r.takenAt, Date.parse('2026-11-02T13:30:00+05:30'));        // local time, read as IST
  }
});

test('EXIF: south and west are negative', () => {
  const r = readExif(jpegWithExif({ lat: 33.5, lng: 18.25, latRef: 'S', lngRef: 'W' }));
  assert.ok(r.lat < 0 && r.lng < 0);
});

test('EXIF: a photo with a time but no location gives only the time', () => {
  const r = readExif(jpegWithExif({}));
  assert.equal(r.lat, undefined); assert.equal(r.lng, undefined); assert.ok(r.takenAt);
});

test('EXIF: plain, damaged or empty files give nothing and never throw', () => {
  assert.deepEqual(readExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), {});
  assert.deepEqual(readExif(new Uint8Array(0)), {});
  assert.deepEqual(readExif(Uint8Array.from([1, 2, 3, 4, 5])), {});
  const good = jpegWithExif({ lat: 20, lng: 73 });
  assert.doesNotThrow(() => readExif(good.slice(0, 40)));                       // cut off in the middle
  assert.deepEqual(readExif(good.slice(0, 40)), {});
  assert.equal(readExif(jpegWithExif({ lat: 0, lng: 0 })).lat, undefined, '0,0 is not a real location');
});
