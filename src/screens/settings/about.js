import { showToast } from '../../services/toastService.js';

export function renderAboutSection(area) {
  area.innerHTML = `
      <h3>About App</h3>
      <p class="section-desc">Technical details and system version.</p>
      <div class="card" style="padding: 2.5rem; background: var(--bg-secondary); border-radius: var(--radius-lg); border: 1px solid var(--border-light);">
        <div style="display: flex; align-items: center; gap: 1.5rem; margin-bottom: 2rem;">
          <div style="width: 72px; height: 72px; background: var(--accent-primary); border-radius: 16px; display: flex; align-items: center; justify-content: center; color: white; font-size: 1.75rem; font-weight: 800; box-shadow: var(--shadow-md);">CL</div>
          <div>
            <h4 style="margin: 0; font-size: 1.4rem; color: var(--text-primary);">Cooperative Log App</h4>
            <p style="margin: 4px 0 0 0; font-size: 0.9rem; color: var(--text-muted); font-weight: 500;">Version 2.4.5 (Enterprise Web)</p>
          </div>
        </div>
        <div style="font-size: 0.95rem; line-height: 1.7; color: var(--text-primary); margin-bottom: 2rem;">
          This application provides a secure, distributed platform for credit unions and multipurpose cooperatives to manage their financial operations with precision.
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; padding-top: 1.5rem; border-top: 1px solid var(--border-light); font-size: 0.85rem;">
          <div>
            <div style="color: var(--text-muted); margin-bottom: 0.25rem;">Developed By</div>
            <div style="font-weight: 600; color: var(--text-primary);">Imradex Global</div>
          </div>
          <div style="text-align: right;">
            <div style="color: var(--text-muted); margin-bottom: 0.25rem;">Release Type</div>
            <div style="font-weight: 600; color: var(--accent-primary);">Stable (LTS)</div>
          </div>
        </div>
      </div>
    `;
}

export function setupAboutListeners() {
  // No listeners yet
}


