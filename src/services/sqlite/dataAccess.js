import { getAllItems, getAllByIndex, getItem } from '../indexedDbService.js'
export async function getAllForCoop(cooperativeId, tableName) {
    let results
    if (tableName === 'cooperatives') {
        const item = await getItem('cooperatives', String(cooperativeId))
        results = item && !item.is_deleted ? [item] : []
    } else {
        try {
            results = await getAllByIndex(tableName, 'cooperative_id', String(cooperativeId))
            if (!results || results.length === 0) {
                const all = await getAllItems(tableName)
                if (all.length > 0) {
                    results = all.filter(r => r.cooperative_id === String(cooperativeId) && !r.is_deleted)
                }
            } else {
                results = results.filter(r => !r.is_deleted)
            }
        } catch (e) {
            const all = await getAllItems(tableName)
            results = all.filter(r => r.cooperative_id === String(cooperativeId) && !r.is_deleted)
        }
    }
    if (tableName === 'members') {
        // Bulk-fetch payment_advise once (1 read) instead of one query per
        // member (N reads). Same resulting attachment per member.
        let adviseByMember = null
        try {
            const allAdvise = await getAllItems('payment_advise')
            adviseByMember = {}
            for (const p of allAdvise) {
                if (p.is_deleted) continue
                const mid = String(p.member_id || '')
                if (!mid) continue
                if (!adviseByMember[mid]) adviseByMember[mid] = []
                adviseByMember[mid].push(p)
            }
        } catch (e) {
            adviseByMember = null
        }
        for (const member of results) {
            member.name = `${member.first_name || ''} ${member.last_name || ''}`.trim()
            if (adviseByMember) {
                member.payment_advise = adviseByMember[String(member.id)] || []
            } else {
                // Fallback: per-member query (slow path, same result)
                try {
                    member.payment_advise = await getAllByIndex('payment_advise', 'member_id', member.id)
                    member.payment_advise = member.payment_advise.filter(p => !p.is_deleted)
                } catch (e) {
                    member.payment_advise = []
                }
            }
        }
    }
    return results
}

export async function getDocById(cooperativeId, tableName, id) {
    const doc = await getItem(tableName, String(id))
    if (!doc || doc.cooperative_id !== String(cooperativeId) || doc.is_deleted) return null
    return doc
}

export async function getDocById_Global(tableName, id) {
    const doc = await getItem(tableName, String(id))
    if (!doc) return null
    if (tableName === 'members' && !doc.name) {
        doc.name = `${doc.first_name || ''} ${doc.last_name || ''}`.trim()
    }
    return doc
}

export async function checkMemberHasRemittances(cooperativeId, memberId) {
    if (!memberId || String(memberId) === 'undefined' || String(memberId) === 'null') return false
    let rems
    try {
        rems = await getAllByIndex('remittance', 'member_id', String(memberId))
        if (!rems || rems.length === 0) {
            const all = await getAllItems('remittance')
            if (all.length > 0) {
                rems = all.filter(r => r.member_id === String(memberId))
            }
        }
    } catch (e) {
        const all = await getAllItems('remittance')
        rems = all.filter(r => r.member_id === String(memberId))
    }
    return rems.some(r => !r.is_deleted)
}

export async function getUserByUsername(username) {
    const allUsers = await getAllItems('users')
    return allUsers.find(u => u.username === username && !u.is_deleted) || null
}

export async function getUsersByUsername(cooperativeId, username) {
    const normalized = String(username).toLowerCase()
    let allUsers
    try {
        allUsers = await getAllByIndex('users', 'cooperative_id', String(cooperativeId))
        if (!allUsers || allUsers.length === 0) {
            const all = await getAllItems('users')
            if (all.length > 0) {
                allUsers = all.filter(u => u.cooperative_id === String(cooperativeId))
            }
        }
    } catch (e) {
        allUsers = await getAllItems('users')
        allUsers = allUsers.filter(u => u.cooperative_id === String(cooperativeId))
    }
    return allUsers.filter(u => !u.is_deleted && String(u.username || '').toLowerCase() === normalized)
}

