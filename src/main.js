import './style.css'
import { hasPermission } from './services/permissionService.js'
import {
  getDb,
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
  getFirebaseAuth,
  signOut
} from './firebase.js'

import { renderAccountBalance } from './screens/AccountBalance.js'
import { renderMemberLedger } from './screens/MemberLedger.js'
import { renderUnifiedPayment } from './screens/Remittance/index.js'
import { renderMembers } from './screens/members/index.js'
import { renderSettings } from './screens/Settings.js'
import { renderReports } from './screens/Reports.js'
import { renderReconciliation } from './screens/Reconciliation.js'
import { renderRegistration } from './screens/Registration.js'
import { fetchAllMembers, fetchMembersBySearch, isNotDeleted } from './services/dataService.js'
import { hashPassword, escapeHtml, escapeAttribute, generateId, getInitials, wrapDateInput } from './utils/formatters.js'
import { initializeSyncService, syncCooperativeData, performHardRestore } from './services/syncService.js'
import { getAllForCoop, loadDoc, isSynced, queryOne } from './services/sqliteService.js'
import { validateLogin } from './services/authService.js'

import { attemptOfflineLogin, saveSessionLocally as saveSession, loadSavedSession, clearSavedSession, clearOfflineSession, clearAllOfflineSessions } from './services/offlineAuthService.js'
import { mountNotificationBell } from './components/NotificationBell.js'
import { getNotificationListHtml, setupNotificationModalListeners } from './components/NotificationModal.js'
import { showToast } from './services/toastService.js'
import { syncBus, SyncEvents } from './services/syncEventBus.js'


const app = document.querySelector('#app')

function getDefaultTab(user) {
  if (!user) return 'dashboard';
  if (user.role === 'member' || hasPermission(user.permissions, 'dashboard_view')) return 'dashboard';
  if (user.role !== 'member' && hasPermission(user.permissions, 'read_member')) return 'members';
  if (hasPermission(user.permissions, 'read_remittance')) return 'payments';
  if (user.role === 'member' || hasPermission(user.permissions, 'read_ledger') || hasPermission(user.permissions, 'read_coop_ledger')) return 'ledger';
  if (hasPermission(user.permissions, 'read_reconcile')) return 'reconciliation';
  if (user.role === 'member' || hasPermission(user.permissions, 'settings_manage')) return 'settings';
  return 'dashboard';
}

let _coopSearchTimeout = null
let _pingInterval = null
let _dashboardRefreshInterval = null
const PING_INTERVAL = 30000 // 30s
const DASHBOARD_REFRESH_INTERVAL = 60000 // 60s

async function checkConnectivity() {
  const tryPing = async (url) => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    await fetch(url, { mode: 'no-cors', signal: ctrl.signal })
    clearTimeout(t)
  }

  const endpoints = [
    'https://www.gstatic.com/generate_204',
    'https://www.google.com/generate_204',
  ]

  for (const url of endpoints) {
    try {
      await tryPing(url)
      if (!state.isOnline) {
        state.isOnline = true
        state.isSyncing = false
        _updateNetworkIndicator()
      }
      return // confirmed online
    } catch {
      // try next endpoint
    }
  }

  // All pings failed — fall back to navigator.onLine as a safety net
  // (endpoints may be blocked by corporate firewall/proxy)
  if (navigator.onLine !== state.isOnline) {
    state.isOnline = navigator.onLine
    state.isSyncing = false
    _updateNetworkIndicator()
  }
}

function startConnectivityCheck() {
  checkConnectivity()
  if (_pingInterval) clearInterval(_pingInterval)
  _pingInterval = setInterval(checkConnectivity, PING_INTERVAL)
}

const savedSession = loadSavedSession();

const state = {
  isOnline: navigator.onLine,
  stage: 1,
  username: '',
  password: '',
  selectedCooperativeId: '',
  cooperatives: [],
  isSubmitting: false,
  isSyncing: false,
  showPassword: false,
  errorMessage: '',
  welcomeUser: savedSession,
  activeTab: savedSession?.activeTab || getDefaultTab(savedSession),
  selectedMemberId: null, // For Admins/Staff
  editingRemittance: null, // Holds data when editing
  editingRemittanceId: null, // ID of record being edited
  members: [], // List of all members for Admins
  isRegistering: false,
  coopSearchQuery: '', // NEW: For searchable dropdown
  showActivationKeyPrompt: false,
  activationKeyInput: '',
  activationKeyError: '',
  modal: {
    isOpen: false,
    title: '',
    content: '',
    type: null, // 'force-password' or null
    data: null  // for passing userDoc etc
  },
  loanRequest: {
    step: 1,
    enterpriseId: '',
    amount: 0,
    duration: 1,
    guarantors: [],
    bankDetails: {
      bankName: '',
      accountName: '',
      accountNumber: ''
    }
  },
  reports: {
    type: '',
    filters: {},
    selectedFields: ['full_name', 'registration_no', 'mobile', 'sex', 'status'],
    currentReportData: null
  },
}

window.addEventListener('hashchange', () => {
  window.__isFormDirty = false;
  handleRouting()
  render()
})

window.addEventListener('online', () => {
  // Browser thinks we're online — verify with a real ping
  checkConnectivity();
});

window.addEventListener('offline', () => {
  // Browser knows we lost the interface — trust this immediately
  state.isOnline = false;
  state.isSyncing = false;
  _updateNetworkIndicator();
});

// Listen for sync status changes to update network indicator only (no re-render)
syncBus.on(SyncEvents.SYNC_STATUS_CHANGED, ({ status }) => {
  if (status === 'syncing' || status === 'reconnecting') {
    state.isSyncing = true;
  } else if (status === 'online' || status === 'offline') {
    state.isSyncing = false;
    state.isOnline = status === 'online';
  }
  _updateNetworkIndicator();
});

// --- Global Error Handling ---
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled Promise Rejection:', event.reason);
  if (event.reason?.message?.includes('Database is locked')) {
    showToast('Database is locked by another tab. Please close other tabs and refresh.', 'error');
  }
});

window.onerror = (message, source, lineno, colno, error) => {
  console.error('Global Error:', { message, source, lineno, colno, error });
  // Don't show alert for minor errors, but log them
};

function handleRouting() {
  const hash = window.location.hash.substring(1)
  if (!hash) {
    if (state.welcomeUser) {
      window.location.hash = state.activeTab
    }
    return
  }

  const [tab, ...parts] = hash.split('/')
  state.activeTab = tab
  state.routeParts = parts

  // Add body class for tab-specific styling (e.g. moving sync indicator)
  document.body.className = `tab-${tab}`
}

function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  return savedTheme;
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  renderThemeToggle();
}

const currentTheme = initTheme();

async function bootstrapApp() {
  const startTs = Date.now();
  console.log(`[DEBUG] [${startTs}] bootstrapApp: Starting...`);
  handleRouting()

  // If there's a saved session, eagerly initialize SQLite so saveSession()
  // during login doesn't trigger initDb() for the first time (blocks UI ~3-5s).
  // If there's no session, skip — initDb() will be lazily called when the user logs in.
  if (state.welcomeUser) {
    console.log(`[DEBUG] [${Date.now()}] bootstrapApp: Initializing SQLite...`);
    app.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background-color: var(--bg-main); font-family: inherit;">
        <div style="width: 48px; height: 48px; border: 4px solid var(--border-medium); border-top: 4px solid var(--accent-primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <h2 style="margin-top: 24px; color: var(--text-primary); font-weight: 600; font-size: 1.25rem;">Restoring Offline Data...</h2>
        <div style="color: var(--text-muted); font-size: 0.875rem; margin-top: 8px;">Please wait</div>
        <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
      </div>
    `
    try {
      const { initDb } = await import('./services/sqliteService.js')
      await initDb()
      console.log(`[DEBUG] [${Date.now()}] bootstrapApp: initDb complete.`);
    } catch (err) {
      console.error("Critical: Failed to initialize SQLite WASM", err)
      app.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background-color: var(--danger-bg); font-family: inherit;">
          <div style="color: var(--danger); font-size: 3rem;">⚠️</div>
          <h2 style="margin-top: 16px; color: var(--danger); font-weight: 600; font-size: 1.25rem;">Database Initialization Failed</h2>
          <div style="color: var(--danger); font-size: 0.875rem; margin-top: 8px; max-width: 400px; text-align: center;">
            ${err.message || "Failed to load the local database."}
          </div>
          <button onclick="window.location.reload()" style="margin-top: 24px; background: var(--danger); color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; cursor: pointer; font-weight: 600;">Reload Page</button>
        </div>
      `
      return // Halt execution, do not render or sync
    }
  }

  if (state.welcomeUser && (state.welcomeUser.subscriptionStatus === undefined || state.welcomeUser.subscriptionExpiry === undefined)) {
    try {
      const { queryOne } = await import('./services/sqliteService.js')
      const userRecord = await queryOne(
        'SELECT subscriptionStatus, expiry_date FROM users WHERE cooperative_id = ? AND username = ? AND is_deleted = 0',
        [String(state.welcomeUser.cooperativeId), state.welcomeUser.username]
      )
      if (userRecord) {
        state.welcomeUser.subscriptionStatus = userRecord.subscriptionStatus
        state.welcomeUser.subscriptionExpiry = userRecord.expiry_date
      }
    } catch (e) {
      console.warn('[Bootstrap] Could not backfill subscription info:', e.message)
    }
  }

  // Start real connectivity pings (replaces unreliable navigator.onLine)
  startConnectivityCheck();

  console.log(`[DEBUG] [${Date.now()}] bootstrapApp: Initializing sync service...`);
  // Start the background sync loop
  initializeSyncService()

  // CRITICAL: If the DB is volatile (in-memory) or wiped, we SHOULD sync before rendering.
  // Previously this was fire-and-forget, causing the dashboard to render with empty data
  // and never re-render after sync completed.
  const isSyncedAlready = await isSynced(state.welcomeUser?.cooperativeId)

  if (state.welcomeUser && navigator.onLine && !isSyncedAlready) {
    console.warn('[Sync] Local database is empty on refresh. Triggering background sync...')
    const msgEl = document.querySelector('#app h2')
    if (msgEl) msgEl.textContent = 'Downloading Data...'
    try {
      await syncCooperativeData(
        state.welcomeUser.cooperativeId,
        state.welcomeUser.role,
        state.welcomeUser.memberId,
        state.welcomeUser.permissions,
        state.welcomeUser.username,
        state.welcomeUser.registrationNo
      )
      console.log(`[DEBUG] [${Date.now()}] bootstrapApp: Initial sync completed before render.`);
    } catch (e) {
      console.error('[Sync] Initial background sync failed:', e);
    }
  }

  console.log(`[DEBUG] [${Date.now()}] bootstrapApp: Setting up PWA listener...`);
  setupPWAUpdateListener()

  // Network indicator is handled by the main listeners above

  console.log(`[DEBUG] [${Date.now()}] bootstrapApp: Calling first render()...`);
  render()
  console.log(`[DEBUG] [${Date.now()}] bootstrapApp: Finished.`);
}

bootstrapApp()


/**
 * PWA Update Listener.
 * Notifies the user when a new version of the app is available.
 */
function setupPWAUpdateListener() {
  if ('serviceWorker' in navigator) {
    // Guard against infinite reload loops caused by frequent controller changes
    if (window.__hasReloaded) return;
    window.__hasReloaded = true;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Reload only once when a new service worker takes control
      if (!window.__hasReloaded) {
        window.__hasReloaded = true;
        window.location.reload();
      }
    });
    // Reset the flag after a short delay to allow future legitimate updates
    setTimeout(() => { window.__hasReloaded = false; }, 5000);
  }
}


app.addEventListener('click', async (event) => {
  const suggestion = event.target.closest('.suggestion-item')
  if (suggestion) {
    state.selectedCooperativeId = suggestion.dataset.id
    state.coopSearchQuery = ''
    // Remember this choice for next login
    try { localStorage.setItem('cooplog-last-coop-' + state.username.toLowerCase(), suggestion.dataset.id) } catch {}

    // Surgical update instead of full renderF
    const statusDiv = document.getElementById('coop-selection-status')
    const searchInput = document.getElementById('coop-search-input')
    const suggestionsDiv = document.getElementById('coop-suggestions')
    const hiddenInput = document.querySelector('input[name="cooperative"]')

    if (statusDiv) {
      const coop = state.cooperatives.find(c => c.id === suggestion.dataset.id)
      statusDiv.innerHTML = `Now viewing: <strong>${escapeHtml(coop?.name || '')}</strong>`
    }
    if (searchInput) searchInput.value = ''
    if (suggestionsDiv) suggestionsDiv.classList.add('hidden')
    if (hiddenInput) hiddenInput.value = suggestion.dataset.id

    return
  }

  const resetBtn = event.target.closest('#coop-reset-btn')
  if (resetBtn) {
    state.selectedCooperativeId = ''
    state.coopSearchQuery = ''

    const statusDiv = document.getElementById('coop-selection-status')
    const searchInput = document.getElementById('coop-search-input')
    const suggestionsDiv = document.getElementById('coop-suggestions')
    const hiddenInput = document.querySelector('input[name="cooperative"]')

    if (statusDiv) statusDiv.innerHTML = ''
    if (searchInput) {
      searchInput.value = ''
      searchInput.focus()
    }
    if (suggestionsDiv) suggestionsDiv.classList.add('hidden')
    if (hiddenInput) hiddenInput.value = ''

    return
  }

  const action = event.target.closest('[data-action]')?.dataset.action
  if (!action) {
    return
  }

  if (action === 'next') {
    await handleNext()
    return
  }

  if (action === 'back') {
    handleBack()
    return
  }

  if (action === 'toggle-password') {
    state.showPassword = !state.showPassword
    render()
    return
  }

  if (action === 'google-login') {
    await handleGoogleLogin();
    return;
  }

  if (action === 'logout') {
    // Capture user info before clearing state
    const coopId = state.welcomeUser?.cooperativeId
    const userId = state.welcomeUser?.userId || state.welcomeUser?.memberId
    try {
      const { auth } = getFirebaseAuth();
      if (auth) {
        await signOut(auth);
      }
    } catch (e) {
      console.warn('Failed to sign out from Firebase', e);
    }
    state.welcomeUser = null
    state.stage = 1
    state.isGoogleLoginFlow = false
    state.username = ''
    state.password = ''
    state.selectedCooperativeId = ''
    state.cooperatives = []
    state.coopSearchQuery = ''
    state.errorMessage = ''
    state.activeTab = 'dashboard'
    state.selectedMemberId = null
    state.members = []
    state.editingRemittance = null
    state.editingRemittanceId = null
    state.loanRequest = {
      step: 1,
      enterpriseId: '',
      amount: 0,
      duration: 1,
      guarantors: [],
      bankDetails: {
        bankName: '',
        accountName: '',
        accountNumber: ''
      }
    }
    saveSession(null)
    // Clear ALL persistent offline sessions from IndexedDB so refresh cannot auto-login
    await clearAllOfflineSessions()
    render()
    return
  }

  if (action === 'nav-tab') {
    const targetHash = event.target.closest('[data-tab]').dataset.tab
    window.location.hash = targetHash
    
    // The hashchange listener will handle the rest (state update + render)
    return
  }

  if (action === 'edit-remit') {
    const remitId = event.target.closest('[data-id]').dataset.id
    // This will be handled by the UnifiedPayment screen's load logic
    state.editingRemittanceId = remitId
    state.activeTab = 'payments'
    renderDashboardContent()
    updateNavSelection()
    return
  }

  if (action === 'delete-remit') {
    const remitId = event.target.closest('[data-id]').dataset.id
    if (confirm('Are you sure you want to delete this payment record?')) {
      import('./services/dataService.js').then(m => {
        m.deleteRemittance(remitId, state.welcomeUser.username).then(() => {
          renderDashboardContent()
        })
      })
    }
    return
  }

  if (action === 'view-details') {
    const row = event.target.closest('[data-remittance]')
    if (row) {
      const remit = JSON.parse(row.dataset.remittance)
      window.showTransactionModal(remit)
    }
    return
  }

  if (action === 'toggle-mobile-nav') {
    const sidebar = document.querySelector('.sidebar')
    if (sidebar) sidebar.classList.toggle('open')
    return
  }

  if (action === 'close-sidebar') {
    const sidebar = document.querySelector('.sidebar')
    if (sidebar) sidebar.classList.remove('open')
    return
  }

  if (action === 'close-modal') {
    // Only close if clicking the close button. 
    // Overlay clicks are ignored now to prevent accidental closures while typing.
    closeModal()
    return
  }

  // Select-member global action removed

  if (action === 'show-registration') {
    state.showActivationKeyPrompt = true
    state.activationKeyInput = ''
    state.activationKeyError = ''
    render()
    return
  }
  
  if (action === 'activation-key-back') {
    state.showActivationKeyPrompt = false
    state.activationKeyInput = ''
    state.activationKeyError = ''
    render()
    return
  }
  
  if (action === 'hard-reset') {
    // Show the same confirmation as in Settings
    if (!confirm('Final Confirmation: Are you absolutely sure? The app will reload and force a new login.')) return
    
    // Call performHardRestore
    try {
      await performHardRestore(null);
    } catch (err) {
      console.error('Hard restore failed:', err);
      showToast('Restore failed: ' + err.message, 'error');
    }
    return
  }

  if (action === 'toggle-theme') {
    toggleTheme()
    return
  }

  if (action === 'withdrawal-request') {
    showWithdrawalWizard();
    return;
  }
})

// --- Notification Events ---
window.addEventListener('show-notifications', async () => {
  if (!state.welcomeUser) return
  
  state.modal.title = "Notifications"
  state.modal.type = "notifications"
  state.modal.isOpen = true
  state.modal.content = '<div style="padding: 2rem; text-align: center;">Loading notifications...</div>'
  render() // Show loading state

  const html = await getNotificationListHtml(state.welcomeUser)
  state.modal.content = html
  render()
})

// --- Global Event Listeners for Complex Screen Interactions ---

window.addEventListener('edit-remittance', async (e) => {
  state.editingRemittance = e.detail
  state.activeTab = 'payments'
  renderDashboardContent()
  updateNavSelection()
})


window.addEventListener('remittance-saved', () => {
  state.editingRemittance = null
  // User Request: Stay on the same screen (Log Payment / Unified Payments)
  renderDashboardContent()
  updateNavSelection()
})

window.addEventListener('cancel-edit-remittance', () => {
  state.editingRemittance = null
  state.activeTab = 'payments'
  renderDashboardContent()
  updateNavSelection()
})

// Listen for tab change requests (e.g. from Members page to Ledger)
window.addEventListener('change-tab', (e) => {
  const { tab, memberId } = e.detail
  state.activeTab = tab
  if (memberId) state.selectedMemberId = memberId
  render()
})

let _lastInteractionTs = Date.now()
window.__isFormDirty = false

// Track user interactions to accurately check idle state
window.addEventListener('mousemove', () => _lastInteractionTs = Date.now(), { passive: true })
window.addEventListener('keydown', () => _lastInteractionTs = Date.now(), { passive: true })
window.addEventListener('scroll', () => _lastInteractionTs = Date.now(), { passive: true })
window.addEventListener('mousedown', () => _lastInteractionTs = Date.now(), { passive: true })
window.addEventListener('touchstart', () => _lastInteractionTs = Date.now(), { passive: true })
window.addEventListener('click', () => _lastInteractionTs = Date.now(), { passive: true })

// Track dirty form inputs globally
window.addEventListener('input', (e) => {
  const target = e.target
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
    const id = target.id || ''
    const className = target.className || ''
    const isFilterOrSearch = id.toLowerCase().includes('search') || 
                             id.toLowerCase().includes('filter') || 
                             className.toLowerCase().includes('search') || 
                             className.toLowerCase().includes('filter')
    if (!isFilterOrSearch) {
      target.dataset.dirty = 'true'
      window.__isFormDirty = true
    }
  }
})

window.addEventListener('change', (e) => {
  const target = e.target
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
    const id = target.id || ''
    const className = target.className || ''
    const isFilterOrSearch = id.toLowerCase().includes('search') || 
                             id.toLowerCase().includes('filter') || 
                             className.toLowerCase().includes('search') || 
                             className.toLowerCase().includes('filter')
    if (!isFilterOrSearch) {
      target.dataset.dirty = 'true'
      window.__isFormDirty = true
    }
  }
})

window.addEventListener('submit', () => {
  window.__isFormDirty = false
})

// Listen to cancel/clear buttons to clear dirty state
window.addEventListener('click', (e) => {
  const cleared = e.target.closest('#clear-log-form-btn, #clear-recon-form-btn, #cancel-btn, #cancel-selection-btn')
  if (cleared) {
    window.__isFormDirty = false
  }
})

// Helper to check if any inputs are currently dirty in the DOM
function isFormDirty() {
  if (window.__isFormDirty) return true
  const dirtyInput = document.querySelector('input[data-dirty="true"], textarea[data-dirty="true"], select[data-dirty="true"]')
  return !!dirtyInput
}

// Check if all safety conditions are met for a background refresh
function canPerformRefresh() {
  if (!state.welcomeUser) return false

  // 1. Typing focus guard
  const activeEl = document.activeElement
  const isTyping = activeEl && (
    activeEl.tagName === 'INPUT' || 
    activeEl.tagName === 'TEXTAREA' || 
    activeEl.tagName === 'SELECT' || 
    activeEl.isContentEditable
  )
  if (isTyping) return false

  // 2. Interaction Idle Guard (15 seconds)
  const isIdle = (Date.now() - _lastInteractionTs) > 15000
  if (!isIdle) return false

  // 3. Modals Guard
  const isModalOpen = !!(
    document.getElementById('member-details-modal') || 
    document.getElementById('md-img-preview') || 
    document.querySelector('.modal-overlay.open') ||
    document.querySelector('#modal-overlay.open')
  )
  if (isModalOpen) return false

  // 4. Checkbox Selection Guard (table row selection active)
  const hasSelections = !!document.querySelector('table input[type="checkbox"]:checked')
  if (hasSelections) return false

  // 5. Unsaved Forms Guard
  if (isFormDirty()) return false

  return true
}



