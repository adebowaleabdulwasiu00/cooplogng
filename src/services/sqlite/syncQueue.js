import { getAllItems, getAllByIndex, getItem, putItem, deleteItem, deleteItemsBatch } from '../indexedDbService.js'
import { runSql } from './sqlExecutor.js'
import { loadDoc } from './mutationEngine.js'

export async function enqueueWrite(cooperativeId, collection, docId, operation, payload) {
    const all = await getAllItems('sync_queue')
    const existing = all.find(q =>
        q.collection_name === collection &&
        q.document_id === String(docId) &&
        q.status === 'pending'
    )
    const serializedPayload = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const now = new Date().toISOString()
    if (existing) {
        existing.operation_type = operation
        existing.merged_document = serializedPayload
        existing.updated_at = now
        existing.attempt_count = 0
        existing.last_error = null
        await putItem('sync_queue', existing)
    } else {
        const nextId = all.length > 0 ? Math.max(...all.map(q => q.id || 0)) + 1 : 1
        const newRow = {
            id: nextId,
            entity: collection,
            entity_id: String(docId),
            collection_name: collection,
            document_id: String(docId),
            operation_type: operation,
            merged_document: serializedPayload,
            status: 'pending',
            created_at: now
        }
        await putItem('sync_queue', newRow)
    }
}

export async function updateQueueStatus(itemId, status, errorMsg = null) {
    const existing = await getItem('sync_queue', itemId)
    if (!existing) return
    const now = new Date().toISOString()
    if (status === 'failed' || errorMsg) {
        existing.attempt_count = (existing.attempt_count || 0) + 1
        existing.last_error = String(errorMsg || 'Unknown error')
        existing.last_attempt_at = now
        // Auto-retry up to 5 times. If exceeded, mark status as failed.
        if (existing.attempt_count < 5) {
            existing.status = 'pending'
        } else {
            existing.status = 'failed'
        }
    } else {
        existing.status = status
        existing.updated_at = now
        existing.last_error = null
    }
    await putItem('sync_queue', existing)
}

export async function hasPendingWrites(collection, docId, excludeItemId = null) {
    const all = await getAllItems('sync_queue')
    return all.some(q =>
        q.collection_name === collection &&
        q.document_id === String(docId) &&
        q.id !== excludeItemId &&
        (q.status === 'pending' || q.status === 'processing')
    )
}

export async function checkDbExists() {
    try {
        const all = await getAllItems('app_settings')
        return all.length > 0
    } catch (e) {
        return false
    }
}

export async function getSyncQueueSummary() {
    const all = await getAllItems('sync_queue')
    let pending = 0, failed = 0, completed = 0, processing = 0
    for (const q of all) {
        if (q.status === 'completed') completed++
        else if (q.status === 'processing') processing++
        else if (q.status === 'failed' || (q.attempt_count || 0) >= 5) failed++
        else if (q.status === 'pending') pending++
    }
    return { pending, failed, completed, processing, total: all.length }
}

export async function getSyncQueueDetails(limit = 50) {
    const all = await getAllItems('sync_queue')
    all.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    return all.slice(0, limit)
}

export async function restartAllSyncItems() {
    const all = await getAllItems('sync_queue')
    const updated = []
    for (const q of all) {
        // Reset everything in the queue (pending, failed, processing) to pending status and 0 attempts
        q.status = 'pending'
        q.attempt_count = 0
        q.last_error = null
        updated.push(q)
    }
    if (updated.length > 0) {
        for (const q of updated) await putItem('sync_queue', q)
        console.log(`[Sync] Restarted all ${updated.length} sync queue items to pending status.`)
    }
}

export async function resetProcessingQueueItems() {
    const all = await getAllItems('sync_queue')
    const updated = []
    for (const q of all) {
        if (q.status === 'processing') {
            q.status = 'pending'
            q.attempt_count = 0
            q.last_error = null
            updated.push(q)
        }
    }
    if (updated.length > 0) {
        for (const q of updated) await putItem('sync_queue', q)
        console.log(`[Sync] Reset ${updated.length} stuck processing queue items to pending status.`)
    }
}

