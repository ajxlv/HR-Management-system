// Which version is running, shown on the cleaner's screen so "I cannot see the latest changes" can be checked in a second.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
function commit() {
  const e = process.env;
  const fromHost = e.VERCEL_GIT_COMMIT_SHA || e.RENDER_GIT_COMMIT || e.RAILWAY_GIT_COMMIT_SHA || e.GIT_COMMIT;
  if (fromHost) return fromHost.slice(0, 7);
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
}
export const VERSION = (() => {
  let v = '0';
  try { v = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch { /* keep 0 */ }
  return { version: v, commit: commit() };
})();
