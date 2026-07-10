import { changePassword } from '../../services/dataService.js';
import { showToast } from '../../services/toastService.js';

export function renderPasswordSection(area) {
  area.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; max-width: 400px;">
        <div>
          <h3>Change Password</h3>
          <p class="section-desc">Update your login credentials.</p>
        </div>
        <button type="button" class="ghost-button" id="clear-pwd-btn" style="color: var(--danger); border: 1px solid var(--danger-bg); padding: 0.25rem 0.5rem; font-size: 0.8rem;">🗑 Clear</button>
      </div>
      <form id="password-form" style="display: flex; flex-direction: column; gap: 1.25rem; max-width: 400px;">
        <div class="field"><label>Current Password</label><input type="password" id="old_password" name="old_password" placeholder="••••••••" required></div>
        <div class="field"><label>New Password</label><input type="password" id="new_password" name="new_password" placeholder="••••••••" required></div>
        <div class="field"><label>Confirm New Password</label><input type="password" id="confirm_password" name="confirm_password" placeholder="••••••••" required></div>
        <button type="submit" class="primary-button" style="width: 100%; margin-top: 0.5rem;">Update Password</button>
      </form>
    `;
}

export function setupPasswordListeners(user) {
  const form = document.getElementById('password-form');
  if (!form) return;

  // Persistence
  const draftKey = 'cooplog-pwd-draft';
  const saveDraft = () => {
    const draft = {
      old_password: form.old_password.value,
      new_password: form.new_password.value,
      confirm_password: form.confirm_password.value
    };
    sessionStorage.setItem(draftKey, JSON.stringify(draft));
  };
  try {
    const raw = sessionStorage.getItem(draftKey);
    if (raw) {
      const d = JSON.parse(raw);
      form.old_password.value = d.old_password || '';
      form.new_password.value = d.new_password || '';
      form.confirm_password.value = d.confirm_password || '';
    }
  } catch (e) { }

  form.addEventListener('input', saveDraft);

  document.getElementById('clear-pwd-btn')?.addEventListener('click', () => {
    sessionStorage.removeItem(draftKey);
    form.reset();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const oldPwd = fd.get('old_password'), newPwd = fd.get('new_password'), confirmPwd = fd.get('confirm_password');
    if (newPwd !== confirmPwd) { showToast('New passwords do not match!', 'warning'); return; }
    try {
      const btn = form.querySelector('button'); btn.disabled = true; btn.innerText = 'Updating...';
      await changePassword(user, oldPwd, newPwd);
      showToast('Password updated successfully!', 'success'); form.reset(); sessionStorage.removeItem(draftKey);
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
    finally { const btn = form.querySelector('button'); btn.disabled = false; btn.innerText = 'Update Password'; }
  });
}
