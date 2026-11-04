// Everything about how the Google Sheet looks lives here: colours, groups, widths, banner text.
// Columns themselves (order, headers, widths) come from server/form.js.
// Change a value, then run `npm run format:sheet` to re-apply it to existing tabs.
import { COLUMNS, HEADERS, GROUP_SPANS, colIndex, ELECTRICAL } from '../form.js';

export const THEME = {
  green: '#0B5D4B', white: '#FFFFFF', subline: '#E7F3EF', sublineText: '#0B5D4B',
  okBg: '#D9F2E3', okText: '#0B5D32',
  badBg: '#F8D7D3', badText: '#8A1C1C',
  warnBg: '#FFF0CC', warnText: '#7A4B00',
  naBg: '#E5E7EB', naText: '#4B5563',
  band: '#F6F7F6', border: '#D0D5D2', blank: '#F1F5F4',
};
// Colour of the band above each group of columns
export const GROUP_COLORS = { 'Photos': '#1F6F8B', 'Electrical checklist': '#B7791F', 'Signatures': '#6B4E9B', 'Work done': '#0B5D4B', 'Result': '#374151' };
export const BRAND_TEXT = 'WRS Energy';       // shown instead of the logo when LOGO_URL is empty
export const OVERVIEW_TAB = 'Overview';
export const MAX_ROWS = 1000;
export const DATE_FORMAT = 'dd-mmm-yyyy', DATETIME_FORMAT = 'dd-mmm-yyyy hh:mm';

// Client tab: rows 1 title, 2 sub-line, 3 spacer, 4 group band, 5 header, data from row 6. Date, submitted-at and cleaner stay frozen.
export const CLIENT_TAB = { headerRow: 5, groupRow: 4, heights: [56, 26, 10, 26, 40], frozenColumns: 3, logoColumns: 3 };
export const NCOLS = HEADERS.length;
// Overview tab: rows 1 title, 2 sub-line, 3 spacer, 4 header, data from row 5.
export const OVERVIEW_TAB_LAYOUT = { headerRow: 4, heights: [56, 26, 10, 32] };
export const OVERVIEW_HEADERS = ['Client', 'Last visit date', 'Visits this month', 'Visits with missing photos', 'Visits with any OFF item', 'Visits not completed', 'Open defects', 'Client tab'];
export const OVERVIEW_WIDTHS = [240, 140, 140, 190, 190, 170, 130, 110];
export const HEADER_ROW = CLIENT_TAB.headerRow;   // 1-based row of the table header in client tabs (rows are appended below it)

// ---------- helpers ----------
export const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : letter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
export const q = (title) => `'${String(title).replace(/'/g, "''")}'`;           // sheet name inside a formula or range
export const str = (s) => `"${String(s).replace(/"/g, '""')}"`;                  // text inside a formula
const rgb = (hex) => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });
const rng = (sheetId, r0, r1, c0, c1) => ({ sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
const cell = (sheetId, r0, r1, c0, c1, fmt, fields) => ({ repeatCell: { range: rng(sheetId, r0, r1, c0, c1), cell: { userEnteredFormat: fmt }, fields: `userEnteredFormat(${fields})` } });
const text = (hex, extra = {}) => ({ foregroundColor: rgb(hex), ...extra });
const widthReq = (sheetId, i, px) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
const heightReq = (sheetId, i, px) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
const merge = (sheetId, r0, r1, c0, c1) => ({ mergeCells: { range: rng(sheetId, r0, r1, c0, c1), mergeType: 'MERGE_ALL' } });
const border = { style: 'SOLID', color: rgb(THEME.border) };
const starts = (v) => ({ type: 'TEXT_STARTS_WITH', values: [{ userEnteredValue: v }] });
const equals = (v) => ({ type: 'TEXT_EQ', values: [{ userEnteredValue: v }] });
const formula = (f) => ({ type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: f }] });
const GOOD = [THEME.okBg, THEME.okText], BAD = [THEME.badBg, THEME.badText], WARN = [THEME.warnBg, THEME.warnText], NA = [THEME.naBg, THEME.naText];

// Requests that remove old rules first, so applying the format twice never stacks rules.
function clearOld(sheetId, bannerRows, ncols, existing = {}) {
  const out = [{ unmergeCells: { range: rng(sheetId, 0, bannerRows, 0, ncols) } }];
  for (let i = 0; i < (existing.conditionalFormats || 0); i++) out.push({ deleteConditionalFormatRule: { sheetId, index: 0 } });
  for (const id of existing.bandedRangeIds || []) out.push({ deleteBanding: { bandedRangeId: id } });
  return out;
}

