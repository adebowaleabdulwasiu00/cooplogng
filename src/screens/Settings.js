import { hasPermission } from '../services/permissionService.js'
import { showToast } from '../services/toastService.js'
import {
  renderPasswordSection,
  setupPasswordListeners,
  renderFeedbackSection,
  setupFeedbackListeners,
  renderGuarantorSection,
  setupGuarantorListeners,
  renderAdviceSection,
  setupAdviceListeners,
  renderCooperativeSection,
  setupCooperativeListeners,
  renderBankSection,
  setupBankListeners,
  renderEnterpriseSection,
  setupEnterpriseListeners,
  renderUserManagementSection,
  setupUserManagementListeners,
  renderTransactionTypesSection,
  setupTransactionTypesListeners,
  renderDbManagementSection,
  setupDbManagementListeners,
  renderHardRestoreSection,
  setupHardRestoreListeners,
  renderDisplaySection,
  setupDisplayListeners,
  renderThemeSection,
  setupThemeListeners,
  renderSubscriptionSection,
  setupSubscriptionListeners,
  renderAboutSection,
  setupAboutListeners
} from './settings/index.js'

export async function renderSettings(container, user) {
  const isAdmin = user.isAdmin || hasPermission(user.permissions, 'admin') || (user.username || '').toLowerCase() === 'admin'
  const canManageSettings = isAdmin || hasPermission(user.permissions, 'settings_manage')
  const cooperativeId = user.cooperativeId

  // Track active section. Always start with null (menu) for native feel.
  let activeSection = null

  const menuItems = []

  // Password change visible to members and admins
  if ((user.role || '').toLowerCase() === 'member' || isAdmin) {
    menuItems.push({ id: 'password', label: '🔑 Change Password', icon: '🔑' })
  }

  // Guarantor and Advice only for members (anyone with a memberId) or Admins
  if (user.memberId || isAdmin) {
    menuItems.push({ id: 'guarantor', label: '🤝 Guarantor Requests', icon: '🤝' })
    menuItems.push({ id: 'advice', label: '📋 Payment Advice', icon: '📋' })
    menuItems.push({ id: 'feedback', label: '💬 Give Feedback', icon: '💬' })
  } else {
    // Staff who aren't members get feedback
    menuItems.push({ id: 'feedback', label: '💬 Give Feedback', icon: '💬' })
  }

  // DB Management strictly for admin/staff (non-members)
  if (isAdmin || (user.role || '').toLowerCase() !== 'member') {
    menuItems.push({ id: 'db', label: '📁 DB Management', icon: '📁' })
  }

  menuItems.push({ id: 'restore', label: '🔄 Hard restore App', icon: '🔄' })

  if (isAdmin) {
    menuItems.push(
      { id: 'cooperative', label: '🏢 Cooperative Settings', icon: '🏢' },
      { id: 'subscription', label: '📋 Subscription Management', icon: '📋' }
    )
  }

  if (canManageSettings) {
        menuItems.push(
            { id: 'banks', label: '🏦 Bank List', icon: '🏦' },
            { id: 'enterprises', label: '📊 Enterprise Accounts', icon: '📊' },
            { id: 'users', label: '👥 User Management', icon: '👥' },
            { id: 'transactionTypes', label: '📝 Transaction Types', icon: '📝' }
        )
    }


  menuItems.push(
    { id: 'display', label: '📱 Display Preferences', icon: '📱' },
    { id: 'theme', label: '🎨 Theme', icon: '🎨' },
    { id: 'about', label: 'ℹ️ About App', icon: 'ℹ️' }
  )

  // Default section logic
  if ((user.role || '').toLowerCase() === 'member') {
    if (activeSection === 'password') activeSection = 'password'
  } else {
    if (activeSection === 'password') activeSection = 'feedback'
  }

  const renderSection = (sectionId) => {
        const area = document.createElement('div')
        switch (sectionId) {
            case 'password': renderPasswordSection(area); break
            case 'feedback': renderFeedbackSection(area); break
            case 'guarantor': renderGuarantorSection(area); break
            case 'advice': renderAdviceSection(area); break
            case 'cooperative': renderCooperativeSection(area); break
            case 'banks': renderBankSection(area); break
            case 'enterprises': renderEnterpriseSection(area); break
            case 'users': renderUserManagementSection(area); break
            case 'transactionTypes': renderTransactionTypesSection(area); break
            case 'db': renderDbManagementSection(area); break
            case 'restore': renderHardRestoreSection(area); break
            case 'about': renderAboutSection(area); break
            case 'theme': renderThemeSection(area); break
            case 'display': renderDisplaySection(area); break
            case 'subscription': renderSubscriptionSection(area); break
            default: area.innerHTML = '<p style="color: var(--text-muted);">Section not found.</p>'
        }
        return area.innerHTML
    }

  const renderPage = () => {
    const showMenu = !activeSection

    container.innerHTML = `
      <style>
        .settings-layout {
          max-width: 800px;
          margin: 0 auto;
          min-height: 500px;
        }
        .settings-menu {
          display: ${showMenu ? 'flex' : 'none'};
          flex-direction: column;
          background: var(--bg-card);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-sm);
          padding: 0.5rem;
          border: 1px solid var(--border-light);
        }
        .settings-menu-group {
          margin-bottom: 1.5rem;
        }
        .settings-menu-group-title {
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          padding: 0 1rem 0.5rem 1rem;
          letter-spacing: 0.05em;
        }
        .settings-menu-btn {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          border: none;
          background: transparent;
          border-radius: var(--radius-lg);
          font-size: 1rem;
          font-weight: 500;
          color: var(--text-primary);
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
          width: 100%;
          border-bottom: 1px solid var(--border-light);
        }
        .settings-menu-btn:last-child { border-bottom: none; }
        .settings-menu-btn:hover {
          background: var(--bg-secondary);
        }
        .settings-menu-btn .icon-wrap {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-secondary);
          border-radius: 10px;
          font-size: 1.2rem;
          transition: transform 0.2s;
        }
        .settings-menu-btn:hover .icon-wrap {
          transform: scale(1.1);
          background: var(--accent-soft);
        }
        .settings-menu-btn .chevron {
          margin-left: auto;
          color: var(--text-muted);
          opacity: 0.5;
        }
        .settings-content {
          display: ${!showMenu ? 'block' : 'none'};
          background: var(--bg-card);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-sm);
          padding: 2rem;
          border: 1px solid var(--border-light);
        }
        @media (max-width: 768px) {
          .settings-content {
            padding: 1.25rem !important;
            border-radius: var(--radius-xl);
          }
          .inline-form {
            flex-direction: column;
            align-items: stretch !important;
          }
        }
        .settings-content h3 {
          margin: 0 0 0.5rem 0;
          font-size: 1.5rem;
          color: var(--text-primary);
        }
        .settings-content .section-desc {
          font-size: 0.95rem;
          color: var(--text-muted);
          margin-bottom: 2rem;
        }
        .table-responsive {
          width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          margin-bottom: 1rem;
          border-radius: var(--radius-md);
          border: 1px solid var(--border-light);
        }
        .crud-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
          table-layout: auto;
        }
        @media (max-width: 600px) {
          .crud-table { font-size: 0.75rem; }
          .crud-table th, .crud-table td { padding: 0.5rem 0.4rem !important; }
        }
        .crud-table thead th {
          background: var(--bg-header);
          padding: 0.75rem 1rem;
          text-align: left;
          font-weight: 600;
          color: var(--text-muted);
          border-bottom: 2px solid var(--border-light);
        }
        .crud-table tbody td {
          padding: 0.7rem 1rem;
          border-bottom: 1px solid var(--border-light);
          color: var(--text-primary);
        }
        .inline-form {
          display: flex;
          gap: 0.75rem;
          align-items: flex-end;
          flex-wrap: wrap;
          padding: 1.25rem;
          background: var(--bg-secondary);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          margin-bottom: 1.5rem;
        }
        .inline-form .field { flex: 1; min-width: 180px; }
        .inline-form .field label { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 0.25rem; }
        .inline-form .field input, .inline-form .field select {
          width: 100%; box-sizing: border-box;
          padding: 0.6rem 0.75rem; border: 1px solid var(--border-medium);
          border-radius: 8px; font-size: 0.9rem;
          background: var(--bg-input); color: var(--text-primary);
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .inline-form .field input:focus, .inline-form .field select:focus {
          border-color: var(--accent-primary);
          box-shadow: 0 0 0 3px var(--accent-soft);
          outline: none;
        }
        .input-with-toggle {
          display: flex;
          align-items: center;
          position: relative;
        }
        .input-with-toggle input {
          padding-right: 3rem !important;
        }
        .input-toggle-wrap {
          position: absolute;
          right: 0.5rem;
          display: flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.7rem;
          font-weight: 700;
          color: var(--text-muted);
          background: var(--bg-secondary);
          padding: 0.2rem 0.4rem;
          border-radius: 4px;
          cursor: pointer;
          user-select: none;
        }
        .input-toggle-wrap input {
          width: auto !important;
          margin: 0 !important;
          padding: 0 !important;
          cursor: pointer;
        }
        .form-section-title {
            font-size: 0.75rem;
            font-weight: 800;
            color: var(--accent-primary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin: 1rem 0 0.5rem 0;
            border-bottom: 1px solid var(--border-light);
            padding-bottom: 0.25rem;
        }
        /* Modal Overlay */
        .settings-modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 1rem;
        }
        .settings-modal-content {
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: 16px;
          width: 100%;
          max-width: 500px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3);
          animation: modal-pop 0.3s ease-out;
        }
        @keyframes modal-pop {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .modal-header {
          padding: 1.25rem;
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .modal-body { padding: 1.25rem; }
        .modal-footer {
          padding: 1.25rem;
          border-top: 1px solid var(--border-light);
          display: flex;
          gap: 1rem;
          justify-content: flex-end;
        }
      </style>

      <div class="page-header" style="max-width: 800px; margin: 0 auto; ${!showMenu ? 'display:none;' : 'padding: 2rem 1rem;'}">
        <h2 style="font-size: 2rem; font-weight: 800;">Settings</h2>
        <p class="subtitle">Personalize your cooperative experience.</p>
      </div>

      <div class="page-container" style="padding: ${window.innerWidth <= 768 ? '1rem' : '2rem 0'};">
        <div class="settings-layout">
          <div class="settings-menu">
            ${menuItems.map((item, idx) => `
              <button class="settings-menu-btn" data-section="${item.id}">
                <div class="icon-wrap">${item.icon}</div>
                <div style="flex: 1;">
                    <div style="font-weight: 600;">${item.label.split(' ').slice(1).join(' ')}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">Manage ${item.label.split(' ').slice(1).join(' ').toLowerCase()}</div>
                </div>
                <span class="chevron">❯</span>
              </button>
            `).join('')}
          </div>

          <div class="settings-content" id="settings-content-area">
            ${activeSection ? `
              <button id="settings-back-btn" style="display: flex; align-items: center; gap: 0.5rem; border: none; background: transparent; color: var(--accent-primary); font-weight: 700; padding: 0; margin-bottom: 2rem; cursor: pointer; font-size: 1rem;">
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"/></svg>
                Back
              </button>
              ${renderSection(activeSection)}
            ` : ''}
          </div>
        </div>
      </div>
    `

    container.querySelectorAll('.settings-menu-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeSection = btn.dataset.section
        renderPage()
      })
    })

    if (activeSection) {
      container.querySelector('#settings-back-btn')?.addEventListener('click', () => {
        activeSection = null
        renderPage()
      })
    }

    attachListeners()
  }

  const attachListeners = () => {
        const contentArea = document.getElementById('settings-content-area')
        if (!contentArea || !activeSection) return

        switch (activeSection) {
            case 'password': setupPasswordListeners(user); break
            case 'feedback': setupFeedbackListeners(user); break
            case 'guarantor': setupGuarantorListeners(user, cooperativeId); break
            case 'advice': setupAdviceListeners(user, cooperativeId); break
            case 'cooperative': setupCooperativeListeners(user, cooperativeId, container); break
            case 'banks': setupBankListeners(user, cooperativeId); break
            case 'enterprises': setupEnterpriseListeners(user, cooperativeId); break
            case 'users': setupUserManagementListeners(user, cooperativeId); break
            case 'transactionTypes': setupTransactionTypesListeners(user, cooperativeId); break
            case 'db': setupDbManagementListeners(user, cooperativeId, container); break
            case 'restore': setupHardRestoreListeners(user, cooperativeId, (section) => {
                activeSection = section;
                renderPage();
            }); break
            case 'about': setupAboutListeners(); break
            case 'theme': setupThemeListeners(); break
            case 'display': setupDisplayListeners(); break
            case 'subscription': setupSubscriptionListeners(user, cooperativeId); break
        }
    }

  renderPage()
}
