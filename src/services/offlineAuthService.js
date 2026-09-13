/**
 * offlineAuthService.js
 * Manages persistent offline sessions, offline login, and online revalidation.
 * 
 * Session key format: <cooperative_id>_<user_id>
 * This allows multiple users (and multiple cooperatives) to have independent sessions on the same device.
 * 
 * Security:
 * - Passwords are NEVER stored locally.
 * - Only a session token (SHA-256 of uid+coopId+timestamp+random) is stored.
 * - Sessions expire after 10 minutes of inactivity (sliding window).
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

function generateSecureRandom(length) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

const SESSION_TTL_MS = 10 * 60 * 1000  // 10 minutes of inactivity
// Remembered ("Remember me") sessions live much longer and auto-restore on
// launch, giving zero-typing sign-in without ever storing a password.
export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 days
const SYNC_SESSION_KEY = 'cooplog-web-session'
// Alias: how long a session may sit idle before auto-logout.
// Active users keep their session alive via recordActivity().
export const INACTIVITY_TIMEOUT_MS = SESSION_TTL_MS
const ACTIVITY_TOUCH_THROTTLE_MS = 60 * 1000  // extend IndexedDB expiry at most once/min
const WATCHER_CHECK_MS = 30 * 1000  // inactivity watcher tick

/**
 * Synchronous load for app initialization (main.js state).
 * Uses sessionStorage for immediate tab-session state.
 * Returns null when the session has been idle past the timeout.
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
        // Inactivity expiry: idle past the timeout forces a fresh login
        const lastActive = session.lastActivityTs || 0
        if (lastActive && Date.now() - lastActive > INACTIVITY_TIMEOUT_MS) {
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

let _lastTouchTs = 0
let _lastActivityWriteTs = 0
const ACTIVITY_WRITE_THROTTLE_MS = 5 * 1000  // sessionStorage stamp at most every 5s

/**
 * Record user activity: refreshes the idle clock in sessionStorage so
 * active users are never logged out. Extends the IndexedDB offline
 * session expiry at most once per minute (sliding 10-min window).
 * Cheap and safe to call from global interaction listeners.
 */
export function recordActivity() {
    try {
        const now = Date.now()
        // Throttle the sessionStorage read/write (fires on every mousemove)
        if (now - _lastActivityWriteTs < ACTIVITY_WRITE_THROTTLE_MS) return
        const raw = window.sessionStorage.getItem(SYNC_SESSION_KEY)
        if (!raw) return
        const session = JSON.parse(raw)
        _lastActivityWriteTs = now
        session.lastActivityTs = now
        window.sessionStorage.setItem(SYNC_SESSION_KEY, JSON.stringify(session))

        // Sliding expiry for the persistent offline session (throttled)
        if (now - _lastTouchTs > ACTIVITY_TOUCH_THROTTLE_MS) {
            _lastTouchTs = now
            const coopId = session.cooperativeId
            const userId = session.userId || session.memberId || session.userDoc?.id
            if (coopId && userId) {
                touchSession(coopId, userId).catch(() => {})
            }
        }
    } catch {
        // never break the UI on activity bookkeeping
    }
}

let _watcherStarted = false

/**
 * Start the inactivity auto-logout watcher (idempotent).
 * Every 30s: if logged in and idle longer than the timeout,
 * `onTimeout` is invoked (the app performs a full logout there).
 */
export function startInactivityWatcher(onTimeout) {
    if (_watcherStarted) return
    _watcherStarted = true
    setInterval(() => {
        try {
            const raw = window.sessionStorage.getItem(SYNC_SESSION_KEY)
            if (!raw) return
            const session = JSON.parse(raw)
            if (!session?.cooperativeId) return
            const lastActive = session.lastActivityTs || 0
            if (Date.now() - lastActive > INACTIVITY_TIMEOUT_MS) {
                onTimeout && onTimeout()
            }
        } catch {
            // ignore
        }
    }, WATCHER_CHECK_MS)
}

/**
 * Persist the current tab so resume (reload / cold start) lands back on the
 * last page. Writes sessionStorage synchronously plus the IndexedDB session
 * row best-effort (the row is what cold starts read). Fire-and-forget safe.
 */
