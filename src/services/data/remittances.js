import { generateId, generateRemittanceId } from '../../utils/formatters.js'
import {
    getRemittances, getRemittancesPage,
    getTransactionTypes, saveDoc, getDocById_Global,
    queryRows, enqueueWrite, upsertRow
} from '../sqliteService.js'

export async function fetchRemittances(cooperativeId, user = null) {
    return getRemittances(cooperativeId, user)
}

export async function fetchRemittancesPage(cooperativeId, user = null, offset = 0, limitCount = 100, options = null) {
    return getRemittancesPage(cooperativeId, user, offset, limitCount, options)
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
        cheque_number: data.cheque_number || '',
        recipient_id: data.recipient_id || '',
        loan_id: data.loan_id || null,
        autogen: data.autogen || 0,
        parent_remittance_id: data.parent_remittance_id || data.loan_id || null,
        isLoanRequest: data.isLoanRequest || false,
        isWithdrawalRequest: data.isWithdrawalRequest || false,
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
            loan_info: d.loan_info || null,
            created_at: now,
            created_by: createdBy || 'system',
            modified_at: now,
            modified_by: createdBy || 'system',
            is_deleted: 0,
            is_synced: 0
        }))
    }

    // Build loan + guarantor child records from details[].loan_info.
    // These are saved to the loans/loan_guarantors tables via mutationEngine.
    // Charges (autogen remittances) and payment_advise are NOT created here -
    // they are created during approval in approveLoanRequest().
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
        is_deleted: 0,
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
            loan_info: d.loan_info || null,
            created_at: d.created_at || now,
            created_by: d.created_by || modifiedBy || 'system',
            modified_at: now,
            modified_by: modifiedBy || 'system',
            is_deleted: d.is_deleted || 0,
            is_synced: 0
        }))
    }

    // Build loan + guarantor child records from details[].loan_info.
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

    // Always set doc.loans (even []) so saveDoc cleans up old loans/guarantors
    doc.loans = (loansList || []).map(l => ({
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

export async function cleanupRemittanceFamily(remittanceId, modifiedBy) {
    const now = new Date().toISOString()

    // Use upsertRow (not saveDoc) to soft-delete children — saveDoc's cascade
    // logic would detect the child's loan_id pointing at the parent and
    // cascade-delete the parent itself, which we do NOT want during an edit.
    // Enqueue each soft-delete so deletions propagate to cloud/sync.
    // Find children via parent_remittance_id (new), loan_id (legacy), or ID prefix.
    const children = await queryRows(
        'SELECT * FROM remittance WHERE (parent_remittance_id = ? OR loan_id = ?) AND autogen = 1 AND is_deleted = 0',
        [remittanceId, remittanceId]
    ).catch(() => [])
    // ID-prefix fallback: old loan charges may have loan_id = loan record id
    // (not parent remittance id). Match by id prefix (e.g. "PARENT-CHARGE-1").
    const prefixChildren = await queryRows(
        "SELECT * FROM remittance WHERE id LIKE ? || '-%' AND autogen = 1 AND is_deleted = 0",
        [remittanceId]
    ).catch(() => [])
    const childIds = new Set((children || []).map(c => c.id));
    const allChildren = [...(children || [])];
    for (const c of (prefixChildren || [])) {
        if (!childIds.has(c.id)) allChildren.push(c);
    }
    for (const child of allChildren) {
        await upsertRow('remittance', {
            ...child,
            is_deleted: 1,
            modified_at: now,
            modified_by: modifiedBy || 'system',
            is_synced: 0
        })
        // Enqueue so cloud/sync sees the deletion
        if (child.cooperative_id) {
            await enqueueWrite(child.cooperative_id, 'remittance', child.id, 'delete', {
                ...child,
                is_deleted: 1,
                modified_at: now,
                modified_by: modifiedBy || 'system'
            }).catch(() => {})
        }
    }

    const loans = await queryRows(
        'SELECT * FROM loans WHERE remittance_id = ? AND is_deleted = 0',
        [remittanceId]
    ).catch(() => [])
    for (const loan of (loans || [])) {
        // Soft-delete and sync guarantors first
        const guarantors = await queryRows(
            'SELECT * FROM loan_guarantors WHERE loan_id = ? AND is_deleted = 0',
            [loan.id]
        ).catch(() => [])
        for (const g of (guarantors || [])) {
            await upsertRow('loan_guarantors', {
                ...g,
                is_deleted: 1,
                modified_at: now,
                modified_by: modifiedBy || 'system',
                is_synced: 0
            })
        }
        // Soft-delete and sync the loan itself
        await upsertRow('loans', {
            ...loan,
            is_deleted: 1,
            modified_at: now,
            modified_by: modifiedBy || 'system',
            is_synced: 0
        })
        // Enqueue the parent remittance for sync so cloud sees the full family change
        if (loan.cooperative_id && loan.remittance_id) {
            await enqueueWrite(loan.cooperative_id, 'remittance', loan.remittance_id, 'update', {
                id: loan.remittance_id,
                cooperative_id: loan.cooperative_id,
                modified_at: now,
                modified_by: modifiedBy || 'system',
                is_synced: 0
            }).catch(() => {})
        }
    }
}

export async function approveRemittance(remittanceId, approvedBy, bankName, remittanceDate) {
    const now = new Date().toISOString()
    const remittance = await getDocById_Global('remittance', remittanceId)
    if (!remittance) throw new Error('Remittance not found')
    const updateData = {
        ...remittance,
        status: 'Approved',
        modified_at: now,
        modified_by: approvedBy,
        is_synced: 0
    }
    if (bankName) updateData.bank_name = bankName
    if (remittanceDate) updateData.remittance_date = remittanceDate

    await saveDoc('remittance', updateData)

    // Bidirectional approve cascade for dues/penalty groups (parent <->
    // children <-> siblings). Only Pending members move; Declined stays.
    // Loan flows untouched: loan-charge children carry loan_id = loan id,
    // so the remittance lookups below no-op for them.
    const approveOne = async (r, propagateFields) => {
        if (!r || r.is_deleted || r.status !== 'Pending') return
        const next = {
            ...r,
            status: 'Approved',
            modified_at: now,
            modified_by: approvedBy,
            is_synced: 0
        }
        if (propagateFields) {
            if (bankName) next.bank_name = bankName
            if (remittanceDate) next.remittance_date = remittanceDate
        }
        await saveDoc('remittance', next)
    }
    // Downward: parent approved => its direct autogen children approve too.
    const directKids = await queryRows(
        'SELECT * FROM remittance WHERE (parent_remittance_id = ? OR loan_id = ?) AND autogen = 1 AND is_deleted = 0',
        [remittanceId, remittanceId]
    ).catch(() => [])
    for (const kid of directKids || []) await approveOne(kid, true)
    // Upward + sideways: a dues-style child approved => parent + siblings approve.
    if (remittance.autogen === 1 && (remittance.parent_remittance_id || remittance.loan_id)) {
        const parentRemId = remittance.parent_remittance_id || remittance.loan_id
        const parentRem = await getDocById_Global('remittance', parentRemId).catch(() => null)
        if (parentRem && !parentRem.is_deleted && String(parentRem.id) !== String(remittanceId)) {
            await approveOne(parentRem, false)
            const siblings = await queryRows(
                'SELECT * FROM remittance WHERE (parent_remittance_id = ? OR loan_id = ?) AND autogen = 1 AND is_deleted = 0',
                [parentRem.id, parentRem.id]
            ).catch(() => [])
            for (const sib of siblings || []) await approveOne(sib, false)
        }
    }
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
        }

        const loans = await queryRows(
            'SELECT * FROM loans WHERE remittance_id = ? AND is_deleted = 0',
            [sid]
        )
        const ts = new Date().toISOString()
        const { runSql, saveDoc: saveLoanDoc, loadDoc: loadParentDoc } = await import('../sqliteService.js')
        let loanChanged = false
        for (const loan of loans) {
            if (loan.status === 'Declined') continue
            // Route through saveDoc so child changes propagate via parent reload
            // (raw SQL alone would bypass the sync queue entirely).
            const guarantors = await queryRows(
                'SELECT * FROM loan_guarantors WHERE loan_id = ? AND is_deleted = 0',
                [loan.id]
            )
            for (const g of guarantors) {
                await saveLoanDoc('loan_guarantors', {
                    ...g,
                    guarantor_approval: 0,
                    modified_at: ts,
                    modified_by: declinedBy,
                    is_synced: 0
                }, true)
            }
            await saveLoanDoc('loans', {
                ...loan,
                status: 'Declined',
                modified_at: ts,
                modified_by: declinedBy,
                is_synced: 0
            })
            loanChanged = true

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
            }
        }

        // Direct autogen children (dues/penalty autos: loan_id = parent
        // remittance id, no loan bridge). Declining the parent declines them.
        const declineOne = async (r) => {
            if (!r || r.status === 'Declined') return
            await saveDoc('remittance', {
                ...r,
                status: 'Declined',
                modified_at: now,
                modified_by: declinedBy,
                is_synced: 0
            })
        }
        const directKids = await queryRows(
            'SELECT * FROM remittance WHERE (parent_remittance_id = ? OR loan_id = ?) AND autogen = 1 AND is_deleted = 0',
            [sid, sid]
        ).catch(() => [])
        for (const kid of directKids || []) await declineOne(kid)

        // Upward + sideways: a dues-style child declined => parent + siblings go too.
        // Loan-charge children are untouched: their loan_id is a loan id, so the
        // remittance lookup below finds nothing and this block no-ops.
        if (target.autogen === 1 && (target.parent_remittance_id || target.loan_id)) {
            const parentRemId = target.parent_remittance_id || target.loan_id
            const parentRem = await getDocById_Global('remittance', parentRemId).catch(() => null)
            if (parentRem && !parentRem.is_deleted && String(parentRem.id) !== String(sid)) {
                await declineOne(parentRem)
                const siblings = await queryRows(
                    'SELECT * FROM remittance WHERE (parent_remittance_id = ? OR loan_id = ?) AND autogen = 1 AND is_deleted = 0',
                    [parentRem.id, parentRem.id]
                ).catch(() => [])
                for (const sib of siblings || []) await declineOne(sib)
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
