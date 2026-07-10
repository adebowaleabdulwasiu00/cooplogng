import { showToast } from '../../services/toastService.js';

export function renderThemeSection(area, appState) {
  const currentTheme = appState?.theme || localStorage.getItem('theme') || 'dark';
  area.innerHTML = `
      <h3>Theme</h3>
      <p class="section-desc">Choose your preferred visual theme.</p>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem;">
        <div class="theme-option" data-theme="light" style="padding: 1.5rem; border: 2px solid ${currentTheme === 'light' ? 'var(--accent-primary)' : 'var(--border-light)'}; border-radius: var(--radius-lg); cursor: pointer; text-align: center; background: white;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">☀️</div>
          <div style="font-weight: 600; color: #111;">Light</div>
        </div>
        <div class="theme-option" data-theme="dark" style="padding: 1.5rem; border: 2px solid ${currentTheme === 'dark' ? 'var(--accent-primary)' : 'var(--border-light)'}; border-radius: var(--radius-lg); cursor: pointer; text-align: center; background: #1e293b;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🌙</div>
          <div style="font-weight: 600; color: #f1f5f9;">Dark</div>
        </div>
        <div class="theme-option" data-theme="system" style="padding: 1.5rem; border: 2px solid ${currentTheme === 'system' ? 'var(--accent-primary)' : 'var(--border-light)'}; border-radius: var(--radius-lg); cursor: pointer; text-align: center; background: linear-gradient(135deg, white 0%, #1e293b 100%);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">💻</div>
          <div style="font-weight: 600; color: #818cf8;">System</div>
        </div>
      </div>
    `;
}

export function setupThemeListeners(user, cooperativeId, appState, setAppState) {
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const theme = btn.dataset.theme;
      const newState = { ...appState, theme };

      localStorage.setItem('theme', theme);
      document.documentElement.setAttribute('data-theme', theme);

      if (setAppState) {
        setAppState(newState);
      }

      // Update UI to reflect new selection
      document.querySelectorAll('.theme-option').forEach(el => {
        el.style.borderColor = el.dataset.theme === theme ? 'var(--accent-primary)' : 'var(--border-light)';
      });

      showToast('Theme updated!', 'success');
    });
  });
}