export async function persistActiveTab(tab) {
    if (!tab) return
    try {
        const raw = window.sessionStorage.getItem(SYNC_SESSION_KEY)
        if (raw) {
            const s = JSON.parse(raw)
            s.activeTab = tab
            s.lastActivityTs = Date.now()
            window.sessionStorage.setItem(SYNC_SESSION_KEY, JSON.stringify(s))
            const coopId = s.cooperativeId
            const userId = s.userId || s.memberId || s.userDoc?.id
            if (coopId && userId) {
                const key = makeSessionKey(coopId, userId)
                const row = await loadLocalSession(key).catch(() => null)
                if (row && row.active_tab !== tab) {
                    await saveLocalSession(key, { ...row, active_tab: tab }).catch(() => {})
                }
            }
        }
    } catch {
        // never break navigation on bookkeeping
    }
}

/**
 * Repair a restored welcomeUser against the CURRENT local database.
 * Persisted snapshots (role/permissions/enterprises/coop name) can predate
 * admin changes or have been saved as '' by older builds. A fresh login
 * already rebuilds these from the live user doc (main.js), so restore must
 * do the same from the local users/members + cooperatives tables —
 * otherwise the dashboard filters on stale rights and shows the coop id.
 * Best-effort: never throws, returns the (possibly unrepaired) object.
 */
export async function repairWelcomeUser(welcomeUser) {
    if (!welcomeUser) return welcomeUser
    try {
        const { getDocById_Global } = await import('./sqliteService.js')
        const isMember = welcomeUser.role === 'member' || welcomeUser.userCollection === 'members'
        const collection = isMember ? 'members' : 'users'
        const id = welcomeUser.userId || welcomeUser.memberId
        if (id) {
            const row = await getDocById_Global(collection, String(id)).catch(() => null)
            if (row && !row.is_deleted) {
                welcomeUser.role = collection === 'members' ? 'member' : (row.role || welcomeUser.role)
                if (row.permissions !== undefined) welcomeUser.permissions = row.permissions
                const rights = row.enterprise_rights || row.enterprises
                if (rights !== undefined) {
                    welcomeUser.enterprises = rights
                    welcomeUser.enterprise_rights = rights
                }
                welcomeUser.username = row.username || row.mobile || welcomeUser.username
                welcomeUser.fullName = collection === 'members'
                    ? (`${row.last_name || ''} ${row.first_name || ''} ${row.middle_name || ''}`.trim() || welcomeUser.fullName)
                    : (row.full_name || row.username || welcomeUser.fullName)
            }
        }
        // memberId must mirror a fresh login: members keep it, staff/admin get
        // null. A stale user_id here member-scopes balance/remittance/member
        // queries (balance.js) and zeroes the whole dashboard.
        if (welcomeUser.role === 'member') {
            welcomeUser.memberId = welcomeUser.memberId || welcomeUser.userId || null
        } else {
            welcomeUser.memberId = null
        }
        if (welcomeUser.cooperativeId && (!welcomeUser.cooperativeName || welcomeUser.cooperativeName === welcomeUser.cooperativeId)) {
            const coop = await getDocById_Global('cooperatives', String(welcomeUser.cooperativeId)).catch(() => null)
            const name = coop?.full_name || coop?.short_name
            if (name) welcomeUser.cooperativeName = name
        }
    } catch {
        // repair is best-effort; a partial session is better than no session
    }
    return welcomeUser
}

/**
 * Restore a persisted session from IndexedDB into sessionStorage.
 * Used after sessionStorage is cleared (e.g. browser crash).
 * The restored session is repaired against the local DB (see
 * repairWelcomeUser) and written back so the next restore is clean.
 */
