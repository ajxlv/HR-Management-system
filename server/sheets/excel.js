import ExcelJS from 'exceljs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { safeName } from '../util.js';
import { COLUMNS, GROUP_SPANS } from '../form.js';
import { classify } from './status.js';

const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const FILL = { good: fill('FFCDEED5'), bad: fill('FFF8C9C9'), warn: fill('FFFFE8B3'), neutral: fill('FFE5E7EB'), blue: fill('FFD6ECFA') };
const HEAD = fill('FF0B3D2E');
const GROUP = { 'Photos': 'FF1F6F8B', 'Electrical checklist': 'FFB7791F', 'Signatures': 'FF6B4E9B', 'Work done': 'FF0B5D4B', 'Result': 'FF374151', 'AMC': 'FF7A5C2E' };

// One Excel workbook, one tab per client, one row per visit. (The Google Sheet is the full-featured view.)
export class ExcelSheet {
  constructor(file, headers) { Object.assign(this, { file, headers }); }

  async appendRow(tab, row) {
    const wb = new ExcelJS.Workbook();
    if (await fs.access(this.file).then(() => true, () => false)) await wb.xlsx.readFile(this.file);
    const title = safeName(tab).slice(0, 31); // Excel tab names: 31 characters max
    let ws = wb.getWorksheet(title);
    if (!ws) {
      ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 2, xSplit: 3 }] });
      ws.addRow([]);                                        // row 1: group band
      for (const g of GROUP_SPANS) {
        ws.mergeCells(1, g.from + 1, 1, g.to + 1);
        const c = ws.getCell(1, g.from + 1); c.value = g.name; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill(GROUP[g.name] || 'FF0B3D2E'); c.alignment = { horizontal: 'center' };
      }
      ws.addRow(this.headers);                              // row 2: header
      ws.getRow(2).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
      ws.getRow(2).height = 34;
      COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = Math.round(c.width / 7); });
      ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    }
    const r = ws.addRow(row);
    const today = String(row[1] || '').slice(0, 10);       // the submitted-at column starts with the date
    COLUMNS.forEach((c, i) => { const k = classify(c.key, row[i], today); if (k) r.getCell(i + 1).fill = FILL[k]; });
    r.eachCell((c) => { c.alignment = { vertical: 'top', wrapText: true }; });

    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await wb.xlsx.writeFile(tmp);
    await fs.rename(tmp, this.file); // fails if someone has the file open in Excel; the app retries
  }
}
