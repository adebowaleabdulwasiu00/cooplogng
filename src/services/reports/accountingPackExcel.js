// Accounting Pack — ExcelJS workbook writer.
// One workbook, one worksheet per statement, generated directly on request
// (no preview step). Styling follows the conventions in ./exporters.js.

const NUM_FMT = '#,##0.00;[Red]-#,##0.00';
const DATE_FMT = 'dd mmm, yyyy';

const NAVY = 'FF1F3864';
const SLATE = 'FF2F5496';
const BAND = 'FFD9E2F3';
const LABEL = 'FFF2F2F2';
const PASS = 'FFE2EFDA';
const REVIEW = 'FFFCE4D6';
const INFO = 'FFE7E6E6';
const BAD = 'FFFFC7CE';

// Exported so the verification harness can assert the workbook contains exactly
// the sheets the cover advertises, and that the count has not drifted.
export const SHEETS = [
    ['Cover & Basis', 'cooperative identity, period, basis of preparation and definitions'],
    ['Control Checks', 'every reconciliation control, with PASS / REVIEW / INFO'],
    ['Trial Balance', 'opening, period movement and closing balances by account'],
    ['General Ledger', 'every posting in the period with running balance and source ids'],
    ['Cash & Bank Book', 'per bank opening / receipts / payments / closing, plus internal transfer memo'],
    ['Member Accounts', 'per member and account balances, the member liability evidence'],
    ['Loan Register', 'per loan record with derived outstanding and ageing'],
    ['Loan Movements', 'disbursements, repayments and charges in the period'],
    ['Income Detail', 'every income posting in the period, with source traceability'],
    ['Expense Detail', 'every expenditure posting in the period, and capitalised asset movements shown separately so a purchase is never read as a cost'],
    ['Account Mapping', 'how every CoopLogNG field maps to an account, code and normal balance'],
    ['Bank Reconciliation', 'sealed bank reconciliation summaries recorded in the app'],
    ['Transaction Audit Trail', 'every remittance in the period including excluded rows'],
    ['Data Quality Exceptions', 'line-by-line explanation of each control difference']
];

// Fit to content.
//
// Excel sizes a column in characters of the workbook's default font, so fitting
// a column means measuring the text Excel will actually display in it, once per
// column. Four things make a naive scan wrong, and all four were wrong in the
// version this replaced:
//
//   1. The banner in rows 1-3, the table and section headings, the totals
//      labels and every note paragraph are single cells anchored in column 1.
//      They are display text belonging to no one column, but a scan reads them
//      as column 1's content, so a 4-character Code column measured 158
//      characters and was forced out to the ceiling on every sheet in the pack.
//      Those cells are tagged as they are written and skipped here.
//   2. The per-sheet ceilings this used (24 to 44) then clipped real content:
//      member names needing 54 characters were given 30, identifiers needing
//      42 were given 26.
//   3. A number displays through its number format, not through String(n).
//      1234567.89 is written with NUM_FMT and shows as "1,234,567.89", three
//      characters wider than the raw value, so every measured amount column
//      came out short and Excel rendered them as ####.
//   4. A wrapped cell is only ever as wide as its longest word, because that is
//      the widest line it can force. Measuring the whole string demanded a
//      200-character column for a paragraph that wraps inside 46.

// Cells holding display text rather than column content.
const FIT_EXEMPT = new WeakSet();
const PINNED = new WeakMap();
const FIT_MIN = 8;
// A runaway guard only, not a presentation ceiling. Prose columns are excluded
// from fitting by being pinned, so this number is never what decides how wide a
// description is: it exists so that a few thousand characters of unmerged text
// can never again dictate a column width.
const FIT_MAX = 100;

function exemptFromFit(cell) {
    FIT_EXEMPT.add(cell);
    return cell;
}

// A width chosen for readability rather than derived from content. Used for two
// kinds of column: prose that wraps, and prose that does not. Both are a
// presentation decision the fit cannot make on its own, because fitting them
// literally would produce a 120-character column. Every other column is fitted.
function pinWidth(ws, column, width) {
    ws.getColumn(column).width = width;
    if (!PINNED.has(ws)) PINNED.set(ws, new Set());
    PINNED.get(ws).add(column);
}

export function pinnedColumns(ws) {
    return [...(PINNED.get(ws) || new Set())].sort((a, b) => a - b);
}

function shownNumber(n, numFmt) {
    const decimals = /\.(0+)/.exec(numFmt || NUM_FMT);
    const places = decimals ? decimals[1].length : 0;
    const body = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
    return n < 0 ? `-${body}` : body;
}

function shownText(value, numFmt) {
    if (value == null || value === '') return '';
    if (typeof value === 'number') return shownNumber(value, numFmt);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'object') {
        if (Array.isArray(value.richText)) return value.richText.map(t => t.text).join('');
        if (value.result !== undefined) return shownText(value.result, numFmt);
        if (value.text !== undefined) return String(value.text);
        if (value.error) return String(value.error);
        return '';
    }
    return String(value);
}

// The width one cell asks for, in characters. A little is added for the bold
// headers and for the padding Excel puts inside the column.
function cellDemand(cell) {
    if (FIT_EXEMPT.has(cell)) return 0;
    // A cell merged into another reports the master's value; that text is
    // already counted once, at the master.
    if (cell.isMerged && cell.master !== cell) return 0;
    const t = shownText(cell.value, cell.numFmt);
    if (!t) return 0;
    const chars = cell.alignment && cell.alignment.wrapText
        ? t.split(/\s+/).reduce((widest, word) => (word.length > widest ? word.length : widest), 0)
        : t.length;
    return chars + (cell.font && cell.font.bold ? 1 : 0);
}

export function fitColumns(ws, opts = {}) {
    const min = opts.min == null ? FIT_MIN : opts.min;
    const max = opts.max == null ? FIT_MAX : opts.max;
    const pinned = PINNED.get(ws) || new Set();
    // Driven by the rows that were written, not by the columns that were named,
    // so a column the sheet filled but never asked for by name is still fitted.
    const colCount = ws.columnCount;
    const demand = new Array(colCount + 1).fill(0);
    ws.eachRow({ includeEmpty: false }, row => {
        row.eachCell({ includeEmpty: false }, (cell, column) => {
            if (column > colCount) return;
            const d = cellDemand(cell);
            if (d > demand[column]) demand[column] = d;
        });
    });
    for (let c = 1; c <= colCount; c++) {
        if (pinned.has(c)) continue;
        ws.getColumn(c).width = Math.min(max, Math.max(min, demand[c] + 2));
    }
    return colCount;
}

// Fits every column of every sheet once the whole pack exists, so no sheet can
// be left unfitted because its own writer did not call the fit, and every fit
// sees the sheet's final row rather than the rows present at the time.
export function fitAllColumns(wb, opts = {}) {
    for (const ws of wb.worksheets) fitColumns(ws, opts);
}

