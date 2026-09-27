// ===========================================================================
// Accounting Pack — data builder
//
// Derives an auditable double-entry view of a cooperative from the SAME
// records the app already writes: `remittance` (header = cooperative/cash
// leg) and `remittance_detail` (member/enterprise leg). No new tables, no new
// columns, no mutation of source data.
//
// Posting rules (validated against sampledata.db — see Control Checks sheet):
//   1. Cash leg      — when bank_name is a real bank (not 'Internal Transfer'),
//                      post |header| to that bank: Debit if header > 0.
//   2. Member legs   — every non-deleted detail posts |amount| to its
//                      enterprise account; side follows the account's normal
//                      balance (savings/liability = credit-normal, loan/asset =
//                      debit-normal), matching the app's own ledger convention.
//   3. Classification leg — when the header category is Income / Expense /
//                      Cooperative Asset, post |header| to that account on the
//                      side opposite the cash direction. This is what captures
//                      the app's header-only income/expense pickups.
//   4. Internal transfers are NOT cash and get no classification leg; they
//      only reallocate value through their detail rows.
//
// Anything that cannot be traced to a rule above is reported as a control
// difference or an exception — never plugged.
// ===========================================================================

const EPS = 0.005;

const INCOME_CATS = ['Revenue', 'Operating Income', 'Loan Income', 'Other Income'];
const EXPENSE_CATS = ['Expense', 'Expenses', 'Operating Expense', 'Administrative Expense', 'Finance Expense', 'Welfare Expense', 'Other Operating Expense', 'Other Expenses'];
const COOP_ASSET_CATS = ['Asset', 'Fixed Asset'];
const NON_POSTING_CATS = ['Transfer', 'Suspense'];
// Categories the app itself uses to route a transaction to a member account
// rather than to the profit and loss account. They are recognised, so they
// must not be reported as unknown classifications.
const MEMBER_CATS = ['Member Liability', 'Loan Asset', 'Liability', 'Equity'];
const RECOGNISED_CATS = [...INCOME_CATS, ...EXPENSE_CATS, ...COOP_ASSET_CATS, ...NON_POSTING_CATS, ...MEMBER_CATS];
const PSEUDO_MEMBER = '0000000000';
const INTERNAL_TRANSFER = 'Internal Transfer';

