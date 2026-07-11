import { getItem, putItem } from '../indexedDbService.js'

export const SYNC_COLLECTIONS = [
  'enterprise', 'bank', 'cooperatives', 'transaction_types',
  'members', 'users', 'remittance', 'notifications'
]

export async function isSynced(cooperativeId) {
    if (!cooperativeId) return false
    const state = await getItem('sync_state', String(cooperativeId))
    if (!state) return false
    if (state.is_full_sync_complete) return true
    const cols = state.collections || {}
    return SYNC_COLLECTIONS.every(name => cols[name] === 1)
}

export async function markCollectionSynced(cooperativeId, collectionName) {
    const existing = await getItem('sync_state', String(cooperativeId)) || {}
    const collections = { ...(existing.collections || {}), [collectionName]: 1 }
    await putItem('sync_state', { ...existing, cooperative_id: String(cooperativeId), collections })
}

export async function markCollectionUnsynced(cooperativeId, collectionName) {
    const existing = await getItem('sync_state', String(cooperativeId)) || {}
    const collections = { ...(existing.collections || {}), [collectionName]: 0 }
    await putItem('sync_state', { ...existing, cooperative_id: String(cooperativeId), collections })
}

export async function getUnsyncedCollections(cooperativeId) {
    const state = await getItem('sync_state', String(cooperativeId))
    if (!state) return [...SYNC_COLLECTIONS]
    const collections = state.collections || {}
    return SYNC_COLLECTIONS.filter(name => collections[name] !== 1)
}

export async function updateSyncState(cooperativeId, updates) {
    const existing = await getItem('sync_state', String(cooperativeId))
    const data = { ...(existing || {}), ...updates, cooperative_id: String(cooperativeId) }
    await putItem('sync_state', data)
}

export const updateSyncMeta = updateSyncState
export const getSyncMeta = (cooperativeId) => getItem('sync_state', String(cooperativeId))
