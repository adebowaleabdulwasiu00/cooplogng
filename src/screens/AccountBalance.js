import { buildAccountBalance, fetchEnterprises, fetchRemittances, fetchAllMembers, fetchBanks } from '../services/dataService.js'
import { hasPermission } from '../services/permissionService.js'
import { formatCurrency, escapeHtml } from '../utils/formatters.js'
import { getPendingQueue, queryRows } from '../services/sqliteService.js'
import { showToast } from '../services/toastService.js'
import { showWithdrawalWizard } from '../components/WithdrawalWizard.js'

// ─── Classification Helpers ─────────────────────────────────────────────────
function isDashboardIncome(cls) {
    return cls === 'Revenue' || cls === 'Operating Income' || cls === 'Loan Income' || cls === 'Other Income';
}
function isDashboardExpense(cls) {
    return cls === 'Expense' || cls === 'Expenses' || cls === 'Operating Expense' || cls === 'Administrative Expense' || cls === 'Finance Expense' || cls === 'Welfare Expense' || cls === 'Other Operating Expense' || cls === 'Other Expenses';
}

// Persist mask/unmask state using localStorage
const MASK_PREF_KEY = 'cooplog_balance_mask'
const SHOW_ZERO_BALANCE_KEY = 'cooplog_show_zero_balance'

function getMaskPreference() {
  try {
    const stored = localStorage.getItem(MASK_PREF_KEY)
    return stored !== null ? stored === 'true' : true
  } catch (e) {
    return true
  }
}

function getShowZeroBalancePreference() {
  try {
    const stored = localStorage.getItem(SHOW_ZERO_BALANCE_KEY)
    return stored !== null ? stored === 'true' : false
  } catch (e) {
    return false
  }
}

let maskBalances = getMaskPreference()
let showZeroBalances = getShowZeroBalancePreference()



function saveMaskPreference(value) {
  try {
    localStorage.setItem(MASK_PREF_KEY, String(value))
  } catch (e) {
    console.warn('Could not save mask preference', e)
  }
}

function saveShowZeroBalancePreference(value) {
  try {
    localStorage.setItem(SHOW_ZERO_BALANCE_KEY, String(value))
  } catch (e) {
    console.warn('Could not save show zero preference', e)
  }
}

