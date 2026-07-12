/**
 * backgroundSyncService.js
 * Isolated background synchronization engine.
 * - Runs delta sync and push queue independently of UI
 * - Updates IndexedDB silently
 * - Emits granular events via syncEventBus
 * - Never calls render(), never manipulates DOM, never triggers navigation
 * - Never calls window.location.reload() or window.location.href=
 */

import { syncBus, SyncEvents, createSyncPayload } from './syncEventBus.js'
import {
    getDb, collection, query, where, getDocs, doc, setDoc, updateDoc,
    getDoc, Timestamp, serverTimestamp, arrayUnion
} from '../firebase.js'

const CURRENT_SCHEMA_VERSION = 11

// Internal state (not exposed to UI)
let _session = null
let _syncTimer = null
let _isLooping = false
let _lastActivityTs = Date.now()
let _isPushing = false
let _isSyncing = false // Lock to prevent concurrent full syncs
let _pendingQueue = new Map() // Track pending items for conflict resolution

export function getSyncSession() {
    return _session
}

export function setSyncSession(session) {
    _session = session
}

export function clearSyncSession() {
    _session = null
}

// ─── Initialization ───────────────────────────────────────────────────────────

export async function initializeBackgroundSync(session) {
    _session = session
    _lastActivityTs = Date.now()

    // Track activity for adaptive timing
    const onActivity = () => { _lastActivityTs = Date.now() }
    window.addEventListener('mousemove', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity, { passive: true })
    window.addEventListener('scroll', onActivity, { passive: true })

    if (!session) return

    const cooperativeId = session.cooperative_id || session.cooperativeId
    if (!cooperativeId) return

    // Reset stuck processing items on startup
    try {
        const { resetProcessingQueueItems } = await import('./sqliteService.js')
        await resetProcessingQueueItems()
    } catch (e) {
        console.error('[BgSync] Failed to reset processing items on startup:', e)
    }

    // Check schema and start background loop
    await _checkSchemaAndSync()
}

// ─── Schema Check ─────────────────────────────────────────────────────────────

async function _checkSchemaAndSync() {
    const cooperativeId = _session.cooperative_id || _session.cooperativeId
    const { getSyncMeta, updateSyncMeta, runSql } = await import('./sqliteService.js')
    const meta = await getSyncMeta(cooperativeId)

    if (meta && meta.schema_version !== undefined && meta.schema_version !== CURRENT_SCHEMA_VERSION) {
        console.warn('[BgSync] Schema mismatch detected. Running recovery flow...')
        await _runSchemaRecoveryFlow()
    } else {
        syncBus.emit(SyncEvents.SYNC_STATUS_CHANGED, { status: 'online' })
        _startBackgroundLoop()
    }
}

async function _runSchemaRecoveryFlow() {
    const cooperativeId = _session.cooperative_id || _session.cooperativeId
    const { pushQueue } = await import('./syncService.js')

    // Push pending writes first
    const pushSuccess = await pushQueue(cooperativeId)
    const { getPendingQueue, runSql, updateSyncMeta, initialSyncInternal } = await import('./sqliteService.js')
    const queue = await getPendingQueue(cooperativeId)

    if (!pushSuccess || queue.length > 0) {
        console.error('[BgSync] Recovery: Push failed or queue not empty. Preserving local cache.')
        return
    }

    // Clear cache
    const tables = ['remittance', 'remittance_detail', 'loans', 'loan_guarantors', 'members',
        'payment_advise', 'enterprise', 'bank', 'users', 'cooperatives', 'notifications', 'transaction_types']
    for (const t of tables) {
        await runSql(`DELETE FROM ${t}`)
    }

    await updateSyncMeta(cooperativeId, {
        is_full_sync_complete: 0,
        last_sync_ts: 0,
        schema_version: CURRENT_SCHEMA_VERSION
    })

    // Full re-sync
    await _initialSyncInternal()
    _startBackgroundLoop()
}

// ─── Background Loop ──────────────────────────────────────────────────────────

