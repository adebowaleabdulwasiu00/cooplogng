/**
 * rememberMeService.js — global "Remember me" for the login screen.
 *
 * Stores ONE device-wide identity in localStorage so the next visit opens
 * with username + cooperative pre-filled AND the password/PIN pre-filled,
 * letting a returning user tap Next → Next → Sign In with no typing.
 *
 * Cleared when the user unticks "Remember me" or taps Log Out.
 *
 * Security note: the PIN/password is stored obfuscated (Base64, NOT
 * encryption) in localStorage at the user's explicit request for
 * convenience on a personal device. Anyone with device access can decode
 * it. Do NOT enable "Remember me" on shared devices.
 */

const KEY = 'cooplog-remember-me';

function encodeSecret(val) {
  try {
    return btoa(unescape(encodeURIComponent(String(val || ''))));
  } catch {
    return '';
  }
}

function decodeSecret(val) {
  try {
    if (!val) return '';
    return decodeURIComponent(escape(atob(String(val))));
  } catch {
    return '';
  }
}

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
      // Decoded for form pre-fill. Empty string when saved by older builds.
      password: data.passwordObf ? decodeSecret(data.passwordObf)
        : (data.password ? String(data.password) : ''),
    };
  } catch {
    return null;
  }
}

export function saveRememberedIdentity(username, cooperativeId, cooperativeName, password) {
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
      passwordObf: encodeSecret(password || ''),
      updatedAt: Date.now(),
    }));
  } catch {
    // private mode etc. — remember-me simply won't persist
  }
}

export function clearRememberedIdentity() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
