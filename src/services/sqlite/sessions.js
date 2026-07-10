import { getItem, putItem, deleteItem, getAllItems } from '../indexedDbService.js'
import { serializeValue, deserializeValue } from './helpers.js'

export async function saveLocalSession(sessionKey, data) {
    const idbKey = `session_${sessionKey}`
    const serialized = serializeValue(data)
    await putItem('app_settings', { key: idbKey, value: serialized })
}

export async function loadLocalSession(sessionKey) {
    const res = await getItem('app_settings', `session_${sessionKey}`)
    return res ? deserializeValue(res.value) : null
}

export async function getAllLocalSessions() {
    const all = await getAllItems('app_settings')
    return all.filter(a => a.key.startsWith('session_')).map(a => deserializeValue(a.value))
}

export async function deleteLocalSession(sessionKey) {
    await deleteItem('app_settings', `session_${sessionKey}`)
}

export function isAvailable() {
    return true
}

export async function setAppSetting(key, value) {
    await putItem('app_settings', { key, value: String(value) })
}

export async function getAppSetting(key) {
    const res = await getItem('app_settings', key)
    return res?.value
}
