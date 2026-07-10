import { generateId, generateRemittanceId } from '../../utils/formatters.js'
import {
    getRemittances, getRemittancesPage, getMaxRid,
    getTransactionTypes, saveDoc, getDocById_Global,
    queryRows, enqueueWrite
} from '../sqliteService.js'

export async function fetchRemittances(cooperativeId, user = null) {
    return getRemittances(cooperativeId, user)
}

export async function fetchRemittancesPage(cooperativeId, user = null, offset = 0, limitCount = 100, options = null) {
    return getRemittancesPage(cooperativeId, user, offset, limitCount, options)
}

export async function getNextRemittanceRid(cooperativeId) {
    const max = await getMaxRid(cooperativeId);
    return Number(max) + 1;
}

export async function fetchTransactionTypes(cooperativeId) {
    return getTransactionTypes(cooperativeId)
}

export async function addRemittance(data, createdBy) {
    const now = new Date().toISOString()
    const id = data.id || generateRemittanceId(String(data.cooperative_id), data.autogen)

    let category = data.category || '';
    if (!category && data.transaction_type && data.cooperative_id) {
        try {
            const types = await getTransactionTypes(String(data.cooperative_id));
            const tt = types.find(t => t.transaction_type === data.transaction_type);
            if (tt && tt.classification) {
                category = tt.classification;
            }
        } catch (e) { }
    }

    const doc = {
        id,
        cooperative_id: String(data.cooperative_id),
        member_id: data.member_id || '0000000000',
        amount: parseFloat(data.amount || 0),
        remittance_date: data.remittance_date || now,
        bank_name: data.bank_name || '',
        transaction_type: data.transaction_type || '',
        description: data.description || '',
        status: data.status || 'Pending',
        category,
        r_id: data.r_id || 0,
        cheque_number: data.cheque_number || '',
        recipient_id: data.recipient_id || '',
        loan_id: data.loan_id || null,
        autogen: data.autogen || 0,
        created_at: now,
        created_by: createdBy || 'system',
        modified_at: now,
        modified_by: createdBy || 'system',
        is_deleted: 0,
        is_synced: 0
    }
    if (data.details) {
        doc.details = data.details.map(d => ({
            id: d.id || generateId(String(data.cooperative_id)),
            remittance_id: id,
            cooperative_id: String(data.cooperative_id),
            enterprise_id: String(d.enterprise_id || d.item || ''),
            amount: parseFloat(d.amount || 0),
            notes: d.notes || '',
            auto_description: d.auto_description || '',
            created_at: now,
            created_by: createdBy || 'system',
            modified_at: now,
            modified_by: createdBy || 'system',
            is_deleted: 0,
            is_synced: 0
        }))
    }

    let loansList = data.loans;
    if (!loansList && data.details) {
        loansList = [];
        data.details.forEach(d => {
            if (d.loan_info) {
                const lInfo = d.loan_info;
                const loanData = lInfo.loanData || {};
                loansList.push({
                    id: lInfo.id || generateId(String(data.cooperative_id)),
                    member_id: data.member_id || '0000000000',
                    enterprise_id: d.enterprise_id || d.item || '',
                    principal_amount: Math.abs(parseFloat(loanData.principalAmount || loanData.principal_amount || 0)),
                    issued_date: loanData.issueDate || loanData.issued_date || data.remittance_date || now,
                    due_date: loanData.dueDate || loanData.due_date || '',
                    status: loanData.status || 'Pending',
                    notes: loanData.notes || '',
                    duration_months: parseInt(loanData.durationMonths || loanData.duration_months || 0, 10),
                    guarantors: (lInfo.guarantors || []).map(g => ({
                        id: g.id,
                        member_id: g.member_id,
                        guarantee_amount: parseFloat(g.guarantee_amount || g.amount || 0),
                        guarantor_approval: g.guarantor_approval !== undefined ? g.guarantor_approval : null
                    }))
                });
            }
        });
    }

    if (loansList && loansList.length > 0) {
        doc.loans = loansList.map(l => ({
            id: l.id || generateId(String(data.cooperative_id)),
            cooperative_id: String(data.cooperative_id),
            member_id: l.member_id || data.member_id || '0000000000',
            enterprise_id: l.enterprise_id || '',
            principal_amount: Math.abs(parseFloat(l.principal_amount || 0)),
            issued_date: l.issued_date || now,
            due_date: l.due_date || '',
            status: l.status || 'Pending',
            notes: l.notes || '',
            remittance_id: id,
            duration_months: l.duration_months || 0,
            admin_fee_id: l.admin_fee_id || null,
            created_at: now,
            created_by: createdBy || 'system',
            modified_at: now,
            modified_by: createdBy || 'system',
            is_deleted: 0,
            is_synced: 0,
            guarantors: (l.guarantors || []).map(g => ({
                id: g.id || generateId(String(data.cooperative_id)),
                cooperative_id: String(data.cooperative_id),
                member_id: String(g.member_id),
                guarantee_amount: parseFloat(g.guarantee_amount || g.amount || 0),
                guarantor_approval: g.guarantor_approval !== undefined ? g.guarantor_approval : null,
                created_at: now,
                created_by: createdBy || 'system',
                modified_at: now,
                modified_by: createdBy || 'system',
                is_deleted: 0,
                is_synced: 0
            }))
        }))
    }
    await saveDoc('remittance', doc)
    return { id }
}

