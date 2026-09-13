#!/usr/bin/env node
/**
 * fix-due-children-cloud.mjs
 * Finds auto-created dues children (-DUE-xx / -INCOME remittances) in
 * Firestore whose created_at/modified_at differ from their parent, aligns
 * them, and bumps sync_at (serverTimestamp) so devices pull the correction
 * on next delta sync.
 *
 * Read discipline: ONE query (remittance where cooperative_id == COOP_ID).
 * Parents resolve from that same snapshot — zero extra reads.
 *
 * Setup: same service-account key as wipe-cooperative-cloud.mjs
 *   Preview:  node fix-due-children-cloud.mjs --dry-run
 *   Apply:    node fix-due-children-cloud.mjs --execute
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const COOP_ID = 'CG0nAXNIzK';
const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    join(dirname(fileURLToPath(import.meta.url)), 'serviceAccountKey.json');

if (!EXECUTE) console.log('DRY-RUN mode (nothing will be written). Add --execute to apply.\n');
if (!existsSync(KEY_PATH)) {
    console.error(`Service account key not found: ${KEY_PATH}`);
    process.exit(1);
}

const adminNs = await import('firebase-admin');
const initializeApp = adminNs.initializeApp ?? adminNs.default?.initializeApp;
const certFn = adminNs.cert ?? adminNs.default?.cert;
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
initializeApp({ credential: certFn(JSON.parse(readFileSync(KEY_PATH, 'utf8'))) });
const db = getFirestore();

const norm = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && typeof v.toMillis === 'function') return `ts:${v.toMillis()}`;
    return String(v);
};
const isChild = (id, data) => {
    if (id.includes('-DUE-') || id.endsWith('-INCOME')) return true;
    const auto = data.autogen;
    const isAuto = auto === 1 || auto === '1' || auto === true;
    return isAuto && !!data.loan_id;
};

const snap = await db.collection('remittance').where('cooperative_id', '==', COOP_ID).get();
console.log(`fetched ${snap.size} remittance docs`);
const byId = new Map(snap.docs.map(d => [d.id, d.data()]));
const fixes = [];
for (const d of snap.docs) {
    if (!isChild(d.id, d.data())) continue;
    const parent = byId.get(String(d.data().loan_id));
    if (!parent) {
        console.log(`SKIP ${d.id}: parent ${d.data().loan_id} not in snapshot`);
        continue;
    }
    const cur = d.data();
    if (norm(cur.created_at) !== norm(parent.created_at) ||
        norm(cur.modified_at) !== norm(parent.modified_at)) {
        fixes.push({ ref: d.ref, id: d.id, created_at: parent.created_at, modified_at: parent.modified_at });
    }
}
console.log(`children needing alignment: ${fixes.length}`);
for (const f of fixes.slice(0, 15)) console.log(`  ${f.id}`);
if (fixes.length > 15) console.log(`  ...and ${fixes.length - 15} more`);

if (!EXECUTE) {
    console.log('\nRe-run with --execute to apply (sets parent timestamps + fresh sync_at).');
    process.exit(0);
}
let done = 0;
while (fixes.length) {
    const batch = db.batch();
    for (const f of fixes.splice(0, 400)) {
        batch.update(f.ref, {
            created_at: f.created_at,
            modified_at: f.modified_at,
            sync_at: FieldValue.serverTimestamp(),
        });
    }
    try {
        await batch.commit();
    } catch (err) {
        console.error(`\nBatch failed: ${err.message}. Re-run --execute to resume.`);
        process.exit(1);
    }
    done += 400;
    console.log(`  applied ~${done}...`);
}
console.log('\nDone. Devices will pull these corrections on next delta sync (sync_at bumped).');
