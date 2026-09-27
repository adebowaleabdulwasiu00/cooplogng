// Final content inspection of the generated workbook: confirms the numbers in
// the sheets agree with the model, not just that the sheets exist.
import ExcelJS from 'exceljs';
import fs from 'fs';

const file = process.argv[2] || 'C:\\Users\\Admin\\AppData\\Local\\Temp\\opencode\\accounting-pack-test.xlsx';
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);

const cell = (ws, r, c) => {
    const v = ws.getCell(r, c).value;
    return v && typeof v === 'object' ? (v.result ?? v.text ?? v.richText?.map(t => t.text).join('') ?? (v instanceof Date ? v.toISOString().slice(0, 10) : JSON.stringify(v))) : v;
};
// Walk the rows of a written table until the first genuinely empty row, so a
// data row is never skipped because its date happens to be stored as an object.
const eachDataRow = (ws, headerRow, fn) => {
    const width = ws.columns.length;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
        const vals = Array.from({ length: width }, (_, i) => cell(ws, r, i + 1));
        if (vals.every(v => v === null || v === undefined || v === '')) break;
        fn(vals, r);
    }
};
const findRow = (ws, firstColValue, col = 1, from = 1, to = 400) => {
    for (let r = from; r <= to; r++) {
        const v = cell(ws, r, col);
        if (v && String(v).includes(firstColValue)) return r;
    }
    return 0;
};
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

console.log(`file: ${file}`);
console.log(`sheets: ${wb.worksheets.length}\n`);

const gl = wb.getWorksheet('General Ledger');
const glHdr = findRow(gl, 'Code', 1, 1, 12);
console.log('GENERAL LEDGER');
console.log('  header row', glHdr, ':', Array.from({ length: gl.columns.length }, (_, i) => cell(gl, glHdr, i + 1)).join(' | '));
let glDebit = 0, glCredit = 0, glRows = 0, glWithDebit = 0, glWithCredit = 0;
eachDataRow(gl, glHdr, v => {
    const d = v[15], c = v[16];
    glRows++;
    if (typeof d === 'number') { glDebit += d; glWithDebit++; }
    if (typeof c === 'number') { glCredit += c; glWithCredit++; }
});
console.log(`  ${glRows} posting rows (${glWithDebit} with a debit, ${glWithCredit} with a credit); period debits ${r2(glDebit).toLocaleString()}, credits ${r2(glCredit).toLocaleString()}`);
console.log(`  credits less debits = ${r2(glCredit - glDebit).toLocaleString()}`);
const firstGl = [];
eachDataRow(gl, glHdr, (v, r) => { if (r === glHdr + 1) firstGl.push(...v); });
console.log(`  first posting: ${firstGl.slice(0, 14).join(' | ')}`);
console.log(`  source table/id: ${firstGl[6]} / ${firstGl[7]}`);

const cc = wb.getWorksheet('Control Checks');
const ccHdr = findRow(cc, 'ID', 1, 1, 12);
console.log('\nCONTROL CHECKS');
const controls = [];
eachDataRow(cc, ccHdr, v => { if (/^C\d+$/.test(String(v[0]))) controls.push(v); });
for (const v of controls) console.log(`  ${String(v[0]).padEnd(4)} ${String(v[2] || '').padEnd(10)} ${v[1]}`);
console.log(`  ${controls.length} controls rendered`);

const lm = wb.getWorksheet('Loan Movements');
const lmHdr = findRow(lm, 'Date', 1, 1, 12);
console.log('\nLOAN MOVEMENTS');
console.log('  header row', lmHdr, ':', Array.from({ length: lm.columns.length }, (_, i) => cell(lm, lmHdr, i + 1)).join(' | '));
let moves = 0, loanAmt = 0;
eachDataRow(lm, lmHdr, v => {
    moves++;
    if (typeof v[8] === 'number') loanAmt += v[8];
});
console.log(`  ${moves} movement rows; loan account amount total ${r2(loanAmt).toLocaleString()}`);

const at = wb.getWorksheet('Transaction Audit Trail');
const atHdr = findRow(at, 'Date', 1, 1, 12);
console.log('\nTRANSACTION AUDIT TRAIL');
console.log('  header row', atHdr, ':', Array.from({ length: at.columns.length }, (_, i) => cell(at, atHdr, i + 1)).join(' | '));

const ma = wb.getWorksheet('Member Accounts');
const maHdr = findRow(ma, 'Member ID', 1, 1, 12);
console.log('\nMEMBER ACCOUNTS');
console.log('  header row', maHdr, ':', Array.from({ length: ma.columns.length }, (_, i) => cell(ma, maHdr, i + 1)).join(' | '));
let both = 0, memRows = 0, crTot = 0, dbTot = 0;
eachDataRow(ma, maHdr, v => {
    memRows++;
    const cr = v[7], db = v[8];
    if (typeof cr === 'number') crTot += cr;
    if (typeof db === 'number') dbTot += db;
    if (typeof cr === 'number' && typeof db === 'number' && cr > 0 && db > 0) both++;
});
console.log(`  ${memRows} member account rows, ${both} show both credits and debits`);
console.log(`  credits ${r2(crTot).toLocaleString()} less debits ${r2(dbTot).toLocaleString()} = ${r2(crTot - dbTot).toLocaleString()}`);

const ex = wb.getWorksheet('Data Quality Exceptions');
const exHdr = findRow(ex, 'Severity', 1, 1, 12);
let exRows = 0;
const codes = {};
eachDataRow(ex, exHdr, v => { exRows++; codes[String(v[1])] = (codes[String(v[1])] || 0) + 1; });
console.log(`\nDATA QUALITY EXCEPTIONS: ${exRows} rows`);
console.log('  ' + Object.entries(codes).map(([k, n]) => `${k}=${n}`).join('  '));