// A heading on a line of its own: the label for the table that follows it, or a
// totals label. Like the banner, it is display text anchored in column 1 rather
// than the content of that column, so it is exempt from the fit and Excel is
// left to show it spilling across the empty cells to its right. Without this a
// fifty-character heading sets the width of the Code column in front of it.
function headingRow(ws, rowIdx, text, font) {
    const cell = exemptFromFit(ws.getCell(rowIdx, 1));
    cell.value = text;
    cell.font = font || { bold: true, size: 11, color: { argb: SLATE } };
    return cell;
}

function putBanner(ws, pack, title, subtitle, colCount) {
    ws.mergeCells(1, 1, 1, Math.max(colCount, 6));
    const c1 = exemptFromFit(ws.getCell(1, 1));
    c1.value = pack.meta.cooperativeName;
    c1.font = { size: 16, bold: true, color: { argb: NAVY } };
    c1.alignment = { horizontal: 'center' };

    ws.mergeCells(2, 1, 2, Math.max(colCount, 6));
    const c2 = exemptFromFit(ws.getCell(2, 1));
    c2.value = `Accounting Pack — ${title}`;
    c2.font = { size: 13, bold: true, color: { argb: SLATE } };
    c2.alignment = { horizontal: 'center' };

    ws.mergeCells(3, 1, 3, Math.max(colCount, 6));
    const c3 = exemptFromFit(ws.getCell(3, 1));
    c3.value = `${subtitle}  |  Period: ${pack.meta.periodLabel}  |  Opening as at ${pack.meta.openingDate}  |  Generated ${String(pack.meta.generatedAt).slice(0, 19).replace('T', ' ')} UTC by ${pack.meta.generatedBy}`;
    c3.font = { size: 9, italic: true, color: { argb: 'FF595959' } };
    c3.alignment = { horizontal: 'center' };
}

function styleHeader(ws, rowIdx, colCount, opts = {}) {
    const row = ws.getRow(rowIdx);
    for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill || NAVY } };
        cell.alignment = { vertical: 'middle', horizontal: opts.leftAlign ? 'left' : 'center', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
            left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
            bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
            right: { style: 'thin', color: { argb: 'FFBFBFBF' } }
        };
    }
    row.height = opts.height || 28;
}

function freezeAndFilter(ws, headerRow, colCount) {
    ws.views = [{ state: 'frozen', ySplit: headerRow }];
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: colCount } };
}

// `headers` are the labels a reader sees; the row objects produced by the model
// are keyed in camelCase, so a label like "Account Type" is not the property
// name `accountType`. Every call therefore passes `opts.keys`, the property
// name for each column in header order. Without this mapping the cells are
// written blank while the sheet still looks correctly headed, which is the
// worst possible failure for a report.
function writeTable(ws, pack, startRow, title, headers, rows, opts = {}) {
    const cols = headers.length;
    const keys = opts.keys && opts.keys.length === cols ? opts.keys : headers;
    if (opts.keys && opts.keys.length !== cols) {
        throw new Error(`writeTable "${title}": ${opts.keys.length} keys for ${cols} headers`);
    }
    exemptFromFit(ws.getCell(startRow, 1)).value = title;
    ws.getCell(startRow, 1).font = { bold: true, size: 11, color: { argb: SLATE } };
    const hRow = startRow + 1;
    headers.forEach((h, i) => { ws.getCell(hRow, i + 1).value = h; });
    styleHeader(ws, hRow, cols, { fill: SLATE, leftAlign: true });

    // Refuse to emit a silently empty or half-empty table. A column whose key
    // does not exist anywhere in the row shape would be written blank under a
    // convincing header, which is the worst possible failure for a report, so
    // the key mapping is checked against the union of every row's fields.
    if (rows.length && !Array.isArray(rows[0])) {
        const present = new Set();
        for (const row of rows) for (const k of Object.keys(row || {})) present.add(k);
        const missing = keys.filter(k => !present.has(k));
        if (missing.length) {
            throw new Error(`writeTable "${title}": key(s) [${missing.join(', ')}] do not exist on the row. Row fields are [${[...present].join(', ')}].`);
        }
    }

    const numericCols = new Set(opts.numericCols || []);
    let r = hRow + 1;
    for (const row of rows) {
        const values = Array.isArray(row) ? row : keys.map(k => (row && row[k] !== undefined ? row[k] : ''));
        values.forEach((v, i) => {
            const cell = ws.getCell(r, i + 1);
            if (opts.rowStyle) {
                const st = opts.rowStyle(row, values);
                if (st) {
                    if (st.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.fill } };
                    if (st.font) cell.font = st.font;
                    if (st.numFmt) cell.numFmt = st.numFmt;
                }
            }
            if (numericCols.has(i) && v !== '' && v !== null && v !== undefined) {
                cell.value = typeof v === 'number' ? v : numOrNull(v);
                cell.numFmt = NUM_FMT;
                cell.alignment = { horizontal: 'right' };
            } else {
                cell.value = v === null || v === undefined ? '' : v;
            }
            cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9D9D9' } } };
        });
        if (r % 2 === 0) {
            for (let c = 1; c <= cols; c++) {
                const cell = ws.getCell(r, c);
                if (!cell.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } };
            }
        }
        r++;
    }
    return { headerRow: hRow, lastRow: r - 1, nextRow: r + 1 };
}

function numOrNull(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : '';
}

function totalRow(ws, rowIdx, colCount, label, cells) {
    const row = ws.getRow(rowIdx);
    exemptFromFit(row.getCell(1)).value = label;
    for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        cell.font = { bold: true, size: 10, color: { argb: NAVY } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    }
    cells.forEach(([col, value]) => {
        const cell = row.getCell(col);
        cell.value = value;
        if (typeof value === 'number') { cell.numFmt = NUM_FMT; cell.alignment = { horizontal: 'right' }; }
    });
}

function noteRow(ws, rowIdx, colCount, text) {
    ws.mergeCells(rowIdx, 1, rowIdx, colCount);
    const cell = exemptFromFit(ws.getCell(rowIdx, 1));
    cell.value = text;
    cell.font = { italic: true, size: 9, color: { argb: 'FF595959' } };
    cell.alignment = { vertical: 'top', wrapText: true };
}

// ---------------------------------------------------------------------------

