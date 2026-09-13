import { 
    getMemberListData, 
    getRemittanceListData, 
    getEnterpriseAccountData, 
    getRemittanceScheduleData, 
    getPaymentAdviseData,
    getEODReportData,
    getTrialBalanceData,
    getGeneralLedgerData,
    getIncomeExpenditureData,
    getBalanceSheetData,
    getCashFlowData,
    getPersonalLedgerData,
    getMemberPerformanceAgingData,
    getGeneralNetworthData,
    exportToExcel,
    exportToPDF
} from '../services/reportsService.js';
import { fetchBanks, fetchEnterprises, fetchAllMembers } from '../services/dataService.js';
import { queryOne, queryRows } from '../services/sqliteService.js';
import { escapeHtml, formatNumber, wrapDateInput } from '../utils/formatters.js';
import { showToast } from '../services/toastService.js';
import { showWorkspaceSpinner } from '../components/workspaceSpinner.js';

export async function renderReports(container, user) {
    showWorkspaceSpinner(container);
    const cooperativeId = user?.cooperativeId;
    const isAdmin = user.role === 'admin' || (user.permissions || '').includes('admin');
    
    // Fetch Coop Info
    let cooperativeFullName = user.cooperativeName || 'Cooperative';
    try {
        const coops = await queryRows('SELECT id, full_name FROM cooperatives', []);
        if (coops && coops.length > 0) {
            // Find the one matching current user's coop ID if possible, otherwise first non-empty
            const myCoop = coops.find(c => String(c.id) === String(user?.cooperativeId));
            const firstWithName = myCoop || coops.find(c => c.full_name && c.full_name.trim().length > 0);
            if (firstWithName) cooperativeFullName = firstWithName.full_name;
        }
    } catch (e) {
        console.warn('Failed to fetch cooperative name from SQLite:', e);
    }

    container.innerHTML = `
        <style>
            .reports-container { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }
            .reports-controls { 
                background: var(--bg-card); 
                padding: 1.5rem; 
                border-radius: var(--radius-lg); 
                border: 1px solid var(--border-light);
                display: flex;
                flex-direction: column;
                gap: 1.25rem;
            }
            .controls-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                gap: 1rem;
                align-items: flex-end;
            }
            .control-group { display: flex; flex-direction: column; gap: 0.5rem; }
            .control-group label { font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; }
            .control-group select, .control-group input { 
                height: 2.75rem; 
                padding: 0 0.75rem; 
                border-radius: var(--radius-md); 
                border: 1px solid var(--border-medium); 
                background: var(--bg-input); 
                color: var(--text-primary);
                font-size: 0.9rem;
            }
            .reports-preview { 
                background: var(--bg-card); 
                border-radius: var(--radius-lg); 
                border: 1px solid var(--border-light);
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            .preview-header {
                padding: 1rem 1.5rem;
                border-bottom: 1px solid var(--border-light);
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: var(--bg-card); /* Match card background */
            }
            .preview-title { font-weight: 700; color: var(--text-primary); }
            .preview-body { 
                overflow: auto; 
                min-height: 300px; 
                max-height: 600px; 
                position: relative; 
            }
            .preview-placeholder { 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                height: 300px; 
                color: var(--text-muted); 
                font-style: italic;
            }

            .styled-table { 
                width: auto !important;
                min-width: 100%;
                border-collapse: separate; 
                border-spacing: 0; 
                font-family: 'Inter', system-ui, sans-serif;
                table-layout: auto !important;
            }
            
            .styled-table thead tr th {
                position: sticky;
                top: 0;
                background: var(--bg-card) !important;
                z-index: 30;
                box-shadow: 0 1px 0 var(--border-light);
                padding: 1rem 1.5rem;
                color: var(--text-muted);
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                text-align: left;
                white-space: nowrap !important;
                word-break: keep-all !important;
                overflow-wrap: normal !important;
            }

            .styled-table tbody tr td {
                padding: 1rem 1.5rem;
                border-bottom: 1px solid var(--border-light);
                color: var(--text-primary);
                white-space: nowrap !important;
                word-break: keep-all !important;
                overflow-wrap: normal !important;
            }
            
            /* Zebra Striping */
            .styled-table tbody tr:nth-child(even) {
                background-color: var(--bg-secondary);
            }
            
            /* Hover State */
            .styled-table tbody tr {
                transition: all 0.2s ease;
            }
            .styled-table tbody tr:hover {
                background-color: var(--bg-input);
            }
            .btn-generate { 
                background: var(--accent-primary); 
                color: white; 
                border: none; 
                padding: 0 1.5rem; 
                height: 2.75rem; 
                border-radius: var(--radius-md); 
                font-weight: 700; 
                cursor: pointer;
                transition: opacity 0.2s;
            }
            .btn-generate:hover { opacity: 0.9; }
            .btn-export { 
                background: #059669; 
                color: white; 
                border: none; 
                padding: 0 1rem; 
                height: 2.25rem; 
                border-radius: var(--radius-md); 
                font-weight: 600; 
                cursor: pointer; 
                font-size: 0.85rem; 
                display: none;
            }
            .btn-pdf {
                background: #dc2626; 
                color: white; 
                border: none; 
                padding: 0 1rem; 
                height: 2.25rem; 
                border-radius: var(--radius-md); 
                font-weight: 600; 
                cursor: pointer; 
                font-size: 0.85rem; 
                display: none;
                margin-left: 0.5rem;
            }
            .field-checkbox-group {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                gap: 0.5rem;
                padding: 0.5rem;
                background: var(--bg-main);
                border-radius: var(--radius-md);
                border: 1px solid var(--border-light);
            }
            .checkbox-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-primary); cursor: pointer; }
            .checkbox-item input { width: auto; height: auto; }

            .field-chips-container {
                border: 1px solid var(--border-medium);
                border-radius: var(--radius-md);
                padding: 0.5rem;
                min-height: 2.75rem;
                background: var(--bg-input);
                display: flex;
                flex-wrap: wrap;
                gap: 0.4rem;
                align-items: center;
            }
            .field-chip {
                background: var(--bg-secondary);
                color: var(--text-primary);
                padding: 0.25rem 0.6rem;
                border-radius: 999px;
                display: flex;
                align-items: center;
                gap: 0.4rem;
                font-size: 0.8rem;
                font-weight: 600;
                border: 1px solid var(--border-light);
            }
            .remove-field { cursor: pointer; color: var(--text-muted); font-size: 1rem; line-height: 1; }
            .field-dropdown {
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                background: var(--bg-card);
                border: 1px solid var(--border-medium);
                border-radius: var(--radius-md);
                box-shadow: var(--shadow-lg);
                z-index: 100;
                padding: 0.75rem;
                width: 300px;
            }
            .field-option { 
                display: flex; 
                align-items: center; 
                gap: 0.75rem; 
                padding: 0.5rem 0.75rem; 
                cursor: pointer; 
                border-radius: 6px;
                transition: background 0.2s; 
                font-size: 0.85rem; 
                color: var(--text-primary); 
            }
            .field-option:hover { background: var(--bg-secondary); }
            .field-option input[type="checkbox"] { 
                cursor: pointer; 
                width: 16px !important; 
                height: 16px !important; 
                margin: 0;
                flex-shrink: 0;
            }

            .dropdown-btn {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0.5rem 0.75rem;
                border-radius: var(--radius-md);
                border: 1px solid var(--border-medium);
                background: var(--bg-input);
                color: var(--text-primary);
                font-size: 0.85rem;
                cursor: pointer;
                min-width: 180px;
                height: 2.75rem;
            }
        </style>
        <div class="reports-container">
            <div class="page-header">
                <h2>Reports & Exports</h2>
                <p class="subtitle">Generate and export cooperative financial and member data</p>
            </div>

            <div class="reports-controls">
                <div class="controls-grid">
                    <div class="control-group">
                        <label>Report Type</label>
                        <select id="report-type">
                            <option value="">Select Report Type...</option>
                            <option value="member_list">Member List (Bio-data)</option>
                            <option value="remittance_list">Remittance List</option>
                            <option value="enterprise_account">Enterprise Account</option>
                            <option value="remittance_schedule">Remittance Schedule</option>
                            <option value="payment_advise">Payment Advise</option>
                            <option value="eod_report">End of Day (EOD) Report</option>
                            <option value="trial_balance">Trial Balance</option>
                            <option value="general_ledger">General Ledger</option>
                            <option value="income_expenditure">Income & Expenditure</option>
                            <option value="balance_sheet">Balance Sheet</option>
                            <option value="cash_flow">Cash Flow Statement</option>
                            <option value="personal_ledger">Personal Ledger</option>
                            <option value="member_performance_aging">Member Performance & Aging</option>
                            <option value="general_networth">General Net Worth Balances</option>
                        </select>
                    </div>
                    
                    <div class="control-group filter-eod-date-from" style="display: none;">
                        <label>EOD Date From</label>
                        <input type="date" id="eod-date-from">
                    </div>
                    <div class="control-group filter-eod-date-to" style="display: none;">
                        <label>EOD Date To</label>
                        <input type="date" id="eod-date-to">
                    </div>
                    
                    <div class="control-group filter-gl-enterprise" style="display: none;">
                        <label>Account (Optional)</label>
                        <select id="gl-enterprise">
                            <option value="all">All Accounts</option>
                        </select>
                    </div>
                    
                    <div class="control-group filter-personal-member" style="display: none;">
                        <label>Member</label>
                        <select id="personal-member">
                        </select>
                    </div>

                    <div class="control-group filter-networth-date" style="display: none;">
                        <label>As At Date</label>
                        <input type="date" id="networth-date">
                    </div>

                    <div class="control-group filter-schedule-type" style="display: none;">
                        <label>Schedule Type</label>
                        <select id="schedule-type">
                            <option value="positive">Deposit (+ve)</option>
                            <option value="negative">Loan (-ve)</option>
                        </select>
                    </div>

                    <div class="control-group filter-date" style="display: none;">
                        <label>Date From</label>
                        <input type="date" id="date-from">
                    </div>
                    <div class="control-group filter-date" style="display: none;">
                        <label>Date To</label>
                        <input type="date" id="date-to">
                    </div>

                    <div class="control-group filter-bank" style="display: none;">
                        <label>Bank</label>
                        <select id="bank-filter">
                            <option value="All">All Banks</option>
                        </select>
                    </div>

                    <div class="control-group filter-enterprise" style="display: none;">
                        <label>Enterprise</label>
                        <select id="ent-filter"></select>
                    </div>

                    <div class="control-group filter-fiscal-year" style="display: none;">
                        <label>Fiscal Year</label>
                        <select id="fy-filter"></select>
                    </div>

                    <div class="control-group filter-schedule-month" style="display: none;">
                        <label>Month</label>
                        <select id="schedule-month">
                            ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => `<option value="${i + 1}" ${new Date().getMonth() === i ? 'selected' : ''}>${m}</option>`).join('')}
                        </select>
                    </div>

                    <div class="control-group filter-schedule-year" style="display: none;">
                        <label>Year</label>
                        <select id="schedule-year">
                            ${[0, 1, 2, 3, 4, 5].map(i => {
                                const y = new Date().getFullYear() - 2 + i;
                                return `<option value="${y}" ${y === new Date().getFullYear() ? 'selected' : ''}>${y}</option>`;
                            }).join('')}
                        </select>
                    </div>

                    <div class="control-group filter-member-status" style="display: none;">
                        <label>Status</label>
                        <select id="member-status">
                            <option value="All">All</option>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                            <option value="Suspended">Suspended</option>
                        </select>
                    </div>

                    <div id="member-fields-container" class="control-group" style="display: none; position: relative;">
                        <label>Include Fields</label>
                        <button class="dropdown-btn" id="field-dropdown-trigger">
                            <span id="field-trigger-text">Select Fields...</span>
                            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>
                        <div id="field-dropdown" class="field-dropdown hidden">
                            <!-- Rendered by renderFieldDropdown() -->
                        </div>
                    </div>

                    <div class="control-group">
                        <button id="btn-generate" class="btn-generate">Generate Preview</button>
                    </div>
                </div>
            </div>

            <div class="reports-preview">
                <div class="preview-header">
                    <div class="preview-title" id="preview-title">Report Preview</div>
                    <div style="display: flex;">
                        <button id="btn-export" class="btn-export">Export to Excel</button>
                        <button id="btn-pdf" class="btn-pdf">Print to PDF</button>
                    </div>
                </div>
                <div class="preview-body" id="preview-body">
                    <div class="preview-placeholder">Select a report type and filters, then click Generate Preview</div>
                </div>
            </div>
        </div>
    `;

    const reportTypeSelect = container.querySelector('#report-type');
    const btnGenerate = container.querySelector('#btn-generate');
    const btnExport = container.querySelector('#btn-export');
    const btnPdf = container.querySelector('#btn-pdf');
    const previewBody = container.querySelector('#preview-body');
    const previewTitle = container.querySelector('#preview-title');

    // Restore State Helper
    const reportsState = user.reports || {};
    const filters = reportsState.filters || {};
    
    let selectedFieldKeys = reportsState.selectedFields || ['full_name', 'registration_no', 'mobile', 'sex', 'status'];
    let pendingFieldKeys = [...selectedFieldKeys]; // Temporary selection before apply
    
    const fieldOptions = [
        { key: 'short_name', label: 'Short Name' },
        { key: 'full_name', label: 'Full Name' },
        { key: 'registration_no', label: 'Reg No' },
        { key: 'mobile', label: 'Mobile' },
        { key: 'sex', label: 'Sex' },
        { key: 'status', label: 'Status' },
        { key: 'date_joined', label: 'Date Joined' },
        { key: 'address', label: 'Address' },
        { key: 'account_manager', label: 'Manager' }
    ];

    const renderFieldDropdown = () => {
        const dropdown = container.querySelector('#field-dropdown');
        if (!dropdown) return;

        const triggerText = container.querySelector('#field-trigger-text');
        if (triggerText) {
            triggerText.textContent = selectedFieldKeys.length > 0 
                ? `${selectedFieldKeys.length} Fields Selected` 
                : 'Select Fields...';
        }

        dropdown.innerHTML = `
            <div style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.75rem; text-transform: uppercase;">
                Select Fields
            </div>
            <div style="margin-bottom: 0.75rem;">
                <input type="text" id="field-dropdown-search" placeholder="Search fields..." 
                    style="width: 100%; padding: 0.4rem; border-radius: 4px; border: 1px solid var(--border-medium); font-size: 0.8rem; background: var(--bg-input); color: var(--text-primary);">
            </div>
            <div class="fields-list" style="max-height: 250px; overflow-y: auto; margin-bottom: 0.75rem;">
                <label class="field-option" data-key="all">
                    <input type="checkbox" id="field-chk-all" ${pendingFieldKeys.length === fieldOptions.length ? 'checked' : ''}>
                    <span style="font-weight: 700;">All Fields</span>
                </label>
                ${fieldOptions.map(f => `
                    <label class="field-option field-item" data-key="${f.key}" data-search="${f.label.toLowerCase()}">
                        <input type="checkbox" class="field-chk" value="${f.key}" ${pendingFieldKeys.includes(f.key) ? 'checked' : ''}>
                        <span>${escapeHtml(f.label)}</span>
                    </label>
                `).join('')}
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="primary-button" id="apply-fields" style="flex: 1; height: 1.85rem; font-size: 0.7rem; border-radius: 999px;">Apply</button>
                <button class="secondary-button" id="cancel-fields" style="flex: 1; height: 1.85rem; font-size: 0.7rem; border-radius: 999px; background: white; color: black;">Cancel</button>
            </div>
        `;

        const searchInput = dropdown.querySelector('#field-dropdown-search');
        searchInput?.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase();
            dropdown.querySelectorAll('.field-item').forEach(item => {
                const text = item.dataset.search || '';
                item.style.display = text.includes(val) ? 'flex' : 'none';
            });
        });

        dropdown.querySelector('#field-chk-all')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                // All selected -> prefer short_name over full_name
                pendingFieldKeys = fieldOptions.map(f => f.key).filter(k => k !== 'full_name');
            } else {
                pendingFieldKeys = [];
            }
            // Update individual checkboxes
            dropdown.querySelectorAll('.field-chk').forEach(cb => {
                cb.checked = pendingFieldKeys.includes(cb.value);
            });
        });

        dropdown.querySelectorAll('.field-chk').forEach(cb => {
            cb.addEventListener('change', () => {
                const key = cb.value;
                if (cb.checked) {
                    if (!pendingFieldKeys.includes(key)) {
                        // Conflict rule: Full Name vs Short Name
                        if (key === 'full_name') {
                            pendingFieldKeys = pendingFieldKeys.filter(k => k !== 'short_name');
                        } else if (key === 'short_name') {
                            pendingFieldKeys = pendingFieldKeys.filter(k => k !== 'full_name');
                        }
                        pendingFieldKeys.push(key);
                    }
                } else {
                    pendingFieldKeys = pendingFieldKeys.filter(k => k !== key);
                }
                
                // Re-sync all checkboxes for conflicts
                dropdown.querySelectorAll('.field-chk').forEach(chk => {
                    chk.checked = pendingFieldKeys.includes(chk.value);
                });

                // Update "All" checkbox
                const allChk = dropdown.querySelector('#field-chk-all');
                if (allChk) allChk.checked = pendingFieldKeys.length >= (fieldOptions.length - 1);
            });
        });

        dropdown.querySelector('#apply-fields')?.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedFieldKeys = [...pendingFieldKeys];
            dropdown.classList.add('hidden');
            if (triggerText) {
                triggerText.textContent = selectedFieldKeys.length > 0 
                    ? `${selectedFieldKeys.length} Fields Selected` 
                    : 'Select Fields...';
            }
            updateGlobalState();
        });

        dropdown.querySelector('#cancel-fields')?.addEventListener('click', (e) => {
            e.stopPropagation();
            pendingFieldKeys = [...selectedFieldKeys];
            dropdown.classList.add('hidden');
        });
    };

    const trigger = container.querySelector('#field-dropdown-trigger');
    const menu = container.querySelector('#field-dropdown');
    
    trigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        menu?.classList.toggle('hidden');
        if (!menu?.classList.contains('hidden')) {
            renderFieldDropdown();
            menu.querySelector('#field-dropdown-search')?.focus();
        }
    });

    // Bound once: per-render closures here stacked a document listener on
    // every Reports visit and retained the whole container in memory.
    if (!window._reportsFieldOutside) {
        window._reportsFieldOutside = (e) => {
            const m = document.getElementById('field-dropdown');
            if (m && !m.classList.contains('hidden') && !document.getElementById('member-fields-container')?.contains(e.target)) {
                m.classList.add('hidden');
            }
        };
        document.addEventListener('click', window._reportsFieldOutside);
    }

    const updateGlobalState = () => {
        if (user.onReportsStateChange) {
            user.onReportsStateChange({
                type: reportTypeSelect.value,
                filters: {
                    dateFrom: container.querySelector('#date-from').value,
                    dateTo: container.querySelector('#date-to').value,
                    bank: container.querySelector('#bank-filter').value,
                    enterprise: container.querySelector('#ent-filter').value,
                    fiscalYear: container.querySelector('#fy-filter').value,
                    scheduleMonth: container.querySelector('#schedule-month').value,
                    scheduleYear: container.querySelector('#schedule-year').value,
                    scheduleType: container.querySelector('#schedule-type').value,
                    memberStatus: container.querySelector('#member-status').value
                },
                selectedFields: selectedFieldKeys,
                currentReportData
            });
        }
    };

    // Populate Banks
    const banks = await fetchBanks(cooperativeId);
    const bankFilter = container.querySelector('#bank-filter');
    banks.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.bank_name;
        opt.textContent = b.bank_name;
        if (filters.bank === b.bank_name) opt.selected = true;
        bankFilter.appendChild(opt);
    });

    // Populate Enterprises for enterprise_account and general_ledger
    const enterprises = await fetchEnterprises(cooperativeId, true);
    const entFilter = container.querySelector('#ent-filter');
    const glEntFilter = container.querySelector('#gl-enterprise');
    enterprises.sort((a, b) => a.account_name.localeCompare(b.account_name)).forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = e.account_name;
        if (filters.enterprise === e.id) opt.selected = true;
        entFilter.appendChild(opt);
        
        const optGl = document.createElement('option');
        optGl.value = e.id;
        optGl.textContent = e.account_name;
        glEntFilter.appendChild(optGl);
    });
    
    // Populate Members for Personal Ledger
    const members = await fetchAllMembers(cooperativeId, user.username, user.role === 'admin' || (user.permissions || '').includes('admin'));
    const memberFilter = container.querySelector('#personal-member');
    members.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.name} (Reg: ${m.registration_no ? String(m.registration_no).padStart(4, '0') : 'N/A'})`;
        memberFilter.appendChild(opt);
    });
    
    // Set default EOD dates to today
    const today = new Date().toISOString().split('T')[0];
    container.querySelector('#eod-date-from').value = today;
    container.querySelector('#eod-date-to').value = today;

    // Populate Fiscal Years
    const fyFilter = container.querySelector('#fy-filter');
    const currentYear = new Date().getFullYear();
    for (let i = -2; i <= 2; i++) {
        const y = currentYear + i;
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = `${y}/${y+1}`;
        if (filters.fiscalYear ? (filters.fiscalYear == y) : (y === currentYear)) opt.selected = true;
        fyFilter.appendChild(opt);
    }

    // Set other filters
    if (reportsState.type) reportTypeSelect.value = reportsState.type;
    if (filters.dateFrom) container.querySelector('#date-from').value = filters.dateFrom;
    if (filters.dateTo) container.querySelector('#date-to').value = filters.dateTo;
    if (filters.scheduleMonth) container.querySelector('#schedule-month').value = filters.scheduleMonth;
    if (filters.scheduleYear) container.querySelector('#schedule-year').value = filters.scheduleYear;
    if (filters.scheduleType) container.querySelector('#schedule-type').value = filters.scheduleType;
    if (filters.memberStatus) container.querySelector('#member-status').value = filters.memberStatus;
    
    let currentReportData = reportsState.currentReportData || null;

    const formatInputDate = (date) => {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const updateUIForType = () => {
        const val = reportTypeSelect.value;
        container.querySelectorAll('.filter-date').forEach(el => el.style.display = (val === 'remittance_list' || val === 'general_ledger') ? 'flex' : 'none');
        container.querySelector('.filter-bank').style.display = (val === 'remittance_list') ? 'flex' : 'none';
        container.querySelector('.filter-enterprise').style.display = (val === 'enterprise_account') ? 'flex' : 'none';
        container.querySelector('.filter-fiscal-year').style.display = (val === 'enterprise_account' || val === 'trial_balance' || val === 'income_expenditure' || val === 'balance_sheet') ? 'flex' : 'none';
        container.querySelector('.filter-schedule-month').style.display = (val === 'remittance_schedule') ? 'flex' : 'none';
        container.querySelector('.filter-schedule-year').style.display = (val === 'remittance_schedule') ? 'flex' : 'none';
        container.querySelector('.filter-schedule-type').style.display = (val === 'remittance_schedule') ? 'flex' : 'none';
        container.querySelector('.filter-member-status').style.display = (val === 'member_list') ? 'flex' : 'none';
        container.querySelector('#member-fields-container').style.display = (val === 'member_list') ? 'flex' : 'none';
        container.querySelector('.filter-eod-date-from').style.display = (val === 'eod_report') ? 'flex' : 'none';
        container.querySelector('.filter-eod-date-to').style.display = (val === 'eod_report') ? 'flex' : 'none';
        container.querySelector('.filter-gl-enterprise').style.display = (val === 'general_ledger') ? 'flex' : 'none';
        container.querySelector('.filter-personal-member').style.display = (val === 'personal_ledger') ? 'flex' : 'none';
        container.querySelector('.filter-networth-date').style.display = (val === 'general_networth') ? 'flex' : 'none';

        // Prefill dates
        if (val === 'remittance_list' || val === 'general_ledger') {
            const dateFromInput = container.querySelector('#date-from');
            const dateToInput = container.querySelector('#date-to');
            if (!dateFromInput.value || !dateToInput.value) {
                const today = new Date();
                const oneMonthAgo = new Date(today);
                oneMonthAgo.setMonth(today.getMonth() - 1);
                dateFromInput.value = formatInputDate(oneMonthAgo);
                dateToInput.value = formatInputDate(today);
                dateFromInput.dispatchEvent(new Event('change', { bubbles: true }));
                dateToInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        if (val === 'eod_report') {
            const eodDateFromInput = container.querySelector('#eod-date-from');
            const eodDateToInput = container.querySelector('#eod-date-to');
            if (!eodDateFromInput.value || !eodDateToInput.value) {
                const today = formatInputDate(new Date());
                eodDateFromInput.value = today;
                eodDateToInput.value = today;
            }
        }

        if (val === 'general_networth') {
            const nwDateInput = container.querySelector('#networth-date');
            if (!nwDateInput.value) {
                nwDateInput.value = formatInputDate(new Date());
            }
        }

        const triggerText = container.querySelector('#field-trigger-text');
        if (triggerText) {
            triggerText.textContent = selectedFieldKeys.length > 0 
                ? `${selectedFieldKeys.length} Fields Selected` 
                : 'Select Fields...';
        }
    };

    updateUIForType();

    // Wrap all date inputs to show DD MMM, YYYY format
    container.querySelectorAll('input[type="date"]').forEach(wrapDateInput);

    if (currentReportData) {
        previewTitle.textContent = currentReportData.title;
        btnExport.style.display = 'block';
        btnPdf.style.display = 'block';
        renderPreviewTable(currentReportData.headers, currentReportData.data);
    }

    // Add listeners to all controls for state update
    container.querySelectorAll('select, input').forEach(el => {
        el.addEventListener('change', updateGlobalState);
    });

    reportTypeSelect.addEventListener('change', () => {
        updateUIForType();
        btnExport.style.display = 'none';
        btnPdf.style.display = 'none';
        previewBody.innerHTML = '<div class="preview-placeholder">Select filters and click Generate Preview</div>';
        previewTitle.textContent = 'Report Preview';
        currentReportData = null;
        updateGlobalState();
    });

    btnGenerate.addEventListener('click', async () => {
        const type = reportTypeSelect.value;
        if (!type) return showToast('Please select a report type', 'warning');

        previewBody.innerHTML = '<div class="preview-placeholder">Generating report...</div>';
        btnExport.style.display = 'none';
        btnPdf.style.display = 'none';

        try {
            let result;
            let title = '';

            if (type === 'member_list') {
                result = await getMemberListData(cooperativeId, user, { 
                    status: container.querySelector('#member-status').value,
                    selectedFields: selectedFieldKeys
                });
                title = 'Member List';
            } else if (type === 'remittance_list') {
                result = await getRemittanceListData(cooperativeId, user, {
                    dateFrom: container.querySelector('#date-from').value,
                    dateTo: container.querySelector('#date-to').value,
                    bank: container.querySelector('#bank-filter').value,
                    transactionType: 'All'
                });
                title = 'Remittance List';
            } else if (type === 'enterprise_account') {
                result = await getEnterpriseAccountData(cooperativeId, user, 
                    container.querySelector('#ent-filter').value,
                    container.querySelector('#fy-filter').selectedOptions[0].textContent
                );
                title = result.title;
            } else if (type === 'remittance_schedule') {
                const month = parseInt(container.querySelector('#schedule-month').value);
                const year = parseInt(container.querySelector('#schedule-year').value);
                const positive = container.querySelector('#schedule-type').value === 'positive';
                result = await getRemittanceScheduleData(cooperativeId, user, month, year, positive);
                const monthName = container.querySelector('#schedule-month').selectedOptions[0].textContent;
                title = `Monthly Schedule for ${monthName} ${year} (${positive ? 'Deposit' : 'Loan'})`;
            } else if (type === 'payment_advise') {
                result = await getPaymentAdviseData(cooperativeId);
                title = 'Payment Advise';
            } else if (type === 'eod_report') {
                const eodDateFrom = container.querySelector('#eod-date-from').value;
                const eodDateTo = container.querySelector('#eod-date-to').value;
                result = await getEODReportData(cooperativeId, eodDateFrom, eodDateTo);
                title = result.title;
            } else if (type === 'trial_balance') {
                const fy = container.querySelector('#fy-filter').selectedOptions[0].textContent;
                result = await getTrialBalanceData(cooperativeId, fy);
                title = result.title;
            } else if (type === 'general_ledger') {
                const dateFrom = container.querySelector('#date-from').value;
                const dateTo = container.querySelector('#date-to').value;
                const entId = container.querySelector('#gl-enterprise').value;
                result = await getGeneralLedgerData(cooperativeId, dateFrom, dateTo, entId);
                title = result.title;
            } else if (type === 'income_expenditure') {
                const fy = container.querySelector('#fy-filter').selectedOptions[0].textContent;
                result = await getIncomeExpenditureData(cooperativeId, fy);
                title = result.title;
            } else if (type === 'balance_sheet') {
                const fy = container.querySelector('#fy-filter').selectedOptions[0].textContent;
                result = await getBalanceSheetData(cooperativeId, fy);
                title = result.title;
            } else if (type === 'cash_flow') {
                const fy = container.querySelector('#fy-filter').selectedOptions[0].textContent;
                result = await getCashFlowData(cooperativeId, fy);
                title = result.title;
            } else if (type === 'personal_ledger') {
                const memberId = container.querySelector('#personal-member').value;
                result = await getPersonalLedgerData(cooperativeId, memberId);
                title = result.title;
            } else if (type === 'member_performance_aging') {
                result = await getMemberPerformanceAgingData(cooperativeId);
                title = result.title;
            } else if (type === 'general_networth') {
                const networthDate = container.querySelector('#networth-date').value;
                if (!networthDate) return showToast('Please select an As At date', 'warning');
                result = await getGeneralNetworthData(cooperativeId, user, networthDate);
                title = result.title;
            }

            if (!result || !result.data || result.data.length === 0) {
                previewBody.innerHTML = '<div class="preview-placeholder">No data found for the selected criteria</div>';
                return;
            }

            currentReportData = { ...result, title };
            previewTitle.textContent = title;
            btnExport.style.display = 'block';
            btnPdf.style.display = 'block';
            renderPreviewTable(result.headers, result.data);
            updateGlobalState();

        } catch (err) {
            console.error(err);
            previewBody.innerHTML = `<div class="preview-placeholder" style="color: var(--danger)">Error: ${err.message}</div>`;
        }
    });

    btnExport.addEventListener('click', async () => {
        if (!currentReportData) return;
        const originalText = btnExport.textContent;
        btnExport.textContent = 'Exporting...';
        btnExport.disabled = true;
        try {
            await exportToExcel(cooperativeFullName, currentReportData.title, currentReportData.headers, currentReportData.data);
            showToast('Excel export completed successfully!', 'success');
        } catch (err) {
            showToast('Export failed: ' + err.message, 'error');
        } finally {
            btnExport.textContent = originalText;
            btnExport.disabled = false;
        }
    });

    btnPdf.addEventListener('click', async () => {
        if (!currentReportData) return;
        const originalText = btnPdf.textContent;
        btnPdf.textContent = 'Printing...';
        btnPdf.disabled = true;
        try {
            const type = reportTypeSelect.value;
            await exportToPDF(
                cooperativeFullName, 
                currentReportData.title, 
                currentReportData.headers, 
                currentReportData.data,
                'l', // Landscape
                user.username,
                type === 'enterprise_account'
            );
            showToast('PDF print completed successfully!', 'success');
        } catch (err) {
            showToast('PDF Print failed: ' + err.message, 'error');
        } finally {
            btnPdf.textContent = originalText;
            btnPdf.disabled = false;
        }
    });

    function renderPreviewTable(headers, data) {
        let html = `
            <table class="styled-table" style="width: auto !important; min-width: 100% !important; border-collapse: separate !important;">
                <thead>
                    <tr>
                        ${headers.map(h => `<th style="white-space: nowrap !important; word-break: keep-all !important; overflow-wrap: normal !important;">${escapeHtml(h).replace(/ /g, '&nbsp;')}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
        `;

        data.forEach(row => {
            const rowArray = Array.isArray(row) ? row : headers.map(h => row[h]);
            html += `
                <tr>
                    ${rowArray.map((val, idx) => {
                        const header = headers[idx];
                        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        const commonAmountHeaders = ['Amount', 'Total', 'Principal', 'Bal B/F', 'DR', 'CR', 'BL', 'Balance'];
                        const isAmount = typeof val === 'number' || ((val !== null && val !== undefined && val !== '') && (commonAmountHeaders.includes(header) || monthNames.includes(header)));
                        
                        const shouldWrap = header === 'Description' || header === 'Notes' || header === 'Note';
                        
                        // Force no-wrap on all non-wrap-friendly cells globally with !important
                        const baseStyle = shouldWrap
                            ? 'white-space: normal !important; word-break: break-word !important; min-width: 150px; max-width: 250px;'
                            : 'white-space: nowrap !important; word-break: keep-all !important; overflow-wrap: normal !important;';

                        if (isAmount) {
                            const numVal = (val === null || val === undefined || val === '') ? 0 : Number(val);
                            const formatted = isNaN(numVal) ? escapeHtml(String(val)).replace(/ /g, '&nbsp;') : formatNumber(numVal).replace(/ /g, '&nbsp;');
                            const style = `style="${baseStyle} ${!isNaN(numVal) && numVal < 0 ? 'color: #dc2626; font-weight: 700;' : ''} text-align: right;"`;
                            return `<td ${style}>${formatted}</td>`;
                        }

                        const rawText = String(val ?? '');
                        const text = shouldWrap ? escapeHtml(rawText) : escapeHtml(rawText).replace(/ /g, '&nbsp;');
                        return `<td style="${baseStyle}">${text}</td>`;
                    }).join('')}
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;
        previewBody.innerHTML = html;
    }
}