// --- Granular Sync Updates ---
// Instead of re-rendering entire views on sync, update only the changed records.
// Components that need to react to data changes should subscribe via syncBus.
syncBus.on(SyncEvents.MEMBER_UPDATED, ({ data }) => {
  if (!state.welcomeUser) return
  // Update in-memory member cache if present
  const idx = state.members.findIndex(m => m.id === data.id)
  if (idx >= 0) {
    state.members[idx] = { ...state.members[idx], ...data }
  }
  // If on members tab, update the member row in-place
  if (state.activeTab === 'members') {
    const row = document.querySelector(`tr[data-member-id="${data.id}"]`)
    if (row) {
      import('./screens/members/membersState.js').then(m => {
        m.getAllMembers().forEach((mem, i) => {
          if (mem.id === data.id) {
            m.getAllMembers()[i] = { ...mem, ...data }
          }
        })
        m.applyFilters()
      })
    }
  }
})

syncBus.on(SyncEvents.REMITTANCE_UPDATED, ({ data }) => {
  if (!state.welcomeUser) return
  // If on dashboard, refresh the balances and charts
  if (state.activeTab === 'dashboard') {
    renderDashboardContent()
    return
  }
  // If on payments tab, update the history row and stats
  if (state.activeTab === 'payments') {
    const row = document.querySelector(`tr[data-remit-id="${data.id}"]`)
    if (row) {
      const cells = row.querySelectorAll('td')
      if (cells.length >= 4) {
        const statusCell = cells[cells.length - 1]
        if (data.status) {
          statusCell.innerHTML = `<span class="status-badge status-${data.status}">${data.status}</span>`
        }
      }
    }
  }
})

syncBus.on(SyncEvents.REMITTANCE_ADDED, () => {
  if (state.welcomeUser && state.activeTab === 'dashboard') {
    renderDashboardContent()
  }
})

syncBus.on(SyncEvents.REMITTANCE_DELETED, () => {
  if (state.welcomeUser && state.activeTab === 'dashboard') {
    renderDashboardContent()
  }
})

syncBus.on(SyncEvents.SYNC_COMPLETED, () => {
  if (state.welcomeUser && state.activeTab === 'dashboard') {
    renderDashboardContent()
  }
})

syncBus.on(SyncEvents.BULK_REMITTANCES_LOADED, () => {
  if (state.welcomeUser && state.activeTab === 'dashboard') {
    renderDashboardContent()
  }
})

syncBus.on(SyncEvents.NOTIFICATION_ADDED, () => {
  // Just update the notification bell badge count
  const badge = document.querySelector('.notification-bell .badge')
  // NotificationBell component handles its own refresh via its own listener
})

// Initial bulk data loaded after full sync
syncBus.on(SyncEvents.BULK_MEMBERS_LOADED, () => {
  if (state.welcomeUser && state.activeTab === 'members') {
    // Only refresh members data state, don't re-render
    import('./screens/members/membersState.js').then(m => m.loadMembersData({
      ...state.welcomeUser,
      isAdmin: hasPermission(state.welcomeUser.permissions, 'admin') || state.welcomeUser.username?.toLowerCase() === 'admin'
    })).catch(e => console.warn('[Sync] Failed to reload members state:', e))
  }
})

window.addEventListener('refresh-members', async () => {
  if (!state.welcomeUser) return
  const isAdmin = hasPermission(state.welcomeUser.permissions, 'admin') || state.welcomeUser.username.toLowerCase() === 'admin'
  const hasAllEnts = String(state.welcomeUser.enterprise_rights || state.welcomeUser.enterprises || '').toLowerCase().includes('all')
  // Only update the in-memory member list, no re-render
  try {
    state.members = await fetchAllMembers(state.welcomeUser.cooperativeId, state.welcomeUser.username, isAdmin || hasAllEnts)
    // Update membersState if component is mounted
    import('./screens/members/membersState.js').then(m => {
      const all = m.getAllMembers()
      if (state.members.length !== all.length || state.members.some((mem, i) => mem.id !== all[i]?.id)) {
        // Reload silently
        m.loadMembersData({
          ...state.welcomeUser,
          isAdmin
        }).catch(e => console.warn('[refresh-members] Failed to reload members state:', e))
      }
    }).catch(() => {})
  } catch (e) {
    console.warn('[refresh-members] Failed to fetch members:', e.message)
  }
})

app.addEventListener('submit', async (event) => {
  // Only trigger login flow if NOT already logged in AND modal is NOT open
  // (the modal has its own specific submit listener)
  if (state.welcomeUser || (state.modal && state.modal.isOpen)) return

  event.preventDefault()
  await handleNext()
})

app.addEventListener('input', (event) => {
  const target = event.target
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
    return
  }

  if (target.name === 'username') {
    state.username = target.value
  }

  if (target.name === 'password') {
    state.password = target.value
  }

  if (target.name === 'cooperative') {
    state.selectedCooperativeId = target.value
  }

  if (target.id === 'coop-search-input') {
    state.coopSearchQuery = target.value
    const query = target.value
    const suggestionsDiv = document.getElementById('coop-suggestions')
    if (suggestionsDiv) {
      const localResults = state.cooperatives.filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
      if (!query) {
        suggestionsDiv.classList.add('hidden')
      } else {
        suggestionsDiv.classList.remove('hidden')
        suggestionsDiv.innerHTML = localResults.map(coop => `
          <div class="suggestion-item" data-id="${escapeAttribute(coop.id)}" style="padding: 0.6rem 0.75rem; font-size: 0.825rem; cursor: pointer; border-bottom: 1px solid var(--border-light); text-align: left;">
            <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(coop.name || 'Cooperative')}</div>
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem;">ID: ${escapeHtml(coop.id)}</div>
          </div>
        `).join('')
        if (localResults.length === 0) {
          suggestionsDiv.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No results found</div>'
        }
      }
      if (_coopSearchTimeout) clearTimeout(_coopSearchTimeout)
      if (query && state.isOnline) {
        _coopSearchTimeout = setTimeout(async () => {
          try {
            const { searchAllCooperatives } = await import('./services/authService.js')
            const onlineResults = await searchAllCooperatives(query)
            const merged = [...localResults]
            const localIds = new Set(localResults.map(c => c.id))
            for (const coop of onlineResults) {
              if (!localIds.has(coop.id)) merged.push(coop)
            }
            const currentSuggestions = document.getElementById('coop-suggestions')
            if (currentSuggestions && state.stage === 2 && state.coopSearchQuery === query) {
              if (merged.length === 0) {
                currentSuggestions.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No results found</div>'
              } else {
                currentSuggestions.innerHTML = merged.map(coop => `
                  <div class="suggestion-item" data-id="${escapeAttribute(coop.id)}" style="padding: 0.6rem 0.75rem; font-size: 0.825rem; cursor: pointer; border-bottom: 1px solid var(--border-light); text-align: left;">
                    <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(coop.name || 'Cooperative')}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem;">ID: ${escapeHtml(coop.id)}</div>
                  </div>
                `).join('')
              }
            }
          } catch (err) {
            console.warn('[Login] Online cooperative search failed:', err.message)
          }
        }, 400)
      }
    }
  }

  // Global member-selector listener removed

  state.errorMessage = ''
})

