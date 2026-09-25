#!/usr/bin/env python3
"""
push_db_to_firestore.py
=======================
Reads a SQLite .db backup (exported from the app's IndexedDB) and pushes
each row to Firestore using the Firebase Admin SDK.

Architecture match:
  - Flat top-level collections (members/, remittance/, enterprise/, etc.)
  - Child tables embedded in parents:
      remittance_detail -> remittance.details[]
      loans             -> remittance.loans[]  (with guarantors nested)
      loan_guarantors   -> loans.guarantors[]  (via remittance.loans[])
      payment_advise    -> members.payment_advise[]
  - Document IDs = the `id` column from SQLite (same as IndexedDB key)
  - Timestamps converted to Firestore Timestamps
  - sync_at set to server_timestamp on every write

Setup:
  1. pip install firebase-admin
  2. Place serviceAccountKey.json in this directory (or set GOOGLE_APPLICATION_CREDENTIALS)
  3. Export a .db from the app (Settings -> DB Management -> Export Database)
  4. Run:
       python push_db_to_firestore.py --db path/to/backup.db --coop COOP_ID
       python push_db_to_firestore.py --db path/to/backup.db --coop COOP_ID --dry-run

Flags:
  --dry-run       Show what would be written, don't actually write
  --db PATH       Path to the .db file (default: ../currentdb.db)
  --coop ID       Cooperative ID to push (required)
  --batch-size N  Firestore batch size (default: 400)
"""

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from google.cloud.firestore import SERVER_TIMESTAMP

# ---------------------------------------------------------------------------
# Firebase Admin init
# ---------------------------------------------------------------------------
KEY_PATH = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or str(
    Path(__file__).parent / "serviceAccountKey.json"
)


def init_firestore():
    import firebase_admin
    from firebase_admin import credentials, firestore

    if not os.path.exists(KEY_PATH):
        print(f"ERROR: Service account key not found: {KEY_PATH}")
        print("Set GOOGLE_APPLICATION_CREDENTIALS or place serviceAccountKey.json next to this script.")
        sys.exit(1)

    cred = credentials.Certificate(KEY_PATH)
    firebase_admin.initialize_app(cred)
    return firestore.client()


