// Tests and demos use these six made-up clients, never the real list in server/clients.json.
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';

export const FIXTURE_CLIENTS = fileURLToPath(new URL('./clients.fixture.json', import.meta.url));
export const testConfig = (env = {}, overrides = {}) => loadConfig(env, { clientsFile: FIXTURE_CLIENTS, ...overrides });
