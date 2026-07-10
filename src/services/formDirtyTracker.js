import { state } from '../state/appState.js'

let _lastInteractionTs = Date.now()
window.__isFormDirty = false

window.addEventListener('mousemove', () => _lastInteractionTs = Date.now(), { passive: true })
window.addEventListener('keydown', () => _lastInteractionTs = Date.now(), { passive: true })
window.addEventListener('scroll', () => _lastInteractionTs = Date.now(), { passive: true })
window.addEventListener('mousedown', () => _lastInteractionTs = Date.now(), { passive: true })
window.addEventListener('touchstart', () => _lastInteractionTs = Date.now(), { passive: true })
window.addEventListener('click', () => _lastInteractionTs = Date.now(), { passive: true })

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

window.addEventListener('click', (e) => {
  const cleared = e.target.closest('#clear-log-form-btn, #clear-recon-form-btn, #cancel-btn, #cancel-selection-btn')
  if (cleared) {
    window.__isFormDirty = false
  }
})

function isFormDirty() {
  if (window.__isFormDirty) return true
  const dirtyInput = document.querySelector('input[data-dirty="true"], textarea[data-dirty="true"], select[data-dirty="true"]')
  return !!dirtyInput
}

function canPerformRefresh() {
  if (!state.welcomeUser) return false

  const activeEl = document.activeElement
  const isTyping = activeEl && (
    activeEl.tagName === 'INPUT' || 
    activeEl.tagName === 'TEXTAREA' || 
    activeEl.tagName === 'SELECT' || 
    activeEl.isContentEditable
  )
  if (isTyping) return false

  const isIdle = (Date.now() - _lastInteractionTs) > 15000
  if (!isIdle) return false

  const isModalOpen = !!(
    document.getElementById('member-details-modal') || 
    document.getElementById('md-img-preview') || 
    document.querySelector('.modal-overlay.open') ||
    document.querySelector('#modal-overlay.open')
  )
  if (isModalOpen) return false

  const hasSelections = !!document.querySelector('table input[type="checkbox"]:checked')
  if (hasSelections) return false

  if (isFormDirty()) return false

  return true
}

export { isFormDirty, canPerformRefresh }
