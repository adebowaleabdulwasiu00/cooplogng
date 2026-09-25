import { renderDevAuditSection, setupDevAuditListeners } from './settings/devAudit.js'
import { renderFirestoreManagementSection, setupFirestoreManagementListeners } from './settings/firestoreManagement.js'
import { renderDbManagementSection, setupDbManagementListeners } from './settings/dbManagement.js'
import * as statePersist from '../services/statePersistence.js'

export async function renderDevSettings(container, user) {
  let activeSection = statePersist.load('dev-settings-section') || null

  const menuItems = [
    { id: 'db', label: 'DB Management', icon: '📁', desc: 'Export, import & sync queue' },
    { id: 'firestore', label: 'Firestore Management', icon: '☁️', desc: 'Manage cloud Firestore data' },
    { id: 'devaudit', label: 'Dev. Audit', icon: '🛠', desc: 'Txn charges fix & description backfill' }
  ]

  if (window.innerWidth >= 1000 && menuItems.length > 0) {
    activeSection = menuItems[0].id
  }

  const renderSection = (sectionId) => {
    const area = document.createElement('div')
    switch (sectionId) {
      case 'devaudit': renderDevAuditSection(area); break
      case 'firestore': renderFirestoreManagementSection(area); break
      case 'db': renderDbManagementSection(area); break
      default: area.innerHTML = '<p style="color: var(--text-muted);">Section not found.</p>'
    }
    return area
  }

  const renderContent = () => {
    const showMenu = !activeSection
    const isDesktop = window.innerWidth >= 1000
    const menuEl = container.querySelector('.dev-settings-menu')
    const headerEl = container.querySelector('.page-header')
    const contentArea = container.querySelector('#dev-settings-content-area')

    if (!contentArea) { renderPage(); return }

    if (menuEl) menuEl.style.display = (showMenu || isDesktop) ? '' : 'none'
    if (headerEl) headerEl.style.display = (showMenu || isDesktop) ? '' : 'none'

    contentArea.innerHTML = `
      ${activeSection ? `
        ${!isDesktop ? `
        <button id="dev-settings-back-btn" style="display: flex; align-items: center; gap: 0.5rem; border: none; background: transparent; color: var(--accent-primary); font-weight: 700; padding: 0; margin-bottom: 2rem; cursor: pointer; font-size: 1rem;">
          <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"/></svg>
          Back
        </button>
        ` : ''}
        <div id="dev-section-host"></div>
      ` : ''}
    `

    const host = contentArea.querySelector('#dev-section-host')
    if (host && activeSection) host.appendChild(renderSection(activeSection))

    container.querySelector('#dev-settings-back-btn')?.addEventListener('click', () => {
      activeSection = null
      statePersist.save('dev-settings-section', null)
      renderContent()
    })

    container.querySelectorAll('.dev-settings-menu-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.section === activeSection)
    })

    attachListeners()
  }

  const renderPage = () => {
    container.innerHTML = `
      <style>
        .dev-settings-layout {
          max-width: 800px;
          margin: 0 auto;
          min-height: 500px;
        }
        .dev-settings-menu {
          display: flex;
          flex-direction: column;
          background: var(--bg-card);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-sm);
          padding: 0.5rem;
          border: 1px solid var(--border-light);
        }
        .dev-settings-menu-btn {
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
        .dev-settings-menu-btn:last-child { border-bottom: none; }
        .dev-settings-menu-btn:hover {
          background: var(--bg-secondary);
        }
        .dev-settings-menu-btn .icon-wrap {
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
        .dev-settings-menu-btn:hover .icon-wrap {
          transform: scale(1.1);
          background: var(--accent-soft);
        }
        .dev-settings-menu-btn .chevron {
          margin-left: auto;
          color: var(--text-muted);
          opacity: 0.5;
        }
        .dev-settings-content {
          background: var(--bg-card);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-sm);
          padding: 2rem;
          border: 1px solid var(--border-light);
        }
        @media (min-width: 1000px) {
          .dev-settings-layout {
            display: grid;
            grid-template-columns: 290px minmax(0, 1fr);
            gap: 1.5rem;
            max-width: none;
            margin: 0;
            align-items: start;
          }
          .dev-settings-menu {
            position: sticky;
            top: 1rem;
            max-height: calc(100vh - 2rem);
            overflow-y: auto;
          }
          .dev-settings-menu-btn.active {
            background: var(--accent-soft);
          }
          .dev-settings-menu-btn.active .icon-wrap {
            background: var(--accent-primary);
            color: #fff;
          }
          .dev-settings-content {
            min-height: 500px;
          }
          .page-header {
            max-width: none !important;
            margin: 0 !important;
          }
        }
        @media (max-width: 999px) {
          .dev-settings-content {
            padding: 1.25rem !important;
            border-radius: var(--radius-xl);
          }
        }
        .dev-settings-content h3 {
          margin: 0 0 0.5rem 0;
          font-size: 1.5rem;
          color: var(--text-primary);
        }
        .dev-settings-content .section-desc {
          font-size: 0.95rem;
          color: var(--text-muted);
          margin-bottom: 2rem;
        }
      </style>

      <div class="page-header" style="max-width: 1100px; margin: 0 auto; padding: 2rem 1rem;">
        <h2 style="font-size: 2rem; font-weight: 800;">🛠 Dev. Settings</h2>
        <p class="subtitle">Developer tools and Firestore management.</p>
      </div>

      <div class="page-container" style="padding: ${window.innerWidth < 1000 ? '1rem' : '2rem'};">
        <div class="dev-settings-layout">
          <div class="dev-settings-menu">
            ${menuItems.map((item) => `
              <button class="dev-settings-menu-btn" data-section="${item.id}">
                <div class="icon-wrap">${item.icon}</div>
                <div style="flex: 1;">
                    <div style="font-weight: 600;">${item.label}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${item.desc}</div>
                </div>
                <span class="chevron">❯</span>
              </button>
            `).join('')}
          </div>

          <div class="dev-settings-content" id="dev-settings-content-area">
          </div>
        </div>
      </div>
    `

    container.querySelectorAll('.dev-settings-menu-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeSection = btn.dataset.section
        statePersist.save('dev-settings-section', activeSection)
        renderContent()
      })
    })

    if (activeSection) renderContent()
  }

  const attachListeners = () => {
    const contentArea = container.querySelector('#dev-settings-content-area')
    if (!contentArea || !activeSection) return

    switch (activeSection) {
      case 'devaudit': setupDevAuditListeners(user, user.cooperativeId); break
      case 'firestore': setupFirestoreManagementListeners(user); break
      case 'db': setupDbManagementListeners(user, user.cooperativeId, container); break
    }
  }

  renderPage()
}
