import { generateId } from '../../utils/formatters.js'
import { getAllForCoop, saveDoc, getDocById_Global, queryOne } from '../sqliteService.js'

export async function fetchBanks(cooperativeId) {
    const banks = await getAllForCoop(cooperativeId, 'bank')
    const internalExists = banks.some(b => b.bank_name === 'Internal Transfer' || b.id === 'internal_transfer')
    if (!internalExists) {
        banks.unshift({
            id: 'internal_transfer',
            bank_name: 'Internal Transfer',
            account_name: null,
            account_number: null,
            branch_name: null,
            swift_code: null,
            is_visible: 1,
            cooperative_id: String(cooperativeId)
        })
    }
    return banks
}

export async function addBank(data, createdBy) {
    const now = new Date().toISOString()
    const id = generateId(String(data.cooperative_id))
    const doc = {
        id,
        cooperative_id: String(data.cooperative_id),
        bank_name: data.bank_name,
        account_number: data.account_number || '',
        account_name: data.account_name || '',
        branch: data.branch || '',
        created_at: now,
        created_by: createdBy || 'system',
        modified_at: now,
        modified_by: createdBy || 'system',
        is_deleted: 0,
        is_synced: 0
    }
    await saveDoc('bank', doc)
    return { id }
}

export async function updateBank(id, data, modifiedBy) {
    const existing = await getDocById_Global('bank', id)
    if (!existing) throw new Error('Bank not found')
    if (existing.bank_name !== data.bank_name && data.bank_name) {
        const used = await queryOne(
            'SELECT id FROM remittance WHERE cooperative_id = ? AND bank_name = ? AND is_deleted = 0 LIMIT 1',
            [existing.cooperative_id, existing.bank_name]
        )
        if (used) throw new Error('Cannot rename: Bank is currently in use by existing records.')
    }
    const now = new Date().toISOString()
    await saveDoc('bank', {
        ...existing,
        ...data,
        id: existing.id,
        modified_at: now,
        modified_by: modifiedBy || 'system',
        is_synced: 0
    })
}

export async function deleteBank(id, modifiedBy) {
    const existing = await getDocById_Global('bank', id)
    if (!existing) throw new Error('Bank not found')
    const now = new Date().toISOString()
    await saveDoc('bank', {
        ...existing,
        is_deleted: 1,
        modified_at: now,
        modified_by: modifiedBy || 'system',
        is_synced: 0
    })
}
