// What a cell's value means, as a colour class. Used by the Excel file and the layout preview.
// (The Google Sheet applies the same rules with conditional formatting, see layout.js.)
// Returns 'good' | 'bad' | 'warn' | 'neutral' | null
export function parseInverters(text) {
  const m = String(text).match(/^(\d+) of (\d+) uploaded$/);
  return m ? { have: +m[1], total: +m[2] } : null;
}

export function classify(key, value) {
  const v = String(value ?? '');
  if (key === 'Before' || key === 'After' || key === 'Challan' || key === 'Bill') return v.startsWith('Uploaded') ? 'good' : v === 'Not uploaded' ? 'bad' : null;
  if (key === 'Inverters') { const i = parseInverters(v); return i ? (i.have >= i.total ? 'good' : 'bad') : null; }
  if (key.startsWith('e:')) return v === 'ON' ? 'good' : v === 'OFF' ? 'bad' : v === 'N/A' ? 'neutral' : null;
  if (key.startsWith('s:') || key.startsWith('w:') || key === 'beforeTaken' || key === 'afterTaken') return v === 'Yes' ? 'good' : v === 'No' ? 'bad' : null;
  if (key === 'overall') return v === 'Completed' ? 'good' : v === 'Not completed' ? 'bad' : v === 'Partly completed' ? 'warn' : null;
  if (key === 'defects') return v === 'Yes' ? 'bad' : v === 'No' ? 'good' : null;
  if (key === 'checks') return v && v !== 'OK' ? 'warn' : null;
  return null;
}
