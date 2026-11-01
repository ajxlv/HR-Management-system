import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// ONE place to change the photo boxes. Order here = order on screen.
//   camera: true  -> opens the camera directly
//   gps:    true  -> location is stamped on the photo and checked
export const BOXES = [
  { key: 'Before', label: 'BEFORE', camera: true,  gps: true  },
  { key: 'After',  label: 'AFTER',  camera: true,  gps: true  },
  { key: 'Bill',   label: 'BILL',   camera: false, gps: false },
  { key: 'Wires',  label: 'WIRES',  camera: true,  gps: true  },
];

export const HEADERS = [
  'Visit date', 'Submitted at (IST)', 'Cleaner', ...BOXES.map((b) => b.key),
  'Defects', 'Defect details', 'Checks', 'Folder path',
];

export function loadConfig(env = process.env, overrides = {}) {
  const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
  const cfg = {
    port: num(env.PORT, 3000),
    dataDir: path.resolve(env.DATA_DIR || './data'),
    secret: env.SESSION_SECRET || '',
    cleanerName: env.CLEANER_NAME || 'Cleaner',
    cleanerPin: env.CLEANER_PIN || '',
    storage: env.STORAGE || 'local',
    rootFolder: env.ROOT_FOLDER || 'Clients',
    ms: {
      tenant: env.MS_TENANT_ID, clientId: env.MS_CLIENT_ID, secret: env.MS_CLIENT_SECRET,
      driveId: env.MS_DRIVE_ID, user: env.MS_USER,
    },
    sheet: env.SHEET || 'excel',
    localRoot: env.LOCAL_ROOT || '',
    reportKey: env.REPORT_KEY || '',
    sheetId: env.SHEET_ID || '',
    google: { clientEmail: env.GOOGLE_CLIENT_EMAIL, privateKey: env.GOOGLE_PRIVATE_KEY },
    maxDaysBack: num(env.MAX_DAYS_BACK, 7),
    photoMaxAgeSec: num(env.PHOTO_MAX_AGE_SEC, 180),
    gpsMaxDistanceM: num(env.GPS_MAX_DISTANCE_M, 300),
    maxPhotoBytes: 3.8 * 1024 * 1024, // Graph simple upload limit is 4 MB
    clientsFile: path.join(here, 'clients.json'),
    ...overrides,
  };
  cfg.clients = JSON.parse(readFileSync(cfg.clientsFile, 'utf8'));
  return cfg;
}
