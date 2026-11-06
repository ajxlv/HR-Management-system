// What a cell's value means, as a colour class. Used by the Excel file and the layout preview.
// (The Google Sheet applies the same rules with conditional formatting, see layout.js.)
// Returns 'good' | 'bad' | 'warn' | 'neutral' | 'blue' | null
import { AMC_REMIND_DAYS } from '../form.js';

const PHOTO_COLUMNS = ['Before', 'After', 'Inverters', 'EarthingPitBefore', 'EarthingPitAfter', 'Challan', 'Bill'];

// today: 'YYYY-MM-DD', needed only for the AMC expiry date
export function classify(key, value, today) {
  const v = String(value ?? '');
  if (PHOTO_COLUMNS.includes(key)) return v.startsWith('Uploaded') ? 'good' : v === 'Not uploaded' ? 'bad' : null;
  if (key === 'e:Internet') return v === 'BLUE' ? 'blue' : v === 'OFF' ? 'bad' : v === 'N/A' ? 'neutral' : null;
  if (key.startsWith('e:')) return v === 'ON' ? 'good' : v === 'OFF' ? 'bad' : v === 'N/A' ? 'neutral' : null;
  if (key.startsWith('s:') || key.startsWith('w:') || key === 'beforeTaken' || key === 'afterTaken') return v === 'Yes' ? 'good' : v === 'No' ? 'bad' : null;
  if (key === 'clientSign') return v === 'Signed (picture missing)' || v.startsWith('Not available') ? 'warn' : v.startsWith('Signed') ? 'good' : v === 'Not taken' ? 'bad' : null;
  if (key === 'overall') return v === 'Completed' ? 'good' : v === 'Not completed' ? 'bad' : v === 'Partly completed' ? 'warn' : null;
  if (key === 'defects') return v === 'Yes' ? 'bad' : v === 'No' ? 'good' : null;
  if (key === 'checks') return v && v !== 'OK' ? 'warn' : null;
  if (key === 'amcExpiry' && /^\d{4}-\d{2}-\d{2}$/.test(v) && today) {
    const days = Math.round((Date.parse(v) - Date.parse(today)) / 86400000);
    return days < 0 ? 'bad' : days <= AMC_REMIND_DAYS ? 'warn' : null;
  }
  return null;
}
