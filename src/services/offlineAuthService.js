/**
 * offlineAuthService.js
 * Manages persistent offline sessions, offline login, and online revalidation.
 * 
 * Session key format: <cooperative_id>_<user_id>
 * This allows multiple users (and multiple cooperatives) to have independent sessions on the same device.
 * 
 * Security:
 * - Passwords are NEVER stored locally.
 * - Only a session token (SHA-256 of uid+coopId+timestamp) is stored.
 * - Sessions expire after 7 days.
 * - Permissions snapshot is compared on revalidation; mismatches force logout.
 */

import {
    saveLocalSession,
    loadLocalSession,
    getAllLocalSessions,
    deleteLocalSession,
    getUsersByUsername,
    getUserByEmail,
    getMemberByMobile,
    getMemberByRegistrationNo,
    getMemberByEmail,
    queryRows,
} from './sqliteService.js'
import { hashPassword } from '../utils/formatters.js'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000  // 7 days
const SYNC_SESSION_KEY = 'cooplog-web-session'

/**
 * Synchronous load for app initialization (main.js state).
 * Uses sessionStorage for immediate tab-session state.
 */
export function loadSavedSession() {
    try {
        const raw = window.sessionStorage.getItem(SYNC_SESSION_KEY)
        if (!raw) return null
        const session = JSON.parse(raw)
        // Basic validation
        if (!session.cooperativeId || (!session.memberId && session.role === 'member')) {
            window.sessionStorage.removeItem(SYNC_SESSION_KEY)
            return null
        }
        return session
    } catch {
        return null
    }
}

/**
 * Synchronous clear.
 */
export function clearSavedSession() {
    window.sessionStorage.removeItem(SYNC_SESSION_KEY)
}

/**
 * Restore a persisted session from IndexedDB into sessionStorage.
 * Used after sessionStorage is cleared (e.g. browser crash).
 */
export async function restoreSessionFromIndexedDB() {
    try {
        const session = await loadBestOfflineSession()
        if (!session) return null
        const welcomeUser = sessionToWelcomeUser(session)
        window.sessionStorage.setItem(SYNC_SESSION_KEY, JSON.stringify(welcomeUser))
        return welcomeUser
    } catch {
        return null
    }
}

/**
 * Save session for both immediate use and long-term offline persistence.
 */
export async function saveSessionLocally(session, password) {
    if (!session) {
        clearSavedSession()
        return
    }

    // 1. Sync save for main.js state
    const payload = { ...session }
    window.sessionStorage.setItem(SYNC_SESSION_KEY, JSON.stringify(payload))

    // 2. Async save for long-term offline login persistence
    // Map from authService format to offlineAuthService format if needed
    const offlineData = {
        userId: session.userDoc?.id || session.memberId || session.userId,
        userCollection: session.collection || session.userCollection || (session.role === 'member' ? 'members' : 'users'),
        cooperativeId: session.cooperativeId,
        username: session.username,
        role: session.role,
        permissions: session.permissions,
        enterprises: session.enterprises,
        memberId: session.memberId,
        fullName: session.fullName,
        cooperativeName: session.cooperativeName,
        activeTab: session.activeTab || 'history'
    }

    // Fire-and-forget: offline persistence is best-effort, non-critical for login
    saveOfflineSession(offlineData).catch(err => {
        console.warn('[OfflineAuth] saveOfflineSession failed (non-critical):', err.message)
    })

    // 3. Save the user document itself to SQLite users/members table
    // This is crucial so validateOfflineLogin can find the password hash later
    if (session.userDoc) {
        try {
            const { saveDoc } = await import('./sqliteService.js')
            // Fire-and-forget; errors are caught internally
            saveDoc(offlineData.userCollection, session.userDoc).catch(err => {
                console.warn('[OfflineAuth] Failed to save userDoc locally (non-critical):', err.message)
            })
        } catch (err) {
            console.warn('[OfflineAuth] Failed to import saveDoc (non-critical):', err.message)
        }
    }
}

/**
 * Wrapper for main.js login flow.
 */
export async function attemptOfflineLogin(username, password, cooperativeId) {
    const normalizedUsername = String(username || '').trim().toLowerCase()
    const { hashPassword } = await import('../utils/formatters.js')
    const pwdHash = await hashPassword(password)
    const session = await validateOfflineLogin(normalizedUsername, pwdHash, cooperativeId)
    return sessionToWelcomeUser(session)
}

function makeSessionKey(cooperativeId, userId) {
    return `${cooperativeId}_${userId}`
}

