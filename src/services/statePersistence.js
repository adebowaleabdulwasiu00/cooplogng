/**
 * statePersistence.js
 * Centralized sessionStorage-based state persistence for CoopLog.
 * All keys are prefixed with "cooplog-" to avoid collisions.
 *
 * Usage:
 *   import { save, load, clear, clearAll } from './statePersistence.js'
 *   save('members-state', { searchTerm: 'foo', statusFilter: 'Active' })
 *   const s = load('members-state')  // { searchTerm: 'foo', statusFilter: 'Active' }
 *   clear('members-state')
 *   clearAll()  // removes every cooplog-* key from sessionStorage
 */

const PREFIX = 'cooplog-'

/**
 * Persist a value to sessionStorage under the given key.
 * Silently ignores storage errors (quota exceeded, private browsing, etc.).
 */
export function save(key, value) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // storage unavailable — non-critical
  }
}

/**
 * Load a persisted value. Returns null when the key is missing or the
 * stored JSON is corrupted.
 */
export function load(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Remove a single persisted key.
 */
export function clear(key) {
  try {
    sessionStorage.removeItem(PREFIX + key)
  } catch {
    // ignore
  }
}

/**
 * Remove ALL cooplog-* keys from sessionStorage.
 * Called on logout to prevent stale state leaking across sessions.
 */
export function clearAll() {
  try {
    const keys = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(PREFIX)) keys.push(k)
    }
    keys.forEach(k => sessionStorage.removeItem(k))
  } catch {
    // ignore
  }
}
