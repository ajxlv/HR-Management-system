export const TZ = 'Asia/Kolkata';

function parts(ms) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
}
export const istDate = (ms) => { const p = parts(ms); return `${p.year}-${p.month}-${p.day}`; };
export const istDateTime = (ms) => { const p = parts(ms); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };

export function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400000);
}
export function isRealDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
}

export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Runs async jobs strictly one after another, so numbering never clashes.
export class Mutex {
  constructor() { this.tail = Promise.resolve(); }
  run(fn) {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
}

export const safeName = (s) => String(s).replace(/[\\/:*?"<>|\[\]]/g, '-').trim().slice(0, 100);