function render() {
  console.log(`[DEBUG] [${Date.now()}] render: Called. stage=${state.stage}, welcomeUser=${!!state.welcomeUser}, isRegistering=${state.isRegistering}, showActivationKeyPrompt=${state.showActivationKeyPrompt}`);
  
  if (state.showActivationKeyPrompt) {
    app.innerHTML = `
      <main class="shell">
        <section class="card" style="animation: fadeIn 0.5s ease-out;">
          <div class="brand">COOPERATIVE LOG APP</div>
          <h1 style="font-weight: 800; font-size: 1.75rem; color: var(--text-primary); margin-top: 0; text-align: center;">Activation Key</h1>
          <p style="color: var(--text-muted); text-align: center; margin-bottom: 2rem; font-size: 0.95rem;">Please enter the activation key to proceed</p>
          ${state.activationKeyError ? `<div class="alert" style="margin-bottom: 1.5rem;">${escapeHtml(state.activationKeyError)}</div>` : ''}
          <form class="form" id="activation-key-form" style="text-align: left;">
            <label class="field">
              <span>Activation Key</span>
              <input
                name="activation_key"
                type="text"
                placeholder="Enter activation key"
                value="${escapeAttribute(state.activationKeyInput)}"
                autocomplete="off"
                autofocus
              />
              <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem;">Hint: (YDM)</p>
            </label>
            <div class="actions">
              <button type="button" class="secondary-button" data-action="activation-key-back">Back</button>
              <button type="submit" class="primary-button">Continue</button>
            </div>
          </form>
        </section>
      </main>
    `;
    
    // Attach listeners
    const form = document.getElementById('activation-key-form');
    form.addEventListener('input', (e) => {
      if (e.target.name === 'activation_key') {
        state.activationKeyInput = e.target.value;
        state.activationKeyError = '';
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      // Generate expected key in YYDDMM format
      const today = new Date();
      const yy = String(today.getFullYear()).slice(-2);
      const dd = String(today.getDate()).padStart(2, '0');
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const expectedKey = `${yy}${dd}${mm}`;
      
      if (state.activationKeyInput.trim() === expectedKey) {
        // Success! Proceed to registration
        state.showActivationKeyPrompt = false;
        state.activationKeyInput = '';
        state.activationKeyError = '';
        state.isRegistering = true;
        render();
      } else {
        state.activationKeyError = 'Invalid activation key. Please try again.';
        render();
      }
    });
    return;
  }
  
  if (state.isRegistering) {
    renderRegistration(app, () => {
      state.isRegistering = false
      render()
    }, (result) => {
      showToast(`Registration Successful!\nCooperative ID: ${result.cooperativeId}\n\nYou can now log in with the 'admin' account.`, 'success')
      state.isRegistering = false
      state.username = 'admin'
      state.stage = 1
      render()
      // Push new cooperative data to Firestore in background
      import('./services/syncService.js').then(m => {
        m.pushQueue(result.cooperativeId).catch(e => console.warn('[Register] Initial push failed:', e))
      })
    })
    return
  }

  if (state.welcomeUser) {
    renderDashboard()
    
    // Mount Notification Bell
    const bellContainer = document.getElementById('notification-bell-placeholder')
    if (bellContainer) {
        mountNotificationBell(bellContainer, state.welcomeUser)
    }
    return
  }

  const detectInputType = (val) => {
    const s = String(val || '');
    if (!s) return '';
    if (/^\d+$/.test(s)) return s.length >= 10 ? '📱 Mobile' : '🔢 Registration No';
    if (/^[A-Z0-9]{2,}$/i.test(s) && s.length >= 3) return '🆔 Special ID';
    if (s.includes('@')) return '✉️ Email';
    return '👤 Username';
  };

  const titles = {
    1: 'Welcome Back',
    2: 'Select Cooperative',
    3: 'Enter Password',
  }

  const buttonLabels = {
    1: 'Next',
    2: 'Next',
    3: 'Sign In',
  }

  app.innerHTML = `
    <main class="shell">
      <section class="card" style="animation: fadeIn 0.5s ease-out; position: relative;">
        <div style="position: absolute; top: 1rem; left: 1.25rem;">
          <div class="network-indicator ${networkIndicatorClass()}" role="status" aria-label="${networkIndicatorLabel()}">
            <span class="indicator-icon">${networkIndicatorIcon()}</span>
            <span>${networkIndicatorLabel()}</span>
          </div>
        </div>
        <button type="button" class="ghost-button" data-action="hard-reset" style="position: absolute; top: 1rem; right: 1rem; width: 2.5rem; height: 2.5rem; padding: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center;" title="Hard Reset App">
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 0A1 1 0 0012 3m0 0v12m0-12L7.054 7.054A7 7 0 005 12v4 12a7 7 0 0014 0 7 7 0 00-.054-.946"></path></svg>
        </button>
        <div class="brand">COOPERATIVE LOG APP</div>
        <h1 style="font-weight: 800; font-size: 1.75rem; color: var(--text-primary); margin-top: 0; text-align: center;">${titles[state.stage]}</h1>
        <div style="margin-bottom: 2rem;"></div>
        ${renderAlert()}
        <form class="form" style="text-align: left;">
          <label class="field ${state.stage !== 1 ? 'field-hidden' : ''}">
            <span>Username, Mobile, or Special ID</span>
            <input
              name="username"
              type="text"
              placeholder="admin, mobile, or special id"
              value="${escapeAttribute(state.username)}"
              ${state.stage !== 1 ? 'disabled' : ''}
            />
            ${state.username ? `<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem;">Detected: ${detectInputType(state.username)}</div>` : ''}
          </label>

          <label class="field ${state.stage !== 2 ? 'field-hidden' : ''}" style="position: relative; margin-top: 1rem;">
            <span style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; display: block;">Cooperative Context</span>
            <div style="position: relative;">
              <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center;">
                <div style="position: relative; flex: 1;">
                  <input
                    type="text"
                    id="coop-search-input"
                    placeholder="Search cooperative..."
                    value="${escapeAttribute(state.coopSearchQuery)}"
                    autocomplete="off"
                    ${state.stage !== 2 ? 'disabled' : ''}
                  />
                </div>
                <button type="button" id="coop-reset-btn" title="Clear search" style="background: var(--bg-secondary); border: none; border-radius: 50%; width: 2.75rem; height: 2.75rem; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-muted); transition: all 0.2s ease;">
                  <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>

              <div id="coop-selection-status" style="font-size: 0.8rem; color: var(--accent-primary); margin-bottom: 1.25rem; font-weight: 600; text-align: left; padding-left: 0.5rem;">
                ${state.selectedCooperativeId ? `Currently viewing: <span style="color: var(--text-primary); font-weight: 700;">${escapeHtml(state.cooperatives.find(c => c.id === state.selectedCooperativeId)?.name || '')}</span>` : 'Currently viewing: Global Data'}
              </div>

              <div id="coop-suggestions" class="search-suggestions ${!state.coopSearchQuery ? 'hidden' : ''}" style="top: 3.25rem;">
                ${state.cooperatives
      .filter(c => c.name.toLowerCase().includes((state.coopSearchQuery || '').toLowerCase()))
      .map(coop => `
                    <div class="suggestion-item" data-id="${escapeAttribute(coop.id)}">
                      <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(coop.name || 'Cooperative')}</div>
                      <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem;">ID: ${escapeHtml(coop.id)}</div>
                    </div>
                  `).join('')}
                ${state.cooperatives.filter(c => c.name.toLowerCase().includes((state.coopSearchQuery || '').toLowerCase())).length === 0 ? '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No results found</div>' : ''}
              </div>
            </div>
            <input type="hidden" name="cooperative" value="${escapeAttribute(state.selectedCooperativeId)}" />
          </label>

          <label class="field ${state.stage !== 3 ? 'field-hidden' : ''}">
            <span>Password</span>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.75rem; padding: 0.5rem 0.75rem; background: var(--bg-secondary); border-radius: 0.5rem; line-height: 1.5;">
              Logging in as <strong style="color: var(--text-primary);">${escapeHtml(state.username)}</strong>
              ${state.selectedCooperativeId ? `→ <strong style="color: var(--text-primary);">${escapeHtml(state.cooperatives.find(c => c.id === state.selectedCooperativeId)?.name || '')}</strong>` : ''}
            </div>
            <div class="password-wrap">
              <input
                name="password"
                type="${state.showPassword ? 'text' : 'password'}"
                placeholder="********"
                value="${escapeAttribute(state.password)}"
                ${state.stage !== 3 ? 'disabled' : ''}
              />
              <button type="button" class="ghost-button" data-action="toggle-password">
                ${state.showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          <div class="actions">
            <button
              type="button"
              class="secondary-button ${state.stage === 1 ? 'hidden' : ''}"
              data-action="back"
              ${state.isSubmitting ? 'disabled' : ''}
            >
              Back
            </button>
            <button type="submit" class="primary-button" ${state.isSubmitting ? 'disabled' : ''}>
              ${state.isSubmitting ? 'Please wait...' : buttonLabels[state.stage]}
            </button>
          </div>

          ${state.stage === 1 ? `
          <div style="margin-top: 1rem;">
            <button type="button" class="secondary-button" data-action="google-login" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem;" ${state.isSubmitting ? 'disabled' : ''}>
              <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Sign In with Google
            </button>
          </div>
          ` : ''}

          <div style="margin-top: 2.5rem; text-align: center; border-top: 1px solid var(--border-light); padding-top: 2rem;">
            <button type="button" class="ghost-button" data-action="show-registration" style="width: 100%; height: 3.25rem;">
                Register New Cooperative
            </button>
          </div>
        </form>
      </section>
    </main>
    ${renderGlobalModal()}
  `

  // Restore focus to the active input for seamless typing
  if (state.stage === 1) {
    const input = document.querySelector('input[name="username"]');
    if (input && !state.isSubmitting) input.focus();
  } else if (state.stage === 2) {
    const input = document.getElementById('coop-search-input');
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  } else if (state.stage === 3) {
    const input = document.querySelector('input[name="password"]');
    if (input && !state.isSubmitting) input.focus();
  }

  // If a modal with complex listeners is open, re-attach them
  if (state.modal.isOpen && state.modal.type === 'force-password') {
    setupForcePwdListeners();
  }
  if (state.modal.isOpen && state.modal.type === 'withdrawal-request') {
    setupLoanRequestListeners();
  }
  if (state.modal.isOpen && state.modal.type === 'notifications') {
    setupNotificationModalListeners(
      document.getElementById('modal-body'),
      state.welcomeUser,
      () => {
        // On Read: Refresh the modal content
        window.dispatchEvent(new CustomEvent('show-notifications'))
        // Also refresh bell count (handled by bell listener)
      },
      (recordId) => {
        // On View: Close modal and go to record
        state.modal.isOpen = false
        render()
        window.dispatchEvent(new CustomEvent('edit-remittance', { detail: { id: recordId } }))
      }
    )
  }
}

function renderThemeToggle() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const isDark = theme === 'dark';
  const svgContent = isDark
    ? `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l.707-.707M6.343 6.343l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"></path></svg>`
    : `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>`;

  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.innerHTML = isDark ? `${svgContent} <span>Light</span>` : `${svgContent} <span>Dark</span>`;

  const mobileBtn = document.getElementById('theme-toggle-mobile-btn');
  if (mobileBtn) mobileBtn.innerHTML = svgContent;

  const dashboardBtn = document.getElementById('theme-toggle-btn-dashboard');
  if (dashboardBtn) dashboardBtn.innerHTML = svgContent;
}

function renderDashboard() {
  const activeTabTitles = {
    dashboard: 'Dashboard',
    members: 'Members',
    payments: 'Remittance',
    ledger: 'Ledger',
    reports: 'Reports',
    reconciliation: 'Reconciliation',
    settings: 'Settings'
  };
  const activeTitle = activeTabTitles[state.activeTab] || 'CoopLog';

  app.innerHTML = `
    <!-- Mobile Top App Bar -->
    <header class="mobile-top-bar">
      <button class="mobile-menu-btn" data-action="toggle-mobile-nav" aria-label="Open navigation menu">
        <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
        </svg>
      </button>
      <div class="mobile-page-title" id="mobile-page-title">${activeTitle}</div>
      <div class="mobile-header-right" style="display: flex; align-items: center; gap: 0.5rem;">
        <button class="icon-btn-circle" id="mask-toggle-mobile-btn" style="display: none;" title="Toggle balance mask">
          <!-- Will be filled dynamically -->
        </button>
        <div id="mobile-notification-bell-placeholder"></div>
        <button class="icon-btn-circle" data-action="toggle-theme" id="theme-toggle-mobile-btn" title="Toggle theme">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path>
          </svg>
        </button>
      </div>
    </header>

    <div class="dashboard-layout">
      <!-- Desktop Collapsible Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-header">
          <div style="display: flex; gap: 0.75rem; align-items: center; width: 100%;">
            <div id="coop-logo-container" style="width: 44px; height: 44px; border-radius: 50%; background: var(--accent-primary); color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.15rem; overflow: hidden; flex-shrink: 0;">
              <!-- Will be filled dynamically -->
            </div>
            <div style="flex: 1; min-width: 0;" class="sidebar-brand-text">
              <div style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem; margin-bottom: 0.15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(state.welcomeUser.cooperativeName)}</div>
              <div class="network-indicator ${networkIndicatorClass()}" style="padding: 0.15rem 0.5rem; font-size: 0.65rem;" role="status" aria-label="${networkIndicatorLabel()}">
                <span class="indicator-icon" style="width: 12px; height: 12px; display: inline-flex; align-items: center; justify-content: center;">${networkIndicatorIcon()}</span>
                <span>${networkIndicatorLabel()}</span>
              </div>
            </div>
            <div id="notification-bell-placeholder" class="sidebar-brand-text"></div>
            <button class="collapse-sidebar-btn" id="collapse-sidebar-btn" title="Collapse Menu" style="margin-left: 0.25rem;">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/></svg>
            </button>
          </div>
        </div>

        ${!isSubscriptionActive() && String(state.welcomeUser.username || '').toLowerCase() !== 'admin' ? `
          <div class="sidebar-brand-text" style="margin: 0.75rem 1rem; padding: 0.75rem; background: var(--warning-bg, #fef3c7); color: var(--warning, #d97706); border: 1px solid var(--warning, #d97706); border-radius: 0.5rem; font-size: 0.7rem; font-weight: 600; text-align: center; line-height: 1.4;">
            ${INACTIVE_MSG}
          </div>
        ` : ''}
        
        <nav class="sidebar-nav">
          ${(state.welcomeUser.role === 'member' || hasPermission(state.welcomeUser.permissions, 'dashboard_view')) ? `
            <button class="nav-item ${state.activeTab === 'dashboard' ? 'active' : ''}" data-action="nav-tab" data-tab="dashboard">
              <span class="nav-icon"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 14a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1h-4a1 1 0 01-1-1v-5z"/></svg></span>
              <span>Dashboard</span>
            </button>
          ` : ''}
          ${!isSubscriptionActive() && String(state.welcomeUser.username || '').toLowerCase() !== 'admin' ? '' : `
          ${(state.welcomeUser.role !== 'member' && hasPermission(state.welcomeUser.permissions, 'read_member')) ? `
            <button class="nav-item ${state.activeTab === 'members' ? 'active' : ''}" data-action="nav-tab" data-tab="members">
              <span class="nav-icon"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 11-8 0 4 4 0 018 0zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg></span>
              <span>Members</span>
            </button>
          ` : ''}
          ${hasPermission(state.welcomeUser.permissions, 'read_remittance') ? `
            <button class="nav-item ${state.activeTab === 'payments' ? 'active' : ''}" data-action="nav-tab" data-tab="payments">
              <span class="nav-icon"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></span>
              <span>Remittance</span>
            </button>
          ` : ''}
          ${(state.welcomeUser.role === 'member' || hasPermission(state.welcomeUser.permissions, 'read_ledger')) ? `
            <button class="nav-item ${state.activeTab === 'ledger' ? 'active' : ''}" data-action="nav-tab" data-tab="ledger/summary">
              <span class="nav-icon"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg></span>
              <span>Ledger</span>
            </button>
          ` : ''}
          <button class="nav-item ${state.activeTab === 'withdrawal-request' ? 'active' : ''}" data-action="withdrawal-request">
            <span class="nav-icon"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19V5m0 0L5 12m7-7l7 7"/></svg></span>
            <span>Withdrawal Request</span>
          </button>
          ${(state.welcomeUser.role !== 'member' && hasPermission(state.welcomeUser.permissions, 'read_member')) ? `
            <button class="nav-item ${state.activeTab === 'reports' ? 'active' : ''}" data-action="nav-tab" data-tab="reports">
              <span class="nav-icon"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m0 0a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2h-2a2 2 0 00-2 2v14"/></svg></span>
              <span>Reports</span>
            </button>
          ` : ''}
          ${hasPermission(state.welcomeUser.permissions, 'read_reconcile') ? `
            <button class="nav-item ${state.activeTab === 'reconciliation' ? 'active' : ''}" data-action="nav-tab" data-tab="reconciliation">
              <span class="nav-icon"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg></span>
              <span>Reconciliation</span>
            </button>
          ` : ''}
          `}
          ${(state.welcomeUser.role === 'member' || hasPermission(state.welcomeUser.permissions, 'settings_manage')) ? `
            <button class="nav-item ${state.activeTab === 'settings' ? 'active' : ''}" data-action="nav-tab" data-tab="settings">
              <span class="nav-icon"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg></span>
              <span>Settings</span>
            </button>
          ` : ''}
        </nav>

        <div class="sidebar-footer">
          <div style="display: flex; gap: 0.75rem; align-items: center; width: 100%;">
            <div id="user-avatar-container" style="width: 36px; height: 36px; border-radius: 50%; background: var(--accent-soft); color: var(--accent-primary); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.95rem; overflow: hidden; flex-shrink: 0;">
              <!-- Will be filled dynamically -->
            </div>
            <div style="flex: 1; min-width: 0;" class="sidebar-brand-text">
              <div style="font-weight: 600; color: var(--text-primary); font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml(state.welcomeUser.role === 'member' ? state.welcomeUser.fullName : state.welcomeUser.username)}
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem; width: 100%;">
            <button class="secondary-button" style="flex: 1; padding: 0.5rem; font-size: 0.8rem; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; gap: 0.4rem;" data-action="logout" title="Log Out">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink: 0;"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
              <span>Log Out</span>
            </button>
          </div>
        </div>
      </aside>
      <div class="sidebar-overlay" data-action="close-sidebar"></div>

      <!-- Main Content Area -->
      <main class="main-content" id="dashboard-main-content">
        <!-- Content gets injected here -->
      </main>

      <!-- Mobile Bottom Navigation Bar -->
      <nav class="mobile-bottom-nav">
        ${(state.welcomeUser.role === 'member' || hasPermission(state.welcomeUser.permissions, 'dashboard_view')) ? `
          <button class="bottom-nav-item ${state.activeTab === 'dashboard' ? 'active' : ''}" data-action="nav-tab" data-tab="dashboard">
            <svg class="nav-icon" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 14a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1h-4a1 1 0 01-1-1v-5z"/></svg>
            <span class="nav-label">Dashboard</span>
          </button>
        ` : ''}
        ${!isSubscriptionActive() && String(state.welcomeUser.username || '').toLowerCase() !== 'admin' ? '' : `
          ${(state.welcomeUser.role !== 'member' && hasPermission(state.welcomeUser.permissions, 'read_member')) ? `
            <button class="bottom-nav-item ${state.activeTab === 'members' ? 'active' : ''}" data-action="nav-tab" data-tab="members">
              <svg class="nav-icon" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 11-8 0 4 4 0 018 0zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
              <span class="nav-label">Members</span>
            </button>
          ` : ''}
          ${(state.welcomeUser.role === 'member' || hasPermission(state.welcomeUser.permissions, 'read_ledger')) ? `
            <button class="bottom-nav-item ${state.activeTab === 'ledger' ? 'active' : ''}" data-action="nav-tab" data-tab="ledger/summary">
              <svg class="nav-icon" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
              <span class="nav-label">Ledger</span>
            </button>
          ` : ''}
          ${hasPermission(state.welcomeUser.permissions, 'read_remittance') ? `
            <button class="bottom-nav-item ${state.activeTab === 'payments' ? 'active' : ''}" data-action="nav-tab" data-tab="payments">
              <svg class="nav-icon" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <span class="nav-label">Remittance</span>
            </button>
          ` : ''}
        `}
        ${(state.welcomeUser.role === 'member' || hasPermission(state.welcomeUser.permissions, 'settings_manage')) ? `
          <button class="bottom-nav-item ${state.activeTab === 'settings' ? 'active' : ''}" data-action="nav-tab" data-tab="settings">
            <svg class="nav-icon" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            <span class="nav-label">Settings</span>
          </button>
        ` : ''}
      </nav>

      <!-- Mobile Context FAB Container -->
      <div id="mobile-context-fab-container"></div>

      ${renderGlobalModal()}
    </div>
  `

  saveSession(state.welcomeUser)
  renderDashboardContent()
  updateNavSelection()
  
  // Start periodic dashboard data refresh (only when idle)
  startDashboardAutoRefresh()

  // Populate cooperative logo and user avatar
  populateAvatars()

  // Setup listeners for Global Modal if active
  if (state.modal.isOpen) {
    if (state.modal.type === 'withdrawal-request') {
      setupLoanRequestListeners()
    }
  }

  // Collapsible sidebar logic
  const collapseBtn = document.getElementById('collapse-sidebar-btn');
  const dashboardLayout = document.querySelector('.dashboard-layout');
  
  const updateCollapseIcon = (btn, collapsed) => {
    if (collapsed) {
      btn.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7"/></svg>`;
      btn.title = "Expand Menu";
    } else {
      btn.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/></svg>`;
      btn.title = "Collapse Menu";
    }
  };

  // Restore collapsed preference
  const isCollapsed = localStorage.getItem('cooplog-sidebar-collapsed') === 'true';
  if (isCollapsed && dashboardLayout) {
    dashboardLayout.classList.add('collapsed');
  }
  if (collapseBtn) {
    updateCollapseIcon(collapseBtn, isCollapsed);
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = dashboardLayout.classList.toggle('collapsed');
      localStorage.setItem('cooplog-sidebar-collapsed', collapsed ? 'true' : 'false');
      updateCollapseIcon(collapseBtn, collapsed);
    });
  }

  // Mobile Top Bar Mask Toggle Logic
  const maskBtnMobile = document.getElementById('mask-toggle-mobile-btn');
  if (maskBtnMobile) {
    maskBtnMobile.addEventListener('click', (e) => {
      e.stopPropagation();
      const current = localStorage.getItem('cooplog-mask-balances') === 'true';
      localStorage.setItem('cooplog-mask-balances', String(!current));
      
      const desktopMaskBtn = document.getElementById('toggle-mask-btn');
      if (desktopMaskBtn) {
        desktopMaskBtn.click();
      } else {
        renderDashboardContent();
      }
    });
  }

  // Setup Mobile Bottom Navigation tab change visual active state updates
  document.querySelectorAll('.mobile-bottom-nav .bottom-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.mobile-bottom-nav .bottom-nav-item').forEach(btn => btn.classList.remove('active'));
      item.classList.add('active');
    });
  });

  // Render context-aware mobile FAB
  updateMobileFab();
}

function updateMobileFab() {
  const fabContainer = document.getElementById('mobile-context-fab-container');
  if (!fabContainer) return;
  
  fabContainer.innerHTML = '';
  
  if (window.innerWidth >= 768) return; // Only show on mobile
  
  const isAdmin = hasPermission(state.welcomeUser.permissions, 'admin') || String(state.welcomeUser.username || '').toLowerCase() === 'admin';
  
  if (state.activeTab === 'members') {
    const canCreate = isAdmin || hasPermission(state.welcomeUser.permissions, 'create_member');
    let html = '';
    
    // Toggle Filter FAB (looks like filter funnel)
    // Mobile Filter Toggle FAB
    html += `
      <button class="mobile-fab secondary-fab" id="mobile-filter-fab" title="Toggle Filters" style="background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-medium); margin-bottom: 0.25rem; width: 48px; height: 48px; border-radius: 12px; box-shadow: var(--shadow-md); display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.874c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z"></path>
        </svg>
      </button>
    `;
    
    if (canCreate) {
      html += `
        <button class="mobile-fab" data-action="nav-tab" data-tab="members/add" title="Add Member">
          <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path>
          </svg>
        </button>
      `;
    }
    
    fabContainer.innerHTML = html;

    // Attach toggle handler to mobile filter FAB
    setTimeout(() => {
      const filterFab = document.getElementById('mobile-filter-fab');
      if (filterFab) {
        filterFab.addEventListener('click', (e) => {
          e.stopPropagation();
          const filtersRow = document.querySelector('.members-filters-row');
          if (filtersRow) {
            const isShown = filtersRow.classList.toggle('show-on-mobile');
            if (isShown) {
              filterFab.style.background = 'var(--accent-soft)';
              filterFab.style.borderColor = 'var(--accent-primary)';
              filterFab.style.color = 'var(--accent-primary)';
            } else {
              filterFab.style.background = 'var(--bg-card)';
              filterFab.style.borderColor = 'var(--border-medium)';
              filterFab.style.color = 'var(--text-primary)';
            }
          }
        });
      }
    }, 50);
  } else if (state.activeTab === 'payments') {
    const canLog = hasPermission(state.welcomeUser.permissions, 'write_remittance') || isAdmin;
    if (canLog) {
      fabContainer.innerHTML = `
        <button class="mobile-fab" id="mobile-log-payment-fab" title="Log Payment">
          <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </button>
      `;
      setTimeout(() => {
        const btn = document.getElementById('mobile-log-payment-fab');
        btn?.addEventListener('click', (e) => {
          e.stopPropagation();
          const clearBtn = document.getElementById('clear-log-btn');
          if (clearBtn) {
            clearBtn.click();
            showToast('Form cleared to log a new payment', 'info');
          }
        });
      }, 50);
    }
  }
}

function startDashboardAutoRefresh() {
  if (_dashboardRefreshInterval) clearInterval(_dashboardRefreshInterval)
  _dashboardRefreshInterval = setInterval(() => {
    if (state.activeTab === 'dashboard' && canPerformRefresh()) {
      renderDashboardContent()
    }
  }, DASHBOARD_REFRESH_INTERVAL)
}

function renderGlobalModal() {
  return `
      <!-- Global Modal Overlay -->
      <div id="modal-overlay" class="modal-overlay ${state.modal.isOpen ? 'open' : ''}">
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="modal-title" style="margin: 0;">${state.modal.title || 'Details'}</h3>
                <button class="modal-close" data-action="close-modal">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
            <div id="modal-body" class="modal-body">
                ${state.modal.content || ''}
            </div>
        </div>
      </div>
  `
}

async function populateAvatars() {
  try {
    console.log('[Avatars] Starting populateAvatars...');
    console.log('[Avatars] Welcome user:', state.welcomeUser);
    
    // Populate cooperative logo
    const coopContainer = document.getElementById('coop-logo-container');
    if (coopContainer && state.welcomeUser?.cooperativeId) {
      console.log('[Avatars] Fetching cooperative data for ID:', state.welcomeUser.cooperativeId);
      const coops = await getAllForCoop(state.welcomeUser.cooperativeId, 'cooperatives');
      console.log('[Avatars] Coops found:', coops);
      console.log('[Avatars] Coops full data (JSON):', JSON.stringify(coops, null, 2));
      const coop = coops[0];
      console.log('[Avatars] Coop logo_path:', coop?.logo_path);
      console.log('[Avatars] Coop logo_path type:', typeof coop?.logo_path);
      
      if (coop?.logo_path) {
        console.log('[Avatars] Displaying cooperative logo');
        coopContainer.innerHTML = `<img src="${coop.logo_path}" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="console.error('[Avatars] Coop logo failed to load', this.src)" />`;
      } else {
        console.log('[Avatars] Using cooperative initials:', getInitials(state.welcomeUser.cooperativeName));
        coopContainer.textContent = getInitials(state.welcomeUser.cooperativeName);
      }
    }

    // Populate user avatar
    const userContainer = document.getElementById('user-avatar-container');
    if (userContainer && state.welcomeUser) {
      const displayName = state.welcomeUser.role === 'member' 
        ? state.welcomeUser.fullName 
        : state.welcomeUser.username;
      
      let imagePath = null;
      if (state.welcomeUser.role === 'member' && state.welcomeUser.memberId) {
        console.log('[Avatars] Fetching member data for ID:', state.welcomeUser.memberId);
        const member = await loadDoc('members', state.welcomeUser.memberId, state.welcomeUser.cooperativeId);
        console.log('[Avatars] Member data:', member);
        console.log('[Avatars] Member image_path:', member?.image_path);
        imagePath = member?.image_path;
      }

      if (imagePath) {
        console.log('[Avatars] Displaying user avatar');
        userContainer.innerHTML = `<img src="${imagePath}" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="console.error('[Avatars] User avatar failed to load', this.src)" />`;
      } else {
        console.log('[Avatars] Using user initials:', getInitials(displayName));
        userContainer.textContent = getInitials(displayName);
      }
    }
  } catch (err) {
    console.error('[Avatars] Failed to populate avatars:', err);
  }
}

function updateNavSelection() {
  const currentHash = window.location.hash.substring(1)
  
  // Desktop Sidebar Nav Items
  document.querySelectorAll('.nav-item').forEach((btn) => {
    const btnTab = btn.dataset.tab
    if (currentHash === btnTab || (currentHash.startsWith(btnTab + '/') && btnTab !== '')) {
      btn.classList.add('active')
    } else if (btnTab === 'ledger/summary' && (currentHash === 'ledger' || currentHash === 'ledger/')) {
      btn.classList.add('active')
    } else {
      btn.classList.remove('active')
    }
  })

  // Mobile Bottom Nav Items
  document.querySelectorAll('.bottom-nav-item').forEach((btn) => {
    const btnTab = btn.dataset.tab
    if (currentHash === btnTab || (currentHash.startsWith(btnTab + '/') && btnTab !== '')) {
      btn.classList.add('active')
    } else if (btnTab === 'ledger/summary' && (currentHash === 'ledger' || currentHash === 'ledger/')) {
      btn.classList.add('active')
    } else {
      btn.classList.remove('active')
    }
  })
}

function isSubscriptionActive() {
  const u = state.welcomeUser
  if (!u) return false
  if (String(u.username || '').toLowerCase() === 'admin') return true
  const status = u.subscriptionStatus
  if (status === undefined || status === null || status === '') return true
  if (status === 0 || status === '0') return false
  if (u.subscriptionExpiry && u.subscriptionExpiry < new Date().toISOString()) return false
  return true
}

const INACTIVE_MSG = 'Your account subscription is inactive. Please contact the administrator.'

function networkIndicatorClass() {
  if (!state.isOnline) return 'offline';
  if (state.isSyncing) return 'syncing';
  return 'online';
}
function networkIndicatorLabel() {
  if (!state.isOnline) return 'Offline';
  if (state.isSyncing) return 'Syncing';
  return 'Online';
}
function networkIndicatorIcon() {
  if (!state.isOnline) {
    return '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  }
  if (state.isSyncing) {
    return '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin-icon"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>';
  }
  return '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>';
}

function _updateNetworkIndicator() {
  const indicators = document.querySelectorAll('.network-indicator');
  indicators.forEach(el => {
    const cls = !state.isOnline ? 'offline' : state.isSyncing ? 'syncing' : 'online'
    const label = !state.isOnline ? 'Offline' : state.isSyncing ? 'Syncing' : 'Online'
    el.className = `network-indicator ${cls}`
    el.setAttribute('aria-label', label)
    const textSpan = el.querySelector('span:last-child')
    if (textSpan) textSpan.textContent = label
    const iconSpan = el.querySelector('.indicator-icon')
    if (iconSpan) iconSpan.innerHTML = networkIndicatorIcon()
  })
}

function classifyLoginError(err) {
  const msg = (err && (err.message || err.toString() || '' )).toLowerCase()
  if (!msg) return { type: 'unknown', message: 'Unable to sign in. Please try again or contact your administrator if the problem persists.' }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout') || msg.includes('abort')) {
    if (msg.includes('timeout')) return { type: 'timeout', message: 'The server is not responding. Please check your connection and try again.' }
    return { type: 'network', message: 'A network error occurred. Please check your internet connection and try again.' }
  }
  if (msg.includes('database') || msg.includes('sqlite')) {
    return { type: 'database', message: 'Failed to access local data. Please close other instances and refresh the page.' }
  }
  if (msg.includes('sync') || msg.includes('server')) {
    return { type: 'server', message: 'The server is experiencing issues. Please try again later or contact your administrator.' }
  }
  if (msg.includes('subscription') || msg.includes('inactive')) {
    return { type: 'subscription', message: 'Your account is inactive. Please contact your administrator.' }
  }
  if (msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('invalid username') || msg.includes('invalid password')) {
    return { type: 'auth', message: 'Invalid username or password.' }
  }
  return { type: 'unknown', message: 'An unexpected error occurred during login. Please try again or contact your administrator if the problem persists.' }
}

async function renderDashboardContent() {
  const container = document.getElementById('dashboard-main-content')
  if (!container) return

  const isAdmin = hasPermission(state.welcomeUser.permissions, 'admin') || String(state.welcomeUser.username || '').toLowerCase() === 'admin'
  const subActive = isSubscriptionActive()

  if (!subActive && !isAdmin) {
    if (state.activeTab !== 'dashboard' && state.activeTab !== 'settings') {
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4rem 2rem; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🔒</div>
          <h3 style="margin: 0 0 0.5rem 0;">Access Restricted</h3>
          <p style="color: var(--text-muted); max-width: 400px; margin: 0;">${INACTIVE_MSG}</p>
        </div>
      `
      return
    }
  }

  // Preserve actual role — don't override to 'admin' for staff users (breaks RBAC in screens)
  // isAdmin flag is passed separately so screens can check it properly
  // Create a deep copy to prevent accidental modifications to shared state
  const displayUser = JSON.parse(JSON.stringify({
    ...state.welcomeUser,
    memberId: state.welcomeUser.memberId,
    memberName: state.welcomeUser.role === 'member' ? state.welcomeUser.fullName : null,
    isAdmin,
    subscriptionStatus: state.welcomeUser.subscriptionStatus,
    subscriptionExpiry: state.welcomeUser.subscriptionExpiry,
  }))

  // Pass sub-route info (deep copy to prevent shared references)
  displayUser.routeParts = JSON.parse(JSON.stringify(state.routeParts || []))

  const isMemberRole = state.welcomeUser.role === 'member'

  // Members cannot access the Members tab — redirect to payments
  if (isMemberRole && state.activeTab === 'members') {
    state.activeTab = 'payments'
    window.location.hash = 'payments'
    return
  }

  // Redirect legacy tabs to unified payments
  if (state.activeTab === 'history' || state.activeTab === 'log') {
    state.activeTab = 'payments'
    window.location.hash = 'payments'
    return
  }

  if (state.activeTab === 'members') {
    await renderMembers(container, displayUser)
  } else if (state.activeTab === 'dashboard') {
    await renderAccountBalance(container, displayUser)
  } else if (state.activeTab === 'payments') {
    await renderUnifiedPayment(container, displayUser, state.editingRemittance)
  } else if (state.activeTab === 'ledger') {
    await renderMemberLedger(container, displayUser)
  } else if (state.activeTab === 'reports') {
    const displayUserReports = JSON.parse(JSON.stringify(displayUser));
    displayUserReports.reports = state.reports;
    displayUserReports.onReportsStateChange = (newReportsState) => {
      state.reports = { ...state.reports, ...newReportsState };
      // We don't necessarily need to full re-render here if the screen handles its own updates
      // but it's good for persistence
    };
    await renderReports(container, displayUserReports)
  } else if (state.activeTab === 'reconciliation') {
    await renderReconciliation(state, container)
  } else if (state.activeTab === 'settings') {
    await renderSettings(container, displayUser)
  }

  // Keep mobile page title in sync
  const mobileTitleEl = document.getElementById('mobile-page-title');
  if (mobileTitleEl) {
    if (state.activeTab === 'dashboard') {
      const isAdmin = String(state.welcomeUser.role).toLowerCase() === 'admin' || hasPermission(state.welcomeUser.permissions, 'admin_view');
      const isMember = state.welcomeUser.role === 'member';
      let subtitleText = '';
      if (isMember) {
        subtitleText = `Welcome back, ${state.welcomeUser.fullName || 'Member'}`;
      } else {
        subtitleText = `Viewing ${isAdmin ? 'Global' : 'Accessible'} cooperative data.`;
      }
      mobileTitleEl.innerHTML = `
        <div style="display: flex; flex-direction: column; text-align: left; line-height: 1.2;">
          <span style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary);">Dashboard</span>
          <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">${subtitleText}</span>
        </div>
      `;
    } else if (state.activeTab === 'members') {
      mobileTitleEl.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; width: 100%; padding-right: 0.5rem;">
          <span style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); white-space: nowrap;">Members</span>
          <div class="search-input-wrap" style="position: relative; flex: 1; max-width: 140px;">
            <input type="text" id="member-search-input-mobile" placeholder="Search..." style="width: 100%; padding: 0.35rem 0.5rem 0.35rem 1.65rem; border-radius: var(--radius-md); border: 1px solid var(--border-medium); font-size: 0.75rem; background: var(--bg-input); color: var(--text-primary); outline: none;">
            <svg class="search-icon" width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="position: absolute; left: 0.5rem; top: 50%; transform: translateY(-50%); color: var(--text-muted);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </div>
        </div>
      `;
      setTimeout(() => {
        const searchInputMobile = document.getElementById('member-search-input-mobile');
        if (searchInputMobile) {
          const desktopInput = document.getElementById('member-search-input');
          if (desktopInput) {
            searchInputMobile.value = desktopInput.value;
          }
          searchInputMobile.addEventListener('input', (e) => {
            window.dispatchEvent(new CustomEvent('mobile-member-search', {
              detail: { value: e.target.value }
            }));
          });
        }
      }, 50);
    } else if (state.activeTab === 'ledger') {
      // Ledger: show member search in mobile top bar
      const isLedgerAdmin = state.welcomeUser.role !== 'member';
      const currentLedgerMemberName = window.__ledgerFilters
        ? (window.__ledgerFilters.memberId === 'All' ? '' : (window.__ledgerFilters.memberName || ''))
        : '';
      mobileTitleEl.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; width: 100%; padding-right: 0.5rem;">
          <span style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary); white-space: nowrap;">Ledger</span>
          ${isLedgerAdmin ? `
          <div style="position: relative; flex: 1; max-width: 150px;">
            <input type="text" id="ledger-member-search-mobile"
              placeholder="All Members..."
              value="${currentLedgerMemberName}"
              autocomplete="off"
              style="width: 100%; padding: 0.35rem 0.5rem 0.35rem 1.65rem; border-radius: var(--radius-md); border: 1px solid var(--border-medium); font-size: 0.75rem; background: var(--bg-input); color: var(--text-primary); outline: none; box-sizing: border-box;">
            <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="position: absolute; left: 0.5rem; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
            <div id="ledger-member-dropdown-mobile" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: var(--radius-sm); box-shadow: var(--shadow-lg); z-index: 9999; max-height: 220px; overflow-y: auto; margin-top: 2px;"></div>
          </div>
          ` : ''}
        </div>
      `;
      if (isLedgerAdmin) {
        setTimeout(() => {
          const mobileSearchInput = document.getElementById('ledger-member-search-mobile');
          const mobileDropdown = document.getElementById('ledger-member-dropdown-mobile');
          if (!mobileSearchInput || !mobileDropdown) return;

          // Dispatch search events to MemberLedger which listens for them
          mobileSearchInput.addEventListener('input', (e) => {
            window.dispatchEvent(new CustomEvent('mobile-ledger-member-search', {
              detail: { query: e.target.value }
            }));
            mobileDropdown.style.display = 'block';
          });
          mobileSearchInput.addEventListener('focus', () => {
            window.dispatchEvent(new CustomEvent('mobile-ledger-member-search', {
              detail: { query: mobileSearchInput.value }
            }));
            mobileDropdown.style.display = 'block';
          });

          // Close dropdown when clicking outside
          document.addEventListener('click', (e) => {
            if (!e.target.closest('#ledger-member-search-mobile') && !e.target.closest('#ledger-member-dropdown-mobile')) {
              if (mobileDropdown) mobileDropdown.style.display = 'none';
            }
          });
        }, 80);
      }
    } else {
      const activeTabTitles = {
        payments: 'Remittance',
        reports: 'Reports',
        reconciliation: 'Reconciliation',
        settings: 'Settings'
      };
      mobileTitleEl.textContent = activeTabTitles[state.activeTab] || 'CoopLog';
    }
  }

  // Update mobile mask toggle button state and visibility
  const maskBtnMobile = document.getElementById('mask-toggle-mobile-btn');
  if (maskBtnMobile) {
    if (state.activeTab === 'dashboard' || state.activeTab === 'ledger') {
      maskBtnMobile.style.display = 'inline-flex';
      const maskBalances = localStorage.getItem('cooplog-mask-balances') === 'true';
      maskBtnMobile.innerHTML = maskBalances ? `
        <!-- Visible eye icon -->
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      ` : `
        <!-- Hidden eye icon -->
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      `;
    } else {
      maskBtnMobile.style.display = 'none';
    }
  }

  // Update context-aware mobile FAB
  updateMobileFab();
}

// Global nav handler
app.addEventListener('click', (e) => {
  const navItem = e.target.closest('[data-tab]')
  if (navItem && (e.target.closest('.sidebar-nav') || e.target.closest('.mobile-bottom-nav') || navItem.dataset.action === 'nav-tab' || navItem.closest('[data-action="nav-tab"]'))) {
    const tabToGo = navItem.dataset.tab || navItem.closest('[data-tab]')?.dataset.tab;
    if (tabToGo) {
      window.location.hash = tabToGo;
    }
  }
  
  // Issue 2: Make date pickers open when clicking anywhere on the input
  const dateInput = e.target.closest('input[type="date"]')
  if (dateInput && typeof dateInput.showPicker === 'function') {
    e.preventDefault()
    dateInput.showPicker()
  }
})

// Global modal helper
window.showTransactionModal = async (remittance) => {
  const overlay = document.getElementById('modal-overlay')
  const title = document.getElementById('modal-title')
  const body = document.getElementById('modal-body')

  if (!overlay || !body) return

  // Clear previous content
  body.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">Loading details...</div>'
  overlay.classList.add('open')
  document.body.style.overflow = 'hidden'

  try {
    // Use static imports already available at the top or via dataService
    const { fetchEnterprises, fetchAllMembers } = await import('./services/dataService.js')
    const fmt = await import('./utils/formatters.js')

    // Fetch all members (full list) to ensure guarantor names can be resolved even for non-admins
    const allMembers = await fetchAllMembers(state.welcomeUser.cooperativeId, state.welcomeUser.username, true)

    title.innerText = `#${String(remittance.r_id || '').padStart(5, '0')} — ${fmt.formatDate(remittance.remittance_date)}`
    const enterprisesArray = await fetchEnterprises(state.welcomeUser.cooperativeId, true)
    const enterpriseNames = {}
    enterprisesArray.forEach(e => { enterpriseNames[e.id] = e.account_name })
    
    const details = remittance.details || []

    let balanceBefore = 0;
    let balanceAfter = 0;
    let entName = 'Savings Account';
    const detail = details[0] || {};
    const targetEntId = detail.enterprise_id || detail.item;
    const targetEnt = targetEntId ? enterprisesArray.find(e => e.id === targetEntId) : null;
    
    const isSavingsRequest = remittance.transaction_type === 'Savings Withdrawal' || 
                             remittance.isWithdrawalRequest === true ||
                             (targetEnt && (targetEnt.account_type || '').toLowerCase() === 'savings');

    if (isSavingsRequest && remittance.member_id) {
      const { buildAccountBalance } = await import('./services/dataService.js');
      const limitRid = remittance.r_id !== undefined && remittance.r_id !== null ? remittance.r_id : null;
      const { accountBalance } = await buildAccountBalance(state.welcomeUser.cooperativeId, { memberId: remittance.member_id }, limitRid);
      const balObj = accountBalance.find(b => b.id === targetEntId);
      balanceBefore = balObj ? parseFloat(balObj.sum_of_amount || 0) : 0;
      balanceAfter = balanceBefore - Math.abs(parseFloat(remittance.amount || detail.amount || 0));
      entName = targetEnt ? targetEnt.account_name : (detail.notes || detail.auto_description || 'Savings Account');
    }

    let html = `
            <div style="margin-bottom: 1.5rem; padding: 1.25rem; background: linear-gradient(135deg, var(--bg-main) 0%, var(--bg-secondary) 100%); border-radius: 1rem; border: 1px solid var(--border-medium);">
                <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Bank / Method</div>
                <div style="font-size: 1.125rem; font-weight: 700; color: var(--text-primary); margin-top: 0.25rem;">${escapeHtml(remittance.bank_name || 'Direct Deposit')}</div>
                <div style="display: flex; justify-content: space-between; margin-top: 1.25rem; align-items: flex-end;">
                    <div>
                         <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Total Amount</div>
                         <div style="font-size: 1.75rem; font-weight: 800; color: ${remittance.amount < 0 ? 'var(--danger)' : 'var(--accent-primary)'}; line-height: 1;">${fmt.formatCurrency(remittance.amount)}</div>
                    </div>
                    <span class="status-badge status-${escapeHtml(remittance.status)}">${escapeHtml(remittance.status)}</span>
                </div>
            </div>
        `

    if (isSavingsRequest) {
      html += `
        <div style="margin-bottom: 1.5rem; padding: 1rem; background: var(--bg-card); border: 1px solid var(--border-light); border-radius: 0.75rem;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; font-size: 0.85rem;">
            <div>
              <span style="color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; font-weight: 700;">Enterprise</span>
              <div style="font-weight: 600; color: var(--text-primary); margin-top: 0.15rem;">${escapeHtml(entName)}</div>
            </div>
            <div>
              <span style="color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; font-weight: 700;">Withdrawal Amount</span>
              <div style="font-weight: 700; color: var(--danger); margin-top: 0.15rem;">-${fmt.formatCurrency(Math.abs(remittance.amount))}</div>
            </div>
            <div>
              <span style="color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; font-weight: 700;">Balance Before</span>
              <div style="font-weight: 600; color: var(--text-primary); margin-top: 0.15rem;">${fmt.formatCurrency(balanceBefore)}</div>
            </div>
            <div>
              <span style="color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; font-weight: 700;">Balance After</span>
              <div style="font-weight: 700; color: ${balanceAfter < 0 ? 'var(--danger)' : 'var(--success)'}; margin-top: 0.15rem;">${fmt.formatCurrency(balanceAfter)}</div>
            </div>
          </div>
        </div>
      `;
    }

    html += `
            <div style="font-weight: 700; font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.75rem; letter-spacing: 0.05em; padding-left: 0.25rem;">BREAKDOWN</div>
            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        `

    if (details.length === 0) {
      html += `<p style="color: #94a3b8; font-style: italic; text-align: center; padding: 1rem;">No specific item breakdown found.</p>`
    } else {
      details.forEach(d => {
        const name = enterpriseNames[d.enterprise_id] || d.enterprise_name || d.item || 'General Contribution'
        const amt = parseFloat(d.amount || 0)
        html += `
                <div class="detail-row" style="background: var(--bg-card); padding: 1rem; border-radius: 0.85rem; border: 1px solid var(--border-light); transition: all 0.2s;">
                    <span class="detail-name" style="font-weight: 600; color: var(--text-secondary);">${escapeHtml(name)}</span>
                    <span class="detail-amount ${amt < 0 ? 'text-red' : 'text-green'}" style="font-weight: 700; font-size: 1.05rem;">${fmt.formatCurrency(amt)}</span>
                </div>
            `
      })
    }

    // --- Render Loan Section (Nested Data) ---
    const loans = remittance.loans || []
    if (loans.length > 0) {
      html += `
                <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px dashed var(--border-medium);">
                    <div style="font-weight: 700; font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase;">Loan Details</div>
                    ${loans.map(loan => {
        const guarantors = loan.guarantors || []
        return `
                            <div style="background: var(--accent-soft); padding: 1.25rem; border-radius: 1rem; border: 1px solid var(--border-light); margin-bottom: 1rem;">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                                    <div>
                                        <div style="font-size: 0.7rem; color: var(--accent-primary); font-weight: 700; text-transform: uppercase;">Principal</div>
                                        <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary);">${fmt.formatCurrency(loan.principal_amount || loan.principalAmount)}</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 0.7rem; color: var(--accent-primary); font-weight: 700; text-transform: uppercase;">Duration</div>
                                        <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary);">${loan.duration_months || loan.durationMonths || 0} Months</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 0.7rem; color: var(--accent-primary); font-weight: 700; text-transform: uppercase;">Issue Date</div>
                                        <div style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary);">${fmt.formatDate(loan.issued_date || loan.issueDate)}</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 0.7rem; color: var(--accent-primary); font-weight: 700; text-transform: uppercase;">Due Date</div>
                                        <div style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary);">${fmt.formatDate(loan.due_date || loan.dueDate)}</div>
                                    </div>
                                </div>
                                
                                ${loan.notes ? `
                                    <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border-light);">
                                        <div style="font-size: 0.7rem; color: var(--accent-primary); font-weight: 700; text-transform: uppercase;">Notes</div>
                                        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">${escapeHtml(loan.notes)}</div>
                                    </div>
                                ` : ''}

                                ${guarantors.length > 0 ? `
                                    <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border-light);">
                                        <div style="font-size: 0.7rem; color: var(--accent-primary); font-weight: 700; text-transform: uppercase; margin-bottom: 0.5rem;">Guarantors</div>
                                        <div style="display: flex; flex-direction: column; gap: 0.4rem;">
                                            ${guarantors.map(g => {
          const gMember = allMembers.find(m => m.id === g.member_id)
          return `
                                                    <div style="display: flex; justify-content: space-between; font-size: 0.8rem; background: var(--bg-main); padding: 0.4rem 0.6rem; border-radius: 0.4rem; align-items: center;">
                                                         <div>
                                                            <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(gMember?.name || 'Unknown')}</div>
                                                            <div style="font-size: 0.7rem; color: ${g.guarantor_approval === 1 ? 'var(--success)' : 'var(--danger)'}; font-weight: 700;">
                                                              ${g.guarantor_approval === 1 ? 'Approved' : 'Pending Approval'}
                                                            </div>
                                                         </div>
                                                         <span style="font-weight: 700; color: var(--text-primary);">${fmt.formatCurrency(g.guarantee_amount || g.amount || 0)}</span>
                                                     </div>
                                                 `
        }).join('')}
                                         </div>
                                     </div>
                                 ` : ''}
                             </div>
                          `
      }).join('')}
                </div>
            `
    }

    // --- Approval Section ---
    const isActualAdmin = hasPermission(state.welcomeUser.permissions, 'admin') || state.welcomeUser.username.toLowerCase() === 'admin';
    if (isActualAdmin && remittance.status === 'Pending') {
      const allGuarantorsApproved = (remittance.details || []).every(d => {
        if (!d.loan_info || !d.loan_info.guarantors) return true;
        return d.loan_info.guarantors.every(g => g.guarantor_approval === 1);
      });

      const hasBank = !!remittance.bank_name && remittance.bank_name !== '0' && remittance.bank_name !== '';
      const canApprove = isSavingsRequest ? true : (allGuarantorsApproved && hasBank);

      const { fetchBanks } = await import('./services/dataService.js');
      const banks = await fetchBanks(state.welcomeUser.cooperativeId);

      html += `
        <div style="margin-top: 2rem; padding: 1.5rem; background: var(--bg-main); border: 2px solid var(--border-medium); border-radius: 1rem;">
          <h4 style="margin: 0 0 1rem 0; color: var(--text-primary);">Approval Workflow</h4>
          
          ${isSavingsRequest ? `
            <div class="field" style="margin-bottom: 1rem;">
              <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Disbursement Date *</span>
              <input type="date" id="approval-date-input" value="${new Date().toISOString().split('T')[0]}" style="width: 100%; margin-top: 0.5rem; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border-medium); background: var(--bg-input); color: var(--text-primary);" required />
            </div>
            <div class="field" style="margin-bottom: 1rem;">
              <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Select Bank for Disbursement *</span>
              <select id="approval-bank-select" style="width: 100%; margin-top: 0.5rem; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border-medium); background: var(--bg-input); color: var(--text-primary);" required>
                <option value="">-- Choose Bank --</option>
                ${banks.map(b => `<option value="${escapeAttribute(b.bank_name)}" ${remittance.bank_name === b.bank_name ? 'selected' : ''}>${escapeHtml(b.bank_name)}</option>`).join('')}
              </select>
            </div>
          ` : `
            ${!hasBank ? `
              <div class="field" style="margin-bottom: 1rem;">
                <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Select Bank for Disbursement</span>
                <select id="approval-bank-select" style="width: 100%; margin-top: 0.5rem; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border-medium); background: var(--bg-input); color: var(--text-primary);">
                  <option value="">-- Choose Bank --</option>
                  ${banks.map(b => `<option value="${escapeAttribute(b.bank_name)}">${escapeHtml(b.bank_name)}</option>`).join('')}
                </select>
              </div>
            ` : ''}
          `}

          ${!isSavingsRequest ? `
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem;">
                <span style="color: ${allGuarantorsApproved ? '#16a34a' : '#ef4444'}; font-weight: 700;">${allGuarantorsApproved ? '✓' : '✗'}</span>
                <span>All Guarantors Approved</span>
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem;">
                <span style="color: ${hasBank ? '#16a34a' : '#ef4444'}; font-weight: 700;">${hasBank ? '✓' : '✗'}</span>
                <span>Bank Selected</span>
              </div>
            </div>
          ` : ''}

          <div style="display: flex; gap: 0.75rem; margin-top: 1.5rem;">
            <button id="approve-transaction-btn" class="primary-button" ${!canApprove ? 'disabled' : ''} style="flex: 1; height: 3.5rem; font-size: 1.1rem;">
              Approve &amp; Disburse
            </button>
            <button id="decline-transaction-btn-modal" class="secondary-button" style="flex: 0 0 auto; height: 3.5rem; font-size: 1rem; background: var(--danger-bg, #fee2e2); color: var(--danger, #dc2626); border: 1px solid var(--danger, #dc2626);">
              Decline
            </button>
          </div>
          ${(!isSavingsRequest && !canApprove) ? `<p style="font-size: 0.75rem; color: #ef4444; text-align: center; margin-top: 0.5rem;">Please ensure all conditions are met before approval.</p>` : ''}
        </div>
      `;
    }

    html += `</div>`
    body.innerHTML = html
    body.querySelectorAll('input[type="date"]').forEach(wrapDateInput);

    // Attach Approval Listeners
    if (isActualAdmin && remittance.status === 'Pending') {
      const approveBtn = body.querySelector('#approve-transaction-btn');
      const bankSelect = body.querySelector('#approval-bank-select');

      bankSelect?.addEventListener('change', async (e) => {
        if (isSavingsRequest) return;
        const newBank = e.target.value;
        if (newBank) {
          // Re-render modal with new bank (locally for now, we'll save on approve)
          const updatedRemittance = { ...remittance, bank_name: newBank };
          window.showTransactionModal(updatedRemittance);
        }
      });

      approveBtn?.addEventListener('click', async () => {
        try {
          // Determine bank name and date
          const bankSelectEl = body.querySelector('#approval-bank-select');
          const dateInputEl = body.querySelector('#approval-date-input');

          const resolvedBankName = (bankSelectEl && bankSelectEl.value) ? bankSelectEl.value : remittance.bank_name;
          const resolvedDate = (dateInputEl && dateInputEl.value) ? dateInputEl.value : remittance.remittance_date;

          if (isSavingsRequest) {
            if (!resolvedBankName) {
              showToast('Please select a bank for disbursement.', 'warning');
              return;
            }
            if (!resolvedDate) {
              showToast('Please select an approval date.', 'warning');
              return;
            }
          }

          approveBtn.disabled = true;
          approveBtn.innerText = 'Processing...';

          const { approveRemittance } = await import('./services/dataService.js');
          await approveRemittance(remittance.id, state.welcomeUser.username, resolvedBankName, resolvedDate);
          showToast('Transaction approved and disbursed successfully!', 'success');
          overlay.classList.remove('open');
          document.body.style.overflow = '';

          // Refresh list if we are on Remittance History
          window.dispatchEvent(new CustomEvent('remittance-saved'));
        } catch (err) {
          showToast('Approval failed: ' + err.message, 'error');
          approveBtn.disabled = false;
          approveBtn.innerText = 'Approve & Disburse';
        }
      });

      // --- Decline button (modal) ---
      const declineBtnModal = body.querySelector('#decline-transaction-btn-modal');
      declineBtnModal?.addEventListener('click', async () => {
        const reason = prompt('Enter decline reason (optional):');
        if (reason === null) return; // cancelled
        if (!confirm('Are you sure you want to decline this remittance? This cannot be undone.')) return;
        try {
          declineBtnModal.disabled = true;
          declineBtnModal.innerText = 'Declining...';
          const { declineRemittance } = await import('./services/dataService.js');
          await declineRemittance(remittance.id, state.welcomeUser.username, reason.trim());
          showToast('Remittance declined.', 'info');
          overlay.classList.remove('open');
          document.body.style.overflow = '';
          window.dispatchEvent(new CustomEvent('remittance-saved'));
        } catch (err) {
          showToast('Decline failed: ' + err.message, 'error');
          declineBtnModal.disabled = false;
          declineBtnModal.innerText = 'Decline';
        }
      });
    }
  } catch (err) {
    body.innerHTML = `<div class="alert">Error loading details: ${err.message}</div>`
  }
}

