/**
 * syncEventBus.js
 * Granular event emitter for synchronization events.
 * Components subscribe only to events relevant to their data.
 * Never triggers full UI re-renders.
 */
class SyncEventBus {
    constructor() {
        this._listeners = new Map()
        this._emitting = false
    }

    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set())
        }
        this._listeners.get(event).add(callback)
        return () => this._listeners.get(event)?.delete(callback)
    }

    once(event, callback) {
        const wrapper = (payload) => {
            callback(payload)
            this._listeners.get(event)?.delete(wrapper)
        }
        return this.on(event, wrapper)
    }

    emit(event, payload) {
        if (this._emitting) return
        this._emitting = true
        try {
            const callbacks = this._listeners.get(event)
            if (callbacks) {
                for (const cb of callbacks) {
                    try { cb(payload) } catch (e) { console.error(`[SyncEventBus] Error in ${event} listener:`, e) }
                }
            }
        } finally {
            this._emitting = false
        }
    }

    removeAll(event) {
        if (event) {
            this._listeners.delete(event)
        } else {
            this._listeners.clear()
        }
    }

    listenerCount(event) {
        return this._listeners.get(event)?.size || 0
    }
}

export const syncBus = new SyncEventBus()

export const SyncEvents = {
    // Collection-level events
    MEMBER_UPDATED: 'member:updated',
    MEMBER_ADDED: 'member:added',
    MEMBER_DELETED: 'member:deleted',
    REMITTANCE_UPDATED: 'remittance:updated',
    REMITTANCE_ADDED: 'remittance:added',
    REMITTANCE_DELETED: 'remittance:deleted',
    ENTERPRISE_UPDATED: 'enterprise:updated',
    ENTERPRISE_ADDED: 'enterprise:added',
    ENTERPRISE_DELETED: 'enterprise:deleted',
    LOAN_UPDATED: 'loan:updated',
    LOAN_ADDED: 'loan:added',
    LOAN_DELETED: 'loan:deleted',
    USER_UPDATED: 'user:updated',
    NOTIFICATION_ADDED: 'notification:added',
    NOTIFICATION_UPDATED: 'notification:updated',
    BANK_UPDATED: 'bank:updated',
    COOPERATIVE_UPDATED: 'cooperative:updated',
    TRANSACTION_TYPE_UPDATED: 'transaction_type:updated',

    // Sync lifecycle events
    SYNC_STARTED: 'sync:started',
    SYNC_PROGRESS: 'sync:progress',
    SYNC_COMPLETED: 'sync:completed',
    SYNC_FAILED: 'sync:failed',
    SYNC_STATUS_CHANGED: 'sync:status_changed',

    // Bulk events for initial/mass sync
    BULK_MEMBERS_LOADED: 'bulk:members_loaded',
    BULK_REMITTANCES_LOADED: 'bulk:remittances_loaded',
}

export function createSyncPayload(eventType, data) {
    return { type: eventType, data, timestamp: Date.now() }
}
