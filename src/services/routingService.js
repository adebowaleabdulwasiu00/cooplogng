import { state } from '../state/appState.js'

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

  document.body.className = `tab-${tab}`
}

function updateNavSelection() {
  const currentHash = window.location.hash.substring(1)
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
}

export { handleRouting, updateNavSelection }