export function closeModal() {
  // If no state-managed modal is active but the overlay is open
  // (e.g., transaction details opened via showTransactionModal),
  // close it directly without a full re-render to preserve scroll position
  if (!state.modal.isOpen && !state.modal.type) {
    const overlay = document.getElementById('modal-overlay')
    if (overlay && overlay.classList.contains('open')) {
      overlay.classList.remove('open')
      document.body.style.overflow = ''
      return
    }
  }
  state.modal.isOpen = false
  state.modal.type = null
  render()
}

function renderAlert() {
  if (!state.errorMessage) {
    return ''
  }

  return `<div class="alert">${escapeHtml(state.errorMessage)}</div>`
}

async function handleNext() {
  if (state.isSubmitting) {
    return
  }

  if (state.stage === 1) {
    await handleUsernameStage()
    return
  }

  if (state.stage === 2) {
    await handleCooperativeStage()
    return
  }

  await handlePasswordStage()
}

function handleBack() {
  if (state.stage === 3) {
    state.stage = 2
    state.password = ''
  } else if (state.stage === 2) {
    state.stage = 1
    state.selectedCooperativeId = ''
    state.cooperatives = []
    state.coopSearchQuery = ''
    state.isGoogleLoginFlow = false
  }

  state.errorMessage = ''
  render()
}

