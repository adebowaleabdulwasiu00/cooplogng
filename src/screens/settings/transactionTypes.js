import { getTransactionTypes, createTransactionType, updateTransactionType, deleteTransactionType, isTransactionTypeUsed, queryRows } from '../../services/sqliteService.js';
import { showToast } from '../../services/toastService.js';
import { escapeHtml } from '../../utils/formatters.js';
import { CLASSIFICATION_OPTIONS } from '../../utils/constants.js';

function classificationBadgeStyle(classification) {
    const incomeColors = 'background: var(--accent-soft); color: var(--accent-primary);';
    const expenseColors = 'background: var(--danger-bg); color: var(--danger);';
    const assetColors = 'background: #e0f2fe; color: #0369a1;';
    const liabilityColors = 'background: #fef3c7; color: #b45309;';
    const equityColors = 'background: #d1fae5; color: #065f46;';
    const transferColors = 'background: #f3e8ff; color: #7c3aed;';
    const suspenseColors = 'background: #f5f5f4; color: #78716c;';

    if (classification === 'Operating Income' || classification === 'Loan Income' || classification === 'Other Income') return incomeColors;
    if (classification === 'Operating Expense' || classification === 'Administrative Expense' || classification === 'Finance Expense' || classification === 'Welfare Expense' || classification === 'Other Operating Expense' || classification === 'Other Expenses') return expenseColors;
    if (classification === 'Asset' || classification === 'Fixed Asset' || classification === 'Loan Asset') return assetColors;
    if (classification === 'Liability' || classification === 'Member Liability') return liabilityColors;
    if (classification === 'Equity') return equityColors;
    if (classification === 'Transfer') return transferColors;
    if (classification === 'Suspense') return suspenseColors;
    return 'background: var(--bg-card); color: var(--text-muted);';
}

function renderClassificationBadge(classification) {
    return `<span style="padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; ${classificationBadgeStyle(classification)}">${escapeHtml(classification)}</span>`;
}

export function renderTransactionTypesSection(area) {
  area.innerHTML = `
      <h3>Transaction Types</h3>
      <p class="section-desc">Manage transaction types for remittances and financial tracking.</p>
      <div id="transaction-type-form-container"></div>
      <div style="margin-bottom: 1rem; text-align: right;">
        <button id="show-add-transaction-type-btn" class="primary-button" style="padding: 0.5rem 1.25rem; font-size: 0.85rem; width: ${window.innerWidth <= 768 ? '100%' : 'auto'};">+ Add Transaction Type</button>
      </div>
      <div id="transaction-type-table-container" class="table-responsive"><p style="color: var(--text-muted); font-style: italic;">Loading transaction types...</p></div>
    `;
}

