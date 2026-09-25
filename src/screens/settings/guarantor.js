import {
  fetchMyGuarantorRequests,
  fetchGuarantorStats,
  setGuarantorDecision,
} from '../../services/dataService.js';
import { showToast } from '../../services/toastService.js';
import { formatCurrency, escapeHtml, formatDate } from '../../utils/formatters.js';

export function renderGuarantorSection(area) {
  area.innerHTML = `
    <style>
      .g-page { display: flex; flex-direction: column; min-height: 0; gap: 0.5rem; }
      .g-sticky { position: sticky; top: 0; z-index: 20; background: var(--bg-card); padding-bottom: 0.5rem; }
      .g-title { margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--text-primary); line-height: 1.2; }
      .g-desc { margin: 0.15rem 0 0 0; font-size: 0.78rem; color: var(--text-muted); }
      .g-stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; margin-top: 0.6rem; }
      .g-stats-grid .stat-card {
        background: var(--bg-card); border: 1px solid var(--border-light);
        border-radius: var(--radius-lg); padding: 0.55rem 0.75rem;
        box-shadow: var(--shadow-sm); min-width: 0; cursor: pointer;
        transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .g-stats-grid .stat-card:hover { transform: translateY(-1px); border-color: var(--border-medium); }
      .g-stats-grid .stat-card.active { border-color: var(--accent-primary); box-shadow: 0 0 0 2px var(--accent-soft); }
      .g-stats-grid .stat-card.static { cursor: default; }
      .g-stats-grid .stat-card.static:hover { transform: none; border-color: var(--border-light); }
      .g-stats-grid .stat-label {
        font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.07em; color: var(--text-muted);
      }
      .g-stats-grid .stat-value {
        font-size: 1.2rem; font-weight: 800; color: var(--text-primary);
        font-variant-numeric: tabular-nums; line-height: 1.2;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .g-stats-grid .stat-sub {
        font-size: 0.68rem; color: var(--text-muted); font-weight: 600;
        margin-top: 0.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .g-filters-row {
        display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
        margin-top: 0.6rem; background: var(--bg-card); padding: 0.5rem;
        border-radius: var(--radius-lg); border: 1px solid var(--border-light);
      }
      .g-search-wrap { position: relative; flex: 1; min-width: 150px; }
      .g-search-wrap input {
        width: 100%; padding: 0.45rem 0.6rem 0.45rem 1.9rem; border-radius: var(--radius-md);
        border: 1px solid var(--border-medium); font-size: 0.8rem; outline: none;
        background: var(--bg-input); color: var(--text-primary); box-sizing: border-box;
      }
      .g-search-wrap .search-icon {
        position: absolute; left: 0.6rem; top: 50%; transform: translateY(-50%);
        color: var(--text-muted); pointer-events: none;
      }
      .g-select {
        padding: 0.45rem 0.5rem; border-radius: var(--radius-md);
        border: 1px solid var(--border-medium); font-size: 0.78rem;
        background: var(--bg-input); color: var(--text-primary); outline: none; cursor: pointer;
      }
      .g-count { font-size: 0.72rem; color: var(--text-muted); font-weight: 600; padding: 0.35rem 0.25rem 0; }
      .g-list-wrap {
        overflow-y: auto; border-radius: var(--radius-lg); scrollbar-width: thin;
        max-height: calc(100vh - 430px); min-height: 240px; position: relative;
      }
      .g-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0.6rem; }
      .g-card {
        background: var(--bg-card); border: 1px solid var(--border-light);
        border-radius: var(--radius-lg); padding: 0.75rem 0.85rem;
        box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 0.5rem; min-width: 0;
      }
      .g-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; }
      .g-name { font-weight: 700; font-size: 0.88rem; color: var(--text-primary); line-height: 1.25; overflow: hidden; text-overflow: ellipsis; }
      .g-meta { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.15rem; }
      .g-amounts { display: flex; gap: 0.75rem; flex-wrap: wrap; font-size: 0.78rem; }
      .g-amounts strong { font-variant-numeric: tabular-nums; }
      .g-badge {
        display: inline-flex; align-items: center; gap: 0.3rem; flex-shrink: 0;
        font-size: 0.66rem; font-weight: 700; padding: 0.2rem 0.6rem;
        border-radius: 999px; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap;
      }
      .g-badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
      .g-badge.pending { background: var(--warning-bg); color: var(--warning); border: 1px solid rgba(217,119,6,0.25); }
      .g-badge.approved { background: var(--success-bg); color: var(--success); border: 1px solid rgba(22,163,74,0.25); }
      .g-badge.rejected { background: var(--danger-bg); color: var(--danger); border: 1px solid rgba(220,38,38,0.25); }
      .g-actions { display: flex; gap: 0.4rem; }
      .g-btn {
        flex: 1; display: inline-flex; align-items: center; justify-content: center;
        padding: 0.5rem 0.7rem; border-radius: var(--radius-md); font-size: 0.78rem; font-weight: 700;
        border: 1px solid var(--border-medium); background: var(--bg-card);
        color: var(--text-primary); cursor: pointer; min-height: 2.4rem;
      }
      .g-btn:hover { background: var(--bg-secondary); }
      .g-btn:disabled { opacity: 0.55; cursor: not-allowed; }
      .g-btn.go { background: var(--accent-primary); border-color: var(--accent-primary); color: #fff; }
      .g-btn.stop { color: var(--danger); border-color: rgba(220,38,38,0.35); }
      .g-empty { text-align: center; padding: 2rem 1rem; color: var(--text-muted); font-size: 0.82rem; font-style: italic; }
      @media (max-width: 640px) {
        .g-stats-grid { grid-template-columns: repeat(2, 1fr); gap: 0.4rem; }
        .g-stats-grid .stat-value { font-size: 1.05rem; }
        .g-list { grid-template-columns: 1fr; }
        .g-list-wrap { max-height: calc(100vh - 400px); }
        .g-actions { flex-direction: column; }
        .g-btn { width: 100%; }
      }
    </style>
    <div class="g-page">
      <div class="g-sticky">
        <h3 class="g-title">Guarantor Requests</h3>
        <p class="g-desc">Review loans that listed you as a guarantor. Approve or reject each request.</p>
        <div id="guarantor-stats"><p style="color: var(--text-muted); font-style: italic; font-size: 0.8rem;">Loading…</p></div>
        <div class="g-filters-row">
          <div class="g-search-wrap">
            <svg class="search-icon" width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
            <input type="text" id="g-search-input" placeholder="Search loanee, amount…" autocomplete="off">
          </div>
          <select id="g-status-filter" class="g-select">
            <option value="pending">Pending</option>
            <option value="all">All</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select id="g-sort-filter" class="g-select">
            <option value="newest">Newest</option>
            <option value="amount-desc">Amount ↓</option>
            <option value="amount-asc">Amount ↑</option>
          </select>
        </div>
        <div id="g-count" class="g-count" aria-live="polite"></div>
      </div>
      <div class="g-list-wrap" id="g-list-wrap">
        <div id="guarantor-requests-list"><p class="g-empty">Checking for requests…</p></div>
      </div>
    </div>
  `;
}

