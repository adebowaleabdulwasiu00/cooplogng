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
const PSEUDO = '0000000000';

console.log('=== MISSING_MEMBER_RECORD: are these real gaps or a false positive? ===');
const missing = await query(`SELECT r.id, r.member_id, r.amount, r.category, r.transaction_type, r.status, r.autogen
  FROM remittance r WHERE r.cooperative_id = ?
  AND r.member_id IS NOT NULL AND TRIM(r.member_id) <> ''
  AND r.member_id <> ?
  AND r.is_deleted = '0'
  AND r.member_id NOT IN (SELECT id FROM members WHERE cooperative_id = ? AND is_deleted = '0')`, [COOP, PSEUDO, COOP]);
console.log(`  approved, non-deleted rows whose member is absent: ${missing.length}`);
const byCat = {};
for (const m of missing) {
    const k = `${m.category}|${m.transaction_type}|autogen=${m.autogen}`;
    byCat[k] = byCat[k] || { n: 0, sum: 0 };
    byCat[k].n++; byCat[k].sum += Number(m.amount || 0);
}
for (const [k, v] of Object.entries(byCat)) console.log(`   ${k.padEnd(56)} n=${String(v.n).padStart(3)} sum=${r2(v.sum)}`);
// Do the members exist at all, just deleted or in another cooperative?
const sample = missing.slice(0, 3);
for (const m of sample) {
    const anywhere = await query(`SELECT id, cooperative_id, is_deleted, status FROM members WHERE id = ?`, [m.member_id]);
    console.log(`  ${m.id} -> member ${m.member_id}: ${anywhere.length ? JSON.stringify(anywhere[0]) : 'NOT PRESENT IN members TABLE AT ALL'}`);
}

console.log('\n=== NO_POSTINGS: do these carry value that the pack is dropping? ===');
const zero = await query(`SELECT r.id, r.amount, r.category, r.transaction_type, r.bank_name, r.autogen, r.status
  FROM remittance r WHERE r.cooperative_id = ? AND r.is_deleted = '0' AND r.status = 'Approved'
  AND (r.amount IS NULL OR TRIM(r.amount) = '' OR CAST(r.amount AS REAL) = 0)`, [COOP]);
console.log(`  approved, non-deleted remittances whose header amount is zero or blank: ${zero.length}`);
const zeroByCat = {};
for (const z of zero) {
    const k = `${z.category}|${z.transaction_type}|autogen=${z.autogen}`;
    zeroByCat[k] = (zeroByCat[k] || 0) + 1;
}
for (const [k, n] of Object.entries(zeroByCat)) console.log(`   ${k.padEnd(56)} n=${n}`);
// For those, do the DETAILS carry value that would be lost?
const ids = zero.map(z => z.id);
if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const dets = await query(`SELECT remittance_id, COUNT(*) n, SUM(CAST(amount AS REAL)) sum
      FROM remittance_detail WHERE is_deleted = '0' AND remittance_id IN (${ph}) GROUP BY remittance_id`, ids);
    const withValue = dets.filter(d => Math.abs(Number(d.sum) || 0) > 0.005);
    console.log(`  of those, ${dets.length} have details, and ${withValue.length} have a non-zero detail sum:`);
    for (const d of withValue.slice(0, 8)) console.log(`    ${d.remittance_id}  details=${d.n} sum=${r2(d.sum)}`);
    const detailTotal = r2(dets.reduce((s, d) => s + (Number(d.sum) || 0), 0));
    console.log(`  total detail value attached to zero-amount headers: ${detailTotal}`);
    console.log(`  a detail posted without a bank leg would still move a member account,`);
    console.log(`  so a zero header with a non-zero detail is NOT value-preserving.`);
}