async function handleGoogleLogin() {
  if (state.isSubmitting) return;

  try {
    state.isSubmitting = true;
    state.errorMessage = '';
    render();

    const { getFirebaseAuth, signInWithPopup } = await import('./firebase.js');
    const { auth, googleProvider } = getFirebaseAuth();
    
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    if (!user.email) {
      throw new Error('No email associated with this Google account.');
    }

    const { discoverLoginCooperativesByEmail, validateGoogleLogin } = await import('./services/authService.js');
    const cooperatives = await discoverLoginCooperativesByEmail(user.email);

    if (cooperatives.length === 0) {
      throw new Error('No cooperative account found for this email.');
    }

    if (cooperatives.length === 1) {
      const session = await validateGoogleLogin(user.email, cooperatives[0].id);
      if (session) {
        state.welcomeUser = session;
        await saveSession(session);
        state.isSubmitting = false;
        render();
      } else {
        throw new Error('Login validation failed.');
      }
    } else {
      state.cooperatives = cooperatives;
      state.username = user.email;
      state.selectedCooperativeId = '';
      state.isGoogleLoginFlow = true; 
      state.stage = 2;
      state.isSubmitting = false;
      render();
    }
  } catch (error) {
    console.error('Google Auth Error:', error);
    state.errorMessage = error.message || 'Google Sign-In failed.';
    state.isSubmitting = false;
    render();
  }
}

async function handleUsernameStage() {
  state.isGoogleLoginFlow = false;
  const username = state.username.trim()
  if (!username) {
    state.errorMessage = 'Please enter username.'
    render()
    return
  }

  try {
    state.isSubmitting = true
    state.errorMessage = ''
    render()

    let cooperatives = []
    let onlineFailed = false

    // Try online discovery first (with 10s timeout)
    try {
      const { discoverLoginCooperatives } = await import('./services/authService.js')
      cooperatives = await Promise.race([
        discoverLoginCooperatives(username),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ]);
    } catch (onlineErr) {
      onlineFailed = true
      console.warn('[Login] Online discovery failed, trying offline...', onlineErr.message)
    }

    // If online returned nothing (offline or genuinely no match), try offline sessions
    if (cooperatives.length === 0) {
      try {
        const { discoverCooperativesOffline, hasLocalAuthData } = await import('./services/offlineAuthService.js')
        const offlineCoops = await discoverCooperativesOffline(username)
        if (offlineCoops.length > 0) {
          cooperatives = offlineCoops
          console.log('[Login] Found', offlineCoops.length, 'cooperative(s) from offline sessions')
        }

        // Determine the right error message when both online and offline returned nothing
        if (cooperatives.length === 0) {
          const localDbHasData = await hasLocalAuthData()
          if (!onlineFailed) {
            state.errorMessage = 'No matching user found. Please check your input.'
          } else if (!localDbHasData) {
            state.errorMessage = 'A network error occurred. Please check your internet connection and try again.'
          } else {
            state.errorMessage = 'Match not found offline. Please connect to the internet to login for the first time.'
          }
          return
        }
      } catch (offErr) {
        console.warn('[Login] Offline discovery also failed:', offErr.message)
      }
    }

    if (cooperatives.length === 0) {
      state.errorMessage = 'A network error occurred. Please check your internet connection and try again.'
      return
    }

    state.cooperatives = cooperatives
    if (cooperatives.length === 1) {
      state.selectedCooperativeId = cooperatives[0].id;
      state.stage = 3;
    } else {
      // Remember last selected cooperative for this username
      const lastCoop = localStorage.getItem('cooplog-last-coop-' + username.toLowerCase());
      state.selectedCooperativeId = lastCoop && cooperatives.some(c => c.id === lastCoop) ? lastCoop : '';
      state.stage = 2;
    }
  } catch (error) {
    state.errorMessage = error.message || 'Unable to continue.'
  } finally {
    state.isSubmitting = false
    render()
  }
}


async function handleCooperativeStage() {
  if (!state.selectedCooperativeId) {
    state.errorMessage = 'Please select a cooperative.'
    render()
    return
  }

  if (state.isGoogleLoginFlow) {
    state.isSubmitting = true;
    state.errorMessage = '';
    render();
    try {
      const { validateGoogleLogin } = await import('./services/authService.js');
      const session = await validateGoogleLogin(state.username, state.selectedCooperativeId);
      if (session) {
        state.welcomeUser = session;
        await saveSession(session);
        render();
      } else {
        throw new Error('Login validation failed.');
      }
    } catch (error) {
      state.errorMessage = error.message || 'Google Sign-In failed.';
      state.isSubmitting = false;
      render();
    }
    return;
  }

  state.stage = 3
  state.errorMessage = ''
  render()
}

async function handlePasswordStage() {
  const username = state.username.trim()
  const password = state.password
  const cooperativeId = state.selectedCooperativeId

  if (!password) {
    state.errorMessage = 'Please enter password.'
    render()
    return
  }

  if (!cooperativeId) {
    state.errorMessage = 'Please select a cooperative.'
    render()
    return
  }

  if (state.isSubmitting) {
    console.log('[Login] Already submitting, ignoring duplicate call.');
    return
  }

  const loginStartTs = Date.now();
  console.log(`[Login] ---------- LOGIN STARTED ---------- [${loginStartTs}]`);
  console.log(`[Login] Username: "${username}", CooperativeId: "${cooperativeId}", Online: ${navigator.onLine}`);

  try {
    state.isSubmitting = true
    state.errorMessage = ''
    render()

    // ── Online authentication (with 10s timeout) ──────────────────────
    let session = null
    let loginError = null
    try {
      if (navigator.onLine) {
        console.log(`[Login] [${Date.now()}] Sending authentication request...`);
        session = await Promise.race([
          validateLogin(username, password, cooperativeId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
        ]);
        console.log(`[Login] [${Date.now()}] Authentication response received. Success: ${!!session}`);
      } else {
        loginError = { type: 'network', message: 'No internet connection detected. Please check your network and try again.' }
        console.log(`[Login] [${Date.now()}] No internet connection.`);
      }
    } catch (onlineErr) {
      loginError = classifyLoginError(onlineErr)
      console.warn(`[Login] [${Date.now()}] Online authentication failed:`, onlineErr.message)
    }

    // ── Offline fallback ──────────────────────────────────────────────
    if (!session) {
      console.log(`[Login] [${Date.now()}] Attempting offline authentication...`);
      try {
        session = await attemptOfflineLogin(username, password, cooperativeId)
        if (session) loginError = null
        console.log(`[Login] [${Date.now()}] Offline authentication result: ${!!session}`);
      } catch (offlineErr) {
        if (!loginError) loginError = classifyLoginError(offlineErr)
        console.warn(`[Login] [${Date.now()}] Offline authentication failed:`, offlineErr.message)
      }
    }

    // ── No session — show specific error ──────────────────────────────
    if (!session) {
      const errorMsg = loginError?.message || 'Invalid username or password.'
      console.log(`[Login] [${Date.now()}] No session returned. Error: "${errorMsg}"`);
      state.errorMessage = errorMsg
      state.isSubmitting = false
      render()
      console.log(`[Login] -------- LOGIN FAILED: ${errorMsg} -------- [${Date.now()}]`);
      return
    }

    console.log(`[Login] [${Date.now()}] Session details:`, {
      forceChange: session?.forceChange,
      collection: session?.collection,
      username: session?.username,
      role: session?.role,
      memberId: session?.memberId,
      isOffline: !!session?.isOfflineSession
    });

    if (session && session.forceChange) {
      console.log(`[Login] [${Date.now()}] Force password change required.`);
      showForcePasswordChangeModal(session.userDoc, session.collection)
      return
    }

    // Save for future offline access (non-blocking - session already in sessionStorage)
    saveSession(session, password).catch(err => console.warn('[Login] Offline save failed:', err))

    const cooperativeName =
      state.cooperatives.find((coop) => coop.id === session.cooperativeId)?.name || session.cooperativeId

    // Reset session-specific state
    state.selectedMemberId = null
    state.members = []
    state.editingRemittance = null
    state.editingRemittanceId = null
    state.loanRequest = {
      step: 1,
      enterpriseId: '',
      amount: 0,
      duration: 1,
      guarantors: [],
      bankDetails: { bankName: '', accountName: '', accountNumber: '' }
    }

    // Build the welcomeUser immediately, subscription will be loaded in background
    state.welcomeUser = {
      memberId: session.memberId,
      username: session.username,
      fullName: session.fullName,
      role: session.role,
      permissions: session.permissions || '',
      enterprises: session.enterprises || '',
      enterprise_rights: session.enterprise_rights || session.enterprises || '',
      cooperativeId: session.cooperativeId,
      cooperativeName,
      subscriptionStatus: 1,
      subscriptionExpiry: null,
    }

    // Save to sessionStorage synchronously
    saveSession(state.welcomeUser)

    if (!isSubscriptionActive()) {
      state.activeTab = 'dashboard'
      window.location.hash = 'dashboard'
    }

    // Default to appropriate tab on successful login
    const defaultTab = getDefaultTab(state.welcomeUser)
    state.activeTab = defaultTab
    window.history.replaceState(null, '', `#${defaultTab}`)

    // Reset login stage
    state.stage = 1
    state.password = ''

    // Render the dashboard first (instant!), then async work in background
    state.isSubmitting = false
    render()
    console.log(`[Login] [${Date.now()}] Dashboard rendered. Login completed in ${Date.now() - loginStartTs}ms`);

    // ── Background: Load subscription info (non-blocking) ────────────
    (async () => {
      try {
        const userRecord = await queryOne(
          'SELECT subscriptionStatus, expiry_date FROM users WHERE id = ?',
          [session.userDoc?.id || '']
        );
        if (userRecord) {
          state.welcomeUser.subscriptionStatus = userRecord.subscriptionStatus;
          state.welcomeUser.subscriptionExpiry = userRecord.expiry_date;
          // Update sidebar subscription banner in-place (no full re-render)
          const existingBanner = document.querySelector('.sidebar [class*="warning"]');
          if (existingBanner && (userRecord.subscriptionStatus === 0 || userRecord.subscriptionStatus === '0')) {
            // Leave the existing inactive banner as-is
          } else if (existingBanner) {
            // Remove banner if subscription is now active
            existingBanner.remove();
          } else if (!isSubscriptionActive() && String(state.welcomeUser.username || '').toLowerCase() !== 'admin') {
            // Add banner if missing
            const sidebar = document.querySelector('.sidebar');
            const header = sidebar?.querySelector('.sidebar-header');
            if (sidebar && header) {
              const banner = document.createElement('div');
              banner.style.cssText = 'margin: 0.75rem 1rem; padding: 0.75rem; background: var(--warning-bg, #fef3c7); color: var(--warning, #d97706); border: 1px solid var(--warning, #d97706); border-radius: 0.5rem; font-size: 0.7rem; font-weight: 600; text-align: center; line-height: 1.4;';
              banner.textContent = INACTIVE_MSG;
              header.insertAdjacentElement('afterend', banner);
            }
          }
        }
      } catch (e) {
        console.warn('[Login] Background subscription fetch failed (non-blocking):', e.message);
      }
    })();

    // ── Background sync (non-blocking) ────────────────────────────────
    if (navigator.onLine) {
      syncCooperativeData(
        session.cooperativeId,
        session.role,
        session.memberId,
        session.permissions,
        session.username,
        ''
      ).then(() => {
        console.log(`[Login] [${Date.now()}] Background sync completed.`);
        // No renderDashboardContent() call - background sync updates data silently
      }).catch(err => {
        console.warn(`[Login] [${Date.now()}] Background sync failed:`, err.message)
      }).finally(() => {
        initializeSyncService().catch(err => console.warn('[Sync] initializeSyncService failed:', err.message))
      })
    } else {
      initializeSyncService().catch(err => console.warn('[Sync] initializeSyncService failed:', err.message))
    }

    console.log(`[Login] -------- LOGIN COMPLETED SUCCESSFULLY -------- [${Date.now()}]`);

  } catch (error) {
    console.error(`[Login] [${Date.now()}] UNEXPECTED ERROR:`, error);
    state.errorMessage = error.message || 'An unexpected error occurred during login. Please try again or contact your administrator if the problem persists.'
    state.isSubmitting = false
    render()
  } finally {
    state.isSubmitting = false
  }
}


// Authentication and Cooperative Discovery migrated to services/authService.js


// validateLogin migrated to services/authService.js


// session functions moved to services/offlineAuthService.js




async function showForcePasswordChangeModal(userDoc, collectionName) {
  state.modal.title = "Secure Your Account";
  state.modal.type = "force-password";
  state.modal.data = { userDoc, collectionName };
  state.modal.isOpen = true;
  state.modal.content = `
        <div style="padding: 1rem 0;">
            <p style="color: #64748b; font-size: 0.9rem; margin-bottom: 1.5rem;">
                Your account is currently using a default or temporary password. For your security, please set a new strong password to continue.
            </p>
            
            <form id="force-pwd-form" style="display: flex; flex-direction: column; gap: 1.25rem;">
                <div class="field">
                    <span>New Password</span>
                    <div class="password-wrap" style="position: relative;">
                        <input type="password" id="new-pwd" placeholder="••••••••" required style="width: 100%;" />
                        <button type="button" class="ghost-button toggle-pwd-btn" style="position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); font-size: 0.7rem;">Show</button>
                    </div>
                </div>
                <div class="field">
                    <span>Confirm New Password</span>
                    <div class="password-wrap" style="position: relative;">
                        <input type="password" id="confirm-pwd" placeholder="••••••••" required style="width: 100%;" />
                        <button type="button" class="ghost-button toggle-pwd-btn" style="position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); font-size: 0.7rem;">Show</button>
                    </div>
                </div>

                <div id="pwd-requirements" style="background: var(--bg-secondary); padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-medium);">
                    <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.75rem; text-transform: uppercase;">Requirements</div>
                    <ul style="list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.8rem;">
                        <li id="req-length" style="color: var(--text-muted); display: flex; align-items: center; gap: 0.4rem;">○ Min 6 characters</li>
                        <li id="req-num" style="color: var(--text-muted); display: flex; align-items: center; gap: 0.4rem;">○ Include a number</li>
                        <li id="req-spec" style="color: var(--text-muted); display: flex; align-items: center; gap: 0.4rem;">○ Special character</li>
                        <li id="req-upper" style="color: var(--text-muted); display: flex; align-items: center; gap: 0.4rem;">○ Uppercase letter</li>
                        <li id="req-lower" style="color: var(--text-muted); display: flex; align-items: center; gap: 0.4rem;">○ Lowercase letter</li>
                        <li id="req-match" style="color: var(--text-muted); display: flex; align-items: center; gap: 0.4rem;">○ Passwords match</li>
                    </ul>
                </div>

                <button type="submit" id="submit-new-pwd" class="primary-button" style="width: 100%; margin-top: 1rem;" disabled>Update & Login</button>
            </form>
        </div>
    `;

  render();
}

function setupForcePwdListeners() {
  const body = document.getElementById('modal-body');
  if (!body) return;

  const userDoc = state.modal.data?.userDoc;
  const collectionName = state.modal.data?.collectionName;
  if (!userDoc) return;

  const newPwdInput = body.querySelector('#new-pwd');
  const confirmPwdInput = body.querySelector('#confirm-pwd');
  const submitBtn = body.querySelector('#submit-new-pwd');
  const form = body.querySelector('#force-pwd-form');

  const validate = () => {
    const val = newPwdInput.value;
    const confirm = confirmPwdInput.value;

    const checks = {
      length: val.length >= 6,
      num: /[0-9]/.test(val),
      spec: /[!@#$%^&*(),.?":{}|<>]/.test(val),
      upper: /[A-Z]/.test(val),
      lower: /[a-z]/.test(val),
      match: val.length > 0 && val === confirm
    };

    Object.keys(checks).forEach(id => {
      const el = body.querySelector(`#req-${id}`);
      if (!el) return;
      if (checks[id]) {
        el.style.color = '#10b981';
        el.innerText = '● ' + el.innerText.substring(2);
      } else {
        el.style.color = '#94a3b8';
        el.innerText = '○ ' + el.innerText.substring(2);
      }
    });

    submitBtn.disabled = !Object.values(checks).every(v => v === true);
  };

  newPwdInput?.addEventListener('input', validate);
  confirmPwdInput?.addEventListener('input', validate);

  body.querySelectorAll('.toggle-pwd-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      const type = input.type === 'password' ? 'text' : 'password';
      input.type = type;
      btn.innerText = type === 'password' ? 'Show' : 'Hide';
    });
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      submitBtn.disabled = true;
      submitBtn.innerText = "Updating...";

      const newPwd = newPwdInput.value;
      const hashed = await hashPassword(newPwd);
      console.log('[PasswordChange] Generated new hash:', {
        length: hashed.length,
        isHash: /^[a-f0-9]{64}$/i.test(hashed)
      });

      const minimalPayload = {
        password_hash: hashed,
        force_password_change: false,
        modified_at: new Date().toISOString(),
        modified_by: 'system-security'
      };

      // ── 1. Write directly to Firestore (immediate, bypasses sync queue)
      // This is critical: the sync queue is eventually-consistent; without this direct
      // write, a re-login while the queue is pending would re-fetch the old password
      // from Firestore and trigger the forceChange modal again.
      if (navigator.onLine) {
        try {
          const { getDb, doc: fsDoc, updateDoc } = await import('./firebase.js');
          const db = getDb();
          await updateDoc(fsDoc(db, collectionName, userDoc.id), minimalPayload);
          console.log('[PasswordChange] Firestore write successful');
        } catch (fsErr) {
          console.warn('[PasswordChange] Firestore direct write failed (will rely on sync queue):', fsErr.message);
        }
      }

      // ── 2. Update SQLite locally and enqueue for sync (offline resilience)
      const fullPayload = { ...userDoc, ...minimalPayload };
      const { updateMember, updateUser } = await import('./services/dataService.js');
      if (collectionName === 'members') {
        await updateMember(userDoc.id, fullPayload, 'system-security');
      } else {
        await updateUser(userDoc.id, fullPayload, 'system-security');
      }

      showToast("Password updated successfully! Welcome to your dashboard.", "success");

      // ── 3. Reset ALL modal and login state completely
      state.modal.isOpen = false;
      state.modal.type = null;
      state.modal.title = '';
      state.modal.content = '';
      state.modal.data = null;
      state.stage = 1;
      state.password = '';
      state.errorMessage = '';

      // ── 4. Build and save the authenticated session
      const role = collectionName === 'members' ? 'member' : (userDoc.role || 'user');
      const fullName = collectionName === 'members'
        ? `${userDoc.last_name || ''} ${userDoc.first_name || ''} ${userDoc.middle_name || ''}`.trim()
        : (userDoc.full_name || userDoc.username);

      const cooperativeName = state.cooperatives.find((coop) => coop.id === userDoc.cooperative_id)?.name || userDoc.cooperative_id;

      const welcomeUser = {
        memberId: collectionName === 'members' ? userDoc.id : null,
        username: userDoc.username || userDoc.mobile,
        fullName: fullName || userDoc.full_name || userDoc.username || userDoc.mobile || '',
        role,
        permissions: userDoc.permissions || '',
        enterprises: userDoc.enterprise_rights || userDoc.enterprises || '',
        cooperativeId: userDoc.cooperative_id,
        cooperativeName,
      };
      // Ensure no forceChange flag leaks into the session
      delete welcomeUser.forceChange;
      state.welcomeUser = welcomeUser;

      // Save session synchronously to sessionStorage first
      await saveSession(state.welcomeUser, newPwd);

      // ── 5. Navigate to dashboard
      state.activeTab = 'history';
      window.history.replaceState(null, '', '#history');

      // ── 6. Trigger background sync to push any remaining queue items
      setTimeout(async () => {
        try {
          await initializeSyncService();
          if (navigator.onLine) {
            await syncCooperativeData(
              state.welcomeUser.cooperativeId,
              state.welcomeUser.role,
              state.welcomeUser.memberId,
              state.welcomeUser.permissions,
              state.welcomeUser.username
            );
          }
        } catch (syncErr) {
          console.warn('[PasswordChange] Post-change sync error:', syncErr.message);
        }
      }, 300);

      render();
    } catch (err) {
      showToast("Failed to update password: " + err.message, "error");
      submitBtn.disabled = false;
      submitBtn.innerText = "Update & Login";
    }
  });
}

/**
 * --- Loan Request Flow ---
 */

