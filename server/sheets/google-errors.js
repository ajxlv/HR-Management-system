// Turns Google's errors into plain English, with the fix.
export class GoogleError extends Error {
  constructor(message, { status = 0, reason = '', body = null, kind = 'api', activationUrl = '' } = {}) {
    super(message);
    Object.assign(this, { status: 502, googleStatus: status, reason, body, kind, activationUrl });
  }
}

export function fromApiResponse(status, body) {
  const e = body?.error || {};
  const detail = (e.details || []).find((d) => d.metadata?.activationUrl || d.reason) || {};
  return new GoogleError(e.message || `HTTP ${status}`, {
    status, body, reason: detail.reason || e.status || '', activationUrl: detail.metadata?.activationUrl || '',
  });
}

export function explain(err, { email = '<service account email>', sheetId = '<SHEET_ID>', projectId = '' } = {}) {
  const msg = String(err?.message || err);
  const st = err?.googleStatus, reason = err?.reason || '';
  if (err?.kind === 'network' || /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(msg)) {
    return 'Cannot reach Google. Check the internet connection on this computer (and any firewall or proxy), then try again.';
  }
  if (err?.kind === 'auth') {
    if (/invalid_grant/i.test(msg)) return `Google refused the key (${msg}). Check that the computer's clock is correct and that the key file is the latest one for ${email}. If the key was deleted in Google Cloud, create a new one.`;
    if (/invalid_client|unauthorized_client/i.test(msg)) return `Google does not recognise this service account (${msg}). Check GOOGLE_KEY_FILE points to the JSON key of the right account.`;
    return `Google sign-in failed (${msg}). Check GOOGLE_KEY_FILE (or GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY).`;
  }
  if (st === 403 && (reason === 'SERVICE_DISABLED' || /has not been used in project|is disabled|API has not been enabled/i.test(msg))) {
    const link = err.activationUrl || `https://console.cloud.google.com/apis/library/sheets.googleapis.com${projectId ? `?project=${projectId}` : ''}`;
    return `Sheets API not enabled: enable it here ${link} and wait a minute.`;
  }
  if (st === 403) return `Sheet not shared with ${email}: open the sheet, press Share, add this email as Editor.`;
  if (st === 404) return `Wrong SHEET_ID (${sheetId}): copy the long id from the sheet's address, the part between /d/ and /edit.`;
  if (st === 400 && /not supported for this document/i.test(msg)) return 'This file is an Excel file opened in Google Sheets. Use File, Save as Google Sheets, then use the new sheet\'s id as SHEET_ID.';
  if (st === 401) return `Google rejected the sign-in (401). Check the key file for ${email}.`;
  if (st === 429) return 'Google says too many requests. The app will retry in a minute.';
  if (st >= 500) return `Google had a problem (${st}). The app will retry in a minute.`;
  return `Google Sheets error: ${msg}`;
}
