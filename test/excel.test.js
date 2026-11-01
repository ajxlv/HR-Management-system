import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { ExcelSheet } from '../server/sheets/excel.js';
import { HEADERS, BOXES } from '../server/config.js';

test('excel: one tab per client, rows appended, colours set', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wrs-x-')), file = path.join(dir, 's.xlsx');
  const sheet = new ExcelSheet(file, HEADERS, BOXES.length);
  const row = (n, wires, defects, checks) => ['2026-11-01', '2026-11-01 10:00', 'Ramesh', `Uploaded (${n})`, 'Uploaded (1)', 'Uploaded (1)', wires, defects, '', checks, 'Clients/A/2026-11-01'];
  await sheet.appendRow('Client A', row(2, 'Not uploaded', 'Yes', 'After_1: no GPS'));
  await sheet.appendRow('Client A', row(1, 'Uploaded (1)', 'No', 'OK'));
  await sheet.appendRow('Client B', row(1, 'Uploaded (1)', 'No', 'OK'));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Client A', 'Client B']);
  const a = wb.getWorksheet('Client A');
  assert.equal(a.rowCount, 3);
  assert.equal(a.getRow(1).getCell(1).value, 'Visit date');
  assert.equal(a.getRow(2).getCell(7).value, 'Not uploaded');
  assert.equal(a.getRow(2).getCell(7).fill.fgColor.argb, 'FFF8C9C9');   // red
  assert.equal(a.getRow(2).getCell(4).fill.fgColor.argb, 'FFCDEED5');   // green
  assert.equal(a.getRow(2).getCell(10).fill.fgColor.argb, 'FFFFE8B3');  // amber check
  rmSync(dir, { recursive: true, force: true });
});