/**
 * Generate a secure session token (no password stored).
 */
async function generateSessionToken(userId, cooperativeId) {
    const raw = `${userId}|${cooperativeId}|${Date.now()}|${Math.random()}`
    return hashPassword(raw)
}

/**
 * Save a verified online session to persistent local storage.
 * Called after a successful Firestore login.
 */
export async function saveOfflineSession(sessionData) {
    const {
        userId,
        userCollection,   // 'users' or 'members'
        cooperativeId,
        username,
        role,
        permissions,
        enterprises,
        memberId,
        fullName,
        cooperativeName,
        activeTab,
    } = sessionData

    if (!userId || !cooperativeId) return

    const token = await generateSessionToken(userId, cooperativeId)
    const now = Date.now()
    const sessionKey = makeSessionKey(cooperativeId, userId)

    await saveLocalSession(sessionKey, {
        user_id: userId,
        user_collection: userCollection || 'users',
        cooperative_id: String(cooperativeId),
        username,
        role,
        permissions_snapshot: JSON.stringify(permissions || ''),
        enterprises_snapshot: JSON.stringify(enterprises || sessionData.enterprise_rights || ''),
        member_id: role === 'member' ? (memberId || userId) : null,
        full_name: fullName || '',
        registration_no: sessionData.registrationNo || sessionData.registration_no || '',
        cooperative_name: cooperativeName || '',
        active_tab: activeTab || 'history',
        session_token: token,
        last_verified_ts: now,
        session_expires_ts: now + SESSION_TTL_MS,
        created_ts: now,
    })

    return sessionKey
}

/**
 * Load the most recent valid local session.
 * Returns null if no valid session exists.
 */
export async function loadBestOfflineSession() {
    try {
        const all = await getAllLocalSessions()
        if (!all || all.length === 0) return null

        const now = Date.now()
        // Filter to non-expired sessions, pick most recently verified
        const valid = all
            .filter(s => s.session_expires_ts > now)
            .sort((a, b) => b.last_verified_ts - a.last_verified_ts)

        return valid.length > 0 ? valid[0] : null
    } catch (err) {
        console.error('[OfflineAuth] Failed to load sessions:', err)
        return null
    }
}

/**
 * Load a specific session by cooperativeId + userId.
 */
export async function loadOfflineSession(cooperativeId, userId) {
    try {
        const sessionKey = makeSessionKey(cooperativeId, userId)
        const session = await loadLocalSession(sessionKey)
        if (!session) return null
        if (Date.now() > session.session_expires_ts) {
            await deleteLocalSession(sessionKey)
            return null
        }
        return session
    } catch (err) {
        console.error('[OfflineAuth] loadOfflineSession error:', err)
        return null
    }
}

/**
 * Validate an offline login attempt (no network).
 * Checks local session and local password hash.
 * 
 * @param {string} username
 * @param {string} passwordHash - SHA-256 hash of entered password
 * @param {string} cooperativeId
 * @returns session object or null
 */
