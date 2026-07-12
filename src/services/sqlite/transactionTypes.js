import { DEFAULT_TRANSACTION_TYPES } from '../../utils/constants.js'
import { getAllItems, getAllByIndex, putItemsBatch, putItem } from '../indexedDbService.js'
import { getDocById } from './dataAccess.js'
import { saveDoc } from './mutationEngine.js'

export async function initializeDefaultTransactionTypes(cooperativeId, userId = 'system') {
    const now = new Date().toISOString()
    let existingTypes
    try {
        existingTypes = await getAllByIndex('transaction_types', 'cooperative_id', String(cooperativeId))
        if (!existingTypes || existingTypes.length === 0) {
            const all = await getAllItems('transaction_types')
            if (all.length > 0) {
                existingTypes = all.filter(t => t.cooperative_id === String(cooperativeId))
            }
        }
    } catch (e) {
        const all = await getAllItems('transaction_types')
        existingTypes = all.filter(t => t.cooperative_id === String(cooperativeId))
    }
    const existingNames = new Set(existingTypes.map(t => t.transaction_type.toLowerCase()))
    const missingTypes = DEFAULT_TRANSACTION_TYPES.filter(tt => !existingNames.has(tt.name.toLowerCase()))
    if (missingTypes.length === 0) return { created: 0 }
    const newDocs = []
    for (const tt of missingTypes) {
        const id = `tt_${cooperativeId}_${tt.name.toLowerCase().replace(/\s+/g, '_')}`
        const doc = {
            id,
            cooperative_id: cooperativeId,
            transaction_type: tt.name,
            classification: tt.classification,
            is_system_default: 1,
            is_active: 1,
            created_by: userId,
            created_at: now,
            modified_by: userId,
            modified_at: now,
            is_deleted: 0,
            is_synced: 0,
            sync_at: now
        }
        newDocs.push(doc)
    }
    if (newDocs.length > 0) {
        await putItemsBatch('transaction_types', newDocs)
    }
    return { created: newDocs.length }
}

export async function getTransactionTypes(cooperativeId) {
    let types
    try {
        types = await getAllByIndex('transaction_types', 'cooperative_id', String(cooperativeId))
        if (!types || types.length === 0) {
            const all = await getAllItems('transaction_types')
            if (all.length > 0) {
                types = all.filter(t => t.cooperative_id === String(cooperativeId))
            }
        }
    } catch (e) {
        const all = await getAllItems('transaction_types')
        types = all.filter(t => t.cooperative_id === String(cooperativeId))
    }
    return types.filter(t => !t.is_deleted).sort((a, b) => String(a.transaction_type).localeCompare(String(b.transaction_type)))
}

export async function getTransactionTypeByName(cooperativeId, name) {
    const normalizedName = String(name).toLowerCase()
    const allTypes = await getTransactionTypes(cooperativeId)
    return allTypes.find(tt => String(tt.transaction_type).toLowerCase() === normalizedName)
}

export async function isTransactionTypeUsed(cooperativeId, transactionTypeId) {
    const tt = await getDocById(cooperativeId, 'transaction_types', transactionTypeId)
    if (!tt) return false
    const name = tt.transaction_type
    let rems
    try {
        rems = await getAllByIndex('remittance', 'cooperative_id', String(cooperativeId))
        if (!rems || rems.length === 0) {
            const all = await getAllItems('remittance')
            if (all.length > 0) {
                rems = all.filter(r => r.cooperative_id === String(cooperativeId))
            }
        }
    } catch (e) {
        const all = await getAllItems('remittance')
        rems = all.filter(r => r.cooperative_id === String(cooperativeId))
    }
    return rems.some(r => !r.is_deleted && r.transaction_type === name)
}

export async function migrateExistingRemittancesToAddCategory(cooperativeId) {
    let rems
    try {
        rems = await getAllByIndex('remittance', 'cooperative_id', String(cooperativeId))
        if (!rems || rems.length === 0) {
            const all = await getAllItems('remittance')
            if (all.length > 0) {
                rems = all.filter(r => r.cooperative_id === String(cooperativeId))
            }
        }
    } catch (e) {
        const all = await getAllItems('remittance')
        rems = all.filter(r => r.cooperative_id === String(cooperativeId))
    }
    const uncategorized = rems.filter(r => !r.is_deleted && !r.category)
    if (uncategorized.length === 0) return { migrated: 0 }
    const allTypes = await getTransactionTypes(cooperativeId)
    const typeMap = new Map()
    allTypes.forEach(tt => typeMap.set(tt.transaction_type.toLowerCase(), tt.classification))
    let migrated = 0
    for (const rem of uncategorized) {
        if (rem.transaction_type) {
            const classification = typeMap.get(rem.transaction_type.toLowerCase())
            if (classification) {
                rem.category = classification
                await putItem('remittance', rem)
                migrated++
            }
        }
    }
    return { migrated }
}

