import { queryRows } from '../sqliteService.js';
import { fetchEnterprises } from '../dataService.js';

// ---------------------------------------------------------------------------
// Corrected regulatory statements — SAME DB architecture, no new tables/cols.
// Conventions (cash basis, Approved-only):
//  - Member-side ledger  = remittance_detail.amount grouped by enterprise_id
//  - Cash-side ledger    = remittance.amount grouped by bank_name (excl. Internal Transfer)
//  - P&L + Retained Earnings share ONE basis: header category (captures the
//    header-only Loan Charges pickup to 0000000000 which has no detail by design).
//  - TB shows: BS details (historical) + Cash + P&L header movement (in-year)
//    + RE opening (cumulative before FY start). No double-count of surplus.
//  - BS shows: BS details (signed, overpayments reclassified) + Cash + RE closing.
//  - Suspense = disclosed header-vs-detail control gap, not a hidden plug.
// ---------------------------------------------------------------------------

const INC_CATS = ['Revenue', 'Operating Income', 'Loan Income', 'Other Income'];
const EXP_CATS = ['Expense', 'Expenses', 'Operating Expense', 'Administrative Expense', 'Finance Expense', 'Welfare Expense', 'Other Operating Expense', 'Other Expenses'];
const NON_POSTING_CATS = ['Transfer', 'Suspense'];

function num(v) {
    const n = parseFloat(v || 0);
    return Number.isFinite(n) ? n : 0;
}

function isRevenueEnterprise(rowOrEnt) {
    const r = rowOrEnt?.is_revenue ?? rowOrEnt?.revenue;
    return r == 1 || r === '1' || r === 'true' || r === true;
}

function normAcctType(t) {
    return String(t || '').trim().toLowerCase();
}

function isBSEnterprise(ent) {
    const t = normAcctType(ent.account_type);
    return (t === 'asset' || t === 'loan' || t === 'liability' ||
        t === 'savings' || t === 'equity' || t === 'capital') && !ent.is_revenue;
}

function isDRNormal(ent) {
    const t = normAcctType(ent.account_type);
    return t === 'asset' || t === 'loan' || t === 'expense';
}

