import { getUnreadNotifications } from '../services/notificationService.js'
import { syncBus, SyncEvents } from '../services/syncEventBus.js'

let _bellEl = null
let _lastCount = 0
let _isMounted = false

/**
 * Creates or updates the notification bell in the DOM.
 */
export async function renderNotificationBell(containerEl, session) {
    console.log('[NotificationBell] render called. Container:', !!containerEl, 'Session:', !!session)
    if (!containerEl || !session) {
        console.warn('[NotificationBell] Missing container or session. Aborting.')
        return
    }

    const { cooperativeId, memberId, role, username, registrationNo } = session
    
    // Ensure we have a bell element
    if (!_bellEl) {
        console.log('[NotificationBell] Creating new bell element.')
        _bellEl = document.createElement('div')
        _bellEl.id = 'notification-bell-container'
        _bellEl.style.cssText = `
            position: relative;
            cursor: pointer;
            padding: 0.5rem;
            border-radius: 50%;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 40px;
            min-height: 40px;
        `
        _bellEl.onclick = (e) => {
            console.log('[NotificationBell] Clicked.')
            e.stopPropagation()
            window.dispatchEvent(new CustomEvent('show-notifications'))
        }
    }

    // Always ensure it's in the current container
    if (!containerEl.contains(_bellEl)) {
        console.log('[NotificationBell] Appending bell to container.')
        containerEl.appendChild(_bellEl)
    }

    try {
        console.log('[NotificationBell] Fetching unread for:', { cooperativeId, memberId, role, username, registrationNo })
        const unread = await getUnreadNotifications(cooperativeId, memberId, role, username, registrationNo)
        const count = unread.length
        console.log('[NotificationBell] Unread count:', count)

        _bellEl.innerHTML = `
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary);">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            ${count > 0 ? `
                <span style="
                    position: absolute;
                    top: 2px;
                    right: 2px;
                    background: #ef4444;
                    color: white;
                    font-size: 0.65rem;
                    font-weight: 800;
                    padding: 2px 5px;
                    border-radius: 10px;
                    min-width: 16px;
                    text-align: center;
                    border: 2px solid var(--bg-sidebar);
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    pointer-events: none;
                ">${count > 99 ? '99+' : count}</span>
            ` : ''}
        `
        
        if (count > _lastCount) {
            _bellEl.style.animation = 'bell-bounce 0.5s ease'
            setTimeout(() => { _bellEl.style.animation = '' }, 500)
        }
        _lastCount = count

    } catch (err) {
        console.error('[NotificationBell] Failed to render unread count:', err)
        // Fallback: Show bell without badge
        _bellEl.innerHTML = `
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted); opacity: 0.5;">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
        `
    }

    // Add animation to head if not exists
    if (!document.getElementById('bell-anim-styles')) {
        const style = document.createElement('style')
        style.id = 'bell-anim-styles'
        style.innerHTML = `
            @keyframes bell-bounce {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.2) rotate(15deg); }
            }
            #notification-bell-container:hover {
                background: var(--bg-secondary);
                transform: scale(1.05);
            }
        `
        document.head.appendChild(style)
    }
}

/**
 * Mounts the bell and sets up listeners for automatic refresh.
 */
export function mountNotificationBell(containerEl, session) {
    // Initial render
    renderNotificationBell(containerEl, session)

    if (_isMounted) return
    _isMounted = true

    console.log('[NotificationBell] First mount - setting up listeners.')

    const refresh = () => {
        const currentPlaceholder = document.getElementById('notification-bell-placeholder')
        if (currentPlaceholder) {
            renderNotificationBell(currentPlaceholder, session)
        }
    }
    
    // Use syncBus for granular notifications instead of global sync-status-changed
    syncBus.on(SyncEvents.NOTIFICATION_ADDED, refresh)
    syncBus.on(SyncEvents.NOTIFICATION_UPDATED, refresh)
    syncBus.on(SyncEvents.SYNC_COMPLETED, refresh)
    window.addEventListener('notification-read', refresh)
    window.addEventListener('notification-received', refresh)
}
