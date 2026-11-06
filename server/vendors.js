// Who can sign in. Each vendor has their own PIN, and the PIN alone says who they are (no name to type).
//
//   VENDORS=Sandeep=4821;Uttam mama=7733;Akshay=9054;Prathamesh and Amar=2610
//
// If VENDORS is empty, the single CLEANER_NAME / CLEANER_PIN pair still works. If there is no PIN at all
// the app is open (only for testing on your own computer).
import crypto from 'node:crypto';

export function parseVendors(env) {
  const raw = String(env.VENDORS || '').trim();
  const list = [];
  if (raw) {
    for (const part of raw.split(';')) {
      const t = part.trim();
      if (!t) continue;
      const i = t.lastIndexOf('=');
      if (i < 1) throw new Error(`VENDORS: "${t}" must look like Name=1234`);
      list.push({ name: t.slice(0, i).trim(), pin: t.slice(i + 1).trim(), strict: true });
    }
  } else if (env.CLEANER_PIN) {
    list.push({ name: env.CLEANER_NAME || 'Cleaner', pin: String(env.CLEANER_PIN), strict: false });
  }
  const names = new Set(), pins = new Set();
  for (const v of list) {
    if (!v.name || v.name.length > 40 || /[\u0000-\u001f]/.test(v.name)) throw new Error(`VENDORS: "${v.name}" is not a usable name (1 to 40 characters)`);
    if (v.strict && !/^\d{4,8}$/.test(v.pin)) throw new Error(`VENDORS: the PIN for ${v.name} must be 4 to 8 digits`);
    if (names.has(v.name.toLowerCase())) throw new Error(`VENDORS: the name ${v.name} is used twice`);
    if (pins.has(v.pin)) throw new Error('VENDORS: two vendors have the same PIN. Each vendor needs a different PIN, because the PIN is how the app knows who is signing in.');
    names.add(v.name.toLowerCase()); pins.add(v.pin);
  }
  return list.map(({ name, pin }) => ({ name, pin }));
}

// Compares against every vendor, so the time taken does not hint at which PINs exist.
export function findVendor(vendors, pin) {
  const given = Buffer.from(String(pin ?? ''));
  let found = null;
  for (const v of vendors) {
    const want = Buffer.from(v.pin);
    const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
    if (ok) found = v;
  }
  return found;
}