function coverSheet(wb, pack) {
    const ws = wb.addWorksheet('Cover & Basis', { pageSetup: { orientation: 'landscape' } });
    putBanner(ws, pack, 'Cover, Scope & Basis of Preparation', 'Statements and supporting schedules', 6);
    // Column 2 carries the basis and definition paragraphs, which wrap, so its
    // width is a readability choice. Columns 1 and 3 are fitted.
    pinWidth(ws, 2, 96);

    let r = 5;
    ws.getCell(r, 1).value = 'Report identification';
    ws.getCell(r, 1).font = { bold: true, size: 11, color: { argb: SLATE } };
    r++;
    const ident = [
        ['Cooperative', pack.meta.cooperativeName],
        ['Cooperative ID', pack.meta.cooperativeId],
        ['Period covered', pack.meta.startDate === pack.meta.endDate ? pack.meta.startDate : `${pack.meta.startDate} to ${pack.meta.endDate}`],
        ['Opening balances as at', pack.meta.openingDate],
        ['Closing balances as at', pack.meta.endDate],
        ['Generated at', pack.meta.generatedAt],
        ['Generated by', pack.meta.generatedBy],
        ['Transactions included', `${pack.meta.postedRows} approved remittances`],
        ['Accounting postings derived', `${pack.meta.postings} individual postings`],
        ['Rows excluded (not approved / deleted)', `${pack.stats.skippedUnapproved} not approved, ${pack.stats.skippedDeleted} deleted`]
    ];
    for (const [k, v] of ident) {
        ws.getCell(r, 1).value = k;
        ws.getCell(r, 1).font = { bold: true, size: 10 };
        ws.getCell(r, 2).value = v;
        r++;
    }

    r++;
    ws.getCell(r, 1).value = 'Worksheets in this workbook';
    ws.getCell(r, 1).font = { bold: true, size: 11, color: { argb: SLATE } };
    r++;
    for (const [name, desc] of SHEETS) {
        ws.getCell(r, 1).value = name;
        ws.getCell(r, 1).font = { size: 10, bold: true };
        ws.getCell(r, 2).value = desc;
        r++;
    }

    r++;
    ws.getCell(r, 1).value = 'Basis of preparation';
    ws.getCell(r, 1).font = { bold: true, size: 11, color: { argb: SLATE } };
    r++;
    for (const b of pack.basis) {
        ws.getCell(r, 1).value = b.topic;
        ws.getCell(r, 1).font = { bold: true, size: 10 };
        ws.getCell(r, 1).alignment = { vertical: 'top' };
        ws.getCell(r, 2).value = b.text;
        ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
        r++;
    }

    r++;
    ws.getCell(r, 1).value = 'Definitions';
    ws.getCell(r, 1).font = { bold: true, size: 11, color: { argb: SLATE } };
    r++;
    for (const d of pack.definitions) {
        ws.getCell(r, 1).value = d.term;
        ws.getCell(r, 1).font = { bold: true, size: 10 };
        ws.getCell(r, 1).alignment = { vertical: 'top' };
        ws.getCell(r, 2).value = d.text;
        ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
        r++;
    }

    r++;
    ws.getCell(r, 1).value = 'Period result';
    ws.getCell(r, 1).font = { bold: true, size: 11, color: { argb: SLATE } };
    r++;
    const pr = pack.periodResult;
    for (const [k, v] of [
        ['Income for the period', pr.income],
        ['Expenditure for the period', pr.expense],
        ['Net surplus / (deficit)', pr.surplus],
        ['Retained earnings brought forward', pr.retainedEarningsOpening],
        ['Retained earnings carried forward', Math.round((pr.retainedEarningsOpening + pr.surplus) * 100) / 100]
    ]) {
        ws.getCell(r, 1).value = k;
        ws.getCell(r, 1).font = { bold: true, size: 10 };
        const c = ws.getCell(r, 2);
        c.value = v;
        c.numFmt = NUM_FMT;
        r++;
    }

    r++;
    noteRow(ws, r, 3, 'This pack is generated directly from the cooperative\'s own records. No source data was added, altered or removed, and no balancing figure has been inserted to make a statement foot. Where the recorded data cannot form a complete double entry the difference is reported on the Control Checks and Data Quality Exceptions sheets instead of being absorbed.');
    return ws;
}

function controlSheet(wb, pack) {
    const ws = wb.addWorksheet('Control Checks', { pageSetup: { orientation: 'landscape' } });
    const headers = ['ID', 'Control', 'What it proves', 'Value A', 'Value B', 'Difference', 'Result', 'Note'];
    putBanner(ws, pack, 'Control Checks', 'Reconciliations between the statements in this pack', headers.length);
    const res = writeTable(ws, pack, 5, 'Reconciliation controls', headers, pack.controlChecks, {
        keys: ['id', 'name', 'description', 'valueA', 'valueB', 'difference', 'status', 'note'],
        numericCols: [3, 4, 5],
        rowStyle: (row) => {
            const fill = row.status === 'PASS' ? PASS : row.status === 'REVIEW' ? REVIEW : INFO;
            return { fill, font: { bold: true, size: 10, color: { argb: row.status === 'REVIEW' ? 'FF9C0006' : 'FF1F3864' } } };
        }
    });
    // The bold status cell should win over the row tint.
    for (let r = res.headerRow + 1; r <= res.lastRow; r++) {
        const status = String(ws.getCell(r, 7).value || '');
        const cell = ws.getCell(r, 7);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: status === 'PASS' ? PASS : status === 'REVIEW' ? BAD : INFO } };
        cell.font = { bold: true, size: 10, color: { argb: status === 'REVIEW' ? 'FF9C0006' : status === 'PASS' ? 'FF375623' : 'FF3F3F76' } };
        for (let c = 2; c <= 6; c++) ws.getCell(r, c).alignment = { wrapText: true, vertical: 'top' };
        ws.getCell(r, 8).alignment = { wrapText: true, vertical: 'top' };
    }
    // These three columns wrap their text, so their width is set for
    // readability; every other column on the sheet is fitted.
    pinWidth(ws, 2, 30);
    pinWidth(ws, 3, 52);
    pinWidth(ws, 8, 70);
    fitColumns(ws);
    freezeAndFilter(ws, res.headerRow, headers.length);

    let r = res.nextRow + 1;
    headingRow(ws, r, 'Control difference — not plugged');
    r++;
    noteRow(ws, r, headers.length, `The trial balance closes with Debits ${fmt(pack.trialBalanceTotals.closingDr)} against Credits ${fmt(pack.trialBalanceTotals.closingCr)}, a control difference of ${fmt(pack.trialBalanceTotals.closingDiff)}. That figure is the arithmetic sum of every posting in this cooperative that could not be matched into a complete double entry. Each contributing remittance is listed on the Data Quality Exceptions sheet with its identifier, so the difference can be traced and cleared one transaction at a time. It has deliberately not been written off to a suspense or balancing account, because doing so would conceal the underlying records from the auditor.`);
    r += 2;
    exemptFromFit(ws.getCell(r, 1)).value = `Data quality exceptions raised: ${pack.exceptions.length}`;
    ws.getCell(r, 1).font = { bold: true, size: 10, color: { argb: pack.exceptions.length ? 'FF9C0006' : 'FF375623' } };
    r++;
    exemptFromFit(ws.getCell(r, 1)).value = `  High ${pack.exceptions.filter(e => e.severity === 'High').length}  |  Medium ${pack.exceptions.filter(e => e.severity === 'Medium').length}  |  Low ${pack.exceptions.filter(e => e.severity === 'Low').length}`;
    return ws;
}

