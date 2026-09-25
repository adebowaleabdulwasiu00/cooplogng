function setupPWAUpdateListener() {
  if (!('serviceWorker' in navigator)) return;
  // Distinguish a first install (no previous controller) from a genuine
  // update. The SW uses skipWaiting() + clients.claim(), so the very first
  // visit fires controllerchange (null -> worker) — often seconds after load,
  // exactly while a new user is typing on the login form. That must never
  // reload; only a real update (old worker -> new worker) should.
  let hadControllerAtSetup = false;
  try { hadControllerAtSetup = !!navigator.serviceWorker.controller; } catch {}
  let reloading = false;
  const userIsTyping = () => {
    try {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return true;
      if (window.__isFormDirty) return true;
    } catch {}
    return false;
  };
  const safeReload = () => {
    if (reloading) return;
    // Never yank the page mid-typing — retry when idle instead.
    if (userIsTyping()) {
      setTimeout(safeReload, 5000);
      return;
    }
    // Loop-breaker: the in-memory `reloading` flag dies with the page, so
    // a churning SW version used to F5 forever. One SW-driven reload
    // per 60s per tab max; production one-reload-per-deploy is unaffected.
    try {
      const last = Number(sessionStorage.getItem('cooplog-sw-reloaded-ts') || 0);
      if (last && Date.now() - last < 60000) return;
      sessionStorage.setItem('cooplog-sw-reloaded-ts', String(Date.now()));
    } catch {}
    reloading = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtSetup) {
      // First install just claimed the page — adopt it silently, no reload.
      hadControllerAtSetup = true;
      return;
    }
    safeReload();
  });
}

export { setupPWAUpdateListener }
