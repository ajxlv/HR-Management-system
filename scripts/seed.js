// npm run seed                      : REPORTS which client folders are missing. Creates nothing.
// npm run seed -- --create-missing  : creates only the folders that do not exist yet
// npm run seed -- --create-missing --create-root : also creates the root folder (only for a local test folder)
//
// Folders are looked for in LOCAL_ROOT/ROOT_FOLDER (for example the OneDrive sync folder), or data/onedrive/ROOT_FOLDER
// when LOCAL_ROOT is empty. The real client folders already exist in OneDrive, so the default never creates anything.
import { loadEnvFile } from '../server/env.js';
import { loadConfig } from '../server/config.js';
import { checkFolders, createMissing } from '../server/folders.js';

loadEnvFile();
const cfg = loadConfig();
const create = process.argv.includes('--create-missing'), createRoot = process.argv.includes('--create-root');
const show = (list, f) => list.slice(0, 25).forEach((x) => console.log(`  ${f(x)}`)) || (list.length > 25 && console.log(`  ... and ${list.length - 25} more`));

const r = create ? await createMissing(cfg, { createRoot }) : await checkFolders(cfg);
console.log(`Client folders are expected in: ${r.base}`);
if (!r.rootExists && !(r.created && r.created.length)) {
  console.log('\nThat folder does not exist. Check LOCAL_ROOT and ROOT_FOLDER in .env.');
  console.log('For a local test folder only: npm run seed -- --create-missing --create-root');
  process.exit(1);
}
if (r.created?.length) { console.log(`\nCreated ${r.created.length} folder(s):`); show(r.created, (c) => c.folder); }
console.log(`\n${r.present.length} of ${cfg.clients.length} client folders exist.`);
if (r.similar.length) {
  console.log(`\n${r.similar.length} client(s) have a SIMILAR folder (different case, spacing or punctuation). Nothing was created for them. Fix the name in clients.json or rename the folder:`);
  show(r.similar, (x) => `${x.client.folder}   <->   ${x.found}`);
}
if (r.missing.length) {
  console.log(`\n${r.missing.length} client folder(s) are MISSING:`);
  show(r.missing, (c) => c.folder);
  console.log('\nNothing was created. If they really are missing, run: npm run seed -- --create-missing');
}
process.exit(r.missing.length || r.similar.length ? 1 : 0);