export async function restoreSessionFromIndexedDB() {
    try {
        const session = await loadBestOfflineSession()
        if (!session) return null
        const welcomeUser = sessionToWelcomeUser(session)
        await repairWelcomeUser(welcomeUser)
        // Policy: no dashboard on a weak stored credential. A restored
        // session skips password entry, so re-check the live row here —
        // plaintext hash or explicit flag means fresh login + forced change.
        if (await sessionRequiresPasswordChange(welcomeUser).catch(() => false)) {
            console.warn('[OfflineAuth] Restored session requires password change; forcing fresh login.')
            return null
        }
        welcomeUser.lastActivityTs = Date.now()
        window.sessionStorage.setItem(SYNC_SESSION_KEY, JSON.stringify(welcomeUser))
        // Persist the repaired snapshots back so future restores are clean
        try {
            await saveLocalSession(`${session.cooperative_id}_${session.user_id}`, {
                ...session,
                cooperative_name: welcomeUser.cooperativeName || session.cooperative_name || '',
                permissions_snapshot: JSON.stringify(welcomeUser.permissions ?? ''),
                enterprises_snapshot: JSON.stringify(welcomeUser.enterprises ?? welcomeUser.enterprise_rights ?? ''),
                full_name: welcomeUser.fullName || session.full_name || '',
                username: welcomeUser.username || session.username || '',
                last_verified_ts: Date.now(),
            })
        } catch {
            // persist-back is best-effort
        }
        return welcomeUser
    } catch {
        return null
    }
}

/**
 * Save session for both immediate use and long-term offline persistence.
 * `remember` (from the login screen's Remember-me checkbox) grants the
 * persistent session a 30-day life so launches auto-sign-in; otherwise the
 * standard 10-minute inactivity expiry applies. Passwords are never stored.
 */
export async function saveSessionLocally(session, password, remember) {
    if (!session) {
        clearSavedSession()
        return
    }

    // 1. Sync save for main.js state (stamped so idle sessions can expire)
    const payload = { ...session, lastActivityTs: Date.now() }
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
        activeTab: session.activeTab || 'history',
        // undefined = not a login event: keep whatever the stored row has
        // (dashboard re-renders must not demote remembered sessions).
        remember,
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
    const session = await validateOfflineLogin(normalizedUsername, pwdHash, cooperativeId, String(password || ''))
    // Preserve the force-change signal: sessionToWelcomeUser only maps full
    // sessions and would strip it, leaving a hollow (all-undefined) user
    // that sails past the modal straight to an Access-Denied dashboard.
    if (session && session.forceChange) return session
    return sessionToWelcomeUser(session)
}

function makeSessionKey(cooperativeId, userId) {
    return `${cooperativeId}_${userId}`
}

/**
 * Generate a secure session token (no password stored).
 */
