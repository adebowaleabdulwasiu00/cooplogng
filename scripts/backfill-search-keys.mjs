/**
 * Backfill `_lower` search fields for case-insensitive login.
 *
 *  users:   username_lower, email_lower  (+ trims username, lowercases email)
 *  members: special_id_lower, email_lower, registration_no_str (+ trims special_id, lowercases email, normalizes phone)
 *
 * Usage:
 *   node scripts/backfill-search-keys.mjs            # live run
 *   node scripts/backfill-search-keys.mjs --dry-run  # report only, no writes
 *
 * Credentials: reads .env.local (VITE_FIREBASE_*) in project root.
 * Firestore rules already allow read:true + update with cooperative_id, so no admin key needed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');

function loadEnv() {
  const p = resolve(ROOT, '.env.local');
  if (!existsSync(p)) throw new Error('.env.local not found in project root');
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const env = loadEnv();
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
for (const [k, v] of Object.entries(firebaseConfig)) {
  if (!v) throw new Error(`Missing ${k} in .env.local`);
}

const { initializeApp } = await import('firebase/app');
const {
  getFirestore, collection, getDocs, updateDoc, doc,
  query, orderBy, limit, startAfter,
} = await import('firebase/firestore');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const lower = (v) => String(v ?? '').trim().toLowerCase();
const phone = (v) => {
  const c = String(v ?? '').replace(/\D/g, '');
  if (!c) return '';
  return c.length > 10 ? c.slice(-10) : c;
};

async function backfillCollection(collName, compute) {
  const BATCH = 400;
  const MAX_PAGES = 10000; // safety guard: 4M docs max, prevents any infinite loop
  let last = null;
  let scanned = 0, updated = 0, pages = 0;
  for (;;) {
    pages++;
    if (pages > MAX_PAGES) {
      console.log(`${collName}: STOPPED after ${MAX_PAGES} pages (safety guard). scanned=${scanned} updated=${updated}`);
      break;
    }
    const q = last
      ? query(collection(db, collName), orderBy('__name__'), startAfter(last), limit(BATCH))
      : query(collection(db, collName), orderBy('__name__'), limit(BATCH));
    const snap = await getDocs(q);
    if (snap.empty) {
      console.log(`${collName}: no more docs (page ${pages}). scanned=${scanned} updated=${updated}`);
      break;
    }
    for (const d of snap.docs) {
      scanned++;
      const data = d.data();
      const patch = compute(data);
      // drop no-ops
      const changes = Object.fromEntries(
        Object.entries(patch).filter(([k, v]) => data[k] !== v)
      );
      if (Object.keys(changes).length > 0) {
        if (DRY) {
          updated++;
          if (updated <= 10) console.log(`[dry] ${collName}/${d.id}`, changes);
        } else {
          await updateDoc(doc(db, collName, d.id), changes);
          updated++;
        }
      }
    }
    console.log(`${collName}: page ${pages} done — scanned ${scanned}, ${DRY ? 'would update' : 'updated'} ${updated}`);
    if (snap.size < BATCH) {
      console.log(`${collName}: FINISHED — last page had ${snap.size} docs (< ${BATCH}).`);
      break;
    }
    last = snap.docs[snap.docs.length - 1];
  }
  console.log(`${collName}: COMPLETE — scanned=${scanned} ${DRY ? 'would-update' : 'updated'}=${updated}`);
  return { scanned, updated };
}

console.log(`Backfill ${DRY ? '(DRY RUN)' : '(LIVE)'} on project ${firebaseConfig.projectId}`);

const users = await backfillCollection('users', (d) => {
  const patch = {};
  const username = String(d.username ?? '').trim();
  if (d.username !== username) patch.username = username;
  const ul = lower(username);
  if (ul && d.username_lower !== ul) patch.username_lower = ul;
  const email = d.email ? String(d.email).trim().toLowerCase() || null : (d.email ?? null);
  // normalize stored email to lowercase (emails are case-insensitive)
  if (d.email && email !== d.email) patch.email = email;
  const el = email ? lower(email) : null;
  if (el !== (d.email_lower ?? null) && (el || d.email_lower !== undefined)) patch.email_lower = el;
  else if (el && d.email_lower !== el) patch.email_lower = el;
  return patch;
});

const members = await backfillCollection('members', (d) => {
  const patch = {};
  const sid = d.special_id !== undefined && d.special_id !== null ? String(d.special_id).trim() : d.special_id;
  if (sid !== d.special_id) patch.special_id = sid;
  const sl = sid ? lower(sid) : '';
  if ((d.special_id_lower ?? '') !== sl) patch.special_id_lower = sl;
  const email = d.email ? String(d.email).trim().toLowerCase() || null : (d.email ?? null);
  if (d.email && email !== d.email) patch.email = email;
  const el = email ? lower(email) : null;
  if ((d.email_lower ?? null) !== el && (el || d.email_lower !== undefined)) patch.email_lower = el;
  const regStr = (d.registration_no !== undefined && d.registration_no !== null && d.registration_no !== '')
    ? lower(d.registration_no) : '';
  if ((d.registration_no_str ?? '') !== regStr && (regStr || d.registration_no_str !== undefined)) patch.registration_no_str = regStr;
  const mob = d.mobile ? phone(d.mobile) : d.mobile;
  if (mob !== undefined && mob !== d.mobile) patch.mobile = mob;
  return patch;
});

console.log('BACKFILL COMPLETE — script finished successfully.', { users, members });
process.exit(0);
