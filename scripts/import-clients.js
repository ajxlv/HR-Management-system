// npm run import:clients -- <file.xlsx|file.csv> [options]
// Reads HR's client list and writes server/clients.json. It refuses to write if any check fails, and prints the problems.
//   --dry-run        only report, never write
//   --column C       which column holds the site names (a letter or the heading text). Usually found by itself.
//   --sheet Name     which sheet of the workbook (default: the first)
//   --out file       where to write (default server/clients.json)
//   --replace-all    start a fresh list: ids are numbered again from c01 (use for the first real import only)
//   --allow-remove   accept that clients already in clients.json are not in the sheet (their stored visits keep the old id)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importClients } from '../server/clients-import.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !['--column', '--sheet', '--out'].includes(args[i - 1]));
if (!file) { console.error('Usage: npm run import:clients -- <file.xlsx|file.csv> [--dry-run] [--column C] [--sheet Name] [--replace-all] [--allow-remove]'); process.exit(2); }
const out = path.resolve(value('--out') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'clients.json'));

let r;
try { r = await importClients({ file: path.resolve(file), out, sheet: value('--sheet'), column: value('--column'), replaceAll: flag('--replace-all'), allowRemove: flag('--allow-remove'), dryRun: flag('--dry-run') }); }
catch (e) { console.error(`Could not read ${file}: ${e.message}`); process.exit(2); }

const m = r.map, cell = (c) => String.fromCharCode(65 + c);
console.log(`Sheet "${r.sheetName}": ${m.headerless ? 'no heading row' : `heading on row ${m.headerRow + 1}`}`);
console.log(`  names      : column ${cell(m.nameCol)} ("${m.nameHeading}")`);
console.log(`  folder     : ${m.folderCol >= 0 ? `column ${cell(m.folderCol)}` : 'no Folder column, so folder = name'}`);
console.log(`  location   : ${m.locationCol >= 0 ? `column ${cell(m.locationCol)}` : 'no Location column, so no coordinates'}`);
console.log(`  clients    : ${r.clients.length}${r.skipped.length ? `   (${r.skipped.length} row(s) with no name were skipped, for example the next contract year of the same site: rows ${r.skipped.join(', ')})` : ''}`);
if (r.fixes.length) { console.log('\nFixed automatically:'); for (const f of r.fixes) console.log(`  row ${f.row}  ${f.client}: ${f.fix}`); }
if (r.removed.length) console.log(`\nNot in the sheet any more: ${r.removed.map((c) => c.name).join(', ')}`);
if (r.problems.length) {
  console.log(`\nPROBLEMS (${r.problems.length}). Nothing was written.`);
  console.log('  row | client | problem | suggested fix');
  for (const p of r.problems) console.log(`  ${p.row} | ${p.client} | ${p.problem} | ${p.suggestion}`);
  process.exit(1);
}
console.log(r.written ? `\nWrote ${out}  (${r.clients.length} clients, sorted by name)` : '\nNo problems. Dry run: nothing written.');
