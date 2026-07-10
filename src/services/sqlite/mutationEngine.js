import {
    getAllItems, getAllByIndex, getItem, putItem, putItemsBatch,
    deleteAllByIndex, deleteByFilter, deleteItem, clearAllStores
} from '../indexedDbService.js'
import { TABLE_COLUMNS } from './constants.js'
import { filterColumns, serializeValue } from './helpers.js'
import { getDocById_Global } from './dataAccess.js'
import { enqueueWrite } from './syncQueue.js'
import { runSql } from './sqlExecutor.js'

export async function upsertRow(tableName, data) {
    let docToSave = { ...data }
    try {
        const raw = window.sessionStorage.getItem('cooplog-web-session')
        if (raw) {
            const session = JSON.parse(raw)
            if (session && session.role === 'member') {
                if (docToSave.created_by) docToSave.created_by = 'Self';
                if (docToSave.modified_by) docToSave.modified_by = 'Self';
            }
        }
    } catch (e) {}
    const filtered = filterColumns(tableName, docToSave)
    await putItem(tableName, filtered)
}

export async function wipeDatabase() {
    await clearAllStores()
}

export async function hardDeleteDoc(tableName, id) {
    await deleteItem(tableName, String(id))
    if (tableName === 'remittance') {
        await deleteAllByIndex('remittance_detail', 'remittance_id', String(id))
        await deleteAllByIndex('loans', 'remittance_id', String(id))
    } else if (tableName === 'members') {
        await deleteAllByIndex('payment_advise', 'member_id', String(id))
    } else if (tableName === 'loans') {
        await deleteAllByIndex('loan_guarantors', 'loan_id', String(id))
    }
}

export async function upsertMany(tableName, rows) {
    if (!rows || rows.length === 0) return
    let filteredRows = rows.map(row => filterColumns(tableName, row))
    try {
        const raw = window.sessionStorage.getItem('cooplog-web-session')
        if (raw) {
            const session = JSON.parse(raw)
            if (session && session.role === 'member') {
                filteredRows = filteredRows.map(row => {
                    const updated = { ...row }
                    if (updated.created_by) updated.created_by = 'Self';
                    if (updated.modified_by) updated.modified_by = 'Self';
                    return updated;
                })
            }
        }
    } catch (e) {}
    await putItemsBatch(tableName, filteredRows)
}