const titleStyle = (sheetId, r, c0, c1) => cell(sheetId, r, r + 1, c0, c1, { backgroundColor: rgb(THEME.green), textFormat: text(THEME.white, { bold: true, fontSize: 16 }), verticalAlignment: 'MIDDLE', horizontalAlignment: 'LEFT', padding: { left: 12 } }, 'backgroundColor,textFormat,verticalAlignment,horizontalAlignment,padding');
const logoStyle = (sheetId, c0, c1) => cell(sheetId, 0, 1, c0, c1, { backgroundColor: rgb(THEME.white), textFormat: text(THEME.green, { bold: true, fontSize: 12 }), verticalAlignment: 'MIDDLE', horizontalAlignment: 'CENTER' }, 'backgroundColor,textFormat,verticalAlignment,horizontalAlignment');
const sublineStyle = (sheetId, c0, c1) => cell(sheetId, 1, 2, c0, c1, { backgroundColor: rgb(THEME.subline), textFormat: text(THEME.sublineText, { fontSize: 10 }), verticalAlignment: 'MIDDLE', padding: { left: 12 } }, 'backgroundColor,textFormat,verticalAlignment,padding');
const headerStyle = (sheetId, row, c0, c1) => cell(sheetId, row, row + 1, c0, c1, { backgroundColor: rgb(THEME.green), textFormat: text(THEME.white, { bold: true }), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }, 'backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy');
const rule = (sheetId, startRow, c0, c1, condition, [bg, fg]) => ({
  addConditionalFormatRule: { index: 0, rule: { ranges: [rng(sheetId, startRow, MAX_ROWS, c0, c1)], booleanRule: { condition, format: { backgroundColor: rgb(bg), textFormat: { foregroundColor: rgb(fg) } } } } },
});
const tableFrame = (sheetId, headerRow, ncols) => [
  { setBasicFilter: { filter: { range: rng(sheetId, headerRow - 1, MAX_ROWS, 0, ncols) } } },
  { updateBorders: { range: rng(sheetId, headerRow - 1, MAX_ROWS, 0, ncols), top: border, bottom: border, left: border, right: border, innerHorizontal: border, innerVertical: border } },
  { addBanding: { bandedRange: { range: rng(sheetId, headerRow, MAX_ROWS, 0, ncols), rowProperties: { firstBandColor: rgb(THEME.white), secondBandColor: rgb(THEME.band) } } } },
];

// "2 of 4 uploaded" -> have / total, as sheet formulas (used for the colour and for the Overview counts)
const have = (c) => `VALUE(LEFT(${c},FIND(" of ",${c})-1))`;
const total = (c) => `VALUE(MID(${c},FIND(" of ",${c})+4,FIND(" uploaded",${c})-FIND(" of ",${c})-4))`;

