import { fetchCooperativeUsers } from '../../services/dataService.js';
import { queryRows, queryOne, initDb, saveDoc, enqueueWrite, getDocById_Global } from '../../services/sqliteService.js';
import { showToast } from '../../services/toastService.js';
import { escapeHtml, formatDate } from '../../utils/formatters.js';

export function renderSubscriptionSection(area) {
  area.innerHTML = `
    <h3>Subscription Management</h3>
    <p class="section-desc">Manage user subscriptions and access for this cooperative.</p>
    <div id="subscription-stats" style="margin-bottom: 1.5rem;">
      <p style="color: var(--text-muted); font-style: italic;">Loading statistics...</p>
    </div>
    <div id="subscription-table-container" class="table-responsive">
      <p style="color: var(--text-muted); font-style: italic;">Loading users...</p>
    </div>
  `;
}

export function setupSubscriptionListeners(user, cooperativeId) {
  const isAdmin = user.isAdmin || user.username === 'admin';
  if (!isAdmin) {
    document.getElementById('subscription-stats').innerHTML =
      '<p style="color: var(--danger);">Access restricted to administrators only.</p>';
    return;
  }

  const loadData = async () => {
    await renderStats(cooperativeId);
    await renderUsersTable(cooperativeId, user);
  };

  loadData();
}

