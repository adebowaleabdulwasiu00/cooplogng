import { escapeHtml } from '../../utils/formatters.js';

// True when running on a local/testing environment (Vite dev, Electron dev
// with START_URL, Capacitor). Only such environments are allowed to reveal
// destructive actions like the remittance Delete button.
function isLocalhost() {
  if (typeof window === 'undefined' || !window.location) return false;
  const host = (window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

// Gmail-style colors for fallback initials
const AVATAR_COLORS = [
  '#f44336', '#e91e63', '#9c27b0', '#673ab7',
  '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4',
  '#009688', '#4caf50', '#8bc34a', '#cddc39',
  '#ffeb3b', '#ffc107', '#ff9800', '#ff5722'
];

function getAvatarColor(name) {
  if (!name) return '#999';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

function showModalDialog(title, message, buttons = []) {
        const modalId = 'dialog-modal';
        let existing = document.getElementById(modalId);
        if (existing) existing.remove();
        
        const overlay = document.createElement('div');
        overlay.id = modalId;
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 999999; display: flex; align-items: center; justify-content: center; opacity: 1; pointer-events: auto;';
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = 'background: var(--bg-card); border-radius: var(--radius-md); width: 90%; max-width: 500px; margin: 2rem auto; max-height: 90vh; overflow-y: auto; padding: 1.5rem; box-shadow: var(--shadow-xl);';
        
        modalContent.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                <h3 style="margin: 0;">${escapeHtml(title)}</h3>
                <button type="button" class="close-dialog-btn" style="background: transparent; border: none; font-size: 1.5rem; cursor: pointer;">&times;</button>
            </div>
            <div class="dialog-body" style="display: flex; flex-direction: column; gap: 1rem;">
                ${typeof message === 'string' ? `<p style="margin: 0;">${message}</p>` : ''}
            </div>
            <div class="dialog-actions" style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem; border-top: 1px solid var(--border-light); padding-top: 1.5rem;"></div>
        `;
        
        const actionsDiv = modalContent.querySelector('.dialog-actions');
        buttons.forEach(btn => {
            const btnEl = document.createElement('button');
            btnEl.className = btn.class || 'btn btn-secondary';
            btnEl.textContent = btn.text;
            btnEl.addEventListener('click', () => {
                overlay.remove();
                if (btn.onClick) btn.onClick();
            });
            actionsDiv.appendChild(btnEl);
        });
        
        modalContent.querySelector('.close-dialog-btn').addEventListener('click', () => {
            overlay.remove();
        });
        
        overlay.appendChild(modalContent);
        document.body.appendChild(overlay);
        
        // Handle list items if message is an array
        if (Array.isArray(message)) {
            const body = modalContent.querySelector('.dialog-body');
            if (message.length > 0) {
                const p = document.createElement('p');
                p.style.cssText = 'margin: 0 0 0.75rem 0;';
                p.textContent = message[0];
                body.appendChild(p);
            }
            if (message.length > 1) {
                const list = document.createElement('ul');
                list.style.cssText = 'margin: 0; padding-left: 1.5rem;';
                for (let i = 1; i < message.length; i++) {
                    const li = document.createElement('li');
                    li.textContent = message[i];
                    list.appendChild(li);
                }
                body.appendChild(list);
            }
        }
    }

function isMobile() {
  try {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(max-width: 999px)').matches;
    }
  } catch {}
  return false;
}

export { AVATAR_COLORS, getAvatarColor, showModalDialog, isLocalhost, isMobile };