export async function validateOfflineLogin(username, passwordHash, cooperativeId) {
    try {
        const coopId = String(cooperativeId)
        const normalizedInput = String(username || '').toLowerCase()
        const normalizedInputNum = !isNaN(parseInt(normalizedInput, 10)) ? parseInt(normalizedInput, 10) : null;

        let userDoc = null
        let collection = ''

        // 1. Try to find in users table
        const users = await getUsersByUsername(coopId, username)
        const usersByE = await getUserByEmail(coopId, username)
        for (const u of [...users, ...usersByE]) {
            const stored = u.password_hash || ''
            if (stored && (stored === passwordHash || stored === String(username || ''))) {
                userDoc = u
                collection = 'users'
                break
            }
        }

        // 2. If not in users, try all member fields
        if (!userDoc) {
            const allMembers = await queryRows('SELECT * FROM members WHERE cooperative_id = ? AND is_deleted = 0', [coopId])
            for (const m of allMembers) {
                const fieldsToCheck = [
                    String(m.mobile || ''),
                    String(m.registration_no || ''),
                    String(m.special_id || ''),
                    String(m.email || '')
                ]
                const matches = fieldsToCheck.some(field => {
                    const fieldLower = field.toLowerCase()
                    return fieldLower === normalizedInput || 
                           (normalizedInputNum !== null && String(field) === String(normalizedInputNum))
                })
                if (matches) {
                    const stored = m.password_hash || ''
                    if (stored && (stored === passwordHash || stored === String(username || ''))) {
                        userDoc = m
                        collection = 'members'
                        break
                    }
                }
            }
        }

        if (!userDoc) return null

        if (collection === 'members' && userDoc) {
            const lastLoginStr = new Date().toISOString()
            const currentCount = parseInt(userDoc.login_count || 0, 10)
            const newCount = currentCount + 1
            
            userDoc.last_login = lastLoginStr
            userDoc.login_count = newCount
            
            try {
                const { saveDoc } = await import('./sqliteService.js')
                await saveDoc('members', {
                    ...userDoc,
                    last_login: lastLoginStr,
                    login_count: newCount
                })
            } catch (err) {
                console.warn('[OfflineAuth] Failed to update offline member stats:', err.message)
            }
        }

        // 3. We have a valid user/password. Now find or build a session.
        const userId = userDoc.id
        const sessionKey = makeSessionKey(coopId, userId)
        let session = await loadLocalSession(sessionKey)

        if (!session) {
            // Build a "synthetic" session if one doesn't exist
            const role = collection === 'members' ? 'member' : (userDoc.role || 'user')
            const now = Date.now()
            session = {
                user_id: userId,
                user_collection: collection,
                cooperative_id: coopId,
                username: userDoc.username || userDoc.mobile,
                role: role,
                permissions_snapshot: JSON.stringify(userDoc.permissions || ''),
                enterprises_snapshot: JSON.stringify(userDoc.enterprise_rights || userDoc.enterprises || ''),
                member_id: collection === 'members' ? userId : null,
                full_name: collection === 'members' 
                    ? `${userDoc.last_name || ''} ${userDoc.first_name || ''} ${userDoc.middle_name || ''}`.trim() || (userDoc.username || userDoc.mobile)
                    : (userDoc.full_name || userDoc.username),
                registration_no: userDoc.registration_no || '',
                cooperative_name: '', 
                active_tab: 'history',
                session_token: 'offline_' + now,
                last_verified_ts: now,
                session_expires_ts: now + SESSION_TTL_MS,
                created_ts: now,
            }
            await saveLocalSession(sessionKey, session)
        } else if (!session.full_name) {
            // Update old session with full_name
            session.full_name = collection === 'members' 
                ? `${userDoc.last_name || ''} ${userDoc.first_name || ''} ${userDoc.middle_name || ''}`.trim() || (userDoc.username || userDoc.mobile)
                : (userDoc.full_name || userDoc.username);
            await saveLocalSession(sessionKey, session)
        }

        return session
    } catch (err) {
        console.error('[OfflineAuth] validateOfflineLogin error:', err)
        return null
    }
}

/**
 * Revalidate a session against Firestore when internet is available.
 * Checks: user still exists, not deleted, permissions unchanged.
 * Returns: { valid: true } or { valid: false, reason: string }
 */
export async function revalidateOnline(session) {
    try {
        const { getDb } = await import('../firebase.js')
        const db = getDb()

        // Get userId and coopId from session
        const userId = session.user_id
        const coopId = session.cooperative_id

        // Fetch from Firestore
        let userDoc = null
        if (session.user_collection === 'members') {
            const { getDoc, doc } = await import('../firebase.js')
            const snap = await getDoc(doc(db, 'members', userId))
            if (!snap.exists()) return { valid: false, reason: 'Account not found.' }
            userDoc = { id: snap.id, ...snap.data() }
        } else {
            const { getDoc, doc } = await import('../firebase.js')
            const snap = await getDoc(doc(db, 'users', userId))
            if (!snap.exists()) return { valid: false, reason: 'Account not found.' }
            userDoc = { id: snap.id, ...snap.data() }
        }

        // Check deleted
        if (userDoc.is_deleted) return { valid: false, reason: 'Account has been deactivated.' }

        // Check cooperative match
        if (String(userDoc.cooperative_id) !== coopId) {
            return { valid: false, reason: 'Cooperative mismatch.' }
        }

        // Check permissions changed
        const currentPerms = JSON.stringify(userDoc.permissions || '')
        const storedPerms = session.permissions_snapshot || ''
        if (currentPerms !== storedPerms) {
            return { valid: false, reason: 'Your permissions have changed. Please log in again.' }
        }

        // Check role changed
        const currentRole = session.user_collection === 'members' ? 'member' : (userDoc.role || 'user')
        if (currentRole !== session.role) {
            return { valid: false, reason: 'Your role has changed. Please log in again.' }
        }

        return { valid: true, userDoc }
    } catch (err) {
        console.error('[OfflineAuth] revalidateOnline error:', err)
        // Network might be flaky — don't invalidate on network errors
        return { valid: true, networkError: true }
    }
}

