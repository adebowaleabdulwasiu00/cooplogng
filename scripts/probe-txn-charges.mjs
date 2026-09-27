import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const SQL = await initSqlJs({ locateFile: f => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(fs.readFileSync('sampledata.db'));
const query = async (sql, bind = []) => {
    const s = db.prepare(sql);
    try { s.bind(bind); const r = []; while (s.step()) r.push(s.getAsObject()); return r; } finally { s.free(); }
};
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const COOP = 'CG0nAXNIzK';
const TXN = 'CG0nA-13AdCod4W-6T0Tfl_B-fKHy';

const all = await query(`
  SELECT r.status, r.is_deleted rd_del, r.remittance_date, rd.amount, rd.is_deleted dd, r.id
  FROM remittance_detail rd JOIN remittance r ON r.id = rd.remittance_id
  WHERE r.cooperative_id = ? AND rd.enterprise_id = ?`, [COOP, TXN]);

const group = (rows, label) => {
    const n = rows.length, sum = r2(rows.reduce((s, x) => s + Number(x.amount || 0), 0));
    console.log(`  ${label.padEnd(46)} n=${String(n).padStart(4)} sum=${sum}`);
    return { n, sum };
};
console.log(`Txn Charges detail rows: ${all.length}`);
group(all, 'all rows');
group(all.filter(x => x.dd !== '1' && x.dd !== 'true'), 'detail not deleted');
group(all.filter(x => x.dd !== '1' && x.dd !== 'true' && x.rd_del === '0'), 'detail live + remittance not deleted');
group(all.filter(x => x.dd !== '1' && x.dd !== 'true' && x.rd_del === '0' && x.status === 'Approved'), 'detail live + remittance live + Approved');

const inRange = all.filter(x => x.dd !== '1' && x.dd !== 'true' && x.rd_del === '0' && x.status === 'Approved'
    && String(x.remittance_date).slice(0, 10) >= '2026-05-29' && String(x.remittance_date).slice(0, 10) <= '2026-09-21');
group(inRange, 'live + Approved + inside 2026-05-29..2026-09-21');

console.log('\nRemittances with more than one Txn Charges detail:');
const byRem = {};
for (const x of inRange) (byRem[x.id] = byRem[x.id] || []).push(Number(x.amount || 0));
for (const [id, amts] of Object.entries(byRem)) {
    if (amts.length > 1) console.log(`  ${id}  amounts [${amts.join(', ')}] sum ${r2(amts.reduce((a, b) => a + b, 0))}`);
}
const dupes = Object.entries(byRem).filter(([, a]) => a.length > 1);
console.log(`  ${dupes.length} remittances carry more than one Txn Charges detail; extras ${dupes.reduce((s, [, a]) => s + a.length - 1, 0)}`);
console.log(`  net of the extras: ${r2(dupes.reduce((s, [, a]) => s + a.slice(1).reduce((x, y) => x + y, 0), 0))}`);

console.log('\nReplicating the older probe query verbatim, to show why it disagreed:');
const old = await query(`SELECT rd.id, rd.remittance_id, rd.amount, r.amount hdr, r.category, r.transaction_type, r.bank_name,
  r.status, r.loan_id, r.parent_remittance_id
  FROM remittance_detail rd JOIN remittance r ON r.id=rd.remittance_id
  WHERE rd.enterprise_id=? AND rd.is_deleted=0 AND r.is_deleted=0 AND r.status='Approved'`, [TXN]);
console.log(`  n=${old.length} sum=${r2(old.reduce((s, d) => s + Number(d.amount), 0))}`);
const oldRem = [...new Set(old.map(d => d.remittance_id))];
console.log(`  distinct remittances: ${oldRem.length}`);
const missingHere = oldRem.filter(id => !byRem[id]);
console.log(`  remittances in the old result but not in the current one: ${missingHere.length}`);
for (const id of missingHere.slice(0, 5)) {
    const d = old.filter(x => x.remittance_id === id);
    console.log(`    ${id} amounts [${d.map(x => x.amount).join(', ')}]`);
}
const inNewNotOld = Object.keys(byRem).filter(id => !oldRem.includes(id));
console.log(`  remittances in the current result but not the old one: ${inNewNotOld.length}`);
for (const id of inNewNotOld.slice(0, 5)) console.log(`    ${id} amounts [${byRem[id].join(', ')}]`);