function _startBackgroundLoop() {
    if (_syncTimer) clearInterval(_syncTimer)

    const runLoop = async () => {
        if (_isLooping || !navigator.onLine || !_session) return
        _isLooping = true
        try {
            const cooperativeId = _session.cooperative_id || _session.cooperativeId
            await _deltaSync()
            const { pushQueue } = await import('./syncService.js')
            await pushQueue(cooperativeId)
        } catch (e) {
            console.error('[BgSync] Loop error:', e)
        } finally {
            _isLooping = false
            _adjustLoopTiming()
        }
    }

    _syncTimer = setInterval(runLoop, 3000)
    runLoop()
}

function _adjustLoopTiming() {
    if (!_syncTimer) return
    const idleTime = Date.now() - _lastActivityTs
    let interval = 3000
    if (document.hidden) {
        interval = 60000
    } else if (idleTime > 60000) {
        interval = 30000
    }
    if (Math.abs(_syncTimer._idleTimeout - interval) > 1000) {
        clearInterval(_syncTimer)
        _syncTimer = setInterval(async () => {
            if (!_isLooping && navigator.onLine && _session) {
                _isLooping = true
                try {
                    await _deltaSync()
                    const { pushQueue } = await import('./syncService.js')
                    await pushQueue(_session.cooperative_id || _session.cooperativeId)
                } finally {
                    _isLooping = false
                    _adjustLoopTiming()
                }
            }
        }, interval)
    }
}

// ─── Delta Sync (isolated from UI) ───────────────────────────────────────────

async function _deltaSync() {
    const cooperativeId = _session.cooperative_id || _session.cooperativeId
    if (!cooperativeId) return

    const { getSyncMeta, updateSyncMeta, queryRows, getPendingQueue, saveMany, getUnsyncedCollections, markCollectionSynced, markCollectionUnsynced } = await import('./sqliteService.js')

    let meta = await getSyncMeta(cooperativeId)

    // If a different-scope user last synced, reset so we re-download everything for this scope
    const currentScope = _getSessionScopeId()
    if (meta && meta.last_sync_scope && currentScope && meta.last_sync_scope !== currentScope) {
        console.log(`[BgSync] Sync scope changed from "${meta.last_sync_scope}" to "${currentScope}". Triggering fresh full sync.`)
        await updateSyncMeta(cooperativeId, {
            is_full_sync_complete: 0,
            collections: null,
            last_sync_ts: 0,
            last_sync_scope: currentScope
        })
        meta = null
    }

    if (!meta?.is_full_sync_complete) {
        const unsynced = await getUnsyncedCollections(cooperativeId)
        if (unsynced.length > 0) {
            console.log(`[BgSync] Resuming incomplete sync. Collections remaining: ${unsynced.join(', ')}`)
            for (const col of unsynced) {
                try {
                    await markCollectionUnsynced(cooperativeId, col)
                    const docs = await _fetchCollection(col, cooperativeId, 0)
                    if (docs.length > 0) {
                        await saveMany(col, docs)
                    }
                    await markCollectionSynced(cooperativeId, col)
                    console.log(`[BgSync] Synced incomplete collection: ${col} (${docs.length} docs)`)
                } catch (err) {
                    console.error(`[BgSync] Failed to sync incomplete collection ${col}:`, err)
                }
            }
            const remaining = await getUnsyncedCollections(cooperativeId)
            if (remaining.length === 0) {
                await updateSyncMeta(cooperativeId, {
                    is_full_sync_complete: 1,
                    last_sync_ts: Date.now(),
                    schema_version: CURRENT_SCHEMA_VERSION,
                    last_sync_scope: _getSessionScopeId()
                })
                syncBus.emit(SyncEvents.SYNC_COMPLETED, createSyncPayload(SyncEvents.SYNC_COMPLETED, {
                    count: 0, cooperativeId, isInitial: true
                }))
                console.log('[BgSync] Incomplete sync fully resumed.')
            }
        }
        return
    }

    const lastSyncTs = meta.last_sync_ts || 0
    const syncStartTs = Date.now()

    try {
        const collections = ['enterprise', 'bank', 'members', 'remittance', 'users', 'notifications', 'cooperatives', 'transaction_types']
        let updateCount = 0
        let maxSyncAt = lastSyncTs

        const pendingQueue = await getPendingQueue(cooperativeId)
        const pendingIds = new Set(pendingQueue.map(item => `${item.collection_name}_${item.document_id}`))

        for (const col of collections) {
            try {
                let since = Math.max(0, lastSyncTs - 300000)

                if (col === 'notifications') {
                    const existingCount = await queryRows('SELECT COUNT(*) as count FROM notifications')
                    if (existingCount[0]?.count === 0) since = 0
                }

                const startCol = Date.now()
                const docs = await _fetchCollection(col, cooperativeId, since)
                const timeCol = Date.now() - startCol

                if (docs.length > 0) {
                    console.log(`[BgSync] Delta Sync: Downloaded ${docs.length} records for ${col} in ${timeCol}ms (since ${new Date(since).toISOString()})`)
                    docs.forEach(d => {
                        const ts = d.sync_at ? new Date(d.sync_at).getTime() : 0
                        if (ts > maxSyncAt) maxSyncAt = ts
                    })

                    const safeDocs = docs.filter(doc => !pendingIds.has(`${col}_${doc.id}`))
                    const skippedCount = docs.length - safeDocs.length
                    if (skippedCount > 0) {
                        console.log(`[BgSync] Skipped ${skippedCount} items in ${col} to preserve unsynced local changes.`)
                    }

                    if (safeDocs.length > 0) {
                        const savedCount = await saveMany(col, safeDocs)
                        console.log(`[BgSync] Delta Sync: Saved ${savedCount} records for ${col} to IndexedDB`)
                        updateCount += safeDocs.length
                        _emitGranularUpdates(col, safeDocs)
                    }
                }
            } catch (colErr) {
                console.error(`[BgSync] Failed to sync collection ${col}:`, colErr)
            }
        }

        // Always advance the last_sync_ts metadata to syncStartTs to move the 5-minute sliding window forward.
        // This prevents re-downloading the same historical updates repeatedly on subsequent loops.
        await updateSyncMeta(cooperativeId, { last_sync_ts: syncStartTs })

        if (updateCount > 0) {
            console.log(`[BgSync] Delta Sync: Complete. Synced ${updateCount} total records.`)
            syncBus.emit(SyncEvents.SYNC_COMPLETED, createSyncPayload(SyncEvents.SYNC_COMPLETED, {
                count: updateCount,
                cooperativeId
            }))
        }
    } catch (err) {
        console.error('[BgSync] Delta sync failed:', err)
        syncBus.emit(SyncEvents.SYNC_FAILED, createSyncPayload(SyncEvents.SYNC_FAILED, {
            error: err.message,
            cooperativeId
        }))
    }
}