async function generateSessionToken(userId, cooperativeId) {
    const raw = `${userId}|${cooperativeId}|${Date.now()}|${generateSecureRandom(16)}`
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
    // Explicit true/false comes from a login event; undefined means a
    // background re-save (e.g. dashboard render) — inherit the stored flag
    // so those never demote a remembered session back to 10 minutes.
    let remembered = !!sessionData.remember
    if (sessionData.remember === undefined) {
        try {
            const existing = await loadLocalSession(sessionKey).catch(() => null)
            if (existing && existing.remember) remembered = true
        } catch {
            // inherit-best-effort only
        }
    }

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
        remember: remembered,
        last_verified_ts: now,
        session_expires_ts: now + (remembered ? REMEMBER_TTL_MS : SESSION_TTL_MS),
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
export async function validateOfflineLogin(username, passwordHash, cooperativeId, plaintextPassword = '') {
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
            if (stored && (stored === passwordHash || (plaintextPassword && stored === plaintextPassword))) {
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
                    if (stored && (stored === passwordHash || (plaintextPassword && stored === plaintextPassword))) {
                        userDoc = m
                        collection = 'members'
                        break
                    }
                }
            }
        }

        if (!userDoc) return null

        // Same 6-digit PIN policy as online login (see formatters.js):
        // 6-digit PINs pass, grandfathered legacy-complex passwords pass,
        // plain-text non-legacy and old <6-digit PINs must change.
        const { needsForceChangeAfterMatch } = await import('../utils/formatters.js')
        if (needsForceChangeAfterMatch(userDoc.password_hash || '', plaintextPassword, userDoc.force_password_change === true)) {
            return { forceChange: true, userDoc, collection };
        }

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
        const _now = Date.now()

        if (!session) {
            // Build a "synthetic" session if one doesn't exist.
            // Snapshots come straight from the live local userDoc, and the
            // coop name is resolved locally so restores never show the id.
            const role = collection === 'members' ? 'member' : (userDoc.role || 'user')
            const now = Date.now()
            let coopName = ''
            try {
                const { getDocById_Global } = await import('./sqliteService.js')
                const coop = await getDocById_Global('cooperatives', String(coopId)).catch(() => null)
                coopName = coop?.full_name || coop?.short_name || ''
            } catch {
                // name lookup is best-effort
            }
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
                cooperative_name: coopName,
                active_tab: 'history',
                session_token: 'offline_' + now,
                last_verified_ts: now,
                session_expires_ts: now + SESSION_TTL_MS,
                created_ts: now,
            }
            await saveLocalSession(sessionKey, session)
        } else {
            // Refresh snapshots from the live local userDoc on every offline
            // login, so permission/enterprise changes apply without an
            // online round-trip (same repair as restoreSessionFromIndexedDB).
            session.permissions_snapshot = JSON.stringify(userDoc.permissions || '');
            session.enterprises_snapshot = JSON.stringify(userDoc.enterprise_rights || userDoc.enterprises || '');
            session.username = userDoc.username || userDoc.mobile || session.username;
            session.role = collection === 'members' ? 'member' : (userDoc.role || session.role);
            session.full_name = collection === 'members'
                ? (`${userDoc.last_name || ''} ${userDoc.first_name || ''} ${userDoc.middle_name || ''}`.trim() || (userDoc.username || userDoc.mobile))
                : (userDoc.full_name || userDoc.username || session.full_name);
            if (!session.cooperative_name || session.cooperative_name === String(coopId)) {
                try {
                    const { getDocById_Global: _getById } = await import('./sqliteService.js')
                    const _coop = await _getById('cooperatives', String(coopId)).catch(() => null)
                    const _name = _coop?.full_name || _coop?.short_name
                    if (_name) session.cooperative_name = _name
                } catch {
                    // best-effort
                }
            }
            session.last_verified_ts = _now
            // Preserve long-lived remembered sessions; standard ones stay 10-min.
            session.session_expires_ts = _now + (session.remember ? REMEMBER_TTL_MS : SESSION_TTL_MS)
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
        session_expires_ts: Date.now() + (session.remember ? REMEMBER_TTL_MS : SESSION_TTL_MS),
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
 * Remove ALL local persistent sessions from IndexedDB.
 * Called on full logout to prevent any session from being restored on refresh.
 */
export async function clearAllOfflineSessions() {
    try {
        const all = await getAllLocalSessions()
        for (const s of all) {
            const sk = `${s.cooperative_id}_${s.user_id}`
            await deleteLocalSession(sk).catch(() => {})
        }
    } catch (e) {
        console.warn('[OfflineAuth] Failed to clear all sessions:', e)
    }
}

/**
 * Convert a local_session row into the app's welcomeUser format.
 */
export function sessionToWelcomeUser(session) {
    if (!session) return null
    const isMember = session.role === 'member'
    return {
        // Staff/admin must have memberId null (like a fresh online login);
        // a spurious memberId would member-scope every dashboard query to zero rows.
        memberId: isMember ? (session.member_id || session.user_id) : null,
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
 * Policy check: must this session set a new password before ANY dashboard
 * access — including session restores, which skip password entry?
 * Plaintext (non-SHA-256) stored hash or an explicit flag is sufficient
 * evidence on its own (mirrors needsForceChangeAfterMatch cases 1-2, which
 * need no typed input). Fail-open on lookup errors so a broken DB never
 * bricks logins; callers run this only after initDb.
 */
export async function sessionRequiresPasswordChange(welcomeUser) {
    try {
        if (!welcomeUser) return false
        const { getDocById_Global } = await import('./sqliteService.js')
        const { isSha256Hex } = await import('../utils/formatters.js')
        const isMember = welcomeUser.role === 'member' || welcomeUser.userCollection === 'members'
        const collection = isMember ? 'members' : 'users'
        const id = welcomeUser.userId || welcomeUser.memberId
        if (!id) return false
        const row = await getDocById_Global(collection, String(id)).catch(() => null)
        if (!row || row.is_deleted) return false
        const flag = row.force_password_change
        if (flag === true || flag === 1 || flag === '1') return true
        if (!isSha256Hex(row.password_hash || '')) return true
        return false
    } catch {
        return false
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
