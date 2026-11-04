// Everything about how the Google Sheet looks lives here: colours, columns, widths, banner text.
// Change a value, then run `npm run format:sheet` to re-apply it to existing tabs.
import { BOXES, HEADERS } from '../config.js';

export const THEME = {
  green: '#0B5D4B', white: '#FFFFFF', subline: '#E7F3EF', sublineText: '#0B5D4B',
  okBg: '#D9F2E3', okText: '#0B5D32',
  badBg: '#F8D7D3', badText: '#8A1C1C',
  warnBg: '#FFF0CC', warnText: '#7A4B00',
  band: '#F6F7F6', border: '#D0D5D2',
};
export const BRAND_TEXT = 'WRS Energy';       // shown instead of the logo when LOGO_URL is empty
export const OVERVIEW_TAB = 'Overview';
export const BANNER_ROWS = 3, HEADER_ROW = 4;  // 1-based; data starts at row 5
export const MAX_ROWS = 1000;
export const ROW_HEIGHTS = [56, 26, 10, 32];   // rows 1..4, in pixels
export const DATE_FORMAT = 'dd-mmm-yyyy', DATETIME_FORMAT = 'dd-mmm-yyyy hh:mm';

// Column widths in pixels, in the same order as HEADERS.
const n = BOXES.length;
export const WIDTHS = [110, 150, 110, ...Array(n).fill(105), 85, 300, 300, 290];
export const COL = { date: 0, at: 1, cleaner: 2, box0: 3, defects: 3 + n, details: 4 + n, checks: 5 + n, folder: 6 + n };
export const NCOLS = HEADERS.length;

export const OVERVIEW_HEADERS = ['Client', 'Last visit date', 'Visits this month', 'Visits with missing photos', 'Open defects', 'Client tab'];
export const OVERVIEW_WIDTHS = [240, 140, 140, 190, 130, 110];

// ---------- helpers ----------
export const letter = (i) => String.fromCharCode(65 + i);
export const q = (title) => `'${String(title).replace(/'/g, "''")}'`;           // sheet name inside a formula or range
export const str = (s) => `"${String(s).replace(/"/g, '""')}"`;                  // text inside a formula
const rgb = (hex) => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });
const rng = (sheetId, r0, r1, c0, c1) => ({ sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
const cell = (sheetId, r0, r1, c0, c1, fmt, fields) => ({ repeatCell: { range: rng(sheetId, r0, r1, c0, c1), cell: { userEnteredFormat: fmt }, fields: `userEnteredFormat(${fields})` } });
const text = (hex, extra = {}) => ({ foregroundColor: rgb(hex), ...extra });
const widthReq = (sheetId, i, px) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
const heightReq = (sheetId, i, px) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
const rule = (sheetId, c0, c1, condition, bg, fg) => ({
  addConditionalFormatRule: { index: 0, rule: { ranges: [rng(sheetId, BANNER_ROWS + 1, MAX_ROWS, c0, c1)],
    booleanRule: { condition, format: { backgroundColor: rgb(bg), textFormat: { foregroundColor: rgb(fg) } } } } },
});
const starts = (v) => ({ type: 'TEXT_STARTS_WITH', values: [{ userEnteredValue: v }] });
const equals = (v) => ({ type: 'TEXT_EQ', values: [{ userEnteredValue: v }] });
const formula = (f) => ({ type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: f }] });
const border = { style: 'SOLID', color: rgb(THEME.border) };

// Requests that remove old rules first, so applying the format twice never stacks rules.
function clearOld(sheetId, existing = {}) {
  const out = [{ unmergeCells: { range: rng(sheetId, 0, BANNER_ROWS, 0, NCOLS) } }];
  for (let i = 0; i < (existing.conditionalFormats || 0); i++) out.push({ deleteConditionalFormatRule: { sheetId, index: 0 } });
  for (const id of existing.bandedRangeIds || []) out.push({ deleteBanding: { bandedRangeId: id } });
  return out;
}

function banner(sheetId, ncols) {
  return [
    { mergeCells: { range: rng(sheetId, 0, 1, 1, ncols), mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: rng(sheetId, 1, 2, 0, ncols), mergeType: 'MERGE_ALL' } },
    cell(sheetId, 0, 1, 1, ncols, { backgroundColor: rgb(THEME.green), textFormat: text(THEME.white, { bold: true, fontSize: 16 }), verticalAlignment: 'MIDDLE', horizontalAlignment: 'LEFT', padding: { left: 12 } }, 'backgroundColor,textFormat,verticalAlignment,horizontalAlignment,padding'),
    cell(sheetId, 0, 1, 0, 1, { backgroundColor: rgb(THEME.white), textFormat: text(THEME.green, { bold: true, fontSize: 12 }), verticalAlignment: 'MIDDLE', horizontalAlignment: 'CENTER' }, 'backgroundColor,textFormat,verticalAlignment,horizontalAlignment'),
    cell(sheetId, 1, 2, 0, ncols, { backgroundColor: rgb(THEME.subline), textFormat: text(THEME.sublineText, { fontSize: 10 }), verticalAlignment: 'MIDDLE', padding: { left: 12 } }, 'backgroundColor,textFormat,verticalAlignment,padding'),
    cell(sheetId, 3, 4, 0, ncols, { backgroundColor: rgb(THEME.green), textFormat: text(THEME.white, { bold: true }), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy'),
    ...ROW_HEIGHTS.map((px, i) => heightReq(sheetId, i, px)),
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: HEADER_ROW } }, fields: 'gridProperties.frozenRowCount' } },
    { setBasicFilter: { filter: { range: rng(sheetId, HEADER_ROW - 1, MAX_ROWS, 0, ncols) } } },
    { updateBorders: { range: rng(sheetId, HEADER_ROW - 1, MAX_ROWS, 0, ncols), top: border, bottom: border, left: border, right: border, innerHorizontal: border, innerVertical: border } },
    { addBanding: { bandedRange: { range: rng(sheetId, HEADER_ROW, MAX_ROWS, 0, ncols), rowProperties: { firstBandColor: rgb(THEME.white), secondBandColor: rgb(THEME.band) } } } },
  ];
}