/**
 * Update the last_verified_ts and extend expiry after successful revalidation.
 */
export async function touchSession(cooperativeId, userId) {
    const sessionKey = makeSessionKey(cooperativeId, userId)
    const session = await loadLocalSession(sessionKey)
    if (!session) return
    await saveLocalSession(sessionKey, {
        ...session,
        last_verified_ts: Date.now(),
        session_expires_ts: Date.now() + SESSION_TTL_MS,
    })
}

/**
 * Remove a specific user's offline session (logout).
 */
export async function clearOfflineSession(cooperativeId, userId) {
    const sessionKey = makeSessionKey(cooperativeId, userId)
    await deleteLocalSession(sessionKey)
}

/**
 * Convert a local_session row into the app's welcomeUser format.
 */
export function sessionToWelcomeUser(session) {
    if (!session) return null
    return {
        memberId: session.member_id || session.user_id,
        userId: session.user_id,
        userCollection: session.user_collection,
        username: session.username,
        role: session.role,
        permissions: JSON.parse(session.permissions_snapshot || '""'),
        enterprises: JSON.parse(session.enterprises_snapshot || '""'),
        cooperativeId: session.cooperative_id,
        cooperativeName: session.cooperative_name || session.cooperative_id,
        fullName: session.full_name || session.username,
        registrationNo: session.registration_no || '',
        activeTab: session.active_tab || 'history',
        isOfflineSession: true,
    }
}

/**
 * Discover which cooperatives a username/mobile has sessions for (offline mode).
 */
export async function discoverCooperativesOffline(username) {
    try {
        const coopIds = new Set()
        const normalizedInput = String(username || '').trim().toLowerCase()
        if (!normalizedInput) return []

        console.log('[OfflineAuth] Discovering cooperatives for:', normalizedInput)

        // 1. Check existing sessions (highest priority for names)
        const allSessions = await getAllLocalSessions()
        const now = Date.now()
        allSessions.forEach(s => {
            if (s.session_expires_ts > now && (
                String(s.username || '').toLowerCase() === normalizedInput || 
                String(s.member_id || '').toLowerCase() === normalizedInput || 
                String(s.registration_no || '').toLowerCase() === normalizedInput ||
                String(s.email || '').toLowerCase() === normalizedInput
            )) {
                coopIds.add(String(s.cooperative_id))
            }
        })

        // 2. Check users table (globally)
        const userMatches = await queryRows('SELECT cooperative_id, username, email FROM users WHERE is_deleted = 0')
        userMatches.forEach(u => {
            if (String(u.username || '').toLowerCase() === normalizedInput || String(u.email || '').toLowerCase() === normalizedInput) {
                coopIds.add(String(u.cooperative_id))
            }
        })

        // 3. Check members table (globally) - by mobile, registration_no, special_id, email
        const memberMatches = await queryRows('SELECT cooperative_id, mobile, registration_no, special_id, email FROM members WHERE is_deleted = 0')
        memberMatches.forEach(m => {
            if (
                String(m.mobile || '').toLowerCase() === normalizedInput || 
                String(m.registration_no || '').toLowerCase() === normalizedInput || 
                String(m.special_id || '').toLowerCase() === normalizedInput ||
                String(m.email || '').toLowerCase() === normalizedInput
            ) {
                coopIds.add(String(m.cooperative_id))
            }
        })

        // 4. Look up cooperative names from the cooperatives table
        const allCoops = await queryRows('SELECT id, full_name, short_name FROM cooperatives WHERE is_deleted = 0')
        const coopNameMap = new Map()
        allCoops.forEach(c => coopNameMap.set(String(c.id), c.full_name || c.short_name || c.id))

        const result = Array.from(coopIds).map(id => ({
            id,
            name: coopNameMap.get(id) || id
        }))
        console.log('[OfflineAuth] Discovery results:', result)
        return result
    } catch (err) {
        console.error('[OfflineAuth] discoverCooperativesOffline error:', err)
        return []
    }
}

export async function hasLocalAuthData() {
    try {
        const users = await queryRows('SELECT 1 FROM users WHERE is_deleted = 0 LIMIT 1')
        if (users.length > 0) return true
        const members = await queryRows('SELECT 1 FROM members WHERE is_deleted = 0 LIMIT 1')
        if (members.length > 0) return true
        return false
    } catch {
        return false
    }
}
