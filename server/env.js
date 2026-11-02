import { readFileSync, existsSync } from 'node:fs';

// Minimal .env loader (no dependency). Existing environment variables win.
export function loadEnvFile(file = '.env') {
  if (!existsSync(file)) return;
  for (const l of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !l.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
