import { generateId, hashPassword } from '../../utils/formatters.js'
import { saveDoc, enqueueWrite } from '../sqliteService.js'

function generateRandomChars(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
        result += chars[Math.floor(Math.random() * chars.length)]
    }
    return result
}

export async function registerCooperative(coopData) {
    const now = new Date().toISOString()
    const cooperativeId = generateId().substring(0, 10)
    const adminId = generateId()
    const adminPwd = '123456'
    const adminPasswordHash = await hashPassword(adminPwd)
    const subKey = `${generateRandomChars(3)}-${generateRandomChars(3)}-${generateRandomChars(3)}`
    const expiryDate = new Date()
    expiryDate.setFullYear(expiryDate.getFullYear() + 1)

    const coop = {
        id: cooperativeId,
        full_name: coopData.full_name,
        short_name: coopData.short_name,
        contact_number: coopData.contact_number || '',
        email: coopData.email,
        address: coopData.address || '',
        logo_path: coopData.logo_path || null,
        coop_first_month: coopData.coop_first_month || '',
        subscription_key: subKey,
        expiry_date: expiryDate.toISOString(),
        created_at: now,
        created_by: 'system',
        modified_at: now,
        modified_by: 'system',
        is_deleted: 0,
        is_synced: 0
    }

    const adminUser = {
        id: adminId,
        username: 'admin',
        username_lower: 'admin',
        password_hash: adminPasswordHash,
        force_password_change: true,
        cooperative_id: cooperativeId,
        role: 'admin',
        permissions: 'admin',
        enterprise_rights: 'all',
        subscriptionStatus: 1,
        expiry_date: expiryDate.toISOString(),
        created_at: now,
        created_by: 'system',
        modified_at: now,
        modified_by: 'system',
        is_deleted: 0,
        is_synced: 0
    }

    await saveDoc('cooperatives', coop)
    await enqueueWrite(cooperativeId, 'cooperatives', cooperativeId, 'set', coop)
    await saveDoc('users', adminUser)
    await enqueueWrite(cooperativeId, 'users', adminId, 'set', adminUser)

    return { generatedPassword: adminPwd, cooperativeId }
}
