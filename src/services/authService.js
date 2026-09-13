import { getDb, doc, getDoc, collection, query, where, getDocs, limit, updateDoc, serverTimestamp } from '../firebase.js'
import { isNotDeleted } from './dataService.js'
import { hashPassword, isSha256Hex, needsForceChangeAfterMatch } from '../utils/formatters.js'
import { usernameKey, normalizePhone } from '../utils/normalize.js'

/** Run a Firestore query safely — missing-index errors return [] so login can fall back. */
async function qSafe(promise) {
  try {
    return await promise;
  } catch (e) {
    console.warn('[authService] query failed, falling back:', e?.message || e);
    return { docs: [] };
  }
}

const RATE_LIMIT_KEY = 'cooplog-login-attempts';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function getRateLimitKey(username, cooperativeId) {
    return `${username.toLowerCase()}|${cooperativeId}`;
}

export function checkRateLimit(username, cooperativeId) {
    try {
        const raw = localStorage.getItem(RATE_LIMIT_KEY);
        if (!raw) return { allowed: true, remaining: MAX_ATTEMPTS };
        const data = JSON.parse(raw);
        const key = getRateLimitKey(username, cooperativeId);
        const entry = data[key];
        if (!entry) return { allowed: true, remaining: MAX_ATTEMPTS };
        if (Date.now() > entry.lockoutUntil) {
            delete data[key];
            localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(data));
            return { allowed: true, remaining: MAX_ATTEMPTS };
        }
        const remaining = Math.max(0, MAX_ATTEMPTS - entry.count);
        return { allowed: entry.count < MAX_ATTEMPTS, remaining, lockoutUntil: entry.lockoutUntil };
    } catch {
        return { allowed: true, remaining: MAX_ATTEMPTS };
    }
}

export function recordFailedAttempt(username, cooperativeId) {
    try {
        const raw = localStorage.getItem(RATE_LIMIT_KEY);
        const data = raw ? JSON.parse(raw) : {};
        const key = getRateLimitKey(username, cooperativeId);
        const entry = data[key] || { count: 0, lockoutUntil: 0 };
        entry.count += 1;
        if (entry.count >= MAX_ATTEMPTS) {
            entry.lockoutUntil = Date.now() + LOCKOUT_MS;
        }
        data[key] = entry;
        localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(data));
    } catch { }
}

export function clearRateLimit(username, cooperativeId) {
    try {
        const raw = localStorage.getItem(RATE_LIMIT_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        const key = getRateLimitKey(username, cooperativeId);
        delete data[key];
        localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(data));
    } catch { }
}

function isLegacyOrWeakHash(storedHash) {
    // Pre-match check (no verified input yet): force when the flag is set,
    // when nothing is stored, or when the stored value is plain text.
    // Valid hashes defer to the post-match input evaluation in validateLogin.
    if (!storedHash) return true;
    if (!isSha256Hex(storedHash)) return true;
    return false;
}

function docForceFlagSet(foundDoc) {
    return foundDoc && foundDoc.force_password_change === true;
}

/** Resolve a cooperative's display name (best-effort; falls back to the id). */
async function fetchCooperativeName(db, cooperativeId) {
    try {
        const snap = await getDoc(doc(db, 'cooperatives', String(cooperativeId)));
        if (snap.exists()) {
            const data = snap.data();
            return data.full_name || data.short_name || String(cooperativeId);
        }
    } catch (e) {
        console.warn('[authService] Cooperative name lookup failed:', e?.message || e);
    }
    return String(cooperativeId);
}

