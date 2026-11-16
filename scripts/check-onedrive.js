// Proves the OneDrive settings in .env work: creates a test folder, uploads a file, reads it back.
//   npm run check:onedrive
import { loadEnvFile } from '../server/env.js';
import { loadConfig } from '../server/config.js';
import { OneDriveStorage } from '../server/storage/onedrive.js';
import { LocalStorage } from '../server/storage/local.js';
import path from 'node:path';

loadEnvFile();
const cfg = loadConfig();
try {
  const storage = cfg.storage === 'onedrive' ? new OneDriveStorage(cfg.ms) : new LocalStorage(cfg.localRoot || path.join(cfg.dataDir, 'onedrive'));
  const text = `WRS connection test ${new Date().toISOString()}`;
  const saved = await storage.saveNamed({ rootFolder: cfg.rootFolder, folder: '_connection-test', name: 'test.txt', buffer: Buffer.from(text) });
  const back = (await storage.read(saved.path)).toString();
  if (back !== text) throw new Error('The file was written but read back differently');
  console.log(`OK (${cfg.storage}): wrote and read ${saved.path}. You can delete the "_connection-test" folder.`);
} catch (e) {
  console.error(`FAILED (${cfg.storage}): ${e.message}`);
  if (/Microsoft sign-in failed/.test(e.message)) console.error('Check MS_TENANT_ID, MS_CLIENT_ID and that MS_CLIENT_SECRET is the secret VALUE (not the secret ID) and has not expired.');
  if (/40[13]/.test(e.message)) console.error('Permission problem: the app needs the Microsoft Graph APPLICATION permission Files.ReadWrite.All with admin consent granted.');
  if (/404/.test(e.message)) console.error('The drive was not found: check MS_USER (the exact work email whose OneDrive should hold the files).');
  process.exit(1);
}