// Formatting for one client tab.
export function clientTabRequests(sheetId, existing) {
  const T = CLIENT_TAB, n = NCOLS, first = T.headerRow;            // first data row index (0-based) = header row number (1-based)
  const logo = T.logoColumns;
  const inv = letter(colIndex('Inverters')), r = first + 1;
  const reqs = [
    ...clearOld(sheetId, T.headerRow, n, existing),
    merge(sheetId, 0, 1, 0, logo), merge(sheetId, 0, 1, logo, n),   // logo | title (the frozen columns end at the logo block, so no merge crosses the freeze line)
    merge(sheetId, 1, 2, 0, logo), merge(sheetId, 1, 2, logo, n),   // last updated | photo folder
    merge(sheetId, T.groupRow - 1, T.groupRow, 0, logo),            // blank corner of the group band
    logoStyle(sheetId, 0, logo), titleStyle(sheetId, 0, logo, n), sublineStyle(sheetId, 0, n),
    cell(sheetId, T.groupRow - 1, T.groupRow, 0, logo, { backgroundColor: rgb(THEME.blank) }, 'backgroundColor'),
    ...GROUP_SPANS.flatMap((g) => [
      merge(sheetId, T.groupRow - 1, T.groupRow, g.from, g.to + 1),
      cell(sheetId, T.groupRow - 1, T.groupRow, g.from, g.to + 1, { backgroundColor: rgb(GROUP_COLORS[g.name] || THEME.green), textFormat: text(THEME.white, { bold: true }), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }, 'backgroundColor,textFormat,horizontalAlignment,verticalAlignment'),
    ]),
    headerStyle(sheetId, T.headerRow - 1, 0, n),
    ...T.heights.map((px, i) => heightReq(sheetId, i, px)),
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: T.headerRow, frozenColumnCount: T.frozenColumns } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } },
    ...tableFrame(sheetId, T.headerRow, n),
    cell(sheetId, first, MAX_ROWS, 0, n, { verticalAlignment: 'MIDDLE', horizontalAlignment: 'CENTER' }, 'verticalAlignment,horizontalAlignment'),
    cell(sheetId, first, MAX_ROWS, colIndex('details'), colIndex('checks') + 1, { wrapStrategy: 'WRAP', horizontalAlignment: 'LEFT', verticalAlignment: 'TOP' }, 'wrapStrategy,horizontalAlignment,verticalAlignment'),
    cell(sheetId, first, MAX_ROWS, colIndex('cleaner'), colIndex('cleaner') + 1, { horizontalAlignment: 'LEFT' }, 'horizontalAlignment'),
    cell(sheetId, first, MAX_ROWS, colIndex('folder'), colIndex('folder') + 1, { horizontalAlignment: 'LEFT' }, 'horizontalAlignment'),
    cell(sheetId, first, MAX_ROWS, colIndex('date'), colIndex('date') + 1, { numberFormat: { type: 'DATE', pattern: DATE_FORMAT } }, 'numberFormat'),
    cell(sheetId, first, MAX_ROWS, colIndex('at'), colIndex('at') + 1, { numberFormat: { type: 'DATE_TIME', pattern: DATETIME_FORMAT } }, 'numberFormat'),
    ...COLUMNS.map((c, i) => widthReq(sheetId, i, c.width)),
  ];
  const col = (key) => [colIndex(key), colIndex(key) + 1];
  const uploaded = ['Before', 'After', 'Challan', 'Bill'].flatMap((k) => [rule(sheetId, first, ...col(k), starts('Not uploaded'), BAD), rule(sheetId, first, ...col(k), starts('Uploaded'), GOOD)]);
  const span = (a, b) => [colIndex(a), colIndex(b) + 1];
  const eFrom = colIndex(`e:${ELECTRICAL[0].key}`), eTo = colIndex(`e:${ELECTRICAL[ELECTRICAL.length - 1].key}`) + 1;
  return [
    ...reqs,
    ...uploaded,
    // Inverters is red unless every inverter has a photo
    rule(sheetId, first, ...col('Inverters'), formula(`=AND($${inv}${r}<>"",IFERROR(${have(`$${inv}${r}`)}<${total(`$${inv}${r}`)},FALSE))`), BAD),
    rule(sheetId, first, ...col('Inverters'), formula(`=AND($${inv}${r}<>"",IFERROR(${have(`$${inv}${r}`)}>=${total(`$${inv}${r}`)},FALSE))`), GOOD),
    rule(sheetId, first, eFrom, eTo, equals('OFF'), BAD), rule(sheetId, first, eFrom, eTo, equals('ON'), GOOD), rule(sheetId, first, eFrom, eTo, equals('N/A'), NA),
    rule(sheetId, first, ...span('s:customer', 's:supervisor'), equals('No'), BAD), rule(sheetId, first, ...span('s:customer', 's:supervisor'), equals('Yes'), GOOD),
    rule(sheetId, first, ...span('w:sessionCleaning', 'afterTaken'), equals('No'), BAD), rule(sheetId, first, ...span('w:sessionCleaning', 'afterTaken'), equals('Yes'), GOOD),
    rule(sheetId, first, ...col('overall'), equals('Completed'), GOOD), rule(sheetId, first, ...col('overall'), equals('Partly completed'), WARN), rule(sheetId, first, ...col('overall'), equals('Not completed'), BAD),
    rule(sheetId, first, ...col('defects'), equals('Yes'), BAD), rule(sheetId, first, ...col('defects'), equals('No'), GOOD),
    rule(sheetId, first, ...col('checks'), formula(`=AND($${letter(colIndex('checks'))}${r}<>"",$${letter(colIndex('checks'))}${r}<>"OK")`), WARN),
  ];
}

