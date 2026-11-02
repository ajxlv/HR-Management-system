// npm run check:google : proves the Google connection works, in plain English.
import { googleFromEnv } from '../server/sheets/factory.js';

const { sheet } = googleFromEnv();
console.log(`Checking Google Sheet ${sheet.sheetId} as ${sheet.clientEmail} ...`);
const r = await sheet.check();
console.log(r.ok ? `\n${r.message}` : `\nNOT WORKING: ${r.message}`);
process.exit(r.ok ? 0 : 1);
