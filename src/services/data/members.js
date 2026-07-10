import { generateId, hashPassword } from '../../utils/formatters.js'
import {
    getAllForCoop, getDocById_Global, queryOne, queryRows,
    saveDoc, upsertRow
} from '../sqliteService.js'

export async function fetchAllMembers(cooperativeId, username = null, allAccess = false) {
    const members = await getAllForCoop(cooperativeId, 'members')
    if (!username || allAccess) return members
    const normalized = String(username).toLowerCase()
    return members.filter(m => {
        const managers = String(m.account_manager || '').split(',').map(s => s.trim().toLowerCase())
        return managers.includes(normalized)
    })
}

export async function fetchMembersBySearch(cooperativeId, searchTerm) {
    const members = await getAllForCoop(cooperativeId, 'members')
    if (!searchTerm) return members
    const term = String(searchTerm).toLowerCase()
    return members.filter(m =>
        String(m.last_name || '').toLowerCase().includes(term) ||
        String(m.first_name || '').toLowerCase().includes(term) ||
        String(m.middle_name || '').toLowerCase().includes(term) ||
        String(m.mobile || '').includes(term) ||
        String(m.registration_no || '').toLowerCase().includes(term) ||
        String(m.special_id || '').toLowerCase().includes(term)
    )
}

export async function fetchMemberDoc(memberId) {
    if (!memberId) return null
    try {
        return await getDocById_Global('members', memberId)
    } catch (e) {
        console.error('[dataService] fetchMemberDoc error:', e.message)
        return null
    }
}

export async function fetchMemberPaymentAdvise(memberId) {
    if (!memberId) return []
    try {
        return await queryRows('SELECT * FROM payment_advise WHERE member_id = ? AND is_deleted = 0', [memberId])
    } catch (e) {
        console.error('[dataService] fetchMemberPaymentAdvise error:', e.message)
        return []
    }
}

function generateRandom4Digit() {
    return Math.floor(1000 + Math.random() * 9000).toString()
}

export async function addMember(data, createdBy) {
    const now = new Date().toISOString()
    const id = generateId(String(data.cooperative_id))
    const pwd = data.password_hash || generateRandom4Digit()
    const password_hash = await hashPassword(pwd)

    let nextReg = 1
    try {
        const allLocal = await getAllForCoop(String(data.cooperative_id), 'members')
        if (allLocal.length > 0) {
            nextReg = Math.max(...allLocal.map(m => parseInt(m.registration_no || 0))) + 1
        }
    } catch (e) { console.warn('[addMember] RegNo calculation error:', e) }

    const doc = {
        id,
        cooperative_id: String(data.cooperative_id),
        registration_no: nextReg,
        last_name: data.last_name,
        first_name: data.first_name,
        middle_name: data.middle_name || '',
        mobile: data.mobile || '',
        special_id: data.special_id || '',
        status: data.status || 'Active',
        sex: data.sex || '',
        email: data.email || null,
        firebase_uid: data.firebase_uid || null,
        date_joined: data.date_joined || '',
        address: data.address || '',
        nok_name: data.nok_name || '',
        nok_mobile: data.nok_mobile || '',
        nok_address: data.nok_address || '',
        bank_name: data.bank_name || '',
        account_number: data.account_number || '',
        account_name: data.account_name || '',
        account_manager: data.account_manager || '',
        image_path: data.image_path || null,
        signature_path: data.signature_path || null,
        password_hash,
        subscriptionStatus: 0,
        expiry_date: null,
        created_at: now,
        created_by: createdBy || 'system',
        modified_at: now,
        modified_by: createdBy || 'system',
        last_login: null,
        login_count: 0,
        is_deleted: 0,
        is_synced: 0
    }
    if (data.payment_advise && Array.isArray(data.payment_advise)) {
        doc.payment_advise = data.payment_advise.map(a => ({
            id: generateId(String(data.cooperative_id)),
            enterprise_id: String(a.enterprise_id),
            amount: parseFloat(a.amount || 0),
            created_at: now,
            created_by: createdBy || 'system',
            modified_at: now,
            modified_by: createdBy || 'system',
            is_deleted: 0,
            is_synced: 0
        }))
    }
    await saveDoc('members', doc)
    return { generatedPassword: pwd }
}

export async function updateMember(id, data, modifiedBy) {
    const existing = await getDocById_Global('members', id)
    if (!existing) throw new Error('Member not found')
    const now = new Date().toISOString()
    const doc = {
        ...existing,
        ...data,
        id: existing.id,
        email: data.email !== undefined ? data.email : existing.email,
        firebase_uid: data.firebase_uid !== undefined ? data.firebase_uid : existing.firebase_uid,
        subscriptionStatus: existing.subscriptionStatus,
        expiry_date: existing.expiry_date,
        modified_at: now,
        modified_by: modifiedBy || 'system',
        is_synced: 0
    }
    delete doc.password_hash
    if (data.password_hash) {
        doc.password_hash = await hashPassword(data.password_hash)
    } else if (existing.password_hash) {
        doc.password_hash = existing.password_hash
    }
    if (data.payment_advise && Array.isArray(data.payment_advise)) {
        doc.payment_advise = data.payment_advise.map(a => ({
            id: a.id || generateId(String(existing.cooperative_id)),
            member_id: id,
            cooperative_id: String(existing.cooperative_id),
            enterprise_id: String(a.enterprise_id),
            amount: parseFloat(a.amount || 0),
            created_at: a.created_at || now,
            created_by: a.created_by || modifiedBy || 'system',
            modified_at: now,
            modified_by: modifiedBy || 'system',
            is_deleted: 0,
            is_synced: 0
        }))
    }
    delete doc.image_path
    delete doc.signature_path
    if (data.image_path !== undefined) doc.image_path = data.image_path
    if (data.signature_path !== undefined) doc.signature_path = data.signature_path
    await saveDoc('members', doc)
}

export async function deleteMember(id, modifiedBy) {
    const existing = await getDocById_Global('members', id)
    if (!existing) throw new Error('Member not found')
    const used = await queryOne(
        'SELECT id FROM remittance WHERE cooperative_id = ? AND member_id = ? AND is_deleted = 0 LIMIT 1',
        [existing.cooperative_id, id]
    )
    if (used) throw new Error('Cannot delete member with existing remittance records.')
    const now = new Date().toISOString()
    await saveDoc('members', {
        ...existing,
        is_deleted: 1,
        modified_at: now,
        modified_by: modifiedBy || 'system',
        is_synced: 0
    })
}

export async function updateMemberPaymentAdvice(memberId, paymentAdvice, modifiedBy, cooperativeId) {
    if (!memberId || !cooperativeId) return
    const now = new Date().toISOString()
    const { loadDoc, enqueueWrite } = await import('../sqliteService.js')
    const member = await loadDoc('members', memberId, cooperativeId)
    if (member) {
        member.payment_advise = paymentAdvice
        member.modified_at = now
        member.modified_by = modifiedBy || 'system'
        member.is_synced = 0
        await saveDoc('members', member)
    }
    await enqueueWrite(cooperativeId, 'members', memberId, 'update', {
        payment_advise: paymentAdvice,
        modified_at: now,
        modified_by: modifiedBy || 'system'
    })
}