export async function saveDoc(tableName, doc, skipEnqueue = false) {
    let mappedDoc = { ...doc }
    try {
        const raw = window.sessionStorage.getItem('cooplog-web-session')
        if (raw) {
            const session = JSON.parse(raw)
            if (session && session.role === 'member') {
                if (mappedDoc.created_by) mappedDoc.created_by = 'Self';
                if (mappedDoc.modified_by) mappedDoc.modified_by = 'Self';
            }
        }
    } catch (e) {}
    doc = mappedDoc
    const docToSave = { ...doc, is_synced: doc.is_synced !== undefined ? doc.is_synced : 0 }
    if (tableName === 'remittance') {
        await upsertRow('remittance', docToSave)
        if (doc.is_deleted === 1 || doc.is_deleted === true) {
            const idbDetails = await getAllByIndex('remittance_detail', 'remittance_id', doc.id)
            if (idbDetails.length > 0) {
                await putItemsBatch('remittance_detail', idbDetails.map(d => ({ ...d, is_deleted: 1, is_synced: 0 })))
            }
            const idbLoans = await getAllByIndex('loans', 'remittance_id', doc.id)
            if (idbLoans.length > 0) {
                await putItemsBatch('loans', idbLoans.map(l => ({ ...l, is_deleted: 1, is_synced: 0 })))
                for (const loan of idbLoans) {
                    const idbGuarantors = await getAllByIndex('loan_guarantors', 'loan_id', loan.id)
                    if (idbGuarantors.length > 0) {
                        await putItemsBatch('loan_guarantors', idbGuarantors.map(g => ({ ...g, is_deleted: 1, is_synced: 0 })))
                    }
                    const childRems = await getAllByIndex('remittance', 'loan_id', loan.id)
                    for (const childRem of childRems) {
                        if (childRem.autogen === 1 && (childRem.is_deleted === 0 || !childRem.is_deleted)) {
                            await saveDoc('remittance', { ...childRem, is_deleted: 1 })
                        }
                    }
                }
            }
            if (doc.autogen === 1 && doc.loan_id) {
                const loan = await getDocById_Global('loans', doc.loan_id)
                if (loan && loan.remittance_id) {
                    const parentRem = await getDocById_Global('remittance', loan.remittance_id)
                    if (parentRem && (parentRem.is_deleted === 0 || !parentRem.is_deleted)) {
                        await saveDoc('remittance', { ...parentRem, is_deleted: 1 })
                    }
                }
            }
        } else {
            if (doc.details) {
                await deleteAllByIndex('remittance_detail', 'remittance_id', doc.id)
                const details = doc.details.map(d => ({
                    ...d,
                    remittance_id: doc.id,
                    cooperative_id: doc.cooperative_id,
                    id: d.id || `${doc.id}_${Math.random().toString(36).slice(2)}`,
                    created_by: d.created_by || doc.created_by || doc.modified_by || 'system',
                    created_at: d.created_at || doc.created_at || doc.modified_at || new Date().toISOString()
                }))
                await upsertMany('remittance_detail', details)
            }
            if (doc.loans && Array.isArray(doc.loans)) {
                for (const loan of doc.loans) {
                    loan.remittance_id = doc.id
                    await saveDoc('loans', loan, true)
                }
            }
        }
    } else if (tableName === 'members') {
        await upsertRow('members', docToSave)
        if (doc.is_deleted === 1 || doc.is_deleted === true) {
            const idbAdvises = await getAllByIndex('payment_advise', 'member_id', doc.id)
            if (idbAdvises.length > 0) {
                await putItemsBatch('payment_advise', idbAdvises.map(a => ({ ...a, is_deleted: 1, is_synced: 0 })))
            }
        } else if (doc.payment_advise) {
            await deleteAllByIndex('payment_advise', 'member_id', doc.id)
            const advises = doc.payment_advise.map(a => ({
                ...a,
                member_id: String(doc.id),
                cooperative_id: String(doc.cooperative_id),
                id: a.id || `${doc.id}_${Math.random().toString(36).slice(2)}`,
                is_synced: 0,
                created_by: String(a.created_by || doc.created_by || doc.modified_by || 'system'),
                created_at: String(a.created_at || doc.created_at || doc.modified_at || new Date().toISOString())
            }))
            await upsertMany('payment_advise', advises)
        }
    } else if (tableName === 'loans') {
        await upsertRow('loans', docToSave)
        if (doc.is_deleted === 1 || doc.is_deleted === true) {
            const idbGuarantors = await getAllByIndex('loan_guarantors', 'loan_id', doc.id)
            if (idbGuarantors.length > 0) {
                await putItemsBatch('loan_guarantors', idbGuarantors.map(g => ({ ...g, is_deleted: 1, is_synced: 0 })))
            }
        } else if (doc.guarantors) {
            await deleteAllByIndex('loan_guarantors', 'loan_id', doc.id)
            const guarantors = doc.guarantors.map(g => ({
                ...g,
                loan_id: doc.id,
                cooperative_id: doc.cooperative_id,
                id: g.id || `${doc.id}_${Math.random().toString(36).slice(2)}`,
                is_synced: 0,
                created_by: g.created_by || doc.created_by || doc.modified_by || 'system',
                created_at: g.created_at || doc.created_at || doc.modified_at || new Date().toISOString()
            }))
            await upsertMany('loan_guarantors', guarantors)
        }
    } else {
        await upsertRow(tableName, docToSave)
    }

    if (!skipEnqueue) {
        const topLevelCollections = ['enterprise', 'bank', 'members', 'remittance', 'users', 'notifications', 'cooperatives', 'transaction_types', 'bank_reconciliation_summary']
        
        let targetQueue = null;

        if (topLevelCollections.includes(tableName)) {
            const coopId = doc.cooperative_id || (tableName === 'cooperatives' ? doc.id : null)
            if (coopId) {
                targetQueue = { collection: tableName, id: doc.id, cooperativeId: coopId, op: (doc.is_deleted === 1 || doc.is_deleted === true) ? 'delete' : 'update', payload: doc }
            }
        } else if (tableName === 'remittance_detail' || tableName === 'loans') {
            if (doc.remittance_id && doc.cooperative_id) {
                targetQueue = { collection: 'remittance', id: doc.remittance_id, cooperativeId: doc.cooperative_id, op: 'update' }
            }
        } else if (tableName === 'loan_guarantors') {
            if (doc.loan_id) {
                const loan = await getDocById_Global('loans', doc.loan_id)
                if (loan && loan.remittance_id) {
                    targetQueue = { collection: 'remittance', id: loan.remittance_id, cooperativeId: loan.cooperative_id || doc.cooperative_id, op: 'update' }
                }
            }
        } else if (tableName === 'payment_advise') {
            if (doc.member_id && doc.cooperative_id) {
                targetQueue = { collection: 'members', id: doc.member_id, cooperativeId: doc.cooperative_id, op: 'update' }
            }
        }

        if (targetQueue) {
            let payload = targetQueue.payload;
            if (!payload) {
                payload = await loadDoc(targetQueue.collection, targetQueue.id, targetQueue.cooperativeId)
                if (payload) {
                    await runSql(`UPDATE ${targetQueue.collection} SET is_synced = 0 WHERE id = ?`, [targetQueue.id])
                }
            }
            if (payload) {
                await enqueueWrite(targetQueue.cooperativeId, targetQueue.collection, targetQueue.id, targetQueue.op, payload)
            }
        }
    }
}

