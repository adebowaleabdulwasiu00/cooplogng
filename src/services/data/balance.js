import { getRemittances, queryRows } from '../sqliteService.js'

export async function buildAccountBalance(cooperativeId, user = null, limitRid = null) {
    const remittances = await getRemittances(cooperativeId, user)
    const enterpriseRows = await queryRows(
        'SELECT * FROM enterprise WHERE cooperative_id = ? AND is_deleted = 0',
        [String(cooperativeId)]
    )
    const entMap = {}
    const entRevenueMap = {}
    for (const ent of enterpriseRows) {
        entMap[ent.id] = ent.account_name
        entRevenueMap[ent.id] = (ent.revenue == 1 || ent.revenue === '1' || ent.revenue === 'true' || ent.revenue === true)
    }
    const balances = {}
    const isMemberQuery = user && user.memberId && user.memberId !== '0000000000'
    for (const rem of remittances) {
        if (rem.status !== 'Approved') continue
        if (isMemberQuery && rem.member_id !== user.memberId) continue
        if (limitRid !== null && (rem.r_id || 0) >= limitRid) continue
        const details = rem.details || []
        for (const d of details) {
            const eid = d.enterprise_id
            if (isMemberQuery && entRevenueMap[eid]) continue
            if (!balances[eid]) balances[eid] = 0
            balances[eid] += parseFloat(d.amount || 0)
        }
    }
    const accountBalance = Object.entries(balances).map(([id, sum_of_amount]) => ({
        id,
        account_name: entMap[id] || 'Unknown',
        sum_of_amount
    }))
    return { accountBalance }
}

export async function buildMemberLedger(cooperativeId, memberId, user = null, limitRid = null) {
    const remittances = await getRemittances(cooperativeId, user)
    const enterpriseRows = await queryRows(
        'SELECT * FROM enterprise WHERE cooperative_id = ? AND is_deleted = 0',
        [String(cooperativeId)]
    )
    const entMap = {}
    const entRevenueMap = {}
    for (const ent of enterpriseRows) {
        entMap[ent.id] = ent.account_name
        entRevenueMap[ent.id] = (ent.revenue == 1 || ent.revenue === '1' || ent.revenue === 'true' || ent.revenue === true)
    }
    const memberRemits = remittances.filter(r => r.member_id === memberId && r.status === 'Approved')
    let runningTotal = 0
    const ledgerEntries = []
    for (const rem of memberRemits) {
        if (limitRid !== null && (rem.r_id || 0) > limitRid) continue
        const details = rem.details || []
        for (const d of details) {
            if (entRevenueMap[d.enterprise_id]) continue
            const amount = parseFloat(d.amount || 0)
            runningTotal += amount
            ledgerEntries.push({
                id: d.id,
                remittance_id: rem.id,
                remittance_date: rem.remittance_date,
                enterprise_id: d.enterprise_id,
                enterprise_name: entMap[d.enterprise_id] || 'Unknown',
                amount,
                running_balance: runningTotal,
                description: rem.description || '',
                status: rem.status
            })
        }
    }
    return { ledgerEntries, totalNetworth: runningTotal }
}
