import { state } from '../state/appState.js'

let _pingInterval = null
const PING_INTERVAL = 30000

async function checkConnectivity() {
  const tryPing = async (url, timeoutMs = 5000) => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    await fetch(url, { mode: 'no-cors', signal: ctrl.signal })
    clearTimeout(t)
  }

  // Endpoints ordered by reliability: Google CDN, then general internet
  const endpoints = [
    'https://www.gstatic.com/generate_204',
    'https://www.google.com/generate_204',
    'https://cdn.jsdelivr.com/favicon.ico',
    'https://httpbin.org/get',
  ]

  for (const url of endpoints) {
    try {
      await tryPing(url)
      if (!state.isOnline) {
        state.isOnline = true
        state.isSyncing = false
        _updateNetworkIndicator()
      }
      return
    } catch {
    }
  }

  // All pings failed — trust navigator.onLine as a safety net.
  // navigator.onLine is reliable for detecting *loss* of connectivity;
  // false negatives happen on captive portals but those are rare for
  // API-only apps like this.
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

export { checkConnectivity, startConnectivityCheck, networkIndicatorClass, networkIndicatorLabel, networkIndicatorIcon, _updateNetworkIndicator }