// Formatting for one client tab.
export function clientTabRequests(sheetId, existing) {
  const first = COL.box0, last = COL.box0 + n;
  return [
    ...clearOld(sheetId, existing),
    ...banner(sheetId, NCOLS),
    cell(sheetId, HEADER_ROW, MAX_ROWS, 0, NCOLS, { verticalAlignment: 'TOP' }, 'verticalAlignment'),
    cell(sheetId, HEADER_ROW, MAX_ROWS, COL.details, COL.checks + 1, { wrapStrategy: 'WRAP' }, 'wrapStrategy'),
    cell(sheetId, HEADER_ROW, MAX_ROWS, first, last + 1, { horizontalAlignment: 'CENTER' }, 'horizontalAlignment'),
    cell(sheetId, HEADER_ROW, MAX_ROWS, COL.date, COL.date + 1, { numberFormat: { type: 'DATE', pattern: DATE_FORMAT }, horizontalAlignment: 'CENTER' }, 'numberFormat,horizontalAlignment'),
    cell(sheetId, HEADER_ROW, MAX_ROWS, COL.at, COL.at + 1, { numberFormat: { type: 'DATE_TIME', pattern: DATETIME_FORMAT }, horizontalAlignment: 'CENTER' }, 'numberFormat,horizontalAlignment'),
    ...WIDTHS.map((px, i) => widthReq(sheetId, i, px)),
    rule(sheetId, first, last, starts('Not uploaded'), THEME.badBg, THEME.badText),
    rule(sheetId, first, last, starts('Uploaded'), THEME.okBg, THEME.okText),
    rule(sheetId, COL.defects, COL.defects + 1, equals('Yes'), THEME.badBg, THEME.badText),
    rule(sheetId, COL.defects, COL.defects + 1, equals('No'), THEME.okBg, THEME.okText),
    rule(sheetId, COL.checks, COL.checks + 1, formula(`=AND($${letter(COL.checks)}${HEADER_ROW + 1}<>"",$${letter(COL.checks)}${HEADER_ROW + 1}<>"OK")`), THEME.warnBg, THEME.warnText),
  ];
}

// Formatting for the Overview tab.
export function overviewRequests(sheetId, existing) {
  const nc = OVERVIEW_HEADERS.length;
  return [
    ...clearOld(sheetId, existing),
    ...banner(sheetId, nc),
    cell(sheetId, HEADER_ROW, MAX_ROWS, 0, nc, { verticalAlignment: 'MIDDLE' }, 'verticalAlignment'),
    cell(sheetId, HEADER_ROW, MAX_ROWS, 1, nc, { horizontalAlignment: 'CENTER' }, 'horizontalAlignment'),
    cell(sheetId, HEADER_ROW, MAX_ROWS, 1, 2, { numberFormat: { type: 'DATE', pattern: DATE_FORMAT } }, 'numberFormat'),
    ...OVERVIEW_WIDTHS.map((px, i) => widthReq(sheetId, i, px)),
    { addConditionalFormatRule: { index: 0, rule: { ranges: [rng(sheetId, HEADER_ROW, MAX_ROWS, 4, 5)],
      booleanRule: { condition: formula(`=AND($E${HEADER_ROW + 1}<>"",$E${HEADER_ROW + 1}>0)`), format: { backgroundColor: rgb(THEME.badBg), textFormat: { foregroundColor: rgb(THEME.badText), bold: true } } } } } },
  ];
}

// ---------- cell contents ----------
export const logoCell = (logoUrl) => (logoUrl ? `=IMAGE(${str(logoUrl)}, 1)` : BRAND_TEXT);
export const clientTitle = (clientName) => `${clientName}: Panel Cleaning Visits`;
export const clientSubline = (rootFolder, folder, updated) => `Photos: OneDrive / ${rootFolder} / ${folder}  ·  Last updated: ${updated} IST`;
export const OVERVIEW_TITLE = 'WRS Panel Cleaning: Overview';
export const overviewSubline = 'Counts are live formulas over each client tab, so they stay correct if rows are edited by hand.';

// Overview row for one client tab (formulas, so edits by hand are counted).
export function overviewRow(tabTitle, tabSheetId, clientName) {
  const t = q(tabTitle), top = HEADER_ROW + 1;
  const rangeOf = (c) => `${t}!$${letter(c)}$${top}:$${letter(c)}`;
  const date = rangeOf(COL.date);
  const missing = BOXES.map((_, i) => `(${rangeOf(COL.box0 + i)}="Not uploaded")`).join('+');
  return [
    clientName,
    `=IFERROR(IF(MAXIFS(${date},${date},">0")=0,"",MAXIFS(${date},${date},">0")),"")`,
    `=COUNTIFS(${date},">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),${date},"<="&EOMONTH(TODAY(),0))`,
    `=SUMPRODUCT(--((${missing})>0))`,
    `=COUNTIFS(${rangeOf(COL.defects)},"Yes")`,
    `=HYPERLINK("#gid=${tabSheetId}","Open")`,
  ];
}
