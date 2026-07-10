import { fetchPendingGuarantorRequests, approveGuarantorRequest } from '../../services/dataService.js';
import { showToast } from '../../services/toastService.js';
import { formatCurrency, escapeHtml } from '../../utils/formatters.js';

export function renderGuarantorSection(area) {
  area.innerHTML = `
      <h3>Guarantor Requests</h3>
      <p class="section-desc">Review loans that have listed you as a guarantor.</p>

      <div id="guarantor-stats-container" style="background: var(--bg-secondary); padding: 1.5rem; border-radius: var(--radius-lg); border: 1px solid var(--border-light); margin-bottom: 2rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;">
        <div style="text-align: center;">
          <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Total Guarantees</div>
          <div id="g-stat-total-count" style="font-size: 1.5rem; font-weight: 800; color: var(--text-primary);">-</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Total Amount</div>
          <div id="g-stat-total-sum" style="font-size: 1.5rem; font-weight: 800; color: var(--accent-primary);">-</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Active Guarantees</div>
          <div id="g-stat-active-count" style="font-size: 1.5rem; font-weight: 800; color: var(--text-primary);">-</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Overdue</div>
          <div id="g-stat-overdue" style="font-size: 1.5rem; font-weight: 800; color: var(--text-muted);">-</div>
        </div>
      </div>

      <div id="guarantor-requests-list"><p style="color: var(--text-muted); font-style: italic; font-size: 0.875rem;">Checking for requests...</p></div>
    `;
}

export function setupGuarantorListeners(user, cooperativeId) {
  const list = document.getElementById('guarantor-requests-list');
  if (!list) return;

  const loadRequests = async () => {
    try {
      // Load Stats
      const { fetchGuarantorStats } = await import('../../services/dataService.js')
      fetchGuarantorStats(user.memberId, cooperativeId).then(stats => {
        const totalCountEl = document.getElementById('g-stat-total-count')
        const totalSumEl = document.getElementById('g-stat-total-sum')
        const activeCountEl = document.getElementById('g-stat-active-count')
        const overdueEl = document.getElementById('g-stat-overdue')
        
        if (totalCountEl) totalCountEl.innerText = stats.totalCount
        if (totalSumEl) totalSumEl.innerText = `₦${(stats.totalSum || 0).toLocaleString()}`
        if (activeCountEl) activeCountEl.innerText = stats.activeCount
        if (overdueEl) {
          overdueEl.innerText = stats.overdueCount
          if (stats.overdueCount > 0) overdueEl.style.color = 'var(--danger)'
        }
      });

      const requests = await fetchPendingGuarantorRequests(user.memberId);
      if (requests.length === 0) {
        list.innerHTML = '<p style="color: var(--text-muted); font-style: italic; font-size: 0.875rem;">No pending guarantor requests.</p>';
        return;
      }

      list.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            ${requests.map(req => `
              <div class="card" style="padding: 1.25rem; border: 1px solid var(--border-light); background: var(--bg-secondary);">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                  <div>
                    <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.25rem;">${escapeHtml(req.loanee_name || 'Member')}</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">
                      Guarantee request of <strong>${formatCurrency(req.guarantee_amount)}</strong>
                      (Total Loan: ${formatCurrency(req.principal_amount)})
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">Requested on: ${new Date(req.created_at).toLocaleDateString()}</div>
                  </div>
                  <div style="display: flex; gap: 0.5rem;">
                    <button class="primary-button approve-req-btn"
                            data-id="${req.id}"
                            data-remittance-id="${req.remittance_id || req.loan_id}"
                            style="padding: 0.4rem 0.85rem; font-size: 0.8rem;">Approve</button>
                    <button class="secondary-button reject-req-btn"
                            data-id="${req.id}"
                            data-remittance-id="${req.remittance_id || req.loan_id}"
                            style="padding: 0.4rem 0.85rem; font-size: 0.8rem; color: var(--danger); border-color: var(--danger-bg);">Reject</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `;

      list.querySelectorAll('.approve-req-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Are you sure you want to approve this guarantor request?')) {
            try {
              const btnEl = btn; btnEl.disabled = true; btnEl.innerText = '...'
              await approveGuarantorRequest(btn.dataset.remittanceId, btn.dataset.id, true, user.username || user.memberId || 'system');
              loadRequests();
            } catch (err) {
              showToast('Approval failed: ' + err.message, 'error');
              btn.disabled = false; btn.innerText = 'Approve';
            }
          }
        });
      });

      list.querySelectorAll('.reject-req-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Are you sure you want to reject this guarantor request?')) {
            try {
              const btnEl = btn; btnEl.disabled = true; btnEl.innerText = '...'
              await approveGuarantorRequest(btn.dataset.remittanceId, btn.dataset.id, false, user.username || user.memberId || 'system');
              loadRequests();
            } catch (err) {
              showToast('Rejection failed: ' + err.message, 'error');
              btn.disabled = false; btn.innerText = 'Reject';
            }
          }
        });
      });
    } catch (err) {
      list.innerHTML = `<p style="color: var(--danger); font-size: 0.875rem;">Error loading requests: ${err.message}</p>`;
    }
  };
  loadRequests();
}
