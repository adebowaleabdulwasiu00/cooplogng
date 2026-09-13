import { changePassword } from '../../services/dataService.js';
import { showToast } from '../../services/toastService.js';

export function renderPasswordSection(area) {
  area.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; max-width: 400px;">
        <div>
          <h3>Change Password</h3>
          <p class="section-desc">Update your 6-digit PIN.</p>
        </div>
        <button type="button" class="ghost-button" id="clear-pwd-btn" style="color: var(--danger); border: 1px solid var(--danger-bg); padding: 0.25rem 0.5rem; font-size: 0.8rem;">🗑 Clear</button>
      </div>
      <form id="password-form" style="display: flex; flex-direction: column; gap: 1.25rem; max-width: 400px;">
        <div class="field"><label>Current 6-Digit PIN</label>
          <div class="pin-wrap" style="display: flex; gap: 0.5rem; justify-content: center;">
            ${[0,1,2,3,4,5].map(i => `
              <input
                type="text"
                name="old_pin-${i}"
                maxlength="1"
                pattern="[0-9]"
                inputmode="numeric"
                style="width: 3rem; height: 3rem; font-size: 1.5rem; text-align: center; border: 2px solid var(--border-medium); border-radius: 0.5rem; background: var(--bg-primary); color: var(--text-primary);"
                aria-label="Current PIN digit ${i+1}"
              />
            `).join('')}
          </div>
          <button type="button" id="legacy-toggle-btn" class="ghost-button" style="margin-top: 0.5rem; font-size: 0.8rem;">My current password contains letters/symbols (legacy)</button>
          <div id="legacy-current-wrap" class="hidden" style="margin-top: 0.75rem;">
            <input type="password" id="old-legacy-input" placeholder="Enter legacy password (e.g. Adex@1234)" autocomplete="current-password"
              style="width: 100%; padding: 0.75rem; border: 2px solid var(--border-medium); border-radius: 0.5rem; background: var(--bg-primary); color: var(--text-primary);" />
          </div>
        </div>
        <div class="field"><label>New 6-Digit PIN</label>
          <div class="pin-wrap" style="display: flex; gap: 0.5rem; justify-content: center;">
            ${[0,1,2,3,4,5].map(i => `
              <input
                type="text"
                name="new_pin-${i}"
                maxlength="1"
                pattern="[0-9]"
                inputmode="numeric"
                style="width: 3rem; height: 3rem; font-size: 1.5rem; text-align: center; border: 2px solid var(--border-medium); border-radius: 0.5rem; background: var(--bg-primary); color: var(--text-primary);"
                aria-label="New PIN digit ${i+1}"
              />
            `).join('')}
          </div>
        </div>
        <div class="field"><label>Confirm New 6-Digit PIN</label>
          <div class="pin-wrap" style="display: flex; gap: 0.5rem; justify-content: center;">
            ${[0,1,2,3,4,5].map(i => `
              <input
                type="text"
                name="confirm_pin-${i}"
                maxlength="1"
                pattern="[0-9]"
                inputmode="numeric"
                style="width: 3rem; height: 3rem; font-size: 1.5rem; text-align: center; border: 2px solid var(--border-medium); border-radius: 0.5rem; background: var(--bg-primary); color: var(--text-primary);"
                aria-label="Confirm PIN digit ${i+1}"
              />
            `).join('')}
          </div>
        </div>
        <button type="submit" class="primary-button" style="width: 100%; margin-top: 0.5rem;" disabled>Update PIN</button>
      </form>
    `;
}

export function setupPasswordListeners(user) {
  const form = document.getElementById('password-form');
  if (!form) return;

  const oldPinInputs = Array.from({length: 6}, (_, i) => form.querySelector(`input[name="old_pin-${i}"]`));
  const newPinInputs = Array.from({length: 6}, (_, i) => form.querySelector(`input[name="new_pin-${i}"]`));
  const confirmPinInputs = Array.from({length: 6}, (_, i) => form.querySelector(`input[name="confirm_pin-${i}"]`));
  const submitBtn = form.querySelector('button[type="submit"]');
  const legacyWrap = form.querySelector('#legacy-current-wrap');
  const legacyInput = form.querySelector('#old-legacy-input');
  const legacyToggle = form.querySelector('#legacy-toggle-btn');
  let useLegacyCurrent = false;

  legacyToggle?.addEventListener('click', () => {
    useLegacyCurrent = !useLegacyCurrent;
    legacyWrap?.classList.toggle('hidden', !useLegacyCurrent);
    legacyToggle.textContent = useLegacyCurrent ? 'Back to 6-digit PIN entry' : 'My current password contains letters/symbols (legacy)';
    validate();
  });
  legacyInput?.addEventListener('input', () => { saveDraft(); validate(); });

  const getPinValue = (inputs) => inputs.map(i => i?.value || '').join('');

  // Persistence
  const draftKey = 'cooplog-pwd-draft';
  const saveDraft = () => {
    const draft = {
      old_pin: getPinValue(oldPinInputs),
      new_pin: getPinValue(newPinInputs),
      confirm_pin: getPinValue(confirmPinInputs)
    };
    sessionStorage.setItem(draftKey, JSON.stringify(draft));
  };
  try {
    const raw = sessionStorage.getItem(draftKey);
    if (raw) {
      const d = JSON.parse(raw);
      if (d.old_pin) d.old_pin.split('').forEach((v, i) => { if (oldPinInputs[i]) oldPinInputs[i].value = v; });
      if (d.new_pin) d.new_pin.split('').forEach((v, i) => { if (newPinInputs[i]) newPinInputs[i].value = v; });
      if (d.confirm_pin) d.confirm_pin.split('').forEach((v, i) => { if (confirmPinInputs[i]) confirmPinInputs[i].value = v; });
    }
  } catch (e) { }

  // Auto-focus next input on digit entry
  [...oldPinInputs, ...newPinInputs, ...confirmPinInputs].forEach((input, idx, arr) => {
    if (!input) return;
    input.addEventListener('input', (e) => {
      if (e.target.value.length === 1 && idx < arr.length - 1) {
        arr[idx + 1]?.focus();
      }
      saveDraft();
      validate();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && idx > 0) {
        arr[idx - 1]?.focus();
      }
    });
  });

  document.getElementById('clear-pwd-btn')?.addEventListener('click', () => {
    sessionStorage.removeItem(draftKey);
    form.reset();
    validate();
  });

  // Validation: new PIN strictly 6 digits; current may be a 6-digit PIN,
  // a short legacy PIN (e.g. 1234), or a legacy letter-password.
  const validate = () => {
    const oldPin = getPinValue(oldPinInputs);
    const oldOk = useLegacyCurrent
      ? (legacyInput?.value || '').length > 0
      : oldPin.length >= 4 && oldPin.length <= 6;
    const newPwd = getPinValue(newPinInputs);
    const confirmPwd = getPinValue(confirmPinInputs);
    const isValid = oldOk && newPwd.length === 6 && /^\d{6}$/.test(newPwd) && newPwd === confirmPwd;
    if (submitBtn) submitBtn.disabled = !isValid;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPwd = useLegacyCurrent ? (legacyInput?.value || '') : getPinValue(oldPinInputs);
    const newPwd = getPinValue(newPinInputs);
    const confirmPwd = getPinValue(confirmPinInputs);
    if (!oldPwd) { showToast('Enter your current password.', 'warning'); return; }
    if (newPwd !== confirmPwd) { showToast('New PINs do not match!', 'warning'); return; }
    if (newPwd.length !== 6 || !/^\d{6}$/.test(newPwd)) { showToast('New PIN must be exactly 6 digits.', 'warning'); return; }
    try {
      submitBtn.disabled = true; submitBtn.innerText = 'Updating...';
      await changePassword(user.username, oldPwd, newPwd, user.cooperativeId);
      showToast('PIN updated successfully!', 'success'); form.reset(); sessionStorage.removeItem(draftKey); validate();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
    finally { submitBtn.disabled = false; submitBtn.innerText = 'Update PIN'; }
  });
}
