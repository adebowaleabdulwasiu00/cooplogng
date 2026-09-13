import { queryRows } from '../sqliteService.js';
import { fetchEnterprises } from '../dataService.js';
import { formatDate } from '../../utils/formatters.js';

export async function getEnterpriseAccountData(cooperativeId, user, enterpriseId, fyLabel) {
    if (!enterpriseId) return { data: [], headers: [], title: 'Enterprise Account' };

    const isAdmin = user.role === 'admin' || (user.permissions || '').includes('admin');
    const baseYear = fyLabel.includes('/') ? parseInt(fyLabel.split('/')[0]) : parseInt(fyLabel);

    const coop = await queryRows("SELECT coop_first_month FROM cooperatives WHERE id=?", [cooperativeId]);
    let startMonth = 1;
    if (coop[0]?.coop_first_month) {
        const parts = coop[0].coop_first_month.split('-');
        startMonth = parseInt(parts[1]);
    }

    const startDate = new Date(baseYear, startMonth - 1, 1);
    const months = [];
    let cur = new Date(startDate);
    for (let i = 0; i < 12; i++) {
        months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
        cur.setMonth(cur.getMonth() + 1);
    }
    const endDate = new Date(cur);

    const moLabels = months.map(m => new Date(m.year, m.month - 1, 1).toLocaleString('default', { month: 'short' }));
    const useSpecialId = localStorage.getItem('useSpecialIdInReports') === 'true';
    const headers = [useSpecialId ? "Member ID" : "Reg No", "", "Bal B/F", ...moLabels, "Total"];

    const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`;
    let bbfSql = `
        SELECT r.member_id as id, m.registration_no, m.special_id, SUM(rd.amount) as amt
        FROM remittance_detail rd
        JOIN remittance r ON r.id = rd.remittance_id
        JOIN members m ON m.id = r.member_id
        WHERE rd.cooperative_id = ? AND rd.enterprise_id = ? AND r.status = 'Approved'
          AND r.is_deleted = 0 AND rd.is_deleted = 0 AND m.is_deleted = 0
          AND date(r.remittance_date) < date(?)
    `;
    const bbfBind = [cooperativeId, enterpriseId, startDateStr];
    if (!isAdmin) {
        bbfSql += " AND LOWER(',' || REPLACE(IFNULL(m.account_manager, ''), ' ', '') || ',') LIKE LOWER('%,' || REPLACE(?, ' ', '') || ',%')";
        bbfBind.push(user.username);
    }
    bbfSql += " GROUP BY r.member_id";
    const bbfRows = await queryRows(bbfSql, bbfBind);
    const bbfMap = {};
    const regMap = {};
    const specialIdMap = {};
    bbfRows.forEach(r => {
        bbfMap[r.id] = r.amt;
        regMap[r.id] = r.registration_no;
        specialIdMap[r.id] = r.special_id;
    });

    const perMonthData = [];
    for (const m of months) {
        const mStartStr = `${m.year}-${String(m.month).padStart(2, '0')}-01`;
        const nextMonthDate = new Date(m.year, m.month, 1);
        const mEndStr = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`;

        let mSql = `
            SELECT r.member_id as id, m.registration_no, m.special_id,
                   SUM(CASE WHEN rd.amount > 0 THEN rd.amount ELSE 0 END) as cr,
                   SUM(CASE WHEN rd.amount < 0 THEN -rd.amount ELSE 0 END) as dr
            FROM remittance_detail rd
            JOIN remittance r ON r.id = rd.remittance_id
            JOIN members m ON m.id = r.member_id
            WHERE rd.cooperative_id = ? AND rd.enterprise_id = ? AND r.status = 'Approved'
              AND r.is_deleted = 0 AND rd.is_deleted = 0 AND m.is_deleted = 0
              AND date(r.remittance_date) >= date(?) AND date(r.remittance_date) < date(?)
        `;
        const mBind = [cooperativeId, enterpriseId, mStartStr, mEndStr];
        if (!isAdmin) {
            mSql += " AND LOWER(',' || REPLACE(IFNULL(m.account_manager, ''), ' ', '') || ',') LIKE LOWER('%,' || REPLACE(?, ' ', '') || ',%')";
            mBind.push(user.username);
        }
        mSql += " GROUP BY r.member_id";
        const mRows = await queryRows(mSql, mBind);
        const mMap = {};
        mRows.forEach(r => {
            mMap[r.id] = { cr: r.cr, dr: r.dr };
            regMap[r.id] = r.registration_no;
            specialIdMap[r.id] = r.special_id;
        });
        perMonthData.push(mMap);
    }

    const allMemberIds = new Set([...Object.keys(bbfMap), ...perMonthData.flatMap(m => Object.keys(m))]);
    const data = [];
    const totalsDr = new Array(12).fill(0);
    const totalsCr = new Array(12).fill(0);
    const totalsBl = new Array(12).fill(0);
    let totalBlEnd = 0;

    const sortedIds = Array.from(allMemberIds).sort((a, b) => (regMap[a] || 0) - (regMap[b] || 0));

    for (const mid of sortedIds) {
        const bbf = bbfMap[mid] || 0;
        let bl = bbf;
        const memberId = useSpecialId ? (specialIdMap[mid] || String(regMap[mid] || '').padStart(4, '0')) : String(regMap[mid] || '').padStart(4, '0');
        const drRow = [memberId, "DR", null];
        const crRow = ["", "CR", null];
        const blRow = ["", "BL", bbf];

        let hasActivity = false;
        for (let i = 0; i < 12; i++) {
            const { cr = 0, dr = 0 } = perMonthData[i][mid] || {};
            if (cr !== 0 || dr !== 0) hasActivity = true;
            bl += (cr - dr);
            drRow.push(dr);
            crRow.push(cr);
            blRow.push(bl);
            totalsDr[i] += dr;
            totalsCr[i] += cr;
            totalsBl[i] += bl;
        }

        if (!hasActivity && Math.abs(bl) < 0.01) continue;

        drRow.push(null);
        crRow.push(null);
        blRow.push(bl);
        totalBlEnd += bl;

        data.push(drRow, crRow, blRow);
    }

    if (data.length > 0) {
        data.push(
            ["TOTAL", "DR", null, ...totalsDr, null],
            ["TOTAL", "CR", null, ...totalsCr, null],
            ["TOTAL", "BL", null, ...totalsBl, totalBlEnd]
        );
    }

    const enterprises = await fetchEnterprises(cooperativeId, true);
    const entName = enterprises.find(e => e.id === enterpriseId)?.account_name || 'Enterprise';
    const title = `${entName} REMITTANCE RECORD FOR ${fyLabel} FINANCIAL YEAR`;

    return { data, headers, title };
}