export async function loadDocLight(tableName, id, cooperativeId) {
    if (tableName === 'cooperatives') {
        return getItem('cooperatives', String(id))
    }
    const doc = await getItem(tableName, String(id))
    if (doc && doc.cooperative_id !== String(cooperativeId)) return null
    return doc || null
}

export async function loadDoc(tableName, id, cooperativeId) {
    let doc
    if (tableName === 'cooperatives') {
        doc = await getItem('cooperatives', String(id))
    } else {
        doc = await getItem(tableName, String(id))
        if (doc && doc.cooperative_id !== String(cooperativeId)) {
            doc = null
        }
    }
    if (!doc) return null

    if (tableName === 'remittance') {
        let details = []
        try {
            details = await getAllByIndex('remittance_detail', 'remittance_id', id)
        } catch (e) { details = [] }
        doc.details = details.filter(d => !d.is_deleted)

        let loans = []
        try {
            loans = await getAllByIndex('loans', 'remittance_id', id)
        } catch (e) { loans = [] }
        loans = loans.filter(l => !l.is_deleted)
        for (const loan of loans) {
            let guarantors = []
            try {
                guarantors = await getAllByIndex('loan_guarantors', 'loan_id', loan.id)
            } catch (e) { guarantors = [] }
            loan.guarantors = guarantors.filter(g => !g.is_deleted)
        }
        doc.loans = loans
    } else if (tableName === 'members') {
        let advises = []
        try {
            advises = await getAllByIndex('payment_advise', 'member_id', id)
        } catch (e) { advises = [] }
        doc.payment_advise = advises.filter(a => !a.is_deleted)
    } else if (tableName === 'loans') {
        let guarantors = []
        try {
            guarantors = await getAllByIndex('loan_guarantors', 'loan_id', id)
        } catch (e) { guarantors = [] }
        doc.guarantors = guarantors.filter(g => !g.is_deleted)
    }
    return doc
}

