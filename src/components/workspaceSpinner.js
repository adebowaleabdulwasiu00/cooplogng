/**
 * Shared "Loading workspace..." spinner — same look as the remittance page.
 * Paint it FIRST THING in a page render so slow pages never sit blank:
 *
 *   import { showWorkspaceSpinner } from '../../components/workspaceSpinner.js';
 *   showWorkspaceSpinner(container);
 *   const data = await fetchSomething();
 *   container.innerHTML = `...real content...`;
 */
export function showWorkspaceSpinner(
  container,
  message = 'Loading workspace...',
  sub = 'Please wait while we prepare your workspace'
) {
  if (!container) return;
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: var(--bg-main); font-family: inherit;">
      <div style="width: 48px; height: 48px; border: 4px solid var(--border-medium); border-top: 4px solid var(--accent-primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <h2 style="margin-top: 24px; color: var(--text-primary); font-weight: 600; font-size: 1.25rem;">${message}</h2>
      <p style="color: var(--text-muted); font-size: 0.875rem; margin-top: 8px;">${sub}</p>
      <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    </div>
  `;
}