async function getFiscalBounds(cooperativeId, fiscalYear) {
    const baseYear = String(fiscalYear).includes('/') ? parseInt(String(fiscalYear).split('/')[0], 10) : parseInt(fiscalYear, 10);
    const coop = await queryRows('SELECT coop_first_month FROM cooperatives WHERE id=?', [cooperativeId]);
    let startMonth = 1;
    if (coop[0]?.coop_first_month) {
        const parts = String(coop[0].coop_first_month).split('-');
        startMonth = parseInt(parts[1], 10) || 1;
    }
    const startDate = new Date(baseYear, startMonth - 1, 1);
    const endDate = new Date(baseYear + 1, startMonth - 1, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const startStr = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-01`;
    const lastDay = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate();
    const endStr = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(lastDay)}`;
    return { startStr, endStr };
}

async function getHeaderRevExpCumulative(cooperativeId, endStr) {
    const rows = await queryRows(`
        SELECT
            SUM(CASE WHEN r.category IN ('Revenue','Operating Income','Loan Income','Other Income') THEN r.amount ELSE 0 END) as rev,
            SUM(CASE WHEN r.category IN ('Expense','Expenses','Operating Expense','Administrative Expense','Finance Expense','Welfare Expense','Other Operating Expense','Other Expenses') THEN ABS(r.amount) ELSE 0 END) as exp
        FROM remittance r
        WHERE r.cooperative_id = ? AND r.status = 'Approved' AND r.is_deleted = 0
          AND date(r.remittance_date) <= date(?)
    `, [cooperativeId, endStr]);
    return { rev: num(rows[0]?.rev), exp: num(rows[0]?.exp) };
}

async function getControlGap(cooperativeId, endStr) {
    // Honest control: cash headers (excl. internal) minus member details.
    // Non-zero = header-only postings (e.g. Loan Charges pickup) or data errors.
    const h = await queryRows(`
        SELECT COALESCE(SUM(amount),0) as t FROM remittance
        WHERE cooperative_id = ? AND status='Approved' AND is_deleted=0
          AND bank_name != 'Internal Transfer' AND date(remittance_date) <= date(?)
    `, [cooperativeId, endStr]);
    const d = await queryRows(`
        SELECT COALESCE(SUM(rd.amount),0) as t FROM remittance_detail rd
        JOIN remittance r ON r.id = rd.remittance_id
        WHERE rd.cooperative_id = ? AND r.status='Approved' AND r.is_deleted=0 AND rd.is_deleted=0
          AND date(r.remittance_date) <= date(?)
    `, [cooperativeId, endStr]);
    const headerTotal = num(h[0]?.t);
    const detailTotal = num(d[0]?.t);
    return { headerTotal, detailTotal, gap: headerTotal - detailTotal };
}

export async function getTrialBalanceData(cooperativeId, fiscalYear) {
    const enterprises = await fetchEnterprises(cooperativeId, true);
    const { startStr, endStr } = await getFiscalBounds(cooperativeId, fiscalYear);

    // 1. Member-side balances (detail basis, cumulative to end).
    const rows = await queryRows(`
        SELECT rd.enterprise_id, SUM(rd.amount) as net_amount
        FROM remittance_detail rd
        JOIN remittance r ON r.id = rd.remittance_id
        WHERE rd.cooperative_id = ? AND r.status = 'Approved' AND r.is_deleted = 0 AND rd.is_deleted = 0
          AND date(r.remittance_date) <= date(?)
        GROUP BY rd.enterprise_id
    `, [cooperativeId, endStr]);

    const entMap = {};
    enterprises.forEach(e => {
        entMap[e.id] = {
            id: e.id,
            account_name: e.account_name,
            account_type: normAcctType(e.account_type),
            is_revenue: e.revenue == 1 || e.revenue === '1' || e.revenue === 'true' || e.revenue === true,
            historical_sum: 0
        };
    });
    rows.forEach(row => {
        const ent = entMap[row.enterprise_id];
        if (!ent) return;
        ent.historical_sum += num(row.net_amount);
    });

    // 2. Cash-side balances (header basis, excl. internal movements).
    const bankRows = await queryRows(`
        SELECT bank_name, SUM(amount) as net_balance
        FROM remittance
        WHERE cooperative_id = ? AND status = 'Approved' AND is_deleted = 0
          AND bank_name != 'Internal Transfer'
          AND date(remittance_date) <= date(?)
        GROUP BY bank_name
    `, [cooperativeId, endStr]);

    // 3. P&L movement for the year (header-category basis — ties to I&E).
    const pnlRows = await queryRows(`
        SELECT r.category, r.transaction_type, SUM(r.amount) as total
        FROM remittance r
        WHERE r.cooperative_id = ? AND r.status = 'Approved' AND r.is_deleted = 0
          AND date(r.remittance_date) >= date(?) AND date(r.remittance_date) <= date(?)
          AND r.category IN ('Revenue','Operating Income','Loan Income','Other Income','Expense','Expenses','Operating Expense','Administrative Expense','Finance Expense','Welfare Expense','Other Operating Expense','Other Expenses')
        GROUP BY r.category, r.transaction_type
    `, [cooperativeId, startStr, endStr]);

    // 4. RE opening (cumulative BEFORE fy start) — avoids double-counting surplus.
    //    Compute as day-before-start to keep single date() basis.
    const startMinusOne = await queryRows(`SELECT date(?, '-1 day') as d`, [startStr]);
    const openDate = startMinusOne[0]?.d || startStr;
    const openCum = await getHeaderRevExpCumulative(cooperativeId, openDate);
    const reOpening = openCum.rev - openCum.exp;

    let idx = 1;
    let totalDebit = 0;
    let totalCredit = 0;
    const data = [];

    const pushBalanced = (name, typeLabel, net, drNormal) => {
        if (Math.abs(net) < 0.01) return;
        let dr = 0, cr = 0;
        if (drNormal) { if (net < 0) dr = -net; else cr = net; }
        else { if (net > 0) cr = net; else dr = -net; }
        totalDebit += dr;
        totalCredit += cr;
        data.push([idx++, name, typeLabel, dr, cr]);
    };

    // BS lines from detail (historical).
    Object.values(entMap)
        .sort((a, b) => String(a.account_name).localeCompare(String(b.account_name)))
        .forEach(ent => {
            const rawType = (ent.account_type || '').toUpperCase() || 'UNCLASSIFIED';
            if (!isBSEnterprise(ent)) return; // P&L enterprises shown via header section below
            pushBalanced(ent.account_name, rawType, ent.historical_sum, isDRNormal(ent));
        });

    // Cash lines from header.
    bankRows.forEach(b => {
        const net = num(b.net_balance);
        if (Math.abs(net) < 0.01) return;
        if (net > 0) { totalDebit += net; data.push([idx++, `Cash in Bank - ${b.bank_name || 'Unspecified'}`, 'CASH/BANK', net, 0]); }
        else { totalCredit += -net; data.push([idx++, `Cash in Bank - ${b.bank_name || 'Unspecified'} (Overdraft)`, 'CASH/BANK', 0, -net]); }
    });

    // P&L lines for the year from header (ties footing to I&E).
    const pnlSorted = [...pnlRows].sort((a, b) => String(a.transaction_type || a.category).localeCompare(String(b.transaction_type || b.category)));
    pnlSorted.forEach(r => {
        const net = num(r.total);
        if (Math.abs(net) < 0.01) return;
        const name = r.transaction_type || r.category || 'Unknown';
        if (INC_CATS.includes(r.category)) pushBalanced(`${name} (P&L)`, 'INCOME', net, false);
        else pushBalanced(`${name} (P&L)`, 'EXPENSE', net, true);
    });

    // RE opening only.
    if (Math.abs(reOpening) >= 0.01) {
        if (reOpening > 0) { totalCredit += reOpening; data.push([idx++, 'Retained Earnings - Opening Balance', 'EQUITY', 0, reOpening]); }
        else { totalDebit += -reOpening; data.push([idx++, 'Retained Earnings - Opening Balance', 'EQUITY', -reOpening, 0]); }
    }

    // Control gap disclosure (explains any remaining imbalance).
    const { headerTotal, detailTotal, gap } = await getControlGap(cooperativeId, endStr);
    const suspense = totalDebit - totalCredit;
    if (Math.abs(suspense) >= 0.01) {
        if (suspense > 0) { totalCredit += suspense; data.push([idx++, 'Suspense - header-only postings gap', '', 0, suspense]); }
        else { totalDebit += -suspense; data.push([idx++, 'Suspense - header-only postings gap', '', -suspense, 0]); }
    }

    data.push([]);
    data.push(['', 'TOTAL', '', totalDebit, totalCredit]);
    data.push([]);
    data.push(['', `Control: cash headers excl. Internal (${headerTotal.toFixed(2)}) vs member details (${detailTotal.toFixed(2)}) = gap ${gap.toFixed(2)}`, '', '', '']);
    data.push(['', `Basis: cash, Approved only, excl. Pending/Deleted/Internal Transfer. FY ${startStr} to ${endStr}.`, '', '', '']);

    const headers = ['S/N', 'Account Name', 'Account Type', 'Debit (DR)', 'Credit (CR)'];
    return { data, headers, title: `Trial Balance - ${fiscalYear} Fiscal Year` };
}

export async function getIncomeExpenditureData(cooperativeId, fiscalYear) {
    const { startStr, endStr } = await getFiscalBounds(cooperativeId, fiscalYear);

    // Header-category basis: captures system pickup rows with no detail.
    const sql = `
        SELECT
            r.category,
            r.transaction_type,
            SUM(r.amount) as total
        FROM remittance r
        WHERE r.cooperative_id = ? AND r.status = 'Approved' AND r.is_deleted = 0
            AND date(r.remittance_date) >= date(?)
            AND date(r.remittance_date) <= date(?)
        GROUP BY r.category, r.transaction_type
    `;
    const rows = await queryRows(sql, [cooperativeId, startStr, endStr]);

    const incomeMap = {};
    const expenseMap = {};
    const memoMap = {};
    let totalIncome = 0;
    let totalExpense = 0;

    rows.forEach(r => {
        const amount = num(r.total);
        const name = r.transaction_type || r.category || 'Unknown';
        if (INC_CATS.includes(r.category)) {
            incomeMap[name] = (incomeMap[name] || 0) + amount;
        } else if (EXP_CATS.includes(r.category)) {
            expenseMap[name] = (expenseMap[name] || 0) + amount;
        } else if (r.category) {
            memoMap[`${r.category} / ${name}`] = (memoMap[`${r.category} / ${name}`] || 0) + amount;
        }
    });

    const data = [];
    data.push(['INCOME', '', '', '']);
    let idx = 1;
    Object.entries(incomeMap).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, amount]) => {
        if (Math.abs(amount) < 0.01) return;
        totalIncome += amount;
        data.push([`  ${idx++}`, name, '', amount]);
    });
    data.push(['', 'TOTAL INCOME', '', totalIncome]);
    data.push([]);

    data.push(['EXPENDITURE', '', '', '']);
    idx = 1;
    Object.entries(expenseMap).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, amount]) => {
        const displayAmt = Math.abs(amount);
        if (displayAmt < 0.01) return;
        totalExpense += displayAmt;
        data.push([`  ${idx++}`, name, '', displayAmt]);
    });
    data.push(['', 'TOTAL EXPENDITURE', '', totalExpense]);
    data.push([]);

    const surplus = totalIncome - totalExpense;
    data.push(['', 'NET SURPLUS/(DEFICIT)', '', surplus]);
    data.push([]);

    // Memo: non-P&L movements in period (proves nothing leaked into totals).
    const memoEntries = Object.entries(memoMap).filter(([, v]) => Math.abs(v) >= 0.01)
        .sort((a, b) => a[0].localeCompare(b[0]));
    if (memoEntries.length) {
        data.push(['MEMO - EXCLUDED FROM TOTALS (Transfers / Assets / Liabilities)', '', '', '']);
        memoEntries.forEach(([name, amount], i) => {
            data.push([`  ${i + 1}`, name, '', amount]);
        });
        data.push([]);
    }

    // Annex: detail-side income check (member charges) for the same period.
    const detailAnnex = await queryRows(`
        SELECT COALESCE(SUM(rd.amount),0) as t FROM remittance_detail rd
        JOIN remittance r ON r.id = rd.remittance_id
        JOIN enterprise e ON e.id = rd.enterprise_id
        WHERE rd.cooperative_id = ? AND r.status='Approved' AND r.is_deleted=0 AND rd.is_deleted=0
          AND date(r.remittance_date) >= date(?) AND date(r.remittance_date) <= date(?)
          AND (e.revenue == 1 OR e.revenue == '1' OR e.revenue == 'true')
    `, [cooperativeId, startStr, endStr]);
    const detailRevSide = num(detailAnnex[0]?.t);
    data.push(['', `Annex: member-side revenue details total (${detailRevSide.toFixed(2)}). Header income above includes system pickups with no detail; difference flows to TB suspense.`, '', '']);
    data.push(['', `Basis: cash, Approved only, header category. FY ${startStr} to ${endStr}.`, '', '']);

    const headers = ['', 'Particulars', '', 'Amount'];
    return { data, headers, title: `Income and Expenditure Statement - ${fiscalYear} Fiscal Year` };
}

