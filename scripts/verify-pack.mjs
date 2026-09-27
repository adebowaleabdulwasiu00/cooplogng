// Runs the real Accounting Pack builder against a SQLite file and reports the
// control totals, so the model can be verified without a browser.
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { buildAccountingPack } from '../src/services/reports/accountingPack.js';

const dbFile = process.argv[2] || 'sampledata.db';
const start = process.argv[3] || '2000-01-01';
const end = process.argv[4] || '2099-12-31';

const buf = fs.readFileSync(dbFile);
const SQL = await initSqlJs({ locateFile: f => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(buf);
const query = async (sql, bind = []) => {
    const stmt = db.prepare(sql);
    try {
        stmt.bind(bind);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
    } finally {
        stmt.free();
    }
};

const coops = await query('SELECT id, full_name FROM cooperatives');
const coop = coops[0];
console.log(`cooperative: ${coop.full_name}  (${coop.id})`);
console.log(`period:      ${start} to ${end}\n`);

const pack = await buildAccountingPack({
    cooperativeId: coop.id, startDate: start, endDate: end,
    cooperativeName: coop.full_name, generatedBy: 'verify-harness', query
});

const f = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const p = (label, v) => console.log(`  ${String(label).padEnd(42)} ${f(v).padStart(20)}`);
const pair = (label, a, b) => console.log(`  ${String(label).padEnd(42)} ${f(a).padStart(20)} /${f(b).padStart(20)}`);

console.log('POSTINGS');
p('approved remittances in scope', pack.meta.postedRows);
p('individual postings derived', pack.meta.postings);
console.log(`  accounts: ${pack.accounts.length}   ledger lines: ${pack.generalLedger.length}`);

console.log('\nTRIAL BALANCE TOTALS');
const t = pack.trialBalanceTotals;
pair('opening  Dr / Cr', t.openingDr, t.openingCr);
p('opening  difference (Dr-Cr)', t.openingDiff);
pair('period   Dr / Cr', t.periodDr, t.periodCr);
p('period   difference (Dr-Cr)', t.periodDr - t.periodCr);
pair('closing  Dr / Cr', t.closingDr, t.closingCr);
p('CLOSING CONTROL DIFFERENCE', t.closingDiff);

console.log('\nPERIOD RESULT');
p('income', pack.periodResult.income);
p('expenditure', pack.periodResult.expense);
p('net surplus / (deficit)', pack.periodResult.surplus);
p('retained earnings b/f', pack.periodResult.retainedEarningsOpening);

console.log('\nTRIAL BALANCE LINES');
for (const r of pack.trialBalance) {
    console.log(`  ${r.code}  ${r.account.padEnd(26).slice(0, 26)} ${r.type.padEnd(10)} ${r.normal}  ` +
        `oDr ${f(r.openingDr).padStart(16)} oCr ${f(r.openingCr).padStart(16)} ` +
        `pDr ${f(r.periodDr).padStart(14)} pCr ${f(r.periodCr).padStart(14)} ` +
        `cDr ${f(r.closingDr).padStart(16)} cCr ${f(r.closingCr).padStart(16)}`);
}

console.log('\nALL ACCOUNTS (incl. memo, incl. nil)');
for (const a of pack.accountDiagnostics) {
    console.log(`  ${a.code}  ${a.account.padEnd(26).slice(0, 26)} ${a.bucket.padEnd(11).padEnd(11)} ` +
        `${a.type.padEnd(10)} ${a.normal}  tb=${a.inTrialBalance ? 'Y' : 'N'}  n=${String(a.postings).padStart(5)}  ` +
        `netDr o ${f(a.openingNetDr).padStart(15)} p ${f(a.periodNetDr).padStart(15)} c ${f(a.closingNetDr).padStart(15)}  ` +
        `presented ${f(a.presented).padStart(16)}`);
}

console.log('\nCONTROL CHECKS');
for (const c of pack.controlChecks) {
    console.log(`  [${c.status.padEnd(6)}] ${c.id} ${c.name}`);
    console.log(`           A ${f(c.valueA).padStart(18)}   B ${f(c.valueB).padStart(18)}   diff ${f(c.difference).padStart(16)}`);
}

console.log('\nCASH BOOK');
for (const r of pack.cashBook.summary) {
    console.log(`  ${r.code} ${r.bank.padEnd(14)} open ${f(r.opening).padStart(18)}  in ${f(r.receipts).padStart(16)}  out ${f(r.payments).padStart(16)}  close ${f(r.closing).padStart(18)}`);
}
p('total cash closing', pack.cashBook.totals.closing);
p('internal transfer memo net', pack.cashBook.internalNet);

console.log('\nMEMBER ACCOUNTS');
p('rows', pack.memberAccounts.rows.length);
p('total closing (credit-positive)', pack.memberAccounts.closingTotal);
p('of which pseudo-member', pack.memberAccounts.pseudoTotal);
p('of which members', pack.memberAccounts.closingTotal - pack.memberAccounts.pseudoTotal);

console.log('\nLOANS');
p('loan records', pack.loanRegister.rows.length);
p('derived outstanding total', pack.loanRegister.outstandingTotal);
p('loan receivable per trial balance', pack.loanRegister.accountClosing);
for (const r of pack.loanRegister.rows.slice(0, 20)) {
    console.log(`  ${r.status.padEnd(8)} ${String(r.member).slice(0, 26).padEnd(26)} principal ${f(r.principal).padStart(14)} out ${f(r.outstanding).padStart(14)}  ${r.ageing}  disb=${r.disbursementStatus}`);
}

console.log('\nINCOME / EXPENSE / COOPERATIVE ASSET DETAIL');
p('income postings', pack.incomeDetail.length);
p('income gross (sum of Amount)', pack.incomeDetail.reduce((s, r) => s + r.amount, 0));
p('income net (sum of Effect)', pack.incomeDetail.reduce((s, r) => s + r.effect, 0));
p('expense postings', pack.expenseDetail.length);
p('expense gross (sum of Amount)', pack.expenseDetail.reduce((s, r) => s + r.amount, 0));
p('expense net (sum of Effect)', pack.expenseDetail.reduce((s, r) => s + r.effect, 0));
p('cooperative asset postings', pack.coopAssetDetail.length);
p('cooperative asset net', pack.coopAssetDetail.reduce((s, r) => s + r.effect, 0));

console.log('\nLOAN ATTRIBUTION');
p('loan account movements unattributed', pack.unattributedLoan.count);
p('  net of those movements', pack.unattributedLoan.net);

console.log('\nAUDIT TRAIL / EXCEPTIONS');
p('audit trail rows', pack.auditTrail.length);
p('exceptions raised', pack.exceptions.length);
const bySev = {};
const byCode = {};
for (const e of pack.exceptions) {
    bySev[e.severity] = (bySev[e.severity] || 0) + 1;
    byCode[e.code] = byCode[e.code] || { n: 0, amt: 0, sev: e.severity, title: e.title };
    byCode[e.code].n++;
    byCode[e.code].amt = Math.round((byCode[e.code].amt + e.amount) * 100) / 100;
}
console.log('  by severity:', JSON.stringify(bySev));
for (const [code, v] of Object.entries(byCode).sort((a, b) => Math.abs(b[1].amt) - Math.abs(a[1].amt))) {
    console.log(`  ${v.sev.padEnd(7)} ${code.padEnd(28)} n=${String(v.n).padStart(5)}  net ${f(v.amt).padStart(18)}  ${v.title}`);
}

console.log('\nREVENUE-ENT MEMO (excluded from trial balance)');
for (const r of pack.revenueEntMemo) console.log(`  ${r.code} ${r.account.padEnd(24)} open ${f(r.opening).padStart(14)} period ${f(r.period).padStart(14)} close ${f(r.closing).padStart(14)}`);

console.log('\nACCOUNT MAPPING');
for (const m of pack.accountMapping) console.log(`  ${m.code}  ${m.type.padEnd(10)} ${m.normal}  ${m.account}`);

const failed = pack.controlChecks.filter(c => c.status === 'REVIEW');
console.log(`\n${failed.length ? 'REVIEW' : 'PASS'}: ${failed.length} control check(s) flagged for review.`);
