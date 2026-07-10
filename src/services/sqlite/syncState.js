import { getItem, putItem } from '../indexedDbService.js'

export async function isSynced(cooperativeId) {
    if (!cooperativeId) return false
    const state = await getItem('sync_state', String(cooperativeId))
    return !!(state && state.is_full_sync_complete)
}

export async function updateSyncState(cooperativeId, updates) {
    const existing = await getItem('sync_state', String(cooperativeId))
    const data = { ...(existing || {}), ...updates, cooperative_id: String(cooperativeId) }
    await putItem('sync_state', data)
}

export const updateSyncMeta = updateSyncState
export const getSyncMeta = (cooperativeId) => getItem('sync_state', String(cooperativeId))
