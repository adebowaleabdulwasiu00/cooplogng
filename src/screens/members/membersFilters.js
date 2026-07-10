import {
    searchTerm, statusFilter, managerFilter,
    setSearchTerm, setStatusFilter, setManagerFilter,
    getAllMembers, getFilteredMembers, applyFilters,
    isSelectionMode, selectedIds, setSelectionMode, deselectAll, usersList
} from './membersState.js'
import { renderMembersTable } from './membersTable.js'
import { renderMembersStats } from './membersStats.js'
import { hasPermission } from '../../services/permissionService.js'
import { deleteMember, updateMember } from '../../services/dataService.js'
import { checkMemberHasRemittances } from '../../services/sqliteService.js'
import { escapeHtml } from '../../utils/formatters.js'
import { showToast } from '../../services/toastService.js'

let searchTimeout = null

/**
 * Handles DOM updates specifically for filters
 */
function updateFilteredViews(container) {
    applyFilters()
    
    // Update Stats
    const statsContainer = container.querySelector('#members-stats-mount')
    if (statsContainer) statsContainer.innerHTML = renderMembersStats(getFilteredMembers())
    
    // Update Table
    renderMembersTable(container)

    // Update reset button visibility
    const resetBtn = container.querySelector('#search-reset-btn')
    if (resetBtn) {
        resetBtn.style.display = searchTerm ? 'flex' : 'none'
    }

    // Update selection bar
    updateSelectionBar(container)
}

