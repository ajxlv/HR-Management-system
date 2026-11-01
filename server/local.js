// Local stand-ins for OneDrive and the Google Sheet, used for testing.
const fs = require('fs'), path = require('path');
const ROOT = process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage');

const files = {
  async put(rel, buf) { const f = path.join(ROOT, 'onedrive', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); },
  async list(rel) { try { return fs.readdirSync(path.join(ROOT, 'onedrive', rel)); } catch { return []; } },
};

const csv = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const sheet = {
  async addRow(tab, header, row) {
    const f = path.join(ROOT, 'sheets', tab.replace(/[^\w .-]+/g, '_') + '.csv');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (!fs.existsSync(f)) fs.writeFileSync(f, header.map(csv).join(',') + '\n');
    fs.appendFileSync(f, row.map(csv).join(',') + '\n');
  },
};

module.exports = { files, sheet };