// Formatting for the Overview tab.
export function overviewRequests(sheetId, existing) {
  const T = OVERVIEW_TAB_LAYOUT, nc = OVERVIEW_HEADERS.length, first = T.headerRow;
  const openCol = OVERVIEW_HEADERS.indexOf('Open defects'), offCol = OVERVIEW_HEADERS.indexOf('Visits with any OFF item');
  return [
    ...clearOld(sheetId, T.headerRow, nc, existing),
    merge(sheetId, 0, 1, 1, nc), merge(sheetId, 1, 2, 0, nc),
    logoStyle(sheetId, 0, 1), titleStyle(sheetId, 0, 1, nc), sublineStyle(sheetId, 0, nc),
    headerStyle(sheetId, T.headerRow - 1, 0, nc),
    ...T.heights.map((px, i) => heightReq(sheetId, i, px)),
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: T.headerRow } }, fields: 'gridProperties.frozenRowCount' } },
    ...tableFrame(sheetId, T.headerRow, nc),
    cell(sheetId, first, MAX_ROWS, 0, nc, { verticalAlignment: 'MIDDLE' }, 'verticalAlignment'),
    cell(sheetId, first, MAX_ROWS, 1, nc, { horizontalAlignment: 'CENTER' }, 'horizontalAlignment'),
    cell(sheetId, first, MAX_ROWS, 1, 2, { numberFormat: { type: 'DATE', pattern: DATE_FORMAT } }, 'numberFormat'),
    ...OVERVIEW_WIDTHS.map((px, i) => widthReq(sheetId, i, px)),
    // red when above 0: open defects, any OFF item, not completed
    ...[openCol, offCol, OVERVIEW_HEADERS.indexOf('Visits not completed')].map((c) => ({
      addConditionalFormatRule: { index: 0, rule: { ranges: [rng(sheetId, first, MAX_ROWS, c, c + 1)],
        booleanRule: { condition: formula(`=AND($${letter(c)}${first + 1}<>"",$${letter(c)}${first + 1}>0)`), format: { backgroundColor: rgb(THEME.badBg), textFormat: { foregroundColor: rgb(THEME.badText), bold: true } } } } },
    })),
  ];
}

// ---------- cell contents ----------
export const logoCell = (logoUrl) => (logoUrl ? `=IMAGE(${str(logoUrl)}, 1)` : BRAND_TEXT);
export const clientTitle = (clientName) => `${clientName}: Panel Cleaning Visits`;
export const clientUpdated = (updated) => `Last updated: ${updated} IST`;
export const clientPhotos = (rootFolder, folder) => `Photos: OneDrive / ${rootFolder} / ${folder}`;
export const OVERVIEW_TITLE = 'WRS Panel Cleaning: Overview';
export const overviewSubline = 'Counts are live formulas over each client tab, so they stay correct if rows are edited by hand.';

// Overview row for one client tab (formulas, so edits by hand are counted).
export function overviewRow(tabTitle, tabSheetId, clientName) {
  const t = q(tabTitle), top = CLIENT_TAB.headerRow + 1;
  const range = (key) => `${t}!$${letter(colIndex(key))}$${top}:$${letter(colIndex(key))}`;
  const date = range('date');
  const notUp = ['Before', 'After', 'Challan', 'Bill'].map((k) => `(${range(k)}="Not uploaded")`).join('+');
  const inv = range('Inverters');
  const invMissing = `(IFERROR(${have(inv)},0)<IFERROR(${total(inv)},0))`;
  const off = ELECTRICAL.map((e) => `(${range(`e:${e.key}`)}="OFF")`).join('+');
  const overall = range('overall');
  return [
    clientName,
    `=IFERROR(IF(MAXIFS(${date},${date},">0")=0,"",MAXIFS(${date},${date},">0")),"")`,
    `=COUNTIFS(${date},">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),${date},"<="&EOMONTH(TODAY(),0))`,
    `=ARRAYFORMULA(SUMPRODUCT(--((${notUp}+${invMissing})>0)))`,
    `=SUMPRODUCT(--((${off})>0))`,
    `=COUNTIFS(${overall},"<>Completed",${overall},"<>")`,
    `=COUNTIFS(${range('defects')},"Yes")`,
    `=HYPERLINK("#gid=${tabSheetId}","Open")`,
  ];
}