export async function discoverLoginCooperatives(username) {
  const db = getDb()
  const key = usernameKey(username);
  if (!key) return [];

  const cooperativeIds = new Set();
  const collect = (snap) => {
    for (const d of snap.docs) {
      const data = d.data();
      if (isNotDeleted(data) && data.cooperative_id) cooperativeIds.add(data.cooperative_id);
    }
  };

  // Minimal indexed lookups on normalized `_lower` fields (single-field indexes, no composites).
  // Each query is bounded with limit() — a handful of reads instead of full scans.
  const phoneKey = normalizePhone(username);
  const queries = [
    qSafe(getDocs(query(collection(db, 'users'), where('username_lower', '==', key), limit(20)))),
    qSafe(getDocs(query(collection(db, 'users'), where('email_lower', '==', key), limit(10)))),
    qSafe(getDocs(query(collection(db, 'members'), where('special_id_lower', '==', key), limit(20)))),
    qSafe(getDocs(query(collection(db, 'members'), where('email_lower', '==', key), limit(10)))),
    qSafe(getDocs(query(collection(db, 'members'), where('registration_no_str', '==', key), limit(10)))),
  ];
  if (phoneKey) {
    queries.push(qSafe(getDocs(query(collection(db, 'members'), where('mobile', '==', phoneKey), limit(20)))));
  }
  const snaps = await Promise.all(queries);
  snaps.forEach(collect);

  // Transitional fallback for docs written before the backfill ran (no `_lower` fields yet).
  // Bounded legacy lookups — still limit()ed, never a full collection scan.
  if (cooperativeIds.size === 0) {
    const raw = String(username || '').trim();
    const variants = [...new Set([raw.toLowerCase(), raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase(), raw.toUpperCase()])];
    const legacy = [];
    for (const v of variants) {
      legacy.push(qSafe(getDocs(query(collection(db, 'users'), where('username', '==', v), limit(5)))));
      legacy.push(qSafe(getDocs(query(collection(db, 'members'), where('mobile', '==', v), limit(5)))));
      legacy.push(qSafe(getDocs(query(collection(db, 'members'), where('registration_no', '==', v), limit(5)))));
      legacy.push(qSafe(getDocs(query(collection(db, 'members'), where('special_id', '==', v), limit(5)))));
    }
    legacy.push(qSafe(getDocs(query(collection(db, 'users'), where('email', '==', key), limit(5)))));
    const legacySnaps = await Promise.all(legacy);
    for (const snap of legacySnaps) {
      for (const d of snap.docs) {
        const data = d.data();
        if (!isNotDeleted(data) || !data.cooperative_id) continue;
        // Verify case-insensitively client-side before accepting legacy match
        const fields = [data.username, data.email, data.mobile, data.registration_no, data.special_id]
          .map(f => String(f ?? '').toLowerCase());
        if (fields.includes(key) || (phoneKey && String(data.mobile ?? '') === phoneKey)) {
          cooperativeIds.add(data.cooperative_id);
        }
      }
    }
  }

  const cooperatives = await fetchCooperativeNames([...cooperativeIds]);
  return cooperatives.sort((left, right) => left.name.localeCompare(right.name));
}

export async function discoverLoginCooperativesByEmail(email) {
  const db = getDb()
  const key = usernameKey(email);
  if (!key) return [];

  const cooperativeIds = new Set();
  const [usersSnap, membersSnap] = await Promise.all([
    qSafe(getDocs(query(collection(db, 'users'), where('email_lower', '==', key), limit(10)))),
    qSafe(getDocs(query(collection(db, 'members'), where('email_lower', '==', key), limit(10)))),
  ]);

  for (const snap of [usersSnap, membersSnap]) {
    for (const d of snap.docs) {
      const data = d.data();
      if (isNotDeleted(data) && data.cooperative_id) cooperativeIds.add(data.cooperative_id);
    }
  }
  // Legacy fallback (pre-backfill docs without email_lower)
  if (cooperativeIds.size === 0) {
    const [lu, lm] = await Promise.all([
      qSafe(getDocs(query(collection(db, 'users'), where('email', '==', key), limit(5)))),
      qSafe(getDocs(query(collection(db, 'members'), where('email', '==', key), limit(5)))),
    ]);
    for (const snap of [lu, lm]) {
      for (const d of snap.docs) {
        const data = d.data();
        if (isNotDeleted(data) && String(data.email || '').toLowerCase() === key && data.cooperative_id) {
          cooperativeIds.add(data.cooperative_id);
        }
      }
    }
  }

  const cooperatives = await fetchCooperativeNames([...cooperativeIds]);
  return cooperatives.sort((left, right) => left.name.localeCompare(right.name));
}

