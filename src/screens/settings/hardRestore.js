import { performHardRestore } from '../../services/syncService.js';
import { showToast } from '../../services/toastService.js';

export function renderHardRestoreSection(area) {
  area.innerHTML = `
      <h3>Hard Restore App</h3>
      <p class="section-desc">Push outstanding data and reset the local workspace.</p>
      <div class="card" style="padding: 2.5rem; background: var(--bg-secondary); border-radius: var(--radius-lg); border: 1px solid var(--border-light);">
        <div style="text-align: center; margin-bottom: 2rem;">
            <div style="width: 80px; height: 80px; background: var(--danger-bg); color: var(--danger); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; font-size: 2.5rem;">⚠️</div>
            <h4 style="margin: 0; font-size: 1.25rem; color: var(--text-primary);">Warning: High Impact Operation</h4>
        </div>

        <div style="font-size: 0.95rem; line-height: 1.6; color: var(--text-primary); margin-bottom: 1.5rem;">
            This procedure will perform the following actions:
            <ul style="margin: 1rem 0; padding-left: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem;">
                <li><strong>1. Sync Push:</strong> Upload any unsaved local changes to the cloud.</li>
                <li><strong>2. Wipe Database:</strong> Completely delete your local offline database and cache.</li>
                <li><strong>3. Force Logout:</strong> Log you out to ensure a fresh session.</li>
                <li><strong>4. Re-download:</strong> On your next login, the app will download a fresh copy of all data from the cloud.</li>
            </ul>
            This is typically used after an app update or if your local data feels out of sync with the server.
        </div>

        <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 2rem;">
            <button id="hard-restore-btn" class="primary-button" style="background: var(--danger); border-color: var(--danger); color: white; padding: 1rem; width: 100%; font-weight: 700;">I UNDERSTAND, PROCEED</button>
            <button id="cancel-restore-btn" class="secondary-button" style="padding: 0.75rem; width: 100%;">Cancel</button>
        </div>
      </div>
    `;
}

export function setupHardRestoreListeners(user, cooperativeId, navigate) {
  document.getElementById('cancel-restore-btn')?.addEventListener('click', () => {
    navigate(null); // Navigate back to menu
  });

  document.getElementById('hard-restore-btn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    if (!confirm('Final Confirmation: Are you absolutely sure? The app will reload and force a new login.')) return;

    try {
      btn.disabled = true;
      btn.innerText = 'Processing Hard Restore...';
      await performHardRestore(cooperativeId);
    } catch (err) {
      console.error('Hard restore failed:', err);
      showToast('Restore failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.innerText = 'I UNDERSTAND, PROCEED';
    }
  });
}