function updateSelectionBar(container) {
    const bar = container.querySelector('#members-selection-bar')
    if (!bar) return

    if (!isSelectionMode || selectedIds.size === 0) {
        bar.style.display = 'none'
        return
    }

    const isAdmin = hasPermission(container.dataset.userPermissions, 'admin')
    const canDelete = isAdmin || hasPermission(container.dataset.userPermissions, 'delete_member')
    const canUpdate = isAdmin || hasPermission(container.dataset.userPermissions, 'update_member')

    bar.style.display = 'flex'
    bar.innerHTML = `
        <div class="selection-info">
            <strong>${selectedIds.size}</strong> members selected
            <button class="ghost-link" id="cancel-selection-btn">Cancel</button>
        </div>
        <div class="selection-actions">
            ${canUpdate ? `
                <div class="bulk-assign-wrap" style="position: relative;">
                    <button class="action-btn" id="bulk-manager-dropdown-btn">
                        Assign Managers...
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="margin-left: 4px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="bulk-manager-menu" class="dropdown-menu hidden" style="position: absolute; top: 100%; right: 0; margin-top: 8px; width: 300px; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 1100; padding: 0.75rem;">
                        <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.75rem; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center;">
                            Select Managers
                        </div>
                        
                        <div style="margin-bottom: 0.75rem;">
                            <input type="text" id="mgr-dropdown-search" placeholder="Search managers..." style="width: 100%; padding: 0.4rem; border-radius: 4px; border: 1px solid var(--border-medium); font-size: 0.8rem; background: var(--bg-input); color: var(--text-primary);">
                        </div>

                        <div class="managers-list" style="max-height: 250px; overflow-y: auto; margin-bottom: 0.75rem;">
                            <label style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem; cursor: pointer; border-radius: 4px;" class="hover-bg">
                                <input type="checkbox" id="bulk-mgr-chk-all">
                                <span style="font-weight: 700; font-size: 0.85rem;">All Managers</span>
                            </label>
                            ${usersList.map(u => {
                                const displayName = u.full_name || u.username;
                                return `
                                <label style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem; cursor: pointer; border-radius: 4px;" class="hover-bg mgr-item" data-search="${escapeHtml(displayName.toLowerCase())}">
                                    <input type="checkbox" class="bulk-mgr-chk" value="${escapeHtml(u.username)}">
                                    <div style="display: flex; flex-direction: column;">
                                        <span style="font-size: 0.85rem; color: var(--text-primary); font-weight: 500;">${escapeHtml(displayName)}</span>
                                        ${u.full_name ? `<span style="font-size: 0.7rem; color: var(--text-muted);">@${escapeHtml(u.username)}</span>` : ''}
                                    </div>
                                </label>
                            `}).join('')}
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="primary-button" id="apply-bulk-mgr" style="flex: 1; height: 1.85rem; font-size: 0.7rem; border-radius: 999px;">Apply</button>
                            <button class="secondary-button" id="close-bulk-mgr" style="flex: 1; height: 1.85rem; font-size: 0.7rem; border-radius: 999px; background: white; color: black;">Cancel</button>
                        </div>
                    </div>
                </div>
            ` : ''}
            ${canDelete ? `
                <button class="action-btn danger" id="bulk-delete-btn">Delete Selected</button>
            ` : ''}
        </div>
    `

    // Attach Bar Listeners
    bar.querySelector('#cancel-selection-btn')?.addEventListener('click', () => {
        setSelectionMode(false)
        updateFilteredViews(container)
    })

    const dropdownBtn = bar.querySelector('#bulk-manager-dropdown-btn')
    const menu = bar.querySelector('#bulk-manager-menu')
    
    dropdownBtn?.addEventListener('click', (e) => {
        e.stopPropagation()
        menu?.classList.toggle('hidden')
        if (!menu?.classList.contains('hidden')) {
            menu.querySelector('#mgr-dropdown-search')?.focus()
        }
    })

    // Search inside dropdown
    menu?.querySelector('#mgr-dropdown-search')?.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase()
        menu.querySelectorAll('.mgr-item').forEach(item => {
            const text = item.dataset.search || ''
            item.style.display = text.includes(val) ? 'flex' : 'none'
        })
    })

    // All Managers checkbox
    menu?.querySelector('#bulk-mgr-chk-all')?.addEventListener('change', (e) => {
        menu.querySelectorAll('.bulk-mgr-chk').forEach(cb => {
            cb.checked = e.target.checked
        })
    })

    bar.querySelector('#close-bulk-mgr')?.addEventListener('click', (e) => {
        e.stopPropagation()
        menu?.classList.add('hidden')
    })

    bar.querySelector('#apply-bulk-mgr')?.addEventListener('click', async (e) => {
        e.stopPropagation()
        const selectedMgrs = Array.from(menu.querySelectorAll('.bulk-mgr-chk:checked')).map(cb => cb.value)
        
        if (selectedMgrs.length === 0) {
            showToast("Please select at least one manager.", "warning")
            return
        }

        const newManagerString = selectedMgrs.join(', ')
        
        if (confirm(`Assign managers (${newManagerString}) to ${selectedIds.size} members?`)) {
            const allMembers = getAllMembers()
            const username = container.dataset.username
            const coopId = container.dataset.coopId
            
            let successCount = 0
            let failCount = 0

            // Import necessary services for direct low-level update
            const { saveDoc, enqueueWrite } = await import('../../services/sqliteService.js')
            
            for (const id of selectedIds) {
                const member = allMembers.find(m => m.id === id)
                if (member) {
                    try {
                        const now = new Date().toISOString()
                        // Fast path: Direct low-level SQLite update bypassing validation/notifications
                        const updateData = { 
                            ...member, 
                            account_manager: newManagerString, 
                            cooperative_id: coopId,
                            modified_at: now,
                            modified_by: username,
                            is_synced: 0
                        }
                        
                        // 1. Local Write
                        await saveDoc('members', updateData)
                        
                        // 2. Queue for Sync
                        await enqueueWrite(coopId, 'members', id, 'update', { 
                            account_manager: newManagerString,
                            modified_at: now,
                            modified_by: username,
                            is_synced: 0
                        })
                        
                        successCount++
                    } catch (err) {
                        console.error(`[Bulk Assign] Failed for member ${id}:`, err)
                        failCount++
                    }
                } else {
                    failCount++
                }
            }
            
            showToast(`Operation Complete:\n- ${successCount} members updated successfully\n- ${failCount} members failed`, "success")
            
            setSelectionMode(false)
            window.dispatchEvent(new CustomEvent('refresh-members'))
            const { loadMembersData } = await import('./membersState.js')
            await loadMembersData({ 
                cooperativeId: coopId, 
                username: username, 
                permissions: container.dataset.userPermissions 
            })
            updateFilteredViews(container)
        }
    })

    bar.querySelector('#bulk-delete-btn')?.addEventListener('click', async () => {
        if (confirm(`Are you sure you want to delete ${selectedIds.size} members? Members with financial records will be skipped.`)) {
            let deletedCount = 0
            let skippedCount = 0
            let errorCount = 0
            const allMembers = getAllMembers()
            const username = container.dataset.username
            const coopId = container.dataset.coopId

            for (const id of selectedIds) {
                try {
                    const hasRecords = await checkMemberHasRemittances(coopId, id)
                    if (hasRecords) {
                        skippedCount++
                        continue
                    }
                    
                    await deleteMember(id, username, coopId)
                    deletedCount++
                } catch (err) {
                    console.error(`[Bulk Delete] Failed for member ${id}:`, err)
                    errorCount++
                }
            }

            showToast(`Operation Complete:\n- ${deletedCount} members deleted\n- ${skippedCount} members skipped (existing records)\n- ${errorCount} errors encountered`, "success")
            
            setSelectionMode(false)
            const { loadMembersData } = await import('./membersState.js')
            await loadMembersData({ 
                cooperativeId: coopId, 
                username: username, 
                permissions: container.dataset.userPermissions 
            })
            updateFilteredViews(container)
        }
    })
}

