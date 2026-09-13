/**
 * normalize.js
 * Single source of truth for login-identifier normalization.
 * Firestore `==` is case-sensitive + type-sensitive, so every write
 * must store a deterministic `_lower` search field and every login
 * query must normalize input the same way.
 */

export function normalizeLower(val) {
  return String(val ?? '').trim().toLowerCase();
}

export function normalizeUsername(val) {
  return String(val ?? '').trim();
}
export function usernameKey(val) {
  return normalizeLower(val);
}

export function normalizeEmail(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim().toLowerCase();
  return s || null;
}

export function normalizePhone(val) {
  const cleaned = String(val ?? '').replace(/\D/g, '');
  if (!cleaned) return '';
  return cleaned.length > 10 ? cleaned.slice(-10) : cleaned;
}

export function normalizeSpecialId(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}
export function specialIdKey(val) {
  return normalizeLower(val);
}

export function normalizeRegNo(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}
export function regNoKey(val) {
  return normalizeLower(val);
}

/** Build the `_lower` search fields for a users doc. */
export function userSearchFields(doc) {
  return {
    username_lower: usernameKey(doc.username),
    email_lower: doc.email ? normalizeLower(doc.email) : null,
  };
}

/** Build the `_lower` search fields for a members doc. */
export function memberSearchFields(doc) {
  return {
    email_lower: doc.email ? normalizeLower(doc.email) : null,
    special_id_lower: doc.special_id ? specialIdKey(doc.special_id) : '',
    registration_no_str: doc.registration_no !== undefined && doc.registration_no !== null && doc.registration_no !== ''
      ? regNoKey(doc.registration_no)
      : '',
  };
}