function trialBalanceSheet(wb, pack) {
    const ws = wb.addWorksheet('Trial Balance', { pageSetup: { orientation: 'landscape' } });
    const headers = ['Code', 'Account', 'Type', 'Normal', 'Classification', 'Opening Dr', 'Opening Cr', 'Period Dr', 'Period Cr', 'Closing Dr', 'Closing Cr'];
    putBanner(ws, pack, 'Trial Balance', `As at ${pack.meta.endDate}`, headers.length);

    const res = writeTable(ws, pack, 5, 'Trial balance', headers, pack.trialBalance, {
        keys: ['code', 'account', 'type', 'normal', 'classification', 'openingDr', 'openingCr', 'periodDr', 'periodCr', 'closingDr', 'closingCr'],
        numericCols: [5, 6, 7, 8, 9, 10],
        rowStyle: (row) => (row.type === 'Income' || row.type === 'Expense'
            ? { font: { italic: true, size: 10 } } : null)
    });

    const t = pack.trialBalanceTotals;
    let r = res.nextRow;
    totalRow(ws, r, headers.length, 'TOTALS', [
        [6, t.openingDr], [7, t.openingCr], [8, t.periodDr], [9, t.periodCr], [10, t.closingDr], [11, t.closingCr]
    ]);
    r += 1;
    totalRow(ws, r, headers.length, 'CONTROL DIFFERENCE (Dr less Cr)', [
        [6, t.openingDiff], [10, t.closingDiff]
    ]);
    const diffCell = ws.getCell(r, 10);
    diffCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: Math.abs(t.closingDiff) < 0.01 ? PASS : BAD } };
    diffCell.font = { bold: true, color: { argb: Math.abs(t.closingDiff) < 0.01 ? 'FF375623' : 'FF9C0006' } };
    r += 2;

    noteRow(ws, r, headers.length, 'Basis: opening balances are cumulative at ' + pack.meta.openingDate + '; period movement covers ' + pack.meta.periodLabel + ' inclusive of both dates; closing balances are cumulative at ' + pack.meta.endDate + '. Only Approved, non-deleted remittances are included. Cash and member balances come from the remittance header and detail records respectively; income and expenditure come from the header category. Income and expenditure lines show the movement for the period only, because their cumulative result is already carried in Retained Earnings — showing both would count the same result twice.');
    r++;
    noteRow(ws, r, headers.length, 'The control difference is intentionally left visible. It represents postings in the source data that do not form a complete double entry. It has not been balanced with a suspense account; see the Control Checks and Data Quality Exceptions sheets for the individual transactions behind it.');
    r += 2;
    headingRow(ws, r, 'Period result');
    r++;
    for (const [k, v] of [['Income', pack.periodResult.income], ['Expenditure', pack.periodResult.expense], ['Net surplus / (deficit)', pack.periodResult.surplus]]) {
        ws.getCell(r, 1).value = k;
        ws.getCell(r, 1).font = { bold: true, size: 10 };
        const c = ws.getCell(r, 2);
        c.value = v; c.numFmt = NUM_FMT;
        r++;
    }

    fitColumns(ws);
    freezeAndFilter(ws, res.headerRow, headers.length);
    return ws;
}

function ledgerSheet(wb, pack) {
    const ws = wb.addWorksheet('General Ledger', { pageSetup: { orientation: 'landscape' } });
    const headers = ['Code', 'Account', 'Account Type', 'Leg', 'Date', 'Reference', 'Source Table', 'Source ID', 'Remittance ID', 'Remittance Detail ID', 'Member ID', 'Enterprise ID', 'Loan ID', 'Description', 'Member', 'Debit', 'Credit', 'Balance'];
    putBanner(ws, pack, 'General Ledger', `Postings for ${pack.meta.periodLabel}`, headers.length);
    const res = writeTable(ws, pack, 5, 'General ledger', headers, pack.generalLedger, {
        keys: ['code', 'account', 'accountType', 'leg', 'date', 'reference', 'sourceTable', 'sourceId', 'remittanceId', 'detailId', 'memberId', 'enterpriseId', 'loanId', 'description', 'member', 'debit', 'credit', 'balance'],
        numericCols: [15, 16, 17],
        rowStyle: (row) => {
            if (row.kind === 'opening') return { font: { bold: true, size: 10, color: { argb: NAVY } }, fill: LABEL };
            if (row.kind === 'closing') return { font: { bold: true, size: 10, color: { argb: NAVY } }, fill: BAND };
            return null;
        }
    });
    noteRow(ws, res.nextRow, headers.length, 'Every posting traces back to the row it came from: Source Table names the table the amount was read from (remittance_detail for a member posting, remittance for a bank or classification posting) and Source ID is that row\'s own primary key, which is also the value to search on in CoopLogNG. Reference shows the same identity combined. Leg names which side of the entry the line is: Cash is the bank movement, Member is the member or enterprise account, Classification is the income, expense, asset or liability side. Balances are running debit-positive balances on each account.');
    // Column 14 is free-text narration that does not wrap, so it is given a
    // readable width rather than fitted to its longest sentence. Everything
    // else on this sheet, including the composite reference in column 6, is
    // fitted.
    pinWidth(ws, 14, 60);
    fitColumns(ws);
    freezeAndFilter(ws, res.headerRow, headers.length);
    return ws;
}

function cashSheet(wb, pack) {
    const ws = wb.addWorksheet('Cash & Bank Book', { pageSetup: { orientation: 'landscape' } });
    const headers = ['Code', 'Bank', 'Opening', 'Receipts', 'Payments', 'Closing', 'In bank register'];
    putBanner(ws, pack, 'Cash & Bank Book', `Movements for ${pack.meta.periodLabel}`, headers.length);
    const c = pack.cashBook;
    const res = writeTable(ws, pack, 5, 'Cash and bank summary', headers, c.summary, {
        keys: ['code', 'bank', 'opening', 'receipts', 'payments', 'closing', 'registered'],
        numericCols: [2, 3, 4, 5]
    });
    let r = res.nextRow;
    totalRow(ws, r, headers.length, 'TOTAL CASH & BANK', [
        [3, c.totals.opening], [4, c.totals.receipts], [5, c.totals.payments], [6, c.totals.closing]
    ]);
    r += 2;

    headingRow(ws, r, 'Bank transactions in the period');
    r++;
    const txHeaders = ['Date', 'Remittance ID', 'Family', 'Bank', 'Transaction Type', 'Category', 'Member', 'Receipt', 'Payment'];
    const txRes = writeTable(ws, pack, r, 'Cash movements', txHeaders, c.transactions, {
        keys: ['date', 'remittanceId', 'family', 'bank', 'transactionType', 'category', 'member', 'receipt', 'payment'],
        numericCols: [7, 8]
    });
    r = txRes.nextRow + 1;

    headingRow(ws, r, 'Internal transfer memo — not cash, not income');
    r++;
    noteRow(ws, r, 9, 'Rows with bank_name "Internal Transfer" move value between the cooperative\'s own accounts. They never enter the cash book and never affect income. Their net header movement for the period is ' + fmt(c.internalNet) + '. The detail rows of these transfers are the reallocations, and they are shown in the General Ledger and Member Accounts sheets.');
    r += 2;
    const itHeaders = ['Date', 'Remittance ID', 'Family', 'Transaction Type', 'Category', 'Member', 'Header Amount', 'Detail Count', 'Detail Sum'];
    const itRes = writeTable(ws, pack, r, 'Internal transfers (memo)', itHeaders, c.internalMemo, {
        keys: ['date', 'remittanceId', 'family', 'transactionType', 'category', 'member', 'headerAmount', 'detailCount', 'detailSum'],
        numericCols: [6, 8]
    });

    fitColumns(ws);
    freezeAndFilter(ws, res.headerRow, headers.length);
    return ws;
}

