import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  boxesFor, clampInverters, declaredInverters, isBoxKey, validateAnswers, buildRow, buildChecks, attention, locationVerdict, locationSourceFrom, LOC,
  HEADERS, COLUMNS, colIndex, GROUP_SPANS, ELECTRICAL, SIGNATURES, WORK, OVERALL,
} from '../server/form.js';
import { classify } from '../server/sheets/status.js';
import { testConfig } from '../testlib/config.js';
import { okAnswers, fakeVisit, rowOf, allPhotos } from '../testlib/helpers.js';

const site = { id: 'c1', name: 'Test Site', folder: 'Test Site', lat: 20, lng: 73 };   // the client has no inverter data: the cleaner sets the count on each visit

test('the form has exactly as many inverter boxes as the cleaner added', () => {
  for (const n of [1, 2, 4, 6, 12]) {
    const boxes = boxesFor(n);
    assert.deepEqual(boxes.filter((b) => b.inverter).map((b) => b.key), Array.from({ length: n }, (_, i) => `Inverter${i + 1}`));
    assert.deepEqual(boxes.map((b) => b.key).filter((k) => !k.startsWith('Inverter')), ['Before', 'After', 'Challan', 'Bill']);
  }
  assert.equal(boxesFor(6).length, 10);
  for (const bad of [undefined, 0, -1, 13, 2.5, '4', null]) assert.equal(boxesFor(bad).filter((b) => b.inverter).length, 1, `one inverter box for ${bad}`);
  const boxes = boxesFor(4);
  assert.ok(boxes.every((b) => b.required), 'every box needs a photo');
  assert.deepEqual(boxes.filter((b) => b.gps).map((b) => b.key), ['Before', 'After'], 'only Before and After need a location');
  assert.ok(!boxes.some((b) => b.key === 'Wires'), 'Wires is gone');
});

test('inverter count: valid range, box keys, and the count a visit really has', () => {
  assert.equal(clampInverters(1), 1); assert.equal(clampInverters(12), 12);
  for (const bad of [0, 13, -3, 1.5, '2', null, undefined, NaN]) assert.equal(clampInverters(bad), null);
  for (const ok of ['Before', 'After', 'Challan', 'Bill', 'Inverter1', 'Inverter9', 'Inverter10', 'Inverter12']) assert.ok(isBoxKey(ok), ok);
  for (const bad of ['Wires', 'Inverter0', 'Inverter13', 'Inverter01', 'inverter1', 'Inverter', 'Inverter1x', '']) assert.ok(!isBoxKey(bad), bad);
  const visit = (...boxes) => ({ photos: Object.fromEntries(boxes.map((b, i) => [`h${i}`, { box: b }])) });
  assert.equal(declaredInverters(visit('Before'), undefined), 1);              // nothing declared: at least one
  assert.equal(declaredInverters(visit('Before'), 3), 3);                      // what the cleaner declared
  assert.equal(declaredInverters(visit('Inverter1', 'Inverter4'), 2), 4);      // never fewer than the highest one he uploaded to
  assert.equal(declaredInverters(visit('Inverter3'), undefined), 3);
  assert.equal(declaredInverters(visit('Before'), 99), 1);                     // an invalid number is ignored
});

test('answers: every item must be answered with an allowed value', () => {
  assert.deepEqual(validateAnswers(okAnswers()), okAnswers());
  const rejects = (mutate, text) => {
    const a = okAnswers(); mutate(a);
    assert.throws(() => validateAnswers(a), (e) => e.status === 400 && text.test(e.message));
  };
  rejects((a) => { delete a.electrical.MCB; }, /MCB/);
  rejects((a) => { a.electrical.ACDB = 'on'; }, /ACDB/);                  // exact wording only
  rejects((a) => { a.electrical.SPD = 'Yes'; }, /SPD/);
  rejects((a) => { delete a.signatures.customer; }, /Customer signature/);
  rejects((a) => { a.signatures.supervisor = 'N/A'; }, /Cleaning supervisor signature/);
  rejects((a) => { a.work.washed = ''; }, /washed with water/);
  rejects((a) => { delete a.work.earthingPit; }, /Earthing pit/);
  rejects((a) => { a.overall = 'Done'; }, /overall status/);
  rejects((a) => { delete a.overall; }, /overall status/);
  assert.throws(() => validateAnswers(undefined), /checklist/);
  assert.throws(() => validateAnswers('x'), /checklist/);
  for (const o of OVERALL) assert.equal(validateAnswers(okAnswers({ overall: o })).overall, o);
});