async function showLoanRequestModal() {
  const isAdmin = hasPermission(state.welcomeUser.permissions, 'admin') ||
    hasPermission(state.welcomeUser.permissions, 'read_member') ||
    state.welcomeUser.username.toLowerCase() === 'admin';

  state.modal.isOpen = true;
  state.modal.title = "Withdrawal Request";
  state.modal.type = "withdrawal-request";

  state.loanRequest = {
    step: isAdmin ? 1 : 2, // Admins start at Step 1 (Member Select), Members start at Step 2 (Enterprise)
    memberId: state.welcomeUser.role === 'member' ? state.welcomeUser.memberId : '',
    memberName: state.welcomeUser.role === 'member' ? (state.welcomeUser.fullName || state.welcomeUser.username) : '',
    enterpriseId: '',
    amount: 0,
    duration: 1,
    guarantors: [],
    bankDetails: {
      bankName: '',
      accountName: '',
      accountNumber: ''
    }
  };

  await renderLoanRequestStep();
}



async function renderLoanRequestStep() {
  const { step } = state.loanRequest;
  const { fetchEnterprises, buildAccountBalance } = await import('./services/dataService.js');
  const enterprisesFull = await fetchEnterprises(state.welcomeUser.cooperativeId, true);
  
  // Get all enterprises, filter out compulsory due and penalty!
  const allEnterprises = enterprisesFull
    .filter(ent => !ent.compulsory_due && !ent.is_penalty)
    .map(ent => ({ 
      id: ent.id, 
      name: ent.account_name, 
      type: ent.account_type?.toLowerCase() || 'other' 
    }));

  // Determine if selected enterprise is savings (skip duration and guarantors)
  const selectedEnterprise = allEnterprises.find(e => e.id === state.loanRequest.enterpriseId);
  const isSavingsEnterprise = selectedEnterprise?.type === 'savings';
  
  // Get member's opening balance for selected enterprise if savings
  let maxAmount = null;
  if (isSavingsEnterprise && state.loanRequest.memberId) {
    const { accountBalance } = await buildAccountBalance(
      state.welcomeUser.cooperativeId, 
      { ...state.welcomeUser, memberId: state.loanRequest.memberId }
    );
    const entBalance = accountBalance.find(ab => ab.id === state.loanRequest.enterpriseId);
    maxAmount = entBalance ? Math.max(0, entBalance.sum_of_amount) : 0;
  }
  
  // Load member's existing bank details for step 6 (bank details)
  const { fetchMemberDoc } = await import('./services/dataService.js');
  if (state.loanRequest.memberId && 
      !state.loanRequest.bankDetails.bankName && 
      !state.loanRequest.bankDetails.accountName && 
      !state.loanRequest.bankDetails.accountNumber) {
    const memberDoc = await fetchMemberDoc(state.loanRequest.memberId);
    if (memberDoc) {
      state.loanRequest.bankDetails = {
        bankName: memberDoc.bank_name || '',
        accountName: memberDoc.account_name || '',
        accountNumber: memberDoc.account_number || ''
      };
    }
  }

  // Load all members specifically for this modal to avoid race conditions with RBAC-filtered state.members
  const { fetchAllMembers } = await import('./services/dataService.js');
  let content = '';
  let adjustedStep = step;
  if (isSavingsEnterprise && step > 3) {
    adjustedStep = step + 2; // Skip steps 4 (duration) and 5 (guarantors) for savings
  }

  const isAdmin = hasPermission(state.welcomeUser.permissions, 'admin') ||
    hasPermission(state.welcomeUser.permissions, 'read_member') ||
    state.welcomeUser.username.toLowerCase() === 'admin';

  if (adjustedStep === 1) {
    content = `
      <div style="padding: 1rem 0;">
        <h4 style="margin-top: 0;">Step 1: Select Member</h4>
        <p style="color: var(--text-muted); font-size: 0.9rem;">Who is requesting this withdrawal?</p>
        <div style="position: relative; margin-top: 1.5rem;">
          <input type="text" id="loan-member-search" placeholder="Search member by name or ID..." value="${escapeHtml(state.loanRequest.memberName || '')}" style="width: 100%; height: 2.75rem; padding: 0 0.75rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: var(--radius-sm);" autocomplete="off">
          <div id="loan-member-suggestions" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 0.5rem; box-shadow: var(--shadow-lg); z-index: 100; max-height: 200px; overflow-y: auto; margin-top: 0.25rem;"></div>
        </div>
        ${state.loanRequest.memberId ? `
          <div style="margin-top: 1rem; padding: 1rem; background: var(--bg-secondary); border-radius: 0.5rem; border: 1px solid var(--border-light);">
             <span style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Selected Member</span>
             <div style="font-weight: 700; color: var(--accent-primary); font-size: 1.1rem; margin-top: 0.25rem;">${escapeHtml(state.loanRequest.memberName)}</div>
          </div>
        ` : ''}
      </div>
    `;
  } else if (adjustedStep === 2) {
    content = `
      <div style="padding: 1rem 0;">
        <h4 style="margin-top: 0;">Step ${isAdmin ? '2' : '1'}: Select Enterprise</h4>
        <p style="color: var(--text-muted); font-size: 0.9rem;">Choose the enterprise for your withdrawal.</p>
        <div style="display: grid; gap: 0.75rem; margin-top: 1.5rem;">
          ${allEnterprises.map(ent => `
            <button class="ghost-button enterprise-option ${state.loanRequest.enterpriseId === ent.id ? 'active' : ''}" 
                    data-id="${ent.id}" 
                    style="text-align: left; padding: 1rem; border: 2px solid ${state.loanRequest.enterpriseId === ent.id ? 'var(--accent-primary)' : 'var(--border-medium)'}; justify-content: flex-start; height: auto;">
              <div style="font-weight: 700; color: var(--text-primary);">${escapeHtml(ent.name)}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">${ent.type}</div>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  } else if (adjustedStep === 3) {
    content = `
      <div style="padding: 1rem 0;">
        <h4 style="margin-top: 0;">Step ${isAdmin ? '3' : '2'}: Amount</h4>
        <p style="color: var(--text-muted); font-size: 0.9rem;">How much would you like to withdraw?</p>
        ${isSavingsEnterprise && maxAmount !== null ? `
          <div style="margin-top: 1rem; padding: 0.75rem; background: var(--bg-secondary); border-radius: 0.5rem; border: 1px solid var(--border-light);">
             <span style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Maximum Withdrawal</span>
             <div style="font-weight: 700; color: var(--accent-primary); font-size: 1.1rem; margin-top: 0.25rem;">₦${maxAmount.toLocaleString()}</div>
          </div>
        ` : ''}
        <div class="field" style="margin-top: 1.5rem;">
          <span>Amount (₦)</span>
          <input type="number" id="loan-amount-input" value="${state.loanRequest.amount || ''}" placeholder="0.00" ${isSavingsEnterprise && maxAmount !== null ? `max="${maxAmount}"` : ''} style="width: 100%; font-size: 1.25rem; font-weight: 700; padding: 0.75rem;" />
        </div>
      </div>
    `;
  } else if (adjustedStep === 4 && !isSavingsEnterprise) {
    content = `
      <div style="padding: 1rem 0;">
        <h4 style="margin-top: 0;">Step ${isAdmin ? '4' : '3'}: Duration</h4>
        <p style="color: var(--text-muted); font-size: 0.9rem;">How many months for repayment?</p>
        <div class="field" style="margin-top: 1.5rem;">
          <span>Duration (Months)</span>
          <input type="number" id="loan-duration-input" value="${state.loanRequest.duration || 1}" min="1" style="width: 100%; font-size: 1.25rem; font-weight: 700; padding: 0.75rem;" />
        </div>
      </div>
    `;
  } else if (adjustedStep === 5 && !isSavingsEnterprise) {
    content = `
      <div style="padding: 1rem 0; min-height: 400px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h4 style="margin: 0;">Step ${isAdmin ? '5' : '4'}: Guarantors</h4>
          <button type="button" id="add-guarantor-btn" class="ghost-button" style="color: var(--accent-primary); height: auto; padding: 0.5rem 1rem;">+ Add Guarantor</button>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.5rem;">Select members to guarantee your withdrawal.</p>
        
        <div id="guarantors-list" style="display: flex; flex-direction: column; gap: 0.85rem;">
           ${state.loanRequest.guarantors.map((g, gi) => `
                 <div class="guarantor-row" data-index="${gi}" data-id="${g.tempId || generateId()}" style="display: flex; flex-direction: column; gap: 0.5rem; background: var(--bg-card); padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-medium);">
                    <div style="display: grid; grid-template-columns: 1fr 120px auto; gap: 0.75rem; align-items: center;">
                       <div style="position: relative;">
                           <input type="text" class="guarantor-search" placeholder="Search guarantor name..." value="${escapeHtml(g.name || '')}" style="width: 100%; height: 2.75rem; padding: 0 0.75rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: var(--radius-sm);">
                           <div class="guarantor-suggestions" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 0.5rem; box-shadow: var(--shadow-lg); z-index: 100; max-height: 200px; overflow-y: auto; margin-top: 0.25rem;"></div>
                           <input type="hidden" class="guarantor-id" value="${g.member_id || ''}">
                       </div>
                       <input type="number" class="guarantor-amt" value="${g.amount || ''}" placeholder="Amount" style="height: 2.75rem; padding: 0 0.75rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: var(--radius-sm);">
                       <button type="button" class="remove-guarantor" style="color: var(--danger); border: 0; background: transparent; font-size: 1.5rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
                    </div>
                    <div class="g-info-row" style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-top: 0.25rem;">
                        <div class="g-selected-display" style="font-size: 0.75rem; color: var(--accent-primary); font-weight: 600;">
                            ${g.name ? `Selected: ${g.name}` : ''}
                        </div>
                        <div class="g-stats-display" style="display: flex; gap: 1rem; font-size: 0.7rem; color: var(--text-muted); font-weight: 500;">
                            <span class="g-active-count">Active: ${g.activeCount !== undefined ? g.activeCount : '-'}</span>
                            <span class="g-active-sum">Total: ${g.activeSum !== undefined ? '₦' + g.activeSum.toLocaleString() : '-'}</span>
                            <span class="g-overdue-count" style="color: ${g.overdueCount > 0 ? 'var(--danger)' : 'inherit'}">Overdue: ${g.overdueCount !== undefined ? g.overdueCount : '-'}</span>
                        </div>
                    </div>
                 </div>
              `).join('')}
           ${state.loanRequest.guarantors.length === 0 ? '<p id="empty-guarantors-msg" style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 2rem; border: 1px dashed var(--border-light); border-radius: 0.5rem;">No guarantors added yet. Click "+ Add Guarantor" to start.</p>' : ''}
        </div>
      </div>
    `;
  } else if (step === 6) {
    content = `
      <div style="padding: 1rem 0;">
        <h4 style="margin-top: 0;">Step ${isAdmin ? '6' : (isSavingsEnterprise ? '3' : '5')}: Bank Details</h4>
        <p style="color: var(--text-muted); font-size: 0.9rem;">Where should the funds be sent? (Optional)</p>
        <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 1.5rem;">
          <div class="field">
            <span>Bank Name</span>
            <input type="text" id="loan-bank-name" value="${escapeAttribute(state.loanRequest.bankDetails.bankName)}" placeholder="e.g. Zenith Bank" style="width: 100%;" />
          </div>
          <div class="field">
            <span>Account Name</span>
            <input type="text" id="loan-account-name" value="${escapeAttribute(state.loanRequest.bankDetails.accountName)}" placeholder="e.g. John Doe" style="width: 100%;" />
          </div>
          <div class="field">
            <span>Account Number</span>
            <input type="text" id="loan-account-number" value="${escapeAttribute(state.loanRequest.bankDetails.accountNumber)}" placeholder="0123456789" style="width: 100%;" />
          </div>
        </div>
      </div>
    `;
  } else if (step === 7) {
    const entName = allEnterprises.find(e => e.id === state.loanRequest.enterpriseId)?.name || 'Unknown';
    content = `
      <div style="padding: 1rem 0;">
        <h4 style="margin-top: 0;">Step ${isAdmin ? '7' : (isSavingsEnterprise ? '4' : '6')}: Confirmation</h4>
        <p style="color: var(--text-muted); font-size: 0.9rem;">Review your withdrawal request details.</p>
        <div style="background: var(--bg-secondary); padding: 1.25rem; border-radius: 0.75rem; margin-top: 1.5rem; display: flex; flex-direction: column; gap: 0.75rem;">
          ${isAdmin ? `
            <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
              <span style="color: var(--text-muted);">Member:</span>
              <span style="font-weight: 700;">${escapeHtml(state.loanRequest.memberName)}</span>
            </div>
          ` : ''}
          <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
            <span style="color: var(--text-muted);">Enterprise:</span>
            <span style="font-weight: 700;">${escapeHtml(entName)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
            <span style="color: var(--text-muted);">Amount:</span>
            <span style="font-weight: 700; color: var(--accent-primary);">₦${parseFloat(state.loanRequest.amount || 0).toLocaleString()}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
            <span style="color: var(--text-muted);">Duration:</span>
            <span style="font-weight: 700;">${state.loanRequest.duration} Months</span>
          </div>
          <div style="display: flex; flex-direction: column; font-size: 0.9rem; border-top: 1px solid var(--border-medium); padding-top: 0.5rem; margin-top: 0.25rem;">
            <span style="color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem;">Guarantors:</span>
            ${state.loanRequest.guarantors.map(g => `
              <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
                <span style="font-size: 0.85rem;">${escapeHtml(g.name)}</span>
                <span style="font-weight: 600;">₦${(g.amount || (Math.abs(state.loanRequest.amount) / (state.loanRequest.guarantors.length || 1))).toLocaleString()}</span>
              </div>
            `).join('')}
            ${state.loanRequest.guarantors.length === 0 ? '<span style="color: var(--text-muted); font-style: italic; font-size: 0.8rem;">None</span>' : ''}
          </div>
          ${state.loanRequest.bankDetails.bankName ? `
            <div style="border-top: 1px solid var(--border-medium); margin-top: 0.5rem; padding-top: 0.5rem;">
              <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem;">Bank Details</div>
              <div style="font-size: 0.85rem; font-weight: 600;">${escapeHtml(state.loanRequest.bankDetails.bankName)}</div>
              <div style="font-size: 0.85rem;">${escapeHtml(state.loanRequest.bankDetails.accountName)} - ${escapeHtml(state.loanRequest.bankDetails.accountNumber)}</div>
            </div>
          ` : ''}
        </div>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 1rem; line-height: 1.4;">
          After confirmation, you will be redirected to the Log Payment screen to finalize the transaction.
        </p>
      </div>
    `;
  }

  const isBackDisabled = (isAdmin && step === 1) || (!isAdmin && step === 2);
  let isNextDisabled = (step === 1 && !state.loanRequest.memberId) || (step === 2 && !state.loanRequest.enterpriseId);
  
  // Check amount validation for savings
  if (step === 3 && isSavingsEnterprise && maxAmount !== null) {
    isNextDisabled = isNextDisabled || !state.loanRequest.amount || state.loanRequest.amount <= 0 || state.loanRequest.amount > maxAmount;
  }

  content += `
    <div style="display: flex; justify-content: space-between; gap: 1rem; margin-top: 2rem;">
      <button class="secondary-button" id="loan-request-back" style="${isBackDisabled ? 'visibility: hidden;' : ''}">Back</button>
      <button class="primary-button" id="loan-request-next" ${isNextDisabled ? 'disabled' : ''}>
        ${step === 7 ? 'Confirm & Continue' : 'Next'}
      </button>
    </div>
  `;

  state.modal.content = content;
  render();
}

