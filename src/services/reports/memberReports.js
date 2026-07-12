import { queryRows } from '../sqliteService.js';
import { fetchAllMembers, fetchEnterprises } from '../dataService.js';
import { formatDate } from '../../utils/formatters.js';

export async function getMemberListData(cooperativeId, user, filters = {}) {
    const { status, selectedFields } = filters;
    const isAdmin = user.role === 'admin' || (user.permissions || '').includes('admin');
    const members = await fetchAllMembers(cooperativeId, user.username, isAdmin);

    let filtered = members;
    if (status && status !== 'All') {
        filtered = members.filter(m => m.status === status);
    }

    const data = filtered.map((m, idx) => {
        const row = { 'S/N': idx + 1 };
        if (selectedFields.includes('short_name')) {
            const last = m.last_name || '';
            const fInit = String(m.first_name || '').charAt(0);
            const mInit = String(m.middle_name || '').charAt(0);
            row['Short Name'] = `${last} ${fInit}${fInit ? '.' : ''}${mInit}${mInit ? '.' : ''}`.trim();
        }
        if (selectedFields.includes('full_name')) row['Full Name'] = `${m.last_name || ''} ${m.first_name || ''} ${m.middle_name || ''}`.trim();
        if (selectedFields.includes('registration_no')) row['Reg No'] = m.registration_no ? String(m.registration_no).padStart(4, '0') : '';
        if (selectedFields.includes('mobile')) row['Mobile'] = m.mobile || '';
        if (selectedFields.includes('sex')) row['Sex'] = m.sex || '';
        if (selectedFields.includes('status')) row['Status'] = m.status || '';
        if (selectedFields.includes('date_joined')) {
            row['Date Joined'] = formatDate(m.date_joined);
        }
        if (selectedFields.includes('address')) row['Address'] = m.address || '';
        if (selectedFields.includes('account_manager')) row['Account Manager'] = m.account_manager || '';
        return row;
    });

    const headers = ['S/N'];

    if (selectedFields.includes('short_name')) headers.push('Short Name');
    else if (selectedFields.includes('full_name')) headers.push('Full Name');

    const remainingFields = {
        registration_no: 'Reg No',
        mobile: 'Mobile',
        sex: 'Sex',
        status: 'Status',
        date_joined: 'Date Joined',
        address: 'Address',
        account_manager: 'Account Manager'
    };

    Object.keys(remainingFields).forEach(key => {
        if (selectedFields.includes(key)) {
            headers.push(remainingFields[key]);
        }
    });

    return { data, headers };
}

export async function getPaymentAdviseData(cooperativeId) {
    const enterprises = await fetchEnterprises(cooperativeId, true);
    const loans = enterprises.filter(e => (e.account_type || '').toLowerCase() === 'loan').sort((a, b) => a.account_name.localeCompare(b.account_name));
    const savings = enterprises.filter(e => (e.account_type || '').toLowerCase() === 'savings').sort((a, b) => a.account_name.localeCompare(b.account_name));
    const others = enterprises.filter(e => !loans.includes(e) && !savings.includes(e)).sort((a, b) => a.account_name.localeCompare(b.account_name));
    const orderedEnts = [...loans, ...savings, ...others];

    const useSpecialId = localStorage.getItem('useSpecialIdInReports') === 'true';
    const headers = ["S/N", useSpecialId ? "Member ID" : "Reg No", ...orderedEnts.map(e => e.account_name), "Total"];

    const sql = `
        SELECT pa.member_id as id, m.registration_no, m.special_id, pa.enterprise_id, SUM(pa.amount) as total
        FROM payment_advise pa
        JOIN members m ON m.id = pa.member_id
        WHERE pa.cooperative_id = ?
          AND pa.is_deleted = 0 AND m.is_deleted = 0
        GROUP BY pa.member_id, pa.enterprise_id
    `;
    const rows = await queryRows(sql, [cooperativeId]);
    const byMember = {};
    const regMap = {};
    const specialIdMap = {};
    rows.forEach(r => {
        if (!byMember[r.id]) byMember[r.id] = {};
        byMember[r.id][r.enterprise_id] = r.total;
        regMap[r.id] = r.registration_no;
        specialIdMap[r.id] = r.special_id;
    });

    const data = [];
    const entTotals = new Array(orderedEnts.length).fill(0);
    const sortedIds = Object.keys(byMember).sort((a, b) => (regMap[a] || 0) - (regMap[b] || 0));

    sortedIds.forEach((mid, idx) => {
        const memberId = useSpecialId ? (specialIdMap[mid] || String(regMap[mid] || '').padStart(4, '0')) : String(regMap[mid] || '').padStart(4, '0');
        const row = [idx + 1, memberId];
        let rowTotal = 0;
        orderedEnts.forEach((ent, eIdx) => {
            const val = byMember[mid][ent.id] || 0;
            row.push(val);
            rowTotal += val;
            entTotals[eIdx] += val;
        });
        row.push(rowTotal);
        data.push(row);
    });

    if (data.length > 0) {
        const totalRow = ["TOTAL", "", ...entTotals, entTotals.reduce((a, b) => a + b, 0)];
        data.push(totalRow);
    }

    return { data, headers };
}

