import { changePassword } from '../../services/dataService.js';
import { showToast } from '../../services/toastService.js';

export function renderPasswordSection(area) {
  area.innerHTML = `
      <style>
        .pwd-page { display: flex; flex-direction: column; gap: 0.5rem; max-width: 560px; width: 100%; margin: 0 auto; }
        .pwd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
        .pwd-title { margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--text-primary); line-height: 1.2; }
        .pwd-desc { margin: 0.15rem 0 0 0; font-size: 0.78rem; color: var(--text-muted); }
        .pwd-btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 0.3rem;
          padding: 0.45rem 0.7rem; border-radius: var(--radius-md); font-size: 0.76rem; font-weight: 600;
          border: 1px solid var(--border-medium); background: var(--bg-card); color: var(--text-primary);
          cursor: pointer; white-space: nowrap;
        }
        .pwd-btn:hover { background: var(--bg-secondary); }
        .pwd-btn.danger { color: var(--danger); border-color: rgba(220,38,38,0.35); }
        .pwd-card {
          background: var(--bg-card); border: 1px solid var(--border-light);
          border-radius: var(--radius-lg); box-shadow: var(--shadow-sm);
          padding: 0.85rem;
        }
        #password-form { display: flex; flex-direction: column; gap: 0.6rem; width: 100%; }
        #password-form .field { margin: 0; }
        .pwd-group {
          border: 1px solid var(--border-light); border-radius: var(--radius-md);
          padding: 0.7rem 0.75rem; background: var(--bg-card);
        }
        .pwd-group-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.55rem; }
        .pwd-step {
          width: 1.35rem; height: 1.35rem; border-radius: 50%; flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 0.7rem; font-weight: 800; color: #fff; background: var(--accent-primary);
        }
        #password-form .force-pin-label { font-size: 0.78rem !important; }
        #legacy-toggle-btn {
          margin-top: 0.55rem; font-size: 0.76rem; padding: 0.45rem 0.7rem;
          border-radius: var(--radius-md); min-height: 2.4rem;
        }
        #legacy-current-wrap { margin-top: 0.6rem; }
        #old-legacy-input {
          width: 100%; box-sizing: border-box; padding: 0.6rem 0.7rem; font-size: 0.85rem;
          border: 1px solid var(--border-medium); border-radius: var(--radius-md);
          background: var(--bg-input); color: var(--text-primary); min-height: 2.75rem;
        }
        #password-form .force-pin-submit { min-height: 2.75rem; font-size: 0.85rem; margin-top: 0.1rem; }
        @media (max-width: 640px) {
          .pwd-page { max-width: 100%; }
          .pwd-card { padding: 0.7rem; }
          .pwd-group { padding: 0.6rem; }
          #password-form .force-pin-reqs-list { grid-template-columns: 1fr; }
        }
      </style>
      <div class="pwd-page">
        <div class="pwd-head">
          <div style="min-width: 0;">
            <h3 class="pwd-title">Change Password</h3>
            <p class="pwd-desc">Update your 6-digit PIN (numbers only — letters are not allowed).</p>
          </div>
          <button type="button" class="pwd-btn danger" id="clear-pwd-btn">🗑 Clear</button>
        </div>
        <div class="pwd-card">
      <form id="password-form">
        <div class="field pwd-group"><label class="force-pin-label"><span class="pwd-group-head"><span class="pwd-step">1</span>Current 6-Digit PIN</span></label>
          <div class="pin-wrap">
            ${[0,1,2,3,4,5].map(i => `
              <input
                type="text"
                name="old_pin-${i}"
                maxlength="1"
                pattern="[0-9]"
                inputmode="numeric"
                autocomplete="one-time-code"
                aria-label="Current PIN digit ${i+1}"
              />
            `).join('')}
          </div>
          <button type="button" id="legacy-toggle-btn" class="ghost-button">My current password contains letters/symbols (legacy)</button>
          <div id="legacy-current-wrap" class="hidden">
            <input type="password" id="old-legacy-input" placeholder="Enter legacy password (e.g. Adex@1234)" autocomplete="current-password" />
          </div>
        </div>
        <div class="field pwd-group"><label class="force-pin-label"><span class="pwd-group-head"><span class="pwd-step">2</span>New 6-Digit PIN (numbers only)</span></label>
          <div class="pin-wrap">
            ${[0,1,2,3,4,5].map(i => `
              <input
                type="text"
                name="new_pin-${i}"
                maxlength="1"
                pattern="[0-9]"
                inputmode="numeric"
                autocomplete="new-password"
                aria-label="New PIN digit ${i+1}"
              />
            `).join('')}
          </div>
        </div>
        <div class="field pwd-group"><label class="force-pin-label"><span class="pwd-group-head"><span class="pwd-step">3</span>Confirm New 6-Digit PIN</span></label>
          <div class="pin-wrap">
            ${[0,1,2,3,4,5].map(i => `
              <input
                type="text"
                name="confirm_pin-${i}"
                maxlength="1"
                pattern="[0-9]"
                inputmode="numeric"
                autocomplete="new-password"
                aria-label="Confirm PIN digit ${i+1}"
              />
            `).join('')}
          </div>
        </div>
        <div id="pwd-requirements" class="force-pin-reqs">
          <div class="force-pin-reqs-title">Requirements</div>
          <ul class="force-pin-reqs-list">
            <li id="req-length" class="req-pending">○ Exactly 6 digits</li>
            <li id="req-match" class="req-pending">○ PINs match</li>
          </ul>
        </div>
        <button type="submit" class="primary-button force-pin-submit" disabled>Update PIN</button>
      </form>
        </div>
      </div>
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
      if (d.old_pin) d.old_pin.split('').forEach((v, i) => { if (oldPinInputs[i]) { oldPinInputs[i].value = v; oldPinInputs[i].classList.toggle('filled', !!v); } });
      if (d.new_pin) d.new_pin.split('').forEach((v, i) => { if (newPinInputs[i]) { newPinInputs[i].value = v; newPinInputs[i].classList.toggle('filled', !!v); } });
      if (d.confirm_pin) d.confirm_pin.split('').forEach((v, i) => { if (confirmPinInputs[i]) { confirmPinInputs[i].value = v; confirmPinInputs[i].classList.toggle('filled', !!v); } });
    }
  } catch (e) { }

  const setReq = (id, ok) => {
    const el = form.querySelector(id);
    if (!el) return;
    const label = id === '#req-length' ? 'Exactly 6 digits' : 'PINs match';
    el.textContent = `${ok ? '●' : '○'} ${label}`;
    el.classList.toggle('req-ok', !!ok);
    el.classList.toggle('req-pending', !ok);
  };

  // Auto-focus next input on digit entry (per group, with paste + digit-strip)
  const wireGroup = (inputs) => {
    inputs.forEach((input, idx) => {
      if (!input) return;
      input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 1);
        input.classList.toggle('filled', !!e.target.value);
        if (e.target.value.length === 1 && idx < inputs.length - 1) {
          inputs[idx + 1]?.focus();
        }
        saveDraft();
        validate();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && idx > 0) {
          inputs[idx - 1]?.focus();
        }
      });
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        if (!text) return;
        text.split('').forEach((ch, k) => {
          if (inputs[idx + k]) {
            inputs[idx + k].value = ch;
            inputs[idx + k].classList.add('filled');
          }
        });
        inputs[Math.min(idx + text.length, inputs.length - 1)]?.focus();
        saveDraft();
        validate();
      });
    });
  };
  wireGroup(oldPinInputs);
  wireGroup(newPinInputs);
  wireGroup(confirmPinInputs);

  document.getElementById('clear-pwd-btn')?.addEventListener('click', () => {
    sessionStorage.removeItem(draftKey);
    form.reset();
    form.querySelectorAll('.pin-wrap input').forEach(i => i.classList.remove('filled'));
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
    const lengthOk = newPwd.length === 6 && /^\d{6}$/.test(newPwd);
    const matchOk = lengthOk && newPwd === confirmPwd;
    setReq('#req-length', lengthOk);
    setReq('#req-match', matchOk);
    const isValid = oldOk && lengthOk && matchOk;
    if (submitBtn) submitBtn.disabled = !isValid;
  };
  validate();

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