# ---------------------------------------------------------------------------
# Schema — mirrors src/services/sqlite/constants.js
# ---------------------------------------------------------------------------
TABLE_COLUMNS = {
    "cooperatives": [
        "id", "full_name", "short_name", "contact_number", "email", "address",
        "logo_path", "coop_first_month", "subscription_key", "expiry_date",
        "created_at", "created_by", "modified_at", "modified_by", "deleted_at",
        "is_deleted", "is_synced", "sync_at",
    ],
    "users": [
        "id", "cooperative_id", "username", "username_lower", "password_hash",
        "force_password_change", "role", "permissions", "enterprise_rights",
        "subscriptionStatus", "expiry_date", "created_at", "created_by",
        "modified_at", "modified_by", "deleted_at", "is_synced", "is_deleted",
        "sync_at", "email", "email_lower", "firebase_uid",
    ],
    "loans": [
        "id", "cooperative_id", "member_id", "enterprise_id", "principal_amount",
        "issued_date", "due_date", "status", "notes", "created_at", "created_by",
        "modified_at", "modified_by", "deleted_at", "is_synced", "is_deleted",
        "sync_at", "admin_fee_id", "duration_months", "remittance_id", "approved_at",
    ],
    "loan_guarantors": [
        "id", "cooperative_id", "loan_id", "member_id", "guarantee_amount",
        "guarantor_approval", "created_at", "created_by", "modified_at",
        "modified_by", "deleted_at", "is_synced", "is_deleted", "sync_at",
    ],
    "members": [
        "id", "cooperative_id", "last_name", "first_name", "middle_name",
        "mobile", "address", "nok_name", "nok_mobile", "nok_address", "sex",
        "status", "image_path", "signature_path", "registration_no",
        "registration_no_str", "special_id", "special_id_lower", "bank_name",
        "account_number", "account_name", "date_joined", "account_manager",
        "created_at", "created_by", "modified_at", "modified_by", "deleted_at",
        "account_balance", "account_balance_total", "is_synced", "is_deleted",
        "sync_at", "password_hash", "force_password_change", "device_id",
        "ip_address", "country", "state", "city", "latitude", "longitude",
        "timezone", "browser", "browser_version", "operating_system",
        "screen_resolution", "device_type", "device_name", "subscriptionStatus",
        "expiry_date", "email", "email_lower", "firebase_uid", "last_login",
        "login_count",
    ],
    "bank": [
        "id", "cooperative_id", "bank_name", "account_name", "account_number",
        "branch_name", "swift_code", "is_visible", "created_by", "created_at",
        "modified_by", "modified_at", "is_deleted", "is_synced", "sync_at",
        "deleted_at",
    ],
    "enterprise": [
        "id", "cooperative_id", "account_name", "account_type", "parent_account",
        "loan_multiplier", "interest_rate", "interest_is_percent", "form_fee",
        "form_fee_is_percent", "admin_charge", "admin_charge_is_percent",
        "created_by", "created_at", "modified_by", "modified_at", "is_deleted",
        "is_synced", "sync_at", "deleted_at", "distribution_priority",
        "compulsory_due", "compulsory_amount", "revenue", "is_penalty",
    ],
    "remittance": [
        "id", "cooperative_id", "member_id", "amount", "bank_name",
        "description", "transaction_type", "category", "status",
        "remittance_date", "created_by", "created_at", "modified_by",
        "modified_at", "is_deleted", "is_synced", "sync_at", "deleted_at",
        "reconciliation_summary_id", "autogen", "loan_id",
        "isWithdrawalRequest", "isLoanRequest", "parent_remittance_id",
    ],
    "transaction_types": [
        "id", "cooperative_id", "transaction_type", "classification",
        "is_system_default", "is_active", "created_by", "created_at",
        "modified_by", "modified_at", "deleted_at", "is_deleted", "is_synced",
        "sync_at",
    ],
    "remittance_detail": [
        "id", "cooperative_id", "remittance_id", "enterprise_id", "amount",
        "auto_description", "loan_info", "created_by", "created_at",
        "modified_by", "modified_at", "is_synced", "is_deleted", "sync_at",
        "deleted_at",
    ],
    "notifications": [
        "id", "cooperative_id", "recipient_id", "viewed", "type", "title",
        "message", "data", "is_read", "created_at", "created_by", "modified_at",
        "is_synced", "is_deleted", "sync_at",
    ],
    "payment_advise": [
        "id", "cooperative_id", "member_id", "enterprise_id", "amount",
        "created_by", "created_at", "modified_by", "modified_at", "is_synced",
        "is_deleted", "sync_at", "deleted_at",
    ],
    "bank_reconciliation_summary": [
        "id", "cooperative_id", "bank_name", "period_month", "bank_total_cr",
        "bank_total_dr", "system_total_cr", "system_total_dr", "status",
        "created_at", "created_by", "modified_by", "is_synced", "is_deleted",
        "sync_at",
    ],
    "feedback": [
        "id", "cooperative_id", "member_id", "subject", "message", "rating",
        "created_at", "created_by", "modified_at", "modified_by", "is_deleted",
        "is_synced", "sync_at",
    ],
}

# Top-level collections pushed as their own Firestore documents
TOP_LEVEL = [
    "enterprise", "bank", "members", "remittance", "users",
    "notifications", "cooperatives", "transaction_types",
    "bank_reconciliation_summary", "feedback",
]

# Child tables embedded into their parents (NOT pushed as own docs)
CHILD_TO_PARENT = {
    "remittance_detail": "remittance",
    "loans": "remittance",
    "loan_guarantors": "remittance",  # embedded via loans[]
    "payment_advise": "members",
}

