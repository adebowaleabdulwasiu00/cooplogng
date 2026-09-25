import { fetchBanks, addBank, updateBank, deleteBank } from '../../services/dataService.js';
import { showToast } from '../../services/toastService.js';
import { queryRows } from '../../services/sqliteService.js';
import { escapeHtml } from '../../utils/formatters.js';

export function renderBankSection(area) {
  area.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
        <div>
          <h3 style="margin:0;">Bank List</h3>
          <p class="section-desc" style="margin: 0.35rem 0 0 0;">Manage the list of banks and payment methods available for remittances.</p>
        </div>
        <button id="show-add-bank-btn" class="primary-button" style="padding: 0.6rem 1.5rem; font-size: 0.85rem; border-radius: var(--radius-md); width: ${window.innerWidth < 1000 ? '100%' : 'auto'};">+ Add Bank</button>
      </div>
      <div id="bank-table-container" class="table-responsive"><p style="color: var(--text-muted); font-style: italic;">Loading banks...</p></div>
    `;
}

export function setupBankListeners(user, cooperativeId) {
  let editingBank = null;
  let usedBankNames = new Set();

  const showBankForm = async (bank = null) => {
    editingBank = bank;
    // Check if bank is in use
    let isInUse = false;
    if (bank) {
      isInUse = usedBankNames.has(bank.bank_name);
    }

    const overlay = document.createElement('div');
    overlay.className = 'settings-modal-overlay';
    overlay.innerHTML = `
        <div class="settings-modal-content">
          <div class="modal-header">
            <div>
              <h3>${bank ? 'Edit Bank' : 'Add New Bank'}</h3>
              <p class="modal-sub">${bank ? `Update details for <strong>${escapeHtml(bank.bank_name || '')}</strong>.` : 'Add a bank account members can pay into.'}</p>
            </div>
            <button id="close-bank-modal-x" style="background:var(--bg-secondary); border:1px solid var(--border-light); color:var(--text-muted); font-size:1.1rem; cursor:pointer; width:32px; height:32px; border-radius:50%; flex-shrink:0; line-height:1;">&times;</button>
          </div>
          <div class="modal-body">
            ${isInUse ? '<div class="stg-notice muted" style="margin-bottom: 1.5rem;">This bank is in use in remittances. Only visibility and blank fields can be changed.</div>' : ''}
            <div class="stg-section">
              <div class="stg-section-title">Bank Identity</div>
              <div class="stg-grid">
                <div class="field">
                  <span>Bank Name *</span>
                  <input type="text" id="bank-name-input" value="${escapeHtml(bank?.bank_name || '')}" placeholder="e.g. First Bank" required ${isInUse && bank?.bank_name ? 'disabled' : ''}>
                </div>
                <div class="field">
                  <span>Branch Name</span>
                  <input type="text" id="bank-branch-name-input" value="${escapeHtml(bank?.branch_name || '')}" placeholder="e.g. Main Branch" ${isInUse && bank?.branch_name ? 'disabled' : ''}>
                </div>
              </div>
            </div>
            <div class="stg-section">
              <div class="stg-section-title">Account Details</div>
              <div class="stg-grid">
                <div class="field">
                  <span>Account Name</span>
                  <input type="text" id="bank-account-name-input" value="${escapeHtml(bank?.account_name || '')}" placeholder="e.g. Cooperative Savings" ${isInUse && bank?.account_name ? 'disabled' : ''}>
                </div>
                <div class="field">
                  <span>Account Number</span>
                  <input type="text" id="bank-account-number-input" value="${escapeHtml(bank?.account_number || '')}" placeholder="e.g. 0123456789" inputmode="numeric" ${isInUse && bank?.account_number ? 'disabled' : ''}>
                </div>
                <div class="field">
                  <span>SWIFT Code</span>
                  <input type="text" id="bank-swift-code-input" value="${escapeHtml(bank?.swift_code || '')}" placeholder="Optional" ${isInUse && bank?.swift_code ? 'disabled' : ''}>
                </div>
              </div>
            </div>
            <div class="stg-section">
              <div class="stg-section-title">Visibility</div>
              <label class="stg-check-card">
                <input type="checkbox" id="bank-visible-input" ${(bank?.is_visible ?? true) ? 'checked' : ''}>
                <div><div class="stg-check-title">Show on Dashboard</div><div class="stg-check-desc">Members will see this bank as a payment option.</div></div>
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button id="cancel-bank-btn" class="secondary-button" style="padding: 0.7rem 1.5rem; border-radius: var(--radius-md);">Cancel</button>
            <button id="save-bank-btn" class="primary-button" style="padding: 0.7rem 2rem; border-radius: var(--radius-md);">${bank ? 'Update Bank' : 'Add Bank'}</button>
          </div>
        </div>
      `;
    document.body.appendChild(overlay);

    const closeModal = () => { overlay.remove(); editingBank = null; };
    overlay.querySelector('#close-bank-modal-x').onclick = closeModal;
    overlay.querySelector('#cancel-bank-btn')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    overlay.querySelector('#save-bank-btn')?.addEventListener('click', async () => {
      const name = overlay.querySelector('#bank-name-input').value.trim();
      const accountName = overlay.querySelector('#bank-account-name-input').value.trim();
      const accountNumber = overlay.querySelector('#bank-account-number-input').value.trim();
      const branchName = overlay.querySelector('#bank-branch-name-input').value.trim();
      const swiftCode = overlay.querySelector('#bank-swift-code-input').value.trim();
      const isVisible = overlay.querySelector('#bank-visible-input')?.checked ?? true;
      if (!name) { showToast('Bank name is required.', 'warning'); return; }
      const saveBtn = overlay.querySelector('#save-bank-btn');
      try {
        saveBtn.disabled = true; saveBtn.innerText = 'Saving...';
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
          await updateBank(editingBank.id, bankData, user.username);
        } else {
          await addBank({ cooperative_id: cooperativeId, ...bankData }, user.username);
        }
        closeModal();
        loadBanks();
      } catch (err) { showToast('Error: ' + err.message, 'error'); saveBtn.disabled = false; saveBtn.innerText = editingBank ? 'Update Bank' : 'Add Bank'; }
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