test('sheet row: 28 columns in the agreed order', () => {
  assert.equal(HEADERS.length, 28);
  assert.deepEqual(HEADERS, ['Visit date', 'Submitted at (IST)', 'Cleaner', 'Before', 'After', 'Inverters', 'Challan', 'Bill', 'ACDB', 'Inverter', 'DCDB', 'Internet', 'MCB', 'SPD', 'Earthing Trip',
    'Customer signature', 'Supervisor signature', 'Session cleaning', 'Washed with water', 'Inverter room checked', 'Earthing pit checked', 'Before photos taken', 'After photos taken',
    'Overall status', 'Defects', 'Defect details', 'Checks', 'Photo folder']);
  assert.deepEqual(GROUP_SPANS.map((g) => [g.name, HEADERS[g.from], HEADERS[g.to]]), [
    ['Photos', 'Before', 'Bill'], ['Electrical checklist', 'ACDB', 'Earthing Trip'], ['Signatures', 'Customer signature', 'Supervisor signature'],
    ['Work done', 'Session cleaning', 'After photos taken'], ['Result', 'Overall status', 'Photo folder']]);
  assert.equal(rowOf(site, { inverters: 4 }).length, 28);
});

test('sheet row: ON / OFF / N/A, signatures, work and the automatic answers', () => {
  const row = rowOf(site, {
    inverters: 4, photos: { Before: 2, After: 1, Inverter1: 1, Inverter2: 2, Inverter3: 1, Challan: 1 },        // Inverter4 and Bill missing
    answers: okAnswers({ electrical: { MCB: 'OFF', SPD: 'N/A', Internet: 'OFF' }, signatures: { customer: 'No' }, work: { washed: 'No' }, overall: 'Partly completed' }),
    defects: 'Yes', details: 'Cracked panel',
  });
  const at = (h) => row[HEADERS.indexOf(h)];
  assert.equal(at('Visit date'), '2026-11-02'); assert.equal(at('Cleaner'), 'Ramesh');
  assert.equal(at('Before'), 'Uploaded (2)'); assert.equal(at('After'), 'Uploaded (1)'); assert.equal(at('Bill'), 'Not uploaded'); assert.equal(at('Challan'), 'Uploaded (1)');
  assert.equal(at('Inverters'), '3 of 4 uploaded');
  assert.deepEqual(['ACDB', 'Inverter', 'DCDB', 'Internet', 'MCB', 'SPD', 'Earthing Trip'].map(at), ['ON', 'ON', 'ON', 'OFF', 'OFF', 'N/A', 'ON']);
  assert.equal(at('Customer signature'), 'No'); assert.equal(at('Supervisor signature'), 'Yes');
  assert.equal(at('Washed with water'), 'No'); assert.equal(at('Session cleaning'), 'Yes');
  assert.equal(at('Before photos taken'), 'Yes'); assert.equal(at('After photos taken'), 'Yes');          // filled in automatically
  assert.equal(at('Overall status'), 'Partly completed'); assert.equal(at('Defects'), 'Yes'); assert.equal(at('Defect details'), 'Cracked panel');
  assert.equal(at('Photo folder'), 'Clients/Test Site/2026-11-02');
  assert.match(at('Checks'), /No photo: .*Inverter 4.*Bill/);
  const none = rowOf(site, { inverters: 4, photos: { Inverter1: 1 } });
  assert.equal(none[HEADERS.indexOf('Before photos taken')], 'No'); assert.equal(none[HEADERS.indexOf('After photos taken')], 'No');
  assert.equal(none[HEADERS.indexOf('Inverters')], '1 of 4 uploaded');
  assert.equal(rowOf(site, { inverters: 4 })[HEADERS.indexOf('Inverters')], '4 of 4 uploaded');
});

test('colours: ON green, OFF red, N/A grey, No red, Inverters red unless all uploaded, Checks amber', () => {
  const c = (h, v) => classify(COLUMNS[HEADERS.indexOf(h)].key, v);
  assert.equal(c('MCB', 'ON'), 'good'); assert.equal(c('MCB', 'OFF'), 'bad'); assert.equal(c('MCB', 'N/A'), 'neutral');
  assert.equal(c('Customer signature', 'Yes'), 'good'); assert.equal(c('Supervisor signature', 'No'), 'bad');
  assert.equal(c('Washed with water', 'No'), 'bad'); assert.equal(c('Before photos taken', 'Yes'), 'good');
  assert.equal(c('Before', 'Uploaded (2)'), 'good'); assert.equal(c('Bill', 'Not uploaded'), 'bad');
  assert.equal(c('Inverters', '4 of 4 uploaded'), 'good'); assert.equal(c('Inverters', '3 of 4 uploaded'), 'bad'); assert.equal(c('Inverters', '0 of 2 uploaded'), 'bad');
  assert.equal(c('Overall status', 'Completed'), 'good'); assert.equal(c('Overall status', 'Partly completed'), 'warn'); assert.equal(c('Overall status', 'Not completed'), 'bad');
  assert.equal(c('Defects', 'Yes'), 'bad'); assert.equal(c('Defects', 'No'), 'good');
  assert.equal(c('Checks', 'OK'), null); assert.equal(c('Checks', 'No GPS: Before_1'), 'warn');
});

