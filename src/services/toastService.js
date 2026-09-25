export function showToast(message, type = "info") {
  // Ensure the toast container exists in the DOM
  let container = document.getElementById('premium-toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'premium-toast-container'
    container.style.position = 'fixed'
    container.style.bottom = '2rem'
    container.style.right = '2rem'
    // Topmost layer: must clear every modal/overlay in the app (modals go up to
    // inline z-index 999999999), so toasts never end up buried under a blur
    // screen. pointer-events none on the tray keeps it from blocking clicks.
    container.style.zIndex = '2147483647'
    container.style.pointerEvents = 'none'
    container.style.display = 'flex'
    container.style.flexDirection = 'column'
    container.style.gap = '0.75rem'
    document.body.appendChild(container)
  }

  const toast = document.createElement('div')
  toast.className = `alert`
  toast.style.margin = '0'
  toast.style.boxShadow = 'var(--shadow-lg)'
  toast.style.pointerEvents = 'auto'
  if (type === 'success') {
    toast.style.background = 'var(--success-bg)'
    toast.style.color = 'var(--success)'
    toast.style.borderColor = 'var(--success)'
  }
  if (type === 'warning') {
    toast.style.background = 'var(--warning-bg)'
    toast.style.color = 'var(--warning)'
    toast.style.borderColor = 'var(--warning)'
  }
  if (type === 'error') {
    toast.style.background = 'var(--danger-bg)'
    toast.style.color = 'var(--danger)'
    toast.style.borderColor = 'var(--danger)'
  }
  
  toast.innerHTML = `<strong>${type.toUpperCase()}:</strong> ${message}`
  container.appendChild(toast)
  setTimeout(() => toast.remove(), 5000)
}
