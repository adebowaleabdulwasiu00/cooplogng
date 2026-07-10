import { fetchRemittances, fetchEnterprises, fetchAllMembers, addRemittance, updateRemittance, fetchBanks, getNextRemittanceRid, buildAccountBalance, fetchLoanById, fetchGuarantorStats, fetchMemberDoc, fetchTransactionTypes, fetchRemittancesPage, deleteRemittance, fetchMemberPaymentAdvise } from '../../services/dataService.js';
import { hasPermission } from '../../services/permissionService.js';
import { formatCurrency, formatDate, formatDateForInput, escapeHtml, getTimestampMs, generateId, generateRemittanceId, wrapDateInput, formatDateTime, getInitials } from '../../utils/formatters.js';
import { getDoc, doc, getDb } from '../../firebase.js';
import { showToast } from '../../services/toastService.js';
import { getAllForCoop } from '../../services/sqliteService.js';
import ExcelJS from 'exceljs';
import { getAvatarColor, showModalDialog } from './constants.js';
import { applyLoanRequestPrefillInternal, applyWithdrawalRequestPrefillInternal } from './remittancePrefill.js';
import { showLoanConfigModal } from './remittanceLoanConfig.js';
import { exportData } from './remittanceExport.js';
import { attachEventListeners } from './remittanceEventListeners.js';
import { render as _render } from './remittanceRender.js';

    export async function renderUnifiedPayment(container, user) {
    const isActualAdmin = hasPermission(user.permissions, 'admin') || (user.username || '').toLowerCase() === 'admin';
    const canApprove = isActualAdmin || hasPermission(user.permissions, 'approve_remittance');
    const canDelete = isActualAdmin || hasPermission(user.permissions, 'delete_remittance');
    const isAdmin = isActualAdmin || user.isAdmin || hasPermission(user.permissions, 'read_member');
    const isMember = user.role === 'member';
    const cooperativeId = user.cooperativeId;

  if (!cooperativeId) {
    container.innerHTML = '<div class="alert">Error: Cooperative ID missing. Please log in again.</div>';
    return;
  }

  const deps = {};

  // --- State Variables ---
  let enterpriseData = [];
  let members = [];
  let selectorMembers = [];
  let banks = [];
  let transactionTypes = [];
  let openingBalances = {};
  let paymentAdvise = {};
  let showAllZeros = false;
  let previewMode = false; // When true, form is read-only showing a selected history record

  // --- Form State ---
  let formData = {
    id: null,
    remittance_date: new Date().toISOString().split('T')[0],
    bank_name: '',
    amount: 0,
    description: '',
    transaction_type: '',
    member_id: isAdmin ? '' : user.memberId,
    details: [],
    isLoanRequest: false,
    isWithdrawalRequest: false
  };
  let initialFormData = JSON.parse(JSON.stringify(formData));

  // --- History State ---
  const historyState = {
    cooperativeId,
    allRemittances: [],
    members: [],
    membersMap: {},
    managedMemberIds: null,
    lastVisibleDoc: null,
    hasMore: true,
    isLoading: false,
    searchTerm: '',
    searchColumn: 'All Columns',
    selectedRemittanceId: null,
    selectedRemittanceIds: new Set(),
    filters: {
      status: 'All',
      bank: 'All',
      dateRange: 'All',
      minAmount: null,
      maxAmount: null,
          memberId: (isActualAdmin || isAdmin) ? 'All' : (user.memberId || 'All'),
      transactionType: 'All',
      dateFrom: '',
      dateTo: ''
    },
    selectAll: false,
    stats: {
      total: 0,
      approved: 0,
      pending: 0,
      monthTotal: 0,
      rejected: 0
    }
  };

  // --- Panel Size State ---
  const PANEL_SIZE_KEY = `cooplog-panels-${user.cooperativeId}-${user.id}`;
  let panelSizes = {
    breakdownWidth: 420,
    topSectionHeight: null
  };
  try {
    const saved = localStorage.getItem(PANEL_SIZE_KEY);
    if (saved) {
      panelSizes = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load panel sizes:', e);
  }

  // --- Session Storage ---
  const SESSION_KEY = `cooplog-form-${user.cooperativeId}-${isAdmin ? 'admin' : user.memberId}`;
  const saveSavedForm = (data) => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch (e) {}
  };
  const clearSavedForm = () => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  };

  // --- Focus Tracking ---
  let activeId = null;
  let activeName = null;
  let activeRowEntId = null;
  let selectionStart = 0;
  let selectionEnd = 0;
  const trackFocus = () => {
    const el = document.activeElement;
    if (!el || !container.contains(el)) {
      activeId = null;
      activeName = null;
      activeRowEntId = null;
      selectionStart = 0;
      selectionEnd = 0;
      return;
    }
    activeId = el.id || null;
    activeName = el.name || null;
    const detailRow = el.closest('.detail-item-row');
    activeRowEntId = detailRow ? detailRow.dataset.entid : null;
    try {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        selectionStart = el.selectionStart || 0;
        selectionEnd = el.selectionEnd || 0;
      }
    } catch (e) {}
  };
  document.addEventListener('focusin', trackFocus);
  document.addEventListener('focusout', trackFocus);

  // --- Helpers ---
  const getFormattedName = (mid, tranType = '') => {
    if (mid === '0000000000' || mid === '0') return tranType || 'Cooperative';
    const mem = historyState.membersMap[mid];
    if (!mem) return 'Unknown Member';
    const last = mem.last_name || '';
    const firstName = String(mem.first_name || '');
    const middleName = String(mem.middle_name || '');
    const first = firstName ? firstName[0].toUpperCase() + '.' : '';
    const middle = middleName ? middleName[0].toUpperCase() + '.' : '';
    return `${last} ${first}${middle}`.trim();
  };
  const canViewRemittance = (remit) => {
    if (isActualAdmin) return true;
    if (isMember) return String(remit.member_id) === String(user.memberId);
    if (!isAdmin) {
      const mid = String(remit.member_id);
      const isCoop = mid === '0000000000' || mid === '0';
      if (isCoop) return true;
      if (historyState.membersMap[mid]) return true;
      return false;
    }
    return true;
  };
  const calculateStats = () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    historyState.stats = historyState.allRemittances.reduce((acc, r) => {
      acc.total++;
      const s = (r.status || '').toLowerCase();
      if (s === 'approved') acc.approved += Number(r.amount);
      if (s === 'pending') acc.pending++;
      if (s === 'rejected') acc.rejected++;
      const rDate = new Date(r.remittance_date);
      if (rDate >= monthStart && s === 'approved') acc.monthTotal += Number(r.amount);
      return acc;
    }, { total: 0, approved: 0, pending: 0, monthTotal: 0, rejected: 0 });
  };

  const applyWithdrawalRequestPrefill = async (wrData) => {
    if (!wrData) return;
    trackFocus();
    formData = applyWithdrawalRequestPrefillInternal(wrData, enterpriseData, user.memberId);
    try {
      if (formData.member_id && formData.member_id !== '0000000000') {
        await loadMemberBalances(formData.member_id);
      }
    } catch (e) {
      console.error('Failed to load balances for withdrawal prefill:', e);
    }
    initialFormData = JSON.parse(JSON.stringify(formData));
    render();
  };

  const applyLoanRequestPrefill = async (lrData) => {
    if (!lrData) return;
    trackFocus();
    formData = applyLoanRequestPrefillInternal(lrData, enterpriseData, user.memberId);
    try {
      if (formData.member_id && formData.member_id !== '0000000000') {
        await loadMemberBalances(formData.member_id);
      }
    } catch (e) {
      console.error('Failed to load balances for prefill:', e);
    }
    initialFormData = JSON.parse(JSON.stringify(formData));
    render();
  };

  // --- Load Data ---
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: var(--bg-main); font-family: inherit;">
      <div style="width: 48px; height: 48px; border: 4px solid var(--border-medium); border-top: 4px solid var(--accent-primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <h2 style="margin-top: 24px; color: var(--text-primary); font-weight: 600; font-size: 1.25rem;">Loading workspace...</h2>
      <p style="color: var(--text-muted); font-size: 0.875rem; margin-top: 8px;">Please wait while we prepare your workspace</p>
      <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    </div>
  `;
  try {
    const [entRes, memRes, bankRes, txRes] = await Promise.all([
      fetchEnterprises(cooperativeId, true, true),
      fetchAllMembers(cooperativeId, user.username, isAdmin),
      fetchBanks(cooperativeId),
      fetchTransactionTypes(cooperativeId)
    ]);
    enterpriseData = entRes || [];
    members = memRes || [];
    banks = bankRes || [];
    transactionTypes = txRes || [];
    if (!isActualAdmin && isAdmin) {
      selectorMembers = await fetchAllMembers(cooperativeId, user.username, false);
    } else {
      selectorMembers = members;
    }
    historyState.members = members;
    historyState.managedMemberIds = members.map(m => String(m.id));
    members.forEach(m => historyState.membersMap[m.id] = m);
    historyState.banks = banks;
    historyState.transactionTypes = transactionTypes.filter(t => t.is_active);
    await loadHistoryData(true);

    // Load from session
    let loadedForm = null;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      loadedForm = raw ? JSON.parse(raw) : null;
    } catch (e) {}

    if (loadedForm && loadedForm.id !== 'NEW' && !loadedForm.id) {
      formData = loadedForm;
      if (formData.member_id && formData.member_id !== '0000000000') {
        await loadMemberBalances(formData.member_id);
      }
    } else {
      if (formData.member_id && formData.member_id !== '0000000000') {
        await loadMemberBalances(formData.member_id);
      }
    }
    initialFormData = JSON.parse(JSON.stringify(formData));
  } catch (err) {
    console.error('Data loading error:', err);
    initialFormData = JSON.parse(JSON.stringify(formData));
  }

  // --- History Loader ---
  async function loadHistoryData(isInitial = false) {
    if (historyState.isLoading || (!isInitial && !historyState.hasMore)) return;
    historyState.isLoading = true;
    let autoFetchCount = 0;
    const MAX_AUTO_FETCH = 10;
    let currentIsInitial = isInitial;
    
    while (true) {
      try {
        if (currentIsInitial) {
          historyState.lastVisibleDoc = null;
          historyState.hasMore = true;
          historyState.allRemittances = [];
        }
        const pageSize = 50;
        const searchOptions = {
          searchTerm: historyState.searchTerm,
          searchColumn: historyState.searchColumn,
          ...historyState.filters
        };
        const result = await fetchRemittancesPage(
          cooperativeId,
          user,
          historyState.lastVisibleDoc || 0,
          pageSize,
          searchOptions
        );
        const existingIds = new Set(historyState.allRemittances.map(r => r.id));
        const uniqueBatch = result.remittances.filter(r => !existingIds.has(r.id));
        const newBatch = uniqueBatch.filter(r => canViewRemittance(r));
        if (currentIsInitial) {
          historyState.allRemittances = newBatch;
        } else {
          historyState.allRemittances = [...historyState.allRemittances, ...newBatch];
        }
        historyState.lastVisibleDoc = result.nextOffset;
        if (result.remittances.length < pageSize) historyState.hasMore = false;
        
        // Break if we got items, exhausted data, or hit the auto-fetch safety limit
        if (newBatch.length > 0 || !historyState.hasMore || autoFetchCount >= MAX_AUTO_FETCH) {
          break;
        }
        autoFetchCount++;
        currentIsInitial = false;
      } catch (err) {
        console.error('History load error:', err);
        break;
      }
    }
    
    // Sort: newest first by r_id (desc), fallback to remittance_date (desc)
    historyState.allRemittances.sort((a, b) => {
      const aRid = a.r_id || 0;
      const bRid = b.r_id || 0;
      if (aRid !== bRid) return bRid - aRid;
      return new Date(b.remittance_date || 0) - new Date(a.remittance_date || 0);
    });
    calculateStats();
    updateHistoryTable();
    historyState.isLoading = false;
  }

  let historyScrollAttached = false;
  function setupHistoryScrollListener() {
    const tableContainer = container.querySelector('.history-table-container');
    if (!tableContainer || tableContainer.dataset.scrollListener) return;
    historyScrollAttached = true;
    tableContainer.dataset.scrollListener = 'true';
    let scrollTimeout = null;
    tableContainer.addEventListener('scroll', () => {
      if (scrollTimeout) return;
      scrollTimeout = setTimeout(() => {
        scrollTimeout = null;
        if (historyState.isLoading || !historyState.hasMore) return;
        const el = tableContainer;
        const scrollBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (scrollBottom < 150) {
          loadHistoryData(false);
        }
      }, 150);
    });
  }

  // --- Member Balances ---
  async function loadMemberBalances(memberId) {
    if (!memberId || memberId === '0000000000') {
      openingBalances = {};
      paymentAdvise = {};
      return;
    }
    try {
      const limitRid = formData.id ? formData.r_id : null;
      const balData = await buildAccountBalance(cooperativeId, { ...user, memberId }, limitRid);
      openingBalances = {};
      balData.accountBalance.forEach(b => openingBalances[b.id] = b.sum_of_amount);
      paymentAdvise = {};
      const advTable = await fetchMemberPaymentAdvise(memberId);
      if (advTable && advTable.length > 0) {
        advTable.forEach(adv => {
          if (!paymentAdvise[adv.enterprise_id]) paymentAdvise[adv.enterprise_id] = 0;
          paymentAdvise[adv.enterprise_id] += parseFloat(adv.amount || 0);
        });
      }
    } catch (err) {
      console.error('Balance fetch error:', err);
    }
  }

  // --- Handle Member Change ---
  async function handleMemberChange(newMemberId) {
    formData.member_id = newMemberId;
    previewMode = false;
    
    // Reset form details and amount when member changes (clear stale history data)
    formData.details = [];
    formData.amount = 0;
    formData.bank_name = '';
    formData.description = '';
    formData.transaction_type = '';
    formData.isLoanRequest = false;
    formData.status = null;
    
    // Load new balances
    if (newMemberId && newMemberId !== '0000000000') {
      await loadMemberBalances(newMemberId);
    } else {
      openingBalances = {};
      paymentAdvise = {};
    }
    
    // Update filters
    historyState.filters.memberId = newMemberId || (isAdmin ? 'All' : user.memberId);
    historyState.selectedRemittanceId = null;
    
    // When a member is freshly selected, force showAllZeros = false so only non-zero rows appear
    deps.showAllZeros = false;
    
    // Refresh history
    await loadHistoryData(true);
    
    render();
  }

  // --- Load Remittance to Form for Read-Only Preview ---
  async function loadRemittanceToForm(remit) {
    previewMode = true;
    
    // Create a map of loans by enterprise_id for quick lookup
    const loansByEnterprise = {};
    if (remit.loans && remit.loans.length > 0) {
      remit.loans.forEach(loan => {
        loansByEnterprise[loan.enterprise_id] = loan;
      });
    }
    
    // Process each detail and attach loan info if applicable
    const processedDetails = remit.details ? remit.details.map((detail, idx) => {
      let loan = loansByEnterprise[detail.enterprise_id] || loansByEnterprise[detail.item];
      if (!loan && remit.loans && remit.loans.length > 0 && idx === 0) {
        loan = remit.loans[0]; // fallback to first loan for first detail if not matched
      }
      if (loan) {
        // Calculate due date if duration is present but due date is missing
        let dueDate = loan.due_date;
        if (!dueDate && loan.duration_months && loan.issued_date) {
          const issueDate = new Date(loan.issued_date);
          issueDate.setMonth(issueDate.getMonth() + loan.duration_months);
          dueDate = issueDate.toISOString().split('T')[0];
        }
        
        // Load default charges from enterprise if there are none (always positive magnitudes)
        let charges = loan.charges || [];
        if (charges.length === 0) {
          const ent = enterpriseData.find(e => String(e.id) === String(detail.enterprise_id));
          const defaultCharges = [];
          if (ent) {
            if (ent.interest_rate !== undefined && ent.interest_rate !== null && ent.interest_rate !== '') {
              defaultCharges.push({
                id: generateId(),
                name: 'Interest',
                value: Math.abs(parseFloat(ent.interest_rate) || 0),
                type: ent.interest_is_percent ? 'percentage' : 'fixed'
              });
            }
            if (ent.form_fee !== undefined && ent.form_fee !== null && ent.form_fee !== '') {
              defaultCharges.push({
                id: generateId(),
                name: 'Form fee',
                value: Math.abs(parseFloat(ent.form_fee) || 0),
                type: ent.form_fee_is_percent ? 'percentage' : 'fixed'
              });
            }
            if (ent.admin_charge !== undefined && ent.admin_charge !== null && ent.admin_charge !== '') {
              defaultCharges.push({
                id: generateId(),
                name: 'Admin charge',
                value: Math.abs(parseFloat(ent.admin_charge) || 0),
                type: ent.admin_charge_is_percent ? 'percentage' : 'fixed'
              });
            }
          }
          charges = defaultCharges;
        }
        
        // Convert loan record to the format expected by loan_info
        return {
          ...detail,
          loan_info: {
            loanData: {
              principalAmount: loan.principal_amount,
              durationMonths: loan.duration_months,
              issueDate: loan.issued_date,
              dueDate: dueDate,
              notes: loan.notes,
              status: loan.status
            },
            guarantors: (loan.guarantors || []).map(g => ({
              ...g,
              amount: g.guarantee_amount || g.amount || 0
            })),
            charges: charges
          }
        };
      }
      return detail;
    }) : [];
    
    // If there are loans but no details were found/matched, create a dummy detail to hold the loan info
    if (processedDetails.length === 0 && remit.loans && remit.loans.length > 0) {
      const loan = remit.loans[0];
      let dueDate = loan.due_date;
      if (!dueDate && loan.duration_months && loan.issued_date) {
        const issueDate = new Date(loan.issued_date);
        issueDate.setMonth(issueDate.getMonth() + loan.duration_months);
        dueDate = issueDate.toISOString().split('T')[0];
      }
      processedDetails.push({
        id: 'dummy_' + Math.random().toString(36).substr(2, 9),
        remittance_id: remit.id,
        enterprise_id: loan.enterprise_id,
        item: loan.enterprise_id || 'Loan',
        amount: loan.principal_amount,
        loan_info: {
          loanData: {
            principalAmount: loan.principal_amount,
            durationMonths: loan.duration_months,
            issueDate: loan.issued_date,
            dueDate: dueDate,
            notes: loan.notes,
            status: loan.status
          },
          guarantors: (loan.guarantors || []).map(g => ({
            ...g,
            amount: g.guarantee_amount || g.amount || 0
          })),
          charges: loan.charges || []
        }
      });
    }
    
    // Set non-detail fields first (details set AFTER balance load to avoid
    // syncFormData reading old DOM during the await and reverting our details)
    Object.keys(formData).forEach(k => delete formData[k]);
    Object.assign(formData, {
      id: remit.id,
      r_id: remit.r_id,
      remittance_date: remit.remittance_date,
      bank_name: remit.bank_name || '',
      amount: remit.amount || 0,
      description: remit.description || '',
      transaction_type: remit.transaction_type || '',
      member_id: remit.member_id || '',
      isLoanRequest: remit.isLoanRequest || (remit.loans && remit.loans.length > 0),
      status: remit.status
    });
    
    if (formData.member_id && formData.member_id !== '0000000000') {
      await loadMemberBalances(formData.member_id);
    } else {
      openingBalances = {};
      paymentAdvise = {};
    }
    
    // Set details after potential async gap to prevent syncFormData corruption
    formData.details = processedDetails;
    
    render();
  }

  // --- Clear Form ---
  async function clearForm(isFullReset = false) {
    clearSavedForm();
    previewMode = false;
    Object.keys(formData).forEach(k => delete formData[k]);
    Object.assign(formData, {
      id: null,
      remittance_date: new Date().toISOString().split('T')[0],
      bank_name: '',
      amount: 0,
      description: '',
      transaction_type: '',
      member_id: isAdmin ? '' : user.memberId,
      details: [],
      isLoanRequest: false,
      isWithdrawalRequest: false
    });
    initialFormData = JSON.parse(JSON.stringify(formData));
    // Reset all history selection state
    historyState.selectedRemittanceId = null;
    historyState.selectedRemittanceIds = new Set();
    historyState.selectAll = false;
    
    // Reset or load balances
    if (formData.member_id && formData.member_id !== '0000000000') {
      await loadMemberBalances(formData.member_id);
    } else {
      openingBalances = {};
      paymentAdvise = {};
    }
    // Reset focus tracking
    activeId = null;
    activeName = null;
    activeRowEntId = null;
    selectionStart = 0;
    selectionEnd = 0;
    render();
  }

  // --- Sync Form Data ---
  function syncFormData() {
    const currentForm = container.querySelector('#payment-form');
    if (!currentForm) return;
    const adminCheck = container.querySelector('#admin-mode-check');
    const fd = new FormData(currentForm);
    const dateVal = fd.get('remittance_date');
    if (dateVal) formData.remittance_date = dateVal;
    const bankVal = fd.get('bank_name');
    if (bankVal !== null) formData.bank_name = bankVal;
    formData.amount = parseFloat(fd.get('amount') || 0);
    formData.description = fd.get('description') || '';
    if (isAdmin) {
      if (adminCheck && adminCheck.checked) {
        formData.member_id = '0000000000';
      } else {
        formData.member_id = fd.get('member_id');
      }
    }
    formData.transaction_type = fd.get('transaction_type') || '';
    const detailRows = container.querySelectorAll('.detail-item-row');
    if (detailRows.length > 0) {
      formData.details = Array.from(detailRows)
        .map(row => {
          const rowId = row.dataset.id || generateId();
          const entId = String(row.dataset.entid || '');
          const inputValStr = row.querySelector('.detail-amt-grid').value;
          let amount = inputValStr ? parseFloat(inputValStr) : 0;
          if (isNaN(amount)) amount = 0;
          const prevDetail = (formData.details || []).find(d => String(d.enterprise_id || d.item || '') === entId);
          let loanInfo = prevDetail ? prevDetail.loan_info : null;
          if (!loanInfo && row.dataset.loaninfo) {
            try {
              const domLoanInfo = JSON.parse(row.dataset.loaninfo);
              if (domLoanInfo && (domLoanInfo.loanData || domLoanInfo.guarantors || domLoanInfo.charges)) {
                loanInfo = domLoanInfo;
              }
            } catch (e) {}
          }
          return {
            id: row.dataset.id || (prevDetail ? prevDetail.id : generateId()),
            enterprise_id: entId,
            item: entId,
            amount: amount,
            loan_info: loanInfo
          };
        });
    }
    const totalDist = (formData.details || []).reduce((sum, d) => sum + (d.amount || 0), 0);
    const totalCell = container.querySelector('#dist-total-cell');
    if (totalCell) {
      totalCell.textContent = totalDist.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      totalCell.style.color = totalDist < 0 ? 'var(--danger)' : 'inherit';
    }
    const diffCell = container.querySelector('#dist-diff-cell');
    if (diffCell) {
      const diff = formData.amount - totalDist;
      diffCell.textContent = diff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      diffCell.style.color = Math.abs(diff) < 0.01 ? 'var(--success)' : 'var(--danger)';
    }
  }

  // --- Check Dirty ---
  function checkDirty() {
    const submitBtn = document.getElementById('submit-log-btn');
    if (!submitBtn) return;
    const isValid = validateEnterpriseInputs();
    submitBtn.disabled = !isValid;
  }

  // --- Validate Enterprise Inputs ---
  function validateEnterpriseInputs() {
    let allValid = true;
    container.querySelectorAll('.detail-item-row').forEach(row => {
      const entId = row.dataset.entid;
      const ent = enterpriseData.find(e => e.id === entId);
      if (!ent) return;

      const input = row.querySelector('.detail-amt-grid');
      let val = parseFloat(input.value || 0);
      const opening = parseFloat(input.dataset.opening || 0);
      const type = (ent.account_type || ent.type || '').toLowerCase();

      let error = null;
      if (formData.member_id !== '0000000000') {
        if (type === 'savings') {
          if (val < -opening) {
            error = "Cannot withdraw more than balance.";
            allValid = false;
          }
        } else if (type === 'loan') {
          const maxRepayment = -opening;
          if (val > maxRepayment) {
            error = "Cannot repay more than owed.";
            allValid = false;
          }

          if (ent.parent_account && ent.loan_multiplier) {
            const parentBal = openingBalances[ent.parent_account] || 0;
            const borrowingLimit = -(parentBal * ent.loan_multiplier);
            const minInput = borrowingLimit - opening;
            if (val < minInput) {
              error = "Exceeds loan limit.";
              allValid = false;
            }
          }
        }
      }

      // Visual feedback for error
      if (error) {
        input.style.borderBottom = '2px solid var(--danger)';
        input.title = error;
      } else {
        input.style.borderBottom = 'none';
        input.title = '';
      }
    });
    return allValid;
  }

  // --- Is Form Valid ---
  function isFormValid() {
    const isCoopWide = isAdmin && formData.member_id === '0000000000';
    const hasDate = !!formData.remittance_date || formData.isLoanRequest;
    const hasBank = !!formData.bank_name || formData.isLoanRequest;
    const hasMember = isCoopWide || (!!formData.member_id && formData.member_id !== '0000000000');
    let hasNote = true;
    if (isCoopWide || (formData.bank_name || '').toLowerCase() === 'internal transfer') {
      hasNote = !!(formData.description || '').trim();
    }

    return hasDate && hasBank && hasMember && hasNote;
  }



  // --- Handle Submit ---
  const handleSubmit = async () => {
    // First, sync form data from DOM to formData!
    syncFormData();
    
    const clearHighlights = () => {
      container.querySelectorAll('.field-invalid').forEach(el => el.classList.remove('field-invalid'));
    };
    const highlightField = (name) => {
      const el = container.querySelector(`[name="${name}"]`);
      if (el) {
        const wrapper = el.closest('.form-group, .select-wrapper') || el.parentElement;
        if (wrapper) wrapper.classList.add('field-invalid');
      }
    };
    clearHighlights();

    const submitBtn = document.getElementById('submit-log-btn');
    if (submitBtn) {
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      submitBtn.innerText = 'Processing...';
    }
    try {
      formData.details = formData.details.filter(d => parseFloat(d.amount || 0) !== 0 || !!d.loan_info);
      
      let txType = formData.transaction_type;
      let memberId = formData.member_id;
      const amountVal = formData.amount;
      const bankName = formData.bank_name;
      const isCoopWide = isAdmin && formData.member_id === '0000000000';
      const detailsSum = formData.details.reduce((sum, d) => sum + (d.amount || 0), 0);
      
      // Bank and date are ALWAYS required except for new loan/withdrawal requests being submitted
      if (!formData.isLoanRequest && !formData.isWithdrawalRequest) {
        if (!formData.remittance_date) {
          highlightField('remittance_date');
          showToast('Validation Error: Transaction Date is required.', 'error');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
          return;
        }
        if (!bankName) {
          highlightField('bank_name');
          showToast('Validation Error: Bank or Remittance Method is required.', 'error');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
          return;
        }
      }
      
      if (isCoopWide) {
        if (amountVal === 0) {
          showToast('Validation Error: Total amount cannot be zero.', 'error');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
          return;
        }
        if (!formData.description.trim()) {
          highlightField('description');
          showToast('Validation Error: Note / Description is required.', 'error');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
          return;
        }
        if (!txType) {
          highlightField('transaction_type');
          showToast('Validation Error: Transaction Type is required for Admin mode.', 'error');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
          return;
        }
      } else {
        txType = '';
        if (!isAdmin) {
          memberId = user.memberId;
          formData.member_id = user.memberId;
        }
        if (!memberId || memberId === '0000000000') {
          highlightField('member_id');
          showToast('Validation Error: Please select a member.', 'error');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
          return;
        }
        if ((bankName || '').toLowerCase() === 'internal transfer') {
          if (!formData.description.trim()) {
            highlightField('description');
            showToast('Validation Error: Note / Description is required for Internal Transfer.', 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
            return;
          }
          txType = 'Internal Transfer';
          if (Math.abs(detailsSum - amountVal) > 0.01) {
            showToast(`Validation Error: Distribution total (${detailsSum.toFixed(2)}) does not match remittance amount (${amountVal.toFixed(2)}).`, 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
            return;
          }
        } else {
          if (amountVal === 0) {
            if (formData.details.length > 1 && Math.abs(detailsSum) < 0.01) {
              txType = 'Internal Transfer';
            } else {
              showToast('Validation Error: Amount cannot be zero except for balanced Internal Transfers.', 'error');
              if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
              return;
            }
          }
          const getAccountType = (acc) => (acc?.account_type || acc?.type || acc?.Account_Type || '').toLowerCase();
          let loanEntIds = enterpriseData.filter(e => getAccountType(e) === 'loan').map(e => e.id);
          let savingsEntIds = enterpriseData.filter(e => getAccountType(e) === 'savings').map(e => e.id);
          if (formData.isLoanRequest) {
            const loanReqEntId = formData.details.find(d => d.loan_info)?.enterprise_id;
            if (loanReqEntId && !loanEntIds.includes(loanReqEntId)) {
              loanEntIds.push(loanReqEntId);
            }
          }
          let loanNegCount = 0;
          let missingLoanConfigId = null;
          formData.details.forEach((d, idx) => {
            const entId = d.enterprise_id || d.item;
            const needsConfig = (d.amount < 0) || (formData.isLoanRequest && d.amount !== 0);
            if (loanEntIds.includes(entId) && needsConfig) {
              loanNegCount++;
              const isInternalTransfer = txType === 'Internal Transfer';
              if (!isInternalTransfer && (!d.loan_info || !d.loan_info.loanData?.durationMonths)) {
                if (!missingLoanConfigId) {
                  missingLoanConfigId = d.enterprise_id || d.item;
                }
              }
            }
          });
          if (missingLoanConfigId) {
            showLoanConfigModal(missingLoanConfigId, false, deps);
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
            return;
          }
          if (formData.isLoanRequest && !formData.details.some(d => d.loan_info)) {
            showToast('Validation Error: Please enter an amount for a loan account and configure the loan details.', 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
            return;
          }
          if (amountVal < 0 && txType !== 'Internal Transfer') {
            if (isAdmin) {
              if (!isCoopWide) {
                const nonZeroDetails = formData.details;
                const hasLoanDistribution = nonZeroDetails.some(d => loanEntIds.includes(d.enterprise_id || d.item) && d.amount < 0);
                const hasSavingsDistribution = nonZeroDetails.some(d => savingsEntIds.includes(d.enterprise_id || d.item) && d.amount < 0);
                const isLoan = hasLoanDistribution && (nonZeroDetails.length === 1);

                if (isLoan) {
                  txType = 'Member Loan';
                  if (!formData.isLoanRequest) {
                    if (!hasLoanDistribution) {
                      showToast('Validation Error: Negative member payments must be distributed to a Loan account.', 'error');
                      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
                      return;
                    }
                  }
                } else {
                  txType = 'Savings Withdrawal';
                  if (!hasSavingsDistribution) {
                    showToast('Validation Error: Negative member payments must be distributed to a Savings account.', 'error');
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
                    return;
                  }
                }
              } else {
                txType = 'Withdrawal';
              }
            } else {
              if (formData.isLoanRequest) {
                txType = 'Member Loan';
              } else if (formData.isWithdrawalRequest) {
                txType = 'Savings Withdrawal';
              } else {
                showToast('Validation Error: Members cannot log negative amounts directly. Please use the "Loan Request" or "Withdrawal Request" button.', 'error');
                if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
                return;
              }
            }
          } else if (formData.isLoanRequest) {
            txType = 'Member Loan';
          } else if (amountVal > 0 && txType !== 'Internal Transfer') {
            txType = 'Member Deposit';
          }
          if (txType !== 'Internal Transfer' && Math.abs(detailsSum - amountVal) > 0.01) {
            showToast(`Validation Error: Distribution total (${detailsSum.toFixed(2)}) does not match remittance amount (${amountVal.toFixed(2)}).`, 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
            return;
          }
        }
      }
      formData.transaction_type = txType;
      const isLoanRequest = !!formData.isLoanRequest;
      if (canApprove && !isLoanRequest && formData.details.some(d => d.loan_info)) {
        formData.details.forEach(d => {
          if (d.loan_info && d.loan_info.guarantors) {
            d.loan_info.guarantors.forEach(g => {
              g.guarantor_approval = 1;
            });
          }
        });
      } else if (formData.details.some(d => d.loan_info)) {
        formData.details.forEach(d => {
          if (d.loan_info && d.loan_info.guarantors) {
            d.loan_info.guarantors.forEach(g => {
              if (g.guarantor_approval === undefined) g.guarantor_approval = null;
            });
          }
        });
      }
      
      // Compulsory due validation: skip for loan transactions (they use their own charge config)
      const getAccountTypeLocal = (acc) => (acc?.account_type || acc?.type || acc?.Account_Type || '').toLowerCase();
      const localLoanEntIds = enterpriseData.filter(e => getAccountTypeLocal(e) === 'loan').map(e => e.id);
      const localSavingsEntIds = enterpriseData.filter(e => getAccountTypeLocal(e) === 'savings').map(e => e.id);
      const hasLoanDist = formData.details.some(d => localLoanEntIds.includes(d.enterprise_id || d.item) && d.amount < 0);
      const hasSavingsDist = formData.details.some(d => localSavingsEntIds.includes(d.enterprise_id || d.item) && d.amount < 0);
      if (!isCoopWide && !hasLoanDist && !hasSavingsDist && amountVal >= 0) {
        const compulsoryWarnings = [];
        enterpriseData.forEach(ent => {
          if (ent.compulsory_due && parseFloat(ent.compulsory_amount || 0) > 0) {
            const detail = formData.details.find(d => (d.enterprise_id || d.item) === ent.id);
            const distAmount = parseFloat(detail?.amount || 0);
            const requiredAmount = parseFloat(ent.compulsory_amount);
            if (distAmount < requiredAmount) {
              compulsoryWarnings.push({ name: ent.account_name || ent.id, required: requiredAmount, entered: distAmount });
            }
          }
        });
        if (compulsoryWarnings.length > 0) {
          const proceed = await new Promise(resolve => {
            showModalDialog('Compulsory Amounts Not Met', [
              '<div style="margin-bottom: 0.75rem;"><strong>The following enterprises have not met their compulsory due amounts:</strong></div>',
              ...compulsoryWarnings.map(w =>
                `<div style="margin: 0.25rem 0; padding: 0.5rem; background: var(--bg-secondary); border-radius: var(--radius-sm);">${w.name}: <strong>₦${w.required.toFixed(2)}</strong> required, ₦${w.entered.toFixed(2)} entered</div>`
              ),
              '<div style="margin-top: 0.75rem;">Do you want to continue anyway or go back to adjust the amounts?</div>'
            ].join(''), [
              { text: 'Go Back', class: 'btn btn-secondary', onClick: () => resolve(false) },
              { text: 'Continue Anyway', class: 'btn btn-primary', onClick: () => resolve(true) }
            ]);
          });
          if (!proceed) {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Save Remittance'; }
            return;
          }
        }
      }

      // Only handle new remittances
      const nextRid = await getNextRemittanceRid(user.cooperativeId);
      const selectedMember = members.find(m => m.id === formData.member_id);
      const status = canApprove ? 'Approved' : 'Pending';
      const finalDescription = (status === 'Approved' && formData.description === 'Loan Request') ? '' : formData.description;
      
      formData.loans = [];
      const autogenRemittances = [];

      formData.details.forEach(d => {
        if (d.loan_info) {
          const lInfo = d.loan_info;
          const loanId = generateId();
          formData.loans.push({
            id: loanId,
            member_id: formData.member_id,
            enterprise_id: d.enterprise_id || d.item,
            principal_amount: lInfo.loanData.principalAmount,
            issued_date: lInfo.loanData.issueDate || formData.remittance_date,
            due_date: lInfo.loanData.dueDate,
            status: lInfo.loanData.status || (status === 'Approved' ? 'Active' : 'Pending'),
            notes: lInfo.loanData.notes || '',
            duration_months: lInfo.loanData.durationMonths || 0,
            guarantors: lInfo.guarantors
          });
          
          if (lInfo.charges && lInfo.charges.length > 0) {
            lInfo.charges.forEach((c, chargeIdx) => {
              let val = parseFloat(c.value) || 0;
              if (c.type === 'percentage') {
                val = (val / 100) * (lInfo.loanData.principalAmount || 0);
              }
              val = -Math.abs(val);
              const singleDetail = [{
                id: generateId(),
                enterprise_id: d.enterprise_id || d.item,
                amount: val,
                notes: c.name
              }];
              autogenRemittances.push({
                member_id: formData.member_id,
                amount: val,
                remittance_date: formData.remittance_date,
                bank_name: formData.bank_name || 'System Generated',
                transaction_type: 'Loan Charges',
                category: 'Loan Income',
                description: 'Loan Charge: ' + (c.name || 'Charge'),
                autogen: 1,
                loan_id: loanId,
                details: singleDetail,
                chargeIndex: chargeIdx
              });
            });
          }
        }
      });

      await addRemittance({
        ...formData,
        description: finalDescription,
        r_id: nextRid,
        status,
        cooperative_id: user.cooperativeId,
        user_role: user.role || 'member',
        user_roles: [user.role || 'member'],
        loan_status: status === 'Approved' ? 'Active' : 'Pending'
      }, isMember ? 'self' : user.username);
      
      // Save autogen remittances
      for (let idx = 0; idx < autogenRemittances.length; idx++) {
          const autoRem = autogenRemittances[idx];
          const baseId = generateRemittanceId(user.cooperativeId);
          const suffix = String(idx + 1).padStart(2, '0');
          autoRem.id = `${baseId}-${suffix}`;
          const autoRid = await getNextRemittanceRid(user.cooperativeId);
          await addRemittance({
              ...autoRem,
              r_id: autoRid,
              status,
              cooperative_id: user.cooperativeId,
              user_role: user.role || 'member',
              user_roles: [user.role || 'member']
          }, isMember ? 'self' : user.username);
      }
      
      if (formData.loans && formData.loans.length > 0) {
          const { fetchMemberDoc, updateMemberPaymentAdvice } = await import('../../services/dataService.js');
          const memberId = formData.member_id;
          const memberDoc = await fetchMemberDoc(memberId);
          if (memberDoc) {
              let existingAdvise = memberDoc.payment_advise || [];
              let adviseChanged = false;
              
              for (const loan of formData.loans) {
                  if (loan.principal_amount && loan.duration_months && loan.duration_months > 0) {
                      const monthlyPayment = parseFloat((loan.principal_amount / loan.duration_months).toFixed(2));
                      if (monthlyPayment > 0) {
                          const existingIndex = existingAdvise.findIndex(a => String(a.enterprise_id) === String(loan.enterprise_id));
                          if (existingIndex >= 0) {
                              existingAdvise[existingIndex].amount = (parseFloat(existingAdvise[existingIndex].amount) || 0) + monthlyPayment;
                          } else {
                              existingAdvise.push({
                                  enterprise_id: String(loan.enterprise_id),
                                  amount: monthlyPayment,
                                  created_at: new Date().toISOString()
                              });
                          }
                          adviseChanged = true;
                      }
                  }
              }
              
              if (adviseChanged) {
                  await updateMemberPaymentAdvice(memberId, existingAdvise, user.username, user.cooperativeId);
              }
          }
      }
      
      clearSavedForm();
      await loadHistoryData(true);
      await clearForm(true);
      showToast('Remittance record saved successfully!', 'success');
      window.dispatchEvent(new CustomEvent('remittance-saved'));
    } catch (err) {
      showToast('Error saving remittance: ' + err.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Save Remittance';
      }
    }
  };

  // --- Show Loan Config Modal (extracted to remittanceLoanConfig.js) ---
  // --- Render ---
  const render = () => {
    const savedScrollTop = container.querySelector('.history-table-container')?.scrollTop ?? null;
    Object.assign(deps, { formData, openingBalances, paymentAdvise, previewMode, historyState });
    _render(container, deps);
    setupHistoryScrollListener();
    if (savedScrollTop !== null) {
      const el = container.querySelector('.history-table-container');
      if (el) el.scrollTop = savedScrollTop;
    }
  };

  // --- Restore Focus ---
  function restoreFocus() {
    try {
      let targetEl = null;
      if (activeId) targetEl = document.getElementById(activeId);
      else if (activeName) targetEl = container.querySelector(`[name="${activeName}"]`);
      else if (activeRowEntId) {
        const row = container.querySelector(`.detail-item-row[data-entid="${activeRowEntId}"]`);
        if (row) targetEl = row.querySelector('.detail-amt-grid');
      }
      if (targetEl && targetEl !== document.body) {
        targetEl.focus();
        const supportedSelection = ['text', 'search', 'url', 'tel', 'password'];
        if (typeof selectionStart === 'number' && (supportedSelection.includes(targetEl.type) || targetEl.tagName === 'TEXTAREA')) {
          try {
            targetEl.setSelectionRange(selectionStart, selectionEnd);
          } catch (e) {}
        } else if (targetEl.type === 'number') {
          const val = targetEl.value;
          targetEl.value = '';
          targetEl.value = val;
        }
      }
    } catch (e) {}
  }

  // --- Attach Event Listeners (extracted to remittanceEventListeners.js) ---
  function attachImagePreview(member) {
    const avatarWrap = container.querySelector('#up-avatar-wrap');
    if (!avatarWrap || !member) return;
    let previewEl = null;
    let pressTimer = null;
    const showPreview = () => {
      if (previewEl) return;
      previewEl = document.createElement('div');
      previewEl.id = 'md-img-preview';
      const initials = getInitials(member.name);
      const color = getAvatarColor(member.name);
      if (member.image_path) {
        previewEl.innerHTML = `
          <div class="md-preview-image-wrap">
            <img src="${member.image_path}" alt="${escapeHtml(member.name)}" draggable="false">
            <div class="md-preview-meta">
              <div class="md-preview-initials-sm" style="background-color: ${color}">${escapeHtml(initials)}</div>
              <div class="md-preview-name">${escapeHtml(member.name)}</div>
            </div>
          </div>
        `;
      } else {
        previewEl.innerHTML = `
          <div class="md-preview-initials-wrap" style="display: flex; flex-direction: column; align-items: center; gap: 1rem;">
            <div class="md-preview-initials-circle" style="width: 120px; height: 120px; border-radius: 50%; background-color: ${color}; display: flex; align-items: center; justify-content: center; font-size: 3rem; font-weight: 800; color: white; text-transform: uppercase; letter-spacing: 0.08em;">${escapeHtml(initials)}</div>
            <div class="md-preview-name">${escapeHtml(member.name)}</div>
          </div>
        `;
      }
      document.body.appendChild(previewEl);
    };
    const hidePreview = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      if (previewEl) { previewEl.remove(); previewEl = null; }
    };
    const startPress = (e) => {
      if (e.type === 'touchstart') e.preventDefault();
      e.stopPropagation();
      pressTimer = setTimeout(() => { showPreview(); }, 350);
      document.addEventListener('mouseup', hidePreview, { once: true });
      document.addEventListener('touchend', hidePreview, { once: true });
      document.addEventListener('touchcancel', hidePreview, { once: true });
    };
    avatarWrap.addEventListener('mousedown', startPress);
    avatarWrap.addEventListener('touchstart', startPress, { passive: false });
  }

  function updateHistoryTable() {
    // Track current focus before modifying the DOM
    trackFocus();
    
    const tbody = container.querySelector('#history-tbody');
    if (!tbody) return;
    tbody.innerHTML = historyState.allRemittances.map((remit, idx) => {
      const member = historyState.membersMap[remit.member_id];
      const isSelected = historyState.selectedRemittanceIds.has(remit.id);
      return `
      <tr class="${historyState.selectedRemittanceId === remit.id ? 'selected' : ''} ${isSelected ? 'selected' : ''}" data-id="${remit.id}" data-row-index="${idx}">
        <td>
          <input type="checkbox" class="remit-checkbox" data-id="${remit.id}" ${isSelected ? 'checked' : ''}>
        </td>
        ${!isMember ? `
          <td>
            <div class="member-name-cell" style="color: ${remit.member_id === '0000000000' ? 'var(--accent-primary)' : 'var(--text-primary)'}">${escapeHtml(getFormattedName(remit.member_id, remit.transaction_type))}</div>
            <div class="member-reg-cell">${String(remit.r_id || '').padStart(5, '0')}</div>
          </td>
        ` : `
          <td>
            <div class="member-name-cell">${String(remit.r_id || '').padStart(5, '0')}</div>
          </td>
        `}
        <td><div style="color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(member?.special_id || '—')}</div></td>
        <td><div>${formatDate(remit.remittance_date)}</div></td>
        <td><div style="font-weight: 600;">${escapeHtml(remit.bank_name || 'Direct')}</div></td>
        <td><div style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-muted);" title="${escapeHtml(remit.description || '')}">${escapeHtml(remit.description || '')}</div></td>
        <td class="text-right">
          <div style="font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 1rem; color: ${remit.amount < 0 ? 'var(--danger)' : 'var(--success)'};">${formatCurrency(remit.amount)}</div>
        </td>
        <td><span class="status-badge status-${escapeHtml(remit.status || 'Pending')}">${escapeHtml(remit.status || 'Pending')}</span></td>
        <td>
          <div class="modified-by-name">${escapeHtml(remit.created_by || '—')}</div>
          <div class="modified-at-time">${formatDateTime(remit.created_at || remit.remittance_date) || '—'}</div>
        </td>
        <td>
          <div class="modified-by-name">${escapeHtml(remit.modified_by || remit.created_by || '—')}</div>
          <div class="modified-at-time">${formatDateTime(remit.modified_at || remit.created_at || remit.remittance_date) || '—'}</div>
        </td>
      </tr>
      `;
    }).join('');

    const scrollIndicator = container.querySelector('#history-scroll-indicator');
    if (scrollIndicator) {
      scrollIndicator.style.display = historyState.isLoading ? 'block' : 'none';
    }

    // Re-attach delete and checkbox listeners
    attachHistoryEventListeners();
    
    // Restore the previous focus and selection
    restoreFocus();
  }

  function attachHistoryEventListeners() {
    // Select all checkbox
    const selectAllCheckbox = container.querySelector('#select-all-checkbox');
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', (e) => {
        historyState.selectAll = e.target.checked;
        if (e.target.checked) {
          historyState.allRemittances.forEach(r => historyState.selectedRemittanceIds.add(r.id));
        } else {
          historyState.selectedRemittanceIds.clear();
        }
        updateHistoryTable();
        updateDeleteSelectedButton();
      });
    }

    // Individual remittance checkboxes
    container.querySelectorAll('.remit-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        if (e.target.checked) {
          historyState.selectedRemittanceIds.add(id);
        } else {
          historyState.selectedRemittanceIds.delete(id);
        }
        historyState.selectAll = historyState.allRemittances.length > 0 && 
          historyState.selectedRemittanceIds.size === historyState.allRemittances.length;
        updateHistoryTable();
        updateDeleteSelectedButton();
      });
    });





    // Delete selected button
    const deleteSelectedBtn = container.querySelector('#delete-selected-btn');
    if (deleteSelectedBtn && canDelete) {
      deleteSelectedBtn.onclick = async () => {
        const count = historyState.selectedRemittanceIds.size;
        if (count === 0) return;
        if (!confirm(`Delete ${count} selected payment${count > 1 ? 's' : ''}?`)) return;
        try {
          console.log('[Delete] Starting deletion of', count, 'remittances:', [...historyState.selectedRemittanceIds]);
          for (const id of historyState.selectedRemittanceIds) {
            console.log('[Delete] Deleting remittance:', id);
            await deleteRemittance(id, user.username);
            console.log('[Delete] Remittance deleted:', id);
          }
          historyState.selectedRemittanceIds.clear();
          historyState.selectAll = false;
          console.log('[Delete] Reloading history...');
          await loadHistoryData(true);
          console.log('[Delete] History reloaded');
          if (historyState.selectedRemittanceId) {
            historyState.selectedRemittanceId = null;
            await clearForm();
          }
          updateDeleteSelectedButton();
          showToast(`${count} payment${count > 1 ? 's' : ''} deleted successfully!`, 'success');
          console.log('[Delete] Done');
        } catch (err) {
          console.error('[Delete] Error:', err);
          showToast('Error deleting payments: ' + err.message, 'error');
        }
      };
    }

    // Export button
    const exportBtn = container.querySelector('#export-excel-btn');
    if (exportBtn) {
      exportBtn.onclick = () => exportData(historyState.allRemittances, isAdmin, getFormattedName);
    }

    // Filter controls
    const openFiltersBtn = container.querySelector('#open-filters-btn');
    const closeFiltersBtn = container.querySelector('#close-filters-btn');
    const applyFiltersBtn = container.querySelector('#apply-filters-btn');
    const clearFiltersBtn = container.querySelector('#clear-filters-btn');
    const filterOverlay = container.querySelector('#filter-overlay');
    const filterDateRange = container.querySelector('#filter-date-range');
    const customDateFromContainer = container.querySelector('#custom-date-from-container');
    const customDateToContainer = container.querySelector('#custom-date-to-container');

    if (openFiltersBtn) {
      openFiltersBtn.onclick = () => {
        if (filterOverlay) filterOverlay.classList.add('open');
      };
    }

    if (closeFiltersBtn) {
      closeFiltersBtn.onclick = () => {
        if (filterOverlay) filterOverlay.classList.remove('open');
      };
    }

    if (filterDateRange) {
      filterDateRange.onchange = (e) => {
        if (customDateFromContainer && customDateToContainer) {
          customDateFromContainer.style.display = e.target.value === 'Custom' ? '' : 'none';
          customDateToContainer.style.display = e.target.value === 'Custom' ? '' : 'none';
        }
      };
    }

    if (clearFiltersBtn) {
      clearFiltersBtn.onclick = () => {
        historyState.filters = {
          status: 'All',
          bank: 'All',
          dateRange: 'All',
          minAmount: null,
          maxAmount: null,
          memberId: (isActualAdmin || isAdmin) ? 'All' : (user.memberId || 'All'),
          transactionType: 'All',
          dateFrom: '',
          dateTo: ''
        };
        if (filterOverlay) filterOverlay.classList.remove('open');
        loadHistoryData(true);
      };
    }

    if (applyFiltersBtn) {
      applyFiltersBtn.onclick = () => {
        const filterMember = container.querySelector('#filter-member');
        const filterBank = container.querySelector('#filter-bank');
        const filterTransactionType = container.querySelector('#filter-transaction-type');
        const filterStatus = container.querySelector('#filter-status');
        const filterDateRangeEl = container.querySelector('#filter-date-range');
        const filterDateFrom = container.querySelector('#filter-date-from');
        const filterDateTo = container.querySelector('#filter-date-to');
        const filterMinAmount = container.querySelector('#filter-min-amount');
        const filterMaxAmount = container.querySelector('#filter-max-amount');

        historyState.filters.memberId = filterMember?.value || 'All';
        historyState.filters.bank = filterBank?.value || 'All';
        historyState.filters.transactionType = filterTransactionType?.value || 'All';
        historyState.filters.status = filterStatus?.value || 'All';
        historyState.filters.dateRange = filterDateRangeEl?.value || 'All';
        historyState.filters.dateFrom = filterDateFrom?.value || '';
        historyState.filters.dateTo = filterDateTo?.value || '';
        historyState.filters.minAmount = filterMinAmount?.value ? Number(filterMinAmount.value) : null;
        historyState.filters.maxAmount = filterMaxAmount?.value ? Number(filterMaxAmount.value) : null;

        if (filterOverlay) filterOverlay.classList.remove('open');
        loadHistoryData(true);
      };
    }
  }

  function updateDeleteSelectedButton() {
    const deleteBtn = container.querySelector('#delete-selected-btn');
    if (deleteBtn) {
        const hasSelected = historyState.selectedRemittanceIds && historyState.selectedRemittanceIds.size > 0;
        deleteBtn.style.display = hasSelected ? 'inline-block' : 'none';
    }
  }

  Object.assign(deps, { formData, enterpriseData, members, selectorMembers, banks, transactionTypes, isMember, user, historyState, loadHistoryData, clearForm, clearSavedForm, render, openingBalances, paymentAdvise, showAllZeros, previewMode, panelSizes, isAdmin, isActualAdmin, canApprove, canDelete, cooperativeId, PANEL_SIZE_KEY, syncFormData, checkDirty, saveSavedForm, handleMemberChange, handleSubmit, updateHistoryTable, updateDeleteSelectedButton, loadRemittanceToForm, attachImagePreview, trackFocus, isFormValid, restoreFocus, getFormattedName, attachHistoryEventListeners });
  render();

  return {
    clearForm,
    applyLoanRequestPrefill
  };
}
