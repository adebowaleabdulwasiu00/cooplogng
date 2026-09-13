import { fetchCooperativeUsers, addUser, updateUser, deleteUser } from '../../services/dataService.js';
import { getAllPermissions } from '../../services/permissionService.js';
import { fetchEnterprises } from '../../services/dataService.js';
import { generateRandom6Digit, isSixDigitPin, escapeHtml } from '../../utils/formatters.js';
import { showToast } from '../../services/toastService.js';

export async function renderUserManagementSection(area) {
  area.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
        <div>
          <h3 style="margin:0;">User Management</h3>
          <p class="section-desc" style="margin: 0.35rem 0 0 0;">Manage staff access, permissions, and enterprise rights.</p>
        </div>
        <button id="show-add-user-btn" class="primary-button" style="padding: 0.6rem 1.5rem; font-size: 0.85rem; border-radius: var(--radius-md); width: ${window.innerWidth <= 768 ? '100%' : 'auto'};">+ Add User</button>
      </div>
      <div id="user-table-container" class="table-responsive" style="margin-top: 0;"><p style="color: var(--text-muted); font-style: italic;">Loading users...</p></div>
    `;
}

export async function setupUserManagementListeners(user, cooperativeId) {
  let editingUser = null;
  const allPerms = getAllPermissions();
  const ents = await fetchEnterprises(cooperativeId, true);

  // Selection States
  let selectedPermissions = [];
  let pendingPermissions = [];
  let selectedEnts = [];
  let pendingEnts = [];

  const renderMultiSelectDropdown = (type, dropdown, triggerText, items, currentSelection, onApply) => {
    let pending = [...currentSelection];
    const isAllSelected = () => {
      if (type === 'perms') return pending.includes('admin');
      if (type === 'ents') return pending.includes('all');
      return false;
    };

    const render = () => {
      dropdown.innerHTML = `
          <div style="font-size: 0.72rem; font-weight: 800; color: var(--accent-primary); margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">
            Select ${type === 'perms' ? 'Permissions' : 'Enterprises'}
          </div>
          <div style="margin-bottom: 0.75rem;">
            <input type="text" class="dropdown-search" placeholder="Search..."
              style="width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--border-medium); font-size: 0.85rem; background: var(--bg-input); color: var(--text-primary);">
          </div>
          <div class="items-list" style="max-height: 220px; overflow-y: auto; margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.15rem;">
            <label class="stg-field-option" data-key="${type === 'perms' ? 'admin' : 'all'}">
              <input type="checkbox" class="all-chk" ${isAllSelected() ? 'checked' : ''}>
              <span style="font-weight: 700;">${type === 'perms' ? '* ALL (Admin)' : '* ALL Enterprises'}</span>
            </label>
            ${items.map(item => `
              <label class="stg-field-option item-row" data-key="${item.id}" data-search="${item.label.toLowerCase()}">
                <input type="checkbox" class="item-chk" value="${item.id}" ${pending.includes(item.id) ? 'checked' : ''}>
                <span>${escapeHtml(item.label)}</span>
              </label>
            `).join('')}
          </div>
          <div style="display: flex; gap: 0.6rem;">
            <button type="button" class="primary-button apply-btn" style="flex: 1; padding: 0.55rem; font-size: 0.8rem; border-radius: 999px;">Apply</button>
            <button type="button" class="secondary-button cancel-btn" style="flex: 1; padding: 0.55rem; font-size: 0.8rem; border-radius: 999px; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-medium);">Cancel</button>
          </div>
        `;

      const searchInput = dropdown.querySelector('.dropdown-search');
      searchInput?.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        dropdown.querySelectorAll('.item-row').forEach(row => {
          const text = row.dataset.search || '';
          row.style.display = text.includes(val) ? 'flex' : 'none';
        });
      });

      dropdown.querySelector('.all-chk')?.addEventListener('change', (e) => {
        const key = type === 'perms' ? 'admin' : 'all';
        if (e.target.checked) {
          pending = [key, ...items.map(i => i.id)];
        } else {
          pending = [];
        }
        dropdown.querySelectorAll('.item-chk').forEach(cb => cb.checked = e.target.checked);
      });

      dropdown.querySelectorAll('.item-chk').forEach(cb => {
        cb.addEventListener('change', () => {
          const key = cb.value;
          if (cb.checked) {
            if (!pending.includes(key)) pending.push(key);
          } else {
            pending = pending.filter(k => k !== key);
            const allKey = type === 'perms' ? 'admin' : 'all';
            pending = pending.filter(k => k !== allKey);
            const allChk = dropdown.querySelector('.all-chk');
            if (allChk) allChk.checked = false;
          }
        });
      });

      dropdown.querySelector('.apply-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        onApply(pending);
        dropdown.classList.add('hidden');
        triggerText.textContent = pending.length > 0 ? `${pending.length} Selected` : 'Select...';
      });

      dropdown.querySelector('.cancel-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.add('hidden');
      });
    };
    render();
  };

  const showUserForm = (u = null) => {
    editingUser = u;
    const overlay = document.createElement('div');
    overlay.className = 'settings-modal-overlay';
    const userPermissions = u ? (Array.isArray(u.permissions) ? u.permissions : (u.permissions || '').split(',').map(p => p.trim())) : [];
    const userEntRights = u ? (u.enterprise_rights || u.enterprises || '').split(',').map(p => p.trim()) : [];

    selectedPermissions = [...userPermissions];
    selectedEnts = [...userEntRights];

    overlay.innerHTML = `
        <div class="settings-modal-content">
          <div class="modal-header">
            <div>
              <h3>${u ? 'Edit User' : 'Add New User'}</h3>
              <p class="modal-sub">${u ? `Update access and rights for <strong>${escapeHtml(u.username || '')}</strong>.` : 'Create staff login, assign a role and access rights.'}</p>
            </div>
            <button id="close-user-modal-x" style="background:var(--bg-secondary); border:1px solid var(--border-light); color:var(--text-muted); font-size:1.1rem; cursor:pointer; width:32px; height:32px; border-radius:50%; flex-shrink:0; line-height:1;">&times;</button>
          </div>
          <div class="modal-body">
            <div class="stg-section">
              <div class="stg-section-title">Account Details</div>
              <div class="stg-grid">
                <div class="stg-field">
                  <span>Username *</span>
                  <input type="text" id="user-username-input" value="${escapeHtml(u?.username || '')}" placeholder="e.g. jdoe" ${u ? 'readonly' : ''} required>
                  <div class="stg-helper">${u ? 'Username cannot be changed after creation.' : 'Staff will log in with this username.'}</div>
                </div>
                <div class="stg-field">
                  <span>Role</span>
                  <select id="user-role-input">
                    <option value="staff" ${u?.role === 'staff' ? 'selected' : ''}>Staff</option>
                    <option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Admin</option>
                  </select>
                  <div class="stg-helper">Admins bypass granular permission checks.</div>
                </div>
              </div>
            </div>
            ${u && (u.password_hash?.length < 6) ? `
              <div class="stg-notice warn" style="margin-bottom: 1.5rem;">
                <span>This user is on the default PIN: <strong>${escapeHtml(u.password_hash)}</strong>. Ask them to change it on next login.</span>
              </div>
            ` : ''}
            ${!u ? `
            <div class="stg-section">
              <div class="stg-section-title">Security</div>
              <div class="stg-field">
                <span>Initial 6-Digit PIN</span>
                <input type="password" id="user-password-input" placeholder="Leave blank for auto-generated PIN" inputmode="numeric" maxlength="6">
                <div class="stg-helper">Exactly 6 numbers, or leave blank to auto-generate one.</div>
              </div>
            </div>
            ` : ''}
            <div class="stg-section">
              <div class="stg-section-title">Access Control</div>
              <div style="display:flex; flex-direction:column; gap:1rem;">
                <div class="stg-field">
                  <span>Permissions</span>
                  <div style="position: relative;">
                    <button type="button" class="stg-dropdown-btn" id="perms-dropdown-trigger">
                      <span id="perms-trigger-text">${selectedPermissions.length > 0 ? `${selectedPermissions.length} Selected` : 'Select Permissions...'}</span>
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="perms-dropdown" class="stg-dropdown-menu hidden"></div>
                  </div>
                  <div class="stg-helper">Choose what this user can do. Select * ALL for full admin rights.</div>
                </div>
                <div class="stg-field">
                  <span>Enterprise Access</span>
                  <div style="position: relative;">
                    <button type="button" class="stg-dropdown-btn" id="ents-dropdown-trigger">
                      <span id="ents-trigger-text">${selectedEnts.length > 0 ? `${selectedEnts.length} Selected` : 'Select Enterprises...'}</span>
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="ents-dropdown" class="stg-dropdown-menu hidden"></div>
                  </div>
                  <div class="stg-helper">Limit which enterprise accounts this user can see and post to.</div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button id="cancel-user-btn" class="secondary-button" style="padding:0.7rem 1.5rem; border-radius:var(--radius-md);">Cancel</button>
            <button id="save-user-btn" class="primary-button" style="padding:0.7rem 2rem; border-radius:var(--radius-md);">${u ? 'Update User' : 'Create User'}</button>
          </div>
        </div>
      `;
    document.body.appendChild(overlay);

    // Initialize Dropdowns
    const permsDropdown = document.getElementById('perms-dropdown');
    const permsTrigger = document.getElementById('perms-dropdown-trigger');
    const permsTriggerText = document.getElementById('perms-trigger-text');

    permsTrigger.onclick = (e) => {
      e.stopPropagation();
      permsDropdown.classList.toggle('hidden');
      if (!permsDropdown.classList.contains('hidden')) {
        renderMultiSelectDropdown('perms', permsDropdown, permsTriggerText,
          allPerms.map(p => ({ id: p, label: p })),
          selectedPermissions,
          (newPerms) => { selectedPermissions = newPerms; });
      }
    };

    const entsDropdown = document.getElementById('ents-dropdown');
    const entsTrigger = document.getElementById('ents-dropdown-trigger');
    const entsTriggerText = document.getElementById('ents-trigger-text');

    entsTrigger.onclick = (e) => {
      e.stopPropagation();
      entsDropdown.classList.toggle('hidden');
      if (!entsDropdown.classList.contains('hidden')) {
        renderMultiSelectDropdown('ents', entsDropdown, entsTriggerText,
          ents.map(e => ({ id: e.id, label: e.account_name })),
          selectedEnts,
          (newEnts) => { selectedEnts = newEnts; });
      }
    };

    // Close on outside click (removed with the modal — anonymous per-open
    // handlers used to leak a document listener + full modal closure each time)
    const userModalOutside = (e) => {
      if (!permsTrigger.parentElement.contains(e.target)) permsDropdown.classList.add('hidden');
      if (!entsTrigger.parentElement.contains(e.target)) entsDropdown.classList.add('hidden');
    };
    document.addEventListener('click', userModalOutside);

    const closeModal = () => { document.removeEventListener('click', userModalOutside); overlay.remove(); editingUser = null; };
    overlay.querySelector('#close-user-modal-x').onclick = closeModal;
    overlay.querySelector('#cancel-user-btn').onclick = closeModal;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    overlay.querySelector('#save-user-btn')?.addEventListener('click', async () => {
      const usernameInput = overlay.querySelector('#user-username-input').value.trim();
      const role = overlay.querySelector('#user-role-input').value;
      const permissions = selectedPermissions.join(',');
      const enterprise_rights = selectedEnts.join(',');

      if (!usernameInput) { showToast('Username is required.', 'warning'); return; }
      const payload = { username: usernameInput, role, permissions, enterprise_rights, cooperative_id: cooperativeId };

      try {
        const btn = overlay.querySelector('#save-user-btn');
        btn.disabled = true; btn.innerText = 'Saving...';
        if (editingUser) {
          await updateUser(editingUser.id, payload, user.username);
        } else {
          const pwd = (overlay.querySelector('#user-password-input')?.value || '').trim();
          if (pwd && !isSixDigitPin(pwd)) {
            showToast('Initial PIN must be exactly 6 digits (numbers only) — or leave blank for random.', 'warning');
            btn.disabled = false; btn.innerText = 'Create User';
            return;
          }
          if (pwd) payload.password_hash = pwd;
          const res = await addUser(payload, user.username);
          if (res.generatedPassword) showToast(`User created! Initial password: ${res.generatedPassword}`, 'success');
        }
        closeModal();
        loadUsers();
      } catch (err) { showToast('Error: ' + err.message, 'error'); btn.disabled = false; btn.innerText = editingUser ? 'Update User' : 'Create User'; }
    });
  };

  const loadUsers = async () => {
    const tc = document.getElementById('user-table-container');
    if (!tc) return;
    try {
      let usersList = await fetchCooperativeUsers(cooperativeId);
      if (usersList.length === 0) {
        tc.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">No additional users found.</p>';
        return;
      }

      // Sort by username, admin always on top
      usersList.sort((a, b) => {
        const u1 = (a.username || '').toLowerCase();
        const u2 = (b.username || '').toLowerCase();
        if (u1 === 'admin') return -1;
        if (u2 === 'admin') return 1;
        return u1.localeCompare(u2);
      });

      const getEntDisplay = (rights) => {
        if (!rights || rights === 'None') return 'None';
        if (rights === 'all') return '<strong>All Enterprises</strong>';
        return rights.split(',').map(id => {
          const ent = ents.find(e => e.id === id.trim());
          return ent ? escapeHtml(ent.account_name) : id;
        }).join(', ');
      };
      tc.innerHTML = `
          <table class="crud-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Enterprise Access</th>
                <th style="width: 160px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${usersList.map(u => `
                <tr>
                  <td><code>${escapeHtml(u.username)}</code></td>
                  <td><span style="text-transform: capitalize; padding: 0.2rem 0.5rem; background: var(--bg-secondary); border-radius: 4px; font-size: 0.75rem; color: var(--text-primary);">${u.role || 'staff'}</span></td>
                  <td style="max-width: 300px; white-space: normal; word-break: break-word; line-height: 1.4;">
                    <small style="color: var(--text-muted);">${getEntDisplay(u.enterprise_rights || u.enterprises)}</small>
                  </td>
                  <td>
                    <button class="crud-action-btn edit" data-id="${u.id}" title="Edit"><svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                    <button class="crud-action-btn reset-pwd" data-id="${u.id}" data-name="${escapeHtml(u.username)}" title="Reset Pwd" style="color: var(--accent-primary);"><svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg></button>
                    <button class="crud-action-btn delete" data-id="${u.id}" data-name="${escapeHtml(u.username)}" title="Delete"><svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2.5 2.5 0 0116.138 21H7.862a2.5 2.5 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      tc.querySelectorAll('.crud-action-btn.edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const u = usersList.find(x => x.id === btn.dataset.id);
          if (u) showUserForm(u);
        });
      });
      tc.querySelectorAll('.crud-action-btn.reset-pwd').forEach(btn => {
        btn.addEventListener('click', async () => {
          const newPwd = generateRandom6Digit();
          if (confirm(`Reset PIN for "${btn.dataset.name}" to a new random 6-digit number?`)) {
            try {
              const u = usersList.find(x => x.id === btn.dataset.id);
              await updateUser(btn.dataset.id, { ...u, password_hash: newPwd, force_password_change: true }, user.username);
              showToast(`PIN reset to: ${newPwd}\nUser will set a new PIN on next login.`, 'success');
              loadUsers();
            } catch (err) { showToast(err.message, 'error'); }
          }
        });
      });
      tc.querySelectorAll('.crud-action-btn.delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (btn.dataset.name === user.username) { showToast("You cannot delete yourself!", 'warning'); return; }
          if (confirm(`Delete user "${btn.dataset.name}"?`)) {
            await deleteUser(btn.dataset.id, user.username, user.cooperativeId);
            loadUsers();
          }
        });
      });
    } catch (err) { tc.innerHTML = `<p style="color: var(--danger);">Error: ${err.message}</p>`; }
  };

  document.getElementById('show-add-user-btn')?.addEventListener('click', () => showUserForm());
  loadUsers();
}