function memberSheet(wb, pack) {
    const ws = wb.addWorksheet('Member Accounts', { pageSetup: { orientation: 'landscape' } });
    const headers = ['Member ID', 'Member', 'Reg No', 'Status', 'Account', 'Classification', 'Opening', 'Credits', 'Debits', 'Closing'];
    putBanner(ws, pack, 'Member Accounts', `Member liabilities as at ${pack.meta.endDate}`, headers.length);
    const m = pack.memberAccounts;
    const res = writeTable(ws, pack, 5, 'Balances by member and account', headers, m.rows, {
        keys: ['memberId', 'member', 'regNo', 'memberStatus', 'account', 'classification', 'opening', 'credits', 'debits', 'closing'],
        numericCols: [6, 7, 8, 9]
    });
    let r = res.nextRow;
    totalRow(ws, r, headers.length, 'TOTAL (includes the cooperative pseudo-member)', [
        [7, round2(m.rows.reduce((s, x) => s + x.opening, 0))],
        [8, round2(m.rows.reduce((s, x) => s + x.credits, 0))],
        [9, round2(m.rows.reduce((s, x) => s + x.debits, 0))],
        [10, m.closingTotal]
    ]);
    r += 1;
    totalRow(ws, r, headers.length, 'Of which cooperative pseudo-member 0000000000', [[10, m.pseudoTotal]]);
    r += 1;
    totalRow(ws, r, headers.length, 'Of which members', [[10, round2(m.closingTotal - m.pseudoTotal)]]);
    r += 2;

    headingRow(ws, r, 'Member totals');
    r++;
    const sHeaders = ['Member ID', 'Member', 'Reg No', 'Status', 'Opening', 'Credits', 'Debits', 'Closing'];
    writeTable(ws, pack, r, 'Summary by member', sHeaders, m.summary, {
        keys: ['memberId', 'member', 'regNo', 'memberStatus', 'opening', 'credits', 'debits', 'closing'],
        numericCols: [4, 5, 6, 7]
    });
    r += 2;

    headingRow(ws, r, 'Member-side revenue accounts (memo, excluded from the trial balance)');
    r++;
    noteRow(ws, r, 8, 'These accounts are flagged as revenue in the enterprise register. They record income accrued to members before it is collected. Because this pack recognises income from the remittance category, recognising it here as well would count the same income twice, so these movements are disclosed here and left out of the trial balance.');
    r += 2;
    const rvHeaders = ['Code', 'Account', 'Opening', 'Period', 'Closing'];
    writeTable(ws, pack, r, 'Accrued member-side revenue', rvHeaders, pack.revenueEntMemo, {
        keys: ['code', 'account', 'opening', 'period', 'closing'],
        numericCols: [2, 3, 4]
    });
    r += 2;
    noteRow(ws, r, 8, 'Basis: member balances are the sum of remittance_detail per member and account, matching the app\'s own member balance calculation. The remittance header amount is never used as a member balance. Amounts are credit-positive: a positive closing balance is owed to the member.');

    fitColumns(ws);
    freezeAndFilter(ws, res.headerRow, headers.length);
    return ws;
}

function loanSheet(wb, pack) {
    const ws = wb.addWorksheet('Loan Register', { pageSetup: { orientation: 'landscape' } });
    const l = pack.loanRegister;
    const headers = ['Loan ID', 'Member', 'Reg No', 'Account', 'Status', 'Principal', 'Issued', 'Due', 'Duration (mth)', 'Disbursed', 'Repaid', 'Charges', 'Outstanding', 'Ageing', 'Disbursement Ref', 'Disbursement Status'];
    putBanner(ws, pack, 'Loan Register', `Outstanding position as at ${pack.meta.endDate}`, headers.length);
    const res = writeTable(ws, pack, 5, 'Loans by record', headers, l.rows, {
        keys: ['loanId', 'member', 'regNo', 'account', 'status', 'principal', 'issued', 'due', 'duration', 'disbursed', 'repaid', 'charges', 'outstanding', 'ageing', 'disbursementRef', 'disbursementStatus'],
        numericCols: [5, 9, 10, 11, 12],
        rowStyle: (row) => (row.outstanding < -0.005 ? { fill: BAD, font: { size: 10, color: { argb: 'FF9C0006' } } } : null)
    });
    let r = res.nextRow;
    totalRow(ws, r, headers.length, 'TOTAL', [
        [6, round2(l.rows.reduce((s, x) => s + x.principal, 0))],
        [10, round2(l.rows.reduce((s, x) => s + x.disbursed, 0))],
        [11, round2(l.rows.reduce((s, x) => s + x.repaid, 0))],
        [12, round2(l.rows.reduce((s, x) => s + x.charges, 0))],
        [13, l.outstandingTotal]
    ]);
    r += 1;
    totalRow(ws, r, headers.length, 'Loan receivable per trial balance', [[13, l.accountClosing]]);
    if (pack.unattributedLoan && pack.unattributedLoan.count) {
        r += 1;
        totalRow(ws, r, headers.length, 'Loan movements not traceable to a loan record (control C11)', [[13, -pack.unattributedLoan.net]]);
    }
    r += 2;
    headingRow(ws, r, 'Loan movements are on the Loan Movements sheet', { bold: true, size: 10, color: { argb: SLATE } });
    r += 2;
    noteRow(ws, r, headers.length, 'Outstanding is derived from the underlying postings, not from a stored balance: the negated sum of the loan account detail movements attributed to this loan. Principal is the figure recorded when the loan was issued. Any difference between the two means the recorded principal and the actual postings disagree, which control C6 on the Control Checks sheet quantifies. Loan interest is recognised by the app only as a one-time charge collected at origination, so the Charges column is charges collected — there is no interest accrual in the source data. A loan is linked to its postings through loans.remittance_id, or through the family of rows the app generated alongside that remittance; loan account movements that match neither are listed as LOAN_DETAIL_UNATTRIBUTED on the Data Quality Exceptions sheet and quantified by control C11.');

    if (pack.unattributedLoan && pack.unattributedLoan.count) {
        r += 2;
        headingRow(ws, r, 'Loan account movements with no matching loan record');
        r++;
        noteRow(ws, r, headers.length, 'These movements post to the loan account and are included in the loan receivable above, but no loan record references their remittance, so they cannot be shown against an individual member. They are a genuine gap in the recorded data, not a presentational choice.');
        r += 2;
        const uHeaders = ['Remittance ID', 'Detail ID', 'Transaction Type', 'Member', 'Amount'];
        writeTable(ws, pack, r, 'Unattributed loan movements', uHeaders, pack.unattributedLoan.rows, {
            keys: ['remittanceId', 'detailId', 'transactionType', 'member', 'amount'],
            numericCols: [4]
        });
    }

    fitColumns(ws);
    freezeAndFilter(ws, res.headerRow, headers.length);
    return ws;
}

