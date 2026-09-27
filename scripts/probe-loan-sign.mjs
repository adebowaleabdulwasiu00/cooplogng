// Precise loan + due enterprise aggregates, so the sign convention is not guessed.
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const buf = fs.readFileSync('sampledata.db');
const SQL = await initSqlJs({ locateFile: f => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(buf);
const q = (sql, bind = []) => { const s = db.prepare(sql); s.bind(bind); const o = []; while (s.step()) o.push(s.getAsObject()); s.free(); return o; };

console.log('=== enterprises: flags that drive the account mapping ===');
for (const e of q(`SELECT id, account_name, account_type, revenue, compulsory_due, is_penalty, is_deleted FROM enterprise ORDER BY account_type, account_name`))
  console.log('  ', e.account_name.padEnd(22), `type=${(e.account_type||'').padEnd(10)} rev=${e.revenue} due=${e.compulsory_due} pen=${e.is_penalty} del=${e.is_deleted}`, e.id);

const loanEnt = q(`SELECT id, account_name FROM enterprise WHERE account_type='Loan' AND is_deleted=0`);
for (const le of loanEnt) {
  console.log(`\n=== ${le.account_name} (${le.id}) detail aggregate ===`);
  const agg = q(`SELECT COUNT(*) n, SUM(CAST(rd.amount AS REAL)) sum_amt,
      SUM(CASE WHEN CAST(rd.amount AS REAL) < 0 THEN 1 ELSE 0 END) neg,
      SUM(CASE WHEN CAST(rd.amount AS REAL) > 0 THEN 1 ELSE 0 END) pos
    FROM remittance_detail rd JOIN remittance r ON r.id=rd.remittance_id
    WHERE rd.enterprise_id=? AND rd.is_deleted=0 AND r.is_deleted=0 AND r.status='Approved'`, [le.id])[0];
  console.log('   approved non-deleted details:', JSON.stringify(agg));

  const bySign = q(`SELECT r.transaction_type, r.category, r.bank_name, COUNT(*) n, SUM(CAST(rd.amount AS REAL)) s,
      SUM(CASE WHEN CAST(rd.amount AS REAL) < 0 THEN 1 ELSE 0 END) neg
    FROM remittance_detail rd JOIN remittance r ON r.id=rd.remittance_id
    WHERE rd.enterprise_id=? AND rd.is_deleted=0 AND r.is_deleted=0 AND r.status='Approved'
    GROUP BY r.transaction_type, r.category, r.bank_name ORDER BY s`, [le.id]);
  console.log('   by transaction type / category / bank:');
  for (const b of bySign) console.log(`     n=${String(b.n).padStart(4)} neg=${String(b.neg).padStart(4)} sum=${String(Number(b.s).toFixed(2)).padStart(16)}  ${b.transaction_type} | ${b.category} | ${b.bank_name}`);

  const disbIds = new Set(q(`SELECT remittance_id FROM loans WHERE is_deleted=0`).map(x => String(x.remittance_id)));
  const split = q(`SELECT SUM(CASE WHEN rd.remittance_id IN (${[...disbIds].map(() => '?').join(',') || "''"}) THEN CAST(rd.amount AS REAL) ELSE 0 END) disb,
      SUM(CASE WHEN rd.remittance_id IN (${[...disbIds].map(() => '?').join(',') || "''"}) THEN 0 ELSE CAST(rd.amount AS REAL) END) other,
      SUM(CASE WHEN rd.remittance_id IN (${[...disbIds].map(() => '?').join(',') || "''"}) THEN 1 ELSE 0 END) disbN
    FROM remittance_detail rd JOIN remittance r ON r.id=rd.remittance_id
    WHERE rd.enterprise_id=? AND rd.is_deleted=0 AND r.is_deleted=0 AND r.status='Approved'`,
    [...disbIds, ...disbIds, ...disbIds, le.id])[0];
  console.log('   disbursement-linked (loans.remittance_id) sum:', Number(split.disb).toFixed(2), ' count:', split.disbN);
  console.log('   everything else sum:', Number(split.other).toFixed(2));
  console.log('   NET detail sum:', Number(agg.sum_amt).toFixed(2));
}

console.log('\n=== do the -DUE-01 / -TR-01 family rows explain the Txn Charges 1000? ===');
for (const id of ['CG0nA-00000000001257', 'CG0nA-00000000001344', 'CG0nA-20260919104912']) {
  console.log(`  family ${id}:`);
  for (const r of q(`SELECT r.id, r.amount, r.category, r.transaction_type, r.bank_name, r.loan_id, r.parent_remittance_id,
      (SELECT group_concat(rd.enterprise_id || ':' || rd.amount, ' | ') FROM remittance_detail rd WHERE rd.remittance_id=r.id AND rd.is_deleted=0) dets
    FROM remittance r WHERE r.id=? OR r.id LIKE ? ORDER BY r.id`, [id, `${id}%`]))
    console.log('   ', r.id.padEnd(34), `amt=${String(r.amount).padStart(9)}`, `${r.transaction_type}|${r.category}|${r.bank_name}`.padEnd(46), 'dets=', r.dets);
}
