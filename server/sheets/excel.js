import ExcelJS from 'exceljs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { safeName } from '../util.js';

const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const GREEN = fill('FFCDEED5'), RED = fill('FFF8C9C9'), AMBER = fill('FFFFE8B3'), HEAD = fill('FF0B3D2E');

// One Excel workbook, one tab per client, one row per visit.
export class ExcelSheet {
  constructor(file, headers, boxCount) { Object.assign(this, { file, headers, boxCount }); }

  async appendRow(tab, row) {
    const wb = new ExcelJS.Workbook();
    if (await fs.access(this.file).then(() => true, () => false)) await wb.xlsx.readFile(this.file);
    const title = safeName(tab).slice(0, 31); // Excel tab names: 31 characters max
    let ws = wb.getWorksheet(title);
    if (!ws) {
      ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.addRow(this.headers);
      ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD; c.alignment = { vertical: 'middle' }; });
      ws.getRow(1).height = 24;
      ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
      [12, 18, 14, ...Array(this.boxCount).fill(15), 10, 34, 40, 38].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    }
    const r = ws.addRow(row);
    const first = 4, defects = first + this.boxCount, checks = defects + 2;
    for (let i = first; i < first + this.boxCount; i++) {
      const c = r.getCell(i); c.fill = String(c.value).startsWith('Uploaded') ? GREEN : RED;
    }
    r.getCell(defects).fill = r.getCell(defects).value === 'Yes' ? RED : GREEN;
    if (r.getCell(checks).value !== 'OK') r.getCell(checks).fill = AMBER;
    r.eachCell((c) => { c.alignment = { vertical: 'top', wrapText: true }; });

    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await wb.xlsx.writeFile(tmp);
    await fs.rename(tmp, this.file); // fails if someone has the file open in Excel; the app retries
  }
}
