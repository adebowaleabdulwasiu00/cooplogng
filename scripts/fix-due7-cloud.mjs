#!/usr/bin/env node
/**
 * fix-due7-cloud.mjs
 * Applies the dues cleanup for 7 skipped parents DIRECTLY in Firestore:
 * merges each due detail into Ordinary Savings, deletes the due entry,
 * and creates the -ve DUE child + ve INCOME child (same IDs/shapes the
 * app itself creates, so a later local push merges instead of duplicating).
 *
 * r_id safety: children take real numbers from counters/{coopId} in ONE
 * transaction (created if missing, seeded from the cloud sane max), and the
 * counter is advanced past them — the app's push-time reservation then
 * continues from there with no collisions.
 * Every write bumps sync_at, so devices pull the corrections on next delta.
 *
 * Setup: same serviceAccountKey.json as the other scripts.
 *   Preview:  node fix-due7-cloud.mjs --dry-run
 *   Apply:    node fix-due7-cloud.mjs --execute
 * Skip this entirely if you wipe + re-import instead (re-import covers all).
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const COOP_ID = 'CG0nAXNIzK';
const IDS = ['CG0nA-20260816113708','CG0nA-20260809143430','CG0nA-00000000001223','CG0nA-00000000000067','CG0nA-00000000001451','CG0nA-00000000000451','CG0nA-00000000001287'];
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
const saneRid = (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 999999999 && String(v).trim() !== '' && /^\d+$/.test(String(v).trim());

// Resolve due/savings enterprise IDs by name (coop-scoped read)
const entSnap = await db.collection('enterprise').where('cooperative_id', '==', COOP_ID).get();
let DUE = null, SAV = null;
for (const d of entSnap.docs) {
    const n = String(d.data().account_name || '');
    if (d.data().compulsory_due === '1' || d.data().compulsory_due === 1) DUE = DUE || d.id;
    if (n === 'Ordinary Savings') SAV = d.id;
}
if (!DUE || !SAV) {
    console.error(`Cannot resolve enterprises (due=${DUE}, savings=${SAV}). Aborting.`);
    process.exit(1);
}
console.log(`due=${DUE} savings=${SAV}`);

const plans = [];
for (const pid of IDS) {
    const psnap = await db.collection('remittance').doc(pid).get();
    if (!psnap.exists) { console.log(`SKIP ${pid}: parent doc missing in cloud`); continue; }
    const p = psnap.data();
    const details = Array.isArray(p.details) ? p.details : [];
    const dueRows = details.filter(d => String(d.enterprise_id) === DUE && !d.is_deleted);
    const savRows = details.filter(d => String(d.enterprise_id) === SAV && !d.is_deleted);
    const dueTotal = dueRows.reduce((s, d) => s + parseFloat(d.amount || 0), 0);
    if (!(dueTotal > 0) || savRows.length === 0) {
        console.log(`SKIP ${pid}: due=${dueTotal} savRows=${savRows.length} (already clean or unexpected shape)`);
        continue;
    }
    const savTotal = savRows.reduce((s, d) => s + parseFloat(d.amount || 0), 0);
    const newDetails = details.filter(d => !(String(d.enterprise_id) === DUE && !d.is_deleted) && !(savRows.slice(1).includes(d)));
    const firstSav = newDetails.find(d => String(d.enterprise_id) === SAV && !d.is_deleted);
    firstSav.amount = String(savTotal + dueTotal);
    plans.push({ pid, p, newDetails, dueTotal });
}
console.log(`\nparents to fix: ${plans.length}`);
for (const pl of plans) console.log(`  ${pl.pid} due=${pl.dueTotal}`);
if (!EXECUTE || plans.length === 0) {
    if (!EXECUTE) console.log('\nRe-run with --execute to apply.');
    process.exit(0);
}

// Reserve real r_ids from the counter (init from cloud sane max if missing)
const counterRef = db.collection('counters').doc(COOP_ID);
const base = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    let next = null;
    if (snap.exists) {
        const v = snap.data()?.next_rid;
        if (Number.isInteger(v) && v >= 1) next = v;
    }
    if (next === null) {
        const all = await db.collection('remittance').where('cooperative_id', '==', COOP_ID).select('r_id').get();
        let mx = 0;
        for (const d of all.docs) {
            const v = d.data()?.r_id;
            if (saneRid(v) && Number(v) > mx) mx = Number(v);
        }
        next = mx + 1;
        console.log(`counter missing: seeding at cloud sane max + 1 = ${next}`);
    }
    tx.set(counterRef, { cooperative_id: COOP_ID, next_rid: next + plans.length * 2, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    return next;
});
console.log(`numbering ${plans.length * 2} children from r_id ${base}`);

const mkDet = (remId, amount, ts) => ({
    id: `${COOP_ID.slice(0, 5)}-${randomUUID()}`,
    cooperative_id: COOP_ID, remittance_id: remId, enterprise_id: DUE,
    amount: String(amount), auto_description: '', created_by: 'migration',
    created_at: ts, modified_by: 'migration', modified_at: ts, is_deleted: 0,
});
let n = base;
for (const pl of plans) {
    const ts = pl.p.created_at, mts = pl.p.modified_at;
    const dueId = `${pl.pid}-DUE-01`, incId = `${pl.pid}-INCOME`;
    const batch = db.batch();
    batch.update(db.collection('remittance').doc(pl.pid), {
        details: pl.newDetails, modified_at: mts, sync_at: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection('remittance').doc(dueId), {
        id: dueId, cooperative_id: COOP_ID, member_id: pl.p.member_id, amount: String(-pl.dueTotal),
        bank_name: 'Internal Transfer', description: 'Auto Internal Charges (Txn Charges)',
        transaction_type: 'Internal Transfer', category: 'Transfer', status: pl.p.status || 'Approved',
        remittance_date: pl.p.remittance_date, created_by: 'migration', created_at: ts,
        modified_by: 'migration', modified_at: mts, is_deleted: 0, r_id: n++,
        autogen: 1, loan_id: pl.pid, details: [mkDet(dueId, -pl.dueTotal, ts)],
        sync_at: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection('remittance').doc(incId), {
        id: incId, cooperative_id: COOP_ID, member_id: '0000000000', amount: String(pl.dueTotal),
        bank_name: 'Internal Transfer', description: 'Auto Other Income (Dues & Penalties)',
        transaction_type: 'Other Income', category: 'Other Income', status: pl.p.status || 'Approved',
        remittance_date: pl.p.remittance_date, created_by: 'migration', created_at: ts,
        modified_by: 'migration', modified_at: mts, is_deleted: 0, r_id: n++,
        autogen: 1, loan_id: pl.pid, details: [mkDet(incId, pl.dueTotal, ts)],
        sync_at: FieldValue.serverTimestamp(),
    });
    try {
        await batch.commit();
        console.log(`  fixed ${pl.pid}`);
    } catch (err) {
        console.error(`  FAILED ${pl.pid}: ${err.message} (re-run --execute to resume)`);
        process.exit(1);
    }
}
console.log('\nDone. Devices pull these on next delta sync (sync_at bumped).');