async function setupLoanRequestListeners() {
  const body = document.getElementById('modal-body');
  if (!body) return;

  const nextBtn = body.querySelector('#loan-request-next');
  const backBtn = body.querySelector('#loan-request-back');
  const step = state.loanRequest.step;



  // Step 1: Enterprise Selection
  body.querySelectorAll('.enterprise-option').forEach(btn => {
    btn.addEventListener('click', () => {
      state.loanRequest.enterpriseId = btn.dataset.id;
      state.loanRequest.step = 2; // Auto-advance to amount
      renderLoanRequestStep();
    });
  });

  // Step 2: Amount
  const amountInput = body.querySelector('#loan-amount-input');
  amountInput?.addEventListener('input', (e) => {
    state.loanRequest.amount = parseFloat(e.target.value) || 0;
  });

  // Step 3: Duration
  const durationInput = body.querySelector('#loan-duration-input');
  durationInput?.addEventListener('input', (e) => {
    state.loanRequest.duration = parseInt(e.target.value) || 1;
  });

  // Step 4: Guarantors (Row-based)
  const addGuarantorBtn = body.querySelector('#add-guarantor-btn');
  const guarantorsList = body.querySelector('#guarantors-list');

  const setupGuarantorSearch = async (row) => {
    const searchInput = row.querySelector('.guarantor-search');
    const suggestions = row.querySelector('.guarantor-suggestions');
    const hiddenId = row.querySelector('.guarantor-id');
    const amtInput = row.querySelector('.guarantor-amt');
    const display = row.querySelector('.g-selected-display');
    const statsDiv = row.querySelector('.g-stats-display');
    const removeBtn = row.querySelector('.remove-guarantor');
    const gi = parseInt(row.dataset.index);

    searchInput?.addEventListener('input', async (e) => {
      const text = (e.target.value || '').toLowerCase().trim();
      if (!text) {
        suggestions.style.display = 'none';
        return;
      }

      // Always fetch full list (cached) to ensure non-admins see all potential guarantors
      const { fetchAllMembers } = await import('./services/dataService.js');
      const allMembers = await fetchAllMembers(state.welcomeUser.cooperativeId, state.welcomeUser.username, true);

      const matches = allMembers.filter(m => {
        const isSelf = m.id === state.welcomeUser.memberId || m.id === state.selectedMemberId;
        if (isSelf) return false;

        const nameMatch = (m.name || '').toLowerCase().includes(text);
        const regMatch = String(m.registration_no || m.file_no || '').toLowerCase().includes(text);
        return nameMatch || regMatch;
      }).slice(0, 8);

      if (matches.length > 0) {
        suggestions.innerHTML = matches.map(m => `
          <div class="g-suggestion" data-id="${m.id}" data-name="${escapeHtml(m.name)}" data-file="${escapeHtml(m.file_no || m.registration_no || 'N/A')}" style="padding: 0.75rem 1rem; cursor: pointer; border-bottom: 1px solid var(--border-light);">
            <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-primary);">${escapeHtml(m.name)}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">File/Reg: ${m.file_no || m.registration_no || 'N/A'}</div>
          </div>
        `).join('');
        suggestions.style.display = 'block';

        suggestions.querySelectorAll('.g-suggestion').forEach(item => {
          item.addEventListener('mousedown', async (e) => {
            e.preventDefault(); // Prevent blur on input
            const { id, name, file } = item.dataset;
            hiddenId.value = id;
            searchInput.value = name;
            display.innerText = `Selected: ${name}`;
            suggestions.style.display = 'none';

            // Update state
            const currentIdx = parseInt(row.dataset.index);
            state.loanRequest.guarantors[currentIdx] = {
              ...state.loanRequest.guarantors[currentIdx],
              member_id: id,
              name,
              file_no: file
            };

            // Fetch stats
            try {
              statsDiv.querySelector('.g-active-count').innerText = 'Loading...';
              const { fetchGuarantorStats } = await import('./services/dataService.js');
              const stats = await fetchGuarantorStats(id, state.welcomeUser.cooperativeId);

              state.loanRequest.guarantors[currentIdx].activeCount = stats.activeCount;
              state.loanRequest.guarantors[currentIdx].activeSum = stats.activeSum;
              state.loanRequest.guarantors[currentIdx].overdueCount = stats.overdueCount;

              statsDiv.querySelector('.g-active-count').innerText = `Active: ${stats.activeCount}`;
              statsDiv.querySelector('.g-active-sum').innerText = `Total: ₦${stats.activeSum.toLocaleString()}`;
              const odSpan = statsDiv.querySelector('.g-overdue-count');
              odSpan.innerText = `Overdue: ${stats.overdueCount}`;
              if (stats.overdueCount > 0) odSpan.style.color = 'var(--danger)';
              else odSpan.style.color = 'inherit';
            } catch (err) {
              console.error("Error fetching stats:", err);
            }
          });
        });
      } else {
        suggestions.innerHTML = '<div style="padding: 0.75rem; color: var(--text-muted); font-style: italic;">No members found</div>';
        suggestions.style.display = 'block';
      }
    });

    searchInput?.addEventListener('blur', () => {
      setTimeout(() => { suggestions.style.display = 'none' }, 200);
    });

    amtInput?.addEventListener('input', (e) => {
      const currentIdx = parseInt(row.dataset.index);
      state.loanRequest.guarantors[currentIdx].amount = parseFloat(e.target.value) || 0;
    });

    removeBtn?.addEventListener('click', () => {
      const currentIdx = parseInt(row.dataset.index);
      state.loanRequest.guarantors.splice(currentIdx, 1);
      // Re-index remaining rows in state and DOM if needed, but for simplicity a full re-render is safer here
      // OR we just remove the row and re-render step
      renderLoanRequestStep();
    });
  };

  if (addGuarantorBtn && guarantorsList) {
    addGuarantorBtn.addEventListener('click', () => {
      const gIdx = state.loanRequest.guarantors.length;
      const gTempId = generateId();
      state.loanRequest.guarantors.push({ member_id: '', name: '', amount: 0, tempId: gTempId });

      const emptyMsg = body.querySelector('#empty-guarantors-msg');
      if (emptyMsg) emptyMsg.remove();

      const rowHtml = `
        <div class="guarantor-row" data-index="${gIdx}" data-id="${gTempId}" style="display: flex; flex-direction: column; gap: 0.5rem; background: var(--bg-card); padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-medium);">
          <div style="display: grid; grid-template-columns: 1fr 120px auto; gap: 0.75rem; align-items: center;">
            <div style="position: relative;">
                <input type="text" class="guarantor-search" placeholder="Search guarantor name..." style="width: 100%; height: 2.75rem; padding: 0 0.75rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: var(--radius-sm);">
                <div class="guarantor-suggestions" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 0.5rem; box-shadow: var(--shadow-lg); z-index: 100; max-height: 200px; overflow-y: auto; margin-top: 0.25rem;"></div>
                <input type="hidden" class="guarantor-id">
            </div>
            <input type="number" class="guarantor-amt" value="0" placeholder="Amount" style="height: 2.75rem; padding: 0 0.75rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: var(--radius-sm);">
            <button type="button" class="remove-guarantor" style="color: var(--danger); border: 0; background: transparent; font-size: 1.5rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
          </div>
          <div class="g-info-row" style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-top: 0.25rem;">
              <div class="g-selected-display" style="font-size: 0.75rem; color: var(--accent-primary); font-weight: 600;"></div>
              <div class="g-stats-display" style="display: flex; gap: 1rem; font-size: 0.7rem; color: var(--text-muted); font-weight: 500;">
                  <span class="g-active-count">Active: -</span>
                  <span class="g-active-sum">Total: -</span>
                  <span class="g-overdue-count">Overdue: -</span>
              </div>
          </div>
        </div>
      `;
      guarantorsList.insertAdjacentHTML('beforeend', rowHtml);
      setupGuarantorSearch(guarantorsList.lastElementChild);
    });
  }

  body.querySelectorAll('.guarantor-row').forEach((row) => {
    setupGuarantorSearch(row);
  });


  // Step 5: Bank Details
  const bankName = body.querySelector('#loan-bank-name');
  const accountName = body.querySelector('#loan-account-name');
  const accountNumber = body.querySelector('#loan-account-number');

  bankName?.addEventListener('input', (e) => state.loanRequest.bankDetails.bankName = e.target.value);
  accountName?.addEventListener('input', (e) => state.loanRequest.bankDetails.accountName = e.target.value);
  accountNumber?.addEventListener('input', (e) => state.loanRequest.bankDetails.accountNumber = e.target.value);

  // Navigation
  backBtn?.addEventListener('click', async () => {
    const isAdmin = hasPermission(state.welcomeUser.permissions, 'admin') ||
      hasPermission(state.welcomeUser.permissions, 'read_member') ||
      state.welcomeUser.username.toLowerCase() === 'admin';
    const minStep = 1;

    // Check if selected enterprise is savings
    const { fetchEnterprises: fetchEntsBack } = await import('./services/dataService.js');
    const entsBack = await fetchEntsBack(state.welcomeUser.cooperativeId);
    const allEntsBack = Object.entries(entsBack).map(([id, name]) => {
      const isLoan = name.toLowerCase().includes('loan') || id.toLowerCase().includes('loan');
      const isSavings = name.toLowerCase().includes('saving') || id.toLowerCase().includes('saving');
      return { id, name, type: isLoan ? 'loan' : (isSavings ? 'savings' : 'other') };
    });
    const selEntBack = allEntsBack.find(e => e.id === state.loanRequest.enterpriseId);
    const isSavingsBack = selEntBack?.type === 'savings';

    if (state.loanRequest.step > minStep) {
      let prevStep = state.loanRequest.step - 1;
      // If going back from Bank Details step and it's a savings enterprise, go back to Enterprise selection
      const bankDetailsStep = isAdmin ? 6 : 5; // Adjust this if we change step order
      const enterpriseStep = isAdmin ? 2 : 1;
      if (state.loanRequest.step === bankDetailsStep && isSavingsBack) {
        prevStep = enterpriseStep;
      }
      state.loanRequest.step = prevStep;
      renderLoanRequestStep();
    }
  });


  nextBtn?.addEventListener('click', async () => {
    const isAdmin = hasPermission(state.welcomeUser.permissions, 'admin') ||
      hasPermission(state.welcomeUser.permissions, 'read_member') ||
      state.welcomeUser.username.toLowerCase() === 'admin';

    // Check if selected enterprise is savings
    const { fetchEnterprises: fetchEnts } = await import('./services/dataService.js');
    const ents = await fetchEnts(state.welcomeUser.cooperativeId);
    const allEnts = Object.entries(ents).map(([id, name]) => {
      const isLoan = name.toLowerCase().includes('loan') || id.toLowerCase().includes('loan');
      const isSavings = name.toLowerCase().includes('saving') || id.toLowerCase().includes('saving');
      return { id, name, type: isLoan ? 'loan' : (isSavings ? 'savings' : 'other') };
    });
    const selEnt = allEnts.find(e => e.id === state.loanRequest.enterpriseId);
    const isSavings = selEnt?.type === 'savings';

    if (state.loanRequest.step === 7) {
      finalizeLoanRequest();
    } else {
      let nextStep = state.loanRequest.step + 1;
      // If current step is Enterprise selection and it's a savings enterprise, skip to Bank Details step
      const enterpriseStep = isAdmin ? 2 : 1;
      const bankDetailsStep = isAdmin ? 6 : 5;
      if (state.loanRequest.step === enterpriseStep && isSavings) {
        nextStep = bankDetailsStep;
      }
      state.loanRequest.step = nextStep;
      renderLoanRequestStep();
    }
  });

  // Setup Step 1 Member Search
  const memberSearchInput = body.querySelector('#loan-member-search');
  const memberSuggestions = body.querySelector('#loan-member-suggestions');
  if (memberSearchInput && memberSuggestions) {
    memberSearchInput.addEventListener('input', async (e) => {
      const text = (e.target.value || '').toLowerCase().trim();
      if (!text) {
        memberSuggestions.style.display = 'none';
        return;
      }

      const { fetchAllMembers } = await import('./services/dataService.js');
      const allMembers = await fetchAllMembers(state.welcomeUser.cooperativeId, state.welcomeUser.username, true);

      const matches = allMembers.filter(m => {
        const nameMatch = (m.name || '').toLowerCase().includes(text);
        const regMatch = String(m.registration_no || m.file_no || '').toLowerCase().includes(text);
        return nameMatch || regMatch;
      }).slice(0, 10);

      if (matches.length > 0) {
        memberSuggestions.innerHTML = matches.map(m => `
          <div class="m-suggestion" data-id="${m.id}" data-name="${escapeHtml(m.name)}" style="padding: 0.75rem 1rem; cursor: pointer; border-bottom: 1px solid var(--border-light);">
            <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-primary);">${escapeHtml(m.name)}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">File/Reg: ${m.file_no || m.registration_no || 'N/A'}</div>
          </div>
        `).join('');
        memberSuggestions.style.display = 'block';

        memberSuggestions.querySelectorAll('.m-suggestion').forEach(item => {
          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const { id, name } = item.dataset;
            state.loanRequest.memberId = id;
            state.loanRequest.memberName = name;
            renderLoanRequestStep(); // Re-render to show selected and enable next
          });
        });
      } else {
        memberSuggestions.innerHTML = '<div style="padding: 0.75rem; color: var(--text-muted); font-style: italic;">No members found</div>';
        memberSuggestions.style.display = 'block';
      }
    });

    memberSearchInput.addEventListener('blur', () => {
      setTimeout(() => { memberSuggestions.style.display = 'none' }, 200);
    });
  }

  // Setup Step 2 Enterprise Selection (auto-advance)
  const enterpriseOptions = body.querySelectorAll('.enterprise-option');
  enterpriseOptions.forEach(option => {
    option.addEventListener('click', async () => {
      const id = option.dataset.id;
      state.loanRequest.enterpriseId = id;
      
      // Auto advance to next step
      const isAdmin = hasPermission(state.welcomeUser.permissions, 'admin') ||
        hasPermission(state.welcomeUser.permissions, 'read_member') ||
        state.welcomeUser.username.toLowerCase() === 'admin';
      
      // Check if selected enterprise is savings
      const { fetchEnterprises: fetchEntsAuto } = await import('./services/dataService.js');
      const entsAuto = await fetchEntsAuto(state.welcomeUser.cooperativeId, true);
      const selEntAuto = entsAuto.find(e => e.id === id);
      const isSavingsAuto = (selEntAuto?.account_type || '').toLowerCase() === 'savings';
      
      let nextStep = state.loanRequest.step + 1;
      if (isSavingsAuto) {
        // Skip duration and guarantors for savings, go to bank details
        nextStep = isAdmin ? 6 : 5;
      }
      state.loanRequest.step = nextStep;
      renderLoanRequestStep();
    });
  });
}

async function finalizeLoanRequest() {
  // First, determine enterprise type
  const { 
    fetchEnterprises, 
    fetchAllMembers, 
    addRemittance, 
    getNextRemittanceRid, 
    updateMemberBankInfo 
  } = await import('./services/dataService.js');
  const { showToast } = await import('./services/toastService.js');
  const { generateId } = await import('./utils/formatters.js');
  const enterprisesFull = await fetchEnterprises(state.welcomeUser.cooperativeId, true);
  const selectedEnterprise = enterprisesFull.find(e => e.id === state.loanRequest.enterpriseId);
  const isSavingsEnterprise = (selectedEnterprise?.account_type || '').toLowerCase() === 'savings';

  // Update member bank details if needed
  if (state.loanRequest.bankDetails.bankName || state.loanRequest.bankDetails.accountName || state.loanRequest.bankDetails.accountNumber) {
    await updateMemberBankInfo(
      state.loanRequest.memberId, 
      state.loanRequest.bankDetails, 
      state.welcomeUser.username, 
      state.welcomeUser.cooperativeId
    );
  }

  // Get member details
  const allMembers = await fetchAllMembers(state.welcomeUser.cooperativeId, state.welcomeUser.username, true);
  const selectedMember = allMembers.find(m => m.id === state.loanRequest.memberId);

  // Determine transaction type and amount
  let transactionType = isSavingsEnterprise ? 'Savings Withdrawal' : 'Member Loan';
  let amount = isSavingsEnterprise ? -Math.abs(state.loanRequest.amount) : -Math.abs(state.loanRequest.amount);

  const nextRid = await getNextRemittanceRid(state.welcomeUser.cooperativeId);
  const status = 'Pending'; // As per instruction
  const description = isSavingsEnterprise ? 'Savings Withdrawal Request' : 'Loan Request';

  // Prepare remittance data
  const remittanceData = {
    member_id: state.loanRequest.memberId,
    amount: amount,
    transaction_type: transactionType,
    description: description,
    remittance_date: new Date().toISOString().split('T')[0],
    bank_name: state.loanRequest.bankDetails.bankName || '',
    r_id: nextRid,
    cooperative_id: state.welcomeUser.cooperativeId,
    user_role: state.welcomeUser.role || 'member',
    user_roles: [state.welcomeUser.role || 'member'],
    status: status,
    is_deleted: 0,
    is_synced: 0,
    created_at: new Date().toISOString(),
    created_by: state.welcomeUser.username,
    modified_at: new Date().toISOString(),
    modified_by: state.welcomeUser.username,
    details: [
      {
        id: generateId(state.welcomeUser.cooperativeId),
        item: state.loanRequest.enterpriseId,
        amount: amount,
        auto_description: `${transactionType} - ${selectedEnterprise?.account_name || 'Unknown'}`,
        ...(isSavingsEnterprise ? {} : {
          loan_info: {
            loanData: {
              principalAmount: Math.abs(state.loanRequest.amount),
              durationMonths: state.loanRequest.duration || 1,
              issueDate: new Date().toISOString().split('T')[0],
              status: 'Pending',
              notes: 'Loan Request'
            },
            guarantors: state.loanRequest.guarantors.map(g => ({
              id: g.id || generateId(state.welcomeUser.cooperativeId),
              member_id: g.member_id,
              name: g.name,
              file_no: g.file_no || '',
              amount: g.amount || (Math.abs(state.loanRequest.amount) / (state.loanRequest.guarantors.length || 1)),
              guarantor_approval: null
            }))
          }
        })
      }
    ]
  };

  // Save the remittance
  await addRemittance(remittanceData, state.welcomeUser.username);

  // Reset state
  state.modal.isOpen = false;
  state.modal.type = null;
  state.loanRequest = {
    step: 1,
    enterpriseId: '',
    amount: 0,
    duration: 1,
    guarantors: [],
    bankDetails: {
      bankName: '',
      accountName: '',
      accountNumber: ''
    }
  };

  // Go to dashboard or remittances tab to show success
  state.activeTab = 'dashboard';
  window.location.hash = 'dashboard';
  render();
  showToast('Withdrawal/Loan request submitted successfully!', 'success');
}

