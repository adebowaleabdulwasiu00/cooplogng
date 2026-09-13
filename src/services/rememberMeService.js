/**
 * rememberMeService.js � global "Remember me" for the login screen.
 *
 * Stores ONE device-wide identity in localStorage so the next visit opens
 * with the username pre-filled (and the cooperative pre-selected where
 * possible). The user then only types their password/PIN.
 *
 * Security: only the username + cooperative id/name are stored.
 * Passwords/PINs are NEVER stored locally.
 */

const KEY = 'cooplog-remember-me';

export function loadRememberedIdentity() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.username) return null;
    return {
      username: String(data.username),
      cooperativeId: data.cooperativeId ? String(data.cooperativeId) : '',
      cooperativeName: data.cooperativeName ? String(data.cooperativeName) : '',
    };
  } catch {
    return null;
  }
}

export function saveRememberedIdentity(username, cooperativeId, cooperativeName) {
  try {
    const u = String(username || '').trim();
    if (!u) {
      clearRememberedIdentity();
      return;
    }
    localStorage.setItem(KEY, JSON.stringify({
      username: u,
      cooperativeId: cooperativeId ? String(cooperativeId) : '',
      cooperativeName: cooperativeName ? String(cooperativeName) : '',
      updatedAt: Date.now(),
    }));
  } catch {
    // private mode etc. � remember-me simply won't persist
  }
}

export function clearRememberedIdentity() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
