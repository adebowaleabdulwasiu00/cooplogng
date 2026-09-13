import { queryRows } from '../sqliteService.js';
import { fetchEnterprises } from '../dataService.js';

export async function getTrialBalanceData(cooperativeId, fiscalYear) {
    const enterprises = await fetchEnterprises(cooperativeId, true);
    const baseYear = fiscalYear.includes('/') ? parseInt(fiscalYear.split('/')[0]) : parseInt(fiscalYear);

    const coop = await queryRows('SELECT coop_first_month FROM cooperatives WHERE id=?', [cooperativeId]);
    let startMonth = 1;
    if (coop[0]?.coop_first_month) {
        const parts = coop[0].coop_first_month.split('-');
        startMonth = parseInt(parts[1]);
    }
    const startDate = new Date(baseYear, startMonth - 1, 1);
    const endDate = new Date(baseYear + 1, startMonth - 1, 0);
    const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2, '0')}-01`;
    const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2, '0')}-${String(new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

    const sql = `
        SELECT 
            rd.enterprise_id,
            r.remittance_date,
            rd.amount
        FROM remittance_detail rd
        JOIN remittance r ON r.id = rd.remittance_id
        WHERE rd.cooperative_id = ? AND r.status = 'Approved' AND r.is_deleted = 0 AND rd.is_deleted = 0
          AND date(r.remittance_date) <= date(?)
    `;
    const rows = await queryRows(sql, [cooperativeId, endStr]);

    const entMap = {};
    enterprises.forEach(e => {
        entMap[e.id] = {
            id: e.id,
            account_name: e.account_name,
            account_type: (e.account_type || '').toLowerCase(),
            is_revenue: e.revenue == 1 || e.revenue === '1' || e.revenue === 'true' || e.revenue === true,
            historical_sum: 0,
            year_sum: 0
        };
    });

    const startMs = new Date(startStr).getTime();
    const endMs = new Date(endStr).getTime();

    rows.forEach(row => {
        const ent = entMap[row.enterprise_id];
        if (!ent) return;
        const amt = parseFloat(row.amount || 0);
        ent.historical_sum += amt;
        const rowDateMs = new Date(row.remittance_date).getTime();
        if (rowDateMs >= startMs && rowDateMs <= endMs) {
            ent.year_sum += amt;
        }
    });

    const bankSql = `
        SELECT bank_name, SUM(amount) as net_balance
        FROM remittance
        WHERE cooperative_id = ? AND status = 'Approved' AND is_deleted = 0
          AND bank_name != 'Internal Transfer'
          AND date(remittance_date) <= date(?)
        GROUP BY bank_name
    `;
    const bankRows = await queryRows(bankSql, [cooperativeId, endStr]);

    let idx = 1;
    let totalDebit = 0;
    let totalCredit = 0;
    const data = [];

    Object.values(entMap).forEach(ent => {
        const isBS = (ent.account_type === 'asset' || ent.account_type === 'loan' ||
                      ent.account_type === 'liability' || ent.account_type === 'savings' ||
                      ent.account_type === 'equity' || ent.account_type === 'capital') && !ent.is_revenue;
        const net = isBS ? ent.historical_sum : ent.year_sum;
        if (Math.abs(net) < 0.01) return;

        const isAssetOrExpense = ent.account_type === 'asset' || ent.account_type === 'loan' || ent.account_type === 'expense';
        let dr = 0;
        let cr = 0;

        if (isAssetOrExpense) {
            if (net < 0) dr = Math.abs(net);
            else cr = net;
        } else {
            if (net > 0) cr = net;
            else dr = Math.abs(net);
        }

        totalDebit += dr;
        totalCredit += cr;
        data.push([idx++, ent.account_name, ent.account_type.toUpperCase(), dr, cr]);
    });

    bankRows.forEach(b => {
        const net = parseFloat(b.net_balance || 0);
        if (Math.abs(net) < 0.01) return;

        let dr = 0;
        let cr = 0;
        if (net > 0) {
            dr = net;
        } else {
            cr = Math.abs(net);
        }

        totalDebit += dr;
        totalCredit += cr;
        data.push([idx++, `Cash in Bank - ${b.bank_name || 'Unspecified'}`, 'CASH/BANK', dr, cr]);
    });

    // Retained Earnings (header rule, same base as the Income &
    // Expenditure statement) so the TB suspense below ties to the
    // Balance Sheet suspense instead of hiding undistributed surplus.
    const reRows = await queryRows(`
        SELECT
            SUM(CASE WHEN category IN ('Revenue','Operating Income','Loan Income','Other Income') THEN amount ELSE 0 END) as rev,
            SUM(CASE WHEN category IN ('Expense','Expenses','Operating Expense','Administrative Expense','Finance Expense','Welfare Expense','Other Operating Expense','Other Expenses') THEN ABS(amount) ELSE 0 END) as exp
        FROM remittance
        WHERE cooperative_id = ? AND status = 'Approved' AND is_deleted = 0
          AND date(remittance_date) <= date(?)
    `, [cooperativeId, endStr]);
    const reNet = parseFloat(reRows[0]?.rev || 0) - parseFloat(reRows[0]?.exp || 0);
    if (Math.abs(reNet) >= 0.01) {
        if (reNet > 0) { totalCredit += reNet; data.push([idx++, 'Retained Earnings', 'EQUITY', 0, reNet]); }
        else { totalDebit += -reNet; data.push([idx++, 'Retained Earnings', 'EQUITY', -reNet, 0]); }
    }

    // Single-entry books can't self-balance: header totals and detail totals
    // differ by header-only postings (detail-less opening rows). Disclose the
    // gap as suspense so the footing is honest instead of a bare mismatch.
    const suspense = totalDebit - totalCredit;
    if (Math.abs(suspense) >= 0.01) {
        if (suspense > 0) {
            totalCredit += suspense;
            data.push([idx++, 'Suspense – header-only postings gap', '', 0, suspense]);
        } else {
            totalDebit += -suspense;
            data.push([idx++, 'Suspense – header-only postings gap', '', -suspense, 0]);
        }
    }

    data.push([]);
    data.push(['', 'TOTAL', '', totalDebit, totalCredit]);

    const headers = ['S/N', 'Account Name', 'Account Type', 'Debit (DR)', 'Credit (CR)'];
    return { data, headers, title: `Trial Balance - ${fiscalYear} Fiscal Year` };
}

export async function getIncomeExpenditureData(cooperativeId, fiscalYear) {
    const baseYear = fiscalYear.includes('/') ? parseInt(fiscalYear.split('/')[0]) : parseInt(fiscalYear);

    const coop = await queryRows('SELECT coop_first_month FROM cooperatives WHERE id=?', [cooperativeId]);
    let startMonth = 1;
    if (coop[0]?.coop_first_month) {
        const parts = coop[0].coop_first_month.split('-');
        startMonth = parseInt(parts[1]);
    }
    const startDate = new Date(baseYear, startMonth - 1, 1);
    const endDate = new Date(baseYear + 1, startMonth - 1, 0);
    const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2, '0')}-01`;
    const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2, '0')}-${String(new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

    // Header-based accounting: income/expenditure follow the remittance
    // category + header amount (details are member-level breakdowns only).
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
    let totalIncome = 0;
    let totalExpense = 0;

    const INC_CATS = ['Revenue', 'Operating Income', 'Loan Income', 'Other Income'];
    const EXP_CATS = ['Expense', 'Expenses', 'Operating Expense', 'Administrative Expense', 'Finance Expense', 'Welfare Expense', 'Other Operating Expense', 'Other Expenses'];
    rows.forEach(r => {
        const amount = parseFloat(r.total || 0);
        const name = r.transaction_type || r.category || 'Unknown';
        if (INC_CATS.includes(r.category)) {
            incomeMap[name] = (incomeMap[name] || 0) + amount;
        } else if (EXP_CATS.includes(r.category)) {
            expenseMap[name] = (expenseMap[name] || 0) + amount;
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

    data.push(['', 'NET SURPLUS/(DEFICIT)', '', totalIncome - totalExpense]);

    const headers = ['', 'Particulars', '', 'Amount'];
    return { data, headers, title: `Income and Expenditure Statement - ${fiscalYear} Fiscal Year` };
}

export async function getBalanceSheetData(cooperativeId, fiscalYear) {
    const enterprises = await fetchEnterprises(cooperativeId, true);
    const baseYear = fiscalYear.includes('/') ? parseInt(fiscalYear.split('/')[0]) : parseInt(fiscalYear);

    const coop = await queryRows('SELECT coop_first_month FROM cooperatives WHERE id=?', [cooperativeId]);
    let startMonth = 1;
    if (coop[0]?.coop_first_month) {
        const parts = coop[0].coop_first_month.split('-');
        startMonth = parseInt(parts[1]);
    }
    const startDate = new Date(baseYear, startMonth - 1, 1);
    const endDate = new Date(baseYear + 1, startMonth - 1, 0);
    const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2, '0')}-${String(new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

    const sql = `
        SELECT 
            e.id,
            e.account_name,
            e.account_type,
            e.revenue as is_revenue,
            SUM(rd.amount) as net_amount
        FROM enterprise e
        LEFT JOIN remittance_detail rd ON e.id = rd.enterprise_id AND rd.is_deleted = 0
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

    // Retained Earnings follows the header rule (same base as the Income &
    // Expenditure statement): income-category headers minus expense-category
    // headers (absolute), cumulative to the balance-sheet date.
    const reSql = `
        SELECT 
            SUM(CASE WHEN r.category IN ('Revenue','Operating Income','Loan Income','Other Income') THEN r.amount ELSE 0 END) as total_rev,
            SUM(CASE WHEN r.category IN ('Expense','Expenses','Operating Expense','Administrative Expense','Finance Expense','Welfare Expense','Other Operating Expense','Other Expenses') THEN ABS(r.amount) ELSE 0 END) as total_exp
        FROM remittance r
        WHERE r.cooperative_id = ? AND r.status = 'Approved' AND r.is_deleted = 0
          AND date(r.remittance_date) <= date(?)
    `;
    const reResult = await queryRows(reSql, [cooperativeId, endStr]);
    const netSurplus = parseFloat(reResult[0]?.total_rev || 0) - parseFloat(reResult[0]?.total_exp || 0);

    const assetAccounts = [];
    const liabilityAccounts = [];
    const equityAccounts = [];

    rows.forEach(r => {
        const type = (r.account_type || '').toLowerCase();
        const isRevenue = r.is_revenue == 1 || r.is_revenue === '1' || r.is_revenue === 'true' || r.is_revenue === true || type === 'revenue';
        if (isRevenue || type === 'expense') return;

        if (type === 'asset' || type === 'loan') {
            assetAccounts.push(r);
        } else if (type === 'liability' || type === 'savings') {
            liabilityAccounts.push(r);
        } else if (type === 'equity' || type === 'capital') {
            equityAccounts.push(r);
        }
    });

    const data = [];
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    data.push(['ASSETS', '', '']);
    let idx = 1;
    assetAccounts.forEach(e => {
        const amount = Math.abs(parseFloat(e.net_amount || 0));
        if (amount < 0.01) return;
        totalAssets += amount;
        data.push([`  ${idx++}`, e.account_name, amount]);
    });
    bankRows.forEach(b => {
        const amount = parseFloat(b.net_balance || 0);
        if (amount <= 0.01) return;
        totalAssets += amount;
        data.push([`  ${idx++}`, `Cash in Bank - ${b.bank_name}`, amount]);
    });
    data.push(['', 'TOTAL ASSETS', totalAssets]);
    data.push([]);

    data.push(['LIABILITIES', '', '']);
    idx = 1;
    liabilityAccounts.forEach(e => {
        const amount = parseFloat(e.net_amount || 0);
        if (amount < 0.01) return;
        totalLiabilities += amount;
        data.push([`  ${idx++}`, e.account_name, amount]);
    });
    bankRows.forEach(b => {
        const amount = parseFloat(b.net_balance || 0);
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
        const amount = parseFloat(e.net_amount || 0);
        if (Math.abs(amount) < 0.01) return;
        totalEquity += amount;
        data.push([`  ${idx++}`, e.account_name, amount]);
    });
    data.push([`  ${idx++}`, 'Retained Earnings (Cumulative Net Surplus)', netSurplus]);
    totalEquity += netSurplus;
    // Same single-entry gap as the Trial Balance (header-only postings):
    // disclosed here so Assets always equals Liabilities + Equity.
    const bsGap = totalAssets - (totalLiabilities + totalEquity);
    if (Math.abs(bsGap) >= 0.01) {
        totalEquity += bsGap;
        data.push([`  ${idx++}`, 'Suspense – header-only postings gap', bsGap]);
    }
    data.push(['', 'TOTAL EQUITY', totalEquity]);
    data.push([]);

    data.push(['', 'TOTAL LIABILITIES + EQUITY', totalLiabilities + totalEquity]);
    data.push([]);

    const diff = Math.abs(totalAssets - (totalLiabilities + totalEquity));
    data.push(['', 'CHECK: Assets = Liab + Equity', diff < 1.0 ? '✓ BALANCED' : `✗ MISMATCH (Diff: ${diff.toFixed(2)})`]);

    const headers = ['', 'Particulars', 'Amount'];
    return { data, headers, title: `Balance Sheet - ${fiscalYear} Fiscal Year` };
}

export async function getCashFlowData(cooperativeId, fiscalYear) {
    const baseYear = fiscalYear.includes('/') ? parseInt(fiscalYear.split('/')[0]) : parseInt(fiscalYear);

    const coop = await queryRows('SELECT coop_first_month FROM cooperatives WHERE id=?', [cooperativeId]);
    let startMonth = 1;
    if (coop[0]?.coop_first_month) {
        const parts = coop[0].coop_first_month.split('-');
        startMonth = parseInt(parts[1]);
    }
    const startDate = new Date(baseYear, startMonth - 1, 1);
    const endDate = new Date(baseYear + 1, startMonth - 1, 0);
    const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2, '0')}-01`;
    const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2, '0')}-${String(new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

    const openingSql = `
        SELECT COALESCE(SUM(amount), 0) as opening
        FROM remittance
        WHERE cooperative_id = ? AND status = 'Approved' AND is_deleted = 0
          AND date(remittance_date) < date(?)
    `;
    const openingResult = await queryRows(openingSql, [cooperativeId, startStr]);
    const openingBalance = parseFloat(openingResult[0]?.opening || 0);

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
        const amt = parseFloat(r.amount || 0);
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
