function setupPWAUpdateListener() {
  if ('serviceWorker' in navigator) {
    if (window.__hasReloaded) return;
    window.__hasReloaded = true;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!window.__hasReloaded) {
        window.__hasReloaded = true;
        window.location.reload();
      }
    });
    setTimeout(() => { window.__hasReloaded = false; }, 5000);
  }
}

export { setupPWAUpdateListener }
