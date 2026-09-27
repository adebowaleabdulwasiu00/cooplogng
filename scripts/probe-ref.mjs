import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const buf = fs.readFileSync(process.argv[2] || 'sampledata.db');
const SQL = await initSqlJs({ locateFile: f => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(buf);
const q = (sql) => { const r = db.exec(sql); if (!r.length) return []; const c = r[0].columns; return r[0].values.map(v => Object.fromEntries(c.map((k, i) => [k, v[i]]))); };

console.log('ENTERPRISES');
console.log(JSON.stringify(q(`SELECT id, account_name, account_type, parent_account, revenue, compulsory_due, is_penalty, distribution_priority, interest_rate, compulsory_amount
  FROM enterprise WHERE is_deleted=0 ORDER BY account_type, account_name`), null, 1));

console.log('\nDETAIL MOVEMENT PER ENTERPRISE (approved, all time)');
console.log(JSON.stringify(q(`SELECT rd.enterprise_id, e.account_name, e.account_type, e.revenue, e.compulsory_due, e.is_penalty,
  count(*) n, round(sum(CAST(rd.amount AS REAL)),2) net
  FROM remittance_detail rd JOIN remittance r ON r.id=rd.remittance_id
  LEFT JOIN enterprise e ON e.id=rd.enterprise_id
  WHERE rd.is_deleted=0 AND r.is_deleted=0 AND r.status='Approved'
  GROUP BY rd.enterprise_id ORDER BY net`), null, 1));

console.log('\nBANKS');
console.log(JSON.stringify(q(`SELECT id, bank_name, account_name, account_number FROM bank WHERE is_deleted=0`), null, 1));

console.log('\nTRANSACTION TYPES');
console.log(JSON.stringify(q(`SELECT transaction_type, classification, is_active FROM transaction_types WHERE is_deleted=0 ORDER BY classification, transaction_type`), null, 1));

console.log('\nLOANS');
console.log(JSON.stringify(q(`SELECT id, member_id, enterprise_id, principal_amount, issued_date, due_date, status, duration_months, remittance_id FROM loans WHERE is_deleted=0`), null, 1));

console.log('\nBANK RECONCILIATION SUMMARIES');
console.log(JSON.stringify(q(`SELECT bank_name, period_month, bank_total_cr, bank_total_dr, system_total_cr, system_total_dr, status FROM bank_reconciliation_summary WHERE is_deleted=0`), null, 1));

console.log('\nSTATUS VALUES');
console.log(JSON.stringify(q(`SELECT status, count(*) n FROM remittance GROUP BY status`), null, 1));

console.log('\nCATEGORY x TRANSACTION_TYPE (all rows)');
console.log(JSON.stringify(q(`SELECT category, transaction_type, count(*) n, round(sum(CAST(amount AS REAL)),2) total FROM remittance WHERE is_deleted=0 GROUP BY category, transaction_type ORDER BY n DESC`), null, 1));
