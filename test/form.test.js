import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  boxesFor, clampInverters, declaredInverters, isBoxKey, validateAnswers, validateSignature, amcStatus, AMC_REMIND_DAYS, buildRow, buildChecks, attention, locationVerdict, locationSourceFrom, LOC,
  HEADERS, COLUMNS, colIndex, GROUP_SPANS, ELECTRICAL, SIGNATURES, WORK, OVERALL,
} from '../server/form.js';
import { classify } from '../server/sheets/status.js';
import { testConfig } from '../testlib/config.js';
import { okAnswers, fakeVisit, rowOf, allPhotos, SIGNED, signedPhoto } from '../testlib/helpers.js';

const site = { id: 'c1', name: 'Test Site', folder: 'Test Site', lat: 20, lng: 73 };   // the client has no inverter data: the cleaner sets the count on each visit

test('the form has exactly as many inverter boxes as the cleaner added, and only Inverter 1 is compulsory', () => {
  for (const n of [1, 2, 4, 6, 12]) {
    const boxes = boxesFor(n);
    assert.deepEqual(boxes.filter((b) => b.inverter).map((b) => b.key), Array.from({ length: n }, (_, i) => `Inverter${i + 1}`));
    assert.deepEqual(boxes.map((b) => b.key).filter((k) => !k.startsWith('Inverter')), ['Before', 'After', 'EarthingPitBefore', 'EarthingPitAfter', 'Challan', 'Bill']);
    assert.deepEqual(boxes.filter((b) => b.inverter && b.required).map((b) => b.key), ['Inverter1'], 'a site may have just one inverter');
  }
  assert.equal(boxesFor(6).length, 12);
  for (const bad of [undefined, 0, -1, 13, 2.5, '4', null]) assert.equal(boxesFor(bad).filter((b) => b.inverter).length, 1, `one inverter box for ${bad}`);
  const boxes = boxesFor(4);
  assert.ok(boxes.filter((b) => !b.inverter).every((b) => b.required), 'every other box needs a photo, earthing pit before and after included');
  assert.deepEqual(boxes.filter((b) => b.gps).map((b) => b.key), ['Before', 'After'], 'only Before and After need a location');
  assert.ok(!boxes.some((b) => b.key === 'Wires'), 'Wires is gone');
});

test('inverter count: valid range, box keys, and the count a visit really has', () => {
  assert.equal(clampInverters(1), 1); assert.equal(clampInverters(12), 12);
  for (const bad of [0, 13, -3, 1.5, '2', null, undefined, NaN]) assert.equal(clampInverters(bad), null);
  for (const ok of ['Before', 'After', 'EarthingPitBefore', 'EarthingPitAfter', 'Challan', 'Bill', 'Signature', 'Inverter1', 'Inverter9', 'Inverter10', 'Inverter12']) assert.ok(isBoxKey(ok), ok);
  for (const bad of ['Wires', 'Inverter0', 'Inverter13', 'Inverter01', 'inverter1', 'Inverter', 'Inverter1x', '', 'signature']) assert.ok(!isBoxKey(bad), bad);
  const visit = (...boxes) => ({ photos: Object.fromEntries(boxes.map((b, i) => [`h${i}`, { box: b }])) });
  assert.equal(declaredInverters(visit('Before'), undefined), 1);              // nothing declared: at least one
  assert.equal(declaredInverters(visit('Before'), 3), 3);                      // what the cleaner declared
  assert.equal(declaredInverters(visit('Inverter1', 'Inverter4'), 2), 4);      // never fewer than the highest one he uploaded to
  assert.equal(declaredInverters(visit('Inverter3'), undefined), 3);
  assert.equal(declaredInverters(visit('Before'), 99), 1);                     // an invalid number is ignored
});

test('checklist: BLUE for the internet, AC SPD and DC SPD, no MCB line', () => {
  assert.deepEqual(ELECTRICAL.map((e) => e.key), ['ACDB', 'Inverter', 'DCDB', 'Internet', 'ACSPD', 'DCSPD', 'EarthingTrip']);
  assert.equal(ELECTRICAL.find((e) => e.key === 'ACDB').label, 'ACDB (MCB ON / OFF)');
  assert.deepEqual(ELECTRICAL.find((e) => e.key === 'Internet').options, ['BLUE', 'OFF', 'N/A']);
  for (const e of ELECTRICAL.filter((x) => x.key !== 'Internet')) assert.deepEqual(e.options, ['ON', 'OFF', 'N/A'], e.key);
  assert.ok(!ELECTRICAL.some((e) => /MCB$/.test(e.key)));
});

