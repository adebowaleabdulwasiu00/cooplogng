// Why are ONE_LEGGED_NON_CASH families not netting to zero?
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const buf = fs.readFileSync('sampledata.db');
const SQL = await initSqlJs({ locateFile: f => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(buf);
const q = (sql, bind = []) => { const s = db.prepare(sql); s.bind(bind); const o = []; while (s.step()) o.push(s.getAsObject()); s.free(); return o; };

const coop = q(`SELECT id FROM cooperatives`)[0].id;
const rems = q(`SELECT id, amount, category, transaction_type, bank_name, member_id, status, is_deleted, parent_remittance_id, loan_id
  FROM remittance WHERE cooperative_id=?`, [coop]);
const remById = new Map(rems.map(r => [String(r.id), r]));

// same family logic as accountingPack.js
const famOf = new Map(rems.map(r => [String(r.id), String(r.id)]));
for (let pass = 0; pass < 6; pass++) {
  for (const r of rems) {
    const lid = String(r.loan_id || '').trim();
    const link = String(r.parent_remittance_id || '').trim() || (lid && remById.has(lid) ? lid : '');
    if (!link || !remById.has(link)) continue;
    const root = famOf.get(link);
    if (root && root !== String(r.id)) famOf.set(String(r.id), root);
  }
}
const famSize = new Map();
for (const r of rems) {
  const f = famOf.get(String(r.id));
  famSize.set(f, (famSize.get(f) || 0) + 1);
}
console.log('families:', famSize.size);
const sizes = {};
for (const v of famSize.values()) sizes[v] = (sizes[v] || 0) + 1;
console.log('family size distribution:', JSON.stringify(sizes));

console.log('\n=== 5 sample families, all rows and their link columns ===');
const byFam = new Map();
for (const r of rems) {
  const f = famOf.get(String(r.id));
  if (!byFam.has(f)) byFam.set(f, []);
  byFam.get(f).push(r);
}
let shown = 0;
for (const [f, rows] of [...byFam].sort((a, b) => b[1].length - a[1].length)) {
  if (shown++ >= 5) break;
  console.log(`\n family ${f}  (${rows.length} rows)`);
  for (const r of rows.sort((a, b) => String(a.id).localeCompare(String(b.id))))
    console.log(`   ${String(r.id).padEnd(36)} amt=${String(r.amount).padStart(10)} ${String(r.transaction_type).padEnd(18)}|${String(r.category).padEnd(13)}|${String(r.bank_name).padEnd(18)} loan_id=${String(r.loan_id).padEnd(26)} parent=${r.parent_remittance_id}`);
}

console.log('\n=== how many families contain a row whose amount has |x| >= 0.005 and a NON-bank, no-classification, <=1-detail row? ===');
const detCount = new Map();
for (const d of q(`SELECT remittance_id, count(*) n FROM remittance_detail WHERE is_deleted=0 GROUP BY remittance_id`)) detCount.set(String(d.remittance_id), d.n);
const INCOME = ['Revenue', 'Operating Income', 'Loan Income', 'Other Income'];
const EXPENSE = ['Expense', 'Expenses', 'Operating Expense', 'Administrative Expense', 'Finance Expense', 'Welfare Expense', 'Other Operating Expense', 'Other Expenses'];
const COOP = ['Asset', 'Fixed Asset'];
const oneLeg = [];
for (const r of rems) {
  if (String(r.is_deleted) === '1' || r.status !== 'Approved') continue;
  const H = Math.abs(Number(r.amount));
  if (H < 0.005) continue;
  const isBank = !!r.bank_name && r.bank_name !== 'Internal Transfer';
  const cat = String(r.category || '');
  const hasClass = INCOME.includes(cat) || EXPENSE.includes(cat) || COOP.includes(cat);
  if (isBank || hasClass) continue;
  if ((detCount.get(String(r.id)) || 0) > 1) continue;
  oneLeg.push(r);
}
console.log('  one-legged candidate rows:', oneLeg.length);
const byFamOne = new Map();
for (const r of oneLeg) {
  const f = famOf.get(String(r.id));
  byFamOne.set(f, (byFamOne.get(f) || 0) + 1);
}
const dist = {};
for (const v of byFamOne.values()) dist[v] = (dist[v] || 0) + 1;
console.log('  families represented, candidates-per-family:', JSON.stringify(dist));
console.log('  distinct families:', byFamOne.size);

console.log('\n=== do the "-INCOME" rows actually carry the parent link? ===');
for (const pat of ['%-INCOME', '%-DUE-01', '%-TR-01']) {
  const rows = q(`SELECT id, loan_id, parent_remittance_id, amount FROM remittance WHERE id LIKE ?`, [pat]);
  const withLoan = rows.filter(r => r.loan_id).length;
  const withParent = rows.filter(r => r.parent_remittance_id).length;
  console.log(`  ${pat}: n=${rows.length}  loan_id set=${withLoan}  parent set=${withParent}`);
  console.log('   e.g.', JSON.stringify(rows.slice(0, 2)));
}

console.log('\n=== family net for the first 3 real families, using the pack posting rules ===');
const INCOME_CR = INCOME, EXPENSE_DR = EXPENSE, COOP_DR = COOP;
function famPostings(r) {
  const out = [];
  const H = Number(r.amount) || 0;
  const isBank = !!r.bank_name && r.bank_name !== 'Internal Transfer';
  const cat = String(r.category || '');
  const hasClass = INCOME_CR.includes(cat) || EXPENSE_DR.includes(cat) || COOP_DR.includes(cat);
  if (isBank && Math.abs(H) >= 0.005) out.push({ acct: 'bank', net: H > 0 ? H : -H });
  for (const d of q(`SELECT amount FROM remittance_detail WHERE remittance_id=? AND is_deleted=0`, [r.id])) {
    const a = Number(d.amount) || 0;
    if (Math.abs(a) < 0.005) continue;
    out.push({ acct: 'detail', net: a < 0 ? Math.abs(a) : -Math.abs(a) });
  }
  if (hasClass && Math.abs(H) >= 0.005) out.push({ acct: 'class', net: H < 0 ? Math.abs(H) : -Math.abs(H) });
  return out;
}
let i = 0;
for (const [f, rows] of byFamOne) {
  if (i++ >= 3) break;
  let net = 0;
  const parts = [];
  for (const r of rows) {
    for (const p of famPostings(r)) { net += p.net; parts.push(`${p.acct}:${p.net}`); }
  }
  console.log(` family ${f} (${rows.length} rows)  net=${net.toFixed(2)}`);
  console.log(`   ${parts.join('  ')}`);
}