export function renderMembersFilters(container, user) {
    const isAdmin = hasPermission(user.permissions, 'admin') || user.username?.toLowerCase() === 'admin'
    const canUpdate = isAdmin || hasPermission(user.permissions, 'update_member')
    
    // Store user info for listeners
    container.dataset.username = user.username
    container.dataset.coopId = user.cooperativeId
    container.dataset.userPermissions = user.permissions

    // Extract unique managers with safety check
    const allMembers = getAllMembers()
    const managers = [...new Set(allMembers
        .map(m => String(m.account_manager || ''))
        .filter(Boolean)
        .flatMap(m => m.split(',').map(s => s.trim()))
    )]
    
    return `
      <div id="members-selection-bar" class="selection-bar-wrap" style="display: none;"></div>
      <div class="members-filters-row">
          <div class="search-and-selectors">
              <div class="search-input-wrap">
                  <svg class="search-icon" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                  <input type="text" id="member-search-input" placeholder="Search..." value="${escapeHtml(searchTerm)}">
                  <button id="search-reset-btn" style="display: ${searchTerm ? 'flex' : 'none'};">×</button>
              </div>
              
              <div class="selectors-row">
                  <select id="status-filter" class="adaptive-select">
                      <option value="All Status">Status</option>
                      <option value="Active" ${statusFilter === 'Active' ? 'selected' : ''}>Active</option>
                      <option value="Inactive" ${statusFilter === 'Inactive' ? 'selected' : ''}>Inactive</option>
                      <option value="Suspended" ${statusFilter === 'Suspended' ? 'selected' : ''}>Suspended</option>
                  </select>

                  <select id="manager-filter" class="adaptive-select">
                      <option value="All Managers">Manager</option>
                      ${managers.map(m => `<option value="${escapeHtml(m)}" ${managerFilter === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
                  </select>

                  <div class="action-buttons-group">
                      <button class="action-btn ${isSelectionMode ? 'active' : ''}" id="toggle-selection-btn" title="Bulk Selection">
                          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
                          <span class="btn-text">Select</span>
                      </button>
                      <button class="action-btn" id="export-members-btn" title="Export — Upgrade in Progress" style="opacity: 0.55; cursor: not-allowed; position: relative;">
                          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                          <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24" style="margin-left: -4px; color: var(--warning);"><path d="M12 1C8.676 1 6 3.676 6 7v1H4v14h16V8h-2V7c0-3.324-2.676-6-6-6zm0 2c2.276 0 4 1.724 4 4v1H8V7c0-2.276 1.724-4 4-4zm0 9a2 2 0 110 4 2 2 0 010-4z"/></svg>
                          <span class="btn-text">Export</span>
                      </button>
                      ${canUpdate ? `
                      <button class="action-btn" id="import-members-btn" title="Import — Upgrade in Progress" style="opacity: 0.55; cursor: not-allowed; position: relative;">
                          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" d="M12 15v-6m0 0l-3 3m3-3l3 3M5 20h14a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0014.586 3H5a2 2 0 00-2 2v13a2 2 0 002 2z"/><path stroke-width="2" d="M17 8H7"/></svg>
                          <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24" style="margin-left: -4px; color: var(--warning);"><path d="M12 1C8.676 1 6 3.676 6 7v1H4v14h16V8h-2V7c0-3.324-2.676-6-6-6zm0 2c2.276 0 4 1.724 4 4v1H8V7c0-2.276 1.724-4 4-4zm0 9a2 2 0 110 4 2 2 0 010-4z"/></svg>
                          <span class="btn-text">Import</span>
                      </button>
                      ` : ''}
                  </div>
              </div>
          </div>
      </div>
      
      <style>
          .selection-bar-wrap {
              display: none;
              background: var(--bg-sidebar);
              border: 1px solid var(--border-medium);
              border-radius: var(--radius-lg);
              padding: 0.75rem 1.25rem;
              margin-bottom: 0.75rem;
              justify-content: space-between;
              align-items: center;
              animation: slideDown 0.3s ease;
          }
          .selection-info { font-size: 0.9rem; color: var(--text-primary); }
          .ghost-link { background: none; border: none; color: var(--text-muted); text-decoration: underline; cursor: pointer; margin-left: 0.5rem; font-size: 0.8rem; }
          .selection-actions { display: flex; gap: 0.75rem; align-items: center; }
          .action-btn.danger { background: var(--danger-bg); color: var(--danger); border-color: var(--danger); }
          .action-btn.active { background: var(--accent-soft); border-color: var(--accent-primary); color: var(--accent-primary); }

          .dropdown-menu.hidden { display: none !important; }
          .hover-bg:hover { background: var(--bg-secondary); }
          .managers-list::-webkit-scrollbar { width: 6px; }
          .managers-list::-webkit-scrollbar-thumb { background: var(--border-medium); border-radius: 10px; }

          .members-filters-row {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 0.5rem;
              margin-bottom: 0.75rem;
              background: var(--bg-card);
              padding: 0.5rem;
              border-radius: var(--radius-lg);
              border: 1px solid var(--border-light);
          }
          .search-and-selectors {
              display: flex;
              gap: 0.5rem;
              flex: 1;
              align-items: center;
          }
          .selectors-row {
              display: flex;
              gap: 0.5rem;
              align-items: center;
          }
          .search-input-wrap {
              position: relative;
              flex: 1;
              max-width: 300px;
          }
          .search-input-wrap input {
              width: 100%;
              padding: 0.5rem 2rem;
              border-radius: var(--radius-md);
              border: 1px solid var(--border-medium);
              font-size: 0.85rem;
              outline: none;
              background: var(--bg-input);
              color: var(--text-primary);
          }
          .search-icon {
              position: absolute;
              left: 0.6rem;
              top: 50%;
              transform: translateY(-50%);
              color: var(--text-muted);
          }
          #search-reset-btn {
              position: absolute;
              right: 0.5rem;
              top: 50%;
              transform: translateY(-50%);
              background: var(--border-medium);
              border: none;
              width: 18px;
              height: 18px;
              border-radius: 50%;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              color: var(--text-muted);
              font-size: 1rem;
          }
          .adaptive-select {
              padding: 0.5rem;
              border-radius: var(--radius-md);
              border: 1px solid var(--border-medium);
              font-size: 0.8rem;
              background: var(--bg-input);
              color: var(--text-primary);
              outline: none;
              cursor: pointer;
          }
          .action-buttons-group {
              display: flex;
              gap: 0.4rem;
          }
          .action-btn {
              display: flex;
              align-items: center;
              gap: 0.3rem;
              padding: 0.5rem 0.75rem;
              border-radius: var(--radius-md);
              border: 1px solid var(--border-medium);
              background: var(--bg-card);
              font-size: 0.8rem;
              font-weight: 600;
              color: var(--text-primary);
              cursor: pointer;
              transition: all 0.2s;
          }
          .action-btn:hover {
              background: var(--bg-secondary);
          }
          
          @keyframes slideDown {
              from { transform: translateY(-10px); opacity: 0; }
              to { transform: translateY(0); opacity: 1; }
          }

          @media (max-width: 600px) {
              .members-filters-row {
                  flex-direction: column;
                  align-items: stretch;
                  max-height: 35vh;
                  padding: 0.6rem;
                  gap: 0.5rem;
              }
              .search-and-selectors {
                  flex-direction: column;
                  gap: 0.5rem;
              }
              .search-input-wrap {
                  max-width: none;
                  width: 100%;
              }
              .selectors-row {
                  display: flex;
                  gap: 0.4rem;
                  width: 100%;
                  align-items: center;
              }
              .adaptive-select {
                  flex: 1;
                  min-width: 0;
                  padding: 0.4rem;
                  font-size: 0.75rem;
              }
              .action-buttons-group {
                  display: contents; /* Merge with selectors-row if possible, but easier to just use flex on selectors-row */
              }
              /* Put buttons into the selectors row on mobile */
              .members-filters-row {
                  display: grid;
                  grid-template-columns: 1fr;
              }
              .search-and-selectors {
                  display: contents;
              }
              .search-input-wrap {
                  grid-row: 1;
              }
              .selectors-row {
                  grid-row: 2;
                  display: flex;
                  gap: 0.35rem;
              }
              .action-buttons-group {
                  display: flex;
                  gap: 0.35rem;
              }
              .action-btn { 
                  padding: 0.4rem;
                  min-width: 40px;
                  justify-content: center;
              }
              .btn-text { display: none !important; } /* Hide labels as requested */
          }
      </style>
    `
}

export function attachFiltersListeners(container, user) {
    const searchInput = container.querySelector('#member-search-input')
    const resetBtn = container.querySelector('#search-reset-btn')

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            if (searchTimeout) clearTimeout(searchTimeout)
            searchTimeout = setTimeout(() => {
                setSearchTerm(e.target.value)
                updateFilteredViews(container)
            }, 300)
        })
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            searchInput.value = ''
            setSearchTerm('')
            updateFilteredViews(container)
            searchInput.focus()
        })
    }

    // Dropdowns
    container.querySelector('#status-filter')?.addEventListener('change', (e) => {
        setStatusFilter(e.target.value === 'All Status' ? 'All Status' : e.target.value)
        updateFilteredViews(container)
    })
    container.querySelector('#manager-filter')?.addEventListener('change', (e) => {
        setManagerFilter(e.target.value === 'All Managers' ? 'All Managers' : e.target.value)
        updateFilteredViews(container)
    })

    // Toggle Selection Mode
    container.querySelector('#toggle-selection-btn')?.addEventListener('click', () => {
        setSelectionMode(!isSelectionMode)
        updateFilteredViews(container)
        // Update the filter button visual state immediately
        const btn = container.querySelector('#toggle-selection-btn')
        if (btn) btn.classList.toggle('active', isSelectionMode)
    })

    // Listen for selection changes from table
    window.addEventListener('members-selection-changed', () => {
        updateSelectionBar(container)
    })

    // Excel Actions
    container.querySelector('#export-members-btn')?.addEventListener('click', () => {
        showToast('⚙️ Upgrade in Progress — Export will be available in a future update.', 'warning')
    })
    container.querySelector('#import-members-btn')?.addEventListener('click', () => {
        showToast('⚙️ Upgrade in Progress — Import will be available in a future update.', 'warning')
    })
}