// ─── Emit granular events for changed records ─────────────────────────────────

function _emitGranularUpdates(collection, docs) {
    for (const doc of docs) {
        const isDeleted = doc.is_deleted === 1 || doc.is_deleted === true
        switch (collection) {
            case 'members':
                syncBus.emit(
                    isDeleted ? SyncEvents.MEMBER_DELETED : SyncEvents.MEMBER_UPDATED,
                    createSyncPayload(SyncEvents.MEMBER_UPDATED, { id: doc.id, data: doc })
                )
                break
            case 'remittance':
                syncBus.emit(
                    isDeleted ? SyncEvents.REMITTANCE_DELETED : SyncEvents.REMITTANCE_UPDATED,
                    createSyncPayload(SyncEvents.REMITTANCE_UPDATED, { id: doc.id, data: doc })
                )
                break
            case 'enterprise':
                syncBus.emit(
                    isDeleted ? SyncEvents.ENTERPRISE_DELETED : SyncEvents.ENTERPRISE_UPDATED,
                    createSyncPayload(SyncEvents.ENTERPRISE_UPDATED, { id: doc.id, data: doc })
                )
                break
            case 'notifications':
                syncBus.emit(
                    SyncEvents.NOTIFICATION_ADDED,
                    createSyncPayload(SyncEvents.NOTIFICATION_ADDED, { id: doc.id, data: doc })
                )
                break
            case 'users':
                syncBus.emit(
                    SyncEvents.USER_UPDATED,
                    createSyncPayload(SyncEvents.USER_UPDATED, { id: doc.id, data: doc })
                )
                break
            case 'bank':
                syncBus.emit(
                    SyncEvents.BANK_UPDATED,
                    createSyncPayload(SyncEvents.BANK_UPDATED, { id: doc.id, data: doc })
                )
                break
            case 'cooperatives':
                syncBus.emit(
                    SyncEvents.COOPERATIVE_UPDATED,
                    createSyncPayload(SyncEvents.COOPERATIVE_UPDATED, { id: doc.id, data: doc })
                )
                break
            case 'transaction_types':
                syncBus.emit(
                    SyncEvents.TRANSACTION_TYPE_UPDATED,
                    createSyncPayload(SyncEvents.TRANSACTION_TYPE_UPDATED, { id: doc.id, data: doc })
                )
                break
        }
    }
}

