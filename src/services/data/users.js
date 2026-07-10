import { generateId, hashPassword } from '../../utils/formatters.js'
import { saveDoc, getDocById_Global, getUsersByUsername } from '../sqliteService.js'

function generateRandom4Digit() {
    return Math.floor(1000 + Math.random() * 9000).toString()
}

export async function fetchCooperativeUsers(cooperativeId) {
    const { getAllForCoop } = await import('../sqliteService.js')
    return getAllForCoop(cooperativeId, 'users')
}

export async function addUser(data, createdBy) {
    const now = new Date().toISOString()
    const id = generateId(String(data.cooperative_id))
    const pwd = data.password_hash || generateRandom4Digit()
    const password_hash = await hashPassword(pwd)
    const expiryDate = new Date()
    expiryDate.setFullYear(expiryDate.getFullYear() + 1)
    const doc = {
        id,
        cooperative_id: String(data.cooperative_id),
        username: data.username,
        email: data.email || null,
        firebase_uid: data.firebase_uid || null,
        password_hash,
        role: data.role || 'staff',
        permissions: data.permissions || '',
        enterprise_rights: data.enterprise_rights || '',
        subscriptionStatus: 1,
        expiry_date: expiryDate.toISOString(),
        created_at: now,
        created_by: createdBy || 'system',
        modified_at: now,
        modified_by: createdBy || 'system',
        is_deleted: 0,
        is_synced: 0
    }
    await saveDoc('users', doc)
    return { generatedPassword: pwd }
}

export async function updateUser(id, data, modifiedBy) {
    const existing = await getDocById_Global('users', id)
    if (!existing) throw new Error('User not found')
    const now = new Date().toISOString()
    const doc = {
        ...existing,
        username: data.username || existing.username,
        email: data.email !== undefined ? data.email : existing.email,
        firebase_uid: data.firebase_uid !== undefined ? data.firebase_uid : existing.firebase_uid,
        role: data.role || existing.role,
        permissions: data.permissions !== undefined ? data.permissions : existing.permissions,
        enterprise_rights: data.enterprise_rights !== undefined ? data.enterprise_rights : existing.enterprise_rights,
        modified_at: now,
        modified_by: modifiedBy || 'system',
        is_synced: 0
    }
    if (data.password_hash) {
        doc.password_hash = await hashPassword(data.password_hash)
    }
    await saveDoc('users', doc)
}

export async function deleteUser(id) {
    const existing = await getDocById_Global('users', id)
    if (!existing) throw new Error('User not found')
    const now = new Date().toISOString()
    await saveDoc('users', {
        ...existing,
        is_deleted: 1,
        modified_at: now,
        modified_by: 'system',
        is_synced: 0
    })
}

export async function changePassword(username, oldPassword, newPassword, cooperativeId) {
    const users = await getUsersByUsername(cooperativeId, username)
    const user = users[0]
    if (!user) throw new Error('User not found')
    const oldHash = await hashPassword(oldPassword)
    if (user.password_hash !== oldHash) throw new Error('Current password is incorrect')
    const newHash = await hashPassword(newPassword)
    const now = new Date().toISOString()
    await saveDoc('users', {
        ...user,
        password_hash: newHash,
        modified_at: now,
        modified_by: username,
        is_synced: 0
    })
}