test('answers: every item must be answered with an allowed value', () => {
  assert.deepEqual(validateAnswers(okAnswers()), okAnswers());
  const rejects = (mutate, text) => {
    const a = okAnswers(); mutate(a);
    assert.throws(() => validateAnswers(a), (e) => e.status === 400 && text.test(e.message));
  };
  rejects((a) => { delete a.electrical.ACSPD; }, /AC SPD/);
  rejects((a) => { a.electrical.ACDB = 'on'; }, /ACDB/);                  // exact wording only
  rejects((a) => { a.electrical.Internet = 'ON'; }, /Internet/);          // the internet line is BLUE, not ON
  rejects((a) => { a.electrical.DCDB = 'BLUE'; }, /DCDB/);               // BLUE belongs to the internet line only
  rejects((a) => { a.electrical.DCSPD = 'Yes'; }, /DC SPD/);
  rejects((a) => { delete a.signatures.customer; }, /Customer signature/);
  rejects((a) => { a.signatures.supervisor = 'N/A'; }, /Cleaning supervisor signature/);
  rejects((a) => { a.work.washed = ''; }, /washed with water/);
  rejects((a) => { delete a.work.earthingPit; }, /Earthing pit/);
  rejects((a) => { a.overall = 'Done'; }, /overall status/);
  rejects((a) => { delete a.overall; }, /overall status/);
  assert.throws(() => validateAnswers(undefined), /checklist/);
  assert.throws(() => validateAnswers('x'), /checklist/);
  for (const o of OVERALL) assert.equal(validateAnswers(okAnswers({ overall: o })).overall, o);
  assert.equal(validateAnswers(okAnswers({ electrical: { Internet: 'BLUE' } })).electrical.Internet, 'BLUE');
});

test("client signature: signed with a time, or not available with a reason", () => {
  assert.equal(validateSignature(undefined), null); assert.equal(validateSignature(null), null);        // an older phone app
  assert.deepEqual(validateSignature({ status: 'signed', signedAt: 1762070000000, junk: 1 }), { status: 'signed', signedAt: 1762070000000 });
  assert.deepEqual(validateSignature({ status: 'unavailable', reason: '  Owner out of town ' }), { status: 'unavailable', reason: 'Owner out of town' });
  for (const bad of ['x', 5, {}, { status: 'maybe' }, { status: 'signed' }, { status: 'signed', signedAt: 'now' }, { status: 'signed', signedAt: -1 }, { status: 'unavailable' }, { status: 'unavailable', reason: ' a ' }])
    assert.throws(() => validateSignature(bad), (e) => e.status === 400, JSON.stringify(bad));
  assert.equal(validateSignature({ status: 'unavailable', reason: 'x'.repeat(500) }).reason.length, 200);
});

test('AMC reminder: dates typed in by the company, 60 days ahead', () => {
  const today = '2026-11-06';
  assert.deepEqual(amcStatus({}, today), { state: 'none', days: null });
  assert.deepEqual(amcStatus({ amcExpiry: 'soon' }, today), { state: 'none', days: null });
  assert.deepEqual(amcStatus({ amcExpiry: '2027-09-30' }, today), { state: 'ok', days: 328 });
  assert.equal(amcStatus({ amcExpiry: '2027-01-04' }, today).state, 'soon');        // exactly 59 days
  assert.equal(amcStatus({ amcExpiry: '2027-01-05' }, today).days, 60);
  assert.equal(amcStatus({ amcExpiry: '2027-01-05' }, today).state, 'soon');        // 60 days is still inside the window
  assert.equal(amcStatus({ amcExpiry: '2027-01-06' }, today).state, 'ok');          // 61 days
  assert.equal(amcStatus({ amcExpiry: '2026-11-06' }, today).state, 'soon');        // ends today
  assert.deepEqual(amcStatus({ amcExpiry: '2026-11-05' }, today), { state: 'expired', days: -1 });
  assert.equal(AMC_REMIND_DAYS, 60);
});