export async function saveMany(tableName, docs) {
    if (!docs || docs.length === 0) return 0
    let changedCount = 0
    for (const doc of docs) {
        const cols = TABLE_COLUMNS[tableName] || Object.keys(doc)
        const filtered = {}
        for (const col of cols) {
            if (doc[col] !== undefined) filtered[col] = doc[col]
        }
        if (doc.is_deleted === 1 || doc.is_deleted === true) {
            await deleteItem(tableName, String(doc.id))
            if (tableName === 'remittance') {
                await deleteAllByIndex('remittance_detail', 'remittance_id', String(doc.id))
                await deleteAllByIndex('loans', 'remittance_id', String(doc.id))
            } else if (tableName === 'members') {
                await deleteAllByIndex('payment_advise', 'member_id', String(doc.id))
            } else if (tableName === 'loans') {
                await deleteAllByIndex('loan_guarantors', 'loan_id', String(doc.id))
            }
            changedCount++
        } else {
            const existing = await getItem(tableName, String(doc.id))
            if (existing) {
                let allMatch = true
                for (const col of cols) {
                    if (filtered[col] !== undefined && existing[col] !== filtered[col]) {
                        allMatch = false
                        break
                    }
                }
                if (allMatch) continue
            }
            if (tableName === 'members' && doc.cooperative_id && doc.mobile) {
                const allMembers = await getAllItems('members')
                const dup = allMembers.find(m =>
                    m.cooperative_id === String(doc.cooperative_id) &&
                    m.mobile === String(doc.mobile) &&
                    m.id !== String(doc.id)
                )
                if (dup) await deleteItem('members', dup.id)
            } else if (tableName === 'bank' && doc.cooperative_id && doc.bank_name) {
                const allBanks = await getAllItems('bank')
                const dup = allBanks.find(b =>
                    b.cooperative_id === String(doc.cooperative_id) &&
                    b.bank_name === String(doc.bank_name) &&
                    b.id !== String(doc.id)
                )
                if (dup) await deleteItem('bank', dup.id)
            } else if (tableName === 'users' && doc.cooperative_id && doc.username) {
                const allUsers = await getAllItems('users')
                const dup = allUsers.find(u =>
                    u.cooperative_id === String(doc.cooperative_id) &&
                    u.username === String(doc.username) &&
                    u.id !== String(doc.id)
                )
                if (dup) await deleteItem('users', dup.id)
            }
            await putItem(tableName, filtered)
            if (tableName === 'remittance') {
                if (doc.is_deleted === 1 || doc.is_deleted === true) {
                    const idbDetails = await getAllByIndex('remittance_detail', 'remittance_id', doc.id)
                    if (idbDetails.length > 0) {
                        await putItemsBatch('remittance_detail', idbDetails.map(d => ({ ...d, is_deleted: 1, is_synced: 1 })))
                    }
                    const idbLoans = await getAllByIndex('loans', 'remittance_id', doc.id)
                    if (idbLoans.length > 0) {
                        await putItemsBatch('loans', idbLoans.map(l => ({ ...l, is_deleted: 1, is_synced: 1 })))
                    }
                } else {
                    if (doc.details) {
                        await deleteAllByIndex('remittance_detail', 'remittance_id', doc.id)
                        const details = doc.details.map(d => ({
                            ...d,
                            remittance_id: doc.id,
                            cooperative_id: doc.cooperative_id,
                            id: d.id || `${doc.id}_${Math.random().toString(36).slice(2)}`,
                            is_synced: 1,
                            created_by: d.created_by || doc.created_by || doc.modified_by || 'system',
                            created_at: d.created_at || doc.created_at || doc.modified_at || new Date().toISOString()
                        }))
                        await upsertMany('remittance_detail', details)
                    }
                    if (doc.loans && Array.isArray(doc.loans)) {
                        for (const loan of doc.loans) {
                            loan.remittance_id = doc.id
                            loan.is_synced = 1
                            await saveDoc('loans', loan, true)
                        }
                    }
                }
            } else if (tableName === 'members') {
                if (doc.is_deleted === 1 || doc.is_deleted === true) {
                    const idbAdvises = await getAllByIndex('payment_advise', 'member_id', doc.id)
                    if (idbAdvises.length > 0) {
                        await putItemsBatch('payment_advise', idbAdvises.map(a => ({ ...a, is_deleted: 1, is_synced: 1 })))
                    }
                } else if (doc.payment_advise) {
                    await deleteAllByIndex('payment_advise', 'member_id', doc.id)
                    const advises = doc.payment_advise.map(a => ({
                        ...a,
                        member_id: String(doc.id),
                        cooperative_id: String(doc.cooperative_id),
                        id: a.id || `${doc.id}_${Math.random().toString(36).slice(2)}`,
                        is_synced: 1,
                        created_by: String(a.created_by || doc.created_by || doc.modified_by || 'system'),
                        created_at: String(a.created_at || doc.created_at || doc.modified_at || new Date().toISOString())
                    }))
                    await upsertMany('payment_advise', advises)
                }
            } else if (tableName === 'loans') {
                if (doc.is_deleted === 1 || doc.is_deleted === true) {
                    const idbGuarantors = await getAllByIndex('loan_guarantors', 'loan_id', doc.id)
                    if (idbGuarantors.length > 0) {
                        await putItemsBatch('loan_guarantors', idbGuarantors.map(g => ({ ...g, is_deleted: 1, is_synced: 1 })))
                    }
                } else if (doc.guarantors) {
                    await deleteAllByIndex('loan_guarantors', 'loan_id', doc.id)
                    const guarantors = doc.guarantors.map(g => ({
                        ...g,
                        loan_id: doc.id,
                        cooperative_id: doc.cooperative_id,
                        id: g.id || `${doc.id}_${Math.random().toString(36).slice(2)}`,
                        is_synced: 1,
                        created_by: g.created_by || doc.created_by || doc.modified_by || 'system',
                        created_at: g.created_at || doc.created_at || doc.modified_at || new Date().toISOString()
                    }))
                    await upsertMany('loan_guarantors', guarantors)
                }
            }
            changedCount++
        }
    }
    return changedCount
}
