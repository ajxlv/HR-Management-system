// The report for one cleaning visit: the answers, the client's signature and every photo, in one PDF.
import PDFDocument from 'pdfkit';

const NAVY = '#0b3a5c', MUTED = '#5b6b78', LINE = '#d8dee3', GOOD = '#1b8a4b', BAD = '#c62828', WARN = '#a96a00';
const colour = (v) => (['ON', 'Yes', 'Completed', 'BLUE'].includes(v) ? GOOD : ['OFF', 'No', 'Not completed'].includes(v) ? BAD : v === 'Partly completed' ? WARN : MUTED);

// data: { client, folder, date, cleaner, submittedAt, answers, defects, details, checks, form, signature, boxes,
//         photos: [{ box, name, buffer }], signatureBuffer, logo }
export function buildReportPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Cleaning report: ${data.client}`, Author: 'WRS Energy' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    try { draw(doc, data); doc.end(); } catch (e) { reject(e); }
  });
}

function draw(doc, d) {
  const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right, bottom = () => doc.page.height - doc.page.margins.bottom;
  const need = (h) => { if (doc.y + h > bottom()) doc.addPage(); };
  const heading = (t) => {
    need(40); doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(t, L, doc.y, { width: W });
    doc.moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).strokeColor(LINE).stroke(); doc.moveDown(0.5);
  };
  const row = (label, value, tone) => {
    need(18); const y = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(label, L, y, { width: W * 0.58 });
    const h1 = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(tone || '#14221c').text(String(value ?? ''), L + W * 0.6, y, { width: W * 0.4 });
    doc.y = Math.max(doc.y, h1) + 3;
  };

  // header
  if (d.logo) { try { doc.image(d.logo, L, 36, { height: 34 }); } catch { /* the logo is optional */ } }
  doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text('Panel Cleaning Report', L, 40, { width: W, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('WRS Energy', L, 62, { width: W, align: 'right' });
  doc.y = 84; doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(2).strokeColor(NAVY).stroke().lineWidth(1); doc.moveDown(0.6);

  heading('Visit');
  row('Site', d.client); row('Date of work', d.date); row('Cleaned by', d.cleaner); row('Submitted at (IST)', d.submittedAt);
  row('Overall status', d.answers.overall, colour(d.answers.overall));
  row('Defects', d.defects, d.defects === 'Yes' ? BAD : GOOD);
  if (d.details) row('Defect details', d.details);
  row('Folder', d.folder);

  heading('Electrical equipment');
  for (const e of d.form.electrical) row(e.label, d.answers.electrical[e.key], colour(d.answers.electrical[e.key]));
  heading('Signatures on the paper challan');
  for (const s of d.form.signatures) row(s.label, d.answers.signatures[s.key], colour(d.answers.signatures[s.key]));
  heading('Work done');
  for (const w of d.form.work) row(w.label, d.answers.work[w.key], colour(d.answers.work[w.key]));
  heading('Checks');
  doc.font('Helvetica').fontSize(10).fillColor(d.checks === 'OK' ? GOOD : WARN).text(d.checks, L, doc.y, { width: W });

  // the client's signature, embedded in the PDF
  let sigH = 60; try { if (d.signatureBuffer) { const im = doc.openImage(d.signatureBuffer); sigH = (Math.min(300, W) * im.height) / im.width + 60; } } catch { /* shown as unreadable below */ }
  need(sigH);   // keep the heading with the picture
  heading('Client signature');
  if (d.signature?.status === 'signed' && d.signatureBuffer) {
    try {
      const img = doc.openImage(d.signatureBuffer), w = Math.min(300, W), h = (w * img.height) / img.width;
      need(h + 24); const y = doc.y;
      doc.rect(L, y, w, h).strokeColor(LINE).stroke(); doc.image(d.signatureBuffer, L, y, { width: w });
      doc.y = y + h + 4; doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Signed by the client (${d.client})`, L, doc.y);
    } catch { doc.font('Helvetica').fontSize(10).fillColor(BAD).text('Signed, but the signature picture could not be read', L, doc.y); }
  } else if (d.signature?.status === 'unavailable') {
    doc.font('Helvetica').fontSize(10).fillColor(WARN).text(`Client was not available to sign: ${d.signature.reason}`, L, doc.y, { width: W });
  } else doc.font('Helvetica').fontSize(10).fillColor(WARN).text('Not taken', L, doc.y);

  // photos, two to a row, grouped by box in the order of the form
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY).text('Photos', L, doc.y); doc.moveDown(0.5);
  const gap = 14, cw = (W - gap) / 2, ch = 190;
  for (const box of d.boxes) {
    const list = d.photos.filter((p) => p.box === box.key);
    need(ch + 50); doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(box.label, L, doc.y);
    doc.moveDown(0.3);
    if (!list.length) { doc.font('Helvetica').fontSize(9).fillColor(box.required ? BAD : MUTED).text(box.required ? 'No photo' : 'Not added', L, doc.y); doc.moveDown(0.6); continue; }
    for (let i = 0; i < list.length; i += 2) {
      need(ch + 22); const y = doc.y;
      list.slice(i, i + 2).forEach((p, k) => {
        const x = L + k * (cw + gap);
        try {
          const img = doc.openImage(p.buffer), s = Math.min(cw / img.width, ch / img.height);
          doc.image(p.buffer, x, y, { width: img.width * s, height: img.height * s });
        } catch { doc.font('Helvetica').fontSize(9).fillColor(BAD).text('(photo could not be read)', x, y); }
        doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(p.name, x, y + ch + 3, { width: cw, lineBreak: false });
      });
      doc.y = y + ch + 18;
    }
    doc.moveDown(0.3);
  }
}