test('sheet row: 33 columns in the agreed order', () => {
  assert.equal(HEADERS.length, 33);
  assert.deepEqual(HEADERS, ['Visit date', 'Submitted at (IST)', 'Cleaner', 'Before', 'After', 'Inverters', 'Earthing pit before', 'Earthing pit after', 'Challan', 'Bill',
    'ACDB', 'Inverter', 'DCDB', 'Internet', 'AC SPD', 'DC SPD', 'Earthing Trip',
    'Customer signature', 'Supervisor signature', 'Client signature', 'Session cleaning', 'Washed with water', 'Inverter room checked', 'Earthing pit checked', 'Before photos taken', 'After photos taken',
    'Overall status', 'Defects', 'Defect details', 'Checks', 'Photo folder', 'Installed on', 'AMC expiry']);
  assert.deepEqual(GROUP_SPANS.map((g) => [g.name, HEADERS[g.from], HEADERS[g.to]]), [
    ['Photos', 'Before', 'Bill'], ['Electrical checklist', 'ACDB', 'Earthing Trip'], ['Signatures', 'Customer signature', 'Client signature'],
    ['Work done', 'Session cleaning', 'After photos taken'], ['Result', 'Overall status', 'Photo folder'], ['AMC', 'Installed on', 'AMC expiry']]);
  assert.equal(rowOf(site, { inverters: 4 }).length, 33);
});

test('sheet row: ON / OFF / N/A / BLUE, signatures, work, client signature and the automatic answers', () => {
  const row = rowOf({ ...site, installed: '2024-10-01', amcExpiry: '2027-09-30' }, {
    inverters: 4, photos: { Before: 2, After: 1, Inverter1: 1, Inverter2: 2, EarthingPitBefore: 1, Challan: 1 },        // Inverter 3 and 4 not photographed (optional); earthing pit after and Bill missing
    answers: okAnswers({ electrical: { ACDB: 'OFF', DCSPD: 'N/A', Internet: 'OFF' }, signatures: { customer: 'No' }, work: { washed: 'No' }, overall: 'Partly completed' }),
    defects: 'Yes', details: 'Cracked panel',
  });
  const at = (h) => row[HEADERS.indexOf(h)];
  assert.equal(at('Visit date'), '2026-11-02'); assert.equal(at('Cleaner'), 'Ramesh');
  assert.equal(at('Before'), 'Uploaded (2)'); assert.equal(at('After'), 'Uploaded (1)'); assert.equal(at('Bill'), 'Not uploaded'); assert.equal(at('Challan'), 'Uploaded (1)');
  assert.equal(at('Earthing pit before'), 'Uploaded (1)'); assert.equal(at('Earthing pit after'), 'Not uploaded');
  assert.equal(at('Inverters'), 'Uploaded (2)');
  assert.deepEqual(['ACDB', 'Inverter', 'DCDB', 'Internet', 'AC SPD', 'DC SPD', 'Earthing Trip'].map(at), ['OFF', 'ON', 'ON', 'OFF', 'ON', 'N/A', 'ON']);
  assert.equal(at('Customer signature'), 'No'); assert.equal(at('Supervisor signature'), 'Yes');
  assert.match(at('Client signature'), /^Signed 2026-11-02 \d\d:\d\d$/);
  assert.equal(at('Washed with water'), 'No'); assert.equal(at('Session cleaning'), 'Yes');
  assert.equal(at('Before photos taken'), 'Yes'); assert.equal(at('After photos taken'), 'Yes');          // filled in automatically
  assert.equal(at('Overall status'), 'Partly completed'); assert.equal(at('Defects'), 'Yes'); assert.equal(at('Defect details'), 'Cracked panel');
  assert.equal(at('Photo folder'), 'Clients/Test Site/2026-11-02');
  assert.equal(at('Installed on'), '2024-10-01'); assert.equal(at('AMC expiry'), '2027-09-30');
  assert.match(at('Checks'), /No photo: .*Earthing pit after.*Bill/);
  assert.doesNotMatch(at('Checks'), /Inverter 3|Inverter 4/, 'an extra inverter is never required');
  const none = rowOf(site, { inverters: 4, photos: { Inverter1: 1 } });
  assert.equal(none[HEADERS.indexOf('Before photos taken')], 'No'); assert.equal(none[HEADERS.indexOf('After photos taken')], 'No');
  assert.equal(none[HEADERS.indexOf('Inverters')], 'Uploaded (1)');
  assert.equal(none[HEADERS.indexOf('Installed on')], ''); assert.equal(none[HEADERS.indexOf('AMC expiry')], '');
  assert.equal(rowOf(site, { inverters: 4 })[HEADERS.indexOf('Inverters')], 'Uploaded (4)');
  assert.equal(rowOf(site, { photos: { Before: 1 } })[HEADERS.indexOf('Inverters')], 'Not uploaded');
});

