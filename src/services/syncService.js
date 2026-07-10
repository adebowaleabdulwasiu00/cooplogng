/**
 * syncService.js
 * Compatibility layer and push queue engine.
 * All background sync logic is now in backgroundSyncService.js.
 * - pushQueue: uploads local writes to Firestore when online
 * - prepareForFirestore: data conversion for cloud writes
 * - Thin wrapper around backgroundSyncService for backwards compatibility
 */

import { getDb, doc, setDoc, updateDoc, Timestamp, serverTimestamp, arrayUnion, writeBatch } from '../firebase.js'
import { getAllItems } from './indexedDbService.js'
import {
    getPendingQueue,
    removeQueueItem,
    removeQueueItemsBatch,
    updateQueueStatus,
    runSql,
    hardDeleteDoc,
    hasPendingWrites,
} from './sqliteService.js'
import { loadDoc } from './sqlite/mutationEngine.js'
import { syncBus, SyncEvents } from './syncEventBus.js'
import { initializeBackgroundSync, triggerFullSync, setSyncSession } from './backgroundSyncService.js'
import { initializeBackgroundAuditor, setAuditSession } from './backgroundAuditorService.js'

export const SyncStatus = {
    OFFLINE: 'offline',
    RECONNECTING: 'reconnecting',
    ONLINE: 'online',
    SYNCING: 'syncing',
    NEEDS_VERIFY: 'needs_verify',
}

const CURRENT_SCHEMA_VERSION = 11

// ─── Initialization ───────────────────────────────────────────────────────────

export async function initializeSyncService() {
    const { loadSavedSession, clearSavedSession, restoreSessionFromIndexedDB } = await import('./offlineAuthService.js')
    let session = loadSavedSession()

    if (!session) {
        session = await restoreSessionFromIndexedDB()
        if (!session) {
            syncBus.emit(SyncEvents.SYNC_STATUS_CHANGED, { status: 'offline' })
            return
        }
    }

    // Set session for background sync
    setSyncSession(session)

    // Start the background sync engine (isolated from UI)
    await initializeBackgroundSync(session)

    // Start the background financial auditor
    setAuditSession(session)
    initializeBackgroundAuditor(session)
}

// ─── Hard Restore (User-initiated) ───────────────────────────────────────────

export async function performHardRestore(cooperativeId) {
    console.log('[Sync] Hard Restore: Pushing pending writes...')
    try {
        await pushQueue(cooperativeId)
    } catch (e) {
        console.warn('[Sync] Hard Restore: Failed to push some writes, continuing anyway.', e)
    }

    const { wipeDatabase } = await import('./sqliteService.js')
    await wipeDatabase()

    const { clearSavedSession } = await import('./offlineAuthService.js')
    clearSavedSession()

    window.location.href = window.location.origin + window.location.pathname
}

// ─── Initial full sync (triggered from login) ───────────────────────────────

export async function syncCooperativeData(cooperativeId, role, memberId, permissions = [], username = null, registrationNo = '', forceFull = false) {
    const { getAppSetting } = await import('./sqliteService.js')
    const lastUser = await getAppSetting('last_synced_user')
    const currentUser = username || memberId
    const userChanged = lastUser && currentUser && lastUser !== currentUser
    const effectiveForceFull = forceFull || userChanged

    if (userChanged) {
        console.log(`[Sync] User changed from ${lastUser} to ${currentUser}. Forcing full sync.`)
    }

    const session = {
        cooperative_id: cooperativeId,
        role,
        user_id: memberId,
        member_id: memberId,
        permissions: permissions,
        username: username,
        registration_no: registrationNo
    }

    setSyncSession(session)
    setAuditSession(session)
    initializeBackgroundAuditor(session)
    await triggerFullSync(session, effectiveForceFull)
}

// ─── Push Queue ───────────────────────────────────────────────────────────────