export async function updateRemittance(id, data, modifiedBy) {
    const existing = await getDocById_Global('remittance', id)
    if (!existing) throw new Error('Remittance not found')
    const now = new Date().toISOString()
    const doc = {
        ...existing,
        ...data,
        id: existing.id,
        modified_at: now,
        modified_by: modifiedBy || 'system',
        is_synced: 0
    }
    delete doc.details
    delete doc.loans
    if (data.details) {
        doc.details = data.details.map(d => ({
            id: d.id || generateId(String(existing.cooperative_id)),
            remittance_id: id,
            cooperative_id: String(existing.cooperative_id),
            enterprise_id: String(d.enterprise_id || d.item || ''),
            amount: parseFloat(d.amount || 0),
            notes: d.notes || '',
            auto_description: d.auto_description || '',
            created_at: d.created_at || now,
            created_by: d.created_by || modifiedBy || 'system',
            modified_at: now,
            modified_by: modifiedBy || 'system',
            is_deleted: d.is_deleted || 0,
            is_synced: 0
        }))
    }

    let loansList = data.loans;
    if (!loansList && data.details) {
        loansList = [];
        data.details.forEach(d => {
            if (d.loan_info) {
                const lInfo = d.loan_info;
                const loanData = lInfo.loanData || {};
                loansList.push({
                    id: lInfo.id || generateId(String(existing.cooperative_id)),
                    member_id: data.member_id || existing.member_id || '0000000000',
                    enterprise_id: d.enterprise_id || d.item || '',
                    principal_amount: Math.abs(parseFloat(loanData.principalAmount || loanData.principal_amount || 0)),
                    issued_date: loanData.issueDate || loanData.issued_date || data.remittance_date || existing.remittance_date || now,
                    due_date: loanData.dueDate || loanData.due_date || '',
                    status: loanData.status || 'Pending',
                    notes: loanData.notes || '',
                    duration_months: parseInt(loanData.durationMonths || loanData.duration_months || 0, 10),
                    guarantors: (lInfo.guarantors || []).map(g => ({
                        id: g.id,
                        member_id: g.member_id,
                        guarantee_amount: parseFloat(g.guarantee_amount || g.amount || 0),
                        guarantor_approval: g.guarantor_approval !== undefined ? g.guarantor_approval : null
                    }))
                });
            }
        });
    }

    if (loansList && loansList.length > 0) {
        doc.loans = loansList.map(l => ({
            id: l.id || generateId(String(existing.cooperative_id)),
            cooperative_id: String(existing.cooperative_id),
            member_id: l.member_id || existing.member_id || data.member_id || '0000000000',
            enterprise_id: l.enterprise_id || '',
            principal_amount: Math.abs(parseFloat(l.principal_amount || 0)),
            issued_date: l.issued_date || '',
            due_date: l.due_date || '',
            status: l.status || 'Pending',
            notes: l.notes || '',
            remittance_id: id,
            duration_months: l.duration_months || 0,
            admin_fee_id: l.admin_fee_id || null,
            created_at: l.created_at || now,
            created_by: l.created_by || modifiedBy || 'system',
            modified_at: now,
            modified_by: modifiedBy || 'system',
            is_deleted: l.is_deleted || 0,
            is_synced: 0,
            guarantors: (l.guarantors || []).map(g => ({
                id: g.id || generateId(String(existing.cooperative_id)),
                cooperative_id: String(existing.cooperative_id),
                member_id: String(g.member_id),
                guarantee_amount: parseFloat(g.guarantee_amount || g.amount || 0),
                guarantor_approval: g.guarantor_approval !== undefined ? g.guarantor_approval : null,
                created_at: g.created_at || now,
                created_by: g.created_by || modifiedBy || 'system',
                modified_at: now,
                modified_by: modifiedBy || 'system',
                is_deleted: g.is_deleted || 0,
                is_synced: 0
            }))
        }))
    }
    await saveDoc('remittance', doc)
}

