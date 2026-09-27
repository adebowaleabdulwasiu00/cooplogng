// Confirms the fitted widths survive serialisation: reads the written .xlsx back
// off disk and re-checks every column against the text it has to display.
import ExcelJS from 'exceljs';
import { pinnedColumns } from '../src/services/reports/accountingPackExcel.js';

const file = process.argv[2] || 'C:/Users/AppData/Local/Temp/opencode/accounting-pack-test.xlsx';
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);

const shown = cell => {
    const v = cell.value;
    if (v == null || v === '') return '';
    const fmt = cell.numFmt || '';
    if (typeof v === 'number') {
        const dp = /\.(0+)/.exec(fmt);
        const p = dp ? dp[1].length : 0;
        const body = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: p, maximumFractionDigits: p });
        return v < 0 ? `-${body}` : body;
    }
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') return String(v.text ?? (v.richText ? v.richText.map(t => t.text).join('') : (v.result ?? '')));
    return String(v);
};
const spansColumns = (row, c) => {
    const cell = row.getCell(c);
    if (!cell.isMerged || cell.master !== cell) return false;
    for (let k = c + 1; k < c + 40; k++) {
        const other = row.getCell(k);
        if (other.isMergedTo(cell)) return true;
        if (!other.isMerged) break;
    }
    return false;
};

let fail = 0, checked = 0, unset = 0;
for (const ws of wb.worksheets) {
    const isPinned = new Set(pinnedColumns(ws));
    const cols = ws.columnCount;
    const demand = new Array(cols + 1).fill(0);
    for (let r = 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        if (!row) continue;
        for (let c = 1; c <= cols; c++) {
            const cell = row.getCell(c);
            if (!cell || !cell.value) continue;
            if (cell.isMerged && cell.master !== cell) continue;
            if (spansColumns(row, c)) continue;
            const t = shown(cell);
            if (!t) continue;
            const chars = cell.alignment && cell.alignment.wrapText
                ? t.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0)
                : t.length;
            const need = chars + (cell.font && cell.font.bold ? 1 : 0) + 2;
            if (need > 100) continue;
            if (need > demand[c]) demand[c] = need;
        }
    }
    const bad = [];
    for (let c = 1; c <= cols; c++) {
        const w = ws.getColumn(c).width;
        checked++;
        if (w == null) { unset++; bad.push(`col ${c} unset`); continue; }
        if (isPinned.has(c)) continue;
        if (w < demand[c]) bad.push(`col ${c} width=${w} needs ${demand[c]}`);
    }
    if (bad.length) { fail += bad.length; console.log(`  FAIL ${ws.name}: ${bad.join('; ')}`); }
}
console.log(`\nread back from ${file}`);
console.log(`columns checked: ${checked}   clipped: ${fail}   unset: ${unset}`);
console.log(fail || unset ? 'ROUND-TRIP WIDTH CHECK: FAIL' : 'ROUND-TRIP WIDTH CHECK: PASS');
process.exit(fail || unset ? 1 : 0);