export async function clearSyncQueueLogs() {
    const all = await getAllItems('sync_queue')
    for (const q of all) {
        if (q.status === 'completed' || q.status === 'failed' || (q.attempt_count || 0) >= 5) {
            await deleteItem('sync_queue', q.id)
        }
    }
}

export async function resetSyncQueueAndMarkUnsynced(cooperativeId) {
    const allQueue = await getAllItems('sync_queue')
    if (allQueue.length === 0) {
        // Even if the queue is empty, run scanAndEnqueueUnsynced to pick up any unsynced items
        return await scanAndEnqueueUnsynced(cooperativeId)
    }

    // For each item in the queue, mark is_synced = 0 in its respective table
    for (const item of allQueue) {
        try {
            const table = item.collection_name
            const docId = item.document_id
            if (table && docId) {
                // Set is_synced = 0 in the corresponding entity table so it's recognized as unsynced
                await runSql(`UPDATE ${table} SET is_synced = 0 WHERE id = ?`, [docId])
            }
        } catch (err) {
            console.warn(`[Sync] Failed to set is_synced = 0 for ${item.collection_name}/${item.document_id}:`, err.message)
        }
    }

    // Delete all items from the sync queue
    for (const item of allQueue) {
        await deleteItem('sync_queue', item.id)
    }

    // Re-scan and enqueue all unsynced items fresh
    const totalEnqueued = await scanAndEnqueueUnsynced(cooperativeId)
    return totalEnqueued
}

export async function scanAndEnqueueUnsynced(cooperativeId) {
    const mainEntities = [
        { table: 'cooperatives', entity: 'cooperatives', isCoopTable: true },
        { table: 'enterprise', entity: 'enterprise' },
        { table: 'bank', entity: 'bank' },
        { table: 'members', entity: 'members' },
        { table: 'users', entity: 'users' },
        { table: 'remittance', entity: 'remittance' },
        { table: 'transaction_types', entity: 'transaction_types' },
        { table: 'bank_reconciliation_summary', entity: 'bank_reconciliation_summary' }
    ]
    let total = 0
    for (const { table, entity, isCoopTable } of mainEntities) {
        let rows
        if (isCoopTable) {
            const item = await getItem(table, String(cooperativeId))
            rows = item && (!item.is_synced) ? [item] : []
        } else {
            let items
            try {
                items = await getAllByIndex(table, 'cooperative_id', String(cooperativeId))
                if (!items || items.length === 0) {
                    const all = await getAllItems(table)
                    if (all.length > 0) {
                        items = all.filter(r => r.cooperative_id === String(cooperativeId))
                    }
                }
            } catch (e) {
                const all = await getAllItems(table)
                items = all.filter(r => r.cooperative_id === String(cooperativeId))
            }
            rows = items.filter(r => !r.is_synced)
        }
        for (const row of rows) {
            const fullDoc = await loadDoc(table, row.id, cooperativeId) || row
            await enqueueWrite(cooperativeId, entity, row.id, 'update', fullDoc)
            total++
        }
    }
    return total
}

export async function getPendingQueue(cooperativeId) {
    const all = await getAllItems('sync_queue')
    const pending = all.filter(q => q.status === 'pending' && (q.attempt_count || 0) < 5)
    const latest = {}
    for (const q of pending) {
        const key = `${q.collection_name}|${q.document_id}`
        if (!latest[key] || q.created_at > latest[key].created_at) {
            latest[key] = q
        }
    }
    return Object.values(latest).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
}

export async function removeQueueItem(itemId) {
    await deleteItem('sync_queue', itemId)
}

export async function removeQueueItemsBatch(itemIds) {
    if (!itemIds || itemIds.length === 0) return
    await deleteItemsBatch('sync_queue', itemIds)
}

export async function incrementQueueRetry(itemId, errorMsg) {
    const existing = await getItem('sync_queue', itemId)
    if (!existing) return
    existing.attempt_count = (existing.attempt_count || 0) + 1
    existing.last_error = String(errorMsg)
    existing.last_attempt_at = new Date().toISOString()
    await putItem('sync_queue', existing)
}
