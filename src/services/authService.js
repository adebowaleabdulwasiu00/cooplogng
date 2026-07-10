import { getDb, doc, getDoc, collection, query, where, getDocs, limit, updateDoc } from '../firebase.js'
import { isNotDeleted } from './dataService.js'
import { hashPassword } from '../utils/formatters.js'

export async function discoverLoginCooperatives(username) {
  const db = getDb()
  const rawInput = String(username || '').trim();
  const normalizedInput = rawInput.toLowerCase();
  const normalizedInputNum = !isNaN(parseInt(normalizedInput, 10)) ? parseInt(normalizedInput, 10) : null;
  
  if (!normalizedInput) return [];

  const cooperativeIds = new Set();

  // Generate common case variations for case-insensitive matching
  // Firestore '==' is case-sensitive, so we try the most likely variants
  const caseVariants = [
    normalizedInput,                                                        // lowercase
    normalizedInput.charAt(0).toUpperCase() + normalizedInput.slice(1),     // Title case
    normalizedInput.toUpperCase(),                                          // UPPERCASE
  ];
  const uniqueVariants = [...new Set(caseVariants)];

  // Users: query by username with each case variant
  const userQueries = uniqueVariants.map(v =>
    getDocs(query(collection(db, 'users'), where('username', '==', v), limit(10)))
  );
  // Also check email with the raw lowercase input
  userQueries.push(getDocs(query(collection(db, 'users'), where('email', '==', normalizedInput), limit(10))));

  const userSnaps = await Promise.all(userQueries);
  for (const snap of userSnaps) {
    for (const doc of snap.docs) {
      const data = doc.data();
      if (isNotDeleted(data)) {
        const storedUsername = String(data.username || '').toLowerCase();
        const storedEmail = String(data.email || '').toLowerCase();
        if (storedUsername === normalizedInput || storedEmail === normalizedInput) {
          cooperativeIds.add(data.cooperative_id);
        }
      }
    }
  }

  // Members: query by mobile, registration_no, special_id with each case variant
  const memberQueries = [];
  for (const v of uniqueVariants) {
    memberQueries.push(getDocs(query(collection(db, 'members'), where('mobile', '==', v), limit(10))));
    memberQueries.push(getDocs(query(collection(db, 'members'), where('registration_no', '==', v), limit(10))));
    memberQueries.push(getDocs(query(collection(db, 'members'), where('special_id', '==', v), limit(10))));
    memberQueries.push(getDocs(query(collection(db, 'members'), where('email', '==', v), limit(10))));
  }
  // Also query numeric registration_no if applicable
  if (normalizedInputNum !== null) {
    memberQueries.push(getDocs(query(collection(db, 'members'), where('registration_no', '==', normalizedInputNum), limit(10))));
  }

  const memberSnaps = await Promise.all(memberQueries);
  const seenMemberIds = new Set();
  for (const snap of memberSnaps) {
    for (const doc of snap.docs) {
      if (seenMemberIds.has(doc.id)) continue;
      seenMemberIds.add(doc.id);
      const data = doc.data();
      if (isNotDeleted(data)) {
        const fieldsToCheck = [
          String(data.mobile || ''),
          String(data.registration_no || ''),
          String(data.special_id || ''),
          String(data.email || '')
        ];
        const matches = fieldsToCheck.some(field => {
          const fieldLower = field.toLowerCase();
          return fieldLower === normalizedInput ||
                 (normalizedInputNum !== null && String(field) === String(normalizedInputNum));
        });
        if (matches) {
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
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return [];

  const cooperativeIds = new Set();

  const [usersSnap, membersSnap] = await Promise.all([
    getDocs(query(collection(db, 'users'), where('email', '==', normalizedEmail), limit(5))),
    getDocs(query(collection(db, 'members'), where('email', '==', normalizedEmail), limit(5)))
  ]);

  usersSnap.docs.forEach(doc => {
    const data = doc.data();
    if (isNotDeleted(data)) {
      cooperativeIds.add(data.cooperative_id);
    }
  });

  membersSnap.docs.forEach(doc => {
    const data = doc.data();
    if (isNotDeleted(data)) {
      cooperativeIds.add(data.cooperative_id);
    }
  });

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
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedCooperativeId = String(cooperativeId || '').trim();

  if (!normalizedEmail || !normalizedCooperativeId) return null;

  const [usersSnap, membersSnap] = await Promise.all([
    getDocs(query(collection(db, 'users'), where('cooperative_id', '==', normalizedCooperativeId))),
    getDocs(query(collection(db, 'members'), where('cooperative_id', '==', normalizedCooperativeId)))
  ]);

  let foundDoc = null;
  let collectionName = '';

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    if (isNotDeleted(data)) {
      const storedEmail = String(data.email || '').toLowerCase();
      if (storedEmail === normalizedEmail) {
        foundDoc = { id: doc.id, ...data };
        collectionName = 'users';
        break;
      }
    }
  }

  if (!foundDoc) {
    for (const doc of membersSnap.docs) {
      const data = doc.data();
      if (isNotDeleted(data)) {
        const storedEmail = String(data.email || '').toLowerCase();
        if (storedEmail === normalizedEmail) {
          foundDoc = { id: doc.id, ...data };
          collectionName = 'members';
          break;
        }
      }
    }
  }

  if (foundDoc) {
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
          last_login: lastLoginStr,
          login_count: newCount
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
      userDoc: foundDoc,
      collection: collectionName
    }
  }
  return null;
}

export async function validateLogin(username, password, cooperativeId) {
  const db = getDb()
  const normalizedInput = String(username || '').trim().toLowerCase();
  const normalizedInputNum = !isNaN(parseInt(normalizedInput, 10)) ? parseInt(normalizedInput, 10) : null;
  const normalizedPassword = String(password || '');
  const normalizedCooperativeId = String(cooperativeId || '').trim();

  if (!normalizedInput || !normalizedPassword || !normalizedCooperativeId) return null;

  const hashedInput = await hashPassword(normalizedPassword);

  // Get all users and members for the cooperative
  const [usersSnap, membersSnap] = await Promise.all([
    getDocs(query(collection(db, 'users'), where('cooperative_id', '==', normalizedCooperativeId))),
    getDocs(query(collection(db, 'members'), where('cooperative_id', '==', normalizedCooperativeId)))
  ]);

  let foundDoc = null;
  let collectionName = '';

  // Check users first
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    if (isNotDeleted(data)) {
      const storedUsername = String(data.username || '').toLowerCase();
      const storedEmail = String(data.email || '').toLowerCase();
      if (storedUsername === normalizedInput || storedEmail === normalizedInput) {
        foundDoc = { id: doc.id, ...data };
        collectionName = 'users';
        break;
      }
    }
  }

  // If not found in users, check members
  if (!foundDoc) {
    for (const doc of membersSnap.docs) {
      const data = doc.data();
      if (isNotDeleted(data)) {
        const fieldsToCheck = [
          String(data.mobile || ''),
          String(data.registration_no || ''),
          String(data.special_id || ''),
          String(data.email || '')
        ];
        const matches = fieldsToCheck.some(field => {
          const fieldLower = field.toLowerCase();
          return fieldLower === normalizedInput || 
                 (normalizedInputNum !== null && String(field) === String(normalizedInputNum));
        });
        if (matches) {
          foundDoc = { id: doc.id, ...data };
          collectionName = 'members';
          break;
        }
      }
    }
  }

  if (foundDoc) {
    const stored = foundDoc.password_hash || '';
    const isMatch = (stored === normalizedPassword) || (stored === hashedInput);
    const isHash = /^[a-f0-9]{64}$/i.test(stored);

    if (isMatch) {
      if (normalizedPassword.length < 6 || !isHash) {
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
            last_login: lastLoginStr,
            login_count: newCount
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
        userDoc: foundDoc,
        collection: collectionName
      }
    }
  }
  return null;
}