function loanMovementsSheet(wb, pack) {
    const ws = wb.addWorksheet('Loan Movements', { pageSetup: { orientation: 'landscape' } });
    const l = pack.loanRegister;
    const headers = ['Date', 'Remittance ID', 'Transaction Type', 'Category', 'Member', 'Reg No', 'Bank', 'Header Amount', 'Loan Account Amount', 'Detail Count', 'Detail Sum', 'Loan ID', 'Parent ID'];
    putBanner(ws, pack, 'Loan Movements', `Every posting that moved a loan account in ${pack.meta.periodLabel}`, headers.length);

    if (!l.movements.length) {
        // The header row is still written, so an empty period produces a sheet
        // with the same shape, filters and frozen header as a populated one.
        const empty = writeTable(ws, pack, 5, 'Loan account movements in the period', headers, [], {
            keys: ['date', 'remittanceId', 'transactionType', 'category', 'member', 'regNo', 'bank', 'amount', 'loanAccountAmount', 'detailCount', 'detailSum', 'loanId', 'parentId'],
            numericCols: [7, 8, 9, 10]
        });
        noteRow(ws, empty.nextRow + 1, headers.length, 'No posting moved a loan account within this period. The Loan Register sheet still shows the outstanding position carried into the period.');
        fitColumns(ws);
        freezeAndFilter(ws, 6, headers.length);
        return ws;
    }

    const res = writeTable(ws, pack, 5, 'Loan account movements in the period', headers, l.movements, {
        keys: ['date', 'remittanceId', 'transactionType', 'category', 'member', 'regNo', 'bank', 'amount', 'loanAccountAmount', 'detailCount', 'detailSum', 'loanId', 'parentId'],
        numericCols: [7, 8, 9, 10],
        rowStyle: (row) => (String(row.category) === 'Loan Income' || /charge|interest|fee/i.test(String(row.transactionType))
            ? { fill: INFO, font: { size: 10, color: { argb: 'FF3F3F76' } } } : null)
    });

    let r = res.nextRow;
    totalRow(ws, r, headers.length, 'MOVEMENT ON THE LOAN RECEIVABLE IN THE PERIOD', [
        [8, round2(l.movements.reduce((s, x) => s + x.loanAccountAmount, 0))]
    ]);
    r += 1;
    totalRow(ws, r, headers.length, 'Loan register lifetime activity (all periods)', [
        [8, round2(l.rows.reduce((s, x) => s + x.disbursed - x.repaid - x.charges, 0))],
        [9, round2(l.rows.reduce((s, x) => s + x.disbursed, 0))],
        [10, round2(l.rows.reduce((s, x) => s + x.repaid, 0))]
    ]);
    r += 2;
    noteRow(ws, r, headers.length, 'This sheet lists every remittance that actually posted to a loan account in the period, identified by the posting itself rather than by the remittance header category. The app records most loan activity under other categories, so a header-category test would omit real advances and repayments.');
    r += 1;
    noteRow(ws, r, headers.length, 'Loan Account Amount is the signed total of the detail rows that hit the loan account, and is the figure that moves the receivable. A negative amount advances the loan and increases the member\'s debt; a positive amount reduces it. Header Amount is the whole remittance, which can also carry non-loan detail, so the two columns deliberately differ. Control C14 rolls the receivable forward using this column.');
    r += 1;
    noteRow(ws, r, headers.length, 'The Loan ID column is resolved from loans.remittance_id or from the family of rows the app generated alongside that remittance, and is blank where no loan record matches. Those movements are still included in the receivable and are listed on the Data Quality Exceptions sheet and quantified by control C11.');
    r += 2;
    noteRow(ws, r, headers.length, 'The two total rows are not expected to agree. The upper row covers only postings dated inside the selected period; the lower row covers the whole life of every loan, including activity before the period began. Interest is recognised by the app only as a one-time charge collected at origination, so there is no accrual to report.');

    fitColumns(ws);
    freezeAndFilter(ws, res.headerRow, headers.length);
    return ws;
}

function incomeExpenseSheet(wb, pack, kind) {
    const isIncome = kind === 'income';
    const ws = wb.addWorksheet(isIncome ? 'Income Detail' : 'Expense Detail', { pageSetup: { orientation: 'landscape' } });
    const rows = isIncome ? pack.incomeDetail : pack.expenseDetail;
    const label = isIncome ? 'Income' : 'Expenditure';
    const headers = ['Date', 'Remittance ID', 'Family', 'Transaction Type', 'Category', 'Classification', 'Member', 'Bank', 'Amount', 'Effect', 'Side'];
    putBanner(ws, pack, isIncome ? 'Income Detail' : 'Expense Detail', `Postings for ${pack.meta.periodLabel}`, headers.length);
    const res = writeTable(ws, pack, 5, `${label} recognised in the period`, headers, rows, {
        keys: ['date', 'remittanceId', 'family', 'transactionType', 'category', 'classification', 'member', 'bank', 'amount', 'effect', 'side'],
        numericCols: [8, 9]
    });
    let r = res.nextRow;
    totalRow(ws, r, headers.length, `TOTAL ${label.toUpperCase()} (net)`, [
        [9, round2(rows.reduce((s, x) => s + x.amount, 0))],
        [10, round2(rows.reduce((s, x) => s + x.effect, 0))]
    ]);
    r += 2;
    noteRow(ws, r, headers.length, `Amount is the absolute size of the posting. Effect is its signed effect on the balance, so a reversed entry reduces ${label.toLowerCase()} rather than inflating it, and the net total foots exactly to the trial balance line for this account.`);
    r += 2;

    // Capitalised asset purchases are reported here, separated from
    // expenditure, because the app records them with an Asset or Fixed Asset
    // category and no enterprise detail. They post to a cooperative asset
    // account and never to the profit and loss.
    if (!isIncome && pack.coopAssetDetail.length) {
        headingRow(ws, r, 'Capitalised cooperative asset movements — not expenditure');
        r++;
        noteRow(ws, r, headers.length, 'These rows are capitalised assets, not costs. The app records them with an Asset or Fixed Asset category and no enterprise detail, so they post to a cooperative asset account and never to the profit and loss. They are shown on this sheet, separately from the expenditure table above, so a capital purchase can never be read as an expense. Control C12 on the Control Checks sheet proves this section agrees with the trial balance.');
        r += 2;
        const aRes = writeTable(ws, pack, r, 'Asset movements in the period', headers, pack.coopAssetDetail, {
            keys: ['date', 'remittanceId', 'family', 'transactionType', 'category', 'classification', 'member', 'bank', 'amount', 'effect', 'side'],
            numericCols: [8, 9]
        });
        r = aRes.nextRow;
        totalRow(ws, r, headers.length, 'TOTAL CAPITALISED ASSETS (net)', [
            [9, round2(pack.coopAssetDetail.reduce((s, x) => s + x.amount, 0))],
            [10, round2(pack.coopAssetDetail.reduce((s, x) => s + x.effect, 0))]
        ]);
        r += 2;
    }

    if (isIncome && pack.revenueEntMemo.length) {
        noteRow(ws, r, headers.length, 'Income above is recognised from the remittance category. Member-side revenue accounts are excluded from it to prevent the same income being counted twice; their movement is disclosed on the Member Accounts sheet.');
        r += 2;
    }
    if (rows.length) {
        noteRow(ws, r, headers.length, 'Each row is one posting, identified by its remittance id, with the family it belongs to so the related rows generated alongside it can be traced. The Side column shows which side of the entry this account took.');
    }
     fitColumns(ws);
     freezeAndFilter(ws, res.headerRow, headers.length);
     return ws;
}

