import { statusFilter, sortKey, sortDir } from './membersState.js'

/**
 * Renders the summary cards at the top of the Members page.
 * Cards are clickable shortcuts (see attachStatsListeners):
 * Total -> All statuses, Active -> Active only, Issues -> Inactive+Suspended,
 * New -> sort newest first. Sub-lines expose the breakdown.
 */
export function renderMembersStats(members = []) {
    let total = members.length
    let active = 0
    let inactive = 0
    let suspended = 0
    let newThisMonth = 0
    let missingPhoto = 0
    
    const now = Date.now()
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000

    for (const m of members) {
        if (m.status === 'Active') active++
        else if (m.status === 'Inactive') inactive++
        else if (m.status === 'Suspended') suspended++
        
        if (m.date_joined) {
            const joinedMs = new Date(m.date_joined).getTime()
            if (!isNaN(joinedMs) && (now - joinedMs) <= thirtyDaysMs) {
                newThisMonth++
            }
        }

        const photo = String(m.image_path || '').trim().toLowerCase()
        if (!photo || photo === 'n/a' || photo === 'null' || photo === 'none' || photo === '-') {
            missingPhoto++
        }
    }

    const issues = inactive + suspended
    const activePct = total > 0 ? Math.round((active / total) * 100) : 0
    const isActive = (key) => {
        if (key === 'total') return statusFilter === 'All Status'
        if (key === 'active') return statusFilter === 'Active'
        if (key === 'issues') return statusFilter === 'Issues'
        if (key === 'new') return sortKey === 'created' && sortDir === 'desc'
        return false
    }

    return `
      <div class="members-stats-grid">
          <div class="stat-card${isActive('total') ? ' active' : ''}" data-stat="total" title="Show all statuses" role="button" tabindex="0">
              <div class="stat-label">Total</div>
              <div class="stat-value">${total}</div>
              <div class="stat-sub">${missingPhoto} no photo</div>
          </div>

          <div class="stat-card${isActive('active') ? ' active' : ''}" data-stat="active" title="Filter: Active only" role="button" tabindex="0">
              <div class="stat-label">Active</div>
              <div class="stat-value" style="color: var(--success);">${active}</div>
              <div class="stat-sub">${activePct}% of total</div>
          </div>

          <div class="stat-card${isActive('issues') ? ' active' : ''}" data-stat="issues" title="Filter: Inactive + Suspended" role="button" tabindex="0">
              <div class="stat-label">Issues</div>
              <div class="stat-value" style="color: var(--danger);">${issues}</div>
              <div class="stat-sub">Inact ${inactive} • Susp ${suspended}</div>
          </div>

          <div class="stat-card${isActive('new') ? ' active' : ''}" data-stat="new" title="Sort newest first" role="button" tabindex="0">
              <div class="stat-label">New</div>
              <div class="stat-value" style="color: var(--accent-primary);">${newThisMonth}</div>
              <div class="stat-sub">last 30 days</div>
          </div>
      </div>
    `
}

/**
 * Progressive click-to-filter. Dispatches a window event that
 * membersFilters handles (avoids a filters<->stats import cycle).
 * Safe to call after every stats re-render; attaches once per card.
 */
export function attachStatsListeners(container) {
    const scope = container || document
    scope.querySelectorAll('.members-stats-grid .stat-card[data-stat]').forEach(card => {
        if (card.dataset.statAttached) {
            // Refresh the active highlight on re-render (fresh nodes each time,
            // but harmless if called twice on the same node).
            return
        }
        card.dataset.statAttached = 'true'
        const fire = () => {
            window.dispatchEvent(new CustomEvent('members-stat-filter', {
                detail: { stat: card.dataset.stat }
            }))
        }
        card.addEventListener('click', fire)
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fire()
            }
        })
    })
}
