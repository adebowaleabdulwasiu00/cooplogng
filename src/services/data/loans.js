import { generateId } from '../../utils/formatters.js'
import {
    getDocById_Global, queryRows, saveDoc, enqueueWrite,
    getTransactionTypes, getMaxRid, runSql
} from '../sqliteService.js'
import { addRemittance } from './remittances.js'

export async function fetchGuarantorStats(memberId, cooperativeId) {
    const { getGuarantorStatsLocal } = await import('../sqliteService.js')
    return getGuarantorStatsLocal(memberId, cooperativeId)
}

export async function fetchPendingGuarantorRequests(memberId) {
    const { getPendingGuarantorRequestsLocal } = await import('../sqliteService.js')
    return getPendingGuarantorRequestsLocal(memberId)
}

export async function approveGuarantorRequest(loanId, guarantorId, approvedBy) {
    const now = new Date().toISOString()
    try {
        await runSql(
            'UPDATE loan_guarantors SET guarantor_approval = ?, modified_at = ?, modified_by = ? WHERE id = ?',
            [1, now, approvedBy, guarantorId]
        )
    } catch (e) {
        console.warn('[dataService] Failed to update local loan_guarantors table:', e.message)
    }
    const loans = await queryRows(
        'SELECT * FROM loans WHERE remittance_id = ? AND is_deleted = 0',
        [loanId]
    )
    let found = false
    for (const loan of loans) {
        const guarantors = (await queryRows(
            'SELECT * FROM loan_guarantors WHERE loan_id = ? AND is_deleted = 0',
            [loan.id]
        )).map(g => {
            if (String(g.id) === String(guarantorId)) {
                found = true
                return { ...g, guarantor_approval: 1, modified_at: now, modified_by: approvedBy, approved_at: now }
            }
            return g
        })
        if (found) {
            await saveDoc('loans', { ...loan, guarantors, modified_at: now, modified_by: approvedBy })
            const remittance = await getDocById_Global('remittance', loan.remittance_id)
            if (remittance) {
                await enqueueWrite(remittance.cooperative_id, 'remittance', loan.remittance_id, 'update', {
                    loans: [{ ...loan, guarantors }],
                    modified_at: now,
                    modified_by: approvedBy
                })
            }
            break
        }
    }
    if (!found) throw new Error('No matching guarantor found for this loan record.')
}