# Fields whose string values should be coerced to floats
NUMERIC_FIELDS = {
    "amount", "principal_amount", "guarantee_amount", "interest_rate",
    "form_fee", "admin_charge", "loan_multiplier", "compulsory_amount",
    "bank_total_cr", "bank_total_dr", "system_total_cr", "system_total_dr",
    "rating", "account_balance", "account_balance_total",
}

# Fields that are JSON strings stored as TEXT in SQLite
JSON_FIELDS = {"account_balance", "payment_advise", "data", "details", "loans"}

# Fields that should be converted to Firestore Timestamps
DATE_FIELDS = {
    "created_at", "modified_at", "deleted_at", "remittance_date",
    "issued_date", "due_date", "expiry_date", "date_joined",
    "last_attempt_at", "sync_at", "coop_first_month", "dob", "last_login",
}

# Fields that should NOT be parsed as JSON even if they look like it
FORCE_STRING_FIELDS = {
    "id", "cooperative_id", "member_id", "enterprise_id", "user_id",
    "remittance_id", "loan_id", "admin_fee_id", "reconciliation_summary_id",
    "mobile", "nok_mobile", "account_number", "registration_no",
    "special_id", "swift_code", "password_hash", "firebase_uid",
    "device_id", "ip_address", "recipient_id", "viewed", "account_manager",
}

