import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const dbPath = process.argv[2] || 'sampledata.db';
const buf = fs.readFileSync(dbPath);
const SQL = await initSqlJs({ locateFile: f => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(buf);
const q = (sql) => { const r = db.exec(sql); if (!r.length) return []; const c = r[0].columns; return r[0].values.map(v => Object.fromEntries(c.map((k, i) => [k, v[i]]))); };

const INCOME = ['Revenue', 'Operating Income', 'Loan Income', 'Other Income'];
const EXPENSE = ['Expense', 'Expenses', 'Operating Expense', 'Administrative Expense', 'Finance Expense', 'Welfare Expense', 'Other Operating Expense', 'Other Expenses'];
const COOP_ASSET = ['Asset', 'Fixed Asset'];          // NOTE: 'Loan Asset' is a MEMBER loan, not a coop asset
const MEMBER_CAT = ['Member Liability', 'Loan Asset', 'Liability', 'Equity', 'Transfer'];

const rems = q(`SELECT id, member_id, amount, bank_name, transaction_type, category, autogen, parent_remittance_id, loan_id, remittance_date
  FROM remittance WHERE is_deleted=0 AND status='Approved'`);
const dets = q(`SELECT remittance_id, SUM(CAST(amount AS REAL)) s, COUNT(*) n FROM remittance_detail WHERE is_deleted=0 GROUP BY remittance_id`);
const detMap = new Map(dets.map(d => [d.remittance_id, d]));

const byId = new Map(rems.map(r => [r.id, r]));
const famOf = new Map(rems.map(r => [r.id, r.id]));
for (let pass = 0; pass < 6; pass++) {
  for (const r of rems) {
    const link = r.parent_remittance_id || (r.loan_id && byId.has(r.loan_id) ? r.loan_id : null);
    if (!link || !byId.has(link)) continue;
    const root = famOf.get(link);
    if (root && root !== r.id) famOf.set(r.id, root);
  }
}
const fams = new Map();
for (const r of rems) { const f = famOf.get(r.id) || r.id; if (!fams.has(f)) fams.set(f, []); fams.get(f).push(r); }

const famsArr = [];
for (const [root, rows] of fams) {
  let cashNet = 0, income = 0, expense = 0, coopAsset = 0, detail = 0, internalHeader = 0;
  for (const r of rows) {
    const H = Number(r.amount || 0);
    const D = detMap.has(r.id) ? Number(detMap.get(r.id).s) : 0;
    detail += D;
    const cat = r.category || '';
    const isBank = !!r.bank_name && r.bank_name !== 'Internal Transfer';
    if (isBank) cashNet += H;
    if (INCOME.includes(cat)) { income += H; if (!isBank) internalHeader += H; }
    else if (EXPENSE.includes(cat)) { expense += Math.abs(H); if (!isBank) internalHeader += Math.abs(H); }
    else if (COOP_ASSET.includes(cat)) { coopAsset += H; if (!isBank) internalHeader += H; }
    else if (!isBank && Math.abs(H) > 0.005) internalHeader += H;
  }
  const residual = cashNet + expense - coopAsset - detail - income;
  famsArr.push({ root, n: rows.length, cashNet, income, expense, coopAsset, detail, internalHeader, residual, rows });
}

const balanced = famsArr.filter(f => Math.abs(f.residual) < 0.005);
const unbalanced = famsArr.filter(f => Math.abs(f.residual) >= 0.005);
console.log('families:', famsArr.length, '| balanced:', balanced.length, '| unbalanced:', unbalanced.length);
console.log('sum of residuals:', famsArr.reduce((s, f) => s + f.residual, 0).toFixed(2));
console.log('rows in unbalanced families:', unbalanced.reduce((s, f) => s + f.n, 0));

// classify unbalanced families by shape
const shape = new Map();
for (const f of unbalanced) {
  const single = f.n === 1;
  const r = f.rows[0];
  const hasDet = detMap.has(r.id);
  const detN = hasDet ? detMap.get(r.id).n : 0;
  const isBank = !!r.bank_name && r.bank_name !== 'Internal Transfer';
  const cat = r.category || '';
  const catGrp = INCOME.includes(cat) ? 'Income' : EXPENSE.includes(cat) ? 'Expense' : COOP_ASSET.includes(cat) ? 'CoopAsset' : cat || '(blank)';
  const k = `${single ? 'single' : 'family(' + f.n + ')'}|${r.transaction_type}|${catGrp}|${isBank ? 'bank' : 'nonbank'}|det=${detN}`;
  if (!shape.has(k)) shape.set(k, { k, n: 0, res: 0, eg: r.id });
  const s = shape.get(k); s.n++; s.res += f.residual;
}
console.log('\nunbalanced shapes:');
for (const s of [...shape.values()].sort((a, b) => Math.abs(b.res) - Math.abs(a.res)))
  console.log(`  n=${String(s.n).padStart(5)}  sum=${s.res.toFixed(2).padStart(16)}  ${s.k}   e.g. ${s.eg}`);

console.log('\ntop 15 unbalanced families:');
unbalanced.sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));
for (const f of unbalanced.slice(0, 15)) {
  console.log(`  ${f.root} n=${f.n} residual=${f.residual.toFixed(2)} cash=${f.cashNet.toFixed(2)} det=${f.detail.toFixed(2)} inc=${f.income.toFixed(2)} exp=${f.expense.toFixed(2)} asset=${f.coopAsset.toFixed(2)}`);
  for (const r of f.rows) {
    const d = detMap.get(r.id) || { s: 0, n: 0 };
    console.log(`      ${r.id} | ${r.transaction_type} | ${r.category} | H=${r.amount} | D=${(Number(d.s) || 0).toFixed(2)}(${d.n}) | ${r.bank_name} | ag=${r.autogen} | ${String(r.remittance_date).slice(0, 10)}`);
  }
}

