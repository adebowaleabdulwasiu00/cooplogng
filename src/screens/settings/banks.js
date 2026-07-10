import { fetchBanks, addBank, updateBank, deleteBank } from '../../services/dataService.js';
import { showToast } from '../../services/toastService.js';
import { queryRows } from '../../services/sqliteService.js';
import { escapeHtml } from '../../utils/formatters.js';

export function renderBankSection(area) {
  area.innerHTML = `
      <h3>Bank List</h3>
      <p class="section-desc">Manage the list of banks and payment methods available for remittances.</p>
      <div id="bank-form-container"></div>
      <div style="margin-bottom: 1rem; text-align: right;">
        <button id="show-add-bank-btn" class="primary-button" style="padding: 0.5rem 1.25rem; font-size: 0.85rem; width: ${window.innerWidth <= 768 ? '100%' : 'auto'};">+ Add Bank</button>
      </div>
      <div id="bank-table-container" class="table-responsive"><p style="color: var(--text-muted); font-style: italic;">Loading banks...</p></div>
    `;
}

export function setupBankListeners(user, cooperativeId) {
  let editingBank = null;
  let usedBankNames = new Set();

  const showBankForm = async (bank = null) => {
    editingBank = bank;
    const fc = document.getElementById('bank-form-container');
    if (!fc) return;

    // Check if bank is in use
    let isInUse = false;
    if (bank) {
      isInUse = usedBankNames.has(bank.bank_name);
    }

    fc.innerHTML = `
        <div class="inline-form" style="display:flex; flex-direction:column; gap:1.25rem;">
          <div class="field">
            <label>${bank ? 'Edit' : 'New'} Bank Name</label>
            <input type="text" id="bank-name-input" value="${escapeHtml(bank?.bank_name || '')}" placeholder="Enter bank name" required ${isInUse && bank?.bank_name ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : ''}>
          </div>
          <div class="field">
            <label>Account Name</label>
            <input type="text" id="bank-account-name-input" value="${escapeHtml(bank?.account_name || '')}" placeholder="Enter account name" ${isInUse && bank?.account_name ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : ''}>
          </div>
          <div class="field">
            <label>Account Number</label>
            <input type="text" id="bank-account-number-input" value="${escapeHtml(bank?.account_number || '')}" placeholder="Enter account number" ${isInUse && bank?.account_number ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : ''}>
          </div>
          <div class="field">
            <label>Branch Name</label>
            <input type="text" id="bank-branch-name-input" value="${escapeHtml(bank?.branch_name || '')}" placeholder="Enter branch name" ${isInUse && bank?.branch_name ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : ''}>
          </div>
          <div class="field">
            <label>SWIFT Code</label>
            <input type="text" id="bank-swift-code-input" value="${escapeHtml(bank?.swift_code || '')}" placeholder="Enter SWIFT code" ${isInUse && bank?.swift_code ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : ''}>
          </div>
          <div class="field" style="display:flex; align-items:center; gap:0.75rem;">
            <input type="checkbox" id="bank-visible-input" ${(bank?.is_visible ?? true) ? 'checked' : ''}>
            <label for="bank-visible-input" style="margin:0;">Show on Dashboard</label>
          </div>
          ${isInUse ? '<p style="font-size:0.8rem; color:var(--text-muted);">This bank is in use. Only visibility and blank fields can be changed.</p>' : ''}
          <div style="display:flex; gap:0.5rem;">
            <button id="save-bank-btn" class="primary-button" style="padding: 0.6rem 1.5rem; font-size: 0.85rem; height: fit-content;">${bank ? 'Update' : 'Add'}</button>
            <button id="cancel-bank-btn" class="secondary-button" style="padding: 0.6rem 1rem; font-size: 0.85rem; height: fit-content; border: 1px solid var(--border-medium); background: transparent; color: var(--text-primary);">Cancel</button>
          </div>
        </div>
      `;
    document.getElementById('cancel-bank-btn')?.addEventListener('click', () => { editingBank = null; fc.innerHTML = '' });
    document.getElementById('save-bank-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('bank-name-input').value.trim();
      const accountName = document.getElementById('bank-account-name-input').value.trim();
      const accountNumber = document.getElementById('bank-account-number-input').value.trim();
      const branchName = document.getElementById('bank-branch-name-input').value.trim();
      const swiftCode = document.getElementById('bank-swift-code-input').value.trim();
      const isVisible = document.getElementById('bank-visible-input')?.checked ?? true;
      if (!name) { showToast('Bank name is required.', 'warning'); return; }
      try {
        let bankData = {};
        if (isInUse) {
          // For in-use banks: allow updating visibility AND any blank fields that were just filled in
          bankData = {
            id: editingBank?.id,
            is_visible: isVisible ? 1 : 0
          };
          // If account name was blank but now filled, allow updating it
          if (!editingBank?.account_name && accountName) {
            bankData.account_name = accountName;
          }
          // If account number was blank but now filled, allow updating it
          if (!editingBank?.account_number && accountNumber) {
            bankData.account_number = accountNumber;
          }
          // If branch name was blank but now filled, allow updating it
          if (!editingBank?.branch_name && branchName) {
            bankData.branch_name = branchName;
          }
          // If swift code was blank but now filled, allow updating it
          if (!editingBank?.swift_code && swiftCode) {
            bankData.swift_code = swiftCode;
          }
        } else {
          bankData = {
            id: editingBank?.id,
            bank_name: name,
            account_name: accountName || null,
            account_number: accountNumber || null,
            branch_name: branchName || null,
            swift_code: swiftCode || null,
            is_visible: isVisible ? 1 : 0
          };
        }
        if (editingBank) {
          await updateBank(bankData, user.username);
        } else {
          await addBank({ cooperative_id: cooperativeId, ...bankData }, user.username);
        }
        editingBank = null; fc.innerHTML = '';
        loadBanks();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
  };

  const loadBanks = async () => {
    const tc = document.getElementById('bank-table-container');
    if (!tc) return;
    try {
      const banks = await fetchBanks(cooperativeId);
      // Filter out the auto-added "Internal Transfer" placeholder
      const realBanks = banks.filter(b => b.id !== 'internal' && b.id !== 'internal_transfer');

      if (realBanks.length === 0) {
        tc.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">No banks registered yet.</p>';
        return;
      }

      // Fetch banks currently in use by remittances
      const inUseRemittances = await queryRows('SELECT DISTINCT bank_name FROM remittance WHERE cooperative_id = ? AND is_deleted = 0', [cooperativeId]);
      const inUseRecon = await queryRows('SELECT DISTINCT bank_name FROM bank_reconciliation_summary WHERE cooperative_id = ? AND is_deleted = 0', [cooperativeId]);
      usedBankNames = new Set([
        ...inUseRemittances.map(r => r.bank_name),
        ...inUseRecon.map(r => r.bank_name)
      ]);

      tc.innerHTML = `
          <table class="crud-table">
            <thead><tr><th>#</th><th>Bank Name</th><th>Account Name</th><th>Account Number</th><th>Branch</th><th>SWIFT</th><th style="width: 120px;">Actions</th></tr></thead>
            <tbody>
              ${realBanks.map((b, i) => {
                const isInUse = usedBankNames.has(b.bank_name);
                return `
                    <tr>
                      <td>${i + 1}</td>
                      <td>${escapeHtml(b.bank_name)} ${isInUse ? '<span style="font-size: 0.7rem; color: var(--text-muted); font-style: italic; margin-left: 0.5rem;">(In Use)</span>' : ''}</td>
                      <td>${escapeHtml(b.account_name || '—')}</td>
                      <td>${escapeHtml(b.account_number || '—')}</td>
                      <td>${escapeHtml(b.branch_name || '—')}</td>
                      <td>${escapeHtml(b.swift_code || '—')}</td>
                      <td>
                        <button class="crud-action-btn edit" data-id="${b.id}" data-name="${escapeHtml(b.bank_name)}" data-in-use="${isInUse ? 'true' : 'false'}">Edit</button>
                        ${!isInUse ? `<button class="crud-action-btn delete" data-id="${b.id}" data-name="${escapeHtml(b.bank_name)}">Delete</button>` : ''}
                      </td>
                    </tr>
                  `;
              }).join('')}
            </tbody>
          </table>
        `;
      tc.querySelectorAll('.crud-action-btn.edit').forEach(btn => {
        const bank = realBanks.find(b => b.id === btn.dataset.id);
        btn.addEventListener('click', () => showBankForm(bank));
      });
      tc.querySelectorAll('.crud-action-btn.delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Delete bank "${btn.dataset.name}"? This cannot be undone.`)) return;
          try {
            await deleteBank(btn.dataset.id, cooperativeId, user.username);
            loadBanks();
          } catch (err) { showToast(err.message, 'error'); }
        });
      });
    } catch (err) {
      tc.innerHTML = `<p style="color: var(--danger);">Error loading banks: ${err.message}</p>`;
    }
  };

  document.getElementById('show-add-bank-btn')?.addEventListener('click', () => showBankForm());
  loadBanks();
}
