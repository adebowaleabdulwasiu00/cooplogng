import { submitFeedback } from '../../services/dataService.js';
import { showToast } from '../../services/toastService.js';

export function renderFeedbackSection(area) {
  area.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; max-width: 500px;">
        <div>
          <h3>Give Feedback</h3>
          <p class="section-desc">We value your suggestions! Please let us know how we can improve.</p>
        </div>
        <button type="button" class="ghost-button" id="clear-fb-btn" style="color: var(--danger); border: 1px solid var(--danger-bg); padding: 0.25rem 0.5rem; font-size: 0.8rem;">🗑 Clear</button>
      </div>
      <form id="feedback-form" style="display: flex; flex-direction: column; gap: 1.25rem; max-width: 500px;">
        <div class="field">
          <label>Your Feedback</label>
          <textarea id="feedback_text" name="feedback_text" rows="5" maxlength="1000" placeholder="Type your feedback here (max 1000 characters)..." required style="width: 100%; border-radius: var(--radius-md); border: 1px solid var(--border-medium); padding: 0.75rem; background: var(--bg-input); color: var(--text-primary);"></textarea>
          <div id="char-count" style="text-align: right; font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">0 / 1000</div>
        </div>
        <button type="submit" class="secondary-button" style="width: 100%; border: 1px solid var(--border-medium); background: transparent; color: var(--text-primary);">Submit Feedback</button>
      </form>
    `;
}

export function setupFeedbackListeners(user) {
  const form = document.getElementById('feedback-form');
  if (!form) return;
  const textarea = form.querySelector('textarea');
  const charCount = document.getElementById('char-count');

  const draftKey = 'cooplog-fb-draft';
  try {
    const raw = sessionStorage.getItem(draftKey);
    if (raw) {
      textarea.value = raw;
      charCount.innerText = `${textarea.value.length} / 1000`;
    }
  } catch (e) { }

  textarea?.addEventListener('input', () => {
    charCount.innerText = `${textarea.value.length} / 1000`;
    sessionStorage.setItem(draftKey, textarea.value);
  });

  document.getElementById('clear-fb-btn')?.addEventListener('click', () => {
    sessionStorage.removeItem(draftKey);
    form.reset();
    charCount.innerText = '0 / 1000';
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    try {
      const btn = form.querySelector('button'); btn.disabled = true; btn.innerText = 'Submitting...'
      await submitFeedback(user.memberId, text, user.cooperativeId, user.name || user.username || '', user.cooperativeName || '', user.username || 'system');
      showToast('Feedback submitted. Thank you!', 'success'); form.reset(); charCount.innerText = '0 / 1000'; sessionStorage.removeItem(draftKey);
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
    finally { const btn = form.querySelector('button'); btn.disabled = false; btn.innerText = 'Submit Feedback'; }
  });
}
