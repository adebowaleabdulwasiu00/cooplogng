import { renderMembersFilters, attachFiltersListeners } from './membersFilters.js'
import { renderMembersTable, getTableStyles } from './membersTable.js'
import { hasPermission } from '../../services/permissionService.js'

export async function renderMembersPage(container, user) {
    const isAdmin = hasPermission(user.permissions, 'admin') || user.username?.toLowerCase() === 'admin'
    const canCreate = isAdmin || hasPermission(user.permissions, 'create_member')

    // 1. Check if page scaffold is already rendered (prevents sync flickering)
    const existingPage = container.querySelector('.members-page')
    if (existingPage) {
        try {
            const { applyFilters, getFilteredMembers } = await import('./membersState.js')
            const { renderMembersStats } = await import('./membersStats.js')
            
            // Re-apply current search/filters
            applyFilters()
            
            // Update stats
            const statsContainer = container.querySelector('#members-stats-mount')
            if (statsContainer) {
                statsContainer.innerHTML = renderMembersStats(getFilteredMembers())
            }
            
            // Diff-render the table
            renderMembersTable(container)
            return
        } catch (err) {
            console.error("[MembersPage] Silent Refresh Error, falling back to full render:", err)
        }
    }

    // 2. Initial Scaffold
    container.innerHTML = `
      ${getTableStyles()}
      <style>
          .members-page {
              width: 100%;
              height: calc(100vh - 4px); /* Full height minus minor buffer */
              display: flex;
              flex-direction: column;
              position: relative;
              font-family: 'Inter', system-ui, sans-serif;
              animation: fadeIn 0.3s ease-out;
              padding: 1.5rem;
              background: var(--bg-main);
              overflow: hidden; /* Only internal containers scroll */
          }
          
          .members-sticky-header {
              position: sticky;
              top: 0;
              z-index: 100;
              background: var(--bg-main);
              padding-bottom: 0.25rem;
          }

          .members-content-area {
              flex: 1;
              width: 100%;
              display: flex;
              flex-direction: column;
              margin-top: 0.5rem;
              min-height: 0; /* Allow flex shrinking */
              overflow: hidden;
          }

          .table-container {
              flex: 1;
              overflow-y: auto;
              border-radius: var(--radius-lg);
              background: var(--bg-card);
              border: 1px solid var(--border-light);
              box-shadow: var(--shadow-sm);
              scrollbar-width: thin;
              scrollbar-color: var(--border-medium) transparent;
          }
          .table-container::-webkit-scrollbar { width: 6px; }
          .table-container::-webkit-scrollbar-thumb { background: var(--border-medium); border-radius: 10px; }

          .fab-container {
              position: fixed;
              bottom: 2rem;
              right: 2rem;
              z-index: 100;
          }
          
          .fab {
              width: 56px;
              height: 56px;
              border-radius: 50%;
              background: var(--accent-primary);
              color: var(--text-inverse);
              border: none;
              box-shadow: var(--shadow-lg);
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .fab:hover {
              background: var(--accent-hover);
              transform: scale(1.08);
          }

          @media (max-width: 768px) {
              .members-page {
                padding: 0 !important;
                padding-top: 0.25rem !important;
                height: 100% !important;
                overflow: hidden;
              }
              .members-sticky-header { padding-bottom: 0; }
              .members-content-area { margin-top: 0; }
              .table-container {
                border-radius: 0;
                border: none;
                box-shadow: none;
                background: transparent;
              }
              .fab-container { display: none !important; }
          }
      </style>

      <div class="members-page">
          <div class="members-sticky-header">
              <div id="members-filters-mount"></div>
          </div>

          <div class="members-content-area">
              <div class="table-container" id="members-table-container">
                  <table class="styled-table">
        <thead>
            <tr style="position: sticky; top: 0; background: var(--bg-main); z-index: 10;">
            <th class="col-profile"></th>
            <th class="col-reg-no" style="width: 55px; text-align: center;">Reg No</th>
            <th>Name</th>
            <th class="col-mobile">Mobile</th>
            <th>Status</th>
            <th>Created</th>
            <th>Last Modified</th>
        </tr>
        </thead>
        <tbody id="members-table-body"></tbody>
    </table>
    <div id="infinite-scroll-indicator"></div>
</div>
</div>

          <div class="fab-container">
              ${canCreate ? `
              <button type="button" class="fab" id="fab-add-btn" title="Add Member">
                  <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4"></path></svg>
              </button>
              ` : ''}
          </div>
      </div>
    `

        // 2. Component Rendering
        try {
            const filtersMount = container.querySelector('#members-filters-mount')
            if (filtersMount) {
                filtersMount.innerHTML = renderMembersFilters(container, user)
                attachFiltersListeners(container, user)
            }
        } catch (err) {
            console.error("[MembersPage] Render Error:", err)
            const errorMsg = document.createElement('div')
            errorMsg.style.color = 'red'
            errorMsg.style.padding = '1rem'
            errorMsg.innerText = "Error rendering components: " + err.message
            container.prepend(errorMsg)
        }

        container.querySelector('#fab-add-btn')?.addEventListener('click', () => {
            window.location.hash = 'members/add'
        })


    try {
        renderMembersTable(container)
    } catch (err) {
        console.error("[MembersPage] Table Render Error:", err)
    }
}
