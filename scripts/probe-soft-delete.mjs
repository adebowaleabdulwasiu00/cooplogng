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

const nulls = await query(`SELECT rd.id, rd.remittance_id, rd.amount, rd.enterprise_id, r.amount hdr,
    r.description, r.parent_remittance_id
  FROM remittance_detail rd JOIN remittance r ON r.id = rd.remittance_id
  WHERE r.cooperative_id = ? AND rd.is_deleted IS NULL`, [COOP]);

console.log(`remittance_detail rows with is_deleted IS NULL: ${nulls.length}\n`);
for (const n of nulls) {
    console.log(`  ${n.remittance_id}`);
    console.log(`    detail amount ${n.amount}   header amount ${n.hdr}   enterprise ${n.enterprise_id}`);
    console.log(`    description: ${n.description}`);
    const family = await query(`SELECT rd.enterprise_id, e.account_name, rd.amount, rd.is_deleted
      FROM remittance_detail rd LEFT JOIN enterprise e ON e.id = rd.enterprise_id
      WHERE rd.remittance_id = ?`, [n.remittance_id]);
    const live = family.filter(x => x.is_deleted !== '1' && x.is_deleted !== 'true');
    console.log(`    family legs (${family.length}, live ${live.length}):`);
    for (const f of live) console.log(`      ${(f.account_name || '(unknown enterprise)').padEnd(22)} ${String(f.amount).padStart(8)}${f.is_deleted === null ? '   <-- is_deleted NULL' : ''}`);
    console.log(`    live family total: ${r2(live.reduce((s, f) => s + Number(f.amount), 0))}`);
    if (n.parent_remittance_id) {
        const sib = await query(`SELECT rd.enterprise_id, e.account_name, rd.amount, rd.is_deleted
          FROM remittance_detail rd LEFT JOIN enterprise e ON e.id = rd.enterprise_id
          WHERE rd.remittance_id = ?`, [n.parent_remittance_id]);
        const sibLive = sib.filter(x => x.is_deleted !== '1' && x.is_deleted !== 'true');
        console.log(`    counter-legs on parent ${n.parent_remittance_id} (live ${sibLive.length}):`);
        for (const f of sibLive) console.log(`      ${(f.account_name || '(unknown)').padEnd(22)} ${String(f.amount).padStart(8)}`);
        console.log(`    counter-leg total: ${r2(sibLive.reduce((s, f) => s + Number(f.amount), 0))}`);
    }
    console.log();
}
console.log(`Total of the NULL-flagged details: ${r2(nulls.reduce((s, n) => s + Number(n.amount), 0))}`);
