import sqlite3

conn = sqlite3.connect(r'C:\Users\Admin\Documents\Imradex_Tech_Projects\cooplogng\currentdb.db')
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

# Find Txn Charges enterprise
cursor.execute("SELECT id FROM enterprise WHERE account_name = 'Txn Charges' AND (is_deleted != '1' OR is_deleted IS NULL)")
txn_ent_id = cursor.fetchone()['id']

# Get all members with Txn Charges enterprise entries where the net is NOT zero
# This means individual remittance_detail records (not paired)
print("=== MEMBERS WITH UNPAIRED (NET != 0) TXN CHARGES ===")
cursor.execute("""
    SELECT 
        m.id AS member_id,
        m.first_name,
        m.last_name,
        m.registration_no_str,
        SUM(CAST(COALESCE(rd.amount, '0') AS REAL)) AS net_txn_charges,
        COUNT(rd.id) AS txn_count
    FROM remittance_detail rd
    JOIN remittance r ON rd.remittance_id = r.id
    JOIN members m ON r.member_id = m.id
    WHERE rd.enterprise_id = ?
      AND (rd.is_deleted != '1' OR rd.is_deleted IS NULL)
      AND (r.is_deleted != '1' OR r.is_deleted IS NULL)
      AND (r.status = 'Approved')
    GROUP BY m.id
    HAVING net_txn_charges != 0
    ORDER BY m.last_name, m.first_name
""", (txn_ent_id,))
rows = cursor.fetchall()
print(f"Members with unpaired Txn Charges != 0: {len(rows)}")
for row in rows:
    print(f"  Reg#{row['registration_no_str']} {row['first_name']} {row['last_name']} -> Net: {row['net_txn_charges']:,.2f} ({row['txn_count']} txns)")

# Also check non-Approved entries
print("\n=== TXN CHARGES WITH NON-APPROVED STATUS ===")
cursor.execute("""
    SELECT 
        m.first_name, m.last_name, m.registration_no_str,
        rd.amount, r.status, r.remittance_date
    FROM remittance_detail rd
    JOIN remittance r ON rd.remittance_id = r.id
    JOIN members m ON r.member_id = m.id
    WHERE rd.enterprise_id = ?
      AND r.status != 'Approved'
      AND (rd.is_deleted != '1' OR rd.is_deleted IS NULL)
      AND (r.is_deleted != '1' OR r.is_deleted IS NULL)
""", (txn_ent_id,))
non_approved = cursor.fetchall()
print(f"Non-approved entries: {len(non_approved)}")
for row in non_approved:
    print(f"  {row['registration_no_str']} {row['first_name']} {row['last_name']} - Amount: {row['amount']} Status: {row['status']}")

# Check: are there members where the TOTAL of individual txn_amounts (amount field in remittance_detail) are not balanced?
# Some entries may be > 0 only or < 0 only
print("\n=== MEMBERS WHERE TXN CHARGES AMOUNT != 0 PER TRANSACTION ===")
cursor.execute("""
    SELECT 
        m.id AS member_id,
        m.first_name,
        m.last_name,
        m.registration_no_str,
        rd.amount,
        rd.auto_description,
        r.remittance_date,
        r.status,
        r.id AS remittance_id
    FROM remittance_detail rd
    JOIN remittance r ON rd.remittance_id = r.id
    JOIN members m ON r.member_id = m.id
    WHERE rd.enterprise_id = ?
      AND CAST(COALESCE(rd.amount, '0') AS REAL) != 0
      AND (rd.is_deleted != '1' OR rd.is_deleted IS NULL)
      AND (r.is_deleted != '1' OR r.is_deleted IS NULL)
    ORDER BY m.last_name, m.first_name, r.remittance_date
""", (txn_ent_id,))
all_rows = cursor.fetchall()
print(f"Total individual txn charge records (amount != 0): {len(all_rows)}")

# Show unique members
unique_members = {}
for row in all_rows:
    mid = row['member_id']
    if mid not in unique_members:
        unique_members[mid] = {
            'reg': row['registration_no_str'],
            'first': row['first_name'],
            'last': row['last_name'],
            'entries': [],
            'net': 0
        }
    unique_members[mid]['entries'].append({
        'amount': float(row['amount'] or 0),
        'date': (row['remittance_date'] or '')[:10],
        'desc': row['auto_description'] or '',
        'status': row['status']
    })
    unique_members[mid]['net'] += float(row['amount'] or 0)

print(f"\nUnique members with Txn Charges entries: {len(unique_members)}")
print(f"{'Reg#':<8} {'Name':<40} {'Net':>12} {'# Entries':>10}")
print("-" * 75)
for mid, info in sorted(unique_members.items(), key=lambda x: x[1]['last'] or ''):
    name = f"{info['first'] or ''} {info['last'] or ''}"
    print(f"{info['reg'] or '':<8} {name:<40} {info['net']:>12,.2f} {len(info['entries']):>10}")

# The "dashboard" Txn Charges view: check the txnChargesFix source for how it calculates
# It says "sum of APPROVED remittance_detail amounts for Txn Charges enterprise"
# Let's also check the member dashboard query in the app
print("\n\n=== DASHBOARD-STYLE: SUM OF APPROVED TXN CHARGES PER MEMBER ===")
cursor.execute("""
    SELECT 
        m.id AS member_id,
        m.first_name,
        m.last_name,
        m.registration_no_str,
        SUM(CAST(COALESCE(rd.amount, '0') AS REAL)) AS total_approved_txn_charges
    FROM remittance_detail rd
    JOIN remittance r ON rd.remittance_id = r.id
    JOIN members m ON r.member_id = m.id
    WHERE rd.enterprise_id = ?
      AND r.status = 'Approved'
      AND (rd.is_deleted != '1' OR rd.is_deleted IS NULL)
      AND (r.is_deleted != '1' OR r.is_deleted IS NULL)
    GROUP BY m.id
    ORDER BY m.last_name, m.first_name
""", (txn_ent_id,))
dash_rows = cursor.fetchall()
print(f"{'Reg#':<8} {'Name':<40} {'Approved Txn Charges':>22}")
print("-" * 75)
for row in dash_rows:
    name = f"{row['first_name'] or ''} {row['last_name'] or ''}"
    print(f"{row['registration_no_str'] or '':<8} {name:<40} {row['total_approved_txn_charges']:>22,.2f}")

conn.close()
