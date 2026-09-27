// Independent check that every column of every sheet in the generated pack is
// wide enough for the text Excel will actually show in it.
//
// It deliberately does not reuse the fitting code. It re-derives the demand from
// the written workbook using only the public ExcelJS merge API, so a bug in the
// fit cannot hide itself here. Merged display text (the banner and the note
// paragraphs) is excluded, because it belongs to no single column.
import initSqlJs from 'sql.js';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { buildAccountingPack } from '../src/services/reports/accountingPack.js';
import { buildAccountingPackWorkbook, pinnedColumns } from '../src/services/reports/accountingPackExcel.js';

const buf = fs.readFileSync('sampledata.db');
const SQL = await initSqlJs({ locateFile: f => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(buf);
const query = async (sql, bind = []) => {
    const stmt = db.prepare(sql);
    try {
        stmt.bind(bind);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
    } finally { stmt.free(); }
};
const coop = (await query('SELECT id, full_name FROM cooperatives'))[0];
const pack = await buildAccountingPack({
    cooperativeId: coop.id, startDate: '2000-01-01', endDate: '2099-12-31',
    cooperativeName: coop.full_name, generatedBy: 'width-harness', query
});
const wb = await buildAccountingPackWorkbook(pack);

// The string Excel shows, with numbers run through their own number format.
const shown = (cell) => {
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
    if (typeof v === 'object') return String(v.text ?? (v.richText ? v.richText.map(t => t.text).join('') : ''));
    return String(v);
};

// True when this cell is the anchor of a merge that spans more than one column.
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

let clipped = 0, atCeiling = 0, fitted = 0, overGuard = 0, pinned = 0;
const GUARD = 100;
for (const ws of wb.worksheets) {
    const cols = ws.columnCount;
    const isPinned = new Set(pinnedColumns(ws));
    const demand = new Array(cols + 1).fill(0);
    const sample = new Array(cols + 1).fill('');
    for (let r = 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        if (!row) continue;
        for (let c = 1; c <= cols; c++) {
            const cell = row.getCell(c);
            if (!cell || !cell.value) continue;
            if (cell.isMerged && cell.master !== cell) continue;   // slave, counted at master
            if (spansColumns(row, c)) continue;                    // banner / note display text
            const t = shown(cell);
            if (!t) continue;
            const chars = cell.alignment && cell.alignment.wrapText
                ? t.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0)
                : t.length;
            const need = chars + (cell.font && cell.font.bold ? 1 : 0) + 2;
            if (need > GUARD) { overGuard++; continue; }           // runaway-guard territory
            if (need > demand[c]) { demand[c] = need; sample[c] = t.slice(0, 30); }
        }
    }
    const bad = [];
    let pinnedHere = [];
    for (let c = 1; c <= cols; c++) {
        const w = ws.getColumn(c).width;
        if (w == null) { bad.push(`      col ${c} has NO width set`); clipped++; continue; }
        if (isPinned.has(c)) { pinned++; pinnedHere.push(`${c}=${w}`); continue; }
        if (w >= demand[c]) {
            if (w === GUARD && demand[c] < GUARD) atCeiling++;
            else fitted++;
            continue;
        }
        clipped++;
        bad.push(`      col ${String(c).padStart(2)} width=${String(w).padStart(4)} needs ${String(demand[c]).padStart(4)}  "${sample[c]}"`);
    }
    console.log(`  ${bad.length ? 'FAIL' : 'ok  '} ${ws.name.padEnd(26)} fitted=${cols - pinnedHere.length}` +
        (pinnedHere.length ? `  readability widths: ${pinnedHere.join(' ')}` : ''));
    bad.forEach(b => console.log(b));
}
console.log(`\ncolumns fitted exactly to their content: ${fitted}`);
console.log(`columns on a readability width (wrapped or narration): ${pinned}`);
console.log(`columns at the ${GUARD} runaway guard: ${atCeiling}`);
console.log(`cells beyond the guard (pathological text, ignored by design): ${overGuard}`);
console.log(`columns still clipped: ${clipped}`);
process.exit(clipped ? 1 : 0);