async function showWithdrawalWizard() {
  const { 
    fetchEnterprises, 
    fetchAllMembers, 
    addRemittance, 
    getNextRemittanceRid,
    buildAccountBalance 
  } = await import('./services/dataService.js');
  const { showToast } = await import('./services/toastService.js');
  const { generateId, formatCurrency, escapeHtml } = await import('./utils/formatters.js');
  
  const existingModal = document.getElementById('withdrawal-wizard-modal');
  if (existingModal) existingModal.remove();

  // Check if user is admin
  const isAdmin = state.welcomeUser.role === 'admin' || 
    (state.welcomeUser.permissions || []).includes('admin');

  // Get required data first
  const enterprises = await fetchEnterprises(state.welcomeUser.cooperativeId, true);
  const allMembers = await fetchAllMembers(state.welcomeUser.cooperativeId, state.welcomeUser.username, true);
  
  // Determine initial member ID
  let memberId = isAdmin ? null : (state.welcomeUser.memberId || allMembers[0]?.id);
  
  // Function to get member balances as a map (entId -> balance)
  const getMemberBalances = async (mId) => {
    if (!mId) return {};
    const result = await buildAccountBalance(state.welcomeUser.cooperativeId, { ...state.welcomeUser, memberId: mId });
    const balanceMap = {};
    result.accountBalance.forEach(ent => {
      balanceMap[ent.id] = ent.sum_of_amount;
    });
    return balanceMap;
  };
  
  let memberBalances = memberId ? await getMemberBalances(memberId) : {};

  // Modal state
    let wizardStep = isAdmin ? 1 : 1; // 1: select member (admin only) or select type (member), 2: select type (admin), 3: select enterprise, 4: enter amount, 5: review
    let selectedMemberId = memberId;
    let selectedEnterprise = null;
    let withdrawalAmount = 0;
    let loanDuration = 1;
    let guarantors = [];
    let totalSteps = isAdmin ? 5 : 4;

  const filterEnterprise = (e) => {
    // Filter out if isCompulsoryDue or isPenalty is true
    if (e.isCompulsoryDue || e.isPenalty) {
      return false;
    }
    // Filter out if name contains any of these keywords
    const nameLower = (e.account_name || '').toLowerCase();
    const forbiddenKeywords = ['compulsory', 'penalty', 'due', 'charges'];
    if (forbiddenKeywords.some(keyword => nameLower.includes(keyword))) {
      return false;
    }
    // Filter out if deleted
    if (e.is_deleted && e.is_deleted !== 0) {
      return false;
    }
    return true;
  };

  const getSavingsEnterprises = () => {
    return enterprises.filter(e => 
      (e.account_type || '').toLowerCase() === 'savings' && 
      filterEnterprise(e)
    );
  };

  const getLoanEnterprises = () => {
    return enterprises.filter(e => 
      (e.account_type || '').toLowerCase() === 'loan' && 
      filterEnterprise(e)
    );
  };

  const getEnterpriseBalance = (entId) => {
    return parseFloat(memberBalances[entId] || 0);
  };

  const renderModal = () => {
    const modalContainer = document.getElementById('withdrawal-wizard-modal');
    if (!modalContainer) return;
    
    let stepContent = '';
    totalSteps = selectedEnterprise?.type === 'loan' 
      ? (isAdmin ? 7 : 6) 
      : (isAdmin ? 5 : 4);
    
    const wizardTitle = selectedEnterprise?.type === 'loan' 
      ? 'Loan Request' 
      : (selectedEnterprise?.type === 'savings' ? 'Savings Withdrawal Request' : 'Withdrawal Request');
    
    if (isAdmin && wizardStep === 1) {
      // Step 1: Select Member (Admin only) - searchable dropdown
      stepContent = `
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <h4 style="margin: 0; color: var(--text-primary);">Select Member</h4>
          <p style="color: var(--text-muted); font-size: 0.9rem;">Who is requesting this?</p>
          <div style="position: relative; z-index: 999999;">
            <input type="text" id="wizard-member-search" placeholder="Search member by name or ID..." value="${escapeHtml(selectedMemberId ? (allMembers.find(m => m.id === selectedMemberId)?.name || '') : '')}" style="width: 100%; height: 2.75rem; padding: 0 0.75rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: var(--radius-sm);" autocomplete="off">
            <div id="wizard-member-suggestions" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 0.5rem; box-shadow: var(--shadow-lg); z-index: 999999; max-height: 250px; overflow-y: auto; margin-top: 0.25rem;"></div>
          </div>
          ${selectedMemberId ? `
            <div style="margin-top: 1rem; padding: 1rem; background: var(--bg-secondary); border-radius: 0.5rem; border: 1px solid var(--border-light);">
              <span style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Selected Member</span>
              <div style="font-weight: 700; color: var(--accent-primary); font-size: 1.1rem; margin-top: 0.25rem;">${escapeHtml(allMembers.find(m => m.id === selectedMemberId)?.name || 'Unknown')}</div>
            </div>
          ` : ''}
        </div>
      `;
    } else if ((isAdmin && wizardStep === 2) || (!isAdmin && wizardStep === 1)) {
      // Step 2 (Admin) / Step 1 (Member): Select Enterprise Type
      stepContent = `
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <h4 style="margin: 0; color: var(--text-primary);">Select Request Type</h4>
          <div style="display: grid; grid-template-columns: 1fr; gap: 0.75rem;">
            <button type="button" class="wizard-type-btn" data-type="savings" style="padding: 1.25rem; border: 1px solid var(--border-medium); border-radius: 0.75rem; background: var(--bg-card); cursor: pointer; text-align: left; transition: all 0.2s;">
              <div style="font-weight: 700; color: var(--text-primary);">Savings Withdrawal Request</div>
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">Withdraw from your savings account</div>
            </button>
            <button type="button" class="wizard-type-btn" data-type="loan" style="padding: 1.25rem; border: 1px solid var(--border-medium); border-radius: 0.75rem; background: var(--bg-card); cursor: pointer; text-align: left; transition: all 0.2s;">
              <div style="font-weight: 700; color: var(--text-primary);">Loan Request</div>
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">Take a loan</div>
            </button>
          </div>
        </div>
      `;
    } else if ((isAdmin && wizardStep === 3) || (!isAdmin && wizardStep === 2)) {
      // Step 3 (Admin) / Step 2 (Member): Select Enterprise
      const ents = selectedEnterprise.type === 'savings' ? getSavingsEnterprises() : getLoanEnterprises();
      stepContent = `
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <h4 style="margin: 0; color: var(--text-primary);">Select Account</h4>
          <div style="display: grid; grid-template-columns: 1fr; gap: 0.75rem; max-height: 400px; overflow-y: auto;">
            ${ents.map(e => `
              <button type="button" class="wizard-enterprise-btn" data-entid="${e.id}" style="padding: 1.25rem; border: 1px solid var(--border-medium); border-radius: 0.75rem; background: var(--bg-card); cursor: pointer; text-align: left; transition: all 0.2s;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <div style="font-weight: 700; color: var(--text-primary);">${escapeHtml(e.account_name)}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">
                      Balance: ${formatCurrency(getEnterpriseBalance(e.id))}
                    </div>
                  </div>
                </div>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    } else if ((isAdmin && wizardStep === 4) || (!isAdmin && wizardStep === 3)) {
      // Step 4 (Admin) / Step 3 (Member): Enter Withdrawal Amount
      const ent = enterprises.find(e => e.id === selectedEnterprise.id);
      const maxWithdrawal = selectedEnterprise.type === 'savings' 
        ? Math.max(0, getEnterpriseBalance(ent.id)) 
        : 999999999;
      
      stepContent = `
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <h4 style="margin: 0; color: var(--text-primary);">Enter Amount</h4>
          <div style="padding: 1rem; background: var(--bg-secondary); border-radius: 0.75rem; border: 1px solid var(--border-light);">
            <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Account</div>
            <div style="font-weight: 700; color: var(--text-primary);">${escapeHtml(ent?.account_name)}</div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem;">
              Current Balance: ${formatCurrency(getEnterpriseBalance(ent?.id))}
            </div>
            ${selectedEnterprise.type === 'savings' ? `
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem;">
                Max withdrawal: ${formatCurrency(maxWithdrawal)}
              </div>
            ` : ''}
          </div>
          <div class="field">
            <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em;">Amount (₦)</label>
            <input type="number" id="wizard-withdrawal-amount" step="0.01" min="0" ${selectedEnterprise.type === 'savings' ? `max="${maxWithdrawal}"` : ''} value="${withdrawalAmount || ''}" style="padding: 0.85rem; font-size: 1.1rem; font-weight: 700;">
          </div>
        </div>
      `;
    } else if (selectedEnterprise.type === 'loan' && ((isAdmin && wizardStep === 5) || (!isAdmin && wizardStep === 4))) {
      // Loan only: Step 5 (Admin) / Step 4 (Member): Enter Duration
      stepContent = `
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <h4 style="margin: 0; color: var(--text-primary);">Enter Duration</h4>
          <div class="field">
            <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em;">Duration (Months)</label>
            <input type="number" id="wizard-loan-duration" min="1" value="${loanDuration || 1}" style="padding: 0.85rem; font-size: 1.1rem; font-weight: 700;">
          </div>
        </div>
      `;
    } else if (selectedEnterprise.type === 'loan' && ((isAdmin && wizardStep === 6) || (!isAdmin && wizardStep === 5))) {
      // Loan only: Step 6 (Admin) / Step 5 (Member): Select Guarantors
      stepContent = `
        <div style="padding: 1rem 0; min-height: 400px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h4 style="margin: 0;">Select Guarantors</h4>
            <button type="button" id="wizard-add-guarantor-btn" class="ghost-button" style="color: var(--accent-primary); height: auto; padding: 0.5rem 1rem;">+ Add Guarantor</button>
          </div>
          <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.5rem;">Select members to guarantee this loan.</p>
          
          <div id="wizard-guarantors-list" style="display: flex; flex-direction: column; gap: 0.85rem;">
            ${guarantors.map((g, gi) => `
              <div class="wizard-guarantor-row" data-index="${gi}" style="display: flex; flex-direction: column; gap: 0.5rem; background: var(--bg-card); padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-medium);">
                <div style="display: grid; grid-template-columns: 1fr 120px auto; gap: 0.75rem; align-items: center;">
                  <div style="position: relative; z-index: 999999;">
                    <input type="text" class="wizard-guarantor-search" placeholder="Search guarantor name..." value="${escapeHtml(g.name || '')}" style="width: 100%; height: 2.75rem; padding: 0 0.75rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: var(--radius-sm);">
                    <div class="wizard-guarantor-suggestions" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 0.5rem; box-shadow: var(--shadow-lg); z-index: 999999; max-height: 200px; overflow-y: auto; margin-top: 0.25rem;"></div>
                    <input type="hidden" class="wizard-guarantor-id" value="${g.member_id || ''}">
                  </div>
                  <input type="number" class="wizard-guarantor-amt" value="${g.amount || ''}" placeholder="Amount" style="height: 2.75rem; padding: 0 0.75rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: var(--radius-sm);">
                  <button type="button" class="wizard-remove-guarantor" style="color: var(--danger); border: 0; background: transparent; font-size: 1.5rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
                </div>
                <div class="wizard-g-info-row" style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-top: 0.25rem;">
                  <div class="wizard-g-selected-display" style="font-size: 0.75rem; color: var(--accent-primary); font-weight: 600;">
                    ${g.name ? `Selected: ${g.name}` : ''}
                  </div>
                </div>
              </div>
            `).join('')}
            ${guarantors.length === 0 ? '<p id="wizard-empty-guarantors-msg" style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 2rem; border: 1px dashed var(--border-light); border-radius: 0.5rem;">No guarantors added yet. Click "+ Add Guarantor" to start.</p>' : ''}
          </div>
        </div>
      `;
    } else if (selectedEnterprise.type === 'loan' && ((isAdmin && wizardStep === 7) || (!isAdmin && wizardStep === 6))) {
      // Loan only: Step 7 (Admin) / Step 6 (Member): Review and Confirm
      const ent = enterprises.find(e => e.id === selectedEnterprise.id);
      const selectedMember = allMembers.find(m => m.id === selectedMemberId);
      stepContent = `
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <h4 style="margin: 0; color: var(--text-primary);">Confirm Loan Request</h4>
          <div style="padding: 1rem; background: var(--bg-secondary); border-radius: 0.75rem; border: 1px solid var(--border-light);">
            ${isAdmin ? `
              <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <span style="color: var(--text-muted);">Member</span>
                <span style="font-weight: 700; color: var(--text-primary);">${escapeHtml(selectedMember?.name || 'Unknown Member')}</span>
              </div>
            ` : ''}
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
              <span style="color: var(--text-muted);">Account</span>
              <span style="font-weight: 700; color: var(--text-primary);">${escapeHtml(ent?.account_name)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
              <span style="color: var(--text-muted);">Amount</span>
              <span style="font-weight: 700; font-size: 1.25rem; color: var(--danger);">${formatCurrency(-withdrawalAmount)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
              <span style="color: var(--text-muted);">Duration</span>
              <span style="font-weight: 700; color: var(--text-primary);">${loanDuration} Months</span>
            </div>
            ${guarantors.length > 0 ? `
              <div style="display: flex; flex-direction: column; gap: 0.5rem; border-top: 1px solid var(--border-medium); padding-top: 0.5rem; margin-top: 0.5rem;">
                <span style="color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; font-weight: 700;">Guarantors:</span>
                ${guarantors.map(g => `
                  <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                    <span>${escapeHtml(g.name || 'Unknown')}</span>
                    <span style="font-weight: 600;">₦${(g.amount || Math.abs(withdrawalAmount) / (guarantors.length || 1)).toLocaleString()}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    } else if ((isAdmin && wizardStep === 5) || (!isAdmin && wizardStep === 4)) {
      // Savings only: Step 5 (Admin) / Step 4 (Member): Review and Confirm
      const ent = enterprises.find(e => e.id === selectedEnterprise.id);
      const selectedMember = allMembers.find(m => m.id === selectedMemberId);
      stepContent = `
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <h4 style="margin: 0; color: var(--text-primary);">Confirm Savings Withdrawal</h4>
          <div style="padding: 1rem; background: var(--bg-secondary); border-radius: 0.75rem; border: 1px solid var(--border-light);">
            ${isAdmin ? `
              <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <span style="color: var(--text-muted);">Member</span>
                <span style="font-weight: 700; color: var(--text-primary);">${escapeHtml(selectedMember?.name || 'Unknown Member')}</span>
              </div>
            ` : ''}
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
              <span style="color: var(--text-muted);">Account</span>
              <span style="font-weight: 700; color: var(--text-primary);">${escapeHtml(ent?.account_name)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-muted);">Amount</span>
              <span style="font-weight: 700; font-size: 1.25rem; color: var(--danger);">${formatCurrency(-withdrawalAmount)}</span>
            </div>
          </div>
        </div>
      `;
    }

    const isNextEnabled = calculateIsNextEnabled();

    modalContainer.innerHTML = `
      <div class="modal-content" style="max-width: 500px; display: flex; flex-direction: column; height: 95vh; max-height: 95vh; margin: auto;">
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-light); flex-shrink: 0;">
          <h3 style="margin: 0; font-weight: 700; color: var(--text-primary);">${wizardTitle}</h3>
          <button class="close-btn" onclick="document.getElementById('withdrawal-wizard-modal').remove()" style="background: transparent; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-muted);">&times;</button>
        </div>
        <div class="modal-body" style="padding: 1.5rem 1.25rem; overflow-y: auto; flex-grow: 1;">
          <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem;">
            ${Array.from({length: totalSteps}, (_, i) => i + 1).map(step => `
              <div style="flex: 1; height: 4px; border-radius: 2px; background: ${step <= wizardStep ? 'var(--accent-primary)' : 'var(--border-light)'};"></div>
            `).join('')}
          </div>
          ${stepContent}
        </div>
        <div class="modal-footer" style="display: flex; justify-content: space-between; gap: 0.75rem; padding: 1rem; border-top: 1px solid var(--border-light); flex-shrink: 0;">
          ${wizardStep > (isAdmin ? 1 : 1) ? `
            <button type="button" class="secondary-button" id="wizard-back-btn" style="background: transparent; border: 1px solid var(--border-medium); color: var(--text-primary); padding: 0.6rem 1.2rem; border-radius: 0.5rem; font-weight: 700; cursor: pointer;">Back</button>
          ` : '<div></div>'}
          <button type="button" class="primary-button" id="wizard-next-btn" style="background: var(--accent-primary); color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 0.5rem; font-weight: 700; cursor: pointer; ${!isNextEnabled ? 'opacity: 0.5; pointer-events: none;' : ''}">
            ${wizardStep < totalSteps ? 'Next' : 'Submit'}
          </button>
        </div>
      </div>
    `;

    attachModalListeners();
  };
  
  const calculateIsNextEnabled = () => {
    const ent = enterprises.find(e => e.id === selectedEnterprise?.id);
    const maxWithdrawal = selectedEnterprise?.type === 'savings' && ent 
      ? Math.max(0, getEnterpriseBalance(ent.id)) 
      : 999999999;
    const isValidAmount = (selectedEnterprise?.type === 'loan' ? ((isAdmin && wizardStep === 4) || (!isAdmin && wizardStep === 3)) : ((isAdmin && wizardStep === 4) || (!isAdmin && wizardStep === 3)))
      ? withdrawalAmount > 0 && (selectedEnterprise.type !== 'savings' || withdrawalAmount <= maxWithdrawal)
      : true;
    const isValidMember = !isAdmin || selectedMemberId;
    const isValidDuration = selectedEnterprise?.type === 'loan' && ((isAdmin && wizardStep === 5) || (!isAdmin && wizardStep === 4))
      ? loanDuration >= 1
      : true;
    return isValidAmount && isValidMember && isValidDuration;
  };
  
  const updateNextButton = () => {
    const nextBtn = document.getElementById('wizard-next-btn');
    if (nextBtn) {
      const isNextEnabled = calculateIsNextEnabled();
      if (isNextEnabled) {
        nextBtn.style.opacity = '1';
        nextBtn.style.pointerEvents = 'auto';
      } else {
        nextBtn.style.opacity = '0.5';
        nextBtn.style.pointerEvents = 'none';
      }
    }
  };

  const attachModalListeners = () => {
    // Back button
    document.getElementById('wizard-back-btn')?.addEventListener('click', () => {
      wizardStep--;
      renderModal();
    });

    if (isAdmin && wizardStep === 1) {
      // Setup searchable member dropdown
      const memberSearchInput = document.getElementById('wizard-member-search');
      const memberSuggestions = document.getElementById('wizard-member-suggestions');
      if (memberSearchInput && memberSuggestions) {
        memberSearchInput.addEventListener('input', async (e) => {
          const text = (e.target.value || '').toLowerCase().trim();
          if (!text) {
            memberSuggestions.style.display = 'none';
            return;
          }

          const matches = allMembers.filter(m => {
            const nameMatch = (m.name || '').toLowerCase().includes(text);
            const regMatch = String(m.registration_no || m.file_no || '').toLowerCase().includes(text);
            return nameMatch || regMatch;
          }).slice(0, 10);

          if (matches.length > 0) {
            memberSuggestions.innerHTML = matches.map(m => `
              <div class="wizard-member-suggestion" data-id="${m.id}" data-name="${escapeHtml(m.name)}" style="padding: 0.75rem 1rem; cursor: pointer; border-bottom: 1px solid var(--border-light);">
                <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-primary);">${escapeHtml(m.name)}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">File/Reg: ${m.file_no || m.registration_no || 'N/A'}</div>
              </div>
            `).join('');
            memberSuggestions.style.display = 'block';

            memberSuggestions.querySelectorAll('.wizard-member-suggestion').forEach(item => {
                item.addEventListener('mousedown', async (e) => {
                    e.preventDefault();
                    const { id, name } = item.dataset;
                    selectedMemberId = id;
                    memberBalances = selectedMemberId 
                        ? await getMemberBalances(selectedMemberId) 
                        : {};
                    renderModal();
                });
            });
          } else {
            memberSuggestions.innerHTML = '<div style="padding: 0.75rem; color: var(--text-muted); font-style: italic;">No members found</div>';
            memberSuggestions.style.display = 'block';
          }
        });

        memberSearchInput.addEventListener('blur', () => {
          setTimeout(() => { memberSuggestions.style.display = 'none' }, 200);
        });
      }
    } else if ((isAdmin && wizardStep === 2) || (!isAdmin && wizardStep === 1)) {
      // Select type
      document.querySelectorAll('.wizard-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedEnterprise = { type: btn.dataset.type };
          // Reset loan-specific state
          loanDuration = 1;
          guarantors = [];
          // Get first available enterprise of this type
          const ents = selectedEnterprise.type === 'savings' ? getSavingsEnterprises() : getLoanEnterprises();
          if (ents.length > 0) {
            selectedEnterprise.id = ents[0].id;
          }
          wizardStep = isAdmin ? 3 : 2;
          renderModal();
        });
      });
    } else if ((isAdmin && wizardStep === 3) || (!isAdmin && wizardStep === 2)) {
      // Select enterprise
      document.querySelectorAll('.wizard-enterprise-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedEnterprise.id = btn.dataset.entid;
          wizardStep = isAdmin ? 4 : 3;
          renderModal();
        });
      });
    } else if ((isAdmin && wizardStep === 4) || (!isAdmin && wizardStep === 3)) {
      // Capture amount input - update state and button without full re-render
      const amtInput = document.getElementById('wizard-withdrawal-amount');
      amtInput?.addEventListener('input', (e) => {
        withdrawalAmount = parseFloat(e.target.value || 0);
        updateNextButton();
      });
    } else if (selectedEnterprise.type === 'loan' && ((isAdmin && wizardStep === 5) || (!isAdmin && wizardStep === 4))) {
      // Loan duration input
      const durationInput = document.getElementById('wizard-loan-duration');
      durationInput?.addEventListener('input', (e) => {
        loanDuration = parseInt(e.target.value || 1);
        updateNextButton();
      });
    } else if (selectedEnterprise.type === 'loan' && ((isAdmin && wizardStep === 6) || (!isAdmin && wizardStep === 5))) {
      // Guarantor management
      const addGuarantorBtn = document.getElementById('wizard-add-guarantor-btn');
      const guarantorsList = document.getElementById('wizard-guarantors-list');
      
      const setupGuarantorSearch = (row) => {
        const searchInput = row.querySelector('.wizard-guarantor-search');
        const suggestions = row.querySelector('.wizard-guarantor-suggestions');
        const hiddenId = row.querySelector('.wizard-guarantor-id');
        const amtInput = row.querySelector('.wizard-guarantor-amt');
        const display = row.querySelector('.wizard-g-selected-display');
        const removeBtn = row.querySelector('.wizard-remove-guarantor');
        const gi = parseInt(row.dataset.index);
        
        searchInput?.addEventListener('input', async (e) => {
          const text = (e.target.value || '').toLowerCase().trim();
          if (!text) {
            suggestions.style.display = 'none';
            return;
          }
          
          const matches = allMembers.filter(m => {
            const isSelf = m.id === selectedMemberId;
            if (isSelf) return false;
            const nameMatch = (m.name || '').toLowerCase().includes(text);
            const regMatch = String(m.registration_no || m.file_no || '').toLowerCase().includes(text);
            return nameMatch || regMatch;
          }).slice(0, 8);
          
          if (matches.length > 0) {
            suggestions.innerHTML = matches.map(m => `
              <div class="wizard-g-suggestion" data-id="${m.id}" data-name="${escapeHtml(m.name)}" data-file="${escapeHtml(m.file_no || m.registration_no || 'N/A')}" style="padding: 0.75rem 1rem; cursor: pointer; border-bottom: 1px solid var(--border-light);">
                <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-primary);">${escapeHtml(m.name)}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">File/Reg: ${m.file_no || m.registration_no || 'N/A'}</div>
              </div>
            `).join('');
            suggestions.style.display = 'block';
            
            suggestions.querySelectorAll('.wizard-g-suggestion').forEach(item => {
              item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const { id, name } = item.dataset;
                hiddenId.value = id;
                searchInput.value = name;
                display.innerText = `Selected: ${name}`;
                suggestions.style.display = 'none';
                
                // Update state
                guarantors[gi] = {
                  ...guarantors[gi],
                  member_id: id,
                  name
                };
              });
            });
          } else {
            suggestions.innerHTML = '<div style="padding: 0.75rem; color: var(--text-muted); font-style: italic;">No members found</div>';
            suggestions.style.display = 'block';
          }
        });
        
        searchInput?.addEventListener('blur', () => {
          setTimeout(() => { suggestions.style.display = 'none' }, 200);
        });
        
        amtInput?.addEventListener('input', (e) => {
          const currentIdx = parseInt(row.dataset.index);
          guarantors[currentIdx].amount = parseFloat(e.target.value || 0);
        });
        
        removeBtn?.addEventListener('click', () => {
          const currentIdx = parseInt(row.dataset.index);
          guarantors.splice(currentIdx, 1);
          renderModal();
        });
      };
      
      if (addGuarantorBtn && guarantorsList) {
        addGuarantorBtn.addEventListener('click', () => {
          const gIdx = guarantors.length;
          const gTempId = generateId();
          guarantors.push({ member_id: '', name: '', amount: 0, tempId: gTempId });
          
          const emptyMsg = guarantorsList.querySelector('#wizard-empty-guarantors-msg');
          if (emptyMsg) emptyMsg.remove();
          
          const rowHtml = `
            <div class="wizard-guarantor-row" data-index="${gIdx}" data-id="${gTempId}" style="display: flex; flex-direction: column; gap: 0.5rem; background: var(--bg-card); padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-medium);">
              <div style="display: grid; grid-template-columns: 1fr 120px auto; gap: 0.75rem; align-items: center;">
                <div style="position: relative; z-index: 999999;">
                  <input type="text" class="wizard-guarantor-search" placeholder="Search guarantor name..." style="width: 100%; height: 2.75rem; padding: 0 0.75rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: var(--radius-sm);">
                  <div class="wizard-guarantor-suggestions" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 0.5rem; box-shadow: var(--shadow-lg); z-index: 999999; max-height: 200px; overflow-y: auto; margin-top: 0.25rem;"></div>
                  <input type="hidden" class="wizard-guarantor-id">
                </div>
                <input type="number" class="wizard-guarantor-amt" value="0" placeholder="Amount" style="height: 2.75rem; padding: 0 0.75rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: var(--radius-sm);">
                <button type="button" class="wizard-remove-guarantor" style="color: var(--danger); border: 0; background: transparent; font-size: 1.5rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
              </div>
              <div class="wizard-g-info-row" style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-top: 0.25rem;">
                <div class="wizard-g-selected-display" style="font-size: 0.75rem; color: var(--accent-primary); font-weight: 600;"></div>
              </div>
            </div>
          `;
          guarantorsList.insertAdjacentHTML('beforeend', rowHtml);
          setupGuarantorSearch(guarantorsList.lastElementChild);
        });
      }
      
      document.querySelectorAll('.wizard-guarantor-row').forEach(row => {
        setupGuarantorSearch(row);
      });
    }

    // Next button
    document.getElementById('wizard-next-btn')?.addEventListener('click', async () => {
      totalSteps = selectedEnterprise?.type === 'loan' 
        ? (isAdmin ? 7 : 6) 
        : (isAdmin ? 5 : 4);
      if (wizardStep < totalSteps) {
        // Validation
        if ((isAdmin && wizardStep === 4) || (!isAdmin && wizardStep === 3)) {
          // Amount step
          if (!withdrawalAmount || withdrawalAmount <= 0) {
            showToast('Please enter a valid amount', 'warning');
            return;
          }
          const ent = enterprises.find(e => e.id === selectedEnterprise.id);
          if (selectedEnterprise.type === 'savings') {
            const maxWithdrawal = Math.max(0, getEnterpriseBalance(ent.id));
            if (withdrawalAmount > maxWithdrawal) {
              showToast('Amount exceeds available balance', 'error');
              return;
            }
          }
        } else if (isAdmin && wizardStep === 1) {
          // Member selection step
          if (!selectedMemberId) {
            showToast('Please select a member', 'warning');
            return;
          }
        }
        wizardStep++;
        renderModal();
      } else {
        // Submit directly to database
        try {
          const ent = enterprises.find(e => e.id === selectedEnterprise.id);
          const selectedMember = allMembers.find(m => m.id === selectedMemberId);
          const transactionType = selectedEnterprise.type === 'loan' ? 'Member Loan' : 'Savings Withdrawal';
          const amount = -Math.abs(withdrawalAmount);
          const nextRid = await getNextRemittanceRid(state.welcomeUser.cooperativeId);
          
          const details = [
            {
              id: generateId(state.welcomeUser.cooperativeId),
              enterprise_id: ent.id,
              item: ent.id,
              amount: amount,
              ...(selectedEnterprise.type === 'loan' ? {
                loan_info: {
                  loanData: {
                    principalAmount: Math.abs(withdrawalAmount),
                    durationMonths: loanDuration,
                    issueDate: new Date().toISOString().split('T')[0],
                    dueDate: '',
                    status: 'Pending',
                    notes: 'Loan Request'
                  },
                  guarantors: guarantors.map(g => ({
                    ...g,
                    id: g.id || generateId(state.welcomeUser.cooperativeId),
                    amount: g.amount || Math.abs(withdrawalAmount) / (guarantors.length || 1)
                  }))
                }
              } : {})
            }
          ];

          const remittanceData = {
            id: null,
            member_id: selectedMemberId,
            amount: amount,
            bank_name: '',
            description: selectedEnterprise.type === 'loan' ? 'Loan Request' : 'Savings Withdrawal Request',
            transaction_type: transactionType,
            remittance_date: new Date().toISOString().split('T')[0],
            details: details,
            isLoanRequest: selectedEnterprise.type === 'loan',
            isWithdrawalRequest: true,
            r_id: nextRid,
            cooperative_id: state.welcomeUser.cooperativeId,
            user_role: state.welcomeUser.role || 'member',
            user_roles: [state.welcomeUser.role || 'member'],
            status: 'Pending',
            is_deleted: 0,
            is_synced: 0,
            created_at: new Date().toISOString(),
            created_by: state.welcomeUser.username,
            modified_at: new Date().toISOString(),
            modified_by: state.welcomeUser.username
          };

          await addRemittance(remittanceData, state.welcomeUser.username);

          document.getElementById('withdrawal-wizard-modal').remove();
          
          // Go to dashboard
          state.activeTab = 'dashboard';
          window.location.hash = 'dashboard';
          render();
          showToast('Request submitted successfully!', 'success');
        } catch (err) {
          showToast('Error submitting request: ' + err.message, 'error');
        }
      }
    });
  };

  const overlay = document.createElement('div');
  overlay.id = 'withdrawal-wizard-modal';
  overlay.className = 'modal-overlay open';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '999999';
  overlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '1rem';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  renderModal();
}



