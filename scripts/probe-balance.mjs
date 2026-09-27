import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const dbPath = process.argv[2] || 'sampledata.db';
const buf = fs.readFileSync(dbPath);
const SQL = await initSqlJs({ locateFile: f => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(buf);
const q = (sql) => { const r = db.exec(sql); if (!r.length) return []; const c = r[0].columns; return r[0].values.map(v => Object.fromEntries(c.map((k, i) => [k, v[i]]))); };
const show = (l, rows) => { console.log('\n=== ' + l + ' ==='); console.log(rows.length ? JSON.stringify(rows, null, 1).slice(0, 6000) : '(none)'); };

show('H vs D by type (approved, not deleted)', q(`
SELECT r.transaction_type, r.category,
  count(*) n,
  sum(case when abs(CAST(r.amount AS REAL) - ifnull(d.s,0)) < 0.005 then 1 else 0 end) balanced,
  sum(case when abs(CAST(r.amount AS REAL) - ifnull(d.s,0)) >= 0.005 then 1 else 0 end) unbalanced,
  sum(case when d.s is null then 1 else 0 end) header_only,
  round(sum(CAST(r.amount AS REAL)),2) hdr, round(sum(ifnull(d.s,0)),2) det
FROM remittance r
LEFT JOIN (SELECT remittance_id, sum(CAST(amount AS REAL)) s FROM remittance_detail WHERE is_deleted=0 GROUP BY remittance_id) d
  ON d.remittance_id = r.id
WHERE r.is_deleted=0 AND r.status='Approved'
GROUP BY r.transaction_type, r.category ORDER BY n DESC`));

show('unbalanced examples', q(`
SELECT r.id, r.transaction_type, r.category, r.amount, r.bank_name, r.autogen, r.member_id,
  (SELECT round(sum(CAST(amount AS REAL)),2) FROM remittance_detail rd WHERE rd.remittance_id=r.id AND rd.is_deleted=0) det
FROM remittance r
WHERE r.is_deleted=0 AND r.status='Approved'
  AND abs(CAST(r.amount AS REAL) - ifnull((SELECT sum(CAST(amount AS REAL)) FROM remittance_detail rd WHERE rd.remittance_id=r.id AND rd.is_deleted=0),0)) >= 0.005
ORDER BY r.remittance_date DESC LIMIT 20`));

show('family balance for a deposit family', q(`
SELECT r.id, r.transaction_type, r.category, r.amount, r.bank_name, r.autogen, r.parent_remittance_id, r.loan_id,
  (SELECT round(sum(CAST(amount AS REAL)),2) FROM remittance_detail rd WHERE rd.remittance_id=r.id AND rd.is_deleted=0) det
FROM remittance r WHERE r.id LIKE 'CG0nA-20260922105559%' OR r.parent_remittance_id='CG0nA-20260922105559' OR r.loan_id='CG0nA-20260922105559' ORDER BY r.id`));

show('charge/pickup rows', q(`
SELECT r.id, r.transaction_type, r.category, r.amount, r.bank_name, r.autogen, r.member_id, r.loan_id, r.parent_remittance_id,
  (SELECT round(sum(CAST(amount AS REAL)),2) FROM remittance_detail rd WHERE rd.remittance_id=r.id AND rd.is_deleted=0) det
FROM remittance r WHERE r.transaction_type='Loan Charges' AND r.is_deleted=0 LIMIT 20`));

show('detail enterprises unknown', q(`
SELECT count(*) n FROM remittance_detail rd LEFT JOIN enterprise e ON e.id=rd.enterprise_id WHERE e.id IS NULL`));
show('remittance member_id unknown', q(`
SELECT count(*) n FROM remittance r LEFT JOIN members m ON m.id=r.member_id WHERE m.id IS NULL AND r.member_id<>'0000000000'`));
show('remit with no date', q(`SELECT count(*) n FROM remittance WHERE remittance_date IS NULL OR remittance_date=''`));
show('orphan details', q(`
SELECT count(*) n FROM remittance_detail rd LEFT JOIN remittance r ON r.id=rd.remittance_id WHERE r.id IS NULL`));
show('deleted count', q(`
SELECT (SELECT count(*) FROM remittance WHERE is_deleted=1) rem_del,
       (SELECT count(*) FROM remittance_detail WHERE is_deleted=1) det_del,
       (SELECT count(*) FROM members WHERE is_deleted=1) mem_del,
       (SELECT count(*) FROM enterprise WHERE is_deleted=1) ent_del`));
show('null bank', q(`SELECT count(*) n FROM remittance WHERE is_deleted=0 AND (bank_name IS NULL OR bank_name='')`));
show('empty category', q(`SELECT count(*) n FROM remittance WHERE is_deleted=0 AND (category IS NULL OR category='')`));
show('empty tx type', q(`SELECT count(*) n FROM remittance WHERE is_deleted=0 AND (transaction_type IS NULL OR transaction_type='')`));
show('detail zero amount', q(`SELECT count(*) n FROM remittance_detail WHERE is_deleted=0 AND (amount IS NULL OR CAST(amount AS REAL)=0)`));
show('header zero amount', q(`SELECT count(*) n FROM remittance WHERE is_deleted=0 AND CAST(amount AS REAL)=0`));
show('date range', q(`SELECT min(remittance_date) a, max(remittance_date) b FROM remittance`));
show('withdrawal rows', q(`
SELECT r.id, r.transaction_type, r.category, r.amount, r.bank_name, r.member_id,
  (SELECT round(sum(CAST(amount AS REAL)),2) FROM remittance_detail rd WHERE rd.remittance_id=r.id AND rd.is_deleted=0) det
FROM remittance r WHERE r.transaction_type='Savings Withdrawal' AND r.is_deleted=0 ORDER BY r.remittance_date DESC LIMIT 8`));