test('sheet row: the client signature cell says what happened', () => {
  const cell = (o) => rowOf(site, o)[HEADERS.indexOf('Client signature')];
  assert.equal(cell({ signature: null }), 'Not taken');
  assert.equal(cell({ signature: { status: 'unavailable', reason: 'Owner was away' } }), 'Not available: Owner was away');
  assert.equal(cell({ signature: SIGNED, signaturePhoto: false }), 'Signed (picture missing)');
  const checks = (o) => rowOf(site, o)[HEADERS.indexOf('Checks')];
  assert.equal(checks({}), 'OK');
  assert.match(checks({ signature: null }), /No client signature/);
  assert.match(checks({ signature: { status: 'unavailable', reason: 'Owner was away' } }), /Client did not sign: Owner was away/);
  assert.match(checks({ signature: SIGNED, signaturePhoto: false }), /signature picture missing/);
});

test('colours: ON green, BLUE blue, OFF red, N/A grey, No red, Checks amber, AMC by date', () => {
  const c = (h, v, today) => classify(COLUMNS[HEADERS.indexOf(h)].key, v, today);
  assert.equal(c('ACDB', 'ON'), 'good'); assert.equal(c('ACDB', 'OFF'), 'bad'); assert.equal(c('ACDB', 'N/A'), 'neutral');
  assert.equal(c('Internet', 'BLUE'), 'blue'); assert.equal(c('Internet', 'OFF'), 'bad'); assert.equal(c('Internet', 'N/A'), 'neutral');
  assert.equal(c('Customer signature', 'Yes'), 'good'); assert.equal(c('Supervisor signature', 'No'), 'bad');
  assert.equal(c('Washed with water', 'No'), 'bad'); assert.equal(c('Before photos taken', 'Yes'), 'good');
  assert.equal(c('Before', 'Uploaded (2)'), 'good'); assert.equal(c('Bill', 'Not uploaded'), 'bad');
  assert.equal(c('Inverters', 'Uploaded (3)'), 'good'); assert.equal(c('Inverters', 'Not uploaded'), 'bad');
  assert.equal(c('Client signature', 'Signed 2026-11-02 13:00'), 'good'); assert.equal(c('Client signature', 'Not taken'), 'bad');
  assert.equal(c('Client signature', 'Not available: away'), 'warn'); assert.equal(c('Client signature', 'Signed (picture missing)'), 'warn');
  assert.equal(c('Overall status', 'Completed'), 'good'); assert.equal(c('Overall status', 'Partly completed'), 'warn'); assert.equal(c('Overall status', 'Not completed'), 'bad');
  assert.equal(c('Defects', 'Yes'), 'bad'); assert.equal(c('Defects', 'No'), 'good');
  assert.equal(c('Checks', 'OK'), null); assert.equal(c('Checks', 'No GPS: Before_1'), 'warn');
  assert.equal(c('AMC expiry', '2027-09-30', '2026-11-06'), null); assert.equal(c('AMC expiry', '2026-12-15', '2026-11-06'), 'warn'); assert.equal(c('AMC expiry', '2026-09-30', '2026-11-06'), 'bad');
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
  const boxes = boxesFor(4), checks = (photos, date) => buildChecks(fakeVisit(site, photos, date, SIGNED), site, boxes);
  const ok = { Inverter1: 1, EarthingPitBefore: 1, EarthingPitAfter: 1, Challan: 1, Bill: 1, ...signedPhoto };
  assert.equal(checks({ ...ok, Before: 2, After: 1 }), 'OK');
  assert.equal(checks({ ...ok, Before: { count: 1, capture: 'gallery', locationSource: LOC.EXIF }, After: 1 }), 'OK');                                       // EXIF: verified
  assert.match(checks({ ...ok, Before: { count: 2, capture: 'gallery', locationSource: LOC.PHONE }, After: 1 }), /^Location not verified: Before_1, Before_2$/);
  assert.match(checks({ ...ok, Before: { count: 1, capture: 'camera', locationSource: LOC.NONE, lat: null, lng: null }, After: 1 }), /^No GPS: Before_1$/);
  assert.match(checks({ ...ok, Before: 1, After: { count: 1, lat: 20.2, lng: 73 } }), /^Far from site: After_1 \(\d+ m\)$/);
  assert.match(checks({ ...ok, Before: { count: 1, takenAt: Date.parse('2026-10-30T07:00:00Z'), takenSource: 'exif' }, After: 1 }), /^Taken on 2026-10-30: Before_1$/);
  assert.equal(checks({ ...ok, Before: { count: 1, capture: 'gallery', locationSource: LOC.EXIF, takenAt: null, takenSource: '' }, After: 1 }), 'OK', 'a gallery photo with no date is not flagged for its date');
  assert.match(checks({ Before: 1, After: 1, ...signedPhoto }), /No photo: Inverter 1, Earthing pit before, Earthing pit after, Challan, Bill/);
  // non-location boxes never complain about a missing location
  assert.equal(checks({ ...ok, Before: 1, After: 1, Inverter1: { count: 1, locationSource: LOC.NONE, lat: null, lng: null, capture: 'gallery' } }), 'OK');
  // the signature is drawn at the end of the visit: its own time and place are never compared
  assert.equal(checks({ ...ok, Before: 1, After: 1, Signature: { count: 1, capture: 'drawn', takenAt: Date.parse('2026-11-03T18:00:00Z'), takenSource: '', lat: null, lng: null, locationSource: '' } }), 'OK');
});

