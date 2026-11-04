import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { ExcelSheet } from '../server/sheets/excel.js';
import { HEADERS, colIndex } from '../server/form.js';
import { loadConfig } from '../server/config.js';
import { okAnswers, rowOf } from '../testlib/helpers.js';

const clients = loadConfig({}).clients;

test('excel: one tab per client, rows appended, group band, colours set', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wrs-x-')), file = path.join(dir, 's.xlsx');
  const sheet = new ExcelSheet(file, HEADERS);
  const bad = rowOf(clients[0], { photos: { Before: 1, After: 1, Inverter1: 1 }, answers: okAnswers({ electrical: { MCB: 'OFF', SPD: 'N/A' }, signatures: { customer: 'No' }, overall: 'Partly completed' }), defects: 'Yes', details: 'Cracked panel' });
  await sheet.appendRow('Client A', bad);
  await sheet.appendRow('Client A', rowOf(clients[0]));
  await sheet.appendRow('Client B', rowOf(clients[1]));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Client A', 'Client B']);
  const a = wb.getWorksheet('Client A');
  assert.equal(a.rowCount, 4);                                   // band, header, 2 visits
  assert.equal(a.getRow(1).getCell(4).value, 'Photos');          // group band above the header
  assert.equal(a.getRow(2).getCell(1).value, 'Visit date');
  const fillOf = (r, h) => a.getRow(r).getCell(colIndex0(h) + 1).fill?.fgColor?.argb;
  const colIndex0 = (h) => HEADERS.indexOf(h);
  assert.equal(fillOf(3, 'MCB'), 'FFF8C9C9');                    // OFF red
  assert.equal(fillOf(3, 'SPD'), 'FFE5E7EB');                    // N/A grey
  assert.equal(fillOf(3, 'ACDB'), 'FFCDEED5');                   // ON green
  assert.equal(fillOf(3, 'Customer signature'), 'FFF8C9C9');     // No red
  assert.equal(fillOf(3, 'Inverters'), 'FFF8C9C9');              // 1 of 2 uploaded: red
  assert.equal(fillOf(3, 'Overall status'), 'FFFFE8B3');         // partly completed: amber
  assert.equal(fillOf(3, 'Bill'), 'FFF8C9C9');                   // not uploaded
  assert.equal(fillOf(4, 'Inverters'), 'FFCDEED5');              // all uploaded: green
  assert.equal(fillOf(4, 'Overall status'), 'FFCDEED5');
  rmSync(dir, { recursive: true, force: true });
});
