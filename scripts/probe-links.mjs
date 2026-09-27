// Focused probe: how are loan-enterprise details and Txn Charges details
// actually linked in sampledata.db?
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const buf = fs.readFileSync('sampledata.db');
const SQL = await initSqlJs({ locateFile: f => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(buf);
const q = (sql, bind = []) => { const s = db.prepare(sql); s.bind(bind); const o = []; while (s.step()) o.push(s.getAsObject()); s.free(); return o; };

const ENT_TXN = 'CG0nA-13AdCod4W-6T0Tfl_B-fKHy';
const ENT_LOAN = 'CG0nA-1LCu-k-5qygivu9OsQxTQUp';

console.log('=== 1. loans table, every column that identifies a remittance ===');
const loans = q(`SELECT id, member_id, enterprise_id, principal_amount, status, remittance_id, is_deleted FROM loans ORDER BY id`);
console.log('  count:', loans.length);
for (const l of loans) console.log('   ', JSON.stringify(l));

console.log('\n=== 2. What do the 588 non-empty remittance.loan_id values point at? ===');
const distinct = q(`SELECT loan_id, count(*) n FROM remittance WHERE loan_id IS NOT NULL AND loan_id != '' GROUP BY loan_id ORDER BY n DESC LIMIT 12`);
console.log('  distinct loan_id values (top 12):');
for (const d of distinct) {
  const isLoan = q(`SELECT 1 x FROM loans WHERE id=?`, [d.loan_id]).length;
  const isRem = q(`SELECT 1 x FROM remittance WHERE id=?`, [d.loan_id]).length;
  const isEnt = q(`SELECT 1 x FROM enterprise WHERE id=?`, [d.loan_id]).length;
  console.log(`   n=${String(d.n).padStart(4)} ${d.loan_id}  -> loan:${isLoan} remittance:${isRem} enterprise:${isEnt}`);
}
console.log('  total remittances with loan_id:', q(`SELECT count(*) n FROM remittance WHERE loan_id IS NOT NULL AND loan_id != ''`)[0].n);
console.log('  of those, category breakdown:');
for (const c of q(`SELECT category, transaction_type, count(*) n FROM remittance WHERE loan_id IS NOT NULL AND loan_id != '' GROUP BY category, transaction_type`))
  console.log(`   n=${String(c.n).padStart(4)}  ${c.category} | ${c.transaction_type}`);

console.log('\n=== 3. Loan-enterprise detail remittances: full link columns ===');
const loanRem = q(`SELECT r.id, r.amount, r.category, r.transaction_type, r.bank_name, r.member_id, r.status,
  r.loan_id, r.parent_remittance_id, r.autogen, COUNT(rd.id) dn
  FROM remittance r JOIN remittance_detail rd ON rd.remittance_id=r.id AND rd.is_deleted=0
  WHERE rd.enterprise_id=? AND r.is_deleted=0 AND r.status='Approved'
  GROUP BY r.id ORDER BY r.amount`, [ENT_LOAN]);
const disbIds = new Set(loans.map(l => String(l.remittance_id)).filter(Boolean));
const remIds = new Set(q(`SELECT id FROM remittance`).map(x => x.id));
const linkKind = {};
for (const r of loanRem) {
  let kind = 'none';
  if (disbIds.has(r.id)) kind = 'LOANS.REMITTANCE_ID';
  else if (r.loan_id && disbIds.has(r.loan_id)) kind = 'remittance.loan_id -> loans.remittance_id';
  else if (r.loan_id && remIds.has(r.loan_id)) kind = 'remittance.loan_id -> remittance';
  else if (r.parent_remittance_id && disbIds.has(r.parent_remittance_id)) kind = 'parent_remittance_id -> loans.remittance_id';
  else if (r.parent_remittance_id) kind = 'parent_remittance_id (other)';
  linkKind[kind] = (linkKind[kind] || 0) + 1;
  if (loanRem.length <= 40) console.log(`   ${kind.padEnd(38)} det=${r.dn} amt=${String(r.amount).padStart(12)} ${r.category}|${r.transaction_type} bank=${r.bank_name} id=${r.id} loan_id=${r.loan_id} parent=${r.parent_remittance_id}`);
}
console.log('  linkage summary:', JSON.stringify(linkKind, null, 1));

console.log('\n=== 4. Txn Charges enterprise: which account_type, and every detail remittance ===');
console.log('  enterprise row:', JSON.stringify(q(`SELECT * FROM enterprise WHERE id=?`, [ENT_TXN])));
const txnDet = q(`SELECT rd.id, rd.remittance_id, rd.amount, r.amount hdr, r.category, r.transaction_type, r.bank_name,
  r.status, r.loan_id, r.parent_remittance_id
  FROM remittance_detail rd JOIN remittance r ON r.id=rd.remittance_id
  WHERE rd.enterprise_id=? AND rd.is_deleted=0 AND r.is_deleted=0 AND r.status='Approved'`, [ENT_TXN]);
console.log('  detail count:', txnDet.length, ' detail sum:', txnDet.reduce((s, d) => s + Number(d.amount), 0));
const txnGroup = {};
for (const d of txnDet) {
  const k = `${d.category}|${d.transaction_type}|bank=${d.bank_name}`;
  txnGroup[k] = txnGroup[k] || { n: 0, sum: 0, eg: d.remittance_id };
  txnGroup[k].n++; txnGroup[k].sum += Number(d.amount);
}
console.log('  by category/type/bank:');
for (const [k, v] of Object.entries(txnGroup).sort((a, b) => Math.abs(b[1].sum) - Math.abs(a[1].sum)))
  console.log(`   n=${String(v.n).padStart(5)} sum=${v.sum.toFixed(2).padStart(12)}  ${k}  e.g. ${v.eg}`);
console.log('  first 4 detail rows:', JSON.stringify(txnDet.slice(0, 4), null, 1));

console.log('\n=== 5. What enterprise does each "-INCOME" remittance detail hit? ===');
for (const id of ['CG0nA-00000000001295-INCOME', 'CG0nA-20260922105559-INCOME', 'CG0nA-20260915162534-RVQU7U-1-RV02']) {
  const r = q(`SELECT id, amount, category, transaction_type, bank_name, member_id, parent_remittance_id FROM remittance WHERE id=?`, [id])[0];
  const ds = q(`SELECT enterprise_id, amount FROM remittance_detail WHERE remittance_id=? AND is_deleted=0`, [id]);
  console.log(' ', JSON.stringify(r), '->', JSON.stringify(ds));
}