test('HR summary: what needs attention', () => {
  const boxes = boxesFor(4), v = fakeVisit(site, { Before: 1, After: 1, Inverter1: 1, EarthingPitBefore: 1, Challan: 1 }, '2026-11-02', { status: 'unavailable', reason: 'away' });   // Earthing pit after and Bill missing
  const a = attention(v, boxes, okAnswers({ electrical: { ACDB: 'OFF', DCDB: 'OFF' }, signatures: { customer: 'No' }, work: { earthingPit: 'No' }, overall: 'Not completed' }));
  assert.deepEqual(a.missing, ['Earthing pit after', 'Bill']);
  assert.deepEqual(a.off, ['ACDB', 'DCDB']);
  assert.deepEqual(a.noSignature, ['Customer signature']); assert.deepEqual(a.notDone, ['Earthing pit checked']); assert.equal(a.notCompleted, true);
  assert.equal(a.clientSign, 'unavailable');
  const clean = attention(fakeVisit(site, { ...allPhotos(4), ...signedPhoto }, '2026-11-02', SIGNED), boxes, okAnswers());
  assert.deepEqual([clean.missing, clean.off, clean.noSignature, clean.notDone, clean.notCompleted, clean.clientSign], [[], [], [], [], false, 'signed']);
  assert.equal(attention(fakeVisit(site, allPhotos(4)), boxes, okAnswers()).clientSign, 'none');
  assert.equal(attention(fakeVisit(site, allPhotos(4), '2026-11-02', SIGNED), boxes, okAnswers()).clientSign, 'image missing');
});

test('column helpers agree with the headers', () => {
  assert.equal(HEADERS[colIndex('Inverters')], 'Inverters'); assert.equal(HEADERS[colIndex('checks')], 'Checks');
  assert.equal(ELECTRICAL.length, 7); assert.equal(SIGNATURES.length, 2); assert.equal(WORK.length, 4);
  assert.throws(() => colIndex('nope'));
});
