import { promises as fs } from 'node:fs';
import path from 'node:path';
import { safeName } from '../util.js';

// Stand-in for the Google Sheet: one CSV file per client tab.
export class CsvSheet {
  constructor(dataDir, headers) { this.dir = path.join(dataDir, 'sheet'); this.headers = headers; }
  async appendRow(tab, row) {
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${safeName(tab)}.csv`);
    const line = (cells) => cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',') + '\n';
    let exists = true;
    try { await fs.access(file); } catch { exists = false; }
    await fs.appendFile(file, (exists ? '' : line(this.headers)) + line(row));
  }
}
