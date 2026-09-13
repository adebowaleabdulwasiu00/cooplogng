import { exportDatabase, importDatabase, getSyncQueueSummary, getSyncQueueDetails, restartAllSyncItems, resetSyncQueueAndMarkUnsynced, clearSyncQueueLogs, checkDbExists, scanAndEnqueueUnsynced, getSyncMeta, markCollectionSynced, markCollectionUnsynced } from '../../services/sqliteService.js';
import { showToast } from '../../services/toastService.js';
import { SYNC_COLLECTIONS } from '../../services/sqlite/syncState.js';
import { triggerFullResync } from '../../services/backgroundSyncService.js';

export function renderDbManagementSection(area) {
  area.innerHTML = `
      <h3>Database Management</h3>
      <p class="section-desc">Export backups, import data, and monitor background synchronization.</p>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
        <div class="card" style="padding: 1.5rem; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--bg-card); width: 100%;">
          <h4 style="margin-top: 0; color: var(--text-primary);">Backup & Restore</h4>
          <div id="db-health-status" style="margin-bottom: 0.75rem; font-size: 0.85rem; font-weight: 600;"></div>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.25rem;">Download a full copy of your local database or import records from a backup file.</p>
          <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
            <button id="export-db-btn" class="primary-button" style="padding: 0.6rem 1rem; font-size: 0.85rem; flex: 1;">Export Database</button>
            <button id="import-db-btn" class="secondary-button" style="padding: 0.6rem 1rem; font-size: 0.85rem; border: 1px solid var(--border-medium); background: transparent; color: var(--text-primary); flex: 1;">Import Database</button>
          </div>
          <input type="file" id="db-import-input" accept=".db,.sqlite" style="display: none;">
        </div>

        <div class="card" style="padding: 1.5rem; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--bg-card); width: 100%;">
          <h4 style="margin-top: 0; color: var(--text-primary);">Initial Cloud Pull Status</h4>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">Shows whether each data set has been fully downloaded from the cloud.</p>
          <div id="initial-sync-status-container">
            <p style="color: var(--text-muted); font-style: italic; font-size: 0.85rem;">Loading...</p>
          </div>
          <button id="force-resync-btn" class="ghost-button" style="margin-top: 1rem; font-size: 0.8rem; color: #e67e22; border-color: rgba(230, 126, 34, 0.3); width: 100%; padding: 0.6rem;">
            🔄 Force Full Re-Sync
          </button>
        </div>

        <div class="card" style="padding: 1.5rem; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--bg-card); width: 100%;">
          <h4 style="margin-top: 0; color: var(--text-primary);">Sync Queue Status</h4>
          <div id="sync-summary-container">
            <p style="color: var(--text-muted); font-style: italic; font-size: 0.85rem;">Loading status...</p>
          </div>
          <div style="display: flex; gap: 0.75rem; margin-top: 1rem; flex-wrap: wrap; flex-direction: column; width: 100%;">
            <div style="display: flex; gap: 0.75rem; width: 100%;">
              <button id="retry-sync-btn" class="ghost-button" style="font-size: 0.8rem; color: var(--accent-primary); border-color: var(--accent-soft); flex: 1;">🔄 Restart All</button>
              <button id="clear-sync-logs-btn" class="ghost-button" style="font-size: 0.8rem; color: var(--text-muted); flex: 1;">🗑 Clear Logs</button>
            </div>
            <button id="rebuild-queue-btn" class="ghost-button" style="font-size: 0.8rem; color: #e67e22; border-color: rgba(230, 126, 34, 0.3); width: 100%; margin-top: 0.5rem;">⚙️ Rebuild Sync Queue</button>
          </div>
        </div>
      </div>

      <h4>Recent Sync Activity</h4>
      <div id="sync-history-container" class="table-responsive">
        <p style="color: var(--text-muted); font-style: italic; font-size: 0.85rem;">Loading history...</p>
      </div>

      <div id="import-progress-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; padding: 1rem;">
        <div class="card" style="width: 100%; max-width: 400px; padding: 2rem; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px solid var(--border-light);">
          <h4 style="margin-top: 0; color: var(--text-primary);">Importing Data...</h4>
          <p id="import-status-text" style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">Processing records...</p>
          <div style="height: 8px; background: var(--bg-secondary); border-radius: 4px; overflow: hidden; margin-bottom: 0.5rem;">
            <div id="import-progress-bar" style="width: 0%; height: 100%; background: var(--accent-primary); transition: width 0.3s;"></div>
          </div>
        </div>
      </div>
    `;
}

