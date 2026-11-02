// npm run format:sheet : re-applies the layout (banner, colours, widths, filter) to every client tab and the Overview.
// Use it if someone has messed up the formatting, or after changing server/sheets/layout.js.
import { googleFromEnv } from '../server/sheets/factory.js';

const { sheet } = googleFromEnv();
try {
  const r = await sheet.formatAll();
  console.log(`Formatted: Overview${r.done.map((t) => `, ${t}`).join('')}`);
  if (r.skipped.length) console.log(`Left alone (not a client in server/clients.json): ${r.skipped.join(', ')}`);
} catch (e) {
  console.error(`NOT WORKING: ${sheet.explain(e)}`);
  process.exit(1);
}
