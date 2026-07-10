/**
 * Renders the modern summary cards at the top of the Members page.
 * Optimized for mobile with a tight grid and responsive font sizes.
 */
export function renderMembersStats(members = []) {
    let total = members.length
    let active = 0
    let inactive = 0
    let suspended = 0
    let newThisMonth = 0
    
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
    }

    return `
      <div class="members-stats-grid">
          <div class="stat-card">
              <div class="stat-label">Total</div>
              <div class="stat-value">${total}</div>
          </div>

          <div class="stat-card">
              <div class="stat-label">Active</div>
              <div class="stat-value" style="color: var(--success);">${active}</div>
          </div>

          <div class="stat-card">
              <div class="stat-label">Issues</div>
              <div class="stat-value" style="color: var(--danger);">${inactive + suspended}</div>
          </div>

          <div class="stat-card">
              <div class="stat-label">New</div>
              <div class="stat-value" style="color: var(--accent-primary);">${newThisMonth}</div>
          </div>
      </div>
    `
}