export async function getGeneralLedgerData(cooperativeId, dateFrom, dateTo, enterpriseId) {
    const useSpecialId = localStorage.getItem('useSpecialIdInReports') === 'true';
    let sql = `
        SELECT 
            r.id as remittance_id,
            r.remittance_date,
            m.last_name,
            m.first_name,
            m.middle_name,
            m.registration_no,
            m.special_id,
            e.account_name,
            e.account_type,
            e.revenue as is_revenue,
            rd.amount,
            r.transaction_type,
            r.category,
            r.bank_name,
            r.description,
            r.created_at
        FROM remittance r
        JOIN remittance_detail rd ON r.id = rd.remittance_id
        LEFT JOIN members m ON r.member_id = m.id
        LEFT JOIN enterprise e ON rd.enterprise_id = e.id
        WHERE r.cooperative_id = ? 
        AND r.status = 'Approved' AND r.is_deleted = 0
    `;
    const params = [cooperativeId];

    if (dateFrom) {
        sql += ` AND date(r.remittance_date) >= date(?)`;
        params.push(dateFrom);
    }
    if (dateTo) {
        sql += ` AND date(r.remittance_date) <= date(?)`;
        params.push(dateTo);
    }
    if (enterpriseId && enterpriseId !== 'all') {
        sql += ` AND rd.enterprise_id = ?`;
        params.push(enterpriseId);
    }

    sql += ` ORDER BY r.remittance_date ASC, r.id ASC`;

    const rows = await queryRows(sql, params);

    // Running balance resets per account — a single total across unrelated
    // accounts is meaningless.
    let runningByAccount = {};
    const data = rows.map((row, idx) => {
        const amt = parseFloat(row.amount || 0);
        const acctKey = row.account_name || 'N/A';
        runningByAccount[acctKey] = (runningByAccount[acctKey] || 0) + amt;
        const runningBalance = runningByAccount[acctKey];

        const type = (row.account_type || '').toLowerCase();
        const isRevenue = row.is_revenue == 1 || row.is_revenue === '1' || row.is_revenue === 'true' || row.is_revenue === true || type === 'revenue';
        const isAssetOrExpense = type === 'asset' || type === 'loan' || type === 'expense';

        let dr = '';
        let cr = '';
        if (isAssetOrExpense) {
            if (amt < 0) dr = Math.abs(amt);
            else cr = amt;
        } else {
            if (amt > 0) cr = amt;
            else dr = Math.abs(amt);
        }

        return [
            idx + 1,
            formatDate(row.remittance_date),
            useSpecialId ? (row.special_id || (row.registration_no ? String(row.registration_no).padStart(4, '0') : 'N/A')) : (row.registration_no ? String(row.registration_no).padStart(4, '0') : 'N/A'),
            [row.last_name, row.first_name, row.middle_name].filter(Boolean).join(' ') || 'Admin',
            row.account_name || 'N/A',
            row.transaction_type || 'N/A',
            row.category || 'N/A',
            row.bank_name || 'N/A',
            dr,
            cr,
            runningBalance,
            row.description || ''
        ];
    });

    const headers = ['S/N', 'Date', useSpecialId ? 'Member ID' : 'Reg No', 'Member', 'Account', 'Type', 'Classification', 'Bank', 'Debit (DR)', 'Credit (CR)', 'Balance', 'Description'];
    return { data, headers, title: 'General Ledger' };
}

