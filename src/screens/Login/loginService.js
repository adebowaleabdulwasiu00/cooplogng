import { state, getDefaultTab } from '../../state/appState.js'
import { escapeHtml, escapeAttribute, hashPassword } from '../../utils/formatters.js'
import { networkIndicatorClass, networkIndicatorLabel, networkIndicatorIcon } from '../../services/networkService.js'
import { showToast } from '../../services/toastService.js'
import { validateLogin } from '../../services/authService.js'
import { attemptOfflineLogin, saveSessionLocally as saveSession } from '../../services/offlineAuthService.js'
import { queryOne } from '../../services/sqliteService.js'
import { syncCooperativeData, initializeSyncService } from '../../services/syncService.js'
import { isSubscriptionActive, INACTIVE_MSG } from '../Dashboard/dashboardService.js'
import { setupLoanRequestListeners } from '../../components/LoanWizard.js'
import { setupNotificationModalListeners } from '../../components/NotificationModal.js'

export function renderLoginHTML(renderAlertFn, renderGlobalModalFn) {
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

  return `
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
        ${renderAlertFn()}
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
            <button type="button" class="secondary-button" data-action="google-login" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; border-color: #d1d5db; color: #374151;" ${state.isSubmitting ? 'disabled' : ''}>
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
    ${renderGlobalModalFn()}
  `
}

export function setupLoginPostRender() {
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
        window.__render()
        window.dispatchEvent(new CustomEvent('edit-remittance', { detail: { id: recordId } }))
      }
    )
  }
}

export function classifyLoginError(err) {
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

export async function handleNext() {
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

export function handleBack() {
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
  window.__render()
}

export async function handleGoogleLogin() {
  if (state.isSubmitting) return;

  try {
    state.isSubmitting = true;
    state.errorMessage = '';
    window.__render();

    const { getFirebaseAuth, signInWithPopup } = await import('../../firebase.js');
    const { auth, googleProvider } = getFirebaseAuth();
    
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    if (!user.email) {
      throw new Error('No email associated with this Google account.');
    }

    const { discoverLoginCooperativesByEmail, validateGoogleLogin } = await import('../../services/authService.js');
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
        window.__render();
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
      window.__render();
    }
  } catch (error) {
    console.error('Google Auth Error:', error);
    state.errorMessage = error.message || 'Google Sign-In failed.';
    state.isSubmitting = false;
    window.__render();
  }
}

export async function handleUsernameStage() {
  state.isGoogleLoginFlow = false;
  const username = state.username.trim()
  if (!username) {
    state.errorMessage = 'Please enter username.'
    window.__render()
    return
  }

  try {
    state.isSubmitting = true
    state.errorMessage = ''
    window.__render()

    let cooperatives = []
    let onlineFailed = false

    // Try online discovery first (with 10s timeout)
    try {
      const { discoverLoginCooperatives } = await import('../../services/authService.js')
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
        const { discoverCooperativesOffline, hasLocalAuthData } = await import('../../services/offlineAuthService.js')
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
    window.__render()
  }
}

export async function handleCooperativeStage() {
  if (!state.selectedCooperativeId) {
    state.errorMessage = 'Please select a cooperative.'
    window.__render()
    return
  }

  if (state.isGoogleLoginFlow) {
    state.isSubmitting = true;
    state.errorMessage = '';
    window.__render();
    try {
      const { validateGoogleLogin } = await import('../../services/authService.js');
      const session = await validateGoogleLogin(state.username, state.selectedCooperativeId);
      if (session) {
        state.welcomeUser = session;
        await saveSession(session);
        window.__render();
      } else {
        throw new Error('Login validation failed.');
      }
    } catch (error) {
      state.errorMessage = error.message || 'Google Sign-In failed.';
      state.isSubmitting = false;
      window.__render();
    }
    return;
  }

  state.stage = 3
  state.errorMessage = ''
  window.__render()
}

export async function handlePasswordStage() {
  const username = state.username.trim()
  const password = state.password
  const cooperativeId = state.selectedCooperativeId

  if (!password) {
    state.errorMessage = 'Please enter password.'
    window.__render()
    return
  }

  if (!cooperativeId) {
    state.errorMessage = 'Please select a cooperative.'
    window.__render()
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
    window.__render()

    // Online authentication (with 10s timeout)
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

    // Offline fallback
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

    // No session — show specific error
    if (!session) {
      const errorMsg = loginError?.message || 'Invalid username or password.'
      console.log(`[Login] [${Date.now()}] No session returned. Error: "${errorMsg}"`);
      state.errorMessage = errorMsg
      state.isSubmitting = false
      window.__render()
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
      userDoc: session.userDoc,
      collection: session.collection,
    }

    // Save to sessionStorage and persist userDoc for offline access
    saveSession(state.welcomeUser).catch(err => console.warn('[Login] Session save failed:', err))

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
    window.__render()
    console.log(`[Login] [${Date.now()}] Dashboard rendered. Login completed in ${Date.now() - loginStartTs}ms`);

    // Background: Load subscription info (non-blocking)
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

    // Background sync (non-blocking)
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
    window.__render()
  } finally {
    state.isSubmitting = false
  }
}

export async function showForcePasswordChangeModal(userDoc, collectionName) {
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

  window.__render();
}

export function setupForcePwdListeners() {
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

      // 1. Write directly to Firestore (immediate, bypasses sync queue)
      if (navigator.onLine) {
        try {
          const { getDb, doc: fsDoc, updateDoc } = await import('../../firebase.js');
          const db = getDb();
          await updateDoc(fsDoc(db, collectionName, userDoc.id), minimalPayload);
          console.log('[PasswordChange] Firestore write successful');
        } catch (fsErr) {
          console.warn('[PasswordChange] Firestore direct write failed (will rely on sync queue):', fsErr.message);
        }
      }

      // 2. Update SQLite locally and enqueue for sync (offline resilience)
      const fullPayload = { ...userDoc, ...minimalPayload };
      const { updateMember, updateUser } = await import('../../services/dataService.js');
      if (collectionName === 'members') {
        await updateMember(userDoc.id, fullPayload, 'system-security');
      } else {
        await updateUser(userDoc.id, fullPayload, 'system-security');
      }

      showToast("Password updated successfully! Welcome to your dashboard.", "success");

      // 3. Reset ALL modal and login state completely
      state.modal.isOpen = false;
      state.modal.type = null;
      state.modal.title = '';
      state.modal.content = '';
      state.modal.data = null;
      state.stage = 1;
      state.password = '';
      state.errorMessage = '';

      // 4. Build and save the authenticated session
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

      // 5. Navigate to dashboard
      state.activeTab = 'history';
      window.history.replaceState(null, '', '#history');

      // 6. Trigger background sync to push any remaining queue items
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

      window.__render();
    } catch (err) {
      showToast("Failed to update password: " + err.message, "error");
      submitBtn.disabled = false;
      submitBtn.innerText = "Update & Login";
    }
  });
}
