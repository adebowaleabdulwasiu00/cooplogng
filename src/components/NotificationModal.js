import { getUnreadNotifications, markAsRead, markAllAsRead } from '../services/notificationService.js'
import { escapeHtml } from '../utils/formatters.js'
import { showToast } from '../services/toastService.js'

// Internal state to hold callbacks and session for the global handlers
let _session = null
let _onReadCallback = null

/**
 * Generates the HTML content for the notification list.
 */
export async function getNotificationListHtml(session) {
    // Ensure session is set for handlers as soon as HTML is generated
    _session = session
    
    const { cooperativeId, memberId, role, username, registrationNo } = session
    const unread = await getUnreadNotifications(cooperativeId, memberId, role, username, registrationNo)

    if (unread.length === 0) {
        return `
            <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
                <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.3;">🔔</div>
                <p>You have no unread notifications.</p>
            </div>
        `
    }

    return `
        <div class="notification-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding: 0 0.5rem;">
            <span style="font-weight: 600; color: var(--text-secondary);">${unread.length} Unread</span>
            <button 
                 class="ghost-button" 
                 style="color: var(--accent-primary); font-size: 0.85rem; padding: 0.25rem 0.5rem; cursor: pointer; border: none; background: transparent; font-weight: 600; height: auto; min-width: auto;"
                 onclick="handleMarkAllAsRead()"
             >
                 Mark all as read
             </button>
        </div>
        <div class="notification-list" style="display: flex; flex-direction: column; gap: 0.75rem; padding: 0.5rem 0;">
            ${unread.map(n => `
                <div class="notification-item" data-id="${n.id}" style="
                    padding: 1rem;
                    border-radius: var(--radius-md);
                    background: var(--bg-secondary);
                    border: 1px solid var(--border-light);
                    display: flex;
                    gap: 1rem;
                    transition: all 0.2s;
                ">
                    <div class="notif-icon" style="
                        width: 40px;
                        height: 40px;
                        border-radius: 50%;
                        background: var(--accent-soft);
                        color: var(--accent-primary);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        flex-shrink: 0;
                    ">
                        ${_getIconForType(n.type)}
                    </div>
                    <div style="flex: 1;">
                        <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 0.25rem;">${escapeHtml(n.title)}</div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4; margin-bottom: 0.5rem;">${escapeHtml(n.message)}</div>
                        <div style="display: flex; gap: 0.75rem; align-items: center;">
                            <span style="font-size: 0.7rem; color: var(--text-muted);">${_formatDate(n.created_at)}</span>
                            <div style="flex: 1;"></div>
                            <button 
                                class="ghost-button" 
                                style="height: 2rem; padding: 0 0.75rem; font-size: 0.75rem; background: var(--bg-card); cursor: pointer;"
                                onclick="handleMarkAsRead('${n.id}')"
                            >
                                Mark as read
                            </button>
                            <button 
                                class="primary-button" 
                                style="height: 2rem; padding: 0 0.75rem; font-size: 0.75rem; border-radius: 2rem; cursor: pointer;"
                                onclick="handleViewRecord('${n.id}')"
                            >
                                View
                            </button>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `
}

/**
 * Attaches listeners to the notification list elements.
 * Stores the session and callbacks for use by the global handlers.
 */
export function setupNotificationModalListeners(modalEl, session, onRead, onView) {
    if (session) _session = session
    if (onRead) _onReadCallback = onRead
}

// Define handlers on window object immediately to prevent "is not a function" errors
window.handleMarkAsRead = async (id) => {
    if (!_session) {
        console.warn('[NotificationModal] Session not ready for markAsRead');
        return;
    }
    
    // Optimistic UI update: Fade and remove immediately
    const item = document.querySelector(`.notification-item[data-id="${id}"]`)
    if (item) {
        item.style.opacity = '0'
        item.style.transform = 'translateX(20px)'
        item.style.transition = 'all 0.3s ease-out'
        setTimeout(() => {
            if (item.parentNode) {
                item.remove()
                // If list is now empty, show empty state
                const list = document.querySelector('.notification-list')
                if (list && list.children.length === 0) {
                    if (_onReadCallback) _onReadCallback()
                }
            }
        }, 300)
    }

    console.log('[NotificationModal] Marking as read:', id)
    const userIdOrUsername = _session.role === 'member' ? (_session.memberId || _session.user_id) : _session.username
    
    try {
        await markAsRead(id, _session.cooperativeId, userIdOrUsername)
        console.log('[NotificationModal] Mark as read success')
        // Refresh the underlying data/bell count without fully re-loading modal if possible
        // but for now, we just let the background sync handle it or call onRead at the very end
        if (_onReadCallback) _onReadCallback()
    } catch (err) {
        console.error('[NotificationModal] Mark as read failed:', err)
        // If it failed, we might want to bring the item back, but usually, a refresh will fix it
    }
}

window.handleMarkAllAsRead = async () => {
    if (!_session) {
        console.warn('[NotificationModal] Session not ready for markAllAsRead');
        return;
    }

    // Optimistic UI update: Fade and clear list
    const list = document.querySelector('.notification-list')
    const header = document.querySelector('.notification-header')
    
    if (list) {
        list.style.opacity = '0'
        list.style.transform = 'translateY(10px)'
        list.style.transition = 'all 0.3s ease-out'
        
        setTimeout(() => {
            if (header) header.remove()
            list.innerHTML = `
                <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
                    <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.3;">🔔</div>
                    <p>You have no unread notifications.</p>
                </div>
            `
            list.style.opacity = '1'
            list.style.transform = 'translateY(0)'
        }, 300)
    }

    console.log('[NotificationModal] Marking all as read')
    
    try {
        await markAllAsRead(
            _session.cooperativeId, 
            _session.memberId || _session.user_id, 
            _session.role, 
            _session.username, 
            _session.registrationNo
        )
        console.log('[NotificationModal] Mark all as read success')
        if (_onReadCallback) _onReadCallback()
    } catch (err) {
        console.error('[NotificationModal] Mark all as read failed:', err)
    }
}

window.handleViewRecord = (id) => {
    console.log('[NotificationModal] View record clicked:', id)
    showToast('Work in progress for now', 'info')
}

function _getIconForType(type) {
    switch(type) {
        case 'payment_log': return '💳'
        case 'payment_approved': return '✅'
        case 'loan_request': return '💰'
        case 'guarantor_request': return '🤝'
        default: return '🔔'
    }
}

function _formatDate(iso) {
    const d = new Date(iso)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