export async function searchAllCooperatives(searchTerm) {
  const db = getDb()
  const cooperativesSnap = await getDocs(collection(db, 'cooperatives'))
  const term = String(searchTerm || '').toLowerCase()
  
  return cooperativesSnap.docs
    .filter(doc => {
      const data = doc.data()
      const name = String(data.full_name || data.short_name || '').toLowerCase()
      return name.includes(term)
    })
    .map(doc => ({
      id: doc.id,
      name: doc.data().full_name || doc.data().short_name || doc.id
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

const COOP_CACHE_KEY = 'cooplog-coop-names';
const COOP_CACHE_TTL = 300_000; // 5 minutes

function loadCachedCooperativeNames() {
  try {
    const raw = localStorage.getItem(COOP_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (Date.now() - cached.ts > COOP_CACHE_TTL) {
      localStorage.removeItem(COOP_CACHE_KEY);
      return null;
    }
    return cached.data;
  } catch { return null }
}

function saveCachedCooperativeNames(data) {
  try {
    localStorage.setItem(COOP_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* quota exceeded – ignore */ }
}

async function fetchCooperativeNames(ids) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];

  // Check cache for hit
  const cached = loadCachedCooperativeNames();
  const cacheMap = cached ? new Map(cached.map(c => [c.id, c])) : new Map();
  const missing = uniqueIds.filter(id => !cacheMap.has(id));

  if (missing.length > 0) {
    const db = getDb()
    const fetched = await Promise.all(missing.map(async (id) => {
      const docRef = doc(db, 'cooperatives', String(id))
      const docSnap = await getDoc(docRef)
      const data = docSnap.exists() ? docSnap.data() : {}
      return { id, name: data.full_name || data.short_name || id }
    }));
    for (const c of fetched) cacheMap.set(c.id, c);
    saveCachedCooperativeNames([...cacheMap.values()]);
  }

  return uniqueIds.map(id => cacheMap.get(id)).filter(Boolean);
}

export async function validateGoogleLogin(email, cooperativeId) {
  const db = getDb()
  const key = usernameKey(email);
  const normalizedCooperativeId = String(cooperativeId || '').trim();

  if (!key || !normalizedCooperativeId) return null;

  // Minimal: 2 indexed lookups instead of downloading the whole cooperative.
  const [usersSnap, membersSnap] = await Promise.all([
    qSafe(getDocs(query(
      collection(db, 'users'),
      where('cooperative_id', '==', normalizedCooperativeId),
      where('email_lower', '==', key),
      limit(2)
    ))),
    qSafe(getDocs(query(
      collection(db, 'members'),
      where('cooperative_id', '==', normalizedCooperativeId),
      where('email_lower', '==', key),
      limit(2)
    ))),
  ]);

  let foundDoc = null;
  let collectionName = '';

  for (const d of usersSnap.docs) {
    const data = d.data();
    if (isNotDeleted(data) && String(data.email || '').toLowerCase() === key) {
      foundDoc = { id: d.id, ...data };
      collectionName = 'users';
      break;
    }
  }

  if (!foundDoc) {
    for (const d of membersSnap.docs) {
      const data = d.data();
      if (isNotDeleted(data) && String(data.email || '').toLowerCase() === key) {
        foundDoc = { id: d.id, ...data };
        collectionName = 'members';
        break;
      }
    }
  }

  // Legacy fallback for pre-backfill docs without email_lower
  if (!foundDoc) {
    const [lu, lm] = await Promise.all([
      qSafe(getDocs(query(
        collection(db, 'users'),
        where('cooperative_id', '==', normalizedCooperativeId),
        where('email', '==', key),
        limit(2)
      ))),
      qSafe(getDocs(query(
        collection(db, 'members'),
        where('cooperative_id', '==', normalizedCooperativeId),
        where('email', '==', key),
        limit(2)
      ))),
    ]);
    for (const d of lu.docs) {
      const data = d.data();
      if (isNotDeleted(data) && String(data.email || '').toLowerCase() === key) {
        foundDoc = { id: d.id, ...data };
        collectionName = 'users';
        break;
      }
    }
    if (!foundDoc) {
      for (const d of lm.docs) {
        const data = d.data();
        if (isNotDeleted(data) && String(data.email || '').toLowerCase() === key) {
          foundDoc = { id: d.id, ...data };
          collectionName = 'members';
          break;
        }
      }
    }
  }

  if (foundDoc) {
    clearRateLimit(key, normalizedCooperativeId);

    const stored = foundDoc.password_hash || '';
    // Google flow has no typed password: force on explicit flag or non-hash storage.
    // Grandfathered legacy-complex hashes pass without a change.
    if (docForceFlagSet(foundDoc) || isLegacyOrWeakHash(stored)) {
      return { forceChange: true, userDoc: foundDoc, collection: collectionName };
    }

    const role = collectionName === 'members' ? 'member' : (foundDoc.role || 'user');
    const fullName = collectionName === 'members' 
      ? `${foundDoc.last_name || ''} ${foundDoc.first_name || ''} ${foundDoc.middle_name || ''}`.trim()
      : (foundDoc.full_name || foundDoc.username);

    if (collectionName === 'members') {
      const lastLoginStr = new Date().toISOString();
      const currentCount = parseInt(foundDoc.login_count || 0, 10);
      const newCount = currentCount + 1;
      
      foundDoc.last_login = lastLoginStr;
      foundDoc.login_count = newCount;
      
      try {
        const mRef = doc(db, 'members', foundDoc.id);
        await updateDoc(mRef, {
          cooperative_id: String(foundDoc.cooperative_id),
          last_login: lastLoginStr,
          login_count: newCount,
          sync_at: serverTimestamp()
        });
      } catch (err) {
        console.warn('[authService] Failed to update member login stats in Firestore:', err.message);
      }
    }

    return {
      memberId: collectionName === 'members' ? foundDoc.id : null,
      username: foundDoc.username || foundDoc.mobile || foundDoc.email,
      fullName: fullName || foundDoc.full_name || foundDoc.username || foundDoc.mobile || 'User',
      role,
      permissions: foundDoc.permissions || '',
      enterprises: foundDoc.enterprise_rights || foundDoc.enterprises || '',
      cooperativeId: foundDoc.cooperative_id,
      cooperativeName: await fetchCooperativeName(db, foundDoc.cooperative_id),
      userDoc: foundDoc,
      collection: collectionName
    }
  }
  return null;
}

export async function validateLogin(username, password, cooperativeId) {
  const db = getDb()
  const key = usernameKey(username);
  const normalizedPassword = String(password || '');
  const normalizedCooperativeId = String(cooperativeId || '').trim();

  if (!key || !normalizedPassword || !normalizedCooperativeId) return null;

  const rateLimit = checkRateLimit(key, normalizedCooperativeId);
  if (!rateLimit.allowed) {
    const minutes = Math.ceil((rateLimit.lockoutUntil - Date.now()) / 60000);
    throw new Error(`Too many attempts. Try again in ${minutes} minute(s).`);
  }

  const hashedInput = await hashPassword(normalizedPassword);
  const phoneKey = normalizePhone(username);

  // Minimal: targeted `username == input` style lookups (bounded, ~6 queries x limit 2).
  // NOTE: composite indexes on (cooperative_id + *_lower) are required — the
  // first failed run logs a Firebase console link to create them with one click.
  const qUsers = [
    qSafe(getDocs(query(
      collection(db, 'users'),
      where('cooperative_id', '==', normalizedCooperativeId),
      where('username_lower', '==', key),
      limit(2)
    ))),
    qSafe(getDocs(query(
      collection(db, 'users'),
      where('cooperative_id', '==', normalizedCooperativeId),
      where('email_lower', '==', key),
      limit(2)
    ))),
  ];
  const qMembers = [
    qSafe(getDocs(query(
      collection(db, 'members'),
      where('cooperative_id', '==', normalizedCooperativeId),
      where('special_id_lower', '==', key),
      limit(2)
    ))),
    qSafe(getDocs(query(
      collection(db, 'members'),
      where('cooperative_id', '==', normalizedCooperativeId),
      where('email_lower', '==', key),
      limit(2)
    ))),
    qSafe(getDocs(query(
      collection(db, 'members'),
      where('cooperative_id', '==', normalizedCooperativeId),
      where('registration_no_str', '==', key),
      limit(2)
    ))),
  ];
  if (phoneKey) {
    qMembers.push(qSafe(getDocs(query(
      collection(db, 'members'),
      where('cooperative_id', '==', normalizedCooperativeId),
      where('mobile', '==', phoneKey),
      limit(2)
    ))));
  }

  const [userSnaps, memberSnaps] = await Promise.all([
    Promise.all(qUsers),
    Promise.all(qMembers),
  ]);

  let foundDoc = null;
  let collectionName = '';

  const matchUser = (data) => {
    if (!isNotDeleted(data)) return false;
    return String(data.username || '').toLowerCase() === key ||
           String(data.email || '').toLowerCase() === key ||
           (data.username_lower && data.username_lower === key) ||
           (data.email_lower && data.email_lower === key);
  };
  const matchMember = (data) => {
    if (!isNotDeleted(data)) return false;
    if ((data.special_id_lower && data.special_id_lower === key) ||
        (data.email_lower && data.email_lower === key) ||
        (data.registration_no_str && data.registration_no_str === key)) return true;
    const fields = [
      String(data.mobile || ''),
      String(data.registration_no || '').toLowerCase(),
      String(data.special_id || '').toLowerCase(),
      String(data.email || '').toLowerCase(),
    ];
    return fields.includes(key) || (phoneKey && String(data.mobile || '') === phoneKey);
  };

  for (const snap of userSnaps) {
    for (const d of snap.docs) {
      const data = d.data();
      if (matchUser(data)) {
        foundDoc = { id: d.id, ...data };
        collectionName = 'users';
        break;
      }
    }
    if (foundDoc) break;
  }

  if (!foundDoc) {
    for (const snap of memberSnaps) {
      for (const d of snap.docs) {
        const data = d.data();
        if (matchMember(data)) {
          foundDoc = { id: d.id, ...data };
          collectionName = 'members';
          break;
        }
      }
      if (foundDoc) break;
    }
  }

  // Fallback when composite indexes aren't built yet (or pre-backfill docs):
  // global `_lower` lookups + client-side cooperative filter. Bounded, no full scans.
  if (!foundDoc) {
    const [gu, gm] = await Promise.all([
      Promise.all([
        qSafe(getDocs(query(collection(db, 'users'), where('username_lower', '==', key), limit(50)))),
        qSafe(getDocs(query(collection(db, 'users'), where('email_lower', '==', key), limit(20)))),
      ]),
      Promise.all([
        qSafe(getDocs(query(collection(db, 'members'), where('special_id_lower', '==', key), limit(50)))),
        qSafe(getDocs(query(collection(db, 'members'), where('email_lower', '==', key), limit(20)))),
        qSafe(getDocs(query(collection(db, 'members'), where('registration_no_str', '==', key), limit(20)))),
        ...(phoneKey ? [qSafe(getDocs(query(collection(db, 'members'), where('mobile', '==', phoneKey), limit(50))))] : []),
      ]),
    ]);
    for (const snap of gu) {
      for (const d of snap.docs) {
        const data = d.data();
        if (String(data.cooperative_id || '') !== normalizedCooperativeId) continue;
        if (matchUser(data)) {
          foundDoc = { id: d.id, ...data };
          collectionName = 'users';
          break;
        }
      }
      if (foundDoc) break;
    }
    if (!foundDoc) {
      for (const snap of gm) {
        for (const d of snap.docs) {
          const data = d.data();
          if (String(data.cooperative_id || '') !== normalizedCooperativeId) continue;
          if (matchMember(data)) {
            foundDoc = { id: d.id, ...data };
            collectionName = 'members';
            break;
          }
        }
        if (foundDoc) break;
      }
    }
  }

  if (foundDoc) {
    const stored = foundDoc.password_hash || '';
    const isMatch = stored === hashedInput || stored === normalizedPassword;

    if (isMatch) {
      clearRateLimit(key, normalizedCooperativeId);

      // Force-change is decided AFTER the password verifies, using the typed
      // input: 6-digit PINs pass, grandfathered legacy-complex passwords
      // (e.g. "Adex@1234") pass, plain-text non-legacy and old <6-digit
      // PINs (e.g. '1234') must change. Explicit flag always forces.
      if (needsForceChangeAfterMatch(stored, normalizedPassword, docForceFlagSet(foundDoc))) {
        return { forceChange: true, userDoc: foundDoc, collection: collectionName };
      }

      const role = collectionName === 'members' ? 'member' : (foundDoc.role || 'user');
      const fullName = collectionName === 'members' 
        ? `${foundDoc.last_name || ''} ${foundDoc.first_name || ''} ${foundDoc.middle_name || ''}`.trim()
        : (foundDoc.full_name || foundDoc.username);

      if (collectionName === 'members') {
        const lastLoginStr = new Date().toISOString();
        const currentCount = parseInt(foundDoc.login_count || 0, 10);
        const newCount = currentCount + 1;
        
        foundDoc.last_login = lastLoginStr;
        foundDoc.login_count = newCount;
        
        try {
          const mRef = doc(db, 'members', foundDoc.id);
          await updateDoc(mRef, {
            cooperative_id: String(foundDoc.cooperative_id),
            last_login: lastLoginStr,
            login_count: newCount,
            sync_at: serverTimestamp()
          });
        } catch (err) {
          console.warn('[authService] Failed to update member login stats in Firestore:', err.message);
        }
      }

      return {
        memberId: collectionName === 'members' ? foundDoc.id : null,
        username: foundDoc.username || foundDoc.mobile || foundDoc.email,
        fullName: fullName || foundDoc.full_name || foundDoc.username || foundDoc.mobile || 'User',
        role,
        permissions: foundDoc.permissions || '',
        enterprises: foundDoc.enterprise_rights || foundDoc.enterprises || '',
        cooperativeId: foundDoc.cooperative_id,
        cooperativeName: await fetchCooperativeName(db, foundDoc.cooperative_id),
        userDoc: foundDoc,
        collection: collectionName
      }
    }
  }

  recordFailedAttempt(key, normalizedCooperativeId);
  return null;
}