export async function approveLoanRequest(remittanceId, approvedBy, options = {}) {
    const now = new Date().toISOString()
    const remittance = await getDocById_Global('remittance', remittanceId)
    if (!remittance) throw new Error('Remittance not found')

    const cooperativeId = remittance.cooperative_id
    const { remittance_date, bank_name, charges: userCharges } = options

    let parentCategory = remittance.category
    try {
        const types = await getTransactionTypes(String(cooperativeId))
        const tt = types.find(t => t.transaction_type === 'Member Loan')
        if (tt && tt.classification) {
            parentCategory = tt.classification
        }
    } catch (e) {
        console.error('[approveLoanRequest] Error fetching Member Loan classification:', e)
    }

    const remitUpdate = {
        ...remittance,
        status: 'Approved',
        transaction_type: 'Member Loan',
        category: parentCategory || 'Loan Asset',
        r_id: remittance.r_id || 0,
        modified_at: now,
        modified_by: approvedBy,
        is_synced: 0
    }
    if (remittance_date) remitUpdate.remittance_date = remittance_date
    if (bank_name) remitUpdate.bank_name = bank_name
    await saveDoc('remittance', remitUpdate)
    await enqueueWrite(cooperativeId, 'remittance', remittanceId, 'update', {
        status: 'Approved',
        modified_at: now,
        modified_by: approvedBy
    })

    const loans = await queryRows(
        'SELECT * FROM loans WHERE (id = ? OR remittance_id = ?) AND cooperative_id = ? AND is_deleted = 0',
        [remittanceId, remittanceId, cooperativeId]
    )
    const baseRid = await getMaxRid(cooperativeId)
    let chargeIndex = 0

    for (const loan of loans) {
        if (loan.status === 'Active') continue

        const duration = parseInt(loan.duration_months) || 0
        let dueDate = loan.due_date
        let issuedDate = loan.issued_date
        if (remittance_date) {
            issuedDate = remittance_date
            const issueD = new Date(remittance_date)
            if (!isNaN(issueD.getTime())) {
                issueD.setMonth(issueD.getMonth() + duration)
                dueDate = issueD.toISOString()
            }
        }

        await saveDoc('loans', {
            ...loan,
            status: 'Active',
            issued_date: issuedDate,
            due_date: dueDate,
            modified_at: now,
            modified_by: approvedBy,
            is_synced: 0
        })

        const guarantors = await queryRows(
            'SELECT * FROM loan_guarantors WHERE loan_id = ? AND is_deleted = 0',
            [loan.id]
        )
        for (const g of guarantors) {
            await saveDoc('loan_guarantors', {
                ...g,
                modified_at: now,
                modified_by: approvedBy,
                is_synced: 0
            })
        }

        if (userCharges && Array.isArray(userCharges) && userCharges.length > 0) {
            let chargeCategory = 'Loan Income'
            try {
                const types = await getTransactionTypes(String(cooperativeId))
                const tt = types.find(t => t.transaction_type === 'Loan Charges')
                if (tt && tt.classification) {
                    chargeCategory = tt.classification
                }
            } catch (e) {
                console.error('[approveLoanRequest] Error fetching Loan Charges classification:', e)
            }
            const principalAmount = Math.abs(parseFloat(loan.principal_amount || 0))
            for (const charge of userCharges) {
                let val = parseFloat(charge.value) || 0
                if (charge.type === 'percentage') {
                    val = (val / 100) * principalAmount
                }
                if (val > 0) {
                    chargeIndex++
                    const chargeId = `${remittanceId}-CHARGE-${chargeIndex}`
                    const chargeDate = remittance_date || remittance.remittance_date
                    await addRemittance({
                        id: chargeId,
                        cooperative_id: cooperativeId,
                        member_id: loan.member_id || remittance.member_id,
                        amount: -val,
                        remittance_date: chargeDate,
                        bank_name: 'Internal Transfer',
                        transaction_type: 'Loan Charges',
                        category: chargeCategory,
                        description: `Loan Charge: ${charge.name}`,
                        autogen: 1,
                        loan_id: loan.id || remittanceId,
                        status: 'Approved',
                        r_id: baseRid + chargeIndex,
                        details: [{
                            id: `${chargeId}_detail`,
                            enterprise_id: loan.enterprise_id,
                            amount: -val,
                            notes: charge.name,
                            auto_description: charge.name
                        }]
                    }, approvedBy)
                }
            }
        }

        if (loan.duration_months > 0 && loan.principal_amount > 0) {
            const { saveDoc: saveAdvice, queryRows: queryAdvice, loadDoc } = await import('../sqliteService.js')
            const monthlyInst = Math.ceil((loan.principal_amount / loan.duration_months) / 100) * 100
            const advises = await queryAdvice(
                'SELECT * FROM payment_advise WHERE cooperative_id = ? AND member_id = ? AND enterprise_id = ? AND is_deleted = 0',
                [String(cooperativeId), loan.member_id, loan.enterprise_id]
            )
            const adviceDoc = {
                id: advises[0]?.id || generateId(cooperativeId),
                cooperative_id: cooperativeId,
                member_id: String(loan.member_id),
                enterprise_id: String(loan.enterprise_id),
                amount: monthlyInst,
                created_at: advises[0]?.created_at || now,
                created_by: advises[0]?.created_by || approvedBy || 'system',
                modified_at: now,
                modified_by: approvedBy || 'system',
                is_deleted: 0,
                is_synced: 0
            }
            await saveAdvice('payment_advise', adviceDoc)
        }
    }
}

export async function declineLoanRequest(remittanceId, declinedBy) {
    const now = new Date().toISOString()
    try {
        const target = await getDocById_Global('remittance', remittanceId)
        if (!target) throw new Error('Remittance not found')

        if (target.status !== 'Declined') {
            await saveDoc('remittance', {
                ...target,
                status: 'Declined',
                modified_at: now,
                modified_by: declinedBy,
                is_synced: 0
            })
            await enqueueWrite(target.cooperative_id, 'remittance', target.id, 'update', {
                status: 'Declined',
                modified_at: now,
                modified_by: declinedBy
            })
        }

        const loans = await queryRows(
            'SELECT * FROM loans WHERE (id = ? OR remittance_id = ?) AND cooperative_id = ? AND is_deleted = 0',
            [remittanceId, remittanceId, target.cooperative_id]
        )
        for (const loan of loans) {
            if (loan.status === 'Declined') continue
            await saveDoc('loans', {
                ...loan,
                status: 'Declined',
                modified_at: now,
                modified_by: declinedBy,
                is_synced: 0
            })

            const guarantors = await queryRows(
                'SELECT * FROM loan_guarantors WHERE loan_id = ? AND is_deleted = 0',
                [loan.id]
            )
            for (const g of guarantors) {
                await saveDoc('loan_guarantors', {
                    ...g,
                    guarantor_approval: 0,
                    modified_at: now,
                    modified_by: declinedBy,
                    is_synced: 0
                })
            }
        }
    } catch (e) {
        console.error('[declineLoanRequest] Error:', e)
        throw e
    }
}
