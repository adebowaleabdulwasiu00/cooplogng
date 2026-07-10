import { fetchEnterprises, addEnterprise, updateEnterprise, deleteEnterprise } from '../../services/dataService.js';
import { showToast } from '../../services/toastService.js';
import { queryRows } from '../../services/sqliteService.js';
import { escapeHtml } from '../../utils/formatters.js';

export function renderEnterpriseSection(area) {
  area.innerHTML = `
      <h3>Enterprise Accounts</h3>
      <p class="section-desc">Configure the enterprise accounts used in remittance distribution.</p>
      <div id="ent-form-container"></div>
      <div style="margin-bottom: 1rem; text-align: right;">
        <button id="show-add-ent-btn" class="primary-button" style="padding: 0.5rem 1.25rem; font-size: 0.85rem; width: ${window.innerWidth <= 768 ? '100%' : 'auto'};">+ Add Account</button>
      </div>
      <div id="ent-table-container" class="table-responsive"><p style="color: var(--text-muted); font-style: italic;">Loading enterprise accounts...</p></div>
    `;
}

export function setupEnterpriseListeners(user, cooperativeId) {
  let editingEnt = null;

  const showEntForm = (ent = null) => {
    editingEnt = ent;
    const overlay = document.createElement('div');
    overlay.className = 'settings-modal-overlay';
    overlay.innerHTML = `
        <div class="settings-modal-content">
          <div class="modal-header">
            <h3 style="margin:0;">${ent ? 'Edit Enterprise Account' : 'Add Enterprise Account'}</h3>
            <button id="close-modal-x" style="background:transparent; border:none; color:var(--text-muted); font-size:1.5rem; cursor:pointer;">&times;</button>
          </div>
          <div class="modal-body">
            <div class="inline-form" style="display:flex; flex-direction:column; gap:1.25rem;">
                <div class="field">
                  <label>📝 Account Name *</label>
                  <input type="text" id="ent-name-input" value="${escapeHtml(ent?.account_name || '')}" placeholder="e.g. Savings Account" required>
                </div>
                <div class="field">
                  <label>🏷️ Account Type *</label>
                  <select id="ent-type-input">
                    <option value="Savings" ${(ent?.account_type || '') === 'Savings' ? 'selected' : ''}>Savings</option>
                    <option value="Loan" ${(ent?.account_type || '') === 'Loan' ? 'selected' : ''}>Loan</option>
                  </select>
                </div>
                <div class="field">
                  <label>📈 Interest Rate</label>
                  <div class="input-with-toggle">
                    <input type="number" step="0.01" id="ent-interest-input" value="${ent?.interest_rate ?? 0}" min="0">
                    <label class="input-toggle-wrap">
                      <input type="checkbox" id="ent-interest-percent" ${ent?.interest_is_percent ? 'checked' : ''}> %
                    </label>
                  </div>
                </div>
                <div class="field">
                  <label>✖️ Loan Multiplier</label>
                  <input type="number" step="0.01" id="ent-multiplier-input" value="${ent?.loan_multiplier ?? 0}" min="0">
                </div>
                <div class="field">
                  <label>📑 Form Fee</label>
                  <div class="input-with-toggle">
                    <input type="number" step="0.01" id="ent-formfee-input" value="${ent?.form_fee ?? 0}" min="0">
                    <label class="input-toggle-wrap">
                      <input type="checkbox" id="ent-formfee-percent" ${ent?.form_fee_is_percent ? 'checked' : ''}> %
                    </label>
                  </div>
                </div>
                <div class="field">
                  <label>🛡️ Admin Charge</label>
                  <div class="input-with-toggle">
                    <input type="number" step="0.01" id="ent-admin-input" value="${ent?.admin_charge ?? 0}" min="0">
                    <label class="input-toggle-wrap">
                      <input type="checkbox" id="ent-admin-percent" ${ent?.admin_charge_is_percent ? 'checked' : ''}> %
                    </label>
                  </div>
                </div>
                <div class="field">
                  <label>🔢 Distribution Priority</label>
                  <input type="number" id="ent-priority-input" value="${ent?.distribution_priority ?? 0}" min="0">
                </div>
                <div class="field">
                  <label>⚠️ Compulsory Due</label>
                  <div style="display:flex; align-items:center; gap:0.5rem;">
                    <input type="checkbox" id="ent-compulsory-due" ${ent?.compulsory_due ? 'checked' : ''}>
                    <span style="color:var(--text-muted);">This is a compulsory due account</span>
                  </div>
                </div>
                <div class="field">
                  <label>💰 Compulsory Amount</label>
                  <input type="number" step="0.01" id="ent-compulsory-amount" value="${ent?.compulsory_amount ?? 0.00}" min="0">
                </div>
                <div class="field">
                  <label>📊 Revenue</label>
                  <div style="display:flex; align-items:center; gap:0.5rem;">
                    <input type="checkbox" id="ent-revenue" ${ent?.revenue ? 'checked' : ''}>
                    <span style="color:var(--text-muted);">Classify as Revenue</span>
                  </div>
                </div>
                <div class="field">
                  <label>🚫 Is Penalty</label>
                  <div style="display:flex; align-items:center; gap:0.5rem;">
                    <input type="checkbox" id="ent-is-penalty" ${ent?.is_penalty ? 'checked' : ''}>
                    <span style="color:var(--text-muted);">This is a penalty account</span>
                  </div>
                </div>
            </div>
          </div>
          <div class="modal-footer">
            <button id="cancel-ent-btn" class="secondary-button" style="padding:0.6rem 1.2rem;">Cancel</button>
            <button id="save-ent-btn" class="primary-button" style="padding:0.6rem 2rem;">${ent ? 'Update' : 'Add'}</button>
          </div>
        </div>
      `;
    document.body.appendChild(overlay);

    const closeModal = () => { overlay.remove(); editingEnt = null; };
    document.getElementById('close-modal-x').onclick = closeModal;
    document.getElementById('cancel-ent-btn').onclick = closeModal;

    document.getElementById('save-ent-btn').addEventListener('click', async () => {
      const name = document.getElementById('ent-name-input').value.trim();
      const type = document.getElementById('ent-type-input').value;
      if (!name || !type) { showToast('Account Name and Type are required.', 'warning'); return; }
      const payload = {
        account_name: name,
        account_type: type,
        interest_rate: parseFloat(document.getElementById('ent-interest-input').value || 0),
        interest_is_percent: document.getElementById('ent-interest-percent').checked ? 1 : 0,
        loan_multiplier: parseFloat(document.getElementById('ent-multiplier-input').value || 0),
        form_fee: parseFloat(document.getElementById('ent-formfee-input').value || 0),
        form_fee_is_percent: document.getElementById('ent-formfee-percent').checked ? 1 : 0,
        admin_charge: parseFloat(document.getElementById('ent-admin-input').value || 0),
        admin_charge_is_percent: document.getElementById('ent-admin-percent').checked ? 1 : 0,
        distribution_priority: parseInt(document.getElementById('ent-priority-input').value || 0),
        compulsory_due: document.getElementById('ent-compulsory-due').checked ? 1 : 0,
        compulsory_amount: parseFloat(document.getElementById('ent-compulsory-amount').value || 0),
        revenue: document.getElementById('ent-revenue').checked ? 1 : 0,
        is_penalty: document.getElementById('ent-is-penalty').checked ? 1 : 0,
        cooperative_id: cooperativeId
      };
      const saveBtn = document.getElementById('save-ent-btn');
      if (!saveBtn) return;
      try {
        saveBtn.disabled = true; saveBtn.innerText = 'Saving...';
        if (editingEnt) {
          await updateEnterprise(editingEnt.id, payload, user.username);
        } else {
          await addEnterprise(payload, user.username);
        }
        closeModal();
        loadEnterprises();
      } catch (err) { showToast('Error: ' + err.message, 'error'); saveBtn.disabled = false; saveBtn.innerText = editingEnt ? 'Update' : 'Add'; }
    });
  };

  const fmtRate = (val, isPercent) => {
    if (val === undefined || val === null || val === '' || val === 0) return '—';
    return isPercent ? `${parseFloat(val).toFixed(2)}%` : `₦${parseFloat(val).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
  };

  const loadEnterprises = async () => {
    const tc = document.getElementById('ent-table-container');
    if (!tc) return;
    try {
      const ents = await fetchEnterprises(cooperativeId, true);
      const active = ents.filter(e => !e.is_deleted || e.is_deleted === 0);
      if (active.length === 0) {
        tc.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">No enterprise accounts registered yet.</p>';
        return;
      }
      // Sort by priority
      active.sort((a, b) => (a.distribution_priority || 0) - (b.distribution_priority || 0));
      // Fetch enterprises currently in use by remittance details
      const inUseDetails = await queryRows('SELECT DISTINCT enterprise_id FROM remittance_detail WHERE cooperative_id = ? AND is_deleted = 0 AND amount != 0', [cooperativeId]);
      const usedEntIds = new Set(inUseDetails.map(d => d.enterprise_id));

      tc.innerHTML = `
          <div style="overflow-x: auto;">
          <table class="crud-table">
            <thead><tr>
              <th>Priority</th><th>Account Name</th><th>Type</th><th>Interest</th><th>Form Fee</th><th>Admin Charge</th><th style="width: 120px;">Actions</th>
            </tr></thead>
            <tbody>
              ${active.map(e => {
                const isInUse = usedEntIds.has(e.id);
                return `
                    <tr>
                      <td>${e.distribution_priority || 0}</td>
                      <td style="font-weight: 600;">${escapeHtml(e.account_name || e.id)} ${isInUse ? '<span style="font-size: 0.7rem; color: var(--text-muted); font-style: italic; margin-left: 0.5rem;">(In Use)</span>' : ''}</td>
                      <td><span style="padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; background: ${(e.account_type || '').toLowerCase() === 'loan' ? 'var(--warning-bg)' : 'var(--success-bg)'}; color: ${(e.account_type || '').toLowerCase() === 'loan' ? 'var(--warning)' : 'var(--success)'};">${e.account_type || '—'}</span></td>
                      <td>${fmtRate(e.interest_rate, e.interest_is_percent)}</td>
                      <td>${fmtRate(e.form_fee, e.form_fee_is_percent)}</td>
                      <td>${fmtRate(e.admin_charge, e.admin_charge_is_percent)}</td>
                      <td>
                        <button class="crud-action-btn edit" data-id="${e.id}">Edit</button>
                        ${!isInUse ? `
                            <button class="crud-action-btn delete" data-id="${e.id}" data-name="${escapeHtml(e.account_name || e.id)}">Delete</button>
                          ` : '<span style="font-size: 0.75rem; color: var(--text-muted); font-style:italic;">Delete Locked</span>'}
                      </td>
                    </tr>
                  `;
              }).join('')}
            </tbody>
          </table>
          </div>
        `;
      tc.querySelectorAll('.crud-action-btn.edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const ent = active.find(e => e.id === btn.dataset.id);
          if (ent) showEntForm(ent);
        });
      });
      tc.querySelectorAll('.crud-action-btn.delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Delete enterprise "${btn.dataset.name}"? This cannot be undone.`)) return;
          try {
            await deleteEnterprise(btn.dataset.id, cooperativeId, user.username);
            loadEnterprises();
          } catch (err) { showToast(err.message, 'error'); }
        });
      });
    } catch (err) {
      tc.innerHTML = `<p style="color: var(--danger);">Error loading accounts: ${err.message}</p>`;
    }
  };

  document.getElementById('show-add-ent-btn')?.addEventListener('click', () => showEntForm());
  loadEnterprises();
}