export async function renderAccountBalance(container, user) {
    const isAdmin = user.isAdmin || hasPermission(user.permissions, 'admin') || user.username?.toLowerCase() === 'admin'
    const isMember = user.role === 'member'
    const isStaff = !isAdmin && !isMember
    const hasDashboardAccess = isAdmin || isMember || hasPermission(user.permissions, 'dashboard_view');

    if (!hasDashboardAccess) {
        container.innerHTML = `
      <div class="page-header">
        <h2>Dashboard</h2>
      </div>
      <div class="page-container">
        <div style="background: var(--danger-bg); color: var(--danger); padding: 1.5rem; border-radius: var(--radius-md); text-align: center; font-weight: 600; border: 1px solid var(--danger);">
          Access Denied: You do not have permission to view the Dashboard.
        </div>
      </div>
    `
        return;
    }



    const headerHtml = `
    <div class="page-header dashboard-page-header" style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2 style="margin: 0; color: var(--text-primary);">Dashboard</h2>
          <p class="subtitle" style="margin: 0.25rem 0 0 0; color: var(--text-muted);">Welcome back!</p>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <button id="toggle-mask-btn" class="ghost-button" style="
            width: 2.25rem;
            height: 2.25rem;
            padding: 0.375rem;
            border-radius: 0.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
          ">
            ${maskBalances ? `
              <!-- Visible eye -->
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12C2 12 5.63636 5 12 5C18.3636 5 22 12 22 12C22 12 18.3636 19 12 19C5.63636 19 2 12 2 12Z"/>
                <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"/>
              </svg>
            ` : `
              <!-- Hidden eye -->
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.9449 17.9449C16.3991 19.2325 14.2839 20 12 20C5.63636 20 2 12 2 12C3.8607 8.49382 6.66692 5.90325 10 4.99988M9.9 4.30021C10.5861 4.10767 11.2873 4.00024 12 4.00024C18.3636 4.00024 22 12 22 12C21.3037 13.3719 20.3339 14.6377 19.169 15.711M15 11.5C15 13.1569 13.6569 14.5 12 14.5C10.6362 14.5 9.47666 13.6048 9.09204 12.335M4 4L20 20"/>
              </svg>
            `}
          </button>
          <button id="theme-toggle-btn-dashboard" class="ghost-button" style="
            width: 2.25rem;
            height: 2.25rem;
            padding: 0.375rem;
            border-radius: 0.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
          " title="Toggle theme">
            <!-- Filled dynamically by js -->
          </button>
        </div>
      </div>



    </div>
    <div class="page-container" id="balance-content"></div>
  `

    try {
        let visibleBalance = []

        const queryUser = JSON.parse(JSON.stringify(user));

        let { accountBalance } = await buildAccountBalance(user.cooperativeId, queryUser)
        visibleBalance = accountBalance

        const enterpriseRows = await fetchEnterprises(user.cooperativeId, true)
        const allEnts = {}
        const entObjMap = {}
        enterpriseRows.forEach(e => {
            allEnts[e.id] = e.account_name
            entObjMap[e.id] = e
        })

        // Guard: if enterprises exist but balance is all zero, retry once with a brief delay
        if (enterpriseRows.length > 0 && (accountBalance.length === 0 || accountBalance.every(b => (b.sum_of_amount || 0) === 0))) {
            await new Promise(r => setTimeout(r, 150))
            const retried = await buildAccountBalance(user.cooperativeId, queryUser)
            if (retried.accountBalance.some(b => (b.sum_of_amount || 0) !== 0)) {
                accountBalance = retried.accountBalance
                visibleBalance = accountBalance
            }
        }

        const existingIds = new Set(visibleBalance.map(b => b.id))
        Object.keys(allEnts).forEach(id => {
            if (!existingIds.has(id)) {
                visibleBalance.push({ id, account_name: allEnts[id], sum_of_amount: 0 })
            }
        })
        visibleBalance.sort((a, b) => a.account_name.localeCompare(b.account_name))

        let allowedEntIds = [];
        let allowedEntNames = [];
        let hasAllAccess = false;

        if (isStaff) {
            const rightsString = user.enterprise_rights || user.enterprises || '';
            const rights = rightsString.split(',').map(p => p.trim()).filter(p => p.length > 0);

            if (rights.some(r => r.toLowerCase() === 'all')) {
                hasAllAccess = true;
            } else {
                rights.forEach(r => {
                    const matchId = Object.keys(allEnts).find(id => id.toLowerCase() === r.toLowerCase());
                    if (matchId) {
                        allowedEntIds.push(matchId);
                    } else {
                        allowedEntNames.push(r.toLowerCase());
                    }
                });
            }
        }

        let visibleTotal = 0;
        let totalSavingsLiabilities = 0;
        let totalLoansOutstandingAssets = 0;
        let totalRevenueCollected = 0;

        visibleBalance = visibleBalance.map(b => {
            const hasAccess = isAdmin || isMember || hasAllAccess ||
                allowedEntIds.includes(b.id) ||
                allowedEntNames.includes((b.account_name || '').toLowerCase());

            if (!hasAccess) {
                return { ...b, sum_of_amount: 0, isRestricted: true };
            }

            const entObj = entObjMap[b.id];
            const isRevenue = entObj && (entObj.revenue == 1 || entObj.revenue === '1' || entObj.revenue === 'true' || entObj.revenue === true || entObj.account_type === 'revenue');
            const isPenalty = entObj && (entObj.is_penalty == 1 || entObj.is_penalty === '1' || entObj.is_penalty === 'true' || entObj.is_penalty === true);
            if (isMember && (isRevenue || isPenalty)) {
                return null;
            }

            const type = entObj ? (entObj.account_type || '').toLowerCase() : '';
            if (isRevenue) {
                // revenue captured from transaction details below, not from balance
            } else if ((type === 'savings' || type === 'liability') && !isPenalty) {
                totalSavingsLiabilities += (b.sum_of_amount || 0);
            } else if (type === 'loan' || type === 'asset') {
                totalLoansOutstandingAssets += Math.abs(b.sum_of_amount || 0);
            }

            visibleTotal += (b.sum_of_amount || 0)
            return b;
        }).filter(Boolean)

        let totalBankCash = 0;
        try {
            const bankBalSql = `
                SELECT SUM(amount) as net_balance
                FROM remittance
                WHERE cooperative_id = ? AND status = 'Approved' AND is_deleted = 0
                  AND (bank_name IS NULL OR bank_name != 'Internal Transfer')
            `;
            const bankBalResult = await queryRows(bankBalSql, [String(user.cooperativeId)]);
            totalBankCash = parseFloat(bankBalResult[0]?.net_balance || 0);
        } catch (e) {
            console.warn('Failed to calculate bank cash:', e);
        }

        const subtitleEl = container.querySelector('.subtitle')
        if (subtitleEl) {
            if (isMember) {
                subtitleEl.innerHTML = `Welcome back, <strong style="color: var(--accent-primary);">${escapeHtml(user.memberName || user.fullName || 'Member')}</strong>`
            } else {
                subtitleEl.innerHTML = `Viewing <strong>${isAdmin ? 'Global' : 'Accessible'}</strong> cooperative data.`
            }
        }

        let remittances = await fetchRemittances(user.cooperativeId, queryUser)
        if (queryUser.memberId && queryUser.memberId !== '0000000000') {
            remittances = remittances.filter(r => r.member_id === queryUser.memberId);
        }
        const recentRemittances = remittances.slice(0, 10)

        const banks = await fetchBanks(user.cooperativeId)

        // Add revenue from income-classified transactions across all enterprises,
        // and from positive amounts in penalty enterprises (revenue regardless of category)
        for (const rem of remittances) {
            if (rem.status !== 'Approved') continue;
            const cls = rem.category || '';
            const isIncomeCat = isDashboardIncome(cls);
            for (const d of (rem.details || [])) {
                const entObj = entObjMap[d.enterprise_id];
                if (!entObj) continue;
                const isRevenueEnt = entObj && (entObj.revenue == 1 || entObj.revenue === '1' || entObj.revenue === 'true' || entObj.revenue === true || entObj.account_type === 'revenue');
                const isPenaltyEnt = entObj && (entObj.is_penalty == 1 || entObj.is_penalty === '1' || entObj.is_penalty === 'true' || entObj.is_penalty === true);
                const amt = parseFloat(d.amount || 0);
                if (isIncomeCat || ((isRevenueEnt || isPenaltyEnt) && amt > 0)) {
                    totalRevenueCollected += amt;
                }
            }
        }

        // Fetch statistics
        let members = await fetchAllMembers(user.cooperativeId, user.username, isAdmin || hasAllAccess)
        if (queryUser.memberId && queryUser.memberId !== '0000000000') {
            members = members.filter(m => m.id === queryUser.memberId);
        }
        const now = Date.now()
        const thisMonthStart = new Date(now).setDate(1)
        let newThisMonth = 0
        let activeMembers = 0
        members.forEach(m => {
            if (m.status === 'Active') activeMembers++;
            if (m.date_joined) {
                const joinedMs = new Date(m.date_joined).getTime()
                if (!isNaN(joinedMs) && joinedMs >= thisMonthStart) {
                    newThisMonth++
                }
            }
        })

        const pendingRemittances = remittances.filter(r => r.status === 'Pending').length
        const approvedThisMonth = remittances.filter(r => {
            const remitDate = new Date(r.remittance_date).getTime()
            return r.status === 'Approved' && remitDate >= thisMonthStart
        }).length

        // Calculate organizational revenue, expenses, net position at detail level
        let organizationalRevenue = 0
        let organizationalExpenses = 0
        try {
            const monthStartStr = `${new Date(thisMonthStart).getFullYear()}-${String(new Date(thisMonthStart).getMonth() + 1).padStart(2, '0')}-01`;
            const monthlySql = `
                SELECT rd.amount, r.category, rd.enterprise_id, r.remittance_date
                FROM remittance r
                JOIN remittance_detail rd ON r.id = rd.remittance_id
                WHERE r.cooperative_id = ? AND r.status = 'Approved' AND r.is_deleted = 0
            `;
            const monthlyRows = await queryRows(monthlySql, [String(user.cooperativeId)]);
            monthlyRows.forEach(row => {
                const remDate = new Date(row.remittance_date).getTime();
                if (isNaN(remDate) || remDate < thisMonthStart) return;
                const amt = parseFloat(row.amount || 0);
                const cls = row.category || '';
                const entObj = entObjMap[row.enterprise_id];
                const isRevenueEnt = entObj && (entObj.revenue == 1 || entObj.revenue === '1' || entObj.revenue === 'true' || entObj.revenue === true || entObj.account_type === 'revenue');
                const isPenaltyEnt = entObj && (entObj.is_penalty == 1 || entObj.is_penalty === '1' || entObj.is_penalty === 'true' || entObj.is_penalty === true);
                if (isDashboardIncome(cls) || ((isRevenueEnt || isPenaltyEnt) && amt > 0)) {
                    organizationalRevenue += amt;
                } else if (isDashboardExpense(cls)) {
                    organizationalExpenses += Math.abs(amt);
                }
            });
        } catch (e) {
            console.warn('Failed to calculate dashboard monthly stats:', e);
        }
        const netPosition = organizationalRevenue - organizationalExpenses
        
        // Fetch loans outstanding balances
        let activeLoans = 0
        let activeLoansAmount = 0
        let overdueLoans = 0
        let overdueLoansAmount = 0
        try {
            let loans = await queryRows(`SELECT * FROM loans WHERE cooperative_id = ? AND is_deleted = 0`, [String(user.cooperativeId)])
            if (queryUser.memberId && queryUser.memberId !== '0000000000') {
                loans = loans.filter(l => l.member_id === queryUser.memberId);
            }
            
            const loanDetailsSql = `
                SELECT r.member_id, rd.enterprise_id, SUM(rd.amount) as net_amt
                FROM remittance r
                JOIN remittance_detail rd ON r.id = rd.remittance_id
                WHERE r.cooperative_id = ? AND r.status = 'Approved' AND r.is_deleted = 0
                GROUP BY r.member_id, rd.enterprise_id
            `;
            const loanDetailsRows = await queryRows(loanDetailsSql, [String(user.cooperativeId)]);
            
            const loanBalMap = {};
            loanDetailsRows.forEach(row => {
                const key = `${row.member_id}_${row.enterprise_id}`;
                loanBalMap[key] = Math.abs(parseFloat(row.net_amt || 0));
            });

            loans.forEach(l => {
                const key = `${l.member_id}_${l.enterprise_id}`;
                const outstanding = loanBalMap[key] !== undefined ? loanBalMap[key] : parseFloat(l.principal_amount || 0);

                if (l.status === 'Active') {
                    activeLoans++;
                    activeLoansAmount += outstanding;
                }
                if (l.status === 'Overdue') {
                    overdueLoans++;
                    overdueLoansAmount += outstanding;
                }
            })
        } catch (e) {
            console.warn('Error fetching loans for stats:', e)
        }

        // Fetch sync queue
        const syncQueue = await getPendingQueue(user.cooperativeId)

        const maskValue = (value) => {
            if (maskBalances) {
                return '••••••••'
            }
            return formatCurrency(value)
        }

        const isMemberView = isMember;

        let contentHtml = `
        <style>
            .dashboard-stats-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 1rem;
                margin-bottom: 2rem;
            }
            
            .dashboard-stat-card {
                background: var(--bg-card);
                border-radius: 1.25rem;
                padding: 1rem 1.5rem;
                position: relative;
                overflow: hidden;
                border: 1px solid var(--border-light);
            }
            
            .dashboard-stat-card::before {
                content: '';
                position: absolute;
                left: 0;
                top: 0;
                bottom: 0;
                width: 4px;
                border-radius: 4px 0 0 4px;
            }
            
            .dashboard-stat-card.blue::before {
                background: linear-gradient(180deg, #3B82F6, #60A5FA);
            }
            
            .dashboard-stat-card.yellow::before {
                background: linear-gradient(180deg, #F59E0B, #FBBF24);
            }
            
            .dashboard-stat-card.red::before {
                background: linear-gradient(180deg, #EF4444, #F87171);
            }
            
            .dashboard-stat-card.green::before {
                background: linear-gradient(180deg, #10B981, #34D399);
            }
            
            .dashboard-stat-card.purple::before {
                background: linear-gradient(180deg, #8B5CF6, #A78BFA);
            }
            
            .stat-card-label {
                font-size: 0.75rem;
                font-weight: 700;
                color: var(--text-muted);
                text-transform: uppercase;
                margin-bottom: 0.25rem;
            }
            
            .stat-card-value {
                font-size: 1.75rem;
                font-weight: 800;
                color: var(--text-primary);
                margin-bottom: 0.25rem;
            }
            
            .stat-card-subvalue {
                font-size: 0.75rem;
                color: var(--text-muted);
            }
            
            .stat-card-subvalue span {
                margin-right: 0.5rem;
            }
            
            .stat-card-new {
                color: var(--accent-primary);
            }
            
            .stat-card-issues {
                color: var(--danger);
            }
            
            #balance-content.hide-zero-ents .enterprise-card[data-balance-raw="0"],
            #balance-content.hide-zero-ents .enterprise-card[data-balance-raw="0.00"] {
                display: none;
            }
            @media (min-width: 768px) {
                .dashboard-stats-grid {
                    grid-template-columns: repeat(4, 1fr);
                }
            }
            @media (max-width: 767px) {
                .fab-container {
                    bottom: calc(64px + 1rem) !important;
                }
            }
            
            .fab-container {
                position: fixed;
                bottom: 1.5rem;
                right: 1.5rem;
                z-index: 999;
                display: flex;
                flex-direction: column-reverse;
                align-items: center;
                gap: 0.5rem;
            }
            .fab-trigger {
                width: 3.25rem;
                height: 3.25rem;
                border-radius: 50%;
                background: var(--accent-primary);
                color: white;
                border: none;
                font-size: 1.5rem;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0,0,0,0.25);
                display: flex;
                align-items: center;
                justify-content: center;
                transition: transform 0.2s ease;
            }
            .fab-trigger:hover { transform: scale(1.1); }
            .fab-trigger.open { transform: rotate(45deg); }
            .fab-menu {
                display: none;
                flex-direction: column;
                gap: 0.5rem;
                align-items: flex-end;
            }
            .fab-menu.open { display: flex; }
            .fab-item {
                padding: 0.6rem 1rem;
                border-radius: 0.75rem;
                background: var(--bg-card);
                border: 1px solid var(--border-light);
                font-weight: 600;
                cursor: pointer;
                color: var(--text-primary);
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                white-space: nowrap;
                display: flex;
                align-items: center;
                gap: 0.5rem;
                transition: background 0.15s;
            }
            .fab-item:hover { background: var(--bg-hover); }
        </style>
        
        
        <div class="fab-container">
          <button class="fab-trigger" id="fab-trigger">+</button>
          <div class="fab-menu" id="fab-menu">
            ${(() => {
              const items = [];
              if (isAdmin) {
                items.push({ action: 'members', icon: '👥', label: 'Add Member' });
                items.push({ action: 'log', icon: '💰', label: 'Log Remittance' });
                items.push({ action: 'reports', icon: '📊', label: 'Reports' });
                items.push({ action: 'settings', icon: '⚙️', label: 'Settings' });
                items.push({ action: 'withdrawal-request', icon: '💸', label: 'Withdrawal Request' });
              } else if (isStaff) {
                items.push({ action: 'members', icon: '👥', label: 'Add Member' });
                items.push({ action: 'log', icon: '💰', label: 'Log Payment' });
                items.push({ action: 'reports', icon: '📊', label: 'Reports' });
                items.push({ action: 'withdrawal-request', icon: '💸', label: 'Withdrawal Request' });
              } else {
                items.push({ action: 'ledger', icon: '📈', label: 'My Ledger' });
                items.push({ action: 'history', icon: '📜', label: 'History' });
                items.push({ action: 'withdrawal-request', icon: '💸', label: 'Withdrawal Request' });
              }
              return items.map(item => `
                <button class="fab-item" data-quick-action="${item.action}" style="padding: 0.6rem 1rem; border-radius: 0.75rem; background: var(--bg-card); border: 1px solid var(--border-light); font-weight: 600; cursor: pointer; color: var(--text-primary); box-shadow: 0 2px 8px rgba(0,0,0,0.15); white-space: nowrap; display: flex; align-items: center; gap: 0.5rem;">
                  <span>${item.icon}</span>
                  <span>${item.label}</span>
                </button>
              `).join('');
            })()}
          </div>
        </div>
        ${isMemberView ? `
        <div style="display: grid; grid-template-columns: 1fr; gap: 1rem; margin-bottom: 2rem;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 1.5rem; padding: 1.5rem; color: white;">
            <div style="font-size: 0.875rem; opacity: 0.9; text-transform: uppercase; font-weight: 600;">MY NET PORTFOLIO</div>
            <div style="font-size: 2rem; font-weight: 800; margin-top: 0.5rem;" data-balance-value="${visibleTotal}">${maskValue(visibleTotal)}</div>
          </div>
        </div>` : `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 1.5rem; padding: 1.5rem; color: white;">
            <div style="font-size: 0.875rem; opacity: 0.9; text-transform: uppercase; font-weight: 600;">TOTAL MEMBER SAVINGS (LIABILITY)</div>
            <div style="font-size: 1.75rem; font-weight: 800; margin-top: 0.5rem;" data-balance-value="${totalSavingsLiabilities}">${maskValue(totalSavingsLiabilities)}</div>
          </div>
          <div style="background: linear-gradient(135deg, #f87171 0%, #ef4444 100%); border-radius: 1.5rem; padding: 1.5rem; color: white;">
            <div style="font-size: 0.875rem; opacity: 0.9; text-transform: uppercase; font-weight: 600;">TOTAL OUTSTANDING LOANS (ASSETS)</div>
            <div style="font-size: 1.75rem; font-weight: 800; margin-top: 0.5rem;" data-balance-value="${totalLoansOutstandingAssets}">${maskValue(totalLoansOutstandingAssets)}</div>
          </div>
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%); border-radius: 1.5rem; padding: 1.5rem; color: white;">
            <div style="font-size: 0.875rem; opacity: 0.9; text-transform: uppercase; font-weight: 600;">Cash + Bank Balance</div>
            <div style="font-size: 1.75rem; font-weight: 800; margin-top: 0.5rem;" data-balance-value="${totalBankCash}">${maskValue(totalBankCash)}</div>
          </div>
          <div style="background: linear-gradient(135deg, #10b981 0%, #34d399 100%); border-radius: 1.5rem; padding: 1.5rem; color: white;">
            <div style="font-size: 0.875rem; opacity: 0.9; text-transform: uppercase; font-weight: 600;">TOTAL REVENUE COLLECTED</div>
            <div style="font-size: 1.75rem; font-weight: 800; margin-top: 0.5rem;" data-balance-value="${totalRevenueCollected}">${maskValue(totalRevenueCollected)}</div>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
          <div style="background: linear-gradient(135deg, #11998e 0%, #34d399 100%); border-radius: 1.5rem; padding: 1.5rem; color: white;">
            <div style="font-size: 0.875rem; opacity: 0.9; text-transform: uppercase; font-weight: 600;">TRANSACTIONS (THIS MONTH)</div>
            <div style="font-size: 1.75rem; font-weight: 800; margin-top: 0.5rem;">${approvedThisMonth}</div>
          </div>
          <div style="background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%); border-radius: 1.5rem; padding: 1.5rem; color: white;">
            <div style="font-size: 0.875rem; opacity: 0.9; text-transform: uppercase; font-weight: 600;">REVENUE (THIS MONTH)</div>
            <div style="font-size: 1.75rem; font-weight: 800; margin-top: 0.5rem;" data-balance-value="${organizationalRevenue}">${maskValue(organizationalRevenue)}</div>
          </div>
          <div style="background: linear-gradient(135deg, #ef4444 0%, #f87171 100%); border-radius: 1.5rem; padding: 1.5rem; color: white;">
            <div style="font-size: 0.875rem; opacity: 0.9; text-transform: uppercase; font-weight: 600;">EXPENSES (THIS MONTH)</div>
            <div style="font-size: 1.75rem; font-weight: 800; margin-top: 0.5rem;" data-balance-value="${organizationalExpenses}">${maskValue(organizationalExpenses)}</div>
          </div>
          <div style="background: linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%); border-radius: 1.5rem; padding: 1.5rem; color: white;">
            <div style="font-size: 0.875rem; opacity: 0.9; text-transform: uppercase; font-weight: 600;">NET POSITION (THIS MONTH)</div>
            <div style="font-size: 1.75rem; font-weight: 800; margin-top: 0.5rem;" data-balance-value="${netPosition}">${maskValue(netPosition)}</div>
          </div>
        </div>`}
        
        ${isMemberView ? `
        <div class="dashboard-stats-grid">
            <div class="dashboard-stat-card blue">
                <div class="stat-card-label">ACTIVE LOANS</div>
                <div class="stat-card-value">${activeLoans}</div>
                <div class="stat-card-subvalue">
                    <span data-balance-value="${activeLoansAmount}">${maskValue(activeLoansAmount)}</span>
                </div>
            </div>
            <div class="dashboard-stat-card red">
                <div class="stat-card-label">OVERDUE</div>
                <div class="stat-card-value">${overdueLoans}</div>
                <div class="stat-card-subvalue">
                    <span data-balance-value="${overdueLoansAmount}">${maskValue(overdueLoansAmount)}</span>
                </div>
            </div>
        </div>` : `
        <div class="dashboard-stats-grid">
            <div class="dashboard-stat-card blue">
                <div class="stat-card-label">TOTAL MEMBERS</div>
                <div class="stat-card-value">${members.length}</div>
                <div class="stat-card-subvalue">
                    <span class="stat-card-new">+${newThisMonth} new</span>
                    <span>• ${activeMembers} active</span>
                </div>
            </div>
            
            <div class="dashboard-stat-card yellow">
                <div class="stat-card-label">PENDING APPROVALS</div>
                <div class="stat-card-value">${pendingRemittances}</div>
                <div class="stat-card-subvalue">
                    <span>needs attention</span>
                </div>
            </div>
            
            <div class="dashboard-stat-card red">
                <div class="stat-card-label">ACTIVE LOANS</div>
                <div class="stat-card-value">${activeLoans}</div>
                <div class="stat-card-subvalue">
                    <span data-balance-value="${activeLoansAmount}">${maskValue(activeLoansAmount)}</span>
                </div>
            </div>
            
            <div class="dashboard-stat-card green">
                <div class="stat-card-label">SYNC QUEUE</div>
                <div class="stat-card-value">${syncQueue.length}</div>
                <div class="stat-card-subvalue">
                    <span>Records waiting</span>
                </div>
            </div>
        </div>`}
        
        ${(isMemberView || (!isMemberView && visibleBalance.length > 0)) ? `
        <div style="margin-bottom: 2rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
            <h3 style="color: var(--text-primary); margin: 0;">${isMember ? 'My Account Balances' : 'Enterprise Balances'}</h3>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span style="color: var(--text-muted); font-size: 0.875rem;">Show Zero Balances</span>
              <label style="
                position: relative;
                display: inline-flex;
                align-items: center;
                cursor: pointer;
              ">
                <input type="checkbox" id="toggle-zero-balances" ${showZeroBalances ? 'checked' : ''} style="display: none;">
                <div style="
                  width: 44px;
                  height: 24px;
                  background: ${showZeroBalances ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' : 'var(--border-light)'};
                  border-radius: 9999px;
                  transition: all 0.3s ease;
                  position: relative;
                ">
                  <div style="
                    position: absolute;
                    top: 2px;
                    left: ${showZeroBalances ? '22px' : '2px'};
                    width: 20px;
                    height: 20px;
                    background: white;
                    border-radius: 50%;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
                    transition: all 0.3s ease;
                  "></div>
                </div>
              </label>
            </div>
          </div>
          <div class="enterprise-grid">
        ` : ''}
    `

        if (isMemberView || (!isMemberView && visibleBalance.length > 0)) {
            if (visibleBalance.length === 0) {
                contentHtml += `<div class="card" style="width: 100%; border-radius: var(--radius-md); padding: 2rem; color: var(--text-muted); text-align: center;">No account balance found.</div>`
            } else {
                visibleBalance.forEach((ent) => {
                    contentHtml += `
              <div class="enterprise-card" data-balance-raw="${ent.sum_of_amount || 0}">
                <div class="enterprise-name">${escapeHtml(ent.account_name)}</div>
                <div class="enterprise-amt ${ent.sum_of_amount < 0 ? 'text-red' : ''}" data-balance-value="${ent.sum_of_amount || 0}">${maskValue(ent.sum_of_amount)}</div>
              </div>
            `
                })
            }

            contentHtml += `</div></div>`
        }

        contentHtml += `
        <div style="margin-bottom: 2rem;">
          <h3 style="color: var(--text-primary); margin-bottom: 1rem;">Recent Activity</h3>
          <div style="background: var(--bg-card); border-radius: 0.75rem; overflow: hidden; border: 1px solid var(--border-light);">
    `

        if (recentRemittances.length === 0) {
            contentHtml += `<div style="padding: 2rem; color: var(--text-muted); text-align: center;">No recent activity found.</div>`
        } else {
            contentHtml += `
        <table class="recent-activity-table" style="width: 100%; border-collapse: collapse;">
          <thead style="background: var(--bg-secondary);">
            <tr>
              <th style="padding: 0.75rem 1rem; text-align: left; font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted);">DATE</th>
              <th style="padding: 0.75rem 1rem; text-align: left; font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted);">DESCRIPTION</th>
              <th style="padding: 0.75rem 1rem; text-align: left; font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted);">BANK</th>
              <th style="padding: 0.75rem 1rem; text-align: left; font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted);">STATUS</th>
              <th style="padding: 0.75rem 1rem; text-align: right; font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted);">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
      `
            recentRemittances.forEach(remit => {
                contentHtml += `
          <tr style="border-top: 1px solid var(--border-light); cursor: pointer;" data-action="view-details" data-remittance='${JSON.stringify(remit).replace(/'/g, "&#39;")}'>
            <td style="padding: 0.75rem 1rem; font-size: 0.875rem; color: var(--text-secondary);">${escapeHtml(new Date(remit.remittance_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }))}</td>
            <td style="padding: 0.75rem 1rem; font-size: 0.875rem; color: var(--text-primary);">${escapeHtml(remit.description || 'No description')}</td>
            <td style="padding: 0.75rem 1rem; font-size: 0.875rem; color: var(--text-secondary);">${escapeHtml(remit.bank_name || '-')}</td>
            <td style="padding: 0.75rem 1rem;">
              <span style="display: inline-block; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; ${remit.status === 'Approved' ? 'background: #d1fae5; color: #065f46;' : remit.status === 'Pending' ? 'background: #fef3c7; color: #92400e;' : 'background: #fee2e2; color: #991b1b;'}">${escapeHtml(remit.status || 'Pending')}</span>
            </td>
            <td style="padding: 0.75rem 1rem; text-align: right; font-size: 0.875rem; font-weight: 600; color: ${remit.amount < 0 ? 'var(--danger)' : 'var(--text-primary)'};" data-balance-value="${remit.amount}">
              ${maskValue(remit.amount)}
            </td>
          </tr>
        `
            })
            contentHtml += `</tbody></table>`
        }

        contentHtml += `</div></div>`

        // Filter banks to show only visible ones, exclude internal transfers
        const visibleBanks = banks.filter(b => 
            (b.is_visible ?? true) && 
            b.id !== 'internal' && 
            b.id !== 'internal_transfer' &&
            !b.bank_name?.toLowerCase().includes('internal')
        )

        if (visibleBanks.length > 0) {
            contentHtml += `
            <div>
              <h3 style="color: var(--text-primary); margin-bottom: 1rem;">Cooperative Bank Accounts</h3>
              <div style="display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
        `

            visibleBanks.forEach(bank => {
                contentHtml += `
              <div style="
                background: linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, var(--bg-card) 100%);
                border-radius: 1.5rem;
                padding: 1.5rem;
                border: 1px solid var(--border-light);
                position: relative;
                overflow: hidden;
              ">
                <div style="
                  position: absolute;
                  left: 0;
                  top: 0;
                  bottom: 0;
                  width: 8px;
                  background: linear-gradient(180deg, #6366f1 0%, #8b5cf6 100%);
                  border-radius: 1.5rem 0 0 1.5rem;
                "></div>
                <div style="
                  font-weight: 800;
                  color: var(--text-primary);
                  font-size: 1.25rem;
                  margin-bottom: 1rem;
                ">${escapeHtml(bank.bank_name)}</div>
                ${bank.account_name ? `<div style="
                  font-size: 0.875rem;
                  color: var(--text-secondary);
                  margin-bottom: 0.5rem;
                ">
                  <span style="color: var(--text-muted); font-weight: 600;">Acc Name:</span> ${escapeHtml(bank.account_name)}
                </div>` : ''}
                ${bank.account_number ? `<div style="
                  font-size: 0.875rem;
                  color: var(--text-secondary);
                  display: flex;
                  align-items: center;
                  gap: 0.5rem;
                ">
                  <span style="color: var(--text-muted); font-weight: 600;">Acc Number:</span>
                  <span style="font-weight: 700;">${escapeHtml(bank.account_number)}</span>
                  <button style="
                    background: rgba(99, 102, 241, 0.1);
                    border: none;
                    border-radius: 0.5rem;
                    padding: 0.25rem 0.75rem;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--accent-primary);
                    gap: 0.25rem;
                  " data-copy="${escapeHtml(bank.account_number)}">📋 Copy</button>
                </div>` : ''}
                ${bank.branch_name ? `<div style="
                  font-size: 0.875rem;
                  color: var(--text-secondary);
                  margin-top: 0.5rem;
                ">
                  <span style="color: var(--text-muted); font-weight: 600;">Branch:</span> ${escapeHtml(bank.branch_name)}
                </div>` : ''}
                ${bank.swift_code ? `<div style="
                  font-size: 0.875rem;
                  color: var(--text-secondary);
                  margin-top: 0.5rem;
                ">
                  <span style="color: var(--text-muted); font-weight: 600;">SWIFT:</span> ${escapeHtml(bank.swift_code)}
                </div>` : ''}
              </div>
            `
            })

            contentHtml += `</div></div>`
        }

        container.innerHTML = headerHtml
        document.getElementById('balance-content').innerHTML = contentHtml

        // Apply zero-balance visibility
        const bcEl = document.getElementById('balance-content')
        if (bcEl) bcEl.classList.toggle('hide-zero-ents', !showZeroBalances)

        // FAB toggle
        const fabTrigger = document.getElementById('fab-trigger');
        const fabMenu = document.getElementById('fab-menu');
        let fabOpen = false;
        const toggleFab = (open) => {
            fabOpen = open !== undefined ? open : !fabOpen;
            fabTrigger.classList.toggle('open', fabOpen);
            fabMenu.classList.toggle('open', fabOpen);
        };
        fabTrigger?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFab();
        });
        // Close FAB when clicking outside
        document.addEventListener('click', (e) => {
            const fab = document.querySelector('.fab-container');
            if (fabOpen && fab && !fab.contains(e.target)) {
                toggleFab(false);
            }
        });
        
        // Quick actions handlers
        document.querySelectorAll('[data-quick-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-quick-action')
                toggleFab(false);
                if (action === 'members') {
                    window.location.hash = 'members'
                } else if (action === 'log') {
                    window.location.hash = 'log'
                } else if (action === 'reports') {
                    window.location.hash = 'reports'
                } else if (action === 'settings') {
                    window.location.hash = 'settings'
                } else if (action === 'ledger') {
                    window.location.hash = 'ledger/summary'
                } else if (action === 'history') {
                    window.location.hash = 'history'
                } else if (action === 'withdrawal-request') {
                    showWithdrawalWizard();
                    return;
                }
                window.dispatchEvent(new Event('hashchange'))
            })
        })

        const toggleMaskBtn = document.getElementById('toggle-mask-btn')
        if (toggleMaskBtn) {
            toggleMaskBtn.addEventListener('click', () => {
                maskBalances = !maskBalances
                saveMaskPreference(maskBalances)
                // Update all balance value displays in-place (no full re-render)
                document.querySelectorAll('[data-balance-value]').forEach(el => {
                    const raw = parseFloat(el.dataset.balanceValue) || 0
                    el.textContent = maskBalances ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : formatCurrency(raw)
                })
                // Update the eye icon
                toggleMaskBtn.innerHTML = maskBalances ? `
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 12C2 12 5.63636 5 12 5C18.3636 5 22 12 22 12C22 12 18.3636 19 12 19C5.63636 19 2 12 2 12Z"/>
                    <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"/>
                  </svg>
                ` : `
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17.9449 17.9449C16.3991 19.2325 14.2839 20 12 20C5.63636 20 2 12 2 12C3.8607 8.49382 6.66692 5.90325 10 4.99988M9.9 4.30021C10.5861 4.10767 11.2873 4.00024 12 4.00024C18.3636 4.00024 22 12 22 12C21.3037 13.3719 20.3339 14.6377 19.169 15.711M15 11.5C15 13.1569 13.6569 14.5 12 14.5C10.6362 14.5 9.47666 13.6048 9.09204 12.335M4 4L20 20"/>
                  </svg>
                `

                // Keep mobile mask button in sync
                const maskBtnMobile = document.getElementById('mask-toggle-mobile-btn');
                if (maskBtnMobile) {
                    maskBtnMobile.innerHTML = maskBalances ? `
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    ` : `
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    `;
                }
            })
        }

        const themeToggleBtnDash = document.getElementById('theme-toggle-btn-dashboard')
        if (themeToggleBtnDash) {
            const updateDashThemeIcon = () => {
                const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
                const isDark = currentTheme === 'dark';
                themeToggleBtnDash.innerHTML = isDark
                    ? `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l.707-.707M6.343 6.343l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"></path></svg>`
                    : `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>`;
            }
            updateDashThemeIcon()
            themeToggleBtnDash.addEventListener('click', () => {
                const current = document.documentElement.getAttribute('data-theme') || 'light';
                const nextTheme = current === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', nextTheme);
                localStorage.setItem('theme', nextTheme);
                updateDashThemeIcon();
                // Sync mobile button representation if active
                const mobileThemeBtn = document.getElementById('theme-toggle-mobile-btn');
                if (mobileThemeBtn) {
                    const isDark = nextTheme === 'dark';
                    const svgContent = isDark
                        ? `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l.707-.707M6.343 6.343l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"></path></svg>`
                        : `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>`;
                    mobileThemeBtn.innerHTML = svgContent;
                }
            })
        }

        // Copy account number functionality
        document.querySelectorAll('[data-copy]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const value = e.currentTarget.getAttribute('data-copy')
                try {
                    await navigator.clipboard.writeText(value)
                    showToast('Account number copied!', 'success')
                } catch (err) {
                    console.error('Failed to copy:', err)
                    showToast('Failed to copy account number', 'error')
                }
            })
        })

        // Zero balance toggle
        const toggleZeroBtn = document.getElementById('toggle-zero-balances')
        if (toggleZeroBtn) {
            toggleZeroBtn.addEventListener('change', (e) => {
                showZeroBalances = e.target.checked
                saveShowZeroBalancePreference(showZeroBalances)
                const bcEl = document.getElementById('balance-content')
                if (bcEl) bcEl.classList.toggle('hide-zero-ents', !showZeroBalances)
                // Update toggle visual
                const labelEl = e.target.closest('label')
                if (labelEl) {
                    const track = labelEl.querySelector('div:first-of-type')
                    if (track) {
                        track.style.background = showZeroBalances ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' : 'var(--border-light)'
                        const knob = track.querySelector('div')
                        if (knob) knob.style.left = showZeroBalances ? '22px' : '2px'
                    }
                }
            })
        }


    } catch (err) {
        container.innerHTML = headerHtml
        document.getElementById('balance-content').innerHTML = `<div class="alert">Could not load dashboard: ${escapeHtml(err.message)}</div>`
    }
}