export async function getMemberByMobile(cooperativeId, mobile) {
    const normalized = String(mobile).toLowerCase()
    let allMembers
    try {
        allMembers = await getAllByIndex('members', 'cooperative_id', String(cooperativeId))
        if (!allMembers || allMembers.length === 0) {
            const all = await getAllItems('members')
            if (all.length > 0) {
                allMembers = all.filter(m => m.cooperative_id === String(cooperativeId))
            }
        }
    } catch (e) {
        allMembers = await getAllItems('members')
        allMembers = allMembers.filter(m => m.cooperative_id === String(cooperativeId))
    }
    return allMembers.filter(m => !m.is_deleted && String(m.mobile || '').toLowerCase() === normalized)
}

export async function getMemberByRegistrationNo(cooperativeId, registrationNo) {
    const normalized = String(registrationNo).toLowerCase()
    let allMembers
    try {
        allMembers = await getAllByIndex('members', 'cooperative_id', String(cooperativeId))
        if (!allMembers || allMembers.length === 0) {
            const all = await getAllItems('members')
            if (all.length > 0) {
                allMembers = all.filter(m => m.cooperative_id === String(cooperativeId))
            }
        }
    } catch (e) {
        allMembers = await getAllItems('members')
        allMembers = allMembers.filter(m => m.cooperative_id === String(cooperativeId))
    }
    return allMembers.filter(m =>
        !m.is_deleted && (
            String(m.registration_no || '').toLowerCase() === normalized ||
            String(m.special_id || '').toLowerCase() === normalized
        )
    )
}

export async function getUserByEmail(cooperativeId, email) {
    const normalized = String(email).toLowerCase()
    let allUsers
    try {
        allUsers = await getAllByIndex('users', 'cooperative_id', String(cooperativeId))
        if (!allUsers || allUsers.length === 0) {
            const all = await getAllItems('users')
            if (all.length > 0) {
                allUsers = all.filter(u => u.cooperative_id === String(cooperativeId))
            }
        }
    } catch (e) {
        allUsers = await getAllItems('users')
        allUsers = allUsers.filter(u => u.cooperative_id === String(cooperativeId))
    }
    return allUsers.filter(u => !u.is_deleted && String(u.email || '').toLowerCase() === normalized)
}

export async function getMemberByEmail(cooperativeId, email) {
    const normalized = String(email).toLowerCase()
    let allMembers
    try {
        allMembers = await getAllByIndex('members', 'cooperative_id', String(cooperativeId))
        if (!allMembers || allMembers.length === 0) {
            const all = await getAllItems('members')
            if (all.length > 0) {
                allMembers = all.filter(m => m.cooperative_id === String(cooperativeId))
            }
        }
    } catch (e) {
        allMembers = await getAllItems('members')
        allMembers = allMembers.filter(m => m.cooperative_id === String(cooperativeId))
    }
    return allMembers.filter(m => !m.is_deleted && String(m.email || '').toLowerCase() === normalized)
}

export async function getGuarantorStatsLocal(memberId, cooperativeId) {
    const allLoans = await getAllItems('loans')
    const allGuarantors = await getAllItems('loan_guarantors')
    const myGuarantors = allGuarantors.filter(g =>
        g.member_id === String(memberId) &&
        !g.is_deleted
    )
    let totalCount = 0, totalSum = 0
    let activeCount = 0, activeSum = 0, overdueCount = 0
    for (const g of myGuarantors) {
        const loan = allLoans.find(l => l.id === g.loan_id && !l.is_deleted)
        if (!loan || loan.status === 'Declined') continue
        totalCount++
        totalSum += Number(g.guarantee_amount) || 0
        if (loan.status === 'Active' || loan.status === 'Overdue') {
            activeCount++
            activeSum += Number(g.guarantee_amount) || 0
            if (loan.status === 'Overdue') overdueCount++
        }
    }
    return { totalCount, totalSum, activeCount, activeSum, overdueCount }
}