const withTimeout = (promise, ms, description = 'Operation') => {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${description} timed out after ${ms}ms`)), ms))
    ]);
};

let _isPushing = false

const FIRESTORE_BATCH_SIZE = 200
const BATCH_CONCURRENCY = 5
const BATCH_RATE_LIMIT_MS = 250

export async function pushQueue(cooperativeId) {
    if (_isPushing) return true
    _isPushing = true

    try {
        const queue = await getPendingQueue(cooperativeId)
        if (queue.length === 0) return true

        console.log(`[Sync] Pushing ${queue.length} items in batches of ${FIRESTORE_BATCH_SIZE}...`)
        let successCount = 0
        let failCount = 0

        const batches = []
        for (let i = 0; i < queue.length; i += FIRESTORE_BATCH_SIZE) {
            batches.push(queue.slice(i, i + FIRESTORE_BATCH_SIZE))
        }

        const processBatch = async (batch) => {
            const db = getDb()
            const fbBatch = writeBatch(db)
            const committed = []

            for (const item of batch) {
                try {
                    await updateQueueStatus(item.id, 'processing')

                    let payload = null
                    if (item.merged_document) {
                        try {
                            payload = typeof item.merged_document === 'string'
                                ? JSON.parse(item.merged_document)
                                : item.merged_document
                        } catch (e) {
                            payload = null
                        }
                    }
                    if (!payload) {
                        payload = await loadDoc(item.collection_name, item.document_id, cooperativeId)
                    }

                    if (item.operation_type === 'delete' && payload) {
                        payload.is_deleted = 1
                    }

                    if (!payload || Object.keys(payload).length === 0) {
                        await removeQueueItem(item.id)
                        continue
                    }

                    const requiredCoopId = payload.cooperative_id ||
                        (item.collection_name === 'cooperatives' ? payload.id : null)
                    if (!requiredCoopId) {
                        await updateQueueStatus(item.id, 'failed', 'Missing cooperative_id')
                        failCount++
                        continue
                    }

                    const docRef = doc(db, item.collection_name, item.document_id)
                    const firestorePayload = {
                        ...prepareForFirestore(payload),
                        sync_at: serverTimestamp()
                    }

                    if (item.operation_type === 'set' || item.operation_type === 'add') {
                        fbBatch.set(docRef, firestorePayload)
                    } else if (item.collection_name === 'notifications' && item.merged_document) {
                        try {
                            const partial = typeof item.merged_document === 'string'
                                ? JSON.parse(item.merged_document)
                                : item.merged_document
                            if (partial.viewed && Array.isArray(partial.viewed)) {
                                fbBatch.set(docRef, firestorePayload, { merge: true })
                            } else {
                                fbBatch.set(docRef, firestorePayload, { merge: true })
                            }
                        } catch (e) {
                            fbBatch.set(docRef, firestorePayload, { merge: true })
                        }
                    } else {
                        fbBatch.set(docRef, firestorePayload, { merge: true })
                    }

                    committed.push({ item, payload })
                } catch (err) {
                    console.error(`[Sync] Prep failed for ${item.collection_name}/${item.document_id}:`, err.message)
                    await updateQueueStatus(item.id, 'failed', err.message)
                    failCount++
                }
            }

            if (committed.length === 0) return

            try {
                await withTimeout(fbBatch.commit(), 60000, `batch of ${committed.length} writes`)
            } catch (batchErr) {
                console.warn(`[Sync] Batch commit failed (${committed.length} items), falling back to individual writes:`, batchErr.message)
                for (const { item, payload } of committed) {
                    try {
                        const docRef = doc(db, item.collection_name, item.document_id)
                        const fp = { ...prepareForFirestore(payload), sync_at: serverTimestamp() }
                        if (item.operation_type === 'set' || item.operation_type === 'add') {
                            await withTimeout(setDoc(docRef, fp), 30000, `setDoc ${item.collection_name}/${item.document_id}`)
                        } else {
                            await withTimeout(setDoc(docRef, fp, { merge: true }), 30000, `mergeDoc ${item.collection_name}/${item.document_id}`)
                        }
                    } catch (indErr) {
                        console.error(`[Sync] Individual write failed for ${item.collection_name}/${item.document_id}:`, indErr.message)
                        await updateQueueStatus(item.id, 'failed', indErr.message)
                        failCount++
                        continue
                    }
                }
            }

            // Batch local cleanup
            const toRemove = []
            const toHardDelete = []
            const toMarkSynced = []

            for (const { item, payload } of committed) {
                toRemove.push(item.id)
                if (payload.is_deleted === 1 || payload.is_deleted === true) {
                    toHardDelete.push({ table: item.collection_name, id: item.document_id })
                } else {
                    toMarkSynced.push({ table: item.collection_name, id: item.document_id })
                }
            }

            if (toRemove.length > 0) {
                await removeQueueItemsBatch(toRemove)
            }

            for (const { table, id } of toHardDelete) {
                try { await hardDeleteDoc(table, id) } catch (e) { /* ignore */ }
            }

            if (toMarkSynced.length > 0) {
                const remaining = await getAllItems('sync_queue')
                const remainingKeys = new Set(
                    remaining.filter(q => q.status === 'pending' || q.status === 'processing')
                        .map(q => `${q.collection_name}:${q.document_id}`)
                )
                const ts = new Date().toISOString()
                for (const { table, id } of toMarkSynced) {
                    if (!remainingKeys.has(`${table}:${id}`)) {
                        try { await runSql(`UPDATE ${table} SET is_synced = 1, sync_at = ? WHERE id = ?`, [ts, id]) } catch (e) { /* ignore */ }
                    }
                }
            }

            successCount += committed.length
        }

        // Process batches with controlled concurrency
        for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
            const slice = batches.slice(i, i + BATCH_CONCURRENCY)
            await Promise.allSettled(slice.map(b => processBatch(b)))
            if (i + BATCH_CONCURRENCY < batches.length) {
                await new Promise(r => setTimeout(r, BATCH_RATE_LIMIT_MS))
            }
        }

        console.log(`[Sync] Push complete: ${successCount} succeeded, ${failCount} failed out of ${queue.length} total.`)
        return failCount === 0
    } finally {
        _isPushing = false
    }
}

// ─── Firestore Helpers (kept for use by pushQueue and dataService) ──────────

export function normalizeFromFirestore(obj) {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) {
        return obj.map(item => normalizeFromFirestore(item))
    }
    const data = { ...obj }
    for (const [key, val] of Object.entries(data)) {
        if (!val) continue
        if (typeof val === 'object') {
            if (typeof val.toDate === 'function') {
                data[key] = val.toDate().toISOString()
            } else if (val.seconds !== undefined && val.nanoseconds !== undefined) {
                data[key] = new Date(Number(val.seconds) * 1000 + Math.round(val.nanoseconds / 1000000)).toISOString()
            } else if (val.type === 'firestore/timestamp/1.0' && val.seconds !== undefined) {
                data[key] = new Date(Number(val.seconds) * 1000).toISOString()
            } else {
                data[key] = normalizeFromFirestore(val)
            }
        } else if (Array.isArray(val) && (key === 'recipient_id' || key === 'viewed')) {
            data[key] = val.join(',')
        }
    }
    if (data.id && !Array.isArray(obj)) {
        data.is_synced = 1
    }
    return data
}

export function prepareForFirestore(obj) {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) {
        return obj.map(item => prepareForFirestore(item))
    }
    const payload = { ...obj }
    const dateFields = [
        'created_at', 'modified_at', 'deleted_at',
        'remittance_date', 'issued_date', 'due_date',
        'expiry_date', 'date_joined', 'last_attempt_at', 'sync_at',
        'coop_first_month', 'dob', 'last_login'
    ]
    const jsonFields = ['account_balance', 'payment_advise', 'data', 'details', 'loans']

    for (const [key, val] of Object.entries(payload)) {
        if (!val) continue
        if (jsonFields.includes(key) && typeof val === 'string') {
            try {
                payload[key] = JSON.parse(val)
                payload[key] = prepareForFirestore(payload[key])
                continue
            } catch (e) {
                console.warn(`[Sync] Failed to parse JSON field ${key}:`, e.message)
            }
        }
        if (dateFields.includes(key) && val) {
            try {
                if (typeof val === 'string' || val instanceof Date) {
                    const date = new Date(val)
                    if (!isNaN(date.getTime())) {
                        payload[key] = Timestamp.fromDate(date)
                        continue
                    }
                }
            } catch (e) {}
        }
        if (typeof val === 'object' && val.seconds !== undefined && val.nanoseconds !== undefined) {
            try {
                payload[key] = new Timestamp(val.seconds, val.nanoseconds)
                continue
            } catch (e) {}
        }
        if ((key === 'recipient_id' || key === 'viewed' || key === 'account_manager') && typeof val === 'string') {
            payload[key] = val.split(',').map(s => s.trim()).filter(Boolean)
            continue
        }
        if (typeof val === 'object' && !(val instanceof Timestamp)) {
            payload[key] = prepareForFirestore(val)
        }
    }
    return payload
}
