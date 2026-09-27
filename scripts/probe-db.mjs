import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const dbPath = process.argv[2] || 'sampledata.db';
const buf = fs.readFileSync(dbPath);
const SQL = await initSqlJs({ locateFile: f => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(buf);

const q = (sql) => {
    const r = db.exec(sql);
    if (!r.length) return [];
    const cols = r[0].columns;
    return r[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
};
const show = (label, rows) => {
    console.log('\n=== ' + label + ' ===');
    if (!rows.length) { console.log('(none)'); return; }
    console.log(JSON.stringify(rows, null, 1).slice(0, 8000));
};

const table = process.argv[3];
if (table) {
    show(table, q(`SELECT * FROM ${table} LIMIT 25`));
    process.exit(0);
}

show('tables', q("SELECT name FROM sqlite_master WHERE type='table'"));
show('counts', q(`SELECT 'cooperatives' t, count(*) n FROM cooperatives
UNION ALL SELECT 'members', count(*) FROM members
UNION ALL SELECT 'enterprise', count(*) FROM enterprise
UNION ALL SELECT 'remittance', count(*) FROM remittance
UNION ALL SELECT 'remittance_detail', count(*) FROM remittance_detail
UNION ALL SELECT 'loans', count(*) FROM loans
UNION ALL SELECT 'bank', count(*) FROM bank
UNION ALL SELECT 'transaction_types', count(*) FROM transaction_types
UNION ALL SELECT 'payment_advise', count(*) FROM payment_advise`));
show('enterprises', q(`SELECT id, account_name, account_type, parent_account, loan_multiplier, interest_rate, form_fee, admin_charge, revenue, compulsory_due, compulsory_amount, is_penalty, is_deleted, distribution_priority FROM enterprise`));
show('banks', q(`SELECT id, bank_name, account_name, is_visible, is_deleted FROM bank`));
show('coops', q(`SELECT id, full_name, short_name, coop_first_month, is_deleted FROM cooperatives`));
show('tx types', q(`SELECT id, transaction_type, classification, is_system_default, is_deleted FROM transaction_types`));
show('remittance categories', q(`SELECT category, count(*) n, sum(amount) total FROM remittance WHERE is_deleted=0 GROUP BY category ORDER BY n DESC`));
show('remittance types', q(`SELECT transaction_type, count(*) n, sum(amount) total FROM remittance WHERE is_deleted=0 GROUP BY transaction_type ORDER BY n DESC`));
show('statuses', q(`SELECT status, count(*) n, sum(amount) total FROM remittance WHERE is_deleted=0 GROUP BY status`));
show('bank_name values', q(`SELECT bank_name, count(*) n, sum(amount) total FROM remittance WHERE is_deleted=0 GROUP BY bank_name ORDER BY n DESC`));
show('autogen', q(`SELECT autogen, count(*) n FROM remittance WHERE is_deleted=0 GROUP BY autogen`));
show('header vs detail control gap', q(`
SELECT (SELECT COALESCE(SUM(amount),0) FROM remittance WHERE is_deleted=0 AND status='Approved') hdr,
       (SELECT COALESCE(SUM(amount),0) FROM remittance WHERE is_deleted=0 AND status='Approved' AND bank_name!='Internal Transfer') hdr_nonint,
       (SELECT COALESCE(SUM(rd.amount),0) FROM remittance_detail rd JOIN remittance r ON r.id=rd.remittance_id WHERE r.is_deleted=0 AND r.status='Approved' AND rd.is_deleted=0) det`));
show('header-only rows (approved, no details)', q(`
SELECT r.id, r.transaction_type, r.category, r.amount, r.member_id, r.bank_name, r.autogen, r.remittance_date
FROM remittance r WHERE r.is_deleted=0 AND r.status='Approved'
AND NOT EXISTS (SELECT 1 FROM remittance_detail rd WHERE rd.remittance_id=r.id AND rd.is_deleted=0)
LIMIT 30`));
show('detail-only rows (details, no matching header detail sum check)', q(`
SELECT r.id, r.transaction_type, r.category, r.amount, (SELECT SUM(rd.amount) FROM remittance_detail rd WHERE rd.remittance_id=r.id AND rd.is_deleted=0) det
FROM remittance r WHERE r.is_deleted=0 AND r.status='Approved'
AND (SELECT SUM(rd.amount) FROM remittance_detail rd WHERE rd.remittance_id=r.id AND rd.is_deleted=0) IS NULL
LIMIT 20`));
show('sample remittances', q(`SELECT id, member_id, amount, bank_name, transaction_type, category, status, autogen, is_deleted, remittance_date, loan_id, parent_remittance_id, isLoanRequest, isWithdrawalRequest FROM remittance ORDER BY remittance_date DESC LIMIT 25`));
show('sample details', q(`SELECT id, remittance_id, enterprise_id, amount, auto_description, is_deleted FROM remittance_detail ORDER BY created_at DESC LIMIT 25`));
show('loans', q(`SELECT id, member_id, enterprise_id, principal_amount, issued_date, due_date, status, duration_months, remittance_id, is_deleted FROM loans LIMIT 25`));
show('loan statuses', q(`SELECT status, count(*) n, sum(principal_amount) p FROM loans WHERE is_deleted=0 GROUP BY status`));
show('per-enterprise detail net', q(`
SELECT rd.enterprise_id, e.account_name, e.account_type, e.revenue, e.compulsory_due, e.is_penalty,
       count(*) n, sum(rd.amount) net
FROM remittance_detail rd
JOIN remittance r ON r.id=rd.remittance_id
LEFT JOIN enterprise e ON e.id=rd.enterprise_id
WHERE rd.is_deleted=0 AND r.is_deleted=0 AND r.status='Approved'
GROUP BY rd.enterprise_id ORDER BY n DESC`));
