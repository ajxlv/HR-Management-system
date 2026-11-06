import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVendors, findVendor } from '../server/vendors.js';

test('VENDORS: several vendors, each with their own PIN', () => {
  const v = parseVendors({ VENDORS: 'Sandeep=4821; Uttam mama=7733 ;Prathamesh and Amar=2610' });
  assert.deepEqual(v, [{ name: 'Sandeep', pin: '4821' }, { name: 'Uttam mama', pin: '7733' }, { name: 'Prathamesh and Amar', pin: '2610' }]);
  assert.equal(findVendor(v, '7733').name, 'Uttam mama');
  assert.equal(findVendor(v, '0000'), null); assert.equal(findVendor(v, ''), null); assert.equal(findVendor(v, undefined), null);
  assert.equal(findVendor(v, '773'), null, 'a PIN that only starts the same is wrong');
});

test('VENDORS: mistakes are refused with a clear message', () => {
  assert.throws(() => parseVendors({ VENDORS: 'Sandeep' }), /must look like Name=1234/);
  assert.throws(() => parseVendors({ VENDORS: 'A=12' }), /4 to 8 digits/);
  assert.throws(() => parseVendors({ VENDORS: 'A=12ab' }), /4 to 8 digits/);
  assert.throws(() => parseVendors({ VENDORS: 'A=1234;a=5678' }), /used twice/);
  assert.throws(() => parseVendors({ VENDORS: 'A=1234;B=1234' }), /same PIN/);
  assert.throws(() => parseVendors({ VENDORS: '=1234' }), /must look like/);
});

test('without VENDORS the single CLEANER_NAME / CLEANER_PIN still works, and no PIN means open', () => {
  assert.deepEqual(parseVendors({ CLEANER_NAME: 'Ramesh', CLEANER_PIN: '1234' }), [{ name: 'Ramesh', pin: '1234' }]);
  assert.deepEqual(parseVendors({ CLEANER_PIN: '1234' }), [{ name: 'Cleaner', pin: '1234' }]);
  assert.deepEqual(parseVendors({}), []);
  assert.deepEqual(parseVendors({ VENDORS: 'A=1234', CLEANER_PIN: '9999' }), [{ name: 'A', pin: '1234' }], 'VENDORS wins');
});