export function setupGuarantorListeners(user, cooperativeId) {
  const list = document.getElementById('guarantor-requests-list');
  const statsEl = document.getElementById('guarantor-stats');
  const countEl = document.getElementById('g-count');
  if (!list) return;

  let all = [];
  let statusFilter = 'pending';
  let searchTerm = '';
  let sortMode = 'newest';
  let searchDebounce = null;
  let working = false;

  if (!user?.memberId) {
    list.innerHTML = '<p class="g-empty">Guarantor requests are available on member-linked accounts. Your login is not linked to a member record.</p>';
    if (statsEl) statsEl.innerHTML = '';
    if (countEl) countEl.textContent = '';
    return;
  }

  const paintStats = (stats, counts) => {
    if (!statsEl) return;
    const card = (key, label, value, color, sub, clickable = true) => `
      <div class="stat-card${statusFilter === key ? ' active' : ''}${clickable ? '' : ' static'}" ${clickable ? `data-stat="${key}" role="button" tabindex="0"` : ''}>
        <div class="stat-label">${label}</div>
        <div class="stat-value" style="color: ${color};">${value}</div>
        <div class="stat-sub">${sub}</div>
      </div>`;
    statsEl.innerHTML = `
      <div class="g-stats-grid">
        ${card('pending', 'Pending', counts.pending, 'var(--warning)', 'awaiting you')}
        ${card('approved', 'Approved', counts.approved, 'var(--success)', 'you approved')}
        ${card('all', 'Total', all.length, 'var(--text-primary)', `${formatCurrency(stats.totalSum || 0)} guaranteed`)}
        ${card('_overdue', 'Overdue', stats.overdueCount || 0, (stats.overdueCount || 0) > 0 ? 'var(--danger)' : 'var(--text-muted)', `${stats.activeCount || 0} active`, false)}
      </div>`;
    statsEl.querySelectorAll('.stat-card[data-stat]').forEach((el) => {
      const fire = () => {
        statusFilter = el.dataset.stat;
        const sel = document.getElementById('g-status-filter');
        if (sel) sel.value = statusFilter;
        paintStats(stats, counts);
        paintList();
      };
      el.onclick = fire;
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } };
    });
  };

  const filtered = () => {
    const term = searchTerm.trim().toLowerCase();
    let rows = all.filter((r) => (statusFilter === 'all' ? true : r.approval_state === statusFilter));
    if (term) {
      rows = rows.filter((r) =>
        String(r.loanee_name || '').toLowerCase().includes(term) ||
        String(r.guarantee_amount || '').includes(term) ||
        String(r.principal_amount || '').includes(term) ||
        String(r.enterprise_name || '').toLowerCase().includes(term),
      );
    }
    rows = [...rows];
    if (sortMode === 'amount-desc') rows.sort((a, b) => (Number(b.guarantee_amount) || 0) - (Number(a.guarantee_amount) || 0));
    else if (sortMode === 'amount-asc') rows.sort((a, b) => (Number(a.guarantee_amount) || 0) - (Number(b.guarantee_amount) || 0));
    else rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return rows;
  };

  const badge = (state) => `<span class="g-badge ${state}">${state}</span>`;

  const paintList = () => {
    const rows = filtered();
    if (countEl) {
      countEl.textContent = rows.length === 0
        ? 'No requests match the current filters'
        : `Showing ${rows.length} of ${all.length} request${all.length === 1 ? '' : 's'}`;
    }
    if (rows.length === 0) {
      list.innerHTML = statusFilter === 'pending' && !searchTerm.trim()
        ? '<p class="g-empty">No pending guarantor requests. 🎉</p>'
        : '<p class="g-empty">No requests match this filter.</p>';
      return;
    }
    list.innerHTML = `<div class="g-list">${rows.map((req) => {
      const when = req.created_at ? formatDate(req.created_at) : '—';
      const due = req.due_date ? formatDate(req.due_date) : null;
      const pending = req.approval_state === 'pending';
      return `
        <div class="g-card" data-id="${escapeHtml(req.id)}">
          <div class="g-card-top">
            <div style="min-width: 0;">
              <div class="g-name">${escapeHtml(req.loanee_name || 'Member')}</div>
              <div class="g-meta">${req.enterprise_name ? `${escapeHtml(req.enterprise_name)} • ` : ''}Requested ${escapeHtml(when)}${due ? ` • Due ${escapeHtml(due)}` : ''}</div>
            </div>
            ${badge(req.approval_state)}
          </div>
          <div class="g-amounts">
            <span>Guarantee <strong>${escapeHtml(formatCurrency(req.guarantee_amount))}</strong></span>
            <span style="color: var(--text-muted);">Loan ${escapeHtml(formatCurrency(req.principal_amount))}</span>
          </div>
          ${pending ? `
            <div class="g-actions">
              <button class="g-btn go g-approve-btn" data-loan="${escapeHtml(req.remittance_id || '')}" data-id="${escapeHtml(req.id)}">Approve</button>
              <button class="g-btn stop g-reject-btn" data-loan="${escapeHtml(req.remittance_id || '')}" data-id="${escapeHtml(req.id)}">Reject</button>
            </div>
          ` : `
            <div class="g-meta">${req.approval_state === 'approved' ? 'You approved this request.' : 'You rejected this request.'}${req.loan_status ? ` Loan: ${escapeHtml(req.loan_status)}.` : ''}</div>
          `}
        </div>`;
    }).join('')}</div>`;
    bindCardEvents();
    document.getElementById('g-list-wrap')?.scrollTo({ top: 0 });
  };

  const confirmDecision = (approved, loanee) =>
    new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'settings-modal-overlay';
      overlay.innerHTML = `
        <div class="settings-modal-content" style="max-width: 380px;">
          <div class="modal-header">
            <h3 style="margin:0; font-size: 1rem; ${approved ? '' : 'color: var(--danger);'}">${approved ? 'Approve guarantee' : 'Reject guarantee'}</h3>
            <button class="close-modal-x" style="background:transparent; border:none; color:var(--text-muted); font-size:1.4rem; cursor:pointer;">&times;</button>
          </div>
          <div class="modal-body" style="padding: 1.25rem;">
            <p style="margin: 0 0 1rem 0; font-size: 0.85rem;">${approved ? 'Guarantee' : 'Reject'} the loan for <strong>${escapeHtml(loanee || 'this member')}</strong>?${approved ? ' You become liable for the guaranteed amount if they default.' : ''}</p>
            <div style="display: flex; gap: 0.5rem;">
              <button class="g-btn close-modal-x" style="flex: 1;">Cancel</button>
              <button class="g-btn ${approved ? 'go' : 'stop'}" id="g-confirm-btn" style="flex: 1; ${approved ? '' : 'background: var(--danger); border-color: var(--danger); color: #fff;'}">${approved ? 'Approve' : 'Reject'}</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const close = (val) => { overlay.remove(); resolve(val); };
      overlay.querySelectorAll('.close-modal-x').forEach((el) => { el.onclick = () => close(false); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      overlay.querySelector('#g-confirm-btn').onclick = () => close(true);
    });

  const bindCardEvents = () => {
    list.querySelectorAll('.g-approve-btn').forEach((btn) => {
      btn.onclick = () => decide(btn, true);
    });
    list.querySelectorAll('.g-reject-btn').forEach((btn) => {
      btn.onclick = () => decide(btn, false);
    });
  };

  const decide = async (btn, approved) => {
    if (working) return;
    const card = btn.closest('.g-card');
    const loanee = card?.querySelector('.g-name')?.textContent || 'this member';
    const ok = await confirmDecision(approved, loanee);
    if (!ok) return;
    working = true;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    card?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await setGuarantorDecision(btn.dataset.loan, btn.dataset.id, approved, user.username || user.memberId || 'system');
      showToast(approved ? 'Guarantee approved.' : 'Guarantee rejected.', approved ? 'success' : 'info');
      await reload(false);
    } catch (err) {
      showToast((approved ? 'Approval' : 'Rejection') + ' failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = label;
      card?.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    } finally {
      working = false;
    }
  };

  const reload = async (resetScroll = true) => {
    try {
      const [requests, stats] = await Promise.all([
        fetchMyGuarantorRequests(user.memberId),
        fetchGuarantorStats(user.memberId, cooperativeId).catch(() => ({ totalCount: 0, totalSum: 0, activeCount: 0, overdueCount: 0 })),
      ]);
      all = requests || [];
      const counts = {
        pending: all.filter((r) => r.approval_state === 'pending').length,
        approved: all.filter((r) => r.approval_state === 'approved').length,
      };
      paintStats(stats || {}, counts);
      paintList();
      if (!resetScroll) document.getElementById('g-list-wrap')?.scrollTo({ top: 0 });
    } catch (err) {
      list.innerHTML = `<p class="g-empty" style="color: var(--danger);">Error loading requests: ${escapeHtml(err.message)}</p>`;
    }
  };

  document.getElementById('g-status-filter').onchange = (e) => {
    statusFilter = e.target.value;
    reload();
  };
  document.getElementById('g-sort-filter').onchange = (e) => {
    sortMode = e.target.value;
    paintList();
  };
  document.getElementById('g-search-input').oninput = (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { searchTerm = e.target.value; paintList(); }, 200);
  };

  reload();
}