async function renderStats(cooperativeId) {
  const container = document.getElementById('subscription-stats');
  const users = await queryRows('SELECT * FROM users WHERE cooperative_id = ? AND is_deleted = 0', [String(cooperativeId)]);
  const now = new Date().toISOString();

  let active = 0, expired = 0, inactive = 0;
  for (const u of users) {
    if (u.subscriptionStatus === 1 || u.subscriptionStatus === '1') {
      if (u.expiry_date && u.expiry_date >= now) active++;
      else expired++;
    } else {
      inactive++;
    }
  }

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem;">
      <div class="dashboard-stat-card blue" style="padding: 1rem; border: 1px solid var(--border-light); border-radius: 0.75rem; background: var(--bg-card);">
        <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Total Users</div>
        <div style="font-size: 1.5rem; font-weight: 800; color: var(--text-primary); margin-top: 0.25rem;">${users.length}</div>
      </div>
      <div class="dashboard-stat-card blue" style="padding: 1rem; border: 1px solid var(--border-light); border-radius: 0.75rem; background: var(--bg-card);">
        <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Active</div>
        <div style="font-size: 1.5rem; font-weight: 800; color: var(--success); margin-top: 0.25rem;">${active}</div>
      </div>
      <div class="dashboard-stat-card blue" style="padding: 1rem; border: 1px solid var(--border-light); border-radius: 0.75rem; background: var(--bg-card);">
        <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Expired</div>
        <div style="font-size: 1.5rem; font-weight: 800; color: var(--warning); margin-top: 0.25rem;">${expired}</div>
      </div>
      <div class="dashboard-stat-card blue" style="padding: 1rem; border: 1px solid var(--border-light); border-radius: 0.75rem; background: var(--bg-card);">
        <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Inactive</div>
        <div style="font-size: 1.5rem; font-weight: 800; color: var(--danger); margin-top: 0.25rem;">${inactive}</div>
      </div>
    </div>
  `;
}

async function renderUsersTable(cooperativeId, user) {
  const container = document.getElementById('subscription-table-container');
  const users = await queryRows('SELECT * FROM users WHERE cooperative_id = ? AND is_deleted = 0', [String(cooperativeId)]);
  const now = new Date().toISOString();

  const getStatusLabel = (u) => {
    if (u.username === 'admin') return '<span style="color: var(--accent-primary); font-weight: 700;">Admin</span>';
    if (u.subscriptionStatus === 1 || u.subscriptionStatus === '1') {
      if (u.expiry_date && u.expiry_date >= now) return '<span style="color: var(--success); font-weight: 600;">Active</span>';
      return '<span style="color: var(--warning); font-weight: 600;">Expired</span>';
    }
    return '<span style="color: var(--danger); font-weight: 600;">Inactive</span>';
  };

  const getExpiryDisplay = (u) => {
    if (u.username === 'admin') return '—';
    if (u.expiry_date) return formatDate(u.expiry_date);
    return '—';
  };

  container.innerHTML = `
    <div style="margin-bottom: 1rem;">
      <input type="text" id="sub-search-input" placeholder="Search by username or role..." 
        style="width: 100%; max-width: 300px; padding: 0.5rem; border-radius: 6px; border: 1px solid var(--border-medium); font-size: 0.85rem; background: var(--bg-input); color: var(--text-primary);">
    </div>
    <table class="crud-table" style="width: 100%;">
      <thead>
        <tr>
          <th>Username</th>
          <th>Role</th>
          <th>Status</th>
          <th>Expiry Date</th>
          <th style="width: 180px;">Actions</th>
        </tr>
      </thead>
      <tbody id="sub-table-body">
        ${users.map(u => {
          const isAdminUser = u.username === 'admin';
          return `
            <tr class="sub-row" data-username="${escapeHtml(u.username).toLowerCase()}">
              <td><strong>${escapeHtml(u.username)}</strong></td>
              <td>${escapeHtml(u.role || '—')}</td>
              <td>${getStatusLabel(u)}</td>
              <td style="font-size: 0.85rem; color: var(--text-muted);">${getExpiryDisplay(u)}</td>
              <td>
                ${isAdminUser ? '<span style="color: var(--text-muted); font-size: 0.8rem;">Not applicable</span>' : `
                  <button class="primary-button sub-activate-btn" data-id="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}" style="padding: 0.3rem 0.75rem; font-size: 0.75rem; margin-right: 0.4rem;">Activate</button>
                  <button class="secondary-button sub-deactivate-btn" data-id="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}" style="padding: 0.3rem 0.75rem; font-size: 0.75rem; border-color: var(--danger); color: var(--danger);">Deactivate</button>
                `}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  const generateExpectedKey = () => {
    const today = new Date();
    const yy = String(today.getFullYear()).slice(-2);
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    return `${yy}${dd}${mm}`;
  };

  const showActivationDialog = (userId, username) => {
    const overlay = document.createElement('div');
    overlay.className = 'settings-modal-overlay';
    overlay.innerHTML = `
      <div class="settings-modal-content" style="max-width: 420px;">
        <div class="modal-header">
          <h3 style="margin:0;">Activate User</h3>
          <button class="close-modal-x" style="background:transparent; border:none; color:var(--text-muted); font-size:1.5rem; cursor:pointer;">&times;</button>
        </div>
        <div class="modal-body">
          <p style="margin-bottom: 1rem; font-size: 0.9rem;">Activate subscription for <strong>${escapeHtml(username)}</strong>?</p>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem;">Enter the activation key (YYDDMM format) to proceed.</p>
          <input type="text" id="activation-key-input" placeholder="Enter activation key" 
            style="width: 100%; padding: 0.5rem; border-radius: 6px; border: 1px solid var(--border-medium); font-size: 1rem; text-align: center; letter-spacing: 0.2em; background: var(--bg-input); color: var(--text-primary); margin-bottom: 1rem;">
          <div id="activation-key-error" style="color: var(--danger); font-size: 0.8rem; margin-bottom: 0.5rem; display: none;"></div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="secondary-button close-modal-x" style="flex: 1;">Cancel</button>
            <button class="primary-button" id="confirm-activate-btn" style="flex: 1;">Activate</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    overlay.querySelectorAll('.close-modal-x').forEach(el => el.onclick = closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    document.getElementById('confirm-activate-btn').onclick = async () => {
      const key = document.getElementById('activation-key-input').value.trim();
      const expected = generateExpectedKey();
      const errorEl = document.getElementById('activation-key-error');

      if (key !== expected) {
        errorEl.textContent = 'Invalid activation key. Please try again.';
        errorEl.style.display = 'block';
        return;
      }

      try {
        const btn = document.getElementById('confirm-activate-btn');
        btn.disabled = true;
        btn.textContent = 'Activating...';

        const existing = await getDocById_Global('users', userId);
        if (!existing) throw new Error('User not found');

        const now = new Date().toISOString();
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);

        await saveDoc('users', {
          ...existing,
          subscriptionStatus: 1,
          expiry_date: expiryDate.toISOString(),
          modified_at: now,
          modified_by: user.username,
          is_synced: 0
        });

        await enqueueWrite(cooperativeId, 'users', userId, 'update', {
          subscriptionStatus: 1,
          expiry_date: expiryDate.toISOString(),
          modified_at: now,
          modified_by: user.username
        });

        showToast(`Subscription activated for ${username} until ${formatDate(expiryDate)}`, 'success');
        closeModal();
        renderUsersTable(cooperativeId, user);
        renderStats(cooperativeId);
      } catch (err) {
        showToast('Activation failed: ' + err.message, 'error');
        document.getElementById('confirm-activate-btn').disabled = false;
        document.getElementById('confirm-activate-btn').textContent = 'Activate';
      }
    };
  };

  const showDeactivationDialog = (userId, username) => {
    const overlay = document.createElement('div');
    overlay.className = 'settings-modal-overlay';
    overlay.innerHTML = `
      <div class="settings-modal-content" style="max-width: 400px;">
        <div class="modal-header">
          <h3 style="margin:0; color: var(--danger);">Deactivate User</h3>
          <button class="close-modal-x" style="background:transparent; border:none; color:var(--text-muted); font-size:1.5rem; cursor:pointer;">&times;</button>
        </div>
        <div class="modal-body">
          <p style="margin-bottom: 1rem; font-size: 0.9rem;">Are you sure you want to deactivate <strong>${escapeHtml(username)}</strong>?</p>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1.5rem;">The user will lose access to the application after deactivation.</p>
          <div style="display: flex; gap: 0.5rem;">
            <button class="secondary-button close-modal-x" style="flex: 1;">Cancel</button>
            <button class="primary-button" id="confirm-deactivate-btn" style="flex: 1; background: var(--danger); border-color: var(--danger);">Deactivate</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    overlay.querySelectorAll('.close-modal-x').forEach(el => el.onclick = closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    document.getElementById('confirm-deactivate-btn').onclick = async () => {
      try {
        const btn = document.getElementById('confirm-deactivate-btn');
        btn.disabled = true;
        btn.textContent = 'Deactivating...';

        const existing = await getDocById_Global('users', userId);
        if (!existing) throw new Error('User not found');

        const now = new Date().toISOString();

        await saveDoc('users', {
          ...existing,
          subscriptionStatus: 0,
          expiry_date: null,
          modified_at: now,
          modified_by: user.username,
          is_synced: 0
        });

        await enqueueWrite(cooperativeId, 'users', userId, 'update', {
          subscriptionStatus: 0,
          expiry_date: null,
          modified_at: now,
          modified_by: user.username
        });

        showToast(`Subscription deactivated for ${username}`, 'info');
        closeModal();
        renderUsersTable(cooperativeId, user);
        renderStats(cooperativeId);
      } catch (err) {
        showToast('Deactivation failed: ' + err.message, 'error');
        document.getElementById('confirm-deactivate-btn').disabled = false;
        document.getElementById('confirm-deactivate-btn').textContent = 'Deactivate';
      }
    };
  };

  container.querySelectorAll('.sub-activate-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showActivationDialog(btn.dataset.id, btn.dataset.username);
    });
  });

  container.querySelectorAll('.sub-deactivate-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showDeactivationDialog(btn.dataset.id, btn.dataset.username);
    });
  });

  const searchInput = document.getElementById('sub-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      container.querySelectorAll('.sub-row').forEach(row => {
        const uname = row.dataset.username || '';
        row.style.display = term === '' || uname.includes(term) ? '' : 'none';
      });
    });
  }
}