export function setupDbManagementListeners(user, cooperativeId, container) {
  const exportBtn = document.getElementById('export-db-btn');
  const importBtn = document.getElementById('import-db-btn');
  const importInput = document.getElementById('db-import-input');
  const summaryContainer = document.getElementById('sync-summary-container');
  const historyContainer = document.getElementById('sync-history-container');
  const retryBtn = document.getElementById('retry-sync-btn');
  const clearBtn = document.getElementById('clear-sync-logs-btn');
  const rebuildBtn = document.getElementById('rebuild-queue-btn');

  // Recent-activity table state: default newest-first (Z-A on Time);
  // every header toggles A-Z / Z-A on click. Preserved across refreshes.
  let historyRows = [];
  let historySig = '';
  let historySortKey = 'created_at';
  let historySortDir = -1;

  const historyVal = (item, key) => {
    if (key === 'created_at') return String(item.created_at || '');
    if (key === 'entity') return String(item.entity || item.collection_name || '').toLowerCase();
    if (key === 'operation_type') return String(item.operation_type || '').toLowerCase();
    if (key === 'status') return String(item.status || '').toLowerCase();
    return '';
  };

  const renderHistory = () => {
    const scroller = historyContainer.querySelector('#sync-history-scroll');
    const prevScrollTop = scroller ? scroller.scrollTop : 0;
    if (historyRows.length === 0) {
      historyContainer.innerHTML = '<p style="color: var(--text-muted); font-style: italic; font-size: 0.85rem;">No recent activity.</p>';
      return;
    }
    const rows = [...historyRows].sort((a, b) => {
      const va = historyVal(a, historySortKey);
      const vb = historyVal(b, historySortKey);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return cmp * historySortDir;
    });
    const arrow = (key) => historySortKey === key ? (historySortDir === 1 ? ' ▲' : ' ▼') : '';
    const th = (key, label) => `<th data-sort="${key}" title="Sort" style="cursor: pointer; user-select: none; white-space: nowrap; position: sticky; top: 0; background: var(--bg-card); z-index: 1;">${label}${arrow(key)}</th>`;
    historyContainer.innerHTML = `
        <div id="sync-history-scroll" style="max-height: 320px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: var(--radius-md);">
          <table class="crud-table" style="font-size: 0.75rem; margin: 0;">
            <thead>
              <tr>
                ${th('created_at', 'Time')}
                ${th('entity', 'Entity')}
                ${th('operation_type', 'Operation')}
                ${th('status', 'Status')}
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => {
                const when = item.created_at ? new Date(item.created_at) : null;
                const timeText = when && !isNaN(when.getTime())
                  ? when.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  : '—';
                return `
                <tr>
                  <td style="color: var(--text-muted); white-space: nowrap;">${timeText}</td>
                  <td><span style="text-transform: capitalize;">${item.entity || item.collection_name || '—'}</span></td>
                  <td><span style="text-transform: uppercase; font-size: 0.7rem; font-weight: 600;">${item.operation_type || '—'}</span></td>
                  <td>
                    <span style="padding: 0.1rem 0.4rem; border-radius: 4px; font-weight: 600; font-size: 0.7rem;
                      background: ${item.status === 'completed' ? 'var(--success-bg)' : (item.status === 'failed' ? 'var(--danger-bg)' : 'var(--bg-secondary)')};
                      color: ${item.status === 'completed' ? 'var(--success)' : (item.status === 'failed' ? 'var(--danger)' : 'var(--text-muted)')};">
                      ${item.status}
                    </span>
                  </td>
                </tr>
              `}).join('')}
            </tbody>
          </table>
        </div>
      `;
    const restored = historyContainer.querySelector('#sync-history-scroll');
    if (restored) restored.scrollTop = prevScrollTop;
  };

  // Delegated header clicks (bound once — innerHTML is replaced on refresh).
  historyContainer.addEventListener('click', (e) => {
    const header = e.target.closest('th[data-sort]');
    if (!header) return;
    const key = header.dataset.sort;
    if (historySortKey === key) {
      historySortDir = historySortDir === 1 ? -1 : 1;
    } else {
      historySortKey = key;
      historySortDir = key === 'created_at' ? -1 : 1;
    }
    renderHistory();
  });

  const refreshStatus = async () => {
    try {
      const dbExists = await checkDbExists();
      const healthDiv = document.getElementById('db-health-status');
      if (healthDiv) {
        healthDiv.innerHTML = dbExists
          ? '<span style="color: var(--success);">✅ Local Database Found</span>'
          : '<span style="color: var(--danger);">❌ No Local Data Found</span>';
      }

      const syncMeta = await getSyncMeta(cooperativeId);
      const syncStatusContainer = document.getElementById('initial-sync-status-container');
      if (syncStatusContainer) {
        const collections = (syncMeta && syncMeta.collections) || {}
        const syncedCount = SYNC_COLLECTIONS.filter(name => collections[name] === 1).length
        const totalCount = SYNC_COLLECTIONS.length
        const allComplete = syncedCount === totalCount
        const pct = totalCount > 0 ? Math.round((syncedCount / totalCount) * 100) : 0

        syncStatusContainer.innerHTML = `
          <div style="margin-bottom: 1rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
              <span style="font-weight: 600; font-size: 0.9rem; color: var(--text-primary);">
                ${allComplete ? '✅ All Data Pulled' : '⏳ Downloading...'}
              </span>
              <span style="font-size: 0.8rem; color: var(--text-muted);">${syncedCount}/${totalCount}</span>
            </div>
            <div style="height: 6px; background: var(--bg-secondary); border-radius: 3px; overflow: hidden;">
              <div style="width: ${pct}%; height: 100%; background: ${allComplete ? 'var(--success)' : 'var(--accent-primary)'}; border-radius: 3px; transition: width 0.5s;"></div>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; font-size: 0.8rem;">
            ${SYNC_COLLECTIONS.map(name => {
              const done = collections[name] === 1
              const label = name.charAt(0).toUpperCase() + name.slice(1)
              return `
                <div style="display: flex; align-items: center; gap: 0.4rem; color: var(--text-muted);">
                  <span style="width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
                    background: ${done ? 'var(--success)' : 'var(--warning)'};"></span>
                  <span style="${done ? 'color: var(--text-primary);' : ''}">${label}</span>
                </div>
              `
            }).join('')}
          </div>
        `
      }

      const summary = await getSyncQueueSummary();
      summaryContainer.innerHTML = `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.9rem;">
            <div style="color: var(--text-muted);">Pending: <span style="font-weight: 600; color: var(--text-primary);">${summary.pending}</span></div>
            <div style="color: var(--text-muted);">Processing: <span style="font-weight: 600; color: var(--accent-primary);">${summary.processing || 0}</span></div>
            <div style="color: var(--text-muted);">Failed: <span style="font-weight: 600; color: var(--danger);">${summary.failed}</span></div>
            <div style="color: var(--text-muted);">Total Logs: <span style="font-weight: 600; color: var(--text-muted);">${summary.total}</span></div>
          </div>
        `;

      // Load the FULL queue history (no cap). Skip the DOM rebuild when
      // nothing changed so large tables don't jank the 5s auto-refresh.
      const freshRows = await getSyncQueueDetails();
      const freshSig = freshRows.length + '|' + freshRows.map(q => `${q.id}:${q.status}:${q.attempt_count || 0}:${q.operation_type || ''}`).join(',');
      if (freshSig !== historySig) {
        historyRows = freshRows;
        historySig = freshSig;
        renderHistory();
      } else if (historyRows.length === 0) {
        renderHistory();
      }
    } catch (err) {
      console.error('Failed to refresh sync status:', err);
    }
  };

  exportBtn?.addEventListener('click', async () => {
    try {
      exportBtn.disabled = true; exportBtn.innerText = 'Exporting...';
      const result = await exportDatabase();
      const blob = new Blob([result.buffer], { type: 'application/x-sqlite3' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
      a.href = url;
      a.download = `cooperative_backup_${ts}.db`;
      a.click();
      URL.revokeObjectURL(url);
      const totalRows = (result.exported || []).reduce((s, t) => s + (t.rows || 0), 0);
      if (result.skipped && result.skipped.length > 0) {
        showToast(`Exported ${(result.exported || []).length} tables (${totalRows} rows). Skipped not-initialized: ${result.skipped.join(', ')}. Reload the app to repair, then export again for a complete backup.`, 'warning');
      } else {
        showToast(`Database exported (${(result.exported || []).length} tables, ${totalRows} rows).`, 'success');
      }
    } catch (err) {
      showToast('Export failed: ' + err.message, 'error');
    } finally {
      exportBtn.disabled = false; exportBtn.innerText = 'Export Database';
    }
  });

  importBtn?.addEventListener('click', () => importInput.click());

  importInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm('Importing will merge records from the backup file and queue them for cloud upload. This may take a moment. Continue?')) {
      importInput.value = '';
      return;
    }

    const modal = document.getElementById('import-progress-modal');
    const bar = document.getElementById('import-progress-bar');
    const statusText = document.getElementById('import-status-text');

    try {
      modal.style.display = 'flex';
      statusText.innerText = 'Reading file...';
      bar.style.width = '10%';

      const buffer = await file.arrayBuffer();
      bar.style.width = '30%';
      statusText.innerText = 'Merging records...';

      const stats = await importDatabase(buffer, cooperativeId);
      bar.style.width = '70%';

      const importedCount = Object.values(stats).reduce((a, b) => a + b, 0);
      statusText.innerText = `Queuing ${importedCount} records for sync...`;

      const enqueued = await scanAndEnqueueUnsynced(cooperativeId);
      bar.style.width = '100%';

      showToast(`Import successful!\n\nRecords merged:\n${Object.entries(stats).filter(([_, v]) => v > 0).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\nTotal records enqueued for sync: ${enqueued}`, 'success');
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
    } finally {
      modal.style.display = 'none';
      importInput.value = '';
      refreshStatus();
    }
  });

  retryBtn?.addEventListener('click', async () => {
    try {
      retryBtn.disabled = true;
      const originalText = retryBtn.innerHTML;
      retryBtn.innerHTML = '🔄 Restarting...';
      await restartAllSyncItems();
      
      // Trigger sync asynchronously in the background so the UI is responsive immediately
      import('../../services/syncService.js').then(({ pushQueue }) => {
        pushQueue(cooperativeId);
      }).catch(err => {
        console.warn('[DbManagement] Failed to trigger pushQueue after restart:', err);
      });
      
      showToast('All sync operations restarted successfully', 'success');
      refreshStatus();
      retryBtn.innerHTML = originalText;
    } catch (err) {
      showToast('Restart failed: ' + err.message, 'error');
    } finally {
      retryBtn.disabled = false;
    }
  });

  rebuildBtn?.addEventListener('click', async () => {
    if (!confirm('Rebuilding will clear the active queue, mark all queued items as unsynced in their tables, and re-enqueue them fresh. Continue?')) return;
    try {
      rebuildBtn.disabled = true;
      const originalText = rebuildBtn.innerHTML;
      rebuildBtn.innerHTML = '⚙️ Rebuilding...';
      const enqueuedCount = await resetSyncQueueAndMarkUnsynced(cooperativeId);
      
      // Trigger sync asynchronously in the background immediately
      import('../../services/syncService.js').then(({ pushQueue }) => {
        pushQueue(cooperativeId);
      }).catch(err => {
        console.warn('[DbManagement] Failed to trigger pushQueue after rebuild:', err);
      });
      
      showToast(`Sync queue rebuilt successfully! Enqueued ${enqueuedCount} items.`, 'success');
      refreshStatus();
      rebuildBtn.innerHTML = originalText;
    } catch (err) {
      showToast('Rebuild failed: ' + err.message, 'error');
    } finally {
      rebuildBtn.disabled = false;
    }
  });

  clearBtn?.addEventListener('click', async () => {
    if (!confirm('Clear all completed and failed sync logs? This only removes the logs, not the synced data.')) return;
    await clearSyncQueueLogs();
    showToast('Sync logs cleared successfully', 'success');
    refreshStatus();
  });

  const forceResyncBtn = document.getElementById('force-resync-btn');
  forceResyncBtn?.addEventListener('click', async () => {
    if (!confirm('This will push any pending local changes to the cloud, then clear your local database and re-download everything from scratch. Continue?')) return;
    
    let activePollInterval = null;
    try {
      forceResyncBtn.disabled = true;
      forceResyncBtn.innerHTML = '⏳ Re-syncing database...';
      
      // 1. Immediately reset the UI's collections list to yellow/unsynced status
      const syncStatusContainer = document.getElementById('initial-sync-status-container');
      if (syncStatusContainer) {
        syncStatusContainer.innerHTML = `
          <div style="margin-bottom: 1rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
              <span style="font-weight: 600; font-size: 0.9rem; color: var(--text-primary);">⏳ Resetting Sync Status...</span>
              <span style="font-size: 0.8rem; color: var(--text-muted);">0/${SYNC_COLLECTIONS.length}</span>
            </div>
            <div style="height: 6px; background: var(--bg-secondary); border-radius: 3px; overflow: hidden;">
              <div style="width: 0%; height: 100%; background: var(--warning); border-radius: 3px; transition: width 0.5s;"></div>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; font-size: 0.8rem;">
            ${SYNC_COLLECTIONS.map(name => {
              const label = name.charAt(0).toUpperCase() + name.slice(1);
              return `
                <div style="display: flex; align-items: center; gap: 0.4rem; color: var(--text-muted);">
                  <span style="width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--warning);"></span>
                  <span>${label}</span>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }
      
      // 2. Start high-frequency polling to visually update the statuses as they sync
      activePollInterval = setInterval(refreshStatus, 300);

      // 3. Trigger the full resync
      const result = await triggerFullResync(user);
      
      // Clean up the high-frequency poller and do a final refresh
      if (activePollInterval) {
        clearInterval(activePollInterval);
        activePollInterval = null;
      }
      await refreshStatus();

      const msg = result.pushed > 0
        ? `Pushed ${result.pushed} pending change(s) before re-sync.`
        : 'No pending changes to push.';
      showToast(`Full re-sync complete. ${msg}`, 'success');
    } catch (err) {
      if (activePollInterval) {
        clearInterval(activePollInterval);
      }
      await refreshStatus();
      showToast('Full re-sync failed: ' + err.message, 'error');
    } finally {
      forceResyncBtn.disabled = false;
      forceResyncBtn.innerHTML = '🔄 Force Full Re-Sync';
    }
  });

  refreshStatus();
  const poller = setInterval(refreshStatus, 5000);

  // Cleanup poller when section changes
  const observer = new MutationObserver((mutations) => {
    if (!document.getElementById('export-db-btn')) {
      clearInterval(poller);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