const T = v => String(v == null ? '' : v).trim();
function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function truthy(v) { return v === 1 || v === '1' || v === true || v === 'true' || v === 'True'; }
function dayOf(v) { return v == null ? '' : String(v).slice(0, 10); }
function normDate(v) {
    const s = dayOf(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function shiftDay(dateStr, delta) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
}
function memberName(m) {
    if (!m) return '';
    const parts = [m.first_name, m.middle_name, m.last_name].map(T).filter(Boolean);
    return parts.length ? parts.join(' ') : (T(m.registration_no) ? `Unnamed (Reg ${m.registration_no})` : 'Unnamed Member');
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------
// Account derivation
// ---------------------------------------------------------------------------

function enterpriseAccount(ent) {
    const type = T(ent.account_type).toLowerCase();
    const revenue = truthy(ent.revenue ?? ent.is_revenue);
    const obligor = truthy(ent.compulsory_due) || truthy(ent.is_penalty);

    if (type === 'asset' || type === 'loan') {
        return { bucket: type === 'loan' ? 'loan' : 'asset', name: T(ent.account_name) || 'Unnamed Account', normal: 'DR', type: 'Asset', obligor: false, revenue };
    }
    if (type === 'expense') {
        return { bucket: 'expenseEnt', name: T(ent.account_name) || 'Unnamed Account', normal: 'DR', type: 'Expense', obligor: false, revenue };
    }
    if (type === 'equity' || type === 'capital') {
        return { bucket: 'equityEnt', name: T(ent.account_name) || 'Unnamed Account', normal: 'CR', type: 'Equity', obligor: false, revenue };
    }
    if (type === 'liability') {
        return { bucket: 'liability', name: T(ent.account_name) || 'Unnamed Account', normal: 'CR', type: 'Liability', obligor: false, revenue };
    }
    if (type === 'revenue') {
        return { bucket: 'revenueEnt', name: T(ent.account_name) || 'Unnamed Account', normal: 'CR', type: 'Income', obligor: true, revenue: true };
    }
    // 'savings' and anything unrecognised
    if (revenue && !obligor) {
        // Accrued member-side income. Excluded from the trial balance so it
        // cannot double count the classification-basis income postings.
        return { bucket: 'revenueEnt', name: T(ent.account_name) || 'Unnamed Account', normal: 'CR', type: 'Income', obligor: false, revenue: true };
    }
    if (revenue && obligor) {
        // Compulsory due / penalty: a real member obligation (the app's
        // buildAccountBalance includes these in member net worth).
        return { bucket: 'due', name: T(ent.account_name) || 'Unnamed Account', normal: 'CR', type: 'Liability', obligor: true, revenue: false };
    }
    return { bucket: 'savings', name: T(ent.account_name) || 'Unnamed Account', normal: 'CR', type: 'Liability', obligor: false, revenue: false };
}

const BUCKETS = {
    bank: { base: '111', type: 'Asset', normal: 'DR', cls: 'Cash & Bank' },
    loan: { base: '121', type: 'Asset', normal: 'DR', cls: 'Loans Receivable' },
    asset: { base: '131', type: 'Asset', normal: 'DR', cls: 'Other Assets' },
    coopAsset: { base: '141', type: 'Asset', normal: 'DR', cls: 'Cooperative Assets' },
    savings: { base: '211', type: 'Liability', normal: 'CR', cls: 'Member Savings' },
    due: { base: '212', type: 'Liability', normal: 'CR', cls: 'Member Dues & Penalties' },
    liability: { base: '221', type: 'Liability', normal: 'CR', cls: 'Other Liabilities' },
    equityEnt: { base: '231', type: 'Equity', normal: 'CR', cls: 'Member Equity Accounts' },
    income: { base: '4', type: 'Income', normal: 'CR', cls: 'Income' },
    expense: { base: '5', type: 'Expense', normal: 'DR', cls: 'Expense' },
    expenseEnt: { base: '5', type: 'Expense', normal: 'DR', cls: 'Expense' },
    revenueEnt: { base: '431', type: 'Income', normal: 'CR', cls: 'Member-Side Revenue (memo)' },
    retained: { base: '311', type: 'Equity', normal: 'CR', cls: 'Retained Earnings' }
};

class AccountRegistry {
    constructor() { this.map = new Map(); this.seq = new Map(); this.accounts = []; }
    get(bucket, name) {
        const key = `${bucket}::${name}`;
        const hit = this.map.get(key);
        if (hit) return hit;
        const meta = BUCKETS[bucket];
        const n = (this.seq.get(meta.base) || 0) + 1;
        this.seq.set(meta.base, n);
        const code = meta.base.length === 1
            ? `${meta.base}${String(n).padStart(3, '0')}`
            : `${meta.base}${String(n).padStart(2, '0')}`;
        const acc = {
            code, bucket, name, type: meta.type, normal: meta.normal,
            classification: meta.cls,
            inTrialBalance: bucket !== 'revenueEnt',
            openingNet: 0, periodNet: 0
        };
        this.map.set(key, acc);
        this.accounts.push(acc);
        return acc;
    }
    retained() { return this.get('retained', 'Retained Earnings'); }
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

// The app's query layer is resolved lazily so this model can be exercised
// against a plain SQLite file in tests without a browser or IndexedDB.
let defaultQuery = null;
async function resolveQuery(query) {
    if (query) return query;
    if (!defaultQuery) {
        const mod = await import('../sqliteService.js');
        defaultQuery = mod.queryRows;
    }
    return defaultQuery;
}

// `query` is injectable so the model can be exercised against a real SQLite
// file in tests without a browser. It defaults to the app's own query layer.
export async function buildAccountingPack({ cooperativeId, startDate, endDate, cooperativeName, generatedBy, query }) {
    const from = normDate(startDate);
    const to = normDate(endDate);
    if (!from || !to) throw new Error('A valid start and end date is required.');
    if (from > to) throw new Error('Start date must not be after end date.');

    const run = await resolveQuery(query);

    const fetchScoped = async (table, coopId) => {
        const rows = await run(`SELECT * FROM ${table} WHERE cooperative_id = ?`, [coopId]);
        return rows.filter(r => String(r.cooperative_id) === String(coopId));
    };

    const [remittances, details, members, enterprises, loans, banks, txTypes, bankRecs, coops] = await Promise.all([
        fetchScoped('remittance', cooperativeId),
        fetchScoped('remittance_detail', cooperativeId),
        fetchScoped('members', cooperativeId),
        fetchScoped('enterprise', cooperativeId),
        fetchScoped('loans', cooperativeId),
        fetchScoped('bank', cooperativeId),
        fetchScoped('transaction_types', cooperativeId),
        fetchScoped('bank_reconciliation_summary', cooperativeId),
        run('SELECT id, full_name, short_name FROM cooperatives', [])
    ]);

    const coop = (coops || []).find(c => String(c.id) === String(cooperativeId));
    const coopName = cooperativeName || T(coop?.full_name) || T(coop?.short_name) || 'Cooperative';

    const memberMap = new Map(members.map(m => [String(m.id), m]));
    const entById = new Map(enterprises.filter(e => !truthy(e.is_deleted)).map(e => [String(e.id), e]));
    const txClassByType = new Map(txTypes.filter(t => !truthy(t.is_deleted)).map(t => [T(t.transaction_type), T(t.classification)]));
    const registeredBanks = new Set(banks.filter(b => !truthy(b.is_deleted)).map(b => T(b.bank_name)));

    const reg = new AccountRegistry();

    // --- Enterprise accounts -------------------------------------------------
    const entAccountById = new Map();
    for (const ent of entById.values()) {
        const a = enterpriseAccount(ent);
        entAccountById.set(String(ent.id), reg.get(a.bucket, a.name));
    }

    // --- Detail index --------------------------------------------------------
    const detByRem = new Map();
    for (const d of details) {
        if (truthy(d.is_deleted)) continue;
        const k = String(d.remittance_id);
        if (!detByRem.has(k)) detByRem.set(k, []);
        detByRem.get(k).push(d);
    }

    // --- Family roots (for the audit trail + exception grouping) --------------
    const remById = new Map(remittances.map(r => [String(r.id), r]));
    const famOf = new Map(remittances.map(r => [String(r.id), String(r.id)]));
    for (let pass = 0; pass < 6; pass++) {
        for (const r of remittances) {
            const link = T(r.parent_remittance_id) || (T(r.loan_id) && remById.has(String(r.loan_id)) ? String(r.loan_id) : '');
            if (!link || !remById.has(link)) continue;
            const root = famOf.get(link);
            if (root && root !== String(r.id)) famOf.set(String(r.id), root);
        }
    }

    // --- Loan attribution ----------------------------------------------------
    // The app records the link in one of two places, and in sampledata.db only
    // one of them is ever populated:
    //   1. loans.remittance_id  -> remittance.id   (the disbursement header)
    //   2. remittance.loan_id   -> loans.id        (never populated in the sample;
    //                                              it holds a remittance id instead)
    // Family-root matching is also applied so repayments and charges generated
    // alongside a disbursement resolve to the same loan.
    const loanById = new Map(loans.filter(l => !truthy(l.is_deleted)).map(l => [String(l.id), l]));
    const loanByDisbursement = new Map();   // remittance id -> loan id
    const loanByRoot = new Map();           // family root -> loan id
    for (const L of loanById.values()) {
        const rid = String(L.remittance_id || '');
        if (!rid) continue;
        loanByDisbursement.set(rid, String(L.id));
        if (remById.has(rid)) loanByRoot.set(String(famOf.get(rid) || rid), String(L.id));
    }
    const loanIdForRemittance = (r) => {
        const root = String(famOf.get(String(r.id)) || String(r.id));
        if (loanByRoot.has(root)) return loanByRoot.get(root);
        if (loanByDisbursement.has(String(r.id))) return loanByDisbursement.get(String(r.id));
        const direct = T(r.loan_id);
        if (direct && loanById.has(direct)) return direct;
        if (direct && loanByDisbursement.has(direct)) return loanByDisbursement.get(direct);
        return '';
    };

    // --- Bank accounts -------------------------------------------------------
    const bankAccountByName = new Map();
    const getBankAccount = (name) => {
        const key = T(name) || 'Unspecified / Direct';
        if (!bankAccountByName.has(key)) bankAccountByName.set(key, reg.get('bank', key));
        return bankAccountByName.get(key);
    };

    // --- Classification accounts --------------------------------------------
    const classAccountByType = new Map();
    const getClassAccount = (row) => {
        const cat = T(row.category);
        const type = T(row.transaction_type) || cat || 'Unclassified';
        const key = `${cat}::${type}`;
        if (!classAccountByType.has(key)) {
            let bucket;
            if (INCOME_CATS.includes(cat)) bucket = 'income';
            else if (EXPENSE_CATS.includes(cat)) bucket = 'expense';
            else if (COOP_ASSET_CATS.includes(cat)) bucket = 'coopAsset';
            else bucket = null;
            classAccountByType.set(key, bucket ? reg.get(bucket, type) : null);
        }
        return classAccountByType.get(key);
    };

    // --- Walk the remittances ------------------------------------------------
    const toDate = remittances
        .filter(r => !truthy(r.is_deleted) && T(r.status) === 'Approved')
        .map(r => ({ r, d: normDate(r.remittance_date) }))
        .filter(x => x.d && x.d <= to)
        .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : String(a.r.id).localeCompare(String(b.r.id))));

    const postings = [];
    const exceptions = [];
    const auditRows = [];
     const incomeRows = [];
     const expenseRows = [];
     const liabilityRows = [];
     const coopAssetRows = [];
    const cashTxRows = [];
    const internalMemo = { rows: [], net: 0 };
    const unattributedLoan = [];
    const memEntAcc = new Map();   // `${member}|${ent}` -> {openingNetDr, periodNetDr, normal, ...}
    const loanActivity = new Map(); // loanId -> {disbursed, repaid, charges, detailNet}
    const revenueEntMemo = new Map();
    const stats = { posted: 0, skippedNoDate: 0, skippedUnapproved: 0, skippedDeleted: 0 };

    const addPosting = (acc, { date, debit, amount, meta }) => {
        if (!acc || amount < EPS) return;
        const isDebit = !!debit;
        const net = isDebit ? amount : -amount;
        const inPeriod = date >= from && date <= to;
        if (inPeriod) acc.periodNet += net; else acc.openingNet += net;
        postings.push({ acc, date, debit: isDebit, amount: round2(amount), netDr: round2(net), inPeriod, meta });
    };

    const addException = (severity, code, title, remId, amount, explanation) => {
        exceptions.push({
            severity, code, title,
            remittanceId: remId || '',
            amount: round2(amount || 0),
            explanation: explanation || ''
        });
    };

    for (const { r, d } of toDate) {
        const H = num(r.amount);
        const bankName = T(r.bank_name);
        const isBank = !!bankName && bankName !== INTERNAL_TRANSFER;
        const cat = T(r.category);
        const txType = T(r.transaction_type);
        const rdets = detByRem.get(String(r.id)) || [];
        const detailSum = rdets.reduce((s, x) => s + num(x.amount), 0);
        const inPeriod = d >= from;
        const memId = String(r.member_id || '');
        const mem = memberMap.get(memId);
        const isPseudo = memId === PSEUDO_MEMBER || !mem;
        const family = famOf.get(String(r.id)) || String(r.id);

        // ---- 1. Cash leg
        if (isBank && Math.abs(H) >= EPS) {
            addPosting(getBankAccount(bankName), { date: d, debit: H > 0, amount: Math.abs(H), meta: { remittanceId: String(r.id), leg: 'Cash', detailId: '' } });
            if (inPeriod) {
                cashTxRows.push({
                    date: d, remittanceId: String(r.id), family, bank: bankName,
                    transactionType: txType, category: cat, member: isPseudo ? `${PSEUDO_MEMBER} (Cooperative)` : memberName(mem),
                    receipt: H > 0 ? round2(H) : 0, payment: H < 0 ? round2(-H) : 0
                });
            }
        }

        // ---- 2. Member legs
        //
        // remittance_detail.amount is signed: positive credits the member
        // account, negative debits it. That holds for every account type, so
        // the side comes from the sign alone. The account's normal balance only
        // decides how the resulting balance is presented, not which side it is
        // posted to. Getting this wrong flips a loan receivable to a credit and
        // cancels a dues account to nil.
        const loanIdForRow = loanIdForRemittance(r);
        for (const det of rdets) {
            const amt = num(det.amount);
            if (Math.abs(amt) < EPS) continue;
            const entId = String(det.enterprise_id || '');
            const ent = entById.get(entId);
            const acc = entAccountById.get(entId);

            if (!ent || !acc) {
                addException('High', 'DETAIL_NO_ENTERPRISE', 'Detail row points to a missing or deleted enterprise', String(r.id), amt,
                    `remittance_detail ${det.id} references enterprise_id "${entId}" which is not present in this cooperative. The amount is excluded from every statement.`);
                continue;
            }

            const isDebit = amt < 0;

            if (acc.bucket === 'revenueEnt') {
                // Memo only — excluded from the trial balance to avoid double
                // counting the classification-basis income postings.
                const cur = revenueEntMemo.get(acc.code) || { acc, net: 0, periodNet: 0 };
                if (inPeriod) cur.periodNet += isDebit ? -Math.abs(amt) : Math.abs(amt); else cur.net += isDebit ? -Math.abs(amt) : Math.abs(amt);
                revenueEntMemo.set(acc.code, cur);
                continue;
            }

            addPosting(acc, { date: d, debit: isDebit, amount: Math.abs(amt), meta: { remittanceId: String(r.id), leg: 'Member', detailId: String(det.id), memberId: memId, enterpriseId: entId } });

            if (acc.bucket === 'loan' && !loanIdForRow) {
                unattributedLoan.push({ remittanceId: String(r.id), detailId: String(det.id), amount: round2(amt), transactionType: txType, member: isPseudo ? PSEUDO_MEMBER : memberName(mem) });
            }

            if (loanIdForRow) {
                const cur = loanActivity.get(loanIdForRow) || { disbursed: 0, repaid: 0, charges: 0, principalNet: 0, detailNet: 0 };
                cur.detailNet += amt;
                if (acc.bucket === 'loan') {
                    // Principal movement only. Charges collected against a loan
                    // sit on other accounts and must not reduce the outstanding.
                    cur.principalNet += amt;
                    if (amt < 0) cur.disbursed += Math.abs(amt); else cur.repaid += amt;
                } else if (/charge|interest|fee/i.test(txType) || acc.type === 'Income') {
                    cur.charges += Math.abs(amt);
                }
                loanActivity.set(loanIdForRow, cur);
            }
        }

         // ---- 3. Classification leg
         const classAcc = getClassAccount(r);
         const type = T(r.transaction_type) || cat || 'Unknown';
         const hasDetails = rdets.some(d => Math.abs(num(d.amount)) >= EPS);
         const isMemberLiab = cat === 'Member Liability' || cat === 'Liability';
         // "Unknown Payment" (Member Liability with no identifiable owner)
         // needs an offsetting liability posting so the trial balance
         // does not show a control difference. Only add when there are
         // no detail legs (no known enterprise/member to credit).
         const classAccForLiab = (!classAcc && isMemberLiab && !hasDetails)
             ? reg.get('liability', type) : null;
         const effectiveClassAcc = classAcc || classAccForLiab;
        if (effectiveClassAcc && Math.abs(H) >= EPS) {
            addPosting(effectiveClassAcc, { date: d, debit: H < 0, amount: Math.abs(H), meta: { remittanceId: String(r.id), leg: 'Classification', detailId: '' } });
            if (inPeriod) {
                const row = {
                    date: d, remittanceId: String(r.id), family, transactionType: txType,
                    category: cat, classification: txClassByType.get(txType) || cat,
                    member: isPseudo ? `${PSEUDO_MEMBER} (Cooperative)` : memberName(mem),
                    bank: isBank ? bankName : INTERNAL_TRANSFER,
                    amount: round2(Math.abs(H)),
                    effect: round2(effectiveClassAcc.type === 'Income' ? H : -H),
                    side: H < 0 ? 'Debit' : 'Credit'
                };
                if (effectiveClassAcc.type === 'Income') incomeRows.push(row);
                else if (effectiveClassAcc.type === 'Expense') expenseRows.push(row);
                else if (effectiveClassAcc.type === 'Liability') liabilityRows.push(row);
                else coopAssetRows.push(row);
            }
        }

        // ---- 4. Internal transfer memo
        if (!isBank && Math.abs(H) >= EPS) {
            internalMemo.net += H;
            if (inPeriod) {
                internalMemo.rows.push({
                    date: d, remittanceId: String(r.id), family, transactionType: txType, category: cat,
                    member: isPseudo ? `${PSEUDO_MEMBER} (Cooperative)` : memberName(mem),
                    headerAmount: round2(H), detailCount: rdets.length, detailSum: round2(detailSum)
                });
            }
        }

        // ---- 5. Exception detection
        if (inPeriod) {
             const legs = (isBank && Math.abs(H) >= EPS ? 1 : 0) + rdets.filter(x => Math.abs(num(x.amount)) >= EPS).length + (effectiveClassAcc && Math.abs(H) >= EPS ? 1 : 0);
             const oneLegged = !isBank && rdets.length <= 1 && !effectiveClassAcc && Math.abs(H) >= EPS;
             const bankNoDetails = isBank && rdets.length === 0 && !effectiveClassAcc && Math.abs(H) >= EPS;
            const transferWithBank = isBank && NON_POSTING_CATS.includes(cat) && rdets.length === 0;

            if (transferWithBank) {
                addException('High', 'TRANSFER_WITH_BANK', 'Internal transfer posted against a real bank account', String(r.id), H,
                    `Category "${cat}" is a non-cash classification yet bank_name is "${bankName}", and the row carries no detail legs. The full amount is recognised as a bank movement with no offsetting account.`);
            }
            if (oneLegged) {
                addException('Medium', 'ONE_LEGGED_NON_CASH', 'Non-cash posting with no counter-leg', String(r.id), H,
                    `Non-cash header of ${round2(H).toLocaleString()} with ${rdets.length} detail leg(s) and no Income/Expense/Asset classification. The entry is its own family, so there is no related row to balance it. It is included in the control difference quantified by C13.`);
            }
            if (bankNoDetails && !transferWithBank) {
                addException('High', 'CASH_POSTING_NO_DETAIL', 'Cash movement with no member or classification leg', String(r.id), H,
                    `Bank "${bankName}" movement of ${round2(H).toLocaleString()} with no detail rows and no Income/Expense/Asset category.`);
            }
            if (isBank && !NON_POSTING_CATS.includes(cat) && rdets.length > 0 && Math.abs(H - detailSum) >= EPS) {
                addException('Medium', 'HEADER_DETAIL_MISMATCH', 'Cash header does not equal the sum of its details', String(r.id), H - detailSum,
                    `Header ${round2(H).toLocaleString()} vs details ${round2(detailSum).toLocaleString()} (difference ${round2(H - detailSum).toLocaleString()}).`);
            }
            if (!T(r.category)) {
                addException('Medium', 'NO_CATEGORY', 'Transaction has no category', String(r.id), H, 'The category is blank, so no classification posting could be derived.');
            } else if (!RECOGNISED_CATS.includes(cat)) {
                addException('Medium', 'UNKNOWN_CATEGORY', 'Transaction category is not a recognised accounting classification', String(r.id), H,
                    `Category "${cat}" matches none of the app's known classifications; treated as unclassified.`);
            }
            if (classAcc && (classAcc.type === 'Income' || classAcc.type === 'Expense') && H < 0) {
                addException('Medium', 'NEGATIVE_PL', 'Income or expenditure header recorded as a negative amount', String(r.id), H,
                    `Category "${cat}" is a profit and loss classification but the header is ${round2(H).toLocaleString()}, so it reduces ${classAcc.type === 'Income' ? 'income' : 'expenditure'} rather than increasing it. Treated as a reversal of an earlier entry and netted at its signed value.`);
            }
            if (classAcc && classAcc.bucket === 'coopAsset') {
                if (!isBank && H > 0) {
                    addException('High', 'COOP_ASSET_CREDIT_NO_BANK', 'Asset purchase recorded as a credit to a cooperative asset account', String(r.id), H,
                        `Category "${cat}" is a capitalised asset but the header is a positive ${round2(H).toLocaleString()} with bank_name "${bankName || '(blank)'}" and ${rdets.length} detail leg(s). With no cash or member leg the entry credits the asset account, reducing it, instead of capitalising the purchase. The movement is included in the trial balance as recorded and has not been adjusted here.`);
                } else if (!isBank && rdets.length === 0) {
                    addException('Medium', 'COOP_ASSET_NO_BANK', 'Cooperative asset movement with no cash or member leg', String(r.id), H,
                        `Category "${cat}" is a capitalised asset but there is no bank leg and no detail leg to offset it, so the asset movement cannot be traced to a payment.`);
                }
            }
            if (!txClassByType.get(txType)) {
                addException('Low', 'UNMAPPED_TRANSACTION_TYPE', 'Transaction type has no classification mapping', String(r.id), H,
                    `"${txType}" is not present in transaction_types for this cooperative.`);
            }
            if (isPseudo && !isBank && !NON_POSTING_CATS.includes(cat)) {
                addException('Low', 'COOPERATIVE_POSTING_NO_BANK', 'Cooperative-level posting with no bank leg', String(r.id), H,
                    `Posted against member ${PSEUDO_MEMBER} with bank_name "${bankName || '(blank)'}". Internal transfer rows are excluded from this finding because the app posts all of its internal moves that way by design.`);
            }
            if (!normDate(r.remittance_date)) {
                addException('Medium', 'MISSING_DATE', 'Transaction has no usable posting date', String(r.id), H, 'remittance_date is empty or malformed, so the row cannot be placed in a period.');
            }
            if (legs === 0) {
                addException('Low', 'NO_POSTINGS', 'Transaction produced no accounting postings', String(r.id), H, 'Zero amount with no detail legs. It is reported for completeness but affects no balance.');
            }
        }

        // ---- 6. Audit trail
        if (inPeriod) {
            auditRows.push({
                date: d, remittanceId: String(r.id), family,
                status: T(r.status) || '(blank)', deleted: truthy(r.is_deleted) ? 'Yes' : 'No',
                transactionType: txType, category: cat,
                classification: txClassByType.get(txType) || cat,
                memberId: memId || '(blank)', member: isPseudo ? `${PSEUDO_MEMBER} (Cooperative)` : memberName(mem),
                regNo: T(mem?.registration_no), memberStatus: T(mem?.status),
                bank: bankName || '(blank)', headerAmount: round2(H),
                detailCount: rdets.length, detailSum: round2(detailSum),
                headerMinusDetail: round2(H - detailSum),
                autogen: truthy(r.autogen) ? 'Yes' : 'No',
                parentId: T(r.parent_remittance_id) || '', loanId: T(r.loan_id) || '',
                description: T(r.description),
                // Provenance. No `approved_by` column exists anywhere in the
                // schema, so an approver identity is deliberately not shown
                // rather than invented; approval is evidenced by `status`.
                cooperativeId: T(r.cooperative_id), createdBy: T(r.created_by),
                createdAt: T(r.created_at), modifiedBy: T(r.modified_by),
                modifiedAt: T(r.modified_at)
            });
        }
    }

    // --- Family roll-up -------------------------------------------------------
    // The app posts a compulsory charge as three separate rows: a header, a
    // deduction from the member's dues, and a pickup of the same amount to
    // ordinary savings. Read one at a time each looks like a one-legged entry;
    // read as a family they balance exactly. Families are therefore netted
    // here so a row-level finding is not reported against a balanced movement.
    const familyNet = new Map();
    for (const p of postings) {
        const f = String(famOf.get(p.meta.remittanceId) || p.meta.remittanceId);
        familyNet.set(f, round2((familyNet.get(f) || 0) + p.netDr));
    }
    for (const ex of exceptions) {
        if (ex.code !== 'ONE_LEGGED_NON_CASH') continue;
        const f = String(famOf.get(ex.remittanceId) || ex.remittanceId);
        const net = familyNet.get(f) || 0;
        if (Math.abs(net) < EPS) {
            ex.severity = 'Low';
            ex.title = 'Non-cash posting with no counter-leg on its own row (family balances)';
            ex.explanation += ` Read as a family this entry balances exactly: the rows the app generated alongside it, identified by family ${f}, net to nil.`;
        }
    }

    // Over a thousand one-legged legacy rows cannot usefully be listed one by
    // one, so the largest are kept for traceability and the remainder is
    // summarised. The whole population is quantified once, by control C13.
    const oneLeggedAll = exceptions.filter(e => e.code === 'ONE_LEGGED_NON_CASH' && e.severity === 'Medium');
    const oneLeggedCount = oneLeggedAll.length;
    const oneLeggedNet = round2(oneLeggedAll.reduce((s, e) => s + e.amount, 0));
    if (oneLeggedAll.length > 200) {
        const bySize = [...oneLeggedAll].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
        const dropSet = new Set(bySize.slice(200));
        for (let i = exceptions.length - 1; i >= 0; i--) if (dropSet.has(exceptions[i])) exceptions.splice(i, 1);
        const droppedNet = round2([...dropSet].reduce((s, e) => s + e.amount, 0));
        addException('Medium', 'ONE_LEGGED_NON_CASH', 'Non-cash postings with no counter-leg (summary)', '', droppedNet,
            `${dropSet.size} further one-legged non-cash entries, net ${droppedNet.toLocaleString()}, are summarised here rather than listed individually. The 200 largest are listed above and the whole population of ${oneLeggedCount}, net ${oneLeggedNet.toLocaleString()}, is quantified by control C13. Each is an internal transfer row that forms a family of its own, so there is no related row to balance it; the large majority are legacy rows that recorded a member balance without a cash leg.`);
    }

    // --- Loan details that resolve to no loan record --------------------------
    if (unattributedLoan.length) {
        const net = round2(unattributedLoan.reduce((s, x) => s + x.amount, 0));
        for (const u of unattributedLoan.slice(0, 50)) {
            addException('Medium', 'LOAN_DETAIL_UNATTRIBUTED', 'Loan account movement does not resolve to a loan record', u.remittanceId, u.amount,
                `remittance_detail ${u.detailId} posts to a loan account but no loan record references remittance ${u.remittanceId}, either directly or through the family it belongs to. The movement is included in the loan receivable in the trial balance but cannot be shown against an individual loan in the register.`);
        }
        if (unattributedLoan.length > 50) {
            addException('Medium', 'LOAN_DETAIL_UNATTRIBUTED', 'Loan account movements that do not resolve to a loan record', '', net,
                `${unattributedLoan.length - 50} further unattributed loan account movement(s), net ${net.toLocaleString()}, are omitted from this list to keep it readable. The total is quantified by control C11.`);
        }
    }

    // Rows excluded from every figure, but still reported.
    for (const r of remittances) {
        const d = normDate(r.remittance_date);
        if (!d || d < from || d > to) continue;
        if (truthy(r.is_deleted)) stats.skippedDeleted++; else if (T(r.status) !== 'Approved') stats.skippedUnapproved++;
        if (truthy(r.is_deleted) || T(r.status) !== 'Approved') {
            const rdets = (detByRem.get(String(r.id)) || []).filter(x => !truthy(x.is_deleted));
            auditRows.push({
                date: d, remittanceId: String(r.id), family: famOf.get(String(r.id)) || String(r.id),
                status: T(r.status) || '(blank)', deleted: truthy(r.is_deleted) ? 'Yes' : 'No',
                transactionType: T(r.transaction_type), category: T(r.category),
                classification: txClassByType.get(T(r.transaction_type)) || T(r.category),
                memberId: String(r.member_id || '(blank)'),
                member: memberName(memberMap.get(String(r.member_id))),
                regNo: T(memberMap.get(String(r.member_id))?.registration_no), memberStatus: T(memberMap.get(String(r.member_id))?.status),
                bank: T(r.bank_name) || '(blank)', headerAmount: round2(num(r.amount)),
                detailCount: rdets.length, detailSum: round2(rdets.reduce((s, x) => s + num(x.amount), 0)),
                headerMinusDetail: round2(num(r.amount) - rdets.reduce((s, x) => s + num(x.amount), 0)),
                autogen: truthy(r.autogen) ? 'Yes' : 'No',
                parentId: T(r.parent_remittance_id) || '', loanId: T(r.loan_id) || '',
                description: T(r.description),
                cooperativeId: T(r.cooperative_id), createdBy: T(r.created_by),
                createdAt: T(r.created_at), modifiedBy: T(r.modified_by),
                modifiedAt: T(r.modified_at)
            });
        }
    }

    // --- Orphan / cross-cooperative detail integrity -------------------------
    const postedRemIds = new Set(postings.map(p => p.meta.remittanceId));
    for (const det of details) {
        if (truthy(det.is_deleted)) continue;
        const rid = String(det.remittance_id);
        if (!postedRemIds.has(rid) && !remById.has(rid)) {
            addException('High', 'ORPHAN_DETAIL', 'Detail row has no matching remittance header', '', num(det.amount),
                `remittance_detail ${det.id} references remittance_id "${rid}" which does not exist in this cooperative.`);
        }
    }
    // --- Unset soft-delete flag ---------------------------------------------
    // CoopLogNG soft-deletes rather than removing rows, but a small number of
    // detail rows were written before the flag was set and are left NULL. NULL
    // is not an assertion of deletion, so these rows are included; excluding
    // them would quietly drop real member-account movement. The difference is
    // material to the trial balance, so the rows are listed explicitly and the
    // choice is put to the reader rather than made silently.
    for (const det of details) {
        if (det.is_deleted !== null && det.is_deleted !== undefined) continue;
        if (truthy(det.is_deleted)) continue;
        const amt = round2(num(det.amount));
        const rid = String(det.remittance_id);
        addException('Medium', 'DELETE_FLAG_UNSET', 'Detail row has no value in the soft-delete flag', rid, amt,
            `remittance_detail ${det.id} has is_deleted = NULL, so CoopLogNG neither confirms nor denies that it is deleted. It is included in this pack, because a missing flag is not a claim of deletion and excluding it would remove ${Math.abs(amt).toLocaleString()} of member account movement without evidence. ${remById.has(rid) ? 'Its remittance header is present, Approved and not deleted.' : 'Its remittance header was not found among the rows in scope.'}`);
    }
    for (const r of remittances) {
        if (r.is_deleted !== null && r.is_deleted !== undefined) continue;
        addException('High', 'DELETE_FLAG_UNSET', 'Remittance has no value in the soft-delete flag', String(r.id), round2(num(r.amount)),
            `remittance ${r.id} has is_deleted = NULL. It is included in this pack. Correct the flag in CoopLogNG if the row is not a real transaction.`);
    }

    for (const b of bankRecs) {
        if (!registeredBanks.has(T(b.bank_name))) {
            addException('Low', 'RECON_BANK_UNKNOWN', 'Bank reconciliation references an unregistered bank', String(b.id), 0,
                `bank_reconciliation_summary references bank "${T(b.bank_name)}" which is not in the bank register.`);
        }
    }

    // --- Identifier uniqueness and completeness ------------------------------
    // CoopLogNG generates primary keys in the client, so a duplicated or blank
    // identifier would silently merge or lose whole transactions. Neither is
    // assumed to be impossible; both are checked and reported.
    const remCount = new Map(), detCount = new Map();
    for (const r of remittances) {
        const id = String(r.id);
        remCount.set(id, (remCount.get(id) || 0) + 1);
    }
    for (const d of details) {
        if (truthy(d.is_deleted)) continue;
        const id = String(d.id);
        detCount.set(id, (detCount.get(id) || 0) + 1);
    }
    for (const [id, n] of remCount) {
        if (n > 1) {
            addException('High', 'DUPLICATE_REM_ID', 'More than one remittance shares a transaction identifier', id, 0,
                `${n} rows in this cooperative share remittance.id "${id}". Only one can be a distinct transaction, so either rows have been merged or a transaction is counted twice. Both rows are shown on the Transaction Audit Trail.`);
        }
    }
    for (const [id, n] of detCount) {
        if (n > 1) {
            addException('High', 'DUPLICATE_DETAIL_ID', 'More than one detail row shares an identifier', id, 0,
                `${n} non-deleted remittance_detail rows share id "${id}".`);
        }
    }
    for (const r of remittances) {
        const id = String(r.id);
        if (!T(r.cooperative_id)) {
            addException('High', 'MISSING_COOPERATIVE_ID', 'Remittance records no cooperative', id, 0,
                `remittance ${id} has a blank cooperative_id, so it cannot be proven to belong to this cooperative. It is included here because it was returned by the cooperative-scoped query, and the ID is shown for the reader to correct.`);
        }
    }
    for (const r of remittances) {
        if (truthy(r.is_deleted)) continue;
        const id = String(r.id);
        const mid = T(r.member_id);
        // `0000000000` is the deliberate cooperative-level pseudo-member, not a
        // missing member, so it is not a finding.
        if (mid && mid !== PSEUDO_MEMBER && !memberMap.has(mid)) {
            addException('High', 'MISSING_MEMBER_RECORD', 'Remittance references a member that does not exist', id, 0,
                `remittance ${id} references member_id "${mid}" which is not in this cooperative's member list, or is deleted. The transaction is included using the recorded member ID, but the member name and account balances cannot be resolved.`);
        }
    }

    // --- Retained earnings (cumulative surplus before the period) ------------
    let cumIncomeBefore = 0, cumExpenseBefore = 0;
    for (const acc of reg.accounts) {
        if (acc.type === 'Income' && acc.bucket === 'income') cumIncomeBefore += -acc.openingNet;
        if (acc.type === 'Expense') cumExpenseBefore += acc.openingNet;
    }
    const reOpening = round2(cumIncomeBefore - cumExpenseBefore);
    if (Math.abs(reOpening) >= EPS) reg.retained().openingNet = -reOpening;

    // --- Member account balances (needed for the member accounts sheet) ------
    // Accumulated in debit-positive terms in a single pass over the postings,
    // then presented on each account's own normal balance. Doing the opening
    // and period in separate passes with different sign conventions is what
    // previously flipped the loan receivable and cancelled the dues account.
    for (const p of postings) {
        const { memberId, enterpriseId } = p.meta;
        if (!memberId || !enterpriseId) continue;
        const k = `${memberId}|${enterpriseId}`;
        const cur = memEntAcc.get(k) || {
            memberId, enterpriseId, enterprise: p.acc.name, type: p.acc.classification,
            normal: p.acc.normal, openingNetDr: 0, periodNetDr: 0, credits: 0, debits: 0
        };
        if (p.inPeriod) {
            cur.periodNetDr += p.netDr;
            // Gross credits and debits, kept separately. Taking the sign of the
            // net movement would leave one of the two columns always zero, which
            // hides the gross activity behind a net figure and makes the
            // "credits less debits = net position" control vacuous.
            const sgn = p.acc.normal === 'CR' ? -1 : 1;
            const delta = sgn * p.netDr;
            if (delta > EPS) cur.credits += delta; else if (delta < -EPS) cur.debits += -delta;
        } else cur.openingNetDr += p.netDr;
        memEntAcc.set(k, cur);
    }
    for (const cur of memEntAcc.values()) {
        // Credit-positive presentation for everything the cooperative owes a
        // member; a loan receivable is presented positive as an amount owed to
        // the cooperative, which is the same convention for a member statement.
        const sign = cur.normal === 'CR' ? -1 : 1;
        cur.opening = round2(cur.openingNetDr * sign);
        cur.period = round2(cur.periodNetDr * sign);
    }

    // =========================================================================
    // Trial balance
    // =========================================================================
    const tbRows = [];
    let tbOpenDr = 0, tbOpenCr = 0, tbPerDr = 0, tbPerCr = 0, tbCloseDr = 0, tbCloseCr = 0;
    const ordered = [...reg.accounts].filter(a => a.inTrialBalance).sort((a, b) =>
        a.code.localeCompare(b.code) || a.name.localeCompare(b.name));

    for (const acc of ordered) {
        const isPL = acc.type === 'Income' || acc.type === 'Expense';
        const opening = isPL ? 0 : acc.openingNet;
        const period = acc.periodNet;
        const closing = isPL ? period : round2(acc.openingNet + acc.periodNet);
        if (Math.abs(opening) < EPS && Math.abs(period) < EPS && Math.abs(closing) < EPS) continue;

        const s = v => (v > EPS ? round2(v) : v < -EPS ? round2(v) : 0);
        const o = s(opening), p = s(period), c = s(closing);
        tbRows.push({
            code: acc.code, account: acc.name, type: acc.type, normal: acc.normal,
            classification: acc.classification,
            openingDr: o > 0 ? o : 0, openingCr: o < 0 ? round2(-o) : 0,
            periodDr: p > 0 ? p : 0, periodCr: p < 0 ? round2(-p) : 0,
            closingDr: c > 0 ? c : 0, closingCr: c < 0 ? round2(-c) : 0
        });
        tbOpenDr += o > 0 ? o : 0; tbOpenCr += o < 0 ? -o : 0;
        tbPerDr += p > 0 ? p : 0; tbPerCr += p < 0 ? -p : 0;
        tbCloseDr += c > 0 ? c : 0; tbCloseCr += c < 0 ? -c : 0;
    }
    tbOpenDr = round2(tbOpenDr); tbOpenCr = round2(tbOpenCr);
    tbPerDr = round2(tbPerDr); tbPerCr = round2(tbPerCr);
    tbCloseDr = round2(tbCloseDr); tbCloseCr = round2(tbCloseCr);

    // =========================================================================
    // General ledger
    // =========================================================================
    const glRows = [];
    for (const acc of ordered) {
        const mine = postings.filter(p => p.acc === acc).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        if (!mine.length) continue;
        const opening = acc.type === 'Income' || acc.type === 'Expense' ? 0 : acc.openingNet;
        let running = opening;
        glRows.push({ kind: 'opening', code: acc.code, account: acc.name, date: '', reference: '', description: 'Opening balance', member: '', debit: '', credit: '', balance: round2(running) });
        for (const p of mine) {
            if (!p.inPeriod) continue;
            running += p.netDr;
            const { remittanceId, leg, detailId, memberId } = p.meta;
            glRows.push({
                kind: 'move', code: acc.code, account: acc.name, accountType: acc.type, leg,
                date: p.date,
                reference: detailId ? `${remittanceId}/${detailId}` : remittanceId,
                // Traceability: the accountant must be able to walk from this
                // line back to the exact row that produced it. `sourceTable`
                // names the table the amount was read from, which differs by
                // leg: a member leg comes from remittance_detail, everything
                // else from the remittance header.
                sourceTable: leg === 'Member' ? 'remittance_detail' : 'remittance',
                sourceId: detailId || remittanceId,
                remittanceId, detailId: detailId || '',
                memberId: p.meta.memberId || '',
                enterpriseId: p.meta.enterpriseId || '',
                loanId: p.meta.loanId || loanIdForRemittance(remById.get(remittanceId) || {}) || '',
                description: `${leg}: ${T(remById.get(remittanceId)?.description) || T(remById.get(remittanceId)?.transaction_type) || remittanceId}`,
                member: memberId ? memberName(memberMap.get(String(memberId))) : '',
                debit: p.debit ? p.amount : '', credit: p.debit ? '' : p.amount,
                netDr: round2(p.netDr),
                balance: round2(running)
            });
        }
        glRows.push({ kind: 'closing', code: acc.code, account: acc.name, date: '', reference: '', description: 'Closing balance', member: '', debit: '', credit: '', balance: round2(running) });
    }

    // =========================================================================
    // Cash & bank book
    // =========================================================================
    const cashSummary = [];
    for (const [name, acc] of [...bankAccountByName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const mine = postings.filter(p => p.acc === acc);
        const op = mine.filter(p => !p.inPeriod).reduce((s, p) => s + p.netDr, 0);
        const per = mine.filter(p => p.inPeriod);
        const receipts = per.filter(p => p.debit).reduce((s, p) => s + p.amount, 0);
        const payments = per.filter(p => !p.debit).reduce((s, p) => s + p.amount, 0);
        if (Math.abs(op) < EPS && Math.abs(receipts) < EPS && Math.abs(payments) < EPS) continue;
        cashSummary.push({
            bank: name, code: acc.code, opening: round2(op), receipts: round2(receipts),
            payments: round2(payments), closing: round2(op + receipts - payments),
            registered: registeredBanks.has(name) ? 'Yes' : 'No'
        });
    }
    const cashOpTotal = round2(cashSummary.reduce((s, r) => s + r.opening, 0));
    const cashRecTotal = round2(cashSummary.reduce((s, r) => s + r.receipts, 0));
    const cashPayTotal = round2(cashSummary.reduce((s, r) => s + r.payments, 0));
    const cashCloseTotal = round2(cashSummary.reduce((s, r) => s + r.closing, 0));

    // =========================================================================
    // Member accounts
    // =========================================================================
    const memberRows = [];
    for (const cur of memEntAcc.values()) {
        const closing = round2(cur.opening + cur.period);
        if (Math.abs(cur.opening) < EPS && Math.abs(closing) < EPS) continue;
        const mem = memberMap.get(String(cur.memberId));
        // Credits and debits are gross, accumulated in the presentation above,
        // so credits less debits is the period movement a reader can check.
        const credits = round2(cur.credits), debits = round2(cur.debits);
        memberRows.push({
            memberId: String(cur.memberId), member: memberName(mem),
            regNo: T(mem?.registration_no), memberStatus: T(mem?.status),
            account: cur.enterprise, classification: cur.type,
            opening: cur.opening, credits, debits, closing,
            isPseudo: String(cur.memberId) === PSEUDO_MEMBER
        });
    }
    memberRows.sort((a, b) => a.member.localeCompare(b.member) || a.account.localeCompare(b.account));

    const memberSummaryMap = new Map();
    for (const r of memberRows) {
        if (!memberSummaryMap.has(r.memberId)) {
            memberSummaryMap.set(r.memberId, { memberId: r.memberId, member: r.member, regNo: r.regNo, memberStatus: r.memberStatus, opening: 0, credits: 0, debits: 0, closing: 0, isPseudo: r.isPseudo });
        }
        const s = memberSummaryMap.get(r.memberId);
        s.opening += r.opening; s.credits += r.credits; s.debits += r.debits; s.closing += r.closing;
    }
    const memberSummary = [...memberSummaryMap.values()].map(s => ({
        ...s, opening: round2(s.opening), credits: round2(s.credits), debits: round2(s.debits), closing: round2(s.closing)
    })).sort((a, b) => b.closing - a.closing || a.member.localeCompare(b.member));

    const memberClosingTotal = round2(memberRows.reduce((s, r) => s + r.closing, 0));
    const memberPseudoTotal = round2(memberRows.filter(r => r.isPseudo).reduce((s, r) => s + r.closing, 0));

    // =========================================================================
    // Loan register + movements
    // =========================================================================
    const loanRows = [];
    for (const L of loans) {
        if (truthy(L.is_deleted)) continue;
        const mem = memberMap.get(String(L.member_id));
        const entId = String(L.enterprise_id || '');
        const entAcc = entAccountById.get(entId);
        const act = loanActivity.get(String(L.id)) || { disbursed: 0, repaid: 0, charges: 0, principalNet: 0, detailNet: 0 };
        // A loan detail is negative when the loan is advanced, so the amount
        // owed to the cooperative is the negated sum of the principal movement.
        const outstanding = round2(-act.principalNet);
        const due = normDate(L.due_date);
        const issued = normDate(L.issued_date);
        let ageing = '';
        if (due) {
            const days = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${due}T00:00:00Z`)) / 86400000);
            ageing = days > 0 ? `${days} days overdue` : `${Math.abs(days)} days remaining`;
        }
        const rem = remById.get(String(L.remittance_id));
        loanRows.push({
            loanId: String(L.id), member: memberName(mem), regNo: T(mem?.registration_no),
            account: entAcc ? entAcc.name : '(unknown account)',
            status: T(L.status) || '(blank)', principal: round2(num(L.principal_amount)),
            issued, due, duration: T(L.duration_months),
            disbursed: round2(act.disbursed), repaid: round2(act.repaid), charges: round2(act.charges),
            outstanding, ageing,
            disbursementRef: T(L.remittance_id) || '',
            disbursementStatus: rem ? T(rem.status) : '(missing)'
        });
        if (rem && T(rem.status) === 'Approved' && T(L.status).toLowerCase() === 'pending') {
            addException('High', 'LOAN_PENDING_POSTED', 'Loan is Pending but its disbursement is already Approved', String(L.id), outstanding,
                `Loan ${L.id} has status "${T(L.status)}" while remittance ${T(L.remittance_id)} is Approved, so the disbursement is included in every figure in this pack.`);
        }
        if (rem && truthy(rem.is_deleted)) {
            addException('High', 'LOAN_DISBURSEMENT_DELETED', 'Loan disbursement has been deleted', String(L.id), outstanding,
                `Loan ${L.id} references remittance ${T(L.remittance_id)}, which is flagged is_deleted.`);
        }
        if (outstanding < -EPS) {
            addException('High', 'LOAN_NEGATIVE_OUTSTANDING', 'Derived loan outstanding is negative', String(L.id), outstanding,
                `Loan ${L.id} was issued for ${round2(num(L.principal_amount)).toLocaleString()} but the postings attributed to it net to a credit of ${round2(-outstanding).toLocaleString()}. A loan disbursement records a negative detail on the loan account; a positive one means the advance was recorded in the wrong direction, so the receivable is overstated by a credit.`);
        }
    }
    loanRows.sort((a, b) => b.outstanding - a.outstanding || a.member.localeCompare(b.member));

    const loanOutstandingTotal = round2(loanRows.reduce((s, r) => s + r.outstanding, 0));
    const loanAccountClosing = round2(ordered.filter(a => a.bucket === 'loan').reduce((s, a) => s + (a.openingNet + a.periodNet), 0));

    // A movement belongs on the loan sheet when it actually posted to a loan
    // account, not when its header happens to be categorised "Loan Asset". The
    // app tags most loan activity with other categories (and some with none at
    // all), so a header-category test misses real disbursements and repayments
    // and would leave the sheet unable to support a loan control.
    const loanMovementRemIds = new Set(
        postings.filter(p => p.inPeriod && p.acc.bucket === 'loan' && p.meta.leg === 'Member')
            .map(p => p.meta.remittanceId)
    );
    const loanMoveRows = [];
    for (const { r, d } of toDate) {
        if (d < from) continue;
        if (!loanMovementRemIds.has(String(r.id))) continue;
        const cat = T(r.category), txType = T(r.transaction_type);
        const rdets = detByRem.get(String(r.id)) || [];
        const mem = memberMap.get(String(r.member_id));
        const loanDetail = round2(rdets.filter(x => !truthy(x.is_deleted) && entById.has(String(x.enterprise_id))
            && enterpriseAccount(entById.get(String(x.enterprise_id))).bucket === 'loan')
            .reduce((s, x) => s + num(x.amount), 0));
        loanMoveRows.push({
            date: d, remittanceId: String(r.id), transactionType: txType, category: cat,
            member: memberName(mem), regNo: T(mem?.registration_no),
            bank: T(r.bank_name) || '(blank)', amount: round2(num(r.amount)),
            detailCount: rdets.length,
            detailSum: round2(rdets.reduce((s, x) => s + num(x.amount), 0)),
            loanAccountAmount: loanDetail,
            loanId: loanIdForRemittance(r), parentId: T(r.parent_remittance_id) || ''
        });
    }
    loanMoveRows.sort((a, b) => a.date.localeCompare(b.date) || a.remittanceId.localeCompare(b.remittanceId));

    // =========================================================================
    // Account mapping
    // =========================================================================
    const mappingRows = [];
    for (const acc of ordered) {
        let source = '', rule = '';
        if (acc.bucket === 'bank') {
            source = 'remittance.bank_name (not "Internal Transfer")';
            rule = 'Header amount posts to this bank account. Debit when the header is positive (cash in), Credit when negative (cash out).';
        } else if (acc.bucket === 'loan') {
            source = 'remittance_detail.enterprise_id -> enterprise.account_type = "Loan"';
            rule = 'Sum of detail amounts, negated. A negative detail (disbursement) increases the receivable.';
        } else if (acc.bucket === 'asset' || acc.bucket === 'liability' || acc.bucket === 'equityEnt') {
            source = `remittance_detail.enterprise_id -> enterprise.account_type = "${acc.bucket}"`;
            rule = 'Sum of detail amounts on this enterprise account.';
        } else if (acc.bucket === 'savings') {
            source = 'remittance_detail.enterprise_id -> enterprise.account_type = "Savings" and revenue is not set';
            rule = 'Credit balance owed to members. Withdrawals post as negative details.';
        } else if (acc.bucket === 'due') {
            source = 'remittance_detail.enterprise_id -> enterprise has compulsory_due or is_penalty set';
            rule = 'Member obligation for dues/penalties. Included in member net worth, matching the app\'s buildAccountBalance.';
        } else if (acc.bucket === 'coopAsset') {
            source = 'remittance.category in (Asset, Fixed Asset)';
            rule = 'Header amount posts on the side opposite the cash direction, whether or not a bank leg exists.';
        } else if (acc.type === 'Income') {
            source = `remittance.category in (${INCOME_CATS.join(', ')})`;
            rule = 'Header amount recognised as income, posted on the side opposite the cash direction. This is the only income basis, so member-side revenue accounts are excluded to prevent double counting.';
        } else {
            source = `remittance.category in (${EXPENSE_CATS.join(', ')})`;
            rule = 'Header amount recognised as an expense, posted on the side opposite the cash direction.';
        }
        mappingRows.push({ code: acc.code, account: acc.name, type: acc.type, normal: acc.normal, classification: acc.classification, source, rule });
    }
    for (const [code, cur] of [...revenueEntMemo.entries()].sort()) {
        const acc = cur.acc;
        mappingRows.push({
            code, account: acc.name, type: acc.type, normal: acc.normal,
            classification: acc.classification, source: 'remittance_detail.enterprise_id -> enterprise.revenue = 1 (no compulsory_due / is_penalty)',
            rule: 'MEMO ONLY — excluded from the trial balance because income is recognised on the header classification basis. Any balance shown is income accrued to members but not yet picked up.'
        });
    }

    // =========================================================================
    // Control checks
    // =========================================================================
    const postingResidual = round2(postings.reduce((s, p) => s + p.netDr, 0));
    const tbCloseDiff = round2(tbCloseDr - tbCloseCr);
    const tbOpenDiff = round2(tbOpenDr - tbOpenCr);
    const cashCheck = round2(cashOpTotal + cashRecTotal - cashPayTotal - cashCloseTotal);

    // Member accounts are compared against the member-related trial balance
    // lines only, each presented on its own normal balance. Cash, cooperative
    // assets, income, expenditure and retained earnings are not member
    // balances and are deliberately outside this comparison.
    const MEMBER_BUCKETS = ['savings', 'due', 'liability', 'equityEnt', 'asset', 'loan'];
    const tbMemberSide = round2(ordered
        .filter(a => MEMBER_BUCKETS.includes(a.bucket))
        .reduce((s, a) => {
            const net = a.openingNet + a.periodNet;
            return s + (a.normal === 'CR' ? -net : net);
        }, 0));
    const memberVsTb = round2(memberClosingTotal - tbMemberSide);

    const tbLoanAsset = round2(ordered.filter(a => a.bucket === 'loan').reduce((s, a) => s + a.openingNet + a.periodNet, 0));
    const unattributedLoanNet = round2(unattributedLoan.reduce((s, x) => s + x.amount, 0));
     const incomeDetailTotal = round2(incomeRows.reduce((s, r) => s + r.effect, 0));
     const tbIncomePeriod = round2(ordered.filter(a => a.bucket === 'income').reduce((s, a) => s + a.periodNet, 0));
     const expenseDetailTotal = round2(expenseRows.reduce((s, r) => s + r.effect, 0));
     const tbExpensePeriod = round2(ordered.filter(a => a.bucket === 'expense').reduce((s, a) => s + a.periodNet, 0));
     const coopAssetTotal = round2(coopAssetRows.reduce((s, r) => s + r.effect, 0));
     const tbCoopAsset = round2(ordered.filter(a => a.bucket === 'coopAsset').reduce((s, a) => s + a.periodNet, 0));
     const liabilityDetailTotal = round2(liabilityRows.reduce((s, r) => s + r.effect, 0));
     const tbLiabilityPeriod = round2(ordered.filter(a => a.bucket === 'liability').reduce((s, a) => s + a.periodNet, 0));

    // Gross member credits and debits, for the control that proves both sides of
    // the member statement are populated and foot to the period movement.
    const memberCreditsTotal = round2(memberRows.reduce((s, r) => s + r.credits, 0));
    const memberDebitsTotal = round2(memberRows.reduce((s, r) => s + r.debits, 0));
    const memberPeriodTotal = round2(memberRows.reduce((s, r) => s + r.credits - r.debits, 0));

    // Loan roll-forward, on the loan receivable's own debit-positive frame.
    const loanBucketAccounts = ordered.filter(a => a.bucket === 'loan');
    const loanOpeningNet = round2(loanBucketAccounts.reduce((s, a) => s + a.openingNet, 0));
    const loanDisbursedNet = round2(postings.filter(p => p.inPeriod && p.acc.bucket === 'loan')
        .reduce((s, p) => s + p.netDr, 0));
    const tbLoanAssetClosingFromOpening = round2(loanOpeningNet + loanDisbursedNet);
    const loanRollForwardDiff = round2(tbLoanAssetClosingFromOpening - tbLoanAsset);

    const status = (diff, tol) => Math.abs(diff) <= (tol == null ? 0.01 : tol) ? 'PASS' : 'REVIEW';
    const checks = [
        { id: 'C1', name: 'Trial Balance closing integrity', description: 'Total closing Debits must equal total closing Credits.', valueA: tbCloseDr, valueB: tbCloseCr, difference: tbCloseDiff, status: status(tbCloseDiff), note: 'The difference is the sum of every posting that could not be traced to a complete entry. It is disclosed, never plugged. See the Data Quality Exceptions sheet.' },
        { id: 'C2', name: 'Trial Balance opening integrity', description: 'Total opening Debits must equal total opening Credits.', valueA: tbOpenDr, valueB: tbOpenCr, difference: tbOpenDiff, status: status(tbOpenDiff), note: 'Reflects unbalanced postings dated before the start of the selected period.' },
        { id: 'C3', name: 'Posting completeness', description: 'The trial balance difference must equal the arithmetic sum of all postings.', valueA: tbCloseDiff, valueB: postingResidual, difference: round2(tbCloseDiff - postingResidual), status: status(tbCloseDiff - postingResidual), note: 'Proves no figure was adjusted, filtered or omitted after the postings were derived.' },
        { id: 'C4', name: 'Cash book continuity', description: 'Opening + receipts - payments must equal closing for every bank.', valueA: round2(cashOpTotal + cashRecTotal - cashPayTotal), valueB: cashCloseTotal, difference: cashCheck, status: status(cashCheck), note: 'Proves the cash book moves continuously from the opening position to the closing position with no unexplained step. Internal transfer rows are excluded from receipts and payments because they never touch a bank account; their net movement is disclosed by C9.' },
        { id: 'C5', name: 'Member accounts vs trial balance', description: 'Member credit balances less loan debit balances must equal the member-related lines in the trial balance.', valueA: memberClosingTotal, valueB: tbMemberSide, difference: memberVsTb, status: status(memberVsTb), note: 'Covers savings, dues and penalties, other liabilities, member equity, other assets and loans. Excludes cash, cooperative assets, income, expenditure and retained earnings, which are not member balances. The cooperative pseudo-member is included here and reported separately in C10.' },
        { id: 'C6', name: 'Loan register vs loan accounts', description: 'Sum of per-loan outstanding must equal the loan receivable balance in the trial balance.', valueA: loanOutstandingTotal, valueB: tbLoanAsset, difference: round2(loanOutstandingTotal - tbLoanAsset), status: status(loanOutstandingTotal - tbLoanAsset), note: 'A difference means loan-account postings exist that do not resolve to a loan record. Those are listed individually as LOAN_DETAIL_UNATTRIBUTED and quantified in C11.' },
        { id: 'C15', name: 'Member credits less debits', description: 'Total gross member credits less total gross member debits must equal the total member period movement.', valueA: round2(memberCreditsTotal - memberDebitsTotal), valueB: memberPeriodTotal, difference: round2(memberCreditsTotal - memberDebitsTotal - memberPeriodTotal), status: status(memberCreditsTotal - memberDebitsTotal - memberPeriodTotal), note: 'Credits and debits are counted gross, so both columns are populated and an account that was credited and debited in the same period shows both. This is the control that would fail if the columns were derived from the sign of the net movement instead.' },
        { id: 'C7', name: 'Income detail vs trial balance', description: 'Sum of the signed income effects must equal the trial balance income movement for the period.', valueA: incomeDetailTotal, valueB: round2(-tbIncomePeriod), difference: round2(incomeDetailTotal + tbIncomePeriod), status: status(incomeDetailTotal + tbIncomePeriod), note: 'Both sides are net. A negative income header is a reversal and reduces income on both the detail sheet and the trial balance, so this control still foots.' },
        { id: 'C8', name: 'Expense detail vs trial balance', description: 'Sum of the signed expenditure effects must equal the trial balance expenditure movement for the period.', valueA: expenseDetailTotal, valueB: tbExpensePeriod, difference: round2(expenseDetailTotal - tbExpensePeriod), status: status(expenseDetailTotal - tbExpensePeriod), note: 'Excludes cooperative asset movements, which are an asset purchase rather than an expense. Those are reported separately in the Trial Balance and are quantified in C12.' },
        { id: 'C9', name: 'Internal transfer memo', description: 'Non-cash headers are excluded from cash and income. Their net movement is disclosed as a memo only.', valueA: round2(internalMemo.net), valueB: 0, difference: round2(internalMemo.net), status: 'INFO', note: 'Internal transfers reallocate value between member accounts; they are not income and not cash.' },
        { id: 'C10', name: 'Cooperative pseudo-member balance', description: `Movement posted against member ${PSEUDO_MEMBER}, which represents the cooperative itself rather than a member.`, valueA: memberPseudoTotal, valueB: 0, difference: memberPseudoTotal, status: 'INFO', note: 'Excluded from member net worth, consistent with the app\'s buildAccountBalance.' },
        { id: 'C11', name: 'Loan movements traceable to a loan record', description: 'Loan account movements that cannot be matched to an individual loan record, counted and quantified.', valueA: unattributedLoan.length, valueB: 0, difference: unattributedLoan.length, status: unattributedLoan.length ? 'REVIEW' : 'PASS', note: `These movements are included in the loan receivable in the trial balance but cannot be shown against an individual loan. Unmatched count ${unattributedLoan.length}, net detail amount ${unattributedLoanNet.toLocaleString()}.` },
        { id: 'C12', name: 'Cooperative asset movements', description: 'Capitalised asset movements must be reported as assets, never as expenditure.', valueA: coopAssetTotal, valueB: tbCoopAsset, difference: round2(coopAssetTotal - tbCoopAsset), status: status(coopAssetTotal - tbCoopAsset), note: 'Confirms the Expense Detail sheet excludes capitalised asset purchases.' },
        { id: 'C13', name: 'One-legged non-cash entries', description: 'Internal transfer rows that form a family of their own and so have no related row to balance them.', valueA: oneLeggedCount, valueB: 0, difference: oneLeggedCount, status: oneLeggedCount ? 'REVIEW' : 'PASS', note: `These rows contribute to the trial balance control difference in C1. Count ${oneLeggedCount}, net header amount ${oneLeggedNet.toLocaleString()}. Each is listed as ONE_LEGGED_NON_CASH on the Data Quality Exceptions sheet, or summarised there when beyond the largest 200. They are overwhelmingly legacy rows that recorded a member balance without a cash leg.` },
         { id: 'C14', name: 'Loan receivable roll-forward', description: 'Opening loan receivable + disbursements - principal repaid = closing loan receivable.', valueA: tbLoanAssetClosingFromOpening, valueB: tbLoanAsset, difference: loanRollForwardDiff, status: status(loanRollForwardDiff), note: 'Disbursements and repayments are taken from the signed loan-account details posted in the period, so the roll-forward uses the same figures the Loan Movements sheet lists. Any difference is loan-account movement that no detail row explains, and is reported rather than absorbed.' },
         { id: 'C16', name: 'Liability detail vs trial balance', description: 'Sum of signed liability effects must equal the trial balance liability movement for the period.', valueA: liabilityDetailTotal, valueB: tbLiabilityPeriod, difference: round2(liabilityDetailTotal - tbLiabilityPeriod), status: status(liabilityDetailTotal - tbLiabilityPeriod), note: 'Covers member liability postings (e.g. Unknown Payments) that have no enterprise detail leg. The offsetting liability account keeps the trial balance in equilibrium, so these entries do not contribute to the control difference. Confirms the Liability Detail sheet agrees with the trial balance.' }
     ];

    const periodIncome = round2(-tbIncomePeriod);
    const periodExpense = round2(tbExpensePeriod);

    return {
        meta: {
            cooperativeId: String(cooperativeId), cooperativeName: coopName,
            startDate: from, endDate: to, openingDate: shiftDay(from, -1),
            generatedAt: new Date().toISOString(),
            generatedBy: generatedBy || 'System',
            periodLabel: from === to ? from : `${from} to ${to}`,
            postedRows: toDate.length, postings: postings.length
        },
        basis: [
            { topic: 'Scope', text: `One cooperative only (cooperative_id ${cooperativeId}). Every query is scoped in SQL and re-checked in JavaScript. No account-manager narrowing, matching the existing financial statements.` },
            { topic: 'Source of truth', text: 'Two records drive everything: remittance (header = cooperative/cash leg) and remittance_detail (member/enterprise leg). No new tables or columns were added and no source data was modified.' },
            { topic: 'Included rows', text: 'Only remittances that are Approved and not deleted, dated on or before the end of the period. Pending, declined and deleted rows are listed on the Transaction Audit Trail but excluded from every figure.' },
            { topic: 'Date handling', text: 'remittance.remittance_date is the posting date, compared as a plain YYYY-MM-DD string so both period boundaries are inclusive and no timezone shift can move a transaction between days.' },
            { topic: 'Cash basis', text: 'bank_name = "Internal Transfer" is not cash and never reaches the cash book. Internal transfers are disclosed as a memo on the Cash & Bank Book sheet.' },
            { topic: 'Income and expense basis', text: 'Recognised from the remittance header category, which is the only basis that captures the app\'s header-only income pickups. Member-side revenue enterprises are reported as a memo only so income cannot be counted twice.' },
            { topic: 'Member liability basis', text: 'Member savings, dues and penalty balances come from the sum of remittance_detail per enterprise, exactly as the app\'s buildAccountBalance computes member net worth. The remittance header amount is never used as a member balance.' },
            { topic: 'Retained earnings', text: 'Cumulative income less cumulative expense on the header classification basis, taken at the day before the period starts, so the period result is never double counted.' },
            { topic: 'Account codes', text: 'Codes are a reporting mapping layer derived at run time from the cooperative\'s own enterprises, banks and transaction types. They are not a statutory chart of accounts. The Account Mapping sheet documents the derivation of every line.' },
            { topic: 'Loan interest', text: 'The app recognises loan interest only as a one-time origination charge (a Loan Charges remittance plus a pickup to the cooperative). There is no accrual, so this pack reports charges collected, not accrued interest.' },
            { topic: 'Balancing', text: 'The pack never inserts a plug. Where the source data cannot form a complete entry the difference is reported as a control difference and listed line by line on the Data Quality Exceptions sheet.' }
        ],
        definitions: [
            { term: 'Opening balance', text: `Cumulative position at ${shiftDay(from, -1)} (the day before the period starts).` },
            { term: 'Period movement', text: `Postings dated between ${from} and ${to}, both dates inclusive.` },
            { term: 'Closing balance', text: `Cumulative position at ${to}. For income and expense accounts the closing column shows the period movement, because the result is carried in retained earnings.` },
            { term: 'Control difference', text: 'Total Debits less Total Credits on the trial balance. It is the value of postings that could not be matched into a complete double entry.' },
            { term: 'Family', text: 'A remittance together with the rows it generated, linked by parent_remittance_id or loan_id. Dues and charge families post as one balanced entry across several rows.' },
            { term: PSEUDO_MEMBER, text: 'The cooperative itself. Used by income, expense and cooperative-side postings, and excluded from member net worth.' }
        ],
        accounts: ordered,
        trialBalance: tbRows,
        trialBalanceTotals: {
            openingDr: tbOpenDr, openingCr: tbOpenCr, periodDr: tbPerDr, periodCr: tbPerCr,
            closingDr: tbCloseDr, closingCr: tbCloseCr,
            openingDiff: tbOpenDiff, closingDiff: tbCloseDiff
        },
        periodResult: { income: periodIncome, expense: periodExpense, surplus: round2(periodIncome - periodExpense), retainedEarningsOpening: reOpening },
        generalLedger: glRows,
        cashBook: { summary: cashSummary, transactions: cashTxRows, internalMemo: internalMemo.rows, internalNet: round2(internalMemo.net), totals: { opening: cashOpTotal, receipts: cashRecTotal, payments: cashPayTotal, closing: cashCloseTotal } },
        memberAccounts: { rows: memberRows, summary: memberSummary, closingTotal: memberClosingTotal, pseudoTotal: memberPseudoTotal },
        loanRegister: { rows: loanRows, movements: loanMoveRows, outstandingTotal: loanOutstandingTotal, accountClosing: loanAccountClosing },
        incomeDetail: incomeRows,
        expenseDetail: expenseRows,
        liabilityDetail: liabilityRows,
        coopAssetDetail: coopAssetRows,
        bankReconciliation: bankRecs.map(b => ({
            bank: T(b.bank_name), period: T(b.period_month), status: T(b.status),
            bankCr: round2(num(b.bank_total_cr)), bankDr: round2(num(b.bank_total_dr)),
            systemCr: round2(num(b.system_total_cr)), systemDr: round2(num(b.system_total_dr)),
            difference: round2(num(b.system_total_cr) - num(b.bank_total_cr) - num(b.system_total_dr) + num(b.bank_total_dr))
        })),
        accountMapping: mappingRows,
        revenueEntMemo: [...revenueEntMemo.values()].map(v => ({ code: v.acc.code, account: v.acc.name, opening: round2(-v.net), period: round2(-v.periodNet), closing: round2(-v.net - v.periodNet) })),
        unattributedLoan: { rows: unattributedLoan, count: unattributedLoan.length, net: unattributedLoanNet },
        // Every account the run created, including memo accounts excluded from
        // the trial balance, so an account that nets to nil can still be traced.
        accountDiagnostics: [...reg.accounts].map(a => {
            const mine = postings.filter(p => p.acc === a);
            return {
                code: a.code, account: a.name, bucket: a.bucket, type: a.type, normal: a.normal,
                inTrialBalance: a.inTrialBalance, postings: mine.length,
                openingNetDr: round2(a.openingNet), periodNetDr: round2(a.periodNet),
                closingNetDr: round2(a.openingNet + a.periodNet),
                presented: round2((a.normal === 'CR' ? -1 : 1) * (a.openingNet + a.periodNet))
            };
        }).sort((x, y) => x.code.localeCompare(y.code)),
        auditTrail: auditRows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.remittanceId).localeCompare(String(b.remittanceId)))),
        controlChecks: checks,
        exceptions: exceptions.sort((a, b) => a.severity.localeCompare(b.severity) || Math.abs(b.amount) - Math.abs(a.amount)),
        stats
    };
}