export async function setupTransactionTypesListeners(user, cooperativeId) {
  let editingTransactionType = null;
  let usedTransactionTypeNames = new Set();

  const showTransactionTypeForm = async (transactionType = null) => {
    editingTransactionType = transactionType;
    const fc = document.getElementById('transaction-type-form-container');
    if (!fc) return;

    let isInUse = false;
    let isSystemDefault = false;
    if (transactionType) {
      isSystemDefault = transactionType.is_system_default === 1 || transactionType.is_system_default === true;
      isInUse = await isTransactionTypeUsed(cooperativeId, transactionType.id);
    }

    fc.innerHTML = `
        <div class="inline-form" style="display:flex; flex-direction:column; gap:1.25rem;">
          <div class="field">
            <label>${transactionType ? 'Edit' : 'New'} Transaction Type Name</label>
            <input type="text" id="transaction-type-name-input" value="${escapeHtml(transactionType?.transaction_type || '')}" placeholder="Enter transaction type name" required ${(isInUse || isSystemDefault) ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : ''}>
          </div>
          <div class="field">
            <label>Classification</label>
            <select id="transaction-type-classification-input" ${(isInUse || isSystemDefault) ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : ''}>
              ${CLASSIFICATION_OPTIONS.map(c => `<option value="${c}" ${transactionType?.classification === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="display:flex; align-items:center; gap:0.75rem;">
            <input type="checkbox" id="transaction-type-active-input" ${(transactionType?.is_active ?? true) ? 'checked' : ''}>
            <label for="transaction-type-active-input" style="margin:0;">Active</label>
          </div>
          ${isSystemDefault ? '<p style="font-size:0.8rem; color:var(--text-muted);">This is a system default transaction type and cannot be modified.</p>' : ''}
          ${isInUse ? '<p style="font-size:0.8rem; color:var(--text-muted);">This transaction type is already in use and cannot be modified.</p>' : ''}
          <div style="display:flex; gap:0.5rem;">
            <button id="save-transaction-type-btn" class="primary-button" style="padding: 0.6rem 1.5rem; font-size: 0.85rem; height: fit-content;">${transactionType ? 'Update' : 'Add'}</button>
            <button id="cancel-transaction-type-btn" class="secondary-button" style="padding: 0.6rem 1rem; font-size: 0.85rem; height: fit-content; border: 1px solid var(--border-medium); background: transparent; color: var(--text-primary);">Cancel</button>
          </div>
        </div>
      `;
    document.getElementById('cancel-transaction-type-btn')?.addEventListener('click', () => { editingTransactionType = null; fc.innerHTML = ''; });
    document.getElementById('save-transaction-type-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('transaction-type-name-input').value.trim();
      const classification = document.getElementById('transaction-type-classification-input').value;
      const isActive = document.getElementById('transaction-type-active-input')?.checked ?? true;

      if (!name) { showToast('Transaction type name is required.', 'warning'); return; }

      try {
        if (editingTransactionType) {
          if (isSystemDefault || isInUse) {
            // Only allow changing is_active if system default or in use
            await updateTransactionType(cooperativeId, editingTransactionType.id, { is_active: isActive ? 1 : 0 }, user.username);
          } else {
            await updateTransactionType(cooperativeId, editingTransactionType.id, { transaction_type: name, classification, is_active: isActive ? 1 : 0 }, user.username);
          }
        } else {
          await createTransactionType(cooperativeId, name, classification, user.username);
        }
        editingTransactionType = null; fc.innerHTML = '';
        loadTransactionTypes();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
  };

  const loadTransactionTypes = async () => {
    const tc = document.getElementById('transaction-type-table-container');
    if (!tc) return;
    try {
      const transactionTypes = await getTransactionTypes(cooperativeId);

      if (transactionTypes.length === 0) {
        tc.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">No transaction types yet.</p>';
        return;
      }

      // Fetch which transaction types are in use
      const inUseRemittances = await queryRows('SELECT DISTINCT transaction_type FROM remittance WHERE cooperative_id = ? AND is_deleted = 0', [cooperativeId]);
      usedTransactionTypeNames = new Set(inUseRemittances.map(r => r.transaction_type?.toLowerCase()));

      tc.innerHTML = `
          <table class="crud-table">
            <thead><tr><th>#</th><th>Name</th><th>Classification</th><th>System Default</th><th>Active</th><th style="width: 120px;">Actions</th></tr></thead>
            <tbody>
              ${transactionTypes.map((t, i) => {
                const isInUse = usedTransactionTypeNames.has(t.transaction_type?.toLowerCase());
                const isSystemDefault = t.is_system_default === 1 || t.is_system_default === true;
                const canEditDelete = !isSystemDefault && !isInUse;
                return `
                    <tr>
                      <td>${i + 1}</td>
                      <td>${escapeHtml(t.transaction_type)} ${isInUse ? '<span style="font-size: 0.7rem; color: var(--text-muted); font-style: italic; margin-left: 0.5rem;">(In Use)</span>' : ''}</td>
                      <td>${renderClassificationBadge(t.classification)}</td>
                      <td>${isSystemDefault ? 'Yes' : 'No'}</td>
                      <td>${t.is_active ? 'Yes' : 'No'}</td>
                      <td>
                        <button class="crud-action-btn edit" data-id="${t.id}" data-name="${escapeHtml(t.transaction_type)}" ${canEditDelete ? '' : 'disabled style="opacity:0.5; cursor:not-allowed;"'}>Edit</button>
                        ${canEditDelete ? `<button class="crud-action-btn delete" data-id="${t.id}" data-name="${escapeHtml(t.transaction_type)}">Delete</button>` : ''}
                      </td>
                    </tr>
                  `;
              }).join('')}
            </tbody>
          </table>
        `;

      tc.querySelectorAll('.crud-action-btn.edit:not([disabled])').forEach(btn => {
        const transactionType = transactionTypes.find(t => t.id === btn.dataset.id);
        btn.addEventListener('click', () => showTransactionTypeForm(transactionType));
      });
      tc.querySelectorAll('.crud-action-btn.delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Delete transaction type "${btn.dataset.name}"? This cannot be undone.`)) return;
          try {
            await deleteTransactionType(cooperativeId, btn.dataset.id, user.username);
            loadTransactionTypes();
          } catch (err) { showToast(err.message, 'error'); }
        });
      });
    } catch (err) {
      tc.innerHTML = `<p style="color: var(--danger);">Error loading transaction types: ${err.message}</p>`;
    }
  };

  document.getElementById('show-add-transaction-type-btn')?.addEventListener('click', () => showTransactionTypeForm());
  await loadTransactionTypes();
}
