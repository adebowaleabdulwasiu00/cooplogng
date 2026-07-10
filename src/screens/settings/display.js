import { showToast } from '../../services/toastService.js';

export function renderDisplaySection(area, appState) {
  const useSpecialIdInReports = localStorage.getItem('useSpecialIdInReports') === 'true';

  area.innerHTML = `
      <h3>Display Preferences</h3>
      <p class="section-desc">Customize how member information is displayed across the app.</p>

      <div style="display: flex; flex-direction: column; gap: 1.5rem;">
        <div class="field" style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 500; color: var(--text-primary);">Use Special ID in Reports</div>
            <div style="font-size: 0.875rem; color: var(--text-muted);">Show Special ID instead of Registration Number in reports</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="use-special-id-reports" ${useSpecialIdInReports ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <style>
        .switch {
          position: relative;
          display: inline-block;
          width: 50px;
          height: 28px;
        }
        .switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #ccc;
          transition: .4s;
          border-radius: 28px;
        }
        .slider:before {
          position: absolute;
          content: "";
          height: 20px;
          width: 20px;
          left: 4px;
          bottom: 4px;
          background-color: white;
          transition: .4s;
          border-radius: 50%;
        }
        input:checked + .slider {
          background-color: var(--accent-primary);
        }
        input:checked + .slider:before {
          transform: translateX(22px);
        }
      </style>
    `;
}

export function setupDisplayListeners(user, cooperativeId, appState, setAppState) {
  const useSpecialIdToggle = document.getElementById('use-special-id-reports');
  useSpecialIdToggle?.addEventListener('change', (e) => {
    localStorage.setItem('useSpecialIdInReports', e.target.checked);
    showToast('Setting saved!', 'success');
  });
}