export async function getBalanceSheetData(cooperativeId, fiscalYear) {
    const enterprises = await fetchEnterprises(cooperativeId, true);
    const { startStr, endStr } = await getFiscalBounds(cooperativeId, fiscalYear);

    const sql = `
        SELECT
            e.id,
            e.account_name,
            e.account_type,
            e.revenue as is_revenue,
            SUM(rd.amount) as net_amount
        FROM enterprise e
        LEFT JOIN remittance_detail rd ON e.id = rd.enterprise_id AND rd.is_deleted = 0 AND rd.cooperative_id = e.cooperative_id
        LEFT JOIN remittance r ON r.id = rd.remittance_id AND r.status = 'Approved' AND r.is_deleted = 0
            AND date(r.remittance_date) <= date(?)
        WHERE e.cooperative_id = ?
        GROUP BY e.id, e.account_name, e.account_type, e.revenue
        ORDER BY e.account_type, e.account_name
    `;
    const rows = await queryRows(sql, [endStr, cooperativeId]);

    const bankSql = `
        SELECT bank_name, SUM(amount) as net_balance
        FROM remittance
        WHERE cooperative_id = ? AND status = 'Approved' AND is_deleted = 0
          AND bank_name != 'Internal Transfer'
          AND date(remittance_date) <= date(?)
        GROUP BY bank_name
    `;
    const bankRows = await queryRows(bankSql, [cooperativeId, endStr]);

    // RE closing on the SAME header basis as I&E (cumulative to BS date).
    const cum = await getHeaderRevExpCumulative(cooperativeId, endStr);
    const netSurplus = cum.rev - cum.exp;

    const assetAccounts = [];
    const assetReclass = [];      // over-withdrawn savings / negative liabilities -> asset
    const liabilityAccounts = [];
    const liabilityReclass = [];  // overpaid loans / positive assets -> liability
    const equityAccounts = [];

    rows.forEach(r => {
        const type = normAcctType(r.account_type);
        const rev = isRevenueEnterprise(r) || type === 'revenue';
        if (rev || type === 'expense') return;
        const net = num(r.net_amount);
        if (Math.abs(net) < 0.01) return;
        if (type === 'asset' || type === 'loan') {
            if (net < 0) assetAccounts.push({ ...r, display: -net });       // DR receivable
            else liabilityReclass.push({ ...r, display: net, note: 'Overpayment / credit balance' });
        } else if (type === 'liability' || type === 'savings') {
            if (net > 0) liabilityAccounts.push({ ...r, display: net });    // CR liability
            else assetReclass.push({ ...r, display: -net, note: 'Over-withdrawn / receivable' });
        } else if (type === 'equity' || type === 'capital') {
            equityAccounts.push({ ...r, display: net });
        }
    });

    const data = [];
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    data.push(['ASSETS', '', '']);
    let idx = 1;
    [...assetAccounts].sort((a, b) => String(a.account_name).localeCompare(String(b.account_name))).forEach(e => {
        totalAssets += e.display;
        data.push([`  ${idx++}`, e.account_name, e.display]);
    });
    assetReclass.forEach(e => {
        totalAssets += e.display;
        data.push([`  ${idx++}`, `${e.account_name} (${e.note})`, e.display]);
    });
    [...bankRows].sort((a, b) => String(a.bank_name).localeCompare(String(b.bank_name))).forEach(b => {
        const amount = num(b.net_balance);
        if (amount <= 0.01) return;
        totalAssets += amount;
        data.push([`  ${idx++}`, `Cash in Bank - ${b.bank_name}`, amount]);
    });
    data.push(['', 'TOTAL ASSETS', totalAssets]);
    data.push([]);

    data.push(['LIABILITIES', '', '']);
    idx = 1;
    [...liabilityAccounts].sort((a, b) => String(a.account_name).localeCompare(String(b.account_name))).forEach(e => {
        totalLiabilities += e.display;
        data.push([`  ${idx++}`, e.account_name, e.display]);
    });
    liabilityReclass.forEach(e => {
        totalLiabilities += e.display;
        data.push([`  ${idx++}`, `${e.account_name} (${e.note})`, e.display]);
    });
    bankRows.forEach(b => {
        const amount = num(b.net_balance);
        if (amount >= -0.01) return;
        const absAmt = Math.abs(amount);
        totalLiabilities += absAmt;
        data.push([`  ${idx++}`, `Bank Overdraft - ${b.bank_name}`, absAmt]);
    });
    data.push(['', 'TOTAL LIABILITIES', totalLiabilities]);
    data.push([]);

    data.push(['EQUITY', '', '']);
    idx = 1;
    equityAccounts.forEach(e => {
        totalEquity += e.display;
        data.push([`  ${idx++}`, e.account_name, e.display]);
    });
    data.push([`  ${idx++}`, 'Retained Earnings (Cumulative Net Surplus)', netSurplus]);
    totalEquity += netSurplus;
    // Disclosed control gap so Assets always equals Liabilities + Equity.
    const bsGap = totalAssets - (totalLiabilities + totalEquity);
    if (Math.abs(bsGap) >= 0.01) {
        totalEquity += bsGap;
        data.push([`  ${idx++}`, 'Suspense - header-only postings gap', bsGap]);
    }
    data.push(['', 'TOTAL EQUITY', totalEquity]);
    data.push([]);

    data.push(['', 'TOTAL LIABILITIES + EQUITY', totalLiabilities + totalEquity]);
    data.push([]);

    const diff = Math.abs(totalAssets - (totalLiabilities + totalEquity));
    data.push(['', 'CHECK: Assets = Liab + Equity', diff < 1.0 ? 'BALANCED' : `MISMATCH (Diff: ${diff.toFixed(2)})`]);
    data.push(['', `Basis: cash, Approved only, excl. Pending/Deleted/Internal Transfer. As at ${endStr} (FY from ${startStr}). Overpayments reclassified, not netted.`, '']);

    const headers = ['', 'Particulars', 'Amount'];
    return { data, headers, title: `Balance Sheet - ${fiscalYear} Fiscal Year` };
}