test('location source: what counts as verified', () => {
  const p = (capture, src, extra = {}) => ({ capture, locationSource: src, lat: src === LOC.NONE ? null : 20, lng: src === LOC.NONE ? null : 73, ...extra });
  assert.equal(locationVerdict(p('gallery', LOC.EXIF)), 'verified');            // location read from the photo itself
  assert.equal(locationVerdict(p('camera', LOC.EXIF)), 'verified');
  assert.equal(locationVerdict(p('camera', LOC.PHONE)), 'verified');           // live camera shot
  assert.equal(locationVerdict(p('gallery', LOC.PHONE)), 'unverified');        // gallery + phone location at upload
  assert.equal(locationVerdict(p('gallery', LOC.NONE)), 'unverified');
  assert.equal(locationVerdict(p('camera', LOC.NONE)), 'none');
  assert.equal(locationSourceFrom('exif', true), 'photo EXIF'); assert.equal(locationSourceFrom('phone', true), 'phone at upload'); assert.equal(locationSourceFrom('none', false), 'none');
  assert.equal(locationSourceFrom(undefined, true), 'phone at upload');         // older clients that only sent coordinates
  assert.equal(locationSourceFrom(undefined, false), 'none');
});

test('Checks column: location, distance and date notes', () => {
  const boxes = boxesFor(4), checks = (photos, date) => buildChecks(fakeVisit(site, photos, date), site, boxes);
  const ok = { Inverter1: 1, Inverter2: 1, Inverter3: 1, Inverter4: 1, Challan: 1, Bill: 1 };
  assert.equal(checks({ ...ok, Before: 2, After: 1 }), 'OK');
  assert.equal(checks({ ...ok, Before: { count: 1, capture: 'gallery', locationSource: LOC.EXIF }, After: 1 }), 'OK');                                       // EXIF: verified
  assert.match(checks({ ...ok, Before: { count: 2, capture: 'gallery', locationSource: LOC.PHONE }, After: 1 }), /^Location not verified: Before_1, Before_2$/);
  assert.match(checks({ ...ok, Before: { count: 1, capture: 'camera', locationSource: LOC.NONE, lat: null, lng: null }, After: 1 }), /^No GPS: Before_1$/);
  assert.match(checks({ ...ok, Before: 1, After: { count: 1, lat: 20.2, lng: 73 } }), /^Far from site: After_1 \(\d+ m\)$/);
  assert.match(checks({ ...ok, Before: { count: 1, takenAt: Date.parse('2026-10-30T07:00:00Z'), takenSource: 'exif' }, After: 1 }), /^Taken on 2026-10-30: Before_1$/);
  assert.equal(checks({ ...ok, Before: { count: 1, capture: 'gallery', locationSource: LOC.EXIF, takenAt: null, takenSource: '' }, After: 1 }), 'OK', 'a gallery photo with no date is not flagged for its date');
  assert.match(checks({ Before: 1, After: 1 }), /No photo: Inverter 1, Inverter 2, Inverter 3, Inverter 4, Challan, Bill/);
  // non-location boxes never complain about a missing location
  assert.equal(checks({ ...ok, Before: 1, After: 1, Inverter1: { count: 1, locationSource: LOC.NONE, lat: null, lng: null, capture: 'gallery' } }), 'OK');
});

test('HR summary: what needs attention', () => {
  const boxes = boxesFor(4), v = fakeVisit(site, { Before: 1, After: 1, Inverter1: 1, Inverter2: 1, Inverter3: 1, Challan: 1 });   // Inverter4, Bill missing
  const a = attention(v, boxes, okAnswers({ electrical: { MCB: 'OFF', DCDB: 'OFF' }, signatures: { customer: 'No' }, work: { earthingPit: 'No' }, overall: 'Not completed' }));
  assert.deepEqual(a.missing, ['Inverter 4', 'Bill']);
  assert.deepEqual(a.off, ['DCDB', 'MCB']); assert.deepEqual(a.noSignature, ['Customer signature']); assert.deepEqual(a.notDone, ['Earthing pit checked']); assert.equal(a.notCompleted, true);
  const clean = attention(fakeVisit(site, allPhotos(4)), boxes, okAnswers());
  assert.deepEqual([clean.missing, clean.off, clean.noSignature, clean.notDone, clean.notCompleted], [[], [], [], [], false]);
});

test('column helpers agree with the headers', () => {
  assert.equal(HEADERS[colIndex('Inverters')], 'Inverters'); assert.equal(HEADERS[colIndex('checks')], 'Checks');
  assert.equal(ELECTRICAL.length, 7); assert.equal(SIGNATURES.length, 2); assert.equal(WORK.length, 4);
  assert.throws(() => colIndex('nope'));
});
