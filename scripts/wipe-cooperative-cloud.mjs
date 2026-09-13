#!/usr/bin/env node
/**
 * wipe-cooperative-cloud.mjs
 * HARD-DELETES every Firestore document carrying cooperative_id === COOP_ID,
 * for one cooperative only. Keeps:
 *   - the whole cooperatives collection (never queried, never touched)
 *   - users docs whose username == 'admin'
 *   - the counters/{coopId} doc is DELETED so the receipt counter re-seeds
 *     from clean local data on next sync.
 *
 * Read discipline (every read is where(cooperative_id == COOP_ID)):
 *   - one collection listing (metadata), one query per collection.
 *   - single-field where() uses Firestore's automatic indexes — no composite
 *     index, no orderBy, no pagination cursors, no offset re-reads.
 *   - at this cooperative's scale (a few thousand docs) each collection is
 *     fetched in a single round trip: exactly 1 read per deleted doc, zero
 *     overhead reads. Nothing from other cooperatives is ever read.
 *   - no post-delete re-scan: batches are atomic; a failed batch aborts with
 *     a non-zero exit and re-running --execute is idempotent (matches only
 *     shrink), so no blanket second pass.
 *
 * Why Admin SDK: firestore.rules forbids client-side deletes
 * (allow delete: if false everywhere), so this bypasses rules with a
 * service-account key.
 *
 * Setup:
 *   1. Firebase console > Project settings > Service accounts >
 *      "Generate new private key" -> save as ./serviceAccountKey.json
 *      (NEVER commit this file — git-ignored.)
 *   2. cd scripts && npm install firebase-admin   (one-time)
 *   3. Preview:  node wipe-cooperative-cloud.mjs --dry-run
 *   4. Execute:  node wipe-cooperative-cloud.mjs --execute
 *
 * After wiping: re-import the fixed original.db in the app and sync —
 * the reconciler re-uploads everything clean. Keep other devices off the
 * app during the wipe; have them pull (or re-import) afterwards.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const COOP_ID = 'CG0nAXNIzK';
const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    join(dirname(fileURLToPath(import.meta.url)), 'serviceAccountKey.json');

if (!EXECUTE) console.log('DRY-RUN mode (nothing will be deleted). Add --execute to delete.\n');
if (!existsSync(KEY_PATH)) {
    console.error(`Service account key not found: ${KEY_PATH}`);
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS or place serviceAccountKey.json next to this script.');
    process.exit(1);
}

const adminNs = await import('firebase-admin');
const initializeApp = adminNs.initializeApp ?? adminNs.default?.initializeApp;
const certFn = adminNs.cert ?? adminNs.default?.cert;
const { getFirestore, FieldPath } = await import('firebase-admin/firestore');
initializeApp({ credential: certFn(JSON.parse(readFileSync(KEY_PATH, 'utf8'))) });
const db = getFirestore();

const SKIP_COLLECTIONS = new Set(['cooperatives']); // never listed for delete, never read
let keptAdmins = 0;
const byCollection = {};

for (const col of await db.listCollections()) {
    const colName = col.id;
    if (SKIP_COLLECTIONS.has(colName)) {
        console.log(`KEEP collection '${colName}' (untouched, not even read)`);
        continue;
    }
    // The ONLY read per collection: our coop's docs, nothing else.
    const snap = await db.collection(colName).where('cooperative_id', '==', COOP_ID).get();
    const refs = [];
    for (const d of snap.docs) {
        if (colName === 'users' && String(d.data().username || '').toLowerCase() === 'admin') {
            keptAdmins++;
            continue;
        }
        refs.push(d.ref);
    }
    byCollection[colName] = refs;
    console.log(`collection '${colName}': ${refs.length} docs ${EXECUTE ? 'to delete' : 'would be deleted'}`);
}

const allRefs = Object.values(byCollection).flat();
if (!EXECUTE) {
    console.log(`\nKept: cooperatives/* untouched, ${keptAdmins} admin user doc(s) kept.`);
    console.log('Re-run with --execute to delete. This cannot be undone.');
    process.exit(0);
}

const total = allRefs.length;
console.log(`\nDeleting ${total} docs in 400-doc batches...`);
let deleted = 0;
while (allRefs.length) {
    const batch = db.batch();
    const chunk = allRefs.splice(0, 400);
    for (const ref of chunk) batch.delete(ref);
    try {
        await batch.commit();
    } catch (err) {
        console.error(`\nBatch failed after ${deleted}/${total} deletes: ${err.message}`);
        console.error('Re-run --execute to resume (already-deleted docs will not re-match).');
        process.exit(1);
    }
    deleted += chunk.length;
    console.log(`  deleted ${deleted}/${total}...`);
}
console.log(`\nDone. Deleted ${deleted} docs. Kept cooperatives/* and ${keptAdmins} admin user(s).`);
console.log('Next: re-import the fixed original.db in the app and sync to re-upload clean data.');
