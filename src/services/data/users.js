import { generateId, hashPassword, generateRandom6Digit, isSixDigitPin } from '../../utils/formatters.js'
import { normalizeUsername, usernameKey, normalizeEmail } from '../../utils/normalize.js'
import { saveDoc, getDocById_Global, getUsersByUsername, queryRows } from '../sqliteService.js'

function generateRandom4Digit() {
    return generateRandom6Digit()
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
    const username = normalizeUsername(data.username)
    const email = normalizeEmail(data.email)
    const doc = {
        id,
        cooperative_id: String(data.cooperative_id),
        username,
        username_lower: usernameKey(username),
        email,
        email_lower: email ? usernameKey(email) : null,
        firebase_uid: data.firebase_uid || null,
        password_hash,
        role: data.role || 'staff',
        permissions: data.permissions || '',
        enterprise_rights: data.enterprise_rights || '',
        subscriptionStatus: 1,
        expiry_date: expiryDate.toISOString(),
        force_password_change: true,
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
    const username = data.username !== undefined ? normalizeUsername(data.username) : existing.username
    const email = data.email !== undefined ? normalizeEmail(data.email) : existing.email
    const doc = {
        ...existing,
        username,
        username_lower: usernameKey(username),
        email,
        email_lower: email ? usernameKey(email) : null,
        firebase_uid: data.firebase_uid !== undefined ? data.firebase_uid : existing.firebase_uid,
        role: data.role || existing.role,
        permissions: data.permissions !== undefined ? data.permissions : existing.permissions,
        enterprise_rights: data.enterprise_rights !== undefined ? data.enterprise_rights : existing.enterprise_rights,
        force_password_change: data.force_password_change !== undefined ? data.force_password_change : (existing.force_password_change || false),
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
    // New passwords must be 6-digit numeric PINs; the current password may be legacy.
    if (!isSixDigitPin(String(newPassword || ''))) {
        throw new Error('New PIN must be exactly 6 digits (numbers only).')
    }
    const coopStr = String(cooperativeId)
    const key = String(username || '').toLowerCase()
    const oldPlain = String(oldPassword || '')
    const oldHash = await hashPassword(oldPassword)
    // Current password verifies against the hash OR plaintext legacy storage.
    const matches = (stored) => stored && (stored === oldHash || stored === oldPlain)
    const now = new Date().toISOString()

    // Staff/admins live in users...
    const users = await getUsersByUsername(cooperativeId, username)
    const user = users[0]
    if (user) {
        if (!matches(user.password_hash)) throw new Error('Current password is incorrect')
        await saveDoc('users', {
            ...user,
            password_hash: await hashPassword(newPassword),
            force_password_change: false,
            modified_at: now,
            modified_by: username,
            is_synced: 0
        })
        return
    }

    // ...members live in members (matched by username, mobile, special ID,
    // email or registration number — same identifiers login accepts).
    const allMembers = await queryRows(
        'SELECT * FROM members WHERE cooperative_id = ? AND is_deleted = 0',
        [coopStr]
    )
    const member = (allMembers || []).find(m =>
        String(m.username || '').toLowerCase() === key ||
        String(m.mobile || '').toLowerCase() === key ||
        String(m.special_id || '').toLowerCase() === key ||
        String(m.email || '').toLowerCase() === key ||
        String(m.registration_no || '').toLowerCase() === key
    )
    if (!member) throw new Error('User not found')
    if (!matches(member.password_hash)) throw new Error('Current password is incorrect')
    const doc = {
        ...member,
        password_hash: await hashPassword(newPassword),
        force_password_change: false,
        modified_at: now,
        modified_by: member.username || member.mobile || username,
        is_synced: 0
    }
    delete doc.payment_advise
    await saveDoc('members', doc)
}