// ─── Initial Full Sync ────────────────────────────────────────────────────────

async function _initialSyncInternal(forceFull = false) {
    if (_isSyncing && !forceFull) {
        console.log('[BgSync] Initial sync already in progress, skipping duplicate.')
        return false
    }
    _isSyncing = true
    const cooperativeId = _session.cooperative_id || _session.cooperativeId
    if (!cooperativeId) { _isSyncing = false; return false }

    syncBus.emit(SyncEvents.SYNC_STARTED, createSyncPayload(SyncEvents.SYNC_STARTED, { cooperativeId }))

    const { runSql, saveMany, getAllForCoop, queryRows, updateSyncMeta, getSyncMeta, markCollectionSynced, markCollectionUnsynced } = await import('./sqliteService.js')

    try {
        console.log(`[BgSync] Starting initial sync. forceFull=${forceFull}`);
        
        // If forceFull is requested, mark all collections as unsynced (0) first so the UI turns yellow/red.
        if (forceFull) {
            console.log('[BgSync] forceFull is true. Resetting all collections to unsynced state.');
            const collectionsList = ['enterprise', 'bank', 'cooperatives', 'transaction_types', 'members', 'users', 'remittance', 'notifications'];
            for (const col of collectionsList) {
                await markCollectionUnsynced(cooperativeId, col);
            }
            // Trigger a status update event so UI can render the yellow dots immediately
            syncBus.emit(SyncEvents.SYNC_STATUS_CHANGED, { status: 'syncing' });
        }

        // If DB was previously synced but is now empty (cleared storage), skip the delete phase
        if (forceFull) {
            const existingMeta = await getSyncMeta(cooperativeId)
            if (existingMeta?.is_full_sync_complete) {
                const countResult = await queryRows('SELECT COUNT(*) as cnt FROM members')
                const isEmpty = !countResult || countResult[0]?.cnt === 0
                if (isEmpty) {
                    console.log('[BgSync] DB is empty despite full sync flag. Skipping delete, re-populating directly.')
                    forceFull = false
                }
            }
        }

        if (forceFull) {
            console.log('[BgSync] forceFull is true. Clearing local cache tables.');
            const tables = ['enterprise', 'bank', 'members', 'remittance', 'remittance_detail', 'loans',
                'loan_guarantors', 'users', 'notifications', 'payment_advise', 'cooperatives', 'transaction_types']
            for (const t of tables) {
                await runSql(`DELETE FROM ${t} WHERE cooperative_id = ? OR id = ?`, [String(cooperativeId), String(cooperativeId)])
            }
        }

        await markCollectionUnsynced(cooperativeId, 'enterprise')
        console.log('[BgSync] Fetching enterprise...');
        const tEntStart = Date.now();
        const enterprises = await _fetchCollection('enterprise', cooperativeId, 0)
        console.log(`[BgSync] Fetched ${enterprises.length} enterprises in ${Date.now() - tEntStart}ms`);
        await saveMany('enterprise', enterprises)
        await markCollectionSynced(cooperativeId, 'enterprise')

        await markCollectionUnsynced(cooperativeId, 'bank')
        console.log('[BgSync] Fetching bank...');
        const tBankStart = Date.now();
        const banks = await _fetchCollection('bank', cooperativeId, 0)
        console.log(`[BgSync] Fetched ${banks.length} banks in ${Date.now() - tBankStart}ms`);
        await saveMany('bank', banks)
        await markCollectionSynced(cooperativeId, 'bank')

        await markCollectionUnsynced(cooperativeId, 'cooperatives')
        console.log('[BgSync] Fetching cooperatives...');
        const tCoopsStart = Date.now();
        const coops = await _fetchCollection('cooperatives', cooperativeId, 0)
        console.log(`[BgSync] Fetched ${coops.length} cooperatives in ${Date.now() - tCoopsStart}ms`);
        await saveMany('cooperatives', coops)
        await markCollectionSynced(cooperativeId, 'cooperatives')

        await markCollectionUnsynced(cooperativeId, 'transaction_types')
        console.log('[BgSync] Fetching transaction_types...');
        const tTTStart = Date.now();
        const transactionTypes = await _fetchCollection('transaction_types', cooperativeId, 0)
        console.log(`[BgSync] Fetched ${transactionTypes.length} transaction_types in ${Date.now() - tTTStart}ms`);
        await saveMany('transaction_types', transactionTypes)
        await markCollectionSynced(cooperativeId, 'transaction_types')

        if (transactionTypes.length === 0) {
            console.log('[BgSync] transaction_types is empty. Initializing defaults...');
            const { initializeDefaultTransactionTypes } = await import('./sqliteService.js')
            const userId = _session.user_id || _session.member_id || _session.userId || _session.memberId
            await initializeDefaultTransactionTypes(cooperativeId, userId)
        }

        await markCollectionUnsynced(cooperativeId, 'members')
        console.log('[BgSync] Fetching members...');
        const tMemStart = Date.now();
        const members = await _fetchCollection('members', cooperativeId, 0)
        console.log(`[BgSync] Fetched ${members.length} members in ${Date.now() - tMemStart}ms`);
        await saveMany('members', members)
        await markCollectionSynced(cooperativeId, 'members')

        const { isAdmin, isStaff } = _getSyncScope(_session)
        let users = []
        if (isAdmin || isStaff) {
            await markCollectionUnsynced(cooperativeId, 'users')
            console.log('[BgSync] Fetching users (Admin/Staff only)...');
            const tUserStart = Date.now();
            users = await _fetchCollection('users', cooperativeId, 0)
            console.log(`[BgSync] Fetched ${users.length} users in ${Date.now() - tUserStart}ms`);
            await saveMany('users', users)
            await markCollectionSynced(cooperativeId, 'users')
        } else {
            await markCollectionSynced(cooperativeId, 'users')
        }

        await markCollectionUnsynced(cooperativeId, 'remittance')
        console.log('[BgSync] Fetching remittance...');
        const tRemStart = Date.now();
        const remittances = await _fetchCollection('remittance', cooperativeId, 0)
        console.log(`[BgSync] Fetched ${remittances.length} remittances in ${Date.now() - tRemStart}ms`);
        await saveMany('remittance', remittances)
        await markCollectionSynced(cooperativeId, 'remittance')

        await markCollectionUnsynced(cooperativeId, 'notifications')
        console.log('[BgSync] Fetching notifications...');
        const tNotStart = Date.now();
        const notifications = await _fetchCollection('notifications', cooperativeId, 0)
        console.log(`[BgSync] Fetched ${notifications.length} notifications in ${Date.now() - tNotStart}ms`);
        await saveMany('notifications', notifications)
        await markCollectionSynced(cooperativeId, 'notifications')

        await updateSyncMeta(cooperativeId, {
            is_full_sync_complete: 1,
            last_sync_ts: Date.now(),
            schema_version: CURRENT_SCHEMA_VERSION,
            last_sync_scope: _getSessionScopeId()
        })

        const { setAppSetting } = await import('./sqliteService.js')
        const currentUser = _session.username || _session.user_id || _session.member_id
        if (currentUser) {
            await setAppSetting('last_synced_user', currentUser)
        }

        syncBus.emit(SyncEvents.BULK_MEMBERS_LOADED, createSyncPayload(SyncEvents.BULK_MEMBERS_LOADED, {
            count: members.length,
            cooperativeId
        }))
        syncBus.emit(SyncEvents.BULK_REMITTANCES_LOADED, createSyncPayload(SyncEvents.BULK_REMITTANCES_LOADED, {
            count: remittances.length,
            cooperativeId
        }))
        syncBus.emit(SyncEvents.SYNC_COMPLETED, createSyncPayload(SyncEvents.SYNC_COMPLETED, {
            count: enterprises.length + banks.length + members.length + remittances.length,
            cooperativeId,
            isInitial: true
        }))
        console.log('[BgSync] Initial Sync Completed Successfully!');
        return true
    } catch (err) {
        console.error('[BgSync] Initial sync failed:', err)
        syncBus.emit(SyncEvents.SYNC_FAILED, createSyncPayload(SyncEvents.SYNC_FAILED, {
            error: err.message,
            cooperativeId
        }))
        return false
    } finally {
        _isSyncing = false
    }
}