function liabilityDetailSheet(wb, pack) {
     const ws = wb.addWorksheet('Liability Detail', { pageSetup: { orientation: 'landscape' } });
     const rows = pack.liabilityDetail;
     const headers = ['Date', 'Remittance ID', 'Family', 'Transaction Type', 'Category', 'Classification', 'Member', 'Bank', 'Amount', 'Effect', 'Side'];
     putBanner(ws, pack, 'Liability Detail', `Member liability postings where no enterprise leg exists (e.g. Unknown Payments)`);
     if (!rows.length) {
         noteRow(ws, 5, headers.length, 'No member liability postings without an enterprise leg were recorded for this period.');
         fitColumns(ws);
         freezeAndFilter(ws, 5, headers.length);
         return;
     }
     const res = writeTable(ws, pack, 5, 'Member liabilities recognised without a matching enterprise detail', headers, rows, {
         keys: ['date', 'remittanceId', 'family', 'transactionType', 'category', 'classification', 'member', 'bank', 'amount', 'effect', 'side'],
         numericCols: [8, 9]
     });
     let r = res.nextRow;
     totalRow(ws, r, headers.length, 'TOTAL MEMBER LIABILITY (net)', [
         [9, round2(rows.reduce((s, x) => s + x.amount, 0))],
         [10, round2(rows.reduce((s, x) => s + x.effect, 0))]
     ]);
     r += 2;
     noteRow(ws, r, headers.length, 'These are member liability postings (e.g. Unknown Payments) that have no enterprise detail leg. The offsetting liability account keeps the trial balance in equilibrium so they do not contribute to the control difference. Control C14 on the Control Checks sheet proves this section agrees with the trial balance.');
     fitColumns(ws);
     freezeAndFilter(ws, res.headerRow, headers.length);
}

function mappingSheet(wb, pack) {
    const ws = wb.addWorksheet('Account Mapping', { pageSetup: { orientation: 'landscape' } });
    const headers = ['Code', 'Account', 'Type', 'Normal Balance', 'Classification', 'Source in CoopLogNG', 'Derivation rule'];
    putBanner(ws, pack, 'Account Mapping', 'How CoopLogNG records become accounting accounts', headers.length);
    const res = writeTable(ws, pack, 5, 'Reporting account mapping', headers, pack.accountMapping, {
        keys: ['code', 'account', 'type', 'normal', 'classification', 'source', 'rule']
    });
    for (let r = res.headerRow + 1; r <= res.lastRow; r++) {
        ws.getCell(r, 6).alignment = { wrapText: true, vertical: 'top' };
        ws.getCell(r, 7).alignment = { wrapText: true, vertical: 'top' };
        ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
    }
    // Columns 2, 6 and 7 wrap their text, so their width is set for readability.
    pinWidth(ws, 2, 34);
    pinWidth(ws, 6, 52);
    pinWidth(ws, 7, 78);
    fitColumns(ws);
    freezeAndFilter(ws, res.headerRow, headers.length);
    let r = res.nextRow + 1;
    noteRow(ws, r, headers.length, 'Account codes are a reporting mapping layer generated for this pack from the cooperative\'s own enterprises, banks and transaction types. They are not a statutory chart of accounts and carry no regulatory meaning. A code is assigned deterministically by sorting the accounts of each class and numbering them in order, so the same data always produces the same codes.');
    r += 2;
    noteRow(ws, r, headers.length, 'Cooperative and member ledgers use opposite signs. remittance_detail.amount is positive when a member account is credited: deposits are positive, withdrawals and loan disbursements are negative. remittance.amount is positive when cash increases. A loan disbursement is therefore a negative detail on a debit-normal loan account, which presents as a positive receivable.');
    return ws;
}

function bankRecSheet(wb, pack) {
    const ws = wb.addWorksheet('Bank Reconciliation', { pageSetup: { orientation: 'landscape' } });
    const headers = ['Bank', 'Period', 'Status', 'Bank Credit', 'Bank Debit', 'System Credit', 'System Debit', 'Difference'];
    putBanner(ws, pack, 'Bank Reconciliation', 'Sealed reconciliation summaries recorded in the app', headers.length);
    if (!pack.bankReconciliation.length) {
        const empty = writeTable(ws, pack, 5, 'Reconciliation summaries', headers, [], {
            keys: ['bank', 'period', 'status', 'bankCredit', 'bankDebit', 'systemCredit', 'systemDebit', 'difference'],
            numericCols: [3, 4, 5, 6, 7]
        });
        noteRow(ws, empty.nextRow + 1, headers.length, 'No bank reconciliation summaries have been sealed for this cooperative. The Cash & Bank Book sheet is built directly from approved postings, so it does not depend on this sheet, but it cannot be corroborated against an independent bank statement until a reconciliation is sealed in the app.');
        fitColumns(ws);
        freezeAndFilter(ws, 6, headers.length);
        return ws;
    }
    const res = writeTable(ws, pack, 5, 'Reconciliation summaries', headers, pack.bankReconciliation, {
        keys: ['bank', 'period', 'status', 'bankCredit', 'bankDebit', 'systemCredit', 'systemDebit', 'difference'],
        numericCols: [3, 4, 5, 6, 7],
        rowStyle: (row) => (Math.abs(row.difference) >= 0.01 ? { fill: REVIEW, font: { size: 10, color: { argb: 'FF9C0006' } } } : null)
    });
    noteRow(ws, res.nextRow, headers.length, 'Difference is system credit less bank credit, plus bank debit less system debit. A zero difference means the sealed reconciliation agreed.');
    fitColumns(ws);
    freezeAndFilter(ws, res.headerRow, headers.length);
    return ws;
}

