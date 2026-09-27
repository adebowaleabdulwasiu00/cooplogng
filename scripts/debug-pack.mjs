import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const buf = fs.readFileSync('sampledata.db');
const SQL = await initSqlJs({ locateFile: f => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(buf);
const q = (sql, bind = []) => { const s = db.prepare(sql); s.bind(bind); const o = []; while (s.step()) o.push(s.getAsObject()); s.free(); return o; };

const ENT = 'CG0nA-13AdCod4W-6T0Tfl_B-fKHy';   // Txn Charges
const LOAN = 'CG0nA-1LCu-k-5qygivu9OsQxTQUp';  // Ordinary Loan

console.log('A. Txn Charges details (approved, non-deleted)');
const txn = q(`SELECT rd.id, rd.remittance_id, rd.amount, rd.enterprise_id, r.category, r.bank_name, r.status, r.is_deleted rd_del, r.autogen, r.parent_remittance_id, r.loan_id
  FROM remittance_detail rd JOIN remittance r ON r.id=rd.remittance_id
  WHERE rd.enterprise_id=? AND rd.is_deleted=0 AND r.is_deleted=0 AND r.status='Approved'`, [ENT]);
console.log('  count:', txn.length, ' sum:', txn.reduce((s,x)=>s+Number(x.amount),0));
const byCat = {};
for (const d of txn) { const k = `${d.category}|${d.bank_name}|del=${d.rd_del}`; byCat[k] = (byCat[k]||0)+Number(d.amount); }
console.log('  by category/bank:', JSON.stringify(byCat, null, 1));
console.log('  first 6:', JSON.stringify(txn.slice(0,6), null, 1));

console.log('\nB. Income-category rows: raw vs what the pack would pick');
const inc = q(`SELECT id, amount, category, transaction_type, bank_name, member_id, is_deleted, status FROM remittance
  WHERE category IN ('Revenue','Operating Income','Loan Income','Other Income') AND is_deleted=0 AND status='Approved' ORDER BY CAST(amount AS REAL)`);
console.log('  count:', inc.length, ' signed sum:', inc.reduce((s,x)=>s+Number(x.amount),0), ' abs sum:', inc.reduce((s,x)=>s+Math.abs(Number(x.amount)),0));
const small = inc.filter(x => Math.abs(Number(x.amount)) < 1000);
console.log('  rows with |amount| < 1000:', JSON.stringify(small, null, 1));
const neg = inc.filter(x => Number(x.amount) < 0);
console.log('  negative income rows:', JSON.stringify(neg, null, 1));

console.log('\nC. Non-bank rows with <=1 detail and no classification, grouped');
const rows = q(`SELECT r.id, r.amount, r.category, r.transaction_type, r.bank_name,
  (SELECT count(*) FROM remittance_detail rd WHERE rd.remittance_id=r.id AND rd.is_deleted=0) dn
  FROM remittance r WHERE r.is_deleted=0 AND r.status='Approved'
  AND (r.bank_name IS NULL OR r.bank_name='' OR r.bank_name='Internal Transfer')
  AND r.category NOT IN ('Revenue','Operating Income','Loan Income','Other Income','Expense','Expenses','Operating Expense','Administrative Expense','Finance Expense','Welfare Expense','Other Operating Expense','Other Expenses','Asset','Fixed Asset')`);
const groups = {};
for (const r of rows) {
  const k = `${r.category}|${r.transaction_type}|det=${r.dn}`;
  if (!groups[k]) groups[k] = { n: 0, amt: 0, eg: r.id };
  groups[k].n++; groups[k].amt += Number(r.amount);
}
console.log('  total rows:', rows.length);
for (const [k,v] of Object.entries(groups).sort((a,b)=>b[1].n-a[1].n)) console.log(`   n=${String(v.n).padStart(5)} amt=${v.amt.toFixed(2).padStart(18)}  ${k}  e.g. ${v.eg}`);

console.log('\nD. Rows with |amount| < 0.005');
const zero = q(`SELECT id, amount, category, transaction_type, bank_name, member_id,
  (SELECT count(*) FROM remittance_detail rd WHERE rd.remittance_id=remittance.id AND rd.is_deleted=0) dn
  FROM remittance WHERE is_deleted=0 AND status='Approved' AND ABS(CAST(amount AS REAL)) < 0.005`);
console.log('  count:', zero.length, JSON.stringify(zero.slice(0, 10), null, 1));

console.log('\nE. Loan attribution: does the disbursement remittance carry loan_id?');
const loanRows = q(`SELECT r.id, r.amount, r.category, r.transaction_type, r.loan_id, r.parent_remittance_id, r.autogen, r.member_id, r.bank_name
  FROM remittance r JOIN loans L ON L.remittance_id = r.id WHERE L.is_deleted=0`);
console.log('  loan disbursement remittances:', JSON.stringify(loanRows, null, 1));
const withLoanId = q(`SELECT count(*) n FROM remittance WHERE loan_id IS NOT NULL AND loan_id != '' AND is_deleted=0`);
console.log('  remittances with a loan_id:', JSON.stringify(withLoanId));
const loanLinked = q(`SELECT r.id, r.amount, r.transaction_type, r.loan_id, r.parent_remittance_id FROM remittance r WHERE r.loan_id IN (SELECT id FROM loans WHERE is_deleted=0) AND r.is_deleted=0`);
console.log('  remittances whose loan_id matches a loan record:', JSON.stringify(loanLinked, null, 1));

console.log('\nF. Loan-enterprise details NOT attributable to a loan record');
const loanDetail = q(`SELECT rd.id, rd.remittance_id, rd.amount, r.loan_id, r.id inLoan
  FROM remittance_detail rd JOIN remittance r ON r.id=rd.remittance_id
  WHERE rd.enterprise_id=? AND rd.is_deleted=0 AND r.is_deleted=0 AND r.status='Approved'`, [LOAN]);
const loanIds = new Set(q(`SELECT id FROM loans WHERE is_deleted=0`).map(x=>x.id));
const disbIds = new Set(loanRows.map(x=>x.id));
const unattributed = loanDetail.filter(d => !loanIds.has(String(d.loan_id)) && !disbIds.has(String(d.remittance_id)));
console.log('  total loan details:', loanDetail.length, ' unattributed:', unattributed.length, ' sum unattributed:', unattributed.reduce((s,x)=>s+Number(x.amount),0));
console.log('  sample unattributed:', JSON.stringify(unattributed.slice(0,5), null, 1));