export async function deleteRemittance(id, modifiedBy) {
    const existing = await getDocById_Global('remittance', id)
    if (!existing) throw new Error('Remittance not found')
    const now = new Date().toISOString()
    await saveDoc('remittance', {
        ...existing,
        is_deleted: 1,
        modified_at: now,
        modified_by: modifiedBy || 'system',
        is_synced: 0
    })
}

export async function approveRemittance(remittanceId, approvedBy, bankName, remittanceDate) {
    const now = new Date().toISOString()
    const remittance = await getDocById_Global('remittance', remittanceId)
    if (!remittance) throw new Error('Remittance not found')
    const updateData = {
        ...remittance,
        status: 'Approved',
        r_id: remittance.r_id || 0,
        modified_at: now,
        modified_by: approvedBy,
        is_synced: 0
    }
    if (bankName) updateData.bank_name = bankName
    if (remittanceDate) updateData.remittance_date = remittanceDate

    await saveDoc('remittance', updateData)

    const queuePayload = {
        ...remittance,
        status: 'Approved',
        modified_at: now,
        modified_by: approvedBy
    }
    if (bankName) queuePayload.bank_name = bankName
    if (remittanceDate) queuePayload.remittance_date = remittanceDate

    await enqueueWrite(remittance.cooperative_id, 'remittance', remittanceId, 'update', queuePayload)
}

export async function declineRemittance(remittanceId, declinedBy) {
    const now = new Date().toISOString()
    try {
        const sid = remittanceId.startsWith('AUTOGEN_') ? remittanceId.replace('AUTOGEN_', '') : remittanceId

        const target = await getDocById_Global('remittance', sid)
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
            'SELECT * FROM loans WHERE remittance_id = ? AND is_deleted = 0',
            [sid]
        )
        const ts = new Date().toISOString()
        for (const loan of loans) {
            if (loan.status === 'Declined') continue
            const { runSql } = await import('../sqliteService.js')
            await runSql(
                "UPDATE loans SET status = 'Declined', modified_at = ?, modified_by = ? WHERE id = ?",
                [ts, declinedBy, loan.id]
            )
            await runSql(
                'UPDATE loan_guarantors SET guarantor_approval = 0, modified_at = ?, modified_by = ? WHERE loan_id = ? AND is_deleted = 0',
                [ts, declinedBy, loan.id]
            )

            const autogenRems = await queryRows(
                'SELECT * FROM remittance WHERE loan_id = ? AND autogen = 1 AND is_deleted = 0',
                [loan.id]
            )
            for (const autorem of autogenRems) {
                if (autorem.status === 'Declined') continue
                await saveDoc('remittance', {
                    ...autorem,
                    status: 'Declined',
                    modified_at: now,
                    modified_by: declinedBy,
                    is_synced: 0
                })
                await enqueueWrite(autorem.cooperative_id, 'remittance', autorem.id, 'update', {
                    status: 'Declined',
                    modified_at: now,
                    modified_by: declinedBy
                })
            }
        }
    } catch (e) {
        console.error('[declineRemittance] Error:', e)
        throw e
    }
}

export async function fetchLoanById(cooperativeId, loanId) {
    const { getDocById } = await import('../sqliteService.js')
    return getDocById(cooperativeId, 'loans', loanId)
}

export async function fetchMemberLoans(cooperativeId, memberId = null) {
    const { getMemberLoans } = await import('../sqliteService.js')
    return getMemberLoans(cooperativeId, memberId)
}