export async function getPendingGuarantorRequestsLocal(memberId) {
    const allLoans = await getAllItems('loans')
    const allGuarantors = await getAllItems('loan_guarantors')
    const results = []
    for (const g of allGuarantors) {
        if (g.member_id === String(memberId) && !g.is_deleted) {
            const approval = g.guarantor_approval
            if (approval === null || approval === '' || approval === 2 || approval === '2') {
                const loan = allLoans.find(l => l.id === g.loan_id && !l.is_deleted)
                if (loan && loan.status !== 'Declined') {
                    results.push({
                        ...g,
                        loanee_id: loan.member_id,
                        principal_amount: loan.principal_amount,
                        issued_date: loan.issued_date,
                        due_date: loan.due_date,
                        remittance_id: loan.remittance_id
                    })
                }
            }
        }
    }
    return results
}

export async function getMemberLoans(cooperativeId, memberId = null) {
    let loans
    try {
        loans = await getAllByIndex('loans', 'cooperative_id', String(cooperativeId))
        if (!loans || loans.length === 0) {
            const all = await getAllItems('loans')
            if (all.length > 0) {
                loans = all.filter(l => l.cooperative_id === String(cooperativeId))
            }
        }
    } catch (e) {
        const all = await getAllItems('loans')
        loans = all.filter(l => l.cooperative_id === String(cooperativeId))
    }
    loans = loans.filter(l => !l.is_deleted)

    if (memberId && memberId !== '0000000000') {
        loans = loans.filter(l => l.member_id === String(memberId))
    }

    loans.sort((a, b) => String(b.issued_date).localeCompare(String(a.issued_date)))

    const enterprises = await getAllItems('enterprise')
    const entMap = {}
    for (const e of enterprises) entMap[e.id] = e.account_name

    const members = await getAllItems('members')
    const memberMap = {}
    for (const m of members) memberMap[m.id] = m

    const allRems = await getAllItems('remittance')
    const allDetails = await getAllItems('remittance_detail')
    const allGuarantors = await getAllItems('loan_guarantors')

    const remMap = {}
    for (const rem of allRems) remMap[rem.id] = rem

    const entBal = {}
    for (const d of allDetails) {
        if (d.is_deleted) continue
        const rem = remMap[d.remittance_id]
        if (!rem || rem.status !== 'Approved' || rem.is_deleted) continue
        const entId = d.enterprise_id || d.item || ''
        if (!memberId || memberId === '0000000000') {
            const key = `${rem.member_id}_${entId}`
            entBal[key] = (entBal[key] || 0) + (Number(d.amount) || 0)
        } else if (rem.member_id === String(memberId)) {
            const key = `${memberId}_${entId}`
            entBal[key] = (entBal[key] || 0) + (Number(d.amount) || 0)
        }
    }

    const loansByME = {}
    for (const loan of loans) {
        const k = `${loan.member_id}_${loan.enterprise_id}`
        if (!loansByME[k]) loansByME[k] = []
        loansByME[k].push(loan)
    }

    for (const loan of loans) {
        loan.enterprise_name = entMap[loan.enterprise_id] || ''
        const member = memberMap[loan.member_id]
        if (member) {
            loan.member_name = `${member.first_name || ''} ${member.last_name || ''}`.trim()
            loan.member_registration_no = member.registration_no || ''
        }

        const k = `${loan.member_id}_${loan.enterprise_id}`
        const group = loansByME[k] || []
        const latest = group.reduce((a, b) =>
            String(a.issued_date || '') > String(b.issued_date || '') ? a : b
        )

        loan.outstanding_balance = loan.id === latest.id ? (entBal[k] || 0) : 0
        loan.guarantors = allGuarantors.filter(g => g.loan_id === loan.id && !g.is_deleted)
    }

    return loans
}
