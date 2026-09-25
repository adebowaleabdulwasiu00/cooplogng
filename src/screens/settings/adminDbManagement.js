import { exportDatabase, getSyncMeta, getAllForCoop, saveDoc, enqueueWrite } from '../../services/sqliteService.js';
import { showToast } from '../../services/toastService.js';
import { SYNC_COLLECTIONS } from '../../services/sqlite/syncState.js';

export function renderAdminDbManagementSection(area) {
  area.innerHTML = `
      <h3>Database Management</h3>
      <p class="section-desc">Extract your cooperative database and monitor initial cloud synchronization.</p>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
        <div class="card" style="padding: 1.5rem; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--bg-card); width: 100%;">
          <h4 style="margin-top: 0; color: var(--text-primary);">Extract Database</h4>
          <div id="extract-status" style="margin-bottom: 0.75rem; font-size: 0.85rem; font-weight: 600;"></div>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.25rem;">
            Download a full copy of this cooperative's database. Once extracted, all users and members will be unable to log in until the database is restored by an administrator.
          </p>
          <button id="extract-db-btn" class="primary-button" style="padding: 0.6rem 1rem; font-size: 0.85rem; width: 100%; background: var(--danger); border-color: var(--danger);">
            ⚠️ Extract Database
          </button>
        </div>

        <div class="card" style="padding: 1.5rem; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--bg-card); width: 100%;">
          <h4 style="margin-top: 0; color: var(--text-primary);">Initial Cloud Pull Status</h4>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">Shows whether each data set has been fully downloaded from the cloud.</p>
          <div id="admin-initial-sync-status">
            <p style="color: var(--text-muted); font-style: italic; font-size: 0.85rem;">Loading...</p>
          </div>
        </div>
      </div>

      <!-- Extract Confirmation Modal -->
      <div id="extract-confirm-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 10000; align-items: center; justify-content: center; padding: 1rem;">
        <div style="background: var(--bg-card); border: 1px solid var(--border-light); border-radius: var(--radius-lg); width: 100%; max-width: 500px; box-shadow: var(--shadow-xl); animation: modal-pop 0.3s ease-out;">
          <div style="padding: 1.25rem 1.75rem 1rem; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h3 style="margin: 0; font-size: 1.2rem; font-weight: 800; color: var(--danger);">⚠️ Extract Database</h3>
              <p style="margin: 0.25rem 0 0 0; font-size: 0.85rem; color: var(--text-muted);">This action cannot be undone.</p>
            </div>
            <button id="extract-modal-close" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-muted); padding: 0; line-height: 1;">&times;</button>
          </div>
          <div style="padding: 1.75rem;">
            <div style="background: var(--danger-bg, #fef2f2); border: 1px solid var(--danger, #ef4444); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1.25rem;">
              <p style="margin: 0; font-size: 0.9rem; color: var(--danger, #ef4444); line-height: 1.6;">
                <strong>Warning:</strong> Extracting the database means you will need to leave the app to download the file. We would hate to lose you, but this action is permanent and <strong>cannot be reversed</strong>.
              </p>
            </div>
            <p style="font-size: 0.9rem; color: var(--text-primary); line-height: 1.6; margin-bottom: 1rem;">
              Once the database is extracted:
            </p>
            <ul style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.8; margin: 0 0 1.25rem 1.25rem; padding: 0;">
              <li>All users and members of this cooperative will be <strong style="color: var(--text-primary);">unable to log in</strong></li>
              <li>Login attempts will be rejected regardless of whether the password is correct</li>
              <li>Users will see a message to contact their administrator</li>
              <li>This cooperative's data will be effectively locked</li>
            </ul>
            <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">
              To proceed, type <strong style="color: var(--danger);">EXTRACT</strong> below:
            </p>
            <input type="text" id="extract-confirm-input" placeholder="Type EXTRACT to confirm" style="width: 100%; margin-top: 0.75rem; padding: 0.75rem; border: 1px solid var(--border-medium); border-radius: var(--radius-md); background: var(--bg-input); color: var(--text-primary); font-size: 0.9rem; box-sizing: border-box;" autocomplete="off" />
          </div>
          <div style="padding: 1.25rem 1.75rem; border-top: 1px solid var(--border-light); background: var(--bg-secondary); display: flex; gap: 0.75rem; justify-content: flex-end;">
            <button id="extract-modal-cancel" style="padding: 0.6rem 1.25rem; border: 1px solid var(--border-medium); border-radius: var(--radius-md); background: transparent; color: var(--text-primary); font-weight: 600; cursor: pointer; font-size: 0.85rem;">Cancel</button>
            <button id="extract-modal-confirm" disabled style="padding: 0.6rem 1.25rem; border: none; border-radius: var(--radius-md); background: var(--danger); color: white; font-weight: 600; cursor: pointer; font-size: 0.85rem; opacity: 0.5; pointer-events: none;">Extract & Lock</button>
          </div>
        </div>
      </div>
    `;
}