export async function getPersonalLedgerData(cooperativeId, memberId) {
    const sql = `
        SELECT 
            r.id as remittance_id,
            r.remittance_date,
            e.account_name,
            e.account_type,
            rd.amount,
            r.transaction_type,
            r.description
        FROM remittance r
        JOIN remittance_detail rd ON r.id = rd.remittance_id
        LEFT JOIN enterprise e ON rd.enterprise_id = e.id
        WHERE r.cooperative_id = ? 
        AND r.member_id = ?
        AND r.status = 'Approved' AND r.is_deleted = 0
        ORDER BY r.remittance_date ASC, r.id ASC
    `;

    const rows = await queryRows(sql, [cooperativeId, memberId]);

    let runningBalance = 0;
    const data = rows.map((row, idx) => {
        runningBalance += row.amount;
        // DR/CR follows the account's normal balance: savings/liability and
        // revenue balances grow on the credit side; loans/assets/expenses on
        // the debit side (same convention as the General Ledger).
        const type = (row.account_type || '').toLowerCase();
        const creditNormal = !(type === 'asset' || type === 'loan' || type === 'expense');
        const amt = parseFloat(row.amount || 0);
        return [
            idx + 1,
            formatDate(row.remittance_date),
            row.account_name || 'N/A',
            row.transaction_type || 'N/A',
            creditNormal ? (amt > 0 ? amt : '') : (amt < 0 ? -amt : ''),
            creditNormal ? (amt < 0 ? -amt : '') : (amt > 0 ? amt : ''),
            runningBalance,
            row.description || ''
        ];
    });

    const headers = ['S/N', 'Date', 'Account', 'Type', 'Debit (DR)', 'Credit (CR)', 'Balance', 'Description'];

    let memberName = '';
    const useSpecialId = localStorage.getItem('useSpecialIdInReports') === 'true';
    const member = await queryRows('SELECT last_name, first_name, middle_name, registration_no, special_id FROM members WHERE id = ?', [memberId]);
    if (member.length > 0) {
        memberName = [member[0].last_name, member[0].first_name, member[0].middle_name].filter(Boolean).join(' ');
        const memberIdStr = useSpecialId ? (member[0].special_id || String(member[0].registration_no).padStart(4, '0')) : String(member[0].registration_no).padStart(4, '0');
        memberName += ` (${useSpecialId ? 'Member ID' : 'Reg No'}: ${memberIdStr})`;
    }

    return { data, headers, title: `Personal Ledger - ${memberName}` };
}