export async function migrateTransactionClassifications() {
    const allCoops = await getAllItems('cooperatives')
    const activeCoops = allCoops.filter(c => !c.is_deleted)
    const classificationMap = {
        'Expense': 'Operating Expense',
        'Expenses': 'Operating Income',
        'Revenue': 'Other Income'
    }
    const overrides = {
        'Unknown Payments': 'Suspense',
        'Admin Expenses': 'Administrative Expense',
        'Staff & Management Expenses': 'Administrative Expense',
        'Meeting & Member Activities': 'Operating Expense',
        'AGM Expenses': 'Operating Expense',
        'Financial & Banking Expenses': 'Finance Expense',
        'Utilities & Operations': 'Operating Expense',
        'Transport & Logistics': 'Operating Expense',
        'Loans & Credit Operations': 'Loan Asset',
        'Asset & Equipment': 'Fixed Asset',
        'General Purchase': 'Operating Expense',
        'Levies, Fee & Subscription': 'Operating Income',
        'Registration Fee': 'Operating Income',
        'Misc. Expenses': 'Other Operating Expense',
        'Member Deposit': 'Member Liability',
        'Member Welfare': 'Welfare Expense',
        'Member Loan': 'Loan Asset',
        'Loan Charges': 'Loan Income',
        'Savings Withdrawal': 'Member Liability',
        'Special Income': 'Other Income',
        'Internal Transfer': 'Transfer',
        'Other Income': 'Other Income',
        'Other Expenses': 'Other Expenses'
    }
    for (const coop of activeCoops) {
        try {
            let types
            try { types = await getAllByIndex('transaction_types', 'cooperative_id', String(coop.id)) }
            catch (e) {
                const all = await getAllItems('transaction_types')
                types = all.filter(t => t.cooperative_id === String(coop.id))
            }
            const activeTypes = types.filter(t => !t.is_deleted)

            let rems
            try { rems = await getAllByIndex('remittance', 'cooperative_id', String(coop.id)) }
            catch (e) {
                const all = await getAllItems('remittance')
                rems = all.filter(r => r.cooperative_id === String(coop.id))
            }
            const activeRems = rems.filter(r => !r.is_deleted)

            const othersType = activeTypes.find(t => t.transaction_type === 'Others')
            if (othersType) {
                othersType.transaction_type = 'Other Income'
                othersType.classification = 'Other Income'
                othersType.is_synced = 0
                await putItem('transaction_types', othersType)
                for (const rem of activeRems) {
                    if (rem.transaction_type === 'Others') {
                        rem.transaction_type = 'Other Income'
                        rem.is_synced = 0
                        await putItem('remittance', rem)
                    }
                }
            }

            for (const [typeName, newCls] of Object.entries(overrides)) {
                const existing = activeTypes.find(t => t.transaction_type === typeName)
                if (existing) {
                    if (existing.classification !== newCls) {
                        existing.classification = newCls
                        existing.is_synced = 0
                        await putItem('transaction_types', existing)
                    }
                } else {
                    const id = `tt_${coop.id}_${typeName.toLowerCase().replace(/\s+/g, '_')}_migrated`
                    const doc = {
                        id,
                        cooperative_id: coop.id,
                        transaction_type: typeName,
                        classification: newCls,
                        is_system_default: 1,
                        is_active: 1,
                        created_by: 'system',
                        created_at: new Date().toISOString(),
                        modified_by: 'system',
                        modified_at: new Date().toISOString(),
                        is_deleted: 0,
                        is_synced: 0,
                        sync_at: new Date().toISOString()
                    }
                    await putItem('transaction_types', doc)
                }
            }

            for (const rem of activeRems) {
                if ((!rem.category) && rem.transaction_type) {
                    const cls = overrides[rem.transaction_type]
                    if (cls) {
                        rem.category = cls
                        rem.is_synced = 0
                        await putItem('remittance', rem)
                    }
                }
            }

            for (const [oldCat, newCat] of Object.entries(classificationMap)) {
                for (const rem of activeRems) {
                    if (rem.category === oldCat) {
                        rem.category = newCat
                        rem.is_synced = 0
                        await putItem('remittance', rem)
                    }
                }
            }
        } catch (e) {
            console.warn(`[Migrate] Failed for cooperative ${coop.id}:`, e.message)
        }
    }
}

export async function createTransactionType(cooperativeId, name, classification, userId = 'system') {
    const id = `tt_${cooperativeId}_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const now = new Date().toISOString()
    const doc = {
        id,
        cooperative_id: cooperativeId,
        transaction_type: name,
        classification,
        is_system_default: 0,
        is_active: 1,
        created_by: userId,
        created_at: now,
        modified_by: userId,
        modified_at: now,
        is_deleted: 0,
        is_synced: 0,
        sync_at: now
    }
    await saveDoc('transaction_types', doc)
    return doc
}

export async function updateTransactionType(cooperativeId, id, data, userId = 'system') {
    const existing = await getDocById(cooperativeId, 'transaction_types', id)
    if (!existing) throw new Error('Transaction type not found')
    if (existing.is_system_default === 1) throw new Error('System default transaction types cannot be modified')
    if (await isTransactionTypeUsed(cooperativeId, id)) throw new Error('Transaction type is already used and cannot be modified')
    const now = new Date().toISOString()
    const updateData = { ...data, modified_by: userId, modified_at: now, is_synced: 0, sync_at: now }
    await saveDoc('transaction_types', { ...existing, ...updateData })
    return await getDocById(cooperativeId, 'transaction_types', id)
}

export async function deleteTransactionType(cooperativeId, id, userId = 'system') {
    const existing = await getDocById(cooperativeId, 'transaction_types', id)
    if (!existing) throw new Error('Transaction type not found')
    if (existing.is_system_default === 1) throw new Error('System default transaction types cannot be deleted')
    if (await isTransactionTypeUsed(cooperativeId, id)) throw new Error('Transaction type is already used and cannot be deleted')
    const now = new Date().toISOString()
    await saveDoc('transaction_types', {
        ...existing,
        is_deleted: 1,
        deleted_at: now,
        deleted_by: userId,
        is_synced: 0,
        sync_at: now
    })
}