export function setupAdminDbManagementListeners(user, cooperativeId) {
  const extractBtn = document.getElementById('extract-db-btn');
  const modal = document.getElementById('extract-confirm-modal');
  const confirmBtn = document.getElementById('extract-modal-confirm');
  const cancelBtn = document.getElementById('extract-modal-cancel');
  const closeBtn = document.getElementById('extract-modal-close');
  const confirmInput = document.getElementById('extract-confirm-input');

  // Check if already extracted and update UI
  const checkExtractedStatus = async () => {
    try {
      const coops = await getAllForCoop(cooperativeId, 'cooperatives');
      const coop = coops[0];
      const statusDiv = document.getElementById('extract-status');
      if (coop && coop.is_extracted) {
        if (statusDiv) {
          statusDiv.innerHTML = '<span style="color: var(--danger);">⛔ Database has been extracted - all logins are blocked</span>';
        }
        if (extractBtn) {
          extractBtn.disabled = true;
          extractBtn.innerText = 'Database Already Extracted';
          extractBtn.style.opacity = '0.5';
          extractBtn.style.cursor = 'not-allowed';
        }
      } else {
        if (statusDiv) {
          statusDiv.innerHTML = '<span style="color: var(--success);">✅ Database active - logins enabled</span>';
        }
      }
    } catch (err) {
      console.error('Failed to check extracted status:', err);
    }
  };

  // Load initial cloud pull status
  const refreshSyncStatus = async () => {
    try {
      const syncMeta = await getSyncMeta(cooperativeId);
      const container = document.getElementById('admin-initial-sync-status');
      if (!container) return;

      const collections = (syncMeta && syncMeta.collections) || {};
      const syncedCount = SYNC_COLLECTIONS.filter(name => collections[name] === 1).length;
      const totalCount = SYNC_COLLECTIONS.length;
      const allComplete = syncedCount === totalCount;
      const pct = totalCount > 0 ? Math.round((syncedCount / totalCount) * 100) : 0;

      container.innerHTML = `
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
            const done = collections[name] === 1;
            const label = name.charAt(0).toUpperCase() + name.slice(1);
            return `
              <div style="display: flex; align-items: center; gap: 0.4rem; color: var(--text-muted);">
                <span style="width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: ${done ? 'var(--success)' : 'var(--warning)'};"></span>
                <span style="${done ? 'color: var(--text-primary);' : ''}">${label}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } catch (err) {
      console.error('Failed to refresh sync status:', err);
    }
  };

  // Extract button click - show modal
  extractBtn?.addEventListener('click', () => {
    modal.style.display = 'flex';
    confirmInput.value = '';
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.5';
    confirmBtn.style.pointerEvents = 'none';
    confirmInput.focus();
  });

  // Confirm input validation
  confirmInput?.addEventListener('input', () => {
    const val = confirmInput.value.trim();
    const isConfirmed = val === 'EXTRACT';
    confirmBtn.disabled = !isConfirmed;
    confirmBtn.style.opacity = isConfirmed ? '1' : '0.5';
    confirmBtn.style.pointerEvents = isConfirmed ? 'auto' : 'none';
  });

  // Close modal
  const closeModal = () => {
    modal.style.display = 'none';
    confirmInput.value = '';
  };
  cancelBtn?.addEventListener('click', closeModal);
  closeBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Confirm extraction
  confirmBtn?.addEventListener('click', async () => {
    if (confirmInput.value.trim() !== 'EXTRACT') return;

    try {
      confirmBtn.disabled = true;
      confirmBtn.innerText = 'Extracting...';

      // 1. Export the database
      const result = await exportDatabase(cooperativeId);
      const blob = new Blob([result.buffer], { type: 'application/x-sqlite3' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
      a.href = url;
      a.download = `cooperative_extracted_${ts}.db`;
      a.click();
      URL.revokeObjectURL(url);

      // 2. Set is_extracted = true in local DB
      const coops = await getAllForCoop(cooperativeId, 'cooperatives');
      const currentCoop = coops[0];
      if (currentCoop) {
        const updatedCoop = {
          ...currentCoop,
          is_extracted: true,
          modified_at: new Date().toISOString(),
          modified_by: user.username,
          is_synced: 0
        };
        await saveDoc('cooperatives', updatedCoop);
        await enqueueWrite(cooperativeId, 'cooperatives', currentCoop.id, 'update', updatedCoop);
      }

      // 3. Set is_extracted = true in Firestore (cloud)
      try {
        const { getDb, doc: fsDoc, updateDoc } = await import('../../firebase.js');
        const db = getDb();
        await updateDoc(fsDoc(db, 'cooperatives', String(cooperativeId)), {
          is_extracted: true,
          modified_at: new Date().toISOString(),
          modified_by: user.username
        });
      } catch (fsErr) {
        console.warn('[AdminDB] Firestore update failed (local already set):', fsErr.message);
      }

      const totalRows = (result.exported || []).reduce((s, t) => s + (t.rows || 0), 0);
      showToast(`Database extracted (${(result.exported || []).length} tables, ${totalRows} rows). All logins for this cooperative are now blocked.`, 'warning');

      closeModal();
      checkExtractedStatus();
    } catch (err) {
      showToast('Extraction failed: ' + err.message, 'error');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.innerText = 'Extract & Lock';
    }
  });

  checkExtractedStatus();
  refreshSyncStatus();

  // Auto-refresh sync status every 10 seconds
  const poller = setInterval(refreshSyncStatus, 10000);
  const observer = new MutationObserver(() => {
    if (!document.getElementById('extract-db-btn')) {
      clearInterval(poller);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