# Fields where comma-separated strings become arrays
ARRAY_FIELDS = {"recipient_id", "viewed", "account_manager"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def parse_value(val, col):
    """Convert a SQLite value to a Firestore-compatible Python value."""
    if val is None:
        return None

    # Force-string fields stay as strings
    if col in FORCE_STRING_FIELDS:
        return str(val) if val is not None else None

    # Array fields: split comma-separated strings
    if col in ARRAY_FIELDS and isinstance(val, str):
        return [s.strip() for s in val.split(",") if s.strip()]

    # Numeric fields: coerce to float
    if col in NUMERIC_FIELDS:
        try:
            return float(val)
        except (ValueError, TypeError):
            return val

    # Boolean-ish integer fields
    if col in {"is_deleted", "is_synced", "is_system_default", "is_active",
               "is_visible", "is_penalty", "isWithdrawalRequest",
               "isLoanRequest", "force_password_change", "is_read", "viewed"}:
        if isinstance(val, (int, float)):
            return int(val)
        if isinstance(val, str):
            if val in ("1", "true", "True"):
                return 1
            if val in ("0", "false", "False", ""):
                return 0
        return val

    # Date fields: parse to datetime
    if col in DATE_FIELDS and isinstance(val, str) and val:
        try:
            # Handle ISO format
            dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
            return dt
        except (ValueError, TypeError):
            pass
        return val

    # JSON fields: parse JSON strings
    if col in JSON_FIELDS and isinstance(val, str):
        try:
            parsed = json.loads(val)
            return parsed
        except (json.JSONDecodeError, ValueError):
            pass

    return val


def row_to_dict(row, columns):
    """Convert a sqlite3.Row to a clean dict with Firestore-compatible values."""
    result = {}
    for col in columns:
        val = row[col]
        if col == "sync_at":
            # Always let Firestore set sync_at to server timestamp
            continue
        converted = parse_value(val, col)
        if converted is not None:
            result[col] = converted
    return result


def read_table(cursor, table, columns, coop_id=None):
    """Read all rows from a table, optionally filtered by cooperative_id."""
    cols_list = TABLE_COLUMNS.get(table, columns)
    col_names = [c for c in cols_list if c in columns]

    if coop_id and "cooperative_id" in columns:
        cursor.execute(f'SELECT * FROM "{table}" WHERE cooperative_id = ?', (coop_id,))
    elif table == "cooperatives" and coop_id:
        cursor.execute(f'SELECT * FROM "{table}" WHERE id = ?', (coop_id,))
    else:
        cursor.execute(f'SELECT * FROM "{table}"')

    rows = cursor.fetchall()
    return [row_to_dict(r, col_names) for r in rows]


# ---------------------------------------------------------------------------
# Embedding logic (mirrors loadDoc in mutationEngine.js)
# ---------------------------------------------------------------------------
def build_child_maps(cursor, coop_id, columns):
    """Pre-load all child tables grouped by their parent foreign key."""
    col_sets = {t: [c for c in TABLE_COLUMNS.get(t, []) if c in columns]
                for t in CHILD_TO_PARENT}

    # remittance_detail -> keyed by remittance_id
    rd_map = {}
    for row in read_table(cursor, "remittance_detail", columns, coop_id):
        rid = str(row.get("remittance_id", ""))
        rd_map.setdefault(rid, []).append(row)

    # loans -> keyed by remittance_id
    lo_map = {}
    for row in read_table(cursor, "loans", columns, coop_id):
        rid = str(row.get("remittance_id", ""))
        lo_map.setdefault(rid, []).append(row)

    # loan_guarantors -> keyed by loan_id
    lg_map = {}
    for row in read_table(cursor, "loan_guarantors", columns, coop_id):
        lid = str(row.get("loan_id", ""))
        lg_map.setdefault(lid, []).append(row)

    # payment_advise -> keyed by member_id
    pa_map = {}
    for row in read_table(cursor, "payment_advise", columns, coop_id):
        mid = str(row.get("member_id", ""))
        pa_map.setdefault(mid, []).append(row)

    return rd_map, lo_map, lg_map, pa_map


def embed_children_remit(doc, remit_id_str, rd_map, lo_map, lg_map):
    """Embed remittance_detail + loans (with guarantors) into a remittance doc."""
    details = rd_map.get(remit_id_str, [])
    doc["details"] = [d for d in details if not d.get("is_deleted")]

    loans = lo_map.get(remit_id_str, [])
    doc["loans"] = []
    for loan in loans:
        if loan.get("is_deleted"):
            continue
        lid = str(loan.get("id", ""))
        guarantors = lg_map.get(lid, [])
        loan["guarantors"] = [g for g in guarantors if not g.get("is_deleted")]
        doc["loans"].append(loan)


def embed_children_member(doc, member_id_str, pa_map):
    """Embed payment_advise into a member doc."""
    advises = pa_map.get(member_id_str, [])
    doc["payment_advise"] = [a for a in advises if not a.get("is_deleted")]


# ---------------------------------------------------------------------------
# Firestore push
# ---------------------------------------------------------------------------
def push_to_firestore(db, table, docs, dry_run=False):
    """Push a list of docs to a Firestore collection."""
    if not docs:
        return 0

    collection_ref = db.collection(table)
    count = 0

    for doc_data in docs:
        doc_id = str(doc_data.get("id", ""))
        if not doc_id:
            print(f"  SKIP {table}: doc missing 'id'")
            continue

        # Add sync_at as server timestamp
        doc_data["sync_at"] = SERVER_TIMESTAMP

        ref = collection_ref.document(doc_id)
        if dry_run:
            print(f"  [DRY] {table}/{doc_id} ({len(doc_data)} fields)")
        else:
            ref.set(doc_data, merge=True)
        count += 1

    return count


def push_in_batches(db, table, docs, dry_run=False, batch_size=400):
    """Push docs in Firestore batches for efficiency."""
    if not docs:
        return 0

    collection_ref = db.collection(table)
    total = 0

    for i in range(0, len(docs), batch_size):
        chunk = docs[i : i + batch_size]
        batch = db.batch()

        for doc_data in chunk:
            doc_id = str(doc_data.get("id", ""))
            if not doc_id:
                continue

            doc_data["sync_at"] = SERVER_TIMESTAMP
            ref = collection_ref.document(doc_id)

            if dry_run:
                print(f"  [DRY] {table}/{doc_id} ({len(doc_data)} fields)")
            else:
                batch.set(ref, doc_data, merge=True)
            total += 1

        if not dry_run and chunk:
            try:
                batch.commit()
                print(f"  Committed batch of {len(chunk)} docs to {table}")
            except Exception as e:
                print(f"  ERROR committing batch to {table}: {e}")
                # Continue with next batch — partial progress is saved
                # via Firestore's atomic batch semantics

    return total


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Push a SQLite .db backup to Firestore"
    )
    parser.add_argument(
        "--db", default=str(Path(__file__).parent / "currentdb.db"),
        help="Path to the .db file (default: currentdb.db in scripts folder)",
    )
    parser.add_argument("--coop", required=True, help="Cooperative ID to push")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be written")
    parser.add_argument("--batch-size", type=int, default=400, help="Firestore batch size")
    args = parser.parse_args()

    db_path = args.db
    if not os.path.exists(db_path):
        print(f"ERROR: Database file not found: {db_path}")
        sys.exit(1)

    print(f"Database: {db_path}")
    print(f"Cooperative: {args.coop}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE PUSH'}")
    print()

    # Init Firestore
    fs = init_firestore()

    # Connect to SQLite
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Verify the cooperative exists
    cursor.execute("SELECT id, full_name FROM cooperatives WHERE id = ?", (args.coop,))
    coop = cursor.fetchone()
    if not coop:
        print(f"ERROR: Cooperative '{args.coop}' not found in database")
        conn.close()
        sys.exit(1)
    print(f"Cooperative: {coop['full_name']} ({coop['id']})")
    print()

    # Get column info from each table
    table_columns = {}
    for table in TABLE_COLUMNS:
        try:
            cursor.execute(f'PRAGMA table_info("{table}")')
            cols = [row["name"] for row in cursor.fetchall()]
            table_columns[table] = cols
        except Exception:
            table_columns[table] = TABLE_COLUMNS[table]

    # Build child maps
    print("Loading child tables...")
    rd_map, lo_map, lg_map, pa_map = build_child_maps(
        cursor, args.coop, table_columns.get("remittance_detail", [])
    )
    print(f"  remittance_detail: {sum(len(v) for v in rd_map.values())} rows")
    print(f"  loans: {sum(len(v) for v in lo_map.values())} rows")
    print(f"  loan_guarantors: {sum(len(v) for v in lg_map.values())} rows")
    print(f"  payment_advise: {sum(len(v) for v in pa_map.values())} rows")
    print()

    # Push each top-level collection
    grand_total = 0
    for table in TOP_LEVEL:
        cols = table_columns.get(table, TABLE_COLUMNS.get(table, []))
        if not cols:
            print(f"SKIP {table}: no columns found")
            continue

        docs = read_table(cursor, table, cols, args.coop)
        if not docs:
            print(f"{table}: 0 rows")
            continue

        # Embed children
        if table == "remittance":
            for doc in docs:
                rid = str(doc.get("id", ""))
                embed_children_remit(doc, rid, rd_map, lo_map, lg_map)
        elif table == "members":
            for doc in docs:
                mid = str(doc.get("id", ""))
                embed_children_member(doc, mid, pa_map)

        # Strip child table fields from parent (they shouldn't be top-level)
        # Actually, the app's loadDoc returns them as embedded arrays in the
        # same doc — they ARE part of the Firestore document. Keep them.

        pushed = push_in_batches(fs, table, docs, args.dry_run, args.batch_size)
        grand_total += pushed
        print(f"{table}: {pushed} docs")

    conn.close()

    print()
    print(f"{'Would push' if args.dry_run else 'Pushed'} {grand_total} documents total.")
    if args.dry_run:
        print("Run without --dry-run to execute.")


if __name__ == "__main__":
    main()