// ─── Firestore Helpers ────────────────────────────────────────────────────────

function _getSessionScopeId() {
    if (!_session) return ''
    const { isAdmin, isStaff, isMember } = _getSyncScope(_session)
    if (isAdmin || isStaff) return 'admin-staff'
    if (isMember) {
        const uid = (_session.user_id || _session.userId || _session.member_id || _session.memberId || _session.id || '').toString()
        return 'member:' + uid
    }
    return ''
}

function _getSyncScope(session) {
    const role = (session.role || '').toLowerCase()
    const perms = (session.permissions || '').toLowerCase()
    const isAdmin = perms.includes('admin') || role === 'admin'
    const isStaff = role === 'staff' || role === 'user' || perms.includes('staff') || perms.includes('user') || isAdmin
    const isMember = role === 'member'
    return { isAdmin, isStaff, isMember }
}

function _normalizeFromFirestore(obj) {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) {
        return obj.map(item => _normalizeFromFirestore(item))
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
                data[key] = _normalizeFromFirestore(val)
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

const withTimeout = (promise, ms, description = 'Operation') => {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${description} timed out after ${ms}ms`)), ms))
    ]);
};

async function _fetchCollection(collectionName, cooperativeId, sinceTs = 0) {
    const db = getDb()
    const coopStr = String(cooperativeId)

    if (collectionName === 'cooperatives') {
        try {
            const docRef = doc(db, 'cooperatives', coopStr)
            const d = await withTimeout(getDoc(docRef), 15000, `getDoc cooperatives/${coopStr}`)
            if (d.exists()) {
                const data = _normalizeFromFirestore({ id: d.id, ...d.data() })
                if (sinceTs > 0) {
                    const syncAt = data.sync_at ? new Date(data.sync_at).getTime() : 0
                    if (syncAt <= sinceTs) return []
                }
                return [data]
            }
            return []
        } catch (err) {
            console.error(`[BgSync] fetchCollection failed for ${collectionName}:`, err)
            throw err
        }
    }

    let constraints = [where('cooperative_id', '==', coopStr)]

    if (collectionName === 'notifications' && _session) {
        const userId = (_session.user_id || _session.userId || _session.member_id || _session.memberId || '').toString().toLowerCase()
        const username = (_session.username || '').toString().toLowerCase()
        const role = (_session.role || '').toLowerCase()
        const regNo = (_session.registration_no || _session.registrationNo || '').toString().toLowerCase()
        const pool = [userId, username, role, regNo, 'all'].filter(v => v && v !== 'null' && v !== 'undefined')

        const { isAdmin, isStaff } = _getSyncScope(_session)
        if (!isAdmin && !isStaff) {
            constraints.push(where('recipient_id', 'array-contains-any', pool))
        }
    }

    if (collectionName === 'remittance' && _session) {
        const { isAdmin, isStaff, isMember } = _getSyncScope(_session)
        if (isMember) {
            const userId = (_session.user_id || _session.userId || _session.member_id || _session.memberId || '').toString()
            constraints.push(where('member_id', '==', userId))
        }
    }

    if (collectionName === 'members' && _session) {
        const { isAdmin, isStaff, isMember } = _getSyncScope(_session)
        if (isMember) {
            const userId = (_session.user_id || _session.userId || _session.member_id || _session.memberId || '').toString()
            constraints.push(where('member_id', '==', userId))
        }
    }

    if (sinceTs > 0) {
        constraints.push(where('sync_at', '>', Timestamp.fromMillis(sinceTs)))
    }

    try {
        const q = query(collection(db, collectionName), ...constraints)
        const snap = await withTimeout(getDocs(q), 15000, `getDocs ${collectionName}`)
        let docs = []
        snap.forEach(d => {
            const data = { id: d.id, ...d.data() }
            docs.push(_normalizeFromFirestore(data))
        })
        if (sinceTs > 0) {
            docs = docs.filter(d => {
                const syncAt = d.sync_at ? new Date(d.sync_at).getTime() : 0
                return syncAt > sinceTs
            })
        }
        return docs
    } catch (err) {
        console.error(`[BgSync] fetchCollection failed for ${collectionName}:`, err)
        throw err
    }
}

// ─── External Sync Triggers ───────────────────────────────────────────────────

export async function triggerFullSync(session) {
    _session = session
    await _initialSyncInternal(true)
}

export async function triggerFullResync(session) {
    _session = session
    const cooperativeId = session.cooperative_id || session.cooperativeId
    const result = { pushed: 0, error: null }

    // Step 1: Push any pending local changes to Firestore first
    try {
        const { pushQueue, getPendingQueue } = await import('./syncService.js')
        const pendingCount = (await getPendingQueue(cooperativeId)).length
        if (pendingCount > 0) {
            console.log(`[BgSync] Full resync: pushing ${pendingCount} pending local changes first...`)
            await pushQueue(cooperativeId)
            const remaining = await getPendingQueue(cooperativeId)
            result.pushed = pendingCount - remaining.length
            if (remaining.length > 0) {
                console.warn(`[BgSync] Full resync: ${remaining.length} items could not be pushed, proceeding with re-sync anyway`)
            }
        }
    } catch (err) {
        console.warn('[BgSync] Full resync: push failed, proceeding with re-sync anyway:', err.message)
        result.error = err.message
    }

    // Step 2: Clear local cache and re-download everything from Firestore
    await _initialSyncInternal(true)

    return result
}

export async function triggerDeltaSync(session) {
    _session = session
    await _deltaSync()
}

// ─── Online/Offline Monitor ───────────────────────────────────────────────────

export function startBgSyncMonitor(session) {
    _session = session

    window.addEventListener('online', () => {
        console.log('[BgSync] Online. Triggering background sync...')
        syncBus.emit(SyncEvents.SYNC_STATUS_CHANGED, { status: 'reconnecting' })
        _deltaSync().finally(() => {
            syncBus.emit(SyncEvents.SYNC_STATUS_CHANGED, { status: 'online' })
        })
    })

    window.addEventListener('offline', () => {
        console.log('[BgSync] Offline.')
        syncBus.emit(SyncEvents.SYNC_STATUS_CHANGED, { status: 'offline' })
    })

    if (navigator.onLine) {
        syncBus.emit(SyncEvents.SYNC_STATUS_CHANGED, { status: 'online' })
    } else {
        syncBus.emit(SyncEvents.SYNC_STATUS_CHANGED, { status: 'offline' })
    }

    // Auth revalidation in background
    _startAuthRevalidationLoop()
}

function _startAuthRevalidationLoop() {
    setInterval(async () => {
        if (!navigator.onLine || !_session) return
        try {
            const { loadOfflineSession, revalidateOnline, touchSession } = await import('./offlineAuthService.js')
            const local = await loadOfflineSession(
                _session.cooperative_id || _session.cooperativeId,
                _session.user_id || _session.userId || _session.member_id || _session.memberId
            )
            if (!local) return

            const now = Date.now()
            const fiveDaysMs = 5 * 24 * 60 * 60 * 1000
            const age = now - (local.last_verified_ts || 0)

            if (age > fiveDaysMs || now > (local.session_expires_ts - 3600000)) {
                const result = await revalidateOnline(local)
                if (result.valid) {
                    await touchSession(
                        _session.cooperative_id || _session.cooperativeId,
                        _session.user_id || _session.userId || _session.member_id || _session.memberId
                    )
                } else if (!result.networkError) {
                    console.warn('[BgSync] Session invalid:', result.reason)
                    syncBus.emit(SyncEvents.SYNC_FAILED, {
                        type: SyncEvents.SYNC_FAILED,
                        data: { error: 'Session expired', type: 'AUTH_EXPIRED' },
                        timestamp: Date.now()
                    })
                }
            }
        } catch (e) {
            console.warn('[BgSync] Auth revalidation error:', e.message)
        }
    }, 3600000) // Check every hour
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export function stopBackgroundSync() {
    if (_syncTimer) {
        clearInterval(_syncTimer)
        _syncTimer = null
    }
    _isLooping = false
    _session = null
}