const list = (a) => a.map(x => `'${x}'`).join(',');
console.log('\ncooperative-level classification rows (income/expense/asset):');
console.log(JSON.stringify(q(`SELECT transaction_type, category, bank_name, count(*) n, round(sum(CAST(amount AS REAL)),2) total
  FROM remittance WHERE is_deleted=0 AND status='Approved'
  AND (category IN (${list(INCOME)}) OR category IN (${list(EXPENSE)}) OR category IN (${list(COOP_ASSET)}))
  GROUP BY transaction_type, category, bank_name ORDER BY n DESC`), null, 1));

console.log('\nsingle-leg internal rows (non-bank header, no details), by category:');
console.log(JSON.stringify(q(`SELECT category, transaction_type, count(*) n, round(sum(CAST(amount AS REAL)),2) total
  FROM remittance r WHERE r.is_deleted=0 AND r.status='Approved'
  AND (r.bank_name IS NULL OR r.bank_name='' OR r.bank_name='Internal Transfer')
  AND NOT EXISTS (SELECT 1 FROM remittance_detail rd WHERE rd.remittance_id=r.id AND rd.is_deleted=0)
  GROUP BY category, transaction_type ORDER BY n DESC`), null, 1));

console.log('\ninternal rows with exactly 1 detail (one-legged transfers):');
console.log(JSON.stringify(q(`SELECT r.category, r.transaction_type, count(*) n, round(sum(CAST(r.amount AS REAL)),2) total
  FROM remittance r WHERE r.is_deleted=0 AND r.status='Approved'
  AND (r.bank_name IS NULL OR r.bank_name='' OR r.bank_name='Internal Transfer')
  AND (SELECT count(*) FROM remittance_detail rd WHERE rd.remittance_id=r.id AND rd.is_deleted=0)=1
  GROUP BY category, transaction_type ORDER BY n DESC`), null, 1));