function auditSheet(wb, pack) {
    const ws = wb.addWorksheet('Transaction Audit Trail', { pageSetup: { orientation: 'landscape' } });
    const headers = ['Date', 'Remittance ID', 'Family', 'Status', 'Deleted', 'Transaction Type', 'Category', 'Classification', 'Member ID', 'Member', 'Reg No', 'Member Status', 'Bank', 'Header Amount', 'Detail Count', 'Detail Sum', 'Header less Detail', 'Auto-generated', 'Parent ID', 'Loan ID', 'Description', 'Cooperative ID', 'Created By', 'Created At', 'Modified By', 'Modified At'];
    putBanner(ws, pack, 'Transaction Audit Trail', `Every remittance dated ${pack.meta.periodLabel}, including rows excluded from the figures`, headers.length);
    const res = writeTable(ws, pack, 5, 'Transactions', headers, pack.auditTrail, {
        keys: ['date', 'remittanceId', 'family', 'status', 'deleted', 'transactionType', 'category', 'classification', 'memberId', 'member', 'regNo', 'memberStatus', 'bank', 'headerAmount', 'detailCount', 'detailSum', 'headerMinusDetail', 'autogen', 'parentId', 'loanId', 'description', 'cooperativeId', 'createdBy', 'createdAt', 'modifiedBy', 'modifiedAt'],
        numericCols: [13, 15, 16],
        rowStyle: (row) => {
            if (row.status !== 'Approved' || row.deleted === 'Yes') return { fill: INFO, font: { size: 10, color: { argb: 'FF3F3F76' } } };
            if (Math.abs(row.headerMinusDetail) >= 0.005) return { fill: REVIEW, font: { size: 10, color: { argb: 'FF9C0006' } } };
            return null;
        }
    });
    noteRow(ws, res.nextRow, headers.length, 'Rows tinted grey were not Approved or are deleted, so they are excluded from every figure in this pack and are listed here only for completeness. Rows tinted amber have a header amount that differs from the sum of their details. Family groups a transaction with the rows the app generated alongside it, so a dues or charge entry posted across several rows can be read as one balanced movement. CoopLogNG records who created and last modified each row but stores no approver identity, so approval is evidenced by the Status column alone; no approver name is shown because none is recorded.');
    // Column 21 is free-text narration that does not wrap, so it is given a
    // readable width rather than fitted to its longest sentence.
    pinWidth(ws, 21, 60);
    fitColumns(ws);
    freezeAndFilter(ws, res.headerRow, headers.length);
    return ws;
}

function exceptionSheet(wb, pack) {
    const ws = wb.addWorksheet('Data Quality Exceptions', { pageSetup: { orientation: 'landscape' } });
    const headers = ['Severity', 'Code', 'Finding', 'Remittance ID', 'Amount', 'Explanation'];
    putBanner(ws, pack, 'Data Quality Exceptions', 'Every transaction behind the control difference, and other findings', headers.length);

    if (!pack.exceptions.length) {
        const empty = writeTable(ws, pack, 5, 'Exceptions raised', headers, [], {
            keys: ['severity', 'code', 'title', 'remittanceId', 'amount', 'explanation'],
            numericCols: [4]
        });
        noteRow(ws, empty.nextRow + 1, headers.length, 'No data quality exceptions were raised for this cooperative and period. The trial balance control difference is nil.');
        // Columns 3 and 6 wrap their text, so their width is set for readability.
        pinWidth(ws, 3, 46);
        pinWidth(ws, 6, 88);
        fitColumns(ws);
        freezeAndFilter(ws, 6, headers.length);
        return ws;
    }

    const res = writeTable(ws, pack, 5, 'Exceptions raised', headers, pack.exceptions, {
        keys: ['severity', 'code', 'title', 'remittanceId', 'amount', 'explanation'],
        numericCols: [4],
        rowStyle: (row) => {
            const fill = row.severity === 'High' ? BAD : row.severity === 'Medium' ? REVIEW : INFO;
            const color = row.severity === 'High' ? 'FF9C0006' : row.severity === 'Medium' ? 'FF9C5700' : 'FF3F3F76';
            return { fill, font: { size: 10, color: { argb: color } } };
        }
    });
    for (let r = res.headerRow + 1; r <= res.lastRow; r++) {
        ws.getCell(r, 1).font = { bold: true, size: 10, color: { argb: ws.getCell(r, 1).value === 'High' ? 'FF9C0006' : ws.getCell(r, 1).value === 'Medium' ? 'FF9C5700' : 'FF3F3F76' } };
        ws.getCell(r, 2).font = { bold: true, size: 9 };
        ws.getCell(r, 3).alignment = { wrapText: true, vertical: 'top' };
        ws.getCell(r, 6).alignment = { wrapText: true, vertical: 'top' };
    }
    pinWidth(ws, 3, 46);
    pinWidth(ws, 6, 88);
    fitColumns(ws);
    freezeAndFilter(ws, res.headerRow, headers.length);

    let r = res.nextRow + 1;
    headingRow(ws, r, 'Summary by finding');
    r++;
    const grouped = new Map();
    for (const e of pack.exceptions) {
        if (!grouped.has(e.code)) grouped.set(e.code, { code: e.code, severity: e.severity, title: e.title, count: 0, amount: 0 });
        const g = grouped.get(e.code);
        g.count += 1;
        g.amount = round2(g.amount + e.amount);
    }
    const sHeaders = ['Severity', 'Code', 'Finding', 'Count', 'Net Amount'];
    const sRows = [...grouped.values()].sort((a, b) => a.severity.localeCompare(b.severity) || Math.abs(b.amount) - Math.abs(a.amount));
    const sRes = writeTable(ws, pack, r, 'Grouped findings', sHeaders, sRows, {
        keys: ['severity', 'code', 'title', 'count', 'amount'],
        numericCols: [4],
        rowStyle: (row) => {
            const fill = row.severity === 'High' ? BAD : row.severity === 'Medium' ? REVIEW : INFO;
            return { fill, font: { size: 10 } };
        }
    });
    // This table reuses the columns of the one above it, so its finding titles
    // have to wrap the same way or they clip against that table's width.
    for (let r2 = sRes.headerRow + 1; r2 <= sRes.lastRow; r2++) {
        ws.getCell(r2, 3).alignment = { wrapText: true, vertical: 'top' };
    }
    r += 2;
    noteRow(ws, r, 6, 'These findings are reported, not corrected. Nothing in this pack has been changed to make a statement balance, and no record has been written back to the database. Each finding carries the remittance identifier needed to locate and resolve the underlying transaction in the app.');
    return ws;
}

function fmt(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

// ---------------------------------------------------------------------------

export async function buildAccountingPackWorkbook(pack) {
    const ExcelJS = (typeof window !== 'undefined' && window.ExcelJS) || (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'cooplogng';
    wb.company = pack.meta.cooperativeName;
    wb.title = `Accounting Pack ${pack.meta.periodLabel}`;
    wb.created = new Date();

    coverSheet(wb, pack);
    controlSheet(wb, pack);
    trialBalanceSheet(wb, pack);
    ledgerSheet(wb, pack);
    cashSheet(wb, pack);
    memberSheet(wb, pack);
    loanSheet(wb, pack);
    loanMovementsSheet(wb, pack);
     incomeExpenseSheet(wb, pack, 'income');
     incomeExpenseSheet(wb, pack, 'expense');
     liabilityDetailSheet(wb, pack);
     mappingSheet(wb, pack);
    bankRecSheet(wb, pack);
    auditSheet(wb, pack);
    exceptionSheet(wb, pack);

    // Every column of every sheet, fitted once the whole pack exists. The
    // per-sheet calls above keep each sheet's own layout correct while it is
    // being written; this is what makes "all columns fit" true of the finished
    // workbook, including the sheets whose writer never asked for a fit and the
    // tables written after their sheet's own fit had already run.
    fitAllColumns(wb);

    return wb;
}

export async function exportAccountingPack(pack) {
    const wb = await buildAccountingPackWorkbook(pack);
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CoopLogNG_Accounting_Pack_${pack.meta.startDate}_to_${pack.meta.endDate}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    return { sheets: SHEETS.length, fileName: a.download };
}