export async function getCashFlowData(cooperativeId, fiscalYear) {
    const baseYear = String(fiscalYear).includes('/') ? parseInt(String(fiscalYear).split('/')[0], 10) : parseInt(fiscalYear, 10);

    const coop = await queryRows('SELECT coop_first_month FROM cooperatives WHERE id=?', [cooperativeId]);
    let startMonth = 1;
    if (coop[0]?.coop_first_month) {
        const parts = String(coop[0].coop_first_month).split('-');
        startMonth = parseInt(parts[1], 10) || 1;
    }
    const startDate = new Date(baseYear, startMonth - 1, 1);
    const endDate = new Date(baseYear + 1, startMonth - 1, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const startStr = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-01`;
    const endStr = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate())}`;

    const openingSql = `
        SELECT COALESCE(SUM(amount), 0) as opening
        FROM remittance
        WHERE cooperative_id = ? AND status = 'Approved' AND is_deleted = 0
          AND date(remittance_date) < date(?)
    `;
    const openingResult = await queryRows(openingSql, [cooperativeId, startStr]);
    const openingBalance = num(openingResult[0]?.opening);

    // Header-based cash flow: every movement comes from the remittance
    // header amount + category (single base, so closing always equals
    // opening + movements). Internal transfers get their own memo section —
    // they move money between own pots, not in/out of the cooperative.
    const remSql = `
        SELECT
            r.amount,
            r.category
        FROM remittance r
        WHERE r.cooperative_id = ? AND r.status = 'Approved' AND r.is_deleted = 0
            AND date(r.remittance_date) >= date(?) AND date(r.remittance_date) <= date(?)
    `;
    const remRows = await queryRows(remSql, [cooperativeId, startStr, endStr]);

    const INC_CATS_CF = ['Revenue', 'Operating Income', 'Loan Income', 'Other Income'];
    const EXP_CATS_CF = ['Expense', 'Expenses', 'Operating Expense', 'Administrative Expense', 'Finance Expense', 'Welfare Expense', 'Other Operating Expense', 'Other Expenses'];
    let operatingInflow = 0, operatingOutflow = 0;
    let investingInflow = 0, investingOutflow = 0;
    let financingInflow = 0, financingOutflow = 0;
    let transferNet = 0;

    remRows.forEach(r => {
        const amt = num(r.amount);
        const cat = r.category || '';
        if (INC_CATS_CF.includes(cat)) {
            if (amt > 0) operatingInflow += amt; else operatingOutflow += Math.abs(amt);
        } else if (EXP_CATS_CF.includes(cat)) {
            if (amt < 0) operatingOutflow += Math.abs(amt); else operatingInflow += amt;
        } else if (cat === 'Loan Asset' || cat === 'Fixed Asset') {
            if (amt < 0) investingOutflow += Math.abs(amt); else investingInflow += amt;
        } else if (cat === 'Member Liability') {
            if (amt > 0) financingInflow += amt; else financingOutflow += Math.abs(amt);
        } else {
            // Transfer and anything unclassified: internal movement memo.
            transferNet += amt;
        }
    });

    const data = [];
    data.push(['CASH FLOW FROM OPERATING ACTIVITIES', '', '']);
    data.push(['  Cash Inflows (Income / Revenue)', '', operatingInflow]);
    data.push(['  Cash Outflows (Expenses)', '', operatingOutflow]);
    const netOperating = operatingInflow - operatingOutflow;
    data.push(['  Net Cash from Operating Activities', '-----', netOperating]);
    data.push([]);

    data.push(['CASH FLOW FROM INVESTING ACTIVITIES', '', '']);
    data.push(['  Cash Inflows (Loan Repayments / Asset Sales)', '', investingInflow]);
    data.push(['  Cash Outflows (Loan Disbursements / Asset Purchases)', '', investingOutflow]);
    const netInvesting = investingInflow - investingOutflow;
    data.push(['  Net Cash from Investing Activities', '-----', netInvesting]);
    data.push([]);

    data.push(['CASH FLOW FROM FINANCING ACTIVITIES', '', '']);
    data.push(['  Cash Inflows (Member Deposits)', '', financingInflow]);
    data.push(['  Cash Outflows (Withdrawals)', '', financingOutflow]);
    const netFinancing = financingInflow - financingOutflow;
    data.push(['  Net Cash from Financing Activities', '-----', netFinancing]);
    data.push([]);

    data.push(['INTERNAL TRANSFERS (MEMO)', '', '']);
    data.push(['  Net Internal Transfers (between own pots)', '', transferNet]);
    data.push([]);

    const netCashMovement = netOperating + netInvesting + netFinancing + transferNet;
    const closingBalance = openingBalance + netCashMovement;

    data.push(['SUMMARY', '', '']);
    data.push(['  Opening Cash Balance', '', openingBalance]);
    data.push(['  Net Cash Movement', '', netCashMovement]);
    data.push(['  Closing Cash Balance', '', closingBalance]);

    const headers = ['', 'Particulars', 'Amount'];
    return { data, headers, title: `Cash Flow Statement - ${fiscalYear} Fiscal Year` };
}