export async function getMemberPerformanceAgingData(cooperativeId) {
    const members = await fetchAllMembers(cooperativeId, null, true);
    const enterprises = await fetchEnterprises(cooperativeId, true);
    const loans = enterprises.filter(e => (e.account_type || '').toLowerCase() === 'loan');

    const data = [];
    let idx = 1;
    const useSpecialId = localStorage.getItem('useSpecialIdInReports') === 'true';

    for (const member of members) {
        for (const loan of loans) {
            const sql = `
                SELECT r.remittance_date, rd.amount
                FROM remittance_detail rd
                JOIN remittance r ON rd.remittance_id = r.id
                WHERE rd.enterprise_id = ?
                  AND r.member_id = ?
                  AND r.status = 'Approved' AND r.is_deleted = 0 AND rd.is_deleted = 0
            `;
            const results = await queryRows(sql, [loan.id, member.id]);

            let outstanding = 0;
            results.forEach(row => {
                outstanding += parseFloat(row.amount || 0);
            });

            if (outstanding < -0.01) {
                const absOutstanding = Math.abs(outstanding);

                let minDate = new Date();
                results.forEach(row => {
                    if (parseFloat(row.amount || 0) < 0) {
                        const d = new Date(row.remittance_date);
                        if (d < minDate) minDate = d;
                    }
                });

                const diffTime = Math.abs(new Date() - minDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                let bucket1 = '';
                let bucket2 = '';
                let bucket3 = '';
                let bucket4 = '';

                if (diffDays < 30) bucket1 = absOutstanding;
                else if (diffDays < 60) bucket2 = absOutstanding;
                else if (diffDays < 90) bucket3 = absOutstanding;
                else bucket4 = absOutstanding;

                const memberIdStr = useSpecialId ? (member.special_id || String(member.registration_no).padStart(4, '0')) : String(member.registration_no).padStart(4, '0');

                data.push([
                    idx++,
                    memberIdStr,
                    `${member.last_name || ''} ${member.first_name || ''} ${member.middle_name || ''}`.trim(),
                    member.status || 'Active',
                    loan.account_name,
                    bucket1,
                    bucket2,
                    bucket3,
                    bucket4,
                    absOutstanding
                ]);
            }
        }
    }

    const headers = ['S/N', useSpecialId ? 'Member ID' : 'Reg No', 'Member Name', 'Status', 'Loan Account', 'Current (<30)', '30-60 Days', '60-90 Days', 'Over 90 Days', 'Total Outstanding'];
    return { data, headers, title: 'Member Performance & Aging Report' };
}
